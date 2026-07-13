// ─── Battle-log verification logic ───────────────────────────────────────────
// Pure functions for turning a Supercell battle log into a tournament match
// result. Shared by the Vercel verify endpoint and the test suite — no fetch,
// no database, just parsing.
//
// Strategy: we only need ONE player's battle log (the "target" — first tag of
// team A). Their log already lists all 6 participants of every 3v3 battle, so
// one API call is enough to (a) find the tournament game, (b) verify the
// other five tags against our manifest, and (c) read the result relative to
// the target player.

export const normalizeTag = (tag) =>
  "#" + String(tag || "").toUpperCase().replace(/[^0-9A-Z]/g, "");

// Supercell tags are URL path segments: '#' must become %23.
export const encodeTag = (tag) => encodeURIComponent(normalizeTag(tag));

// Supercell basic-ISO timestamp ("20260713T183000.000Z") → epoch millis.
export const parseBattleTime = (s) => {
  if (!s) return NaN;
  const iso = s.replace(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/,
    "$1-$2-$3T$4:$5:$6"
  );
  return Date.parse(iso);
};

// All players across both sides of a battle-log entry (3v3 → teams array;
// showdown formats have `players` instead and are never tournament-valid).
const battleTags = (battle) => {
  const teams = battle?.battle?.teams;
  if (!Array.isArray(teams)) return null;
  return teams.flat().map(p => normalizeTag(p.tag));
};

// Search one player's battle log for the tournament game.
//
//   battleLog  — Supercell response: { items: [...] }
//   options.teamATags / teamBTags — manifest from TournamentMatches (6 tags)
//   options.targetTag  — whose log this is (must be in teamATags)
//   options.windowStart / windowEnd — epoch ms; battle must fall inside
//   options.mode — optional mode filter (e.g. "brawlBall")
//
// Returns { status, result?, battle?, reason? } where status is one of
// found | not_found | ambiguous, and result is team_a | team_b | tie.
export const findTournamentMatch = (battleLog, options) => {
  const { teamATags = [], teamBTags = [], targetTag, windowStart, windowEnd, mode } = options;
  const wantA = teamATags.map(normalizeTag);
  const wantB = teamBTags.map(normalizeTag);
  const wantAll = [...wantA, ...wantB].sort();
  const target = normalizeTag(targetTag);
  if (!wantA.includes(target)) {
    return { status: "error", reason: "target_not_in_team_a" };
  }

  const items = Array.isArray(battleLog?.items) ? battleLog.items : [];
  const candidates = [];

  for (const item of items) {
    const t = parseBattleTime(item.battleTime);
    if (Number.isNaN(t)) continue;
    if (windowStart != null && t < windowStart) continue;
    if (windowEnd != null && t > windowEnd) continue;
    if (mode && item?.event?.mode !== mode && item?.battle?.mode !== mode) continue;

    const tags = battleTags(item);
    if (!tags || tags.length !== wantAll.length) continue;
    // Exact participant match — all 6 tags, nobody else. Blocks result
    // spoofing via a friendly with a copycat lineup missing one player.
    const sorted = [...tags].sort();
    if (sorted.some((tag, i) => tag !== wantAll[i])) continue;

    candidates.push(item);
  }

  if (candidates.length === 0) return { status: "not_found", reason: "no_matching_battle_in_window" };

  // Multiple qualifying games inside the window (e.g. a sudden-death rematch
  // after a tie): the LATEST one decides the series.
  candidates.sort((a, b) => parseBattleTime(b.battleTime) - parseBattleTime(a.battleTime));
  const battle = candidates[0];

  const outcome = battle?.battle?.result; // 'victory' | 'defeat' | 'draw' (relative to log owner = target)
  if (outcome === "draw") return { status: "found", result: "tie", battle };
  if (outcome === "victory") return { status: "found", result: "team_a", battle };
  if (outcome === "defeat") return { status: "found", result: "team_b", battle };
  return { status: "error", reason: `unrecognized_result:${outcome}` };
};

// Rate limit check: one verification attempt per user per RATE_LIMIT_MS.
export const RATE_LIMIT_MS = 3 * 60 * 1000;
export const rateLimited = (lastAttemptTime, now = Date.now()) => {
  if (!lastAttemptTime) return false;
  const last = new Date(lastAttemptTime).getTime();
  return now - last < RATE_LIMIT_MS;
};
export const rateLimitRemaining = (lastAttemptTime, now = Date.now()) => {
  if (!lastAttemptTime) return 0;
  const last = new Date(lastAttemptTime).getTime();
  return Math.max(0, RATE_LIMIT_MS - (now - last));
};
