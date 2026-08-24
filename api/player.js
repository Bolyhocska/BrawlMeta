// ─── GET /api/player?tag=%232C20JJRG ─────────────────────────────────────────
// Live player lookup for the Player Card on the Leaderboards tab. The browser
// can't call the Supercell API (key + IP allowlist), so this relays through
// the same authenticated proxy the scraper uses. Returns a trimmed profile —
// never the raw payload — so the response stays small and stable.
//
// Requires SUPERCELL_API_KEY (+ PROXY_HOST/PORT/USER/PASS) in Vercel env.

import { getPlayer, isConfigured } from "./_lib/supercell.js";
import { json, dbRpc } from "./_lib/db.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "GET only" });
  try {
    if (!isConfigured()) return json(res, 501, { error: "not_configured", message: "SUPERCELL_API_KEY is not set on the server." });

    const raw = String(req.query?.tag || "");
    const tag = raw.toUpperCase().replace(/[^0-9A-Z]/g, "");
    if (tag.length < 3) return json(res, 400, { error: "bad_tag", message: "Enter a player tag like #2C20JJRG." });

    const result = await getPlayer(tag);
    if (!result.ok) return json(res, result.status, { error: result.error, message: result.message, cause: result.cause });
    const p = result.data;

    // ENROL-ON-LOOKUP. Looking a player up starts recording their match history
    // from this moment on — free, automatic, and the direct answer to Brawlify
    // paywalling a player's own past. The battlelog is a ~25-battle rolling
    // buffer that never back-fills, so a tag nobody has ever looked up has no
    // recoverable history; enrolling on first sight is the only way the second
    // visit is worth anything.
    //
    // AWAITED, not fire-and-forget. A serverless function is frozen as soon as
    // it sends a response, so an un-awaited promise is simply never run — the
    // first live test of this enrolled nobody for exactly that reason. Errors
    // are still swallowed, so the failure mode stays "lookup works, tracking
    // silently didn't" rather than a broken page. enrol_player itself refuses
    // to resurrect an opted-out tag.
    try {
      await dbRpc("enrol_player", { p_tag: `#${tag}`, p_name: p.name ?? null });
    } catch (e) {
      console.error("enrol_player failed (non-fatal):", e.message);
    }

    const brawlers = Array.isArray(p.brawlers) ? p.brawlers : [];
    const best = [...brawlers].sort((a, b) => (b.trophies || 0) - (a.trophies || 0)).slice(0, 3)
      .map(b => ({ name: b.name, trophies: b.trophies, power: b.power, rank: b.rank }));

    return json(res, 200, {
      tag: p.tag,
      name: p.name,
      nameColor: p.nameColor,
      iconId: p.icon?.id ?? null,
      trophies: p.trophies ?? 0,
      highestTrophies: p.highestTrophies ?? 0,
      expLevel: p.expLevel ?? 0,
      victories3v3: p["3vs3Victories"] ?? 0,
      soloVictories: p.soloVictories ?? 0,
      duoVictories: p.duoVictories ?? 0,
      club: p.club?.name ?? null,
      brawlersOwned: brawlers.length,
      maxedBrawlers: brawlers.filter(b => (b.power || 0) >= 11).length,
      bestBrawlers: best,
    });
  } catch (e) {
    console.error("player lookup error:", e, e?.cause);
    // Surface the underlying cause — "fetch failed" alone hides the real reason
    // (proxy refused, DNS, TLS, timeout…).
    return json(res, 500, { error: e.message, cause: e?.cause?.code || e?.cause?.message || String(e?.cause || "") });
  }
}
