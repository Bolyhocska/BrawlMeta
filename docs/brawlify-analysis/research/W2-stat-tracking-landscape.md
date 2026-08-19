# W2 — Player Stat Tracking: Data Substrate, Competition, Limits

STATUS: in progress
Research date: 2026-08-19
Target: implementation plan for brawl-meta.vercel.app

Legend: **[V]** = VERIFIED (read from a fetched page/doc this session) · **[I]** = INFERRED (reasoned from evidence, not directly stated)

---

## Research constraint note

`developer.brawlstars.com` and `brawlstats.readthedocs.io` are **blocked by this sandbox's egress proxy** (EGRESS_BLOCKED), so the official portal could not be read directly this session. Everything about the official API below is reconstructed from (a) **our own production code, which calls the live API every day** — the strongest evidence available, and (b) community wrapper documentation that mirrors the schema. Items sourced only from wrappers are marked [I] where the wrapper may be mixing in Brawlify's unofficial API.

---

# PART 1 — The official Supercell Brawl Stars API

## 1.1 Base facts

| Fact | Value | Source |
|---|---|---|
| Base URL | `https://api.brawlstars.com/v1` | **[V]** `scrapers/common.py:40`, `api/player.js` (both live in production) |
| Auth | `Authorization: Bearer <JWT>` header | **[V]** `api/player.js` |
| Key issuance | developer.brawlstars.com account → create key → **key is bound to a fixed list of allowed source IPs** | **[V]** by behaviour: this repo routes *every* call — scrapers and serverless alike — through a Webshare **static-IP** proxy (`PROXIES` in `common.py`, `ProxyAgent` in `api/player.js`) precisely because Vercel/GitHub-Actions egress IPs are dynamic. That architecture only exists because of IP allowlisting. |
| Community proxy | `https://bsproxy.royaleapi.dev/v1` — RoyaleAPI runs a fixed-IP relay so devs on dynamic-IP hosts can allowlist RoyaleAPI's IP instead of their own | **[V]** https://github.com/mlieshoff/brawljars (documents both base URLs) |
| Tag encoding | `#` MUST be percent-encoded as `%23` in the path | **[V]** `common.py:245` `player_tag.replace("#","%23")`, `api/player.js` `players/%23${tag}` |
| Pagination | `limit`, `after`, `before` on list endpoints (rankings, club members, brawlers) | **[V]** https://github.com/mlieshoff/brawljars |
| Caching | Supercell returns `cache-control` headers; wrappers cache until `max-age` | **[I]** https://brawlapi.com/ and wrapper docs describe honouring Supercell's `cache-control`; exact max-age per endpoint not verified this session |

## 1.2 Endpoint-by-endpoint

### `GET /players/{tag}` — **[V] against live production output** (`api/player.js` reads all of these)
```
tag, name, nameColor, icon{id},
trophies, highestTrophies,
highestPowerPlayPoints,             (legacy, dead mode)
expLevel, expPoints,
isQualifiedFromChampionshipChallenge,
"3vs3Victories", soloVictories, duoVictories,
bestRoboRumbleTime, bestTimeAsBigBrawler,
club{tag, name},
brawlers[ { id, name, power, rank, trophies, highestTrophies,
            gears[{id,name}], starPowers[{id,name}], gadgets[{id,name}] } ]
```
Note the JSON key `"3vs3Victories"` starts with a digit — needs bracket access in JS/Python. **[V]** `api/player.js:56`.

**What is NOT in the player object — this is the whole product opportunity:**
- **No ranked data at all.** No current Ranked tier (Bronze→Masters), no ranked wins/losses, no ranked season history, no peak rank. The single most-wanted stat in competitive Brawl Stars is simply absent from `/players`. **[V]** — our own `api/player.js` maps the *entire* useful surface of the payload and there is no ranked field; our ranked bracket labels are derived from *seed lists* (`masters_players`, `diamond_mythic_players`) scraped off third-party sites, not from the API.
- **No per-brawler win/loss counters.** `brawlers[]` carries trophies/power/rank/gear only. There is no `wins`, `losses`, `matches`, or per-mode split. Trophy count is a *reward* signal, not a win-rate signal.
- **No mastery data.** Brawler Mastery points/tiers (in-game since 2023) are not exposed.
- **No historical anything.** The object is a pure snapshot. No trophy history, no rank history, no date of any record. `highestTrophies` is the only memory the API has, and it is a scalar with no timestamp.
- **No account age / creation date, no last-online timestamp.**
- **No per-mode victory splits** beyond the three legacy counters (3v3 / solo / duo) which lump every mode and every era together since account creation.
- **No friends list, no recent teammates, no club history.**

### `GET /players/{tag}/battlelog` — **[V] against live production parsing** (`common.py:227-330`)
```
{ items: [ {
    battleTime,                       # "20260819T134500.000Z"
    event: { id, mode, map },         # map can be null/absent on friendlies
    battle: {
      mode,                           # duplicated here; we read battle.mode
      type,                           # "ranked" | "soloRanked" | "teamRanked" |
                                      # "friendly" | "challenge" | ...
      result,                         # "victory"|"defeat"|"draw"  (3v3 only)
      rank,                           # showdown only, instead of result
      duration,
      trophyChange,                   # ABSENT on competitive Ranked  [V]
      starPlayer: { tag, name, brawler{id,name,power,trophies} },
      teams: [ [ {tag,name,brawler{id,name,power,trophies}} x3 ] x2 ],
      players: [...]                  # solo modes use players[] not teams[]
    } } ] }
```
**Verified gotchas from our own production code (these cost us real bugs):**
- **`type:"ranked"` is TROPHY ladder, not Ranked.** Competitive Ranked reports `soloRanked` / `teamRanked`. Our filter is `"ranked" in type and type != "ranked"`. **[V]** `common.py:265`.
- **Competitive Ranked battles never carry `trophyChange`;** we use its presence as a hard exclusion guard. **[V]** `common.py:270`.
- **Mode-name collisions across formats:** 5v5 events reuse mode names, so team-shape must be validated (`len(teams)==2 and all(len(t)==3)`). **[V]** `common.py:281`.
- **`event.map` can be missing** → we default to `"Unknown Map"`. **[V]** `common.py:302`.
- **Battle `type` is not stored by us historically** and pre-2026-07-16 rows can't be purged of trophy pollution — a reminder that *the API gives you no way to re-derive what you didn't store*. **[V]** `CLAUDE.md`.
- **429s silently return non-200 and drop the whole battlelog** — no partial results. We insert `REQUEST_DELAY` per request and cap `CONCURRENCY=8`. **[V]** `common.py:129,242`.

**The hard limit that defines the entire market: the battlelog returns only the ~25 most recent battles**, and there is no `before`/`after` paging into history. **[V]** multiple independent wrapper docs (https://github.com/Nick-Gabe/brawlstars-api/blob/main/docs.md — "25 most recent battles"; https://brawlify.com/player/VVG0Y9LG/battles). Consequences:
- A player who plays 60 games in an evening loses ~35 of them permanently unless someone polled mid-session.
- Retention is by **count, not time**: a dormant player's 25 battles may be months old; a grinder's 25 may be 40 minutes old.
- Therefore **history is a scraping asset, not a fetch.** Whoever polls first and stores wins; the data is non-recoverable afterwards. This is exactly the moat BrawlMeta already has 1.5M rows of.

### `GET /clubs/{tag}` and `GET /clubs/{tag}/members` — **[I]** (wrapper-documented, not exercised by our code)
```
/clubs/{tag}:     tag, name, description, type, badgeId, requiredTrophies,
                  trophies, members[{tag,name,nameColor,role,trophies,icon{id}}]
/clubs/{tag}/members: same member objects, supports limit/after/before
```
Missing: club trophy history, member join dates, club war/league record, per-member contribution. **[I]**
Source: https://github.com/Nick-Gabe/brawlstars-api/blob/main/docs.md

### `GET /rankings/{country}/players`, `/rankings/{country}/brawlers/{id}`, `/rankings/{country}/clubs` — **[I]**
```
players / brawlers:  [{tag,name,nameColor,icon{id},trophies,rank,club{name}}]
clubs:               [{tag,name,badgeId,trophies,rank,memberCount}]
```
`{country}` is a 2-letter ISO code or `global`; `limit` supported (top 200 max is the practical ceiling — our `leaderboard.py` scrapes "top-200"). **[V]** repo: `scrapers/leaderboard.py` named "top-200 + event rotation".
**Rankings are TROPHY rankings only.** There is no ranked-ladder leaderboard endpoint, which is why competitive sites (brawlace, brawlytix) build Masters player lists by their own means and why our masters scraper seeds from *scraped HTML*, not the API. **[V]** `CLAUDE.md` architecture map.

### `GET /brawlers` / `GET /brawlers/{id}` — **[I]**
Official version returns id, name, starPowers[], gadgets[]. (The rich version with `imageUrl`, `class`, `rarity`, `description` documented in some wrappers is **Brawlify's** unofficial API, not Supercell's — do not confuse them.) **[I]**

### `GET /events/rotation` — **[V]** endpoint exists (brawljars `findEventRotation`); returns active slot list with startTime/endTime/map/mode/modifiers. Our `leaderboard.py` consumes "event rotation". **[V]** `CLAUDE.md`.
Missing: **no Ranked map rotation endpoint.** Ranked maps must be hardcoded — which is exactly what `RANKED_MAPS` in `scrapers/common.py` is. **[V]** repo.

