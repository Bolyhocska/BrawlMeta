# ─── Masters+ match scraper ───────────────────────────────────────────────────
# Collects Masters/Legendary ranked matches by spidering battlelogs outward
# from verified top-ranked players. Runs standalone:
#
#   python -m scrapers.masters
#
# Seeds: a RANDOM `SEED_COUNT` of the live top-200 global ranked players
# (scraped from brawlytix each run into masters_players, brawlace as a
# secondary source, with stored/hardcoded fallbacks below that).
# The public API has no per-match rank-tier field, so rank purity is enforced
# by spider proximity instead: SPIDER_DEPTH=2 keeps collection within two
# matchmaking hops of verified top-ranked players. At Masters I+ the queue is
# solo-only and matchmaking rank-tight, so those hops stay Masters-adjacent
# instead of drifting down the ladder.

import re
import random
import requests
from datetime import datetime, timezone

try:
    # cloudscraper solves Cloudflare's basic JS "checking your browser"
    # challenge (what a plain requests.get sees as a 403/520) without needing
    # a real browser. Optional: falls back to plain requests if unavailable,
    # which will likely still be blocked but costs nothing to attempt.
    import cloudscraper
    _HTTP = cloudscraper.create_scraper()
except ImportError:
    _HTTP = requests

from scrapers.common import (
    require_credentials, LookupCache, get_stored_match_count,
    harvest_bracket, push_matches, reaggregate, prune_bracket,
    SUPABASE_URL, SUPABASE_HEADERS, PROXIES,
    MASTERS_BASELINE, MASTERS_STEADY, MASTERS_RUN_CAP, SPIDER_DEPTH,
    MASTERS_WINDOW_CAP,
)

BRACKET = "masters_legendary"

# brawlytix.com lists the global ranked (Masters) leaderboard, 200 deep, as
# plain server-rendered HTML (<small>#TAG</small> right after each player's
# name) — confirmed 2026-07-20 to need only a browser User-Agent, no JS
# challenge (unlike brawlace, which is Cloudflare-JS-gated). Primary source.
BRAWLYTIX_URL = "https://brawlytix.com/leaderboard/highest-ranked-elo"

# brawlace.com: same idea, secondary fallback if brawlytix's markup ever
# changes or the site goes down. Cloudflare-JS-gated (see fetch below).
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

_BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

def _fetch_brawlytix(limit):
    """Plain server-rendered HTML — <small>#TAG</small> immediately after each
    player's <strong>name</strong>, in rank order. No JS challenge to solve."""
    res = requests.get(BRAWLYTIX_URL, timeout=30, headers=_BROWSER_HEADERS)
    if res.status_code != 200:
        print(f"⚠️ brawlytix fetch failed: {res.status_code}")
        return []
    tags = []
    for m in re.finditer(r"<small>(#[0-9A-Z]{4,12})</small>", res.text):
        tag = m.group(1)
        if tag not in tags:
            tags.append(tag)
        if len(tags) >= limit:
            break
    if not tags:
        print("⚠️ brawlytix scrape returned no tags (markup changed?)")
    return tags

def _fetch_brawlace(limit):
    """brawlace sits behind a Cloudflare JS challenge (plain requests sees
    403/520 regardless of User-Agent — confirmed 2026-07-20). cloudscraper
    attempts that challenge; route through the Webshare static-IP proxy too
    since GH Actions IPs are separately flagged as datacenter traffic."""
    res = _HTTP.get(BRAWLACE_RANKED_URL, timeout=30, proxies=PROXIES, headers=_BROWSER_HEADERS)
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
    return tags

def fetch_top_ranked_players(limit=200):
    """Scrape the top `limit` ranked player tags (in rank order): brawlytix
    first (200 deep, no JS challenge), brawlace as a secondary fallback.
    Refreshes masters_players on success. Returns [] if both fail — the
    spider self-seeds from masters_players either way."""
    try:
        tags, source = _fetch_brawlytix(limit), "brawlytix"
        if not tags:
            tags, source = _fetch_brawlace(limit), "brawlace"
        if not tags:
            return []
        now = datetime.now(timezone.utc).isoformat()
        rows = [{"player_tag": t, "rank": i + 1, "source": source, "fetched_at": now} for i, t in enumerate(tags)]
        up = requests.post(
            f"{SUPABASE_URL}/rest/v1/masters_players?on_conflict=player_tag",
            json=rows,
            headers={**SUPABASE_HEADERS, "Prefer": "resolution=merge-duplicates"},
        )
        if up.status_code in (200, 201, 204):
            print(f"✅ masters_players refreshed ({len(rows)} ranked players via {source})")
        else:
            print(f"⚠️ masters_players store failed: {up.status_code} {up.text[:200]}")
        return tags
    except Exception as e:
        print(f"⚠️ leaderboard scrape error: {e}")
        return []

# How many seeds to start each run's depth-2 spider from. Widened from 5
# (2026-07-20): the actual bottleneck was graph size, not request throughput —
# a run hit only 11k/95k of its target because it ran out of players reachable
# within 2 hops of just 5 starting points, not because of rate limiting. More
# seeds = wider frontier at the SAME depth, so rank purity is unaffected.
SEED_COUNT = 25

def get_masters_seeds(count=SEED_COUNT):
    """Random `count` of the live top-200 ranked players. Falls back to all 5
    hardcoded pro anchors + rotating players from the stored 'spider' pool
    (each row there is, by construction, exactly one hop from a player
    verified in SOME prior run — see persist_spider_players). Returns (seeds,
    verified_set) — verified_set is which of the returned seeds are
    trustworthy as a depth-1 collection origin for THIS run (real leaderboard
    players or hardcoded pros; never a previously-spidered player, which is
    what stops drift from compounding)."""
    top = fetch_top_ranked_players(200)
    if top:
        seeds = random.sample(top, min(count, len(top)))
        return seeds, set(seeds)
    res = requests.get(
        f"{SUPABASE_URL}/rest/v1/masters_players?select=player_tag&source=eq.spider&limit=1000",
        headers=SUPABASE_HEADERS,
    )
    pool = []
    if res.status_code == 200:
        pool = [r["player_tag"] for r in res.json() if r.get("player_tag")]
    anchors = list(FALLBACK_MASTERS_SEEDS)
    if pool:
        rotating_n = max(0, count - len(anchors))
        rotating = [t for t in random.sample(pool, min(rotating_n, len(pool))) if t not in anchors]
        print(f"brawlace unavailable — seeding {len(anchors)} anchor pros + {len(rotating)} rotating (unverified) players.")
        return anchors + rotating, set(anchors)
    print("Using hardcoded fallback Masters seeds.")
    return anchors, set(anchors)

def persist_spider_players(depth1_tags, limit=100):
    """REPLACE (not accumulate) the stored spider seed pool with a fresh
    sample of players found exactly one hop from a seed verified THIS run.
    Deleting the old pool first is what bounds drift: a future run's
    'rotating' seeds are always <=1 hop from a real top-100/hardcoded pro,
    never 2+ hops via a previous run's spider seed."""
    tags = [t for t in depth1_tags if t]
    del_res = requests.delete(
        f"{SUPABASE_URL}/rest/v1/masters_players?source=eq.spider",
        headers=SUPABASE_HEADERS,
    )
    if del_res.status_code not in (200, 204):
        print(f"⚠️ could not clear old spider pool: {del_res.status_code} {del_res.text[:200]}")
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
        print(f"🕸️ spider seed pool refreshed with {len(rows)} depth-1 (verified-origin) players")
    else:
        print(f"⚠️ spider player store failed: {res.status_code} {res.text[:200]}")

def main():
    require_credentials()
    print("🛰️ Masters scraper: harvesting Masters+ ranked matches...")
    lookups = LookupCache()

    # Fill to the full 1.5M window baseline first (up to MASTERS_RUN_CAP per
    # run); once met, throttle down to a steady 50k per run — the FIFO window
    # prune then trims each run's surplus back to 1.5M.
    stored = get_stored_match_count(lookups, BRACKET)
    if stored < MASTERS_BASELINE:
        target = min(MASTERS_BASELINE - stored, MASTERS_RUN_CAP)
        print(f"{BRACKET}: {stored} stored, filling {MASTERS_BASELINE} baseline (target {target} this run).")
    else:
        target = MASTERS_STEADY
        print(f"{BRACKET}: {stored} stored, baseline met — steady +{target}.")

    seeds, verified_seeds = get_masters_seeds()
    print(f"Masters seeds this run: {', '.join(seeds)} (verified: {', '.join(sorted(verified_seeds)) or 'none'})")

    extracted, seen_tags, seen_hashes, depth1_tags = [], set(), set(), set()
    harvest_bracket(BRACKET, seeds, extracted, seen_tags, seen_hashes,
                    target_matches=target, max_depth=SPIDER_DEPTH,
                    depth1_tags=depth1_tags, depth1_source_whitelist=verified_seeds)

    persist_spider_players(depth1_tags)

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
