// Tournament engine tests — run with: node tests/tournament.test.mjs
import {
  nextPowerOfTwo, byesNeeded, seedOrder, groupIntoTeams, seedTeams,
  generateBracket, nextSlot, totalRoundsFor,
} from "../src/data/bracket.js";
import {
  normalizeTag, encodeTag, parseBattleTime, findTournamentMatch,
  rateLimited, rateLimitRemaining, RATE_LIMIT_MS,
} from "../src/data/verifyLogic.js";

let passed = 0, failed = 0;
const assert = (cond, label) => {
  if (cond) { passed++; }
  else { failed++; console.error(`  ❌ FAIL: ${label}`); }
};
const section = (name) => console.log(`\n── ${name}`);

// ─── Bracket math ────────────────────────────────────────────────────────────
section("Power-of-two + byes");
assert(nextPowerOfTwo(1) === 1, "npot(1)=1");
assert(nextPowerOfTwo(3) === 4, "npot(3)=4");
assert(nextPowerOfTwo(16) === 16, "npot(16)=16");
assert(nextPowerOfTwo(44) === 64, "npot(44)=64");
assert(nextPowerOfTwo(100) === 128, "npot(100)=128");
assert(byesNeeded(44) === 20, "44 teams → 20 byes (goal example)");
assert(byesNeeded(16) === 0, "16 teams → 0 byes");
assert(byesNeeded(7) === 1, "7 teams → 1 bye");
assert(byesNeeded(100) === 28, "100 teams → 28 byes");

section("Seed order");
assert(JSON.stringify(seedOrder(8)) === JSON.stringify([1, 8, 4, 5, 2, 7, 3, 6]), "size-8 seed order");
const so16 = seedOrder(16);
assert(so16[0] === 1 && so16[1] === 16, "seed 1 plays seed 16 first");
assert(new Set(so16).size === 16, "seed order is a permutation");

const mkTeams = (n, premiumEvery = 0) =>
  Array.from({ length: n }, (_, i) => ({
    name: `Team ${i + 1}`,
    players: [0, 1, 2].map(j => ({ tag: `#T${i}P${j}`, name: `P${i}-${j}` })),
    premiumCount: premiumEvery && i % premiumEvery === 0 ? 1 : 0,
    joinedAt: new Date(2026, 0, 1, 0, i).toISOString(),
  }));

section("Bracket generation across team counts");
for (const n of [3, 7, 15, 16, 44, 100]) {
  const teams = seedTeams(mkTeams(n), 42);
  const bracket = generateBracket(teams);
  const size = nextPowerOfTwo(n);
  const r1 = bracket.filter(m => m.round === 1);
  const byes = r1.filter(m => m.status === "bye");
  assert(r1.length === size / 2, `${n} teams → ${size / 2} round-1 slots`);
  assert(byes.length === byesNeeded(n), `${n} teams → ${byesNeeded(n)} byes`);
  assert(byes.every(m => m.teamA && !m.teamB), `${n} teams: every bye has exactly one team`);
  const placed = r1.flatMap(m => [m.teamA, m.teamB]).filter(Boolean);
  assert(placed.length === n, `${n} teams: all teams placed exactly once`);
  assert(new Set(placed.map(t => t.name)).size === n, `${n} teams: no duplicates`);
  const rounds = Math.max(...bracket.map(m => m.round));
  assert(rounds === totalRoundsFor(n), `${n} teams: ${totalRoundsFor(n)} rounds`);
  assert(bracket.filter(m => m.round === rounds).length === 1, `${n} teams: single final`);
}
let threw = false;
try { generateBracket(mkTeams(1)); } catch { threw = true; }
assert(threw, "1 team: refuses to build a bracket");

section("Premium bye priority (integrity rule: byes only, never bought wins)");
{
  const teams = mkTeams(44, 4); // 11 premium teams, 20 byes available
  const seeded = seedTeams(teams, 7);
  const premiumNames = new Set(teams.filter(t => t.premiumCount > 0).map(t => t.name));
  assert(seeded.slice(0, premiumNames.size).every(t => premiumNames.has(t.name)), "all premium teams seeded first");
  const bracket = generateBracket(seeded);
  const byeTeams = bracket.filter(m => m.status === "bye").map(m => m.teamA.name);
  const premiumWithBye = byeTeams.filter(nm => premiumNames.has(nm)).length;
  assert(premiumWithBye === premiumNames.size, "every premium team got one of the 20 byes");
  assert(byeTeams.length === 20, "still exactly 20 byes — premium can't mint extras");
}

section("Advancement slots");
assert(JSON.stringify(nextSlot(1, 0)) === JSON.stringify({ round: 2, matchNumber: 0, slot: "A" }), "R1M0 → R2M0 slot A");
assert(JSON.stringify(nextSlot(1, 1)) === JSON.stringify({ round: 2, matchNumber: 0, slot: "B" }), "R1M1 → R2M0 slot B");
assert(JSON.stringify(nextSlot(3, 5)) === JSON.stringify({ round: 4, matchNumber: 2, slot: "B" }), "R3M5 → R4M2 slot B");

section("Team grouping from registrations");
{
  const regs = [
    { team_name: "Alpha", player_tag: "#AAA1", display_name: "a1", is_premium: true, joined_at: "2026-01-01" },
    { team_name: "alpha", player_tag: "#AAA2", display_name: "a2", is_premium: false, joined_at: "2026-01-02" },
    { team_name: "ALPHA ", player_tag: "#AAA3", display_name: "a3", is_premium: false, joined_at: "2026-01-03" },
    { team_name: "Beta", player_tag: "#BBB1", display_name: "b1", is_premium: false, joined_at: "2026-01-01" },
    { team_name: "Beta", player_tag: "#BBB2", display_name: "b2", is_premium: false, joined_at: "2026-01-02" },
  ];
  const teams = groupIntoTeams(regs, 3);
  assert(teams.length === 1, "only complete 3-player teams qualify");
  assert(teams[0].name === "Alpha" && teams[0].premiumCount === 1, "case-insensitive grouping + premium count");
}

// ─── Verification logic ──────────────────────────────────────────────────────
section("Tag handling");
assert(normalizeTag("#p9lq82") === "#P9LQ82", "normalize lowercases→upper");
assert(normalizeTag("  #2C2 0JJ ") === "#2C20JJ", "normalize strips junk");
assert(encodeTag("#P9LQ82") === "%23P9LQ82", "URL-encodes # correctly");
assert(parseBattleTime("20260713T183000.000Z") === Date.parse("2026-07-13T18:30:00.000Z"), "basic-ISO parse");

const A = ["#A1", "#A2", "#A3"], B = ["#B1", "#B2", "#B3"];
const mkBattle = ({ time, result, mode = "brawlBall", teams = [A, B] }) => ({
  battleTime: time,
  event: { mode, map: "Sneaky Fields" },
  battle: {
    mode, type: "friendly", result, duration: 120,
    teams: teams.map(side => side.map(tag => ({ tag, name: "x" }))),
  },
});
const W_START = Date.parse("2026-07-13T18:00:00Z");
const W_END = Date.parse("2026-07-13T19:00:00Z");
const opts = { teamATags: A, teamBTags: B, targetTag: "#A1", windowStart: W_START, windowEnd: W_END };

section("Winner parsing");
{
  const log = { items: [mkBattle({ time: "20260713T183000.000Z", result: "victory" })] };
  const r = findTournamentMatch(log, opts);
  assert(r.status === "found" && r.result === "team_a", "victory → team_a wins");
}
{
  const log = { items: [mkBattle({ time: "20260713T183000.000Z", result: "defeat" })] };
  const r = findTournamentMatch(log, opts);
  assert(r.status === "found" && r.result === "team_b", "defeat → team_b wins");
}
{
  const log = { items: [mkBattle({ time: "20260713T183000.000Z", result: "draw" })] };
  const r = findTournamentMatch(log, opts);
  assert(r.status === "found" && r.result === "tie", "draw → tie (frontend prompts rematch)");
}

section("Manifest & window enforcement");
{
  const impostor = mkBattle({ time: "20260713T183000.000Z", result: "victory", teams: [A, ["#B1", "#B2", "#EVIL"]] });
  const r = findTournamentMatch({ items: [impostor] }, opts);
  assert(r.status === "not_found", "wrong 6th player → rejected (anti-spoof)");
}
{
  const early = mkBattle({ time: "20260713T170000.000Z", result: "victory" });
  const r = findTournamentMatch({ items: [early] }, opts);
  assert(r.status === "not_found", "battle before window → rejected");
}
{
  const late = mkBattle({ time: "20260713T193000.000Z", result: "victory" });
  const r = findTournamentMatch({ items: [late] }, opts);
  assert(r.status === "not_found", "battle after window → rejected");
}
{
  const wrongMode = mkBattle({ time: "20260713T183000.000Z", result: "victory", mode: "gemGrab" });
  const r = findTournamentMatch({ items: [wrongMode] }, { ...opts, mode: "brawlBall" });
  assert(r.status === "not_found", "wrong mode → rejected when mode filter set");
}
{
  const r = findTournamentMatch({ items: [] }, opts);
  assert(r.status === "not_found", "empty log → not_found (retry later)");
}
{
  const r = findTournamentMatch(null, opts);
  assert(r.status === "not_found", "null/malformed API response → not_found, no crash");
}
{
  const r = findTournamentMatch({ items: [mkBattle({ time: "20260713T183000.000Z", result: "victory" })] },
    { ...opts, targetTag: "#B1" });
  assert(r.status === "error", "target tag must belong to team A");
}

section("Tie → sudden-death rematch resolution");
{
  // A tie followed by a rematch inside the same window: latest game decides.
  const log = { items: [
    mkBattle({ time: "20260713T184500.000Z", result: "victory" }), // rematch (later)
    mkBattle({ time: "20260713T183000.000Z", result: "draw" }),    // original tie
  ] };
  const r = findTournamentMatch(log, opts);
  assert(r.status === "found" && r.result === "team_a", "latest battle wins the series after a tie");
}

section("Rate limiting");
{
  const now = Date.parse("2026-07-13T18:10:00Z");
  assert(rateLimited(null, now) === false, "no prior attempt → allowed");
  assert(rateLimited("2026-07-13T18:08:30Z", now) === true, "90s ago → blocked");
  assert(rateLimited("2026-07-13T18:06:59Z", now) === false, "3m01s ago → allowed");
  const remaining = rateLimitRemaining("2026-07-13T18:09:00Z", now);
  assert(remaining === RATE_LIMIT_MS - 60000, "remaining cooldown math");
}

console.log(`\n${"═".repeat(40)}\n${failed === 0 ? "✅" : "❌"} ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
