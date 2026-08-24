# Player Profile — Feature Spec

**Date:** 2026-08-24 · **Scope:** the `/player/:tag` experience (what Brawlify splits across
Profile / Brawlers / History / Battles).
**Inputs:** `IMPLEMENTATION-PLAN.md` §2 and §4, `research/W1-brawlify-inventory.md`,
`research/W2-stat-tracking-landscape.md`, `src/PlayerPage.jsx`, `src/data/draftEngine.js`, `CLAUDE.md`.
**Status of the plan this refines:** the plan's P1-1…P2-8 list is still the right *set* of ideas.
This document changes the *order*, the *granularity*, and — in three cases — says the feature as
written is not honest and specifies the version that is.

This spec is a design document. It proposes no schema change and invents no column: every feature
below is computed from `player_matches`, `player_snapshots`, `tracked_players`,
`brawler_intelligence`, `BrawlerStats`, `ranked_matches` and the lookup tables as they exist today.

---

## 0. Four measurements that govern every number on this page

These were measured against production on 2026-08-24, not assumed. They are load-bearing: three of
them invalidate a feature the implementation plan currently recommends.

### 0.1 A tracked player's sample is 2.2× smaller than the row count says

`player_matches` holds 14,603 rows over 881 players. Collapsing rows that share
`(player_tag, map_id, team_brawlers, enemy_brawlers)` inside one hour — the rounds of one Ranked
series — gives **6,584 series, 2.22 rows per series**, only 544 of them single-round and 1,979 of
them three rounds or more.

Rounds of a series are the *same six players replaying the same draft on the same map minutes
apart*. They are not independent observations, and §0.2 of `IMPLEMENTATION-PLAN.md` already
established this for the aggregate side. So:

> **The unit of evidence on a profile is the SERIES, not the match.** Every rate, every threshold,
> every confidence band in this document counts series. The median tracked player has 19 rows —
> that is **about 8 independent drafts**, and no honest per-brawler win rate exists at 8.

The row count is still the right thing to *display* ("42 matches, 19 series") because a player
counts games, not series. It is the wrong thing to divide by.

`src/PlayerPage.jsx:groupIntoSeries` already implements exactly this collapse (15-minute gap, same
map, same six brawlers) for display. Every statistic in this spec reuses that grouping. It should
be lifted out of the component into a shared helper the moment a second surface needs it.

### 0.2 Star Player is not a 1-in-6 event, and it is missing non-randomly

`IMPLEMENTATION-PLAN.md` P1-5 proposes "Star Player rate vs the 1-in-6 baseline". Measured:

| slice | rows | star = NULL | star = true | rate among known |
|---|---|---|---|---|
| all | 14,603 | 8,330 (57.0%) | 1,669 | **26.6%** |
| wins | 8,821 | 4,820 (54.6%) | 1,492 | **37.3%** |
| losses | 5,782 | 3,510 (60.7%) | 177 | **7.8%** |

Three consequences:

1. **The baseline is not 1-in-6.** Star Player overwhelmingly goes to the winning side, so the rate
   among known-attribution games is 26.6%, and 37.3% conditional on a win. A profile that prints
   "you are Star Player 30% of the time, versus a 17% baseline" is congratulating the player for
   winning, which they already knew. **The only honest form is conditional on the outcome:
   *given your team won, were you the one?* — measured against the 37.3% field rate.**
2. **57% of rows carry no attribution at all** (`scrapers/common.py:485` sets `is_star_player` to
   `None` when the payload has no `starPlayer` object). The denominator is
   `is_star_player IS NOT NULL`, never `count(*)`, and the missingness rate is flat across all six
   modes (56.6%–57.7%) so it is not a mode artefact.
3. **Missingness is mildly correlated with result** (54.6% on wins vs 60.7% on losses), which is
   another reason to slice by result rather than pool.

The 37.3% field baseline must be recomputed from `player_matches` per patch as the table grows —
it is a property of our own population, and nothing in `brawler_intelligence` carries star data.

### 0.3 The owner's headline question is the least reachable one, at brawler granularity

"What brawlers am I worst against" is the stated wow. Measured coverage today:

| granularity | best-case sample | realistic horizon |
|---|---|---|
| enemy **brawler** | max any player has faced one brawler: **14 rows ≈ 6 series**; only 69 (player, enemy) pairs anywhere are ≥10 rows | ~15 series facing one brawler needs roughly **8–12 weeks of heavy play**, and most tracked players will never get there |
| enemy **draft class** (7 buckets) | a class appears in roughly half of all drafts | **≈4–6 weeks** for an active player |
| **own brawler** | max 24 rows ≈ 11 series on one brawler; 562 (player, brawler) pairs ≥5 rows | 25 series on a main ≈ **3–5 weeks** |

So the feature ships as a **class-level matchup profile first** (§5, OP-1) with the brawler-level
table (OP-2) present but progressively unlocking per row. The unlock is not a growth hack — it is
the sample threshold made visible, which is the most on-brand way to display a threshold this site
has available.

### 0.4 Three things the current table is better at than the brief assumed

- **`bracket_id` is effectively never NULL.** 14,566 of 14,603 rows are `masters_legendary`, 24 are
  `diamond_mythic`, 13 are NULL. Rank-matched comparison works *today* — but note the mirror
  image: **our tracked population is ~99.8% Masters**, because it was seeded from
  `masters_players` / `top_200_leaderboard` / `diamond_mythic_players`. Any percentile we quote is
  "of tracked Masters players", and must say so.
- **The social graph is already dense.** 9,429 distinct (player, teammate) pairs, 3,923 of them
  ≥3 rows. And **3,696 of 18,535 distinct (player, opponent) edges — 20% — are opponents we also
  track**, 3,253 with stored history. Rivals and cross-links work now.
- **`player_snapshots` is not a real data source yet** (1 row, boosted-only, 1 boosted account).
  Everything trophy-shaped is boost-gated and stays out of the default page.

---

## 1. Brawlify's four tabs, and where each is weak

Sourced from `W1-brawlify-inventory.md` §3 and §5 (search-index metadata; the site itself is
Cloudflare/egress-blocked from this environment, so UI *quality* claims stay inferred). What is
solid is the **feature list**, which is all this section needs.

| Their tab | What is on it | Where it is weak | Our answer |
|---|---|---|---|
| **Profile** `/player/{TAG}` | One live Supercell call rendered well: name, icon, club, trophies, 3v3/solo/duo victory counters, brawler collection with power levels, gadgets, star powers, gears, **upgrade costs**. "Best brawlers" surfaced by trophies. | Every number is a **lifetime cumulative counter with no denominator and no date**. `3vs3Victories` mixes six years and every mode. "Best brawler by trophies" measures *how long you have owned it*. There is no ranked dimension anywhere. Nothing on the page is a *comparison*. | Keep the live header (we already have it — `api/player`), then lead with a comparison the API cannot make: performance against a **bracket-matched** baseline. |
| **Brawlers** `/player/{TAG}/brawlers` | Collection grid with a completion count ("90/104"), power/gear/star-power state, maxing progress. | It is an **inventory screen**, not a performance view. It ranks account spend. A player learns nothing about which brawler to stop playing. | Rank the player's brawlers by **win delta vs the bracket's `true_win_rate` for that brawler**, expressed in *wins gained/lost*, not percentage points. |
| **History** `/player/{TAG}/history`, `/stats/profile/{TAG}` | Trophy progression chart at **end-of-day resolution**; 90-day GitHub-style activity heatmap with per-day battles/W-L/trophy delta. Gated behind a 7-day "Free Boost" or $4.99/mo Premium. | (a) It is **your own data, paywalled**. (b) **Daily granularity** cannot show a session. (c) It is **trophy-only, so competitive Ranked is invisible** — and `trophyChange` is absent on Ranked battles, meaning the one number their layout is built around is *structurally empty* for the competitive population. (d) The heatmap is decorative: "you played a lot Saturday" is not a decision. | Free, per-battle, ranked-native. Replace the heatmap with the **Rhythm** tab: same timestamps, actual findings (fade curve, after-a-loss, session length). |
| **Battles** `/player/{TAG}/battles` | Formatted battlelog, 50 per page, filters by brawler / mode / map / result, per-page W-L-WR-trophy summary. | A **pass-through dump**. The per-page summary is a win rate over an arbitrary 50-row window, which is a denominator chosen by pagination. Nothing is *evaluated*. Ranked series render as 2–3 near-identical rows with no indication they were one draft. And no battle has a permalink. | The **Drafts** tab: series-collapsed, each with a `computeWinSplit` verdict, and aggregate draft-quality statistics on top. This is the one thing in the category that cannot be copied in a weekend. |

**The category-wide gap, restated in one line:** every Brawl Stars tracker answers *what did you
do*; none answers *was it any good, compared to whom, and how sure are you*. All three halves of
that question are things we already have the tables for.

---

## 2. Mechanics worth stealing, and why each creates a "wow"

Named mechanic → the psychological reason it works → our version. The two starred rows are the
spine of this spec.

| Source | Mechanic | Why it lands | Our version |
|---|---|---|---|
| **op.gg** ★ | **OP Score** — a per-match performance number computed independently of win/loss, plus the "POG" badge for the best player in the game. | It separates *how you played* from *whether you won*. Losing players still get a number they can be proud of; winning players discover they were carried. That tension is the entire reason the number gets screenshotted. | **Above Draft (§5, OV-1)** — actual wins minus the sum of `computeWinSplit` probabilities across your series. Same separation (play vs picks), and unlike OP Score the model is public and auditable. |
| **chess.com Game Review** ★ | Every move gets a *label* (Brilliant / Good / Inaccuracy / Blunder) and the game gets one headline sentence. | **Named events beat numbers.** "You blundered on move 23" is shareable; "your accuracy was 84.2%" is not. Labels also make a continuous model legible to someone who will never read the model. | Every series gets a label from its draft split × its result: **Steal** (won as underdog), **Converted**, **Coin Flip**, **Threw the Draft** (lost while favoured), **Drafted Out** (lost while underdog). `PlayerPage.jsx:verdictLine` already writes these sentences — this promotes them to a countable, filterable dimension. |
| **chess.com Insights** | Panels that simply **do not render** below a sample threshold, and always print n. | The discipline is the feature. A site that hides a panel until it can support it buys permanent trust in the panels it does show. | §3's display ladder, applied uniformly. |
| **Spotify Wrapped** | "Your top genres", "you were in the top 2% of listeners" — **distribution facts, not rate facts**. | Distributions are *stable at small n* in a way rates never are. 20 series is a garbage win-rate sample and a perfectly good sample of "what you like to pick". This is the single best answer to our cold-start problem. | **Draft-class fingerprint (BR-2)** — your pick distribution across the 7 draft classes vs your bracket's. Honest at 20 series, and it is a genuine "I did not know that about myself." |
| **Dotabuff** | Per-hero **"vs hero"** and **"with hero"** tables with a games column, sorted by advantage. | The table format itself teaches that some matchups are structural rather than personal. | **OP-1 / OP-2**, with the twist Dotabuff cannot do: two columns — *your* rate and *the population's* rate — so the reader can tell "this is hard" from "this is hard **for me**". |
| **Strava** | **Segments**: the same stretch of road, everyone's times, your rank on it. Plus "relative effort" — you vs your own 6-week baseline. | Comparability is the wow. A time means nothing; a time against the same hill everyone else climbed means everything. | Two borrows: (a) **percentile against the tracked Masters population** (OV-3); (b) **you vs your own 30-day baseline** (RH-4), which is honest at samples where you-vs-the-world is not, because the confound cancels. |
| **Last.fm** | **Neighbours** — people whose taste overlaps yours. | Social discovery without a social graph. | Deferred, but the data exists: 20% of opponents are tracked, so "players who draft like you" is a real later feature. Not in this spec's build order. |
| **tracker.gg** | **Session reports** and weekly improvement digests. | Converts a page you visit into a message you receive. | **Rhythm** tab now; a Discord weekly digest later (distribution, per `IMPLEMENTATION-PLAN.md` Phase 5). |
| **Duolingo** | Progress-toward-unlock, visible and specific ("3 more to go"). | Turns a locked state from a dead end into a goal. | Locked matchup rows print **"12 of 15 series — needs 3 more"**. This is the honest thing to say *and* the retention mechanic. They are the same sentence. |
| **Duolingo (anti-pattern)** | Streak pressure. | — | **Deliberately not stolen.** A coaching product must never make "play more games" the goal it rewards; §7 (T7) explains why a play-volume streak actively conflicts with the fade-curve finding in RH-1. |

---

## 3. The honesty kit — shared primitives every feature uses

Build these once. Every feature spec in §5 refers to them by name.

### 3.1 `toSeries(rows)` — collapse rounds into drafts
Consecutive rows (newest-first) sharing `map_id`, `team_brawlers` and `enemy_brawlers` within a
15-minute gap are one series. Yields `{ map_id, mode, brawler_id, team_brawlers, enemy_brawlers,
team_tags, enemy_tags, bracket_id, patch_id, rounds[], roundsWon, won, started_at }`.
`won = roundsWon > rounds.length / 2`. Already written as `groupIntoSeries` in
`src/PlayerPage.jsx`; **lift it to `src/data/playerStats.js` and reuse it everywhere.**
Measured constants for the doc-comment: median inter-round gap 131s, max observed 476s, 2.22
rounds per series.

### 3.2 Shrink toward the population baseline, not toward 50%
For any personal rate over `n` series with `w` wins and a bracket-matched population baseline `b`:

```
p̂ = (w + k·b) / (n + k)          shown delta = p̂ − b
```

Shrinking toward `b` rather than 0.5 means **the displayed delta is exactly 0 at n = 0**, which is
the correct statement of "we don't know yet". Shrinking toward 50% would make a player look
below-average on a brawler whose population rate is 56%, purely from having no data.

`k = 25 series` as the starting prior. Rationale: a series outcome is Bernoulli with SD ≈ 0.5, so a
25-series rate has SE ≈ 10 points; k = 25 halves an observed delta at n = 25, which is roughly the
right scepticism at that size.

**Calibrate k rather than leaving it chosen** — the house already did this for `pairEdgeVs`
(`draftEngine.js:125`, prior = 135 derived from a measured SD). Method, runnable once ≈200 players
hold ≥60 series: split each player's series chronologically in half, regress the second half's
delta on the first half's; the slope is the shrink factor at that n, and `k` solves
`n/(n+k) = slope`. Until then, k = 25 is labelled in the code as provisional.

### 3.3 Which baselines actually exist (and which are trivially 50%)
A recurring mistake waiting to happen. In `ranked_matches` every game has exactly one winning and
one losing side, so:

- **Baseline win rate overall, per mode, per map, per bracket = 50% by construction.** There is no
  table to fetch. "Your Knockout is 9 points below average" means below 50.
- **Baselines that are genuinely ≠ 50 and must be read from a table:**
  - per brawler → `brawler_intelligence.true_win_rate` (+ `recent_*` via `recencyTWR`), keyed
    `(patch, rank_bracket, brawler)`
  - per brawler per map → `BrawlerStats(map, patch, rank_bracket, brawler, picks, wins)`, combined
    with the global rate via `blendMapGlobal` — reuse the engine's helpers, do not re-derive
  - brawler vs enemy **class** → `brawler_intelligence.vs_class`
  - brawler vs enemy **brawler** → `brawler_intelligence.vs_brawler` `{enemy: {picks, winRate}}`
  - brawler with **teammate** brawler → `brawler_intelligence.with_brawler`
- **The best baseline of all is the draft's own win probability** from `computeWinSplit`, because it
  already conditions on the map, both comps and the head-to-head data simultaneously. That is why
  OV-1 is the flagship: it is the only comparison that controls for what the player was actually up
  against, rather than for one variable at a time.

### 3.4 The display ladder — four states, applied to every panel
1. **n = 0** → the panel does not render. No empty charts.
2. **0 < n < threshold** → render the **raw record and the gap**: "4–2 in 6 series · needs 9 more
   before we'll call it." Never a percentage, never a delta, never a colour that implies good/bad.
3. **n ≥ threshold** → render the shrunk estimate, the delta, **n in series**, and a ± band.
4. **n ≥ threshold and the band excludes 0** → *now* the panel is allowed a verdict sentence and a
   red/green colour.

State 4 is the only state that gets prose. This is the single rule that keeps the page from
sounding confident about noise, and it is cheap: it is one shared `<Confidence>` wrapper component.

### 3.5 Coverage disclosure
The battlelog is a ~25-battle rolling buffer, so we know we have holes and cannot know how many.
Two honest signals we *do* have:
- `tracked_players.poll_interval_mins` halves whenever a poll returned ≥20 new battles — i.e. **we
  were outrun and lost games**. Surface that as a badge: "you play faster than we poll — boost to
  narrow the gap."
- `tracked_players.first_seen_at` + `boosted` → the existing "Tracked since …" line
  (`PlayerPage.jsx` already prints it). Keep it on every tab, not just the history list.

Never write "your win rate" without "over the N series we've seen". The phrasing is
"**of what we've tracked**", everywhere.

---

## 4. Tab structure

Five tabs. Brawlify has four; the count is not the point, the *axis* is: theirs are **object
types** (profile, brawlers, history, battles), ours are **questions**.

| Tab | The question it answers | Ships when |
|---|---|---|
| **Overview** | *Am I any good, and at what?* | Now (partly today) |
| **Drafts** | *Was the game decided at the picks or on the map?* | Now — this is the moat and it already half-exists |
| **Brawlers** | *Which of my brawlers should I stop playing?* | ~3–5 weeks of accumulation |
| **Opponents** | *Who beats me, and is it just me?* | Class level ~4–6 weeks; brawler level unlocks per row |
| **Rhythm** | *When am I good, and when should I stop?* | ~6–8 weeks |
| *(Progress)* | *How am I trending?* | Boosted accounts only; not a default tab |

**Deliberately not built** (each is a real Brawlify feature, and each is a trap for us):
- **Brawler collection / maxing / upgrade costs.** It measures spend. `W1` §9 is right that this is
  catalogue bloat; it is also the exact metric-shape our own critique of Brawlytix's "Account
  Value" attacks. Building it would undercut the positioning.
- **Trophy leaderboards and per-country boards.** A pure API mirror; everyone has it.
- **The activity heatmap.** Replaced by Rhythm. If a contribution grid is ever wanted for the
  screenshot value, it should encode *series played and draft quality*, not raw battle count.
- **A composite "player rating" number.** See §7, T3.

---

## 5. Feature specs

Format for each: **wow line** (as the user would say it) · **compute** (exact tables/columns) ·
**threshold** and what shows below it · **effort** · **availability**.

Effort: **S** ≤1 day · **M** 2–4 days · **L** a week or more.

---

### Overview

#### OV-1 — Above Draft ★ FLAGSHIP
> *"The drafts I played were worth 9.4 wins. I got 12. I'm winning games my picks didn't."*

**Compute.** For each series from `toSeries`: run `computeWinSplit({ blueTeam: team_brawlers→names,
redTeam: enemy_brawlers→names, mode: maps.mode, mapStats, intelligence })` exactly as
`PlayerPage.jsx:DraftVerdict` already does — `mapStats` from `BrawlerStats(map, patch,
rank_bracket)`, `intelligence` from `brawler_intelligence(patch, rank_bracket)` keyed on the
series' own `patch_id` / `bracket_id`. Let `pᵢ = split.blue / 100`.
- Expected wins `E = Σ pᵢ`; actual wins `A = Σ won`; **Above Draft = A − E**.
- Standard error `SE = √(Σ pᵢ(1−pᵢ))` — the drafts themselves tell you how much variance to expect.
- Display as a **cumulative chart**: x = series in time order, y = running `A − E`, with a ±2·SE
  ribbon that visibly narrows. The reader sees the uncertainty rather than reading a caveat.

**Why this is the flagship.** It is the only statistic on the site that separates *drafting* from
*playing*, it is computed from the one asset no competitor has, and it needs **no depth in the
player's own history to be correct** — one series plus the 1.8M-row aggregate is a valid single
observation. Depth only narrows the ribbon.

**Threshold.** Chart renders from **10 series** (the ribbon does the honesty). The **verdict
sentence** — "you outplay your drafts" / "you're losing games your picks won" — only appears when
the ribbon excludes zero, which in practice needs **80–120 series**. Below that the label reads
*"so far, indistinguishable from your drafts"*, which is both true and a reason to come back.

**Effort.** M. The per-series grading already exists; this adds accumulation, the chart, and
caching (`intelCache` / `mapStatsCache` in `PlayerPage.jsx` already dedupe the fetches — grading 40
series costs ~1 intelligence fetch and ~15 map fetches).

**Availability.** **Today**, at chart-with-wide-ribbon quality.

**Caveat to print under it:** `computeWinSplit` measures *matchup edge from aggregate win rates*,
not skill — the existing footer line in `DraftVerdict` says this already and should be reused
verbatim. And when `bracket_id` is NULL, grading falls back to Masters and must say so (also
already implemented).

---

#### OV-2 — The facts strip
> *"I'm Star Player in 46% of my wins. The field is 37%."*

Three rotating one-sentence facts at the top of the page, each drawn from a pool and each carrying
its own threshold — a fact only enters the pool when its own panel would qualify under §3.4 state
4. Candidate facts, cheapest first:

| Fact | Compute | Threshold |
|---|---|---|
| Star Player rate given a win | `player_matches` where `is_star_player IS NOT NULL AND result = 1`; baseline = same ratio over the whole table for the patch (37.3% today) | 25 known-attribution wins |
| Longest series streak | `toSeries` consecutive `won` | 15 series |
| Most-faced enemy brawler | `unnest(enemy_brawlers)` count | 20 series |
| Your signature pick | `brawler_id` share vs `brawler_intelligence.pick_rate` | 20 series |
| Draft label counts | §5 DR-2 labels | 20 series |
| Rarest thing you did | e.g. won a series graded ≤35% — from OV-1's `pᵢ` | 1 (it is an event, not a rate) |

The last row is the important one: **event facts have no sample problem**. "You won a draft the
engine gave you 31% in, on Aug 19" is checkable, singular, and needs no statistics at all. Lead the
cold-start experience with events; let rate facts arrive later.

**Effort.** S per fact once the underlying panels exist. **Availability.** Event facts **today**;
rate facts follow their panels.

---

#### OV-3 — Where you sit
> *"My series win rate is 57% — 71st percentile of the Masters players we track."*

**Compute.** Series win rate per player from `player_matches` (via `toSeries`), restricted to
players with ≥25 series and the same `bracket_id`; the subject's shrunk rate (§3.2, b = 0.50) ranked
within that set. Population from `player_matches` itself — 881 players today, growing.

**Threshold.** 25 series for the subject; **≥200 qualifying players** in the comparison set before
the percentile renders at all. Below either: show the record and "we need more tracked players
before a percentile means anything."

**Honesty requirement.** The label is **"of the Masters players we track"**, never "of players".
Our population is 99.8% `masters_legendary` and was seeded from top-200 and Masters lists (§0.4) —
it is a *selected* population, and a 50th percentile inside it is nowhere near a 50th percentile in
the game. Say the population size and the selection out loud, in the panel.

**Effort.** M (needs a cached aggregate — recomputing 881 players' series client-side is not
acceptable; this wants a small RPC or a nightly-refreshed table).
**Availability.** ~2–3 weeks (needs the qualifying-player count to grow).

---

#### OV-4 — Coverage and tracking state
> *"You play faster than we poll — we're probably missing games."*

**Compute.** `tracked_players.poll_interval_mins`, `tier`, `boosted`, `first_seen_at`,
`last_battle_at`. The "outrun" badge fires when `poll_interval_mins` has been halved (the tracker's
own ≥20-new-battles rule). **Effort.** S. **Availability.** Today. Not a wow — a trust primitive.
It is what earns the right to show everything else.

---

### Drafts *(replaces "Battles")*

#### DR-1 — Series list with a draft verdict — **ALREADY SHIPPED**
`PlayerPage.jsx:SeriesCard` + `DraftVerdict`. Nothing in the category has this. Two upgrades worth
doing while the rest is built:
- **A permalink per series** (`/player/:tag/series/:match_key`) — `W2` §2.4 is right that the
  per-match permalink is what makes a match page shareable and arguable. `match_key` is already the
  natural id. **Effort S.**
- **Filters** matching Brawlify's table stakes (brawler / mode / map / result) plus one they cannot
  offer: **filter by draft label** (see DR-2). **Effort S.**

#### DR-2 — Your draft record, split by who the draft favoured ★
> *"I win 74% of the drafts the engine likes. I win 19% of the ones it doesn't. I don't steal games."*

**Compute.** Bucket each series by its OV-1 `pᵢ`: **favoured** ≥ 0.56, **even** 0.44–0.56,
**underdog** ≤ 0.44. Per bucket: series, wins, rate; and the headline **conversion** = favoured-win
rate, **steal** = underdog-win rate. Attach the chess.com-style label to each series (§2) so the
list in DR-1 is filterable by it.

**Why it wows.** It answers a question players argue about constantly and cannot otherwise settle:
*am I losing because of my picks or my play?* And unlike OV-1 it is legible without a chart.

**Threshold.** **12 series in a bucket.** Below that, collapse to two buckets (favoured / not) and
show records only. Note that drafts cluster near 50/50, so the underdog bucket fills slowest —
expect the favoured bucket to qualify ~2× sooner.

**Effort.** S once OV-1's grading loop exists. **Availability.** ~2–3 weeks.

#### DR-3 — The pick that was there
> *"Swapping my Piper for Angelo would have made that draft 55/45 instead of 46/54."*

**Compute.** For a completed series, hold the other five brawlers fixed, substitute each candidate
into the player's own slot, re-run `computeWinSplit`, and report the best improvement.
**This is order-free** and therefore legal: we do **not** know draft order (§7, T4), so we cannot
say "you should have counter-picked" — but a straight swap needs no order assumption.

**Guards.** Only show when (a) the improvement is ≥6 points, (b) the map's `BrawlerStats` sample for
both brawlers is ≥ `minMapPicks` (30, the engine's own floor), and (c) it is phrased as *the
engine's view of the aggregate*, not as advice about what was available — bans and ownership are
invisible to us.

**Threshold.** Per-series; no accumulation needed. **Effort.** M. **Availability.** Today.

#### DR-4 — Structural gaps in your drafts
> *"1 in 3 of my comps went in with no lane anchor. Across Masters it's 1 in 8."*

**Compute.** `finalSanityCheck(team_brawlers→names, mode)` per series (`draftEngine.js:206`) —
returns `missing[]` of structural roles. Player rate per role vs a population rate computed once by
running the same function over a sample of `ranked_matches` (`w1..w3` / `l1..l3` → `brawlers.name`,
`maps.mode`) per mode. That population number is a handful of rows, computed once per patch.

**Why it wows.** It is *actionable* in a way a win rate is not: "you keep drafting without an
anchor" is a sentence a player can act on tomorrow. And it uses the one engine nobody else has.

**Threshold.** 20 series for the player rate. The population rate needs no threshold (it comes from
1.8M matches) and is worth showing on its own even before the personal side qualifies.

**Effort.** M (the population side is a one-off aggregation job). **Availability.** ~2–3 weeks.

#### DR-5 — Series shape
> *"I win the first round 61% of the time but only close it out 2–0 in a third of those."*

**Compute.** Within a series (`rounds[]`, ordered by `battle_time`): round-1 result, final result,
`2–0` vs `2–1`, and comeback rate (lost round 1, won the series).
**Threshold.** 25 series. **Effort.** S. **Availability.** ~3 weeks.
**Caveat:** rounds are recovered by our own grouping heuristic, not by an API field. A missed round
(buffer overflow, §3.5) turns a 2–1 into a 2–0 in our view. Print a lower-confidence note when the
player carries the "outrun" badge.

---

### Brawlers

#### BR-1 — Your brawlers, ranked by what they cost you
> *"Piper has cost me about 2.1 wins this month compared to a Masters-average Piper."*

**Compute.** Per `brawler_id` over the player's series: `n`, `w`; baseline `b` from
`blendMapGlobal(mapPicks, mapTWR, recencyTWR(intel))` averaged over the maps the player actually
played that brawler on — i.e. `BrawlerStats` for those maps plus
`brawler_intelligence.true_win_rate` at the player's bracket, using the engine's own helpers so the
profile and the Draft Assistant can never disagree about a brawler's strength. Then §3.2 shrinkage,
and **display the delta in wins: `(p̂ − b) × n`**, not in percentage points.

**Why wins, not points.** "−6.2 percentage points" is abstract; "cost you about 2 wins" is a unit
the player feels. Strava does this (time saved), Duolingo does this (days). It also degrades
gracefully: at small n the win-delta is *automatically small*, because it is multiplied by n. The
unit itself is sample-honest.

**Threshold.** 15 series on a brawler for a delta; 25 for a verdict sentence. Below 15: the row
shows record + "needs N more". Sort the whole list by |delta in wins|, so the top of the list is
always the thing that matters most, and unqualified brawlers sink naturally.

**Effort.** M. **Availability.** ~3–5 weeks for a main; the *table* renders earlier in record mode.

#### BR-2 — Your draft fingerprint ★ (the cold-start feature)
> *"I play Damage Dealers 41% of the time. Masters plays them 26%. I have literally never picked a tank."*

**Compute.** Distribution of the player's `brawler_id` over the 7 draft classes
(`brawler_classes` table, or `draftClassOf` from the config — they are synced by
`meta_weights.py`), vs the bracket's pick distribution from `brawler_intelligence.pick_rate`
grouped by class (or `BrawlerStats.picks`). Show as paired bars, sorted by |difference|. Optionally
the same for modes and maps.

**Why this ships early.** It is a **distribution, not a rate** (§2, Spotify Wrapped). At 20 series a
win rate is worthless and a pick distribution is already informative — a player who picked 20 times
genuinely does have a taste profile. **This is the highest wow-per-week-of-waiting on the page.**

**Threshold.** 20 series. Below: show the counts, no comparison. Only call out a class as a genuine
deviation when the difference exceeds ~2 SE of a multinomial share at that n (roughly 15 points at
n = 20, 7 points at n = 100) — otherwise show the bars without prose.

**Effort.** S. **Availability.** **Today** for many tracked players (397 of 881 already have ≥20
rows; ~9 series — so realistically ~2 weeks for a comfortable qualifying population).

#### BR-3 — Carry rate
> *"When my team wins, I'm the Star Player 46% of the time. The field is 37%."*

**Compute.** Numerator `is_star_player = true AND result = 1`; denominator
`is_star_player IS NOT NULL AND result = 1`. Baseline = the same ratio computed over all of
`player_matches` for the current patch (37.3% at time of writing) — recompute it, do not hardcode.
Per-brawler breakdown uses the same conditioning.

**This is counted in ROWS, not series** — being star player is a per-round event, and the
per-round variation within a series is real information rather than a duplicate. It is the one
statistic in this document where the series rule does not apply, and the code should say so.

**Threshold.** 25 known-attribution wins. At ~43% attribution and a ~60% series win rate, that is
roughly **100 rows ≈ 45 series**. Below: "we can only see who got Star Player in about 4 in 10
games — 11 of the 25 we need."

**Effort.** S. **Availability.** ~4–6 weeks.

#### BR-4 — The brawler you're wasting
> *"You're 8 points above Masters on Bibi and you've picked her four times."*

**Compute.** Join BR-1's per-brawler delta against the player's own pick share. Surface brawlers
with a positive delta and a below-personal-median pick share. Purely a re-sort of BR-1, no new data.
**Threshold.** Inherits BR-1's (15 series). **Effort.** S. **Availability.** With BR-1.

---

### Opponents

#### OP-1 — What actually beats you ★ (the owner's stated wow, reachable version)
> *"Throwers beat me 11 points harder than they beat everyone else playing my brawlers. Assassins don't bother me at all."*

**Compute.** Per series, map each of the three `enemy_brawlers` to its draft class
(`brawler_classes`). For each enemy class `C`: `n_C` = number of the player's series in which `C`
appeared, `w_C` = wins among those. Baseline: for each such series, read
`brawler_intelligence.vs_class[player's brawler][C]` at the series' `(patch, rank_bracket)` and
average — this is the *population's* win rate for that brawler against that class, so the
comparison controls for the fact that the player's own brawler choice already determines part of
the answer. Then §3.2 shrinkage against that baseline.

**Counting rule that matters:** a series with two throwers on the enemy side counts **once** toward
throwers, not twice. The three enemy slots share one outcome; treating them as three observations
triples the apparent sample for one coin flip (§7, T2).

**Threshold.** **25 series in which that class appeared.** A class shows in roughly half of drafts,
so ~50 total series gets the common classes qualified. Below threshold the row shows the record and
the gap. Verdict prose only at §3.4 state 4.

**Effort.** M. **Availability.** ~4–6 weeks.

#### OP-2 — The nemesis table (two columns: you, and everyone)
> *"Mortis beats everyone. But Mortis beats ME 14 points harder than he beats the field."*

**Compute.** Same shape as OP-1 at brawler granularity. **Column A** (available immediately, for
every brawler): the population's rate from `brawler_intelligence.vs_brawler[player's brawler][enemy]`
`{picks, winRate}`, at the player's bracket. **Column B** (unlocks per row): the player's own record
against that enemy, series-counted.

**The design that makes this honest AND compelling:** ship the table with Column A filled and
Column B showing progress — *"Mortis · field 44.1% · you 3–2 in 5 series · needs 10 more"*. The
reader gets real, sourced information on day one about which matchups are structurally hard, and
watches their own column fill in. The threshold is the product.

**Threshold.** **15 series facing that brawler** for Column B. Per §0.3 that is 8–12 weeks of heavy
play, and most players never reach it for most brawlers — which is exactly why Column A carries the
table. Sort by the population edge until enough personal rows qualify to sort by the difference.

**Effort.** M. **Availability.** Column A **today**; Column B unlocks per row over months.

#### OP-3 — Your squad
> *"I've queued with #2P8LQVR 14 times. We're 9–5. Solo I'm 51%."*

**Compute.** `unnest(team_tags)` excluding self (verified: `player_tag` is present in `team_tags` on
14,603 of 14,603 rows), counted **at series level**. Per teammate: series together, record, and the
delta against the player's own overall shrunk rate. Link every teammate tag that exists in
`tracked_players` to their profile.

**Two states.** Below threshold — and this is the version that ships first — the panel is a plain
**"who you play with"** list: names, series counts, profile links, **no win rates at all**. That is
socially compelling at n = 2, statistically unimpeachable, and the cross-linking is what makes the
site feel populated. Win-rate deltas appear per teammate only at threshold.

**Threshold.** **12 series together** for a delta. Coverage today: 3,923 pairs at ≥3 rows, i.e.
mostly 1–2 series — so almost nothing qualifies yet, and the list-only version is what ships.

**Effort.** S for the list, M for the deltas. **Availability.** List **today**; deltas ~6–8 weeks.

#### OP-4 — Rivals
> *"You've run into #YQ8C0LP 4 times this month. They're 3–1 against you — and here's their profile."*

**Compute.** `unnest(enemy_tags)` at series level, joined to `tracked_players` /
`player_matches`. **20% of opponent edges are already tracked players** (§0.4), so this has real
coverage now. No inference, no rates — a **count and a record**, which needs no threshold because
it is a fact, not an estimate.

**Why it wows.** It is the only feature here that makes the site feel like a world rather than a
dashboard, and it drives page-to-page navigation for free. Requires the tracked player's own
opt-out to be respected (`tracked_players.opted_out`) — do not link a profile that opted out.

**Threshold.** Show from **2 series** faced. It is an event log, not a statistic.
**Effort.** S. **Availability.** Today.

#### OP-5 — The draft that keeps beating you
> *"This exact enemy comp has shown up 5 times against you. You're 1–4."*

**Compute.** Group the player's series by sorted `enemy_brawlers`; surface repeats with a losing
record. Enrich with the OV-1 grade so the player learns whether it is a hard comp or a badly
answered one. **Threshold.** 4 series against the same comp. **Effort.** S.
**Availability.** ~4 weeks.

---

### Rhythm

#### RH-1 — The fade curve
> *"Your first three series of a session: 58%. Everything after: 41%."*

**Compute.** Cluster series by `started_at` with a **60-minute** gap → sessions. Per session index
(1st series, 2nd, …), win rate. Report the **slope of win rate against session index** (one test),
plus the two-bucket split (first 3 vs rest) as the headline sentence.

**The trap this dodges** (§7, T5): searching for *the index where performance drops* over ~8 indices
will always find one, and it will be noise. Fitting a single slope is one hypothesis, one test, one
honest answer. If the two-bucket headline is used, the split point must be **fixed at 3 in advance
and never tuned per player**.

**Threshold.** **15 sessions and 60 series.** Below: show session length distribution only
("your typical session is 4 series") — a descriptive fact, no performance claim.
**Effort.** M. **Availability.** ~6–8 weeks.

#### RH-2 — After a loss
> *"After losing a series you win 38%. After winning, 57%."*

**Compute.** Series ordered by time within a session; result of series *n+1* conditioned on series
*n*. **Must be series-level** — computed on raw rows this measures "you lost round 1 of a best-of-3",
which is near-deterministic and would produce a spectacular, entirely fake tilt finding (§7, T2).
**Threshold.** 40 series with a within-session predecessor. **Effort.** S once RH-1's sessionizer
exists. **Availability.** ~6 weeks.

#### RH-3 — Time of day / weekday
> *"You're a different player after midnight."*

**Compute.** `battle_time` at series level, bucketed. **Threshold.** This one is a
multiple-comparison minefield — 24 hourly buckets means one will look significant by chance in
almost every player. Ship it as **3 fixed buckets defined in advance** (before 18:00 / 18:00–23:00 /
after 23:00) with **≥25 series per bucket**. Note we store no timezone, so the buckets must either
be labelled UTC or derived client-side from the browser's offset — and if derived client-side, say
so, because it changes when the player travels. **Effort.** S.
**Availability.** ~8 weeks. **Lowest priority in this tab** — it is the closest thing here to
Brawlify's heatmap gimmick and should be treated with suspicion.

#### RH-4 — You vs your own recent self
> *"Your last 20 series: +6 points on your own 90-day baseline."*

**Compute.** Rolling series win rate vs the player's own trailing baseline, plus the same for
Above Draft (OV-1). Borrowed from Strava's relative effort.
**Why it is honest earlier than you-vs-the-world:** the player's own confounds (which brawlers they
play, which bracket, which maps) largely cancel between the two windows, so a within-player
comparison needs less shrinkage than a between-player one.
**Threshold.** 20 series in the recent window, 40 in the baseline. **Effort.** S.
**Availability.** ~5 weeks.

---

### Progress *(boosted accounts only — not a default tab)*

#### PR-1 — Trophy and collection curve
**Compute.** `player_snapshots.trophies`, `highest_trophies`, `exp_level`, `victories_3v3`,
`solo_victories`, `duo_victories`, `brawlers_owned`, `brawler_trophies` jsonb.
**Status:** 1 row exists. This is Brawlify's flagship and our table-stakes; it is *not* a
differentiator and it must not be allowed to become the page's centre of gravity — it measures
grinding. Render it for boosted accounts, keep it out of Overview.
**Threshold.** 14 daily snapshots for a curve. **Effort.** M. **Availability.** boost-gated,
weeks after boosting.

#### PR-2 — Derived ranked-strength estimate — **DEFERRED, see §7 T3**

---

## 6. Build order

Score = (wow × reachability) ÷ effort, where reachability discounts anything needing weeks of
accumulation. Build strictly top-down; each block is shippable on its own.

| # | Feature | Wow | Reachable | Effort | Ship |
|---|---|---|---|---|---|
| **1** | **OV-1 Above Draft** | ★★★★★ | today | M | **First. Nothing else on this list is unavailable to a competitor.** |
| **2** | **DR-1 upgrades** (permalink + label filter) | ★★★ | today | S | Cheap, and it makes every series shareable |
| **3** | **DR-2 favoured/underdog record** | ★★★★★ | ~2 wks | S | Falls out of OV-1's loop almost free |
| **4** | **BR-2 draft fingerprint** | ★★★★ | ~2 wks | S | The best cold-start feature; distribution, not rate |
| **5** | **OP-4 rivals + OP-3 squad list** | ★★★★ | today | S | Makes the site feel inhabited; zero statistical risk |
| **6** | **OV-2 facts strip (event facts only)** | ★★★★ | today | S | Wow at n = 1 |
| **7** | **OV-4 coverage line** | ★ | today | S | Trust primitive; do it before anything with a % on it |
| **8** | **DR-3 the pick that was there** | ★★★★★ | today | M | High wow, needs careful guards |
| **9** | **DR-4 structural gaps** | ★★★★ | ~3 wks | M | Population side alone is worth shipping first |
| **10** | **OP-2 nemesis table, Column A** | ★★★★ | today | M | Population matchups now, personal column unlocks later |
| **11** | **BR-1 brawlers ranked by wins cost** | ★★★★ | ~4 wks | M | The direct answer to Brawlify's trophy-sorted list |
| **12** | **OP-1 class matchup profile** | ★★★★★ | ~5 wks | M | The owner's stated wow, in its reachable form |
| **13** | **BR-3 carry rate** | ★★★ | ~5 wks | S | Cheap, but see §0.2 — get the baseline right |
| **14** | **RH-4 you vs your recent self** | ★★★ | ~5 wks | S | |
| **15** | **OV-3 percentile** | ★★★ | ~3 wks | M | Needs a cached aggregate + honest population label |
| **16** | **DR-5 series shape** | ★★ | ~3 wks | S | |
| **17** | **RH-1/RH-2 sessions & tilt** | ★★★★ | ~7 wks | M | Big wow, genuinely far away — do not start early |
| **18** | **BR-4, OP-5** | ★★ | with parents | S | Re-sorts of work already done |
| **19** | **PR-1 trophy curve** | ★ | boost-gated | M | Table stakes, not differentiation |
| — | **RH-3 time of day** | ★★ | ~8 wks | S | Ship last or not at all |

**The one-sentence version:** build **Above Draft** first, because it is the only feature here that
is simultaneously maximum-wow, available today, and impossible for anyone else in the category to
copy — then harvest the three cheap things that fall out of the same grading loop (DR-2, DR-3,
OV-2), then the cold-start distribution features (BR-2, OP-3/OP-4) while the sample accumulates for
everything else.

---

## 7. Traps — ideas that sound great and are not

### T1 — "Your personal win rate against every brawler" (as the plan's P1-4 is currently written)
The most requested-sounding feature and the least supportable. Measured: the deepest
(player, enemy-brawler) pair anywhere in the database is **14 rows ≈ 6 series**, and only 69 pairs
in the entire table reach 10 rows. A 6-series win rate has a 95% interval of roughly ±40 points.
Shipped naively this prints "you're 17% against Mortis" from one bad night, which is the exact
failure mode this site's identity is built against. **Ship OP-1 (classes) and OP-2 Column A
(population) instead, and let the personal column unlock per row.**

### T2 — Counting rounds, enemy slots, or teammates as independent observations
Three versions of the same error, each of which silently multiplies the apparent sample:
- **Rounds**: 2.22 rows per series, measured. Any rate computed on rows over-counts by 2.22×, and
  "win rate after a loss" computed on rows is measuring *round 2 of a best-of-three*, which will
  produce a huge and completely fake tilt effect.
- **Enemy slots**: a series with two throwers is one outcome, not two observations of "vs thrower".
- **Teammates**: the 3,923 (player, teammate) pairs at ≥3 rows look like a rich teammate dataset.
  Series-collapsed, most are 1–2 games together. There is no teammate win rate in this database yet.

### T3 — A single composite "player rating" (the plan's P2-8, and every competitor's headline number)
Brawlytix's Skill Score, Brawl Time's S+→D grade and Brawlify's club Quality Score are all
arbitrary weighted sums with no stated objective — `W1` §11 calls this out correctly, and building
our own would forfeit the argument. Worse, ours would have to be anchored to a **ranked tier the API
does not expose at all** (`W2` §2.0): our `bracket_id` comes from *seed lists*, not from the game, so
the rating would rest on a label we inferred. **If a rating is ever built it must be OV-1 — Above
Draft — under its own name, with the model published**, because that one has a stated objective
(predicting the series outcome) and is therefore falsifiable. Do not ship a number that cannot be
wrong.

### T4 — Anything that assumes draft order
"You should have counter-picked X", first-pick vs counter-pick performance, ban analysis, blind-pick
safety scoring for a *played* game. **The battlelog contains no draft order and no bans.** The
`teams[]` array order is roster order, not pick order — treating it as pick order would produce
confident, wrong coaching. `draftMeta.js`'s blind-pick machinery is valid *during* a live draft in
the Draft Assistant, where the order is known because the user is entering it. It is not valid
retrospectively. DR-3 is the legal version: an order-free swap.

### T5 — "Find the game in your session where you start losing"
Scanning ~8 session indices for the largest win-rate drop is eight tests dressed as one finding, and
at realistic samples it will locate a "tilt point" for essentially every player — including players
with no tilt at all. Same failure for 24 hourly buckets, 7 weekdays, and 20+ maps. **Rule:
pre-commit to the buckets and test one hypothesis** (a slope, or a split fixed at 3), or don't ship
the panel.

### T6 — Per-map personal performance
Feels like the natural extension of the map-based tier list, and it is the thinnest slice on the
page: ~20+ ranked maps in rotation × a median 8 series per player means most map cells hold zero or
one series. **Aggregate to mode (6 buckets), not map.** And remember that the population baseline
per map is exactly 50% (§3.3) — the only non-trivial map baseline is *per brawler per map*, which is
`BrawlerStats`, and that is a BR-1 input, not a standalone panel.

### T7 — Streaks, heatmaps, and anything that rewards volume
A play-streak or contribution grid is the cheapest engagement mechanic available and it is
**actively at odds with our own product's finding**: if RH-1 shows a fade curve, the honest
recommendation is *stop playing tonight* — and a streak counter punishes the player for taking it.
A coaching product cannot both tell you to stop and penalise you for stopping. Report streaks as
*facts* in OV-2 if they are interesting; never as a *goal* with a counter to protect.

### T8 — "Strength of schedule" from opponent quality
Tempting now that 20% of opponents are tracked. But opponent ratings would be derived from their own
tiny samples, and every player's rating would depend on ratings that depend on theirs — circular,
and built on 8-series estimates. Revisit only if OV-1 accumulates to the point where a stable
per-player Above Draft exists across hundreds of players.

### T9 — Reading `trophy_change` for anything
It is `NULL` on every competitive Ranked row by definition (`common.py` uses its *presence* as an
exclusion guard). The column exists; the values do not. Anything trophy-shaped needs
`player_snapshots`, which needs boost.

---

## 8. Infrastructure this spec assumes (no schema changes)

1. **`src/data/playerStats.js`** — `toSeries`, the §3.2 shrinkage helper, the label taxonomy, and
   the baseline lookups. Lifted from `PlayerPage.jsx`; imported by the page, and later by `api/`.
2. **A `<Confidence>` wrapper** implementing the §3.4 four-state ladder, so no panel can
   accidentally print a number it cannot support. One component, used everywhere.
3. **Grading at page level, not card level.** `PlayerPage.jsx` currently grades a series when its
   card is expanded. OV-1 needs every series graded on load — the existing `intelCache` /
   `mapStatsCache` make this ~1 + ~15 fetches for 40 series, which is acceptable client-side. If it
   is later needed server-side (Discord cards, OG images), `draftEngine.js` is pure JS + JSON
   imports and is importable from `api/` — with the Node ESM JSON-import caveat
   (`with { type: "json" }`).
4. **One cached population aggregate** for OV-3 (per-player series win rates) and DR-4 (structural
   gap rates from `ranked_matches`). Both are small, both are per-patch, and both should follow the
   house RPC rules: compute into a TEMP table, swap last, no large sort or DISTINCT.
5. **Respect `tracked_players.opted_out` on every cross-link** (OP-3, OP-4). An opted-out tag must
   not be linkable from someone else's profile.

---

## 9. Open questions for the owner

1. **Series or matches as the displayed unit?** This spec says: *display* matches, *divide by*
   series, print both. Confirm the phrasing — it appears on every panel.
2. **Should OV-1 have a name?** "Above Draft" is descriptive and honest. A named metric is more
   shareable and more dangerous (T3). Recommendation: name it, publish the method on a `/method`
   page, and never let it become a single-number grade.
3. **The percentile population (OV-3) is 99.8% Masters.** Acceptable to label it as such, or wait
   until Diamond/Mythic tracking has depth? Recommendation: label it and ship.
4. **`player_snapshots` remains boost-gated** per the existing decision (one extra `/players` call
   per player per run). Confirm that stays true — it is the only thing blocking the Progress tab,
   and it is deliberately blocked.
5. **Does the fade curve, if found, get surfaced as advice** ("stop after 4 series")? That is a
   product-voice decision, not a statistics one, and it is the moment this site becomes a coach
   rather than a tracker.
