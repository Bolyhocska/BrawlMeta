// ─── GET /api/player?tag=%232C20JJRG ─────────────────────────────────────────
// Live player lookup for the Player Card on the Leaderboards tab. The browser
// can't call the Supercell API (key + IP allowlist), so this relays through
// the same authenticated proxy the scraper uses. Returns a trimmed profile —
// never the raw payload — so the response stays small and stable.
//
// Requires SUPERCELL_API_KEY (+ PROXY_HOST/PORT/USER/PASS) in Vercel env.

import { ProxyAgent } from "undici";
import { json } from "./_lib/db.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { error: "GET only" });
  try {
    const key = process.env.SUPERCELL_API_KEY;
    if (!key) return json(res, 501, { error: "not_configured", message: "SUPERCELL_API_KEY is not set on the server." });

    const raw = String(req.query?.tag || "");
    const tag = raw.toUpperCase().replace(/[^0-9A-Z]/g, "");
    if (tag.length < 3) return json(res, 400, { error: "bad_tag", message: "Enter a player tag like #2C20JJRG." });

    const { PROXY_HOST, PROXY_PORT, PROXY_USER, PROXY_PASS } = process.env;
    const dispatcher = PROXY_HOST
      ? new ProxyAgent(`http://${PROXY_USER}:${PROXY_PASS}@${PROXY_HOST}:${PROXY_PORT}`)
      : undefined;

    const r = await fetch(`https://api.brawlstars.com/v1/players/%23${tag}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      dispatcher,
    });
    if (r.status === 404) return json(res, 404, { error: "player_not_found", message: "No player with that tag — check it against your in-game profile." });
    if (!r.ok) return json(res, 502, { error: `upstream_${r.status}`, message: "The Brawl Stars API didn't answer — try again in a minute." });
    const p = await r.json();

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
    console.error("player lookup error:", e);
    return json(res, 500, { error: e.message });
  }
}
