# W2 — Player Stat Tracking: Data Substrate, Competition, Limits

STATUS: complete
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


## 1.3 THE CENTRAL QUESTION — what can be COMPUTED but not READ

The API is a **snapshot service with a 25-battle rolling buffer**. Everything below is *derivable only by polling over time and storing your own history*. Nothing in this list can be fetched. This is the entire product surface.

### Tier A — derivable from battlelog polling alone (highest value, hardest for a newcomer to bootstrap)
1. **Win rate per brawler** — overall, per mode, per map, per ranked bracket. The API has zero win/loss counters; every WR on every Brawl Stars site is a derived statistic from stitched battlelogs.
2. **Win rate per map per brawler for a SPECIFIC PLAYER** (vs. the global aggregate BrawlMeta already computes). "You are 31% with Piper on Hideout while the global is 52%" is a coaching product nobody ships.
3. **Personal matchup table** — WR when a given enemy brawler was on the other team; WR with a given teammate brawler. The global versions exist in our `vs_brawler`/`with_brawler` jsonb; the *personal* version does not exist anywhere.
4. **Teammate synergy / "recently played with"** — who you queue with, W-L per teammate tag, which duo partner is dragging your rank. Trivially derivable from `teams[].tag`, exposed by nobody.
5. **Session detection** — cluster `battleTime` into sessions; produce session length, games/session, WR by session position (game 1 vs game 9) → **tilt detection** and "stop playing" alerts. Requires only timestamps.
6. **Streak / tilt analytics** — current streak, longest streak, WR after a loss vs after a win, WR by hour-of-day and day-of-week. Pure history math.
7. **Ranked progression curve** — because the API exposes no rank, rank must be *inferred* from where a player's opponents sit (our whole bracket model) or from opt-in user input. A per-player "estimated ranked Elo/MMR" is computable and is the single most demanded missing number.
8. **Playtime / games-per-day, activity heatmap, retention** — derived from battle counts over time.
9. **Draft-outcome attribution**: which comps a player wins with, first-pick vs counter-pick performance. We already own the draft engine; the join to personal history is unique to us.
10. **Star Player rate** (`battle.starPlayer.tag == player tag`) — a per-player "carry rate". Present in the payload, aggregated by essentially no one.
11. **Brawler-level performance vs. that brawler's global baseline → "your best/worst brawlers" percentile**, i.e. mastery-like ranking that is skill-based rather than grind-based.

### Tier B — derivable from `/players` polling (snapshot diffing)
12. **Trophy delta over time** — daily/weekly/seasonal trophy gain, per-brawler trophy curve, push-rate. Requires storing a daily snapshot; the API's `highestTrophies` is the only built-in memory and is undated.
13. **Season recap / end-of-season projections** — trophy road, expected reset, "you need X for the next tier".
14. **Progression tracking** — power-level upgrades, gadget/star-power/gear unlocks over time, account "maxedness" curve, time-to-max projection.
15. **Peak-rank and record history with dates** (the API's records have no timestamps).
16. **Club membership history / roster churn**, member trophy contribution per week (club endpoints are snapshots too).
17. **Name-change history** (tags are stable, names are not) — an anti-impersonation asset that is directly relevant to our tournament product.

### Tier C — things the API will never give you at all
18. **Ranked tier, ranked W/L, ranked season history** — absent from `/players`. Only inferable.
19. **Mastery points/tiers** — absent.
20. **Damage, healing, objective stats per match** — absent; only `starPlayer` hints at it.
21. **Match-level events (kills, deaths, gem counts, ball touches)** — absent. Brawl Stars has no post-match box score in its API, unlike Dota/LoL. This caps how deep any "match detail page" can go and is the structural reason Brawl Stars trackers are shallower than op.gg/dotabuff.
22. **Anything about a battle older than the 25-battle buffer that you did not personally capture.**

**Strategic consequence:** in this game, *stored history is the only defensible asset*, and its value compounds. BrawlMeta already holds 1.5M ranked matches with `collected_at`. The missing move is **pivoting that store from brawler-centric to player-centric**: today `ranked_matches` stores only brawler names per side (`w1-w3`, `l1-l3`), **not player tags** — so none of Tier A #2–#10 is currently computable from our own archive. That schema decision is the single biggest blocker to a player-stats product and should be the first item in the implementation plan.

### 1.4 Two schema facts in OUR archive that block the player-stats product (both **[V]** from repo source)

1. **`ranked_matches` stores no player identity and no battle time.** The insert payload is exactly `{match_hash, map_id, bracket_id, patch_id, w1..w3, l1..l3}` (`scrapers/common.py:416-423`), where `w*/l*` are **brawler** FKs. Player tags harvested from `teams[].tag` are used only to expand the spider frontier (`candidate_tags`) and are then discarded. `battleTime` is used only to pick a patch and then discarded. → Not one of Tier A #2–#10 is computable from the 1.5M rows we already own; they would need a **new, parallel player-match table** built from today forward.
2. **The dedupe hash is composition-based, not identity-based.** `make_hash` = md5 of `map + mode + bracket + sorted(winner brawlers) + sorted(loser brawlers)` — **no timestamp, no player tags** (`scrapers/common.py:218-222`). Combined with the DB-side `on_conflict=match_hash&ignore-duplicates`, **two genuinely different games with the same 6 brawlers on the same map in the same bracket collapse into one stored row, forever.** This is intentional for cross-run dedupe, but it means: (a) popular/meta comps are systematically *under*-counted relative to rare comps, biasing pick-rate and win-rate downward for exactly the comps that matter most; (b) the archive can never be re-keyed to per-player granularity retroactively. Any player-stat table must use a different key (e.g. `battleTime + sorted player tags`).

*(Flagging, not fixing — this is a research doc. But it belongs at the top of the implementation plan.)*

---

# PART 3 — Legal / ToS / feasibility  *(placed early: it constrains the whole plan)*

## 3.1 Supercell Fan Content Policy — the monetization clause

> "You are **not permitted to charge a fee of any kind** (including in-app functionalities) from customers or visitors to your Fan Content, unless this has expressly been approved by Supercell." The **three exceptions** are monetization "through **ads**, by **donations** or by **coaching**." **[V]** https://supercell.com/en/fan-content-policy/ (page itself is egress-blocked in this sandbox; wording retrieved verbatim via search index of that URL and corroborated by the Supercell Zendesk mirror https://z3n6487.zendesk.com/hc/en-us/articles/360007467518-Fan-content-Policy)

Additional verified clauses:
- Donations "must be purely donations in nature and **not tied to any special features, IAPs or other benefits of any kind**." **[V]** same source. → A "supporter tier that unlocks features" is *not* a donation under this policy.
- "You can't register domain names, social media accounts or related addresses for your Fan Content which include Supercell's trademarks (such as SUPERCELL or our game names) without a separate written agreement." **[V]** same source. → "Brawl Stars" is the trademark; `brawl-meta.vercel.app` uses "brawl" alone on a third-party subdomain. Competitors (brawlify.com, brawlace.com, brawlytix.com, brawltime.ninja) all do the same and have survived for years, so enforcement is evidently lenient here — but this is **tolerance, not permission**. **[I]**
- Ads must comply with applicable laws/regulations/developer policies. **[V]**
- Permitted fan content explicitly includes "**non-commercial** fan-generated online guides and guide apps, fan meetups, fan pages". **[V]** — note the word *non-commercial*.
- Required posture: you may not "create the impression that Supercell is a sponsor or creator of or otherwise endorses your Fan Content." Standard disclaimer used by every major site (e.g. Brawlify: "not affiliated with, endorsed, sponsored, or specifically approved by Supercell"). **[V]** https://brawlify.com/about

## 3.2 Supercell Tournament Guidelines — directly on point for our tournament product

> "**All tournaments must be free to enter for the players — no exceptions, including things like membership fees or season passes.**" **[V]** https://supercell.com/en/tournament-guidelines/
- Live events may charge **spectators** a venue fee, but must **refund it to anyone who chooses to compete**. **[V]**
- "You are responsible for providing all prizes for your event." **[V]**
- "Your event cannot involve **gambling, paid raffles, or fantasy sports betting**." **[V]**
- Cannot promote other game companies/platforms, alcohol, tobacco, drugs, pornography, weapons, **cryptocurrency, blockchain**, betting or gambling. **[V]**
- Cannot register trademarks/domains/social accounts "confusingly similar to Supercell's trademarks" without written agreement. **[V]**

## 3.3 What this means for BrawlMeta's monetization — honest assessment

| Our model | Verdict |
|---|---|
| **Players never pay** (core principle) | **Fully compliant, and required** — the Tournament Guidelines mandate it independently of our own principle. This is the one part of the plan that is unambiguously safe. **[V]** |
| **Ads** | Explicitly permitted. Currently the *only* named-safe revenue line. **[V]** |
| **Donations** | Permitted, but must carry **zero** attached benefits — so no "supporter perks", no ad-free tier, no badge. **[V]** |
| **Coaching** | Explicitly permitted, and interesting: a *stats-driven coaching* product (paid human coaching, with our analytics as the tool) sits inside a named exception. **[I]** that our analytics-as-coaching-aid counts, but the exception is written broadly. |
| **Premium subscription for organizers/orgs** | **This is the exposed flank.** The Fan Content Policy bars charging "a fee of any kind ... from customers or visitors to your Fan Content" with only three exceptions, and a B2B SaaS subscription is none of them. An organizer is a *visitor to our fan content*. **[I]** — no source states organizers are exempt, and none states they are covered; the policy simply doesn't contemplate B2B. |
| **Organizer fees per tournament** | **Highest risk.** "Free to enter for the players" is satisfied, but if an organizer's fee is funded by, or amounts to, monetizing a Supercell-game tournament, it is a fee charged in connection with fan content. **[I]** |
| **Real-money prizes** | Allowed in principle (you provide prizes) but *you* are liable for them, no gambling/raffle mechanics, and our own note about verifying tag ownership before real-money prizes is the right instinct. **[V]** for the guidelines; **[I]** for the risk framing. |

**Mitigations worth putting in the plan (all [I]):**
1. **Ask Supercell.** The policy's escape hatch is literally "unless this has expressly been approved by Supercell." A written approval request for a paid organizer tier costs nothing and is the only way to make the subscription line durable. RoyaleAPI and Brawlify operate under closer relationships with Supercell (Brawlify holds a **Creator Code**, i.e. a formal Supercell creator relationship) — that is the precedent to imitate. **[V]** creator-code fact: https://brawlify.com/about
2. **Structure premium as ads-removal-free.** Any tier must not read as "pay to unlock game-data features."
3. **Never gate a player-facing stat behind payment** — already our principle; the policy independently backs it.
4. **Keep prize handling off-platform** until a business entity + explicit approval exist (already the plan's stance).

## 3.4 Unofficial-API terms (Brawlify / BrawlAPI)
- Brawlify's data API is `api.brawlapi.com` (formerly `api.starlist.pro`; `api.brawlify.com` 301-redirects `/v1/*` and `/game*` to it). Assets live on `cdn.brawlify.com` / `cdn-misc.brawlify.com`. **[V]** https://brawlapi.com/ (via search index; domain egress-blocked here)
- **No published rate limit or commercial-use licence was locatable this session.** Treat it as goodwill-only: fine for brawler portraits and map images with attribution, **not** something to build a paid feature on. **[I]**
- starlist.pro **is** brawlify.com (renamed). Treating them as two competitors would be an error. **[V]** https://brawlstars.fandom.com/f/p/4400000000000058139 and the Google Play listing whose package id is still `pro.starlist.app`.

---

# PART 2 — Competitive landscape

## 2.0 The Ranked-Elo question (settled)

**Ranked tier / Elo is NOT in the official API.** Evidence:
- No wrapper library that documents the Player model exposes any ranked or Elo attribute — checked `SharpBit/brawlstats` models (https://raw.githubusercontent.com/SharpBit/brawlstats/master/brawlstats/models.py), `mlieshoff/brawljars`, `y9vad9/krawl`, `Nick-Gabe/brawlstars-api`. All five list the same six API families (players, players/battlelog, clubs, clubs/members, rankings×3, brawlers, events/rotation) and nothing ranked. **[V]**
- Our own architecture is the strongest proof: `scrapers/masters.py` seeds Masters players by **scraping brawlytix.com's server-rendered HTML** and brawlace behind Cloudflare, precisely because the API cannot tell you who is Masters. **[V]** `CLAUDE.md`.
- Yet **brawlytix, brawlace, brawltime.ninja and brawlcards all publish Ranked Elo leaderboards** (https://brawlytix.com/leaderboard/highest-ranked-elo, https://brawlace.com/leaderboards-ranked, https://ranked.brawlcards.com/). So they obtain it outside the public API — most plausibly by reading the in-game Ranked leaderboard through a non-public route, or by user-submitted/OCR data. **[I]** — none of them documents a source.

**Implication for us:** any "estimated MMR / ranked progression" feature we build must be **derived** (from opponent quality + our own match archive) or **user-declared**, and we should treat the competitors' Elo numbers as a dependency we do not control and cannot legally guarantee. Deriving it ourselves is *more* defensible, not less, and is the honest differentiator. **[I]**

## 2.1 Brawl Stars competitors

### Brawlify (brawlify.com) — formerly starlist.pro. The category leader.
- **Identity:** starlist.pro was renamed brawlify.com; same project, Android package id is still `pro.starlist.app`. Holds a **Supercell Creator Code**. **[V]** https://brawlify.com/about, https://brawlstars.fandom.com/f/p/4400000000000058139
- **What it stores historically:** genuinely does keep history — "trophy progression graphs", "endless history of battle logs", accumulated by "periodically checking profiles". Battle log is paginated **50 battles per page** with a per-page wins/losses/win-rate/trophy-change summary. **[V]** https://brawlify.com/stats, https://brawlify.com/player/VVG0Y9LG/battles
- **Freshness:** profiles/battle history/trophies/brawler progress **daily**; rankings **hourly**. **[V]** https://brawlify.com/stats
- **Runs its own data API:** `api.brawlapi.com` (was `api.starlist.pro`; `api.brawlify.com` 301s to it), plus `cdn.brawlify.com` assets — the de-facto community asset source. **[V]** https://brawlapi.com/, https://api-docs.starlist.pro/
- **Biggest weakness:** it is a **reference site, not an analytics site.** It shows you your battles; it does not *interpret* them. Daily-only profile refresh means an active player's 25-battle buffer overflows many times between polls, so the "endless history" is full of holes for exactly the heavy players who care. And there is no Ranked dimension at all — no bracket filtering, no map-level personal performance, no matchup analysis.

### Brawl Ace (brawlace.com)
- **Scope:** multi-game (Brawl Stars + Clash Royale + Clash of Clans). Player stats, battlelog history, **brawler trophy history**, global player/club/**ranked** rankings ("elo updated realtime"), daily meta with solo-pick and team-pick suggestions, events, brawler pages with tips/changelogs, end-of-season trophy calculator, **club + member trophy history**. **[V]** https://brawlace.com/, https://brawlace.com/leaderboards-ranked, https://brawlace.com/leaderboards-alltime
- **Historical store:** yes — brawler trophy history and club/member trophy history are diffed snapshots. **[V]**
- **Biggest weakness:** **Cloudflare JS-gated** (our own scraper needs `cloudscraper` + a proxy to read it — **[V]** `CLAUDE.md`), which signals a site defending its data rather than growing an audience; and the breadth-over-depth problem of a three-game site — nothing is deep. Meta advice is site-wide, not personalised.

### Brawlytix (brawlytix.com) — the most *analytical* of the incumbents
- **Player page:** trophies, **Ranked Elo**, **Skill Score**, battle log, progression, **Account Value**. **[V]** https://brawlytix.com/player/LGVY0QGP9, https://brawlytix.com/
- **Skill Score** = highest recorded Ranked Elo (dominant term) + estimated playtime from account XP (small adjustment). **[V]** https://brawlytix.com/about
- **Account Value** = gem-equivalent of power upgrades, gadgets, star powers, gears, Hypercharges, Fame, and estimated skin value. **[V]** same
- **Leaderboards** across progression, cosmetics, skill, match statistics and social metrics — trophies, wins, skins, icons, titles. **[V]** https://brawlytix.com/leaderboards
- **Compare tool:** two tags side by side (trophies, ranked, wins, brawlers, progression, records). **[V]** https://brawlytix.com/compare
- Claims to "gather data from thousands of players every day". **[V]** https://brawlytix.com/
- **Biggest weakness:** every headline metric is a **vanity/progression score, not a performance score.** "Account Value" measures spending; "Skill Score" is dominated by a single peak-Elo number. There is **no per-brawler-per-map win rate for the individual player, no matchup analysis, no session or trend analysis** — i.e. nothing that tells a player *how to get better*. It ranks accounts; it does not coach players. Also its top-200 page is plain server-rendered HTML with no auth (we scrape it daily — **[V]** `CLAUDE.md`), i.e. no defensible moat on the data itself.

### Brawl Time Ninja (brawltime.ninja)
- **Distinctive feature — the only real "rating" product in the space:** an **account grade S+ → D** combining three percentile scores: **skill** (best Ranked Elo), **progression** (hours played), **power** (how maxed the account is). **[V]** https://brawltime.ninja/
- Signature hook: **hours played** ("Brawl Time") computed from battle counts × mode durations. Win rate overall and per mode, battle log, leaderboard comparison, friend comparison, brawler win rates, star-power tier lists, **map tier lists** (best brawler per map/mode), a personality quiz. **[V]** https://brawltime.ninja/, https://brawltime.ninja/profile/PQQ99LGRL
- Open-source-ish and has a Chrome extension + Android app. **[V]** https://chrome-stats.com/d/xyz.schneefux.brawltimeninja
- **Biggest weakness:** the aggregate meta data is **trophy-mode-flavoured and bracket-blind** — it does not separate competitive Ranked from ladder, which is precisely the axis BrawlMeta's whole archive is built on. Its percentiles reward playtime and account maxing as much as skill, so a whale outranks a better player. UI is quirky/hobbyist and the site has repeatedly had uptime/monetisation strain.

### NOFF (noff.gg)
- Multi-game mobile-stats platform that added Brawl Stars. Profile = current stats + **graph of recent battle trophy progression** + battle log + brawler collection; **win rate and pick rate for your most-used brawlers derived from your own battles**; sortable brawler collection with maxing progress; "**stats history** to see how you've improved or declined"; global top-200 leaderboard updated **daily**; brawler pages; a **tier list built from top-200 players' battles**, updated daily. **[V]** https://www.noff.gg/brawl-stars/stats, https://www.noff.gg/brawl-stars/leaderboards, https://www.noff.gg/news/brawl-stars-is-now-on-noff
- **Notable:** NOFF is the closest anyone gets to *personal* win/pick rate — but only over "your most recent Brawlers", i.e. the shallow buffer.
- **Biggest weakness:** thin sample. Personal win rates computed off a rolling recent window are statistically meaningless (25–100 games spread over 20 brawlers), and the site presents them without confidence framing. Meta tier list is built from top-200 **trophy** players, who are not the competitive population.

### Smaller / newer entrants (all **[V]** as existing, feature detail **[I]**)
- **BrawlCards Ranked** — https://ranked.brawlcards.com/ — "Track your Ranked journey": Elo history, ranked matches, season stats, and player comparison. **The most direct competitor to a ranked-progression feature.** Single-purpose, so likely to do that one thing better than the generalists.
- **Brawl Tracker** — https://brawltracker.com/ — stats, leaderboards, and **custom shareable profile images/cards**. The only one leaning on the shareable-card pattern.
- **brawltrack.app** — https://brawltrack.app/ — "player stats, meta and analytics".
- **BrawlVision** — https://brawlvision.com/en/battle-history — battle history + gem calculator.
- **brawl.one**, **igitems tracker**, **brawlytics.pro** — thin SEO-driven trackers; account snapshot + battle log, no history store. **[I]**
- **Discord bots** — the ecosystem is wrapper-driven (`brawlstats`, `brawling`, `brawlstars.js`, `brawljars`, `krawl`, `BrawlPlex`, `bstats`). Typical bot = `/profile`, `/battlelog`, `/brawler`. **They are stateless relays of the 25-battle buffer** — none of the popular wrappers ships a persistence layer, so no bot accumulates history. **[I]** from the wrapper docs surveyed above.

## 2.2 Pattern summary — what the whole Brawl Stars category is missing

Across every site above, the same gaps recur:
1. **No per-match detail page.** Nobody gives a battle its own URL with both comps, the map, the draft, and a verdict. (Partly the API's fault — no box score — but the *draft* is fully available and nobody analyses it.)
2. **No bracket separation.** Personal stats are computed over trophy + ranked + friendlies mixed together. BrawlMeta is the only project in this survey whose entire archive is bracket-partitioned.
3. **No personal-vs-global comparison.** Everyone shows either the global meta or your raw numbers, never "your Piper WR vs the global Piper WR on this map, with a sample-size caveat".
4. **No time-structure analysis.** Zero session detection, zero tilt/streak analysis, zero time-of-day, despite `battleTime` being free.
5. **No teammate/social layer.** `teams[].tag` is in every battle and nobody builds "recently played with", duo synergy, or a club-mates board from it.
6. **Rating metrics measure spending and grinding, not skill.** Brawlytix's Account Value, Brawl Time's power percentile — both reward money and hours.
7. **No alerts/notifications, no seasonal recap, no post-match report.**
8. **Freshness is daily.** Brawlify daily, NOFF daily. For an active player that guarantees data loss.

## 2.3 Discord-bot trackers (Brawl Stars)
- **Brawl Bot** (~in Discord App Directory, https://discord.com/discovery/applications/717761456787030047) — real-time stats, brawlers, leaderboards, events, and **`/image` to generate a shareable profile image**. **[V]**
- **Brawl Stats Bot** (https://top.gg/bot/923162685271584788) — `/save` (bind your tag), **`/graphique` (trophy-progression graphs → it stores history)**, `/brawlers`, `/profile`. **[V]**
- **Brawler Stats** (https://discordbotlist.com/bots/brawler-stats) — `bs!profile`, `bs!club`; ~1,570 servers. **[V]**
- **BrawlTools** (https://brawltools.net/) — profile, club, **push stats, and friend comparison**. **[V]**
- **Star List bot** = Brawlify's bot (https://top.gg/bot/517368847322447873). **[V]**

**Read on the bot layer:** two of the five already do the two things web trackers don't — **saved identity** (`/save`) and **shareable image cards**. That is where the distribution is: Brawl Stars' community lives in Discord clubs/servers, and a bot that posts a *club-wide* leaderboard or a post-session report into a server is a distribution channel our tournament product already has a reason to build. **[I]**

## 2.4 Sibling-game trackers — the sticky feature patterns

| Pattern | Where it works | Why it sticks | Brawl Stars status |
|---|---|---|---|
| **Per-match detail page** with full rosters + per-player rating | op.gg (More → match detail, shows each player's OP Score and POG) https://help.op.gg/hc/en-us/articles/31091817743129 ; tracker.gg "match details include rosters, post-match stats, player ratings, performance graphs" https://tracker.gg/lol | Gives every game a permalink → shareable, linkable, argued about | **Absent everywhere.** Brawl Stars has no box score, but map + both 3-man comps + result + draft order *is* enough for a real page. |
| **A single proprietary performance score** | OP Score — computed on a 3–5 min timeline through the match, final value recorded, plus 14 narrative keywords ("Tenacity", "Unstoppable") https://help.op.gg/hc/en-us/articles/31088715328665-OP-Score-explained | One number people chase and screenshot; the *keywords* are the shareable part | Brawlytix "Skill Score" and Brawl Time "S+→D" exist but both are **account-value/playtime scores, not per-match performance scores.** |
| **MMR/rating estimation for a hidden value** | Riot hides MMR; op.gg/u.gg percentile distributions are cross-referenced to estimate it https://www.aussyelo.com/blog/best-mmr-checker-league-of-legends | The hidden number is the most-searched number in the game | **Exactly our situation** — Ranked Elo/tier is hidden from the API. Nobody has published a *derived* estimate with a stated method. |
| **"Recently played with"** — teammates you've queued with repeatedly, with win rate per teammate | op.gg https://help.op.gg/hc/en-us/articles/30994064577433 | Social hook; brings a whole friend group onto the site | **Absent.** Data is free in `teams[].tag`. |
| **Session reports / weekly improvement reports** | tracker.gg — "session reports with insights and improvement tips", "see your improvement via weekly reports" https://tracker.gg/premium | Converts a stats page into a habit | **Absent.** |
| **Post-match overlay / real-time round-by-round** | Valorant Tracker overlay https://www.overwolf.com/app/tracker_network-valorant_tracker | Zero-friction capture | Impossible on mobile — but a **Discord post-session report** is the mobile-native equivalent. **[I]** |
| **Mastery / hero-mastery improvement tool behind a paywall** | Dotabuff Plus — $6/mo or $56/yr for "Hero Mastery Tool + advanced match analysis and personal improvement tools" https://www.dotabuff.com/plus | Proves people pay for *coaching-flavoured* analytics, not raw stats | Absent — and note the Supercell policy issue: **paid** would need approval, but **coaching** is a named exception. |
| **Ad-free premium as the whole pitch** | op.gg Premium (ad-free + personalised match-history dashboard + upgraded favourites) https://opgg.helpscoutdocs.com/article/400 ; tracker.gg Premium; wzstats premium = remove ads | Lowest-friction paid tier | Nobody in Brawl Stars sells one. And ads are the one Supercell-blessed revenue line. |
| **Percentile leaderboards on derived metrics** | op.gg/PUBG OP-Score tier distribution https://op.gg/pubg/statistics/op-score | Turns a stat into a ladder | Brawlytix does this for *cosmetics/progression*, not performance. |
| **Shareable profile card image** | Brawl Tracker https://brawltracker.com/ ; Brawl Bot `/image` | Free organic distribution | Exists but crude; no seasonal recap format. |
| **Seasonal recap ("Wrapped")** | tracker.gg seasonal per-role/per-champion overviews | Annual viral spike | **Completely absent in Brawl Stars.** |
| **Free full API + open data** | OpenDota (free API, full match stats, graphs, movement map) https://www.opendota.com | Community builds *on* you; becomes infrastructure | Only Brawlify (api.brawlapi.com) does this, and only for static game data — not match data. |

---

## 1.5 Rate limits, keys, and operational limits (back-fill to Part 1)

- **IP allowlisting is real and is the #1 operational constraint.** "Each API token is associated with a specific IP address, so you need to use the token in the same server where you obtained it." **[V]** https://github.com/RoyaleAPI/cr-api-docs/blob/master/docs/proxy.md / https://docs.royaleapi.com/proxy.html
- **The community workaround:** create the key with RoyaleAPI's proxy IP **45.79.218.79** allowlisted, then call `https://bsproxy.royaleapi.dev/v1/...` instead of `https://api.brawlstars.com/v1/...`. Free, and it removes the static-IP requirement entirely. **[V]** same source.
  - **Actionable for us:** BrawlMeta currently pays for a Webshare static-IP proxy to solve exactly this problem (**[V]** `common.py` `PROXIES`, `api/player.js` `ProxyAgent`). `bsproxy.royaleapi.dev` is a zero-cost fallback/second path — worth having configured as a failover even if we keep Webshare as primary (a third-party proxy is a dependency and a privacy consideration). **[I]**
- **Rate limiting is per-token, per-second, and advertised in response headers:** `x-ratelimit-limit` (requests/second), `x-ratelimit-remaining`, `x-ratelimit-retry-after` (microseconds, only sent on a 429), plus `x-cached`. **[V]** https://github.com/RoyaleAPI/cr-api-docs/blob/master/docs/faq.md — *note: these docs are RoyaleAPI's, describing the Supercell-family API surface; treat the exact header names as **[I]** for Brawl Stars until observed on a live response.*
- **Practical throughput:** the Supercell family is commonly reported at **~10 req/s per token**, with a second, longer (per-minute) bucket behind it; on a 429 wait 1s and retry, and if 429s repeat, back off up to a minute. **[I]** https://forum.supercell.com/showthread.php/1211833-Request-rate-for-API, https://github.com/RoyaleAPI/cr-api-docs/blob/master/docs/faq.md
  - Our scraper's empirical settings — `CONCURRENCY = 8` with a per-request `REQUEST_DELAY` — are consistent with that ceiling. **[V]** `common.py:129`.
  - **429s cost you the whole battlelog** (non-200 → `return []`, no partial parse). At 25 battles/response, sustained throttling silently shrinks collection without any error surfacing. **[V]** `common.py:249`.
- **Multiple keys are the scaling lever** (each key = its own bucket, each bound to an IP), which is how high-volume sites operate. **[I]**
- **Caching:** Supercell sends `cache-control`; wrappers cache until `max-age` and expose an `x-cached` indicator. Community wrappers mention ~3-minute caches on some endpoints. **[I]** https://brawlapi.com/, wrapper docs.
- **Battlelog freshness/delay:** no authoritative figure found this session for how long after a match a battle appears. Empirically the buffer is depth-limited (~25) rather than time-limited. Treat "poll interval must be shorter than the time it takes an active player to play 25 games" as the design rule — for a grinder that is roughly **30–60 minutes**, not a day. **[I]**
- **Supercell's stated data-privacy posture:** most in-game information is deliberately private; "battle logs" are the notable exception granted to developers. **[V]** https://github.com/RoyaleAPI/cr-api-docs/blob/master/docs/faq.md — i.e. the absence of ranked/mastery/damage data is a **policy choice, not an oversight**, and is unlikely to change on our timeline.

---

# PRIORITIZED: stat-tracking features that are (a) possible with the official API + our own history store, and (b) not done well by anyone today

Ranked by **(differentiation × reachability) ÷ cost**. Every item is derivable from data the API already gives us plus history we store ourselves. None requires a data source we don't have or can't legally get.

### P0 — Prerequisite (nothing below works without it)
**0. Start storing player-level match rows today.** A new table (`player_matches` or similar) keyed on `battleTime + sorted(player tags)` — **not** the existing composition hash — carrying: battle time, map, mode, battle type, bracket, each player's tag + brawler + team + result, and star-player tag. The existing 1.5M-row `ranked_matches` archive is brawler-only and its hash collapses distinct games (§1.4), so it can power none of this. **Every day this is delayed is a day of history permanently lost** — the 25-battle buffer does not back-fill. This is the single highest-value item in this document.
*Cost: one migration + ~30 lines in `common.py`, reusing the spider that already visits these battlelogs. Storage: the pruning/FIFO discipline in `prune_ranked_matches` gives us the pattern.*

### P1 — High differentiation, low cost, nobody does it
1. **"Your brawler vs. the world" — personal WR per brawler per map vs. our global aggregate**, with an explicit sample-size/confidence treatment (we already have Bayesian `true_win_rate` machinery in `brawler_intelligence`). No competitor compares a player against a bracket-matched baseline. Directly reuses the confidence-honest UI language already in the Draft Assistant.
2. **Session & tilt report.** Cluster `battleTime` into sessions; report games/session, WR by game index within session, WR after a loss vs after a win, WR by hour and weekday. Pure timestamp math; **completely absent from the category**; the most "coaching" feeling feature per unit of effort. Pairs naturally with a Discord push.
3. **Recently played with / duo synergy.** W-L per teammate tag, best and worst partners, and per-teammate WR delta vs your solo baseline. Free from `teams[].tag`; op.gg proved the social stickiness; zero Brawl Stars sites have it.
4. **Personal matchup table.** Your WR with brawler X *against* enemy brawler Y and *alongside* teammate brawler Z — the personal version of our existing `vs_brawler`/`with_brawler` jsonb. We already have the RPC pattern; the join is the only new work.
5. **Star Player rate as a carry metric.** `battle.starPlayer.tag == you`, per brawler/mode/map, vs the 1-in-6 baseline. Present in every payload, aggregated by nobody.

### P2 — High value, moderate cost
6. **Derived Ranked-strength estimate ("BrawlMeta Rating") with a published method.** The API hides ranked entirely; competitors show an Elo of undisclosed provenance. A *transparent* derived rating — from opponent quality, bracket of the lobbies you appear in, and WR against a bracket-matched baseline — is honest, defensible, and the most-searched number in the game. Publish the formula; that transparency is the differentiator, not the number.
7. **Per-match detail page with a draft verdict.** A permalink per battle: both comps, map, bracket, result, plus **`computeWinSplit` run on the finished draft** — "this comp was a 61/39 matchup edge; you lost it" or "you won a 38/62". Nobody in Brawl Stars has a per-match page at all, and nobody anywhere can add a *draft-quality verdict*, because nobody else has the engine. **This is the single most defensible feature in the list — it is the only one a competitor cannot copy in a weekend.**
8. **Trophy & progression history with graphs.** Daily `/players` snapshot diffing: trophy curve, per-brawler trophy curve, power/gadget/star-power/gear/Hypercharge unlocks over time, maxing projection, season deltas. Brawlify and brawlace already do the trophy part — this is table stakes, not differentiation, but its absence is conspicuous.
9. **Post-session / weekly report, delivered.** Email or Discord: what you played, WR, best/worst brawler, the map that hurt you, one concrete recommendation from the draft engine. tracker.gg proved this converts a stats page into a habit; nobody in this game does it.
10. **Club / roster board.** Aggregate a club's members into one page: activity, WR, who's improving, who's inactive. Feeds directly into the tournament product (rosters, seeding) and is a natural Discord-bot surface.

### P3 — Distribution & retention plays
11. **Shareable profile / recap card image.** Season recap ("Wrapped"), post-tournament card, best-brawler card. Free organic distribution; two Discord bots do a crude version; no seasonal recap exists in Brawl Stars at all.
12. **Discord bot with saved identity + club leaderboard + session report.** The community lives in Discord; `/save`-style identity binding is already normalised there; this is the cheapest real distribution channel we have and it plugs straight into the tournament flow.
13. **Percentile leaderboards on *performance*, not spending.** Every existing Brawl Stars leaderboard ranks trophies, skins, account value or hours. A bracket-partitioned WR/rating percentile board is unoccupied ground.
14. **Alerts.** Rank/trophy milestone, "your main got nerfed and your recent WR dropped X%" (we already compute recency deltas and Trending chips), tournament reminders.
15. **Name-change / tag history.** Cheap, and directly serves our anti-impersonation and permanent-display-name principles.

### Explicitly OUT — do not plan around these
- Damage/kills/objective box scores, mastery points, official ranked tier or Elo, per-brawler win counters, any battle older than the 25-battle buffer that we did not capture. **None exist in the API and Supercell's stated posture is that non-battlelog player data stays private.** Anything a competitor shows in these categories comes from outside the public API and should not be treated as a reachable baseline.

### Monetization guardrails carried forward from Part 3
- **Never put a player-facing stat behind a paywall.** Required by our own principle *and* by the Fan Content Policy's fee prohibition.
- **Ads are the only unambiguously sanctioned revenue line**; coaching is the second named exception and the P1/P2 features above are literally coaching tooling.
- **The organizer-subscription line needs written Supercell approval to be durable.** Ask; the policy has an explicit approval path, and Brawlify's Creator Code shows the relationship is obtainable.
- **Tournaments must stay free to enter for players — no membership fees, no season passes.** This is Supercell's rule, not just ours.

---
STATUS: complete
