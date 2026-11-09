# What data we can actually get, and what we could do with it

**Measured 2026-11-05** by `scrapers/probe_api_schema.py` against the live API
(run it again any time: Actions → "Probe — Supercell API schema"). Every field
list below is observed, not remembered. Where a number is a sample size it was
queried the same day.

---

## 0. Read this first: the binding constraint

| | |
|---|---|
| database size | **599 MB** against a **500 MB** free tier — already over |
| `player_matches` rows at the 1000-row cap | **53 players**, 100 more above 900 |
| `meta_daily` | **54 MB / 201,164 rows**, up from 18 MB on 09-26 |

Two things follow, and they govern everything else in this document:

1. **We are already deleting player history.** `prune_player_matches` caps at
   1,000 rows per player, oldest first. 53 players have hit it, so their early
   history is gone and more cross that line every week. The projection made on
   09-27 was "the fastest 10% in 1.2 months"; it arrived on schedule.
2. **`meta_daily` grows unbounded while a patch is open.** `prune_meta_daily`
   only clears CLOSED patches, and 69.230 has been open 66 days at ~2,900
   rows/day. It self-clears at the next rollover, but the peak is ~55 MB and we
   are sitting on it.

**No new collection should ship before this is resolved**, because every
proposal below adds rows to a database that is over its limit today.

---

## 1. What the API returns — complete, measured

### 1.1 `GET /v1/players/{tag}/battlelog` — 18 fields, last ~25 battles

```
battleTime                                     str   "20261104T221517.000Z"
event.id                                       int   15000440
event.mode                                     str   "knockout"
event.modeId                                   int   20
event.map                                      str   "Flaring Phoenix"
battle.mode                                    str   "knockout"
battle.type                                    str   "soloRanked"
battle.result                                  str   "victory"
battle.duration                                int   129          (seconds)
battle.starPlayer.{tag,name}                   str
battle.starPlayer.brawler.{id,name,power,trophies}
battle.teams[2][3].{tag,name}                  str
battle.teams[2][3].brawler.{id,name,power,trophies}
```

**That is all of it.** No damage, no healing, no kills, no objective time, no
per-player anything beyond which brawler they used and its power/trophies. The
in-game end-of-match scoreboard is computed by the game server and sent to the
client over its own protocol; none of it reaches the public API.

**There is no way to ask for more.** The API has no `?fields=`, no `?include=`,
no verbosity parameter and no paid tier. Each endpoint returns one fixed shape.

Note `trophyChange` is absent on Ranked battles — it appears only on trophy
ladder games, which is exactly what the 2026-07-19 collection guard relies on.

### 1.2 `GET /v1/players/{tag}` — 44 fields

Account totals:
```
tag, name, trophies, highestTrophies, expLevel, expPoints
3vs3Victories, soloVictories, duoVictories
bestRoboRumbleTime, bestTimeAsBigBrawler
club.{tag,name}, icon.id
isQualifiedFromChampionshipChallenge
fame, fameTierName                 e.g. 55685, "SOLAR FAME I"
totalPrestigeLevel
```

**Ranked (the find — see §3):**
```
rankedElo                     5949
rankedRank                    15
rankedRankName                "MYTHIC III"
rankedSeasonId                50
highestSeasonRankedElo        5949
highestSeasonRankedRank       15
highestSeasonRankedRankName   "MYTHIC III"
highestAllTimeRankedElo       6701
highestAllTimeRankedRank      16
highestAllTimeRankedRankName  "LEGENDARY I"
```

Per brawler, for all ~110 owned:
```
brawlers[].{id, name, power, rank, trophies, highestTrophies}
brawlers[].{prestigeLevel, currentWinStreak, maxWinStreak}
brawlers[].buffies.{gadget, hyperCharge, starPower}      bool each
brawlers[].gadgets[].{id,name}
brawlers[].starPowers[].{id,name}
brawlers[].hyperCharges[].{id,name}
brawlers[].gears[].{id,name,level}
brawlers[].skin.{id,name}
```

### 1.3 Other endpoints this codebase calls

| endpoint | contents | used for |
|---|---|---|
| `/rankings/global/players?limit=200` | top 200 by trophies | leaderboard, spider seeds |
| `/brawlers` | static brawler/gadget/star-power list | metadata refresh |
| `/events/rotation` | live event slots | map rotation |

Not probed in detail; none can carry per-match performance.

---

## 2. What we keep today, and what we throw away

### 2.1 From the battlelog — we use 13 of 18 fields

| field | stored? | where |
|---|---|---|
| `battleTime` | yes | `player_matches.battle_time` |
| `event.map`, `event.mode` | yes | `map_id` (maps carries mode) |
| `battle.type`, `.mode` | used as filters, not stored | |
| `battle.result` | yes | `result` |
| `starPlayer.tag` | yes, as a boolean | `is_star_player` |
| `teams[].tag` | yes | `team_tags`, `enemy_tags` |
| `teams[].brawler.name` | yes | `brawler_id`, `team_brawlers`, `enemy_brawlers` |
| **`battle.duration`** | **NO** | — |
| **`teams[].brawler.power`** | **NO** | — |
| **`teams[].brawler.trophies`** | **NO** | — |
| **`event.modeId`** | **NO** | redundant with mode |
| `brawler.id` | resolved to our own id | |

### 2.2 From `/players/{tag}` — we keep 9 of 44

`player_snapshots` stores: `trophies, highest_trophies, exp_level,
victories_3v3, solo_victories, duo_victories, brawlers_owned, club_tag,
brawler_trophies`.

**Everything else is fetched daily and discarded**, including all ten ranked
fields, `fame`, `prestigeLevel`, win streaks, gears, buffies and skins.

---

## 3. The single biggest find: ranked Elo is available

CLAUDE.md says in several places that *"the API exposes no per-match rank
tier."* That remains true — a **battle** carries no tier, which is why
`seed_bracket` is a proximity guess and `resolveMatchBracket` exists.

But **the player's own rank is right there**, on a call we already make every
day, and we throw it away. This is not a new endpoint and costs **zero extra
API requests**.

What it unlocks:

- **Real rank on a profile.** "Mythic III · 5949 Elo" instead of inferring
  from which seed list someone came off.
- **An Elo curve.** `player_snapshots` already runs daily; six integers per row
  gives a climb graph that is genuinely the player's competitive progress,
  unlike the trophy curve which is a ladder stat.
- **Season vs all-time peak.** `highestSeasonRankedElo` vs
  `highestAllTimeRankedElo` — "best this season" and "best ever" for free.
- **An honest percentile cohort.** §"The percentile cohort" in CLAUDE.md
  apologises for comparing against "Masters-ish by proximity". With Elo we can
  state the actual distribution of who someone is being compared to.
- **A measurement of how wrong `seed_bracket` is.** For the first time the
  proximity approximation can be checked rather than caveated.

**Cost:** 6 integer columns + 3 short text on `player_snapshots`. At ~860
rows/day that is well under 1 MB/month. The cheapest high-value thing available.

**Caveat:** it is the rank *at snapshot time*, not at match time. A game played
three weeks ago was played at a different Elo. For labelling a MATCH it is
still an approximation — a better one than `seed_bracket`, but an
approximation. Do not present it as per-match truth.

---

## 4. Everything we could offer, by source

Verdicts use the sample measured 2026-11-05: 1,438 tracked players, 417,712
rounds, median **249 rounds (~107 series)** per player, 678 players ≥200 rounds.

### 4.1 Free — fields we already fetch and discard

| data point | source | verdict |
|---|---|---|
| Ranked Elo + rank name | `/players` | **Build.** Zero extra calls, tiny storage |
| Elo progression curve | `player_snapshots` + Elo | **Build.** Same row, 6 ints |
| Season / all-time peak Elo | `/players` | **Build.** Two more ints |
| Match duration stats | `battle.duration` | **Build.** 1 smallint on `player_matches`; enables "your games run 18s longer than average", a genuine playstyle signal |
| Brawler power level in match | `teams[].brawler.power` | **Build, engine-relevant.** First per-match strength input the draft model has never had — a power-9 vs maxed brawler is a real edge currently treated as identical |
| Win streaks per brawler | `/players` brawlers[] | Cheap, low value — it is a ladder stat |
| Fame / prestige | `/players` | Cosmetic. Skip unless a profile needs flavour |
| Gears / buffies / hypercharge owned | `/players` brawlers[] | **Interesting for the Upgrade Advisor** — it currently recommends without knowing what you own |

### 4.2 Derivable from data we already store

| data point | how | verdict |
|---|---|---|
| Per-map win rate per patch + all-time | `player_matches.patch_id` | **Already designed** — see the `player_patch_stats` rollup discussed 09-27. One row per player per patch, jsonb of maps, ~5 MB/year |
| Teammate/party analysis | `team_tags` recurrence | Shipped (`partyBreakdown`) |
| Time-of-day / session / tilt | `battle_time` | Shipped |
| Opponent strength | enemy tags → their Elo | **New and good.** With §3 we could finally say "you beat players averaging 6100 Elo" — strength of schedule, which nothing on the market offers |
| Star-player rate | `is_star_player` | Shipped |
| Brawler × mode | stored | Shipped |
| Brawler × map | stored | **Refused deliberately** — best cell in the DB is 9 series |

### 4.3 Not possible

| | why |
|---|---|
| Damage dealt, healing, kills, objective time | Not in the API. Client-side only. No parameter, no tier, no workaround |
| ~~Per-match rank tier~~ | **WRONG — corrected 2026-11-09.** It IS in the API: in Ranked battles `brawler.trophies` holds each player's rank at match time (19–21 Masters, 22 Pro). The masters spider now filters on it. |
| Draft order / ban data | Not in the API — this is why `firstPickSafety`, `counterability` and `banStrategy` stay priors forever |
| Accurate match-time Elo | Only snapshot-time Elo exists |
| Anything below Diamond in Ranked | `SPIDER_DEPTH = 2` from Masters seeds — such players never enter the graph |

---

## 5. Recommended order

1. **Fix storage first.** Nothing below ships until the 599 MB is under 500.
   The levers, cheapest first: close 69.230 at the next rollover (frees ~54 MB
   of `meta_daily` automatically), `REINDEX` the 70 MB `ranked_matches_pkey`
   (~25 MB of bloat from 4.65M lifetime deletes), lower `per_player_cap`.
2. **Ranked Elo capture.** 9 columns, zero extra API calls, and the data only
   accumulates forward — every day of delay is a day of Elo history that can
   never be recovered.
3. **`player_patch_stats` rollup.** Decouples per-map history from
   `player_matches` retention, which is actively deleting it today, and lets
   `per_player_cap` come DOWN rather than up.
4. **`battle.duration` + `brawler.power`** on `player_matches`. 2 smallints.
   Power is the one with engine upside.
5. **Strength of schedule**, once Elo exists for enough opponents.

## 6. How to re-check any of this

```
Actions → "Probe — Supercell API schema" → Run workflow
```

Two API calls, writes nothing. The report ends with a **"NOT consumed"** line
listing every field the API returns that `parse_battle` ignores — so a field
Supercell adds later surfaces on its own rather than needing to be noticed.
Keep `CONSUMED_KEYS` in that script in sync with `parse_battle` or it will lie.
