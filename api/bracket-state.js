// ─── GET /api/bracket-state?tournamentId=… ───────────────────────────────────
// Returns the full bracket, and lazily enforces check-in deadlines: any match
// whose 10-minute window expired gets resolved as a walkover — the team with
// the complete (or better) check-in record advances, no-shows are
// disqualified. Running this on read keeps the engine fully hands-off with no
// cron dependency: the next person to look at the bracket triggers the sweep.

import { assertEnv, dbSelect, dbUpdate, advanceWinner, creditWallets, json } from "./_lib/db.js";

// Advance the winner and, when it was the FINAL match (no next match), mark the
// tournament completed and pay out — mirroring report-result/declare-winner.
// The sweeps previously skipped this, leaving finished tournaments stuck "live".
async function advanceAndMaybeFinish(match, winningSide, checkinMinutes = 10) {
  const next = await advanceWinner(match, winningSide, checkinMinutes);
  if (!next) {
    const [tournament] = await dbSelect("Tournaments", `id=eq.${match.tournament_id}&select=*`);
    await dbUpdate("Tournaments", `id=eq.${match.tournament_id}`, { status: "completed" });
    const winnerTags = winningSide === "A" ? match.team_a_tags : match.team_b_tags;
    await creditWallets(winnerTags, Number(tournament?.prize_pool_total || 0));
  }
  return next;
}

const checkinsFor = (match, side) => {
  const tags = side === "A" ? match.team_a_tags : match.team_b_tags;
  return (tags || []).filter(t => match.checkin_status?.[t] === true).length;
};

// Captain-level check-in: a side is PRESENT when at least one of its players
// has checked in. Teammates registered by their captain have no accounts, so
// requiring the whole roster used to block matches from ever going active —
// which is why the old sweep "randomly" declared winners at the deadline and
// the report button never appeared.
async function sweepExpiredCheckins(matches) {
  const now = Date.now();
  const resolved = [];
  for (const m of matches) {
    if (!["pending", "checkin"].includes(m.status)) continue;
    if (!m.checkin_deadline || Date.parse(m.checkin_deadline) > now) continue;
    if (!(m.team_a_tags || []).length || !(m.team_b_tags || []).length) continue;

    const aPresent = checkinsFor(m, "A") >= 1;
    const bPresent = checkinsFor(m, "B") >= 1;

    if (aPresent && bPresent) {
      // Both captains showed. Team A hosts the lobby — if they never shared
      // the invite before the master timer hit 0, THEY forfeit, so the host
      // can't grief the opponent by withholding the lobby link until the end.
      if (!m.lobby_invite) {
        const [updated] = await dbUpdate("TournamentMatches", `id=eq.${m.id}`, {
          status: "completed", result: "team_b", verified: true, verified_at: new Date().toISOString(),
        });
        if (updated) await advanceAndMaybeFinish(updated, "B");
        resolved.push({ id: m.id, action: "host_forfeit_no_lobby", winner: m.team_b_name });
      } else {
        // Deadline raced the activation flip — go live; the match is now in
        // the disputable reporting state, never a silent random walkover.
        await dbUpdate("TournamentMatches", `id=eq.${m.id}`, { status: "active" });
        resolved.push({ id: m.id, action: "activated" });
      }
      continue;
    }
    // Walkover: the side whose captain checked in advances (deterministic
    // team_a fallback when both sides fully no-showed).
    const winningSide = aPresent || !bPresent ? "A" : "B";
    const [updated] = await dbUpdate("TournamentMatches", `id=eq.${m.id}`, {
      status: "completed",
      result: winningSide === "A" ? "team_a" : "team_b",
      verified: true,           // verified by forfeit, not by battle log
      verified_at: new Date().toISOString(),
    });
    if (updated) await advanceAndMaybeFinish(updated, winningSide);
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
    if (updated) await advanceAndMaybeFinish(updated, winningSide, checkinMinutes);
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
