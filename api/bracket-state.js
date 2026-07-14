// ─── GET /api/bracket-state?tournamentId=… ───────────────────────────────────
// Returns the full bracket, and lazily enforces check-in deadlines: any match
// whose 10-minute window expired gets resolved as a walkover — the team with
// the complete (or better) check-in record advances, no-shows are
// disqualified. Running this on read keeps the engine fully hands-off with no
// cron dependency: the next person to look at the bracket triggers the sweep.

import { assertEnv, dbSelect, dbUpdate, advanceWinner, json } from "./_lib/db.js";

const checkinsFor = (match, side) => {
  const tags = side === "A" ? match.team_a_tags : match.team_b_tags;
  return (tags || []).filter(t => match.checkin_status?.[t] === true).length;
};

async function sweepExpiredCheckins(matches) {
  const now = Date.now();
  const resolved = [];
  for (const m of matches) {
    if (!["pending", "checkin"].includes(m.status)) continue;
    if (!m.checkin_deadline || Date.parse(m.checkin_deadline) > now) continue;
    if (!(m.team_a_tags || []).length || !(m.team_b_tags || []).length) continue;

    const aIn = checkinsFor(m, "A");
    const bIn = checkinsFor(m, "B");
    const aFull = aIn === m.team_a_tags.length;
    const bFull = bIn === m.team_b_tags.length;

    if (aFull && bFull) {
      // Everyone made it right at the wire — the flip to active raced the
      // deadline; just activate.
      await dbUpdate("TournamentMatches", `id=eq.${m.id}`, { status: "active" });
      resolved.push({ id: m.id, action: "activated" });
      continue;
    }
    // Walkover: the side with the stronger check-in record advances
    // (deterministic team_a fallback when both sides fully no-showed).
    const winningSide = aIn >= bIn ? "A" : "B";
    const [updated] = await dbUpdate("TournamentMatches", `id=eq.${m.id}`, {
      status: "completed",
      result: winningSide === "A" ? "team_a" : "team_b",
      verified: true,           // verified by forfeit, not by battle log
      verified_at: new Date().toISOString(),
    });
    if (updated) await advanceWinner(updated, winningSide);
    resolved.push({ id: m.id, action: "walkover", winner: winningSide === "A" ? m.team_a_name : m.team_b_name });
  }
  return resolved;
}

// Dual-confirmation timeout: an active match where exactly one side reported a
// winner and the report window has lapsed resolves to the reporter — the silent
// opponent forfeits the confirmation. Disputed matches are left for the creator.
async function sweepReportTimeouts(matches, checkinMinutes) {
  const now = Date.now();
  const resolved = [];
  for (const m of matches) {
    if (m.status !== "active" || m.disputed) continue;
    if (!m.report_deadline || Date.parse(m.report_deadline) > now) continue;
    const aRep = m.team_a_reported, bRep = m.team_b_reported;
    if ((aRep && bRep) || (!aRep && !bRep)) continue; // both or neither → not a timeout case

    const reported = aRep || bRep;                // the lone report
    const winningSide = reported === "team_a" ? "A" : "B";
    const [updated] = await dbUpdate("TournamentMatches", `id=eq.${m.id}`, {
      status: "completed", result: reported, verified: true, verified_at: new Date().toISOString(),
    });
    if (updated) await advanceWinner(updated, winningSide, checkinMinutes);
    resolved.push({ id: m.id, action: "report_timeout", winner: reported === "team_a" ? m.team_a_name : m.team_b_name });
  }
  return resolved;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "GET only" });
  try {
    assertEnv();
    const tournamentId = req.query?.tournamentId;
    if (!tournamentId) return json(res, 400, { error: "tournamentId required" });

    const [tournament] = await dbSelect("Tournaments", `id=eq.${encodeURIComponent(tournamentId)}&select=*`);
    if (!tournament) return json(res, 404, { error: "tournament_not_found" });

    let matches = await dbSelect(
      "TournamentMatches",
      `tournament_id=eq.${encodeURIComponent(tournamentId)}&select=*&order=round.asc,match_number.asc`
    );
    const swept = await sweepExpiredCheckins(matches);
    const sweptReports = await sweepReportTimeouts(matches, tournament.checkin_minutes || 10);
    if (swept.length || sweptReports.length) {
      matches = await dbSelect(
        "TournamentMatches",
        `tournament_id=eq.${encodeURIComponent(tournamentId)}&select=*&order=round.asc,match_number.asc`
      );
    }
    return json(res, 200, { tournament, matches, swept: [...swept, ...sweptReports] });
  } catch (e) {
    console.error("bracket-state error:", e);
    return json(res, e.status || 500, { error: e.message });
  }
}
