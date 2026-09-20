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

// The gap between the favoured and underdog buckets that counts as "your
// results follow your picks".
export const TRACKS_DRAFT_AT = 0.25;

// Does the favoured-minus-underdog gap support a verdict yet?
//
// The panel makes one of two OPPOSITE claims — a large gap means results track
// the draft, a small one means they don't — so a point estimate cannot choose
// between them: a measured gap of 0.24 is equally consistent with both. Only an
// interval that sits entirely on one side of the boundary settles it.
//
// This replaces a raw `favoured.n >= 12 && underdog.n >= 12` count gate that was
// wrong twice over. Drafts cluster near even (the engine's differential is
// narrow by design), so 12 in EACH tail needs roughly 60 graded series — one
// player in 1,126 had that on 2026-08-28, meaning the sentence had essentially
// never rendered. And when it did fire, the standard error of the difference at
// 12-and-12 is ~20 points against a 25-point threshold, barely 1.2 SE — so the
// counts that unlocked the claim did not support it.
//
// Same 2-SE standard aboveDraft uses for bandExcludesZero, so the two panels
// cannot disagree about what counts as evidence. SE uses the conservative
// p = 0.5 variance, matching sePoints.
// The two branches are asymmetric on purpose, because they are different kinds
// of claim and so have different nulls:
//
//   "tracks" asserts an effect EXISTS — the draft predicts your results. Its
//   null is a zero gap, so the interval has to clear zero. This is exactly
//   aboveDraft's bandExcludesZero test, applied to a difference of two rates.
//
//   "loose" asserts an effect is SMALL, and you can never establish that by
//   failing to find one. It needs the interval to sit entirely BELOW the
//   boundary, which is what `boundary` is for.
//
// Testing "tracks" against the boundary too would need a gap above 0.25 + 2SE —
// over 51 points at 30 drafts a side — so a plainly real 47-point gap would
// still say nothing. Testing "loose" against zero is not possible at all.
export function draftTracking(buckets, boundary = TRACKS_DRAFT_AT) {
  const a = buckets?.favoured, b = buckets?.underdog;
  if (!a?.n || !b?.n) return { verdict: null, delta: null, se: null };
  const delta = a.rate - b.rate;
  const se = Math.sqrt(0.25 / a.n + 0.25 / b.n);
  if (delta - 2 * se > 0) return { verdict: "tracks", delta, se };
  if (delta + 2 * se < boundary) return { verdict: "loose", delta, se };
  return { verdict: null, delta, se };   // honest silence — cannot tell yet
}

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

// ── OP-3 opponent, teammate and context breakdowns ───────────────────────────
// Everything below answers "where are you better or worse than YOUR OWN
// normal", so every rate is shrunk toward the player's own overall series win
// rate — not toward 50% and not toward the population. The question is not
// "are you good", it is "is this matchup different for you", and the player's
// baseline is what makes that difference meaningful.
//
// SAMPLE REALITY, measured 2026-09-19 over 1,224 tracked players. The median
// player has 151 rows (~68 series) and the heaviest has 561 (~250 series):
//
//   breakdown          heaviest        median
//   enemy brawler      27 at >=20      1 at >=20
//   teammate brawler   28 at >=20      2 at >=20
//   own brawler x mode  6 at >=15      0 at >=15
//   own brawler x MAP   best cell 9    best cell 1-2
//
// Two consequences are baked in below. Per-CLASS works for everyone (seven
// buckets over three enemies a game), which is why the class panels carry the
// page. Per-BRAWLER is real only for heavy players, so those panels sort by
// shrunk delta, always print n, and hide entirely below a floor. Own-brawler
// x MAP is NOT built at any floor: the best cell in the entire database is 9
// series, so the honest answer to "am I worse with him on this map" is that
// nobody has played enough for anyone to know. Brawler x MODE is offered
// instead — six buckets rather than twenty — and still gated.

// Floors, in SERIES. Below these a bucket is counted but never rated.
export const VS_BRAWLER_MIN = 8;
export const WITH_BRAWLER_MIN = 8;
export const CLASS_MIN = 15;
export const MODE_MIN = 10;
export const MAP_MIN = 10;
export const OWN_BRAWLER_MIN = 8;
// A panel needs this many qualifying rows before it is worth rendering at all.
export const PANEL_MIN_ROWS = 3;

/** Overall series win rate — the baseline every breakdown shrinks toward. */
export function baselineRate(series) {
  if (!series.length) return 0.5;
  return series.filter(s => s.won).length / series.length;
}

/**
 * Generic "bucket the series, shrink each bucket" pass.
 * @param series  drafts
 * @param keysOf  (s) => string[]  buckets this series contributes to
 * @param min     floor in series before a bucket is rated
 */
function bucketed(series, keysOf, min) {
  const base = baselineRate(series);
  const acc = {};
  for (const s of series) {
    for (const key of keysOf(s) || []) {
      if (!key) continue;
      const a = acc[key] || (acc[key] = { key, n: 0, wins: 0 });
      a.n += 1;
      if (s.won) a.wins += 1;
    }
  }
  return Object.values(acc).map(a => {
    const sh = shrink(a.wins, a.n, base);
    return {
      ...a,
      raw: a.n ? a.wins / a.n : 0,
      rate: sh.rate,
      delta: sh.delta,            // vs the player's own normal
      se: sePoints(a.n),
      qualified: a.n >= min,
    };
  }).sort((x, y) => y.delta - x.delta);
}

/** Win rate against each specific ENEMY brawler. "Who do you beat?" */
export function vsBrawlers(series) {
  return bucketed(series, s => s.enemyNames, VS_BRAWLER_MIN);
}

/**
 * Win rate when a TEAMMATE picked each brawler. "Your best synergy pick."
 * Note this is a teammate's brawler, not a teammate player — squadAndRivals
 * already covers the people.
 */
export function withBrawlers(series) {
  return bucketed(series, s => s.teamNames, WITH_BRAWLER_MIN);
}

/** Win rate by the class of the brawler YOU played. */
export function ownClassRates(series) {
  return bucketed(series, s => [draftClassOf(s.brawler)], CLASS_MIN);
}

/**
 * Win rate against each enemy CLASS — "how do you do into throwers".
 * A game with two throwers counts once for THROWER, not twice: the unit is a
 * series outcome, and counting it twice would make the same win support two
 * observations and shrink the error bar on a sample that never grew.
 */
export function vsClassRates(series) {
  return bucketed(series, s => [...new Set((s.enemyNames || []).map(draftClassOf))], CLASS_MIN);
}

/** Win rate per game mode. Six buckets, so this survives a median sample. */
export function modeRates(series) {
  return bucketed(series, s => [s.mode], MODE_MIN);
}

/** Win rate per map. Thin for most players — always shown with n. */
export function mapRates(series) {
  return bucketed(series, s => [s.map], MAP_MIN);
}

/** Win rate on each brawler the player actually drafts. */
export function ownBrawlerRates(series) {
  return bucketed(series, s => [s.brawler], OWN_BRAWLER_MIN);
}

/**
 * Own brawler x MODE, for "you are fine with him generally but not here".
 * Deliberately mode and not map — see the sample table above; the best
 * brawler x map cell in the whole database is 9 series.
 *
 * Only returns a row where BOTH the overall brawler rate and the mode cell
 * clear their floors, and where the cell differs from that brawler's own
 * overall rate by more than the cell's own standard error. Without that last
 * test every player has a "weak spot" that is pure noise.
 */
export function brawlerModeOutliers(series, minCell = 12) {
  const overall = {};
  for (const r of ownBrawlerRates(series)) overall[r.key] = r;

  const acc = {};
  for (const s of series) {
    if (!s.brawler || !s.mode) continue;
    const k = `${s.brawler}|${s.mode}`;
    const a = acc[k] || (acc[k] = { brawler: s.brawler, mode: s.mode, n: 0, wins: 0 });
    a.n += 1;
    if (s.won) a.wins += 1;
  }

  const out = [];
  for (const a of Object.values(acc)) {
    const base = overall[a.brawler];
    if (!base || !base.qualified || a.n < minCell) continue;
    const sh = shrink(a.wins, a.n, base.rate);
    const gapPts = (sh.rate - base.rate) * 100;
    if (Math.abs(gapPts) <= sePoints(a.n)) continue;   // inside the noise floor
    out.push({
      ...a, brawlerRate: base.rate, brawlerN: base.n,
      rate: sh.rate, gapPts, se: sePoints(a.n),
    });
  }
  return out.sort((x, y) => Math.abs(y.gapPts) - Math.abs(x.gapPts));
}

/** Pick SHARE and win rate per own class together — feeds the donut. */
export function classSplit(series) {
  const rates = ownClassRates(series);
  const total = rates.reduce((sum, r) => sum + r.n, 0) || 1;
  return rates
    .map(r => ({ ...r, label: classLabel(r.key) || r.key, share: r.n / total }))
    .sort((a, b) => b.n - a.n);
}

// ── OP-5 who you face, and what answers them ─────────────────────────────────

// Field pairs below this are noise even at 1.5M matches — same floor the
// nemesis table uses, and for the same reason: a 20-game pair carries ~11
// points of error, which cannot support the word "counter".
const COUNTER_MIN_PICKS = 200;
// A counter has to actually beat the target by a margin that clears its own
// error, not merely be above 50.
const COUNTER_MIN_RATE = 53;

/**
 * Which brawlers the FIELD beats `enemy` with.
 *
 * Read off `vs_brawler`, which stores each brawler's win rate against every
 * other, so "what counters X" is a scan for high rates against X rather than a
 * separate table. Note this is the FIELD's answer, not the player's: a counter
 * only works if you can actually play it, and nothing here knows that.
 *
 * Deliberately NOT filtered to brawlers the player owns or drafts — ownership
 * is invisible to us, and silently hiding the real answer because we guessed
 * they lack it would be worse than naming it.
 */
export function bestCountersTo(enemy, intelligence, limit = 2) {
  const target = (enemy || "").toUpperCase();
  if (!target || !intelligence) return [];
  const out = [];
  for (const [brawler, row] of Object.entries(intelligence)) {
    if (brawler === target) continue;
    const cell = row?.vs_brawler?.[target] || row?.vs_brawler?.[enemy];
    if (!cell) continue;
    const picks = Number(cell.picks) || 0;
    const rate = parseFloat(cell.winRate);
    if (picks < COUNTER_MIN_PICKS || !Number.isFinite(rate) || rate < COUNTER_MIN_RATE) continue;
    out.push({ brawler, rate, picks });
  }
  return out.sort((a, b) => b.rate - a.rate).slice(0, limit);
}

/**
 * The enemy brawlers you meet most, with your record and the field's answer.
 * Sorted by ENCOUNTERS, not by how badly they beat you — the point is "this is
 * what your ladder actually looks like", and the most common opponent is worth
 * preparing for even at a neutral record.
 */
export function mostEncountered(series, intelligence, limit = 6) {
  const base = baselineRate(series);
  const acc = {};
  for (const s of series) {
    for (const e of s.enemyNames || []) {
      if (!e) continue;
      const a = acc[e] || (acc[e] = { key: e, n: 0, wins: 0 });
      a.n += 1;
      if (s.won) a.wins += 1;
    }
  }
  return Object.values(acc)
    .sort((a, b) => b.n - a.n)
    .slice(0, limit)
    .map((a) => {
      const sh = shrink(a.wins, a.n, base);
      return {
        ...a,
        raw: a.wins / a.n,
        rate: sh.rate,
        delta: sh.delta,
        qualified: a.n >= VS_BRAWLER_MIN,
        counters: bestCountersTo(a.key, intelligence),
      };
    });
}

/**
 * Where a negative Above-Draft gap is CONCENTRATED.
 *
 * Above Draft says the picks were fine and the games were lost anyway; it
 * cannot say why, because nothing in a battlelog records execution. What the
 * data CAN do is say where those losses cluster, which is a real lead rather
 * than a guess. Returns the worst mode and worst enemy class that clear their
 * own floors, or nulls.
 */
export function lossConcentration(series) {
  const modes = modeRates(series).filter((r) => r.qualified);
  const classes = vsClassRates(series).filter((r) => r.qualified);
  const worstMode = modes.length ? modes[modes.length - 1] : null;
  const worstClass = classes.length ? classes[classes.length - 1] : null;
  return {
    worstMode: worstMode && worstMode.delta < 0 ? worstMode : null,
    worstClass: worstClass && worstClass.delta < 0 ? worstClass : null,
  };
}

/**
 * For the player's weakest mode, what they actually bring to it versus what
 * they bring to the modes they win.
 *
 * Deliberately built from the player's OWN data rather than a "best brawlers
 * in heist" list. A generic recommendation is available on the tier list and
 * says nothing about them; "you take Control into your worst mode twice as
 * often as into your best ones" is specific, checkable, and actionable without
 * assuming anything about which brawlers they own.
 */
export function modeImprovement(series, minModeDrafts = 10) {
  const modes = modeRates(series).filter((r) => r.qualified);
  if (modes.length < 2) return null;
  const worst = modes[modes.length - 1];
  if (worst.delta >= 0 || worst.n < minModeDrafts) return null;

  const good = new Set(modes.filter((m) => m.delta > 0).map((m) => m.key));
  if (!good.size) return null;

  const mix = (pred) => {
    const c = {};
    let total = 0;
    for (const s of series) {
      if (!pred(s)) continue;
      const cls = draftClassOf(s.brawler);
      c[cls] = (c[cls] || 0) + 1;
      total += 1;
    }
    return { c, total };
  };
  const bad = mix((s) => s.mode === worst.key);
  const ok = mix((s) => good.has(s.mode));
  if (!bad.total || !ok.total) return null;

  let over = null;
  for (const cls of new Set([...Object.keys(bad.c), ...Object.keys(ok.c)])) {
    const gap = (bad.c[cls] || 0) / bad.total - (ok.c[cls] || 0) / ok.total;
    if (!over || gap > over.gap) over = { cls, gap, inBad: (bad.c[cls] || 0), badTotal: bad.total };
  }
  // Under a 15-point share gap this is just drafting noise, not a habit.
  if (!over || over.gap < 0.15) return { mode: worst, over: null };
  return { mode: worst, over };
}

// ── OP-6 sessions, party, tilt ───────────────────────────────────────────────
// The coaching half. Everything above answers "what do you play and against
// whom"; this answers "under what conditions do you play it well", which is
// the part a player can act on tonight.
//
// ALL OF IT RUNS ON SERIES, NEVER ROWS. player_matches stores one row per
// ROUND and the same teammates play every round of a series by definition, so
// a naive party detector run on rows reports that 98.7% of teammates recur —
// measured 2026-09-19, and that is an artefact of the storage shape, not a
// fact about the player. Rounds also make a 2-0 look like two wins in a row,
// which would invent tilt that never happened.

// Gap that ends a session: long enough to survive a queue plus a lobby, short
// enough that two evenings do not merge into one.
const SESSION_GAP_MS = 45 * 60 * 1000;

// Every bucket below needs this many SERIES before it is rated. Lower than the
// 15 the class panels use because these splits have few buckets each, so a
// given bucket fills much faster than one of ~106 brawlers.
const SESSION_BUCKET_MIN = 12;

/** Split series into sessions, oldest-first within each. */
export function toSessions(series, gapMs = SESSION_GAP_MS) {
  const asc = [...series].sort(
    (a, b) => new Date(a.started_at) - new Date(b.started_at));
  const out = [];
  for (const s of asc) {
    const last = out[out.length - 1];
    const t = new Date(s.started_at).getTime();
    if (last && t - last.endedAt <= gapMs) {
      last.series.push(s);
      last.endedAt = t;
    } else {
      out.push({ series: [s], startedAt: t, endedAt: t });
    }
  }
  return out;
}

// Below this a bucket is dropped entirely rather than shown greyed. The other
// panels show a thin row because the row NAMES something real (a map you have
// played 4 times). Here the buckets are fixed and exhaustive, so a 1-0 bucket
// adds no information and renders as a shouting 100% next to rows that mean
// something.
const BUCKET_SHOW_MIN = 3;

/** Shared tail: shrink a bucket toward the player's own rate and mark it. */
function rated(b, base) {
  const sh = shrink(b.wins, b.n, base);
  return { ...b, raw: b.n ? b.wins / b.n : 0, rate: sh.rate, delta: sh.delta,
           qualified: b.n >= SESSION_BUCKET_MIN };
}

/**
 * Solo / duo / trio, INFERRED — the API never says who queued together.
 *
 * A teammate counts as premade for a session when their tag appears in at
 * least two DIFFERENT series of that session. Two strangers matched together
 * twice in one evening happens; the same person across three drafts is a
 * party. Series, not rounds, for the reason at the top of this block.
 *
 * It is a heuristic and the panel says so: it will call a long random
 * coincidence a duo, and a party that played one game solo.
 */
export function partyBreakdown(series, selfTag) {
  const base = baselineRate(series);
  const buckets = [
    { key: "Solo queue", mates: 0, n: 0, wins: 0 },
    { key: "With one regular", mates: 1, n: 0, wins: 0 },
    { key: "Full trio", mates: 2, n: 0, wins: 0 },
  ];

  for (const session of toSessions(series)) {
    const seen = {};
    for (const s of session.series) {
      for (const t of s.team_tags || []) {
        if (!t || t === selfTag) continue;
        (seen[t] = seen[t] || new Set()).add(s.key);
      }
    }
    const premade = new Set(
      Object.entries(seen).filter(([, set]) => set.size >= 2).map(([t]) => t));

    for (const s of session.series) {
      const n = (s.team_tags || [])
        .filter((t) => t && t !== selfTag && premade.has(t)).length;
      const b = buckets[Math.min(n, 2)];
      b.n += 1;
      if (s.won) b.wins += 1;
    }
  }
  return buckets.filter((b) => b.n >= BUCKET_SHOW_MIN).map((b) => rated(b, base));
}

/**
 * Win rate by how many games you have already lost in a row THIS SESSION.
 *
 * The tilt question, and the one thing on this page a player can act on
 * within the hour. Streaks reset between sessions — a loss last Tuesday does
 * not tilt you tonight.
 */
export function tiltCurve(series) {
  const base = baselineRate(series);
  const buckets = [
    { key: "Fresh or after a win", lo: 0, hi: 0, n: 0, wins: 0 },
    { key: "After 1 loss", lo: 1, hi: 1, n: 0, wins: 0 },
    { key: "After 2 losses", lo: 2, hi: 2, n: 0, wins: 0 },
    { key: "After 3+ losses", lo: 3, hi: 1e9, n: 0, wins: 0 },
  ];
  for (const session of toSessions(series)) {
    let streak = 0;
    for (const s of session.series) {
      const b = buckets.find((x) => streak >= x.lo && streak <= x.hi);
      if (b) { b.n += 1; if (s.won) b.wins += 1; }
      streak = s.won ? 0 : streak + 1;
    }
  }
  return buckets.filter((b) => b.n >= BUCKET_SHOW_MIN).map((b) => rated(b, base));
}

/** Win rate by how deep into a session you are — the fatigue question. */
export function sessionDepth(series) {
  const base = baselineRate(series);
  const buckets = [
    { key: "Games 1-3", lo: 0, hi: 2, n: 0, wins: 0 },
    { key: "Games 4-6", lo: 3, hi: 5, n: 0, wins: 0 },
    { key: "Games 7-10", lo: 6, hi: 9, n: 0, wins: 0 },
    { key: "Game 11+", lo: 10, hi: 1e9, n: 0, wins: 0 },
  ];
  for (const session of toSessions(series)) {
    session.series.forEach((s, i) => {
      const b = buckets.find((x) => i >= x.lo && i <= x.hi);
      if (b) { b.n += 1; if (s.won) b.wins += 1; }
    });
  }
  return buckets.filter((b) => b.n >= BUCKET_SHOW_MIN).map((b) => rated(b, base));
}

/**
 * Win rate by time of day, in the VIEWER'S local clock.
 *
 * battle_time is UTC and we do not know the player's timezone, so on someone
 * else's profile these blocks are the reader's evening, not theirs. The panel
 * only renders on a profile the viewer is looking at for themselves.
 */
export function timeOfDay(series) {
  const base = baselineRate(series);
  const blocks = [
    { key: "Morning (6-12)", lo: 6, hi: 11 },
    { key: "Afternoon (12-18)", lo: 12, hi: 17 },
    { key: "Evening (18-24)", lo: 18, hi: 23 },
    { key: "Late night (0-6)", lo: 0, hi: 5 },
  ].map((b) => ({ ...b, n: 0, wins: 0 }));
  for (const s of series) {
    const h = new Date(s.started_at).getHours();
    const b = blocks.find((x) => h >= x.lo && h <= x.hi);
    if (b) { b.n += 1; if (s.won) b.wins += 1; }
  }
  return blocks.filter((b) => b.n >= BUCKET_SHOW_MIN).map((b) => rated(b, base));
}

/**
 * Your mains versus the rest of your pool.
 *
 * Framed as the player's OWN comparison, not "specialists beat generalists" —
 * that is a claim about a population, it would need many players to test, and
 * we have not tested it.
 */
export function poolBreadth(series, mainCount = 3) {
  const byBrawler = {};
  for (const s of series) {
    const b = byBrawler[s.brawler] || (byBrawler[s.brawler] = { n: 0, wins: 0 });
    b.n += 1;
    if (s.won) b.wins += 1;
  }
  const ranked = Object.entries(byBrawler).sort((a, b) => b[1].n - a[1].n);
  const mains = new Set(ranked.slice(0, mainCount).map(([k]) => k));
  const base = baselineRate(series);

  const agg = (key, pred) => {
    let n = 0, wins = 0;
    for (const s of series) if (pred(s)) { n += 1; if (s.won) wins += 1; }
    return rated({ key, n, wins }, base);
  };
  return {
    distinct: ranked.length,
    mains: [...mains],
    onMains: agg("Your top " + mains.size, (s) => mains.has(s.brawler)),
    offMains: agg("Everyone else", (s) => !mains.has(s.brawler)),
  };
}

/**
 * Star player rate, overall and per brawler.
 *
 * COVERAGE IS THE CATCH: is_star_player is null on most stored rows (233
 * known of 561 on the heaviest profile, 42%) because the field is only
 * present on some battlelog shapes. Rates are over KNOWN rows only and the
 * denominator is always shown; a per-brawler split is mostly out of reach, so
 * the panel states the coverage rather than quietly dividing by a number it
 * does not have.
 */
export function starRates(series, minKnown = 10) {
  let known = 0, stars = 0;
  const per = {};
  for (const s of series) {
    for (const r of s.rounds || []) {
      if (r.is_star_player === null || r.is_star_player === undefined) continue;
      known += 1;
      if (r.is_star_player) stars += 1;
      const p = per[s.brawler] || (per[s.brawler] = { key: s.brawler, known: 0, stars: 0 });
      p.known += 1;
      if (r.is_star_player) p.stars += 1;
    }
  }
  return {
    known, stars,
    rate: known ? stars / known : null,
    perBrawler: Object.values(per)
      .filter((p) => p.known >= minKnown)
      .map((p) => ({ ...p, rate: p.stars / p.known }))
      .sort((a, b) => b.rate - a.rate),
  };
}

// ── OP-7 standing: percentile, streaks, recent form, activity ────────────────
// The "am I actually good" half. Everything else on this page is internal to
// the player ("is this different for ME"); this is the only part that answers
// the question against other people.

/**
 * Where this player sits against every other tracked player.
 *
 * Brawlify charges $4.99/mo for the equivalent; it is free here because
 * players never pay on this site and the data is already ours.
 *
 * The RPC returns ROUND-based rates for everyone, so the ordering is valid
 * even though the profile headline counts series. Show the RANK, never the
 * RPC's win rate, or the page contradicts itself two cards apart.
 */
export function loadPercentiles(tag) {
  if (!tag) return Promise.resolve(null);
  return supabase
    .rpc("player_percentiles", { target_tag: tag })
    .then(({ data, error }) => (error ? null : (data && data[0]) || null))
    .catch(() => null);
}

/**
 * Win / loss streaks over the player's whole history, newest first.
 *
 * Counted in SERIES across the full history rather than inside a session,
 * unlike tiltCurve — a best-ever streak that reset every time you went to bed
 * would not be a record of anything.
 */
export function streaks(series) {
  const asc = [...series].sort(
    (a, b) => new Date(a.started_at) - new Date(b.started_at));
  let bestWin = 0, worstLoss = 0, run = 0, breaks = 0;
  let prev = null;
  for (const s of asc) {
    if (prev === null || s.won === prev) run += 1;
    else { breaks += 1; run = 1; }
    if (s.won) bestWin = Math.max(bestWin, run);
    else worstLoss = Math.max(worstLoss, run);
    prev = s.won;
  }
  // `run`/`prev` now describe the most recent streak, which is the live one.
  return {
    bestWin, worstLoss, breaks,
    current: asc.length ? { won: prev, length: run } : null,
  };
}

/** Win rate over the most recent N drafts, against the all-time rate. */
export function recentForm(series, n = 20) {
  const desc = [...series].sort(
    (a, b) => new Date(b.started_at) - new Date(a.started_at));
  const slice = desc.slice(0, n);
  if (slice.length < Math.min(n, 10)) return null;
  const wins = slice.filter(s => s.won).length;
  const all = baselineRate(series);
  return {
    n: slice.length,
    wins,
    rate: wins / slice.length,
    allTime: all,
    deltaPts: (wins / slice.length - all) * 100,
  };
}

/**
 * Per-day draft counts for the last `days` days, oldest first, with empty
 * days included — a calendar with the gaps removed is not a calendar.
 */
export function activityCalendar(series, days = 28) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const byDay = new Map();
  for (const s of series) {
    const d = new Date(s.started_at);
    d.setHours(0, 0, 0, 0);
    const k = d.getTime();
    const cur = byDay.get(k) || { n: 0, wins: 0 };
    cur.n += 1;
    if (s.won) cur.wins += 1;
    byDay.set(k, cur);
  }
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const cell = byDay.get(d.getTime()) || { n: 0, wins: 0 };
    out.push({ date: d, ...cell });
  }
  const played = out.filter(c => c.n > 0).length;
  const busiest = out.reduce((m, c) => (c.n > (m?.n || 0) ? c : m), null);
  return { cells: out, days, played, busiest };
}

// ── OP-8 ranked quality score ────────────────────────────────────────────────
// A single 0-100 for how well someone plays RANKED.
//
// It exists because Brawlify's Account Quality score is the most visible
// number on their profile and it does not measure skill at all: Trophy
// Efficiency, Mastery, Collection, Gears, Power Levels and total victories.
// Every one of those is money and time. A whale who has maxed 44 brawlers and
// never won a competitive game scores high, and a strong player on a young
// account scores low. Copying it would import exactly the confusion the rest
// of this profile is built to avoid.
//
// So nothing here reads trophies, collection, gears or power levels. Four
// components, all of them things you did in a ranked match:
//
//   PERCENTILE   45%  where you rank on win rate against every tracked player
//   ABOVE DRAFT  28%  do you beat what your drafts were worth — skill NET of
//                     draft luck, which is the one thing no competitor has
//   COMPOSURE    15%  how much you drop once you are two losses down
//   BREADTH      12%  how many modes and brawlers you are actually winning on
//
// VOLUME IS DELIBERATELY NOT A COMPONENT. Their score rewards grinding
// directly, which is why it reads high for an account that is merely old.
// Here it sets CONFIDENCE instead: a thin sample gets the same score with a
// wider band and a "provisional" label, never a smaller number. Rewarding
// volume would make the score partly a measure of free time.
//
// A component with no data is DROPPED and the rest renormalise, rather than
// scoring zero — absent is not bad.

const QUALITY_WEIGHTS = { percentile: 45, aboveDraft: 28, composure: 15, breadth: 12 };

// Bands are named for what they say about ranked play, not for prestige.
const QUALITY_BANDS = [
  { at: 80, label: "Elite",        tone: "#ffce7a" },
  { at: 65, label: "Strong",       tone: "#8ee6b0" },
  { at: 45, label: "Solid",        tone: "#7cc4ff" },
  { at: 25, label: "Developing",   tone: "#c9a6ff" },
  { at: 0,  label: "Early days",   tone: "#8b8b9c" },
];

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/**
 * @param series   drafts
 * @param pc       player_percentiles row, or null
 * @param ad       aboveDraft() result, or null
 */
export function rankedQuality(series, pc, ad) {
  const parts = [];

  // 1. Percentile — already a 0-100 rank, used directly.
  if (pc && pc.win_rate_pct_rank != null) {
    parts.push({
      key: "percentile", label: "Standing", weight: QUALITY_WEIGHTS.percentile,
      value: Number(pc.win_rate_pct_rank),
      detail: `${Math.round(Number(pc.win_rate_pct_rank))}th percentile of ${pc.cohort} tracked players`,
    });
  }

  // 2. Above Draft, as a z-score so the sample size is priced in. Someone
  //    +3 wins over 20 drafts has shown less than +3 over 200, and the
  //    standard error is exactly that difference.
  if (ad && ad.n >= 10 && ad.se > 0) {
    const z = Math.max(-3, Math.min(3, ad.delta / ad.se));
    parts.push({
      key: "aboveDraft", label: "Above draft", weight: QUALITY_WEIGHTS.aboveDraft,
      value: clamp01((z + 3) / 6) * 100,
      detail: `${ad.delta >= 0 ? "+" : ""}${ad.delta.toFixed(1)} wins vs what your drafts were worth`,
    });
  }

  // 3. Composure — the drop from fresh to two-or-more losses down. 0 drop or
  //    better scores full marks; a 20-point collapse scores zero. Only when
  //    both buckets are rated, or this measures nothing.
  const tilt = tiltCurve(series);
  const fresh = tilt.find((b) => b.lo === 0 && b.qualified);
  const down = [...tilt].reverse().find((b) => b.lo >= 2 && b.qualified);
  if (fresh && down) {
    const dropPts = (fresh.rate - down.rate) * 100;
    parts.push({
      key: "composure", label: "Composure", weight: QUALITY_WEIGHTS.composure,
      value: clamp01(1 - dropPts / 20) * 100,
      detail: dropPts > 0
        ? `drops ${dropPts.toFixed(0)}pts once two losses down`
        : `holds up when behind`,
    });
  }

  // 4. Breadth — modes and brawlers you are actually WINNING on, measured
  //    against 50% rather than against your own average. Self-relative would
  //    be circular: roughly half of anything is above its own mean.
  const modes = modeRates(series).filter((r) => r.qualified);
  const brawlers = ownBrawlerRates(series).filter((r) => r.qualified);
  if (modes.length >= 2 || brawlers.length >= 2) {
    const modeWin = modes.filter((r) => r.raw >= 0.5).length;
    const brawlerWin = brawlers.filter((r) => r.raw >= 0.5).length;
    // Six winning modes is every mode; six winning brawlers is a real pool.
    const v = (clamp01(modeWin / 6) * 0.5) + (clamp01(brawlerWin / 6) * 0.5);
    parts.push({
      key: "breadth", label: "Breadth", weight: QUALITY_WEIGHTS.breadth,
      value: v * 100,
      detail: `winning on ${modeWin} mode${modeWin === 1 ? "" : "s"} and ${brawlerWin} brawler${brawlerWin === 1 ? "" : "s"}`,
    });
  }

  if (!parts.length) return null;

  // Renormalise over the components we actually have.
  const wsum = parts.reduce((a, p) => a + p.weight, 0);
  const score = Math.round(parts.reduce((a, p) => a + p.value * p.weight, 0) / wsum);
  const band = QUALITY_BANDS.find((b) => score >= b.at);

  // CONFIDENCE, not a score input. Drafts, because that is the unit the whole
  // page counts in.
  const n = series.length;
  const confidence = n >= 150 ? { key: "solid", label: "", band: 0 }
                   : n >= 60  ? { key: "fair", label: "Provisional", band: 5 }
                   :            { key: "thin", label: "Provisional", band: 10 };

  return {
    score, band, parts, n, confidence,
    missing: Object.keys(QUALITY_WEIGHTS).filter(k => !parts.some(p => p.key === k)),
  };
}
