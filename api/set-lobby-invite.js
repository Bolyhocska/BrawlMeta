// ─── POST /api/set-lobby-invite ───────────────────────────────────────────────
// The team that hosts the lobby (team A — shown on top of the matchup) shares a
// Brawl Stars team invite link into the match, so the opponent can click it and
// join without exchanging friend requests.
//
// Body: { matchId, invite }
// Auth: caller's Supabase session (Bearer); their profile.player_tag must be in
// the match. Any member of either side may post/replace the invite.

import { assertEnv, dbSelect, dbUpdate, json, getUserFromRequest } from "./_lib/db.js";
import { normalizeTag } from "../src/data/verifyLogic.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  try {
    assertEnv();
    const { matchId, invite } = req.body ?? {};
    if (!matchId) return json(res, 400, { error: "matchId required" });
    const clean = String(invite ?? "").trim().slice(0, 400);

    const user = await getUserFromRequest(req);
    if (!user) return json(res, 401, { error: "not_signed_in" });
    const [profile] = await dbSelect("Profiles", `id=eq.${user.id}&select=player_tag,display_name`);
    const myTag = normalizeTag(profile?.player_tag || "");
    if (!profile?.player_tag) return json(res, 400, { error: "no_player_tag", message: "Set your player tag on your profile first." });

    const [match] = await dbSelect("TournamentMatches", `id=eq.${encodeURIComponent(matchId)}&select=*`);
    if (!match) return json(res, 404, { error: "match_not_found" });
    if (match.status === "completed") return json(res, 409, { error: "already_completed" });

    const onA = (match.team_a_tags || []).includes(myTag);
    const onB = (match.team_b_tags || []).includes(myTag);
    if (!onA && !onB) return json(res, 403, { error: "not_in_match" });

    const patch = {
      lobby_invite: clean || null,
      lobby_invite_by: clean ? (profile.display_name || myTag) : null,
      lobby_invite_at: clean ? new Date().toISOString() : null,
    };

    // Anti-grief grace period: if the host shares the invite with under 3
    // minutes left on the check-in clock, the opponent gets a fresh 3-minute
    // window to join the lobby — a last-second link can't force a forfeit.
    const GRACE_MS = 3 * 60 * 1000;
    if (clean && ["pending", "checkin"].includes(match.status) && match.checkin_deadline) {
      const remaining = Date.parse(match.checkin_deadline) - Date.now();
      if (remaining < GRACE_MS) patch.checkin_deadline = new Date(Date.now() + GRACE_MS).toISOString();
    }

    await dbUpdate("TournamentMatches", `id=eq.${match.id}`, patch);
    const graced = !!patch.checkin_deadline;
    return json(res, 200, {
      ok: true,
      message: clean
        ? (graced ? "Lobby invite shared — your opponent got a 3-minute grace window to join." : "Lobby invite shared with your opponent.")
        : "Lobby invite cleared.",
    });
  } catch (e) {
    console.error("set-lobby-invite error:", e);
    return json(res, e.status || 500, { error: e.message });
  }
}
