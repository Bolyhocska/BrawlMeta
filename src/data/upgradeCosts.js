// ─── Real upgrade economics ───────────────────────────────────────────────────
// Owner-supplied, 2026-08-25. Everything the advisor says about "worth it" is
// value per coin, so these numbers are the denominator of the whole feature.

// Cost to go FROM level i TO level i+1. Index 1 = 1→2.
export const LEVEL_COST = [
  null,
  { pp: 20,   coins: 20 },
  { pp: 30,   coins: 35 },
  { pp: 50,   coins: 75 },
  { pp: 80,   coins: 140 },
  { pp: 130,  coins: 290 },
  { pp: 210,  coins: 480 },    // → 7  unlocks the first gadget slot
  { pp: 340,  coins: 800 },    // → 8  unlocks the first gear slot
  { pp: 550,  coins: 1250 },   // → 9  unlocks the star power slot
  { pp: 890,  coins: 1875 },   // → 10 unlocks the second gear slot
  { pp: 1440, coins: 2800 },   // → 11 unlocks the hypercharge slot
];
export const MAX_POWER = 11;
export const FULL_LEVEL_COST = { pp: 3740, coins: 7765 };   // 1 → 11

// A slot does not exist before its level, so an item cannot be "the next step"
// until the brawler is high enough to hold it. Getting this wrong is how an
// advisor ends up telling someone to unlock a star power on a power-3 brawler.
export const SLOT_LEVEL = {
  gadget: 7,
  gear1: 8,
  starPower: 9,
  gear2: 10,
  hypercharge: 11,
};

export const ITEM_COST = {
  gadget: 1000,
  starPower: 2000,
  gear: 1000,          // epic 1500, mythic 2000 — we cannot see rarity, so this
  gearEpicish: 1500,   // is the optimistic figure and the UI says so
  hypercharge: 5000,
};

// Buffies cannot be bought for a chosen brawler. Each purchase draws ONE random
// buffie from a fixed group of three brawlers, skipping any you already hold —
// so the only honest advice about a specific brawler's buffie is "you cannot
// target it". What CAN be said is whether saving is better than spending.
export const BUFFIE_COST = { pp: 2000, coins: 1000 };
export const BUFFIE_GROUP_SIZE = 3;
export const BUFFIE_SLOTS_PER_BRAWLER = 3;   // gadget, star power, hypercharge

// New buffies arrive roughly every 2–3 months, ~6 brawlers at a time. That
// cadence is why "save instead" is sometimes the right answer for a player whose
// roster is already deep.
export const BUFFIE_DROP_MONTHS = [2, 3];
export const BUFFIE_DROP_BRAWLERS = 6;

/** Coins + power points to take a brawler from `from` to `to`. */
export function levelCost(from, to = MAX_POWER) {
  let pp = 0, coins = 0;
  for (let i = Math.max(1, from); i < Math.min(to, MAX_POWER); i++) {
    pp += LEVEL_COST[i].pp;
    coins += LEVEL_COST[i].coins;
  }
  return { pp, coins };
}

/**
 * Everything still missing, and what it would cost — respecting slot levels, so
 * an item the brawler cannot yet hold is priced as "level there first".
 */
export function costToComplete(b) {
  const power = Number(b.power) || 1;
  const lvl = levelCost(power, MAX_POWER);

  const gadgetsMissing = Math.max(0, 2 - (b.gadgets || []).length);
  const spMissing = Math.max(0, 2 - (b.starPowers || []).length);
  const gearsMissing = Math.max(0, 2 - (b.gears || []).length);
  const ownsHyper = (b.hyperCharges || []).length > 0;

  const items =
    gadgetsMissing * ITEM_COST.gadget +
    spMissing * ITEM_COST.starPower +
    gearsMissing * ITEM_COST.gear +
    (ownsHyper ? 0 : ITEM_COST.hypercharge);

  return {
    levelPp: lvl.pp,
    levelCoins: lvl.coins,
    itemCoins: items,
    totalCoins: lvl.coins + items,
    totalPp: lvl.pp,
    gadgetsMissing, spMissing, gearsMissing, ownsHyper,
  };
}

/**
 * The cheapest single action that actually moves this brawler forward, priced.
 * Slot-aware: below the slot level the answer is always "level up first".
 */
export function nextStepFor(b) {
  const power = Number(b.power) || 1;
  const gadgets = (b.gadgets || []).length;
  const sps = (b.starPowers || []).length;
  const gears = (b.gears || []).length;
  const ownsHyper = (b.hyperCharges || []).length > 0;

  // ALWAYS target power 11. From Mythic upward, ranked only allows power-11
  // brawlers, so levelling to 7 or 9 does not make a brawler playable where it
  // matters — it just spends coins for a slot that cannot be used in a real
  // game. Quoting an intermediate milestone would understate the real ask and
  // point at a stopping point nobody should stop at.
  if (power < MAX_POWER) {
    const c = levelCost(power, MAX_POWER);
    const gained = [];
    if (power < SLOT_LEVEL.gadget) gained.push("gadget");
    if (power < SLOT_LEVEL.starPower) gained.push("star power");
    if (power < SLOT_LEVEL.gear2) gained.push("second gear");
    gained.push("hypercharge");
    return {
      label: `Level ${power} → 11`,
      unlocks: `${gained.join(", ")} slot${gained.length > 1 ? "s" : ""}`,
      ...c,
    };
  }
  if (!ownsHyper) return { label: "Buy the Hypercharge", pp: 0, coins: ITEM_COST.hypercharge };
  if (sps < 2) return { label: "Second Star Power", pp: 0, coins: ITEM_COST.starPower };
  if (gadgets < 2) return { label: "Second Gadget", pp: 0, coins: ITEM_COST.gadget };
  if (gears < 2) return { label: "Add a Gear", pp: 0, coins: ITEM_COST.gear };
  return null;   // finished
}

// ─── Buffie packs ─────────────────────────────────────────────────────────────
// Owner-supplied, 2026-08-25. A purchase draws ONE buffie at random from the
// three brawlers in a pack, skipping any you already hold — so a buffie can
// never be bought for a chosen brawler, only for a chosen PACK. That is the
// whole reason this table exists: without it the only honest thing the advisor
// could say was "you can't target that", which is true and useless. With it, it
// can price the actual gamble.
//
// Each brawler has three buffie slots (gadget, star power, hypercharge), so a
// pack holds nine and the odds shift as you fill them.
export const BUFFIE_PACKS = [
  { name: "Ranger Ranch",     brawlers: ["SHELLY", "COLT", "SPIKE"] },
  { name: "Mortis' Mortuary", brawlers: ["MORTIS", "FRANK", "EMZ"] },
  { name: "Retropolis",       brawlers: ["BULL", "CROW", "BIBI"] },
  { name: "Rumble Jungle",    brawlers: ["NITA", "LEON", "BO"] },
  { name: "Gift Shop",        brawlers: ["EDGAR", "COLETTE", "GRIFF"] },
  { name: "Arcade",           brawlers: ["RICO", "BROCK", "8-BIT"] },
  { name: "Super City",       brawlers: ["MAX", "SURGE", "MEG"] },   // MEG owner-confirmed
];

export const packForBrawler = (name) => {
  const k = String(name || "").toUpperCase();
  return BUFFIE_PACKS.find(p => p.brawlers.includes(k)) || null;
};

/**
 * What a draw on this brawler's pack is actually worth, given what the player
 * already holds across all three brawlers in it.
 *
 * Draws are uniform over the buffies still missing in the pack and without
 * replacement, so the expected number of draws to land ANY buffie for one
 * specific brawler is (M+1)/(m+1), where M is everything still missing in the
 * pack and m is what is missing on that brawler.
 */
export function buffieOdds(name, roster) {
  const pack = packForBrawler(name);
  if (!pack) return null;
  const byName = Object.fromEntries((roster || []).map(b => [String(b.name || "").toUpperCase(), b]));
  const missingIn = (n) => {
    const b = byName[n];
    if (!b) return BUFFIE_SLOTS_PER_BRAWLER;          // unknown: assume none held
    if (!b.buffies) return BUFFIE_SLOTS_PER_BRAWLER;
    return Object.values(b.buffies).filter(v => !v).length;
  };
  const packMissing = pack.brawlers.reduce((a, n) => a + missingIn(n), 0);
  const mine = missingIn(String(name || "").toUpperCase());
  if (!packMissing || !mine) {
    return { pack: pack.name, packMissing, mine, chance: 0, expectedDraws: null,
             expectedCoins: 0, expectedPp: 0, complete: mine === 0 };
  }
  const chance = mine / packMissing;
  const expectedDraws = (packMissing + 1) / (mine + 1);
  return {
    pack: pack.name,
    others: pack.brawlers.filter(n => n !== String(name || "").toUpperCase()),
    packMissing, mine, chance, expectedDraws,
    expectedCoins: Math.round(expectedDraws * BUFFIE_COST.coins),
    expectedPp: Math.round(expectedDraws * BUFFIE_COST.pp),
    complete: false,
  };
}
