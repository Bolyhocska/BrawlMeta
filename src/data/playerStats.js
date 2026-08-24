// ─── Player statistics core ───────────────────────────────────────────────────
// Shared by /player/:tag and /profile. Implements the "honesty kit" from
// docs/brawlify-analysis/PROFILE-FEATURE-SPEC.md §3 — the primitives every panel
// on those pages is required to go through.
//
// THE ONE RULE THIS FILE EXISTS TO ENFORCE: a tracked player's sample is 2.2x
// smaller than their row count suggests. Ranked is played as a best-of series
// and we store every round, so 14,603 rows are only ~6,500 drafts. Counting
// rounds as independent observations would inflate every sample size on the
// page by more than double and make confidence intervals that are simply wrong.
// Everything here counts SERIES.

import { computeWinSplit } from "./draftEngine";
import { supabase } from "../appCore";

// Measured 2026-08-24 over 14,603 stored rows: median inter-round gap 131s,
// max observed 476s, 2.22 rounds per series. 15 minutes is comfortably clear of
// the observed maximum without being loose enough to merge separate matchups.
const SERIES_GAP_MS = 15 * 60 * 1000;

// Shrink prior, in series. A series outcome is Bernoulli with SD ~0.5, so a
// 25-series rate has SE ~10 points; k = 25 halves an observed delta at n = 25.
// PROVISIONAL — the spec (§3.2) gives a calibration method to run once ~200
// players hold >=60 series, mirroring how pairEdgeVs's prior of 135 was derived.
export const SHRINK_K = 25;

// Bucket edges for "did the draft favour you" (§5 DR-2).
export const FAVOURED_AT = 0.56;
export const UNDERDOG_AT = 0.44;

// ── series ───────────────────────────────────────────────────────────────────

/**
 * Collapse rounds into drafts. `rows` must be newest-first.
 * Consecutive rows sharing map + both comps within SERIES_GAP_MS are one series.
 */
export function toSeries(rows) {
  const out = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    const sameLineup =
      last &&
      last.map_id === r.map_id &&
      last.teamKey === (r.team_brawlers || []).join() &&
      last.enemyKey === (r.enemy_brawlers || []).join() &&
      Math.abs(new Date(last.oldest).getTime() - new Date(r.battle_time).getTime()) <= SERIES_GAP_MS;

    if (sameLineup) {
      last.rounds.push(r);
      last.oldest = r.battle_time;
    } else {
      out.push({
        key: r.match_key,
        map_id: r.map_id, map: r.map, mode: r.mode,
        brawler_id: r.brawler_id, brawler: r.brawler,
        team_brawlers: r.team_brawlers, enemy_brawlers: r.enemy_brawlers,
        teamNames: r.teamNames, enemyNames: r.enemyNames,
        team_tags: r.team_tags, enemy_tags: r.enemy_tags,
        bracket: r.bracket, patch: r.patch,
        teamKey: (r.team_brawlers || []).join(),
        enemyKey: (r.enemy_brawlers || []).join(),
        newest: r.battle_time, oldest: r.battle_time,
        rounds: [r],
      });
    }
  }
  for (const s of out) {
    s.roundsWon = s.rounds.filter(r => r.result === 1).length;
    s.won = s.roundsWon > s.rounds.length / 2;
    s.started_at = s.oldest;
  }
  return out;
}

// ── shrinkage ────────────────────────────────────────────────────────────────

/**
 * Shrink a personal rate toward the POPULATION baseline, never toward 50%.
 * At n = 0 the returned delta is exactly 0 — the correct way to say "we don't
 * know yet". Shrinking toward 50% would make a player look bad on a brawler
 * whose population rate is 56%, purely for having no data.
 */
export function shrink(wins, n, baseline, k = SHRINK_K) {
  const b = Number.isFinite(baseline) ? baseline : 0.5;
  if (!n) return { rate: b, delta: 0, n: 0 };
  const rate = (wins + k * b) / (n + k);
  return { rate, delta: rate - b, n };
}

/** Standard error of a proportion over n series, in percentage points. */
export const sePoints = (n) => (n ? (0.5 / Math.sqrt(n)) * 100 : Infinity);

// ── the display ladder (§3.4) ────────────────────────────────────────────────
// 0: don't render · 1: record only, no % · 2: estimate + band · 3: verdict allowed
export const LADDER = { EMPTY: 0, RECORD_ONLY: 1, ESTIMATE: 2, VERDICT: 3 };

export function ladderState(n, threshold, bandExcludesZero = false) {
  if (!n) return LADDER.EMPTY;
  if (n < threshold) return LADDER.RECORD_ONLY;
  return bandExcludesZero ? LADDER.VERDICT : LADDER.ESTIMATE;
}

// ── grading (the flagship's engine) ──────────────────────────────────────────
// Module-level caches: grading 40 series costs ~1 intelligence fetch and ~15 map
// fetches rather than 40 of each, and two pages share the same cache.

const intelCache = new Map();
const mapStatsCache = new Map();
export const DEFAULT_BRACKET = "masters_legendary";

export function loadIntelligence(patch, bracket) {
  const key = `${patch}|${bracket}`;
  if (!intelCache.has(key)) {
    intelCache.set(key, supabase
      .from("brawler_intelligence")
      // Only what computeWinSplit reads. vs_brawler is a large jsonb blob, so
      // select("*") here would move far more than needed.
      .select("brawler,true_win_rate,recent_picks,recent_wins,vs_brawler")
      .eq("patch", patch).eq("rank_bracket", bracket)
      .then(({ data }) => {
        const by = {};
        for (const r of data || []) by[(r.brawler || "").toUpperCase()] = r;
        return by;
      }));
  }
  return intelCache.get(key);
}

export function loadMapStats(map, patch, bracket) {
  const key = `${map}|${patch}|${bracket}`;
  if (!mapStatsCache.has(key)) {
    mapStatsCache.set(key, supabase
      .from("BrawlerStats").select("brawler,picks,wins")
      .eq("map", map).eq("patch", patch).eq("rank_bracket", bracket)
      .then(({ data }) => {
        const by = {};
        for (const r of data || []) {
          const k = (r.brawler || "").toUpperCase();
          if (!k) continue;
          if (!by[k]) by[k] = { picks: 0, wins: 0 };
          by[k].picks += Number(r.picks) || 0;
          by[k].wins += Number(r.wins) || 0;
        }
        return by;
      }));
  }
  return mapStatsCache.get(key);
}

/**
 * Attach the draft's own win probability to each series.
 * `p` is OUR side's probability. Series we cannot grade keep p = null and are
 * excluded from every downstream statistic rather than defaulted to 0.5, which
 * would quietly pull Above Draft toward zero.
 */
export async function gradeSeries(series) {
  const needed = new Map();
  for (const s of series) {
    const bracket = s.bracket || DEFAULT_BRACKET;
    needed.set(`${s.patch}|${bracket}`, { patch: s.patch, bracket });
  }
  const intelByKey = {};
  await Promise.all([...needed.values()].map(async ({ patch, bracket }) => {
    intelByKey[`${patch}|${bracket}`] = await loadIntelligence(patch, bracket);
  }));

  const mapKeys = new Map();
  for (const s of series) {
    const bracket = s.bracket || DEFAULT_BRACKET;
    mapKeys.set(`${s.map}|${s.patch}|${bracket}`, { map: s.map, patch: s.patch, bracket });
  }
  const statsByKey = {};
  await Promise.all([...mapKeys.values()].map(async ({ map, patch, bracket }) => {
    statsByKey[`${map}|${patch}|${bracket}`] = await loadMapStats(map, patch, bracket);
  }));

  return series.map(s => {
    const bracket = s.bracket || DEFAULT_BRACKET;
    const intelligence = intelByKey[`${s.patch}|${bracket}`] || {};
    const mapStats = statsByKey[`${s.map}|${s.patch}|${bracket}`] || {};
    if (!Object.keys(mapStats).length) return { ...s, p: null, split: null };
    try {
      const split = computeWinSplit({
        blueTeam: s.teamNames, redTeam: s.enemyNames, mode: s.mode,
        mapStats, intelligence,
      });
      return { ...s, p: Number(split.blue) / 100, split, assumedBracket: !s.bracket };
    } catch {
      return { ...s, p: null, split: null };
    }
  });
}

// ── OV-1 Above Draft ─────────────────────────────────────────────────────────

/**
 * Expected wins from the drafts themselves, versus wins actually taken.
 * SE comes from the drafts: sqrt(sum p(1-p)). A run of coin-flip drafts carries
 * more inherent variance than a run of lopsided ones, and this says so.
 */
export function aboveDraft(graded) {
  const usable = graded.filter(s => s.p != null).slice().reverse(); // oldest first
  let E = 0, A = 0, varSum = 0;
  const points = [];
  for (const s of usable) {
    E += s.p;
    A += s.won ? 1 : 0;
    varSum += s.p * (1 - s.p);
    points.push({ n: points.length + 1, delta: A - E, se: Math.sqrt(varSum), at: s.started_at });
  }
  const se = Math.sqrt(varSum);
  const delta = A - E;
  return {
    n: usable.length, expected: E, actual: A, delta, se, points,
    // The ribbon excluding zero is what unlocks a verdict sentence (§3.4 state 4).
    bandExcludesZero: usable.length > 0 && Math.abs(delta) > 2 * se,
  };
}

// ── DR-2 favoured / even / underdog ──────────────────────────────────────────

export function draftBuckets(graded) {
  const mk = () => ({ n: 0, wins: 0 });
  const b = { favoured: mk(), even: mk(), underdog: mk() };
  for (const s of graded) {
    if (s.p == null) continue;
    const k = s.p >= FAVOURED_AT ? "favoured" : s.p <= UNDERDOG_AT ? "underdog" : "even";
    b[k].n += 1;
    if (s.won) b[k].wins += 1;
  }
  for (const k of Object.keys(b)) b[k].rate = b[k].n ? b[k].wins / b[k].n : null;
  return b;
}

export const bucketOf = (p) =>
  p == null ? null : p >= FAVOURED_AT ? "favoured" : p <= UNDERDOG_AT ? "underdog" : "even";

// ── OV-2 event facts ─────────────────────────────────────────────────────────
// Events, not rates. "You won a draft the engine gave you 31%" is checkable,
// singular, and needs no statistics — so it works from the very first series,
// which is exactly what a cold-start profile needs.

const fmtDate = (d) =>
  new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function eventFacts(graded, { starWins = 0, starKnownWins = 0 } = {}) {
  const facts = [];
  const usable = graded.filter(s => s.p != null);

  const biggestUpset = usable
    .filter(s => s.won)
    .reduce((best, s) => (!best || s.p < best.p ? s : best), null);
  if (biggestUpset && biggestUpset.p <= 0.45) {
    facts.push({
      icon: "⚡",
      text: `You won a draft the engine gave you ${Math.round(biggestUpset.p * 100)}% in — ${biggestUpset.map}, ${fmtDate(biggestUpset.started_at)}.`,
    });
  }

  const worstGiveaway = usable
    .filter(s => !s.won)
    .reduce((best, s) => (!best || s.p > best.p ? s : best), null);
  if (worstGiveaway && worstGiveaway.p >= 0.60) {
    facts.push({
      icon: "💀",
      text: `You lost one the engine gave you ${Math.round(worstGiveaway.p * 100)}% in — ${worstGiveaway.map}, ${fmtDate(worstGiveaway.started_at)}.`,
    });
  }

  // Longest run of won series. An event, so no rate threshold applies.
  let run = 0, best = 0;
  for (const s of graded.slice().reverse()) {
    run = s.won ? run + 1 : 0;
    if (run > best) best = run;
  }
  if (best >= 3) facts.push({ icon: "🔥", text: `Your best run is ${best} series won back to back.` });

  // Star Player is only meaningful conditioned on a win — see spec §0.2. The
  // unconditional rate mostly measures whether you won, not whether you carried.
  if (starKnownWins >= 25) {
    const rate = (starWins / starKnownWins) * 100;
    facts.push({
      icon: "⭐",
      text: `You're Star Player in ${rate.toFixed(0)}% of your wins. Across everyone we track it's 37%.`,
    });
  }

  const counts = {};
  for (const s of graded) for (const n of s.enemyNames || []) counts[n] = (counts[n] || 0) + 1;
  const mostFaced = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (mostFaced && graded.length >= 20) {
    facts.push({ icon: "🎯", text: `You've faced ${mostFaced[0]} more than anyone — ${mostFaced[1]} times.` });
  }

  return facts;
}

// ── OP-3 / OP-4 squad and rivals ─────────────────────────────────────────────
// Free from team_tags / enemy_tags, and statistically safe: these are COUNTS of
// encounters, not rates, so they carry no sample-size problem at all.

export function squadAndRivals(series, selfTag) {
  const mates = {}, foes = {};
  for (const s of series) {
    for (const t of s.team_tags || []) {
      if (!t || t === selfTag) continue;
      mates[t] = mates[t] || { tag: t, n: 0, wins: 0 };
      mates[t].n += 1;
      if (s.won) mates[t].wins += 1;
    }
    for (const t of s.enemy_tags || []) {
      if (!t || t === selfTag) continue;
      foes[t] = foes[t] || { tag: t, n: 0, wins: 0 };
      foes[t].n += 1;
      if (s.won) foes[t].wins += 1;   // wins = times WE beat them
    }
  }
  const rank = (o) => Object.values(o).sort((a, b) => b.n - a.n);
  return { squad: rank(mates).filter(m => m.n >= 2), rivals: rank(foes).filter(f => f.n >= 2) };
}
