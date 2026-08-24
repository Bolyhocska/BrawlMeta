# ─── Diamond/Mythic match scraper ─────────────────────────────────────────────
# Collects Diamond/Mythic ranked matches by spidering battlelogs outward from
# the curated diamond_mythic_players seed table. Runs standalone:
#
#   python -m scrapers.diamond_mythic
#
# Gated on the Masters baseline: until Masters has filled its full 1.5M-match
# sliding window, this scraper exits without collecting so all API/proxy budget
# goes to the bracket the tier list leans on hardest.

import requests

from scrapers.common import (
    require_credentials, LookupCache, refresh_dynamic_map_pool, get_stored_match_count,
    harvest_bracket, push_matches, reaggregate,
    SUPABASE_URL, SUPABASE_HEADERS,
    MASTERS_BASELINE, DIAMOND_RUN_CAP, SPIDER_DEPTH,
)

BRACKET = "diamond_mythic"

def get_diamond_seeds():
    """Diamond/Mythic seeds live in the diamond_mythic_players table."""
    fallback = ["#2Y9RV2RGR", "#2JJPLROYGY", "#RYRU2L2UV"]
    try:
        res = requests.get(
            f"{SUPABASE_URL}/rest/v1/diamond_mythic_players?select=player_tag",
            headers=SUPABASE_HEADERS,
        )
        if res.status_code == 200:
            tags = [r["player_tag"] for r in res.json() if r.get("player_tag")]
            if tags:
                return tags
    except Exception as e:
        print(f"⚠️ diamond_mythic_players read error: {e}")
    return fallback

def main():
    require_credentials()
    print("🛰️ Diamond/Mythic scraper: harvesting ranked matches...")
    lookups = LookupCache()
    # Widen the map allowlist with the live rotation observed by map_pool.py,
    # so a newly rotated-in map is collected without a code edit.
    refresh_dynamic_map_pool()

    # patch_name=None on purpose: MASTERS_BASELINE is the size of the retention
    # WINDOW, and prune_ranked_matches caps that window across all patches. The
    # gate used to count only CURRENT_PATCH, so it compared a per-patch number
    # against an all-patch cap — and once Masters hit the cap with any old-patch
    # rows still inside it, the current-patch count could never reach the
    # baseline. Diamond/Mythic skipped every run from 2026-07-20 (when windowed
    # retention shipped) until this was fixed. The failure repeats at every
    # patch rollover if the counts are ever mismatched again.
    masters_stored = get_stored_match_count(lookups, "masters_legendary", patch_name=None)
    if masters_stored < MASTERS_BASELINE:
        print(f"Skipping Diamond/Mythic this run — Masters baseline not yet met "
              f"({masters_stored}/{MASTERS_BASELINE}).")
        return

    seeds = get_diamond_seeds()
    print(f"Diamond/Mythic seeds: {', '.join(seeds)} (target {DIAMOND_RUN_CAP}).")

    extracted, seen_tags, seen_hashes = [], set(), set()
    harvest_bracket(BRACKET, seeds, extracted, seen_tags, seen_hashes,
                    target_matches=DIAMOND_RUN_CAP, max_depth=SPIDER_DEPTH)

    inserted, touched = push_matches(extracted, lookups)
    if inserted:
        reaggregate(touched)
        # Keep the Intelligence Engine's statistical layer in step with the data
        from scrapers.meta_weights import refresh_intelligence
        refresh_intelligence(sorted(touched))

if __name__ == "__main__":
    main()
