// ─── Tournament bracket math ─────────────────────────────────────────────────
// Pure functions shared by the frontend (bracket rendering) and the Vercel
// API functions (bracket generation + advancement). No imports, no I/O —
// everything here is unit-testable with plain node.
//
// Model: single-elimination. When the team count isn't a power of two, the
// bracket is padded to the next power of two and the empty slots become
// first-round byes. Standard sports seeding (seed 1 plays the lowest seed)
// means byes land on the TOP seeds naturally — and seeding order puts premium
// teams first, so premium players receive byes without ever being able to
// buy a win over an actual opponent (a bye only exists when the math demands
// one; competitive integrity rule #3).

export const nextPowerOfTwo = (n) => {
  if (n < 1) return 1;
  let p = 1;
  while (p < n) p *= 2;
  return p;
};

export const byesNeeded = (teamCount) => nextPowerOfTwo(teamCount) - teamCount;

// Standard bracket seeding order: for size 8 → [1, 8, 4, 5, 2, 7, 3, 6].
// Consecutive pairs are the round-1 matches, and the sub-brackets keep the
// property that seeds 1 and 2 can only meet in the final.
export const seedOrder = (bracketSize) => {
  let seq = [1];
  while (seq.length < bracketSize) {
    const next = [];
    const size = seq.length * 2;
    for (const s of seq) next.push(s, size + 1 - s);
    seq = next;
  }
  return seq;
};

// Group flat registrations into complete teams. Players join a team by
// entering the same team name; only full rosters (exactly teamSize players)
// are bracket-eligible. A team counts as premium if ANY member is premium
// (they get seeded ahead of non-premium teams → first claim on byes).
export const groupIntoTeams = (registrations, teamSize = 3) => {
  const byTeam = new Map();
  for (const r of registrations) {
    const key = (r.team_name || "").trim().toLowerCase();
    if (!key) continue;
    if (!byTeam.has(key)) byTeam.set(key, []);
    byTeam.get(key).push(r);
  }
  const teams = [];
  for (const members of byTeam.values()) {
    if (members.length !== teamSize) continue; // incomplete or oversized — skip
    members.sort((a, b) => new Date(a.joined_at || 0) - new Date(b.joined_at || 0));
    teams.push({
      name: members[0].team_name.trim(),
      players: members.map(m => ({ tag: m.player_tag, name: m.display_name, userId: m.user_id || null })),
      premiumCount: members.filter(m => m.is_premium).length,
      joinedAt: members[0].joined_at || null,
    });
  }
  return teams;
};

// Deterministic shuffle when a seed is provided (so tests are reproducible);
// Math.random otherwise. Mulberry32.
const rng = (seed) => {
  if (seed == null) return Math.random;
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const shuffle = (arr, random) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Seeding: premium teams first (more premium members = higher seed, ties
// broken by signup order), then everyone else in random order. Because byes
// attach to the top seeds, premium teams absorb the byes first — but no team
// ever skips a round that the bracket math didn't already require.
export const seedTeams = (teams, randomSeed = null) => {
  const random = rng(randomSeed);
  const premium = teams
    .filter(t => t.premiumCount > 0)
    .sort((a, b) => b.premiumCount - a.premiumCount || new Date(a.joinedAt || 0) - new Date(b.joinedAt || 0));
  const rest = shuffle(teams.filter(t => t.premiumCount === 0), random);
  return [...premium, ...rest];
};

// Build every match of a single-elim bracket. Returns:
//   [{ round, matchNumber, teamA, teamB, status }]
// Round 1 matches with teamB === null are byes (teamA auto-advances).
// Later rounds start with both slots null and fill as winners advance.
export const generateBracket = (seededTeams) => {
  const n = seededTeams.length;
  if (n < 2) throw new Error(`Need at least 2 complete teams, got ${n}`);
  const size = nextPowerOfTwo(n);
  const order = seedOrder(size);
  const slots = order.map(seed => (seed <= n ? seededTeams[seed - 1] : null));

  const matches = [];
  // Round 1 from the seeded slots
  for (let i = 0; i < size / 2; i++) {
    const teamA = slots[i * 2];
    const teamB = slots[i * 2 + 1];
    // Standard seeding never pairs two empty slots while n >= size/2 + 1;
    // when n <= size/2 the padded bracket would be degenerate, but that can't
    // happen because nextPowerOfTwo(n) < 2n for all n >= 1.
    matches.push({
      round: 1,
      matchNumber: i,
      teamA: teamA ?? teamB,          // keep the real team in slot A
      teamB: teamA ? teamB : null,
      status: teamA && teamB ? "pending" : "bye",
    });
  }
  // Empty shells for every later round
  const totalRounds = Math.log2(size);
  for (let r = 2; r <= totalRounds; r++) {
    const count = size / 2 ** r;
    for (let i = 0; i < count; i++) {
      matches.push({ round: r, matchNumber: i, teamA: null, teamB: null, status: "pending" });
    }
  }
  return matches;
};

// Where does the winner of (round, matchNumber) go?
export const nextSlot = (round, matchNumber) => ({
  round: round + 1,
  matchNumber: Math.floor(matchNumber / 2),
  slot: matchNumber % 2 === 0 ? "A" : "B",
});

export const totalRoundsFor = (teamCount) => Math.log2(nextPowerOfTwo(teamCount));

export const roundLabel = (round, totalRounds) => {
  const remaining = totalRounds - round;
  if (remaining === 0) return "Final";
  if (remaining === 1) return "Semifinals";
  if (remaining === 2) return "Quarterfinals";
  return `Round ${round}`;
};
