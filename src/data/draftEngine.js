// ─── BrawlApex Intelligence Engine ───────────────────────────────────────────
// The 5-pass draft advisor. Combines three intelligence layers:
//   • live per-map match data          (mapStats / matchupStats — from useMapMatches)
//   • daily statistical intelligence   (brawler_intelligence table — true win
//     rates, popularity-trap / broken / inflation flags, per-class matchup WRs)
//   • Bobby's draft framework          (draft_logic_config.json — counter
//     triangle, active/passive tempo, thrower rules, 1-mid + 2-lane structure)
//   • pro map intel                    (draft_logic_config.json mapRules /
//     brawlerBias / brawlerCounters — SpenLC's per-map requirements and tier
//     corrections)
//
// The two hand-authored layers are PRIORS, not verdicts: every multiplier they
// contribute runs through dampPrior and shrinks toward 1.0 once the brawler has
// real data on the map, because a measured win rate already encodes whatever the
// prior was describing. Thin data → theory leads. Thick data → statistics lead.
//
// PASS 1  Statistical      — Bayesian-shrunk "true win rate" + coefficient flags
// PASS 2  Counter-intel    — class matrix + empirical vs-class WRs vs revealed enemies
// PASS 3  Preventative     — block the enemy's best remaining answer to OUR comp
// PASS 4  Strategic filter — mode tempo weights, thrower penalty, class diversity
// PASS 5  Composition      — final_sanity_check: mid + lane anchor + objective specialist
//
// getDraftAdvice() returns the top-3 ranked picks — each with a confidence-honest
// headline win rate (falls back to overall when the map sample is thin), a one-line
// matchupNote ("how good into their comp"), and short reason chips.
// computeWinSplit() produces the draft-complete BLUE/RED win % (always sums 100).

import CONFIG from "./draft_logic_config.json";
import BRAWLER_META from "./brawlerMeta.json";
import { blindPickLabel, getDraftProfile } from "./draftMeta";

const norm = (k) => (k || "").toUpperCase().trim();

// ── Class resolution (mirrors scrapers/meta_weights.py exactly) ──────────────
export function draftClassOf(key) {
  const k = norm(key);
  const override = CONFIG.brawlerClassOverrides[k];
  if (override && !k.startsWith("_")) return override;
  const apiClass = BRAWLER_META[k]?.class || "Unknown";
  return CONFIG.apiClassToDraftClass[apiClass] || "CONTROL";
}

export const classLabel = (cls) => CONFIG.classLabels[cls] || cls;

// ── Ability tag (Good Hyper / Knockback-Stun / Wall Break / Pierce Damage /
// Special) — a static per-brawler trait, distinct from data-driven flags like
// Meta Breaker. Undefined for brawlers not yet in the role map (e.g. Damian).
// A brawler may carry more than one tag (Ruffs is Good Hyper AND a wall breaker
// via his star power), so brawlerAbilities values are either a string or an
// array. abilitiesOf is what the RULES read; abilityOf returns just the first
// tag, which is what the UI badge shows.
export const abilitiesOf = (key) => {
  const v = CONFIG.brawlerAbilities?.[norm(key)];
  return v == null ? [] : Array.isArray(v) ? v : [v];
};
export const abilityOf = (key) => abilitiesOf(key)[0] || null;
export const abilityLabel = (code) => CONFIG.abilityLabels?.[code] || code;

// ── Shared helpers ───────────────────────────────────────────────────────────
const PRIOR = CONFIG.statisticalCoefficients.confidencePriorGames;

// Bayesian shrink toward 50%: tiny samples can't fake a monster win rate.
const trueWR = (wins, picks, prior = PRIOR) =>
  picks + prior === 0 ? 50 : ((wins + prior * 0.5) / (picks + prior)) * 100;

// ── Shared statistical core ──────────────────────────────────────────────────
// getDraftAdvice RANKS candidates and computeWinSplit GRADES the finished
// draft. They must agree about who is favoured, so both read a brawler's
// strength through these two helpers rather than each rolling their own blend.
// They used to differ (0.65/0.35 with a 30-game floor vs 0.6/0.4 with a
// 20-game floor, and only the ranker applied recency), which is a standing
// invitation for the engine to recommend a pick and then grade that same pick
// as the one that lost the draft.

// Overall patch rate with the recent window blended in when it has a real
// sample — the mid-patch shadow-nerf defense.
const recencyTWR = (intel) => {
  if (!intel) return null;
  let g = parseFloat(intel.true_win_rate);
  if (!Number.isFinite(g)) return null;
  const rec = CONFIG.statisticalCoefficients?.recency;
  const recentPicks = Number(intel.recent_picks) || 0;
  if (rec && recentPicks >= (rec.minRecentPicks ?? 300)) {
    const w = rec.recentWeight ?? 0.6;
    // recent_picks / recent_wins count ROUNDS (times_seen), like every other
    // aggregate since 2026-08-28, so this shrink is already round-weighted and
    // a 2-1 no longer reads as a flat 50/50 here either. Nothing to special-case.
    g = trueWR(Number(intel.recent_wins) || 0, recentPicks) * w + g * (1 - w);
  }
  return g;
};

// Map rate weighted against the overall rate by how much map evidence exists.
// The map rate is blended toward a FALLBACK rate in proportion to how much map
// evidence exists. The fallback is the brawler's rate in this MODE where we have
// one, and their global rate otherwise.
//
// Mode beats global because a brawler's record in gem grab is a better prior for
// a gem grab map than a record pooled across heist and bounty as well. Bolt is
// the clean example: 59.6% on Gem Fort against a 55.1% global rate, so shrinking
// toward global drags a well-measured map reading down toward modes he is not
// played in. Measured at +0.0009 +/- 0.0008 AUC on 23,772 held-out decisions —
// small and only just clear of its error bar, but the right sign and a fair
// comparison, since both variants keep the same base and differ only in target.
//
// Do NOT read the wider sweep around this as a licence to weaken the blend. On
// that harness "shrink toward 50%" scores better still, and removing the
// win-rate base entirely scores best of all (+0.0023) — which is nonsense as
// advice. The harness scores ONE pick against ITS OWN team's result, so terms
// that differentiate the two teams (head-to-head, duo) are priced correctly
// while a brawler's standalone strength largely cancels out of the outcome and
// looks like noise. It can compare variants of the base; it cannot price the
// base against nothing.
const blendMapGlobal = (mapPicks, mapTWR, fallbackTWR) => {
  if (mapTWR == null) return fallbackTWR ?? 50;
  if (fallbackTWR == null) return mapTWR;
  const prior = CONFIG.mapPriority?.blendPriorGames ?? 400;
  const w = mapPicks / (mapPicks + prior);
  return mapTWR * w + fallbackTWR * (1 - w);
};

// The brawler's rate across every map of THIS mode, shrunk like any other rate.
// Falls back to the global rate when the mode sample is too thin to add value.
const modeOrGlobalTWR = (modeStats, key, globalTWR, minPicks) => {
  const msd = modeStats?.[norm(key)];
  const picks = Number(msd?.picks) || 0;
  if (picks < (minPicks ?? 300)) return globalTWR;
  return trueWR(msd.wins, picks);
};

// Compact game counts for note copy ("7.3K games"). DraftAssistant has its own
// copy for card chrome; this one exists so the engine's own strings don't print
// a bare 66592.
const fmtGames = (n) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "")}K` : `${n}`;

// ── Pair-level evidence: the same idea as blendMapGlobal, one level down ─────
// How a brawler actually fares AGAINST a specific enemy, in win-rate points
// either side of even, shrunk by how much evidence backs it.
//
// The prior is measured, not chosen: across the current patch the standard
// deviation of a pair's TRUE edge vs 50% is ~4.3 points, stable from the 50-game
// bucket up past 1000. prior = 2500/sd^2 (2500 being the squared standard error
// of a win rate, 50/sqrt(n)), which gives ~135. A 30-game pair therefore
// contributes 18% of its raw edge, a 300-game pair 69%, a 3,000-game pair 96%.
// That is the priors-vs-evidence rule pointed the other way: thin samples must
// not shout, and no step gate is needed to stop them.
//
// `mapPairs` is the PER-MAP layer, and it is live as of 2026-08-30: a pair's
// record on THIS map, shrunk toward its patch-wide rate by its own sample. Same
// trunk-and-correction shape as blendMapGlobal, one level down.
//
// This is the largest single gain the calibration pass has produced: +0.0043
// +/-0.0029 AUC on 23,772 held-out pick decisions, beating the +0.0032 from
// refitting every recommender weight. Validation preferred the smallest shrink
// prior tried and the curve is monotone in that direction, i.e. the map layer
// wants MORE weight, not less — which is why the prior is 50 against the
// patch-wide 135.
//
// The long tail is deliberately not stored: of 169,191 per-map pairings only
// 18.7% reach 30 games and 2.6% reach 200, so map_pair_edges keeps what clears
// its floor and everything else simply falls through to the patch-wide rate.
//
// INVARIANT: pairEdgeVs(a, b) === -pairEdgeVs(b, a), and the map layer PRESERVES
// it — both directions are stored, so mapWR(a,b) = 100 - mapWR(b,a) exactly and
// the blend weight is the same either way. Anything that scores BOTH sides and
// takes the difference counts this term twice, exactly the counterMatrix trap,
// which is why mapPairs.splitWeight is half the intuitive value.
const pairEdgeVs = (myKey, enemyKey, intelligence = {}, mapPairs = null) => {
  const v = intelligence[norm(myKey)]?.vs_brawler?.[norm(enemyKey)];
  const n = Number(v?.picks) || 0;
  const wr = parseFloat(v?.winRate);
  const prior = CONFIG.mapPairs?.shrinkPriorGames ?? 135;
  const patchEdge = (!n || !Number.isFinite(wr)) ? 0 : (wr - 50) * (n / (n + prior));

  const mp = mapPairs?.[`${norm(myKey)}|${norm(enemyKey)}`];
  const mn = Number(mp?.picks) || 0;
  if (!mn) return { edge: patchEdge, games: n, winRate: Number.isFinite(wr) ? wr : null, mapGames: 0 };
  const mapWR = (Number(mp.wins) / mn) * 100;
  const w = mn / (mn + (CONFIG.mapPairs?.mapShrinkPriorGames ?? 50));
  return {
    edge: (mapWR - 50) * w + patchEdge * (1 - w),
    games: n, winRate: Number.isFinite(wr) ? wr : null,
    mapGames: mn, mapWinRate: Math.round(mapWR * 10) / 10,
  };
};

// Measured teammate synergy, from with_brawler.
//
// The signal is the EXCESS over what the pair's own solo rates already predict,
// never the raw duo win rate. Raw conflates synergy with individual strength —
// two strong brawlers post a high duo rate with no interaction whatsoever, and
// the engine would then double-count strength it has already scored. Measured
// 2026-08-27: excess held out at +0.0102 AUC, raw at +0.0088.
//
// Shrunk by sample like pairEdgeVs, so a 40-game duo cannot shout. Unlike
// pairEdgeVs this is NOT antisymmetric — each team's synergy is computed from
// its own pairs — so the differential counts it once and the weight is the
// intuitive value rather than half of it.
const pairEdgeWith = (aKey, bKey, intelligence = {}) => {
  const a = norm(aKey), b = norm(bKey);
  const v = intelligence[a]?.with_brawler?.[b] ?? intelligence[b]?.with_brawler?.[a];
  const n = Number(v?.picks) || 0;
  const wr = parseFloat(v?.winRate);
  if (!n || !Number.isFinite(wr)) return { edge: 0, games: 0, winRate: null, excess: null };
  const ra = recencyTWR(intelligence[a]), rb = recencyTWR(intelligence[b]);
  if (ra == null || rb == null) return { edge: 0, games: n, winRate: wr, excess: null };
  const excess = wr - (ra + rb) / 2;
  const prior = CONFIG.duoSynergy?.shrinkPriorGames ?? 135;
  return { edge: excess * (n / (n + prior)), games: n, winRate: wr, excess };
};

// Mean synergy across a team's three pairings, in win-rate points so it is
// dimensionally comparable to every other term. Falls back to the class table
// for a duo with no measured sample.
const teamSynergy = (keys, intelligence = {}) => {
  let pts = 0, n = 0;
  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++) {
      const m = pairEdgeWith(keys[i], keys[j], intelligence);
      pts += m.excess == null ? synergyScore(draftClassOf(keys[i]), draftClassOf(keys[j])) : m.edge;
      n++;
    }
  return n ? pts / n : 0;
};

// Mean head-to-head edge of one brawler against a set of enemies. A MEAN, not a
// sum: it stays denominated in win-rate points, so it is dimensionally
// comparable to the solo-rate mean that both scorers are built on.
const meanPairEdge = (myKey, enemyKeys, intelligence = {}, mapPairs = {}) => {
  const rows = enemyKeys
    .map(ek => ({ name: fmtName(ek), ...pairEdgeVs(myKey, ek, intelligence, mapPairs) }))
    .filter(r => r.games > 0);
  if (!rows.length) return { mean: 0, rows: [], best: null, worst: null, games: 0 };
  return {
    mean: rows.reduce((a, r) => a + r.edge, 0) / rows.length,
    rows,
    // By EDGE, not by sample size. Picking the largest sample is why a card
    // could report "51.9% vs their Pierce" (4,872 games) and stay silent about
    // "61% vs their Nani" (290) — the second is the reason to make the pick.
    best: rows.reduce((a, r) => (r.edge > a.edge ? r : a)),
    worst: rows.reduce((a, r) => (r.edge < a.edge ? r : a)),
    games: rows.reduce((a, r) => a + r.games, 0),
  };
};

const matrixScore = (myClass, enemyClass) =>
  CONFIG.counterMatrix[myClass]?.[enemyClass] ?? 0;

// Class-matrix edge for a concrete brawler pairing, honoring per-brawler
// matchupOverrides (e.g. BOLT is a tank that throwers do NOT counter). The
// override value is the listed brawler's edge vs that enemy class; the
// reverse pairing gets its negation. Falls back to the class matrix.
const pairEdge = (myKey, myClass, enemyKey, enemyClass) => {
  const ex = CONFIG.matchupOverrides || {};
  const mine = ex[norm(myKey)]?.[enemyClass];
  if (mine != null) return mine;
  const theirs = ex[norm(enemyKey)]?.[myClass];
  if (theirs != null) return -theirs;
  return matrixScore(myClass, enemyClass);
};

const synergyScore = (a, b) =>
  CONFIG.synergyPairs[`${a}+${b}`] ?? CONFIG.synergyPairs[`${b}+${a}`] ?? 0;

// ── Map-keyed config lookup ──────────────────────────────────────────────────
// The live API's spelling for a map drifts across rotations ("Belles Rock" vs
// "Belle's Rock", "Out in the open" vs "Out in the Open"), so config tables
// keyed by map name resolve case- and punctuation-insensitively instead of
// forcing every variant to be duplicated in the JSON.
const mapSlug = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const lookupByMap = (table, name) => {
  if (!table || !name) return null;
  if (table[name]) return table[name];
  const want = mapSlug(name);
  for (const k of Object.keys(table)) {
    if (k.startsWith("_")) continue;
    if (mapSlug(k) === want) return table[k];
  }
  return null;
};

// ── Prior damping ────────────────────────────────────────────────────────────
// Every hand-authored prior in this engine (map geometry, pro map rules, pro
// tier corrections) is a stand-in for evidence we don't have yet. Once real
// data exists for that brawler, the measured win rate already encodes whatever
// the prior was describing, so the prior shrinks toward 1.0 rather than
// stacking on top of it. `damp` = how much of the prior survives when the
// evidence is present (0.5 → half-strength).
const dampPrior = (mult, hasData, damp = 0.5) =>
  mult === 1 || !hasData ? mult : 1 + (mult - 1) * damp;

const fmtName = (key) =>
  norm(key).toLowerCase().replace(/[a-z]+/g, w => w.charAt(0).toUpperCase() + w.slice(1));

// ── final_sanity_check ───────────────────────────────────────────────────────
// A legal comp has a mid (objective player), at least one lane anchor for the
// two lanes, and the mode's objective specialist. Returns what's missing.
export function finalSanityCheck(teamKeys, mode) {
  const classes = teamKeys.map(draftClassOf);
  const roles = CONFIG.roles;
  const specialists = roles.objectiveSpecialistByMode[mode] || [];
  const hasMid = classes.some(c => roles.midClasses.includes(c));
  const hasAnchor = classes.some(c => roles.laneAnchorClasses.includes(c));
  const hasObjective = specialists.length === 0 || classes.some(c => specialists.includes(c));
  const missing = [];
  if (!hasMid) missing.push("mid holder");
  if (!hasAnchor) missing.push("lane anchor");
  if (!hasObjective) missing.push(CONFIG.roles.objectiveSpecialistLabel[mode] || "objective specialist");
  return { hasMid, hasAnchor, hasObjective, missing };
}

// ── The 5-pass advisor ───────────────────────────────────────────────────────
export function getDraftAdvice({
  mode,                 // camelCase mode, e.g. "brawlBall"
  mapName = null,       // exact map name — unlocks geometry/bush modifiers
  pickSlot,             // global pick about to be made, 1..6
  myTeam = [],          // my revealed picks (brawler keys)
  enemyTeam = [],       // enemy revealed picks (brawler keys)
  unavailable = [],     // picked or banned keys
  banned = [],          // banned keys ONLY — some rules lift once a named answer is off the board
  mapStats = {},        // { KEY: {picks, wins} } for this map+bracket
  matchupStats = {},    // { KEY: {picks, wins} } empirical vs this exact enemy set
  intelligence = {},    // { KEY: brawler_intelligence row }
  topN = 7,             // 3 explained in full, the rest as name + score
  minMapPicks = 30,
  mapClassLift = null,  // { CLASS: liftPts } measured class fit for THIS map (map_class_weights)
  modeStats = null,     // { KEY: {picks, wins} } across every map of this mode
  mapPairs = null,      // { "A|B": {picks, wins} } head-to-head ON THIS MAP
  _noDenial = false,    // internal: guards the one-level enemy-perspective recursion
}) {
  const modeCfg = CONFIG.modes[mode] || { tempo: "active", classWeights: {}, maxPerClass: {} };
  const myClasses = myTeam.map(draftClassOf);
  const enemyClasses = enemyTeam.map(draftClassOf);
  const enemyPicksRemaining = 3 - enemyTeam.length;
  // How many of each class the enemy has committed — drives the counter-stack rule.
  const enemyClassCounts = {};
  for (const c of enemyClasses) enemyClassCounts[c] = (enemyClassCounts[c] || 0) + 1;
  // rankedIneligible is a hard exclusion regardless of any data that exists for
  // the key — a safety net for newly released brawlers not yet legal in Ranked
  // (belt-and-suspenders on top of the scraper's own ranked-only filter).
  const ineligible = CONFIG.rankedIneligible?.keys || [];
  const used = new Set([...myTeam, ...enemyTeam, ...unavailable, ...ineligible].map(norm));
  const coeff = CONFIG.statisticalCoefficients;
  const mapPri = CONFIG.mapPriority || { blendPriorGames: 400, firstPick: {} };
  const fpPri = mapPri.firstPick || {};

  // Every match contributes 6 brawler-picks, so the map's total picks / 6 is
  // the number of matches behind this map's sample. That denominator turns raw
  // picks into a PRESENCE percentage — "what share of games on this map does
  // this brawler actually show up in" — which is the pick-rate half of judging
  // a first pick, and is meaningless without it.
  const mapTotalPicks = Object.values(mapStats).reduce((a, s) => a + (Number(s?.picks) || 0), 0);
  const mapTotalMatches = mapTotalPicks > 0 ? mapTotalPicks / 6 : 0;
  const cons = CONFIG.constraints;

  // Phase-specific drafting (counter-ladder): how hard counter evidence weighs
  // scales with the pick slot — anchor phase (1-2) is stats-led, late picks
  // (5-6) are hard-counter execution. Ability tags feed the wall-break rules.
  const abilityRules = CONFIG.abilityRules || {};
  const supportRules = CONFIG.supportRules || {};
  const ladder = CONFIG.counterLadder || {};
  const slotCounterW = ladder.counterWeightBySlot?.[String(pickSlot)] ?? 1;
  const myAbilities = new Set(myTeam.flatMap(abilitiesOf));
  const enemyAbilities = new Set(enemyTeam.flatMap(abilitiesOf));
  const bannedSet = new Set(banned.filter(Boolean).map(norm));

  // Pro map intel (SpenLC breakdowns) for THIS map: requirements, class biases,
  // ban advice. Everything numeric here is a prior and gets damped once the
  // candidate has a real sample on the map — see dampPrior.
  const mapRule = lookupByMap(CONFIG.mapRules, mapName) || {};
  const mapDamp = CONFIG.mapRules?._defaults?.dampWithMapData ?? 0.5;
  // requireArchetype ramps in as the team runs out of slots to satisfy it: a
  // flat whole-comp penalty would shift every candidate equally and change no
  // ranking, so instead the candidates that DON'T satisfy the mandate get
  // penalized, at full strength on the final pick and half strength before it.
  const archetype = mapRule.requireArchetype;
  const myPicksLeft = 3 - myTeam.length;
  const archetypeMissing = archetype &&
    !myClasses.some(c => archetype.classes.includes(c)) && myPicksLeft <= 2;
  const archetypeMult = archetypeMissing
    ? (myPicksLeft === 1 ? archetype.multiplier : 1 + (archetype.multiplier - 1) * 0.5)
    : 1;
  // requireTeamAbility: the handicap stays on until SOMEONE on the team brings
  // the enabling ability — the candidate itself counts, which is what makes the
  // wall breaker rise instead of merely making the sniper fall.
  const rta = mapRule.requireTeamAbility;
  const teamHasRequiredAbility = rta
    ? [...myAbilities].some(a => rta.abilities.includes(a)) : true;

  // PASS 3 prep: which class is the biggest available threat to my comp
  // (including nothing picked yet → generic anti-meta threat is skipped).
  let topThreatClass = null;
  if (enemyPicksRemaining > 0 && myTeam.length > 0) {
    let best = 0;
    for (const threat of CONFIG.classes) {
      const dmg = myClasses.reduce((s, mine) => s + Math.max(0, matrixScore(threat, mine)), 0);
      if (dmg > best) { best = dmg; topThreatClass = threat; }
    }
    if (best < 1.5) topThreatClass = null; // no meaningful threat to block
  }

  // Interception drafting: evaluate what the ENEMY would most want to pick
  // next (one-level recursion, guarded by _noDenial). If their dream pick also
  // scores well for us, stealing it gets a denial bonus in the loop below.
  let enemyTopKey = null;
  const denial = ladder.denial;
  if (denial && !_noDenial && enemyPicksRemaining > 0) {
    const enemyView = getDraftAdvice({
      mode, mapName, pickSlot, myTeam: enemyTeam, enemyTeam: myTeam,
      unavailable, mapStats, matchupStats: {}, intelligence,
      topN: 1, minMapPicks, mapClassLift, modeStats, mapPairs, _noDenial: true,
    });
    enemyTopKey = enemyView.suggestions[0]?.key ?? null;
  }

  let candidates = [];
  const pool = new Set([...Object.keys(mapStats), ...Object.keys(intelligence)].map(norm));

  for (const key of pool) {
    if (used.has(key)) continue;
    const ms = mapStats[key];
    const intel = intelligence[key];
    if ((!ms || ms.picks < minMapPicks) && !intel) continue;

    const cls = draftClassOf(key);
    const candAbilities = abilitiesOf(key);
    const candAbility = candAbilities[0] || null;   // primary tag — UI badge only
    const chips = [];       // short UI badges [{label, tone}]
    const why = [];         // rationale fragments, priority-ordered

    // ── PASS 1 · Statistical: true win rate + coefficient flags ──
    const mapPicks = ms?.picks || 0;
    const mapTWR = mapPicks >= minMapPicks ? trueWR(ms.wins, mapPicks) : null;
    let globalTWR = intel ? parseFloat(intel.true_win_rate) : null;

    // Recency blend: when the last N days have a solid sample, they outvote
    // the full-patch aggregate — a shadow-nerfed brawler stops being
    // recommended within days even if a million older games say otherwise.
    const rec = coeff.recency;
    const recentPicks = Number(intel?.recent_picks) || 0;
    if (rec && globalTWR != null && recentPicks >= (rec.minRecentPicks ?? 300)) {
      const recentTWR = trueWR(Number(intel.recent_wins) || 0, recentPicks);
      const w = rec.recentWeight ?? 0.6;
      globalTWR = recentTWR * w + globalTWR * (1 - w);
    }

    // Map data leads, in proportion to how much of it there is. The old fixed
    // 65/35 split had two failure modes: it treated 40 map games exactly like
    // 4,000, and — worse — a brawler with NO map sample fell straight through
    // to a pure overall score, so "unproven on this map" ranked identically to
    // "proven on this map". Sample weighting fixes both: the weight rises
    // smoothly with evidence and is 0 when there is none.
    let score = blendMapGlobal(mapPicks, mapTWR,
      modeOrGlobalTWR(modeStats, key, globalTWR, CONFIG.mapPriority?.modeFallbackMinPicks));

    // Pro tier correction: a named balance change (star-power rework, buff) the
    // patch aggregate hasn't caught up to yet. Damped once the RECENT window
    // has a solid sample, because that window is the engine's own detector for
    // exactly this — the prior only covers the lag before the data lands.
    const bias = CONFIG.brawlerBias?.[key]?.modes?.[mode];
    if (bias) {
      const solidRecent = recentPicks >= (rec?.minRecentPicks ?? 300);
      score *= dampPrior(bias, solidRecent, CONFIG.brawlerBias._defaults?.dampWithRecentData ?? 0.5);
    }

    // Trending chips: recent WR diverging hard from the patch aggregate is
    // the signature of a balance change or meta shift mid-patch.
    if (rec && recentPicks >= (rec.minRecentPicks ?? 300) &&
        intel?.recent_win_rate != null && intel?.win_rate != null) {
      const drift = parseFloat(intel.recent_win_rate) - parseFloat(intel.win_rate);
      if (drift <= -(rec.trendDeltaPct ?? 4)) chips.push({ label: rec.downLabel ?? "Trending down", tone: "bad" });
      else if (drift >= (rec.trendDeltaPct ?? 4)) chips.push({ label: rec.upLabel ?? "Trending up", tone: "good" });
    }

    const flags = intel?.flags || [];
    if (flags.includes("broken")) {
      score *= coeff.brokenIndicator.scoreMultiplier;
      chips.push({ label: coeff.brokenIndicator.label, tone: "good" });
      why.push(`flagged a meta breaker (${intel.win_rate}% over ${Number(intel.picks).toLocaleString("en-US")} games)`);
    }
    if (flags.includes("popularity_trap")) {
      score *= coeff.popularityTrap.scoreMultiplier;
      chips.push({ label: coeff.popularityTrap.label, tone: "bad" });
      why.push(`a popularity trap — ${intel.pick_rate}% picked but only ${intel.win_rate}% wins`);
    }
    if (flags.includes("inflation_bias")) {
      score *= coeff.inflationBias.scoreMultiplier;
      chips.push({ label: coeff.inflationBias.label, tone: "bad" });
    }

    // ── PASS 2 · Counter-intelligence vs revealed enemy picks ──
    // With no enemy info yet, fall back to per-brawler blind safety: a 60% WR
    // Edgar is still a terrible reveal because his wins come from matchups.
    let matchupWinRate = null, matchupPicks = null;
    let dataEdge = null;                 // empirical WR-50 vs their classes
    let bestPair = null;                 // { name, winRate, picks, edge } strongest head-to-head edge
    let worstPair = null;                // { name, winRate, picks, edge } weakest head-to-head edge
    let compPair = null;                 // { mean, games, count } mean edge across the revealed enemies
    let bestEdge = 0, bestCounterName = null;   // strongest class edge we have
    let worstEdge = 0, worstCounterName = null; // worst class matchup we're in
    let stackedCounter = null;           // { cls, count } enemy class we hard-counter and they stacked
    // ── Use rate ─────────────────────────────────────────────────────────────
    // A small nudge toward brawlers this map actually plays. Deliberately tiny,
    // and the size is the whole point: a use-rate term was measured across three
    // shapes and eleven weights on 23,772 held-out decisions and it NEVER helped.
    // It only stops hurting once it is small enough to be a tie-breaker —
    // linear 0.05 costs -0.0007 +/-0.0007 (significant), 0.03 costs
    // -0.0004 +/-0.0004, and 0.02 costs -0.0002 +/-0.0003, indistinguishable
    // from zero. So 0.02 buys the "there is a reason these are picked" intuition
    // at a price the data says is nil: about +0.9 points for a 45%-presence
    // staple against +0.1 for a 5% niche pick, on a ~50-90 scale.
    //
    // Note presence ALREADY enters the score properly, as confidence rather than
    // as a bonus: mapWRk shrinks toward the brawler's global rate by SAMPLE, and
    // on a fixed map games = presence x matches. On a 70k-match map a 40%
    // brawler keeps 98.6% of its map rate and a 3% brawler only 84%. That is the
    // statistically correct use of popularity, and it is why an additive bonus
    // adds so little — the information is largely already spent.
    const useCfg = CONFIG.useRate || {};
    if ((useCfg.weight ?? 0) > 0 && mapTotalMatches > 0) {
      score += (useCfg.weight ?? 0) * ((mapPicks / mapTotalMatches) * 100);
    }

    // ── Counterability ───────────────────────────────────────────────────────
    // The risk that the enemy simply answers this pick. It is NOT a property of
    // "no enemy revealed yet" — it lasts as long as they still hold picks, so
    // it scales with enemyPicksRemaining instead of firing once on an empty
    // board and then vanishing the moment they reveal one brawler.
    //
    // ADDITIVE, in win-rate points. It used to be `score *= blindPickFactor`,
    // a 0.35-1.0 multiplier on a 50-90 point score — up to -40 points for an
    // Edgar, an order of magnitude larger than any measured term in the engine.
    //
    // The SAFETY VALUES behind it stay hand-authored on purpose. Two independent
    // attempts to derive them failed against the owner's own ground truth
    // (matchup spread put Rico 2nd-safest of 95; meta-weighted counter risk put
    // Rico 2nd-safest of 92 and Mortis safer than Brock — both backwards). The
    // cause is structural: vs_brawler only covers drafts that actually happened,
    // and nobody first-picks Mortis, so the punishment he would take is never
    // observed. Without draft order in ranked_matches this is unrecoverable.
    const counterability = 1 - (getDraftProfile(key).firstPickSafety ?? 0.65);
    if (enemyPicksRemaining > 0) {
      score -= (CONFIG.scoring?.counterabilityPts ?? 14) * counterability
               * (enemyPicksRemaining / 3);
    }

    // ── Ban relief ───────────────────────────────────────────────────────────
    // Bans that removed an answer to THIS candidate. Same machinery as
    // counterability, opposite sign: one asks what threats remain available,
    // the other what threats were taken off the board. Gated on
    // enemyPicksRemaining, because a ban is only worth something while the
    // enemy could still have used it.
    //
    // Weighted by how likely the enemy was to pick it: banning Ash removes a
    // bigger per-game threat to Brock (8.78 pts) than banning Stu (4.66), but
    // Stu is picked three times as often, so the ban removes more real risk.
    //
    // Deductive rather than fitted — ranked_matches has no ban data, so there is
    // no hold-out for this. It is entered at its arithmetic value for that
    // reason. It replaces firstPickCaution.waivedIfBanned, which hard-coded
    // "Brock is safe if Max is banned" — Max vs Brock measures 49.81% over
    // 37,243 games, i.e. no counter at all.
    if (enemyPicksRemaining > 0 && bannedSet.size && mapTotalMatches > 0) {
      const brCfg = CONFIG.banRelief || {};
      let relief = 0; const freedFrom = [];
      for (const bk of bannedSet) {
        const threat = -pairEdgeVs(key, bk, intelligence, mapPairs).edge;
        if (threat <= 0) continue;
        const bPicks = Number(mapStats[bk]?.picks) || 0;
        const pPick = Math.min(1, bPicks / mapTotalMatches);
        if (!pPick) continue;
        relief += threat * pPick;
        if (threat >= (brCfg.chipEdgePts ?? 2.5)) freedFrom.push(fmtName(bk));
      }
      if (relief > 0) {
        score += relief * (brCfg.weight ?? 1) * (enemyPicksRemaining / 3);
        if (freedFrom.length) {
          chips.push({ label: `${freedFrom[0]} banned`, tone: "good" });
          why.push(`their answer is gone — ${freedFrom.join(" / ")} banned with ${enemyPicksRemaining} pick${enemyPicksRemaining > 1 ? "s" : ""} left`);
        }
      }
    }

    if (enemyTeam.length === 0) {
      const bl = blindPickLabel(key);
      if (bl) chips.push(bl);
      if (bl?.tone === "bad") why.push("risky reveal — wins come from favorable matchups");

      // First pick is a MAP question before it is a matchup question. With no
      // enemy revealed there is nothing to counter, so the only real evidence
      // is whether this brawler wins AND gets played on this specific map. A
      // brawler nobody picks here is not a first pick however good their global
      // numbers look — and one with no map sample at all is a guess, not a read.
      if (mapTWR == null) {
        score *= fpPri.noMapDataPenalty ?? 0.8;
        chips.push({ label: fpPri.noMapDataLabel ?? "No map data", tone: "bad" });
        why.push("no meaningful sample on this map — scored on overall data alone");
      } else if (mapTotalMatches > 0) {
        const presencePct = (mapPicks / mapTotalMatches) * 100;
        if (presencePct >= (fpPri.staplePresencePct ?? 8)) {
          score *= fpPri.stapleBonus ?? 1.06;
          chips.push({ label: fpPri.stapleLabel ?? "Map staple", tone: "good" });
          why.push(`picked in ${presencePct.toFixed(1)}% of games on this map`);
        } else if (presencePct <= (fpPri.rarePresencePct ?? 2)) {
          score *= fpPri.rarePenalty ?? 0.88;
          chips.push({ label: fpPri.rareLabel ?? "Rarely picked here", tone: "bad" });
          why.push(`only ${presencePct.toFixed(1)}% pick rate on this map`);
        }
      }
    }
    if (enemyTeam.length > 0) {
      // Class counter matrix. No longer theory: every value is a measured
      // head-to-head edge in WIN-RATE POINTS, so `edge` here reads directly as
      // "this class wins N points more often against that one". The chip
      // threshold is config-driven because the matrix changed scale — at the
      // old hardcoded 1.5 only two of 42 class pairings could ever fire.
      const chipAt = CONFIG.classCounter?.chipThreshold ?? 1.0;
      // A class cell describes CLASSES, never these two brawlers — within-class
      // spread dwarfs the class mean (vs throwers, Bolt is +5.79 and Buster
      // -5.19 around a class mean of ~0). So when vs_brawler has a real sample
      // on this exact pairing, the class matrix must not also make a claim
      // about it: that is how one card came to read "Weak vs Emz" (Tank vs
      // Anti-Tank, -1.06) next to "Beats their Emz" (measured, and correct).
      // The matrix is a FALLBACK, so it speaks only where the measurement is
      // thin — the same rule its weighting already follows.
      // Two ways the measurement can outrank the class: a big sample, or an
      // edge strong enough that the pair chip below will speak for itself. The
      // second is what a games-only gate misses — the pair chip fires off the
      // SHRUNK edge, so a 150-game pairing can still chip and collide.
      const deferAt = CONFIG.classCounter?.deferToPairGames ?? 200;
      const pairChipPts = CONFIG.mapPairs?.chipEdgePts ?? 2.5;
      let matrixPts = 0;
      for (let i = 0; i < enemyTeam.length; i++) {
        const edge = pairEdge(key, cls, enemyTeam[i], enemyClasses[i]);
        matrixPts += edge;
        if (edge > bestEdge) { bestEdge = edge; bestCounterName = fmtName(enemyTeam[i]); }
        if (edge < worstEdge) { worstEdge = edge; worstCounterName = fmtName(enemyTeam[i]); }
        // Measured head-to-head on this pairing outranks the class generalisation.
        const pv = pairEdgeVs(key, enemyTeam[i], intelligence, mapPairs);
        if (pv.games >= deferAt || Math.abs(pv.edge) >= pairChipPts) continue;
        if (edge >= chipAt) {
          chips.push({ label: `Counters ${fmtName(enemyTeam[i])}`, tone: "good" });
          why.push(`${classLabel(cls)} answer to their ${fmtName(enemyTeam[i])}`);
        } else if (edge <= -chipAt) {
          chips.push({ label: `Weak vs ${fmtName(enemyTeam[i])}`, tone: "bad" });
        }
      }
      // 2.0 against the measured matrix is roughly the contribution 1.4 gave
      // against the old authored one — the matrix got smaller, not this term
      // louder. Worth being blunt about the size of the effect: held out over
      // 23,772 real pick decisions, removing the class matrix ENTIRELY moves
      // AUC by -0.0008 ± 0.0010. It does not clear its own error bar, and
      // neither did the authored table, the measured one, or 18 classes learned
      // by co-clustering — a class matrix cannot add much once brawler-level
      // vs_brawler covers 93% of decisions. It stays because it explains picks,
      // not because it ranks them. See classCounter in the config.
      score += matrixPts * (CONFIG.classCounter?.adviceWeight ?? 2.0) * slotCounterW;

      // Counter-stack: the enemy committed 2+ of a class we hard-counter → near-lock.
      const cStack = cons.counterStack;
      if (cStack) {
        for (const [ec, cnt] of Object.entries(enemyClassCounts)) {
          if (cnt >= cStack.minStack && matrixScore(cls, ec) >= cStack.hardCounterThreshold &&
              (!stackedCounter || cnt > stackedCounter.count)) {
            stackedCounter = { cls: ec, count: cnt };
          }
        }
      }

      // Data: this brawler's empirical WR against the enemy's classes
      if (intel?.vs_class) {
        const edges = enemyClasses
          .map(ec => intel.vs_class[ec])
          .filter(v => v && v.picks >= 200)
          .map(v => parseFloat(v.winRate) - 50);
        if (edges.length) {
          dataEdge = edges.reduce((a, v) => a + v, 0) / edges.length;
          score += dataEdge * 0.6 * slotCounterW;
          if (dataEdge >= 2.5) why.push(`${(50 + dataEdge).toFixed(1)}% into their classes historically`);
        }
      }

      // Data: brawler-vs-BRAWLER empirical edges — sharper than class-level and
      // able to contradict it (e.g. Brock empirically beats Mortis even though
      // sniper "loses" to space maker on the matrix). Weighted above vs_class.
      // Shrinkage replaces the old hard `picks >= 100` step gate: a 99-game pair
      // used to count for nothing and a 100-game pair for everything, which is
      // not how evidence works. Now it fades in continuously.
      if (enemyTeam.length) {
        const mp = CONFIG.mapPairs || {};
        const pe = meanPairEdge(key, enemyTeam, intelligence, mapPairs);
        if (pe.rows.length) {
          score += pe.mean * (mp.suggestWeight ?? 1.0) * slotCounterW;
          bestPair = { name: pe.best.name, winRate: pe.best.winRate, picks: pe.best.games, edge: pe.best.edge };
          worstPair = { name: pe.worst.name, winRate: pe.worst.winRate, picks: pe.worst.games, edge: pe.worst.edge };
          compPair = { mean: pe.mean, games: pe.games, count: pe.rows.length };
          // Chips fire off the SHRUNK edge, so a thin fluke can't produce one.
          const chipPts = mp.chipEdgePts ?? 2.5;
          if (pe.best.edge >= chipPts) chips.push({ label: `Beats their ${pe.best.name}`, tone: "good" });
          else if (pe.worst.edge <= -chipPts) chips.push({ label: `Loses to their ${pe.worst.name}`, tone: "bad" });
        }
      }

      // Named counters (pro source): sits above the class matrix, which only
      // sees e.g. Control-vs-Support and would miss that Pearl specifically
      // eats dive. Damped when we already have map evidence for this brawler.
      const named = CONFIG.brawlerCounters?.[key];
      if (named) {
        const hits = enemyTeam.filter(ek => named.vs.includes(norm(ek)));
        if (hits.length) {
          score *= dampPrior(named.multiplier, mapTWR != null,
            CONFIG.brawlerCounters._defaults?.dampWithMapData ?? 0.5);
          chips.unshift({ label: named.label, tone: "good" });
          why.unshift(`hard answer to their ${hits.map(fmtName).join(" / ")}`);
        }
      }

      // Data: exact-matchup evidence on this map vs this enemy set
      const emp = matchupStats[key];
      if (emp && emp.picks >= 20) {
        matchupWinRate = Math.round((emp.wins / emp.picks) * 1000) / 10;
        matchupPicks = emp.picks;
        score = score * 0.6 + trueWR(emp.wins, emp.picks) * 0.4;
      }
    }

    // ── Ability rules (Bobby) · wall break opens lanes / strips cover ──
    if (candAbilities.includes("WALL_BREAK")) {
      const sniperMates = myClasses.filter(c => c === "SNIPER").length;
      // Synergy: our snipers dominate once the obstacles are gone
      if (sniperMates > 0 && abilityRules.wallBreakSniperSynergy) {
        score += abilityRules.wallBreakSniperSynergy.bonusPerSniper * sniperMates;
        chips.push({ label: abilityRules.wallBreakSniperSynergy.label, tone: "good" });
        why.push("wall break opens lanes for your snipers");
      }
      // Hard counter: throwers are defenseless without their cover
      const enemyThrowers = enemyClasses.filter(c => c === "THROWER").length;
      if (enemyThrowers > 0 && abilityRules.wallBreakVsThrower) {
        score += abilityRules.wallBreakVsThrower.bonusPerThrower * enemyThrowers;
        chips.unshift({ label: abilityRules.wallBreakVsThrower.label, tone: "good" });
        why.unshift("strips the cover their thrower depends on");
      }
      // Combined counter: no approach cover → their anti-tank gets kited by our snipers
      if (enemyClasses.includes("ANTI_TANK") && sniperMates > 0 && abilityRules.wallBreakSniperVsAntiTank) {
        score += abilityRules.wallBreakSniperVsAntiTank.bonus;
        chips.push({ label: abilityRules.wallBreakSniperVsAntiTank.label, tone: "good" });
      }
    }
    // Mirror: a sniper joining a team that already brought the wall break
    if (cls === "SNIPER" && myAbilities.has("WALL_BREAK") && abilityRules.sniperWithWallBreakSynergy) {
      score += abilityRules.sniperWithWallBreakSynergy.bonus;
      chips.push({ label: abilityRules.sniperWithWallBreakSynergy.label, tone: "good" });
    }

    // ── Teammate synergy · measured duo edge with already-locked mates ──
    // The EXCESS over what the pair's own solo rates predict, not the raw duo
    // win rate this used to score. Raw conflates synergy with individual
    // strength — two strong brawlers post a high duo rate with no interaction
    // at all — so scoring it double-counts strength already in the solo term.
    // Measured 2026-08-27 in the win split: excess held out at +0.0102 AUC,
    // raw at +0.0088. Same helper as computeWinSplit, so the ranker and the
    // verdict cannot disagree about which duos are good.
    //
    // The weight is set to preserve this block's previous influence rather than
    // amplify it: 0.5 x raw-vs-50 and 1.0 x shrunk-excess are comparable in
    // magnitude for a typical strong duo. Unlike the win-split weight, this one
    // is NOT independently validated — the recommender resists outcome testing.
    if (myTeam.length > 0) {
      const duoW = CONFIG.duoSynergy?.adviceWeight ?? 1.0;
      for (const mk of myTeam) {
        const m = pairEdgeWith(key, mk, intelligence);
        if (m.excess == null) {
          score += synergyScore(cls, draftClassOf(mk)) * duoW;   // no sample: fall back to the class table
          continue;
        }
        score += m.edge * duoW;
        if (m.excess >= 3) chips.push({ label: `Duos with ${fmtName(mk)}`, tone: "good" });
        else if (m.excess <= -3) chips.push({ label: `Weak duo with ${fmtName(mk)}`, tone: "bad" });
        if (m.games >= 300 && Math.abs(m.excess) >= 3) {
          why.push(`${m.winRate.toFixed(1)}% together with ${fmtName(mk)} over ${m.games.toLocaleString("en-US")} games`);
        }
      }
    }

    // ── PASS 3 · Preventative: block their best remaining answer to us ──
    if (topThreatClass && enemyPicksRemaining > 0) {
      const blocks = matrixScore(cls, topThreatClass) >= 1.5;
      const denies = cls === topThreatClass;
      if (blocks || denies) {
        score += 6;
        chips.push({ label: `Blocks ${classLabel(topThreatClass)}`, tone: "good" });
        why.push(`preventative pick — ${denies ? "denies" : "pre-answers"} the ${classLabel(topThreatClass)} response to your comp`);
      }
    }

    // ── PASS 4 · Strategic / map filter ──
    // Class fit for THIS MAP, measured, in win-rate points — how much a class
    // over- or under-performs here relative to its own brawlers' global rates,
    // so brawler strength is removed and what is left is map fit. Rebuilt daily
    // from map_class_weights, so it tracks the meta instead of rotting.
    //
    // ADDITIVE, not multiplicative, and that is the whole point. The authored
    // weights multiplied a ~50-90 point score, so CONTROL x1.15 was worth ~+11
    // points — an order of magnitude more than the effect it was describing.
    // Measured, Control on Double Swoosh is -0.31. Held out over 23,772 real
    // pick decisions the authored weights cost -0.0041 AUC at shipped strength
    // and -0.0083 at 1.5x, a clean monotone slide; the measured term is neutral
    // (-0.0000 +/- 0.0013). So the gain here is from REMOVING a harmful term,
    // not from adding a predictive one — see mapClassFit in the config.
    const measuredFit = mapClassLift?.[cls];
    if (measuredFit != null) score += measuredFit * (CONFIG.mapClassFit?.weight ?? 1);
    else score *= modeCfg.classWeights?.[cls] ?? 1;   // fallback: no data for this map yet

    // Map geometry + mechanical attributes (range / attack type / spawner /
    // bush kits). Geometry is a PRIOR: dampened when the brawler has a real
    // map sample, since live map WR already encodes how the map treats them.
    const attrs = CONFIG.brawlerAttributes?.[key];
    const mapProf = lookupByMap(CONFIG.mapProfiles, mapName);
    const aRules = CONFIG.attributeRules || {};
    if (mapProf && aRules.geometry) {
      // Dynamic map mutation: a friendly wall breaker (already drafted, or this
      // candidate itself) physically opens the map — CLOSED plays like MIXED,
      // MIXED plays like OPEN, so range modifiers use the mutated state.
      let openness = mapProf.openness;
      if (aRules.geometry.wallBreakShiftsOpen &&
          (myAbilities.has("WALL_BREAK") || candAbilities.includes("WALL_BREAK"))) {
        openness = openness === "CLOSED" ? "MIXED" : "OPEN";
      }
      const g = aRules.geometry[openness] || {};
      let gm = (attrs && g.rangeMultipliers?.[attrs.range]) ?? 1;
      gm *= g.classMultipliers?.[cls] ?? 1;
      if (gm !== 1 && mapTWR != null) gm = 1 + (gm - 1) * (aRules.geometry.dampWithMapData ?? 0.5);
      score *= gm;
    }
    if (mapProf && attrs?.bushSynergy && aRules.bushSynergy) {
      const bushPts = aRules.bushSynergy[mapProf.bushDensity] || 0;
      if (bushPts) {
        score += bushPts;
        if (mapProf.bushDensity === "HIGH") chips.push({ label: aRules.bushSynergy.label, tone: "good" });
      }
    }
    // Spawner interactions: attackable summons soak single shots unless a
    // teammate brings the wave-clear; pierce/splash clears them for free.
    const enemyHasSpawner = enemyTeam.some(ek => CONFIG.brawlerAttributes?.[norm(ek)]?.spawner);
    if (enemyHasSpawner && attrs) {
      const ss = aRules.singleShotVsSpawner;
      if (ss && attrs.attackType === "SINGLE_SHOT") {
        const waived = myTeam.some(mk =>
          ss.waivedByTeammateAttackTypes.includes(CONFIG.brawlerAttributes?.[norm(mk)]?.attackType));
        if (!waived) {
          score *= ss.scoreMultiplier;
          chips.push({ label: ss.label, tone: "bad" });
        }
      }
      const clearBonus = aRules.clearsSummons?.attackTypeBonus?.[attrs.attackType];
      if (clearBonus) {
        score += clearBonus;
        chips.push({ label: aRules.clearsSummons.label, tone: "good" });
      }
    }

    // Anti-synergy: a friendly wall breaker strips the team's OWN thrower's
    // cover. Symmetric (either side joining the other), exempt in Heist where
    // opening the safe lane is the point.
    const wbot = aRules.wallBreakOwnThrower;
    if (wbot && !(wbot.exemptModes || []).includes(mode)) {
      if ((candAbilities.includes("WALL_BREAK") && myClasses.includes("THROWER")) ||
          (cls === "THROWER" && myAbilities.has("WALL_BREAK"))) {
        score *= wbot.scoreMultiplier;
        chips.push({ label: wbot.label, tone: "bad" });
      }
    }

    // Scaler saturation: two late-game scaling kits concede the early map.
    const sat = aRules.scalerSaturation;
    if (sat && attrs?.scaler &&
        myTeam.some(mk => CONFIG.brawlerAttributes?.[norm(mk)]?.scaler)) {
      score *= sat.scoreMultiplier;
      chips.push({ label: sat.label, tone: "bad" });
    }

    // Utility saturation: in DPS-hungry objective modes a third utility-class
    // pick (support/thrower/control in any mix) loses the damage race.
    const us = aRules.utilitySaturation;
    if (us && us.modes.includes(mode) && us.classes.includes(cls) &&
        myClasses.filter(c => us.classes.includes(c)).length >= us.maxUtility) {
      score *= us.scoreMultiplier;
      chips.push({ label: us.label, tone: "bad" });
    }

    // ── Pro map rules (SpenLC) · map-specific requirements and biases ────────
    // Layered on top of the statistical core: each multiplier is a prior, so it
    // runs through dampPrior and halves once this brawler has a real sample on
    // the map. Ordered cheapest-signal-first so the chips read in priority order.
    if (mapRule.mode) {
      const dp = (m) => dampPrior(m, mapTWR != null, mapDamp);

      // Class-level map bias (e.g. Layer Cake hates early snipers), with an
      // exempt-slot escape so "no snipers except last pick" is expressible.
      const pen = mapRule.penalizeClasses?.[cls];
      if (pen && !(mapRule.penaltyExemptSlots || []).includes(pickSlot)) score *= dp(pen);
      const fav = mapRule.favorClasses?.[cls];
      if (fav) score *= dp(fav);

      // Named brawlers the pro calls out on this map.
      const favB = mapRule.favorBrawlers?.[key];
      if (favB) score *= dp(favB);

      // Wall break as a map-level win condition (open the lanes, deny the
      // spawn trap) rather than the generic ability synergy handled above.
      if (mapRule.wallBreakBonus && candAbilities.includes("WALL_BREAK")) {
        score *= dp(mapRule.wallBreakBonus);
        chips.push({ label: "Opens the map", tone: "good" });
      }

      // Team must field an enabling ability before a class is playable here.
      // The candidate counts toward satisfying it, so the wall breaker rises
      // rather than the sniper merely falling.
      if (rta && !teamHasRequiredAbility && rta.penalizeClasses.includes(cls) &&
          !candAbilities.some(a => rta.abilities.includes(a))) {
        score *= dp(rta.multiplier);
        chips.push({ label: rta.label, tone: "bad" });
      }

      // Class penalty waived by a teammate class (aggro needs a zone sitter).
      const cp = mapRule.conditionalPenalty;
      if (cp && cp.classes.includes(cls) &&
          !myClasses.some(c => cp.waivedByTeammateClasses.includes(c))) {
        score *= dp(cp.multiplier);
        chips.push({ label: cp.label, tone: "bad" });
      }

      // Comp mandate: penalize candidates that don't satisfy it, once the team
      // is running out of picks to satisfy it with.
      if (archetypeMissing && !archetype.classes.includes(cls)) {
        score *= dp(archetypeMult);
        chips.push({ label: archetype.label, tone: "bad" });
      }
    }

    // Named first-pick caution: a pro caveat for a brawler that is strong on the
    // map but exploitable as an early reveal. The TABLE IS EMPTY — see the config
    // note. Kept as a mechanism, but now expressed in win-rate points like every
    // other term rather than as a multiplier on the running score, and without
    // the old waivedIfBanned escape hatch: ban relief above answers that question
    // from measured pairings instead of a hand-listed name.
    const fpc = CONFIG.firstPickCaution?.[key];
    if (fpc && fpc.appliesToPickSlots?.includes(pickSlot)) {
      score -= dampPrior(fpc.penaltyPts ?? 0, mapTWR != null, mapDamp);
      if (fpc.label) chips.push({ label: fpc.label, tone: "bad" });
    }

    // Interception: this is the enemy's dream next pick and it works for us too.
    if (enemyTopKey && key === enemyTopKey) {
      score *= denial.scoreMultiplier;
      chips.push({ label: denial.label, tone: "good" });
    }

    // Counter-stack bonus — added AFTER mode weight so a mode that favours the
    // enemy's stacked class can't bury its hard counter (2 snipers → Mortis/Kit).
    if (stackedCounter) {
      score += (cons.counterStack.bonusPerEnemy ?? 9) * stackedCounter.count;
      chips.unshift({ label: `Counters ${stackedCounter.count}× ${classLabel(stackedCounter.cls)}`, tone: "good" });
    }

    // Thrower rule: never early without protection (Bobby), softer on passive
    // maps, and REDUCED rather than lifted at slot 5 (owner, 2026-08-30).
    // The rule bundles two risks that stop applying at different times. The
    // PROTECTION half is fully resolved by slot 5 — in the 1-2-2-1 order blue
    // holds slots 1/4/5, so slot 5 is blue's last pick and no frontline is
    // coming that waivedWithProtection has not already seen. The COUNTER-DRAFT
    // half is not: the enemy still holds slot 6. So slot 5 keeps the residual
    // enemyPicksRemaining/3 share (slotMultipliers 0.35) instead of dropping
    // straight to zero, which was a -14 cliff in one pick and a large part of
    // why throwers clustered at the top of pick-5 lists. Slot 6 stays at 0:
    // both risks are genuinely over there, which is what throwerLastPick pays.
    const tp = cons.throwerPenalty;
    const tpSlotMult = tp.slotMultipliers?.[String(pickSlot)] ??
      (tp.appliesToPickSlots.includes(pickSlot) ? 1 : 0);
    if (cls === "THROWER" && tpSlotMult > 0) {
      const protectedComp = tp.waivedWithProtection &&
        myClasses.some(c => tp.protectionClasses.includes(c));
      if (!protectedComp) {
        const mult = modeCfg.tempo === "passive" ? tp.passiveTempoMultiplier : 1;
        score += tp.penalty * mult * tpSlotMult;
        chips.push({ label: tpSlotMult < 1 ? "Thrower unprotected" : "Thrower too early", tone: "bad" });
      } else {
        why.push("thrower unlocked — your frontline protects it");
      }
    }

    // Thrower last-pick window: the enemy comp is done and brought no answer,
    // so the thrower is uncontested (Bobby's pick-6 out). The window is about
    // COUNTER-DRAFT risk being over — it is not a licence to throw into a comp
    // that already answers throwers, and it used to fire as though it were:
    // with three enemy space makers the card showed "Thrower window" next to
    // "Loses to their Kenji". Counters are read from the MEASURED matrix rather
    // than a hand-listed class, so the rule follows the data — today only
    // SPACE_MAKER clears the bar (+2.06 vs THROWER, the largest cell in the
    // matrix), which is exactly what the dose-response says: a thrower is
    // +2.89 win-rate points against a comp with no space maker, -2.06 against
    // one, -4.73 against two and -8.66 against three, over 332k games.
    // The MAGNITUDE of that is already priced by the class matrix itself
    // (-2.06 x adviceWeight 2.0 per space maker); this gate only stops the
    // BONUS and its chip from contradicting it.
    const tlp = ladder.throwerLastPick;
    if (cls === "THROWER" && tlp && pickSlot >= (tlp.minSlot ?? 5) &&
        (!tlp.requiresEnemyNoWallBreak || !enemyAbilities.has("WALL_BREAK"))) {
      const counterAt = tlp.counterEdgeThreshold ?? CONFIG.classCounter?.chipThreshold ?? 1;
      const answered = enemyClasses.filter(ec => matrixScore(ec, "THROWER") >= counterAt);
      // A CLASS gate alone is not enough, for the same reason the chips needed
      // one: the class matrix describes classes, not brawlers. Bolt is the
      // single best thrower counter in the game at +12.3 win-rate points, and
      // he is a TANK, where the class cell is -0.04 — so the class check waves
      // him straight through. Shelly (Anti-Tank, +5.7), Brock (Sniper, +5.5)
      // and Ash (Tank, +5.0) are the same story. Check the MEASURED pairing
      // too, at the threshold that already governs the "Loses to their X" chip,
      // so the window can never contradict a chip on its own card.
      const pairAt = tlp.counterPairPts ?? CONFIG.mapPairs?.chipEdgePts ?? 2.5;
      const answeredBy = enemyTeam.filter(ek =>
        -pairEdgeVs(key, ek, intelligence, mapPairs).edge >= pairAt);
      if (!answered.length && !answeredBy.length) {
        score += tlp.bonus;
        chips.push({ label: tlp.label, tone: "good" });
        why.push("no wall break on their side — your cover stays up");
      } else {
        const named = answeredBy.length
          ? answeredBy.map(fmtName).join(" / ")
          : answered.map(classLabel).join(" / ");
        why.push(`no thrower window — their ${named} already answers it`);
      }
    }

    // Support rules (Bobby): supports are reactive conditional modifiers.
    // Never in the first two picks unless a map meta-anchor; never without a
    // lane/aggro partner whose pressure the support amplifies.
    if (cls === "SUPPORT") {
      const early = supportRules.earlyPickPenalty;
      if (early?.appliesToPickSlots?.includes(pickSlot) &&
          !(mapTWR != null && mapTWR >= (early.waiverMinMapTrueWR ?? 99))) {
        score += early.penalty;
        chips.push({ label: early.label, tone: "bad" });
        why.push("supports are reactive — commit a lane first");
      }
      if (myTeam.length > 0 &&
          !myClasses.some(c => (supportRules.needsPartnerClasses || []).includes(c))) {
        score += supportRules.noPartnerPenalty ?? 0;
        chips.push({ label: supportRules.noPartnerLabel, tone: "bad" });
      }
      for (const combo of supportRules.combos || []) {
        if (norm(combo.brawler) !== key) continue;
        if (combo.modes && !combo.modes.includes(mode)) continue;
        if (combo.tempo && modeCfg.tempo !== combo.tempo) continue;
        if (combo.teammateClasses && !myClasses.some(c => combo.teammateClasses.includes(c))) continue;
        if (combo.enemyClasses && !enemyClasses.some(c => combo.enemyClasses.includes(c))) continue;
        score += combo.bonus;
        chips.push({ label: combo.label, tone: "good" });
      }
    }

    // Statistical significance (Bobby): a thin map sample marks a last-pick
    // specialist — demoted during slots 1-4, back to normal for picks 5-6.
    const lps = ladder.lastPickSpecialist;
    if (lps && lps.appliesToPickSlots.includes(pickSlot) && (!ms || ms.picks < lps.minMapPicks)) {
      score *= lps.multiplier;
    }

    // Class diversity: duplicates compound the 0.7x multiplier
    const dupes = myClasses.filter(c => c === cls).length;
    if (dupes > 0) {
      let dupMult = Math.pow(cons.classDiversity.duplicateMultiplier, dupes);
      // The stacking penalty is about counter-DRAFT exposure — one enemy pick
      // that answers your whole stack. With no enemy picks left there is no
      // such pick coming, so the penalty is relieved. Being countered by their
      // already-revealed comp is priced by PASS 2, and a structurally broken
      // comp is still caught by finalSanityCheck below.
      const relief = cons.classDiversity.noCounterDraftRelief ?? 0;
      const safeToStack = relief > 0 && enemyPicksRemaining === 0;
      if (safeToStack) dupMult = 1 - (1 - dupMult) * (1 - relief);
      score *= dupMult;
      chips.push(safeToStack
        ? { label: `${dupes + 1}× ${classLabel(cls)} · safe to stack`, tone: "good" }
        : { label: `${dupes + 1}× ${classLabel(cls)}`, tone: "bad" });
    }
    // Mode hard caps (e.g. Brawl Ball: max 1 control)
    const cap = modeCfg.maxPerClass?.[cls];
    if (cap != null && dupes >= cap) score *= 0.55;

    // Anti-tank foundation: best first pick in active/objective modes
    if (cls === "ANTI_TANK" && cons.antiTankFirstPick.appliesToPickSlots.includes(pickSlot) &&
        (!cons.antiTankFirstPick.activeTempoOnly || modeCfg.tempo === "active")) {
      score += cons.antiTankFirstPick.bonus;
      chips.push({ label: "Anti-tank foundation", tone: "good" });
      why.unshift("anti-tank foundation — the safest early commitment in objective modes");
    }

    // Space-maker window: slots 4-6 once the enemy comp is committed
    if (cls === "SPACE_MAKER" && cons.spaceMakerLateBonus.appliesToPickSlots.includes(pickSlot) &&
        (!cons.spaceMakerLateBonus.requiresEnemyCommitted || enemyTeam.length >= 2)) {
      score += cons.spaceMakerLateBonus.bonus;
      chips.push({ label: "Space maker window", tone: "good" });
      why.push("space-maker window — their comp is committed and can't answer the dive");
    }

    // ── PASS 5 · Composition scoring ──
    const before = finalSanityCheck(myTeam, mode);
    const after = finalSanityCheck([...myTeam, key], mode);
    let fixed = 0;
    if (!before.hasMid && after.hasMid) fixed++;
    if (!before.hasAnchor && after.hasAnchor) fixed++;
    if (!before.hasObjective && after.hasObjective) {
      fixed++;
      why.push(`gives you the ${CONFIG.roles.objectiveSpecialistLabel[mode] || "objective specialist"}`);
    }
    score += fixed * 4;
    if (myTeam.length === 2 && after.missing.length > 0) {
      score -= 8;
      chips.push({ label: `No ${after.missing[0]}`, tone: "bad" });
    }
    // Headline win rate: trust the map only when the sample is real; otherwise
    // fall back to the (large-sample) overall rate so a 25-game map WR never headlines.
    // mapGames/overallGames are reported SEPARATELY and always, so the card can
    // show the map sample next to the overall one — when those two disagree the
    // user needs to see it, and when the map sample is missing entirely that has
    // to be visible rather than quietly becoming an overall number.
    const overallGames = Number(intel?.picks) || 0;
    let displayWinRate = null, sampleGames = 0, sampleScope = null;
    const mapWinRate = mapPicks > 0 ? Math.round((ms.wins / mapPicks) * 1000) / 10 : null;
    // Headlining needs a bigger sample than SCORING does. Scoring runs the map
    // rate through trueWR's Bayesian shrink, so 41 games can contribute safely —
    // but the card prints raw wins/picks, and 41 games rendering as a confident
    // "53.7%" is noise presented as a map read. Below the headline threshold the
    // overall rate leads and the map sample still shows beside it.
    if (mapPicks >= Math.max(minMapPicks, mapPri.headlineMinMapPicks ?? 200)) {
      displayWinRate = mapWinRate;
      sampleGames = mapPicks; sampleScope = "map";
    } else if (intel) {
      displayWinRate = Math.round(parseFloat(intel.win_rate) * 10) / 10;
      sampleGames = overallGames; sampleScope = "overall";
    } else if (mapPicks > 0) {
      displayWinRate = mapWinRate;
      sampleGames = mapPicks; sampleScope = "map";
    }

    // Thin map evidence is FLAGGED, never penalised. Every exclusion rule was
    // measured and every one of them lost: a presence floor costs -0.0091 at 1%
    // and -0.0230 at 15%, and a minimum-map-games floor costs -0.0077 at 50
    // games — all significant on 23,772 held-out decisions. The reason is that
    // rare picks are not bad picks: the picks real Masters players made below
    // 1% presence won 51.6%, and below 50 map games 51.2%. A floor also cannot
    // tell the two cases apart — on Dry Season a 15% floor deletes Ash (0.56%
    // presence, 396 games, 58.1% on the map) along with Amber (0.20%, 144
    // games, 47.2%), and replaces both with Piper at 49.9%. What separates them
    // is how much we can believe the map reading, so say that instead of
    // pretending to know they are bad.
    const thinAt = mapPri.headlineMinMapPicks ?? 200;
    if (mapPicks > 0 && mapPicks < thinAt) {
      // Unproven HERE is a counter-draft risk, not a verdict: an Amber first
      // pick can be answered by the three picks still to come, while the same
      // Amber taken last — into a comp she already counters — cannot. So this
      // scales with enemyPicksRemaining exactly like counterability, and
      // disappears at the last pick.
      //
      // It is a PRIOR, not a fit, and cannot be otherwise: pick order is not
      // stored in ranked_matches, so early-vs-late is unmeasurable. (An earlier
      // attempt to measure it fabricated the order by withholding enemy picks
      // from the scorer, which tests information, not timing.) Kept modest for
      // that reason — at most thinMapPenaltyPts, against counterability's 14.
      //
      // What IS measured is that a flat floor is wrong in every form tried:
      // presence floors 1-15% cost -0.0091 to -0.0230, map-game floors 50-800
      // cost -0.0077 to -0.0158, all significant. Rare picks are not bad picks
      // (they won 51.6% below 1% presence), and a floor cannot separate Ash
      // (396 games, 58.1% on Dry Season) from Amber (144 games, 47.2%). Hence a
      // graded, fading penalty rather than a cut-off.
      // Two different things were being conflated here. "They can still answer
      // this" IS a counter-draft risk and correctly fades as the enemy runs out
      // of picks. "We do not know whether this works on this map" is a fact
      // about evidence quality and does NOT stop being true at pick 5 — but the
      // original form faded both to a third, which is how Larry & Lawrie (79
      // games, 40.5% on Center Stage) reached the top of a pick-5 list twelve
      // points above Bolt (1,674 games, 54.7%) on a map whose measured class fit
      // puts THROWER second-worst at -0.67 and TANK best at +1.08.
      //
      // So only thinMapFadeShare of it fades; the rest stands for the whole
      // draft. The presence floor is untouched and still lifts entirely at
      // pick 5, as specified.
      const deficit = 1 - mapPicks / thinAt;
      const fade = CONFIG.scoring?.thinMapFadeShare ?? 0.5;
      const slotFactor = (1 - fade) + fade * (enemyPicksRemaining / 3);
      score -= (CONFIG.scoring?.thinMapPenaltyPts ?? 8) * deficit * slotFactor;
      chips.push({ label: "Thin map read", tone: "bad" });
      why.push(`only ${mapPicks} games on this map — scored mostly on ${modeStats ? "mode" : "overall"} form`);
    }

    // matchupNote: one plain line answering "how good is this into their comp?"
    let matchupNote = null;
    if (enemyTeam.length > 0) {
      const noteMin = CONFIG.mapPairs?.noteMinEdgePts ?? 1.5;
      const noteMinGames = CONFIG.mapPairs?.noteMinGames ?? 300;
      if (stackedCounter) {
        matchupNote = `Hard-counters their ${stackedCounter.count}× ${classLabel(stackedCounter.cls)}`;
      } else if (matchupWinRate != null) {
        matchupNote = `${matchupWinRate}% vs this exact comp · ${matchupPicks} games`;
      // Comp-level head-to-head first — it is the line that literally answers
      // "how does this do against THEIR TEAM", rather than one duel from it.
      } else if (compPair && compPair.count >= 2 && Math.abs(compPair.mean) >= noteMin) {
        matchupNote = `${(50 + compPair.mean).toFixed(1)}% head-to-head into their comp · ${fmtGames(compPair.games)} games`;
      // A single pairing may only HEADLINE a raw percentage once its sample can
      // carry one. Shrinkage governs the score, but the card prints the raw
      // rate, and "58.3% vs their El Primo · 60 games" is the same noise-as-
      // evidence problem headlineMinMapPicks already solves for map rates. The
      // comp-level line above is exempt: it averages across the enemy team, so
      // it is not one thin duel being read as a fact.
      } else if (bestPair && bestPair.edge >= noteMin && bestPair.picks >= noteMinGames) {
        matchupNote = `${bestPair.winRate.toFixed(1)}% vs their ${bestPair.name} · ${bestPair.picks.toLocaleString("en-US")} games`;
      // The stop condition, made visible: Max looks great into snipers until
      // Brock is on the board, and the card should say so rather than go quiet.
      } else if (worstPair && worstPair.edge <= -noteMin && worstPair.picks >= noteMinGames) {
        matchupNote = `Loses to their ${worstPair.name} · ${worstPair.winRate.toFixed(1)}% over ${fmtGames(worstPair.picks)} games`;
      } else if (bestEdge >= 1.5 && bestCounterName) {
        matchupNote = `Strong into their ${bestCounterName}`;
      } else if (dataEdge != null && dataEdge >= 2) {
        matchupNote = `${(50 + dataEdge).toFixed(0)}% into their classes`;
      } else if (worstEdge <= -1.5 && worstCounterName) {
        matchupNote = `Loses lane to their ${worstCounterName}`;
      } else {
        matchupNote = "Even into their comp";
      }
    }

    candidates.push({
      key,
      name: fmtName(key),
      draftClass: cls,
      classLabel: classLabel(cls),
      ability: candAbility ? abilityLabel(candAbility) : null,
      score,
      winRate: displayWinRate,
      displayWinRate, sampleGames, sampleScope,
      mapGames: mapPicks, mapWinRate, overallGames,
      mapPresencePct: mapTotalMatches > 0 ? Math.round((mapPicks / mapTotalMatches) * 1000) / 10 : null,
      picks: mapPicks,
      matchupWinRate, matchupPicks, matchupNote,
      reasons: chips.slice(0, 2),
    });
  }

  // ── Final pick: rank by the verdict itself ──────────────────────────────
  // Every heuristic in the passes above exists to reason about what happens
  // NEXT — blind-pick safety, denial, leaving room for a counter. On the last
  // pick nothing happens next: the draft ends the moment this brawler is
  // locked. So the only correct objective is "which brawler leaves my side
  // ahead", and the honest way to rank that is to actually finish the draft
  // with each candidate and read the verdict.
  //
  // This also makes the two code paths agree BY CONSTRUCTION at the one slot
  // where they were most visibly contradicting each other: the engine was
  // recommending a sniper that graded out 44-56, while a hand-picked Edgar
  // graded 51-49. Ranking on the split can't disagree with the split.
  const isFinalPick = myTeam.length + enemyTeam.length >= 5 || pickSlot >= 6;
  if (isFinalPick && enemyTeam.length > 0) {
    // Ranking by the split means none of the score multipliers above reach this
    // slot — they only break exact ties. That is what let class theory pull in
    // brawlers with ~0.1% presence on the map: countering a class is worth real
    // points in the split, and nothing was checking whether the brawler is
    // actually played here. A pro's last pick answers the enemy comp AND is a
    // real pick on the map, so gate the pool on presence first and rank the
    // survivors by the verdict. Falls back to the full pool if the floor would
    // leave too little to choose from.
    const lp = mapPri.lastPick || {};
    const floor = lp.minPresencePct ?? 1.5;
    const eligible = mapTotalMatches > 0
      ? candidates.filter(c => (c.mapGames / mapTotalMatches) * 100 >= floor)
      : candidates;
    const ranked = eligible.length >= (lp.minCandidates ?? 12) ? eligible : candidates;

    for (const c of ranked) {
      const split = computeWinSplit({
        blueTeam: [...myTeam, c.key],   // symmetric — "blue" is just the picker
        redTeam: enemyTeam,
        mode, mapStats, intelligence, minMapPicks, modeStats, mapPairs,
      });
      c.projectedWin = split.blue;
      c._edge = split.rawEdge;
    }
    // Sort on the continuous differential; `score` only breaks exact ties.
    ranked.sort((a, b) => (b._edge - a._edge) || (b.score - a.score));
    candidates = ranked;
  } else {
    candidates.sort((a, b) => b.score - a.score);
  }

  // ── Presence floor (owner decision, 2026-08-30) ──────────────────────────
  // Brawlers played in less than minPresencePct of this map's games are pushed
  // behind everything that clears the bar, on the EARLY picks only. It lifts for
  // slots 5 and 6, where a niche answer is the point: by then the enemy comp is
  // essentially set and a specialist counter can no longer be counter-drafted.
  // Owner's reasoning: "just because they picked Brock there shouldn't be an
  // automatic Ash pick in bounty" — that risk is a first-half-of-the-draft
  // problem, which is why the slot list matches throwerPenalty's.
  //
  // THIS IS A PREFERENCE, NOT A MEASURED IMPROVEMENT, and the price is known.
  // Floors were tested four ways over 23,772 held-out decisions and every one
  // lost: presence 1% -0.0091, presence 15% -0.0230, min-50-games -0.0077,
  // graded 400->0 -0.0042, all significant. A 5% floor sits around -0.0126.
  // Rare picks are not bad picks — real picks below 1% presence won 51.6% —
  // and the floor cannot separate Ash on Dry Season (0.56% presence, 396 games,
  // 58.1%) from Amber (0.20%, 144 games, 47.2%); it removes both. Kept because
  // the owner asked for it twice with a clear rationale, after being shown the
  // cost. Set minPresencePct to 0 to turn it off.
  //
  // Never returns a short list: if the floor would leave fewer than topN, the
  // filtered-out brawlers are appended behind those that cleared it.
  const pf = CONFIG.mapPriority?.presenceFloor;
  const floorSlots = pf?.appliesToPickSlots ?? [1, 2, 3, 4];
  if (pf?.minPresencePct > 0 && mapTotalMatches > 0 && floorSlots.includes(pickSlot)) {
    const clears = (c) => {
      const ms2 = mapStats[norm(c.key)];
      return ((Number(ms2?.picks) || 0) / mapTotalMatches) * 100 >= pf.minPresencePct;
    };
    const keep = candidates.filter(clears);
    if (keep.length) candidates = [...keep, ...candidates.filter(c => !clears(c))];
  }

  // ── First pick: rank the MOST-PLAYED brawlers on this map by win rate ─────
  // With nothing revealed there is no matchup to solve, so the honest question
  // is "of the brawlers that actually get played here, which ones win". Take
  // the top `poolSize` by presence on this map, then order that pool by the
  // same blended win rate the score is built on.
  //
  // This is a PRESENTATION choice for slot 1, not an accuracy claim, and the
  // distinction matters: a use-rate term added to the SCORE was tested every
  // way and lost every time — linear, log and sqrt shapes at six weights each
  // all came out negative on 23,772 held-out decisions (-0.0007 to -0.0021,
  // every one significant), and so did presence used as a floor (-0.0012).
  // Popularity tracks what players pick, not what wins: on these maps only 27
  // of 42 most-picked brawlers are above 50%. So presence selects the POOL
  // here and win rate does the ranking; presence never adds points anywhere.
  const fpo = CONFIG.mapPriority?.firstPick?.orderByWinRate;
  if (fpo?.enabled && pickSlot === 1 && enemyTeam.length === 0 && myTeam.length === 0) {
    const presenceOf = (c) => {
      const ms = mapStats[norm(c.key)];
      return mapTotalMatches > 0 ? (Number(ms?.picks) || 0) / mapTotalMatches : 0;
    };
    // poolSize is the WHOLE rule: take exactly this many most-played brawlers
    // and re-order them by win rate. At 7 the list IS "the seven most-picked on
    // this map, best win rate first" — nothing outside that seven can appear,
    // however well it performs, because a brawler nobody picks here is not a
    // first pick. Raising it lets a rarer but stronger brawler in: on Gem Fort
    // Bolt (59.6%, 5,852 games) is the 27th most-picked, so he is absent at 7
    // or 20 and leads the list at 30.
    const pool = [...candidates]
      .sort((a, b) => presenceOf(b) - presenceOf(a))
      .slice(0, fpo.poolSize ?? 7)
      .filter(c => presenceOf(c) >= (fpo.minPresencePct ?? 3) / 100);
    // Exceptional performers are admitted even when they are not among the most
    // picked, because "nobody has caught on yet" is not a reason to hide a
    // brawler winning 62% of 8,671 games. Gated on the SHRUNK rate and a
    // presence floor, not a raw threshold: a flat cut lets a 200-game fluke in
    // and drops a 59.9% staple, while the shrunk rate barely moves a
    // four-figure sample and pulls a thin one hard toward even.
    const exWR = fpo.exceptionalWinRate, exPres = fpo.exceptionalMinPresencePct ?? 5;
    if (exWR) {
      const inPool = new Set(pool.map(c => c.key));
      for (const c of candidates) {
        if (inPool.has(c.key)) continue;
        if (presenceOf(c) * 100 < exPres) continue;
        if (c.sampleScope !== "map") continue;          // must be a real map read
        if ((c.displayWinRate ?? 0) >= exWR) pool.push(c);
      }
    }
    if (pool.length >= 2) {
      pool.sort((a, b) => (b.displayWinRate ?? b.winRate ?? 0) - (a.displayWinRate ?? a.winRate ?? 0));
      const seen = new Set(pool.map(c => c.key));
      candidates = [...pool, ...candidates.filter(c => !seen.has(c.key))];
    }
  }
  return {
    suggestions: candidates.slice(0, topN),
    topThreatClass,
    // Advisory only — never scored. mapNote is the pro's one-line read on the
    // map; banSuggestions are the picks they open by removing (filtered to
    // whatever is still on the board).
    mapNote: mapRule.note ?? null,
    banSuggestions: (mapRule.banSuggestions || []).filter(b => !used.has(norm(b))),
  };
}

// ── Draft-complete win split ─────────────────────────────────────────────────
// Comp score per side = statistical strength + cross-team counter pressure +
// synergy + structure. The differential runs through a logistic squash and is
// capped (no draft is ever 90-10 — execution still exists). Always sums to 100.
// ── Ban advice ───────────────────────────────────────────────────────────────
// Which brawlers to ban depends entirely on WHERE YOU PICK, and this is the one
// piece of draft theory the old list ignored — it showed the six strongest
// brawlers on the map to both teams.
//
// That's actively wrong for the team picking first. Banning the best brawler in
// the game when you hold first pick throws the ban away: you could simply have
// taken him. What a first-picker cannot control is the enemy's LAST pick, which
// sees the whole revealed comp and answers it — so those counter threats are
// what they should be removing. The team picking last has the opposite problem:
// the enemy opens on the best brawler and they will never get him, so denying
// the meta openers is exactly right.
//
// firstPickSafety (draftMeta) is the discriminator. High = hard to punish, safe
// to reveal early, therefore the brawler that gets first-picked. Low = wins come
// from favourable matchups, therefore a last-pick counter threat.
export function getBanAdvice({
  mapName = null,
  banningTeamPicksFirst,      // true if the team choosing this ban also picks first
  mapStats = {},
  intelligence = {},
  unavailable = [],           // already banned or picked — kept, but marked used
  topN = 6,
  minMapPicks = 30,
}) {
  const cfg = CONFIG.banStrategy || {};
  const deny = cfg.denyOpeners || {};
  const protect = cfg.protectFromCounters || {};
  const used = new Set(unavailable.map(norm));
  const ineligible = new Set((CONFIG.rankedIneligible?.keys || []).map(norm));
  const mapRule = lookupByMap(CONFIG.mapRules, mapName) || {};
  const proBans = new Set((mapRule.banSuggestions || []).map(norm));

  const mapTotalPicks = Object.values(mapStats).reduce((a, s) => a + (Number(s?.picks) || 0), 0);
  const mapTotalMatches = mapTotalPicks > 0 ? mapTotalPicks / 6 : 0;
  const floor = cfg.minPresencePct ?? 1.5;

  const rows = [];
  for (const key of new Set([...Object.keys(mapStats), ...Object.keys(intelligence)].map(norm))) {
    if (ineligible.has(key)) continue;
    const ms = mapStats[key];
    const intel = intelligence[key];
    const mapPicks = Number(ms?.picks) || 0;
    if (!mapPicks && !intel) continue;
    // A brawler nobody plays here isn't worth a ban, same floor as the last pick.
    const presencePct = mapTotalMatches > 0 ? (mapPicks / mapTotalMatches) * 100 : 0;
    if (mapTotalMatches > 0 && presencePct < floor) continue;

    const mapTWR = mapPicks >= minMapPicks ? trueWR(ms.wins, mapPicks) : null;
    const strength = blendMapGlobal(mapPicks, mapTWR, recencyTWR(intel));
    // Only brawlers actually above par are worth a ban slot.
    const edge = strength - 50;
    if (edge <= 0) continue;

    const safety = getDraftProfile(key).firstPickSafety;   // 0..1
    const openerScore  = edge * ((deny.safetyBase ?? 0.7) + (deny.safetyBias ?? 0.6) * safety);
    const counterScore = edge * ((protect.counterBase ?? 0.5) + (protect.counterBias ?? 1.0) * (1 - safety));

    rows.push({
      key, name: fmtName(key),
      winRate: mapPicks >= minMapPicks
        ? Math.round((ms.wins / mapPicks) * 1000) / 10
        : (intel ? Math.round(parseFloat(intel.win_rate) * 10) / 10 : null),
      mapGames: mapPicks,
      presencePct: Math.round(presencePct * 10) / 10,
      safety, openerScore, counterScore,
      isPro: proBans.has(key),
      used: used.has(key),
    });
  }

  // The brawlers this team would realistically OPEN on. Never recommend banning
  // your own first pick — that is the whole point of the rule.
  const ownOpeners = new Set(
    [...rows].sort((a, b) => b.openerScore - a.openerScore)
      .slice(0, protect.skipTopOpeners ?? 2).map(r => r.key));

  const mode = banningTeamPicksFirst ? protect : deny;
  let ranked;
  if (banningTeamPicksFirst) {
    // Drop the safe openers entirely. A brawler this team can simply TAKE with
    // the first pick is never worth a ban slot — that's the Surge case: he's the
    // best brawler on the map, which is exactly why you pick him instead of
    // banning him. Down-weighting wasn't enough; a high enough win rate still
    // carried openers into the list.
    const maxSafety = protect.maxOpenerSafety ?? 0.78;
    ranked = rows.filter(r => !ownOpeners.has(r.key) && r.safety < maxSafety)
                 .sort((a, b) => b.counterScore - a.counterScore);
  } else {
    ranked = [...rows].sort((a, b) => b.openerScore - a.openerScore);
  }

  return {
    headline: mode.headline || null,
    picksFirst: !!banningTeamPicksFirst,
    // Pro-authored bans for the map still ride along as a flag, not a re-sort.
    bans: ranked.slice(0, topN).map(r => ({
      key: r.key, name: r.name, winRate: r.winRate,
      mapGames: r.mapGames, presencePct: r.presencePct, used: r.used,
      reason: r.isPro ? (cfg.proBanReason || "Pro priority ban") : (mode.reason || null),
      isPro: r.isPro,
    })),
  };
}

export function computeWinSplit({ blueTeam, redTeam, mode, mapStats = {}, intelligence = {}, minMapPicks = 30, modeStats = null, mapPairs = null }) {
  const strength = (teamKeys, enemyKeys) => {
    const classes = teamKeys.map(draftClassOf);
    const enemyCls = enemyKeys.map(draftClassOf);

    // Statistical core — the SAME blend getDraftAdvice ranks with, so the two
    // can't disagree about a brawler's strength (see blendMapGlobal).
    const rates = teamKeys.map(k => {
      const ms = mapStats[norm(k)];
      const mapPicks = Number(ms?.picks) || 0;
      const mapTWR = mapPicks >= minMapPicks ? trueWR(ms.wins, mapPicks) : null;
      return blendMapGlobal(mapPicks, mapTWR, modeOrGlobalTWR(
        modeStats, k, recencyTWR(intelligence[norm(k)]), CONFIG.mapPriority?.modeFallbackMinPicks));
    });
    let s = rates.reduce((a, v) => a + v, 0) / Math.max(1, rates.length);

    // Counter pressure across all 9 pairings (per-brawler overrides honored).
    // counterWeight is deliberately half the intuitive value — the matrix is
    // antisymmetric, so this term enters the final differential twice (once as
    // +x for one side, once as -x for the other). See winProbability config.
    const cw = CONFIG.winProbability.counterWeight ?? 0.6;
    for (let i = 0; i < teamKeys.length; i++)
      for (let j = 0; j < enemyKeys.length; j++)
        s += pairEdge(teamKeys[i], classes[i], enemyKeys[j], enemyCls[j]) * cw;

    // Measured head-to-head across the same 9 cross-team pairings — the SAME
    // helper getDraftAdvice ranks with, so the two cannot disagree about who
    // the matchup favours.
    //
    // This term did not exist before, and its absence was a real hole: the last
    // pick is ranked by THIS function's rawEdge, while brawler-vs-brawler win
    // rates were only ever read by getDraftAdvice. So in the one slot that is
    // purely about answering the enemy comp, the ranker was blind to whether a
    // candidate actually beats them.
    //
    // A MEAN, not a sum, and splitWeight is HALF the intuitive value — both for
    // the counterWeight reason directly above. pairEdgeVs is antisymmetric, so
    // red's total is the negation of blue's and the differential counts every
    // pairing twice. Summing instead of averaging would let one brawler's three
    // good matchups swing the verdict ~20 points through logisticScale.
    const pw = CONFIG.mapPairs?.splitWeight ?? 0.6;
    let pairPts = 0, pairN = 0;
    for (const mine of teamKeys)
      for (const foe of enemyKeys) { pairPts += pairEdgeVs(mine, foe, intelligence, mapPairs).edge; pairN++; }
    if (pairN) s += (pairPts / pairN) * pw;

    // Measured teammate synergy. The hand-authored class table that used to sit
    // here could not move anything (removing it changed AUC by 0.0000); this
    // replaces it with real duo data and is the single largest improvement
    // found in the calibration pass, +0.0102 AUC held out.
    s += teamSynergy(teamKeys, intelligence) * (CONFIG.duoSynergy?.weight ?? 2.4);

    const sanity = finalSanityCheck(teamKeys, mode);
    s -= sanity.missing.length * 3;

    // Diversity: each duplicate class bleeds points ("three control brawlers
    // are all countered by one aggro")
    const counts = {};
    for (const c of classes) counts[c] = (counts[c] || 0) + 1;
    for (const n of Object.values(counts)) if (n > 1) s -= (n - 1) * 3;

    return { score: s, sanity };
  };

  const blue = strength(blueTeam, redTeam);
  const red = strength(redTeam, blueTeam);
  const { logisticScale, capPct } = CONFIG.winProbability;
  const raw = 100 / (1 + Math.exp(-(blue.score - red.score) / logisticScale));
  const bluePct = Math.min(capPct, Math.max(100 - capPct, Math.round(raw)));
  return {
    blue: bluePct,
    red: 100 - bluePct,
    winner: bluePct === 50 ? "even" : bluePct > 50 ? "blue" : "red",
    blueSanity: blue.sanity,
    redSanity: red.sanity,
    // Continuous, uncapped, unrounded differential. `blue` is rounded to a whole
    // percent and clamped to 85/15, so dozens of candidates tie on it — the
    // final-pick ranker sorts on this instead to keep a strict ordering.
    rawEdge: blue.score - red.score,
  };
}

// ── Lane matchups ────────────────────────────────────────────────────────────
// Which of your brawlers ends up opposite which of theirs, and who wins that
// pairing.
//
// A 3v3 draft resolves into a mid and two sides. The API exposes no positional
// data whatsoever, so a lane is INFERRED from how a brawler wants to hold
// ground: range first — a Long brawler owns the middle sightline, a Short one
// has to work the flanks — then draft class, which separates brawlers that
// share a range band. This is a model of the most likely formation, not an
// observation, and the UI is required to say so.
//
// The pairing is deliberately NOT optimised. Sorting both teams by the same
// affinity and pairing rank-for-rank is the one assignment that cannot flatter
// either side; choosing pairs to maximise or minimise your edge would invent a
// result the draft does not contain.

const MID_PULL_BY_RANGE = { Long: 2.0, Mid: 1.0, Short: 0 };
const MID_PULL_BY_CLASS = {
  SNIPER: 1.0,      // holds the long sightline the middle lane is built around
  THROWER: 0.8,     // sits behind mid cover and denies the choke
  CONTROL: 0.6,
  SUPPORT: 0.2,
  ANTI_TANK: 0.0,
  SPACE_MAKER: -0.8, // wants a flank to jump from
  TANK: -1.0,        // walks a side lane into the enemy back line
};

const midAffinity = (key) => {
  const attrs = CONFIG.brawlerAttributes?.[norm(key)] || {};
  return (MID_PULL_BY_RANGE[attrs.range] ?? 1) + (MID_PULL_BY_CLASS[draftClassOf(key)] ?? 0);
};

// Mid first, then the two flanks. Ties break on the key so one draft always
// renders the same lanes rather than shuffling between renders.
const laneOrder = (team) =>
  [...team].sort((a, b) => midAffinity(b) - midAffinity(a) || norm(a).localeCompare(norm(b)));

// Where each pick stands on the map, for a PARTIAL or a complete team. Uses the
// same midAffinity ordering getLaneMatchups ranks with, so the board on the map
// and the lane-matchup cards can never disagree about who is holding mid.
//
// Lanes are shared, not mirrored: the left lane is the left lane for both teams,
// which is exactly the pairing getLaneMatchups assumes when it matches mine[i]
// against theirs[i]. Placement is recomputed from the whole team on every pick,
// so a brawler can move once a stronger mid presence arrives — that is honest,
// because the lane a comp wants genuinely depends on the rest of the comp.
export function assignLanes(team = []) {
  const ordered = laneOrder(team.filter(Boolean).map(norm));
  return { mid: ordered[0] ?? null, left: ordered[1] ?? null, right: ordered[2] ?? null };
}

export function getLaneMatchups({ myTeam = [], enemyTeam = [], intelligence = {} }) {
  const mine = laneOrder(myTeam.filter(Boolean).map(norm));
  const theirs = laneOrder(enemyTeam.filter(Boolean).map(norm));
  if (mine.length !== 3 || theirs.length !== 3) return [];

  const prior = CONFIG.mapPairs?.shrinkPriorGames ?? 135;
  const minPicks = CONFIG.statisticalCoefficients?.pairMinPicks ?? 20;

  const lanes = mine.map((me, i) => {
    const foe = theirs[i];
    const v = intelligence[me]?.vs_brawler?.[foe];
    const n = Number(v?.picks) || 0;
    const raw = parseFloat(v?.winRate);

    if (n > 0 && Number.isFinite(raw)) {
      // Shrunk toward even by sample, the same way every other pair term in
      // this engine is. A 12-game edge must not read like a 600-game one.
      return {
        lane: i === 0 ? "Mid" : "Side",
        mine: me, enemy: foe,
        winRate: 50 + (raw - 50) * (n / (n + prior)),
        rawWinRate: raw, games: n,
        basis: "head-to-head",
        state: n >= minPicks ? "measured" : "thin",
      };
    }

    // No head-to-head sample. Fall back to the gap between the two brawlers'
    // overall rates, HALVED: a solo win rate is already measured against the
    // whole field, so carrying the full gap into a single pairing overstates
    // it. Labelled as a different basis so the UI never presents this as a
    // measured matchup.
    const a = recencyTWR(intelligence[me]), b = recencyTWR(intelligence[foe]);
    if (a == null || b == null) {
      return { lane: i === 0 ? "Mid" : "Side", mine: me, enemy: foe,
               winRate: null, rawWinRate: null, games: 0, basis: "none", state: "none" };
    }
    return {
      lane: i === 0 ? "Mid" : "Side",
      mine: me, enemy: foe,
      winRate: 50 + (a - b) / 2,
      rawWinRate: null, games: 0,
      basis: "overall", state: "inferred",
    };
  });

  // Display order puts the mid in the middle, as the lane actually sits.
  return [lanes[1], lanes[0], lanes[2]];
}
