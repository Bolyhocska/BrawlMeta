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

import { computeWinSplit, draftClassOf, classLabel } from "./draftEngine";
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
      // Only what computeWinSplit reads, plus pick_rate for the draft
      // fingerprint. vs_brawler is a large jsonb blob, so select("*") here would
      // move far more than needed.
      .select("brawler,true_win_rate,recent_picks,recent_wins,vs_brawler,pick_rate")
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

// ── DR-3 the pick that was there ─────────────────────────────────────────────
// Hold the other five brawlers fixed, substitute each candidate into the
// player's own slot, and re-grade. THIS IS ORDER-FREE, which is what makes it
// legal: the battlelog carries no draft order (teams[] is roster order), so we
// can never say "you should have counter-picked". A straight swap assumes
// nothing about who picked when.
//
// It is also not advice about what was *available* — bans and brawler ownership
// are both invisible to us. It is strictly "the aggregate rates this comp
// higher", and the UI must say so.

// The engine's own floor for trusting a map sample (CONFIG.minMapPicks).
const MIN_MAP_PICKS = 30;
const MIN_IMPROVEMENT_PTS = 6;

// THE GUARD THAT ACTUALLY MATTERS, and it is not the improvement size.
//
// Taking the best of ~100 candidates will beat almost any pick by a wide margin
// — that is a property of maximising over a large pool, not evidence the player
// misdrafted. Measured on a real profile: gating only on "best swap gains >= 6
// points" fired on 11 of 11 drafts with gains up to +29, i.e. it would tell
// every player they misplayed every game, which is both useless and false.
//
// So the real test is not "how good is the best alternative" but "how bad was
// your pick, relative to everything else that was legal here". Only surface a
// suggestion when the played brawler sits in the bottom slice of the option
// distribution. That turns a statement which is trivially always true into one
// that is sometimes true and therefore worth reading.
const PICK_PERCENTILE_MAX = 0.30;

/**
 * @returns {{name, from, to, gain, percentile, better}|null}
 *   `percentile` is the share of legal options the played brawler beat.
 */
export function bestSwap(series, mapStats, intelligence, basePct) {
  const mine = (series.teamNames || []).slice();
  const slot = mine.indexOf(series.brawler);
  if (slot < 0 || basePct == null) return null;

  // The brawler actually played must itself have a real sample on this map,
  // otherwise the baseline we are improving on is guesswork.
  const own = mapStats[(series.brawler || "").toUpperCase()];
  if (!own || (own.picks || 0) < MIN_MAP_PICKS) return null;

  const inGame = new Set([...(series.teamNames || []), ...(series.enemyNames || [])].map(n => (n || "").toUpperCase()));

  const gains = [];
  let best = null;
  for (const [name, st] of Object.entries(mapStats)) {
    if (inGame.has(name)) continue;                 // already in this match
    if ((st.picks || 0) < MIN_MAP_PICKS) continue;  // thin on this map
    const candidate = mine.slice();
    candidate[slot] = name;
    let split;
    try {
      split = computeWinSplit({
        blueTeam: candidate, redTeam: series.enemyNames,
        mode: series.mode, mapStats, intelligence,
      });
    } catch { continue; }
    const gain = Number(split.blue) - basePct;
    if (!Number.isFinite(gain)) continue;
    gains.push(gain);
    if (!best || gain > best.gain) best = { name, gain, to: Number(split.blue) };
  }

  if (!best || gains.length < 20) return null;   // too few legal options to rank against
  if (best.gain < MIN_IMPROVEMENT_PTS) return null;

  // Share of legal options the played brawler was already better than.
  const worseThanMine = gains.filter(g => g < 0).length;
  const percentile = worseThanMine / gains.length;
  if (percentile > PICK_PERCENTILE_MAX) return null;

  return { ...best, from: basePct, percentile, better: gains.length - worseThanMine };
}

// ── BR-2 draft fingerprint ───────────────────────────────────────────────────
// A DISTRIBUTION, not a rate — which is why it is the cold-start feature. At 20
// series a win rate is worthless, but a player who has picked 20 times genuinely
// does have a taste profile, and "you have never once picked a tank" is true and
// interesting immediately.

/**
 * @param intelligence keyed brawler -> { pick_rate } for the matching bracket.
 * @returns [{ cls, mine, theirs, diff, count, notable }] sorted by |diff|.
 */
export function classFingerprint(series, intelligence) {
  const n = series.length;
  const mineCounts = {};
  for (const s of series) {
    const cls = draftClassOf(s.brawler);
    mineCounts[cls] = (mineCounts[cls] || 0) + 1;
  }

  // Population share of picks by class, from the bracket's own pick rates.
  const popWeight = {};
  let popTotal = 0;
  for (const [brawler, row] of Object.entries(intelligence || {})) {
    const w = parseFloat(row?.pick_rate);
    if (!Number.isFinite(w) || w <= 0) continue;
    const cls = draftClassOf(brawler);
    popWeight[cls] = (popWeight[cls] || 0) + w;
    popTotal += w;
  }

  const classes = new Set([...Object.keys(mineCounts), ...Object.keys(popWeight)]);
  const out = [];
  for (const cls of classes) {
    const count = mineCounts[cls] || 0;
    const mineShare = n ? count / n : 0;
    const theirShare = popTotal ? (popWeight[cls] || 0) / popTotal : 0;
    // 2 SE of a multinomial share at this n — below it, the bars are shown but
    // never described in words.
    const se2 = n ? 2 * Math.sqrt(Math.max(mineShare * (1 - mineShare), 0.01) / n) : 1;
    out.push({
      cls, count,
      mine: mineShare, theirs: theirShare,
      diff: mineShare - theirShare,
      notable: n >= 20 && Math.abs(mineShare - theirShare) > se2,
    });
  }
  return out.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
}

// ── OP-2 the nemesis table ───────────────────────────────────────────────────
// Two columns, and the split is the whole design. Column A is the POPULATION's
// head-to-head rate, which exists today for every pairing from 1.8M matches.
// Column B is the player's own record, which for most people will never reach a
// usable sample against most brawlers (the deepest personal pairing in the whole
// database is ~6 series).
//
// Shipping A filled and B showing its own progress means the reader gets real,
// sourced information on day one — which matchups are structurally hard — and
// watches their own column fill in. The threshold is the product, not an excuse.

// Personal rate needs this many series against that specific brawler.
const NEMESIS_PERSONAL_MIN = 15;
// Population pairs below this are noise even at 1.8M matches. The config's
// pairMinPicks is 20, but a 20-game rate carries ~11 points of error, which is
// far too loose to call something a nemesis; 200 gives ~3.5 and still keeps
// 6,160 of 10,171 stored pairs (measured 2026-08-24).
const NEMESIS_POP_MIN_PICKS = 200;

// The table is anchored to the brawler the player actually plays, so there has
// to BE one. With a handful of drafts spread across a handful of brawlers the
// "most played" is whichever they picked once, and calling that a signature is
// simply false — the panel stays hidden until a real main exists.
const MIN_SIGNATURE_DRAFTS = 3;

/**
 * Worst population matchups for the player's signature brawler, with their own
 * record against each overlaid.
 * @returns {{brawler, rows:[{enemy, popRate, popPicks, mine:{n,wins}|null, qualified}]}|null}
 */
export function nemesisTable(series, intelligence) {
  if (!series.length) return null;

  // Signature brawler = most drafted. Anything else would mix matchup profiles
  // from different brawlers into one row and mean nothing.
  const byBrawler = {};
  for (const s of series) byBrawler[s.brawler] = (byBrawler[s.brawler] || 0) + 1;
  const [brawler, played] = Object.entries(byBrawler).sort((a, b) => b[1] - a[1])[0] || [];
  if (!brawler || played < MIN_SIGNATURE_DRAFTS) return null;

  const vs = intelligence?.[brawler.toUpperCase()]?.vs_brawler;
  if (!vs || typeof vs !== "object") return null;

  // The player's own record against each enemy, but ONLY from series where they
  // actually played this brawler — otherwise the two columns describe different
  // things and the comparison is meaningless.
  const mine = {};
  for (const s of series) {
    if (s.brawler !== brawler) continue;
    for (const e of s.enemyNames || []) {
      if (!e) continue;
      mine[e] = mine[e] || { n: 0, wins: 0 };
      mine[e].n += 1;
      if (s.won) mine[e].wins += 1;
    }
  }

  const rows = [];
  for (const [enemy, v] of Object.entries(vs)) {
    const picks = Number(v?.picks) || 0;
    const rate = parseFloat(v?.winRate);
    if (picks < NEMESIS_POP_MIN_PICKS || !Number.isFinite(rate)) continue;
    const m = mine[enemy.toUpperCase()] || mine[enemy] || null;
    rows.push({
      enemy, popRate: rate, popPicks: picks,
      mine: m, qualified: !!m && m.n >= NEMESIS_PERSONAL_MIN,
    });
  }
  // Sorted by the population edge, since that is the column that is actually
  // populated. Re-sorting by personal difference only makes sense once enough
  // rows qualify, which for most players is months away.
  rows.sort((a, b) => a.popRate - b.popRate);
  return { brawler, played, rows, personalMin: NEMESIS_PERSONAL_MIN };
}
