# ─── Leaderboard & site-feed scraper ──────────────────────────────────────────
# Refreshes the live relays: the event/map rotation stays as a raw SiteFeed
# payload, while the global top-200 trophy leaderboard is parsed into the
# structured top_200_leaderboard table that the Leaderboards UI reads. Both
# come from the official Supercell API (browser clients can't call it — key +
# IP allowlist — so this scraper relays them into Supabase). Runs standalone:
#
#   python -m scrapers.leaderboard
#
# Cheap and fast (2 API calls) — deliberately separate from the match
# scrapers so a slow or failed spidering run can never delay the site's live
# leaderboard and event rotation.

import requests
from datetime import datetime, timezone

from scrapers.common import (
    require_credentials,
    BASE_URL, HEADERS, PROXIES, SUPABASE_URL, SUPABASE_HEADERS,
)

def store_top_200(payload):
    """Parse the raw rankings payload into structured top_200_leaderboard rows
    (upsert on rank, so the table always holds exactly the latest snapshot)."""
    items = payload.get("items", [])
    if not items:
        return
    now = datetime.now(timezone.utc).isoformat()
    rows = [{
        "rank": p.get("rank"),
        "player_tag": p.get("tag"),
        "name": p.get("name"),
        "name_color": p.get("nameColor"),
        "icon_id": (p.get("icon") or {}).get("id"),
        "trophies": p.get("trophies", 0),
        "club_name": (p.get("club") or {}).get("name"),
        "fetched_at": now,
    } for p in items if p.get("rank") and p.get("tag")]
    res = requests.post(
        f"{SUPABASE_URL}/rest/v1/top_200_leaderboard?on_conflict=rank",
        json=rows,
        headers={**SUPABASE_HEADERS, "Prefer": "resolution=merge-duplicates"},
    )
    if res.status_code in (200, 201, 204):
        print(f"✅ top_200_leaderboard updated ({len(rows)} rows)")
    else:
        print(f"⚠️ top_200_leaderboard store failed: {res.status_code} {res.text[:200]}")

def refresh_site_feed():
    feeds = [
        ("player_rankings", "global", f"{BASE_URL}/rankings/global/players?limit=200"),
        ("event_rotation", "global", f"{BASE_URL}/events/rotation"),
    ]
    for kind, region, url in feeds:
        try:
            res = requests.get(url, headers=HEADERS, proxies=PROXIES, timeout=30)
            if res.status_code != 200:
                print(f"⚠️ SiteFeed fetch failed for {kind}: {res.status_code}")
                continue
            payload = res.json()
            row = {"kind": kind, "region": region, "payload": payload, "fetched_at": datetime.now(timezone.utc).isoformat()}
            up = requests.post(
                f"{SUPABASE_URL}/rest/v1/SiteFeed?on_conflict=kind,region",
                json=row,
                headers={**SUPABASE_HEADERS, "Prefer": "resolution=merge-duplicates"},
            )
            if up.status_code in (200, 201, 204):
                print(f"✅ SiteFeed updated: {kind}")
            else:
                print(f"⚠️ SiteFeed store failed for {kind}: {up.status_code} {up.text[:200]}")

            if kind == "player_rankings":
                store_top_200(payload)
        except Exception as e:
            print(f"⚠️ SiteFeed error for {kind}: {e}")

def main():
    require_credentials()
    print("🛰️ Leaderboard scraper: refreshing SiteFeed + top 200...")
    refresh_site_feed()

if __name__ == "__main__":
    main()
