// ─── POST /api/verify-match ──────────────────────────────────────────────────
// Player-triggered result verification. Fetches the battle log of ONE
// designated target player (first tag of team A — their log already lists all
// six participants, so a single Supercell call covers the whole lobby),
// matches it against the tournament manifest, and advances the winner.
//
// Body: { matchId, playerTag }   (playerTag = whoever pressed the button,
//                                 used for the per-player 3-minute rate limit)
// Responses:
//   200 { status:"found", result:"team_a"|"team_b", winner }  → advanced
//   200 { status:"found", result:"tie" }                      → play rematch
//   404 { status:"not_found" }        → log not synced yet, retry later
//   429 { status:"rate_limited", retryAfterMs }
//   409 { status:"invalid_state" }    → match not active / already verified

import {
  normalizeTag, encodeTag, findTournamentMatch, rateLimited, rateLimitRemaining,
} from "../src/data/verifyLogic.js";
import { assertEnv, dbSelect, dbInsert, dbUpdate, advanceWinner, creditWallets, json } from "./_lib/db.js";
import { supercellFetch } from "./_lib/proxyFetch.js";

const SUPERCELL_API_KEY = process.env.SUPERCELL_API_KEY;
const API_BASE = process.env.SUPERCELL_API_BASE || "https://api.brawlstars.com/v1";
const WINDOW_MS = 45 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  try {
    assertEnv();
    if (!SUPERCELL_API_KEY) return json(res, 500, { error: "Server missing SUPERCELL_API_KEY" });

    const { matchId, playerTag } = req.body ?? {};
    if (!matchId || !playerTag) return json(res, 400, { error: "matchId and playerTag required" });
    const requester = normalizeTag(playerTag);

    const matches = await dbSelect("TournamentMatches", `id=eq.${encodeURIComponent(matchId)}&select=*`);
    const match = matches[0];
    if (!match) return json(res, 404, { status: "match_not_found" });
    if (match.verified) return json(res, 409, { status: "invalid_state", reason: "already_verified" });
    if (!["active", "checkin"].includes(match.status)) {
      return json(res, 409, { status: "invalid_state", reason: `match_status_${match.status}` });
    }
    const allTags = [...(match.team_a_tags || []), ...(match.team_b_tags || [])];
    if (!allTags.includes(requester)) return json(res, 403, { status: "forbidden", reason: "not_in_match" });

    // Per-player rate limit: one attempt per 3 minutes, tracked in Verifications.
    const prior = await dbSelect(
      "Verifications",
      `match_id=eq.${encodeURIComponent(matchId)}&user_id=eq.${encodeURIComponent(requester)}&order=last_attempt_time.desc&limit=1`
    );
    if (prior.length && rateLimited(prior[0].last_attempt_time)) {
      return json(res, 429, { status: "rate_limited", retryAfterMs: rateLimitRemaining(prior[0].last_attempt_time) });
    }

    // Target player = first tag of team A; one battle-log call verifies all 6.
    // Routed through the same static-IP proxy the scrapers package uses —
    // Supercell
    // keys are locked to an allowlisted IP, and Vercel's outbound IP isn't
    // static, so a direct call would be rejected.
    const targetTag = normalizeTag(match.team_a_tags[0]);
    const scRes = await supercellFetch(
      `${API_BASE}/players/${encodeTag(targetTag)}/battlelog`,
      { headers: { Authorization: `Bearer ${SUPERCELL_API_KEY}` }, signal: AbortSignal.timeout(15000) }
    );

    const logAttempt = async (status, resultJson) => {
      if (prior.length) {
        await dbUpdate("Verifications", `id=eq.${prior[0].id}`, {
          attempt_count: prior[0].attempt_count + 1,
          last_attempt_time: new Date().toISOString(),
          status,
          result_json: resultJson ?? null,
        });
      } else {
        await dbInsert("Verifications", [{
          match_id: matchId, user_id: requester, status, result_json: resultJson ?? null,
        }]);
      }
    };

    if (!scRes.ok) {
      await logAttempt("error", { supercellStatus: scRes.status });
      return json(res, 502, { status: "error", reason: `supercell_api_${scRes.status}` });
    }
    const battleLog = await scRes.json();

    const anchor = match.scheduled_time ? Date.parse(match.scheduled_time) : null;
    const now = Date.now();
    const windowStart = Math.max(now - WINDOW_MS, anchor ? anchor - 5 * 60 * 1000 : 0);

    const found = findTournamentMatch(battleLog, {
      teamATags: match.team_a_tags,
      teamBTags: match.team_b_tags,
      targetTag,
      windowStart,
      windowEnd: now + 60 * 1000, // small clock-skew slack
    });

    await logAttempt(found.status, found.battle ? { result: found.result, battleTime: found.battle.battleTime, map: found.battle.event?.map, mode: found.battle.event?.mode } : { reason: found.reason });

    if (found.status === "not_found") {
      return json(res, 404, { status: "not_found", message: "Battle not in the log yet — Supercell syncs with a delay. Try again in a minute." });
    }
    if (found.status !== "found") {
      return json(res, 422, { status: found.status, reason: found.reason });
    }
    if (found.result === "tie") {
      return json(res, 200, { status: "found", result: "tie", message: "Draw detected — play a sudden-death rematch, then verify again. The latest game decides." });
    }

    // Verified result → complete the match and advance the winner.
    const winningSide = found.result === "team_a" ? "A" : "B";
    const winnerName = winningSide === "A" ? match.team_a_name : match.team_b_name;
    await dbUpdate("TournamentMatches", `id=eq.${match.id}`, {
      status: "completed",
      result: found.result,
      verified: true,
      verified_at: new Date().toISOString(),
    });
    const [tournament] = await dbSelect("Tournaments", `id=eq.${match.tournament_id}&select=*`);
    const next = await advanceWinner(match, winningSide, tournament?.checkin_minutes || 10);

    // Final won → tournament completed; credit the prize pool to the winners'
    // wallets (payout scaffolding — real payment processor comes later).
    if (!next) {
      await dbUpdate("Tournaments", `id=eq.${match.tournament_id}`, { status: "completed" });
      const winnerTags = winningSide === "A" ? match.team_a_tags : match.team_b_tags;
      await creditWallets(winnerTags, Number(tournament?.prize_pool_total || 0));
    }

    return json(res, 200, {
      status: "found",
      result: found.result,
      winner: winnerName,
      advancedTo: next ? { round: next.round, matchNumber: next.match_number } : "champion",
    });
  } catch (e) {
    console.error("verify-match error:", e);
    return json(res, e.status || 500, { status: "error", reason: e.message });
  }
}
