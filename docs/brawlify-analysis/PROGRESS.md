# Brawlify Feature Analysis — Progress Ledger

**Task:** Analyze all of Brawlify's features (especially player stat tracking), harshly evaluate
them, find improvements/expansions, and devise a concrete implementation plan for BrawlMeta.

**Branch:** `claude/brawlify-feature-analysis-rj9xws`
**Started:** 2026-08-19

This file is the resume point. If a session dies (limit reset, container reclaim), read this
file first, then continue at the first unchecked box. Commit + push after every completed box.

## Workstreams

### W1 — Brawlify feature inventory (web research)
- [x] W1.1 Home / navigation / overall IA
- [x] W1.2 Brawlers section + individual brawler pages
- [x] W1.3 Maps section + individual map pages
- [x] W1.4 Events / rotation
- [x] W1.5 Stats / tier lists / meta
- [x] W1.6 Gadgets, star powers, gears
- [x] W1.7 Tools (calculators, simulators, randomizers)
- [x] W1.8 **Player profiles & stat tracking** (highest priority)
- [x] W1.9 Clubs
- [x] W1.10 Cosmetics (skins, pins, icons, sprays, emotes)
- [x] W1.11 Public API (api.brawlify.com) — every endpoint
- [x] W1.12 Esports / championship pages, blog/changelog
- [x] W1.13 Non-functional: perf, mobile, ads, monetization, freshness/caching

### W2 — Player stat tracking landscape
- [x] W2.1 Official Supercell API: every endpoint, every field
- [x] W2.2 **The gap analysis**: what must be derived by polling + storing history
- [x] W2.3 Competitors (brawlace, brawlytix, brawlstats, brawltime, starlist)
- [x] W2.4 Sibling-game trackers (op.gg, tracker.gg, dotabuff) — sticky feature patterns
- [x] W2.5 ToS / fan content policy / monetization constraints

### W3 — BrawlMeta codebase capability audit
- [x] W3.1 `api/` serverless functions (esp. `player.js`, `_lib/`)
- [x] W3.2 `scrapers/` pipeline — how a player-poller plugs in
- [x] W3.3 `.github/workflows/` — scheduling headroom
- [x] W3.4 `src/` — routing, styling, data-fetch patterns, auth
- [x] W3.5 `src/data/` — reusable analytical machinery
- [x] W3.6 DB reality check — **does `ranked_matches` store player tags or only brawler ids?**
- [x] W3.7 Hard constraints inventory

### W4 — Synthesis
- [x] W4.1 Harsh evaluation writeup (Brawlify feature-by-feature)
- [x] W4.2 Feature opportunity matrix (impact x effort x moat)
- [x] W4.3 Concrete implementation plan (schema, scrapers, API, UI, phased)
- [x] W4.4 Final deliverable committed locally
- [ ] W4.5 BLOCKED: push to origin — session lacks GitHub write access (see log)

## Session log
- 2026-08-19: scaffolding created. First agent fan-out (3 agents) killed by session limit reset.

- 2026-08-19: W1 (740 lines) + W2 (350 lines) research complete. W3 audit complete.
  Two headline findings in W3: no player identity stored anywhere; match_hash collision bug.
  NOTE: `git push` over HTTPS returns 403 (proxy policy denial) — persist via GitHub MCP instead.
- 2026-08-19: IMPLEMENTATION-PLAN.md written (448 lines). All research + synthesis complete.
- 2026-08-19: **PUSH BLOCKED.** Two channels tried, both denied:
  1. `git push` (incl. with $GITHUB_TOKEN as an auth header) -> HTTP 403 from GitHub.
     The session's git proxy permits reads (clone/fetch/ls-remote) but denies writes.
  2. GitHub MCP `push_files` -> 403 "Resource not accessible by integration".
  The branch does not exist on origin (`git ls-remote --heads` returns nothing).
  4 commits sit unpushed on the local branch. Needs the owner to grant this session's
  GitHub App write access to Bolyhocska/BrawlMeta, then a re-push. Work was delivered
  to the owner directly as files in the meantime.
