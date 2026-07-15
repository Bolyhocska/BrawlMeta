import os
import re
import time
import random
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

def refresh_site_feed():
    """Refresh the live relays: the event/map rotation stays as a raw SiteFeed
    payload, while the global top-200 trophy leaderboard is parsed into the
    structured top_200_leaderboard table that the Leaderboards UI reads. Both
    come from the official Supercell API (browser clients can't call it — key +
    IP allowlist — so the scraper relays them into Supabase on every run)."""
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

# ==========================================
# MASTERS SEEDS — live from the ranked leaderboard
# ==========================================
# brawlace.com lists the global ranked (Masters) leaderboard; player profile
# links embed the tag as /players/%23TAG. We pull the top 100, store them in
# masters_players, then seed the spider from a RANDOM 5 of them each run so
# collection coverage rotates across the very top of the ladder.
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

def fetch_top_ranked_players(limit=100):
    """Scrape the top `limit` ranked player tags (in rank order) from brawlace
    and refresh the masters_players table. Returns [] on any failure."""
    try:
        res = requests.get(BRAWLACE_RANKED_URL, timeout=30, headers={
            "User-Agent": "Mozilla/5.0 (compatible; BrawlMetaBot/1.0; +https://brawl-meta.vercel.app)"
        })
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
            return []
        now = datetime.now(timezone.utc).isoformat()
        rows = [{"player_tag": t, "rank": i + 1, "source": "brawlace", "fetched_at": now} for i, t in enumerate(tags)]
        up = requests.post(
            f"{SUPABASE_URL}/rest/v1/masters_players?on_conflict=player_tag",
            json=rows,
            headers={**SUPABASE_HEADERS, "Prefer": "resolution=merge-duplicates"},
        )
        if up.status_code in (200, 201, 204):
            print(f"✅ masters_players refreshed ({len(rows)} ranked players)")
        else:
            print(f"⚠️ masters_players store failed: {up.status_code} {up.text[:200]}")
        return tags
    except Exception as e:
        print(f"⚠️ brawlace scrape error: {e}")
        return []

def get_masters_seeds():
    """Random 5 of the live top-100 ranked players. Falls back to the last
    stored masters_players, then to the hardcoded pro tags."""
    top = fetch_top_ranked_players(100)
    if not top:
        res = requests.get(
            f"{SUPABASE_URL}/rest/v1/masters_players?select=player_tag&order=rank.asc&limit=100",
            headers=SUPABASE_HEADERS,
        )
        if res.status_code == 200:
            top = [r["player_tag"] for r in res.json() if r.get("player_tag")]
        if top:
            print(f"Using {len(top)} previously stored masters_players as seed pool.")
    if not top:
        print("Using hardcoded fallback Masters seeds.")
        return list(FALLBACK_MASTERS_SEEDS)
    return random.sample(top, min(5, len(top)))

def get_diamond_seeds():
    """Diamond/Mythic seeds now live in the diamond_mythic_players table."""
    fallback = ["#2Y9RV2RGR", "#2JJPLROYGY", "#RYRU2L2UV"]
    try:
        res = requests.get(
            f"{SUPABASE_URL}/rest/v1/diamond_mythic_players?select=player_tag",
            headers=SUPABASE_HEADERS,
        )
        if res.status_code == 200:
            tags = [r["player_tag"] for r in res.json() if r.get("player_tag")]
            if tags:
                return tags
    except Exception as e:
        print(f"⚠️ diamond_mythic_players read error: {e}")
    return fallback

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

    # Slight per-request delay so 8 parallel workers can't hammer the Brawl
    # Stars API into rate-limiting us (429s silently drop whole battlelogs).
    time.sleep(REQUEST_DELAY)
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

MASTERS_BASELINE = 400000              # Masters fills to this before Diamond/Mythic collection ever starts
MASTERS_STEADY = 50000                 # per-run Masters target once the baseline is met
RUN_HARD_CAP = 150000                  # absolute max matches collected across one whole run
SPIDER_DEPTH = 2                       # strictly 2 hops from seed players — rank purity by proximity
MAX_PLAYERS_PER_BRACKET = 20000        # safety cap so a run can't spider forever if the target is unreachable
CONCURRENCY = 8                        # parallel battlelog requests
REQUEST_DELAY = 0.15                   # seconds before each API call (per worker) — stays under rate limits
DB_BATCH_DELAY = 0.25                  # pause between Supabase insert batches

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

def harvest_to_cloud():
    print("🛰️ Harvesting rank-segmented high-elo matches...")
    refresh_site_feed()
    extracted_data = []
    seen_tags = set()
    existing_hashes = fetch_existing_hashes()

    # ==========================================
    # PASS 1: Masters (1+) — always collected first. Fills to the 400k
    # baseline before Diamond/Mythic gets any budget; once the baseline is
    # met, throttles down to a steady 50k per run. The whole run is hard-
    # capped at RUN_HARD_CAP matches regardless of bracket.
    #
    # Seeds: a RANDOM 5 of the live top-100 global ranked players (scraped
    # from brawlace each run into masters_players, with stored/hardcoded
    # fallbacks). The public API has no per-match rank-tier field, so rank
    # purity is enforced by spider proximity instead: SPIDER_DEPTH=2 keeps
    # collection within two matchmaking hops of verified top-ranked players.
    # At Masters I+ the queue is solo-only and matchmaking rank-tight, so
    # those hops stay Masters-adjacent instead of drifting down the ladder.
    # ==========================================
    masters_stored = get_stored_match_count("masters_legendary")
    if masters_stored < MASTERS_BASELINE:
        masters_target = min(MASTERS_BASELINE - masters_stored, RUN_HARD_CAP)
        print(f"masters_legendary: {masters_stored} stored, filling 400k baseline (target {masters_target} this run).")
    else:
        masters_target = min(MASTERS_STEADY, RUN_HARD_CAP)
        print(f"masters_legendary: {masters_stored} stored, baseline met — steady +{masters_target}.")

    masters_seed_tags = get_masters_seeds()
    print(f"Masters seeds this run: {', '.join(masters_seed_tags)}")
    harvest_bracket("masters_legendary", masters_seed_tags, extracted_data, seen_tags, existing_hashes,
                    target_matches=masters_target, max_depth=SPIDER_DEPTH)

    # ==========================================
    # PASS 2: Diamond & Mythic — only once Masters has met its 400k baseline,
    # and only with whatever budget the run cap has left after Masters.
    # ==========================================
    if masters_stored < MASTERS_BASELINE:
        print(f"Skipping Diamond/Mythic this run — Masters baseline not yet met ({masters_stored}/{MASTERS_BASELINE}).")
    else:
        run_budget_left = RUN_HARD_CAP - len(extracted_data)
        if run_budget_left <= 0:
            print("Skipping Diamond/Mythic — run hard cap already consumed by Masters.")
        else:
            diamond_seed_tags = get_diamond_seeds()
            print(f"Diamond/Mythic seeds: {', '.join(diamond_seed_tags)} (budget {run_budget_left}).")
            harvest_bracket("diamond_mythic", diamond_seed_tags, extracted_data, seen_tags, existing_hashes,
                            target_matches=run_budget_left, max_depth=SPIDER_DEPTH)

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
        if i > 0:
            time.sleep(DB_BATCH_DELAY)  # breathe between batches — don't overload Supabase
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
