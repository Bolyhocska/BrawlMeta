# Getting BrawlMeta into the Supercell Creator Program

**Date:** 2026-08-19 · **Why this matters:** Creator Program membership is the gate to *every*
compliant paid product (`MONETIZATION-STRATEGY.md` §1.3). Outside the Program you get ads,
donations and coaching. Inside it, Supercell has expressly permitted community sites to sell
premium services since October 2023. This is an application, not a legal argument.

---

## 0. The finding that changes the order of operations

`MONETIZATION-STRATEGY.md` §7 says: build a social presence to clear the follower bar, *then*
apply. **I now think that order is backwards, and it could cost months.**

Two separate things are documented, and their relationship is genuinely unclear:

1. **The general Creator Program entry bar** — 16+, and **100 YouTube subscribers OR 25 Twitch
   followers OR 1,000 TikTok followers**. This is written for *content creators* (video/stream
   channels) and is what every secondary source repeats.
   ([RoyaleAPI's summary](https://help.royaleapi.com/en/badges_creators.html), corroborated across
   two independent searches.)
2. **A fan-site developer track** — "If you are a fansite developer, are interested in exploring
   offering a premium service for your site, and would like to be a part of the Supercell Content
   Creator Program, **you can apply**."
   ([Supercell](https://supercell.com/en/news/next-step-community-sites/))

**Nothing I can reach states whether a fansite applicant must clear the follower thresholds.** The
invitation to fansite developers is worded without restating them, and the thresholds are framed
around channels a fan site does not have. It reads like a distinct path — but that is an inference,
not a fact, and `creators.supercell.com` is egress-blocked from this environment so I could not
open the registration form to check.

**Why this matters so much:** if the fansite track waives the follower bar, then 1,000 TikTok
followers is months of work you may not need. If it doesn't, you need to know *now* so you can
start. Either way, **the cheapest possible action is to find out first** — and you can do that in
an afternoon.

---

## Phase A — Resolve the ambiguity (this week, ~2 hours, do this first)

| # | Action | Notes |
|---|---|---|
| A1 | **Confirm you are 16+** | Hard gate on the general track, no way around it. If you are under 16 this whole plan stalls until you aren't, and the honest move is to plan around ads + coaching in the meantime (both need no Program membership). |
| A2 | **Make sure you have a Supercell ID (SCID)** on the account you want associated | Registration is SCID-based. |
| A3 | ~~Open the registration form and read what it asks~~ **PARTLY RESOLVED 2026-08-24 — see "Phase A findings" below.** The form URL in this plan was wrong, the public requirements are confirmed, and no fansite track is visible from outside. What remains yours: stepping through the signup wizard itself (age gate + reCAPTCHA + Supercell ID). |
| A4 | **If the form is channel-only or ambiguous, ask before you apply** | An enquiry costs nothing; a rejected application may carry a cooldown. Draft below (§A5). |

### A5 — Enquiry to send if the form doesn't make the fansite path obvious

> **Subject:** Fansite developer — Creator Program eligibility question
>
> Hi,
>
> I develop and run BrawlMeta (https://brawl-meta.vercel.app), a free Brawl Stars statistics and
> automated-tournament site. It publishes ranked meta analysis built from a database of over a
> million ranked matches, a draft assistant, per-map brawler guides, and free-to-enter automated
> tournament brackets.
>
> Following your October 2023 announcement about community sites, I would like to apply to the
> Content Creator Program as a fansite developer, with a view to understanding the policy for
> premium services on community sites.
>
> My question: the published Creator Program requirements refer to YouTube, Twitch and TikTok
> follower thresholds. I run a website rather than a video channel. **Could you tell me whether
> fansite developers apply through the same registration form, and whether those follower
> thresholds apply to a site-based application?** I want to apply correctly rather than submit
> something that doesn't fit the process.
>
> Thank you,
> [name] — [contact email]

**Where to send it:** [supercell.com/en/support/](https://supercell.com/en/support/) is named in the
Fan Content Policy as the route for policy questions. For tournament-specific matters there is also
`tournaments@supercell.com`. Use support for this one — it's a Program question, not a tournament one.

---

### Phase A findings (checked directly, 2026-08-24)

Read live from `creators.supercell.com`, which turned out to be reachable after all:

- **The registration URL in this plan was wrong.** `/en/register` returns PAGE NOT FOUND. The real
  entry point is **[creators.supercell.com/en/signup](https://creators.supercell.com/en/signup)**,
  linked from the site as "Go to application".
- **The published requirements are confirmed verbatim:** act in good manner; **at least 16 years
  old**; **minimum 100 followers on YouTube, 25 on Twitch, or 1,000 on TikTok**. The page also
  states plainly that meeting them is "not a guarantee for getting accepted".
- **A second, higher tier exists that this plan did not know about:** "Trusted Creators" at
  **5,000 YouTube / 3,000 Twitch / 15,000 TikTok**, which unlocks the Creators Discord and update
  previews. Super Creator status above that is handpicked. Useful context — the follower bar in
  Phase D is the *entry* bar, not the bar for the visible perks.
- **No fansite or website track is visible anywhere on the public site.** The eligibility list is
  channel-only; there is no "I run a website" option advertised, and no field for a site URL on any
  public page. This does not disprove the fansite path — Supercell's October 2023 announcement does
  invite fansite developers to apply — but it does mean **you cannot confirm it from outside**, and
  the signup wizard is gated behind an age step and reCAPTCHA before it reveals what it asks.

**What this changes:** the enquiry in §A5 is now clearly the right first move rather than a
fallback. Applying blind through a channel-shaped form, as a site with no channel, is the scenario
most likely to produce a rejection — and §A4's caution about cooldowns still stands. Send the
enquiry, and update the URL in it to `/en/signup`.

---

## Phase B — Make the site application-ready (~1 day, do before applying either way)

A reviewer will open the site. Right now there are two **policy-required** gaps that would make an
application look careless, and both are quick.

| # | Task | Why | Effort |
|---|---|---|---|
| B1 | ~~Fan content disclaimer in the footer of every page~~ **DONE 2026-08-24 (commit 05ad8a0).** | **This plan's claim that the disclaimer was "currently missing" was wrong** — `SiteFooter.jsx` already had the exact required wording and linked the policy. The real gap was coverage: the footer was mounted only on tournament pages, with the homepage carrying a separate copy, so the tier list, leaderboards, draft assistant, brawler guides, scrims and guides all rendered without it. Now mounted once in `AppRoutes` outside `<Routes>`, so no route can ship without it. | done |
| B2 | ~~Privacy policy + cookie policy~~ **DONE 2026-08-24 — `/privacy`.** | Written from the code, not from a template: fields taken from the real `Profiles`/`Registrations` columns, uploads from the three storage buckets, OCR from `api/_lib/ocr.js`. Two findings are stated plainly on the page — uploaded proof is served at PUBLIC urls, and there is no analytics or tracking script anywhere, so it claims essential-cookies-only honestly. **Blocked on you:** `CONTROLLER` is a placeholder; the policy is not valid until it names a real contactable person. | done |
| B3 | ~~An About page~~ **DONE 2026-08-24 — `/about`.** | Covers what the site is, where the data comes from, and the three principles that make it low-risk to approve. **Blocked on you:** same `CONTROLLER` placeholder — an About page that won't say who runs it defeats its own purpose. | done |
| B4 | **Do not register any domain containing "brawlstars"**, and use no Supercell logos in branding | Trademark clause. Current posture ("brawl" alone on a `vercel.app` subdomain) is what every incumbent does — tolerated, not permitted. Don't make it worse right before applying. | — |
| B5 | ~~Have your numbers ready~~ **PULLED 2026-08-24 — see "Your actual numbers" below.** | The database is the strong number; the audience is not, and the application should lead with the former. | done |

**A note on B1:** it's tempting to treat the disclaimer as trivial. It isn't — it's the single
cheapest compliance signal you can send, it's explicitly required, and its absence is the first
thing a reviewer checking policy adherence would notice.

---

### Your actual numbers (measured 2026-08-24)

| Metric | Value |
|---|---|
| Ranked matches analysed | **1,807,280** |
| — Masters/Legendary bracket | 1,500,000 (at the retention cap) |
| — Diamond/Mythic bracket | 307,280 |
| Brawlers covered | 105 |
| Ranked maps covered | 29 |
| Database size | 281 MB |
| Tournaments run | 6 (2 completed) |
| Tournament registrations | 21 |
| Registered accounts | 2 |
| Data freshness | continuous; newest match 2026-08-23 19:38 UTC |

**Read this honestly before writing the application.** The database is genuinely impressive and
completely true: *"over 1.8 million ranked matches analysed, separated by rank bracket, refreshed
four times a day"* is a strong, specific, verifiable line that most applicants cannot write.

The audience numbers are not impressive yet, and the application should not invite the comparison.
Two registered accounts is a pre-launch site. **Lead with what you built and the data behind it,
not with reach** — and note this cuts against any framing that leans on community size. If the form
asks for traffic, answer plainly; do not volunteer it otherwise.

There is also no analytics on the site, so **pageview/unique figures do not exist**. If the
application asks for them, you will need to either install analytics first (which then requires the
cookie policy to change — see `/privacy`) or answer that the site does not track visitors, which is
itself a defensible and increasingly respected answer.

---

## Phase C — Apply

Use the application body already drafted in `MONETIZATION-STRATEGY.md` §4.3. The framing that
matters, and why it's the right one:

- **Lead with the site, not the money.** You're a fansite developer who built something real, and
  you want to understand the premium-services policy. That is literally the invitation Supercell
  published.
- **State the principles that make you low-risk to approve:** players never pay to compete, no game
  statistic is ever paywalled, tournaments are free to enter. You are asking to cover infrastructure
  costs, not to monetize players. That is an unusually easy thing for them to say yes to.
- **Do not ask about organizer fees in the application.** That's a separate, harder question and it
  is not covered by the October 2023 change. Raise it later, once you're a member with usage
  evidence — the sequencing in `MONETIZATION-STRATEGY.md` §4.2 is right about this.

---

## Phase D — The follower bar (start only if Phase A says you need it)

If the thresholds do apply, **TikTok's 1,000 followers is the cheapest of the three** — but be
honest that it's still the longest pole in this plan, likely 2–4 months of consistent posting.

**Your unfair advantage: the site already generates the content.** You are sitting on a 1.5M-match
ranked database and a draft engine, which means you can make data-backed claims nobody else in the
community can make. That is genuinely differentiated short-form content, not generic gameplay:

- **"This brawler got shadow-nerfed and nobody noticed"** — you already compute recency deltas and
  Trending chips against the patch aggregate. That's a post with a number in it.
- **Patch-day meta shifts** — real win-rate movement per map, published within hours of a balance
  change, straight off `brawler_intelligence`.
- **Draft verdicts** — run a pro match's draft through `computeWinSplit` and show the 61/39 call
  against what actually happened.
- **Per-map counter picks** — "the three brawlers that beat X on this map", from `vs_brawler`.
- **Tournament highlights** from your own brackets.

Cadence: 3–5 short posts a week, each one number-led. Point every caption at the site — the channel
is a means to the Program and to traffic, not a product.

**Two cautions.** First, the follower bar is a *floor*, not a guarantee — acceptance is discretionary.
Second, do not buy followers: it's detectable, it would be a bad-faith entry into a program whose
whole basis is trust, and getting caught would cost you the API key, not just the application.

---

## Phase E — After acceptance

1. **Read the premium-services policy.** Supercell states it is "visible to website developers in
   Supercell's Creator Program" — i.e. **you cannot read the rules until you're a member.** That is
   itself an argument for applying early, before you've built anything commercial.
2. **Launch only what that policy already blesses.** The cleanest candidate is an **ad-free tier**:
   it paywalls no data at all — everything stays free, you're only selling the absence of ads — so
   it sits comfortably inside both Supercell's rules and your own "players never pay" principle.
   Brawlify sells exactly this at $4.99/mo.
3. **Then, and only then, raise the organizer-fee question** with usage evidence, via your Program
   contact. RoyaleAPI's precedent is instructive: they raised a fan-site monetization problem in
   June 2023 and the policy changed that October. A well-argued question from a real community site
   does get answered — but it came from a member, not a stranger.

---

## The critical path, in order

```
A1 confirm 16+        ─┐
A3 read the form       ├─ this week, ~2h   ← the only step that unblocks the rest
A4/A5 ask if unclear  ─┘
        │
        ▼
B1 disclaimer + B2 privacy + B3 about  ─ ~1 day, do regardless
        │
        ▼
C  apply (body already written)
        │
        ├── accepted ──► E: read policy → ad-free tier → raise organizer question
        │
        └── follower bar required ──► D: TikTok, 2-4 months, then re-apply
```

**Total effort to be application-ready: about one and a half days**, plus whatever Phase D turns out
to require. The single highest-value thing you can do is **A3 — open the registration form and look**,
because it's the difference between applying next week and applying in four months.

---

## Confidence

- **Verified:** the fansite-developer invitation and the October 2023 premium-services change
  ([Supercell](https://supercell.com/en/news/next-step-community-sites/)); the registration URL;
  the general 16+ / 100 YT / 25 Twitch / 1,000 TikTok thresholds (consistent across independent
  searches).
- **Not verified — and the crux of this plan:** whether those thresholds bind a fansite applicant.
  `creators.supercell.com` and `supercell.com` are egress-blocked here, so the policy pages were
  read through search-index metadata only; no archive, cache or proxy bypass was used. **Phase A3
  exists precisely because you can check this and I cannot.**
