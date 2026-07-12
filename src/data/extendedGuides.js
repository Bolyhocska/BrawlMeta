// ─── Extended brawler guides ─────────────────────────────────────────────────
// Generates a full written guide for EVERY brawler: game plan, strengths &
// weaknesses, and draft timing — driven by each brawler's class archetype and
// draft profile, with hand-written overrides for headline meta brawlers.
//
// Video strategy: a few verified creator guides are embedded where we have a
// solid match; every brawler additionally gets a YouTube search deep-link,
// which always surfaces the NEWEST guides (embeds go stale, search doesn't).

import BRAWLER_META from "./brawlerMeta.json";
import { getDraftProfile } from "./draftMeta";

const CLASS_PLAYBOOK = {
  "Marksman": {
    gameplan: [
      "Your win condition is range discipline: park at the edge of your attack's reach, hit the shots the enemy has to walk through, and never let the fight come to you. Every tile you give up shrinks your advantage — every tile you hold makes the enemy's approach more expensive.",
      "Track the enemy's gap-closers before anything else. The moment an assassin's super is charged, your positioning rules change: hug your teammates, hold a wall between you and the flank path, and pre-aim the jump spot.",
    ],
    strengths: ["Controls open sightlines all game", "Punishes every enemy mistake from safety", "Strong in the final seconds of range-favored modes"],
    weaknesses: ["Folds to gap-close pressure up close", "Weak in bush-heavy maps with short sightlines", "Low forgiveness — missed shots waste your whole value"],
  },
  "Artillery": {
    gameplan: [
      "You don't need line of sight — that's the whole kit. Arc shots over the walls the enemy thinks are protecting them, deny the ground they want to stand on, and turn every choke point into a place nobody contests for free.",
      "Your weakness is everything within two tiles of you. Play behind your front line, keep a wall between you and open lanes, and treat an approaching assassin as a fire alarm: move first, throw later.",
    ],
    strengths: ["Damages through walls nobody else can touch", "Elite area denial on chokes and objectives", "Forces enemies off comfortable positions"],
    weaknesses: ["Nearly helpless in point-blank fights", "Struggles on wide-open maps with no walls to exploit", "Slow projectiles are dodge-able at range"],
  },
  "Tank": {
    gameplan: [
      "Your health bar is a resource the team spends to take space — but only spend it when the trade is real. Walk in when the enemy's damage is on cooldown, when your super is up, or when a teammate can follow; walking in 'because you're tanky' is how tanks feed.",
      "Use bushes and walls to close distance for free. The open-field walk-up against ranged brawlers is the losing line every time; the flank through cover is the winning one.",
    ],
    strengths: ["Wins every fight inside your effective range", "Turns bushes and walls into ambush tools", "Soaks pressure so squishier teammates can work"],
    weaknesses: ["Kited to death in the open by ranged picks", "Chipped down by throwers before reaching anything", "Super-reliant — obvious to play around when it's down"],
  },
  "Assassin": {
    gameplan: [
      "You're not a fighter, you're an executioner: your job is deleting one specific target — usually their sniper or their support — and getting out. Pick the target before the fight starts, commit only when the kill is actually there, and treat even trades as losses.",
      "Patience is your real weapon. The enemy knows what you want to do; let them burn their escape tools and supers on your teammates first, then take the angle they stopped watching.",
    ],
    strengths: ["Deletes priority targets through one committed window", "Punishes immobile backline brawlers all game", "Mobility tools double as escapes when played with discipline"],
    weaknesses: ["Hard-countered when revealed early in a draft", "Tanks and area control invalidate the dive", "Falls apart when forced to play front-line"],
  },
  "Damage Dealer": {
    gameplan: [
      "You're the pressure engine: consistent damage output that makes every inch of the map cost the enemy health. Play the mid-range band — close enough to hit reliably, far enough that divers can't reach you for free — and keep shots flowing so your supers cycle.",
      "Your flexibility is the point. Rotate to whichever lane is losing, punish tanks that overstep, and force enemies to respect space they'd otherwise take.",
    ],
    strengths: ["Reliable damage into almost every comp", "Melts tanks that try to walk through you", "Flexible — rarely a dead pick on any map"],
    weaknesses: ["Out-ranged by dedicated snipers", "Rarely the hard-carry — wins through consistency, not takeover", "Mid-range band takes constant poke"],
  },
  "Controller": {
    gameplan: [
      "You decide where the fight is allowed to happen. Zone tools, slows, knockbacks, vision denial — every piece of your kit is about making the enemy's preferred position unavailable and your team's position safe.",
      "Play the objective clock, not the kill feed. Controllers win by making every second of enemy objective time expensive; a game where you dealt the least damage but held mid the whole match is a game you carried.",
    ],
    strengths: ["Dictates the geometry of every fight", "Excellent objective-mode value (zones, mid control)", "Utility stays useful even in losing matchups"],
    weaknesses: ["Low kill threat — relies on teammates to convert", "Can be out-paced by hyper-aggressive comps", "Value is invisible on the scoreboard, easy to misplay as a fighter"],
  },
  "Support": {
    gameplan: [
      "Your team's health bars are your damage output. Position one step behind the front line, keep healing uptime on whoever is soaking pressure, and remember that a dead support heals nobody — your survival is a team resource.",
      "Track the enemy's dive threat constantly: supports are the priority target for every assassin in the game. Play near peel, hold your escape tool, and make them pay a full commitment to reach you.",
    ],
    strengths: ["Multiplies the value of every teammate", "Turns close fights into won fights with sustain", "High-value super economy in long fights"],
    weaknesses: ["Primary assassination target every game", "Limited solo carry potential", "Weak when the team fights split up"],
  },
  "Unknown": {
    gameplan: [
      "Play to your kit's range band and the map in front of you: hold the positions where your attacks connect and the enemy's don't, and trade only when the numbers favor you.",
    ],
    strengths: ["Flexible pick"],
    weaknesses: ["Master the matchup spread before ranked play"],
  },
};

// Hand-written overrides for headline meta brawlers.
const BRAWLER_NOTES = {
  "EDGAR": "Edgar is the textbook counterable brawler: his entire game is one jump onto a squishy target. In ranked, never reveal him early — he only works as a late reactive pick into comps with no tank, no knockback, and an exposed backline. If they have any of those three, the jump is a donation.",
  "MORTIS": "Mortis lives and dies on ammo discipline: three dashes is your whole mobility, damage, and escape budget. Dash in only on reload advantage, target supports and throwers exclusively, and accept that some drafts simply don't have a Mortis game in them.",
  "PIPER": "Piper wants maximum-range duels forever — her damage falls off hard up close. Open maps are her kingdom; use Auto Aimer's knockback as a get-off-me tool, not an engage. One of the safest first picks in the game on any open sightline map.",
  "BROCK": "Brock trades Piper's point damage for wall-breaking and area pressure. His super opening a sightline is a permanent map advantage — spend it early on the wall that protects their comfort position and the rest of the game gets easier.",
  "SPIKE": "Spike is the premier flex pick: real damage, real area control via super, and no true hard counter. Curveball turns whiffs into chip. If you're unsure what your team needs, Spike is almost never wrong.",
  "GENE": "Gene's pull is the highest-leverage single button in ranked: one good grab converts a stalemate into a 3v2. Hold it for the target that matters — pulling a tank into your team is throwing; pulling their healer or sniper wins the fight.",
  "LEON": "Leon's invisibility is scouting, flanking, and execution in one kit — but his damage falloff means the kill window is closer than it feels. Get to point-blank before breaking stealth, and use clones to fake lane presence during rotations.",
  "SURGE": "Surge is a snowball engine: each upgrade stage changes what fights you can take. Stage 1 Surge plays like a coward; max Surge plays like a tank-assassin hybrid. Protect the early game, and don't take even trades that reset your stages for free.",
  "CHUCK": "Chuck ignores the map's rules in Heist: posts create a private railway to the safe. Set the route before committing, and remember the post network is the win condition — protecting it matters more than any single trade.",
  "FANG": "Fang's super chains through grouped enemies — his dream fight is the clumped push. Into spread-out range comps he's just a slow walker; save him for drafts where the enemy wants to group (Brawl Ball especially).",
  "MEG": "Meg is two health bars in a trench coat: the mech is the fight, the pilot is the reset. Charge the mech safely from range, and when it breaks, disengage immediately — pilot deaths are what actually lose Meg games.",
  "CROW": "Crow is chip, vision, and finish — not raw damage. Poison forces enemies off heal rhythm and reveals rotations; his super is both an engage on a weakened team and the game's most reliable escape. Flexible enough to blind pick despite being an assassin.",
};

// Verified creator guide embeds (kept small on purpose — embeds go stale;
// the search link below always finds the newest).
const BRAWLER_VIDEOS = {
  "CHUCK": { id: "kyCBSdlw2mc", title: "How to Play Chuck (Heist) — Updated 2025" },
  "COLT": { id: "hezq7h9_Vuo", title: "Colt Guide: The Best Heist Brawler?" },
  "EL PRIMO": { id: "Sbkd1Hu8UrA", title: "El Primo Gem Grab Pro Tips" },
  "DARRYL": { id: "hdkkTDQqCvA", title: "How to Hold the Hot Zone with Darryl" },
};

const norm = (k) => (k || "").toUpperCase().trim();

export function getExtendedGuide(key) {
  const k = norm(key);
  const meta = BRAWLER_META[k] || {};
  const profile = getDraftProfile(k);
  const playbook = CLASS_PLAYBOOK[profile.class] || CLASS_PLAYBOOK.Unknown;
  const name = k.toLowerCase().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

  const draftTiming = profile.firstPickSafety >= 0.75
    ? `${name} is a safe early pick — hard to punish even when the enemy drafts with full knowledge of it. Comfortable as a first pick or blind pick.`
    : profile.firstPickSafety <= 0.42
    ? `${name} is a reactive pick: revealing it early hands the enemy a free counter-draft. Hold it for the later pick rotations, after the enemy has committed to a comp it punishes.`
    : `${name} is flexible in the draft — reasonable at most pick positions, best when at least one enemy pick is known.`;

  const counterText = [
    profile.counters.length ? `Preys on ${profile.counters.join(", ").toLowerCase()} classes.` : null,
    profile.counteredBy.length ? `Punished by ${profile.counteredBy.join(", ").toLowerCase()} classes — check the enemy draft for these before locking.` : null,
  ].filter(Boolean).join(" ");

  return {
    class: profile.class,
    gameplan: [
      ...(BRAWLER_NOTES[k] ? [BRAWLER_NOTES[k]] : []),
      ...playbook.gameplan,
    ],
    strengths: playbook.strengths,
    weaknesses: playbook.weaknesses,
    draftTiming,
    counterText,
    loadout: {
      starPowers: (meta.starPowers || []).map(sp => sp.name),
      gadgets: (meta.gadgets || []).map(g => g.name),
    },
    video: BRAWLER_VIDEOS[k] || null,
    videoSearchUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(name + " brawl stars guide")}`,
  };
}
