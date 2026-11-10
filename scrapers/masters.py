# ─── Masters+ match scraper ───────────────────────────────────────────────────
# Collects Masters/Legendary ranked matches by spidering battlelogs outward
# from verified top-ranked players. Runs standalone:
#
#   python -m scrapers.masters
#
# Seeds: `SEED_COUNT` players VERIFIED as Masters I+ via /players rankedRank
# (see get_masters_seeds), drawn from scraped leaderboards when available and
# otherwise from stored candidate pools. Stored matches are filtered on the
# lobby's match-time rank (MASTERS_MIN_LOBBY_RANK in common.py); SPIDER_DEPTH=2
# bounds how far the walk strays from those verified seeds.

import re
import time
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
    require_credentials, LookupCache, refresh_dynamic_map_pool, get_stored_match_count,
    harvest_bracket, push_matches, push_players, reaggregate, prune_bracket,
    SUPABASE_URL, SUPABASE_HEADERS, PROXIES, BASE_URL, HEADERS, REQUEST_DELAY,
    MASTERS_MIN_LOBBY_RANK,
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

# API verification of seeds (2026-11-10). Both scraped leaderboards died in
# October: brawlytix put a Cloudflare managed challenge on its leaderboard path
# (homepage still 200, the leaderboard answers `cf-mitigated: challenge` from
# any IP, residential included — so not a GitHub-runner block, and solving it
# would be bot-detection evasion, which we do not do), and brawlace's origin
# went down site-wide (Cloudflare 520 on every path). Last brawlytix refresh of
# masters_players: 2026-10-11.
#
# They are no longer needed for trust. /players/{tag} carries `rankedRank` on
# the same 1–22 scale as the battlelog's per-match rank, so a seed can be READ
# as Masters+ instead of inferred from which list it came from. That also
# upgrades the stored spider pool: a tag one hop from last run's seeds is
# verified directly here, not trusted by proximity.
SEED_VERIFY_MAX_CALLS = 150   # one /players call each; ~0.4% of a run's battlelog calls

def _player_ranked_rank(tag):
    """Current-season Ranked rank (1–22) from /players, or None on any failure."""
    time.sleep(REQUEST_DELAY)
    try:
        res = requests.get(f"{BASE_URL}/players/{tag.replace('#', '%23')}",
                           headers=HEADERS, proxies=PROXIES, timeout=20)
        if res.status_code != 200:
            return None
        return res.json().get("rankedRank")
    except Exception:
        return None

def _stored_candidates():
    """Every tag we have reason to think is near the top of Ranked: the stored
    spider pool (refreshed each run), every tag brawlytix ever gave us, the
    tracked Masters-seeded players and the trophy top 200. Candidates only —
    nothing here is trusted until _player_ranked_rank says so."""
    out = []
    for url in (
        f"{SUPABASE_URL}/rest/v1/masters_players?select=player_tag&limit=5000",
        f"{SUPABASE_URL}/rest/v1/tracked_players?select=player_tag&seed_bracket=eq.{BRACKET}&active=eq.true&limit=5000",
        f"{SUPABASE_URL}/rest/v1/top_200_leaderboard?select=player_tag&limit=500",
    ):
        try:
            res = requests.get(url, headers=SUPABASE_HEADERS, timeout=30)
            if res.status_code == 200:
                out += [r["player_tag"] for r in res.json() if r.get("player_tag")]
            else:
                print(f"⚠️ seed candidate read failed: {res.status_code} {url.split('?')[0].rsplit('/', 1)[-1]}")
        except Exception as e:
            print(f"⚠️ seed candidate read error: {e}")
    return out

def verify_seeds(candidates, count, max_calls=SEED_VERIFY_MAX_CALLS):
    """Check candidates (in the given order) against the API until `count` are
    at Masters I+ (MASTERS_MIN_LOBBY_RANK — the same bar matches are stored at)."""
    verified, ranks, calls = [], {}, 0
    for tag in dict.fromkeys(candidates):
        if len(verified) >= count or calls >= max_calls:
            break
        r = _player_ranked_rank(tag)
        calls += 1
        ranks[r] = ranks.get(r, 0) + 1
        if isinstance(r, int) and r >= MASTERS_MIN_LOBBY_RANK:
            verified.append(tag)
    dist = ", ".join(f"{k}:{v}" for k, v in sorted(ranks.items(), key=lambda kv: (kv[0] is None, kv[0] or 0)))
    print(f"🔎 seed verification: {len(verified)}/{count} Masters+ from {calls} /players calls (rankedRank → count: {dist})")
    return verified

def get_masters_seeds(count=SEED_COUNT):
    """Up to `count` seeds VERIFIED as Masters I+ by the API. Scraped
    leaderboard tags (if a source ever comes back) are tried first, then the
    stored candidate pools in random order. Returns (seeds, verified_set);
    verified_set is the depth-1 whitelist for persist_spider_players.

    If the API cannot verify anyone (key/proxy outage), falls back to the old
    behaviour: 5 hardcoded pro anchors + rotating spider-pool players, with only
    the anchors trusted."""
    top = fetch_top_ranked_players(200)
    stored = _stored_candidates()
    random.shuffle(top)
    random.shuffle(stored)
    anchors = list(FALLBACK_MASTERS_SEEDS)
    verified = verify_seeds(top + stored + anchors, count)
    if verified:
        return verified, set(verified)
    print("⚠️ no seed could be verified via the API — falling back to anchors + spider pool.")
    res = requests.get(
        f"{SUPABASE_URL}/rest/v1/masters_players?select=player_tag&source=eq.spider&limit=1000",
        headers=SUPABASE_HEADERS,
    )
    pool = []
    if res.status_code == 200:
        pool = [r["player_tag"] for r in res.json() if r.get("player_tag")]
    if pool:
        rotating_n = max(0, count - len(anchors))
        rotating = [t for t in random.sample(pool, min(rotating_n, len(pool))) if t not in anchors]
        print(f"seeding {len(anchors)} anchor pros + {len(rotating)} rotating (unverified) players.")
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
    # Widen the map allowlist with the live rotation observed by map_pool.py,
    # so a newly rotated-in map is collected without a code edit.
    refresh_dynamic_map_pool()

    # Fill to the full 1.5M window baseline first (up to MASTERS_RUN_CAP per
    # run); once met, throttle down to a steady 50k per run — the FIFO window
    # prune then trims each run's surplus back to 1.5M.
    # patch_name=None: MASTERS_BASELINE is the size of the retention WINDOW, and
    # the FIFO prune caps that window across all patches. Counting only
    # CURRENT_PATCH understated `stored` by however many old-patch rows were
    # still inside the window, so this branch believed the baseline was unmet
    # and set target = MASTERS_BASELINE - stored — throttling the scrape to
    # ~2k matches per run instead of the 50k steady state. That, not spider
    # saturation, is what cut daily collection ~95% through August 2026.
    stored = get_stored_match_count(lookups, BRACKET, patch_name=None)
    if stored < MASTERS_BASELINE:
        target = min(MASTERS_BASELINE - stored, MASTERS_RUN_CAP)
        print(f"{BRACKET}: {stored} stored, filling {MASTERS_BASELINE} baseline (target {target} this run).")
    else:
        target = MASTERS_STEADY
        print(f"{BRACKET}: {stored} stored, baseline met — steady +{target}.")

    seeds, verified_seeds = get_masters_seeds()
    print(f"Masters seeds this run: {', '.join(seeds)} (verified: {', '.join(sorted(verified_seeds)) or 'none'})")

    extracted, seen_tags, seen_hashes, depth1_tags = [], set(), set(), set()
    # Write periodically instead of only at the end. A run takes ~75 minutes and
    # a killed runner used to discard all of it; push_matches sends round-count
    # deltas, so flushing early cannot double-count anything.
    harvest_bracket(BRACKET, seeds, extracted, seen_tags, seen_hashes,
                    target_matches=target, max_depth=SPIDER_DEPTH,
                    depth1_tags=depth1_tags, depth1_source_whitelist=verified_seeds,
                    flush=lambda: (push_players(), push_matches(extracted, lookups)))

    persist_spider_players(depth1_tags)

    # Every battlelog the spider read handed us {tag, name} for six players.
    # Recorded before the match push so a failure there still leaves the
    # directory richer than it was.
    named = push_players()
    if named:
        print(f"player_directory: {named} name(s) recorded.")

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
