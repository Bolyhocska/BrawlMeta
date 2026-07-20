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
    harvest_bracket, push_matches, reaggregate, prune_bracket,
    SUPABASE_URL, SUPABASE_HEADERS, PROXIES,
    MASTERS_BASELINE, MASTERS_STEADY, MASTERS_RUN_CAP, SPIDER_DEPTH,
    MASTERS_WINDOW_CAP,
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
        # brawlace sits behind Cloudflare bot protection that 403s obvious bots
        # and datacenter IPs (GitHub Actions runners especially). Route through
        # the same Webshare static-IP proxy as the Supercell API and present a
        # normal browser fingerprint. Failure stays graceful — the spider
        # self-seeds from masters_players either way.
        res = requests.get(BRAWLACE_RANKED_URL, timeout=30, proxies=PROXIES, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
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
    """Random 5 of the live top-100 ranked players. Falls back to the stored
    masters_players pool (brawlace rows AND spider-discovered players), always
    anchored by 2 hardcoded pros so seed drift can't compound across runs."""
    top = fetch_top_ranked_players(100)
    if top:
        return random.sample(top, min(5, len(top)))
    res = requests.get(
        f"{SUPABASE_URL}/rest/v1/masters_players?select=player_tag&order=rank.asc&limit=300",
        headers=SUPABASE_HEADERS,
    )
    pool = []
    if res.status_code == 200:
        pool = [r["player_tag"] for r in res.json() if r.get("player_tag")]
    if pool:
        anchors = random.sample(FALLBACK_MASTERS_SEEDS, 2)
        rotating = random.sample(pool, min(3, len(pool)))
        print(f"brawlace unavailable — seeding 2 anchor pros + {len(rotating)} of {len(pool)} stored masters_players.")
        return anchors + [t for t in rotating if t not in anchors]
    print("Using hardcoded fallback Masters seeds.")
    return list(FALLBACK_MASTERS_SEEDS)

def persist_spider_players(seen_tags, limit=100):
    """Store a random sample of this run's spidered players (all within
    SPIDER_DEPTH hops of verified seeds → Masters-adjacent) so future runs can
    rotate seeds even while brawlace is unreachable. rank=999 keeps them below
    real leaderboard rows in the order-by-rank seed query."""
    tags = [t for t in seen_tags if t]
    if not tags:
        return
    sample = random.sample(tags, min(limit, len(tags)))
    now = datetime.now(timezone.utc).isoformat()
    rows = [{"player_tag": t, "rank": 999, "source": "spider", "fetched_at": now} for t in sample]
    res = requests.post(
        f"{SUPABASE_URL}/rest/v1/masters_players?on_conflict=player_tag",
        json=rows,
        headers={**SUPABASE_HEADERS, "Prefer": "resolution=merge-duplicates"},
    )
    if res.status_code in (200, 201, 204):
        print(f"🕸️ masters_players topped up with {len(rows)} spider-discovered players")
    else:
        print(f"⚠️ spider player store failed: {res.status_code} {res.text[:200]}")

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

    persist_spider_players(seen_tags)

    inserted, touched = push_matches(extracted, lookups)
    if inserted:
        # Sliding window BEFORE re-aggregation, so the fresh aggregates and
        # intelligence are computed over exactly the retained window.
        prune_bracket(BRACKET, MASTERS_WINDOW_CAP)
        reaggregate(touched)
        # Keep the Intelligence Engine's statistical layer in step with the data
        from scrapers.meta_weights import refresh_intelligence
        refresh_intelligence(sorted(touched))

if __name__ == "__main__":
    main()
