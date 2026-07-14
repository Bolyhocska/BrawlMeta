// ─── Server-side Supabase + bracket helpers for Vercel functions ─────────────
// Uses the service-role key (env: SUPABASE_SERVICE_KEY) via plain REST — the
// anon key in the browser is read-only for tournament tables, so every write
// funnels through these functions.

import { nextSlot } from "../../src/data/bracket.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const headers = () => ({
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
});

export const assertEnv = () => {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw Object.assign(new Error("Server missing SUPABASE_URL / SUPABASE_SERVICE_KEY"), { status: 500 });
  }
};

export async function dbSelect(table, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: headers() });
  if (!res.ok) throw Object.assign(new Error(`db select ${table}: ${res.status} ${await res.text()}`), { status: 502 });
  return res.json();
}

export async function dbInsert(table, rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...headers(), Prefer: "return=representation" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw Object.assign(new Error(`db insert ${table}: ${res.status} ${await res.text()}`), { status: 502 });
  return res.json();
}

export async function dbUpdate(table, query, patch) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: "PATCH",
    headers: { ...headers(), Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw Object.assign(new Error(`db update ${table}: ${res.status} ${await res.text()}`), { status: 502 });
  return res.json();
}

// Advance a winning team out of `match` into its next-round slot. Returns the
// updated next match row, or null when `match` was the final.
export async function advanceWinner(match, winningSide) {
  const team = {
    name: winningSide === "A" ? match.team_a_name : match.team_b_name,
    userIds: winningSide === "A" ? match.team_a_user_ids : match.team_b_user_ids,
    tags: winningSide === "A" ? match.team_a_tags : match.team_b_tags,
  };
  const { round, matchNumber, slot } = nextSlot(match.round, match.match_number);
  const rows = await dbSelect(
    "TournamentMatches",
    `tournament_id=eq.${match.tournament_id}&round=eq.${round}&match_number=eq.${matchNumber}&select=*`
  );
  if (!rows.length) return null; // that was the final

  const next = rows[0];
  const patch = slot === "A"
    ? { team_a_name: team.name, team_a_user_ids: team.userIds, team_a_tags: team.tags }
    : { team_b_name: team.name, team_b_user_ids: team.userIds, team_b_tags: team.tags };

  // If the opposite slot is already occupied, the next match becomes playable:
  // open a fresh 10-minute check-in window.
  const otherFilled = slot === "A" ? (next.team_b_tags || []).length > 0 : (next.team_a_tags || []).length > 0;
  if (otherFilled) {
    patch.status = "checkin";
    patch.scheduled_time = new Date().toISOString();
    patch.checkin_deadline = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  }
  const updated = await dbUpdate("TournamentMatches", `id=eq.${next.id}`, patch);
  return updated[0] ?? null;
}

// Credit tournament winnings into UserWallets (schema scaffolding for the
// future payout integration — no real money moves yet).
export async function creditWallets(tags, totalAmount) {
  if (!tags?.length || !totalAmount) return;
  const share = Math.round((totalAmount / tags.length) * 100) / 100;
  for (const tag of tags) {
    const existing = await dbSelect("UserWallets", `player_tag=eq.${encodeURIComponent(tag)}&select=*`);
    if (existing.length) {
      await dbUpdate("UserWallets", `player_tag=eq.${encodeURIComponent(tag)}`, {
        balance: Number(existing[0].balance) + share,
        total_earned: Number(existing[0].total_earned) + share,
        updated_at: new Date().toISOString(),
      });
    } else {
      await dbInsert("UserWallets", [{ player_tag: tag, balance: share, total_earned: share }]);
    }
  }
}

export const json = (res, status, body) => {
  res.status(status).setHeader("Content-Type", "application/json");
  res.json(body);
};

// Resolves the Supabase user for a request's Bearer token — used to let a
// tournament's creator trigger their own bracket generation without needing
// the global admin key. Returns null for a missing/invalid/expired token.
export async function getUserFromRequest(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}
