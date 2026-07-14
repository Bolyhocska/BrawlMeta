// ─── POST /api/declare-winner ─────────────────────────────────────────────────
// Creator/admin dispute resolution: force a final winner on a match, whatever
// the two teams reported. Used from the manage dashboard after glancing at the
// uploaded screenshots. Finalizes + advances like a normal confirmation.
//
// Body: { matchId, winner: "team_a" | "team_b", adminKey? }
// Auth: global admin key, or the tournament's creator (still premium).

import { assertEnv, dbSelect, dbUpdate, advanceWinner, creditWallets, json, getUserFromRequest } from "./_lib/db.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  try {
    assertEnv();
    const { matchId, winner, adminKey } = req.body ?? {};
    if (!matchId || !["team_a", "team_b"].includes(winner)) {
      return json(res, 400, { error: "matchId and winner (team_a|team_b) required" });
    }

    const [match] = await dbSelect("TournamentMatches", `id=eq.${encodeURIComponent(matchId)}&select=*`);
    if (!match) return json(res, 404, { error: "match_not_found" });
    const [tournament] = await dbSelect("Tournaments", `id=eq.${match.tournament_id}&select=*`);
    if (!tournament) return json(res, 404, { error: "tournament_not_found" });

    const isAdmin = process.env.TOURNAMENT_ADMIN_KEY && adminKey === process.env.TOURNAMENT_ADMIN_KEY;
    if (!isAdmin) {
      const user = await getUserFromRequest(req);
      if (!user || user.id !== tournament.created_by) return json(res, 403, { error: "forbidden" });
      const [profile] = await dbSelect("Profiles", `id=eq.${user.id}&select=is_premium`);
      if (!profile?.is_premium) return json(res, 403, { error: "premium_required" });
    }

    const winningSide = winner === "team_a" ? "A" : "B";
    if (!(winningSide === "A" ? match.team_a_tags : match.team_b_tags)?.length) {
      return json(res, 409, { error: "winner_slot_empty" });
    }

    await dbUpdate("TournamentMatches", `id=eq.${match.id}`, {
      status: "completed", result: winner, verified: true, verified_at: new Date().toISOString(), disputed: false,
    });
    const next = await advanceWinner({ ...match, result: winner }, winningSide, tournament.checkin_minutes || 10);
    if (!next) {
      await dbUpdate("Tournaments", `id=eq.${match.tournament_id}`, { status: "completed" });
      const winnerTags = winningSide === "A" ? match.team_a_tags : match.team_b_tags;
      await creditWallets(winnerTags, Number(tournament.prize_pool_total || 0));
    }

    return json(res, 200, { ok: true, result: winner, advancedTo: next ? { round: next.round, matchNumber: next.match_number } : "champion" });
  } catch (e) {
    console.error("declare-winner error:", e);
    return json(res, e.status || 500, { error: e.message });
  }
}
