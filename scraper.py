import os
import hashlib
import requests

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
        if "ranked" in match_type or "solomode" in match_type:
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

                match_entry = {
                    "map": map_name,
                    "mode": mode_name,
                    "rank_bracket": bracket,
                    "winners": winners,
                    "losers": losers,
                    "patch": CURRENT_PATCH,
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

def harvest_to_cloud():
    print("🛰️ Harvesting rank-segmented high-elo matches...")
    extracted_data = []
    seen_tags = set()
    existing_hashes = fetch_existing_hashes()

    # ==========================================
    # PASS 1: Masters & Legendary (1000 players)
    # ==========================================
    print("Collecting Masters/Legendary players from leaderboards...")
    masters_tags = collect_players_from_leaderboards(limit=1000)
    print(f"Got {len(masters_tags)} unique Masters/Legendary players.")
    for i, tag in enumerate(masters_tags):
        if i % 100 == 0:
            print(f"  Processing Masters player {i+1}/{len(masters_tags)}...")
        fetch_player_battles(tag, "masters_legendary", extracted_data, seen_tags, existing_hashes)

    print(f"Masters/Legendary done. {len(extracted_data)} new matches so far.")

    # ==========================================
    # PASS 2: Diamond & Mythic (spider from seeds)
    # ==========================================
    print("Gathering Diamond/Mythic seed data via spidering...")
    seed_tags = [
        "#2Y9RV2RGR",
        "#2JJPLROYGY",
        "#RYRU2L2UV"
    ]
    spider_queue = list(seed_tags)
    mythic_count = 0
    while spider_queue and mythic_count < 1000:
        tag = spider_queue.pop(0)
        new_tags = fetch_player_battles(tag, "diamond_mythic", extracted_data, seen_tags, existing_hashes)
        spider_queue.extend(new_tags)
        mythic_count += 1
        if mythic_count % 100 == 0:
            print(f"  Spidered {mythic_count}/1000 Diamond/Mythic players...")

    print(f"Diamond/Mythic done. {len(extracted_data)} total new matches.")

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

    # Re-aggregate stats for the current patch so the website stays fast
    print(f"🔄 Re-aggregating BrawlerStats for patch {CURRENT_PATCH}...")
    rpc_url = f"{SUPABASE_URL}/rest/v1/rpc/aggregate_brawler_stats"
    rpc_res = requests.post(rpc_url, json={"target_patch": CURRENT_PATCH}, headers=SUPABASE_HEADERS)
    if rpc_res.status_code in [200, 204]:
        print("✅ BrawlerStats aggregation complete.")
    else:
        print(f"⚠️ Aggregation failed: {rpc_res.status_code} {rpc_res.text}")

if __name__ == "__main__":
    harvest_to_cloud()
