# ─── Masters+ match scraper ───────────────────────────────────────────────────
# Collects Masters/Legendary ranked matches by spidering battlelogs outward
# from verified top-ranked players. Runs standalone:
#
#   python -m scrapers.masters
#
# Seeds: a RANDOM 5 of the live top-100 global ranked players (scraped from
# brawlace each run into masters_players, with stored/hardcoded fallbacks).
# The public API has no per-match rank-tier field, so rank purity is enforced
# by spider proximity instead: SPIDER_DEPTH=2 keeps collection within two
# matchmaking hops of verified top-ranked players. At Masters I+ the queue is
# solo-only and matchmaking rank-tight, so those hops stay Masters-adjacent
# instead of drifting down the ladder.

import re
import random
import requests
from datetime import datetime, timezone

from scrapers.common import (
    require_credentials, LookupCache, get_stored_match_count,
    harvest_bracket, push_matches, reaggregate,
    SUPABASE_URL, SUPABASE_HEADERS,
    MASTERS_BASELINE, MASTERS_STEADY, MASTERS_RUN_CAP, SPIDER_DEPTH,
)

BRACKET = "masters_legendary"

# brawlace.com lists the global ranked (Masters) leaderboard; player profile
# links embed the tag as /players/%23TAG. We pull the top 100, store them in
# masters_players, then seed the spider from a RANDOM 5 of them each run so
# collection coverage rotates across the very top of the ladder.
BRAWLACE_RANKED_URL = "https://brawlace.com/leaderboards-ranked"

# Last manually verified top-5 global ranked players — the fallback if the
# brawlace scrape ever fails (site down, markup change, bot protection).
FALLBACK_MASTERS_SEEDS = [
    "#2R0JLJJ9PP",  # FUT|Guesti
    "#9JCG0VY8U",   # Joker Ilaria
    "#UVQRUVR0",    # DPB|SusiGuy
    "#80PVPCC29",   # NAVI|Enraged
    "#89VC2CGCJ",   # TH|Subeme
]

def fetch_top_ranked_players(limit=100):
    """Scrape the top `limit` ranked player tags (in rank order) from brawlace
    and refresh the masters_players table. Returns [] on any failure."""
    try:
        res = requests.get(BRAWLACE_RANKED_URL, timeout=30, headers={
            "User-Agent": "Mozilla/5.0 (compatible; BrawlMetaBot/1.0; +https://brawl-meta.vercel.app)"
        })
        if res.status_code != 200:
            print(f"⚠️ brawlace fetch failed: {res.status_code}")
            return []
        # Profile links look like href="https://brawlace.com/players/%23TAG"
        tags = []
        for m in re.finditer(r"/players/%23([0-9A-Z]+)", res.text):
            tag = "#" + m.group(1)
            if tag not in tags:
                tags.append(tag)
            if len(tags) >= limit:
                break
        if not tags:
            print("⚠️ brawlace scrape returned no tags (markup changed?)")
            return []
        now = datetime.now(timezone.utc).isoformat()
        rows = [{"player_tag": t, "rank": i + 1, "source": "brawlace", "fetched_at": now} for i, t in enumerate(tags)]
        up = requests.post(
            f"{SUPABASE_URL}/rest/v1/masters_players?on_conflict=player_tag",
            json=rows,
            headers={**SUPABASE_HEADERS, "Prefer": "resolution=merge-duplicates"},
        )
        if up.status_code in (200, 201, 204):
            print(f"✅ masters_players refreshed ({len(rows)} ranked players)")
        else:
            print(f"⚠️ masters_players store failed: {up.status_code} {up.text[:200]}")
        return tags
    except Exception as e:
        print(f"⚠️ brawlace scrape error: {e}")
        return []

def get_masters_seeds():
    """Random 5 of the live top-100 ranked players. Falls back to the last
    stored masters_players, then to the hardcoded pro tags."""
    top = fetch_top_ranked_players(100)
    if not top:
        res = requests.get(
            f"{SUPABASE_URL}/rest/v1/masters_players?select=player_tag&order=rank.asc&limit=100",
            headers=SUPABASE_HEADERS,
        )
        if res.status_code == 200:
            top = [r["player_tag"] for r in res.json() if r.get("player_tag")]
        if top:
            print(f"Using {len(top)} previously stored masters_players as seed pool.")
    if not top:
        print("Using hardcoded fallback Masters seeds.")
        return list(FALLBACK_MASTERS_SEEDS)
    return random.sample(top, min(5, len(top)))

def main():
    require_credentials()
    print("🛰️ Masters scraper: harvesting Masters+ ranked matches...")
    lookups = LookupCache()

    # Fill to the 400k baseline first (up to MASTERS_RUN_CAP per run); once
    # met, throttle down to a steady 50k per run.
    stored = get_stored_match_count(lookups, BRACKET)
    if stored < MASTERS_BASELINE:
        target = min(MASTERS_BASELINE - stored, MASTERS_RUN_CAP)
        print(f"{BRACKET}: {stored} stored, filling {MASTERS_BASELINE} baseline (target {target} this run).")
    else:
        target = MASTERS_STEADY
        print(f"{BRACKET}: {stored} stored, baseline met — steady +{target}.")

    seeds = get_masters_seeds()
    print(f"Masters seeds this run: {', '.join(seeds)}")

    extracted, seen_tags, seen_hashes = [], set(), set()
    harvest_bracket(BRACKET, seeds, extracted, seen_tags, seen_hashes,
                    target_matches=target, max_depth=SPIDER_DEPTH)

    inserted, touched = push_matches(extracted, lookups)
    if inserted:
        reaggregate(touched)
        # Keep the Intelligence Engine's statistical layer in step with the data
        from scrapers.meta_weights import refresh_intelligence
        refresh_intelligence(sorted(touched))

if __name__ == "__main__":
    main()
