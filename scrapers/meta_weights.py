# ─── Intelligence weights refresher ──────────────────────────────────────────
# Keeps the brawler_intelligence table in sync with the match data and the
# draft logic config. Runs standalone:
#
#   python -m scrapers.meta_weights
#
# ...and is also called by the masters / diamond_mythic scrapers after every
# successful data push, so the Intelligence Engine's statistical layer is
# never more than one scrape behind.
#
# What it does:
#   1. Sync brawler_classes from src/data/draft_logic_config.json — the single
#      source of truth for Bobby's 7-class framework (apiClassToDraftClass over
#      brawlerMeta.json, then brawlerClassOverrides on top). Brawlers found in
#      the DB but absent from the config/meta fall back to CONTROL.
#   2. Call the refresh_brawler_intelligence RPC per open patch, passing the
#      config's statisticalCoefficients so thresholds (popularity trap, broken
#      indicator, inflation bias, Bayesian prior) live in the JSON, not in SQL.

import json
import os
import requests

from scrapers.common import (
    require_credentials, SUPABASE_URL, SUPABASE_HEADERS,
    CURRENT_PATCH, CLOSED_PATCHES, PATCH_START_TIMES,
)

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(REPO_ROOT, "src", "data", "draft_logic_config.json")
BRAWLER_META_PATH = os.path.join(REPO_ROOT, "src", "data", "brawlerMeta.json")

def load_config():
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return json.load(f)

def build_class_map(config):
    """name → draft class for every brawler the config/meta knows about."""
    with open(BRAWLER_META_PATH, encoding="utf-8") as f:
        meta = json.load(f)
    api_map = config["apiClassToDraftClass"]
    overrides = {k: v for k, v in config["brawlerClassOverrides"].items() if not k.startswith("_")}
    classes = {}
    for name, m in meta.items():
        n = name.strip().upper()
        classes[n] = overrides.get(n) or api_map.get(m.get("class", "Unknown"), "CONTROL")
    # Overrides may name brawlers newer than brawlerMeta.json
    for n, cls in overrides.items():
        classes.setdefault(n, cls)
    return classes

def sync_brawler_classes(config):
    """Upsert brawler_classes so every row in brawlers has a draft class."""
    res = requests.get(f"{SUPABASE_URL}/rest/v1/brawlers?select=id,name", headers=SUPABASE_HEADERS)
    if res.status_code != 200:
        print(f"⚠️ Could not load brawlers lookup: {res.status_code} {res.text[:200]}")
        return False
    classes = build_class_map(config)
    default = config["apiClassToDraftClass"].get("Unknown", "CONTROL")
    rows = [
        {"brawler_id": b["id"], "draft_class": classes.get(b["name"].strip().upper(), default)}
        for b in res.json()
    ]
    up = requests.post(
        f"{SUPABASE_URL}/rest/v1/brawler_classes?on_conflict=brawler_id",
        json=rows,
        headers={**SUPABASE_HEADERS, "Prefer": "resolution=merge-duplicates"},
    )
    if up.status_code in (200, 201, 204):
        print(f"✅ brawler_classes synced ({len(rows)} brawlers)")
        return True
    print(f"⚠️ brawler_classes sync failed: {up.status_code} {up.text[:200]}")
    return False

def refresh_intelligence(patches=None):
    """Sync classes, then rebuild brawler_intelligence for each open patch."""
    config = load_config()
    sync_brawler_classes(config)
    coeff = config.get("statisticalCoefficients", {})
    if patches is None:
        patches = sorted({name for name, _ in PATCH_START_TIMES} - CLOSED_PATCHES)
    for patch in patches:
        res = requests.post(
            f"{SUPABASE_URL}/rest/v1/rpc/refresh_brawler_intelligence",
            json={"target_patch": patch, "coeff": coeff},
            headers=SUPABASE_HEADERS,
        )
        if res.status_code == 200:
            print(f"✅ brawler_intelligence refreshed for {patch}: {res.text} rows")
        else:
            print(f"⚠️ intelligence refresh failed for {patch}: {res.status_code} {res.text[:200]}")

        # Brawler-vs-brawler + teammate-synergy jsonb (vs_brawler/with_brawler)
        # lives in its own RPC, called once per bracket: inlining it into the
        # main refresh blew the statement budget on 470k+ matches.
        for bracket in ("masters_legendary", "diamond_mythic"):
            res = requests.post(
                f"{SUPABASE_URL}/rest/v1/rpc/refresh_brawler_pairs",
                json={"target_patch": patch, "target_bracket": bracket, "coeff": coeff},
                headers=SUPABASE_HEADERS,
            )
            if res.status_code == 200:
                print(f"✅ pair intelligence refreshed for {patch}/{bracket}: {res.text} rows")
            else:
                print(f"⚠️ pair refresh failed for {patch}/{bracket}: {res.status_code} {res.text[:200]}")

def main():
    require_credentials()
    print("🧠 Meta weights: refreshing brawler intelligence...")
    refresh_intelligence([CURRENT_PATCH])

if __name__ == "__main__":
    main()
