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
  levelCost, costToComplete, nextStepFor, buffieOdds, BUFFIE_PACKS,
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

// A brawler counts as a real option in its role only if it is fully fieldable
// AND worth fielding. 0.5 on the metaStrength scale is a ~51% true win rate.
const READY_META = 0.5;
// Three fieldable brawlers in a role is enough to never be stuck in a draft.
const READY_TARGET = 3;

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

  // "Do I have options in this role?" is not the same question as "how many of
  // these have I maxed?". Measuring raw maxed count made the term useless on any
  // developed roster: 44 maxed brawlers spread over seven classes cleared the
  // threshold everywhere except Thrower, so class need was 0.00 for six of seven
  // and the whole term stopped discriminating. What matters when drafting is how
  // many brawlers in a role are genuinely FIELDABLE — power 11 (below it there is
  // no ranked game from Mythic up), hypercharge owned (or you are a tier down on
  // every exchange), and actually good in the current meta.
  const readyByClass = {}, maxedByClass = {}, ownedByClass = {};
  for (const b of owned) {
    const cls = draftClassOf(b.name);
    ownedByClass[cls] = (ownedByClass[cls] || 0) + 1;
    if (num(b.power) >= MAX_POWER) maxedByClass[cls] = (maxedByClass[cls] || 0) + 1;
    const m = metaStrength(b.name, intelligence, rotationStats);
    if (num(b.power) >= MAX_POWER && (b.hyperCharges || []).length > 0 && num(m) >= READY_META) {
      readyByClass[cls] = (readyByClass[cls] || 0) + 1;
    }
  }
  const classes = Object.keys(ownedByClass).map(cls => ({
    cls, label: classLabel(cls),
    owned: ownedByClass[cls] || 0, maxed: maxedByClass[cls] || 0,
    ready: readyByClass[cls] || 0,
  })).sort((a, b) => a.ready - b.ready);

  // `banked` counts picks already chosen higher up the list. A recommendation is
  // a PLAN, not five independent scores: once the list has told you to build a
  // Thrower, the second Thrower is worth less than it was, because the hole is
  // already being filled. Folding banked picks into the same count is what makes
  // the top five a coherent set rather than five answers to the same question.
  const classNeed = (cls, banked = 0) =>
    Math.max(0, 1 - ((readyByClass[cls] || 0) + banked) / READY_TARGET);
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

    scored.push({
      gain, ease,
      name: b.name, cls, label: classLabel(cls), power: num(b.power, 1),
      meta, sunk, waste, affinity, ownsHyper, rescued,
      buffieCount: b.buffies ? Object.values(b.buffies).filter(Boolean).length : 0,
      // The full inventory, so the card can state what is already owned rather
      // than mentioning only the parts that happen to drive the score.
      owned: {
        gadgets: (b.gadgets || []).length,
        starPowers: (b.starPowers || []).length,
        gears: (b.gears || []).length,
        buffies: b.buffies ? Object.values(b.buffies).filter(Boolean).length : 0,
        buffieKinds: b.buffies
          ? Object.entries(b.buffies).filter(([, v]) => v).map(([k]) => k)
          : [],
        hyper: (b.hyperCharges || []).length > 0,
      },
      step, cost: costToComplete(b),
      odds: buffieOdds(b.name, roster),
      played: playedCounts[(b.name || "").toUpperCase()] || 0,
    });
  }

  // Greedy selection rather than one sort. Each pick is scored against the roster
  // AS IT WOULD BE after the picks above it are done, so the list stops
  // recommending the same hole five times. The class term is a nudge, not a
  // quota — a genuinely outstanding second Thrower still beats a mediocre Tank.
  const banked = {};
  const picks = [];
  const pool = scored.slice();
  while (pool.length) {
    let bestI = 0, bestScore = -Infinity, bestNeed = 0;
    for (let i = 0; i < pool.length; i++) {
      const p = pool[i];
      const need = classNeed(p.cls, banked[p.cls] || 0);
      const sc = p.gain * p.ease * (1 + W.classGap * need + W.affinity * p.affinity) + W.waste * p.waste;
      if (sc > bestScore) { bestScore = sc; bestI = i; bestNeed = need; }
    }
    const [p] = pool.splice(bestI, 1);
    p.score = bestScore;
    p.classNeed = bestNeed;
    p.classReady = readyByClass[p.cls] || 0;
    p.classMaxed = maxedByClass[p.cls] || 0;
    p.classOwned = ownedByClass[p.cls] || 0;
    p.classBanked = banked[p.cls] || 0;
    // Value per 1,000 coins of the immediate step — the only way a 20-coin
    // level-up and a 5,000-coin hypercharge are comparable at all.
    p.perK = p.step.coins > 0 ? bestScore / (p.step.coins / 1000) : bestScore;
    banked[p.cls] = (banked[p.cls] || 0) + 1;
    picks.push(p);
  }

  for (const p of picks) p.reasons = buildReasons(p);

  return { picks, classes, saveAdvice: saveOrSpend(picks, owned, classes, roster) };
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
function saveOrSpend(scored, owned, classes, roster) {
  const top = scored[0];
  const thinRoles = classes.filter(c => c.ready <= 1).length;
  const maxed = owned.filter(b => num(b.power) >= MAX_POWER).length;
  const cheapAndStrong = scored.filter(p => p.meta >= 0.55 && p.step.coins <= 3000).length;

  // How much buffie headroom is left across every pack. When packs are nearly
  // full, draws are mostly duplicates-in-waiting and the next wave is the only
  // real place for power points to go.
  const byName = Object.fromEntries((roster || []).map(b => [String(b.name || "").toUpperCase(), b]));
  let slotsMissing = 0, slotsTotal = 0;
  for (const pack of BUFFIE_PACKS) {
    for (const n of pack.brawlers) {
      const bf = byName[n]?.buffies;
      slotsTotal += 3;
      slotsMissing += bf ? Object.values(bf).filter(v => !v).length : 3;
    }
  }
  const packsNearlyFull = slotsTotal > 0 && slotsMissing / slotsTotal <= 0.25;

  if (!(maxed >= 25 && thinRoles === 0 && cheapAndStrong <= 1 &&
        (!top || top.score < 0.45) && packsNearlyFull)) {
    return null;
  }
  return {
    verdict: "save",
    text: `Your roster is deep — ${maxed} maxed, no thin roles, and only ${slotsMissing} buffie slots left across all seven packs. `
        + `New buffies land every ${BUFFIE_DROP_MONTHS[0]}–${BUFFIE_DROP_MONTHS[1]} months for around `
        + `${BUFFIE_DROP_BRAWLERS} brawlers, at ${BUFFIE_COST.pp.toLocaleString("en-US")} power points and `
        + `${BUFFIE_COST.coins.toLocaleString("en-US")} gold per draw. Holding for that wave usually beats `
        + `spending now on a second gear. The picks below are the best of what's available if you'd rather not wait.`,
  };
}

/** "a", "a and b", "a, b and c" — join(" and ") produces "a and b and c". */
function listJoin(items) {
  if (items.length <= 1) return items[0] || "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function buildReasons(p) {
  const out = [];

  if (p.waste > 0.12) {
    const o = p.owned;
    const bits = [];
    if (o.gadgets) bits.push(`${o.gadgets === 2 ? "both" : "1 of 2"} gadget${o.gadgets > 1 ? "s" : ""}`);
    if (o.starPowers) bits.push(`${o.starPowers === 2 ? "both" : "1 of 2"} star power${o.starPowers > 1 ? "s" : ""}`);
    if (o.gears) bits.push(`${o.gears} gear${o.gears > 1 ? "s" : ""}`);
    if (o.buffies) bits.push(`${o.buffies} buffie${o.buffies > 1 ? "s" : ""}`);
    if (o.hyper) bits.push("its hypercharge");
    if (bits.length) {
      // The "can't redirect" line is only true of buffies — they draw randomly
      // from a group of three brawlers. Saying it about a hypercharge would be
      // wrong, since that one IS bought directly.
      const tail = p.buffieCount
        ? " Buffies can't be bought for a chosen brawler, so that's spend you can't redirect."
        : "";
      out.push({
        tone: p.buffieCount ? "warn" : "info",
        text: `You already own ${listJoin(bits)} here.${tail}`,
      });
    }
  }

  // Role scarcity and meta strength are ONE argument, not two — "you're thin on
  // Throwers" and "Sprout is strong" only justify an upgrade together, and split
  // across two bullets the reader has to join them up. Fold them when both hold,
  // and fall back to either alone when only one does.
  const nice = p.name.charAt(0) + p.name.slice(1).toLowerCase();
  const metaPhrase =
    p.meta >= 0.65 ? `${nice} is one of the strongest in the meta right now`
    : p.meta >= 0.5 ? `${nice} is solid in the current meta`
    : null;

  // Every pick gets a class verdict, including the ones where the class argument
  // runs AGAINST it. A strong brawler in a role you have already covered is
  // ranked where it is BECAUSE the role is covered, and staying silent about
  // that leaves the reader wondering why an obviously good brawler sits at four
  // rather than one. "{label} brawlers", never "{label}s" — the class names do
  // not pluralise ("no Controls" reads like nonsense).
  if (p.classNeed >= 0.33) {
    const n = p.classReady;
    let have, tail;
    if (p.classBanked === 0) {
      have = n === 0
        ? `You have no ${p.label} brawlers that are fully built and actually good`
        : `You don't have many strong ${p.label} brawlers — only ${n} of yours ${n > 1 ? "are" : "is"} fully built and actually good`;
      tail = "this fills a real hole in your drafts";
    } else {
      // The count has to be restated around what the roster looks like AFTER the
      // picks above are done, not tacked on as a parenthetical. Appending
      // "(counting the one above this)" to "you have no Control brawlers"
      // contradicts itself — counting it, you would have one.
      const eff = p.classReady + p.classBanked;
      have = `Even after the ${p.classBanked === 1 ? `${p.label} brawler` : `${p.classBanked} ${p.label} brawlers`} `
           + `above this one, you'd have just ${eff} that ${eff === 1 ? "is" : "are"} fully built and actually good`;
      tail = "there's still room in the role";
    }
    out.push({
      tone: "info",
      text: metaPhrase ? `${have}, and ${metaPhrase} — so ${tail}.` : `${have}, so ${tail}.`,
    });
  } else if (p.classReady >= READY_TARGET) {
    // Crowded on the roster itself. Quote the maxed count as well as the
    // fieldable one — "3 fieldable" on its own reads as FEW, which is the
    // opposite of the point being made.
    const lead = metaPhrase ? `${metaPhrase}, but you` : "You";
    out.push({
      tone: "muted",
      text: `${lead} already have plenty of ${p.label} brawlers — ${p.classMaxed} maxed, `
          + `${p.classReady} of them genuinely strong right now — so this adds depth, not coverage.`,
    });
  } else if (p.classBanked > 0) {
    // Only covered once the picks ABOVE this one are done. Saying "you already
    // have plenty" here would contradict the card higher up the same list that
    // just said the role was thin.
    const lead = metaPhrase ? `${metaPhrase}, but the` : "The";
    out.push({
      tone: "muted",
      text: `${lead} ${p.classBanked === 1 ? `${p.label} brawler` : `${p.classBanked} ${p.label} brawlers`} `
          + `higher up this list already cover the role — do those first, and this becomes depth on top.`,
    });
  } else if (p.meta >= 0.65) {
    out.push({ tone: "good", text: "One of the strongest picks on the maps in rotation right now." });
  } else if (p.meta >= 0.5) {
    out.push({ tone: "good", text: "Solid on the current rotation." });
  }

  if (p.meta <= 0.3) out.push({ tone: "muted", text: "Not a standout in the meta — this is about finishing what you started, not chasing a strong brawler." });

  if (p.step.unlocks) out.push({ tone: "info", text: `This unlocks the ${p.step.unlocks}.` });

  if (!p.ownsHyper && p.power >= MAX_POWER) {
    out.push(p.rescued
      ? { tone: "warn", text: `No hypercharge yet (${ITEM_COST.hypercharge.toLocaleString("en-US")} coins) — but it's strong enough, and fills a role you're short of, to be worth buying anyway.` }
      : { tone: "muted", text: `No hypercharge yet, which caps what maxing buys until you spend the ${ITEM_COST.hypercharge.toLocaleString("en-US")} coins.` });
  }

  // Buffies can only be bought by PACK, so the useful thing to say is what a
  // draw on that pack is actually worth — not "go buy this brawler's buffie",
  // which nobody can do.
  const o = p.odds;
  if (o && !o.complete && o.mine > 0 && p.power >= MAX_POWER) {
    const pct = Math.round(o.chance * 100);
    out.push({
      tone: "info",
      text: `${o.mine} of its 3 buffies still missing. They only drop from the ${o.pack} pack, `
          + `shared with ${o.others.map(n => n[0] + n.slice(1).toLowerCase()).join(" and ")} — `
          + `${pct}% per draw right now, so about ${o.expectedDraws.toFixed(1)} draws `
          + `(${o.expectedPp.toLocaleString("en-US")} power points, ${o.expectedCoins.toLocaleString("en-US")} gold) to land one.`,
    });
  }

  if (p.affinity >= 0.5) out.push({ tone: "info", text: "One of the brawlers you actually draft." });

  if (!out.length) out.push({ tone: "muted", text: "Best remaining value for the coins among what's left." });
  return out;
}

export { levelCost, costToComplete };
