// ─── Per-brawler guide content ───────────────────────────────────────────────
// The hand-written half of a brawler guide page: combat stats, per-mode build
// recommendations, aim/gadget/star-power/hypercharge tips, synergies, map notes
// and "how to counter" copy.
//
// This is deliberately separate from extendedGuides.js — that file GENERATES a
// guide for all 105 brawlers from class archetypes, while this one holds
// specific, earned knowledge that only exists where someone wrote it. A
// brawler with no entry here renders the generated guide alone rather than
// filler: an absent section is honest, a generic one pretends to know something.
//
// Ability NAMES and art always come from brawlerMeta.json (synced from the
// Brawlify API) — only the recommendation and the reasoning live here, keyed by
// the official name. That way a rework that renames a gadget shows up as a
// missing recommendation instead of silently describing an ability that no
// longer exists.

import GENERAL_TIER_LIST from "./generalTierList.json";
import { hasHypercharge } from "./brawlerTile";

const norm = (k) => (k || "").toUpperCase().trim();

// ── Tier classification ──────────────────────────────────────────────────────
// The guide page's headline rating is our own tier list, not an invented
// "meta score". The general list is the owner's hand-curated ranking and is
// still empty (see generalTierList.json), so until it's filled every brawler
// falls back to the placeholder below and the UI labels it provisional. The
// moment a brawler is added to the JSON the real tier wins, no code change.
const PLACEHOLDER_TIER = "S";

export function getGeneralTier(key) {
  const k = norm(key);
  for (const [tier, keys] of Object.entries(GENERAL_TIER_LIST)) {
    if (tier.startsWith("_") || !Array.isArray(keys)) continue;
    if (keys.some(entry => norm(entry) === k)) return { tier, provisional: false };
  }
  return { tier: PLACEHOLDER_TIER, provisional: true };
}

// ── Power-level scaling ──────────────────────────────────────────────────────
// Brawl Stars scales health and damage linearly: each power level adds 5% of
// the POWER-1 base, so Power 11 is base x1.5. Guides quote Power 11 because
// that's the only level ranked play happens at, so that's what we store — the
// lower levels are derived, and the UI says so. `scaled: false` marks the stats
// that don't move with power level (range, speed, ammo count, reload).
const POWER_MULTIPLIER = { 11: 1.5, 9: 1.4, 6: 1.25, 1: 1 };

export function scaleStatValue(power11Value, power) {
  const factor = (POWER_MULTIPLIER[power] ?? 1.5) / 1.5;
  // The game rounds scaled health/damage to the nearest 20.
  return Math.round((power11Value * factor) / 20) * 20;
}

export const POWER_LEVELS = [11, 9, 6, 1];

// ── Guide content ────────────────────────────────────────────────────────────
const GUIDES = {
  BROCK: {
    subclass: "Damage Dealer",

    // Power-11 reference values. `scaled` entries are recomputed by the power
    // selector; the rest are level-invariant.
    combatStats: [
      { label: "Max Health", value: 6000, scaled: true },
      { label: "Damage / Rocket", value: 2320, scaled: true },
      { label: "Super Damage", value: 1200, scaled: true },
      { label: "Projectiles", value: 1 },
      { label: "Ammo", value: 3 },
      { label: "Attack Range", value: "9 tiles", tag: "Long" },
      { label: "Super Range", value: "9 tiles" },
      { label: "Movement Speed", value: 720, tag: "Normal" },
      { label: "Projectile Speed", value: 2700 },
      { label: "Reload Speed", value: "2.1s" },
      { label: "Attack Spread", value: "Single shot" },
      { label: "Subclass", value: "Damage Dealer" },
    ],

    // Build recommendations keyed by the OFFICIAL ability name in
    // brawlerMeta.json. "General" is the fallback tab; mode tabs only render
    // for modes we actually have map data for.
    builds: {
      General: {
        starPower: "Rocket No. 4",
        gadget: "Rocket Laces",
        gears: ["Speed", "Shield"],
        note: "The all-purpose setup: a fourth rocket for uptime and Laces as the panic button against dives.",
      },
      heist: {
        starPower: "More Rockets",
        gadget: "Rocket Fuel",
        gears: ["Damage", "Shield"],
        note: "Heist is the one mode where the safe never moves — More Rockets converts that into raw safe damage, and Rocket Fuel opens the lane to reach it.",
      },
      knockout: {
        starPower: "Rocket No. 4",
        gadget: "Rocket Laces",
        gears: ["Speed", "Shield"],
        note: "One life per round means surviving the dive matters more than damage. Four rockets keeps you covered through a full engage; Laces gets you out of the one that lands.",
      },
      bounty: {
        starPower: "Rocket No. 4",
        gadget: "Rocket Laces",
        gears: ["Speed", "Vision"],
        note: "Long sightlines suit Brock — the extra ammo lets you contest every peek, and Vision catches the bush flank that would otherwise end your star streak.",
      },
      brawlBall: {
        starPower: "Rocket No. 4",
        gadget: "Rocket Laces",
        gears: ["Shield", "Speed"],
        note: "You're not carrying the ball. Sit off the ball path, punish the carrier's approach, and keep Laces for whoever breaks through.",
      },
      gemGrab: {
        starPower: "Rocket No. 4",
        gadget: "Rocket Laces",
        gears: ["Shield", "Vision"],
        note: "Mid is cramped and bushy — Brock's worst geometry. Play the lane, not the mine, and let a teammate hold gems.",
      },
      hotZone: {
        starPower: "More Rockets",
        gadget: "Rocket Fuel",
        gears: ["Shield", "Damage"],
        note: "The zone is a fixed target the enemy has to stand on, which is exactly what More Rockets wants. Brock is still a weak Hot Zone pick overall — see the mode numbers below.",
      },
    },

    // Ability-specific reasoning, keyed by official name.
    abilityNotes: {
      "Rocket No. 4": { pick: "main", body: "A fourth ammo slot is the biggest upgrade to Brock's uptime. More shots means more wall-breaking, more pre-fires into chokes, and a real answer when someone dives you — three rockets often isn't enough to stop a tank, four usually is." },
      "More Rockets": { pick: "situational", body: "Adds rockets to the Rocket Rain super. Strong where the super lands on a fixed objective the enemy can't leave — the Heist safe, a Hot Zone circle — but on maps where you mostly use the super to open walls, the extra ammo does more." },
      "Rocket Laces": { pick: "main", body: "The escape button. Brock's whole weakness is that anything reaching him kills him, and Laces answers exactly that — it launches you out of the dive and damages whatever jumped in. Hold it for the assassin; using it to reposition is how you die to the next Mortis." },
      "Rocket Fuel": { pick: "situational", body: "A single mega rocket that breaks walls on impact. Take it when the map's win condition is opening a specific wall fast — otherwise your super already does that, and Laces keeps you alive to use it." },
    },

    // The guide tabs. `videos` are owner-supplied clips in public/guides/brock/
    // (see videoBase); each has its own short label. The Pro Gameplay tab
    // collects the "Pro" clips (the dodging one lives in the counter section).
    guideTabs: [
      {
        key: "aim", label: "Aim",
        tips: [
          { lead: "Lead the target, don't chase it.", rest: "The rocket travels at 2,700 speed on a fixed path — aim where they'll be, not where they are. At max range that's about a full body-width ahead of anyone strafing." },
          { lead: "Use walls as aim assist.", rest: "A rocket that hits a wall still explodes and the splash reaches around it. Against someone hugging cover, aim at the wall edge beside them rather than the sliver of body you can see." },
          { lead: "Pre-fire the choke.", rest: "Because the shot is slow, firing at a choke before they cross beats reacting after. Keep one rocket permanently in flight toward the lane they want." },
          { lead: "No falloff — hold your ground.", rest: "A point-blank rocket hits as hard as a max-range one. When an assassin closes, don't panic-retreat while shooting: plant, aim at their feet, and the splash usually wins the trade." },
          { lead: "Keep one in reserve.", rest: "Disengage with at least one rocket left. An empty Brock walking backwards is free; a Brock with one shot still zones the chaser." },
        ],
        videos: [{ src: "aim-tips", label: "Leading your shots" }],
      },
      {
        key: "gadget", label: "Gadget",
        tips: [
          { lead: "Rocket Laces is a defensive button.", rest: "It launches you up and damages what's underneath. The correct trigger is 'someone reached me', not 'I want to be over there' — spending it on movement leaves you naked for the next dive." },
          { lead: "Jump the telegraphed engage.", rest: "Against Mortis, Edgar or Kenji the dive is visible a beat before it lands. Laces at that moment turns their commitment into your free hit." },
          { lead: "Rocket Fuel is a map tool.", rest: "When you run it, spend it on the wall that protects their comfort position — not on chip damage. The sightline it opens lasts the rest of the round." },
        ],
        videos: [
          { src: "gadget1-kill-confirm", label: "Gadget 1 · Rocket Laces — kill confirm" },
          { src: "gadget1-shot-reset", label: "Gadget 1 · Rocket Laces — shot reset" },
          { src: "gadget2-shot-reset", label: "Gadget 2 · Rocket Fuel — shot reset" },
          { src: "gadget2-surprise", label: "Gadget 2 · Rocket Fuel — surprise trick" },
        ],
      },
      {
        key: "starpower", label: "Star Power",
        tips: [
          { lead: "Rocket No. 4 is the default.", rest: "The fourth rocket is uptime, and uptime is how a marksman converts range into pressure. It's the right answer on the large majority of maps." },
          { lead: "Swap to More Rockets on fixed objectives.", rest: "Heist and Hot Zone give you a target that can't move. That's the only condition where super damage beats having another rocket in the chamber." },
          { lead: "Count their reload, not yours.", rest: "With four rockets you win reload wars against every three-ammo marksman. Track when their last shot goes out and take the window." },
        ],
        videos: [{ src: "starpower2-trick", label: "Star Power 2 · More Rockets — trick" }],
      },
      {
        key: "hyper", label: "Hyper",
        tips: [
          { lead: "Bait first, then fire.", rest: "A hypercharged Rocket Rain on an empty tile is worthless. Force the enemy onto the objective before you spend it — the widened area only matters if someone is standing in it." },
          { lead: "It still breaks walls.", rest: "Opening a sightline and threatening lethal in the same button is what makes the hyper swing whole rounds, not just fights." },
          { lead: "Don't hold it forever.", rest: "An unspent hypercharge at the end of a round did nothing. If the perfect window never comes, take the second-best one." },
        ],
        videos: [{ src: "hyper-tip", label: "Hypercharge timing" }],
      },
      {
        key: "pro", label: "Pro Gameplay",
        tips: [
          { lead: "Watch the spacing.", rest: "Notice how the pros never let a target inside their comfort band — every rotation keeps a wall or their team between them and the flank." },
          { lead: "Super economy.", rest: "The hypercharge windows below are earned by patient chip damage, not forced — the barrage only comes out when the objective forces the enemy to hold still." },
        ],
        videos: [
          { src: "pro-aim", label: "Pro aim & positioning" },
          { src: "pro-hyper", label: "Pro hypercharge" },
          { src: "pro-hyper-2", label: "Pro hypercharge · #2" },
        ],
      },
    ],

    // Base path for the owner-supplied clips (transcoded to muted H.264 loops).
    videoBase: "/guides/brock",
    // The dodging clip belongs to the counter section, not the guide tabs.
    counterVideo: { src: "pro-dodge", label: "Dodging Brock's rockets" },

    // Brock-specific notes on OUR ranked maps. Maps without a note fall back to
    // the live win rate alone rather than inventing advice.
    mapNotes: {
      "Safe Zone": "The best Brock map in the pool. There's no cover to close through, so you post at max range and chip the safe every reload — take More Rockets and Rocket Fuel here.",
      "Out in the Open": "Long open sightlines and a back wall worth breaking. Open it early so they can't spawn-trap you, then hold the angle.",
      "Flaring Phoenix": "Mid wants a sniper and Brock qualifies. Play the centre lane, use the poison gas as a zoning partner, and don't contest the left thrower pocket.",
      "Belle's Rock": "Play from the back rock formations and poke whoever peeks first. Rico is the pick you're answering — your range wins that neutral as long as you don't wander into the open middle.",
      "New Horizons": "Back-wall camping decides this map. You ARE the wall break, so open the sightline your snipers need and the rest of the round gets easier.",
      "Layer Cake": "Strong here despite the map's anti-sniper reputation — just don't reveal Brock early. He's a fine last pick once their dive is on the board.",
      "Kaboom Canyon": "Fire down the long central corridor and fall back the instant a diver commits. Don't over-draft snipers alongside you.",
      "Hot Potato": "Defensive anchor map. You're the follow-up damage behind the frontline, not the frontline.",
    },

    // Synergy DATA is live — the page reads Brock's per-teammate win rate from
    // brawler_intelligence.with_brawler and ranks it. These are only the
    // hand-written reasons for the teammates that tend to top that list; any
    // teammate without one falls back to a class-derived line.
    synergyReasons: {
      BOLT: "A tank frontline that also slows and stuns — Bolt holds the aggro and the space so Brock is never the closest target, then locks down whoever tries to close in.",
      SPROUT: "Two zoners stacking walls and chip. Sprout's hedge splits the map into lanes Brock already dominates, and neither of them wants to be approached.",
      PEARL: "Pearl punishes exactly the divers that punish Brock — hand her the frontline duel and poke over the top while the assassin is busy.",
      DAMIAN: "A tank frontline means Brock is never the closest target — the single condition his whole kit depends on.",
      "8-BIT": "Two immobile long-range carries, but 8-Bit's damage booster turns Brock's already-safe poke into lethal chip from range nobody can close.",
      SURGE: "Surge takes the flanks and snowballs while Brock owns the lane — his mobility covers the one thing Brock can't, the enemy who gets in.",
      "STARR NOVA": "Starr Nova's zoning and Brock's wall-breaking split the map from both sides, leaving the enemy nowhere to hold.",
      GENE: "Gene's pull drags enemies out of cover into the open, which is exactly the geometry Brock's splash wants.",
      BYRON: "Heals and damage amp stack with Brock's range — safe chip turns into a two-person siege the enemy can't approach without eating both.",
      POCO: "Passive area healing keeps Brock topped up while he holds max range, letting him contest a lane far longer than his health alone allows.",
    },

    counterTips: [
      { lead: "Close the gap fast or not at all.", rest: "Brock has no answer at close range, but a slow walk-up gets punished every reload. Use a dash, jump or blast to skip his comfort band entirely — don't stroll into it." },
      { lead: "Break line of sight, don't just juke.", rest: "His splash still catches you near walls and bush edges. Commit to full cover, not partial, before you reset." },
      { lead: "Punish the reload window.", rest: "After his last rocket he's defenceless for a beat — that's the moment to engage, not while he still has ammo. Note that Rocket No. 4 gives him four, so count carefully." },
      { lead: "Bait Rocket Laces before committing.", rest: "If the gadget is already spent, his escape is gone and a second engage right after is far safer. Force it with a fake dive if you have to." },
      { lead: "Take his walls away.", rest: "Brock wants long lanes. Fighting him in bush-heavy, broken-up terrain removes the sightlines his damage depends on." },
    ],
  },
};

export function getBrawlerGuide(key) {
  const k = norm(key);
  const g = GUIDES[k];
  if (!g) return null;
  // The hypercharge tab only means something for brawlers that have one —
  // brawlerTile.js already tracks that, so don't duplicate the list here.
  return {
    ...g,
    guideTabs: hasHypercharge(k) ? g.guideTabs : g.guideTabs.filter(t => t.key !== "hyper"),
  };
}

export const hasBrawlerGuide = (key) => Boolean(GUIDES[norm(key)]);
