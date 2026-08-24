// ─── "What should I upgrade next?" ────────────────────────────────────────────
// Ranks a player's own brawlers by how much a further investment would actually
// buy them, given what the meta rewards right now and what they have already
// sunk into each one.
//
// WHAT THE API ACTUALLY GIVES US (verified against two live rosters, 2026-08-24
// — worth writing down, because the field names are not obvious):
//   power        1..11
//   gears[]      owned gears, by name
//   starPowers[] owned star powers  (0, 1 or 2)
//   gadgets[]    owned gadgets      (0, 1 or 2)
//   buffies{}    { gadget, starPower, hyperCharge } — PLAYER-SPECIFIC. Two
//                rosters agreed on 98/105 brawlers and genuinely differed on 7,
//                so this is per-account state, not game-wide balance data. It
//                correlates with owning things but is not the same as owning
//                them (29% vs 8%), so it is treated as its own investment axis.
//   hyperCharges[] the hypercharge that EXISTS for that brawler — near-identical
//                across players (100/105) and present on power-1 brawlers, so it
//                is a catalogue, NOT ownership. Never read it as "they have it".
//
// THE IDEA, in one line: the best upgrade is a strong brawler you are already
// most of the way through, in a role your maxed roster is thin on.

import { draftClassOf, classLabel } from "./draftEngine";

const MAX_POWER = 11;
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

// Weights. Deliberately few and named, so a recommendation can always be
// explained by pointing at which term dominated.
const W = {
  classGap: 0.45,  // does the maxed roster lack this role
  affinity: 0.30,  // do they actually play it
  waste: 0.90,     // investment currently locked behind a low power level
};

// How much the CHEAPEST remaining step is actually worth. This is the term that
// makes the advice useful rather than merely true.
//
// A first pass scored "how far through the brawler you are", which ranked every
// maxed brawler's missing second gear above levelling an unusable one — the
// steps were treated as interchangeable when they are worth wildly different
// amounts. A brawler below power 9 is not draftable in ranked at all; a second
// gear is a rounding error. The gap between those has to be in the model.
const STEP = {
  toNine: 1.00,      // sub-9 is unusable — by far the biggest jump available
  toEleven: 0.55,    // 9/10 -> 11 unlocks the hypercharge tier
  firstSp: 0.45,     // no star power at all is a real hole
  firstGadget: 0.40,
  secondSp: 0.22,
  secondGadget: 0.20,
  gearOnly: 0.08,    // marginal, and should almost never be the headline
};

function stepImpact(b, gaps) {
  const power = num(b.power, 1);
  if (power < 9) return STEP.toNine;
  if (gaps.spGap === 2) return STEP.firstSp;
  if (gaps.gadgetGap === 2) return STEP.firstGadget;
  if (power < MAX_POWER) return STEP.toEleven;
  if (gaps.spGap > 0) return STEP.secondSp;
  if (gaps.gadgetGap > 0) return STEP.secondGadget;
  return STEP.gearOnly;
}

/**
 * Meta strength on a 0..1 scale, blending the brawler's overall true win rate
 * with how it performs on the maps currently in rotation. Uses the same
 * Bayesian-ish shrink idea as the rest of the site: a map sample only counts
 * once it is big enough to mean something.
 */
function metaStrength(name, intelligence, rotationStats) {
  const key = (name || "").toUpperCase();
  const global = num(intelligence[key]?.true_win_rate, NaN);
  const rot = rotationStats[key];
  const picks = num(rot?.picks);
  const mapWR = picks >= 200 ? (num(rot.wins) / picks) * 100 : null;

  let wr;
  if (Number.isFinite(global) && mapWR != null) wr = mapWR * 0.6 + global * 0.4;
  else if (Number.isFinite(global)) wr = global;
  else if (mapWR != null) wr = mapWR;
  else return null;                       // no evidence at all — never recommend

  // 45%..57% maps to 0..1; outside that is clamped. A brawler at 50 is average
  // and should not score as "worth investing in" on meta grounds alone.
  return Math.max(0, Math.min(1, (wr - 45) / 12));
}

/** What is still missing, and what it is worth. */
function gapsFor(b) {
  const powerGap = Math.max(0, MAX_POWER - num(b.power, 1));
  const spGap = Math.max(0, 2 - (b.starPowers || []).length);
  const gadgetGap = Math.max(0, 2 - (b.gadgets || []).length);
  const gearGap = Math.max(0, 2 - (b.gears || []).length);
  return { powerGap, spGap, gadgetGap, gearGap };
}

/** How far through this brawler the player already is, 0..1. */
function sunkFraction(b) {
  const power = (num(b.power, 1) - 1) / (MAX_POWER - 1);      // 0 at p1, 1 at p11
  const sp = Math.min(1, (b.starPowers || []).length / 2);
  const gd = Math.min(1, (b.gadgets || []).length / 2);
  const gr = Math.min(1, (b.gears || []).length / 2);
  const bf = b.buffies ? Object.values(b.buffies).filter(Boolean).length / 3 : 0;
  return power * 0.4 + sp * 0.15 + gd * 0.15 + gr * 0.1 + bf * 0.2;
}

/**
 * Investment the player has ALREADY made that is doing nothing because the
 * brawler is under-levelled. This is the "3 buffies on a power-1 Leon" case:
 * the value is bought and sitting idle, so levelling is worth more here than on
 * an equally-strong brawler with nothing attached to it.
 */
function wastedInvestment(b) {
  const power = num(b.power, 1);
  if (power >= 9) return 0;                       // near enough to max to not be waste
  const attached =
    (b.starPowers || []).length / 2 * 0.3 +
    (b.gadgets || []).length / 2 * 0.3 +
    (b.buffies ? Object.values(b.buffies).filter(Boolean).length / 3 : 0) * 0.4;
  const shortfall = (MAX_POWER - power) / (MAX_POWER - 1);
  return attached * shortfall;
}

/**
 * @param roster        from /api/player
 * @param intelligence  brawler -> { true_win_rate, pick_rate }
 * @param rotationStats brawler -> { picks, wins } summed over in-rotation maps
 * @param playedCounts  brawler -> series the player has actually drafted it
 */
export function recommendUpgrades({ roster, intelligence = {}, rotationStats = {}, playedCounts = {} }) {
  const owned = (roster || []).filter(b => num(b.power) >= 1);
  if (!owned.length) return { picks: [], classes: [] };

  // Which roles is the player's MAXED roster thin on? A draft needs three
  // functioning brawlers; being deep in one class and empty in another limits
  // what they can pick into, which is exactly what the draft engine punishes.
  const maxedByClass = {};
  const ownedByClass = {};
  for (const b of owned) {
    const cls = draftClassOf(b.name);
    ownedByClass[cls] = (ownedByClass[cls] || 0) + 1;
    if (num(b.power) >= MAX_POWER) maxedByClass[cls] = (maxedByClass[cls] || 0) + 1;
  }
  const classes = Object.keys(ownedByClass).map(cls => ({
    cls, label: classLabel(cls),
    owned: ownedByClass[cls] || 0,
    maxed: maxedByClass[cls] || 0,
  })).sort((a, b) => a.maxed - b.maxed);

  const totalMaxed = Object.values(maxedByClass).reduce((a, v) => a + v, 0);
  const classNeed = (cls) => {
    if (!totalMaxed) return 0.5;
    const have = maxedByClass[cls] || 0;
    // 0 maxed in a role is the strongest signal; it decays fast after that.
    return Math.max(0, 1 - have / 3);
  };

  const maxPlayed = Math.max(1, ...Object.values(playedCounts));

  const scored = [];
  for (const b of owned) {
    const meta = metaStrength(b.name, intelligence, rotationStats);
    if (meta == null) continue;                   // no data: stay silent
    const gaps = gapsFor(b);
    const anythingLeft = gaps.powerGap + gaps.spGap + gaps.gadgetGap + gaps.gearGap;
    if (anythingLeft === 0) continue;             // already finished

    const cls = draftClassOf(b.name);
    const sunk = sunkFraction(b);
    const waste = wastedInvestment(b);
    const affinity = Math.min(1, (playedCounts[(b.name || "").toUpperCase()] || 0) / maxPlayed);

    // gain  — what the next step actually buys, gated on the brawler being worth
    //         playing at all. A weak brawler cannot be rescued by affinity.
    // ease  — already-invested brawlers are cheaper to finish, so this discounts
    //         cost rather than inflating value (0.6 .. 1.0).
    // need  — role hole and whether they actually draft it, as multipliers.
    const impact = stepImpact(b, gaps);
    const gain = meta * impact;
    const ease = 0.6 + 0.4 * sunk;
    const need = 1 + W.classGap * classNeed(cls) + W.affinity * affinity;
    const score = gain * ease * need + W.waste * waste;

    scored.push({
      name: b.name, cls, label: classLabel(cls),
      power: num(b.power, 1), gaps, meta, sunk, waste, impact: stepImpact(b, gaps),
      classNeed: classNeed(cls), affinity,
      played: playedCounts[(b.name || "").toUpperCase()] || 0,
      buffies: b.buffies || null,
      score,
      reasons: buildReasons({ b, meta, sunk, waste, gaps, cls, classNeed: classNeed(cls), affinity }),
      nextStep: nextStep(b, gaps),
    });
  }

  scored.sort((a, b) => b.score - a.score);
  // Never headline a gear-only step unless the brawler is genuinely strong —
  // otherwise the whole list becomes "add a second gear" to maxed brawlers,
  // which is true, useless, and crowds out the upgrades that matter.
  const worthSaying = scored.filter(p => p.impact > STEP.gearOnly || p.meta >= 0.6);
  return { picks: worthSaying.length ? worthSaying : scored, classes };
}

/** The single cheapest concrete action, so the advice is do-able not abstract. */
function nextStep(b, gaps) {
  if (gaps.powerGap > 0 && num(b.power, 1) < 9) return `Level to 9 (currently ${num(b.power, 1)})`;
  if (gaps.spGap === 2) return "Unlock a Star Power";
  if (gaps.gadgetGap === 2) return "Unlock a Gadget";
  if (gaps.powerGap > 0) return `Level to 11 (currently ${num(b.power, 1)})`;
  if (gaps.spGap > 0) return "Unlock the second Star Power";
  if (gaps.gadgetGap > 0) return "Unlock the second Gadget";
  if (gaps.gearGap > 0) return "Add a Gear";
  return "Finish the loadout";
}

function buildReasons({ b, meta, sunk, waste, gaps, cls, classNeed, affinity }) {
  const out = [];
  const bf = b.buffies ? Object.entries(b.buffies).filter(([, v]) => v).map(([k]) => k) : [];

  if (waste > 0.12) {
    const bits = [];
    if ((b.starPowers || []).length) bits.push(`${(b.starPowers || []).length} star power${(b.starPowers || []).length > 1 ? "s" : ""}`);
    if ((b.gadgets || []).length) bits.push(`${(b.gadgets || []).length} gadget${(b.gadgets || []).length > 1 ? "s" : ""}`);
    if (bf.length) bits.push(`${bf.length} buff${bf.length > 1 ? "ies" : "ie"}`);
    if (bits.length) out.push({ tone: "warn", text: `You already own ${bits.join(", ")} here, but at power ${num(b.power, 1)} none of it is doing much.` });
  }
  if (meta >= 0.6) out.push({ tone: "good", text: "Strong on the maps in rotation right now." });
  else if (meta <= 0.25) out.push({ tone: "muted", text: "Not a standout in the current meta." });
  if (sunk >= 0.7 && gaps.powerGap > 0 && gaps.powerGap <= 2) {
    out.push({ tone: "good", text: `Nearly finished — ${gaps.powerGap} power level${gaps.powerGap > 1 ? "s" : ""} from maxed.` });
  }
  if (classNeed >= 0.66) out.push({ tone: "info", text: `You have no maxed ${classLabel(cls)} — this fills a hole in your drafts.` });
  if (affinity >= 0.5) out.push({ tone: "info", text: "One of the brawlers you actually draft." });
  return out;
}
