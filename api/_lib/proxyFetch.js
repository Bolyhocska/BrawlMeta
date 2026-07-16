// ─── Proxy-aware fetch for Supercell calls ───────────────────────────────────
// Supercell API keys are locked to a single allowlisted IP. Vercel functions
// don't have a static IP, so outbound Supercell requests are routed through
// the same Webshare static-IP proxy the scrapers package already uses (PROXY_HOST/
// PORT/USER/PASS) — reuse that key's existing allowlist entry instead of
// managing a second one. Falls back to a direct call if no proxy is
// configured (useful for local dev against a key allowlisted to "any IP").

import { ProxyAgent, fetch as undiciFetch } from "undici";

const PROXY_HOST = process.env.PROXY_HOST;
const PROXY_PORT = process.env.PROXY_PORT;
const PROXY_USER = process.env.PROXY_USER;
const PROXY_PASS = process.env.PROXY_PASS;

const proxyAgent = PROXY_HOST && PROXY_PORT
  ? new ProxyAgent(`http://${encodeURIComponent(PROXY_USER)}:${encodeURIComponent(PROXY_PASS)}@${PROXY_HOST}:${PROXY_PORT}`)
  : null;

export async function supercellFetch(url, options = {}) {
  if (!proxyAgent) return fetch(url, options); // local dev fallback, no proxy env set
  return undiciFetch(url, { ...options, dispatcher: proxyAgent });
}
