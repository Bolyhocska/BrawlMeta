# W3 — BrawlMeta codebase capability audit
STATUS: in progress (auditor: main session, read-only)

Scope: what infrastructure already exists that player-stat-tracking could be built on,
and what is genuinely missing. Supabase MCP is NOT authenticated this session, so every
claim below is derived from **code + CLAUDE.md only**. Nothing here was verified against
the live database; items needing DB confirmation are marked **[NEEDS DB CHECK]**.

---

## FINDING 1 (decisive) — `ranked_matches` stores brawler ids ONLY. No player identity. Ever.

`scrapers/common.py:300-301` builds a match from the battlelog as brawler **names**:
```py
winners = [p['brawler']['name'] for p in winning_team if ...]
losers  = [p['brawler']['name'] for p in losing_team  if ...]
```
and `scrapers/common.py:409-422` resolves those names to smallint ids and writes exactly:
`match_hash, map_id, bracket_id, patch_id, w1..w3, l1..l3`.

Player tags exist in the pipeline (`candidate_tags`, `seen_tags`, `common.py:283-289`) but are
used **only to drive the spider queue** and are then discarded. `battleTime` is read at
`common.py:307` solely to resolve the patch (`determine_patch`) and is **never stored**.

**Consequence for the plan:** there is *zero* per-player history latent in our 1.5M-row store.
A player stat tracker cannot be built by re-reading existing data — it must collect fresh data
from day one. This is the single most important architectural fact for scoping. It also means
the tracker's clock starts the day we ship the collector, which argues for shipping the
collector **before** the UI.

## FINDING 2 (pre-existing data-integrity bug, surfaced by this audit)

`make_hash` (`scrapers/common.py:215-222`):
```py
raw = f"{entry['map']}{entry['mode']}{entry['rank_bracket']}{''.join(winners)}{''.join(losers)}"
```
The dedupe key contains **no timestamp, no player tags, and no patch**. Combined with the
insert's `on_conflict=match_hash&ignore-duplicates` (`common.py:429`), this means:

1. **Distinct matches with the same 6 brawlers on the same map+bracket collapse into one row,
   permanently.** Two different teams playing the same meta comp on the same map are stored once.
2. **Cross-patch collisions are silently dropped.** Patch is a *column* but not part of the hash,
   so a match in the new patch whose comp already occurred in an older in-window patch is
   discarded as a duplicate, keeping the OLD row's `patch_id`.

**Why this matters more than it looks:** collisions are not uniformly distributed. The comp space
is astronomically large in theory (C(105,3)² per map), so random collisions are rare — but the
meta concentrates hard onto ~15-25 viable brawlers per map, and the *most popular* comps repeat
most often. Collision probability scales with a comp's true frequency, so the loss falls almost
entirely on the head of the distribution. Direction of the bias: **the most-played comps are the
most under-counted**, which is exactly what pick rate and win rate for meta brawlers are computed
from. Effect 2 additionally biases the first days of every new patch — precisely when the meta is
most interesting and the site's answers are most valuable.

**[NEEDS DB CHECK]** — this is a code-derived inference about magnitude, not a measurement.
Verification query once Supabase access is restored (counts collisions the hash would have merged):
```sql
-- how much head-of-distribution mass is at risk: how many stored rows are
-- "popular comps" whose repeat plays would have been swallowed
SELECT count(*) AS distinct_comp_rows,
       count(*) FILTER (WHERE patch_id <> (SELECT id FROM patches WHERE name = '68.250')) AS old_patch_rows
FROM ranked_matches;
```
A direct measurement requires re-scraping a sample of battlelogs and counting how many parsed
matches hit an existing `match_hash` — i.e. instrument the scraper to log
`attempted - inserted` per run, split by "seen this run" vs "already in DB". `save_matches`
already computes `attempted` and `inserted` (`common.py:427-440`), so the delta is one log line away.

**Fix shape (NOT applied — flagged for owner decision):** add `battleTime` (and ideally the
6 player tags) into the hash input. This is a **breaking change to dedupe continuity** — the
docstring at `common.py:216-218` says the formula is deliberately identical to the historical one
so continuity is preserved. Changing it re-admits every previously-collapsed match, so the row
count will jump and the FIFO window will churn faster. It must be an owner decision, and it
interacts with the 1.5M cap (Core principle 5). Do not change it as a side effect of the tracker.

---

## (A) Exists and directly reusable

- **`api/player.js`** (69 lines) — already does live Supercell player lookup through the
  Webshare proxy, with the undici gotcha handled correctly (`api/player.js:12`, `:25-33`).
  Returns a trimmed profile (tag, name, nameColor, iconId, trophies, highestTrophies, expLevel,
  3v3/solo/duo victories, club, brawlersOwned, maxedBrawlers, top-3 bestBrawlers by trophies).
  This is a working, proven template for every new player-facing endpoint. It is **stateless** —
  pure passthrough, stores nothing.
- **The proxy pattern** — `api/_lib/proxyFetch.js` (23 lines) server-side, `PROXIES` in
  `common.py` for scrapers. Both route through the same static-IP Webshare proxy that the
  IP-allowlisted Supercell key requires. Any new collector reuses this unchanged.
- **The scraper insert pipeline** — `save_matches` (`common.py:~398-450`): batching at
  `INSERT_BATCH_SIZE` with `DB_BATCH_DELAY` between batches, `on_conflict` + ignore-duplicates,
  and `return=representation` to count genuinely-new rows. A player-history collector should
  copy this shape verbatim; the batching rules are hard-won (statement timeout 57014).
- **The threaded spider** — `harvest_bracket` (`common.py:345-390`) already does a locked,
  parallel, depth-bounded BFS over battlelogs with a shared `seen_tags` set. A "poll these N
  tracked players' battlelogs" job is a *strictly simpler* special case: depth 0, fixed seed
  list, no discovery. Most of the concurrency work is done.
- **GitHub Actions scheduling headroom** — 4 workflows currently occupy
  `00,06,12,18` (masters), `05,11,17,23` (leaderboard), `07:30` (diamond), `08:30` (intelligence).
  Plenty of free slots; all have `workflow_dispatch`. Runner is `ubuntu-latest` with no explicit
  `timeout-minutes` override found, so the GitHub default (360 min/job) applies — not a near-term
  constraint.
- **Analytical machinery worth reusing for per-player analysis** — `src/data/draftEngine.js`
  (1153 lines, 5-pass advisor), `draftMeta.js` (blind-pick safety), `draft_logic_config.json`
  (7 draft classes, counter matrix, mode tempo, map profiles). A per-player "your comps" or
  "your draft tendencies" analysis can run the *existing* engine over a player's own history
  instead of the global aggregate — that is a genuine differentiator no competitor has, and it
  costs almost no new modelling work.

## (B) Exists but needs refactoring
- `api/player.js` returns a **hardcoded, narrow projection** (`:47-62`). A profile page needs far
  more (full brawler collection, per-brawler trophies/rank/power/gears, club details, battlelog).
  Refactor into a shared Supercell client in `api/_lib/` + thin per-route projections, rather than
  copy-pasting the ProxyAgent construction into every new endpoint.
- The scraper's battle-parse loop (`common.py:288-325`) throws away everything except brawler
  names. A player-history collector needs the *same parse* to retain tags, battleTime, result,
  trophy/rank change, star player, and map/mode. Extract the parse into a reusable function that
  returns a rich record, then let each consumer project down — instead of forking the loop.

## (C) Entirely missing — must be built
1. Any table keyed by player tag holding history (no `player_*` tables exist; the only per-player
   tables are `Profiles`, `UserWallets`, `Registrations` for the tournament flow, plus the seed
   lists `top_200_leaderboard`, `masters_players`, `diamond_mythic_players`).
2. A collector that polls tracked players' battlelogs on a schedule and stores per-player rows.
3. Any notion of "tracked player" / claim-your-profile linkage between a `Profiles` row and a tag.
4. Snapshot/time-series storage (trophy over time, ranked progression) — nothing time-series
   exists at all; `collected_at` on `ranked_matches` is a retention mechanism, not a history.
5. Every piece of profile UI.

## (D) Hard constraints any plan must respect (from CLAUDE.md)
- **Players NEVER pay.** Every player-stat feature must be free to players. Monetization is
  premium subs (orgs/organizers) + organizer fees only. This kills the entire "premium tracker
  tier" business model that op.gg/tracker.gg use — the plan must find a different wedge.
- Premium is enforced **server-side** in `api/` against the DB, never trusted from the client.
- Display names permanent + globally unique; player tags globally unique and **freeze after the
  first tournament played**. A "claim your tag" flow interacts directly with this rule.
- `ranked_matches` is under **owner-authorized windowed retention** (1.5M FIFO by `collected_at`
  via `prune_ranked_matches`). NEVER bulk-delete outside it. **A new player-history table must
  have its OWN retention story from day one** — it will grow faster than `ranked_matches` if
  unbounded, and it must not be pruned by that RPC.
- New tables: RLS enabled + `"Public read access"` SELECT policy for `anon, authenticated`;
  writes via service role or SECURITY DEFINER RPCs with `auth.uid()` guards.
- Service-role `SUPABASE_KEY` never in the browser bundle (frontend uses anon `VITE_SUPABASE_KEY`).
- Heavy RPCs: compute into a TEMP table, swap last (lock duration); **no big sort/DISTINCT**
  (temp space is far smaller than the DB — 53100 on ~29M rows); a 504 from PostgREST does NOT
  mean the statement failed, and it keeps holding locks.
- Inserts batched ≤2000 rows with pauses.
- New tables need `ANALYZE` after bulk backfill.
- Number formatting must use `toLocaleString("en-US")` (owner's browser is Hungarian).

## (E) Five biggest technical risks
1. **Supercell API rate limit vs. tracked-player count.** Polling N players' battlelogs every
   few hours is O(N) requests against a single IP-allowlisted key already shared with 4 scrapers
   and the live `api/player.js`. This is the binding constraint on how many players can be
   tracked, and it must be measured before the feature is scoped. **[NEEDS DB CHECK / needs a
   measured rate-limit test]**
2. **Battlelog retention is ~25 battles.** Poll less often than a player plays and history has
   permanent holes. This sets a hard floor on poll frequency for active players and means
   coverage is inherently best-effort — the UI must be honest about it rather than implying
   completeness.
3. **Unbounded growth of a per-player match table**, colliding with the same storage pressure
   that forced windowed retention on `ranked_matches`.
4. **The dedupe-hash bug (Finding 2)** contaminating any comparison between a player's personal
   win rate and the global aggregate — the aggregate is biased against popular comps, so a
   player's "vs meta" comparison would inherit that bias.
5. **Monetization mismatch (constraint D.1)** — the highest-value tracker features are exactly
   the ones competitors paywall, and we cannot. Sustainability has to come from elsewhere.

---

## W3.4 — Frontend patterns (how a new page/tab actually gets added)

- **Routing is `react-router-dom`** (`src/App.jsx:2`): top-level `<Routes>/<Route>` for real paths
  (`/guides/...`, `/tournaments/...`, `/scrims`), PLUS a `?tab=` query-param sub-router inside
  `/app` (`App.jsx:113`: `const activeTab = VALID_TABS.includes(searchParams.get("tab")) ? ... : "meta"`).
  Tabs render as `{activeTab === "meta" && <BrawlersPage .../>}` blocks (`App.jsx:134-158`).
  A player-profile feature wants a **real route** (`/player/:tag`) — shareable URLs are the whole
  point of a profile page — not a `?tab=`.
  Note the comment at `App.jsx:109-112`: switching `?tab=` does NOT remount, which is why tab state
  lives in `useState` with a searchParams-derived `activeTab`. A new route avoids that subtlety.
- **Styling is predominantly inline `style={{...}}` objects** (see e.g. `App.jsx:219`), with
  `App.css`/`index.css` for globals. Dark palette, `#94a3b8` muted text, amber accent
  `#ffce7a`/`rgba(255,180,61,.12)`, `'JetBrains Mono', monospace` for numeric/label text, pill
  radii (`borderRadius: 999`). A new page must match this by hand — there is no design-token layer
  and no CSS framework. **This is the main cosmetic risk**: a stat page built without copying these
  values will look foreign.
- **Data fetching**: shared hooks in `src/appCore.js` (exports `supabase` client built from
  `VITE_SUPABASE_URL`/`VITE_SUPABASE_KEY`, `appCore.js:8-11`, plus `CURRENT_PATCH`, `BRAWLERS`,
  `MODE_COLORS`, `MODE_ICONS`, `GEAR_ICONS`). Pattern is a `useState` + `useEffect` hook per
  dataset returning `{data, loading, error}` (e.g. the patches/maps/stats hooks at `App.jsx:36-85`).
  Serverless endpoints are called with plain `fetch("/api/...")` — see the existing player-card
  component (`App.jsx:281+`) which already consumes `/api/player`.
- **Asset convention**: brawler/mode/gear art is hotlinked from **`cdn.brawlify.com`**
  (`appCore.js:40`, `:54`). Worth noting in the competitive analysis: we already depend on a
  competitor's CDN for imagery. That is a supply-chain risk (they can rate-limit, hotlink-block, or
  rename paths at will) and should be an explicit line item in the plan.
- **Auth**: Supabase Auth via `src/auth.jsx` (89 lines) + `AuthModal.jsx` (144 lines); `Profiles`
  holds the permanent display name. A "claim your tag" flow attaches to this.

## W3.3 — Scheduling headroom (detail)
| workflow | cron (UTC) |
|---|---|
| `scrape-masters.yml` | `0 0,6,12,18 * * *` |
| `scrape-leaderboard.yml` | `0 5,11,17,23 * * *` |
| `scrape-diamond-mythic.yml` | `30 7 * * *` |
| `refresh-intelligence.yml` | `30 8 * * *` |

No `timeout-minutes` is set on any job, so GitHub's 360-minute default applies. Free slots are
plentiful; the real constraint on a player-poller is the **shared Supercell API key + single proxy
IP** (risk E.1), not Actions capacity. A poller must therefore be scheduled to *avoid* overlapping
the masters/leaderboard windows above, or it will contend with them for the same rate budget.

STATUS: complete
