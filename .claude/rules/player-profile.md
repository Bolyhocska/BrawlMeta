---
paths:
  - "src/data/playerStats.js"
  - "src/PlayerInsights.jsx"
  - "src/PlayerPage.jsx"
  - "src/TournamentPages.jsx"
  - "scrapers/player_tracker.py"
---

<!-- Moved verbatim from CLAUDE.md on 2026-11-18 (setup audit). Loads only when a matching file is read or edited; the full pre-split file is .claude/archive/CLAUDE-2026-11-18.md. -->

## Player profile — what the sample can and cannot support

**Measured 2026-09-19 over 1,224 tracked players. Check this table before promising any new profile breakdown.** The median player has 151 `player_matches` rows (~125 series) and the heaviest in the whole database has 561.

| breakdown | heaviest player | median player |
|---|---|---|
| vs a specific enemy brawler | 27 brawlers at ≥20 series | **1** |
| with a specific teammate brawler | 28 at ≥20 | **2** |
| own brawler × mode | 6 cells at ≥15 | **0** |
| own brawler × **map** | **best cell 9** | best cell 1–2 |
| per enemy CLASS | ~65 per class | ~65 per class |

- **Class-level breakdowns carry the page**; seven buckets over three enemies a draft survive a median sample, which is why the donut and the vs-class panel are the load-bearing ones and the per-brawler panels hide themselves below a floor.
- **"Am I worse with this brawler on THIS MAP" is NOT buildable and was deliberately not built at any floor.** The largest brawler-on-one-map cell in the entire database is **9 series** — that cannot separate a real weakness from a run of bad luck, and a floor low enough to show something would show noise. Brawler × MODE is the shipped substitute (six buckets instead of twenty) and even that only lists a cell when the gap beats the cell's own standard error.
- **Every profile rate shrinks toward the PLAYER'S OWN overall series rate**, never 50% and never the population — the question is "is this different for me", so a 48% player who is 54% into throwers has learned something. `shrink()` in `playerStats.js` already takes the baseline as an argument; pass `baselineRate(series)`.
- **A draft with two throwers counts ONCE for THROWER.** The unit is the series outcome; counting it twice lets one win support two observations and shrinks the error bar on a sample that never grew.
- **A row below its floor gets no percentage AND no bar.** A dimmed bar still asserts a magnitude, and a small-n record shrinks to a LARGE delta — an 11-2 thrower record was drawing the longest bar on the panel, which is the row we were explicitly refusing to rate. Show the raw record instead.
- `DonutChart` (`Charts.jsx`) encodes pick share in its angles and nothing else. Colouring slices by win rate as well was tried and dropped: it makes a large slice of a weak class look like a large problem when it is only a preference, and it collides with the site-wide green/red = above/below convention.

## The percentile cohort — what a player is actually compared to

**`player_percentiles(tag)` ranks against a SAMPLE of Masters-tier players, not the best N players in the world, and the owner had to ask — so say it on the page, not just here.** Measured 2026-09-20 over the 1,034 players with ≥30 tracked rounds:

| | |
|---|---|
| seeded `tier=3`, `seed_bracket=masters_legendary` | **1,029** |
| in `top_200_leaderboard` (verifiably global top 200) | **56** |
| in `masters_players` | 575 |
| looked up by a visitor (`tier=2`) | 5 |

- The spider starts from the global top 200 and the Masters list and walks **2 hops** out through battlelogs, so the cohort is those players, their opponents, and their opponents' opponents. Masters-ish by proximity, which is the same approximation `seed_bracket` makes everywhere else.
- **Selection bias worth naming: it finds people by seeing them IN battlelogs, so it favours HIGH-VOLUME players.** This is Masters-tier grinders more than Masters-tier players in general.
- The cohort median win rate is **57%**, not 50% — these players were selected for being good. Mid-table here is well above the game average, and any copy that implies otherwise is flattering or scaring the reader depending on which side they land.
- The RPC ranks on **rounds** while the profile headline counts **series**, because series grouping needs the 15-minute same-lineup rule and is not cheap in SQL. Rounds are used for everyone so the ORDERING holds — but print the RANK only, never the RPC's win rate, or the page contradicts itself two cards apart.

