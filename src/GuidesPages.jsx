import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import SiteHeader from "./SiteHeader";
import BRAWLER_META from "./data/brawlerMeta.json";
import { slugifyBrawlerKey } from "./BrawlersPage";
import { tileStyles } from "./data/brawlerTile";

// ─── Shared shell + primitives (from the cyberpunk design handoff) ───────────

const MONO = "'JetBrains Mono', monospace";
const DISPLAY = "'Baloo 2', sans-serif";

export function GuideShell({ children }) {
  return (
    <div style={{
      position: "relative", minHeight: "100vh", background: "#08080c",
      backgroundImage: "linear-gradient(rgba(179,107,255,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(179,107,255,.04) 1px, transparent 1px)",
      backgroundSize: "44px 44px", overflow: "hidden",
      color: "#e9e9f2", fontFamily: "'Chakra Petch', sans-serif", WebkitFontSmoothing: "antialiased",
    }}>
      <div style={{ position: "absolute", top: -160, right: -120, width: 820, height: 720, background: "radial-gradient(ellipse, rgba(179,107,255,.20), transparent 68%)", pointerEvents: "none", filter: "blur(20px)" }} />
      <div style={{ position: "absolute", bottom: -260, left: -160, width: 760, height: 640, background: "radial-gradient(ellipse, rgba(255,180,61,.10), transparent 70%)", pointerEvents: "none", filter: "blur(20px)" }} />
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(ellipse 120% 80% at 50% 20%, transparent 55%, rgba(0,0,0,.5))" }} />
      <SiteHeader />
      {children}
      <footer style={{
        position: "relative", zIndex: 10, padding: "32px 5vw", borderTop: "1px solid rgba(255,255,255,.06)",
        display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12,
        fontFamily: MONO, fontSize: 11, letterSpacing: 1, color: "#5a5a6a",
      }}>
        <span>BRAWLMETA — UNOFFICIAL STRATEGY GUIDE</span>
        <span>v2026.1 · META SNAPSHOT</span>
      </footer>
      <style>{`html { scroll-behavior: smooth; }`}</style>
    </div>
  );
}

function Eyebrow({ children, dotColor = "#b36bff", color = "#c98bff", borderColor = "rgba(179,107,255,.3)" }) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 9, width: "fit-content",
      padding: "9px 18px 9px 14px", borderRadius: 999, background: "rgba(13,13,20,.6)",
      border: `1px solid ${borderColor}`, fontFamily: MONO, fontSize: 12, letterSpacing: 2.5, color,
    }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, boxShadow: `0 0 8px ${dotColor}` }} />
      {children}
    </div>
  );
}

function StatChip({ value, label, color = "#f4f4fa" }) {
  return (
    <div style={{ padding: "16px 22px", borderRadius: 20, background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", fontFamily: MONO }}>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 10, letterSpacing: 2, color: "#6f7180", marginTop: 2 }}>{label}</div>
    </div>
  );
}

function Panel({ children, tinted, gold, style }) {
  const base = tinted
    ? { background: gold ? "linear-gradient(160deg, rgba(255,180,61,.10), rgba(20,14,32,.3))" : "linear-gradient(160deg, rgba(179,107,255,.10), rgba(20,14,32,.4))",
        border: gold ? "1px solid rgba(255,180,61,.24)" : "1px solid rgba(179,107,255,.22)" }
    : { background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)" };
  return <div style={{ borderRadius: 28, padding: 38, display: "flex", flexDirection: "column", gap: 18, ...base, ...style }}>{children}</div>;
}

function BrawlerChipRow({ names }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 6 }}>
      {names.map(n => (
        <span key={n} style={{
          fontFamily: MONO, fontSize: 11, letterSpacing: ".5px", padding: "6px 12px", borderRadius: 999,
          background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.08)", color: "#c9c9d6", whiteSpace: "nowrap",
        }}>{n}</span>
      ))}
    </div>
  );
}

// Embedded creator guide clip — privacy-enhanced YouTube embed with a visible
// watch-on-YouTube fallback link (some channels disable embedding).
export function VideoClip({ videoId, title, note }) {
  return (
    <div style={{ borderRadius: 24, overflow: "hidden", background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)" }}>
      <div style={{ position: "relative", paddingTop: "56.25%" }}>
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${videoId}`}
          title={title}
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          loading="lazy"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
        />
      </div>
      <div style={{ padding: "14px 20px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#f4f4fa" }}>{title}</div>
          {note && <div style={{ fontSize: 11.5, color: "#8b8b9c", marginTop: 2 }}>{note}</div>}
        </div>
        <a href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noreferrer" style={{
          fontFamily: MONO, fontSize: 10, letterSpacing: 1, color: "#c98bff", textDecoration: "none",
          padding: "7px 14px", borderRadius: 999, border: "1px solid rgba(179,107,255,.3)", background: "rgba(179,107,255,.08)", whiteSpace: "nowrap",
        }}>WATCH ON YOUTUBE ↗</a>
      </div>
    </div>
  );
}

// Renders **bold** spans inside guide copy.
function RichText({ text, style }) {
  const parts = text.split("**");
  return (
    <p style={style}>
      {parts.map((p, i) => i % 2 === 1 ? <strong key={i} style={{ color: "#f4f4fa" }}>{p}</strong> : p)}
    </p>
  );
}

const h2Style = { fontFamily: DISPLAY, fontSize: "clamp(24px,3vw,32px)", color: "#f4f4fa", letterSpacing: "-.3px" };
const h2CenterStyle = { fontFamily: DISPLAY, fontSize: "clamp(26px,3.4vw,36px)", color: "#f4f4fa", letterSpacing: "-.3px", marginBottom: 26, textAlign: "center" };
const bodyStyle = { fontSize: 15.5, lineHeight: 1.7, color: "#b0b0c0" };

// ─── Mode guide content ──────────────────────────────────────────────────────
// Heist content is 1:1 from the design handoff; the other five modes follow
// the same structure.

export const MODE_GUIDES = {
  heist: {
    name: "Heist", accent: "#ffb43d",
    video: { id: "W7TvxadZCNM", title: "How To Play Heist (2025) — Full Guide", note: "Recent full-mode walkthrough — rotations, comps, and safe-race decisions." },
    intro: "Two teams of three, two safes, one objective: destroy the enemy safe before yours goes down. No control point, no gems, no ball — just a damage race.",
    stats: [
      { value: "3v3", label: "TEAM SIZE", color: "#f4f4fa" },
      { value: "25%", label: "SAFE SHIELD STEP", color: "#ffb43d" },
      { value: "3s", label: "IMMUNITY WINDOW", color: "#c98bff" },
    ],
    how: [
      "The safe doesn't fight back, but it isn't defenseless: every time it loses 25% of its total health, it goes immune for 3 seconds and knocks back anyone standing nearby. That window matters — it's often the moment a defending team resets, and the moment an attacking team should be repositioning rather than standing still.",
      "If neither safe falls before time runs out, whichever team's safe has more health remaining wins. There's no control point, no gem count, no ball — Heist is pure damage-race logistics: who can put more sustained or burst damage onto a stationary target while giving up less to the enemy pushing theirs.",
    ],
    roles: [
      { tag: "SAFE-CRACKERS", accent: "#ffb43d", title: "Safe-crackers",
        desc: "Throwers can arc damage over walls directly onto the safe, sidestepping the line-of-sight problem everyone else has to solve with positioning. Fast melee brawlers burst hard on an unopposed run, but are punished hardest by a well-timed defense.",
        brawlers: ["Barley", "Dynamike", "Sprout", "Larry & Lawrie", "Tick", "Bull", "Darryl", "El Primo"] },
      { tag: "SAFE-DEFENDERS", accent: "#b36bff", title: "Safe-defenders",
        desc: "Splash-damage brawlers are efficient on defense because a single well-placed shot can hit both an incoming attacker and chip the safe if the enemy overextends. Area-denial supers matter more here than raw 1v1 strength.",
        brawlers: ["Penny", "Squeak", "Willow", "Mr. P", "Hank"] },
      { tag: "LONG-RANGE CONTROL", accent: "#8ee6b0", title: "Long-range control",
        desc: "On maps with open sightlines, snipers apply constant pressure to the safe from a position the enemy can't easily punish, without ever fully committing.",
        brawlers: ["Piper", "Brock", "Mandy", "Rico", "8-Bit", "Byron", "Colt"] },
    ],
    drafting: "Ban priority should track whichever throwers and mobile rushers are strongest that patch — they scale hardest with an unopposed lane. When picking, decide early whether your team is playing for a **rush** (burst the safe fast, accept the risk) or a **grind** (control the map, chip safe health over the full match). Mixing both without coordination usually means you're neither pushing hard enough to close it out nor defending well enough to hold your own safe.",
    mistakes: [
      { title: "Grouping up on defense", desc: "Stacking all three players on your own safe means the enemy only has to bait one bad rotation. Split the damage soak instead." },
      { title: "Pushing without tracking supers", desc: "A rush that looks clean can get erased by a super the enemy's been saving. Count charge, not just health bars." },
      { title: "Standing still through immunity", desc: "The 3-second shield after a 25% chunk is a reposition cue, not a break. Attackers who wait get punished; defenders who don't regroup lose the next push clean." },
      { title: "Ignoring the side lanes", desc: "On maps with multiple approaches, funneling everyone through one lane makes your push predictable and your defense easy to flank." },
    ],
    tips: [
      { lead: "Track the immunity window, not just the timer.", rest: "When the safe flashes and knocks back, that's your cue to reposition — not to keep pressing forward into a guaranteed reset." },
      { lead: "Don't let one brawler solo the safe.", rest: "Rotate who's tanking damage on attack and who's soaking hits on defense — a single overextended brawler dies for free and gives up map control." },
      { lead: "Call out safe health thresholds to your team.", rest: "A quick ping at 50% and 25% keeps everyone's rotations synced instead of guessing when to commit." },
      { lead: "Keep at least one long-range or splash option in your comp.", rest: "It punishes overextensions and keeps chip damage flowing on the safe even when close-range duels are lost." },
      { lead: "Save supers for the reset, not the poke.", rest: "A banked super during the immunity window often wins the follow-up fight outright — don't spend it just to shave a little safe health." },
    ],
    mapGuide: { title: "Heist on Safe Zone", desc: "One lane, no wall cover, sniper-friendly — see best picks and lane tricks for this specific map.", href: "/guides/modes/heist/safe-zone" },
  },

  gemGrab: {
    name: "Gem Grab", accent: "#b36bff",
    video: { id: "jsMIyZN7IXQ", title: "Gem Grab Guide — The Strategy Pros Use", note: "Mid control, carrier discipline, and the 15-second countdown game." },
    intro: "A gem mine in the center of the map produces gems one at a time. Hold ten between your team and survive the countdown — die carrying them and they scatter for anyone to take.",
    stats: [
      { value: "10", label: "GEMS TO WIN", color: "#c98bff" },
      { value: "~7s", label: "GEM SPAWN RATE", color: "#ffb43d" },
      { value: "15s", label: "WIN COUNTDOWN", color: "#f4f4fa" },
    ],
    how: [
      "Gems spawn from the central mine roughly every seven seconds. When one team holds ten or more total gems, a 15-second countdown starts — if it reaches zero, that team wins. Any carrier dying resets the situation instantly: every gem they held drops on the spot for either team to pick up.",
      "This makes Gem Grab a control mode disguised as a collection mode. The gems themselves are only the scoreboard — the real game is who controls the middle of the map, because mid control decides who collects safely and who has to fight for scraps.",
    ],
    roles: [
      { tag: "GEM CARRIER", accent: "#b36bff", title: "Gem carrier",
        desc: "Usually your mid brawler. Their job is to collect and then NOT die — positioning behind the front line matters more than damage output once they're holding six or more.",
        brawlers: ["Gene", "Tara", "Poco", "Gray", "Sandy", "Otis"] },
      { tag: "LANE PRESSURE", accent: "#ffb43d", title: "Lane pressure",
        desc: "Side laners keep the enemy's attention off your carrier and deny the enemy team a free path to the mine. Winning your lane translates directly into mid control.",
        brawlers: ["Colt", "Rico", "Spike", "Surge", "Chester", "Pearl"] },
      { tag: "COUNTER / ANCHOR", accent: "#8ee6b0", title: "Counter & anchor",
        desc: "One pick should answer whatever the enemy is building toward — a tank counter if they went heavy, an assassin answer if they're diving your carrier.",
        brawlers: ["Piper", "Mandy", "Emz", "Gale", "Willow"] },
    ],
    drafting: "Draft your **mid** first only if it's a safe flex pick like Gene or Tara — dedicated carriers with weak self-defense are punished if revealed early. Lane picks can be more aggressive. Always answer the question: **who on this team is holding gems in the last 30 seconds?** If the answer is nobody, the comp is incoherent no matter how strong each pick looks individually.",
    mistakes: [
      { title: "The carrier plays like a fighter", desc: "Ten gems means nothing if the carrier trades themselves for a kill. Once holding, their job is to exist, not to fight." },
      { title: "Chasing kills during the countdown", desc: "When your countdown is running, you win by not dying. Backing off to spawn walls is almost always right — kills add nothing." },
      { title: "Everyone stacks mid", desc: "Three players at the mine means two open lanes, and flanking enemies arrive at your mid with super charged." },
      { title: "No gem-count awareness", desc: "Trading a fight when the enemy is at nine gems and you're at two is throwing — track the count and pick fights accordingly." },
    ],
    tips: [
      { lead: "Gems don't expire — patience does.", rest: "A team that's behind on gems but ahead on map control should keep squeezing rather than force a desperate fight at the mine." },
      { lead: "Punish the enemy carrier's greed.", rest: "Carriers who keep collecting past ten instead of retreating are one pick away from handing you the game." },
      { lead: "Rotate lanes when yours is lost.", rest: "Losing a 1v1 doesn't mean feeding it forever — collapse mid or swap sides and make the winner walk into a 2v1." },
      { lead: "Use the countdown as a timer for your all-in.", rest: "If the enemy hits ten, you have 15 seconds where THEY want to run — that's the safest moment to force fights you'd normally avoid." },
      { lead: "Spawn control ends games.", rest: "When ahead, push your line up to their spawn walls. Respawning enemies who can't leave spawn can't contest the mine." },
    ],
    mapGuide: null,
  },

  brawlBall: {
    name: "Brawl Ball", accent: "#3B82F6",
    video: { id: "7jZGa7lejRE", title: "The Only Brawl Ball Guide You'll Ever Need", note: "Pro tips & strategies — the newest full Brawl Ball breakdown." },
    intro: "Football with fights. Carry or pass the ball into the enemy goal — two goals wins outright, and holding the ball means you can't attack.",
    stats: [
      { value: "2", label: "GOALS TO WIN", color: "#60a5fa" },
      { value: "3v3", label: "TEAM SIZE", color: "#f4f4fa" },
      { value: "0", label: "ATTACKS WHILE CARRYING", color: "#ffb43d" },
    ],
    how: [
      "The ball spawns at center field. Whoever holds it can't attack — passing and movement are the only options — so possession is a liability without teammates creating space. Scoring resets both teams to their spawns; two goals ends the match immediately, and a tie at full time goes to overtime where walls around the goals break down.",
      "Because the carrier is defenseless, Brawl Ball is about clearing the path BEFORE the ball moves. Kills matter more here than in any other 3v3 mode: a numbers advantage of even one player usually converts directly into a goal.",
    ],
    roles: [
      { tag: "BALL CARRIER", accent: "#60a5fa", title: "Ball carrier & playmaker",
        desc: "Mobile brawlers with dashes or jumps can turn a half-open lane into a goal. Their supers double as goal-scoring tools — held supers are goals waiting to happen.",
        brawlers: ["Mortis", "Max", "Stu", "Fang", "El Primo", "Buzz"] },
      { tag: "MIDFIELD CONTROL", accent: "#b36bff", title: "Midfield control",
        desc: "Area control brawlers own the center, forcing the enemy to play the ball wide into slower, more readable attacks.",
        brawlers: ["Sandy", "Spike", "Gale", "Emz", "Willow", "Charlie"] },
      { tag: "LAST DEFENDER", accent: "#8ee6b0", title: "Last defender",
        desc: "Someone has to be the player who doesn't chase. Tanks and knockback brawlers make goal-line stands and clear the ball out of danger.",
        brawlers: ["Frank", "Bibi", "Ash", "Poco", "Gene", "Draco"] },
    ],
    drafting: "Brawl Ball drafts collapse into a simple question: **who wins the midfield brawl, and who converts it into goals?** Control picks are safe early. Save your finisher (Mortis, Max, Fang) for later picks once you can see whether the enemy has the tools to punish them. **Never draft three brawlers who all want the ball** — someone has to do the fighting.",
    mistakes: [
      { title: "Everyone chases the ball", desc: "The ball is bait. Three players converging on it means an open enemy on each wing, and one pass beats all three of you at once." },
      { title: "Carrying into a full enemy team", desc: "Solo-dribbling into three defenders trades the ball for nothing. Reset it, hold possession, and wait for a pick." },
      { title: "Wasting wall-breaking supers", desc: "Walls around the goal are your defense's structure. Breaking them for chip damage hands the enemy easier shots for the rest of the game." },
      { title: "No one on the goal line in overtime", desc: "Overtime removes the goal walls — an uncontested long shot can end the game while your team brawls mid." },
    ],
    tips: [
      { lead: "Score off respawns, not off scrambles.", rest: "The cleanest goals come right after winning a fight — count enemy respawn timers and time your push for the window when it's 3v1 or 3v2." },
      { lead: "Pass backward to go forward.", rest: "A backward pass to a safe teammate keeps possession; a hopeful forward carry usually donates the ball at midfield." },
      { lead: "Hold your super as the carrier's escort.", rest: "Supers that knock back or stun are goal-savers on defense and path-openers on offense — spending them in neutral fights wastes their game-winning value." },
      { lead: "Learn each map's wall gaps.", rest: "Kick lanes through gaps let you score from farther out than most defenders expect — walk the line before committing the shot." },
      { lead: "Force the enemy to hold the ball.", rest: "An enemy carrying the ball is an enemy who can't shoot back. Pressure the carrier, ignore the escorts." },
    ],
    mapGuide: null,
  },

  knockout: {
    name: "Knockout", accent: "#FF6B35",
    video: { id: "kTLAfsS0_Uw", title: "Knockout Guide — Best Brawlers for Every Map", note: "Range wars, super economy, and poison positioning." },
    intro: "Best-of-three elimination rounds with no respawns. Win a round by wiping the enemy team — and survive the poison clouds that shrink the arena as time runs on.",
    stats: [
      { value: "Bo3", label: "ROUND FORMAT", color: "#ffb43d" },
      { value: "0", label: "RESPAWNS", color: "#ff8f8f" },
      { value: "3v3", label: "TEAM SIZE", color: "#f4f4fa" },
    ],
    how: [
      "Each round is a single team fight: no respawns, first team fully eliminated loses the round, first to two rounds takes the match. As the round timer runs down, poison clouds close in from the edges, squeezing both teams toward the middle so rounds can't stall forever.",
      "No respawns changes everything about how much a death costs. In Gem Grab a bad trade loses you tempo; in Knockout it loses you the round. The mode rewards patient chip damage, super economy across rounds, and knowing when a round is already lost so you can save information and supers for the next one.",
    ],
    roles: [
      { tag: "SNIPER PRESSURE", accent: "#ffb43d", title: "Sniper pressure",
        desc: "Long-range brawlers dictate the early round. Chipping an enemy to half health before the poison forces movement effectively wins the fight before it starts.",
        brawlers: ["Piper", "Brock", "Mandy", "Belle", "Bonnie", "Angelo"] },
      { tag: "MID ANCHOR", accent: "#b36bff", title: "Mid anchor",
        desc: "Bush control and area denial in the center decide where the final poison-forced fight happens — and whoever picked the ground usually wins it.",
        brawlers: ["Bo", "Tara", "Sandy", "Gale", "Buster", "Cordelius"] },
      { tag: "CLOSER", accent: "#8ee6b0", title: "Closer",
        desc: "When the poison forces everyone into one bush-lined box, burst damage up close finishes what the snipers started.",
        brawlers: ["Shelly", "Bull", "Edgar", "Kenji", "Bibi", "Fang"] },
    ],
    drafting: "Knockout is the most matchup-driven mode in ranked — a hard-countered pick can't hide behind objectives, because there are none. **Never first-pick an assassin or short-range brawler on an open map** — the enemy simply picks range and you lose the poke war three rounds in a row. Draft range first, then answer their comp with your closer.",
    mistakes: [
      { title: "Taking a 2v3 fight after first blood", desc: "Losing one player early means playing for poison time, not fighting. Retreat, stall, and make them chase through chip damage." },
      { title: "Burning supers in a lost round", desc: "Supers partially carry between rounds. Dumping everything into a round you've already lost starts the next one at a disadvantage." },
      { title: "Standing in poison for greed", desc: "The clouds out-damage most healing. A kill secured while standing in poison often converts into a 1-for-1 the enemy wins on positioning." },
      { title: "Fighting where the enemy is strong", desc: "If they drafted close-range, the final circle fight is theirs — spend the whole round chipping so they're too low to win it." },
    ],
    tips: [
      { lead: "Round one is information.", rest: "Even losing it teaches you their engage pattern, super timings, and who their win condition is — adjust rounds two and three accordingly." },
      { lead: "Health bars decide who dictates.", rest: "The team with higher total health controls the tempo — if you're chipped, back off and reset before poison locks you in." },
      { lead: "Play the poison, not against it.", rest: "Position so the shrinking zone pushes ENEMIES toward you, not you toward them. Fighting with poison at your back is fighting cornered." },
      { lead: "Count enemy supers out loud.", rest: "With no respawns, one surprise super decides rounds. Track charge like it's a health bar." },
      { lead: "Never clump against throwers and piercers.", rest: "Stacked teammates turn one good enemy shot into a lost round. Spread until the final forced fight." },
    ],
    mapGuide: null,
  },

  hotZone: {
    name: "Hot Zone", accent: "#EF4444",
    video: { id: "8tgKC69EQfY", title: "Never Lose Hot Zone Again — 5 Pro Tips", note: "Zone math, contesting with one toe, and when to reset." },
    intro: "Stand in the marked zones to fill your team's capture meter. First team to 100% — or the higher percentage when time expires — takes the win.",
    stats: [
      { value: "100%", label: "CAPTURE TO WIN", color: "#ff8f8f" },
      { value: "1-2", label: "ZONES PER MAP", color: "#ffb43d" },
      { value: "3v3", label: "TEAM SIZE", color: "#f4f4fa" },
    ],
    how: [
      "Every second a teammate stands inside a zone with no enemy contesting, your meter ticks up. Zones tick faster with more teammates inside, and a contested zone ticks for nobody. Unlike Gem Grab there's nothing to drop and no countdown to interrupt — progress is permanent, which makes early leads brutally hard to claw back.",
      "The mode is a war of attrition around fixed ground. You can't dodge the objective, so team fights happen ON the zone, over and over, and sustain — healing, shields, respawn timing — matters more than burst.",
    ],
    roles: [
      { tag: "ZONE SQUATTER", accent: "#ff8f8f", title: "Zone squatter",
        desc: "Tanks and high-HP brawlers stand on the point and simply refuse to die. Every second they buy is permanent progress.",
        brawlers: ["Rosa", "Draco", "Frank", "Ash", "Buster", "Meg"] },
      { tag: "AREA DENIAL", accent: "#b36bff", title: "Area denial",
        desc: "Throwers and zone-control brawlers make standing on the point miserable, chipping squatters out without stepping in themselves.",
        brawlers: ["Sprout", "Willow", "Emz", "Lou", "Sandy", "Charlie"] },
      { tag: "PEEL & SUSTAIN", accent: "#8ee6b0", title: "Peel & sustain",
        desc: "Healers and support picks keep the squatter alive through the grind and punish divers who commit onto the zone.",
        brawlers: ["Poco", "Byron", "Gus", "Pam", "Kit", "Gray"] },
    ],
    drafting: "Hot Zone drafts are won by **sustain math**: whichever comp can keep bodies on the zone longer wins, so healers and tanks spike in value. Aggro assassin comps struggle — there's nowhere for the enemy to hide, so ambush value evaporates. **Ban the premier throwers** on double-zone maps; they solo-hold a zone while their team stacks the other.",
    mistakes: [
      { title: "Fighting off the zone", desc: "Kills three screens away from the point win nothing. Every fight should either happen on the zone or peel someone off it." },
      { title: "All three on one zone", desc: "On two-zone maps, ceding one zone entirely means you need a permanent 100% hold of yours — split pressure instead." },
      { title: "Diving into sustain comps", desc: "Trading your assassin into a Poco-backed tank is a donation. Chip the healer out first." },
      { title: "Ignoring the respawn stagger", desc: "Dying one-by-one means the zone is never yours. Reset together, push together — synchronized respawns are hidden tempo." },
    ],
    tips: [
      { lead: "Percentages are permanent — act like it.", rest: "A 20% early lead means the enemy needs a 20% longer hold later. Squeeze every uncontested second, especially pre-first-fight." },
      { lead: "Contest with one toe.", rest: "You only need a pixel of your hitbox inside the zone to freeze the enemy's ticks. Contest from maximum cover, not center stage." },
      { lead: "Save supers for zone flips.", rest: "The moment a fight is won and the zone flips is when supers matter — clearing a defended zone without them rarely works." },
      { lead: "Track the meter, pick fights by it.", rest: "Ahead 70-30? You can afford to give the zone up and reset. Behind? You need the fight NOW — the clock is your enemy." },
      { lead: "Use walls around zones as rotation cover.", rest: "Most zones have flanking walls — rotating behind them beats walking through the open middle every respawn." },
    ],
    mapGuide: null,
  },

  bounty: {
    name: "Bounty", accent: "#06B6D4",
    video: { id: "xfn9VBdA_Uk", title: "Bounty Tips — How to Win More in Bounty", note: "Star economy, the blue star, and playing the clock." },
    intro: "Every kill drops stars, every death gives them away. Hold the higher star count when the clock hits zero — no objective, no cashing in, just a running scoreboard of who's winning the fights.",
    stats: [
      { value: "★7", label: "MAX BOUNTY PER PLAYER", color: "#ffce7a" },
      { value: "+1", label: "STAR PER KILL", color: "#8ee6b0" },
      { value: "1", label: "CENTER BLUE STAR", color: "#60a5fa" },
    ],
    how: [
      "Each player carries a bounty that grows with every kill they get (up to seven stars) and pays out to the enemy when they die. A neutral blue star at map center gives the first team to grab it a one-star lead. When time expires, the team holding more stars wins — a tie only breaks on the blue star.",
      "The scoring creates Bounty's signature dynamic: kills make you worth more, so the best player on the map becomes the biggest liability. A five-star carrier dying once undoes the entire lead they built. Once ahead, the correct play is often to stop fighting entirely.",
    ],
    roles: [
      { tag: "STAR FISHER", accent: "#ffce7a", title: "Star fisher",
        desc: "Long-range snipers rack up stars from safety. Bounty is their best mode — nothing forces them to ever leave comfortable range.",
        brawlers: ["Piper", "Brock", "Mandy", "Belle", "Janet", "Bea"] },
      { tag: "MIDLINE BODYGUARD", accent: "#b36bff", title: "Midline bodyguard",
        desc: "Area control keeps assassins from reaching your snipers and stops the enemy from taking free mid ground.",
        brawlers: ["Bo", "Tara", "Gale", "Sandy", "Otis", "Willow"] },
      { tag: "LEAD PROTECTOR", accent: "#8ee6b0", title: "Lead protector",
        desc: "Once ahead, someone has to enable the retreat — healers and disruptors who make chasing your carriers expensive.",
        brawlers: ["Poco", "Byron", "Gene", "Crow", "Max", "Squeak"] },
    ],
    drafting: "Range wins Bounty — it's Knockout's poke war without the poison forcing a close. **First-pick your safest sniper**, and treat enemy assassins as the primary ban targets since they're the only real answer to a sniper line. A comp that can't match the enemy's effective range spends the whole match walking into losing trades.",
    mistakes: [
      { title: "Chasing when ahead", desc: "With the star lead, every fight you take is a fight you didn't need. Play keep-away and let the clock be your third teammate." },
      { title: "Feeding a high-bounty brawler", desc: "Dying at six stars hands the enemy a bigger swing than any kill you got building it. High bounty means play like glass." },
      { title: "Ignoring the blue star", desc: "It decides ties and starts the game as a free lead. Contesting it with your whole team early is almost always worth it." },
      { title: "Trading one-for-one when behind", desc: "Even trades don't close a star gap — being behind means you need clean picks, which means patience, not desperation." },
    ],
    tips: [
      { lead: "The clock is a weapon — for exactly one team.", rest: "Check the score, then decide which team you are: the one that needs fights, or the one that needs to vanish." },
      { lead: "Poke walls down early.", rest: "Cover disappears permanently — spending early-game shots opening sightlines pays interest all match for a sniper comp." },
      { lead: "Reset your bounty intentionally? Never.", rest: "There's no way to bank stars — protect a fat bounty with positioning and teammates, don't 'spend' it on a trade." },
      { lead: "Bait with the low-bounty teammate.", rest: "Whoever's worth one star can afford to show themselves; the enemy committing onto them exposes their carries to your snipers." },
      { lead: "Count stars before overtime plays.", rest: "Last 10 seconds up by one? Group and wall off. Down by one? Someone has to force a play NOW — decide who before the clock forces it." },
    ],
    mapGuide: null,
  },
};

const MODE_ORDER = ["gemGrab", "brawlBall", "knockout", "heist", "hotZone", "bounty"];

// ─── Guides landing (/guides) ────────────────────────────────────────────────

const LANDING_CARDS = [
  { to: "/guides/skills", tag: "SKILLS GUIDE", badge: "FUNDAMENTALS", accent: "#ffb43d", accentBg: "rgba(255,180,61,.14)",
    heading: "Movement & Shooting", desc: "The mechanics under every good player: aiming discipline, strafing, juking, and bush control.",
    bullets: "Aim control · Movement tech · Positioning", linkLabel: "Learn the fundamentals" },
  { to: "/guides/modes", tag: "MODE GUIDES", badge: "STRATEGY", accent: "#b36bff", accentBg: "rgba(179,107,255,.14)",
    heading: "Modes & Maps", desc: "How each ranked mode is actually won — roles, drafting logic, common mistakes, and map-specific guides.",
    bullets: "6 ranked modes · Roles · Map guides", linkLabel: "Browse mode guides" },
  { to: "/guides/brawlers", tag: "BRAWLER GUIDES", badge: "ALL 100+", accent: "#8ee6b0", accentBg: "rgba(142,230,176,.14)",
    heading: "Brawler Guides", desc: "Every brawler's full guide: live win rates, best maps and modes, abilities, and in-depth tips.",
    bullets: "Live stats · Abilities · Deep dives", linkLabel: "Find your brawler" },
];

export function GuidesLandingPage() {
  return (
    <GuideShell>
      <section style={{ position: "relative", zIndex: 10, padding: "30px 5vw 50px", maxWidth: 860, margin: "0 auto", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <Eyebrow>GUIDES · LEARN THE GAME</Eyebrow>
        <h1 style={{ marginTop: 24, fontFamily: DISPLAY, fontSize: "clamp(48px,7vw,92px)", fontWeight: 700, lineHeight: .95, letterSpacing: "-1px", color: "#f4f4fa" }}>
          Get <span style={{ color: "#b36bff", textShadow: "0 0 40px rgba(179,107,255,.5)" }}>better</span>
        </h1>
        <p style={{ marginTop: 22, maxWidth: 600, fontSize: 17, lineHeight: 1.6, color: "#a4a4b5" }}>
          Three tracks: master the raw mechanics, learn how each mode is won, or deep-dive a specific brawler.
        </p>
      </section>

      <div style={{ position: "relative", zIndex: 10, padding: "0 5vw 100px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 26, maxWidth: 1280, margin: "0 auto" }}>
        {LANDING_CARDS.map(c => (
          <Link key={c.to} to={c.to} style={{
            borderRadius: 24, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)",
            padding: 26, display: "flex", flexDirection: "column", gap: 16, textDecoration: "none",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 2, color: c.accent }}>{c.tag}</span>
              <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1, color: c.accent, background: c.accentBg, padding: "3px 10px", borderRadius: 999 }}>{c.badge}</span>
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#f4f4fa", letterSpacing: "-.3px", fontFamily: DISPLAY }}>{c.heading}</div>
            <div style={{ color: "#9a9aab", fontSize: 14.5, lineHeight: 1.5 }}>{c.desc}</div>
            <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: .5, color: "#6f7180" }}>{c.bullets}</div>
            <span style={{ marginTop: "auto", display: "inline-flex", alignItems: "center", gap: 8, color: c.accent, fontWeight: 700, fontSize: 14 }}>{c.linkLabel} <span>→</span></span>
          </Link>
        ))}
      </div>
    </GuideShell>
  );
}

// ─── Skills guide (/guides/skills) ───────────────────────────────────────────

export function SkillsGuidePage() {
  const sections = [
    {
      tag: "SHOOTING", accent: "#ffb43d", title: "Aim: auto vs. manual",
      video: { id: "9Cd8wttsIqI", title: "Pro Aim Guide", note: "Leading shots, reading strafe rhythms, and when auto-aim is actually correct." },
      paras: [
        "Auto-aim isn't a crutch — it's a tool with a spec sheet. It snaps to the nearest visible target, which makes it correct at point-blank range, against slow targets, and when you need to fire mid-juke without losing movement control. It's wrong at range, against strafing enemies, and any time a better target exists behind the closest one.",
        "Manual aim wins everything else. The core skill is **leading the shot**: aim where the enemy is going, not where they are. Watch two or three of their dodges first — most players strafe on a rhythm, and once you've read it, you're aiming at a schedule, not a person.",
      ],
    },
    {
      tag: "MOVEMENT", accent: "#b36bff", title: "Strafing & juking",
      video: { id: "vHuMVWNyaHc", title: "Top Movement Secrets Every Player Needs", note: "Watch the jukes from this section performed at a high level." },
      paras: [
        "Standing still is the only real mistake in Brawl Stars. Between every shot you fire there's a movement window — good players **strafe unpredictably** through it: short zigzags with irregular timing, not smooth side-to-side sways that are trivial to lead.",
        "Juking projectiles is rhythm-breaking: walk one direction just long enough for the enemy to commit their shot, then cut the opposite way as it fires. Against long-range brawlers this alone makes you nearly unhittable — their projectile travel time is your reaction budget.",
      ],
    },
    {
      tag: "POSITIONING", accent: "#8ee6b0", title: "Range discipline & bush control",
      paras: [
        "Every brawler has a range band where they win and one where they lose. **Fight only in yours.** A Shelly walking through open ground toward a Piper isn't brave, she's feeding — the same matchup in bushes reverses completely. Before every engagement, ask whose range band the fight is happening in.",
        "Bushes are information warfare: an unchecked bush is a coin-flip you're taking with your health bar. Poke bushes with a shot before walking through, and when defending, remember enemies can't see you either — first-shot advantage in a bush fight usually decides it.",
      ],
    },
    {
      tag: "GAME SENSE", accent: "#60a5fa", title: "Super economy & trade math",
      paras: [
        "Supers charge from hitting shots, which makes every poke war secretly a race to the first super. **Cycling supers** — using one super to charge the next — is the engine behind most high-level snowballs. Before committing yours, know what it's buying: a kill, an escape, or objective time are worth it; chip damage almost never is.",
        "Trade math is the quiet fundamental: a 50/50 fight is only worth taking when losing it costs you nothing. If you're the gem carrier, the star carrier, or the last defender, your health bar is worth more than any kill — walk away from fights a 'better' player would win.",
      ],
    },
  ];

  return (
    <GuideShell>
      <div style={{ position: "relative", zIndex: 10, maxWidth: 1000, margin: "0 auto", padding: "0 5vw 100px" }}>
        <section style={{ padding: "30px 0 60px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center" }}>
          <Eyebrow dotColor="#ffb43d" color="#ffce7a" borderColor="rgba(255,180,61,.3)">SKILLS GUIDE · FUNDAMENTALS</Eyebrow>
          <h1 style={{ marginTop: 24, fontFamily: DISPLAY, fontSize: "clamp(48px,7vw,92px)", fontWeight: 700, lineHeight: .95, letterSpacing: "-1px", color: "#f4f4fa" }}>
            Movement &<br /><span style={{ color: "#ffb43d", textShadow: "0 0 40px rgba(255,180,61,.5)" }}>Shooting</span>
          </h1>
          <p style={{ marginTop: 22, maxWidth: 620, fontSize: 17, lineHeight: 1.6, color: "#a4a4b5" }}>
            Drafting and map knowledge decide games at the margins — mechanics decide every single fight. These four fundamentals are the difference between knowing the right play and being able to execute it.
          </p>
        </section>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {sections.map(s => (
            <Panel key={s.title}>
              <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 2, color: s.accent }}>{s.tag}</span>
              <h2 style={h2Style}>{s.title}</h2>
              {s.paras.map((p, i) => <RichText key={i} text={p} style={bodyStyle} />)}
              {s.video && <VideoClip videoId={s.video.id} title={s.video.title} note={s.video.note} />}
            </Panel>
          ))}
        </div>

        <div style={{ marginTop: 40 }}>
          <Panel tinted gold style={{ alignItems: "center", textAlign: "center" }}>
            <h2 style={h2Style}>Put it into practice</h2>
            <p style={{ ...bodyStyle, maxWidth: 520 }}>Mechanics stick through reps. Run the draft assistant before your next ranked session so the only thing you're thinking about in-game is execution.</p>
            <Link to="/app?tab=meta" style={{
              display: "inline-flex", alignItems: "center", gap: 10, padding: "15px 30px", borderRadius: 999,
              background: "#ffb43d", color: "#1a1206", fontWeight: 700, fontSize: 15, letterSpacing: .5,
              textDecoration: "none", boxShadow: "0 0 30px rgba(255,180,61,.35)",
            }}>Open the Draft Assistant <span>→</span></Link>
          </Panel>
        </div>
      </div>
    </GuideShell>
  );
}

// ─── Modes index (/guides/modes) ─────────────────────────────────────────────

export function ModesGuidesPage() {
  return (
    <GuideShell>
      <section style={{ position: "relative", zIndex: 10, padding: "30px 5vw 50px", maxWidth: 860, margin: "0 auto", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <Eyebrow>MODE GUIDES · RANKED</Eyebrow>
        <h1 style={{ marginTop: 24, fontFamily: DISPLAY, fontSize: "clamp(48px,7vw,92px)", fontWeight: 700, lineHeight: .95, letterSpacing: "-1px", color: "#f4f4fa" }}>
          Know the <span style={{ color: "#b36bff", textShadow: "0 0 40px rgba(179,107,255,.5)" }}>win condition</span>
        </h1>
        <p style={{ marginTop: 22, maxWidth: 620, fontSize: 17, lineHeight: 1.6, color: "#a4a4b5" }}>
          Every ranked mode is a different game wearing the same controls. Each guide covers how the mode actually works, the roles that matter, drafting logic, and the mistakes that lose games.
        </p>
      </section>

      <div style={{ position: "relative", zIndex: 10, padding: "0 5vw 100px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 26, maxWidth: 1280, margin: "0 auto" }}>
        {MODE_ORDER.map(id => {
          const m = MODE_GUIDES[id];
          return (
            <Link key={id} to={`/guides/modes/${id}`} style={{
              borderRadius: 24, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)",
              padding: 26, display: "flex", flexDirection: "column", gap: 14, textDecoration: "none",
            }}>
              <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 2, color: m.accent }}>{m.name.toUpperCase()}</span>
              <div style={{ fontSize: 24, fontWeight: 700, color: "#f4f4fa", fontFamily: DISPLAY, letterSpacing: "-.3px" }}>{m.name} Guide</div>
              <div style={{ color: "#9a9aab", fontSize: 14.5, lineHeight: 1.5, flex: 1 }}>{m.intro}</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {m.stats.map(s => (
                  <span key={s.label} style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1, padding: "4px 10px", borderRadius: 999, background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.08)", color: "#c9c9d6" }}>
                    {s.value} {s.label}
                  </span>
                ))}
              </div>
              <span style={{ marginTop: 6, display: "inline-flex", alignItems: "center", gap: 8, color: m.accent, fontWeight: 700, fontSize: 14 }}>Read the guide <span>→</span></span>
            </Link>
          );
        })}
      </div>
    </GuideShell>
  );
}

// ─── Mode guide page (/guides/modes/:modeId) — structure 1:1 from handoff ────

export function ModeGuidePage() {
  const { modeId } = useParams();
  const m = MODE_GUIDES[modeId];

  if (!m) {
    return (
      <GuideShell>
        <div style={{ position: "relative", zIndex: 10, padding: "80px 5vw", textAlign: "center" }}>
          <h1 style={{ fontFamily: DISPLAY, fontSize: 40, color: "#f4f4fa" }}>Mode not found</h1>
          <Link to="/guides/modes" style={{ color: "#b36bff", fontWeight: 700 }}>← Back to mode guides</Link>
        </div>
      </GuideShell>
    );
  }

  const sideNav = [
    { label: "Overview", href: "#overview" },
    { label: "How It Works", href: "#how-it-works" },
    ...(m.video ? [{ label: "Watch", href: "#watch" }] : []),
    { label: "Roles", href: "#roles" },
    { label: "Drafting", href: "#drafting" },
    { label: "Mistakes", href: "#mistakes" },
    ...(m.mapGuide ? [{ label: "Map Guide", href: "#map-guide" }] : []),
    { label: "Tips & Tricks", href: "#tips-tricks" },
    { label: "Quiz", href: "#quiz" },
  ];

  return (
    <GuideShell>
      {/* Right-side section nav rail — hidden below 1181px */}
      <aside className="side-nav-rail" style={{
        position: "fixed", top: "50%", right: 22, transform: "translateY(-50%)", zIndex: 35,
        display: "flex", flexDirection: "column", gap: 2, padding: 12, borderRadius: 20,
        background: "rgba(13,13,20,.72)", border: "1px solid rgba(255,255,255,.08)",
        backdropFilter: "blur(12px)", boxShadow: "0 20px 50px rgba(0,0,0,.4)",
      }}>
        {sideNav.map(s => (
          <a key={s.href} href={s.href} className="rail-link" style={{
            display: "flex", alignItems: "center", gap: 9, textDecoration: "none", color: "#8b8b9c",
            fontFamily: MONO, fontSize: 11, letterSpacing: 1, padding: "9px 14px", borderRadius: 999, whiteSpace: "nowrap",
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#b36bff", flexShrink: 0, boxShadow: "0 0 6px #b36bff" }} />
            {s.label}
          </a>
        ))}
      </aside>

      <div className="content-wrap" style={{ position: "relative", zIndex: 10, maxWidth: 1160, margin: "0 auto", padding: "0 5vw 100px" }}>
        {/* Hero */}
        <section id="overview" style={{ scrollMarginTop: 110, padding: "30px 0 70px", maxWidth: 860, margin: "0 auto", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center" }}>
          <Eyebrow>MODE GUIDE · RANKED</Eyebrow>
          <h1 style={{ marginTop: 24, fontFamily: DISPLAY, fontSize: "clamp(48px,7vw,92px)", fontWeight: 700, lineHeight: .95, letterSpacing: "-1px", color: "#f4f4fa" }}>
            {m.name}<br /><span style={{ color: "#b36bff", textShadow: "0 0 40px rgba(179,107,255,.5)" }}>General Guide</span>
          </h1>
          <p style={{ marginTop: 22, maxWidth: 600, fontSize: 17, lineHeight: 1.6, color: "#a4a4b5" }}>{m.intro}</p>
          <div style={{ display: "flex", gap: 14, marginTop: 32, flexWrap: "wrap", justifyContent: "center" }}>
            {m.stats.map(s => <StatChip key={s.label} value={s.value} label={s.label} color={s.color} />)}
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" style={{ scrollMarginTop: 110, paddingBottom: 60, maxWidth: 860, margin: "0 auto" }}>
          <Panel>
            <h2 style={h2Style}>How {m.name} works</h2>
            {m.how.map((p, i) => <RichText key={i} text={p} style={bodyStyle} />)}
          </Panel>
        </section>

        {/* Watch — creator guide clip */}
        {m.video && (
          <section id="watch" style={{ scrollMarginTop: 110, paddingBottom: 60, maxWidth: 860, margin: "0 auto" }}>
            <div style={{ marginBottom: 14 }}>
              <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 2, color: "#ffb43d" }}>WATCH · PRO GUIDE</span>
            </div>
            <VideoClip videoId={m.video.id} title={m.video.title} note={m.video.note} />
          </section>
        )}

        {/* Roles */}
        <section id="roles" style={{ scrollMarginTop: 110, paddingBottom: 60 }}>
          <h2 style={h2CenterStyle}>Roles that matter</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
            {m.roles.map(r => (
              <div key={r.tag} style={{ borderRadius: 24, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)", padding: 26, display: "flex", flexDirection: "column", gap: 12 }}>
                <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 2, color: r.accent }}>{r.tag}</span>
                <h3 style={{ fontSize: 20, fontWeight: 700, color: "#f4f4fa" }}>{r.title}</h3>
                <p style={{ fontSize: 14.5, lineHeight: 1.65, color: "#9a9aab" }}>{r.desc}</p>
                <BrawlerChipRow names={r.brawlers} />
              </div>
            ))}
          </div>
        </section>

        {/* Drafting */}
        <section id="drafting" style={{ scrollMarginTop: 110, paddingBottom: 60, maxWidth: 860, margin: "0 auto" }}>
          <Panel tinted>
            <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 2, color: "#c98bff" }}>HOW TO DRAFT</span>
            <RichText text={m.drafting} style={{ fontSize: 15.5, lineHeight: 1.7, color: "#c9c9d6" }} />
          </Panel>
        </section>

        {/* Mistakes */}
        <section id="mistakes" style={{ scrollMarginTop: 110, paddingBottom: 60 }}>
          <h2 style={h2CenterStyle}>Common mistakes</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
            {m.mistakes.map(mi => (
              <div key={mi.title} style={{ display: "flex", gap: 14, borderRadius: 20, padding: 22, border: "1px solid rgba(255,255,255,.08)", background: "rgba(255,255,255,.03)" }}>
                <span style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 10, background: "rgba(255,122,122,.12)", color: "#ff8f8f", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 15 }}>✕</span>
                <div>
                  <h4 style={{ fontSize: 15.5, fontWeight: 700, marginBottom: 6, color: "#f4f4fa" }}>{mi.title}</h4>
                  <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "#9a9aab" }}>{mi.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Map guide callout */}
        {m.mapGuide && (
          <section id="map-guide" style={{ scrollMarginTop: 110, paddingBottom: 60 }}>
            <Link to={m.mapGuide.href} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap",
              borderRadius: 28, padding: "32px 36px", background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)", textDecoration: "none",
            }}>
              <div>
                <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 2, color: "#ffb43d" }}>MAP GUIDE</span>
                <h3 style={{ fontSize: 24, fontWeight: 700, color: "#f4f4fa", marginTop: 6, fontFamily: DISPLAY }}>{m.mapGuide.title}</h3>
                <p style={{ fontSize: 14.5, color: "#9a9aab", marginTop: 6, maxWidth: 520 }}>{m.mapGuide.desc}</p>
              </div>
              <span style={{ flexShrink: 0, width: 48, height: 48, borderRadius: "50%", background: "#b36bff", color: "#0a0a0f", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 700 }}>→</span>
            </Link>
          </section>
        )}

        {/* Tips & tricks */}
        <section id="tips-tricks" style={{ scrollMarginTop: 110, paddingBottom: 60, maxWidth: 860, margin: "0 auto" }}>
          <Panel>
            <h2 style={{ ...h2Style, textAlign: "center" }}>Tips & tricks</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {m.tips.map((t, i) => (
                <div key={i} style={{ display: "flex", gap: 14 }}>
                  <span style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 10, background: "rgba(179,107,255,.14)", color: "#c98bff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, fontWeight: 700, fontSize: 12 }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <p style={{ fontSize: 15, lineHeight: 1.7, color: "#c9c9d6" }}>
                    <strong style={{ color: "#f4f4fa" }}>{t.lead}</strong> {t.rest}
                  </p>
                </div>
              ))}
            </div>
          </Panel>
        </section>

        {/* Quiz CTA */}
        <section id="quiz" style={{ scrollMarginTop: 110, maxWidth: 860, margin: "0 auto" }}>
          <Panel tinted gold style={{ alignItems: "center", textAlign: "center", gap: 16, padding: 40 }}>
            <h2 style={h2Style}>Ready to test yourself?</h2>
            <a href="#" style={{
              display: "inline-flex", alignItems: "center", gap: 10, padding: "15px 30px", borderRadius: 999,
              background: "#ffb43d", color: "#1a1206", fontWeight: 700, fontSize: 15, letterSpacing: .5,
              textDecoration: "none", boxShadow: "0 0 30px rgba(255,180,61,.35)",
            }}>Take the {m.name} Draft Quiz <span>→</span></a>
          </Panel>
        </section>
      </div>

      <style>{`
        @media (max-width: 1180px) { .side-nav-rail { display: none !important; } }
        @media (min-width: 1181px) { .content-wrap { padding-right: 260px !important; } }
        .rail-link:hover { background: rgba(179,107,255,.16); color: #f4f4fa; }
      `}</style>
    </GuideShell>
  );
}

// ─── Safe Zone map guide (/guides/modes/heist/safe-zone) — 1:1 from handoff ──

export function SafeZoneGuidePage() {
  const picks = [
    { tag: "LONG-RANGE ATTACKERS", accent: "#ffb43d", title: "Long-range attackers",
      desc: "The open safe with no wall cover means a clean sightline is often all you need. These brawlers chip the safe from a position the enemy has to work to reach.",
      brawlers: ["Piper", "Brock", "Mandy", "Rico", "8-Bit", "Byron", "Colt"] },
    { tag: "SPLASH-DAMAGE DEFENDERS", accent: "#b36bff", title: "Splash-damage defenders",
      desc: "The bush directly in front of each safe is prime defensive real estate; brawlers with spread or splash attacks can hit anyone pushing through the narrow central gap without needing precise aim.",
      brawlers: ["Poco", "Frank", "Pam", "Gene", "Penny", "Emz", "Sandy"] },
  ];
  const tricks = [
    { lead: "The middle lane is effectively the only lane.", rest: "Water blocks the sides, so whoever controls the center controls access to both safes. Map control usually wins over raw safe damage early — establish center presence first, push second." },
    { lead: "Use the bush, don't walk through it blind.", rest: "It's a defensive ambush point, not a shortcut. If your team is pushing through the middle, hold on the side edges until teammates clear the center — bunching up in the open gap is a common way to get erased by a piercing attack in one hit." },
    { lead: "This isn't a map to force a rush comp on.", rest: "The lack of cover cuts both ways — your rushers are exposed just as much as theirs. Grinding safe damage from range tends to outperform an all-in burst here." },
  ];

  return (
    <GuideShell>
      <div style={{ position: "relative", zIndex: 10, padding: "26px 5vw 0", maxWidth: 1000, margin: "0 auto" }}>
        <Link to="/guides/modes/heist" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontFamily: MONO, fontSize: 12, letterSpacing: 1, color: "#8b8b9c", textDecoration: "none" }}>
          ← Heist General Guide
        </Link>
      </div>

      <section style={{ position: "relative", zIndex: 10, padding: "20px 5vw 60px", maxWidth: 1000, margin: "0 auto" }}>
        <Eyebrow>MAP GUIDE · HEIST</Eyebrow>
        <h1 style={{ marginTop: 24, fontFamily: DISPLAY, fontSize: "clamp(48px,7vw,92px)", fontWeight: 700, lineHeight: .95, letterSpacing: "-1px", color: "#f4f4fa" }}>
          Safe <span style={{ color: "#b36bff", textShadow: "0 0 40px rgba(179,107,255,.5)" }}>Zone</span>
        </h1>
        <p style={{ marginTop: 22, maxWidth: 640, fontSize: 17, lineHeight: 1.6, color: "#a4a4b5" }}>
          A diagonally symmetrical map built around a single central approach — two lakes flank the sides, so there's effectively one main lane into each safe, with bush cover lining the middle.
        </p>
      </section>

      <section style={{ position: "relative", zIndex: 10, padding: "0 5vw 60px", maxWidth: 1000, margin: "0 auto" }}>
        <div style={{ borderRadius: 28, overflow: "hidden", background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)" }}>
          <div style={{ height: 280, position: "relative", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(160deg, rgba(179,107,255,.10), rgba(20,14,32,.5))", color: "#5a5a6a", fontFamily: MONO, fontSize: 11, letterSpacing: 1 }}>
            Drop Safe Zone map layout image
          </div>
          <div style={{ padding: "32px 38px", display: "flex", flexDirection: "column", gap: 14 }}>
            <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 2, color: "#ffb43d" }}>MAP SNAPSHOT</span>
            <p style={bodyStyle}>Both safes sit with little to no wall protection, which makes this one of the more sniper-friendly Heist maps: long sightlines reward brawlers who can apply damage from range without closing distance.</p>
          </div>
        </div>
      </section>

      <section style={{ position: "relative", zIndex: 10, padding: "0 5vw 60px", maxWidth: 1160, margin: "0 auto" }}>
        <h2 style={{ ...h2CenterStyle, textAlign: "left" }}>Best brawlers on this map</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 20 }}>
          {picks.map(r => (
            <div key={r.tag} style={{ borderRadius: 24, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)", padding: 26, display: "flex", flexDirection: "column", gap: 12 }}>
              <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 2, color: r.accent }}>{r.tag}</span>
              <h3 style={{ fontSize: 20, fontWeight: 700, color: "#f4f4fa" }}>{r.title}</h3>
              <p style={{ fontSize: 14.5, lineHeight: 1.65, color: "#9a9aab" }}>{r.desc}</p>
              <BrawlerChipRow names={r.brawlers} />
            </div>
          ))}
        </div>

        <div style={{ marginTop: 20, display: "flex", gap: 14, borderRadius: 20, padding: "22px 26px", border: "1px solid rgba(255,122,122,.2)", background: "rgba(255,122,122,.05)" }}>
          <span style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 10, background: "rgba(255,122,122,.15)", color: "#ff8f8f", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 15 }}>✕</span>
          <div>
            <h4 style={{ fontSize: 15.5, fontWeight: 700, marginBottom: 6, color: "#f4f4fa" }}>Weaker picks on this map</h4>
            <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "#9a9aab" }}>Pure melee brawlers without a mobility tool (dash, jump, or grapple) struggle here — the lack of wall cover on the approach means a slow walk-up gets punished by any competent long-range defense before you're close enough to matter.</p>
          </div>
        </div>
      </section>

      <section style={{ position: "relative", zIndex: 10, padding: "0 5vw 60px", maxWidth: 1000, margin: "0 auto" }}>
        <Panel style={{ gap: 20 }}>
          <h2 style={h2Style}>Lanes, picks, tricks</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {tricks.map((t, i) => (
              <div key={i} style={{ display: "flex", gap: 14 }}>
                <span style={{ flexShrink: 0, width: 8, height: 8, borderRadius: "50%", background: "#b36bff", marginTop: 9, boxShadow: "0 0 8px #b36bff" }} />
                <p style={{ fontSize: 15, lineHeight: 1.7, color: "#c9c9d6" }}>
                  <strong style={{ color: "#f4f4fa" }}>{t.lead}</strong> {t.rest}
                </p>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <section style={{ position: "relative", zIndex: 10, padding: "0 5vw 100px", maxWidth: 1000, margin: "0 auto" }}>
        <div style={{
          borderRadius: 28, padding: "34px 38px", background: "linear-gradient(160deg, rgba(179,107,255,.10), rgba(20,14,32,.4))",
          border: "1px solid rgba(179,107,255,.22)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap",
        }}>
          <div>
            <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 2, color: "#c98bff" }}>HOW TO DRAFT FOR THIS MAP</span>
            <p style={{ fontSize: 14.5, color: "#9a9aab", marginTop: 8, maxWidth: 520 }}>Run a live draft for Safe Zone with map-aware pick and ban suggestions.</p>
          </div>
          <Link to="/app?tab=meta" style={{
            flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 10, padding: "14px 26px", borderRadius: 999,
            background: "#b36bff", color: "#0a0a0f", fontWeight: 700, fontSize: 14, letterSpacing: .5,
            textDecoration: "none", boxShadow: "0 0 26px rgba(179,107,255,.4)",
          }}>Try the Draft Simulator →</Link>
        </div>
      </section>
    </GuideShell>
  );
}

// ─── Brawler guides index (/guides/brawlers) ─────────────────────────────────

export function BrawlerGuidesPage() {
  const [search, setSearch] = useState("");
  const brawlers = Object.entries(BRAWLER_META)
    .map(([key, meta]) => ({
      key,
      name: key.toLowerCase().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
      imageUrl: meta.imageUrl, rarity: meta.rarity || "—", rarityColor: meta.rarityColor || "#94a3b8",
    }))
    .filter(b => b.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <GuideShell>
      <section style={{ position: "relative", zIndex: 10, padding: "30px 5vw 40px", maxWidth: 860, margin: "0 auto", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <Eyebrow dotColor="#8ee6b0" color="#8ee6b0" borderColor="rgba(142,230,176,.3)">BRAWLER GUIDES · ALL BRAWLERS</Eyebrow>
        <h1 style={{ marginTop: 24, fontFamily: DISPLAY, fontSize: "clamp(48px,7vw,92px)", fontWeight: 700, lineHeight: .95, letterSpacing: "-1px", color: "#f4f4fa" }}>
          Pick your <span style={{ color: "#8ee6b0", textShadow: "0 0 40px rgba(142,230,176,.5)" }}>main</span>
        </h1>
        <p style={{ marginTop: 22, maxWidth: 560, fontSize: 17, lineHeight: 1.6, color: "#a4a4b5" }}>
          Every guide includes live ranked win rates, best modes and maps, full ability breakdowns, and in-depth tips.
        </p>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search brawlers…"
          style={{
            marginTop: 28, width: "100%", maxWidth: 380, padding: "14px 24px", borderRadius: 999,
            background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)",
            color: "#e9e9f2", fontSize: 15, fontFamily: "'Chakra Petch', sans-serif", outline: "none",
          }}
        />
      </section>

      <div style={{
        position: "relative", zIndex: 10, padding: "0 5vw 100px", maxWidth: 1280, margin: "0 auto",
        display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 14,
      }}>
        {brawlers.map(b => (
          <Link key={b.key} to={`/brawlers/${slugifyBrawlerKey(b.key)}`} style={{
            borderRadius: 20, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)",
            padding: 14, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textDecoration: "none",
          }}>
            {(() => { const t = tileStyles({ key: b.key, rarity: b.rarity, rarityColor: b.rarityColor, size: 64, radius: 16 }); return (
              <div style={t.outer}>
                <div style={t.inner}>
                  {b.imageUrl
                    ? <img src={b.imageUrl} alt={b.name} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <span style={{ fontWeight: 800, color: b.rarityColor }}>{b.name.slice(0, 2)}</span>}
                </div>
              </div>
            ); })()}
            <span style={{ fontSize: 13, fontWeight: 700, color: "#e9e9f2", textAlign: "center", fontFamily: DISPLAY }}>{b.name}</span>
            <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 1, color: b.rarityColor }}>{b.rarity.toUpperCase()}</span>
          </Link>
        ))}
        {brawlers.length === 0 && (
          <p style={{ gridColumn: "1/-1", textAlign: "center", color: "#6f7180", padding: 40 }}>No brawlers match "{search}".</p>
        )}
      </div>
    </GuideShell>
  );
}
