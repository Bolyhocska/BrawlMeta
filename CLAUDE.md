# BrawlMeta — Claude handoff

Brawl Stars stats + automated-tournament site. Live at **https://brawl-meta.vercel.app**.
Stack: Vite + React (no TS) · Vercel serverless functions (`api/`) · Supabase Postgres · Python scrapers on GitHub Actions.

⚠️ **This repo is PUBLIC.** Never commit secrets, key values, or tokens into any file — including this one. Document where a secret lives, never what it is.

## Core principles (non-negotiable)

1. **Players NEVER pay.** Monetization is premium subscriptions + organizer fees only. No player-side charges, ever.
2. **Premium is enforced server-side** (checked in `api/` against the DB), never trusted from the client.
3. **Display names are permanent and globally unique** (case-insensitive). Once set, locked. Signup autofills it; profile shows 🔒.
4. **Player tags are globally unique and freeze after the first tournament played** (anti account-selling/impersonation). Future: verify tag ownership via the Supercell API before real-money prizes.
5. **`ranked_matches` uses owner-authorized windowed retention** (2026-07-20): the Masters bracket is FIFO-capped at 1.5M rows by `collected_at` via the `prune_ranked_matches` RPC, called only by the masters scraper after each push. NEVER bulk-delete outside this mechanism, never manually; schema changes stay additive, verified migrations only.
6. **`SUPABASE_KEY` used by scrapers is the service-role key** — GitHub Actions secrets only, never in the browser bundle. The frontend uses the anon key (`VITE_SUPABASE_KEY`).
7. New tables get RLS enabled + a `"Public read access"` SELECT policy for `anon, authenticated`; writes happen via service role (bypasses RLS) or SECURITY DEFINER RPCs with `auth.uid()` guards.

## Architecture map

- **`src/`** — React app. `appCore.js` (supabase client, shared hooks: `useMapMatches` reads the `Matches` VIEW), `App.jsx` (tabs: tier list / leaderboards / draft), `DraftAssistant.jsx`, `TournamentPages.jsx`, `SiteHeader.jsx`, `AuthModal.jsx`.
- **`src/data/`** — `draft_logic_config.json` (**single source of truth** for the Intelligence Engine: Bobby's 7 draft classes, counter matrix, mode tempo, coefficients, plus `mapProfiles` (per-map openness/bush geometry), `brawlerAttributes` (range/attackType/spawner/bushSynergy) and `attributeRules` (geometry & spawner interaction rules, dampened when live map data exists) — read by BOTH the browser engine and Python), `draftEngine.js` (5-pass draft advisor + win split), `draftMeta.js` (per-brawler blind-pick safety), `brawlerMeta.json`, `bracket.js` (tournament math), `verifyLogic.js`.
- **`api/`** — Vercel serverless (ESM). Tournament flow: `generate-bracket`, `tournament` RPC callers, `report-result` (OCR fast-path), `verify-match` (battle-log check), `report-dodge`, `set-lobby-invite`, `bracket-state` (lazy sweeps, `advanceAndMaybeFinish` completes tournaments + credits wallets), `declare-winner`, `reset-match`, `player` (live player card lookup). Shared: `api/_lib/db.js`, `api/_lib/ocr.js` (Claude Haiku vision, model `claude-haiku-4-5-20251001`), `api/_lib/proxyFetch.js`.
  - **These run only on deployed Vercel** — NOT under local `npm run dev`.
- **`scrapers/`** — Python package, one module per source: `masters.py` (spider, 1.5M baseline → 50k steady, then FIFO window prune at 1.5M; top-200 seeding from brawlytix.com — plain server-rendered HTML, browser UA only, confirmed 2026-07-20 — with brawlace as a Cloudflare-JS-gated secondary source via `cloudscraper`+proxy, and the spider self-seeds `masters_players` with depth-1-from-verified-only discoveries, replaced each run to bound drift, anchored by the 5 hardcoded pros so both sources being down never stops rotation), `diamond_mythic.py` (gated on Masters baseline), `leaderboard.py` (top-200 + event rotation), `meta_weights.py` (syncs `brawler_classes` from the config, refreshes `brawler_intelligence` + pair RPCs), `common.py` (shared spider/insert pipeline + `prune_bracket`; dedupe is DB-side via `on_conflict=match_hash&ignore-duplicates`).
- **`.github/workflows/`** — one workflow per scraper: `scrape-leaderboard.yml` (4×/day), `scrape-masters.yml` (06:00 UTC), `scrape-diamond-mythic.yml` (07:30 UTC), `refresh-intelligence.yml` (08:30 UTC safety net). All have `workflow_dispatch`.

## Database (Supabase Postgres)

Normalized match storage (2026-07-16; DB went 149→68 MB):
- **`ranked_matches`** — uuid PK = the scraper's md5 dedupe hash; smallint FKs `map_id/bracket_id/patch_id/w1-w3/l1-l3`; `collected_at` (added 2026-07-20, pre-existing rows carry the migration timestamp) drives the FIFO window + recency stats. Indexes `(patch_id, map_id)`, `(bracket_id, collected_at)`.
- Lookups: **`brawlers`**, **`maps`** (carries `mode`; map→mode is 1:1), **`patches`**, **`rank_brackets`**, **`brawler_classes`** (draft class per brawler, synced from config).
- **`Matches` is a VIEW** (security_invoker) over `ranked_matches` with the legacy shape (`map,mode,rank_bracket,patch,winners,losers,match_hash`) so the frontend never changed. **It is read-only — INSERT into `ranked_matches`, never the view.**
- **`BrawlerStats`** — tier-list aggregates; rebuilt by RPC `aggregate_brawler_stats(target_patch)`.
- **`brawler_intelligence`** — per patch+bracket+brawler: Bayesian `true_win_rate`, flags (`popularity_trap`/`broken`/`inflation_bias`), `vs_class` jsonb (empirical WR vs each enemy class), `vs_brawler` jsonb (WR vs each specific enemy brawler, ≥`pairMinPicks` pairs) and `with_brawler` jsonb (duo WR with each specific teammate). Rebuilt by RPC `refresh_brawler_intelligence(target_patch, coeff)`; the pair columns by `refresh_brawler_pairs(target_patch, target_bracket, coeff)` called once per bracket (inlining them into the main RPC blew the statement budget on 470k+ matches — keep them split). Coeff comes from the config JSON. `pick_rate` here = share of matches (0–100), NOT share of total picks.
- Tournament tables: `Tournaments`, `Registrations`, `TournamentMatches`, `TournamentFeedback`, `Verifications`, `UserWallets`, `Profiles`.
- Feeds: `SiteFeed` (raw payload relays), `top_200_leaderboard`, `masters_players` (brawlace top-100), `diamond_mythic_players` (curated seeds).
- `brawler_intelligence` also carries `recent_picks/recent_wins/recent_win_rate` (last `recency.windowDays` days by `collected_at`); the engine blends recent WR at `recency.recentWeight` over the patch aggregate when the recent sample ≥ `minRecentPicks`, and shows Trending up/down chips on ≥`trendDeltaPct` divergence — this is the mid-patch shadow-nerf defense; announced balance patches are handled by bumping `CURRENT_PATCH` (patches = balance epochs).
- `service_role` has an explicit `statement_timeout = 600s` (set 2026-07-20 — the heavy RPCs outgrew the cluster default at ~475k matches and every aggregation 57014'd). Frontend roles keep 3s/8s.
- RPC gotcha: when changing a tournament RPC's signature, **DROP the old overload first** — duplicate overloads break PostgREST ("could not choose best candidate function").
- Patch bookkeeping lives in `scrapers/common.py`: `CURRENT_PATCH`, `PATCH_START_TIMES`, `CLOSED_PATCHES`, `RANKED_MAPS` per patch. On a new patch, update these + add the map list.

## Access & credentials (where, not what)

| Service | How Claude accesses it | Where credentials live |
|---|---|---|
| **Supabase** | `mcp__supabase__*` MCP tools (execute_sql, apply_migration, list_tables…) — already connected in Claude Code, no setup needed | Frontend anon key: Vercel env + `.env` as `VITE_SUPABASE_URL/KEY`. Service-role key: GitHub Actions secrets + Vercel env as `SUPABASE_URL`/`SUPABASE_KEY` |
| **Vercel** | `mcp__…__list_deployments / get_deployment_build_logs / get_runtime_logs` MCP tools. Deploys happen automatically on push to `master` — never deploy manually | Env vars managed in the Vercel dashboard (already uploaded): Supabase keys, `SUPERCELL_API_KEY`, `PROXY_HOST/PORT/USER/PASS`, `ANTHROPIC_API_KEY` (OCR) |
| **GitHub** | Plain `git push` — the PAT is embedded in the local git remote URL (`git remote -v` shows it; that's why the repo must stay free of other secrets). PAT has `repo` + `workflow` scopes (workflow scope added 2026-07-16) | Actions secrets (repo Settings → Secrets): `SUPERCELL_API_KEY`, `SUPABASE_URL`, `SUPABASE_KEY`, `PROXY_HOST/PORT/USER/PASS`. `gh` CLI is NOT installed |
| **Supercell API** | Never from the browser (key is IP-allowlisted). Server side: `api/_lib/proxyFetch.js`; scrapers: `requests` + `PROXIES` in `common.py`. Both route through the same Webshare static-IP proxy | Key + proxy creds in Vercel env and Actions secrets (same names) |
| **Anthropic API** | `api/_lib/ocr.js` (screenshot verification) | `ANTHROPIC_API_KEY` in Vercel env |

## Hard-won pitfalls

- **undici**: when passing a `ProxyAgent` from the standalone `undici` package, you MUST use `import { fetch } from "undici"` — Node's global fetch rejects it with `UND_ERR_INVALID_ARG`. Also pass proxy auth as explicit `token`, not URL userinfo.
- **React**: never define a component inside another component's render — inputs remount and lose focus every keystroke (the create-tournament bug).
- **Supabase inserts** from scrapers: batch ≤2000 rows, pause between batches; a giant single insert hits statement timeout 57014 and rolls back entirely.
- **New tables need `ANALYZE`** after bulk backfill, or the planner picks catastrophic nested-loop plans.
- **Locale**: the user's browser is Hungarian — use `toLocaleString("en-US")` for number formatting or thousands separators render as dots.
- Windows dev box: PowerShell 5.1 quirks apply; the repo uses CRLF locally (LF warnings on commit are normal).

## Current state / open threads (2026-07-16)

- Intelligence Engine live: 5-pass `getDraftAdvice` + `computeWinSplit` (capped 85-15, always sums to 100) in the Draft Assistant. Suggestion cards headline a confidence-honest WR (falls back to overall when the map sample < `minMapPicks`), a one-line `matchupNote`, and short chips — no more rationale paragraph. `counterStack` (config `constraints`) makes a hard counter to a class the enemy stacked (2+) surface strongly, applied AFTER mode weighting. Draft-complete verdict labels the win split as "matchup edge" vs the "roster strength / solo WR" rows so the two numbers stop reading as contradictory.
- Draft classes are owner-confirmed: `NORI` = SPACE_MAKER (assassin), `DAMIAN` = TANK. Both are API-`Unknown`, so they live only in `brawlerClassOverrides`; the DB `vs_class` reflects a class change only after `refresh-intelligence` reruns `meta_weights.py`.
- Scraper collects competitive Ranked ONLY: `common.py` filter is `"ranked" in type and type != "ranked"` (drops trophy-ladder `type:"ranked"`, keeps `soloRanked`/`teamRanked`), PLUS two 2026-07-19 guards: skip any battle carrying `trophyChange` (competitive Ranked never has it), and require exactly 2 teams × 3 players (blocks 5v5 events with colliding mode names). Pre-2026-07-16 rows still contain trophy pollution and can't be purged (battle `type` was never stored). Verify with a `workflow_dispatch` — near-zero collection means a guard is wrong for the live API shape (e.g. if `trophyChange` ever appears on soloRanked, remove that guard).
- `src/data/generalTierList.json` is an intentionally empty hand-curated list — the tier list "GENERAL" tab is blank until the owner fills it.
- User must drop `add-friend-id.png` + `add-friend-qr.png` into `public/help/` (registration example images hide via onError until then).
- Future: Stripe Connect for prize payouts (needs business entity first); Supercell-API tag-ownership verification before real-money prizes.
