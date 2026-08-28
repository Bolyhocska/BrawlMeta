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

# Confirmed official ranked maps per patch.
#
# THIS IS A FLOOR, NOT THE LIVE LIST. scrapers/map_pool.py reads the actual
# rotation daily into ranked_map_pool and every scraper unions it in via
# refresh_dynamic_map_pool(), so a map rotating in is collected without anyone
# editing this file. Keeping the hardcoded set is what makes that safe: if the
# external source breaks, changes its markup, or starts returning nonsense, the
# allowlist degrades to this known-good baseline rather than to nothing — and an
# empty allowlist would let themed and event reskins pollute the ranked dataset,
# which is the whole reason the filter exists.
#
# So: no obligation to keep this current. Add to it when a rotation is known and
# stable, leave it alone otherwise.
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
        # Rotation additions (2026-07-20). The API's exact spelling for
        # not-yet-collected maps is unconfirmed, so apostrophe/case variants are
        # listed too — the allowlist is additive-safe, unknown names just never match.
        "Belle's Rock", "Ring of Fire", "Out in the Open",
        # "Safe(r) Zone" is a SEPARATE HEIST MAP from "Safe Zone" — owner-confirmed
        # 2026-08-24, correcting an earlier note here that claimed they were the
        # same map. They are not, and must never be merged: they have different
        # geometry and different metas.
        #
        # Because it was missing from this list, every Safe(r) Zone match was
        # dropped rather than misfiled — verified: `maps` holds no Safe(r) Zone
        # row, and Safe Zone's 64,490 rows are all genuinely Safe Zone. So the
        # cost was lost collection, not corrupted data, and it starts clean.
        #
        # They do not collide in the engine either: mapSlug() strips punctuation,
        # giving "safezone" and "saferzone", so draft_logic_config lookups stay
        # distinct. Safe(r) Zone simply has no hand-authored map profile or pro
        # rules yet, so the engine runs on measured data alone for it.
        "Safe(r) Zone",
        # 2026-07-22 rotation: Rustic Arcade left the ranked pool and its data was
        # purged by hand (owner-instructed). It ROTATED BACK IN and was confirmed
        # live on 2026-08-24, so it is listed again — the `maps` lookup row was
        # deliberately kept through the purge for exactly this, and its id
        # survived. Crystal Arcade and Deathcap Trap arrived in the same rotation.
        "Crystal Arcade", "Deathcap Trap", "Rustic Arcade",
        # 2026-08-24: Spiraling Out (Brawl Ball) confirmed in the live rotation.
        # Its absence meant every match on it was being silently dropped, which
        # is what motivated the dynamic pool below.
        "Spiraling Out",
    },
}

# ──────────────────────────────────────────────────────────────────────────────
# DYNAMIC MAP POOL
# ──────────────────────────────────────────────────────────────────────────────
# RANKED_MAPS above is hand-maintained, so a map rotating IN is invisible until
# somebody edits this file — and until they do, every match on that map is
# dropped. scrapers/map_pool.py observes the live rotation daily and records it
# in the ranked_map_pool table; this set is loaded from there at the start of a
# run and treated as an ADDITION to the hardcoded allowlist.
#
# Union only, never intersection. A wrong addition costs some unwanted data that
# can be pruned later; a wrong removal silently discards real matches for as
# long as nobody notices. Those are not symmetric, so the code refuses to shrink
# the allowlist from a remote source.
#
# Empty by default: a scraper that never calls refresh_dynamic_map_pool() keeps
# exactly the old behaviour, and a failed fetch leaves it empty rather than
# leaving the pipeline in a half-updated state.
EXTRA_RANKED_MAPS = set()

def refresh_dynamic_map_pool():
    """Load every map ever observed in the ranked pool into EXTRA_RANKED_MAPS.
    Safe to call from any scraper's main(); failures are non-fatal and simply
    leave the set empty, falling back to the hardcoded baseline."""
    global EXTRA_RANKED_MAPS
    try:
        res = requests.get(
            f"{SUPABASE_URL}/rest/v1/ranked_map_pool",
            headers=SUPABASE_HEADERS,
            # EVERY map ever seen in the ranked pool, not just today's rotation.
            # The allowlist answers "is this a real ranked map", not "is it live
            # right now" — the rotation turns over every day or two (measured
            # 2026-08-24: six maps swapped between two runs hours apart), and a
            # battlelog still contains games from maps that rotated out this
            # morning. Filtering on in_rotation would silently drop those.
            params={"select": "map_name,mode"},
            timeout=30,
        )
        if res.status_code != 200:
            print(f"⚠️ could not load ranked_map_pool: {res.status_code}")
            return
        names = {r["map_name"] for r in res.json() if r.get("map_name")}
        extra = names - RANKED_MAPS.get(CURRENT_PATCH, set())
        EXTRA_RANKED_MAPS = names
        if extra:
            print(f"🗺️ dynamic map pool adds {len(extra)} map(s) not in the hardcoded list: {', '.join(sorted(extra))}")
        else:
            print(f"🗺️ dynamic map pool: {len(names)} map(s), all already allowed")
    except Exception as e:
        print(f"⚠️ ranked_map_pool load failed (continuing with hardcoded list): {e}")

# ==========================================
# THROTTLES & TARGETS
# ==========================================
MASTERS_WINDOW_CAP = 1500000           # sliding-window retention: keep the newest 1.5M Masters rows (FIFO by collected_at)
MASTERS_BASELINE = MASTERS_WINDOW_CAP  # Masters fills all the way to the 1.5M window before Diamond/Mythic collection ever starts — the owner wants the full Masters window in force first, then the rolling steady-state, and only then Diamond/Mythic
MASTERS_STEADY = 50000                 # per-run Masters target once the baseline is met (== steady-state that the FIFO window trims back to 1.5M)
MASTERS_RUN_CAP = 150000               # max matches one Masters run may collect while filling the baseline
DIAMOND_RUN_CAP = 50000                # per-run Diamond/Mythic target
SPIDER_DEPTH = 2                       # strictly 2 hops from seed players — rank purity by proximity
MAX_PLAYERS_PER_BRACKET = 50000        # safety cap so a run can't spider forever if the target is unreachable
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
    """Count of matches already stored for this bracket.

    patch_name=None counts EVERY patch in the bracket, which is what you want
    when comparing against the retention window: prune_ranked_matches caps the
    bracket as a whole, so a per-patch count can never reach that cap while any
    older-patch rows survive inside the window. Comparing the two deadlocked the
    Diamond/Mythic gate for a month — see diamond_mythic.py.
    """
    bracket_id = lookups.brackets.get(bracket_name)
    if bracket_id is None:
        return 0  # lookup row doesn't exist yet → nothing stored under it
    url = (f"{SUPABASE_URL}/rest/v1/ranked_matches?select=match_hash"
           f"&bracket_id=eq.{bracket_id}")
    if patch_name is not None:
        patch_id = lookups.patches.get(patch_name)
        if patch_id is None:
            return 0
        url += f"&patch_id=eq.{patch_id}"
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
# Patches whose stored rows were hashed WITHOUT a patch component.
#
# The original formula omitted the patch, which is a silent data-loss bug at
# every rollover: while an old patch is still open, a NEW-patch game whose comp
# already exists from the OLD patch hashes identically and is dropped by
# ignore-duplicates. The surviving row keeps its old patch_id, so the game does
# not count toward the new patch's aggregates either — it is simply gone. On the
# run measured 2026-08-27, 10,755 of 48,620 collected rows (22%) already existed;
# at a rollover that same share of new-patch games would vanish, biased toward
# the MOST COMMON comps, which is exactly the population the tier list cares
# about.
#
# Adding the patch changes every hash, so the fix is scoped rather than global:
# patches already in the table keep the old formula (their stored rows stay
# addressable and dedupe continuity holds), and every patch from the next one
# onward is hashed with its patch included. Nothing is re-collected.
LEGACY_HASH_PATCHES = {"67.306", "68.250"}


def make_hash(entry):
    """md5 over map+mode+bracket+sorted teams, plus the patch for any patch not
    in LEGACY_HASH_PATCHES. The 128-bit digest is ranked_matches' uuid PK."""
    winners = sorted([w for w in entry['winners'] if w])
    losers = sorted([l for l in entry['losers'] if l])
    raw = f"{entry['map']}{entry['mode']}{entry['rank_bracket']}{''.join(winners)}{''.join(losers)}"
    patch = entry.get('patch')
    if patch and patch not in LEGACY_HASH_PATCHES:
        raw = f"{raw}|{patch}"
    return hashlib.md5(raw.encode()).hexdigest()

def _battletime_delta_seconds(a, b):
    """Seconds between two API battleTime strings ('20260819T120000.000Z').
    Returns None if either fails to parse. Used only by RunStats, to tell a
    genuine rematch (minutes apart) from the same game reported at slightly
    different timestamps in two battlelogs (seconds apart)."""
    try:
        fmt = "%Y%m%dT%H%M%S.%fZ"
        return abs((datetime.strptime(b, fmt) - datetime.strptime(a, fmt)).total_seconds())
    except (ValueError, TypeError):
        return None

# ==========================================
# RUN INSTRUMENTATION — measurement only, changes no behaviour (Phase 0)
# ==========================================
class RunStats:
    """Counters for one scraper run. Nothing here alters what is parsed,
    stored, or deduped — it only observes.

    WHY THIS EXISTS. `make_hash` keys on composition only: map + mode + bracket
    + the six brawler names. No timestamp, no player tags. So two genuinely
    different games with the same six brawlers on the same map collapse into a
    single stored row, permanently. That loss is invisible in the database —
    the second game was simply never written — and it is ALSO invisible in
    `push_matches`' attempted-vs-inserted delta, because that delta is
    dominated by benign duplicates: one match appears in up to six battlelogs,
    and the spider revisits the same players on every run. Counting "already in
    DB" therefore measures re-scraping, not collisions.

    So the collapse is measured here, at parse time, by indexing every battle
    under its composition key by (six player tags, battleTime) — which
    identifies the physical game — and counting how many distinct games share
    one composition key. report() then splits those collisions by cause,
    because only some of them are the bug.

    Scope caveat, stated so the number is not over-read: this measures collapse
    WITHIN one run. Collisions against rows stored by EARLIER runs are real too
    and are not counted here, so the reported rate is a lower bound on the
    steady-state loss.
    """

    def __init__(self):
        self._lock = threading.Lock()
        # comp_hash -> {six-player-tag tuple -> set(battleTime)}
        # Indexed this way rather than as opaque identity hashes so the report
        # can tell the two explanations for a collision apart — see report().
        self.comp_index = {}
        self.battles_parsed = 0        # raw sightings, before any dedupe
        self.status_counts = {}        # HTTP status -> count, for the API budget question
        self.rate_limit_headers = {}   # any rate-limit header the API actually returns

    # -- collision measurement -------------------------------------------------
    def record_battle(self, comp_hash, battle_time, tags):
        with self._lock:
            self.battles_parsed += 1
            party = tuple(sorted(t for t in tags if t))
            self.comp_index.setdefault(comp_hash, {}).setdefault(party, set()).add(battle_time)

    # -- API budget measurement ------------------------------------------------
    def record_response(self, res):
        """Track status codes and surface whatever rate-limit headers the Brawl
        Stars API actually returns. Non-200s are currently swallowed silently by
        fetch_player_battles, which means a 429 storm is indistinguishable from
        'these players have no ranked games' — this makes that visible."""
        with self._lock:
            self.status_counts[res.status_code] = self.status_counts.get(res.status_code, 0) + 1
            for name, value in res.headers.items():
                low = name.lower()
                if "ratelimit" in low.replace("-", "") or low in ("retry-after", "x-quota-remaining"):
                    self.rate_limit_headers[name] = value

    def report(self, label=""):
        """Classifies every collision rather than just counting it.

        A composition key holding more than one game has two very different
        possible causes, and they demand opposite conclusions:

          REMATCH  — same six players, different battleTimes. Either a genuine
                     rematch (they requeued and drafted the same comp), or the
                     SAME game seen from several battlelogs with an unstable
                     timestamp. The time gap separates them: seconds apart is
                     clock skew and the collision is an artifact of this
                     measurement; minutes apart is a real second game.
          DISTINCT — different sets of six players. Unambiguously two different
                     real games sharing one composition key. This is the bug.

        Reporting only the total conflates a measurement artifact with the
        thing being measured, so the two are kept apart here.
        """
        with self._lock:
            sightings = self.battles_parsed
            rows = len(self.comp_index)
            games = 0
            rematch_parties = 0     # one party, >1 timestamp
            distinct_party_keys = 0  # one comp key, >1 different party
            distinct_party_games = 0
            deltas = []
            for parties in self.comp_index.values():
                for times in parties.values():
                    games += len(times)
                    if len(times) > 1:
                        rematch_parties += 1
                        ordered = sorted(times)
                        for a, b in zip(ordered, ordered[1:]):
                            d = _battletime_delta_seconds(a, b)
                            if d is not None:
                                deltas.append(d)
                if len(parties) > 1:
                    distinct_party_keys += 1
                    distinct_party_games += len(parties) - 1
            statuses = dict(self.status_counts)
            headers = dict(self.rate_limit_headers)

        tag = f" [{label}]" if label else ""
        print(f"\n📊 RUN STATS{tag}")
        if games:
            print(f"  Sightings {sightings:,} → {games:,} distinct (party, time) → {rows:,} storable row(s)")
            print(f"  Cross-battlelog dedupe: {sightings - games:,} repeat sightings removed "
                  f"({(sightings - games) / sightings * 100:.1f}% of sightings)")
            print(f"  COLLISIONS, split by cause:")
            print(f"    distinct-party : {distinct_party_games:,} game(s) over {distinct_party_keys:,} key(s) "
                  f"— different players, same comp. REAL LOSS.")
            print(f"    same-party     : {rematch_parties:,} key(s) — same six players at >1 timestamp.")
            if deltas:
                deltas.sort()
                mid = deltas[len(deltas) // 2]
                near = sum(1 for d in deltas if d <= 10)
                print(f"      gaps: min {deltas[0]:.0f}s / median {mid:.0f}s / max {deltas[-1]:.0f}s; "
                      f"{near:,} of {len(deltas):,} are <=10s")
                print(f"      → gaps of seconds mean unstable timestamps (measurement artifact);")
                print(f"        gaps of minutes mean genuine rematches (real loss).")
            real = distinct_party_games
            print(f"  Lower-bound REAL loss (distinct-party only): {real:,} of {games:,} "
                  f"({real / games * 100:.2f}%)")
            print(f"    NOTE: in-run only — collisions against previously stored rows are extra.")
        else:
            print("  No ranked battles parsed — nothing to measure.")

        if statuses:
            ok = statuses.get(200, 0)
            total = sum(statuses.values())
            # Counts every Supercell call, not only battlelogs — a boosted
            # profile also costs a /players request for its snapshot.
            print(f"  Supercell requests: {total} ({ok} ok)")
            for code in sorted(statuses):
                if code != 200:
                    print(f"    ⚠️ HTTP {code}: {statuses[code]}")
            if 429 in statuses:
                print("    ⚠️ 429s present — the shared Supercell key IS rate-limited at this volume.")
        print(f"  Rate-limit headers seen: {headers if headers else 'none returned by the API'}\n")

STATS = RunStats()

# ==========================================
# BATTLELOG SPIDER
# ==========================================
# ─── Player name directory ────────────────────────────────────────────────────
# Supercell exposes no player-search endpoint, so looking a player up BY NAME can
# only ever search an index we build ourselves. Every battlelog entry already
# hands us {tag, name} for all six players and we were reading the tag and
# throwing the name away — so this costs zero extra API calls and rides along
# with work the scrapers already do.
#
# Measured 2026-08-26: a 4,000-row sample of player_matches held 236 tags we had
# polled and 4,972 distinct tags visible inside those same rows, 21x more.
SEEN_PLAYERS = {}

# How many distinct ROUNDS collapsed into each composition hash this run, and
# the battle identities already counted.
#
# A Ranked series is one draft on one map, up to 3 rounds (measured: 16,349
# series, 100% same map). Every round of a 2-0 hashes identically, so the extra
# rounds were being discarded — 45.5% of all rounds played. Counting them means
# a 2-1 stops reading as a flat 50/50.
#
# Identity dedupe has to come FIRST. One round sits in up to six players'
# battlelogs, so counting per sighting would inflate every count roughly 6x.
# Identity is battleTime + all six tags, the same key player_matches uses.
HASH_COUNTS = {}
SEEN_IDENTITIES = set()


def push_players(players=None):
    """Upsert observed {tag: name} pairs into player_directory.

    The name is OVERWRITTEN on every sighting, deliberately: a rename has to
    follow the tag, which is the stable identity. `first_seen_at` is left out of
    the payload so the conflict path cannot reset it — PostgREST only updates the
    columns you send.
    """
    rows = dict(SEEN_PLAYERS if players is None else players)
    if not rows:
        return 0
    now = datetime.now(timezone.utc).isoformat()
    payload = [{"player_tag": t, "name": n, "last_seen_at": now}
               for t, n in rows.items() if t and n]
    headers = {**SUPABASE_HEADERS, "Prefer": "resolution=merge-duplicates"}
    url = f"{SUPABASE_URL}/rest/v1/player_directory?on_conflict=player_tag"
    written = 0
    # Same batching rule as the match insert: a giant single statement hits the
    # timeout and rolls the whole thing back.
    for i in range(0, len(payload), 1000):
        chunk = payload[i:i + 1000]
        try:
            r = requests.post(url, headers=headers, json=chunk, timeout=60)
            if r.status_code in (200, 201, 204):
                written += len(chunk)
            else:
                print(f"  player_directory upsert failed ({r.status_code}): {r.text[:200]}")
        except Exception as e:
            print(f"  player_directory upsert error: {e}")
        time.sleep(0.2)
    if players is None:
        SEEN_PLAYERS.clear()
    return written


def parse_battle(match, player_tag, bracket):
    """Parse ONE battlelog entry. Returns (frontier_tags, record, players).

    Single source of truth for what counts as a collectable competitive Ranked
    match, shared by the spider (which projects the record down to brawler names)
    and the player tracker (which keeps all of it). Extracted from
    fetch_player_battles rather than copied, so the two can never drift apart
    about which battles are legitimate.

    `frontier_tags` is returned SEPARATELY from `record` on purpose. The spider
    feeds those tags to its queue as soon as a battle looks structurally like
    Ranked 3v3, even if the battle is then rejected for being on a closed patch
    or an unlisted map. Folding the tags into the record would silently shrink
    the spider's reach, so the split preserves the original behaviour exactly.

    `record` is None for anything not collectable. When present it carries both
    the absolute view (winners/losers, for the composition hash) and the view
    relative to `player_tag` (team/enemy, result), because a player history is
    written from the player's side while ranked_matches is not.

    `players` is [{"tag", "name"}] for everyone in the battle, and follows the
    same rule as frontier_tags: it is returned even when the battle is rejected,
    because a real player was still observed. Supercell exposes no player-search
    endpoint, so name lookup can only search an index we build ourselves — and
    the battlelog hands us {tag, name} for all six players at no extra cost. We
    were reading the tag and dropping the name.
    """
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
        return [], None, []

    if not (is_competitive_ranked and mode_name in RANKED_MODES):
        return [], None, []

    teams = battle_data.get("teams", [])
    result = battle_data.get("result", "").lower()

    # Ranked is strictly 3v3 — the team-size check guards against any
    # 5v5 event that reports a mode name colliding with RANKED_MODES.
    if not (len(teams) == 2 and all(len(t) == 3 for t in teams) and result in ["victory", "defeat"]):
        return [], None, []

    battle_tags = []
    battle_players = []
    for team in teams:
        for p in team:
            tag = p.get("tag")
            if tag:
                battle_tags.append(tag)
                name = p.get("name")
                if name:
                    battle_players.append({"tag": tag, "name": name})

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
        return battle_tags, None, battle_players

    map_name = event_data.get("map") or "Unknown Map"
    mode_name = battle_data.get("mode") or "Unknown Mode"
    battle_time = match.get("battleTime")
    match_patch = determine_patch(battle_time)
    if match_patch in CLOSED_PATCHES:
        return battle_tags, None, battle_players

    allowed_maps = RANKED_MAPS.get(match_patch)
    # EXTRA_RANKED_MAPS is the live rotation observed by scrapers/map_pool.py.
    # It widens the allowlist and never narrows it — see the note on that set.
    if allowed_maps is not None and map_name not in allowed_maps and map_name not in EXTRA_RANKED_MAPS:
        return battle_tags, None, battle_players

    record = {
        "map": map_name,
        "mode": mode_name,
        "rank_bracket": bracket,
        "winners": winners,
        "losers": losers,
        "patch": match_patch,
        "match_hash": None,
        # --- the rich half, used only by the player tracker ---
        "battle_time": battle_time,
        "result": 1 if result == "victory" else 0,
        "team_tags": [p.get("tag") for p in teams[player_team_idx] if p.get("tag")],
        "enemy_tags": [p.get("tag") for p in teams[1 - player_team_idx] if p.get("tag")],
        "team_brawlers": [p['brawler']['name'] for p in teams[player_team_idx] if p.get('brawler') and p['brawler'].get('name')],
        "enemy_brawlers": [p['brawler']['name'] for p in teams[1 - player_team_idx] if p.get('brawler') and p['brawler'].get('name')],
        "all_tags": battle_tags,
        # starPlayer is not guaranteed present on every payload shape, so this is
        # None (unknown) rather than False when the field is absent — the two mean
        # different things to a carry-rate metric built on it later.
        "is_star_player": (
            None if not isinstance(battle_data.get("starPlayer"), dict)
            else battle_data["starPlayer"].get("tag") == player_tag
        ),
    }
    record["match_hash"] = make_hash(record)
    return battle_tags, record, battle_players

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
    STATS.record_response(log_res)

    if log_res.status_code != 200:
        return []

    candidate_tags = []
    candidate_entries = []
    candidate_players = []
    battles = log_res.json().get("items", [])
    for match in battles:
        battle_tags, record, battle_players = parse_battle(match, player_tag, bracket)
        candidate_players.extend(battle_players)
        # Frontier tags are taken even when the battle is later rejected (closed
        # patch, unlisted map, unreadable brawler). That is the pre-existing
        # behaviour and it matters: those players are still Masters-adjacent and
        # dropping them here would shrink the spider's reach.
        candidate_tags.extend(battle_tags)
        if record is None:
            continue
        # Project the rich record down to the brawler-only shape this pipeline
        # has always stored. push_matches reads exactly these keys.
        candidate_entries.append({
            "map": record["map"],
            "mode": record["mode"],
            "rank_bracket": record["rank_bracket"],
            "winners": record["winners"],
            "losers": record["losers"],
            "patch": record["patch"],
            "match_hash": record["match_hash"],
            # Consumed by merge() and removed there — never reaches push_matches.
            "identity": f"{record['battle_time']}|{','.join(sorted(battle_tags))}",
        })
        # Measurement only — never stored, never deduped on; it exists so
        # RunStats can see how many distinct real games a composition key absorbs.
        STATS.record_battle(record["match_hash"], record["battle_time"], battle_tags)

    # All shared-state reads/writes happen here under lock, in one short critical
    # section, rather than scattered through the parsing above. seen_hashes only
    # dedupes within this run — cross-run dedupe happens in the database via
    # the match_hash primary key + ignore-duplicates on insert.
    def merge():
        # Written here rather than in the parse loop because this is the one
        # place already holding the lock; the spider runs threaded.
        for pl in candidate_players:
            SEEN_PLAYERS[pl["tag"]] = pl["name"]
        new_player_tags = [t for t in candidate_tags if t not in seen_tags]
        for entry in candidate_entries:
            identity = entry.pop("identity", None)
            # Same round, another player's battlelog — already counted.
            if identity is not None:
                if identity in SEEN_IDENTITIES:
                    continue
                SEEN_IDENTITIES.add(identity)
            h = entry["match_hash"]
            HASH_COUNTS[h] = HASH_COUNTS.get(h, 0) + 1
            if h not in seen_hashes:
                extracted_data.append(entry)
                seen_hashes.add(h)
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
    STATS.report(bracket)

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
            # Rounds this composition actually won, this run. Accumulates across
            # runs DB-side, so a comp re-seen next week adds rather than resets.
            "times_seen": min(32767, HASH_COUNTS.get(e["match_hash"], 1)),
        })

    # Insert in batches — a single request with tens of thousands of rows can
    # exceed Supabase's statement timeout (57014) and roll back with zero rows
    # written, even though the whole run otherwise succeeded.
    total_rounds = sum(r["times_seen"] for r in rows)
    print(f"Connecting to Supabase... pushing {len(rows)} compositions "
          f"({total_rounds} rounds) in batches of {INSERT_BATCH_SIZE}")
    # An RPC, not a plain upsert: PostgREST can only ignore or overwrite on
    # conflict, and times_seen has to ADD — a composition re-seen on a later run
    # was genuinely played again.
    url = f"{SUPABASE_URL}/rest/v1/rpc/upsert_ranked_matches"
    headers = SUPABASE_HEADERS
    inserted = 0
    attempted = 0
    for i in range(0, len(rows), INSERT_BATCH_SIZE):
        if i > 0:
            time.sleep(DB_BATCH_DELAY)  # breathe between batches — don't overload Supabase
        batch = rows[i:i + INSERT_BATCH_SIZE]
        res = requests.post(url, json={"rows": batch}, headers=headers)
        if res.status_code in (200, 201):
            # The RPC returns how many rows were genuinely NEW; the rest were
            # existing compositions whose counts it incremented.
            #
            # Parsed defensively. PostgREST returns a scalar function's value
            # bare, but this is the single path every collected match travels
            # through — a shape surprise here must degrade the COUNT, never kill
            # a run that has already written its rows.
            try:
                payload = res.json()
                if isinstance(payload, list):
                    payload = (payload[0] or {}).get("upsert_ranked_matches", 0) if payload else 0
                elif isinstance(payload, dict):
                    payload = payload.get("upsert_ranked_matches", 0)
                new_rows = int(payload)
            except Exception as e:
                print(f"  (could not read the RPC's new-row count: {e}; rows were still written)")
                new_rows = 0
            inserted += new_rows
            attempted += len(batch)
            print(f"  Batch {i // INSERT_BATCH_SIZE + 1}: {new_rows}/{len(batch)} new ({attempted}/{len(rows)} processed)")
        else:
            print(f"❌ Failed to save batch starting at {i}: {res.status_code} {res.text}")
            print(f"⚠️ Stopping insert — {inserted} new matches were saved before the failure.")
            break

    touched_patches = {e["patch"] for e in extracted_data} - CLOSED_PATCHES
    merged = len(rows) - inserted if attempted == len(rows) else '?'
    print(f"✅ Done. {inserted} new compositions stored; {merged} already known "
          f"(their round counts were incremented). {total_rounds} rounds represented.")
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
