# ─── Ranked map-pool watcher ──────────────────────────────────────────────────
# Observes the live ranked map rotation once a day and records it in
# ranked_map_pool, so the scrapers' allowlist tracks reality instead of waiting
# for someone to remember to edit scrapers/common.py. Runs standalone:
#
#   python -m scrapers.map_pool
#
# WHY. RANKED_MAPS in common.py exists to stop themed/event reskins polluting
# the ranked dataset, and it is hand-maintained. That means a map rotating IN is
# invisible: every match played on it is silently dropped, and nothing in the
# logs says so, because a filtered battle looks exactly like a battle that never
# happened. Spiraling Out (Brawl Ball) was in rotation and being discarded until
# the owner noticed by eye.
#
# SOURCE. brawltime.ninja publishes the current ranked pool and embeds it as
# JSON in server-rendered HTML, so it needs no browser — only a real User-Agent,
# exactly like the brawlytix leaderboard scrape in masters.py (it returns 403 to
# a default client UA). The parse targets the embedded JSON rather than the
# rendered markup, because {"map":"X","mode":"Y"} is far more stable than the
# surrounding presentation, and `mode` arrives already in the API's camelCase
# form so it can be checked against RANKED_MODES directly.

import re
from datetime import datetime, timezone, timedelta

import requests

try:
    # Same escape hatch masters.py uses for brawlace: cloudscraper solves the
    # basic Cloudflare JS check that a plain requests.get sees as a 403.
    import cloudscraper
    _HTTP = cloudscraper.create_scraper()
except ImportError:
    _HTTP = requests

from scrapers.common import (
    require_credentials, RANKED_MODES, RANKED_MAPS, CURRENT_PATCH,
    SUPABASE_URL, SUPABASE_HEADERS, PROXIES,
)

SOURCE_URL = "https://brawltime.ninja/tier-list/ranked"

BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

# Sanity floors. A parse that returns less than this is treated as broken markup
# rather than as a rotation that suddenly shrank — the whole point of this module
# is that it must never be able to make the allowlist worse.
MIN_MAPS = 12
MIN_MODES = 4

# A map must be unseen for this long before it counts as out of rotation. The
# source renders partially — one Hot Zone map on 2026-08-24 — so a single miss
# is far more likely to be a bad scrape than a real change.
ROTATION_GRACE_DAYS = 3

MAP_JSON = re.compile(r'"map":"([^"]{2,40})","mode":"([a-zA-Z]{3,20})"')


def _get(use_proxy):
    """One attempt. Returns a response or None."""
    try:
        return _HTTP.get(
            SOURCE_URL, headers=BROWSER_HEADERS, timeout=30,
            proxies=PROXIES if use_proxy else None,
        )
    except Exception as e:
        print(f"⚠️ map pool fetch error ({'proxied' if use_proxy else 'direct'}): {e}")
        return None


def fetch_pool():
    """Return {map_name: mode} for the live ranked rotation, or {} on any doubt.

    Tries direct first, then through the Webshare static-IP proxy. The direct
    path works from a normal machine but GitHub Actions runners are flagged as
    datacenter traffic and get a 403 — the same thing masters.py documents for
    brawlace. Trying direct first keeps the proxy (a paid, shared resource) out
    of the loop whenever it isn't needed."""
    res = _get(use_proxy=False)
    if res is None or res.status_code != 200:
        got = res.status_code if res is not None else "error"
        print(f"   direct fetch got {got} — retrying through the proxy")
        res = _get(use_proxy=True)

    if res is None:
        print("⚠️ map pool fetch failed on both paths")
        return {}
    if res.status_code != 200:
        print(f"⚠️ map pool fetch failed: HTTP {res.status_code}")
        return {}

    pool = {}
    for name, mode in MAP_JSON.findall(res.text):
        if mode in RANKED_MODES:
            pool[name] = mode

    if len(pool) < MIN_MAPS or len({m for m in pool.values()}) < MIN_MODES:
        # Refuse to act on a thin parse. Publishing it would not corrupt the
        # allowlist (this source can only add) but it WOULD mark real maps as out
        # of rotation, so treat it as a failure and change nothing.
        print(f"⚠️ parse looks wrong ({len(pool)} maps across "
              f"{len({m for m in pool.values()})} modes) — markup probably changed. "
              f"Doing nothing rather than acting on it.")
        return {}
    return pool


def publish(pool):
    """Record what was observed, and seed anything the baseline knows about.

    TWO THINGS THIS DELIBERATELY DOES NOT DO.

    It does not treat the source as authoritative about what is OUT. The page is
    demonstrably partial — it listed a single Hot Zone map on 2026-08-24, when
    the mode plainly has more — so a map missing from one scrape is far more
    likely to be an incomplete render than a real rotation change. in_rotation is
    therefore derived from how recently a map was last seen, not from whether it
    appeared in this one run, so a flaky scrape self-corrects instead of marking
    real maps dead.

    It also does not let the table be limited to whatever the source showed. The
    hardcoded RANKED_MAPS baseline is seeded in on every run, so ranked_map_pool
    holds the union of "everything we already knew" and "everything the source
    has ever shown" — which is what the scrapers read.
    """
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    rows = [{"map_name": name, "mode": mode, "source": "brawltime",
             "last_seen": now_iso, "in_rotation": True}
            for name, mode in sorted(pool.items())]

    # Seed the baseline for anything the source has never shown us. last_seen is
    # left at the epoch so these never masquerade as "currently in rotation"
    # purely because we happen to know the name.
    known = RANKED_MAPS.get(CURRENT_PATCH, set())
    unseen = sorted(known - set(pool))
    baseline_rows = [{"map_name": name, "mode": "unknown", "source": "baseline",
                      "last_seen": "1970-01-01T00:00:00+00:00", "in_rotation": False}
                     for name in unseen]

    if baseline_rows:
        # on_conflict DO NOTHING: never overwrite a real observation with a stub.
        res0 = requests.post(
            f"{SUPABASE_URL}/rest/v1/ranked_map_pool?on_conflict=map_name",
            json=baseline_rows,
            headers={**SUPABASE_HEADERS, "Prefer": "resolution=ignore-duplicates"},
        )
        if res0.status_code not in (200, 201, 204):
            print(f"\u26a0\ufe0f baseline seed failed: {res0.status_code} {res0.text[:200]}")

    res = requests.post(
        f"{SUPABASE_URL}/rest/v1/ranked_map_pool?on_conflict=map_name",
        json=rows,
        headers={**SUPABASE_HEADERS, "Prefer": "resolution=merge-duplicates"},
    )
    if res.status_code not in (200, 201, 204):
        print(f"\u26a0\ufe0f map pool upsert failed: {res.status_code} {res.text[:200]}")
        return False

    # Demote only what has been unseen for a while. One missing scrape means
    # nothing; several days of absence is a rotation change worth recording.
    stale = (now - timedelta(days=ROTATION_GRACE_DAYS)).isoformat()
    requests.patch(
        f"{SUPABASE_URL}/rest/v1/ranked_map_pool?last_seen=lt.{stale}&in_rotation=eq.true",
        json={"in_rotation": False},
        headers={**SUPABASE_HEADERS, "Prefer": "return=minimal"},
    )
    return True


def main():
    require_credentials()
    print("🗺️ Ranked map pool: checking the live rotation...")

    pool = fetch_pool()
    if not pool:
        print("No usable pool this run — leaving the stored rotation untouched.")
        return

    by_mode = {}
    for name, mode in sorted(pool.items()):
        by_mode.setdefault(mode, []).append(name)
    print(f"Observed {len(pool)} ranked maps across {len(by_mode)} modes:")
    for mode in sorted(by_mode):
        print(f"   {mode:<10} {', '.join(by_mode[mode])}")

    hardcoded = RANKED_MAPS.get(CURRENT_PATCH, set())
    union = hardcoded | set(pool)
    missing = sorted(set(pool) - hardcoded)
    if missing:
        # Informational, not a task. Rotation is automatic: these maps are
        # already being collected through ranked_map_pool. RANKED_MAPS is only
        # the floor the allowlist falls back to if this source ever breaks, so
        # it does not need hand-syncing every time the rotation changes.
        print(f"\n🆕 {len(missing)} map(s) new since the RANKED_MAPS['{CURRENT_PATCH}'] baseline "
              f"-- already being collected:")
        for m in missing:
            print(f"     + {m}  ({pool[m]})")
    else:
        print(f"\n✅ rotation matches the RANKED_MAPS['{CURRENT_PATCH}'] baseline exactly.")

    publish(pool)
    print("✅ ranked_map_pool updated.")


if __name__ == "__main__":
    main()
