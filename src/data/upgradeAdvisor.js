// ─── "What should I upgrade next?" ────────────────────────────────────────────
// Ranks a player's own brawlers by what the next upgrade actually buys them per
// coin spent, given the current map rotation and what they have already sunk in.
//
// TWO THINGS ABOUT THE API THAT HAD TO BE ESTABLISHED EMPIRICALLY, both of which
// were got wrong on a first pass and are worth stating plainly:
//
//   buffies{}      { gadget, starPower, hyperCharge } — PLAYER-SPECIFIC. Two
//                  rosters agreed on 98/105 brawlers and genuinely differed on 7.
//   hyperCharges[] OWNERSHIP, not a catalogue. This was the wrong call the first
//                  time: 99/105 brawlers listing one, and 100/105 agreement
//                  between two accounts, reads exactly like a catalogue — but
//                  both accounts were advanced and simply owned nearly all of
//                  them. The owner reported not owning Bea's; Bea returns [].
//                  Hypercharge drops are not power-gated, which is why a power-1
//                  brawler can hold one and why the power correlation misled.
//
// COSTS ARE REAL (upgradeCosts.js), so ranking is value per coin rather than a
// bare score. That matters because steps differ by two orders of magnitude —
// 20 coins for level 1→2 against 5,000 for a hypercharge.

import { draftClassOf, classLabel } from "./draftEngine";
import {
  MAX_POWER, SLOT_LEVEL, ITEM_COST, BUFFIE_COST,
  BUFFIE_SLOTS_PER_BRAWLER, BUFFIE_DROP_MONTHS, BUFFIE_DROP_BRAWLERS,
  levelCost, costToComplete, nextStepFor,
} from "./upgradeCosts";

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

const W = {
  classGap: 0.45,
  affinity: 0.30,
  waste: 0.90,
  // A brawler whose hypercharge is not owned is capped — at power 11 it still
  // lacks the tier everyone else has, and closing that costs 5,000 coins. A
  // multiplier rather than a filter, so a genuinely strong pick that fills a
  // role gap can still outrank a mediocre one that happens to own its
  // hypercharge. That is the owner's stated rule.
  noHyperPenalty: 0.55,
};

const STEP = {
  toEleven: 1.00,       // unplayable in ranked below 11 — nothing beats this
  firstSp: 0.50,
  firstGadget: 0.45,
  hypercharge: 0.50,
  secondSp: 0.22,
  secondGadget: 0.20,
  gearOnly: 0.08,
};

function stepImpact(b) {
  const power = num(b.power, 1);
  const gadgets = (b.gadgets || []).length;
  const sps = (b.starPowers || []).length;
  const ownsHyper = (b.hyperCharges || []).length > 0;
  // Below 11 a brawler cannot be played in ranked from Mythic upward, so the
  // whole climb is one step and it outranks every item purchase. How far away
  // it is shows up in the cost, not in the impact.
  if (power < MAX_POWER) return STEP.toEleven;
  if (gadgets === 0) return STEP.firstGadget;
  if (sps === 0) return STEP.firstSp;
  if (!ownsHyper) return STEP.hypercharge;
  if (sps < 2) return STEP.secondSp;
  if (gadgets < 2) return STEP.secondGadget;
  return STEP.gearOnly;
}

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
  else return null;
  return Math.max(0, Math.min(1, (wr - 45) / 12));
}

function sunkFraction(b) {
  const power = (num(b.power, 1) - 1) / (MAX_POWER - 1);
  const sp = Math.min(1, (b.starPowers || []).length / 2);
  const gd = Math.min(1, (b.gadgets || []).length / 2);
  const gr = Math.min(1, (b.gears || []).length / 2);
  const bf = b.buffies ? Object.values(b.buffies).filter(Boolean).length / BUFFIE_SLOTS_PER_BRAWLER : 0;
  const hc = (b.hyperCharges || []).length ? 1 : 0;
  return power * 0.34 + sp * 0.13 + gd * 0.13 + gr * 0.08 + bf * 0.17 + hc * 0.15;
}

/**
 * Investment already bought and doing nothing because the brawler is too low to
 * use it. Buffies weigh heaviest: they cost 2,000 power points and 1,000 gold,
 * and a purchase draws a RANDOM buffie from a group of three brawlers — so one
 * stranded on a power-1 brawler is the least redirectable spend in the game.
 */
function wastedInvestment(b) {
  const power = num(b.power, 1);
  if (power >= 9) return 0;
  const bfCount = b.buffies ? Object.values(b.buffies).filter(Boolean).length : 0;
  const attached =
    (b.starPowers || []).length / 2 * 0.22 +
    (b.gadgets || []).length / 2 * 0.22 +
    (bfCount / BUFFIE_SLOTS_PER_BRAWLER) * 0.34 +
    ((b.hyperCharges || []).length ? 0.22 : 0);
  return attached * ((MAX_POWER - power) / (MAX_POWER - 1));
}

export function recommendUpgrades({ roster, intelligence = {}, rotationStats = {}, playedCounts = {} }) {
  const owned = (roster || []).filter(b => num(b.power) >= 1);
  if (!owned.length) return { picks: [], classes: [], saveAdvice: null };

  const maxedByClass = {}, ownedByClass = {};
  for (const b of owned) {
    const cls = draftClassOf(b.name);
    ownedByClass[cls] = (ownedByClass[cls] || 0) + 1;
    if (num(b.power) >= MAX_POWER) maxedByClass[cls] = (maxedByClass[cls] || 0) + 1;
  }
  const classes = Object.keys(ownedByClass).map(cls => ({
    cls, label: classLabel(cls),
    owned: ownedByClass[cls] || 0, maxed: maxedByClass[cls] || 0,
  })).sort((a, b) => a.maxed - b.maxed);

  const totalMaxed = Object.values(maxedByClass).reduce((a, v) => a + v, 0);
  const classNeed = (cls) => (totalMaxed ? Math.max(0, 1 - (maxedByClass[cls] || 0) / 3) : 0.5);
  const maxPlayed = Math.max(1, ...Object.values(playedCounts));

  const scored = [];
  for (const b of owned) {
    const step = nextStepFor(b);
    if (!step) continue;                         // nothing left to buy
    const meta = metaStrength(b.name, intelligence, rotationStats);
    if (meta == null) continue;                  // no evidence — stay silent

    const cls = draftClassOf(b.name);
    const sunk = sunkFraction(b);
    const waste = wastedInvestment(b);
    const affinity = Math.min(1, (playedCounts[(b.name || "").toUpperCase()] || 0) / maxPlayed);
    const need = classNeed(cls);
    const ownsHyper = (b.hyperCharges || []).length > 0;

    // Don't push a brawler whose hypercharge isn't owned UNLESS it is strong and
    // fills a role the roster is short of.
    //
    // But never penalise the hypercharge PURCHASE itself: if that is the
    // recommended step, completing it removes the very deficiency being punished.
    // Scoring it as though the gap persists double-counts, and it buried a
    // meta-0.71 brawler that was one purchase from finished at rank 55.
    const buyingHyper = /Hypercharge/i.test(step.label);
    const rescued = meta >= 0.6 && need >= 0.33;
    const hyperMult = (ownsHyper || rescued || buyingHyper) ? 1 : W.noHyperPenalty;

    const gain = meta * stepImpact(b) * hyperMult;
    const ease = 0.6 + 0.4 * sunk;
    const demand = 1 + W.classGap * need + W.affinity * affinity;
    const score = gain * ease * demand + W.waste * waste;

    scored.push({
      name: b.name, cls, label: classLabel(cls), power: num(b.power, 1),
      meta, sunk, waste, classNeed: need, affinity, ownsHyper, rescued,
      buffieCount: b.buffies ? Object.values(b.buffies).filter(Boolean).length : 0,
      step, cost: costToComplete(b), score,
      // Value per 1,000 coins of the immediate step — the only way a 20-coin
      // level-up and a 5,000-coin hypercharge are comparable at all.
      perK: step.coins > 0 ? score / (step.coins / 1000) : score,
      played: playedCounts[(b.name || "").toUpperCase()] || 0,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  for (const p of scored) p.reasons = buildReasons(p);

  return { picks: scored, classes, saveAdvice: saveOrSpend(scored, owned, classes) };
}

/**
 * Spend now, or hold for the next buffie wave?
 *
 * Buffies cannot be aimed — a purchase draws one random buffie from a group of
 * three brawlers, skipping any already held — so a player with a deep, balanced
 * roster is largely buying lottery tickets on brawlers they have finished. New
 * buffies arrive every 2–3 months for about six brawlers, so holding power
 * points can genuinely beat spending them on a second gear.
 *
 * Deliberately conservative: this only fires for a roster that really has run
 * out of good options, and the top five are shown either way.
 */
function saveOrSpend(scored, owned, classes) {
  const top = scored[0];
  const thinRoles = classes.filter(c => c.maxed <= 1).length;
  const maxed = owned.filter(b => num(b.power) >= MAX_POWER).length;
  const cheapAndStrong = scored.filter(p => p.meta >= 0.55 && p.step.coins <= 3000).length;

  if (!(maxed >= 25 && thinRoles === 0 && cheapAndStrong <= 1 && (!top || top.score < 0.45))) {
    return null;
  }
  return {
    verdict: "save",
    text: `Your roster is deep — ${maxed} maxed and no thin roles — and nothing left is both strong and cheap. `
        + `New buffies land every ${BUFFIE_DROP_MONTHS[0]}–${BUFFIE_DROP_MONTHS[1]} months for around `
        + `${BUFFIE_DROP_BRAWLERS} brawlers, at ${BUFFIE_COST.pp.toLocaleString("en-US")} power points and `
        + `${BUFFIE_COST.coins.toLocaleString("en-US")} gold per draw. Holding for that wave usually beats `
        + `spending now on a second gear. The picks below are the best of what's available if you'd rather not wait.`,
  };
}

function buildReasons(p) {
  const out = [];

  if (p.waste > 0.12) {
    const bits = [];
    if (p.buffieCount) bits.push(`${p.buffieCount} buffie${p.buffieCount > 1 ? "s" : ""}`);
    if (p.ownsHyper) bits.push("its hypercharge");
    if (bits.length) {
      // The "can't redirect" line is only true of buffies — they draw randomly
      // from a group of three brawlers. Saying it about a hypercharge would be
      // wrong, since that one IS bought directly.
      const tail = p.buffieCount
        ? " Buffies can't be bought for a chosen brawler, so that's spend you can't redirect."
        : "";
      out.push({
        tone: "warn",
        text: `You already own ${bits.join(" and ")} here, and at power ${p.power} none of it is usable.${tail}`,
      });
    }
  }

  if (p.meta >= 0.65) out.push({ tone: "good", text: "One of the strongest picks on the maps in rotation right now." });
  else if (p.meta >= 0.5) out.push({ tone: "good", text: "Solid on the current rotation." });
  else if (p.meta <= 0.3) out.push({ tone: "muted", text: "Not a standout in the meta — this is about finishing what you started, not chasing a strong brawler." });

  if (p.step.unlocks) out.push({ tone: "info", text: `This unlocks the ${p.step.unlocks}.` });

  if (!p.ownsHyper && p.power >= MAX_POWER) {
    out.push(p.rescued
      ? { tone: "warn", text: `No hypercharge yet (${ITEM_COST.hypercharge.toLocaleString("en-US")} coins) — but it's strong enough, and fills a role you're short of, to be worth buying anyway.` }
      : { tone: "muted", text: `No hypercharge yet, which caps what maxing buys until you spend the ${ITEM_COST.hypercharge.toLocaleString("en-US")} coins.` });
  }

  if (p.classNeed >= 0.66) out.push({ tone: "info", text: `You have no maxed ${p.label} — this fills a hole in your drafts.` });
  if (p.affinity >= 0.5) out.push({ tone: "info", text: "One of the brawlers you actually draft." });

  if (!out.length) out.push({ tone: "muted", text: "Best remaining value for the coins among what's left." });
  return out;
}

export { levelCost, costToComplete };
