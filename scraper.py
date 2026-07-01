import os
import hashlib
import requests
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

COUNTRIES = [
    "global","US","GB","DE","FR","BR","KR","JP","CN","RU",
    "TR","MX","AR","PL","ES","IT","NL","SE","NO","FI",
    "DK","AU","CA","IN","ID","TH","VN","PH","MY","SG",
    "HU","CZ","RO","PT","BE","CH","AT","GR","IL","SA"
]

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

def fetch_player_battles(player_tag, bracket, extracted_data, seen_tags, existing_hashes):
    if player_tag in seen_tags:
        return []
    seen_tags.add(player_tag)

    player_url_tag = player_tag.replace("#", "%23")
    log_url = f"{BASE_URL}/players/{player_url_tag}/battlelog"
    log_res = requests.get(log_url, headers=HEADERS, proxies=PROXIES)

    if log_res.status_code != 200:
        return []

    new_player_tags = []
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
                        if tag and tag not in seen_tags:
                            new_player_tags.append(tag)

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

                if match_entry["match_hash"] not in existing_hashes:
                    extracted_data.append(match_entry)
                    existing_hashes.add(match_entry["match_hash"])

    return new_player_tags

def collect_players_from_leaderboards(limit=1000):
    player_tags = []
    seen = set()
    for country in COUNTRIES:
        if len(player_tags) >= limit:
            break
        if country == "global":
            url = f"{BASE_URL}/rankings/global/players?limit=200"
        else:
            url = f"{BASE_URL}/rankings/{country}/players?limit=200"
        response = requests.get(url, headers=HEADERS, proxies=PROXIES)
        if response.status_code == 200:
            for player in response.json().get("items", []):
                tag = player["tag"]
                if tag not in seen:
                    seen.add(tag)
                    player_tags.append(tag)
        if len(player_tags) >= limit:
            break
    return player_tags[:limit]

TARGET_MATCHES_PER_BRACKET = 20000
MAX_PLAYERS_PER_BRACKET = 8000  # safety cap so a run can't spider forever if the target is unreachable

def harvest_bracket(bracket, seed_tags, extracted_data, seen_tags, existing_hashes,
                     target_matches=TARGET_MATCHES_PER_BRACKET, max_players=MAX_PLAYERS_PER_BRACKET):
    # Every entry fetch_player_battles appends during this call carries this
    # bracket, so tracking the growth of extracted_data's length is equivalent
    # to (and much cheaper than) recounting matches for this bracket each time.
    queue = list(seed_tags)
    processed = 0
    collected = 0
    while queue and processed < max_players and collected < target_matches:
        tag = queue.pop(0)
        before = len(extracted_data)
        new_tags = fetch_player_battles(tag, bracket, extracted_data, seen_tags, existing_hashes)
        collected += len(extracted_data) - before
        queue.extend(new_tags)
        processed += 1
        if processed % 100 == 0:
            print(f"  {bracket}: {processed} players processed, {collected} matches collected...")

    reason = "reached target" if collected >= target_matches else ("ran out of players" if not queue else "hit player safety cap")
    print(f"{bracket} done. {collected} matches from {processed} players ({reason}).")

def harvest_to_cloud():
    print("🛰️ Harvesting rank-segmented high-elo matches...")
    extracted_data = []
    seen_tags = set()
    existing_hashes = fetch_existing_hashes()

    # ==========================================
    # PASS 1: Masters & Legendary — spider from leaderboard seeds until
    # TARGET_MATCHES_PER_BRACKET matches are collected for this bracket
    # ==========================================
    print("Collecting Masters/Legendary seed players from leaderboards...")
    masters_seed_tags = collect_players_from_leaderboards(limit=1000)
    print(f"Got {len(masters_seed_tags)} unique Masters/Legendary seed players.")
    harvest_bracket("masters_legendary", masters_seed_tags, extracted_data, seen_tags, existing_hashes)

    # ==========================================
    # PASS 2: Diamond & Mythic (spider from seeds)
    # ==========================================
    print("Gathering Diamond/Mythic seed data via spidering...")
    diamond_seed_tags = [
        "#2Y9RV2RGR",
        "#2JJPLROYGY",
        "#RYRU2L2UV"
    ]
    harvest_bracket("diamond_mythic", diamond_seed_tags, extracted_data, seen_tags, existing_hashes)

    # ==========================================
    # SAVE PIPELINE: SUPABASE CLOUD
    # ==========================================
    if len(extracted_data) == 0:
        print("⚠️ No new matches found to save.")
        return

    print(f"Connecting to Supabase... pushing {len(extracted_data)} new matches")
    url = f"{SUPABASE_URL}/rest/v1/Matches"
    res = requests.post(url, json=extracted_data, headers=SUPABASE_HEADERS)
    if res.status_code in [200, 201]:
        print(f"✅ Success! Pushed {len(extracted_data)} live matches to Cloud Database.")
    else:
        print(f"❌ Failed to save to database: {res.status_code} {res.text}")
        return

    # Re-aggregate stats for every patch actually touched by this batch,
    # skipping any patch that's been declared closed/finished
    touched_patches = sorted({m["patch"] for m in extracted_data} - CLOSED_PATCHES)
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
