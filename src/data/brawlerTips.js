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
  // Power 11 is the authored figure — return it EXACTLY. The nearest-20
  // rounding below approximates how the game rounds derived lower levels, and
  // applying it at Power 11 silently corrupted hand-entered values that aren't
  // multiples of 20 (696 burn showed as 700, 5358 hyper as 5360).
  if (factor === 1) return power11Value;
  return Math.round((power11Value * factor) / 20) * 20;
}

export const POWER_LEVELS = [11, 9, 6, 1];

// ── Guide content ────────────────────────────────────────────────────────────
const GUIDES = {
  BROCK: {
    subclass: "Damage Dealer",

    // Power-11 reference values. `scaled` entries are recomputed by the power
    // selector; the rest are level-invariant.
    // Composite figures use `parts` + `tpl` so every number inside them scales
    // with the power selector, not just the headline (same for `tagParts`).
    combatStats: [
      { label: "Max Health", value: 6000, scaled: true, tagTpl: "+{0} with Shield Gear", tagParts: [900] },
      { label: "Damage / Rocket", value: 2320, scaled: true },
      { label: "Burn Damage", value: 696, scaled: true, tag: "Rocket Fuel / super burn" },
      { label: "Super Damage", tpl: "9 × {0}", parts: [2080], scaled: true, tagTpl: "{0} if every rocket lands", tagParts: [18720] },
      { label: "Hyper Damage", value: 5358, scaled: true, tagTpl: "{0} main + {1} × 2 splash", tagParts: [2436, 1461] },
      { label: "Projectiles", value: 1 },
      { label: "Ammo", value: 3 },
      { label: "Attack Range", value: "9 tiles", tag: "Long" },
      { label: "Super Range", value: "9 tiles" },
      { label: "Movement Speed", value: 720, tag: "Normal" },
      { label: "Projectile Speed", value: 2700 },
      { label: "Reload Speed", value: "2.1s" },
      { label: "Attack Spread", value: "Single shot" },
      { label: "Subclass", value: "Marksman" },
    ],

    // Build recommendations keyed by the OFFICIAL ability name in
    // brawlerMeta.json. "General" is the fallback tab; mode tabs only render
    // for modes we actually have map data for.
    builds: {
      General: {
        starPower: "Rocket No. 4",
        gadget: "Rocket Laces",
        gears: ["Shield", "Damage"],
        note: "The all-purpose setup: a fourth rocket for uptime and Laces as the panic button against dives.",
        gearNote: "On bushy maps, swap Damage for Speed Gear.",
      },
      bounty: {
        starPower: "Rocket No. 4",
        gadget: "Rocket Laces",
        gears: ["Shield", "Damage"],
        note: "Same as general. Laces is the default — but if their comp has no aggro at all, Rocket Fuel is fine here.",
        gearNote: "On bushy maps, swap Damage for Speed Gear.",
      },
      knockout: {
        starPower: "Rocket No. 4",
        gadget: "Rocket Laces",
        gears: ["Shield", "Damage"],
        note: "Same as general. Laces is the default — but if their comp has no aggro at all, Rocket Fuel is fine here.",
        gearNote: "On bushy maps, swap Damage for Speed Gear.",
      },
      heist: {
        starPower: "Rocket No. 4",
        gadget: "Rocket Fuel",
        gears: ["Shield", "Damage"],
        note: "Always Rocket No. 4 here — never More Rockets. Use the extra range to chip the safe from where they can't reach you. Rocket Fuel opens the lane in.",
        gearNote: "On bushy maps, swap Damage for Speed Gear.",
      },
      hotZone: {
        starPower: "More Rockets",
        gadget: "Rocket Fuel",
        gears: ["Shield", "Damage"],
        note: "One of only two modes for Rocket Fuel — but if they have aggro your comp can't answer, take Laces instead.",
        gearNote: "On bushy maps, swap Damage for Speed Gear.",
      },
      brawlBall: {
        starPower: "More Rockets",
        gadget: "Rocket Laces",
        gears: ["Shield", "Damage"],
        note: "More Rockets here. Laces lets you play the aggressive goal tricks below.",
        gearNote: "On bushy maps, swap Damage for Speed Gear.",
      },
      gemGrab: {
        starPower: "More Rockets",
        gadget: "Rocket Laces",
        gears: ["Shield", "Damage"],
        note: "More Rockets here. Brock is a weak Gem Grab pick regardless — see the mode note below.",
        gearNote: "On bushy maps, swap Damage for Speed Gear.",
      },
    },

    // Ability-specific reasoning, keyed by official name.
    abilityNotes: {
      "Rocket No. 4": { pick: "main", body: "A fourth ammo slot is the biggest upgrade to Brock's uptime. More shots means more wall-breaking, more pre-fires into chokes, and a real answer when someone dives you — three rockets often isn't enough to stop a tank, four usually is." },
      "More Rockets": { pick: "situational", body: "Adds rockets to the Rocket Rain super. Strong where the super lands on a fixed objective the enemy can't leave — the Heist safe, a Hot Zone circle — but on maps where you mostly use the super to open walls, the extra ammo does more." },
      "Rocket Laces": { pick: "main", body: "The escape button. Brock's whole weakness is that anything reaching him kills him, and Laces answers exactly that — it launches you out of the dive and damages whatever jumped in. Hold it for the assassin; using it to reposition is how you die to the next Mortis." },
      "Rocket Fuel": { pick: "situational", body: "A single mega rocket that breaks walls on impact. Take it when the map's win condition is opening a specific wall fast — otherwise your super already does that, and Laces keeps you alive to use it." },
    },

    // The guide tabs. Each TIP carries its own clips so the text sits beside
    // the footage that demonstrates it (side by side on desktop, text above
    // video on mobile) rather than in a separate column. Per tip:
    //   header     — starts a labelled sub-group and restarts the numbering
    //   videos     — clips demonstrating the tip itself
    //   note       — an italic follow-up tip, with its own optional noteVideos
    //   block      — a titled figures table (damage breakdowns)
    // A tab-level `intro` renders above the first tip.
    guideTabs: [
      {
        key: "aim", label: "Aim",
        tips: [
          {
            lead: "Lead the target, don't chase it.",
            rest: "The rocket travels at 2,700 speed on a fixed path — aim where they'll be, not where they are. At max range that's about a full body-width ahead of anyone strafing. Never shoot with a single rocket: fire two at once, one aimed in front of the enemy and one behind, to cover the most ground.",
            videos: [{ src: "aim-tips", label: "Aim where they'll be and always shoot 2 shots" }],
          },
          {
            lead: "Use walls as aim assist.",
            rest: "A rocket that hits a wall still explodes and the splash reaches around it. Against someone hugging cover, aim at the wall edge beside them rather than the sliver of body you can see.",
            videos: [{ src: "aim-around-the-wall", label: "Around the wall trick" }],
            note: "Tip: you can hit enemies behind a wall as long as they're touching it — the splash reaches through to confirm the kill.",
            noteVideos: [{ src: "aim-behind-the-wall", label: "Behind the wall kill confirm" }],
          },
          { lead: "Pre-fire the choke.", rest: "Because the shot is slow, firing at a choke before they cross beats reacting after. Keep one rocket permanently in flight toward the lane they want." },
          { lead: "No falloff — hold your ground.", rest: "A point-blank rocket hits as hard as a max-range one. When an assassin closes, don't panic-retreat while shooting — move in close on top of them and auto-aim, so even if you go down they're left burning." },
          { lead: "Keep one in reserve.", rest: "Disengage with at least one rocket left. An empty Brock walking backwards is free; a Brock with one shot still zones the chaser." },
        ],
      },
      {
        key: "gadget", label: "Gadget",
        tips: [
          { header: "Gadget 1 · Rocket Laces" },
          {
            lead: "Rocket Laces is a defensive button.",
            rest: "It launches you up and damages what's underneath. The correct trigger is 'someone reached me', not 'I want to be over there' — spending it on movement leaves you naked for the next dive.",
            videos: [
              { src: "gadget1-kill-confirm", label: "Kill confirm" },
              { src: "gadget1-full-health-kill", label: "Full health kill" },
            ],
            note: "When to go aggro: surprise them by jumping over a wall to engage. Land the gadget on top of them and auto-aim the first shot for a guaranteed 3,320 damage. Best when the enemy is below that HP or low on ammo — but never jump on someone holding a disengage (Surge's super, for example).",
            block: {
              title: "Gadget 1 damage guide",
              rows: [
                { label: "Jump + 1 shot", value: "3,320", extra: "+696 burn = 4,016" },
                { label: "Jump + 2 shots", value: "5,640", extra: "+696 burn = 6,336" },
                { label: "Jump + 3 shots", value: "6,960", extra: "+696 burn = 7,656" },
                { label: "Shot → jump + 1 shot", value: "5,640" },
                { label: "With hyper · jump + 1 shot", value: "6,358", extra: "1,000 + 5,358" },
                { label: "With hyper · jump + 2 shots", value: "11,716", extra: "1,000 + 10,716" },
              ],
            },
          },
          {
            lead: "Reset their shots and supers.",
            rest: "Jumping on an enemy resets whatever they were winding up and catches them completely off guard. Watch Bibi's shot get reset.",
            videos: [{ src: "gadget1-shot-reset", label: "Shot reset" }],
          },
          { header: "Gadget 2 · Rocket Fuel" },
          {
            lead: "Rocket Fuel is a map tool.",
            rest: "Spend it on the wall that protects their comfort position — not on chip damage. The sightline it opens lasts the rest of the round. Check the map guide below for the exact wall break on each map.",
            note: "Tip: reset your reload by tapping the gadget immediately after a shot, then firing again. Shot + gadget + shot = 2,320 + 2,000 + 2,320 = 6,640 damage.",
            noteVideos: [{ src: "gadget2-shot-reset", label: "Reload reset" }],
          },
          {
            lead: "Surprise them by breaking the wall open.",
            rest: "Nobody expects an aggressive Brock. Best when the enemy is really close and low on ammo. Wall break + shot = 4,320 damage — though budget 500–1,000 less, because the wall break itself is unpredictable.",
            videos: [{ src: "gadget2-surprise", label: "Engagement trick" }],
          },
        ],
      },
      {
        key: "starpower", label: "Star Power",
        tips: [
          { lead: "Rocket No. 4 is the default.", rest: "The fourth rocket is uptime, and uptime is how a marksman converts range into pressure. It's the right answer on the large majority of maps." },
          {
            lead: "Swap to More Rockets on fixed objectives.",
            rest: "Hot Zone, Brawl Ball and Gem Grab give you targets worth the extra super damage. Heist is the exception — always Rocket No. 4 there, for the range.",
            note: "Tip: with the added movement speed, you can use your super purely to escape an aggro brawler.",
            noteVideos: [{ src: "starpower2-trick", label: "More Rockets trick" }],
          },
          { lead: "Count their reload, not yours.", rest: "With four rockets you win reload wars against every three-ammo marksman. Track when their last shot goes out and take the window." },
        ],
      },
      {
        key: "hyper", label: "Hyper",
        tips: [
          {
            lead: "Be aggressive.",
            rest: "You deal 5,358 per shot if all the rockets align — two shots is 10,716. You can shred almost anyone, but only if you hit. GET CLOSE. Exceptional in combination with Rocket Laces.",
            note: "Tip: use the gadget to jump on top of the enemy and activate the hyper mid-air to catch them completely off guard.",
            noteVideos: [{ src: "hyper-tip", label: "Hypercharge timing" }],
          },
          {
            lead: "Fire the hyper-super just before the hyper ends.",
            rest: "If you activate your super during the hyper you still get the hyper version even after the hyper runs out — and that super charges your next hyper. So don't sit on the hyper waiting for a super: shoot your normal ammo first, and once you're empty, hyper-super.",
          },
          { lead: "Don't hold it forever.", rest: "An unspent hypercharge at the end of a round did nothing. If the perfect window never comes, take the second-best one." },
        ],
      },
      {
        key: "pro", label: "Pro Gameplay",
        intro: "Watch how the pros combine all of these tricks — always firing two shots, the Gadget 2 reload reset, going aggro on hyper, and supering when the enemy has no ammo. Gameplay from the NA July 2026 Monthly Qualifiers.",
        tips: [
          {
            lead: "Watch the spacing.",
            rest: "Notice how the pros never let a target inside their comfort band — every rotation keeps a wall or their team between them and the flank.",
            videos: [{ src: "pro-aim", label: "Pro aim & positioning" }],
          },
          {
            lead: "Super economy.",
            rest: "The hypercharge windows are earned by patient chip damage, not forced — the barrage only comes out when the objective forces the enemy to hold still.",
            videos: [
              { src: "pro-hyper", label: "Pro hypercharge" },
              { src: "pro-hyper-2", label: "Pro hypercharge · #2" },
            ],
          },
        ],
      },
    ],

    // Base path for the owner-supplied clips (transcoded to muted H.264 loops).
    videoBase: "/guides/brock",
    // Counter clips hang off the tip they demonstrate (see counterTips), the
    // same pairing the guide tabs use.

    // Why Brock LOSES these matchups — hand-written for the regulars at the top
    // of his worst-against list; class-derived fallback for the rest. The DATA
    // (win rate, games, ordering) is live from vs_brawler.
    counterReasons: {
      BOLT: "The same tank that carries Brock as a teammate wrecks him across the net — Bolt closes behind his own wall-break, slows the retreat, and out-trades point-blank where Brock can't kite.",
      FINX: "Out-ranges and out-DPSes Brock in the open; his hypercharge shreds an immobile marksman from a distance Brock can't answer.",
      "STARR NOVA": "A space-maker that dives the backline — exactly Brock's blind spot. The mobility skips his comfort band before he gets a second rocket off.",
      ASH: "Builds rage off Brock's own chip and walks him down; sustained frontline pressure Brock can't kite forever on a closed lane.",
      KAZE: "Fast, slippery aggressor that closes the gap and deletes a stationary marksman before the single-shot can track her.",
      MELODIE: "Repeated dashes Brock's one rocket at a time can't track — she's on top of him before the reload, and there's no falloff to save him up close.",
      SURGE: "Snowballs past Brock's range with his upgrades and jumps the wall to reach him; once Surge is charged, Brock's spacing stops mattering.",
      STU: "Dashes on every attack — closes and resets faster than Brock can zone, and ignores the reload window Brock relies on.",
      "8-BIT": "A mirror at longer effective range with a damage booster; in a straight poke war 8-Bit out-values Brock and never has to approach.",
      DAMIAN: "A mobile tank that reaches the backline — Brock's cover comes down and the dive lands before he can reposition.",
    },

    // Owner-supplied map clips. `mapVideos` are keyed by canonical DB map name
    // and show only on that map; `modeVideos` are keyed by mode and show on
    // EVERY map in it (the Brawl Ball goal tricks are general technique, not
    // map-specific). Both resolve against videoBase.
    mapVideos: {
      "Belle's Rock": [
        { src: "map-belles-rock-all-walls", label: "Belle's Rock — All Walls" },
        { src: "map-belles-rock-left-wall", label: "Belle's Rock — Left Wall" },
        { src: "map-belles-rock-right-wall", label: "Belle's Rock — Right Wall" },
        { src: "map-belles-rock-aggro-wall-break", label: "Belle's Rock — Aggro Wall Break" },
      ],
      "Flaring Phoenix": [
        { src: "map-flaring-phoenix-good-wall-break", label: "Flaring Phoenix — Good Wall Break" },
        { src: "map-flaring-phoenix-bad-wall-break", label: "Flaring Phoenix — Bad Wall Break" },
        { src: "map-flaring-phoenix-own-wall-right-block", label: "Flaring Phoenix — Own Wall Right Block" },
      ],
      "New Horizons": [
        { src: "map-new-horizons-wall-break", label: "New Horizons — Wall Break" },
      ],
      "Out in the Open": [
        { src: "map-out-in-the-open-wall-break", label: "Out in the Open — Wall Break" },
      ],
      // Owner-specified order: wall break, then max range, then positioning.
      "Safe Zone": [
        { src: "map-safe-zone-wall-break", label: "Safe Zone — Wall Break" },
        { src: "map-safe-zone-max-range", label: "Safe Zone — Max Safe Range" },
        { src: "map-safe-zone-positioning", label: "Safe Zone — Positioning" },
      ],
      "Hot Potato": [
        { src: "map-hot-potato-best-wall-break", label: "Hot Potato — Best Wall Break" },
        { src: "map-hot-potato-usual-wall-break", label: "Hot Potato — Usual Wall Break" },
        { src: "map-hot-potato-enemy-wall-break", label: "Hot Potato — Enemy Wall Break" },
        { src: "map-hot-potato-max-safe-range-burn", label: "Hot Potato — Max Safe Range (With Burn)" },
        { src: "map-hot-potato-max-safe-range-no-burn", label: "Hot Potato — Max Safe Range (Without Burn)" },
      ],
      "Kaboom Canyon": [
        { src: "map-kaboom-canyon-wall-break", label: "Kaboom Canyon — Wall Break" },
        { src: "map-kaboom-canyon-max-safe-range-burn", label: "Kaboom Canyon — Max Safe Range (With Burn)" },
      ],
      "Bridge Too Far": [
        { src: "map-bridge-too-far-max-safe-range-burn", label: "Bridge Too Far — Max Safe Range (With Burn)" },
        { src: "map-bridge-too-far-max-safe-range-no-burn", label: "Bridge Too Far — Max Safe Range (Without Burn)" },
      ],
      "Layer Cake": [
        { src: "map-layer-cake-wall-break", label: "Layer Cake — Wall Break" },
      ],
      "Ring of Fire": [
        { src: "map-ring-of-fire-wall-break", label: "Ring of Fire — Wall Break" },
      ],
    },
    modeVideos: {
      brawlBall: [
        { src: "mode-brawlball-gadget1-goal-trick", label: "Gadget 1 · Rocket Laces — Goal Trick" },
        { src: "mode-brawlball-gadget2-goal-trick", label: "Gadget 2 · Rocket Fuel — Goal Trick" },
        { src: "mode-brawlball-gadget2-easier-goal-trick", label: "Gadget 2 · Rocket Fuel — Easier Goal Trick" },
      ],
    },

    // Mode-level read, shown above the map pills — whether Brock belongs in the
    // mode at all, before you get to individual maps.
    modeNotes: {
      heist: "Always Rocket No. 4 here, never More Rockets — the extra range is what lets you chip the safe from outside their reach. Chip it every single reload.",
      brawlBall: "Brock can be played far more aggressively here, and the goal tricks below are not optional — if you pick Brock in Brawl Ball you are expected to hit them. Watch the clips closely and drill them. He's mostly a Pinball Dreams pick; check the pick rates per map before locking him elsewhere.",
      gemGrab: "Not really a Brock mode, and the pick rates show it. Griff is the better pick almost every time. If you genuinely need the wall break, Brock is fine — but he cannot be your gem carrier.",
      hotZone: "Avoid Brock here. Ring of Fire is the only map where he's defensible, and even there he's a weak pick. His one real use is opening walls against Penny.",
    },

    // Brock-specific notes on OUR ranked maps. Maps without a note fall back to
    // the live win rate alone rather than inventing advice.
    mapNotes: {
      "Safe Zone": "The best Brock map in the pool. There's no cover to close through, so you post at max range and chip the safe every reload.",
      "Out in the Open": "Long open sightlines and a back wall worth breaking. Open it early so they can't spawn-trap you, then hold the angle.",
      "Flaring Phoenix": "Mid wants a sniper and Brock qualifies. Play the centre lane, use the poison gas as a zoning partner, and don't contest the left thrower pocket.",
      "Belle's Rock": "Play from the back rock formations and poke whoever peeks first. Rico is the pick you're answering — your range wins that neutral as long as you don't wander into the open middle.\n\nPro tip: if you have an aggro like Mina, use the aggro wall break shown below — it gives them a wall to hide behind and creates space for your team. Otherwise destroy all the walls exactly as demonstrated, because the wrong gadget shot leaves one block standing.",
      "New Horizons": "Back-wall camping decides this map. You ARE the wall break, so open the sightline your snipers need and the rest of the round gets easier.",
      "Layer Cake": "Strong here despite the map's anti-sniper reputation — just don't reveal Brock early. He's a fine last pick once their dive is on the board.",
      "Kaboom Canyon": "Fire down the long central corridor and fall back the instant a diver commits. Don't over-draft snipers alongside you.",
      "Hot Potato": "Only pick Brock here if you genuinely need the wall break — Colt and Griff are the better wall-break options on this map. If you do take him, you're the follow-up damage behind the frontline, not the frontline.",
      "Pit Stop": "Don't play Brock here at all. There is no version of this map that wants him.",
      "Bridge Too Far": "A good Brock map. The long bridge lanes are exactly his geometry — sit at max range, chip the safe every reload, and let the burn tick while they try to close.",
      "Dry Season": "Standard Knockout-style play: hold your lane, poke whoever peeks first, and don't walk into the open. There's no specific wall break to learn on this map — run Rocket No. 4 and follow the aim guide above.",
      "Shooting Star": "Standard Knockout-style play: hold your lane, poke whoever peeks first, and don't walk into the open. There's no specific wall break to learn on this map — run Rocket No. 4 and follow the aim guide above.",
      "Hideout": "Standard Knockout-style play: hold your lane, poke whoever peeks first, and don't walk into the open. There's no specific wall break to learn on this map — run Rocket No. 4 and follow the aim guide above.",
      "Ring of Fire": "The only Hot Zone map where Brock is defensible, and he's still a weak pick. His real value is opening walls against Penny.",
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
      {
        lead: "Close the gap fast or not at all.",
        rest: "Brock has no answer at close range, but a slow walk-up gets punished every reload. Use a dash, jump or blast to skip his comfort band entirely — don't stroll into it. Watch how the pros stay between Brock and the end of his rocket's travel, where the shot is easiest to read and dodge.",
        videos: [
          { src: "pro-dodge", label: "Dodging Brock's rockets" },
          { src: "pro-dodge-2", label: "Pro dodge · #2" },
        ],
      },
      { lead: "Break line of sight, don't just juke.", rest: "His splash still catches you near walls and bush edges. Commit to full cover, not partial, before you reset." },
      { lead: "Punish the reload window.", rest: "After his last rocket he's defenceless for a beat — that's the moment to engage, not while he still has ammo. Note that Rocket No. 4 gives him four, so count carefully." },
      { lead: "Bait Rocket Laces before committing.", rest: "If the gadget is already spent, his escape is gone and a second engage right after is far safer. Force it with a fake dive if you have to." },
      { lead: "Overwhelm him.", rest: "He has a slow reload and low damage for a marksman. Swarming him with fast brawlers is the single cleanest way to beat him — check the match-up data above for exactly who." },
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
