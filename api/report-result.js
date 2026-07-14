// ─── POST /api/report-result ──────────────────────────────────────────────────
// Single-upload + dispute-timer result reporting. Only the winner needs to act:
// they report the result (ideally with a screenshot). The other team gets a
// short window to confirm or dispute — doing nothing accepts it. Resolution
// ladder (same call handles the reporter and the responder):
//   • first report            → start the dispute window; the other team is
//                               notified they can confirm or dispute
//   • other team confirms      → finalize + advance the winner instantly
//   • other team disputes      → flag disputed; the creator decides
//   • other team does nothing  → a lazy sweep in bracket-state.js auto-accepts
//                               the reported result once the window lapses
//
// Body: { matchId, winner: "team_a" | "team_b", proofUrl? }
// Auth: the caller's Supabase session (Bearer token); their profile.player_tag
// must be in the match, which decides which side they report for.

import { assertEnv, dbSelect, dbUpdate, advanceWinner, creditWallets, json, getUserFromRequest } from "./_lib/db.js";
import { normalizeTag } from "../src/data/verifyLogic.js";

const REPORT_WINDOW_MIN = 3;                             // dispute window
const REPORT_WINDOW_MS = REPORT_WINDOW_MIN * 60 * 1000;  // silent side auto-accepts after this

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  try {
    assertEnv();
    const { matchId, winner, proofUrl } = req.body ?? {};
    if (!matchId || !["team_a", "team_b"].includes(winner)) {
      return json(res, 400, { error: "matchId and winner (team_a|team_b) required" });
    }

    const user = await getUserFromRequest(req);
    if (!user) return json(res, 401, { error: "not_signed_in" });
    const [profile] = await dbSelect("Profiles", `id=eq.${user.id}&select=player_tag`);
    const myTag = normalizeTag(profile?.player_tag || "");
    if (!profile?.player_tag) return json(res, 400, { error: "no_player_tag", message: "Set your player tag on your profile first." });

    const [match] = await dbSelect("TournamentMatches", `id=eq.${encodeURIComponent(matchId)}&select=*`);
    if (!match) return json(res, 404, { error: "match_not_found" });
    if (match.status === "completed") return json(res, 409, { error: "already_completed" });
    if (!["active", "checkin"].includes(match.status)) return json(res, 409, { error: `match_status_${match.status}` });

    const onA = (match.team_a_tags || []).includes(myTag);
    const onB = (match.team_b_tags || []).includes(myTag);
    if (!onA && !onB) return json(res, 403, { error: "not_in_match" });
    const mySide = onA ? "A" : "B";

    // Record this side's report (+ optional proof, + first-report deadline).
    const now = new Date().toISOString();
    const patch = {};
    if (mySide === "A") {
      patch.team_a_reported = winner;
      patch.team_a_reported_at = now;
      if (proofUrl) patch.team_a_proof_url = proofUrl;
    } else {
      patch.team_b_reported = winner;
      patch.team_b_reported_at = now;
      if (proofUrl) patch.team_b_proof_url = proofUrl;
    }
    // Start the report window on the first report so the sweep can forfeit a
    // silent opponent.
    const firstReport = !match.team_a_reported && !match.team_b_reported;
    if (firstReport) patch.report_deadline = new Date(Date.now() + REPORT_WINDOW_MS).toISOString();

    // Also flip an unresolved checkin match to active on first report — the
    // teams clearly played, so don't leave it stuck waiting on check-ins.
    if (match.status !== "active") patch.status = "active";

    const [afterReport] = await dbUpdate("TournamentMatches", `id=eq.${match.id}`, patch);

    const aReport = afterReport.team_a_reported;
    const bReport = afterReport.team_b_reported;

    // Both sides in — resolve.
    if (aReport && bReport) {
      if (aReport === bReport) {
        // Agreement → finalize + advance.
        const winningSide = aReport === "team_a" ? "A" : "B";
        await dbUpdate("TournamentMatches", `id=eq.${match.id}`, {
          status: "completed", result: aReport, verified: true, verified_at: now, disputed: false,
        });
        const [tournament] = await dbSelect("Tournaments", `id=eq.${match.tournament_id}&select=*`);
        const next = await advanceWinner({ ...afterReport, result: aReport }, winningSide, tournament?.checkin_minutes || 10);
        if (!next) {
          await dbUpdate("Tournaments", `id=eq.${match.tournament_id}`, { status: "completed" });
          const winnerTags = winningSide === "A" ? afterReport.team_a_tags : afterReport.team_b_tags;
          await creditWallets(winnerTags, Number(tournament?.prize_pool_total || 0));
        }
        return json(res, 200, { status: "confirmed", result: aReport, message: "Confirmed — winner advances! 🏆" });
      }
      // Disagreement → dispute.
      await dbUpdate("TournamentMatches", `id=eq.${match.id}`, { disputed: true });
      return json(res, 200, { status: "disputed", message: "Result disputed. Attach a screenshot of the result screen — the organizer will resolve it." });
    }

    // First report — the other team now has the dispute window to respond.
    return json(res, 200, { status: "waiting", message: `Result submitted. If the other team doesn't dispute within ${REPORT_WINDOW_MIN} minutes, you advance automatically.` });
  } catch (e) {
    console.error("report-result error:", e);
    return json(res, e.status || 500, { error: e.message });
  }
}
