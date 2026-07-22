// ─── BrawlMeta Intelligence Engine ───────────────────────────────────────────
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
import { blindPickFactor, blindPickLabel } from "./draftMeta";

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
export const abilityOf = (key) => CONFIG.brawlerAbilities?.[norm(key)] || null;
export const abilityLabel = (code) => CONFIG.abilityLabels?.[code] || code;

// ── Shared helpers ───────────────────────────────────────────────────────────
const PRIOR = CONFIG.statisticalCoefficients.confidencePriorGames;

// Bayesian shrink toward 50%: tiny samples can't fake a monster win rate.
const trueWR = (wins, picks, prior = PRIOR) =>
  picks + prior === 0 ? 50 : ((wins + prior * 0.5) / (picks + prior)) * 100;

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
  norm(key).toLowerCase().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

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
  topN = 3,
  minMapPicks = 30,
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
  const cons = CONFIG.constraints;

  // Phase-specific drafting (counter-ladder): how hard counter evidence weighs
  // scales with the pick slot — anchor phase (1-2) is stats-led, late picks
  // (5-6) are hard-counter execution. Ability tags feed the wall-break rules.
  const abilityRules = CONFIG.abilityRules || {};
  const supportRules = CONFIG.supportRules || {};
  const ladder = CONFIG.counterLadder || {};
  const slotCounterW = ladder.counterWeightBySlot?.[String(pickSlot)] ?? 1;
  const myAbilities = new Set(myTeam.map(abilityOf).filter(Boolean));
  const enemyAbilities = new Set(enemyTeam.map(abilityOf).filter(Boolean));
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
      topN: 1, minMapPicks, _noDenial: true,
    });
    enemyTopKey = enemyView.suggestions[0]?.key ?? null;
  }

  const candidates = [];
  const pool = new Set([...Object.keys(mapStats), ...Object.keys(intelligence)].map(norm));

  for (const key of pool) {
    if (used.has(key)) continue;
    const ms = mapStats[key];
    const intel = intelligence[key];
    if ((!ms || ms.picks < minMapPicks) && !intel) continue;

    const cls = draftClassOf(key);
    const candAbility = abilityOf(key);
    const chips = [];       // short UI badges [{label, tone}]
    const why = [];         // rationale fragments, priority-ordered

    // ── PASS 1 · Statistical: true win rate + coefficient flags ──
    const mapTWR = ms && ms.picks >= minMapPicks ? trueWR(ms.wins, ms.picks) : null;
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

    let score = mapTWR != null && globalTWR != null
      ? mapTWR * 0.65 + globalTWR * 0.35
      : (mapTWR ?? globalTWR ?? 50);

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
    let bestPair = null;                 // { name, winRate, picks } best-sampled brawler-vs-brawler edge
    let bestEdge = 0, bestCounterName = null;   // strongest class edge we have
    let worstEdge = 0, worstCounterName = null; // worst class matchup we're in
    let stackedCounter = null;           // { cls, count } enemy class we hard-counter and they stacked
    if (enemyTeam.length === 0) {
      score *= blindPickFactor(key);
      const bl = blindPickLabel(key);
      if (bl) chips.push(bl);
      if (bl?.tone === "bad") why.push("risky reveal — wins come from favorable matchups");
    }
    if (enemyTeam.length > 0) {
      // Theory: class counter matrix
      let matrixPts = 0;
      for (let i = 0; i < enemyTeam.length; i++) {
        const edge = pairEdge(key, cls, enemyTeam[i], enemyClasses[i]);
        matrixPts += edge;
        if (edge > bestEdge) { bestEdge = edge; bestCounterName = fmtName(enemyTeam[i]); }
        if (edge < worstEdge) { worstEdge = edge; worstCounterName = fmtName(enemyTeam[i]); }
        if (edge >= 1.5) {
          chips.push({ label: `Counters ${fmtName(enemyTeam[i])}`, tone: "good" });
          why.push(`${classLabel(cls)} answer to their ${fmtName(enemyTeam[i])}`);
        } else if (edge <= -1.5) {
          chips.push({ label: `Weak vs ${fmtName(enemyTeam[i])}`, tone: "bad" });
        }
      }
      score += matrixPts * 2.2 * slotCounterW;

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
      if (intel?.vs_brawler) {
        const pairs = enemyTeam
          .map(ek => ({ name: fmtName(ek), v: intel.vs_brawler[norm(ek)] }))
          .filter(p => p.v && p.v.picks >= 100);
        if (pairs.length) {
          const pe = pairs.reduce((a, p) => a + (parseFloat(p.v.winRate) - 50), 0) / pairs.length;
          score += pe * 0.8 * slotCounterW;
          const best = pairs.reduce((a, p) => (p.v.picks > a.v.picks ? p : a));
          bestPair = { name: best.name, winRate: parseFloat(best.v.winRate), picks: best.v.picks };
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
    if (candAbility === "WALL_BREAK") {
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

    // ── Teammate synergy · empirical duo win rate with already-locked mates ──
    if (myTeam.length > 0 && intel?.with_brawler) {
      for (const mk of myTeam) {
        const v = intel.with_brawler[norm(mk)];
        if (!v || v.picks < 50) continue;
        const duoEdge = parseFloat(v.winRate) - 50;
        score += duoEdge * 0.5;
        if (duoEdge >= 3) chips.push({ label: `Duos with ${fmtName(mk)}`, tone: "good" });
        else if (duoEdge <= -3) chips.push({ label: `Weak duo with ${fmtName(mk)}`, tone: "bad" });
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
    score *= modeCfg.classWeights?.[cls] ?? 1;

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
          (myAbilities.has("WALL_BREAK") || candAbility === "WALL_BREAK")) {
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
      if ((candAbility === "WALL_BREAK" && myClasses.includes("THROWER")) ||
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
      if (mapRule.wallBreakBonus && candAbility === "WALL_BREAK") {
        score *= dp(mapRule.wallBreakBonus);
        chips.push({ label: "Opens the map", tone: "good" });
      }

      // Team must field an enabling ability before a class is playable here.
      // The candidate counts toward satisfying it, so the wall breaker rises
      // rather than the sniper merely falling.
      if (rta && !teamHasRequiredAbility && rta.penalizeClasses.includes(cls) &&
          !rta.abilities.includes(candAbility)) {
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

    // Named first-pick caution: strong on the map but exploitable as an early
    // reveal, unless the specific answer is already banned off the board.
    const fpc = CONFIG.firstPickCaution?.[key];
    if (fpc && fpc.appliesToPickSlots.includes(pickSlot) &&
        !(fpc.waivedIfBanned || []).some(b => bannedSet.has(norm(b)))) {
      score *= dampPrior(fpc.multiplier, mapTWR != null, mapDamp);
      chips.push({ label: fpc.label, tone: "bad" });
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

    // Thrower rule: never early without protection (Bobby), softer on passive maps
    if (cls === "THROWER" && cons.throwerPenalty.appliesToPickSlots.includes(pickSlot)) {
      const protectedComp = cons.throwerPenalty.waivedWithProtection &&
        myClasses.some(c => cons.throwerPenalty.protectionClasses.includes(c));
      if (!protectedComp) {
        const mult = modeCfg.tempo === "passive" ? cons.throwerPenalty.passiveTempoMultiplier : 1;
        score += cons.throwerPenalty.penalty * mult;
        chips.push({ label: "Thrower too early", tone: "bad" });
      } else {
        why.push("thrower unlocked — your frontline protects it");
      }
    }

    // Thrower last-pick window: the enemy comp is done and brought no wall
    // break to strip its cover — the thrower is uncontested (Bobby's pick-6 out).
    const tlp = ladder.throwerLastPick;
    if (cls === "THROWER" && tlp && pickSlot >= (tlp.minSlot ?? 5) &&
        (!tlp.requiresEnemyNoWallBreak || !enemyAbilities.has("WALL_BREAK"))) {
      score += tlp.bonus;
      chips.push({ label: tlp.label, tone: "good" });
      why.push("no wall break on their side — your cover stays up");
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
      score *= Math.pow(cons.classDiversity.duplicateMultiplier, dupes);
      chips.push({ label: `${dupes + 1}× ${classLabel(cls)}`, tone: "bad" });
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
    for (const mate of myClasses) score += synergyScore(cls, mate) * 2;

    // Headline win rate: trust the map only when the sample is real; otherwise
    // fall back to the (large-sample) overall rate so a 25-game map WR never headlines.
    let displayWinRate = null, sampleGames = 0, sampleScope = null;
    if (ms && ms.picks >= minMapPicks) {
      displayWinRate = Math.round((ms.wins / ms.picks) * 1000) / 10;
      sampleGames = ms.picks; sampleScope = "map";
    } else if (intel) {
      displayWinRate = Math.round(parseFloat(intel.win_rate) * 10) / 10;
      sampleGames = Number(intel.picks) || 0; sampleScope = "overall";
    } else if (ms && ms.picks > 0) {
      displayWinRate = Math.round((ms.wins / ms.picks) * 1000) / 10;
      sampleGames = ms.picks; sampleScope = "map";
    }

    // matchupNote: one plain line answering "how good is this into their comp?"
    let matchupNote = null;
    if (enemyTeam.length > 0) {
      if (stackedCounter) {
        matchupNote = `Hard-counters their ${stackedCounter.count}× ${classLabel(stackedCounter.cls)}`;
      } else if (matchupWinRate != null) {
        matchupNote = `${matchupWinRate}% vs this exact comp · ${matchupPicks} games`;
      } else if (bestPair && Math.abs(bestPair.winRate - 50) >= 1.5) {
        matchupNote = `${bestPair.winRate.toFixed(1)}% vs their ${bestPair.name} · ${bestPair.picks.toLocaleString("en-US")} games`;
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
      picks: ms?.picks ?? 0,
      matchupWinRate, matchupPicks, matchupNote,
      reasons: chips.slice(0, 2),
    });
  }

  candidates.sort((a, b) => b.score - a.score);
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
export function computeWinSplit({ blueTeam, redTeam, mode, mapStats = {}, intelligence = {} }) {
  const strength = (teamKeys, enemyKeys) => {
    const classes = teamKeys.map(draftClassOf);
    const enemyCls = enemyKeys.map(draftClassOf);

    // Statistical core: blended true win rates
    const rates = teamKeys.map(k => {
      const ms = mapStats[norm(k)];
      const intel = intelligence[norm(k)];
      const mapTWR = ms && ms.picks >= 20 ? trueWR(ms.wins, ms.picks) : null;
      const gTWR = intel ? parseFloat(intel.true_win_rate) : null;
      return mapTWR != null && gTWR != null ? mapTWR * 0.6 + gTWR * 0.4 : (mapTWR ?? gTWR ?? 50);
    });
    let s = rates.reduce((a, v) => a + v, 0) / Math.max(1, rates.length);

    // Counter pressure across all 9 pairings (per-brawler overrides honored)
    for (let i = 0; i < teamKeys.length; i++)
      for (let j = 0; j < enemyKeys.length; j++)
        s += pairEdge(teamKeys[i], classes[i], enemyKeys[j], enemyCls[j]) * 1.2;

    // Synergy + structure
    for (let i = 0; i < classes.length; i++)
      for (let j = i + 1; j < classes.length; j++)
        s += synergyScore(classes[i], classes[j]);

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
  };
}
