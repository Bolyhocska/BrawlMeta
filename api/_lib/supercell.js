// ─── The one place that knows how to call the Supercell API ──────────────────
// Supercell API keys are locked to a single allowlisted IP and Vercel functions
// have no static outbound IP, so every call is routed through the same Webshare
// static-IP proxy the scrapers package uses (PROXY_HOST/PORT/USER/PASS) —
// reusing that key's existing allowlist entry rather than managing a second one.
//
// TWO UNDICI GOTCHAS LIVE HERE AND NOWHERE ELSE. Both were found the hard way,
// and the point of this module is that they only have to be got right once:
//
//   1. Drive the ProxyAgent with undici's OWN fetch, not Node's global fetch.
//      A ProxyAgent from the standalone undici package must be paired with the
//      matching undici fetch; the global fetch's bundled undici rejects a
//      foreign dispatcher with UND_ERR_INVALID_ARG.
//   2. Pass proxy credentials as an explicit `token`, NOT as URI userinfo.
//      undici's ProxyAgent silently ignores credentials embedded in the proxy
//      URL, so `http://user:pass@host:port` authenticates as nobody and the
//      proxy answers 407.
//
// This module exists because those two rules were previously known in only one
// of the two places that called Supercell. api/player.js had them right (fixed
// in 7e1f75d and e4c8ba1); api/_lib/proxyFetch.js, used by api/verify-match.js,
// still embedded credentials in the URI and would have failed against an
// authenticated proxy. That path had never been exercised in production — the
// Verifications table is empty — so it was latent rather than broken, but it
// was one tournament away from being real. proxyFetch.js is replaced by this.

import { fetch as undiciFetch, ProxyAgent } from "undici";

export const API_BASE = process.env.SUPERCELL_API_BASE || "https://api.brawlstars.com/v1";

// Built once per lambda instance and reused across invocations on a warm
// container — constructing a ProxyAgent per request leaks sockets.
let cachedDispatcher;
let dispatcherBuilt = false;

function getDispatcher() {
  if (dispatcherBuilt) return cachedDispatcher;
  dispatcherBuilt = true;
  const { PROXY_HOST, PROXY_PORT, PROXY_USER, PROXY_PASS } = process.env;
  if (!PROXY_HOST || !PROXY_PORT) {
    // No proxy configured: local dev against a key allowlisted to "any IP".
    cachedDispatcher = undefined;
    return cachedDispatcher;
  }
  const opts = { uri: `http://${PROXY_HOST}:${PROXY_PORT}` };
  if (PROXY_USER) {
    // Gotcha 2 — explicit token, never URI userinfo.
    opts.token = `Basic ${Buffer.from(`${PROXY_USER}:${PROXY_PASS}`).toString("base64")}`;
  }
  cachedDispatcher = new ProxyAgent(opts);
  return cachedDispatcher;
}

export function isConfigured() {
  return Boolean(process.env.SUPERCELL_API_KEY);
}

/**
 * Raw call against the Supercell API.
 * @param {string} path  path below /v1, e.g. `/players/%23ABC/battlelog`
 * @returns {Promise<Response>} the undici response, unread
 */
export async function supercellFetch(path, options = {}) {
  const key = process.env.SUPERCELL_API_KEY;
  if (!key) throw new Error("SUPERCELL_API_KEY is not set on the server.");

  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const init = {
    ...options,
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      ...(options.headers || {}),
    },
    signal: options.signal ?? AbortSignal.timeout(15000),
  };

  const dispatcher = getDispatcher();
  // Gotcha 1 — undici's own fetch whenever a dispatcher is involved.
  return dispatcher ? undiciFetch(url, { ...init, dispatcher }) : fetch(url, init);
}

/**
 * Call and parse, turning upstream failures into a consistent shape so every
 * route reports them the same way instead of inventing its own vocabulary.
 * @returns {Promise<{ok: true, data: any} | {ok: false, status: number, error: string, message: string}>}
 */
export async function supercellJson(path, options = {}) {
  let r;
  try {
    r = await supercellFetch(path, options);
  } catch (e) {
    // "fetch failed" on its own hides the real cause (proxy refused, DNS, TLS,
    // timeout), and that is exactly what makes these calls hard to debug.
    const cause = e?.cause?.code || e?.cause?.message || String(e?.cause || "");
    return { ok: false, status: 500, error: "request_failed", message: e.message, cause };
  }
  if (r.status === 404) {
    return { ok: false, status: 404, error: "player_not_found",
             message: "No player with that tag — check it against your in-game profile." };
  }
  if (r.status === 429) {
    return { ok: false, status: 429, error: "rate_limited",
             message: "The Brawl Stars API is rate-limiting us — try again shortly." };
  }
  if (!r.ok) {
    return { ok: false, status: 502, error: `upstream_${r.status}`,
             message: "The Brawl Stars API didn't answer — try again in a minute." };
  }
  return { ok: true, data: await r.json() };
}

// ── Typed helpers. Routes should prefer these over hand-built paths. ─────────

/** Tag in, URL-safe `%23TAG` out. Accepts "#ABC", "abc", "%23ABC". */
export function tagPath(tag) {
  const clean = String(tag || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  return `%23${clean}`;
}

export const getPlayer = (tag, options) => supercellJson(`/players/${tagPath(tag)}`, options);
export const getBattlelog = (tag, options) => supercellJson(`/players/${tagPath(tag)}/battlelog`, options);
