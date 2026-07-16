// ─── BrawlMeta Intelligence Engine ───────────────────────────────────────────
// The 5-pass draft advisor. Combines three intelligence layers:
//   • live per-map match data          (mapStats / matchupStats — from useMapMatches)
//   • daily statistical intelligence   (brawler_intelligence table — true win
//     rates, popularity-trap / broken / inflation flags, per-class matchup WRs)
//   • Bobby's draft framework          (draft_logic_config.json — counter
//     triangle, active/passive tempo, thrower rules, 1-mid + 2-lane structure)
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

// ── Shared helpers ───────────────────────────────────────────────────────────
const PRIOR = CONFIG.statisticalCoefficients.confidencePriorGames;

// Bayesian shrink toward 50%: tiny samples can't fake a monster win rate.
const trueWR = (wins, picks, prior = PRIOR) =>
  picks + prior === 0 ? 50 : ((wins + prior * 0.5) / (picks + prior)) * 100;

const matrixScore = (myClass, enemyClass) =>
  CONFIG.counterMatrix[myClass]?.[enemyClass] ?? 0;

const synergyScore = (a, b) =>
  CONFIG.synergyPairs[`${a}+${b}`] ?? CONFIG.synergyPairs[`${b}+${a}`] ?? 0;

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
  pickSlot,             // global pick about to be made, 1..6
  myTeam = [],          // my revealed picks (brawler keys)
  enemyTeam = [],       // enemy revealed picks (brawler keys)
  unavailable = [],     // picked or banned keys
  mapStats = {},        // { KEY: {picks, wins} } for this map+bracket
  matchupStats = {},    // { KEY: {picks, wins} } empirical vs this exact enemy set
  intelligence = {},    // { KEY: brawler_intelligence row }
  topN = 3,
  minMapPicks = 30,
}) {
  const modeCfg = CONFIG.modes[mode] || { tempo: "active", classWeights: {}, maxPerClass: {} };
  const myClasses = myTeam.map(draftClassOf);
  const enemyClasses = enemyTeam.map(draftClassOf);
  const enemyPicksRemaining = 3 - enemyTeam.length;
  // How many of each class the enemy has committed — drives the counter-stack rule.
  const enemyClassCounts = {};
  for (const c of enemyClasses) enemyClassCounts[c] = (enemyClassCounts[c] || 0) + 1;
  const used = new Set([...myTeam, ...enemyTeam, ...unavailable].map(norm));
  const coeff = CONFIG.statisticalCoefficients;
  const cons = CONFIG.constraints;

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

  const candidates = [];
  const pool = new Set([...Object.keys(mapStats), ...Object.keys(intelligence)].map(norm));

  for (const key of pool) {
    if (used.has(key)) continue;
    const ms = mapStats[key];
    const intel = intelligence[key];
    if ((!ms || ms.picks < minMapPicks) && !intel) continue;

    const cls = draftClassOf(key);
    const chips = [];       // short UI badges [{label, tone}]
    const why = [];         // rationale fragments, priority-ordered

    // ── PASS 1 · Statistical: true win rate + coefficient flags ──
    const mapTWR = ms && ms.picks >= minMapPicks ? trueWR(ms.wins, ms.picks) : null;
    const globalTWR = intel ? parseFloat(intel.true_win_rate) : null;
    let score = mapTWR != null && globalTWR != null
      ? mapTWR * 0.65 + globalTWR * 0.35
      : (mapTWR ?? globalTWR ?? 50);

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
        const edge = matrixScore(cls, enemyClasses[i]);
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
      score += matrixPts * 2.2;

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
          score += dataEdge * 0.6;
          if (dataEdge >= 2.5) why.push(`${(50 + dataEdge).toFixed(1)}% into their classes historically`);
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
      score,
      winRate: displayWinRate,
      displayWinRate, sampleGames, sampleScope,
      picks: ms?.picks ?? 0,
      matchupWinRate, matchupPicks, matchupNote,
      reasons: chips.slice(0, 2),
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return { suggestions: candidates.slice(0, topN), topThreatClass };
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

    // Counter pressure across all 9 pairings
    for (const mine of classes)
      for (const theirs of enemyCls)
        s += matrixScore(mine, theirs) * 1.2;

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
