// ─── POST /api/generate-bracket ──────────────────────────────────────────────
// Locks registration and builds the single-elimination bracket: groups
// registrations into complete teams, seeds premium teams first (they absorb
// the mathematically-required byes — never extra wins), shuffles the rest,
// writes every round's matches, auto-advances bye teams, and opens the
// round-1 check-in window.
//
// Body: { tournamentId, adminKey }
// Admin-gated via TOURNAMENT_ADMIN_KEY env var.

import { groupIntoTeams, seedTeams, generateBracket, nextSlot, totalRoundsFor } from "../src/data/bracket.js";
import { assertEnv, dbSelect, dbInsert, dbUpdate, json } from "./_lib/db.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  try {
    assertEnv();
    const { tournamentId, adminKey } = req.body ?? {};
    if (!process.env.TOURNAMENT_ADMIN_KEY || adminKey !== process.env.TOURNAMENT_ADMIN_KEY) {
      return json(res, 403, { error: "forbidden" });
    }
    if (!tournamentId) return json(res, 400, { error: "tournamentId required" });

    const [tournament] = await dbSelect("Tournaments", `id=eq.${encodeURIComponent(tournamentId)}&select=*`);
    if (!tournament) return json(res, 404, { error: "tournament_not_found" });
    if (tournament.status !== "registration") return json(res, 409, { error: `tournament_status_${tournament.status}` });

    const registrations = await dbSelect("Registrations", `tournament_id=eq.${encodeURIComponent(tournamentId)}&select=*`);
    const teams = groupIntoTeams(registrations, tournament.team_size);
    if (teams.length < 2) return json(res, 422, { error: "need_at_least_2_complete_teams", completeTeams: teams.length });

    const seeded = seedTeams(teams.slice(0, tournament.max_teams));
    const bracket = generateBracket(seeded);

    const nowIso = new Date().toISOString();
    const deadline = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const rows = bracket.map(m => ({
      tournament_id: tournamentId,
      round: m.round,
      match_number: m.matchNumber,
      team_a_name: m.teamA?.name ?? null,
      team_b_name: m.teamB?.name ?? null,
      team_a_user_ids: m.teamA?.players.map(p => p.userId).filter(Boolean) ?? [],
      team_b_user_ids: m.teamB?.players.map(p => p.userId).filter(Boolean) ?? [],
      team_a_tags: m.teamA?.players.map(p => p.tag) ?? [],
      team_b_tags: m.teamB?.players.map(p => p.tag) ?? [],
      status: m.status === "bye" ? "bye" : "pending",
      scheduled_time: m.round === 1 && m.status !== "bye" ? nowIso : null,
      checkin_deadline: m.round === 1 && m.status !== "bye" ? deadline : null,
    }));
    const inserted = await dbInsert("TournamentMatches", rows);

    // Auto-advance every bye team into round 2 immediately.
    const byRoundNum = new Map(inserted.map(m => [`${m.round}:${m.match_number}`, m]));
    for (const m of inserted.filter(x => x.status === "bye")) {
      const { round, matchNumber, slot } = nextSlot(m.round, m.match_number);
      const next = byRoundNum.get(`${round}:${matchNumber}`);
      if (!next) continue;
      const patch = slot === "A"
        ? { team_a_name: m.team_a_name, team_a_user_ids: m.team_a_user_ids, team_a_tags: m.team_a_tags }
        : { team_b_name: m.team_a_name, team_b_user_ids: m.team_a_user_ids, team_b_tags: m.team_a_tags };
      // Two byes can feed the same next-round match — once both slots are
      // occupied it's immediately playable, so open its check-in window.
      const otherFilled = slot === "A" ? (next.team_b_tags || []).length > 0 : (next.team_a_tags || []).length > 0;
      if (otherFilled) {
        patch.status = "checkin";
        patch.scheduled_time = nowIso;
        patch.checkin_deadline = deadline;
      }
      const [updated] = await dbUpdate("TournamentMatches", `id=eq.${next.id}`, patch);
      if (updated) byRoundNum.set(`${round}:${matchNumber}`, updated);
    }

    await dbUpdate("Tournaments", `id=eq.${encodeURIComponent(tournamentId)}`, { status: "live" });

    return json(res, 200, {
      ok: true,
      teams: seeded.length,
      byes: bracket.filter(m => m.status === "bye").length,
      rounds: totalRoundsFor(seeded.length),
      matches: inserted.length,
    });
  } catch (e) {
    console.error("generate-bracket error:", e);
    return json(res, e.status || 500, { error: e.message });
  }
}
