# W1 — Brawlify.com Feature Inventory & Critical Evaluation

STATUS: in progress
Researcher: Claude (agent W1)
Date started: 2026-08-19
Purpose: exhaustive competitive inventory of brawlify.com to feed an implementation plan for brawl-meta.vercel.app

Every claim is marked **VERIFIED** (fetched the page and observed it) or **INFERRED** (deduced, not directly observed).
Where a page is JS-gated or failed to load, that is stated explicitly rather than guessed.

---
## 0. RESEARCH CONSTRAINT — brawlify.com is BLOCKED from this session (read this first)

**VERIFIED (blocking):** Every attempt to fetch brawlify.com or api.brawlify.com from this
session is refused by the organization's egress gateway, not by brawlify:

- `WebFetch https://brawlify.com/` → `EGRESS_BLOCKED: Access to brawlify.com is blocked by the network egress proxy.`
- `WebFetch https://api.brawlify.com/v1/brawlers` → same error.
- `curl https://brawlify.com/` → `curl: (56) CONNECT tunnel failed, response 403` (gateway policy denial).
- `curl https://api.brawlify.com/v1/brawlers` → same 403.

Host probe of every other candidate source (VERIFIED, one curl each):

| Host | Result |
|---|---|
| github.com | reachable |
| raw.githubusercontent.com | reachable |
| brawlapi.com | BLOCKED (000 / CONNECT refused) |
| docs.brawlapi.com | BLOCKED |
| www.npmjs.com | 403 |
| play.google.com | BLOCKED |
| apps.apple.com | BLOCKED |
| api.brawlstars.com | BLOCKED |
| brawltime.ninja | BLOCKED |
| www.brawlify.com | BLOCKED |

The agent-proxy README (`/root/.ccr/README.md`) states explicitly that a 403 from the gateway is
an organization policy denial and must be **reported, not routed around**. I therefore did **not**
use web.archive.org, Google cache, text-extraction proxies, or any other mirror of the blocked host.

### What this means for the confidence level of this document

Everything below is assembled from two sources that ARE permitted:

1. **WebSearch** — returns the search index's own titles, meta descriptions and extracted
   summaries of brawlify pages. This is second-hand: it reflects brawlify's own marketing copy
   and page metadata, not the rendered DOM.
2. **GitHub** — public API-wrapper libraries, bots and scrapers that call the Brawlify API.
   These are *primary evidence for the API surface* (endpoint paths, response field names,
   rate-limit handling) because they are working code written against the live service.

So the marking convention in this document is:

- **VERIFIED (code)** — I read source code on GitHub that calls this exact endpoint / field.
- **VERIFIED (search-meta)** — the search index returned brawlify's own page title/description
  asserting this. Trustworthy for *what features exist*, untrustworthy for *how good they are*.
- **INFERRED** — my deduction. Includes essentially ALL of the UI/UX, layout, latency, mobile,
  and ad critique, because I could not render a single brawlify page.

**Action required from the parent agent / owner:** if the implementation plan is going to make
build-vs-skip calls on UI quality, someone with an unblocked browser must do a visual pass. Ask
an admin to allowlist `brawlify.com` and `api.brawlify.com`, or have the owner screenshot the
pages listed in section 12 ("What still needs human eyes"). Do not treat the UI critique in this
document as observed fact.

---
