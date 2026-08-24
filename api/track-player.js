// ─── POST /api/track-player ──────────────────────────────────────────────────
// Boost a profile into deeper tracking, or opt it out of tracking entirely.
//
// Body: { tag, action: "boost" | "untrack" }
//   boost   → poll this profile every ~3h instead of ~12h, and start recording
//             trophy/progression snapshots for it.
//   untrack → stop tracking, delete stored history, and tombstone the tag so a
//             later lookup cannot silently re-enrol it.
//
// BOOST IS FREE AND ALWAYS WILL BE. Brawlify sells almost exactly this at
// $4.99/mo ("automatic updates", "never miss a battle"). Core principle 1 says
// players never pay, so this is opt-in rather than paid: the deeper data costs
// real budget against a single IP-allowlisted Supercell key, and asking is how
// we decide who to spend it on. Do not turn this into a paywall.
//
// Deliberately NOT authenticated. Requiring an account to stop being tracked
// would be indefensible — the people most likely to want out are the ones who
// never signed up. The trade-off is that anyone can boost or untrack any tag,
// which is why untrack is destructive-but-recoverable (their history rebuilds
// if they ask to be tracked again) and boost only ever costs us API budget.
// Real ownership proof waits on the Supercell tag-verification work already on
// the roadmap; until then neither action may confer anything of value.

import { json, dbRpc, assertEnv } from "./_lib/db.js";

// Crude per-instance rate limit. Not a security control — it exists so a script
// cannot cheaply enqueue thousands of boosts and drain the shared API budget.
const hits = new Map();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;

function rateLimited(key) {
  const now = Date.now();
  const seen = (hits.get(key) || []).filter(t => now - t < WINDOW_MS);
  seen.push(now);
  hits.set(key, seen);
  if (hits.size > 5000) hits.clear();   // bound memory on a long-lived instance
  return seen.length > MAX_PER_WINDOW;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { error: "POST only" });
  try {
    assertEnv();

    const { tag: rawTag, action } = req.body ?? {};
    const tag = String(rawTag || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
    if (tag.length < 3) return json(res, 400, { error: "bad_tag", message: "Enter a player tag like #2C20JJRG." });
    if (!["boost", "untrack"].includes(action)) {
      return json(res, 400, { error: "bad_action", message: "action must be 'boost' or 'untrack'." });
    }

    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || "unknown";
    if (rateLimited(ip)) {
      return json(res, 429, { error: "rate_limited", message: "Too many requests — wait a minute and try again." });
    }

    if (action === "untrack") {
      const out = await dbRpc("untrack_player", { p_tag: `#${tag}` });
      return json(res, 200, {
        tracked: false,
        removed: out?.rows_removed ?? 0,
        message: "Tracking stopped and stored history deleted. This tag won't be re-added by future lookups.",
      });
    }

    const out = await dbRpc("boost_player", { p_tag: `#${tag}` });
    return json(res, 200, {
      tracked: true,
      boosted: true,
      pollIntervalMins: out?.poll_interval_mins ?? 180,
      message: "Boosted. This profile now updates several times a day and records trophy history.",
    });
  } catch (e) {
    console.error("track-player error:", e);
    return json(res, e.status || 500, { error: "server_error", message: e.message });
  }
}
