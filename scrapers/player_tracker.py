# ─── Player match tracker ─────────────────────────────────────────────────────
# Polls the battlelogs of players in `tracked_players` and stores one row per
# (battle, player) in `player_matches`. Runs standalone:
#
#   python -m scrapers.player_tracker
#
# WHY THIS EXISTS, AND WHY IT SHIPS BEFORE ANY UI.
# `ranked_matches` stores brawler ids only — no player identity, no timestamp —
# so none of it can ever power a player profile. The Supercell battlelog is a
# ~25-battle rolling buffer that does not back-fill, which means history only
# exists from the moment something starts writing it down. Every day this does
# not run is a day of history that cannot be bought back later. That is the
# whole reason this module has no user-visible output.
#
# SCOPE:
#   · competitive Ranked only — same filters as the spider, via parse_battle,
#     so the two can never disagree about what counts as a real match.
#   · everyone tracked gets their battlelog read: one request per player.
#   · BOOSTED profiles additionally get a /players call for trophy and
#     progression snapshots. That doubles their per-run cost against a single
#     IP-allowlisted key shared with four other scrapers, which is exactly why
#     it is opt-in rather than universal — not because it is a premium feature.
#     Boost is free (Core principle 1); asking is just how we decide where to
#     spend a finite budget.
#   · opted-out tags are never polled, and boosted players are ordered first so
#     that MAX_POLLS_PER_RUN truncating the queue can never drop them.

import time
import hashlib
import threading
from datetime import datetime, timezone, timedelta
from concurrent.futures import ThreadPoolExecutor

import requests

from scrapers.common import (
    require_credentials, LookupCache, parse_battle,
    BASE_URL, HEADERS, PROXIES, SUPABASE_URL, SUPABASE_HEADERS,
    REQUEST_DELAY, CONCURRENCY, INSERT_BATCH_SIZE, DB_BATCH_DELAY, STATS,
)

# The binding constraint is the single IP-allowlisted Supercell key shared with
# four other scrapers and the live /api/player endpoint — not Actions capacity.
# One poll is one request. Start conservative and raise it while watching the
# 429 count that RunStats now reports.
MAX_POLLS_PER_RUN = 500

# Adaptive polling. The battlelog holds ~25 battles, so a fixed interval either
# wastes requests on inactive players or silently loses history for active ones.
# Feedback rule: getting close to a full log means we are being outrun and must
# poll sooner; getting nothing means back off.
OUTRUN_THRESHOLD = 20      # >= this many new battles => we probably lost some
QUIET_THRESHOLD = 5        # < this many => start backing off
MIN_INTERVAL_MINS = 60
MAX_INTERVAL_MINS = 10080  # 7 days, after which the player is marked inactive
EMPTY_POLLS_BEFORE_BACKOFF = 3

# Floors per tier, so a claimed profile is never backed off into uselessness.
# NOTE: the workflow runs 4x/day, so the effective floor is ~6h regardless of
# what these say. The tighter tiers only start to matter if that cron gets
# denser — which is an API-budget decision, not a code change.
TIER_FLOOR_MINS = {0: 180, 1: 360, 2: 720, 3: 1440}


def make_match_key(battle_time, tags):
    """Identity of the physical game: battleTime + all six player tags.

    Deliberately NOT ranked_matches' composition hash. A player's history needs
    one row per game actually played, and the composition hash merges games that
    share a map and a draft — which the 2026-08-24 measurement showed is mostly
    the separate rounds of one Ranked series. Those rounds are distinct events in
    a player's history even though they are one matchup in the aggregate, so the
    two tables key differently on purpose and are not joinable on hash."""
    return hashlib.md5(f"{battle_time}{''.join(sorted(t for t in tags if t))}".encode()).hexdigest()


def parse_battle_time(value):
    try:
        return datetime.strptime(value, "%Y%m%dT%H%M%S.%fZ").replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None


def fetch_due_players(limit=MAX_POLLS_PER_RUN):
    """Players whose next_poll_at has come, most important tier first.

    Filters go through `params` rather than an f-string URL on purpose: an ISO
    timestamp ends in "+00:00", and a raw "+" in a query string decodes to a
    space, so PostgREST rejected it with 22007 "invalid input syntax for type
    timestamp with time zone". Letting requests percent-encode it fixes that."""
    res = requests.get(
        f"{SUPABASE_URL}/rest/v1/tracked_players",
        headers=SUPABASE_HEADERS,
        params={
            "select": "player_tag,tier,poll_interval_mins,last_battle_at,consecutive_empty,seed_bracket,boosted",
            "active": "eq.true",
            "opted_out": "eq.false",   # a tombstoned tag is never polled again
            "next_poll_at": f"lte.{datetime.now(timezone.utc).isoformat()}",
            # Boosted players first: they asked for this, and if MAX_POLLS_PER_RUN
            # truncates the queue they are the ones who must not be dropped.
            "order": "boosted.desc,tier.asc,next_poll_at.asc",
            "limit": str(limit),
        },
    )
    if res.status_code != 200:
        print(f"⚠️ could not read tracked_players: {res.status_code} {res.text[:200]}")
        return []
    return res.json()


def poll_player(row, lookups, out_rows, out_snapshots, out_updates, lock):
    """One battlelog request; append rows to store and a schedule update."""
    tag = row["player_tag"]
    last_seen = None
    if row.get("last_battle_at"):
        try:
            last_seen = datetime.fromisoformat(row["last_battle_at"].replace("Z", "+00:00"))
        except ValueError:
            last_seen = None

    time.sleep(REQUEST_DELAY)
    res = requests.get(f"{BASE_URL}/players/{tag.replace('#', '%23')}/battlelog",
                       headers=HEADERS, proxies=PROXIES)
    STATS.record_response(res)
    if res.status_code != 200:
        # Reschedule rather than retry-storm; a 404 is a dead tag, a 429/5xx is
        # transient. Either way the next run picks it up.
        with lock:
            out_updates.append(_schedule(row, new_count=0, dead=(res.status_code == 404)))
        return

    rows, newest = [], last_seen
    for match in res.json().get("items", []):
        _, record = parse_battle(match, tag, row.get("seed_bracket"))
        if record is None:
            continue
        when = parse_battle_time(record["battle_time"])
        if when is None:
            continue
        # Incremental: skip anything at or before what we already stored. The
        # primary key would reject duplicates anyway, but not sending them keeps
        # the insert batches small.
        if last_seen and when <= last_seen:
            continue
        if newest is None or when > newest:
            newest = when

        brawler_ids = lambda names: [i for i in (lookups.brawler_id(n) for n in names) if i is not None]
        team_ids, enemy_ids = brawler_ids(record["team_brawlers"]), brawler_ids(record["enemy_brawlers"])
        # The player's own brawler is their slot in their own team.
        own = None
        for p_tag, b_name in zip(record["team_tags"], record["team_brawlers"]):
            if p_tag == tag:
                own = lookups.brawler_id(b_name)
                break
        if own is None or not team_ids or not enemy_ids:
            continue

        map_id = lookups.map_id(record["map"], record["mode"])
        patch_id = lookups.patch_id(record["patch"])
        bracket_id = lookups.bracket_id(record["rank_bracket"]) if record["rank_bracket"] else None
        if map_id is None or patch_id is None:
            continue

        rows.append({
            "match_key": make_match_key(record["battle_time"], record["all_tags"]),
            "player_tag": tag,
            "battle_time": when.isoformat(),
            "map_id": map_id,
            "bracket_id": bracket_id,
            "patch_id": patch_id,
            "brawler_id": own,
            "result": record["result"],
            "is_star_player": record["is_star_player"],
            "team_brawlers": team_ids,
            "enemy_brawlers": enemy_ids,
            "team_tags": record["team_tags"],
            "enemy_tags": record["enemy_tags"],
        })

    # Boosted profiles get the second /players call that Phase 1 refused to spend
    # on everybody. This is the whole substance of the boost: trophy and
    # progression curves can only be built by diffing snapshots over time, and
    # they double a player's per-run request cost against the shared key.
    snapshot = fetch_snapshot(tag) if row.get("boosted") else None

    with lock:
        out_rows.extend(rows)
        if snapshot:
            out_snapshots.append(snapshot)
        out_updates.append(_schedule(row, new_count=len(rows), newest=newest))


def fetch_snapshot(tag):
    """One /players call → one progression snapshot. Returns None on any
    failure: a missing snapshot is a gap in a chart, never a reason to lose the
    match rows we already parsed."""
    time.sleep(REQUEST_DELAY)
    try:
        res = requests.get(f"{BASE_URL}/players/{tag.replace('#', '%23')}",
                           headers=HEADERS, proxies=PROXIES)
        STATS.record_response(res)
        if res.status_code != 200:
            return None
        p = res.json()
    except Exception:
        return None

    brawlers = p.get("brawlers") or []
    return {
        "player_tag": tag,
        "taken_at": datetime.now(timezone.utc).isoformat(),
        "trophies": p.get("trophies"),
        "highest_trophies": p.get("highestTrophies"),
        "exp_level": p.get("expLevel"),
        "victories_3v3": p.get("3vs3Victories"),
        "solo_victories": p.get("soloVictories"),
        "duo_victories": p.get("duoVictories"),
        "brawlers_owned": len(brawlers),
        "club_tag": (p.get("club") or {}).get("tag"),
        # Per-brawler trophies, so a boosted profile can show which brawler a
        # push actually came from rather than just a total moving.
        "brawler_trophies": {str(b.get("id")): b.get("trophies")
                             for b in brawlers if b.get("id") is not None},
    }


def _schedule(row, new_count, newest=None, dead=False):
    """Adaptive interval for one player. Pure function of what we just saw."""
    interval = row.get("poll_interval_mins") or 1440
    empty = row.get("consecutive_empty") or 0
    active = True

    if dead:
        active, empty = False, empty + 1
    elif new_count >= OUTRUN_THRESHOLD:
        interval = max(MIN_INTERVAL_MINS, int(interval / 2))   # we are losing history
        empty = 0
    elif new_count >= QUIET_THRESHOLD:
        empty = 0                                              # cadence is right
    elif new_count > 0:
        interval = min(MAX_INTERVAL_MINS, int(interval * 1.5))
        empty = 0
    else:
        empty += 1
        if empty >= EMPTY_POLLS_BEFORE_BACKOFF:
            interval = min(MAX_INTERVAL_MINS, interval * 2)
            if interval >= MAX_INTERVAL_MINS:
                active = False

    interval = max(interval, TIER_FLOOR_MINS.get(row.get("tier", 3), 1440))
    now = datetime.now(timezone.utc)
    # Every key must be present on EVERY object in the batch: PostgREST rejects a
    # bulk upsert whose objects have differing key sets with PGRST102 "All object
    # keys must match". So last_battle_at is always included — falling back to
    # the row's existing value rather than None, since a None here would merge
    # over a real stored timestamp and lose the incremental-fetch watermark.
    return {
        "player_tag": row["player_tag"],
        "poll_interval_mins": interval,
        "next_poll_at": (now + timedelta(minutes=interval)).isoformat(),
        "last_polled_at": now.isoformat(),
        "consecutive_empty": empty,
        "active": active,
        "last_battle_at": newest.isoformat() if newest is not None else row.get("last_battle_at"),
    }


def save_player_matches(rows):
    if not rows:
        print("No new player matches to store.")
        return 0
    url = f"{SUPABASE_URL}/rest/v1/player_matches?on_conflict=match_key,player_tag"
    headers = {**SUPABASE_HEADERS, "Prefer": "resolution=ignore-duplicates,return=representation"}
    stored = 0
    for i in range(0, len(rows), INSERT_BATCH_SIZE):
        if i:
            time.sleep(DB_BATCH_DELAY)
        batch = rows[i:i + INSERT_BATCH_SIZE]
        res = requests.post(url, json=batch, headers=headers)
        if res.status_code in (200, 201):
            stored += len(res.json())
        else:
            print(f"❌ player_matches insert failed at {i}: {res.status_code} {res.text[:300]}")
            break
    print(f"✅ {stored} new player-match rows stored (of {len(rows)} sent).")
    return stored


def save_player_snapshots(rows):
    if not rows:
        return 0
    url = f"{SUPABASE_URL}/rest/v1/player_snapshots?on_conflict=player_tag,taken_at"
    headers = {**SUPABASE_HEADERS, "Prefer": "resolution=ignore-duplicates,return=representation"}
    stored = 0
    for i in range(0, len(rows), INSERT_BATCH_SIZE):
        if i:
            time.sleep(DB_BATCH_DELAY)
        res = requests.post(url, json=rows[i:i + INSERT_BATCH_SIZE], headers=headers)
        if res.status_code in (200, 201):
            stored += len(res.json())
        else:
            print(f"⚠️ player_snapshots insert failed at {i}: {res.status_code} {res.text[:200]}")
            break
    print(f"📈 {stored} progression snapshot(s) stored for boosted profiles.")
    return stored


def save_schedules(updates):
    if not updates:
        return
    url = f"{SUPABASE_URL}/rest/v1/tracked_players?on_conflict=player_tag"
    headers = {**SUPABASE_HEADERS, "Prefer": "resolution=merge-duplicates"}
    for i in range(0, len(updates), INSERT_BATCH_SIZE):
        if i:
            time.sleep(DB_BATCH_DELAY)
        res = requests.post(url, json=updates[i:i + INSERT_BATCH_SIZE], headers=headers)
        if res.status_code not in (200, 201, 204):
            print(f"⚠️ schedule update failed at {i}: {res.status_code} {res.text[:200]}")


def prune():
    res = requests.post(f"{SUPABASE_URL}/rest/v1/rpc/prune_player_matches",
                        json={}, headers=SUPABASE_HEADERS)
    if res.status_code in (200, 204):
        print(f"🧹 retention: {res.text[:200]}")
    else:
        print(f"⚠️ prune_player_matches failed: {res.status_code} {res.text[:200]}")


def main():
    require_credentials()
    print("🛰️ Player tracker: polling tracked battlelogs...")
    lookups = LookupCache()

    due = fetch_due_players()
    if not due:
        print("No players due for polling.")
        return
    boosted = sum(1 for r in due if r.get("boosted"))
    print(f"{len(due)} player(s) due (cap {MAX_POLLS_PER_RUN}); {boosted} boosted.")

    rows, snapshots, updates, lock = [], [], [], threading.Lock()
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        futures = [pool.submit(poll_player, r, lookups, rows, snapshots, updates, lock) for r in due]
        for f in futures:
            f.result()

    save_player_matches(rows)
    save_player_snapshots(snapshots)
    save_schedules(updates)
    prune()
    STATS.report("player_tracker")


if __name__ == "__main__":
    main()
