# ─── Shared scraper plumbing ──────────────────────────────────────────────────
# Config, Supercell API access (proxied), Supabase REST helpers, the battlelog
# spider, and the normalized insert pipeline used by every scraper module.
#
# Matches are stored NORMALIZED: ranked_matches holds smallint lookup ids
# (maps / rank_brackets / patches / brawlers) plus the md5 dedupe hash as a
# uuid primary key. Deduplication happens in the database via
# on_conflict=match_hash + ignore-duplicates — there is no longer any need to
# preload every stored hash before a run (the old scraper paginated the whole
# Matches table, hundreds of requests, before collecting anything).

import os
import time
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

def require_credentials():
    if not SUPERCELL_API_KEY or not SUPABASE_URL or not SUPABASE_KEY:
        print("⚠️ Missing API keys. Ensure environment variables are set.")
        raise SystemExit(1)

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
# data is final.
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
        # Season 47 rotation additions (2026-07-20). The API's exact spelling for
        # not-yet-collected maps is unconfirmed, so apostrophe/case variants are
        # listed too — the allowlist is additive-safe, unknown names just never match.
        # ("Safe(r) Zone" from the draft doc turned out to be Safe Zone itself.)
        "Rustic Arcade",
        "Belle's Rock", "Ring of Fire", "Out in the Open",
    },
}

# ==========================================
# THROTTLES & TARGETS
# ==========================================
MASTERS_BASELINE = 400000              # Masters fills to this before Diamond/Mythic collection ever starts
MASTERS_STEADY = 50000                 # per-run Masters target once the baseline is met
MASTERS_WINDOW_CAP = 1500000           # sliding-window retention: keep the newest 1.5M Masters rows (FIFO by collected_at)
MASTERS_RUN_CAP = 150000               # max matches one Masters run may collect while filling the baseline
DIAMOND_RUN_CAP = 50000                # per-run Diamond/Mythic target
SPIDER_DEPTH = 2                       # strictly 2 hops from seed players — rank purity by proximity
MAX_PLAYERS_PER_BRACKET = 20000        # safety cap so a run can't spider forever if the target is unreachable
CONCURRENCY = 8                        # parallel battlelog requests
REQUEST_DELAY = 0.15                   # seconds before each API call (per worker) — stays under rate limits
DB_BATCH_DELAY = 0.25                  # pause between Supabase insert batches

# ==========================================
# LOOKUP CACHE — name→id maps for the normalized schema
# ==========================================
class LookupCache:
    """In-memory name→id caches for the four lookup tables. Unknown names
    (new brawler release, new ranked map, new patch) are inserted on demand
    with merge-duplicates so concurrent scrapers can't race each other."""

    def __init__(self):
        self.brawlers = self._load("brawlers")
        self.maps = self._load("maps")
        self.patches = self._load("patches")
        self.brackets = self._load("rank_brackets")

    def _load(self, table):
        res = requests.get(
            f"{SUPABASE_URL}/rest/v1/{table}?select=id,name",
            headers=SUPABASE_HEADERS,
        )
        if res.status_code != 200:
            print(f"⚠️ Could not load {table} lookup: {res.status_code} {res.text[:200]}")
            return {}
        return {r["name"]: r["id"] for r in res.json()}

    def _ensure(self, table, cache, name, extra=None):
        if name in cache:
            return cache[name]
        res = requests.post(
            f"{SUPABASE_URL}/rest/v1/{table}?on_conflict=name",
            json={"name": name, **(extra or {})},
            headers={**SUPABASE_HEADERS, "Prefer": "resolution=merge-duplicates,return=representation"},
        )
        if res.status_code in (200, 201) and res.json():
            cache[name] = res.json()[0]["id"]
            return cache[name]
        print(f"⚠️ Could not ensure {table} row '{name}': {res.status_code} {res.text[:200]}")
        return None

    def brawler_id(self, name):
        return self._ensure("brawlers", self.brawlers, name.strip().upper())

    def map_id(self, name, mode):
        return self._ensure("maps", self.maps, name, extra={"mode": mode})

    def patch_id(self, name):
        return self._ensure("patches", self.patches, name)

    def bracket_id(self, name):
        return self._ensure("rank_brackets", self.brackets, name)

def get_stored_match_count(lookups, bracket_name, patch_name=CURRENT_PATCH):
    """Count of matches already stored for this bracket on the given patch."""
    bracket_id = lookups.brackets.get(bracket_name)
    patch_id = lookups.patches.get(patch_name)
    if bracket_id is None or patch_id is None:
        return 0  # lookup row doesn't exist yet → nothing stored under it
    url = (f"{SUPABASE_URL}/rest/v1/ranked_matches?select=match_hash"
           f"&bracket_id=eq.{bracket_id}&patch_id=eq.{patch_id}")
    headers = {**SUPABASE_HEADERS, "Prefer": "count=exact", "Range": "0-0"}
    res = requests.get(url, headers=headers)
    if res.status_code not in (200, 206):
        print(f"⚠️ Could not get match count for {bracket_name}: {res.status_code} {res.text}")
        return 0
    content_range = res.headers.get("Content-Range", "")
    if "/" in content_range:
        return int(content_range.split("/")[-1])
    return 0

# ==========================================
# MATCH HASH — dedupe key (identical to the historical formula)
# ==========================================
def make_hash(entry):
    """md5 over map+mode+bracket+sorted teams — the same formula every stored
    match was hashed with, so dedupe continuity is preserved. The 128-bit
    digest is stored as ranked_matches' uuid primary key."""
    winners = sorted([w for w in entry['winners'] if w])
    losers = sorted([l for l in entry['losers'] if l])
    raw = f"{entry['map']}{entry['mode']}{entry['rank_bracket']}{''.join(winners)}{''.join(losers)}"
    return hashlib.md5(raw.encode()).hexdigest()

# ==========================================
# BATTLELOG SPIDER
# ==========================================
def fetch_player_battles(player_tag, bracket, extracted_data, seen_tags, seen_hashes, lock=None):
    # lock guards all shared-state mutations (seen_tags/extracted_data/seen_hashes)
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

    # Slight per-request delay so parallel workers can't hammer the Brawl
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
        # Competitive Ranked reports "soloRanked" / "teamRanked". Plain trophy-ladder
        # games report EXACTLY "ranked" and must be EXCLUDED: a freshly released
        # brawler (e.g. Nori) can be trophy-legal while still absent from the
        # competitive Ranked pool, and those lower-skill games pollute the high-rank
        # meta the tier list and draft engine are built on. Matching the "ranked"
        # substring while dropping the exact "ranked" string keeps every competitive
        # variant (soloRanked / teamRanked / any future *Ranked) but sheds trophy.
        is_competitive_ranked = "ranked" in match_type and match_type != "ranked"

        # Belt-and-suspenders: trophy/casual battles carry a trophyChange field;
        # competitive Ranked never does. Catches any mislabeled type string.
        if "trophyChange" in battle_data:
            continue

        if is_competitive_ranked and mode_name in RANKED_MODES:
            teams = battle_data.get("teams", [])
            result = battle_data.get("result", "").lower()

            # Ranked is strictly 3v3 — the team-size check guards against any
            # 5v5 event that reports a mode name colliding with RANKED_MODES.
            if len(teams) == 2 and all(len(t) == 3 for t in teams) and result in ["victory", "defeat"]:
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
    # section, rather than scattered through the parsing above. seen_hashes only
    # dedupes within this run — cross-run dedupe happens in the database via
    # the match_hash primary key + ignore-duplicates on insert.
    def merge():
        new_player_tags = [t for t in candidate_tags if t not in seen_tags]
        for entry in candidate_entries:
            if entry["match_hash"] not in seen_hashes:
                extracted_data.append(entry)
                seen_hashes.add(entry["match_hash"])
        return new_player_tags

    if lock:
        with lock:
            return merge()
    return merge()

def harvest_bracket(bracket, seed_tags, extracted_data, seen_tags, seen_hashes,
                    target_matches, max_players=MAX_PLAYERS_PER_BRACKET, max_depth=None,
                    depth1_tags=None, depth1_source_whitelist=None):
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
    #
    # depth1_tags/depth1_source_whitelist: optionally collect this run's
    # depth-1 discoveries (players found directly in a seed's battlelog) for
    # future seed rotation — but ONLY when the originating depth-0 seed is in
    # depth1_source_whitelist (i.e. verified this run, not a previously-
    # spidered player). This is what stops rank drift from compounding across
    # successive runs: a "spider" seed offered to a future run is always
    # exactly one hop from a player verified THIS run, never one hop from
    # another spider seed.
    lock = threading.Lock()
    queue = [(tag, 0) for tag in seed_tags]
    processed = 0
    collected_start = len(extracted_data)

    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        while queue and processed < max_players and (len(extracted_data) - collected_start) < target_matches:
            batch = queue[:CONCURRENCY]
            queue = queue[CONCURRENCY:]
            futures = [(tag, depth, pool.submit(fetch_player_battles, tag, bracket, extracted_data, seen_tags, seen_hashes, lock)) for tag, depth in batch]
            for tag, depth, f in futures:
                new_tags = f.result()
                if depth == 0 and depth1_tags is not None:
                    if depth1_source_whitelist is None or tag in depth1_source_whitelist:
                        depth1_tags.update(new_tags)
                if max_depth is None or depth < max_depth:
                    queue.extend((t, depth + 1) for t in new_tags)
            processed += len(batch)
            if processed % 200 < CONCURRENCY:
                print(f"  {bracket}: {processed} players processed, {len(extracted_data) - collected_start} matches collected...")

    collected = len(extracted_data) - collected_start
    reason = "reached target" if collected >= target_matches else ("ran out of players" if not queue else "hit player safety cap")
    print(f"{bracket} done. {collected} matches from {processed} players ({reason}).")

# ==========================================
# SAVE PIPELINE — normalized rows into ranked_matches
# ==========================================
INSERT_BATCH_SIZE = 2000

def push_matches(extracted_data, lookups):
    """Convert collected name-based entries into normalized smallint rows and
    upsert them into ranked_matches. Duplicates (already stored on any prior
    run) are silently ignored by the database. Returns (inserted_count,
    touched_patches) — inserted_count reflects rows actually NEW to the DB."""
    if not extracted_data:
        print("⚠️ No new matches found to save.")
        return 0, set()

    rows = []
    for e in extracted_data:
        w = [lookups.brawler_id(n) for n in e["winners"][:3]]
        l = [lookups.brawler_id(n) for n in e["losers"][:3]]
        map_id = lookups.map_id(e["map"], e["mode"])
        bracket_id = lookups.bracket_id(e["rank_bracket"])
        patch_id = lookups.patch_id(e["patch"])
        if None in (map_id, bracket_id, patch_id) or not w or w[0] is None or not l or l[0] is None:
            continue  # lookup resolution failed — skip rather than store a broken row
        rows.append({
            "match_hash": e["match_hash"],  # 32-hex md5 → valid uuid input
            "map_id": map_id,
            "bracket_id": bracket_id,
            "patch_id": patch_id,
            "w1": w[0], "w2": w[1] if len(w) > 1 else None, "w3": w[2] if len(w) > 2 else None,
            "l1": l[0], "l2": l[1] if len(l) > 1 else None, "l3": l[2] if len(l) > 2 else None,
        })

    # Insert in batches — a single request with tens of thousands of rows can
    # exceed Supabase's statement timeout (57014) and roll back with zero rows
    # written, even though the whole run otherwise succeeded.
    print(f"Connecting to Supabase... pushing {len(rows)} matches in batches of {INSERT_BATCH_SIZE}")
    url = f"{SUPABASE_URL}/rest/v1/ranked_matches?on_conflict=match_hash"
    headers = {**SUPABASE_HEADERS, "Prefer": "resolution=ignore-duplicates,return=representation"}
    inserted = 0
    attempted = 0
    for i in range(0, len(rows), INSERT_BATCH_SIZE):
        if i > 0:
            time.sleep(DB_BATCH_DELAY)  # breathe between batches — don't overload Supabase
        batch = rows[i:i + INSERT_BATCH_SIZE]
        res = requests.post(url, json=batch, headers=headers)
        if res.status_code in (200, 201):
            new_rows = len(res.json())  # representation returns only rows actually inserted
            inserted += new_rows
            attempted += len(batch)
            print(f"  Batch {i // INSERT_BATCH_SIZE + 1}: {new_rows}/{len(batch)} new ({attempted}/{len(rows)} processed)")
        else:
            print(f"❌ Failed to save batch starting at {i}: {res.status_code} {res.text}")
            print(f"⚠️ Stopping insert — {inserted} new matches were saved before the failure.")
            break

    touched_patches = {e["patch"] for e in extracted_data} - CLOSED_PATCHES
    print(f"✅ Done. {inserted} new matches stored ({len(rows) - inserted if attempted == len(rows) else '?'} were already known).")
    return inserted, touched_patches

def prune_bracket(bracket_name, cap=MASTERS_WINDOW_CAP):
    """Sliding-window retention: FIFO-drop the oldest rows beyond `cap` for
    this bracket (by collected_at). Owner-authorized exception to the old
    'never delete from ranked_matches' rule — aggregates are per patch and the
    recency window keeps the engine tracking the live meta, so rows older than
    the window only cost storage and aggregation time."""
    res = requests.post(
        f"{SUPABASE_URL}/rest/v1/rpc/prune_ranked_matches",
        json={"target_bracket": bracket_name, "cap": cap},
        headers=SUPABASE_HEADERS,
    )
    if res.status_code == 200:
        print(f"🧹 window prune ({bracket_name}, cap {cap:,}): {res.text.strip()} old matches dropped")
    else:
        print(f"⚠️ prune failed for {bracket_name}: {res.status_code} {res.text[:200]}")

def reaggregate(touched_patches):
    """Re-aggregate BrawlerStats for every open patch touched by this run."""
    rpc_url = f"{SUPABASE_URL}/rest/v1/rpc/aggregate_brawler_stats"
    for patch in sorted(touched_patches):
        print(f"🔄 Re-aggregating BrawlerStats for patch {patch}...")
        rpc_res = requests.post(rpc_url, json={"target_patch": patch}, headers=SUPABASE_HEADERS)
        if rpc_res.status_code in (200, 204):
            print(f"✅ BrawlerStats aggregation complete for {patch}.")
        else:
            print(f"⚠️ Aggregation failed for {patch}: {rpc_res.status_code} {rpc_res.text}")
