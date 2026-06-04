import os
import requests
from supabase import create_client, Client

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

def fetch_player_battles(player_tag, bracket, extracted_data):
    """Helper function to fetch and process matches for a single player."""
    player_url_tag = player_tag.replace("#", "%23")
    log_url = f"{BASE_URL}/players/{player_url_tag}/battlelog"
    log_res = requests.get(log_url, headers=HEADERS, proxies=PROXIES)

    if log_res.status_code != 200:
        return

    battles = log_res.json().get("items", [])
    for match in battles:
        battle_data = match.get("battle", {})
        event_data = match.get("event", {})

        match_type = battle_data.get("type", "").lower()
        if "ranked" in match_type or "solomode" in match_type:
            teams = battle_data.get("teams", [])
            result = battle_data.get("result", "").lower()

            if len(teams) == 2 and result in ["victory", "defeat"]:
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

                match_entry = {
                    "map": event_data.get("map", "Unknown Map"),
                    "mode": battle_data.get("mode", "Unknown Mode"),
                    "rank_bracket": bracket,
                    "winners": [p['brawler']['name'] for p in winning_team],
                    "losers": [p['brawler']['name'] for p in losing_team]
                }
                extracted_data.append(match_entry)

def harvest_to_cloud():
    print("🛰️ Harvesting rank-segmented high-elo matches...")
    extracted_data = []

    # ==========================================
    # PASS 1: Masters & Legendary Bracket
    # ==========================================
    print("Gathering Global Masters data...")
    rankings_url = f"{BASE_URL}/rankings/global/players?limit=15"
    response = requests.get(rankings_url, headers=HEADERS, proxies=PROXIES)

    if response.status_code == 200:
        top_players = response.json().get("items", [])
        for player in top_players:
            fetch_player_battles(player['tag'], "masters_legendary", extracted_data)
    else:
        print("❌ Failed to reach Global Leaderboard.")

    # ==========================================
    # PASS 2: Diamond & Mythic Bracket
    # ==========================================
    print("Gathering Diamond/Mythic seed data...")

    # ⚠️ ADD YOUR PLAYER TAGS HERE (Keep the # symbol!)
    seed_tags = [
        "#YOUR_TAG_HERE",
        "#FRIEND_1_TAG",
        "#FRIEND_2_TAG"
    ]

    for tag in seed_tags:
        fetch_player_battles(tag, "diamond_mythic", extracted_data)

    # ==========================================
    # SAVE PIPELINE: SUPABASE CLOUD
    # ==========================================
    if len(extracted_data) == 0:
        print("⚠️ No valid Ranked matches found to save.")
        return

    print("Connecting to Supabase...")
    try:
        supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        response = supabase.table("Matches").insert(extracted_data).execute()
        print(f"✅ Success! Pushed {len(extracted_data)} live matches to Cloud Database.")
    except Exception as e:
        print(f"❌ Failed to save to database: {e}")

if __name__ == "__main__":
    harvest_to_cloud()
