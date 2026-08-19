# W1 — Brawlify.com Feature Inventory & Critical Evaluation

STATUS: complete
Researcher: Claude (agent W1)
Date started: 2026-08-19
Purpose: exhaustive competitive inventory of brawlify.com to feed an implementation plan for brawl-meta.vercel.app

Every claim is marked **VERIFIED** (fetched the page and observed it) or **INFERRED** (deduced, not directly observed).
Where a page is JS-gated or failed to load, that is stated explicitly rather than guessed.

---
## 0. RESEARCH CONSTRAINT — brawlify.com is BLOCKED from this session (read this first)

**VERIFIED (blocking):** Every attempt to fetch brawlify.com or api.brawlify.com from this
session is refused by the organization's egress gateway, not by brawlify:

- `WebFetch https://brawlify.com/` → `EGRESS_BLOCKED: Access to brawlify.com is blocked by the network egress proxy.`
- `WebFetch https://api.brawlify.com/v1/brawlers` → same error.
- `curl https://brawlify.com/` → `curl: (56) CONNECT tunnel failed, response 403` (gateway policy denial).
- `curl https://api.brawlify.com/v1/brawlers` → same 403.

Host probe of every other candidate source (VERIFIED, one curl each):

| Host | Result |
|---|---|
| github.com | reachable |
| raw.githubusercontent.com | reachable |
| brawlapi.com | BLOCKED (000 / CONNECT refused) |
| docs.brawlapi.com | BLOCKED |
| www.npmjs.com | 403 |
| play.google.com | BLOCKED |
| apps.apple.com | BLOCKED |
| api.brawlstars.com | BLOCKED |
| brawltime.ninja | BLOCKED |
| www.brawlify.com | BLOCKED |

The agent-proxy README (`/root/.ccr/README.md`) states explicitly that a 403 from the gateway is
an organization policy denial and must be **reported, not routed around**. I therefore did **not**
use web.archive.org, Google cache, text-extraction proxies, or any other mirror of the blocked host.

### What this means for the confidence level of this document

Everything below is assembled from two sources that ARE permitted:

1. **WebSearch** — returns the search index's own titles, meta descriptions and extracted
   summaries of brawlify pages. This is second-hand: it reflects brawlify's own marketing copy
   and page metadata, not the rendered DOM.
2. **GitHub** — public API-wrapper libraries, bots and scrapers that call the Brawlify API.
   These are *primary evidence for the API surface* (endpoint paths, response field names,
   rate-limit handling) because they are working code written against the live service.

So the marking convention in this document is:

- **VERIFIED (code)** — I read source code on GitHub that calls this exact endpoint / field.
- **VERIFIED (search-meta)** — the search index returned brawlify's own page title/description
  asserting this. Trustworthy for *what features exist*, untrustworthy for *how good they are*.
- **INFERRED** — my deduction. Includes essentially ALL of the UI/UX, layout, latency, mobile,
  and ad critique, because I could not render a single brawlify page.

**Action required from the parent agent / owner:** if the implementation plan is going to make
build-vs-skip calls on UI quality, someone with an unblocked browser must do a visual pass. Ask
an admin to allowlist `brawlify.com` and `api.brawlify.com`, or have the owner screenshot the
pages listed in section 12 ("What still needs human eyes"). Do not treat the UI critique in this
document as observed fact.

---
## 1. The Brawlify public API (`api.brawlify.com/v1`, docs at `brawlapi.com`)

This is the single best-documented part of Brawlify and the part a competitor will interact with
most, because it is the free data plumbing half the Brawl Stars tooling ecosystem is built on.

### 1.1 Endpoint surface — COMPLETE

**VERIFIED (code)** — reconstructed from `y9vad9/krawl`, a type-safe Kotlin client whose entire
`brawlify-api` module is a 1:1 model of the API. Source of the endpoint list:
https://raw.githubusercontent.com/y9vad9/krawl/main/brawlify-api/src/commonMain/kotlin/com/y9vad9/krawl/brawlify/api/v1/DefaultRawBrawlifyApiClient.kt
Base URL literal in that file: `https://api.brawlify.com/` with paths appended.

| Endpoint | Returns | Envelope |
|---|---|---|
| `GET /v1/events` | active + upcoming rotation | `{active: [...], upcoming: [...]}` — NOT wrapped in `list` |
| `GET /v1/brawlers` | every brawler | `{list: [...]}` |
| `GET /v1/brawlers/{brawlerId}` | one brawler | bare object |
| `GET /v1/maps` | every map ever, incl. retired | `{list: [...]}` |
| `GET /v1/maps/{id}` | one map **+ its stats/teamStats** | bare object |
| `GET /v1/gamemodes` | every game mode | `{list: [...]}` |
| `GET /v1/gamemodes/{id}` | one mode (`id` or `scId`; krawl's docstring says **prefer `scId`, `id` is often absent**) | bare object |
| `GET /v1/icons` | all player icons + club badges | `{player: {id: {...}}, club: {id: {...}}}` — maps keyed by id, not arrays |
| Game-data (CSV→JSON) endpoints | parsed raw in-game `.csv` files | documented at `brawlapi.com/#/endpoints/game-data`; krawl marks the whole module `@UnstableBrawlifyGameDataApi` — "inherently unstable and may break at any time" |

**VERIFIED (search-meta):** the docs site describes the API as "a free, static JSON API … served
straight from Cloudflare Pages, so it is fast, cached, and needs no key. No API keys, no tokens,
and no rate limits." (https://brawlapi.com/) Also **VERIFIED (search-meta):** `api.brawlify.com`
301-redirects `/v1/*` to `api.brawlapi.com`, and new integrations are told to point at
`api.brawlapi.com` directly.

**Two things that are NOT in this API and matter enormously:**

1. **There is no player endpoint. There is no club endpoint. There is no battle-log endpoint.**
   The public API is game *catalog* + *rotation* + *map aggregate stats*, full stop. Every
   player-facing feature on brawlify.com is therefore a server-side proxy of Supercell's official
   API (`api.brawlstars.com`) — **INFERRED**, but strongly: Supercell's API is IP-allowlisted, so a
   browser cannot call it, and Brawlify exposes no player route of its own for third parties.
   Consequence: **their profile pages can contain nothing Supercell does not return**, unless they
   are separately warehousing it, which the API gives no evidence of.
2. **There is no historical/time-series endpoint anywhere.** Every stat object is a single current
   scalar. No `?patch=`, no `?from=&to=`, no snapshots.

### 1.2 Exact response shapes — COMPLETE FIELD LISTS

All **VERIFIED (code)** from the krawl `@Serializable` data classes (`brawlify-api/.../api/v1/`).
Fields with `= null` / `= emptyList()` defaults are optional in the wire format.

**Brawler** (`/v1/brawlers`) — `RawBrawlifyBrawler.kt`:
`id, avatarId, name, hash, path, fankit, released, version, link, imageUrl, imageUrl2 (borderless),
imageUrl3 (fankit), class{id,name}, rarity{id,name,color}, unlock?, description, descriptionHtml,
starPowers[], gadgets[], videos[]`
- `starPowers[]` / `gadgets[]` element: `id, name, path, version, description, descriptionHtml, imageUrl, released`
- Rarity id map (**VERIFIED (code)**, `ienone/brawlstars_banpick/scripts/crawler.py`):
  `0 Unknown, 1 Common, 2 Rare, 3 Super Rare, 4 Epic, 5 Mythic, 6 Legendary, 7 Ultra Legendary`

**Map** (`/v1/maps`, `/v1/maps/{id}`) — `RawBrawlifyMap.kt`:
`id, new, disabled, name, hash, version, link, imageUrl, credit?, environment{...},
gameMode{...}, lastActive?, dataUpdated?, stats[], teamStats[]`
- `environment`: `id, scId, name, hash, path, version, imageUrl`
- `gameMode` (view object): `id?, scId, name, hash, version, color, bgColor, link, imageUrl`
- `stats[]` element (`RawBrawlifyMapBrawlerStatistics`): **`brawler (int id), winRate, useRate, starRate?`**
- `teamStats[]` element: `name, hash, brawler1..brawler3 (+brawler4/5 optional for 5v5),
  data{winRate, useRate, wins, losses, draws, total}`
- **VERIFIED (search-meta):** the LIST endpoint omits `stats`/`teamStats`; only the per-id DETAIL
  endpoint carries them. So a competitor mirroring their map stats needs N+1 requests.

**Game mode** (`/v1/gamemodes`) — `RawBrawlifyGameMode.kt`:
`id?, scId, name, hash, scHash, disabled, color, bgColor, version, title, tutorial, description,
shortDescription, sort1, sort2, link, imageUrl (icon), imageUrl2 (header), lastActive?, TID`

**Events rotation** (`/v1/events`) — `RawBrawlifyEventsRotation.kt` + `RawBrawlifyEvent.kt`:
- top level: `{active: RawBrawlifyEvent[], upcoming: RawBrawlifyEvent[]}`
- event: `slot{...}, predicted (bool), historyLength?, startTime, endTime, reward (int), map{full map object}, modifier?`
- `slot`: `id, name, emoji, hash, listAlone, hideable, hideForSlot?, background?`
- **`predicted: Boolean` is the interesting field** — Brawlify publishes *forecast* rotation slots,
  flagged as such. **INFERRED:** they extrapolate the known rotation cycle rather than having
  privileged data.

**Icons** (`/v1/icons`) — `RawBrawlifyIcons.kt`:
- `{player: Map<id, PlayerIcon>, club: Map<id, ClubBadge>}`
- PlayerIcon: `id, name, name2, imageUrl, imageUrl2, brawler (int|null), requiredTotalTrophies,
  sortOrder, isReward, isAvailableForOffers`
- ClubBadge: `id, imageUrl` — that is the entire object.

### 1.3 Critique of the API

- **It is a CDN-backed JSON dump of the game's own CSV files with images bolted on.** `hash`,
  `path`, `TID`, `scId`, `sort1`, `sort2`, `version` are all straight out of Supercell's
  `.csv` game files. The genuine value-add is exactly three fields: `stats[]`, `teamStats[]`, and
  `predicted` on events. Everything else is repackaging.
- **`stats[]` is analytically threadbare.** Three numbers per brawler per map — `winRate`,
  `useRate`, `starRate` — with **no sample size, no confidence interval, no rank-bracket split, no
  patch tag, and no timestamp on the stat itself** (`dataUpdated` is per map, not per stat row).
  You cannot tell whether a 62% win rate came from 50 games or 500,000, whether it is Bronze or
  Masters, or which balance patch it covers. This is the single largest attack surface: BrawlMeta
  already stores `collected_at`, `patch_id`, `bracket_id` and Bayesian `true_win_rate` per row.
- **`teamStats[]` is a raw frequency table, not analysis.** It gives comps that occurred with
  win/loss/draw counts. It does not tell you *why*, does not compute a counter matrix, does not
  handle the draft-order problem, and does not distinguish "this comp is strong" from "this comp is
  what people who queue this map happen to own."
- **No player, club, ranked, or battle-log data at all.** So the API cannot be used to build the
  player-facing half of the site, and neither can a competitor use it that way.
- **Zero historical dimension.** No patch parameter, no time-series, no snapshots. Their own site
  therefore cannot honestly show "how did this brawler trend across the last three patches"
  without a private warehouse, and there is no evidence in the public surface that one exists.
- **The game-data endpoints are explicitly unstable** (krawl's `UnstableBrawlifyGameDataApi`
  marker, citing `brawlapi.com/#/endpoints/game-data`). Anyone building on them is building on sand.
- **"No rate limits" is a claim, not a guarantee.** **VERIFIED (code):** a production consumer
  (`Itxialdiak/brawl-tracker`, `app/integrations/brawlify_live.py`) carries the comment
  *"`api.brawlify.com` puede responder 403 a IPs de datacenter pese a las cabeceras de navegador"*
  — i.e. **the live API 403s datacenter IPs even with browser headers**, and that project keeps a
  `probe()` function specifically to test egress before wiring it in. So the real policy is
  "unlimited unless Cloudflare decides you're a bot." A competitor's server-side scraper needs a
  residential/static proxy exactly like BrawlMeta already uses.
- **Two hostnames, one 301.** `api.brawlify.com` → `api.brawlapi.com`. Consumers in the wild are
  still hardcoding the old host (**VERIFIED (code):** 32+ GitHub files matched `api.brawlify.com/v1`
  in a single code search), so a future removal of the redirect breaks a large ecosystem.
- **Ecosystem lock-in is their real moat, not the site.** Their CDN (`cdn.brawlify.com`) and this
  API are the default asset/catalog source for essentially every third-party Brawl Stars tool,
  bot and tracker. That is worth more than any single page on the site.

### 1.4 What a competitor should do with this

- **Consume it, don't fight it, for catalog + art.** Brawler/map/mode/icon metadata and images are
  a solved problem; mirroring `cdn.brawlify.com` assets (their CDN repo is explicitly
  "free to use for everyone… mostly used by developers of their own projects") costs nothing and
  frees engineering for the parts that differentiate.
- **Compete precisely on the three fields they add value with.** Ship map stats that carry
  `n`, `patch`, `rank_bracket`, `collected_at`, and a Bayesian shrunk win rate — every axis their
  `stats[]` lacks. BrawlMeta's `brawler_intelligence` table already has all five.
- **Ship the historical endpoint they don't have.** "Win rate of X on map Y across the last 4
  patches" is impossible against their API and trivial against `ranked_matches` + `patches`.
- **Ship a public API with those extra dimensions.** Their ecosystem dominance came from being the
  free API everyone builds on. The way to take a slice is to be the free API that answers the
  questions theirs can't — per-bracket, per-patch, sample-sized, with pair/counter data
  (`vs_brawler`, `with_brawler`) that has no equivalent anywhere in `/v1`.

---
## 2. Site map / URL structure (confirmed routes)

**VERIFIED (search-meta)** — each of these URLs was returned by the search index with a real
brawlify-authored `<title>`, which proves the route exists and tells us what the page claims to be.

| URL | Page `<title>` as indexed | What it is |
|---|---|---|
| `https://brawlify.com/` | "Brawl Stars Meta — Stats Tracker, Events & Rankings" | home |
| `/about` | "About Brawlify — Brawl Stars Statistics & Player Tracker" | about |
| `/about/premium` | "Brawlify Premium — Ad-Free Brawl Stars Stats & Auto Tracking" | paywall page |
| `/brawlers` | "All 106 Brawl Stars Brawlers Ranked — Tier List & Meta (2026)" | brawler index + global tier list |
| `/maps` | "Brawl Stars Maps — Today's Rotation & Who to Pick" | map index |
| `/maps/{id}` e.g. `/maps/15000170`, `/15000321`, `/15001021`, `/15000548`, `/15000996`, `/15001026`, `/15000734` | "{MapName} Best Brawlers & Tier List - {MODE}" | per-map meta page |
| `/events` | "Brawl Stars Map Rotation — Who to Play on Today's Maps" | live rotation |
| `/stats` | "Brawl Stars Stats Tracker & Account Checker" | player search entry point |
| `/stats/profile/{TAG}` e.g. `/stats/profile/28QL8PCJR` | "{Name} #{TAG} Profile History & Graphs \| Brawl Stars Stats" | **tracked-profile history view** |
| `/player/{TAG}` e.g. `/player/P2J2QCR8` | "{Name} #{TAG} — Brawl Stars Stats & Battle Log" | live profile |
| `/player/{TAG}/history` | "{Name}'s Trophy Graph & History - Brawl Stars" | trophy graph |
| `/player/{TAG}/battles` | "{Name}'s Battle Log - Brawl Stars" | battle log |

**Note the duplication (VERIFIED):** there are two parallel player URL families — `/player/{TAG}/...`
and `/stats/profile/{TAG}`. Both are indexed, both carry titles about profile history. **INFERRED:**
this is legacy-route drift (an older "stats" section and a newer "player" section), and it is an SEO
self-own — two URLs competing for the same query for the same tag.

**Also confirmed to exist (VERIFIED, search-meta / store listings):** a native mobile app,
"Brawlify for Brawl Stars", Android package **`pro.starlist.app`**, iOS id **1541845276**,
listed under publisher **MWM**. The package name is the tell: Brawlify was previously branded
**Star List**. So the brand is a rename of an older project and the app is at least partly
operated/monetized through a third-party app studio rather than the site team.

---

## 3. Player-facing features — profile, battle log, tracking (THE most important section)

### 3.1 What is shown

**VERIFIED (search-meta)** — from the indexed descriptions of `/stats`, `/player/{TAG}`,
`/player/{TAG}/history`, `/player/{TAG}/battles`, `/about/premium`:

- **Player search by tag** → full profile with battle log, trophies, brawler progression.
- **Brawler collection view:** "all brawlers with power levels, gadgets, star powers, gears **and
  upgrade costs**".
- **Battle log:** "complete tracked battle history … teams, players, brawlers, loadouts, results,
  and trophy changes", **filterable by brawler, mode, map, and result**.
- **Trophy progression chart:** "each point representing the player's trophy count **at the end of
  that day**".
- **Activity heatmap:** GitHub-contributions-style grid over the **past 90 days**, one cell per day,
  darker = more battles; hover gives exact battle count, win/loss record, and trophy change.
- **Leaderboards/rankings:** global and **per-country** player rankings, club rankings, and
  **per-brawler** top players.

### 3.2 Is the history stored server-side, or is it just the live API?

**This is the crux, and the answer is: BOTH, split along the paywall.**

- The Supercell official API returns a player object (current trophies, brawler list) and a
  **battle log of only the last ~25 battles, retained ~24–48h**. It returns **no trophy history and
  no daily aggregates whatsoever**. (INFERRED from the API's well-known shape; `api.brawlstars.com`
  is blocked from this session so I could not re-verify.)
- Therefore a "trophy count at the end of each day" chart and a "90-day activity heatmap"
  **cannot** come from a live call. They require server-side daily snapshots. **VERIFIED
  (search-meta):** "For tracked players, Brawlify creates graphs showing how trophies evolved
  **tracked every single day**", and "player and club statistics are updated **daily**".
- **VERIFIED (search-meta):** tracking is **opt-in and gated**. A user enables automatic tracking by
  activating a **"Free Boost" for 7 days**; **Premium** ($4.99/mo) includes "automatic profile
  updates so you never miss a battle" and "continuous tracking of your trophy progression".

**So the real behaviour (INFERRED, high confidence, from the above):**
an untracked tag gets a page that is a pretty rendering of one live Supercell call — current
trophies, current brawler list, last ~25 battles — with an empty or near-empty graph. History only
exists for tags someone has boosted or is paying for, and only from the moment tracking started.
The marketing copy ("full profile with battle log, trophies and brawler progression") does not
distinguish these two states.

### 3.3 Harsh critique

1. **The graph is a paywall in a trenchcoat.** The single most valuable player-facing artifact — a
   real trophy history — is the thing you cannot have unless you pay or burn a 7-day boost. The
   free profile is a skin over one API call. Charging for *your own historical data*, which only
   exists because you visited, is the least defensible possible paywall.
2. **"Tracked every single day" means daily resolution and nothing finer.** A daily end-of-day
   trophy point cannot show a push session, a tilt streak, or an intra-day drop. For a game whose
   entire trophy loop happens in 45-minute sessions, day-granularity is the wrong sampling rate,
   and it is chosen because it is cheap to store, not because it is informative.
3. **History starts when tracking starts — retroactively, there is nothing.** A new user's graph is
   empty. This is structurally unavoidable for them and equally unavoidable for a competitor, which
   makes "who started snapshotting earlier" a moat that only compounds. **The implication for
   BrawlMeta is urgent: start snapshotting profiles now, for free, for everyone, before there is a
   product to attach it to.** Every day of delay is a day of history you can never buy back.
4. **The battle log is a formatted dump, not analysis.** Teams, brawlers, loadouts, result, trophy
   change — every one of those fields comes straight from Supercell's battlelog response. Filtering
   by brawler/mode/map/result is table-stakes UI, not insight. Nothing here computes *your* win rate
   with a brawler versus the population's, *your* map-specific weaknesses, who you lose to, or
   whether your last 20 games were above or below your own baseline.
5. **"Best brawlers" for a player is (INFERRED) sorted by trophies**, which measures time invested,
   not skill or current form. A player's "best brawler" by trophies is usually just their oldest.
6. **No ranked depth on profiles.** The indexed copy is entirely trophy-centric — trophy graph,
   trophy heatmap, trophy leaderboards. Ranked/Masters is where the competitive population actually
   lives, and I found no evidence of per-bracket ranked history, ranked win rate by map, or draft
   performance on player pages. **(Marked INFERRED-from-absence; a visual pass should confirm.)**
7. **The activity heatmap is the most gimmick-shaped feature on the site.** It is a GitHub
   contribution graph. It tells a player "you played a lot on Saturday," which they knew. It carries
   essentially zero decision-relevant information, but it screenshots well — which is why it exists.
8. **Two competing URL families for the same entity** (`/player/{TAG}` vs `/stats/profile/{TAG}`)
   split link equity and confuse deep links.

### 3.4 How to beat it

- **Snapshot every tag anyone ever looks up, permanently, for free.** Their moat is opt-in and
  paywalled; make yours automatic and universal. A lookup is a subscription. This also matches
  BrawlMeta's non-negotiable "players never pay."
- **Snapshot per battle, not per day.** BrawlMeta's scrapers already ingest battle logs into
  `ranked_matches` with `collected_at`. A per-battle trophy/rank curve is strictly better than a
  daily point and you are already paying for the data.
- **Make the profile analytical, not descriptive.** For each brawler the player owns, show *their*
  win rate against the population's `true_win_rate` at their bracket — "you are 6 points below
  average on Piper in Knockout" is a sentence Brawlify structurally cannot write, because it has no
  per-bracket baseline and no per-player aggregate.
- **Lead with ranked, not trophies.** Per-bracket ranked history, map-level ranked performance, and
  draft/ban tendencies are where the competitive audience is and where their trophy-centric design
  has nothing.
- **Reuse the counter/pair data on the profile.** `vs_brawler` / `with_brawler` already exist —
  "your Piper loses to Mortis 8 points more than average" is a genuine product no one ships.
- **Never gate history.** Their $4.99/mo for "your own data" is the most attackable thing on the
  site; a free, permanent, higher-resolution history is a marketing weapon, not just a feature.

---

## 4. Monetization, ads, and business model

**VERIFIED (search-meta), from `/about` and `/about/premium`:**
- Ad-supported: "Ads help Brawlify cover server costs and keep providing free Brawl Stars stats."
- "No paywalls on stats, and Premium is optional."
- **Brawlify Premium: $4.99/month, cancel anytime.** Includes: ad-free browsing, automatic profile
  updates, battle history tracking, club activity logs.
- Free "Boost": 7 days of automatic tracking without paying.
- Supercell Creator Code: **"Brawlify"** — they are in Supercell's creator program, so a share of
  in-game spend routed through their code is a third revenue line.
- Mobile apps on both stores under publisher **MWM** (**VERIFIED**, store listings indexed),
  Android package `pro.starlist.app`.

**Critique:**
- "No paywalls on stats" is technically true and materially misleading — the *aggregate* stats are
  free, but the *personal history* (the thing a player actually returns for) is behind Premium or a
  7-day boost. The copy is engineered so both statements can coexist.
- Four monetization surfaces at once (display ads, $4.99 subscription, creator code, app-store
  presence via a third-party studio) on a site whose core value-add is three numbers per map. That
  ratio of monetization to differentiated data is the strategic weakness.
- **INFERRED (cannot verify without rendering):** an ad-funded stats site of this scale typically
  runs multiple display slots per page, which is the standard cause of poor mobile CLS and slow
  first paint. Treat as a hypothesis to confirm visually, not as fact.

**How to beat it:** BrawlMeta's model (players never pay; revenue from organizer fees + premium
for organizers) is a directly ownable position against a competitor charging players $4.99 to see
their own trophy graph. That contrast is the marketing message, and it costs nothing to make true.

---
## 5. Additional confirmed routes (second pass)

**VERIFIED (search-meta)** — more indexed brawlify URLs with real titles:

| URL | Indexed title | Notes |
|---|---|---|
| `/gamemodes` | "Brawl Stars Game Modes — Every Mode, Maps & Best Brawlers" | mode index |
| `/gamemodes/48000020` | "KNOCKOUT Maps — Today's Rotation & Who to Pick" | keyed by Supercell `scId` |
| `/gamemodes/48000006` | "SOLO SHOWDOWN Maps …" | |
| `/gamemodes/48000000` | "GEM GRAB Maps …" | |
| `/gamemodes/48000003` | "BOUNTY Maps …" | |
| `/brawlers/16000076` | "Kit — Brawl Stars Best Build, Stats & Tips" | per-brawler page, keyed by Supercell id |
| `/brawlers/16000104` | "Damian — …" | (note: Damian is one of the two brawlers BrawlMeta had to class by hand) |
| `/brawlers/detail/Kit` | "Kit in Brawl Stars \| Brawlers on Brawlify" | **a THIRD route family, keyed by name** |
| `/rankings` | "Brawl Stars Leaderboard — Top 200 Players & Clubs Live" | leaderboard hub |
| `/rankings/clubs` | "Brawl Stars Club Rankings & Leaderboard - Global" | |
| `/club/{TAG}` e.g. `/club/90GQQCCC`, `/club/Y9CRQC9` | "{Name} #{TAG} - Brawl Stars Club" | |
| `/stats/club/{TAG}` e.g. `/stats/club/9Y0QGCCJ` | "{Name} #{TAG} Club Stats \| Brawlify for Brawl Stars" | **duplicate club route** |
| `/player/{TAG}/brawlers` e.g. `/player/G00J28PVU/brawlers` | "{Name}'s Brawlers (90/104)" | collection view w/ completion count |
| `/player/{TAG}/maps` e.g. `/player/YPGQUJY/maps` | "{Name} — Brawl Stars Maps — Today's Rotation & Best Picks" | **personalized rotation** |

**Route-hygiene critique (VERIFIED from the table above):** brawlers are reachable at
`/brawlers/{scId}` AND `/brawlers/detail/{Name}`; players at `/player/{TAG}` AND
`/stats/profile/{TAG}`; clubs at `/club/{TAG}` AND `/stats/club/{TAG}`. **Three separate entity
types each have two indexed canonical-ish URLs.** That is accumulated legacy, it splits SEO
authority three ways, and it means deep links from Discord/YouTube point at inconsistent surfaces.
A competitor should pick one canonical route per entity on day one and 301 everything else.

---

## 6. Events / rotation

**What it is (VERIFIED, search-meta from `/events` and `/maps`):** every active map with the best
brawlers to pick on it, live win rates, tier lists, and the upcoming schedule, "updated every
rotation". Indexed copy describes the slot system in detail: slots #1 and #2 are permanent daily
slots (Brawl Ball, Solo Showdown); #3 and #6 rotate their mode's daily map; the **Featured slot
(#55) cycles every two hours across six modes**; #4 and #42 alternate two modes in the same lane.
There is also a **notification** offering ("get notified about event rotations, game updates, and
deals").

**Data source:** their own `/v1/events` endpoint, which is itself derived from Supercell's event
API plus their own extrapolation. **VERIFIED (code):** the event object carries
`predicted: Boolean` and `historyLength`, so upcoming slots are explicitly labelled as forecast.

**Critique:**
- This is the single feature they do *well* and the one with the clearest daily-use hook: a player
  opens the game, wants to know what's live, and gets it in one screen. It is also the least
  defensible, because the data is free and every competitor has it.
- The `predicted` flag is honest engineering, but **INFERRED:** the UI's willingness to surface
  predictions as if they were schedule is a correctness risk whenever Supercell changes the cycle.
- Rotation pages are inherently ephemeral — there is no "what was live last Tuesday" view, no
  rotation history, and therefore no way to correlate "this map was in rotation" with "this brawler
  spiked." That correlation is exactly what a match warehouse enables and a rotation feed does not.
- The per-map "best brawlers" attached to rotation is the same undifferentiated
  `winRate/useRate/starRate` triple, so the rotation page inherits every weakness of section 1.3.

**How to beat it:** store rotation history (map ↔ slot ↔ time window) as first-class rows. It costs
one small table and unlocks things they cannot show: "Bounty maps in the last 30 days and how the
meta moved across them", "this map returns to rotation every N days", and — most valuable for
BrawlMeta specifically — **automatic detection of a map leaving the ranked pool**, which the CLAUDE.md
Rustic Arcade incident shows is currently a manual, error-prone process.

---

## 7. Maps and per-map meta pages

**What it is (VERIFIED, search-meta):** `/maps` is the index ("Today's Rotation & Who to Pick");
`/maps/{id}` is titled "{Map} Best Brawlers & Tier List - {MODE}" and shows win rates, pick rates,
and a tier list of best brawlers, plus (per `/v1/maps/{id}`) **team comps** with win/loss/draw
counts. Indexed copy claims stats are "calculated from millions of real battles and updated in real
time" and that the archive includes "every map in the game, including old and disabled ones".

**Data source:** their own aggregation over battle logs (**INFERRED** — no public API exposes raw
matches, and the `stats`/`teamStats` arrays are computed, not from Supercell). Map metadata,
`environment`, `credit` (community map author) and images come from the game files.

**Critique:**
- **"Millions of real battles" with no `n` displayed per row is a credibility gap, not a strength.**
  The API object proves there is no sample-size field to display (section 1.2). A 68% win rate on a
  freshly-rotated map is indistinguishable from a 68% win rate on a staple map.
- **No rank-bracket split.** Aggregating Bronze and Masters into one win rate is the classic
  meta-site error: it makes high-skill-floor brawlers look bad and beginner-friendly brawlers look
  broken. BrawlMeta's `rank_brackets` + per-bracket `brawler_intelligence` is a structural
  advantage here, and it should be shown, not just stored.
- **No patch dimension.** When a balance change lands, their numbers are contaminated by pre-patch
  games with no way for a reader to tell. BrawlMeta's `patches` / `CURRENT_PATCH` / `CLOSED_PATCHES`
  model and the 14-day `recency` window with Trending chips is a directly superior answer.
- **`useRate` is not `pickRate` and the distinction is never explained.** Nor is `starRate`
  (star-player rate) — a metric that rewards damage-dealing and systematically flatters certain
  classes while telling you nothing about whether the pick wins games.
- **`teamStats` is presented as "best comps" but is a popularity table.** No draft-order awareness,
  no counter modelling, no "given the enemy has X, pick Y". This is precisely the hole BrawlMeta's
  5-pass `getDraftAdvice` + antisymmetric counter matrix + `counterStack` fills.
- **The tier list is derived, not authored.** A tier list generated by sorting win rate is a tier
  list that is wrong the week a brawler is released (tiny sample, inflated by novelty) and wrong the
  week after a nerf (lagging sample). Their `popularity_trap` / `inflation_bias` equivalents do not
  exist. BrawlMeta already computes exactly those flags.

**How to beat it:** put on every map page the five things their data model cannot carry — sample
size, rank bracket selector, patch selector, a Bayesian-shrunk win rate with a confidence interval,
and a recency-vs-patch trend chip. Then add the thing no one has: **counter-aware pick advice**
("against the comp you're facing"), not a static list.

---

## 8. Brawler pages

**What it is (VERIFIED, search-meta):** `/brawlers` is titled "All 106 Brawl Stars Brawlers Ranked
— Tier List & Meta (2026)". Individual pages (`/brawlers/{scId}`, also `/brawlers/detail/{Name}`)
are titled "{Name} — Brawl Stars Best Build, Stats & Tips" and show: health/damage stats, class,
star powers, gadgets, gears, skins, tier ranking, win rates, and (per indexed copy) "Season Trophy
Progression, Mode Breakdown with battle results per game mode, and Map Statistics".

**Data source:** everything except the win rates is a direct render of `/v1/brawlers` (which is
itself the game's CSV data) — `description`, `descriptionHtml`, `starPowers[]`, `gadgets[]`,
`imageUrl`, `rarity`, `class` are literally API fields (section 1.2, VERIFIED code). Win rates come
from their aggregation.

**Critique:**
- **The majority of a brawler page is an API dump with a skin on it.** Kit's page and Bull's page
  differ only in the CSV rows behind them. There is no authored strategy content that a competitor
  could not generate in an afternoon from the same endpoint.
- **"Best Build" is the page's headline claim and the API has no build data.** `/v1/brawlers`
  returns the *list* of star powers and gadgets, not which one wins more. **INFERRED:** the "best
  build" is either pick-frequency among high-trophy players or editorial. Either way it is
  unlabelled, and frequency-among-good-players is a popularity measurement, not a performance one.
  Nothing in the public data model supports a per-star-power or per-gadget win rate — which means
  **a competitor that computes real per-loadout win rates has an uncontested feature**. Battle logs
  do expose loadouts, so this is buildable.
- **No matchup data.** No "who counters this brawler", no "who pairs with them". BrawlMeta's
  `vs_brawler` / `with_brawler` jsonb is exactly this and has no analogue on their site.
- **No historical performance.** No "win rate across the last 5 patches", no "this brawler was
  nerfed and dropped 4 points". The 2026-in-the-title framing implies currency but the underlying
  object has no time axis at all.
- **Gears are shown but there is no gear endpoint in `/v1`** (VERIFIED: the endpoint list in 1.1 has
  no gears route). **INFERRED:** gears are hand-maintained or scraped separately, which means they
  are the most likely thing on the page to be stale after an update.
- **No dedicated `/gadgets`, `/star-powers`, or `/gears` index found in the index** — those appear
  to exist only as sub-sections of a brawler page. If a cross-brawler "which gadgets win most" view
  exists, it is not indexed; treat "they don't have it" as INFERRED.

---

## 9. Cosmetics (skins / pins / sprays / emotes / icons)

**Findings are mostly negative and should be treated carefully.**

- **VERIFIED (search-meta):** skins appear *within* individual brawler pages ("skins that can be
  unlocked with gems, bling, or through special events").
- **VERIFIED (code):** player icons and club badges are a real API surface (`/v1/icons`) with
  `requiredTotalTrophies`, `isReward`, `isAvailableForOffers`, `brawler` linkage.
- **NOT FOUND:** a consolidated `/skins`, `/pins`, `/sprays`, or `/emotes` index. A targeted search
  returned no such indexed page. **INFERRED (from absence):** either these do not exist as
  standalone sections or they are not indexed. **This needs human confirmation before anyone plans
  around it.**

**Critique:** cosmetics are pure catalog — zero analytical value, high maintenance cost (every
update adds skins), and no competitive relevance. For a site positioning on *meta and stats*, a
cosmetics browser is a traffic play, not a product. **Recommendation for BrawlMeta: do not build
this.** It is the clearest example on the site of surface area that looks like a feature list item
and generates no decisions. The one exception worth stealing is the `/v1/icons` data as a *free
asset source* for rendering player avatars on profiles.

---

## 10. Draft / ban-pick tools — THE BIGGEST GAP

**VERIFIED (by absence, with a targeted search):** a search for a Brawlify tools/draft/simulator
page returned **no brawlify.com result at all**. What it returned instead was the competitive set
that actually occupies that space:

- `powerleagueprodigy.com/plprodigy` — "AI-powered draft tool with expert pick & ban recommendations… master-level pick & ban simulator"
- `bspro.gg/draft` — "Draft simulator with all brawlers, gadgets, star powers, and hypercharges"
- `brawldraft.netlify.app` — "advanced analytics, win rate statistics, team composition guides, competitive leaderboards"
- `metapick-ai.com` — "free ranked assistant… draft tools, brawler stats, tier lists"
- `bs-drafting.netlify.app` — create a draft and share it

**This is the single most important strategic finding in this document.**

1. **Brawlify does not appear to have a draft assistant.** Their contribution to drafting is a
   static per-map "best brawlers" list and a `teamStats` popularity table. They are a *reference*
   site, not a *decision* tool.
2. **BrawlMeta's real competitor for its flagship feature is therefore NOT Brawlify** — it is PL
   Prodigy, bspro.gg, BrawlDraft and MetaPick AI. Any plan that benchmarks the Draft Assistant
   against Brawlify is benchmarking against the wrong opponent and will feel falsely comfortable.
   **Recommend a dedicated follow-up research pass on those four sites** (all of which appear
   unblocked-adjacent; note `bspro.gg` etc. were not probed and may also be blocked).
3. **Conversely, Brawlify's absence here is BrawlMeta's opening.** The highest-leverage position is
   "the stats site that is also the draft tool" — reference *and* decision in one place, with the
   stats actually feeding the advice rather than sitting next to it. Neither Brawlify (stats, no
   draft) nor the draft tools (draft, thin stats) currently occupy it.
4. Note the competitors' feature vocabulary: **hypercharges** appear in bspro.gg's copy. Confirm
   BrawlMeta's engine and config account for hypercharge, since it is now a first-class draft
   consideration and is absent from the `/v1/brawlers` schema entirely (VERIFIED: no hypercharge
   field in `RawBrawlifyBrawler`) — meaning Brawlify's own data model has not caught up either.

---

## 11. Clubs and rankings

**What it is (VERIFIED, search-meta):**
- `/rankings` — "Top 200 Players & Clubs Live"; global and **per-country** leaderboards; also top
  players **per brawler**.
- `/rankings/clubs` — clubs ranked by combined member trophies; the indexed page names the #1 club
  ("Heaven🍁, 30 members, 7,461,976 trophies"), so it renders real live values.
- `/club/{TAG}` and `/stats/club/{TAG}` — club profile: member list, description, club stats.
- **A "Quality Score" for clubs**, explicitly weighted: **total trophies 30%, average member
  trophies 35%, roster size 15%, percentage of elite members 20%.**
- Premium adds **"club activity logs"** (VERIFIED, `/about/premium`).

**Data source:** Supercell's official rankings + club endpoints, proxied. The Quality Score is
hand-authored by Brawlify. (**VERIFIED (search-meta):** "top 200 charts for players, clubs and every
brawler — updated directly from the Supercell API".)

**Critique:**
- **Leaderboards are a pure API mirror.** Supercell publishes top-200 by country and by brawler;
  rendering it is not a product. Everyone has it, including BrawlMeta (`top_200_leaderboard`).
- **"Top 200" is a hard ceiling imposed by Supercell**, so the leaderboard cannot answer "where do I
  rank" for 99.99% of players. Nobody solves this by mirroring; you solve it by computing your own
  percentile from your own player warehouse — which requires snapshotting profiles (see 3.4).
- **The Quality Score is unvalidated numerology.** Four arbitrary weights summing to 100%, three of
  which (total trophies, average member trophies, % elite members) are near-collinear — they all
  measure "the members have lots of trophies". Roster size at 15% mostly rewards being full. There
  is no stated objective it predicts (retention? club league performance? activity?), so it cannot
  be right or wrong, which is the problem. It is a *number that looks like analysis*. Calling this
  out matters because it is exactly the trap a competitor building a "club rating" would fall into.
- **Club activity logs behind Premium** repeats the profile-history pattern: the genuinely useful
  longitudinal view is the paid one; the free view is a live snapshot.
- **No club-level competitive data.** Nothing about ranked performance, club league results by
  member, or roster churn over time — all of which are computable from repeated snapshots and none
  of which they show for free.

**How to beat it:** free percentile ranking for *every* player (not top-200), free club history and
roster-churn timeline, and — uniquely available to BrawlMeta — **tie clubs to the tournament
product**: club-vs-club brackets, club leaderboards derived from actual tournament results rather
than from summed trophies. That is a metric with a real objective behind it, which is precisely what
their Quality Score lacks.

---
## 12. Discord bot, apps, and ecosystem reach

**VERIFIED (search-meta):**
- Brawlify is described as "centered around a website (brawlify.com), **a Discord bot**, and other
  projects running around Brawl Stars" (https://discord.do/brawlify/).
- The bot serves: **player profiles, club info, upcoming events, brawler info, Trophy Graphs**
  (explicitly "track progression of your trophies with friends and compare them"), and
  **server leaderboards** — best on the server, per-brawler, highest trophies, most wins, showdown.
- Server config: language, channel restriction, custom prefix, link-conversion toggle.
- Localized into English, Portuguese, Chinese, German, Spanish, Finnish, French and others.
- The predecessor bot is listed on top.gg as **"Star List"** (`top.gg/bot/517368847322447873`),
  confirming the Star List → Brawlify rename (matches the `pro.starlist.app` package name).
- Native apps: iOS `1541845276`, Android `pro.starlist.app`, publisher **MWM**.
- **CDN**: `cdn.brawlify.com`, backed by the public `Brawlify/CDN` GitHub repo (66 stars, 26 forks,
  last updated 2026-08-16) described as "Public Brawl Stars CDN from Brawlify **free to use for
  everyone**, mostly used by developers of their own projects". *(I could not read that repo's
  README — the GitHub MCP tool in this session is scoped to `bolyhocska/brawlmeta` only — but the
  repo metadata above is VERIFIED via repository search.)*

**Critique:**
- **The ecosystem, not the website, is the actual moat.** Website + Discord bot + two mobile apps +
  a public API + a public CDN that half the third-party tooling depends on. A competitor that only
  beats the website has beaten the least important asset.
- **The Discord bot is the most under-appreciated distribution channel here.** "Server leaderboards"
  and "compare trophy graphs with friends" put their brand inside every Brawl Stars community
  server, permanently, for free. The site is downstream of the bot, not the other way round.
- The bot duplicates the site's paywalled feature (trophy graphs) in a social framing, which is
  smart product design and undercuts the argument that history is expensive to serve.
- **INFERRED:** publishing the mobile apps under a third-party studio (MWM) suggests the apps are
  monetized/operated at arm's length. That is a brand-control weakness — app-store reviews and
  ad experience are not fully theirs.

**How to beat it:** a website-only competitor loses on distribution regardless of data quality.
The cheap counter-moves, in order of leverage: (1) a Discord bot that posts **tournament** brackets,
results and lobby invites — something Brawlify's bot structurally cannot do because it has no
tournament product; (2) rich Discord link embeds (OpenGraph) for every BrawlMeta URL so pasted links
render as cards; (3) a public API with the dimensions theirs lacks, to start pulling third-party
developers off `api.brawlify.com`.

---

## 13. Performance, caching, mobile, ads — HONEST STATUS

**I could not render a single brawlify page. Everything in this section is INFERRED and must not be
quoted as observed.** What can be said with evidence:

- **The API layer is genuinely fast and cached.** **VERIFIED (search-meta):** BrawlAPI is "served
  straight from Cloudflare Pages, so it is fast, cached, and needs no key". Static JSON on a CDN is
  the right architecture for catalog data.
- **The API blocks datacenter IPs.** **VERIFIED (code):** `Itxialdiak/brawl-tracker` documents
  `api.brawlify.com` returning **403 to datacenter IPs even with browser User-Agent**, and ships a
  `probe()` to test egress before depending on it. Practical consequence for BrawlMeta: any
  server-side use of their API or CDN needs the existing Webshare static-IP proxy path, and should
  be treated as a source that can vanish.
- **Freshness claims are internally inconsistent** (VERIFIED, search-meta, from their own pages):
  "updated **hourly**", "updated **daily**", "updated **in real time**", "served fresh **every few
  minutes**", and "updated **every rotation**" all appear across `/`, `/stats`, `/maps` and
  `/about`. At least three of those cannot simultaneously describe the same pipeline. **This is a
  concrete, quotable credibility weakness**: a competitor that puts an explicit
  "stats as of {timestamp}, n = {sample}" line on every stats surface wins the honesty comparison
  outright, and BrawlMeta already stores `collected_at` and `dataUpdated`-equivalents to do it.
- **Ads:** confirmed present and confirmed as a primary revenue source (§4). Density, placement and
  their layout impact are UNVERIFIED.
- **Mobile:** two native apps exist, implying the mobile web experience is at minimum a funnel to
  them. Actual responsive behaviour UNVERIFIED.
- **Audience (VERIFIED, search-meta via Similarweb):** ~48.6% of desktop visits from organic search
  (direct 2nd, referrals 3rd); audience 72% male; largest cohort 18–24. **Read: they are an
  SEO-driven property.** Their per-map and per-brawler pages exist in the shape they do because
  "{map} best brawlers" is a search query. A competitor that does not take SEO seriously will not
  reach their users no matter how much better the analysis is.

---

## 14. Competitive landscape around Brawlify

**VERIFIED (search-meta, Similarweb):** brawlify.com's nearest competitors by monthly visits are
**brawltime.ninja** (#1), **brawlstats.com** (#2), **noff.gg** (#3). Also present in the space:
**brawlytix.com** (already used by BrawlMeta's masters scraper for top-200 seeding) and
**brawlfind.com**.

**VERIFIED (search-meta), the draft-tool cluster** (see §10): powerleagueprodigy.com, bspro.gg,
brawldraft.netlify.app, metapick-ai.com, bs-drafting.netlify.app.

**Reading of the landscape:**
- The market is split into **reference sites** (Brawlify, brawltime, brawlstats, noff) and
  **draft tools** (the cluster above). Nobody credibly holds both.
- Brawlify wins the reference segment on distribution (bot + apps + API + CDN + SEO), not on depth.
- **BrawlMeta's tournament product has no competitor in either segment.** No site in this landscape
  runs automated brackets with OCR result reporting and wallet payouts. That is the genuinely
  defensible asset; the stats/draft side is the acquisition funnel for it.

---

## 15. Summary — where Brawlify is weakest, ranked by exploitability

1. **No sample size, no rank bracket, no patch, no timestamp on any stat.** VERIFIED from the API
   schema itself (§1.2). BrawlMeta has all four already stored. Highest-leverage, lowest-cost win.
2. **No historical dimension anywhere in the public data model.** No trend, no patch-over-patch, no
   rotation history. Requires only that you keep what you already collect.
3. **No draft assistant at all** (§10). Their drafting story is a static list; BrawlMeta's is an
   engine. But the real competitors here are the draft-tool cluster, not Brawlify.
4. **Personal history paywalled at $4.99/mo, opt-in, daily-resolution, non-retroactive** (§3).
   Free + automatic + per-battle beats it on every axis, and aligns with "players never pay".
5. **No matchup/counter/pair data.** `vs_brawler` / `with_brawler` have no analogue on their site.
6. **No per-loadout (star power / gadget / gear) win rates**, despite "Best Build" being the
   headline of every brawler page. Buildable from battle logs; currently unoccupied.
7. **Inconsistent freshness claims** (§13) — a direct credibility attack surface.
8. **Unvalidated composite metrics** (club Quality Score, §11) presented as analysis.
9. **Three entity types with duplicate URL families** (§5) — SEO and deep-link damage.
10. **Cosmetics/catalog bloat** with no analytical value — a trap to avoid copying, not a gap to fill.

**Where they are strong and should NOT be attacked head-on:** the event-rotation feed (free data,
everyone has it), the asset CDN (use theirs), the raw catalog API (use theirs), and their
distribution via Discord bot + apps + SEO (must be answered with distribution, not with features).

---

## 16. What still needs human eyes (BLOCKERS for the implementation plan)

Because brawlify.com never rendered in this session, the following are **not** established and
should be confirmed by someone with an unblocked browser before any plan depends on them:

1. Actual nav structure and IA of the homepage — I inferred the site map from indexed URLs only.
2. Whether `/skins`, `/pins`, `/sprays`, `/emotes`, `/gadgets`, `/star-powers`, `/gears` exist as
   standalone index pages (§8, §9 — currently INFERRED-from-absence).
3. Whether any draft/ban-pick or randomizer tool exists anywhere on the site (§10). This is the
   single most consequential open question in this document.
4. What an **untracked** player profile actually looks like versus a tracked one — how empty the
   free experience really is (§3.2). Load a tag that has plainly never been visited.
5. Whether player pages show any **ranked/Masters** data at all, or are purely trophy-centric (§3.3).
6. Ad density and placement; real mobile behaviour; first-paint and interaction latency (§13).
7. The actual text of their API terms of use / attribution requirements — I found no terms page.
   **Do not mirror their CDN or API in production until someone reads it.**
8. A pass over the four real draft-tool competitors (PL Prodigy, bspro.gg, BrawlDraft, MetaPick AI)
   — they, not Brawlify, are the benchmark for BrawlMeta's flagship feature.

---

STATUS: complete
