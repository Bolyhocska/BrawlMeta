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
import time

import requests

from scrapers.common import (
    require_credentials, SUPABASE_URL, SUPABASE_HEADERS,
    CURRENT_PATCH, CLOSED_PATCHES, PATCH_START_TIMES,
    capture_meta_history,
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

def call_rpc(name, payload, label, attempts=3, backoff=20):
    """POST an RPC, retrying the failures that are worth retrying.

    A 504 here does NOT mean the statement failed — PostgREST gives up at the
    gateway while Postgres carries on (service_role runs with a 600s
    statement_timeout), so the work usually lands anyway. That is exactly how
    the 2026-08-02 run went wrong: the intelligence refresh 504'd, kept running,
    and held its lock on brawler_intelligence while the pair refreshes that
    follow it hit authenticator's lock_timeout=8s and died with 55P03 — leaving
    vs_brawler/with_brawler empty and silently emptying the guide's Match-ups.

    Both halves are fixed in SQL now (the refresh computes into a temp table and
    holds the lock only for the row swap), but retrying costs nothing and keeps
    a transient lock from turning into a whole day of missing pair data.
    """
    transient = {408, 409, 425, 429, 500, 502, 503, 504}
    for attempt in range(1, attempts + 1):
        res = requests.post(f"{SUPABASE_URL}/rest/v1/rpc/{name}", json=payload, headers=SUPABASE_HEADERS)
        if res.status_code == 200:
            if attempt > 1:
                print(f"✅ {label}: {res.text} (recovered on attempt {attempt})")
            else:
                print(f"✅ {label}: {res.text}")
            return res
        retryable = res.status_code in transient
        if retryable and attempt < attempts:
            print(f"↻ {label} attempt {attempt}/{attempts} failed ({res.status_code}), retrying in {backoff}s: {res.text[:160]}")
            time.sleep(backoff)
            continue
        print(f"⚠️ {label} failed: {res.status_code} {res.text[:200]}")
        return res
    return res


def refresh_intelligence(patches=None):
    """Sync classes, then rebuild brawler_intelligence for each open patch."""
    config = load_config()
    sync_brawler_classes(config)
    coeff = config.get("statisticalCoefficients", {})
    if patches is None:
        patches = sorted({name for name, _ in PATCH_START_TIMES} - CLOSED_PATCHES)
    for patch in patches:
        call_rpc(
            "refresh_brawler_intelligence",
            {"target_patch": patch, "coeff": coeff},
            f"brawler_intelligence refreshed for {patch}",
        )

        # Brawler-vs-brawler + teammate-synergy jsonb (vs_brawler/with_brawler)
        # lives in its own RPC, called once per bracket: inlining it into the
        # main refresh blew the statement budget on 470k+ matches.
        #
        # 2026-07-28: at 1.11M Masters rows it unrolled to ~33M pair-rows and
        # started exceeding the PostgREST gateway timeout, so this call failed
        # every run and left both jsonb columns as '{}' — silently emptying the
        # guide's Match-ups section. The RPC now bounds itself to the most
        # recent `recent_limit` matches (default 600k, ~20s) via the
        # (bracket_id, collected_at) index, so runtime stays flat as the
        # retention window grows. If it regresses again, lower that default
        # rather than re-inlining.
        #
        # 2026-08-02: these failed again, but for a different reason — see
        # call_rpc's docstring. The cause was lock contention from the refresh
        # above, not this RPC's own cost.
        for bracket in ("masters_legendary", "diamond_mythic"):
            call_rpc(
                "refresh_brawler_pairs",
                {"target_patch": patch, "target_bracket": bracket, "coeff": coeff},
                f"pair intelligence refreshed for {patch}/{bracket}",
            )

        # Per-map class fit, which REPLACED the hand-authored modes[].classWeights
        # in draft_logic_config.json. Those were written once and never checked;
        # measured, they cost -0.0041 AUC over 23,772 held-out pick decisions,
        # and some were plainly inverted (heist gave TANK the biggest bonus in
        # the mode while tanks measure -3.08 there). The engine now reads this
        # table instead, so the numbers follow the meta. Cheap next to the pair
        # RPCs: one pass over the patch, no pair unrolling.
        call_rpc(
            "refresh_map_class_weights",
            {"target_patch": patch},
            f"map class fit refreshed for {patch}",
        )

def main():
    require_credentials()
    print("🧠 Meta weights: refreshing brawler intelligence...")
    refresh_intelligence([CURRENT_PATCH])
    # Also snapshot the meta here, not only from reaggregate(). This job is the
    # daily safety net, so on a day when every scraper failed it is the last
    # chance to record what the meta looked like — and a missing day of history
    # can never be filled in afterwards, because the matches behind it are
    # already outside the retention window. Idempotent, so overlapping with a
    # scraper's own capture just refreshes the same rows.
    capture_meta_history(CURRENT_PATCH)

if __name__ == "__main__":
    main()
