import os
import hashlib
import threading
import requests
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

# ==========================================
# 🔑 API KEYS & CREDENTIALS (Secured)
# ==========================================
SUPERCELL_API_KEY = os.environ.get("SUPERCELL_API_KEY")
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
PROXY_HOST = os.environ.get("PROXY_HOST")
PROXY_PORT = os.environ.get("PROXY_PORT")
PROXY_USER = os.environ.get("PROXY_USER")
PROXY_PASS = os.environ.get("PROXY_PASS")

if not SUPERCELL_API_KEY or not SUPABASE_URL or not SUPABASE_KEY:
    print("⚠️ Missing API keys. Ensure environment variables are set.")
    exit(1)

HEADERS = {
    "Authorization": f"Bearer {SUPERCELL_API_KEY}",
    "Accept": "application/json"
}
BASE_URL = "https://api.brawlstars.com/v1"
PROXIES = {
    "http": f"http://{PROXY_USER}:{PROXY_PASS}@{PROXY_HOST}:{PROXY_PORT}",
    "https": f"http://{PROXY_USER}:{PROXY_PASS}@{PROXY_HOST}:{PROXY_PORT}",
}
SUPABASE_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json"
}

CURRENT_PATCH = "68.250"

# Patch start times (UTC). Used to determine which patch a match actually
# belongs to based on its own battleTime, instead of blindly stamping every
# collected match with CURRENT_PATCH — a player's battlelog can still contain
# battles from before the patch changed if they haven't played since.
PATCH_START_TIMES = [
    ("67.306", datetime(2000, 1, 1, tzinfo=timezone.utc)),   # earliest known patch, catch-all floor
    ("68.250", datetime(2026, 6, 30, 8, 0, 0, tzinfo=timezone.utc)),  # 10:00 CET = 08:00 UTC
]

def determine_patch(battle_time_str):
    """Given the API's battleTime (e.g. '20260630T101500.000Z'), return which
    patch that match actually happened in."""
    if not battle_time_str:
        return CURRENT_PATCH
    try:
        dt = datetime.strptime(battle_time_str, "%Y%m%dT%H%M%S.%fZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return CURRENT_PATCH
    patch = PATCH_START_TIMES[0][0]
    for name, start in PATCH_START_TIMES:
        if dt >= start:
            patch = name
    return patch

# Patches that are fully finished — no more ranked matches will ever occur on
# them again. Matches tagged with a closed patch are dropped entirely (not
# inserted), and BrawlerStats is never re-aggregated for them, since their
# data is final and re-running aggregation is just wasted DB load (and can
# time out as the Matches table grows).
CLOSED_PATCHES = {"67.306"}

RANKED_MODES = {"brawlBall", "knockout", "bounty", "hotZone", "heist", "gemGrab"}

# Confirmed official ranked maps per patch. Any match on a map not in this
# list for the current patch is dropped, since the API tags themed/event
# reskins with the same mode as real ranked maps.
RANKED_MAPS = {
    "67.306": {
        "Dry Season", "Hideout", "Layer Cake", "Shooting Star",
        "Center Stage", "Pinball Dreams", "Sneaky Fields", "Triple Dribble",
        "Double Swoosh", "Gem Fort", "Hard Rock Mine", "Undermine",
        "Bridge Too Far", "Hot Potato", "Kaboom Canyon", "Safe Zone",
        "Dueling Beetles", "In The Liminal", "Open Business", "Parallel Plays",
        "Quick Travel", "Ring Of Fire",
        "Belles Rock", "Flaring Phoenix", "New Horizons", "Out in the open",
    },
    "68.250": {
        "Dry Season", "Hideout", "Layer Cake", "Shooting Star",
        "Center Stage", "Pinball Dreams", "Sneaky Fields", "Triple Dribble",
        "Double Swoosh", "Gem Fort", "Hard Rock Mine", "Undermine",
        "Bridge Too Far", "Hot Potato", "Kaboom Canyon", "Safe Zone", "Pit Stop",
        "Dueling Beetles", "In The Liminal", "Open Business", "Parallel Plays",
        "Quick Travel", "Ring Of Fire",
        "Belles Rock", "Flaring Phoenix", "New Horizons", "Out in the open",
    },
}

def get_stored_match_count(rank_bracket):
    """Count of matches already stored for this bracket on the current patch."""
    url = f"{SUPABASE_URL}/rest/v1/Matches?select=id&rank_bracket=eq.{rank_bracket}&patch=eq.{CURRENT_PATCH}"
    headers = {**SUPABASE_HEADERS, "Prefer": "count=exact", "Range": "0-0"}
    res = requests.get(url, headers=headers)
    if res.status_code not in (200, 206):
        print(f"⚠️ Could not get match count for {rank_bracket}: {res.status_code} {res.text}")
        return 0
    content_range = res.headers.get("Content-Range", "")
    if "/" in content_range:
        return int(content_range.split("/")[-1])
    return 0

def make_hash(entry):
    winners = sorted([w for w in entry['winners'] if w])
    losers = sorted([l for l in entry['losers'] if l])
    raw = f"{entry['map']}{entry['mode']}{entry['rank_bracket']}{''.join(winners)}{''.join(losers)}"
    return hashlib.md5(raw.encode()).hexdigest()

def fetch_existing_hashes():
    print("Fetching existing match hashes from Supabase...")
    hashes = set()
    offset = 0
    while True:
        res = requests.get(
            f"{SUPABASE_URL}/rest/v1/Matches?select=match_hash&limit=1000&offset={offset}",
            headers=SUPABASE_HEADERS
        )
        if res.status_code != 200:
            print(f"⚠️ Could not fetch existing hashes: {res.text}")
            break
        batch = res.json()
        if not batch:
            break
        for row in batch:
            if row.get("match_hash"):
                hashes.add(row["match_hash"])
        offset += 1000
        if len(batch) < 1000:
            break
    print(f"Found {len(hashes)} existing matches in database.")
    return hashes

def fetch_player_battles(player_tag, bracket, extracted_data, seen_tags, existing_hashes, lock=None):
    # lock guards all shared-state mutations (seen_tags/extracted_data/existing_hashes)
    # so this function is safe to call from multiple threads concurrently — only the
    # network request itself runs unlocked, which is the whole point of parallelizing.
    if lock:
        with lock:
            if player_tag in seen_tags:
                return []
            seen_tags.add(player_tag)
    else:
        if player_tag in seen_tags:
            return []
        seen_tags.add(player_tag)

    player_url_tag = player_tag.replace("#", "%23")
    log_url = f"{BASE_URL}/players/{player_url_tag}/battlelog"
    log_res = requests.get(log_url, headers=HEADERS, proxies=PROXIES)

    if log_res.status_code != 200:
        return []

    candidate_tags = []
    candidate_entries = []
    battles = log_res.json().get("items", [])
    for match in battles:
        battle_data = match.get("battle", {}) or {}
        event_data = match.get("event", {}) or {}

        match_type = battle_data.get("type", "").lower()
        mode_name = battle_data.get("mode", "")
        if ("ranked" in match_type or "solomode" in match_type) and mode_name in RANKED_MODES:
            teams = battle_data.get("teams", [])
            result = battle_data.get("result", "").lower()

            if len(teams) == 2 and result in ["victory", "defeat"]:
                for team in teams:
                    for p in team:
                        tag = p.get("tag")
                        if tag:
                            candidate_tags.append(tag)

                player_team_idx = 0
                for idx, team in enumerate(teams):
                    if any(p.get('tag') == player_tag for p in team):
                        player_team_idx = idx
                        break

                if result == "victory":
                    winning_team = teams[player_team_idx]
                    losing_team = teams[1 - player_team_idx]
                else:
                    winning_team = teams[1 - player_team_idx]
                    losing_team = teams[player_team_idx]

                winners = [p['brawler']['name'] for p in winning_team if p.get('brawler') and p['brawler'].get('name')]
                losers = [p['brawler']['name'] for p in losing_team if p.get('brawler') and p['brawler'].get('name')]

                if not winners or not losers:
                    continue

                map_name = event_data.get("map") or "Unknown Map"
                mode_name = battle_data.get("mode") or "Unknown Mode"
                match_patch = determine_patch(match.get("battleTime"))
                if match_patch in CLOSED_PATCHES:
                    continue

                allowed_maps = RANKED_MAPS.get(match_patch)
                if allowed_maps is not None and map_name not in allowed_maps:
                    continue

                match_entry = {
                    "map": map_name,
                    "mode": mode_name,
                    "rank_bracket": bracket,
                    "winners": winners,
                    "losers": losers,
                    "patch": match_patch,
                    "match_hash": None
                }
                match_entry["match_hash"] = make_hash(match_entry)
                candidate_entries.append(match_entry)

    # All shared-state reads/writes happen here under lock, in one short critical
    # section, rather than scattered through the parsing above.
    def merge():
        new_player_tags = [t for t in candidate_tags if t not in seen_tags]
        for entry in candidate_entries:
            if entry["match_hash"] not in existing_hashes:
                extracted_data.append(entry)
                existing_hashes.add(entry["match_hash"])
        return new_player_tags

    if lock:
        with lock:
            return merge()
    return merge()

BASELINE_TARGET_PER_BRACKET = 100000   # one-time fill target before switching to steady increments
STEADY_INCREMENT_PER_PUSH = 10000      # per-run target once the baseline has been reached
MAX_PLAYERS_PER_BRACKET = 20000        # safety cap so a run can't spider forever if the target is unreachable
CONCURRENCY = 12                       # parallel battlelog requests — the real fix for the 35min -> 3hr slowdown

def harvest_bracket(bracket, seed_tags, extracted_data, seen_tags, existing_hashes,
                     target_matches, max_players=MAX_PLAYERS_PER_BRACKET, max_depth=None):
    # Every entry fetch_player_battles appends during this call carries this
    # bracket, so tracking the growth of extracted_data's length is equivalent
    # to (and much cheaper than) recounting matches for this bracket each time.
    #
    # max_depth limits how many spider hops away from the verified seed players
    # we collect. The public API has no per-match rank-tier field, so rank
    # purity can only be controlled by proximity to verified players: at
    # Masters I+ everyone queues solo and matchmaking is rank-tight, so players
    # found in a verified Masters player's games (depth 1) and their games'
    # players (depth 2) are Masters-adjacent. Unlimited spidering drifts far
    # below the intended rank — that's what this cap prevents.
    lock = threading.Lock()
    queue = [(tag, 0) for tag in seed_tags]
    processed = 0
    collected_start = len(extracted_data)

    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        while queue and processed < max_players and (len(extracted_data) - collected_start) < target_matches:
            batch = queue[:CONCURRENCY]
            queue = queue[CONCURRENCY:]
            futures = [(depth, pool.submit(fetch_player_battles, tag, bracket, extracted_data, seen_tags, existing_hashes, lock)) for tag, depth in batch]
            for depth, f in futures:
                new_tags = f.result()
                if max_depth is None or depth < max_depth:
                    queue.extend((t, depth + 1) for t in new_tags)
            processed += len(batch)
            if processed % 200 < CONCURRENCY:
                print(f"  {bracket}: {processed} players processed, {len(extracted_data) - collected_start} matches collected...")

    collected = len(extracted_data) - collected_start
    reason = "reached target" if collected >= target_matches else ("ran out of players" if not queue else "hit player safety cap")
    print(f"{bracket} done. {collected} matches from {processed} players ({reason}).")

def bracket_target(bracket):
    """Baseline-fill this bracket to BASELINE_TARGET_PER_BRACKET first; once
    reached, only collect a small steady increment per run."""
    stored = get_stored_match_count(bracket)
    if stored < BASELINE_TARGET_PER_BRACKET:
        remaining = BASELINE_TARGET_PER_BRACKET - stored
        print(f"{bracket}: {stored} stored, still filling baseline ({remaining} to go).")
        return min(remaining, MAX_PLAYERS_PER_BRACKET)  # cap per-run effort even while filling baseline
    print(f"{bracket}: {stored} stored, baseline met — steady +{STEADY_INCREMENT_PER_PUSH} increment.")
    return STEADY_INCREMENT_PER_PUSH

def harvest_to_cloud():
    print("🛰️ Harvesting rank-segmented high-elo matches...")
    extracted_data = []
    seen_tags = set()
    existing_hashes = fetch_existing_hashes()

    # ==========================================
    # PASS 1: Masters (1+) — always prioritized. Fills to a 100k baseline
    # first, then only tops up 10k per run once that's reached.
    #
    # Seeded from player tags confirmed to be genuinely Masters+ ranked
    # (found via powerleagueprodigy.com). The public API has no per-match
    # rank-tier field (confirmed by dumping raw battle JSON) and the legacy
    # Power League /rankings/{country}/seasons/{id} endpoint is dead (404),
    # so Masters-only collection is enforced by spider proximity instead:
    # max_depth=2 keeps collection within two matchmaking hops of verified
    # Masters players. At Masters I+ queue is solo-only and matchmaking is
    # rank-tight, so those hops stay Masters-adjacent instead of drifting
    # down the ladder like unlimited spidering does.
    # ==========================================
    masters_target = bracket_target("masters_legendary")
    masters_seed_tags = [
        "#J2RJ8Y",
        "#22LURJ9JY",
        "#8J8V2RUGO",
        "#YPUJUORC8",
        "#2C20JJRGJJ",
        "#VU9CRLP8",
    ]
    harvest_bracket("masters_legendary", masters_seed_tags, extracted_data, seen_tags, existing_hashes, target_matches=masters_target, max_depth=2)

    # ==========================================
    # PASS 2: Diamond & Mythic — only collected once Masters & Legendary has
    # met its own baseline, so early runs put full budget into Masters first.
    # ==========================================
    masters_stored_after = get_stored_match_count("masters_legendary")
    if masters_stored_after < BASELINE_TARGET_PER_BRACKET:
        print(f"Skipping Diamond/Mythic this run — Masters & Legendary baseline not yet met ({masters_stored_after}/{BASELINE_TARGET_PER_BRACKET}).")
    else:
        diamond_target = bracket_target("diamond_mythic")
        print("Gathering Diamond/Mythic seed data via spidering...")
        diamond_seed_tags = [
            "#2Y9RV2RGR",
            "#2JJPLROYGY",
            "#RYRU2L2UV"
        ]
        harvest_bracket("diamond_mythic", diamond_seed_tags, extracted_data, seen_tags, existing_hashes, target_matches=diamond_target)

    # ==========================================
    # SAVE PIPELINE: SUPABASE CLOUD
    # ==========================================
    if len(extracted_data) == 0:
        print("⚠️ No new matches found to save.")
        return

    # Insert in batches — a single request with tens of thousands of rows can
    # exceed Supabase's statement timeout (57014) and roll back with zero rows
    # written, even though the whole run otherwise succeeded.
    INSERT_BATCH_SIZE = 2000
    print(f"Connecting to Supabase... pushing {len(extracted_data)} new matches in batches of {INSERT_BATCH_SIZE}")
    url = f"{SUPABASE_URL}/rest/v1/Matches"
    pushed = 0
    for i in range(0, len(extracted_data), INSERT_BATCH_SIZE):
        batch = extracted_data[i:i + INSERT_BATCH_SIZE]
        res = requests.post(url, json=batch, headers=SUPABASE_HEADERS)
        if res.status_code in [200, 201]:
            pushed += len(batch)
            print(f"  Pushed batch {i // INSERT_BATCH_SIZE + 1} ({len(batch)} matches, {pushed}/{len(extracted_data)} total)")
        else:
            print(f"❌ Failed to save batch starting at {i}: {res.status_code} {res.text}")
            print(f"⚠️ Stopping insert — {pushed} matches were saved before the failure.")
            break

    if pushed == 0:
        print("❌ No matches were saved.")
        return
    print(f"✅ Success! Pushed {pushed}/{len(extracted_data)} live matches to Cloud Database.")

    # Re-aggregate stats for every patch actually touched by the successfully
    # saved matches (not the full extracted set, in case a later batch failed),
    # skipping any patch that's been declared closed/finished
    touched_patches = sorted({m["patch"] for m in extracted_data[:pushed]} - CLOSED_PATCHES)
    rpc_url = f"{SUPABASE_URL}/rest/v1/rpc/aggregate_brawler_stats"
    for patch in touched_patches:
        print(f"🔄 Re-aggregating BrawlerStats for patch {patch}...")
        rpc_res = requests.post(rpc_url, json={"target_patch": patch}, headers=SUPABASE_HEADERS)
        if rpc_res.status_code in [200, 204]:
            print(f"✅ BrawlerStats aggregation complete for {patch}.")
        else:
            print(f"⚠️ Aggregation failed for {patch}: {rpc_res.status_code} {rpc_res.text}")

if __name__ == "__main__":
    harvest_to_cloud()
