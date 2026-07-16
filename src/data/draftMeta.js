// ─── Draft intelligence metadata ─────────────────────────────────────────────
// Encodes what raw win rates can't see: HOW a brawler wins, and therefore when
// it's safe to pick. A brawler like Edgar can hold a 60% win rate and still be
// a terrible first pick, because his wins come from favorable matchups — if
// the enemy picks after you, they simply answer him. The draft assistant
// combines this with live win-rate data:
//   • blind picks (enemy team unknown) weight toward hard-to-punish picks
//   • reactive picks weight toward class counters of revealed enemy picks
//
// All of this is editable, class defaults cover every brawler; the override
// tables refine specific well-known cases.

import BRAWLER_META from "./brawlerMeta.json";

// ── Classes for brawlers whose API class is "Unknown" (newer releases) ──────
const CLASS_OVERRIDES = {
  "BOLT": "Tank",
  "STARR NOVA": "Assassin",
  "DAMIAN": "Assassin",
  "NAJIA": "Assassin",
  "SIRIUS": "Support",
  "GLOWY": "Controller",
  "GIGI": "Artillery",
  "PIERCE": "Marksman",
  "ZIGGY": "Artillery",
  "MINA": "Assassin",
  "TRUNK": "Tank",
  "ALLI": "Assassin",
  "KAZE": "Assassin",
  "JAE-YONG": "Support",
  "FINX": "Controller",
  "OLLIE": "Tank",
  "MEEPLE": "Controller",
};

// ── Class-level draft profiles ───────────────────────────────────────────────
// firstPickSafety: 0..1 — how safe this archetype is to reveal before the
// enemy has committed. High = hard to punish (marksmen always shoot things),
// low = easy to answer (assassins get walled by tanks/controllers).
// counters / counteredBy: class-level matchup edges used once enemy picks are
// visible. These follow the standard Brawl Stars counter cycle.
const CLASS_PROFILES = {
  "Marksman":      { firstPickSafety: 0.90, counters: ["Tank", "Artillery", "Support"], counteredBy: ["Assassin"] },
  "Controller":    { firstPickSafety: 0.85, counters: ["Assassin", "Tank"],             counteredBy: ["Marksman", "Artillery"] },
  "Damage Dealer": { firstPickSafety: 0.80, counters: ["Tank", "Assassin"],             counteredBy: ["Marksman", "Artillery"] },
  "Support":       { firstPickSafety: 0.78, counters: [],                                 counteredBy: ["Assassin"] },
  "Artillery":     { firstPickSafety: 0.62, counters: ["Tank", "Controller"],            counteredBy: ["Assassin", "Marksman"] },
  "Tank":          { firstPickSafety: 0.50, counters: ["Assassin", "Controller"],        counteredBy: ["Damage Dealer", "Artillery", "Marksman"] },
  "Assassin":      { firstPickSafety: 0.32, counters: ["Marksman", "Artillery"],         counteredBy: ["Tank", "Damage Dealer", "Controller"] },
  "Unknown":       { firstPickSafety: 0.65, counters: [],                                 counteredBy: [] },
};

// ── Per-brawler overrides ────────────────────────────────────────────────────
// Refines firstPickSafety where a brawler plays differently from its class
// stereotype. Only listed where it meaningfully deviates.
const BRAWLER_OVERRIDES = {
  // Extremely punishable if revealed early — win rate comes from matchup wins
  "EDGAR":    { firstPickSafety: 0.12 },
  "MORTIS":   { firstPickSafety: 0.18 },
  "MICO":     { firstPickSafety: 0.22 },
  "LILY":     { firstPickSafety: 0.28 },
  "MELODIE":  { firstPickSafety: 0.28 },
  "BUZZ":     { firstPickSafety: 0.28 },
  "FANG":     { firstPickSafety: 0.32 },
  "SHADE":    { firstPickSafety: 0.35 },
  "KENJI":    { firstPickSafety: 0.38 },
  "SAM":      { firstPickSafety: 0.30 },
  "CORDELIUS":{ firstPickSafety: 0.40 },
  "KAZE":     { firstPickSafety: 0.35 },
  "ALLI":     { firstPickSafety: 0.35 },
  "DAMIAN":   { firstPickSafety: 0.35 },
  "NAJIA":    { firstPickSafety: 0.40 },
  "MINA":     { firstPickSafety: 0.40 },

  // Flexible assassins — utility/invisibility keeps them useful even when answered
  "LEON":     { firstPickSafety: 0.55 },
  "CROW":     { firstPickSafety: 0.62 },
  "STU":      { firstPickSafety: 0.55 },

  // Tanks that get hard-countered when revealed early
  "FRANK":    { firstPickSafety: 0.30 },
  "HANK":     { firstPickSafety: 0.38 },
  "EL PRIMO": { firstPickSafety: 0.40 },
  "BULL":     { firstPickSafety: 0.42 },
  "DARRYL":   { firstPickSafety: 0.45 },
  "ASH":      { firstPickSafety: 0.48 },

  // Slow/telegraphed damage dealers — easier to punish than class suggests
  "8-BIT":    { firstPickSafety: 0.52 },

  // Highly flexible picks — safe openers beyond their class default
  "SPIKE":    { firstPickSafety: 0.88 },
  "GENE":     { firstPickSafety: 0.88 },
  "TARA":     { firstPickSafety: 0.85 },
  "SANDY":    { firstPickSafety: 0.82 },
  "MAX":      { firstPickSafety: 0.85 },
  "POCO":     { firstPickSafety: 0.85 },
  "BYRON":    { firstPickSafety: 0.88 },
  "GRAY":     { firstPickSafety: 0.85 },
};

const norm = (k) => (k || "").toUpperCase().trim();

export function getBrawlerClass(key) {
  const k = norm(key);
  const metaClass = BRAWLER_META[k]?.class;
  if (metaClass && metaClass !== "Unknown") return metaClass;
  return CLASS_OVERRIDES[k] || "Unknown";
}

export function getDraftProfile(key) {
  const k = norm(key);
  const cls = getBrawlerClass(k);
  const profile = CLASS_PROFILES[cls] || CLASS_PROFILES.Unknown;
  const override = BRAWLER_OVERRIDES[k] || {};
  return {
    class: cls,
    firstPickSafety: override.firstPickSafety ?? profile.firstPickSafety,
    counters: profile.counters,
    counteredBy: profile.counteredBy,
  };
}

// ── Scoring helpers used by the draft assistant ──────────────────────────────

// Blind-pick multiplier: scales a brawler's stat score by how safe it is to
// reveal with no enemy information. Maps safety 0..1 → multiplier 0.35..1.0,
// so an Edgar (0.12) keeps ~43% of its score while a Piper (0.9) keeps ~94%.
export function blindPickFactor(key) {
  const { firstPickSafety } = getDraftProfile(key);
  return 0.35 + 0.65 * firstPickSafety;
}

// Matchup adjustment once enemy picks are known. Returns
// { factor, reasons: [{ label, tone }] } where tone is "good" | "bad".
export function matchupAdjustment(key, enemyKeys, formatName) {
  const me = getDraftProfile(key);
  let factor = 1;
  const reasons = [];
  for (const enemyKey of enemyKeys) {
    const enemy = getDraftProfile(enemyKey);
    const enemyName = formatName ? formatName(enemyKey) : enemyKey;
    if (me.counters.includes(enemy.class)) {
      factor *= 1.10;
      reasons.push({ label: `Counters ${enemyName}`, tone: "good" });
    }
    if (me.counteredBy.includes(enemy.class)) {
      factor *= 0.85;
      reasons.push({ label: `Weak vs ${enemyName}`, tone: "bad" });
    }
  }
  return { factor, reasons };
}

// Label for the blind phase shown on suggestion cards.
export function blindPickLabel(key) {
  const { firstPickSafety } = getDraftProfile(key);
  if (firstPickSafety >= 0.78) return { label: "Safe opener", tone: "good" };
  if (firstPickSafety <= 0.42) return { label: "Risky blind pick", tone: "bad" };
  return null;
}
