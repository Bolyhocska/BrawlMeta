# Beating Brawlify on Player Stats — Evaluation & Implementation Plan

**Date:** 2026-08-19 · **Branch:** `claude/brawlify-feature-analysis-rj9xws`
**Backing research:** `research/W1-brawlify-inventory.md`, `research/W2-stat-tracking-landscape.md`,
`research/W3-codebase-audit.md`

---

## 0. Read this before anything else — three findings that change the plan

### 0.1 We store no player identity. None. Anywhere.
`ranked_matches` stores brawler ids only: the insert is exactly
`{match_hash, map_id, bracket_id, patch_id, w1..w3, l1..l3}` (`scrapers/common.py:416-423`).
Player tags are harvested from `teams[].tag` purely to expand the spider frontier and are then
**discarded** (`common.py:283-289`). `battleTime` is read only to resolve the patch and is
**discarded** (`common.py:307`).

**Consequence:** our 1.5M-row archive can power *none* of the player-stat features in this plan.
There is no retroactive path — the Supercell battlelog is a ~25-battle rolling buffer that does not
back-fill. **Every day without a player-level collector is a day of history that can never be
bought back.** This is why Phase 1 below is a collector with no UI attached to it.

### 0.2 A pre-existing dedupe bug is biasing the tier list against meta comps
`make_hash` = md5 of `map + mode + bracket + sorted(winners) + sorted(losers)`
(`common.py:215-222`) — **no timestamp, no player tags, and no patch**. With
`on_conflict=match_hash&ignore-duplicates` (`common.py:429`) this means:

1. Two genuinely different games with the same 6 brawlers on the same map+bracket collapse into
   **one row, permanently**.
2. Patch is a column but **not** in the hash, so a new-patch match whose comp already occurred in an
   older in-window patch is dropped as a duplicate and the old row keeps its old `patch_id`.

Collisions are not uniform — they scale with how often a comp is actually played, so the loss lands
almost entirely on the **head** of the distribution. Direction of bias: **the most-played comps are
the most under-counted**, which is exactly what pick rate and win rate for meta brawlers are
computed from. Effect (2) additionally corrupts the opening days of every new patch.

**Status: flagged, NOT fixed.** The docstring says the formula is deliberately identical to the
historical one to preserve dedupe continuity, so changing it is an owner decision: it re-admits
every previously-collapsed match, the row count jumps, and the 1.5M FIFO window churns faster
(Core principle 5). **This is not a side effect to slip into the tracker work.**
Magnitude is a code-derived inference, not a measurement — see §7.1 for the cheap way to measure it.

### 0.3 Our organizer-subscription revenue line may violate Supercell's Fan Content Policy
> "You are **not permitted to charge a fee of any kind** … from customers or visitors to your Fan
> Content, unless this has expressly been approved by Supercell." Exceptions: **ads, donations,
> coaching**.

A B2B organizer subscription is none of the three, and an organizer is a visitor to our fan
content. Separately, the Tournament Guidelines state tournaments must be **"free to enter for the
players — no exceptions, including membership fees or season passes"** — which our "players never
pay" principle already satisfies, and which is now confirmed as Supercell's rule, not just ours.

**This does not block the stats plan** (all of it is free-to-player, which is the safe side of the
policy). It is flagged because it affects how the site is funded. The policy has an explicit
approval path — "unless expressly approved by Supercell" — and Brawlify operates with a Creator
Code, so the relationship is obtainable. **Recommendation: ask Supercell in writing before building
more billing.** Details and citations in `W2 §3.1-3.3`.

---

## 1. Research confidence — what is solid and what is not

`brawlify.com`, `api.brawlify.com`, `api.brawlstars.com` and several competitor domains are
**blocked by this environment's egress policy** (403 at the gateway). The research agent correctly
reported this rather than routing around it via caches or mirrors.

| Claim class | Confidence | Basis |
|---|---|---|
| Supercell API surface, fields, limits | **High** | Our own working production code parses it (`common.py`, `api/player.js`) + public wrapper sources |
| Our own codebase & schema | **High** | Read directly, `file:line` cited |
| Supercell Fan Content / Tournament policy | **High** | Verbatim policy text |
| *Which* features Brawlify has | **Medium** | Search-index metadata of Brawlify's own pages |
| **How good Brawlify's UI/UX is** | **Low — inferred** | Not a single page could be rendered |

**Therefore:** the plan below is built on the high-confidence layers (the API's limits, our schema,
the policy) and never depends on a UI judgement. The §2 critique is included because it was asked
for, but the items marked *inferred* need a human with an unblocked browser before they are used to
justify build-vs-skip decisions. **Action for the owner: screenshot or allowlist Brawlify's
player pages** — that is the one input this analysis could not get.

---

## 2. Harsh evaluation of Brawlify's player stat tracking

The single structural fact: **Brawlify's player history is opt-in and paywalled.** Tracking is
enabled by a 7-day "Free Boost" or by Premium ($4.99/mo, which advertises "automatic profile
updates" and "continuous tracking of your trophy progression"). An untracked tag renders one live
Supercell call with a near-empty graph.

| # | Weakness | Why it is a real weakness | What we do instead |
|---|---|---|---|
| 1 | **Charging for your own history** | The trophy graph only exists because you visited. Gating a user's own past behind $4.99/mo is the least defensible paywall on the site — and it's their flagship feature. | Free, permanent, universal. Matches "players never pay" *and* the Fan Content Policy. |
| 2 | **Daily resolution** | One end-of-day trophy point cannot show a push session, a tilt streak, or an intra-day collapse. Brawl Stars is played in 45-minute sessions; day-granularity is chosen for storage cost, not information. | Per-battle resolution from the battlelog. Strictly finer, same data cost. |
| 3 | **The battle log is a formatted dump** | Teams, brawlers, loadouts, trophy change — every field is passed straight through from Supercell. Filtering by brawler/mode/map is table-stakes UI, not insight. Nothing computes your WR *vs the population*, your map weaknesses, or who beats you. | Every match gets a verdict (§4, P2-7). |
| 4 | **"Best brawlers" sorted by trophies** | Trophies measure time invested, not skill or form. A player's "best" brawler by trophies is usually just their oldest. | Rank by WR vs a **bracket-matched baseline**, with confidence intervals. |
| 5 | **Trophy-centric, ranked-blind** | All indexed copy is trophies — graph, heatmap, leaderboards. The competitive population lives in Ranked/Masters. *(inferred from absence — verify)* | We are the only project whose entire archive is bracket-partitioned. Lead with ranked. |
| 6 | **The activity heatmap is a gimmick** | It is a GitHub contribution graph. It tells a player "you played a lot on Saturday", which they knew. Zero decision-relevant information — but it screenshots well, which is why it exists. | Replace with session/tilt analysis: same timestamps, actual insight (§4, P1-2). |
| 7 | **History starts when tracking starts** | Structurally unavoidable for them *and* for us. Whoever starts snapshotting earlier wins, and the lead compounds. | **This is the argument for shipping the collector before the UI.** |

**Category-wide gaps** (not just Brawlify — nobody in Brawl Stars does these): no per-match detail
page, no bracket separation, no personal-vs-global comparison, no session/tilt analysis, no
teammate/social layer, no alerts, no seasonal recap, and every "rating" on the market
(Brawlytix Account Value, Brawl Time percentile) **measures spending and grinding, not skill**.

**The honest counterpoint:** Brawlify is the category leader on *coverage* — cosmetics, events,
maps, a public API, a Discord bot, and a real CDN that we ourselves hotlink for brawler art
(`src/appCore.js:40,54`). We should not pretend their site is bad. We should attack one axis where
they are structurally weak — **analytical depth on player data** — and not try to out-catalogue them.
Also note that CDN dependency is a live supply-chain risk: they can hotlink-block or rename paths
at any time (§7.5).

---

## 3. Strategic thesis

> **Stored history is the only defensible asset in this game, and we are not storing any.**

The Supercell API is a snapshot service with a 25-battle rolling buffer. It exposes **no** win/loss
counters, **no** trophy history, **no** ranked tier, **no** mastery, and **no** box score. Every
statistic any Brawl Stars site shows is *derived* from stitched-together polling. That means:

1. Whoever polls earliest and most often has data nobody can replicate later.
2. Our two genuine, non-copyable advantages are the **bracket-partitioned archive** and the
   **draft engine** (`draftEngine.js`, `computeWinSplit`, `brawler_intelligence.vs_brawler`).
   A competitor can copy a trophy graph in a weekend. They cannot copy a draft verdict.
3. Because we cannot charge players, our strategy must be *distribution*, not conversion — which
   points at Discord (where this community actually lives) rather than a premium tier.

**The wedge, in one sentence:** *Brawlify tells you what you did; we tell you whether it was any
good, measured against a bracket-matched baseline, for free.*

---

## 4. What to build, prioritized

Ranked by (differentiation × reachability) ÷ cost. Everything here is derivable from the official
API plus history we store ourselves — nothing needs a source we can't legally get.

| # | Feature | Why it wins | Cost |
|---|---|---|---|
| **P0** | **Player-level match collector** | Prerequisite for everything else. Nothing below works without it. Start the clock now. | 1 migration + ~150 lines |
| P1-1 | **"You vs the world"** — personal WR per brawler/map against our *bracket-matched* `true_win_rate` | Nobody compares a player to a bracket-matched baseline. Reuses the Bayesian machinery and confidence-honest UI language we already ship. | Low |
| P1-2 | **Session & tilt report** — games/session, WR by game-index-in-session, WR after a loss, WR by hour/weekday | Pure timestamp math. Completely absent from the category. Highest "coaching" feeling per unit of effort. | Low |
| P1-3 | **Recently played with** — W-L per teammate tag, best/worst partners vs your solo baseline | Free from `teams[].tag`. op.gg proved the social stickiness. Zero Brawl Stars sites have it. | Low |
| P1-4 | **Personal matchup table** — your WR with X vs enemy Y / alongside Z | The personal version of our existing `vs_brawler`/`with_brawler`. RPC pattern already exists. | Low-Med |
| P1-5 | **Star Player rate as a carry metric**, vs the 1-in-6 baseline | In every payload, aggregated by nobody. | Very low |
| P2-6 | **Per-match page with a draft verdict** — `computeWinSplit` on the finished draft: *"this was a 61/39 matchup edge and you lost it"* | **The most defensible feature we can ship.** Nobody in Brawl Stars has a per-match page at all, and nobody else has a draft engine to grade it with. Not copyable in a weekend. | Med |
| P2-7 | **Trophy & progression history** from `/players` snapshot diffing | Table stakes (Brawlify/brawlace have it) — but free and per-battle where theirs is paywalled and daily. | Med |
| P2-8 | **Derived ranked-strength estimate with a *published* method** | The API hides ranked entirely; the hidden number is the most-searched number in the game. Transparency about the formula *is* the differentiator. | Med-High |
| P3 | Discord bot (saved identity, club board, session report); shareable recap cards; performance-percentile leaderboards; alerts | Distribution, not conversion — the correct strategy when players can never pay. | Med |

**Explicitly out of scope — do not plan around these.** Damage/kills/objective box scores, mastery
points, official ranked tier/Elo, per-brawler win counters, and any battle older than the 25-battle
buffer we didn't capture. **None exist in the API.** Anything a competitor displays in these
categories did not come from the public API and is not a reachable baseline.

---

## 5. Concrete implementation

### 5.1 Schema — three new tables

All three follow the house rules: RLS enabled, `"Public read access"` SELECT policy for
`anon, authenticated`, writes via service role. All get `ANALYZE` after first bulk load.
**None of them are touched by `prune_ranked_matches`** — they carry their own retention (§5.4).

```sql
-- 1) The poll registry. Who we track, how often, and when next.
CREATE TABLE tracked_players (
  player_tag      text PRIMARY KEY,               -- canonical, no '#', uppercase
  display_name    text,                           -- last seen in-game name
  tier            smallint NOT NULL DEFAULT 3,    -- 0 claimed, 1 tournament, 2 looked-up, 3 seeded
  poll_interval   interval NOT NULL DEFAULT '24 hours',
  next_poll_at    timestamptz NOT NULL DEFAULT now(),
  last_polled_at  timestamptz,
  last_battle_at  timestamptz,                    -- newest battleTime we've stored
  consecutive_empty smallint NOT NULL DEFAULT 0,  -- drives back-off
  active          boolean NOT NULL DEFAULT true,
  first_seen_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tracked_players_due_idx ON tracked_players (next_poll_at) WHERE active;
CREATE INDEX tracked_players_tier_idx ON tracked_players (tier, next_poll_at) WHERE active;

-- 2) The history. One row per (battle, tracked player) — denormalized so a profile
--    page is ONE index scan with no joins.
CREATE TABLE player_matches (
  match_key     uuid NOT NULL,        -- md5(battleTime + sorted(all 6 tags)) — IDENTITY-based
  player_tag    text NOT NULL,
  battle_time   timestamptz NOT NULL,
  map_id        smallint REFERENCES maps(id),
  bracket_id    smallint REFERENCES rank_brackets(id),
  patch_id      smallint REFERENCES patches(id),
  brawler_id    smallint NOT NULL REFERENCES brawlers(id),
  result        smallint NOT NULL,    -- 1 win, 0 loss, 2 draw
  is_star_player boolean NOT NULL DEFAULT false,
  trophy_change smallint,
  team_brawlers  smallint[] NOT NULL, -- 3 brawler ids incl. self
  enemy_brawlers smallint[] NOT NULL,
  team_tags      text[] NOT NULL,     -- powers "recently played with"
  enemy_tags     text[] NOT NULL,
  collected_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_key, player_tag)
);
-- primary access pattern: one player's history, newest first
CREATE INDEX player_matches_player_time_idx ON player_matches (player_tag, battle_time DESC);
-- per-match detail page
CREATE INDEX player_matches_key_idx ON player_matches (match_key);
-- "your brawler vs the world"
CREATE INDEX player_matches_player_brawler_idx ON player_matches (player_tag, brawler_id);
-- retention sweeps
CREATE INDEX player_matches_collected_idx ON player_matches (collected_at);

-- 3) Snapshot diffing for trophy/progression curves. Cheap and small.
CREATE TABLE player_snapshots (
  player_tag     text NOT NULL,
  taken_at       timestamptz NOT NULL DEFAULT now(),
  trophies       integer,
  highest_trophies integer,
  exp_level      smallint,
  victories_3v3  integer,
  solo_victories integer,
  duo_victories  integer,
  brawlers_owned smallint,
  maxed_brawlers smallint,
  club_tag       text,
  brawler_trophies jsonb,   -- {brawler_id: trophies} for per-brawler curves
  PRIMARY KEY (player_tag, taken_at)
);
CREATE INDEX player_snapshots_time_idx ON player_snapshots (taken_at);
```

**Why `match_key` is `md5(battleTime + sorted(all 6 tags))` and not the existing `make_hash`:**
the existing composition hash collapses distinct games (§0.2). An identity-based key cannot. This
also means the two tables are deliberately **not** joinable on hash — that is correct, they answer
different questions, and `player_matches` must never inherit the collision bug.

### 5.2 The collector — `scrapers/player_tracker.py`

**Refactor first (small, and it prevents a fork):** extract the battle-parsing body of
`fetch_player_battles` (`common.py:288-325`) into a shared
`parse_battle(battle, player_tag) -> dict | None` that returns the **rich** record (battle time,
map, mode, bracket, result, all six tags + brawlers, star player, trophy change). Then:
- `common.py`'s spider projects it down to the brawler-only shape it stores today — **behaviour
  unchanged, zero risk to the existing pipeline**;
- the new tracker keeps the full record.

Reused as-is: the `requests` session + `PROXIES`, `determine_patch`, `CLOSED_PATCHES`,
`RANKED_MAPS`, `lookups.*`, and the batched-insert discipline (`INSERT_BATCH_SIZE`,
`DB_BATCH_DELAY`, `on_conflict=...&ignore-duplicates`, `return=representation`).

```
main():
  due = GET tracked_players WHERE active AND next_poll_at <= now()
        ORDER BY tier ASC, next_poll_at ASC LIMIT MAX_POLLS_PER_RUN
  for tag in due (thread pool, same pattern as harvest_bracket):
      battles = GET /players/{tag}/battlelog        # 1 request per player
      rows    = [parse_battle(b, tag) for b in battles]
      rows    = [r for r in rows if r and r.battle_time > last_battle_at]   # incremental
      save_player_matches(rows)                     # batched, ignore-duplicates
      update_poll_schedule(tag, len(rows), battles)
  call RPC prune_player_matches()
```

**Adaptive polling — the part that actually matters.** The battlelog holds only ~25 battles, so a
fixed interval either wastes requests on inactive players or silently loses history for active
ones. Feedback rule:

| Observed on this poll | Action |
|---|---|
| ≥ 20 new battles (we are being outrun — data was lost) | `poll_interval := max(1h, interval / 2)` |
| 5–19 new | keep interval |
| 1–4 new | `poll_interval := min(48h, interval × 1.5)` |
| 0 new, 3 polls running | `poll_interval := min(7d, interval × 2)`, and at 7d set `active = false` |

Tier floors so a claimed profile is never backed off into uselessness:
T0 claimed ≥ 3h · T1 tournament ≥ 6h · T2 looked-up ≥ 12h · T3 seeded ≥ 24h.

**Seeding the universe on day one, at zero marginal cost:** `top_200_leaderboard`,
`masters_players` and `diamond_mythic_players` already exist and already hold exactly the
competitive tags we most want history for. One `INSERT ... SELECT` seeds `tracked_players` at
tier 3 before a single user has visited.

**Workflow:** `.github/workflows/track-players.yml`, cron `17 1,9,15,21 * * *` — deliberately
offset from masters (`0 0,6,12,18`), leaderboard (`0 5,11,17,23`), diamond (`30 7`) and
intelligence (`30 8`) so it never contends with them for the shared API key. `workflow_dispatch`
like the others.

### 5.3 Rate budget (the real constraint — not Actions capacity)

One battlelog poll = one request. Budget is bounded by the **single IP-allowlisted Supercell key
shared with 4 scrapers and the live `/api/player` endpoint**.

| Tracked players | Polls/day (mixed tiers) | Mean req/s |
|---|---|---|
| 1,000 | ~2,000 | 0.02 |
| 10,000 | ~25,000 | 0.29 |
| 50,000 | ~120,000 | 1.4 |

Comfortable to ~10k tracked players; beyond that it needs measurement. **`MAX_POLLS_PER_RUN` is the
throttle** — set it low (500) on first deploy and raise it while watching for 429s.
Two hedges worth having: (a) read `x-ratelimit-remaining` off responses and back off on it rather
than guessing; (b) configure `bsproxy.royaleapi.dev` as a **failover path** — it is free and removes
the static-IP requirement, so it de-risks our single-proxy dependency. Keep Webshare primary
(a third-party proxy is both a dependency and a privacy consideration).

### 5.4 Retention — decided up front, not after it hurts

`ranked_matches` needed emergency windowing at 1.5M rows. `player_matches` grows faster. So it ships
with retention from day one, as `prune_player_matches` — a **separate** RPC, modelled on
`prune_ranked_matches` but never invoked by it:

1. **Per-player FIFO cap** — keep the most recent `PLAYER_MATCH_CAP` (start 1,000) rows per
   `player_tag`, by `battle_time`. Bounds any single heavy player.
2. **Global age cap** — delete rows older than `PLAYER_MATCH_MAX_AGE` (start 365 days).
3. **Inactive sweep** — when `tracked_players.active = false` for 90 days, drop that player's rows.

Following the hard-won RPC lessons: compute the keep-set into a **TEMP table**, swap last so the
exclusive lock covers the delete rather than the scan; **no big sort or DISTINCT** (temp space is
far smaller than the DB — a `DISTINCT` over ~29M rows already died with 53100 once); and remember a
PostgREST 504 does **not** mean the statement failed or released its locks.

Rough sizing: 10k tracked players × 1,000-row cap ≈ 10M rows worst case, but realistic activity puts
it near 2–3M. `player_snapshots` at one row/player/day ≈ 3.6M/year at 10k players — small.

### 5.5 API layer — `api/`

**Refactor first:** `api/player.js` currently inlines its `ProxyAgent` construction and a hardcoded
projection (`api/player.js:25-33`, `:47-62`). Lift the Supercell client into
`api/_lib/supercell.js` (one place that knows about the undici gotcha — *undici's own `fetch`, and
proxy auth as an explicit `token`, never URL userinfo*) and let each route project down. Otherwise
that 20-line block gets copy-pasted into five new endpoints.

| Route | Does | Notes |
|---|---|---|
| `GET /api/player?tag=` | **exists** — live card | Keep. Add a fire-and-forget `tracked_players` upsert at tier 2 so **every lookup enrols that tag** (§6, the "a lookup is a subscription" move). |
| `GET /api/player-profile?tag=` | Live `/players` call **merged with** our stored aggregates | Must degrade honestly when we have no history yet (§7.3). |
| `GET /api/player-matches?tag=&cursor=` | Paginated history from `player_matches` | Keyset pagination on `(battle_time DESC)`, never OFFSET. |
| `GET /api/player-insights?tag=` | Sessions, tilt, streaks, teammate synergy, vs-global deltas | Heavy — cache per tag; recompute on new data only. |
| `GET /api/match?key=` | Per-match page data + **draft verdict** | Runs `computeWinSplit` server-side on the stored comps. |
| `POST /api/track-player` | Promote a tag to a higher tier | Rate-limit by IP. Tier 0 requires auth + claim. |

**Server-side only, non-negotiable:** the service-role key never reaches the browser bundle
(frontend uses the anon `VITE_SUPABASE_KEY`), and anything premium-gated is checked in `api/`
against the DB — never trusted from the client.

**Claiming a tag interacts with an existing invariant.** Player tags are globally unique and
**freeze after the first tournament played** (anti account-selling). A "claim your profile" flow
must respect that: claiming is *not* the same as the tournament tag-freeze, and the two must not be
conflated in the same column. Recommendation: `Profiles.claimed_tag` is separate from whatever the
tournament flow freezes, and real ownership verification waits for the Supercell-API tag-ownership
check already on the roadmap. **Until then, a claim is a soft link and must not confer anything of
value.**

### 5.6 Frontend — `src/PlayerPage.jsx`

A **real route**, `/player/:tag` — shareable permalinks are the entire point of a profile page, so
this must not be a `?tab=` (and `?tab=` switches don't remount, per `App.jsx:109-112`).
Register in the top-level `<Routes>` in `App.jsx` alongside `/guides/...` and `/tournaments/...`.

Follow the house conventions exactly, because there is no design-token layer to fall back on:
inline `style={{...}}` objects, dark palette, `#94a3b8` muted text, amber accent `#ffce7a` /
`rgba(255,180,61,.12)`, `'JetBrains Mono', monospace` for numerics, `borderRadius: 999` pills.
Data via the `useState`+`useEffect` hook shape in `appCore.js`. **Format every number with
`toLocaleString("en-US")`** — the owner's browser is Hungarian and will otherwise render thousands
separators as dots.

Page structure:
1. **Header** — name, tag, icon, club, trophies (live call, always works, even with zero history).
2. **"You vs the world"** — per-brawler WR against the bracket-matched `true_win_rate`, sorted by
   the *delta*, with sample-size honesty (reuse the Draft Assistant's existing fallback language
   when the map sample is thin).
3. **Recent matches** — each row links to `/match/:key`.
4. **Sessions & form** — session clustering, WR by game-index-in-session, after-loss WR.
5. **Played with** — teammate W-L.
6. **Trophy curve** — from `player_snapshots`, once there is data.

Empty-state is a first-class design problem, not an afterthought: a brand-new tag has **zero**
stored history, and the page must say so plainly ("we started tracking this account today —
check back after a few games") rather than rendering an empty chart that reads as a bug.

---

## 6. Phasing

**Phase 0 — Measure & decide (before any feature work).**
- Instrument `save_matches` to log `attempted - inserted` split by "seen this run" vs "already in
  DB" — one log line, and it turns §0.2 from an inference into a measurement.
- Owner decision on the `make_hash` fix (§0.2) and on the Supercell approval letter (§0.3).
- Confirm the live rate-limit headroom on the shared key.

**Phase 1 — Start the clock (highest urgency, no UI).**
Schema migration; `parse_battle` refactor; `player_tracker.py`; `track-players.yml`; seed
`tracked_players` from the three existing player lists; `prune_player_matches`; `ANALYZE`.
Ship it with **no user-visible change**. This is deliberate: history accrues from the day it
deploys, and every day of delay is permanently lost data (§0.1).

**Phase 2 — Make it visible.** `/player/:tag`, the profile endpoints, enrol-on-lookup. Ships once
Phase 1 has ~2 weeks of history so the page isn't mostly empty states.

**Phase 3 — Make it analytical.** P1-1 through P1-5: vs-the-world, sessions/tilt, played-with,
personal matchups, star-player rate. This is where we pass Brawlify rather than match it.

**Phase 4 — The moat.** Per-match page with the draft verdict (P2-6). The one feature a competitor
cannot copy quickly.

**Phase 5 — Distribution.** Discord bot (saved identity, club board, session report), share cards,
performance percentile boards. Correct strategy given players can never pay.

---

## 7. Risks

1. **Rate limit vs tracked-player count** (§5.3) — the binding constraint. Mitigation:
   `MAX_POLLS_PER_RUN` throttle, header-driven back-off, RoyaleAPI proxy as failover.
2. **The 25-battle buffer guarantees holes** for very active players. Adaptive polling narrows it;
   it cannot close it. **The UI must never imply completeness** — show "tracked since <date>" and a
   coverage indicator rather than pretending the history is total.
3. **Empty-state cold start** — the product is worthless on day one for any given player and only
   compounds. This is why Phase 1 ships before Phase 2, and why enrol-on-lookup matters.
4. **The dedupe bug (§0.2) contaminates the comparison baseline.** "You vs the world" compares a
   player against an aggregate that is biased against popular comps. Either fix the hash first or
   state the caveat — do **not** ship the comparison silently on a known-biased baseline.
5. **CDN dependency on a competitor.** We hotlink `cdn.brawlify.com` for brawler, mode and gear art
   (`src/appCore.js:40,54`). They can hotlink-block or rename paths at will, and a player-stats
   product that competes with them raises the incentive. Self-host the assets before Phase 2.
6. **Storage growth** repeating the `ranked_matches` emergency — pre-empted by §5.4.
7. **Monetization exposure** (§0.3) — orthogonal to this plan, but it funds it.

---

## 8. Open decisions for the owner

1. **Fix `make_hash`?** Breaks dedupe continuity, jumps the row count, churns the FIFO window
   faster. Needs an explicit call (Core principle 5). *Recommendation: yes, but measure first
   (Phase 0), and treat it as its own change — never bundled into the tracker.*
2. **Write to Supercell** about the organizer subscription (§0.3)? *Recommendation: yes. Costs
   nothing, and it's the only way that revenue line becomes durable.*
3. **Which battle types to store** — ranked only (matches our bracket-partitioned strength and our
   existing baselines) or ranked + trophy (broader appeal, more storage, no baseline to compare
   against)? *Recommendation: ranked only in Phase 1.*
4. **Tracked-player universe** — everyone ever looked up, or opt-in only? *Recommendation:
   everyone, at a low tier. It is our direct answer to Brawlify's paywall, and it is the cheapest
   moat available. Note it is a privacy posture, not just a technical choice — but the data is
   already public via the official API, and the whole category operates this way.*
5. **Self-host brawler art** before Phase 2? *Recommendation: yes (risk 5).*
6. **Someone with an unblocked browser must do a visual pass on Brawlify's player pages** (§1) —
   the one input this analysis could not obtain.
