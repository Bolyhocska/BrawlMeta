// ─── Per-brawler play tips ───────────────────────────────────────────────────
// The hand-written "how to actually play this brawler" layer of a guide page:
// aiming mechanics, which gadget/star power to run and why, and the hypercharge
// window. This is deliberately separate from extendedGuides.js — that file
// GENERATES a guide for all 105 brawlers from class archetypes, while this one
// holds specific, earned knowledge that only exists where someone wrote it.
//
// A brawler with no entry here renders no tips section at all, rather than a
// filler paragraph — an empty section is honest, a generic one pretends to
// know something. Add brawlers as the guides get written.
//
// Loadout `pick` values: "main" = the default recommendation, "situational" =
// real but narrower, "skip" = trap option. The UI colours them accordingly.

import GENERAL_TIER_LIST from "./generalTierList.json";
import { hasHypercharge } from "./brawlerTile";

const norm = (k) => (k || "").toUpperCase().trim();

// ── Tier classification ──────────────────────────────────────────────────────
// The general tier list is the owner's hand-curated ranking and is still empty
// (see generalTierList.json). Until it's filled, guide pages fall back to the
// placeholder below so the badge has something honest to show; the moment a
// brawler is added to the JSON, the real tier wins automatically with no code
// change. `provisional` drives the UI's "placeholder" caption.
const PLACEHOLDER_TIER = "S";

export function getGeneralTier(key) {
  const k = norm(key);
  for (const [tier, keys] of Object.entries(GENERAL_TIER_LIST)) {
    if (tier.startsWith("_") || !Array.isArray(keys)) continue;
    if (keys.some(entry => norm(entry) === k)) return { tier, provisional: false };
  }
  return { tier: PLACEHOLDER_TIER, provisional: true };
}

// ── Tips ─────────────────────────────────────────────────────────────────────
const TIPS = {
  BROCK: {
    aiming: [
      {
        title: "Lead the target, don't chase it",
        body: "Brock's rocket is slow and travels a fixed path — you aim where the enemy will be, not where they are. At max range that's roughly a full body-width ahead of a strafing target. Against players who juke, fire at the tile they're committed to rather than the one they're standing on.",
      },
      {
        title: "Use walls as aim assist",
        body: "A rocket that hits a wall still explodes, and the splash reaches around it. When an enemy hugs cover, aim at the wall edge beside them instead of the sliver of body you can see — the explosion does the work your accuracy doesn't have to.",
      },
      {
        title: "Fire through your own chokes",
        body: "Because the shot is slow, pre-firing a choke point the enemy has to cross beats reacting to them crossing it. In Heist and Knockout especially, keep one rocket permanently in flight toward the lane they want.",
      },
      {
        title: "Respect the falloff in reverse",
        body: "Brock has no damage falloff, which means a point-blank rocket hits just as hard as a max-range one. If an assassin closes on you, don't panic-retreat while shooting — plant, aim at their feet, and the splash usually wins the trade outright.",
      },
    ],
    starPowers: [
      {
        name: "Rocket No. 4",
        pick: "main",
        body: "A fourth ammo slot is the single biggest upgrade to Brock's uptime. More shots in the chamber means more wall-breaking, more pre-fires into chokes, and a real answer when someone dives you — three rockets often isn't enough to stop a tank, four usually is.",
      },
      {
        name: "More Rockets",
        pick: "situational",
        body: "Adds rockets to the Rocket Rain super. Genuinely strong on maps where the super lands on a fixed objective the enemy can't leave — Hot Zone circles, the Heist safe — but on maps where the super is mostly used to open walls and zone, the extra ammo from Rocket No. 4 does more for you.",
      },
    ],
    gadgets: [
      {
        name: "Rocket Laces",
        pick: "main",
        body: "The escape button. Brock's whole weakness is that anything reaching him kills him, and Laces answers exactly that — it launches you out of the dive and damages whatever jumped in. Hold it for the assassin, not for repositioning; using it to move is how you die to the next Mortis.",
      },
      {
        name: "Rocket Fuel",
        pick: "situational",
        body: "A single mega rocket that breaks walls on impact. Take it when the map's win condition is opening a specific wall fast — otherwise your super already does that, and Laces keeps you alive to use it.",
      },
    ],
    hypercharge: {
      name: "Rocket Rain Hypercharge",
      body: "Brock's hypercharge widens the super's area and speeds up the barrage, turning what was a zoning tool into an actual kill threat on a stationary target. The correct instinct is to stop treating the super as free chip and start saving it for the moment the enemy is committed to standing somewhere — on the safe in Heist, inside the zone, or pinched against a wall in Knockout.",
      tips: [
        "Charge it, then bait. A hypercharged Rocket Rain on an empty tile is worthless — force the enemy onto the objective first.",
        "It still breaks walls. Opening a sightline and threatening lethal at the same time is what makes the hyper swing rounds.",
        "Don't hold it forever. An unspent hypercharge at the end of a round did nothing; spend it on the second-best window if the perfect one never comes.",
      ],
    },
    matchupNotes: [
      { label: "Beats", body: "Throwers and immobile control brawlers — you out-range them and delete the walls they hide behind.", tone: "good" },
      { label: "Struggles into", body: "Anything that closes distance for free: Mortis, Edgar, Kenji, and Max-boosted dives. Save Rocket Laces for exactly these.", tone: "bad" },
      { label: "Wants alongside", body: "A tank or knockback brawler who keeps the frontline honest, so you're never the closest target.", tone: "neutral" },
    ],
  },
};

export function getBrawlerTips(key) {
  const k = norm(key);
  const t = TIPS[k];
  if (!t) return null;
  // The hypercharge block is only meaningful for brawlers that actually have
  // one — brawlerTile.js already tracks that, so don't duplicate the list here.
  return { ...t, hypercharge: hasHypercharge(k) ? t.hypercharge : null };
}

export const hasBrawlerTips = (key) => Boolean(TIPS[norm(key)]);
