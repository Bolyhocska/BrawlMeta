// ─── POST /api/report-dodge ───────────────────────────────────────────────────
// Team reports an opponent no-show or dodge during the pick phase. Organizer
// will review the uploaded video and decide (award victory or reset match).
//
// Body: { matchId, videoUrl }
// Auth: the caller's Supabase session (Bearer token); their profile.player_tag
// must be in the match.

import { assertEnv, dbSelect, dbUpdate, json, getUserFromRequest } from "./_lib/db.js";
import { normalizeTag } from "../src/data/verifyLogic.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  try {
    assertEnv();
    const { matchId, videoUrl } = req.body ?? {};
    if (!matchId || !videoUrl) {
      return json(res, 400, { error: "matchId and videoUrl required" });
    }

    const user = await getUserFromRequest(req);
    if (!user) return json(res, 401, { error: "not_signed_in" });
    const [profile] = await dbSelect("Profiles", `id=eq.${user.id}&select=player_tag`);
    const myTag = normalizeTag(profile?.player_tag || "");
    if (!profile?.player_tag) return json(res, 400, { error: "no_player_tag", message: "Set your player tag on your profile first." });

    const [match] = await dbSelect("TournamentMatches", `id=eq.${encodeURIComponent(matchId)}&select=*`);
    if (!match) return json(res, 404, { error: "match_not_found" });
    if (match.status === "completed") return json(res, 409, { error: "already_completed" });
    if (!["pending", "checkin", "active"].includes(match.status)) return json(res, 409, { error: `match_status_${match.status}` });

    const onA = (match.team_a_tags || []).includes(myTag);
    const onB = (match.team_b_tags || []).includes(myTag);
    if (!onA && !onB) return json(res, 403, { error: "not_in_match" });

    // Record the dodge report — whoever reports it.
    const now = new Date().toISOString();
    const patch = {
      dodge_report_url: videoUrl,
      dodge_reported_by: onA ? match.team_a_name : match.team_b_name,
      dodge_reported_at: now,
    };

    await dbUpdate("TournamentMatches", `id=eq.${match.id}`, patch);
    return json(res, 200, { ok: true, message: "Dodge reported — organizer will review the video." });
  } catch (e) {
    console.error("report-dodge error:", e);
    return json(res, e.status || 500, { error: e.message });
  }
}
