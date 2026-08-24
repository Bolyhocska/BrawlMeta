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
from datetime import datetime, timezone

import requests

from scrapers.common import (
    require_credentials, RANKED_MODES, RANKED_MAPS, CURRENT_PATCH,
    SUPABASE_URL, SUPABASE_HEADERS,
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

MAP_JSON = re.compile(r'"map":"([^"]{2,40})","mode":"([a-zA-Z]{3,20})"')


def fetch_pool():
    """Return {map_name: mode} for the live ranked rotation, or {} on any doubt."""
    try:
        res = requests.get(SOURCE_URL, headers=BROWSER_HEADERS, timeout=30)
    except Exception as e:
        print(f"⚠️ map pool fetch error: {e}")
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
    """Upsert the observed rotation; mark anything absent as out of rotation."""
    now = datetime.now(timezone.utc).isoformat()
    rows = [{"map_name": name, "mode": mode, "source": "brawltime",
             "last_seen": now, "in_rotation": True}
            for name, mode in sorted(pool.items())]

    res = requests.post(
        f"{SUPABASE_URL}/rest/v1/ranked_map_pool?on_conflict=map_name",
        json=rows,
        headers={**SUPABASE_HEADERS, "Prefer": "resolution=merge-duplicates"},
    )
    if res.status_code not in (200, 201, 204):
        print(f"⚠️ map pool upsert failed: {res.status_code} {res.text[:200]}")
        return False

    # Anything we did NOT see this run has left the rotation. This only flips a
    # flag; it never deletes collected matches, and because scrapers union this
    # table with the hardcoded allowlist, a map dropping out here cannot by
    # itself stop collection — that stays a human decision.
    quoted = ",".join(f'"{n}"' for n in pool)
    res2 = requests.patch(
        f"{SUPABASE_URL}/rest/v1/ranked_map_pool?map_name=not.in.({quoted})&in_rotation=eq.true",
        json={"in_rotation": False},
        headers={**SUPABASE_HEADERS, "Prefer": "return=representation"},
    )
    if res2.status_code in (200, 204):
        left = res2.json() if res2.text else []
        for r in left:
            print(f"   ↘ {r['map_name']} has left the rotation")
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
    missing = sorted(set(pool) - hardcoded)
    if missing:
        # Loud on purpose. The allowlist self-heals through ranked_map_pool, but
        # the hardcoded list is what a human reads, and letting the two drift
        # forever would recreate exactly the blind spot this module fixes.
        print(f"\n⚠️ {len(missing)} map(s) in rotation are NOT in RANKED_MAPS['{CURRENT_PATCH}']:")
        for m in missing:
            print(f"     + {m}  ({pool[m]})")
        print("   Collection continues via ranked_map_pool, but add them to "
              "scrapers/common.py so the file matches reality.")
    else:
        print(f"\n✅ every map in rotation is already in RANKED_MAPS['{CURRENT_PATCH}'].")

    publish(pool)
    print("✅ ranked_map_pool updated.")


if __name__ == "__main__":
    main()
