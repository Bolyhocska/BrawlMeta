// ─── Per-route title, description and canonical ──────────────────────────────
// This is a client-rendered SPA, so every URL is served the same index.html.
// Until 2026-10-09 that meant all ~165 pages shared one <title> and had no
// description at all — to a crawler the site looked like a single page.
//
// WHAT THIS FIXES AND WHAT IT DOES NOT. Google executes JavaScript, so a title
// and description set here are indexed (with a delay, on a second rendering
// pass). Social crawlers — Discord, Slack, Twitter, Facebook — do NOT execute
// JavaScript: they read the raw HTML and leave. So the og: tags in index.html
// are what every shared link shows, no matter which page was shared, and
// nothing this hook does can change that. Making share cards per-route needs
// prerendering or an edge function that injects tags for bot user-agents; it
// is a separate job, deliberately not faked here.
//
// No react-helmet. One hook touching four tags does not justify a dependency,
// and Helmet's async rendering is a known source of wrong-title-on-back-button
// in React 19.

import { useEffect } from "react";

const SITE = "BrawlApex";
const ORIGIN = "https://brawl-meta.vercel.app";

/** Set (or create) a <meta> by name or property. */
function setMeta(attr, key, content) {
  if (!content) return;
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function setCanonical(href) {
  let el = document.head.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

/**
 * @param title        page title WITHOUT the site suffix; omit for the default
 * @param description  ~150-160 chars, written for a human in a result list
 * @param noindex      keep this page out of search entirely
 * @param canonicalPath  override when several URLs render the same content
 *
 * Pass `undefined` for a value that is still loading rather than a placeholder
 * — the hook skips undefined, so the previous title stays until real data
 * arrives instead of flashing "Loading…" into someone's history and tab bar.
 */
export function useSeo({ title, description, noindex = false, canonicalPath } = {}) {
  useEffect(() => {
    const full = title ? `${title} — ${SITE}` : `${SITE} — Ranked Draft Intelligence`;
    document.title = full;

    if (description) {
      setMeta("name", "description", description);
      setMeta("property", "og:description", description);
    }
    setMeta("property", "og:title", full);

    const path = canonicalPath ?? (window.location.pathname + window.location.search);
    const href = ORIGIN + path;
    setCanonical(href);
    setMeta("property", "og:url", href);

    // robots is REMOVED rather than set to "index" when a page is indexable:
    // navigating from a noindex page to an indexable one must not leave the
    // tag behind, and absence is the correct default.
    const existing = document.head.querySelector('meta[name="robots"]');
    if (noindex) {
      setMeta("name", "robots", "noindex, nofollow");
    } else if (existing) {
      existing.remove();
    }
  }, [title, description, noindex, canonicalPath]);
}
