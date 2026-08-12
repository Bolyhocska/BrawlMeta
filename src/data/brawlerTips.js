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
// Brawl Stars scales health and damage linearly: each power level adds 10% of
// the POWER-1 base, so Power 11 is base x2. Guides quote Power 11 because
// that's the only level ranked play happens at, so that's what we store — the
// lower levels are derived, and the UI says so. `scaled: false` marks the stats
// that don't move with power level (range, speed, ammo count, reload).
//
// Verified against the community wiki's Power-1 figures: Brock 3,000 health ->
// 6,000 at Power 11, Crow 2,800 -> 5,600, Crow 380 damage/dagger -> 760. An
// earlier x1.5 assumption here made every DERIVED level read too high (Brock
// showed 4,000 at Power 1 instead of 3,000); Power 11 itself was always right
// because it's the stored value.
const POWER_MULTIPLIER = { 11: 2, 9: 1.8, 6: 1.5, 1: 1 };

export function scaleStatValue(power11Value, power) {
  // Stored values are Power 11, so divide by the Power-11 multiplier rather
  // than a hard-coded constant — otherwise changing the scale silently
  // rescales Power 11 itself.
  const factor = (POWER_MULTIPLIER[power] ?? POWER_MULTIPLIER[11]) / POWER_MULTIPLIER[11];
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
    // Power-11 reference values. `scaled` entries are recomputed by the power
    // selector; the rest are level-invariant. Composite figures use `parts` +
    // `tpl` so every number inside them scales too, not just the headline
    // (same for `tagParts`).
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
            note: "Tip: You can hit enemies behind a wall as long as they're touching it — the splash reaches through to confirm the kill.",
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
            note: "When to go aggro: Surprise them by jumping over a wall to engage. Land the gadget on top of them and auto-aim the first shot for a guaranteed 3,320 damage. Best when the enemy is below that HP or low on ammo — but never jump on someone holding a disengage (Surge's super, for example).",
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
            note: "Tip: Reset your reload by tapping the gadget immediately after a shot, then firing again. Shot + gadget + shot = 2,320 + 2,000 + 2,320 = 6,640 damage.",
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
            note: "Tip: With the added movement speed, you can use your super purely to escape an aggro brawler.",
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
            note: "Tip: Use the gadget to jump on top of the enemy and activate the hyper mid-air to catch them completely off guard.",
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
      // `kind` splits the clips into a DO / DON'T pair of groups so the bad
      // wall breaks read as warnings rather than options.
      "Belle's Rock": [
        { src: "map-belles-rock-all-walls", label: "Break every wall", kind: "do" },
        { src: "map-belles-rock-aggro-wall-break", label: "Aggro wall break — leaves them cover", kind: "do" },
        { src: "map-belles-rock-left-wall", label: "Bad break — left wall only, one block left", kind: "dont" },
        { src: "map-belles-rock-right-wall", label: "Bad break — right wall only, one block left", kind: "dont" },
      ],
      "Flaring Phoenix": [
        { src: "map-flaring-phoenix-good-wall-break", label: "Good wall break", kind: "do" },
        { src: "map-flaring-phoenix-own-wall-right-block", label: "Keep your own right block", kind: "do" },
        { src: "map-flaring-phoenix-bad-wall-break", label: "Bad wall break", kind: "dont" },
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
      knockout: "One of Brock's best modes. There are no respawns, so his job is to hold a lane from max range and win the opening trade before anyone can close. Break the wall that protects their camping spot early, then never walk into the open middle — every round you survive at range is a round your team plays 3v2.",
      bounty: "A strong Brock mode for the same reason as Knockout: long sightlines and a heavy price on dying. Take a side lane, poke whoever peeks, and let the stars come from patient chip rather than pushes. Retreat with ammo in hand — a Brock who dies for one star hands the whole lead back.",
      heist: "Always Rocket No. 4 here, never More Rockets — the extra range is what lets you chip the safe from outside their reach. Chip it every single reload.",
      brawlBall: "Brock can be played far more aggressively here, and the goal tricks below are not optional — if you pick Brock in Brawl Ball you are expected to hit them. Watch the clips closely and drill them. He's mostly a Pinball Dreams pick; check the pick rates per map before locking him elsewhere.",
      gemGrab: "Not really a Brock mode, and the pick rates show it. Griff is the better pick almost every time. If you genuinely need the wall break, Brock is fine — but he cannot be your gem carrier.",
      hotZone: "Avoid Brock here. Ring of Fire is the only map where he's defensible, and even there he's a weak pick. His one real use is opening walls against Penny.",
    },

    // Brock-specific notes on OUR ranked maps. Maps without a note fall back to
    // the live win rate alone rather than inventing advice.
    mapNotes: {
      "Safe Zone": "The best Brock map in the pool. Take a side lane and post at the very edge of your range — there's no cover for them to close through, so your job is simply to chip the safe every reload and never let anyone reach you. Rocket Fuel opens the lane in; Rocket No. 4 keeps the chip flowing.",
      "Out in the Open": "Long open sightlines and a back wall worth breaking. Open it early so they can't spawn-trap you, then hold the angle.",
      "Flaring Phoenix": "Mid wants a sniper and Brock qualifies. Play the centre lane, use the poison gas as a zoning partner, and don't contest the left thrower pocket.",
      "Belle's Rock": "Play from the back rock formations and poke whoever peeks first. Rico is the pick you're answering — your range wins that neutral as long as you don't wander into the open middle.\n\nPro tip: If you have an aggro like Mina, use the aggro wall break shown below — it gives them a wall to hide behind and creates space for your team. Otherwise destroy all the walls exactly as demonstrated, because the wrong gadget shot leaves one block standing.",
      "New Horizons": "Back-wall camping decides this map. Take a side lane and open the back wall early — you ARE the wall break, so the sightline you create is what lets your snipers work for the rest of the round. Once it's open, hold the angle and punish anyone crossing.",
      "Layer Cake": "Strong here despite the map's anti-sniper reputation — just don't reveal Brock early. He's a fine last pick once their dive is on the board. Play a side lane, break the wall that shields their mid control, and poke from behind your own cover.",
      "Kaboom Canyon": "Fire down the long central corridor and fall back the instant a diver commits. Your job is defence-to-offence: hold the lane until the safe is exposed, then chip it. Don't over-draft snipers alongside you.",
      "Hot Potato": "Only pick Brock here if you genuinely need the wall break — Colt and Griff are the better wall-break options on this map. If you do take him, you're the follow-up damage behind the frontline, not the frontline.",
      "Pit Stop": "Don't play Brock here at all. There is no version of this map that wants him.",
      "Bridge Too Far": "A good Brock map. The long bridge lanes are exactly his geometry — sit at max range, chip the safe every reload, and let the burn tick while they try to close. Take a bridge lane and hold it; you're the safe DPS, not a defender.",
      "Dry Season": "Standard Bounty play: take a side lane, poke whoever peeks first, and don't walk into the open middle. There's no specific wall break to learn here — run Rocket No. 4 and follow the aim guide above. Watch for Sprout, Kit or Bolt on their last pick.",
      "Shooting Star": "Standard Bounty play: take a side lane, poke whoever peeks first, and don't walk into the open middle. There's no specific wall break to learn here — run Rocket No. 4 and follow the aim guide above. Dual ranged works well on this map, so you're rarely the only long-range pick.",
      "Hideout": "Standard Bounty play: take a side lane, poke whoever peeks first, and don't walk into the open middle. There's no specific wall break to learn here — run Rocket No. 4 and follow the aim guide above. Expect to be banned or contested; Brock is a priority pick on this map.",
      "Ring of Fire": "The only Hot Zone map where Brock is defensible, and he's still a weak pick. His real value is opening walls against Penny — break her cover, then hold range off the zone rather than trying to contest it yourself.",
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

  CROW: {
    // Base figures from the community wiki's Power-1 stat block, scaled x1.5 to
    // Power 11 (the level ranked is played at) so they match how the rest of
    // the page reads. The combo numbers in the gadget tips are the owner's own
    // measurements and are shown as authored.
    combatStats: [
      { label: "Max Health", value: 5600, scaled: true, tagTpl: "+{0} with Shield Gear", tagParts: [900] },
      { label: "Damage / Dagger", value: 760, scaled: true, tag: "3 daggers per shot" },
      { label: "Full Attack", tpl: "3 × {0}", parts: [760], scaled: true, tagTpl: "{0} if all three land", tagParts: [2280] },
      { label: "Poison Damage", value: 160, scaled: true, tag: "per tick" },
      { label: "Healing Reduction", value: "50%", tag: "while poisoned" },
      { label: "Super Damage", tpl: "14 × {0}", parts: [640], scaled: true, tagTpl: "{0} if every dagger lands", tagParts: [8960] },
      { label: "Slowing Toxin", value: 2560, scaled: true, tagTpl: "+{0} poison", tagParts: [320] },
      { label: "Attack Range", value: "8.67 tiles", tag: "Long" },
      { label: "Super Range", value: "8.67 tiles" },
      { label: "Movement Speed", value: 820, tag: "Very Fast · 984 on hyper" },
      { label: "Reload Speed", value: "1.6s", tag: "Normal" },
      { label: "Attack Spread", value: "20.25°" },
      { label: "Gadget Charges", value: 3 },
      { label: "Subclass", value: "Assassin" },
    ],

    builds: {
      General: {
        starPower: "Carrion Crow",
        gadget: "Instapoison",
        gears: ["Shield", "Damage"],
        note: "The all-purpose Crow setup, and it plays on every mode and every map. Instapoison is the safer default — it converts your poison into instant damage and hands you a shield on demand.",
        gearNote: "Shield Gear always. On bushy maps swap Damage for Speed — never Vision Gear, it does nothing for Crow.",
      },
      brawlBall: {
        starPower: "Carrion Crow",
        gadget: "Slowing Toxin",
        gears: ["Shield", "Damage"],
        note: "Brawl Ball is where we'd actively recommend the kunai over Instapoison — you're playing closer, and the slow both peels for you and sets up the score.",
        gearNote: "Shield Gear always. On bushy maps swap Damage for Speed — never Vision Gear, it does nothing for Crow.",
      },
      bounty: {
        starPower: "Carrion Crow", gadget: "Instapoison", gears: ["Shield", "Damage"],
        note: "Same as general. Pros lean toward Slowing Toxin on open maps and into aggro comps — worth trying both to see which you prefer.",
        gearNote: "Shield Gear always. On bushy maps swap Damage for Speed — never Vision Gear, it does nothing for Crow.",
      },
      knockout: {
        starPower: "Carrion Crow", gadget: "Instapoison", gears: ["Shield", "Damage"],
        note: "Same as general. Pros lean toward Slowing Toxin on open maps and into aggro comps — worth trying both to see which you prefer.",
        gearNote: "Shield Gear always. On bushy maps swap Damage for Speed — never Vision Gear, it does nothing for Crow.",
      },
      heist: {
        starPower: "Carrion Crow", gadget: "Instapoison", gears: ["Shield", "Damage"],
        note: "Same as general. Instapoison keeps you alive in mid while you farm super off chip damage.",
        gearNote: "Shield Gear always. On bushy maps swap Damage for Speed — never Vision Gear, it does nothing for Crow.",
      },
      gemGrab: {
        starPower: "Carrion Crow", gadget: "Instapoison", gears: ["Shield", "Damage"],
        note: "Same as general. The Instapoison shield is what lets you hold gems through a dive.",
        gearNote: "Shield Gear always. On bushy maps swap Damage for Speed — never Vision Gear, it does nothing for Crow.",
      },
      hotZone: {
        starPower: "Carrion Crow", gadget: "Instapoison", gears: ["Shield", "Damage"],
        note: "Same as general. Pros lean toward Slowing Toxin on the more open zones and into aggro comps.",
        gearNote: "Shield Gear always. On bushy maps swap Damage for Speed — never Vision Gear, it does nothing for Crow.",
      },
    },

    abilityNotes: {
      "Carrion Crow": { pick: "main", body: "Extra damage on anything already below the health threshold — with your poison ticking on everything you touch, targets slide into that window constantly. This is the default star power; take it everywhere." },
      "Extra Toxic": { pick: "situational", body: "Poisoned enemies deal less damage. Real value into heavy-damage comps, but it does nothing to help you finish a target, and finishing is Crow's whole job." },
      "Instapoison": { pick: "main", body: "Dumps all remaining poison damage instantly and shields you for part of it. Two jobs in one button — the burst that confirms a kill, and the panic shield that survives a burst." },
      "Slowing Toxin": { pick: "situational", body: "A kunai that damages, slows and poisons. Mainly defensive — it makes committing to you expensive — but it is the pick in Brawl Ball, and pros prefer it on open maps and into aggro." },
    },

    videoBase: "/guides/crow",

    guideTabs: [
      {
        key: "aim", label: "Aim",
        intro: "Crow fires three daggers in a spread. Almost everything about aiming him comes down to landing more than one dagger per shot — that single habit roughly doubles your damage.",
        tips: [
          {
            lead: "Never aim straight at them.",
            rest: "Aiming dead-on lands only the middle dagger. Aim at a slight angle — roughly 15–30° off centre — so two daggers connect instead of one.",
            videos: [
              { src: "aim-correct", label: "Correct aim — 2 hits per shot", kind: "do" },
              { src: "aim-wrong", label: "Wrong aim — 1 hit per shot", kind: "dont" },
            ],
          },
          {
            lead: "Around cover, aim past the edge.",
            rest: "Don't aim directly at someone behind a wall. Line the outside dagger up so it just clears the corner — that spreads the rest of the volley across the ground they have to move through.",
            videos: [{ src: "aim-around-walls", label: "Wrong and correct way to shoot around walls" }],
          },
        ],
      },
      {
        key: "gadget", label: "Gadget",
        tips: [
          { header: "Gadget 1 · Instapoison" },
          {
            lead: "Count four ticks, then reset.",
            rest: "Let the poison run about 4 seconds — four ticks — before firing Instapoison. That maximises the window where the enemy cannot heal. Count it in your head, or watch your super bar: every tick charges it slightly.",
            videos: [{ src: "gadget1-chip", label: "Using Gadget 1 to chip — press after 4s" }],
            block: {
              title: "Instapoison burst",
              rows: [
                { label: "1 dagger hit + gadget", value: "2,040" },
                { label: "2 dagger hits + gadget", value: "2,800" },
                { label: "3 dagger hits + gadget", value: "3,560" },
              ],
            },
            note: "Use these numbers to plan the kill — if the target is under the threshold, the gadget finishes them on its own.",
          },
          {
            lead: "It is also a panic shield.",
            rest: "Low on health, fire it right before their shot lands and you tank a hit you had no business surviving. One dagger hit plus an instant gadget is a 912 shield.",
            videos: [{ src: "gadget1-survivability", label: "Gadget 1 survivability" }],
          },
          { header: "Gadget 2 · Slowing Toxin" },
          {
            lead: "Reset your reload with it.",
            rest: "Shoot, tap the gadget, shoot again — the kunai's poison is a separate instance from your attack poison, so the two stack. That chain is 4,520 damage.",
            videos: [{ src: "gadget2-shot-reset", label: "Gadget 2 shot reset" }],
          },
          {
            lead: "Go offensive only when they group.",
            rest: "The kunai is a defensive tool by default. The exception is when the enemy team is bunched together and you're on high health — then it's free value.",
            videos: [{ src: "gadget2-situational", label: "Situational shot — enemy grouped up" }],
          },
          {
            lead: "Bait the dive with it.",
            rest: "At low health, sit at the distance that tempts an aggro brawler to commit. When they do, back off while shooting — that's an instant 4,520 minimum on someone who can no longer disengage.",
            videos: [{ src: "gadget2-defensive", label: "Gadget 2 as a defensive tool" }],
          },
        ],
      },
      {
        key: "starpower", label: "Star Power & Super",
        tips: [
          { header: "Star Power" },
          {
            lead: "Always Carrion Crow.",
            rest: "Take the damage star power everywhere. Your poison is constantly pushing targets under the health threshold, so the bonus is close to permanently active — and it applies to your super as well as your attack.",
          },
          { header: "Super · Ult" },
          {
            lead: "Never auto-aim the super.",
            rest: "Auto-aim centres the dive and most of the daggers miss. Aim slightly behind or beside the target instead so the spread lands across them. After you land, Instapoison for the shield or Slowing Toxin for the damage.",
            videos: [
              { src: "super-aim-behind", label: "How to aim the ult — slightly behind", kind: "do" },
              { src: "super-dont-autoaim", label: "Don't auto-aim the ult", kind: "dont" },
            ],
            note: "Heist is the exception and it's the exact reverse — there you DO auto-aim, straight at the safe. See the Heist mode read below.",
          },
          {
            lead: "Dive the lowest-health target.",
            rest: "Use the super to jump the squishy backline — throwers especially — and remove them from the fight. Fire a normal shot just before you jump: it lands more damage and spreads poison over the landing zone.",
            videos: [
              { src: "super-lowest-hp", label: "Aim the ult at the lowest HP enemy" },
              { src: "super-dive-backline", label: "Dive the backline — shot before ult" },
            ],
          },
          {
            lead: "Don't dive someone who can leave.",
            rest: "Never jump a target holding an escape — a Piper super, for instance. Crow's super is one of the slowest in the game to charge, so trading it for theirs is not an even trade. Wait until they've spent the gadget or super, then commit.",
            videos: [{ src: "super-bad-dive", label: "How NOT to dive the backline", kind: "dont" }],
          },
        ],
      },
      {
        key: "hyper", label: "Hyper",
        intro: "Crow's hypercharge absolutely shreds, and it's at its best on open maps. The one rule: empty your ammo before you hyper-super.",
        tips: [
          {
            lead: "Use it to reach behind walls.",
            rest: "An advanced trick for hitting targets tucked behind cover — very strong for confirming a kill or forcing an annoying brawler out of a pocket.",
            videos: [{ src: "hyper-aim-trick", label: "Hyper aim trick" }],
          },
          {
            lead: "Hyper-super at the very end of the hyper.",
            rest: "Fire it just before the hyper expires: you still get the hyper version, and the super itself charges your next hyper. That's the loop.",
            note: "Exception: to surprise someone, or into high-health tanky comps, supering early can get you two hyper-supers out of one hyper. Shoot before you super for maximum damage — and treat this as the exception, not the habit.",
            videos: [{ src: "hyper-fast-charge", label: "Hyper trick — fast charge hyper" }],
          },
        ],
      },
    ],

    // Crow is playable in every mode and on every map — these are about HOW,
    // not whether.
    modeNotes: {
      bounty: "Chip, don't commit. Poison everything that peeks, let the ticks do the work, and bank stars by never dying. Your super is for removing a specific problem — usually their backline — not for opening a fight.",
      knockout: "Pure chip mode. Poison whoever peeks first and let the damage-over-time win the neutral for you. With no respawns, a poisoned enemy who has to back off is as good as a kill. Save the super for a target you can actually delete.",
      brawlBall: "Play noticeably more aggressive here. Farm your super off their aggro brawlers in the midfield scrap, then use it to dive their backline once they've committed. Slowing Toxin is the gadget — the slow both peels and sets up goals.",
      heist: "You live in mid, chipping to farm super, and every super goes into the safe. Auto-aim it — see the clips below, this is the one place auto-aim is correct. Watch out for one trap though: auto-aim locks onto the nearest target, so with an enemy between you and the safe you'll jump onto THEM instead. Check what's in front of you before you press it. Hold the hyper-super until the last shield break so it closes the game outright.",
      gemGrab: "You can carry gems here. The Instapoison shield is what lets you survive a dive while holding them, and the super is your escape when aggro commits. If they're the ones on countdown, flip it — super straight onto their carrier.",
      hotZone: "Zone control. Your poison denies the circle without you standing in it, which is exactly what Crow wants — contest from the edge, tick them off the point, and take the super dive only when it removes whoever is anchoring the zone.",
    },

    // Heist and Brawl Ball technique applies on every map in the mode.
    modeVideos: {
      brawlBall: [
        { src: "mode-brawlball-score-1", label: "How to score in Brawl Ball #1" },
        { src: "mode-brawlball-score-2", label: "How to score in Brawl Ball #2" },
      ],
      heist: [
        { src: "mode-heist-ult-autoaim", label: "Heist ult — auto-aim the safe", kind: "do" },
        { src: "mode-heist-hyper-autoaim", label: "Hyper-ult the safe — auto-aim", kind: "do" },
        { src: "mode-heist-ult-wrong", label: "Wrong — aiming behind the safe", kind: "dont" },
        { src: "mode-heist-hyper-wrong", label: "Wrong — hyper-ult behind the safe", kind: "dont" },
        { src: "mode-heist-useless-ult", label: "Useless — standing on the safe to ult", kind: "dont" },
      ],
    },

    modeVideoNotes: {
      brawlBall: "Knowing these two scores is essential if you play Crow in Brawl Ball — watch them closely and drill them.",
      heist: "Unlike against enemies, you want to AUTO-AIM the safe. Auto-aim breaks the shield; aiming behind it lands only about 13% safe damage. The same applies to the hyper-ult, and standing on the safe to ult does nothing at all. One caveat: auto-aim takes the nearest target, so if an enemy is standing between you and the safe you'll dive them instead — clear the lane first.",
    },

    synergyReasons: {
      POCO: "Sustain behind a brawler whose whole plan is surviving long enough for poison to finish the job.",
      BYRON: "Byron's amp turns Crow's chip into real damage, and the heal keeps him at the health where he wants to dive.",
      GENE: "Gene drags a target out of position and Crow's spread punishes them wherever they land.",
    },

    counterReasons: {
      PIPER: "Out-ranges Crow outright and can leave the moment he commits — the matchup he least wants to see.",
      BELLE: "Long range plus a mark that follows him; Crow has to cross open ground to answer and rarely survives it.",
      "8-BIT": "Out-ranges and out-damages him from a position Crow can't dive profitably.",
    },

    counterTips: [
      {
        lead: "Out-range him.",
        rest: "Snipers and sharpshooters simply beat Crow — he has to close distance to threaten, and crossing that gap is where he dies. Peek around walls to tap him and retreat before the poison stacks.",
      },
      {
        lead: "Don't feed the super.",
        rest: "Crow's super is one of the slowest to charge in the game. Every point of chip you eat is progress toward a dive on you. Break line of sight and let the poison expire rather than trading pointlessly.",
      },
      {
        lead: "If he dives you, hold your escape.",
        rest: "Wait for Crow to actually commit the super onto you, then use your gadget or super to leave. Burning it early just means you're standing there when he lands.",
      },
      {
        lead: "Bring a spawner.",
        rest: "Pets and turrets are miserable for Crow — his burst is low, so anything with a health bar he has to chew through costs him far more time than it costs you.",
      },
      {
        lead: "Overwhelm him, but know the cost.",
        rest: "High burst does kill him quickly, since he's squishy. Just be aware every hit you take on the way in feeds his super — so make sure you finish what you start.",
      },
    ],
  },

  SURGE: {
    // Power-11 figures read straight off the in-game Brawler Stats card. The
    // 2,360 is the DIRECT hit — Surge's shot splits in two on contact, and the
    // wall-shot row below is what To The Max turns that into when the splits
    // come back off a wall (owner-measured: 3,540 with one split returning,
    // 4,720 with both).
    combatStats: [
      { label: "Max Health", value: 6600, scaled: true, tagTpl: "+{0} with Shield Gear", tagParts: [900] },
      { label: "Damage / Shot", value: 2360, scaled: true, tag: "Splits in two on contact" },
      { label: "Wall Shot · To The Max", tpl: "{0} – {1}", parts: [3540, 4720], scaled: true, tag: "One or both splits return" },
      { label: "Super Damage", value: 2000, scaled: true, tag: "Party Tricks" },
      { label: "Shots to Super", value: 3, tag: "2 if the Super hit two enemies" },
      { label: "Ammo", value: 3 },
      { label: "Attack Range", value: "Normal", tag: "Longer from Stage 2" },
      { label: "Super Range", value: "Short" },
      { label: "Movement Speed", value: 720, tag: "Normal · faster from Stage 1" },
      { label: "Reload Speed", value: "Slow" },
      { label: "Stage 1", value: "Move speed" },
      { label: "Stage 2", value: "Weapon range" },
      { label: "Stage 3", value: "Splits into 6", tag: "instead of 2 · max stage" },
      { label: "Subclass", value: "Damage Dealer" },
    ],

    // Surge's loadout does not change. It is Power Shield + Serve Ice Cold in
    // every mode on every map, so the mode tabs exist for the mode-specific
    // reasoning rather than for a different build.
    builds: {
      General: {
        starPower: "Serve Ice Cold",
        gadget: "Power Shield",
        gears: ["Shield", "Speed"],
        note: "This is the Surge build, everywhere. Power Shield and Serve Ice Cold in every mode and on every map — Power Surge is never played in 3v3, and To The Max belongs in Showdown.",
        gearNote: "Shield and Speed by default. On maps without bushes, swap Speed for Damage Gear.",
      },
      knockout: {
        starPower: "Serve Ice Cold", gadget: "Power Shield", gears: ["Shield", "Speed"],
        note: "Same as general. With no respawns, keeping your Stage 1 through a death is worth more here than anywhere else.",
        gearNote: "Shield and Speed by default. On maps without bushes, swap Speed for Damage Gear.",
      },
      bounty: {
        starPower: "Serve Ice Cold", gadget: "Power Shield", gears: ["Shield", "Speed"],
        note: "Same as general. Dying costs you stages and stars at the same time, so Power Shield is doing double duty.",
        gearNote: "Shield and Speed by default. On maps without bushes, swap Speed for Damage Gear.",
      },
      heist: {
        starPower: "Serve Ice Cold", gadget: "Power Shield", gears: ["Shield", "Speed"],
        note: "Same as general. You're farming Super in mid rather than hitting the safe, and the shield is what keeps you there.",
        gearNote: "Shield and Speed by default. On maps without bushes, swap Speed for Damage Gear.",
      },
      brawlBall: {
        starPower: "Serve Ice Cold", gadget: "Power Shield", gears: ["Shield", "Speed"],
        note: "Same as general. The ammo Power Shield returns is what lets you follow up a goal trick instead of standing there empty.",
        gearNote: "Shield and Speed by default. On maps without bushes, swap Speed for Damage Gear.",
      },
      gemGrab: {
        starPower: "Serve Ice Cold", gadget: "Power Shield", gears: ["Shield", "Speed"],
        note: "Same as general. You're carrying gems, so the shield is what survives the dive that comes for them.",
        gearNote: "Shield and Speed by default. On maps without bushes, swap Speed for Damage Gear.",
      },
      hotZone: {
        starPower: "Serve Ice Cold", gadget: "Power Shield", gears: ["Shield", "Speed"],
        note: "Same as general. Contest from the edge and let the shield buy you the extra seconds on the point.",
        gearNote: "Shield and Speed by default. On maps without bushes, swap Speed for Damage Gear.",
      },
    },

    abilityNotes: {
      "Serve Ice Cold": { pick: "main", body: "Keeps your Stage 1 upgrade for the whole match, so a death no longer drops you all the way back to a slow, short-range Surge. In 3v3 this is always the pick — Surge's entire game is about not losing progress, and this is the only thing that protects it." },
      "To The Max": { pick: "situational", body: "Your shot splits when it hits a wall, so firing at the wall behind a target can hit them twice — more damage and a faster Super. Genuinely strong tech and worth learning, but it belongs in Showdown and casual play. In 3v3 the permanent Stage 1 wins every time." },
      "Power Shield": { pick: "main", body: "Eats most of the next incoming hit and converts it into 2 reloaded ammo. Defence and offence in one button, and the reason you can commit to an aggressive jump at all — but only if you fire it when a shot is genuinely on the way." },
      "Power Surge": { pick: "skip", body: "Never play this. It raises your stage temporarily, but it does not change the 3 shots you need to charge your Super — so it buys you nothing you can build on. Power Shield's free ammo plus the damage it absorbs is a strictly better payoff." },
    },

    videoBase: "/guides/surge",

    guideTabs: [
      {
        key: "gadget", label: "Gadget",
        tips: [
          { header: "Gadget 1 · Power Surge" },
          {
            lead: "Never play it.",
            rest: "Without the gadget it takes 3 shots to charge your Super. With the gadget active it still takes 3 shots — the one thing you would want it for, it does not do. Power Shield's 2 returned ammo plus the damage it absorbs is the higher pay-off every single time.",
            videos: [{ src: "gadget1-useless", label: "Gadget 1 is useless — still 3 shots", kind: "dont" }],
          },
          { header: "Gadget 2 · Power Shield" },
          {
            lead: "Wait for the shot — don't guess.",
            rest: "Power Shield only pays off if a hit actually lands inside the window, so fire it when you can already see the shot coming. Pop it early and good players will simply hold their attack and watch it expire. The reliable pattern is the aggressive one: jump in, empty your ammo, activate the gadget as they commit, then keep shooting with what it hands back.",
            videos: [{ src: "gadget2-right-activation-single-shot", label: "Right activation vs a single shot", kind: "do" }],
          },
          {
            lead: "Bait the big single-hit brawlers.",
            rest: "Against anyone whose damage arrives in one large chunk, sit at low health and let them come to you. Absorb that shot with the gadget, then spend the returned ammo on an immediate Super to finish them — they've used their window and you've been handed yours. The clip above is exactly this: one big shot in, gadget out, ammo back.",
          },
          {
            lead: "Against burst, the shield won't tank the burst.",
            rest: "This is the part people get wrong. Power Shield eats ONE hit, so popping it into a burst brawler mid-volley absorbs a single shot and leaves the rest of the burst to land on you — you've spent the gadget and still taken most of the damage.",
            videos: [{ src: "gadget2-wrong-activation-burst", label: "Wrong — popping it mid-burst", kind: "dont" }],
          },
          {
            lead: "So walk into the burst on purpose instead.",
            rest: "Activate the gadget BEFORE you step out, then deliberately move into the opening shot. The shield consumes that first shot, and because you're now moving through their volley the rest of the burst misses. You take one shot's worth of damage, they've spent their burst, and you're holding free ammo for the follow-up.",
            videos: [{ src: "gadget2-right-activation-burst", label: "Right — gadget first, then step into it", kind: "do" }],
          },
        ],
      },
      {
        key: "super", label: "Super & Star Power",
        intro: "Surge's Super is both his damage and his progression — every one you land makes the next fight easier, and every death takes it away. Most of playing him well is managing that one number.",
        tips: [
          { header: "Super · Party Tricks" },
          {
            lead: "Shoot once, then Super.",
            rest: "Fire an ammo just before you ult. The shot lands after the Super has already gone out, so it counts toward the next one — leaving you 2 shots from charged instead of 3. It costs nothing and should be your default habit.",
            videos: [{ src: "super-charge-trick", label: "Surge ult charge trick" }],
          },
          {
            lead: "Land it — the radius lies.",
            rest: "The outer edge of the ult ring does not connect. Clip someone with the rim and you'll land next to them having dealt no damage at all, which on an aggressive jump is simply how you die. Commit only when they are properly inside the circle.",
            videos: [
              { src: "super-range-hit", label: "Inside the radius — hit", kind: "do" },
              { src: "super-range-no-hit", label: "On the rim — no hit", kind: "dont" },
            ],
          },
          {
            lead: "Three shots to charge.",
            rest: "Land 3 shots and the Super is up. Landing the Super itself on a single target doesn't shorten that — you still need 3 shots afterwards, so don't count on the ult to pay for the next one.",
            videos: [
              { src: "super-3-shots-for-super", label: "3 shots to charge the Super" },
              { src: "super-then-3-shots", label: "Super on one target — still 3 shots" },
            ],
          },
          {
            lead: "Catch two enemies and you only need two.",
            rest: "A Super that lands on two opponents leaves you 2 shots from the next one. Chaining upgrades is the entire Surge game plan, so take the double whenever the fight offers it.",
            videos: [{ src: "super-double-hit-2-shots", label: "Double hit — only 2 shots after" }],
            block: {
              title: "Super combo damage",
              rows: [
                { label: "Super + 1 shot", value: "4,360" },
                { label: "Super + 2 shots", value: "6,720" },
                { label: "Super + 3 shots", value: "9,080" },
              ],
            },
            note: "Keep these in your head before you jump — they tell you whether the target is actually dead, or whether you're about to land next to a survivor with no ammo.",
          },
          { header: "Star Power 1 · To The Max" },
          {
            lead: "Showdown and casual only.",
            rest: "In 3v3 the answer is always Serve Ice Cold. To The Max is real tech and worth knowing, but everything in this sub-section only works while it's equipped — don't take these tips into a ranked game.",
          },
          {
            lead: "Shoot the wall behind them, not them.",
            rest: "Your shot splits on walls, so firing into the wall BEHIND a target hits them going in and again on the rebound. That charges your Super in 2 shots instead of 3 — and against a wide target like Frank a perfect shot can do it in 1, though that's unreliable enough that you should always plan for 2. The same geometry is a damage upgrade: an enemy stood against a wall takes 3,540 or 4,720 instead of 2,360.",
            videos: [{ src: "sp1-fast-charge-extra-damage", label: "Fast charge + extra damage" }],
          },
          {
            lead: "Chip through the wall before you jump it.",
            rest: "Before ulting over cover, land a wall shot on them first and then jump across to finish. Don't forget the outer border of the map counts as a wall too — it works exactly the same way.",
            videos: [{ src: "sp1-attack-behind-walls", label: "Attacking enemies behind walls" }],
          },
          { header: "Star Power 2 · Serve Ice Cold" },
          {
            lead: "Hold the opening Super against aggro.",
            rest: "Don't spend your opening Super to upgrade early when they have a diver — an Edgar can reach you in the first seconds, and a Surge with no Super is a free kill. Keep it as the answer to the dive. Against a comp with no aggro at all the opposite is true: ult straight away and use the extra range to land more shots.",
            videos: [{ src: "sp2-save-super-for-aggro", label: "Save the Super for aggro" }],
          },
        ],
      },
      {
        key: "hyper", label: "Hyper",
        intro: "Surge's hypercharge is broken, and there isn't much nuance to it — the skill is in when you spend it, not how.",
        tips: [
          {
            lead: "Land it on top of them, then auto-aim.",
            rest: "Hyper-ult directly onto the enemy, auto-aim your shots, activate Power Shield for the extra ammo, and there is very little they can do about it. This is one of the few Surge situations where you don't need to be clever.",
          },
          {
            lead: "Keep your Super charge in mind and chain them.",
            rest: "The real value is the chain. Track how close the next Super is before you commit, because a hyper that ends with another Super already banked turns one won fight into a won round.",
          },
        ],
      },
      {
        key: "gameplay", label: "Gameplay",
        intro: "Surge is playable on every map in the pool — he just struggles more in heavy bush, which is exactly why Speed Gear is in the default build. Everything below is about protecting the snowball.",
        tips: [
          {
            lead: "Not dying is the whole game.",
            rest: "A death resets your upgrade stages, and a Stage 0 Surge is one of the weakest brawlers on the field. Every aggressive decision has to be weighed against that — the trade that looks even usually isn't, because you're also paying with your progression. Don't be too aggro.",
          },
          {
            lead: "Farm 1v1s until you're maxed.",
            rest: "At low stages, keep the game to trades you control: chip a single opponent, bank the Super, take the upgrade. Only once you're at max stage — the one where your attack splits into 6 — should you look for 2v1s and start taking the game over.",
          },
          {
            lead: "Walls are your best friend.",
            rest: "Chip around cover and ult over walls. Your Super ignores the geometry everyone else has to walk around, which is what makes an even-looking position suddenly not one. Play the map as a set of walls you can appear behind.",
          },
        ],
      },
    ],

    // Surge is playable everywhere, so these are about HOW the snowball gets
    // built in each mode rather than whether to pick him.
    modeNotes: {
      gemGrab: "You're the gem carrier. Farm your Super early and then hold it — it is your escape with the gems, not your engage. Losing the carry resets your stages and hands them the count in the same moment, which is the worst trade available to you.",
      heist: "You are not really safe damage. Your job is farming Super off their mid presence and keeping the centre under control so your actual damage dealers get free hits on the safe. Chip, upgrade, hold the middle.",
      brawlBall: "The two goal tricks below are not optional — if you pick Surge in Brawl Ball you're expected to hit them. Watch both closely and drill them.",
      bounty: "Don't die. Bounty punishes a reset harder than any other mode, because you lose your stages and hand them stars at the same time. Chip, upgrade, and only push once you're fully stacked.",
      knockout: "Don't die. With no respawns a reset Surge is a lost round — play the neutral, farm your stages off safe chip, and take the 2v1 only once you're at max stage.",
      hotZone: "Contest from the edge rather than standing in the circle, and let your stages come off chip damage. The general rule applies harder here than most places: a Surge who trades his life for a few seconds of contest can't hold the zone for the rest of the round.",
    },

    // Brawl Ball technique applies on every map in the mode.
    modeVideos: {
      brawlBall: [
        { src: "mode-brawlball-goal-trick-1", label: "Goal trick #1" },
        { src: "mode-brawlball-goal-trick-2", label: "Goal trick #2" },
      ],
    },

    modeVideoNotes: {
      brawlBall: "Learning these two scores is essential if you play Surge in Brawl Ball — watch them closely and drill them.",
    },

    counterTips: [
      {
        lead: "Do not feed his Super. At all.",
        rest: "Every point of chip you give up is progress toward another upgrade, and upgrades are the only reason he's a problem. At his lower stages his range is short — out-range him and refuse the trade entirely.",
      },
      {
        lead: "Bait the gadget.",
        rest: "If a Surge pushes in with his Super up, expect Power Shield. Hide rather than shoot: a shot into the shield hands him 2 free ammo and absorbs your damage. The only exception is when the shot is a guaranteed kill.",
      },
      {
        lead: "Trade with him at max stage.",
        rest: "Once he's fully upgraded he's an absolute monster, and leaving him there is worse than taking an even trade. Knocking him back down to Stage 0 is worth considerably more than your health bar.",
      },
      {
        lead: "Count his ammo.",
        rest: "Three ammo and a slow reload. After 2–3 shots into an aggressive push, expect the gadget — and once that's spent and his ammo is gone, he's on cooldown with nothing. That's your window to push him.",
      },
      {
        lead: "Out-range him — while you still can.",
        rest: "At low stages staying outside his range and poking is close to free. Be honest with yourself about the other end of it though: at max stage he has no real counters, which is why the earlier points matter so much.",
      },
      {
        lead: "Save your escape for his jump.",
        rest: "Hold dashes, gadgets and Supers for the moment he ults onto you. Surge is strong enough that trading with him is usually fine — just don't be caught with nothing when he lands.",
      },
    ],
  },

  BIBI: {
    // Power-11 figures read straight off the in-game Brawler Stats card. Bibi's
    // card quotes range and both speeds as words rather than numbers, so they
    // are stored as words — inventing tile counts here would be dressing a
    // guess up as a measurement.
    combatStats: [
      { label: "Max Health", value: 10000, scaled: true, tag: "One of the biggest in the game" },
      { label: "Damage / Swing", value: 2800, scaled: true, tag: "Three Strikes" },
      { label: "Super Damage", value: 1800, scaled: true, tag: "Per hit — one bubble can hit twice" },
      { label: "Attack Range", value: "Short" },
      { label: "Super Range", value: "Very Long", tag: "Passes through enemies" },
      { label: "Movement Speed", value: "Very Fast", tag: "Faster again on a full Home Run bar" },
      { label: "Reload Speed", value: "Very Fast" },
      { label: "Home Run Bar", value: "Charges over time", tag: "Full bar = knockback swing" },
      { label: "Subclass", value: "Tank" },
    ],

    // The loadout does not move between modes. Vitamin Booster and Home Run
    // everywhere, so the mode tabs carry the mode-specific reasoning rather
    // than a different build.
    builds: {
      General: {
        starPower: "Home Run",
        gadget: "Vitamin Booster",
        gears: ["Shield", "Speed"],
        note: "This is the Bibi build in every mode. Vitamin Booster keeps you alive through the walk-in, Home Run turns a full bar into the speed that gets you there, and the two gears cover the moment it goes wrong.",
        gearNote: "Batting Stance replaces Home Run when the enemy has drafted several tanks — flat damage reduction beats movement in a stand-up fight you can't dodge your way out of.",
      },
      brawlBall: {
        starPower: "Home Run", gadget: "Vitamin Booster", gears: ["Shield", "Speed"],
        note: "Same as general, and the mode where the gadget earns most. Carrying the ball means you cannot swing, so the heal is the only defence you have on the walk-in.",
        gearNote: "Batting Stance if they've drafted several tanks; otherwise Home Run every time.",
      },
      gemGrab: {
        starPower: "Home Run", gadget: "Vitamin Booster", gears: ["Shield", "Speed"],
        note: "Same as general. You are the one who breaks the enemy's hold on mid — heal, close, and make the gem carrier's position untenable.",
        gearNote: "Batting Stance if they've drafted several tanks; otherwise Home Run every time.",
      },
      knockout: {
        starPower: "Home Run", gadget: "Vitamin Booster", gears: ["Shield", "Speed"],
        note: "Same as general, played more patiently. With no respawns the heal is worth more as the thing that survives the first exchange than as the thing that funds a dive.",
        gearNote: "Batting Stance if they've drafted several tanks; otherwise Home Run every time.",
      },
      bounty: {
        starPower: "Home Run", gadget: "Vitamin Booster", gears: ["Shield", "Speed"],
        note: "Same as general. Bounty is the mode where the Spitball does most of your work — chip from range, and only commit the bat when the star count makes the trade worth it.",
        gearNote: "Batting Stance if they've drafted several tanks; otherwise Home Run every time.",
      },
      heist: {
        starPower: "Home Run", gadget: "Vitamin Booster", gears: ["Shield", "Speed"],
        note: "Same as general. Bibi hits the safe hard once she reaches it, and the heal plus the speed burst is exactly the package that gets a short-range brawler across the open ground.",
        gearNote: "Batting Stance if they've drafted several tanks; otherwise Home Run every time.",
      },
      hotZone: {
        starPower: "Home Run", gadget: "Vitamin Booster", gears: ["Shield", "Speed"],
        note: "Same as general — with the single exception in the game where Extra Sticky is worth a thought. Read the gadget note below before you swap.",
        gearNote: "Batting Stance if they've drafted several tanks; otherwise Home Run every time.",
      },
    },

    abilityNotes: {
      "Home Run": { pick: "main", body: "A full Home Run bar makes Bibi very fast. That speed is what turns a short-range tank into a brawler that actually arrives — and, just as importantly, what walks her back out. This is the default in every mode." },
      "Batting Stance": { pick: "situational", body: "Turns the same full bar into damage reduction instead of speed. Take it when the enemy has drafted several tanks: against sustained close-range damage you aren't dodging anything, so mitigation beats movement." },
      "Vitamin Booster": { pick: "main", body: "A heal on demand, and the reason Bibi survives the approach at all. It also leaves your Home Run bar full, so the star power bonus arrives with it — one button for health and mobility at the same time." },
      "Extra Sticky": { pick: "skip", body: "The slow is genuine utility, but it does nothing about the problem Bibi actually has, which is crossing open ground alive. Only consider it in Hot Zone alongside a teammate who can punish everything caught in the gum." },
    },

    videoBase: "/guides/bibi",

    guideTabs: [
      {
        key: "gadget", label: "Gadget",
        tips: [
          { header: "Gadget 1 · Vitamin Booster" },
          {
            lead: "Heal after their ammo is gone, not before.",
            rest: "The whole value of Vitamin Booster is in the timing. Take the poke, let them empty the magazine into you, and heal once there is nothing left coming — with Shield Gear layered on top that puts you somewhere around 15,000 effective health, which is more than most brawlers can chew through before you're on them. Heal early and you have just restored damage they are delighted to re-apply.",
          },
          {
            lead: "It hands you your star power for free.",
            rest: "Activating the gadget leaves your Home Run bar full, so whichever star power you're running comes online in the same moment — Home Run's speed to close the gap, or Batting Stance's damage reduction to walk through the answer. That is why the heal is an engage tool and not just a panic button.",
          },
          {
            lead: "Pin them against a wall, then swing.",
            rest: "A full bar means your next swing knocks the target back. Line it up so the knockback drives them into a wall and they are stuck there with nowhere to retreat — and a target that cannot move, inside Bibi's range, is a dead one. The heal is what buys you the walk-up to set it.",
            videos: [{ src: "gadget1-kill-confirm", label: "Knock them into the wall, then confirm", kind: "do" }],
          },
          {
            lead: "In Brawl Ball it is how you walk the ball in.",
            rest: "Holding the ball means you cannot attack, so your health bar is your only defence. Popping Vitamin Booster on the run gives you a second health bar for the walk-in and the star power bonus to shorten it.",
          },
          { header: "Gadget 2 · Extra Sticky" },
          {
            lead: "Leave it at home.",
            rest: "The slow field is real utility, but it does not solve the problem Bibi has. Every hard moment in a Bibi game is about surviving the ground between you and the target, and Vitamin Booster answers that where Extra Sticky doesn't.",
            note: "The one exception is Hot Zone with a teammate who can convert the slow — a Pierce or similar punishing everything stuck in the gum. That is narrow enough that Vitamin Booster stays the default and the swap is a deliberate read, never a habit.",
          },
        ],
      },
      {
        key: "super", label: "Super & Star Power",
        intro: "Spitball passes through enemies and bounces off walls, so one bubble is rarely one hit. Most of playing Bibi well is turning a single Super into three or four connections — and using the movement the star power gives you to be somewhere the answering shot isn't.",
        tips: [
          { header: "Super · Spitball" },
          {
            lead: "Swing first, then bubble.",
            rest: "Fire the Super immediately after a bat swing connects and the bubble catches the same target on its way out — a free double hit. It works from any range once you have the rhythm, and it is a timing habit rather than a read, so take it into the training room and drill it before you rely on it in a game.",
            videos: [
              { src: "super-double-hit-1", label: "Double hit — swing, then bubble" },
              { src: "super-double-hit-2", label: "Same trick, longer range" },
            ],
          },
          { header: "Star Power 1 · Home Run" },
          {
            lead: "The speed is a dodging tool first, a chasing tool second.",
            rest: "A full Home Run bar makes Bibi fast enough that shots already aimed at her stop landing — snipers and single-shot brawlers have to lead you, and at that speed their lead is wrong. Getting on top of people is the second thing it buys. Watch how much of the movement in these clips is sideways rather than forwards.",
            videos: [
              { src: "sp1-dodging-1", label: "Dodging with the speed boost — full sequence" },
              { src: "sp1-dodging-2", label: "Dodging in a real fight" },
            ],
          },
          {
            lead: "Aim the bubble into a narrow gap.",
            rest: "Spitball bounces, so pick a line where it rattles between two walls a short distance apart. It then passes through whatever is standing in that lane several times instead of once, which is the difference between chip and a kill — and it is how you touch someone who believes a wall is protecting them.",
            videos: [
              { image: "spitball-aim-angle.jpg", label: "The angle to look for — a tight lane between walls" },
              { src: "spitball-aim", label: "The same bounce in motion" },
            ],
          },
          {
            lead: "Let the bubble win the fight before you commit.",
            rest: "Watch this one properly: the Spitball rattles through Colt several times before Bibi ever steps in, and by the time she walks up to Fang the fight has already been decided. The bat confirms the kill — the bubble is what earned it.",
            videos: [{ src: "hyper-bubble-aim", label: "Bubble does the damage, bat confirms" }],
          },
          { header: "Star Power 2 · Batting Stance" },
          {
            lead: "Swap to it when they draft tanks.",
            rest: "Batting Stance turns the full bar into damage reduction rather than speed. Against a comp built on tanks and sustained close-range damage there is nothing to dodge — you are trying to win a stand-up fight in their faces, and flat mitigation does that better than movement ever will.",
          },
          {
            lead: "Dying is not always losing the trade.",
            rest: "In this clip Bibi pushes into a 2v1, does not survive it, and it is still the right play — she pulled two opponents out of the fight for long enough that her team could move up and hold the ground. Bibi's job is making space. Measure the play by where your team ends up, not by your own health bar.",
            videos: [{ src: "sp2-trade-for-space", label: "Trading a life for map position", kind: "do" }],
          },
        ],
      },
      {
        key: "hyper", label: "Hyper",
        intro: "The hypercharge gives Bibi a lot of damage in a very short window. The trap is reading that as permission to run at everybody.",
        tips: [
          {
            lead: "Don't get blinded by wanting to laser everyone down.",
            rest: "The damage is high enough that players charge in swinging and skip the setup entirely. Aim the bubble first and take the multi-hit, then close on whatever survived it — the hyper punishes a comp that is already hurt far harder than one at full health.",
            videos: [{ src: "hyper-bubble-aim", label: "Aim first, then close" }],
          },
          {
            lead: "Chain the Supers.",
            rest: "A well-aimed Spitball hits several times, and every one of those hits charges the next Super. Play the hyper as the opening of a sequence — bubble, close, swing, bubble again — rather than as one big moment you spend and then walk away from.",
          },
        ],
      },
      {
        key: "gameplay", label: "Gameplay",
        intro: "Bibi is a tank who has to arrive. Everything here is about arriving with a health bar left.",
        tips: [
          {
            lead: "Cross through cover, never through the open.",
            rest: "A short-range brawler walking a straight line at a ranged one is just handing over free damage. Route your approach through bushes and behind walls, and treat the open walk-up as the losing line even when your health bar says you can afford it.",
          },
          {
            lead: "Protect the full bar.",
            rest: "The bar empties the moment you swing with it, so poking a wall or a stray minion at the wrong time strips exactly the tool you needed for the engage. When you are not committing, hold the swing and keep the knockback banked.",
          },
          {
            lead: "The Spitball is your ranged game — use it.",
            rest: "Bibi has a genuinely long-range attack and most players sit on it waiting for the perfect engage. Poke with the bubble across the whole neutral game: it charges quickly, it costs you no position, and it softens the target you're about to walk at.",
          },
          {
            lead: "Go past the front line.",
            rest: "The knockback is wasted on the enemy tank, who is happy to fight you. Your targets are the brawlers standing behind him — the marksman, the thrower, the support — and the speed burst exists precisely so you can reach them.",
          },
        ],
      },
    ],

    modeNotes: {
      brawlBall: "Bibi's best mode. The knockback clears the ball carrier's path and the heal is what walks the ball in, so she contributes on both sides of the objective. Push the ball, don't chase kills.",
      gemGrab: "You are the tool that breaks their hold on mid. Poke with the bubble until the gem carrier has to commit, then heal, close, and knock them off the point — you don't need to survive it if the gems drop.",
      bounty: "The most patient Bibi mode. Every death is a star, so play the bubble from range for most of the round and only spend the bat when the count makes the trade clearly worth it.",
      knockout: "No respawns means the walk-in has to be right first time. Use the Spitball to force them out of position across the whole round, and save the heal for the one exchange that decides it.",
      heist: "Bibi does real damage to the safe once she reaches it, and the speed burst plus the heal is exactly the package that gets a short-range brawler across open ground. Farm the bubble on their defenders, then commit.",
      hotZone: "Contest with the bubble rather than by standing in the circle. Bibi holds a zone by making it expensive for anyone else to stand there — the knockback is worth more seconds on the point than her own body is.",
    },

    counterTips: [
      {
        lead: "Break the walls she is walking behind.",
        rest: "Bibi's whole approach is routed through cover. Take the walls down and the short-range brawler has to cross open ground at you, which is the fight she cannot win — this is the single highest-value thing you can do against her.",
      },
      {
        lead: "Bring high damage, not chip.",
        rest: "A 10,000 health bar plus a heal on demand shrugs off poke. What actually kills Bibi is burst arriving faster than Vitamin Booster can answer it, so pick the brawlers that delete a health bar in a couple of connections rather than the ones that whittle it.",
      },
      {
        lead: "Watch the Home Run bar, not the health bar.",
        rest: "A full bar means her next swing knocks you back — into a wall if she has set it up, and that is where you die. When the bar is full, break line of sight or take the fight in the open where the knockback has nothing to pin you against.",
      },
      {
        lead: "Bait the heal before you commit.",
        rest: "Vitamin Booster is what converts a losing walk-in into a won one. Spend a little damage to draw it out, then step back and re-engage on the cooldown — a Bibi with no gadget is a very short-range brawler with no way to close.",
      },
      {
        lead: "Don't line up behind each other.",
        rest: "The Spitball passes through enemies and bounces off walls, so a team stacked in one lane takes the same bubble three times over. Spread out, and don't stand in a narrow corridor she can rattle a shot down.",
      },
    ],
  },

  SHADE: {
    // Power-11 figures read straight off the in-game Brawler Stats card. The
    // Shield Gear figure is not an estimate: the owner's own screenshots show
    // Shade sitting at 8,300 with the gear equipped, which is the 7,400 base
    // plus 900 — the same +900 already recorded on the Surge guide.
    combatStats: [
      { label: "Max Health", value: 7400, scaled: true, tagTpl: "+{0} → {1} with Shield Gear", tagParts: [900, 8300] },
      { label: "Damage / Hug", value: 1600, scaled: true, tag: "Outer part of the embrace" },
      { label: "Center Damage", value: 3200, scaled: true, tag: "Double — always aim the middle" },
      { label: "Attack Range", value: "Short", tag: "Hugs through walls" },
      { label: "Super Range", value: "Short" },
      { label: "Movement Speed", value: "Very Fast" },
      { label: "Reload Speed", value: "Very Fast" },
      { label: "Incorporeal Form", value: "Walks through walls", tag: "Plus a speed boost" },
      { label: "Subclass", value: "Assassin" },
    ],

    // The loadout never changes. Longarms + Hardened Hoodie with Shield and
    // Speed in every mode on every map, so the mode tabs carry the reasoning
    // rather than a different build.
    builds: {
      General: {
        starPower: "Hardened Hoodie",
        gadget: "Longarms",
        gears: ["Shield", "Speed"],
        note: "Longarms and Hardened Hoodie, always. Longarms is not just extra range — it is the gadget the entire reset trick is built on, and that trick is most of Shade's ceiling. Hardened Hoodie is what lets you sit inside a wall in the middle of their team and not die for it.",
        gearNote: "Shield and Speed in every game. Shield takes you to 8,300 effective health, which is the difference between surviving a contested wall and feeding one.",
      },
      brawlBall: {
        starPower: "Hardened Hoodie", gadget: "Longarms", gears: ["Shield", "Speed"],
        note: "Same as general, and Shade's best mode by the numbers. Walking through the wall beside their goal is a position no other brawler can take.",
        gearNote: "Shield and Speed in every game — 8,300 effective health is what makes the aggressive wall spots survivable.",
      },
      heist: {
        starPower: "Hardened Hoodie", gadget: "Longarms", gears: ["Shield", "Speed"],
        note: "Same as general. Incorporeal Form ignores the wall the safe is hiding behind, and Hardened Hoodie is what gets you back out afterwards.",
        gearNote: "Shield and Speed in every game — 8,300 effective health is what makes the aggressive wall spots survivable.",
      },
      gemGrab: {
        starPower: "Hardened Hoodie", gadget: "Longarms", gears: ["Shield", "Speed"],
        note: "Same as general. You threaten the gem carrier from inside geometry they think is protecting them, which is worth more than contesting the mine head-on.",
        gearNote: "Shield and Speed in every game — 8,300 effective health is what makes the aggressive wall spots survivable.",
      },
      hotZone: {
        starPower: "Hardened Hoodie", gadget: "Longarms", gears: ["Shield", "Speed"],
        note: "Same as general — but read the mode note below before you lock him. Hot Zone is where Shade gets picked most and performs worst.",
        gearNote: "Shield and Speed in every game — 8,300 effective health is what makes the aggressive wall spots survivable.",
      },
      bounty: {
        starPower: "Hardened Hoodie", gadget: "Longarms", gears: ["Shield", "Speed"],
        note: "Same as general, played far more carefully. Every wall you walk into is a star if you misjudge it.",
        gearNote: "Shield and Speed in every game — 8,300 effective health is what makes the aggressive wall spots survivable.",
      },
      knockout: {
        starPower: "Hardened Hoodie", gadget: "Longarms", gears: ["Shield", "Speed"],
        note: "Same as general. Shade's weakest mode: no respawns means a wall dive that doesn't land costs the round, and the walls get broken as the round goes on.",
        gearNote: "Shield and Speed in every game — 8,300 effective health is what makes the aggressive wall spots survivable.",
      },
    },

    abilityNotes: {
      "Longarms": { pick: "main", body: "Extra range on the next attack — and far more than that. Activated at the right point in an attack it refunds itself, which is where three gadget shots off one charge comes from. Learning that timing is the single biggest jump in Shade's ceiling." },
      "Jump Scare": { pick: "skip", body: "A slow on nearby enemies. Perfectly reasonable in isolation, but it costs you the reset trick, and the reset trick is most of what makes Shade frightening. Leave it." },
      "Spooky Speedster": { pick: "situational", body: "Speed boost for landing the centre of your attack. It rewards the thing you should be doing anyway, but it only pays out after you have already hit — Hardened Hoodie protects you on the way in, which matters more." },
      "Hardened Hoodie": { pick: "main", body: "Damage reduction while in Incorporeal Form. This is what turns walking into the middle of their team from a gimmick into a position: you arrive inside the wall with the damage already halved, and you leave the same way." },
    },

    videoBase: "/guides/shade",

    guideTabs: [
      {
        key: "gadget", label: "Gadget",
        intro: "The gadget reset is the highest-value thing to learn on Shade, and it is pure timing rather than a read. Take everything in this tab to the training room before you take it into ranked — and be honest about your connection, because the window is small enough that bad ping will eat it.",
        tips: [
          { header: "Gadget 1 · Longarms" },
          {
            lead: "Fire it mid-attack, while the arms are still behind its head.",
            rest: "Activate Longarms during an attack rather than before one and the gadget gives itself back — one charge, two shots. The whole trick lives in that one moment of the animation, so drill it until it is muscle memory rather than a decision.",
            videos: [{ src: "gadget-reset-trick", label: "The reset — gadget fired mid-attack", kind: "do" }],
          },
          {
            lead: "Look for the arms past the triangle.",
            rest: "This is the reference frame. The arms have to be beyond the triangle marker for the reset to register — earlier than that and you simply spend the gadget. Learn the shape, not a count.",
            videos: [{ image: "gadget-timing-arms.png", label: "Arms beyond the triangle — the window", ratio: "195/241" }],
          },
          {
            lead: "It works exactly the same in a real game.",
            rest: "Nothing about the timing changes under pressure — the animation is the animation. What changes is that you now have to find it while someone is shooting at you, which is the actual reason to over-drill it first.",
            videos: [{ src: "gadget-reset-live", label: "The same reset in live gameplay" }],
          },
          { header: "The Super reset" },
          {
            lead: "Your Super resets the gadget too.",
            rest: "Activate Incorporeal Form while the arms are behind Shade's head and you get the same refund. Same window, different button — which is what makes stacking them possible.",
            videos: [{ src: "ult-gadget-reset", label: "Super used as the reset", kind: "do" }],
          },
          {
            lead: "If it looks like this, you went too early.",
            rest: "Firing before the arms clear the triangle still gives you the long-range shot, so it is not a disaster — it can even catch people out with the reach. But you have paid full price for the gadget and got no refund, which is the whole point of the trick.",
            videos: [{ src: "ult-gadget-too-early", label: "Too early — no reset", kind: "dont" }],
          },
          {
            lead: "Practise the Super reset on ordinary shots first.",
            rest: "Learn the timing without spending a gadget on every attempt: throw normal attacks and reset them with the Super until the window is obvious. Only then put the gadget into it — you will learn far faster with the cheaper version.",
            videos: [{ src: "ult-reset-practice", label: "Drilling the timing with normal attacks" }],
          },
          { header: "Putting it together" },
          {
            lead: "Chain both and you get three gadget shots off one charge.",
            rest: "Once the gadget reset and the Super reset are both reliable you can stack them — reset the gadget twice and fire three long-range hugs from a single activation. This is the play that deletes a whole team, and it is what separates a good Shade from a Shade people are scared of.",
            videos: [{ src: "pro-trick-triple-gadget", label: "Three gadget shots, one charge", kind: "do" }],
            note: "Train this in the training room, and know that it needs a clean connection — on bad ping the window can disappear entirely, and forcing it anyway just throws the gadget away.",
          },
          { header: "Gadget 2 · Jump Scare" },
          {
            lead: "Don't take it.",
            rest: "A slow on nearby enemies is a real effect and there is nothing wrong with it in a vacuum. It just costs you everything above — the reset, the triple hug, the reason to pick Shade over another assassin. Longarms every game.",
          },
        ],
      },
      {
        key: "super", label: "Super & Star Power",
        intro: "Incorporeal Form is not an escape you spend once. It is a position: walls stop being boundaries and start being rooms you can stand in, and the whole game is about which room you pick and how you behave inside it.",
        tips: [
          { header: "Super · Incorporeal Form" },
          {
            lead: "Move in and out of the wall — don't park in it.",
            rest: "Sitting still inside a wall wastes it. Drifting in and out in small movements does two things at once: it extends your effective reach, because you can hug from just outside the wall and retreat inside it, and it baits ammo out of anyone watching. They spend shots on a target that steps back into geometry, and then you go in on an empty magazine.",
            videos: [{ src: "super-in-and-out-of-walls", label: "In and out, small movements", kind: "do" }],
          },
          {
            lead: "You can no longer stack the speed boost.",
            rest: "This changed — re-ulting while the previous one is still running does not extend or stack the movement speed, so activating again early simply throws the second Super away. Let the first run out, then use the next one.",
            videos: [{ src: "super-no-stacking-speed", label: "Re-ulting early wastes it", kind: "dont" }],
          },
          { header: "Star Power 2 · Hardened Hoodie" },
          {
            lead: "This is what makes the aggressive spots survivable.",
            rest: "Damage reduction while incorporeal means the wall in the middle of their team is a place you can actually live, not a place you visit once. Combined with Shield Gear's 8,300 you can hold a position that no enemy can reach and most cannot punish.",
          },
          { header: "Star Power 1 · Spooky Speedster" },
          {
            lead: "It rewards the shot you should already be landing.",
            rest: "Centre hits give a speed boost, and centre hits do double damage anyway — so it stacks a bonus on top of good play rather than fixing anything. The problem is that it pays out after you have connected, while Hardened Hoodie protects the approach. Take the Hoodie.",
          },
        ],
      },
      {
        key: "hyper", label: "Hyper",
        intro: "Nothing subtle here — the hyper is a delivery system for the trick you already learned.",
        tips: [
          {
            lead: "Run the triple gadget reset with it.",
            rest: "Land the hyper and then chain the resets: three long-range hugs into a grouped team, with the centre damage on each. Done properly their whole team disappears at once. Everything in the Gadget tab is the prerequisite — the hyper does not add a new skill, it just raises the payoff on the one you drilled.",
          },
          {
            lead: "Set it up from inside the wall.",
            rest: "You do not have to announce the hyper by walking at them. Take the wall position first, let them commit to a fight they think is 3v2, and open from a place they cannot shoot back into.",
          },
        ],
      },
      {
        key: "gameplay", label: "Gameplay",
        intro: "Shade's whole identity is standing where nobody can answer. Everything here is about picking that spot and not giving it up.",
        tips: [
          {
            lead: "Always aim the centre of the hug.",
            rest: "1,600 on the outside, 3,200 in the middle — the same attack is worth double if you line it up properly. Most low-value Shade games are just a series of outer-edge hits, so treat the centre as the shot and the edge as the miss.",
          },
          {
            lead: "Hug through the wall rather than around it.",
            rest: "Your attack hits through walls, which means you can trade with someone who has no way to trade back. Before you Super in, ask whether you can simply stand behind the cover and take the fight for free.",
          },
          {
            lead: "Pick the wall that keeps working.",
            rest: "The best positions are the ones that stay valuable after a respawn — a wall next to where the enemy has to walk, not one next to where they happened to be. That is the difference between a Super spent for one kill and a position that charges your next Super for the rest of the game.",
          },
          {
            lead: "Watch for the wall break.",
            rest: "Everything above depends on the geometry existing. Against a comp that can remove walls your safe rooms are temporary, so take value early and have a second position picked before the first one disappears.",
          },
        ],
      },
    ],

    // Shade is picked most in Hot Zone and wins least there. These notes lead
    // with that rather than hiding it — the live win rates on this page make
    // the point anyway, so pretending otherwise would just be a worse guide.
    modeNotes: {
      brawlBall: "Shade's strongest mode, and the numbers agree. Walls sit right where the fight is, the ball forces enemies into predictable lanes, and Incorporeal Form lets you hold ground beside their goal that nobody else on the map can contest.",
      heist: "Very strong. The safe is protected by exactly the thing Shade ignores — walk through the wall, hug the safe through it, and leave incorporeal. Farm Super on their defenders and treat every wall around the safe as a door.",
      gemGrab: "Solid. You are not the gem carrier and you are not contesting the mine head-on; you are the threat that appears inside the wall next to whoever is carrying, which forces them to play further back than they want to.",
      bounty: "Playable, but the mode punishes his main habit. Walking into a contested wall is how you hand over a star, so take the safe positions and let the enemy come to a place where you attack through cover for free.",
      hotZone: "Be honest about this one: Hot Zone is where Shade is picked most and where he wins least. The zone is open ground, contesting it means leaving your walls, and his damage does not hold a circle against a real controller. If you take him here, play the edges and the walls around the zone rather than the zone itself.",
      knockout: "His weakest mode. No respawns means a wall position that goes wrong ends the round, and walls come down as the round progresses — the geometry Shade needs is exactly what Knockout removes over time.",
    },

    // The Brawl Ball spot is a mode-wide idea rather than a single map's trick,
    // so it rides along on every map in the mode.
    modeVideos: {
      brawlBall: [
        { src: "mode-brawlball-safe-charge-spot", label: "The permanent charge spot by their goal", kind: "do" },
      ],
    },

    modeVideoNotes: {
      brawlBall: "This is the strongest position Shade gets in the whole mode. Standing inside the wall beside their goal, you charge your Super permanently — it keeps charging even after they respawn — and you are behind geometry nothing can reach. Not even splash damage touches you here.",
    },

    // Owner's positioning references: where to actually stand on each map. The
    // pattern is the same everywhere — the wall block you occupy in Incorporeal
    // Form — so the notes explain what that specific spot buys you.
    mapVideos: {
      "Parallel Plays": [{ image: "map-parallel-plays.jpg", label: "The wall block on the zone's edge" }],
      "Triple Dribble": [
        { image: "map-triple-dribble.jpg", label: "Centre wall — covers both lanes" },
        { image: "map-triple-dribble-2.jpg", label: "The wall beside the left lane" },
      ],
      "Layer Cake": [{ image: "map-layer-cake.jpg", label: "The wall by the left spawn lane" }],
      "Hard Rock Mine": [{ image: "map-hard-rock-mine.jpg", label: "The right-side wall cluster" }],
      "Pinball Dreams": [
        { image: "map-pinball-dreams.jpg", label: "The bumper wall beside mid" },
        { image: "map-pinball-dreams-2.jpg", label: "Pushed up — the wall in their half" },
      ],
      "Sneaky Fields": [{ image: "map-sneaky-fields.jpg", label: "The left wall stack off mid" }],
      "Hot Potato": [{ image: "map-hot-potato.jpg", label: "The crate wall on the safe's lane" }],
      "Open Business": [
        { image: "map-open-business.jpg", label: "The wall beside the right zone" },
        { image: "map-open-business-2.jpg", label: "The wall above the lower zone" },
      ],
      "Dueling Beetles": [{ image: "map-dueling-beetles.jpg", label: "The wall on the zone's north edge" }],
      // Not in the current ranked rotation, so this never renders today — it
      // activates by itself if Super Beach comes back round.
      "Super Beach": [{ image: "map-super-beach.jpg", label: "The crate wall left of mid" }],
    },

    mapNotes: {
      "Parallel Plays": "Shade's most-picked map by a distance — and one of his worse ones. The zone is wide open and he cannot hold it in a straight fight, so the picture below is the whole plan: take the wall on the zone's edge, attack through it, and let a teammate stand in the circle.\n\nIf you find yourself walking into the middle to contest, you have already lost the reason you picked him.",
      "Triple Dribble": "One of his best maps. Three lanes means enemies commit to one, and the centre wall covers two of them at once — you threaten whichever lane the ball goes down without moving. The second position pushes further up the left lane when you already have tempo.",
      "Layer Cake": "Heavily picked and distinctly mediocre here. Bounty punishes the aggressive wall dive, so use the spot below as a poke position: hug through the wall at anyone rotating past, and stay out of the open middle entirely.",
      "Hard Rock Mine": "Comfortable. The right-side wall cluster puts you next to the lane their gem carrier has to use, so you threaten the carry without ever contesting the mine directly. Let your team hold the middle.",
      "Pinball Dreams": "His best map in the pool. The bumper walls run right through the fight, so there is always a position that touches both the ball and their rotation. Start at mid and push to the second spot once you are ahead.",
      "Sneaky Fields": "The bush density cuts both ways — you get free approaches, but so do they, and Shade does not win a surprise fight he did not choose. Use the wall stack off mid as a fixed anchor and let the bushes be their problem.",
      "Hot Potato": "Strong. The crate wall on the safe's lane means you are hugging the safe through cover while their defenders have no angle on you. This is the shape every Heist map wants from Shade.",
      "Open Business": "Two zones means two sets of walls, and you should be rotating between them rather than picking one. Both spots below sit adjacent to a circle without standing in it — that is the whole idea.",
      "Dueling Beetles": "His weakest map in the pool by win rate, and worth being honest about: the zone is open, the walls sit off to the side, and there is not much geometry to hide the approach. If you take him here, hold the north wall and play purely for chip through cover.",
    },

    counterTips: [
      {
        lead: "Break the walls. That is the counter.",
        rest: "Everything Shade does depends on geometry — the safe positions, the free hugs through cover, the Super that goes where you cannot follow. Take the walls down around your objective and he becomes a short-range assassin standing in the open, which is a fight he loses to almost anybody.",
      },
      {
        lead: "Don't stand next to a wall you can't see behind.",
        rest: "His attack goes through cover, so a wall between you and Shade protects him and not you. When you know he is nearby, hold ground in the open where you can actually see the hug coming, or put real distance between yourself and the geometry.",
      },
      {
        lead: "Punish him the moment the Super drops.",
        rest: "Incorporeal Form is on a clock. Shade out of form is a 7,400 health brawler with short range and no escape, so track when he entered the wall and be ready to commit the instant he becomes solid again.",
      },
      {
        lead: "Make him hit the edge, not the centre.",
        rest: "The middle of the hug does double damage. Fighting him at an angle and staying off his centre line halves what he gets out of every attack — and against a Shade who has to chase for centre hits, kiting is genuinely effective.",
      },
      {
        lead: "Respect the long one.",
        rest: "If a Shade knows the reset trick, the range on the hug is not what you measured a second ago — and it can come three times off one gadget. When you see the long-range version once, stop trusting your spacing and back up further than feels necessary.",
      },
    ],
  },
};

// Local art overrides for abilities where the synced Brawlify CDN icon has
// gone stale (a rework changed the effect but the old icon is still served —
// confirmed by comparing against the current in-game asset). Keyed by
// "BRAWLER_KEY::Ability Name". Files live in public/icons/star-powers/ or
// public/icons/gadgets/ and are used AS PROVIDED, unmodified — Supercell's own
// full badge art, not re-cropped to match the CDN's borderless style.
const ICON_OVERRIDES = {
  "BROCK::More Rockets": "/icons/star-powers/BROCK_MORE_ROCKETS.png",
};
export const iconOverride = (brawlerKey, abilityName) =>
  ICON_OVERRIDES[`${norm(brawlerKey)}::${abilityName}`] || null;

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
