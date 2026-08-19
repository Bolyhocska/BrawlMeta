# Brawlify Feature Analysis — Progress Ledger

**Task:** Analyze all of Brawlify's features (especially player stat tracking), harshly evaluate
them, find improvements/expansions, and devise a concrete implementation plan for BrawlMeta.

**Branch:** `claude/brawlify-feature-analysis-rj9xws`
**Started:** 2026-08-19

This file is the resume point. If a session dies (limit reset, container reclaim), read this
file first, then continue at the first unchecked box. Commit + push after every completed box.

## Workstreams

### W1 — Brawlify feature inventory (web research)
- [ ] W1.1 Home / navigation / overall IA
- [ ] W1.2 Brawlers section + individual brawler pages
- [ ] W1.3 Maps section + individual map pages
- [ ] W1.4 Events / rotation
- [ ] W1.5 Stats / tier lists / meta
- [ ] W1.6 Gadgets, star powers, gears
- [ ] W1.7 Tools (calculators, simulators, randomizers)
- [ ] W1.8 **Player profiles & stat tracking** (highest priority)
- [ ] W1.9 Clubs
- [ ] W1.10 Cosmetics (skins, pins, icons, sprays, emotes)
- [ ] W1.11 Public API (api.brawlify.com) — every endpoint
- [ ] W1.12 Esports / championship pages, blog/changelog
- [ ] W1.13 Non-functional: perf, mobile, ads, monetization, freshness/caching

### W2 — Player stat tracking landscape
- [ ] W2.1 Official Supercell API: every endpoint, every field
- [ ] W2.2 **The gap analysis**: what must be derived by polling + storing history
- [ ] W2.3 Competitors (brawlace, brawlytix, brawlstats, brawltime, starlist)
- [ ] W2.4 Sibling-game trackers (op.gg, tracker.gg, dotabuff) — sticky feature patterns
- [ ] W2.5 ToS / fan content policy / monetization constraints

### W3 — BrawlMeta codebase capability audit
- [ ] W3.1 `api/` serverless functions (esp. `player.js`, `_lib/`)
- [ ] W3.2 `scrapers/` pipeline — how a player-poller plugs in
- [ ] W3.3 `.github/workflows/` — scheduling headroom
- [ ] W3.4 `src/` — routing, styling, data-fetch patterns, auth
- [ ] W3.5 `src/data/` — reusable analytical machinery
- [ ] W3.6 DB reality check — **does `ranked_matches` store player tags or only brawler ids?**
- [ ] W3.7 Hard constraints inventory

### W4 — Synthesis
- [ ] W4.1 Harsh evaluation writeup (Brawlify feature-by-feature)
- [ ] W4.2 Feature opportunity matrix (impact x effort x moat)
- [ ] W4.3 Concrete implementation plan (schema, scrapers, API, UI, phased)
- [ ] W4.4 Final deliverable committed + pushed

## Session log
- 2026-08-19: scaffolding created. First agent fan-out (3 agents) killed by session limit reset.
