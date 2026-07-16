# BrawlMeta — Claude handoff

Brawl Stars stats + automated-tournament site. Live at **https://brawl-meta.vercel.app**.
Stack: Vite + React (no TS) · Vercel serverless functions (`api/`) · Supabase Postgres · Python scrapers on GitHub Actions.

⚠️ **This repo is PUBLIC.** Never commit secrets, key values, or tokens into any file — including this one. Document where a secret lives, never what it is.

## Core principles (non-negotiable)

1. **Players NEVER pay.** Monetization is premium subscriptions + organizer fees only. No player-side charges, ever.
2. **Premium is enforced server-side** (checked in `api/` against the DB), never trusted from the client.
3. **Display names are permanent and globally unique** (case-insensitive). Once set, locked. Signup autofills it; profile shows 🔒.
4. **Player tags are globally unique and freeze after the first tournament played** (anti account-selling/impersonation). Future: verify tag ownership via the Supercell API before real-money prizes.
5. **Never wipe `ranked_matches`** (471k+ matches, the tier list & draft engine live on it). Additive changes only; verified migrations only.
6. **`SUPABASE_KEY` used by scrapers is the service-role key** — GitHub Actions secrets only, never in the browser bundle. The frontend uses the anon key (`VITE_SUPABASE_KEY`).
7. New tables get RLS enabled + a `"Public read access"` SELECT policy for `anon, authenticated`; writes happen via service role (bypasses RLS) or SECURITY DEFINER RPCs with `auth.uid()` guards.

## Architecture map

- **`src/`** — React app. `appCore.js` (supabase client, shared hooks: `useMapMatches` reads the `Matches` VIEW), `App.jsx` (tabs: tier list / leaderboards / draft), `DraftAssistant.jsx`, `TournamentPages.jsx`, `SiteHeader.jsx`, `AuthModal.jsx`.
- **`src/data/`** — `draft_logic_config.json` (**single source of truth** for the Intelligence Engine: Bobby's 7 draft classes, counter matrix, mode tempo, coefficients — read by BOTH the browser engine and Python), `draftEngine.js` (5-pass draft advisor + win split), `draftMeta.js` (per-brawler blind-pick safety), `brawlerMeta.json`, `bracket.js` (tournament math), `verifyLogic.js`.
- **`api/`** — Vercel serverless (ESM). Tournament flow: `generate-bracket`, `tournament` RPC callers, `report-result` (OCR fast-path), `verify-match` (battle-log check), `report-dodge`, `set-lobby-invite`, `bracket-state` (lazy sweeps, `advanceAndMaybeFinish` completes tournaments + credits wallets), `declare-winner`, `reset-match`, `player` (live player card lookup). Shared: `api/_lib/db.js`, `api/_lib/ocr.js` (Claude Haiku vision, model `claude-haiku-4-5-20251001`), `api/_lib/proxyFetch.js`.
  - **These run only on deployed Vercel** — NOT under local `npm run dev`.
- **`scrapers/`** — Python package, one module per source: `masters.py` (brawlace-seeded spider, 400k baseline → 50k steady), `diamond_mythic.py` (gated on Masters baseline), `leaderboard.py` (top-200 + event rotation), `meta_weights.py` (syncs `brawler_classes` from the config, refreshes `brawler_intelligence` via RPC), `common.py` (shared spider/insert pipeline; dedupe is DB-side via `on_conflict=match_hash&ignore-duplicates`).
- **`.github/workflows/`** — one workflow per scraper: `scrape-leaderboard.yml` (4×/day), `scrape-masters.yml` (06:00 UTC), `scrape-diamond-mythic.yml` (07:30 UTC), `refresh-intelligence.yml` (08:30 UTC safety net). All have `workflow_dispatch`.

## Database (Supabase Postgres)

Normalized match storage (2026-07-16; DB went 149→68 MB):
- **`ranked_matches`** — uuid PK = the scraper's md5 dedupe hash; smallint FKs `map_id/bracket_id/patch_id/w1-w3/l1-l3`. Index `(patch_id, map_id)`.
- Lookups: **`brawlers`**, **`maps`** (carries `mode`; map→mode is 1:1), **`patches`**, **`rank_brackets`**, **`brawler_classes`** (draft class per brawler, synced from config).
- **`Matches` is a VIEW** (security_invoker) over `ranked_matches` with the legacy shape (`map,mode,rank_bracket,patch,winners,losers,match_hash`) so the frontend never changed. **It is read-only — INSERT into `ranked_matches`, never the view.**
- **`BrawlerStats`** — tier-list aggregates; rebuilt by RPC `aggregate_brawler_stats(target_patch)`.
- **`brawler_intelligence`** — per patch+bracket+brawler: Bayesian `true_win_rate`, flags (`popularity_trap`/`broken`/`inflation_bias`), `vs_class` jsonb (empirical WR vs each enemy class). Rebuilt by RPC `refresh_brawler_intelligence(target_patch, coeff)` — coeff comes from the config JSON. `pick_rate` here = share of matches (0–100), NOT share of total picks.
- Tournament tables: `Tournaments`, `Registrations`, `TournamentMatches`, `TournamentFeedback`, `Verifications`, `UserWallets`, `Profiles`.
- Feeds: `SiteFeed` (raw payload relays), `top_200_leaderboard`, `masters_players` (brawlace top-100), `diamond_mythic_players` (curated seeds).
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

- Intelligence Engine live: 5-pass `getDraftAdvice` + `computeWinSplit` (capped 85-15, always sums to 100) in the Draft Assistant.
- `NORI` (newest brawler) is defaulted to CONTROL in `draft_logic_config.json` — unconfirmed, correct if wrong.
- `src/data/generalTierList.json` is an intentionally empty hand-curated list — the tier list "GENERAL" tab is blank until the owner fills it.
- User must drop `add-friend-id.png` + `add-friend-qr.png` into `public/help/` (registration example images hide via onError until then).
- Future: Stripe Connect for prize payouts (needs business entity first); Supercell-API tag-ownership verification before real-money prizes.
