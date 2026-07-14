// ─── POST /api/reset-match ────────────────────────────────────────────────────
// Tournament-creator override for disputes (lag, disconnects, mistaken
// verification): resets a match back to a fresh check-in window without
// touching the result-verification logic. No investigation UI — the creator
// just presses one button and both teams re-check-in and replay.
//
// Body: { matchId, adminKey? }
// Same auth as generate-bracket: global admin key, or the tournament's
// creator (still premium).

import { assertEnv, dbSelect, dbUpdate, json, getUserFromRequest } from "./_lib/db.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  try {
    assertEnv();
    const { matchId, adminKey } = req.body ?? {};
    if (!matchId) return json(res, 400, { error: "matchId required" });

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

    if (!match.team_a_tags?.length || !match.team_b_tags?.length) {
      return json(res, 409, { error: "match_not_playable", reason: "missing_a_team" });
    }

    const [updated] = await dbUpdate("TournamentMatches", `id=eq.${match.id}`, {
      status: "checkin",
      result: null,
      verified: false,
      verified_at: null,
      scheduled_time: new Date().toISOString(),
      checkin_deadline: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      checkin_status: {},
    });

    return json(res, 200, { ok: true, match: updated });
  } catch (e) {
    console.error("reset-match error:", e);
    return json(res, e.status || 500, { error: e.message });
  }
}
