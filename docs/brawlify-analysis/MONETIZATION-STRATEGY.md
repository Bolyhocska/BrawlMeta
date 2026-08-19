# BrawlMeta — Monetization Strategy under Supercell's Fan Content Policy

STATUS: in progress
Research date: 2026-08-19
Author: analysis pass (Claude), building on `research/W2-stat-tracking-landscape.md` PART 3

Legend: **[V]** = VERIFIED (read from a page fetched this session, or from repo source) · **[I]** = INFERRED (reasoned, not directly stated) · **[BLOCKED]** = source refused by this environment's egress gateway; claim reconstructed from search-index metadata or third-party corroboration.

> **This is not legal advice.** It is a commercial/risk analysis of published policy text. Before any real-money flow (prize payouts, invoicing organizers), get an actual lawyer and an actual business entity.

---

## 0. The one-paragraph answer

Supercell's Fan Content Policy permits exactly three ways to make money from fan content — **ads, donations, coaching** — and forbids "a fee of any kind … from customers or visitors" otherwise. BrawlMeta's currently-stated model (premium subscriptions + organizer fees) is **outside all three**. The honest reading is that today's plan of record is non-compliant as written, tolerated-in-practice at best, and un-financeable at worst — you cannot build a business on a revenue line a third party can switch off with an email. The strategy below therefore: (a) turns on the sanctioned lines now (ads + donations), (b) restructures the organizer product into a **coaching/services** shape that sits inside a named exception, (c) sends a written approval request for the paid organizer tier, and (d) builds the one revenue line Supercell's policy has no jurisdiction over at all — **non-game-derived B2B services and sponsorship** — as the long-term floor.

---

## 1. The policy foundation — and one finding that changes the previous verdict

### 1.1 What W2 §3.1 established (carried forward, not re-derived)

- **The fee prohibition.** "You are **not permitted to charge a fee of any kind** (including in-app functionalities) from customers or visitors to your Fan Content, unless this has expressly been approved by Supercell." Three exceptions: **ads, donations, coaching**. **[V]** https://supercell.com/en/fan-content-policy/ **[BLOCKED]** — supercell.com is refused by this environment's egress gateway (`EGRESS_BLOCKED`), so the wording is taken from the search index of that exact URL, consistent across two independent retrievals this session and with the Zendesk mirror https://z3n6487.zendesk.com/hc/en-us/articles/360007467518-Fan-content-Policy (also blocked).
- **Donations must be "purely donations in nature and not tied to any special features, IAPs or other benefits of any kind."** **[V]** same source.
- **Ads** "must comply with all applicable laws, rules, regulations and developer policies." **[V]** same source.
- **Tournament Guidelines**: free to enter for players, no exceptions including membership fees or season passes; organizer provides all prizes; no gambling/paid raffles/fantasy betting; no crypto/blockchain promotion. **[V]** https://supercell.com/en/tournament-guidelines/

### 1.2 NEW FINDING — coaching is defined much more broadly than we assumed

The policy defines the coaching exception explicitly:

> "By coaching we mean **training and guidance provided to other players**. This could be for example **selling base layouts, personal coaching, online coaching or similar activities**."

**[V]** https://supercell.com/en/fan-content-policy/ (via search index; domain **[BLOCKED]**)

This matters enormously and W2 did not have it. "Selling base layouts" is Supercell explicitly blessing the sale of a **static, productised, non-live artefact of game knowledge** — not a human sitting with you for an hour. It is the Clash-of-Clans equivalent of selling a draft sheet, a map guide, or a prepared comp package. The exception is therefore **not** limited to 1:1 human services; it covers **paid guidance products**. That is a much wider door than "we could run a coaching marketplace."

### 1.3 THE BIG ONE — Supercell expressly approved premium services for Creator-Program fan sites in October 2023

> Starting in **October 2023**, Supercell allows fan sites **within their Creator Program** to offer **premium services** on their site, which may include **better match data, improved record keeping, analysis, pro tips, coaching services, and more**. Previously fan sites were disallowed from offering paid premium services. **Any premium services offered by websites that are part of the Creator Program have received Supercell's approval**, subject to strict policies those sites must follow.

**[V]** https://supercell.com/en/news/next-step-community-sites/ — the article's existence and title are confirmed in the search index across two independent queries; the page body itself is **[BLOCKED]** here. The substance is corroborated independently by RoyaleAPI, who state the change followed **their** raising the issue with Supercell in **June 2023**, and who note that before it, "per the Supercell fan content policy, third-party sites were not allowed to derive revenue other than display ads." **[V]** https://royaleapi.com/blog/sunset-api (domain **[BLOCKED]**; content via search index) and https://seeminglee.com/blog/royaleapi/ (**[BLOCKED]**).

**This overturns the framing in W2 §3.3 and IMPLEMENTATION-PLAN §0.3.** The correct statement is no longer "a premium subscription is outside all three exceptions and therefore non-compliant." It is:

> **A premium subscription on a fan site is expressly permitted — conditional on being in Supercell's Creator Program.** The Fan Content Policy's generic prohibition is the *default* rule; the Creator Program is the *documented mechanism* by which the "unless expressly approved" clause is exercised for community sites, and it has been exercised, at category level, since October 2023.

The compliance question therefore changes from **"is a paid tier allowed?"** (answer: yes, for Creator-Program sites) to **"is BrawlMeta in the Creator Program?"** (answer today: **no**, and that is now the single highest-leverage item in this entire document).

### 1.4 What is still NOT covered by the October 2023 change

Read the enumerated list precisely: "better match data, improved record keeping, analysis, pro tips, coaching services". Every item is a **player-facing information service**. Nothing in it says:
- that **tournament organizer fees** are approved — a fee for *running an event on our infrastructure* is a different product from a data subscription; **[I]**
- that **entry fees** are approved — the Tournament Guidelines independently and absolutely forbid them ("no exceptions"); **[V]**
- that a site **outside** the Creator Program may do any of it. **[V]** the approval is scoped to "websites that are part of their Creator Program".

And note the sting in the tail for BrawlMeta specifically: the approved list is **exactly the product we said we would never charge for** (core principle 1, "players NEVER pay"), while the product we *did* plan to charge for (organizer subscriptions) is **not** in the approved list. **We have the compliance situation precisely inverted.** That is the central strategic finding of this document and §4 is built on it.

---

## 2. How comparable sites actually monetize — permitted vs merely tolerated

**Environment note:** `brawlify.com`, `royaleapi.com`, `seeminglee.com`, `supercell.com`, `creators.supercell.com`, `z3n6487.zendesk.com`, `help.royaleapi.com` and `brawltime.ninja` are all **[BLOCKED]** by this environment's egress gateway (403 / EGRESS_BLOCKED). No archive, cache or text-proxy workaround was used. Everything below marked **[BLOCKED]** was reconstructed from search-index metadata of the exact canonical URL, and cross-checked against at least one independent source wherever the claim is load-bearing.

### 2.1 The table

| Site | Revenue lines | Permitted, or merely tolerated? |
|---|---|---|
| **Brawlify** (brawlify.com) | Display ads; **Brawlify Premium $4.99/mo *per player tag*** — ad-free browsing, automatic profile updates (no manual "boost"), complete saved battle history, club tracking; **Supercell Creator Code "Brawlify"**; mobile app (MWM-published). **[V]** https://brawlify.com/about/premium (**[BLOCKED]**, via search index), https://brawlify.com/about | **Permitted — almost certainly expressly.** The feature list ("automatic tracking", "complete battle history") maps one-for-one onto Supercell's own enumerated approvals ("better match data, improved record keeping"). Brawlify holds a Creator Code, i.e. it is in the Creator Program, which is the exact condition attached to the Oct-2023 premium-services approval. **[I]** on "expressly", but a strong inference. |
| **RoyaleAPI** (royaleapi.com, Clash Royale) | Display ads; **Patreon** (from $1/mo; **$30/mo tier removes ads forever**, or **$100 lifetime PayPal donation** removes ads); Creator Code "RoyaleAPI". Shut down its free developer API citing cost. **[V]** https://www.patreon.com/RoyaleAPI, https://royaleapi.com/code, https://royaleapi.com/blog/sunset-api (**[BLOCKED]**, via index) | **Permitted, and they are the reason the rule changed.** RoyaleAPI raised the fan-site monetization problem with Supercell in **June 2023**; the community-sites policy changed in **October 2023**. Note their ad-free-for-donors mechanic would, on a literal reading of the donations clause ("not tied to any … benefits of any kind"), be non-compliant — it is compliant *because* they are inside the Creator Program, not because donations allow it. **This is the single clearest illustration of why Program membership, not clever structuring, is the thing that matters.** |
| **Brawl Ace** (brawlace.com) | **Interest-based display ads** ("won't sell or share personal information to inform the ads you see"); a **subscription unlocking premium features, tied to a specific player profile** — i.e. the same per-tag model as Brawlify. Cloudflare-gated. **[V]** brawlace.com pages via search index | **Grey → probably permitted.** Same product shape as Brawlify. Whether they are Creator-Program members was not verifiable this session — **[I]**. If they are not, they are *tolerated*, not permitted. |
| **Brawl Time Ninja** (brawltime.ninja) | **Display ads via Venatus Media** (a gaming/esports-specialist ad network). No paid tier found. **[V]** https://brawltime.ninja/about (**[BLOCKED]**, via index) | **Permitted outright.** Ads are a named exception; no Program membership needed. This is the zero-risk baseline every fan site can operate. |
| **Brawlytix / BrawlCards / Brawl Tracker / brawltrack.app / starr-drop-style SEO sites** | Display ads, SEO/affiliate-adjacent monetization. No paid tiers observed. **[I]** — none of these publishes a monetization page; absence of a paywall is observed, not stated. | **Permitted** to the extent it is ads only. |
| **Dotabuff Plus** (Valve) — *pattern reference only, NOT precedent* | **$5.99/mo or $56.99/yr**: Hero Mastery Tool, advanced match analysis, personal improvement tools, ad-free. **[V]** https://www.dotabuff.com/plus | Different publisher, different rules. Valve's policies are permissive about third-party paid analytics in a way Supercell's are not. **Do not cite Dotabuff to justify anything to Supercell.** Useful only as evidence that *coaching-flavoured* analytics converts to paid where allowed. |
| **op.gg Premium** (Riot) — *pattern reference only* | Ad-free + personalised match-history dashboard + upgraded favourites. **[V]** https://opgg.helpscoutdocs.com/article/400 | Same caveat. The transferable lesson is the **packaging**: "ad-free + convenience + depth", never "the stat itself is paywalled". |

### 2.2 The distinction that matters, stated plainly

Three genuinely different statuses exist in this market, and conflating them is how a fan site gets a takedown:

1. **Permitted by the policy text itself** — display ads, unconditional donations, coaching. Available to anyone, no relationship required. *(Brawl Time Ninja lives entirely here.)*
2. **Permitted by express approval via the Creator Program** — paid premium services on a fan site. Available only to Program members, governed by a **policy document that is not public** ("visible to website developers in Supercell's Creator Program"). **[V]** https://supercell.com/en/news/next-step-community-sites/ (**[BLOCKED]**, via index). *(Brawlify and RoyaleAPI live here.)*
3. **Merely tolerated** — trademark-adjacent domain names ("brawl" in the domain), scraping of competitor sites, hotlinking `cdn.brawlify.com`, and any paid tier run by a non-Program site. Nothing endorses these; they persist because nobody has complained. **Tolerance is not a licence and it is not an asset — it cannot be sold, financed, or relied on in a plan.**

**BrawlMeta today is entirely in bucket 1 + bucket 3.** Every paid feature currently planned sits in bucket 3. The entire strategic move available to us is to get from bucket 3 into bucket 2, which is an application, not a legal argument.

---

## 3. Verdict on every candidate revenue line

Risk key: **COMPLIANT** = permitted by the policy text as written, no relationship required · **GREY** = not prohibited but not enumerated; survives only on tolerance or on an argument Supercell has never confirmed · **NON-COMPLIANT** = contradicts a clause as written; needs express approval to exist · **DEAD** = prohibited outright, do not build.

### 3.1 Display advertising — **COMPLIANT**
- **Mechanism:** programmatic display via a managed ad partner (see §5 for network selection). Header-bidding managed inventory, not raw AdSense, once traffic supports it.
- **Deciding clause:** "monetization of your Fan Content through **ads**" is exception #1; the only rider is that ads "must comply with all applicable laws, rules, regulations and developer policies." **[V]**
- **Realistic revenue:** entirely traffic-bound. See §5.3 for the model. At small scale this is a hosting-cost offset, not an income.
- **What makes it safe:** it already is. The residual risk is *legal*, not Supercell-policy: GDPR consent and child-audience rules (§5.4–5.5). Those are the real constraint on this line, and they are severe for this specific audience.
- **Verdict: turn this on first.** It is the only line that requires no permission from anybody.

### 3.2 Direct sponsorship / brand deals — **COMPLIANT** (with a category blacklist)
- **Mechanism:** sell inventory directly rather than programmatically — a tournament series title sponsor, a newsletter sponsor slot, a "presented by" on the draft assistant. Buyers: gaming-peripheral brands, esports orgs, creator merch lines, mobile-gaming tools, energy/snack brands with youth-marketing budgets.
- **Deciding clause:** a sponsorship *is* an ad; it falls inside exception #1. The fee comes from an advertiser, not from a visitor. **[I]** — the policy does not use the word "sponsorship", but a paid placement is an ad on any reading.
- **Hard limits from the Tournament Guidelines** (these bind any sponsored event): cannot promote other game companies/publishers/platforms, alcohol, tobacco, drugs, pornography, weapons, **cryptocurrency, blockchain**, betting or gambling. **[V]** https://supercell.com/en/tournament-guidelines/ Add your own blacklist for the two categories that will actually approach you: **gem-selling / account-selling / boosting services** (they violate Supercell's game ToS and associating with them is the fastest route to a takedown) and **skin-gambling / case sites**.
- **Realistic revenue:** direct deals are worth **5–20× programmatic RPM** on the same inventory, but they require a salesperson and an audience story. Realistically not addressable until there is a repeating tournament series with a known participant count and a Discord to point at. **Assumption:** a small recurring series sponsorship in mobile esports sits in the **$200–2,000 per event** range; this is an industry-shape estimate, not a quoted figure — treat as **ASSUMPTION**.
- **What makes it safe:** written category blacklist, no implication of Supercell endorsement, the required disclaimer on every page.

### 3.3 Donations (Ko-fi / Patreon / GitHub Sponsors / Buy-Me-a-Coffee) — **COMPLIANT, but crippled by the no-benefits clause**
- **Deciding clause:** donations "must be purely donations in nature and **not tied to any special features, IAPs or other benefits of any kind**." **[V]**
- **This kills every mechanic that makes donations actually work.** No supporter badge, no Discord role, no ad-free, no early access, no name in the credits — "benefits of any kind" is not ambiguous. What remains is a naked tip jar, which in practice converts at a small fraction of a perked tier.
- **Realistic revenue:** for a hobby-scale gaming utility, **ASSUMPTION: $0–150/month** from an unperked tip jar, with heavy dependence on whether the owner has a personal community presence. Do not model this as infrastructure funding.
- **The one nuance worth exploiting: GitHub Sponsors is arguably not fan-content monetization at all.** The object sponsored is *the developer and the open-source code*, not the Brawl Stars fan content. This repo is public; the draft engine, the bracket math and the scraper architecture are genuinely reusable software. Sponsoring a developer for their code is a category the Fan Content Policy does not reach. **[I]** — untested, but it is a materially better argument than "please tip my Brawl Stars site", and it lets you offer sponsor tiers with benefits *scoped to the software* (priority issues, logo in README) without touching the fan-content donation clause. Keep the two strictly separate: the GitHub Sponsors page must talk about the codebase, never about site features.
- **What makes it safe:** if you take donations on the site, offer literally nothing in return, and say so.

### 3.4 Coaching — **COMPLIANT, and far wider than we assumed. This is the most under-exploited line in the document.**
- **Deciding clause, verbatim:** "By coaching we mean **training and guidance provided to other players**. This could be for example **selling base layouts, personal coaching, online coaching or similar activities**." **[V]** https://supercell.com/en/fan-content-policy/ (**[BLOCKED]**, via index)
- **Why "selling base layouts" is the important half of that sentence.** A base layout is a *file*. It is static, it is productised, it is sold repeatedly to many buyers with zero marginal labour, and it is the crystallised output of game analysis. Supercell names it as coaching. By direct analogy, the Brawl Stars equivalents all sit inside the exception:
  - a **paid map/draft prep pack** — per-map ban priorities, first-pick sheets, comp templates (this is literally what `mapRules` / SpenLC breakdowns already encode);
  - a **paid team scouting report** — an opponent's most-played brawlers, map preferences, draft tendencies, produced from our archive;
  - a **paid pre-tournament prep session or written review**;
  - a **coach marketplace** where verified coaches sell sessions and we take a commission.
- **Where it stops being clean:** the marketplace-commission version charges a fee to *coaches*, who are visitors to our fan content. The exception permits monetization "by coaching"; whether taking a cut of someone else's coaching counts is **[I]** and unconfirmed. First-party coaching (we produce and sell the guidance) is unambiguous; third-party marketplace commission is **GREY**. Start first-party.
- **The collision with our own core principle.** Core principle 1 says *players never pay*. A coaching product sold to a player is a player paying. These can be reconciled two ways, and the owner must pick one:
  1. **Narrow the principle to its actual intent** — "no player ever pays to compete, and no statistic on the site is ever paywalled." Coaching is a service, not access. This is the reading that matches the Tournament Guidelines' own logic (free to *enter*, prizes and services are separate).
  2. **Sell coaching only to teams/orgs, never to individual players.** Cleaner against the principle, much smaller market.
  *Recommendation: (1), stated explicitly on the site so it never looks like drift.*
- **Realistic revenue:** ASSUMPTION — a productised prep pack at $5–15 converting at 0.5–2% of engaged draft-assistant users; a scouting report at $25–75 per opponent for serious teams. Small absolute numbers, but **the margin is ~100% and the policy risk is zero**, which is a rare combination here.
- **Strategic point:** BrawlMeta's entire P1/P2 stats roadmap (personal-vs-global WR, session/tilt reports, per-match draft verdicts) is *coaching tooling by Supercell's own definition*. Framing the product as coaching is not a dodge — it is the accurate description, and it is the frame that should appear in the approval request in §4.

### 3.5 Affiliate links — **GREY, and mostly not worth it**
- **Mechanism:** commission on gaming gear, mobile accessories, Discord Nitro, etc.
- **Deciding clause:** the fee is paid by a merchant, not by a visitor, so it reads as advertising. **[I]** No clause names affiliate marketing either way.
- **Reality check:** a Brawl Stars audience is overwhelmingly young, mobile-only, and low-purchasing-power. Physical-goods affiliate conversion on this traffic is near zero. This is not a revenue line, it is a distraction.
- **Two affiliate categories are DEAD, not grey:** anything selling **gems, accounts, boosting, or in-game currency** (violates the game's own ToS and taints the whole site), and **skin/case gambling** (explicitly prohibited category).

### 3.6 Merchandise — **GREY at best; DEAD if it carries Supercell IP**
- Selling anything bearing Brawl Stars characters, logos, or names is straightforwardly outside fan-content permission and outside the three exceptions. **DEAD.**
- BrawlMeta-branded merch with zero Supercell IP is a sale of our own goods, arguably not "a fee from visitors to your Fan Content" at all. **[I]** Commercially it is worthless at our scale (no audience, no brand affinity, negative working capital). **Do not build.**

### 3.7 Paid organizer tiers — **NON-COMPLIANT as written; the flagged flank, now with a precise diagnosis**
- **Mechanism:** organizers pay monthly or per-event for automated brackets, verification, seeding, branding.
- **Deciding clause:** "not permitted to charge a fee of any kind … from **customers or visitors** to your Fan Content." An organizer using our tournament tooling is a visitor to our fan content, and a recurring platform fee is not ads, not a donation, and not coaching. **[V]** clause; **[I]** application.
- **And the October 2023 approval does not rescue it.** That approval enumerates *player-facing information services* — "better match data, improved record keeping, analysis, pro tips, coaching services". Tournament-platform fees are not on that list. Even as a Creator-Program member, this specific line would need to be raised with Supercell explicitly. **[I]**
- **Second, independent risk:** the Tournament Guidelines say tournaments must be free to enter for players "no exceptions, including membership fees or season passes". **[V]** If an organizer funds our platform fee out of anything player-derived, the fee has been laundered into an entry fee. Any paid organizer product therefore needs a contractual term forbidding the organizer from charging players — and we cannot actually police that.
- **What would make it safe (in ascending order of effort):**
  1. **Ask.** Express approval is the policy's own escape hatch, and §4 drafts the request.
  2. **Reframe from "platform fee" to "services".** A fee for *us running your event* (human operations, verification, dispute handling, production support) is a services contract, not a fee for access to fan content — and it edges toward the coaching/services frame Supercell already recognises. **[I]**
  3. **Make it sponsor-funded, not organizer-funded.** If the organizer's tier is paid for by the event's sponsor, the money originates from an advertiser and lands inside the ads exception. This is a genuinely clean structure and is under-appreciated. **[I]**
- **Verdict: do not build billing for this until §4's request is answered.** Build the *product*, free, and instrument who uses it — that usage data is the strongest possible attachment to the approval request.

### 3.8 White-label / B2B tooling for esports orgs — **NON-COMPLIANT while it is Brawl-Stars-shaped; COMPLIANT once it is not**
- Same clause and same analysis as §3.7 — being B2B changes nothing, because the policy's test is *whether the money relates to the fan content*, not what kind of entity pays.
- **The one durable structure:** a white-label bracket/verification platform that is **game-agnostic** and contains no Supercell data or IP is simply a SaaS product, and Supercell's policy has no jurisdiction over it. `src/data/bracket.js`, the report-result/verify-match flow and the wallet/advance machinery are already mostly game-independent; the Brawl-Stars-specific parts are the battle-log verification and the map/mode metadata.
- **This is the strategic hedge that matters most in the whole document**: it is the only revenue line that a Supercell policy change cannot zero. See §6 and §7.

### 3.9 Data / API licensing — **NON-COMPLIANT, and worse, strategically foolish**
- Selling access to the 1.5M-row archive or an API on top of it is a fee from a customer, outside all three exceptions, and additionally the data is derived from Supercell's own API under a developer key. **[V]** clause; **[I]** on the API-terms overlay (developer.brawlstars.com is **[BLOCKED]**; W2 §1 could not read it either).
- Note the market signal: **RoyaleAPI — the most established site in the whole Supercell ecosystem — shut its free developer API down rather than monetize it.** **[V]** https://royaleapi.com/blog/sunset-api (**[BLOCKED]**, via index). If the category leader concluded an API is a cost centre, we should not model it as revenue.
- **What it *is* good for:** giving it away. A free, attributed data API is how you become infrastructure (OpenDota's whole position). That is a distribution and moat play, not a revenue line. **Do not price it.**

### 3.10 Supercell Creator Code — **COMPLIANT and fully sanctioned; small money, but it is the same door as everything else**
- **Mechanism:** players enter your code in the in-game shop or Supercell Store; Supercell shares roughly **5%** of their purchase revenue with you at no extra cost to the player. **[V]** consistent across multiple secondary sources, e.g. https://www.dexerto.com/gaming/clash-royale-creator-codes-1762321/, https://royaleinsights.com/guides/clash-royale-creator-codes — the exact percentage is not published by Supercell in a source readable here, so treat **5%** as **[I]**.
- **Eligibility is social-media-based**, and this is the practical blocker for a site with no channel: at least 16 years old, and **100 YouTube subscribers / 25 Twitch followers / 1,000 TikTok followers** as the entry bar. **[V]** (secondary sources, corroborated across two searches; creators.supercell.com is **[BLOCKED]**). Higher "Official Creator" tiers need 5,000 YouTube / 3,000 Twitch / 15,000 TikTok.
- **Realistic revenue:** ASSUMPTION — a fan site with a modest audience and no video presence typically sees code usage in the low hundreds of players; at ~5% of what those players spend, that is realistically **tens of dollars per month**, spiking around Brawl Pass launches. Not a business.
- **But this is the highest-priority item anyway**, because Creator-Program membership is the *same gate* that unlocks approved premium services (§1.3). The Creator Code is the visible token of a relationship whose real value is the permission. **Getting into the Creator Program is worth far more than the 5%.**
- **Concrete implication:** BrawlMeta needs a minimal social presence to clear the entry bar. 1,000 TikTok followers is the cheapest of the three thresholds and is achievable with clipped draft-assistant verdicts and tournament highlights. Treat this as a compliance task, not a marketing one.

### 3.11 Prize-pool sponsorship — **COMPLIANT, and the best-fitting commercial line for the tournament product**
- **Mechanism:** a brand funds a tournament's prize pool and gets naming/placement. We never charge the organizer or the players; the money enters as advertising.
- **Deciding clauses:** "You are responsible for providing all prizes for your event" **[V]** — so *we* (or the named organizer) must actually deliver the prizes; a sponsor's involvement does not transfer that liability. "Free to enter for the players — no exceptions" **[V]** — satisfied. No gambling/paid raffles/fantasy betting **[V]** — so prize *draws* among entrants are fine only if entry is free and no consideration is paid; a raffle anyone pays into is DEAD.
- **What makes it safe:** free entry, prizes escrowed or delivered before announcement, no crypto, no prohibited sponsor categories, age/consent rules observed (participants must be 13+, and parental consent is required for minors in cash-prize events **[V]** https://supercell.com/en/tournament-guidelines/), and prizes delivered by us with a paper trail.
- **The real constraint is not policy, it is operations:** cash prizes to minors across borders is a genuinely hard compliance problem (tax, KYC, guardian consent). Prefer **in-kind prizes** (peripherals, merch, gift codes) until there is an entity and a lawyer. This also matches the repo's existing stance ("keep prize handling off-platform until a business entity exists").

### 3.12 Lines nobody has proposed but that deserve a line each
| Line | Verdict | Note |
|---|---|---|
| **Ad-free tier** | **NON-COMPLIANT without Creator Program; COMPLIANT with it** | It is a fee, and it cannot be dressed as a donation ("no benefits of any kind"). Brawlify sells exactly this — because they are in the Program. **This is the single cleanest thing to ask approval for**, because it paywalls no data at all: everything stays free, you are only selling the absence of ads. |
| **Job board / verified-org directory** | GREY | A listing fee from an org is still a fee from a visitor. Small money; not worth the exposure. |
| **Paid Discord bot tiers** | NON-COMPLIANT | Same clause; also Discord's own monetization rules apply on top. |
| **Consulting / build-for-hire** (running an org's event, building their bracket) | GREY→COMPLIANT | A services contract for labour is not a fee for access to fan content, and edges toward the coaching frame. Lumpy, unscalable, but real money and low risk. **[I]** |
| **Newsletter sponsorship** | COMPLIANT | An ad. Cheap to start, and it builds the audience story needed for §3.2. |
| **Selling the tournament engine to a non-Supercell game community** | COMPLIANT (out of scope of the policy entirely) | The hedge in §3.8. |
| **Any paid raffle, lottery, "buy a ticket for a chance at gems"** | **DEAD** | Explicitly prohibited. **[V]** |
| **Crypto/NFT/token anything** | **DEAD** | Explicitly prohibited for tournaments, and would end the relationship. **[V]** |
| **Charging for tournament entry, "premium leagues", season passes** | **DEAD** | "No exceptions." **[V]** And it violates core principle 1. |

---

## 4. The approval path — how the escape hatch is actually operated

### 4.1 What the route really is

The Fan Content Policy's "unless this has expressly been approved by Supercell" is not exercised by writing a letter into the void. Since October 2023 it is operated through a **programme**:

1. **Join the Supercell Creator Program** (`creators.supercell.com` → register). Entry bar: **16+**, and **100 YouTube subscribers OR 25 Twitch followers OR 1,000 TikTok followers**; acceptance is discretionary, not automatic. **[V]** (secondary sources; creators.supercell.com **[BLOCKED]**). The Program has 1,000+ members "including developers of numerous fansites". **[V]** https://supercell.com/en/news/next-step-community-sites/ (**[BLOCKED]**, via index)
2. **Once in, the premium-services policy becomes visible to you** — Supercell states the full policy for paid fan-site services "is visible to website developers in Supercell's Creator Program". **[V]** same source. You cannot read the rules you must comply with until you are a member. That is itself a reason to apply early.
3. **Fan-site developers who want to offer a premium service are explicitly invited to apply** to the Program on that basis. **[V]** same source.
4. **For anything the Program's published policy does not cover** — in our case tournament-organizer fees — raise it directly. The channels that exist: Supercell customer support (`https://supercell.com/en/support/`, named in the Fan Content Policy as the route for policy questions **[V]**), **`tournaments@supercell.com`** for tournament matters **[V]** https://supercell.com/en/tournament-guidelines/, and — once you are a member — your Creator Program contact, which is the channel that actually works. RoyaleAPI's experience is the template: they raised the fan-site monetization problem in **June 2023** and the policy changed in **October 2023**. **[V]** https://royaleapi.com/blog/sunset-api (**[BLOCKED]**, via index). A well-argued question from a real community site does get answered and can move policy.

### 4.2 Sequencing — do not skip this

- **Do NOT ask for tournament-organizer-fee approval first.** It is the least precedented ask, it involves money changing hands around competitive events (the area Supercell polices hardest), and a "no" is much harder to reverse than a "not yet".
- **Ask in this order:** (1) join the Creator Program on the fan-site track; (2) read their premium-services policy; (3) launch only what that policy already blesses (ad-free tier and/or premium stats — both of which we can offer *without* charging players for any statistic, see §6); (4) *then*, with usage evidence in hand, raise the organizer-services question.
- **Prerequisite work before applying:** a TikTok or YouTube presence clearing the follower bar (§3.10), the required disclaimer on every page, and no trademark problems in naming. On the last point: the current name and domain use "brawl" alone on a `vercel.app` subdomain, which is the same posture every incumbent takes — **tolerated, not permitted** (W2 §3.1). Before applying, do not make it worse: **do not register a domain containing "brawlstars"** and do not use Supercell logos in branding.

### 4.3 Ready-to-send: Creator Program application — the "about your site" body

> **Site:** BrawlMeta — https://brawl-meta.vercel.app
> **What it is:** a free Brawl Stars competitive-analytics and automated-tournament site, focused on **Ranked** rather than trophy ladder.
> **What it does that others don't:** we maintain our own archive of ~1.5 million Ranked matches, partitioned by rank bracket (Masters / Diamond-Mythic) and by balance patch, collected continuously from the official Brawl Stars API. On top of it we run a draft-advice engine that gives per-map, per-bracket brawler recommendations with honest confidence framing, and a fully automated community tournament system (bracket generation, screenshot + battle-log result verification, dispute handling).
> **Monetization today:** none. The site is free and has never charged anyone.
> **Why we're applying:** we would like to be part of the Creator Program and to understand the policy for premium services on community sites, so that anything we do commercially is done with Supercell's approval rather than in a grey area. Our own principle is that players never pay to compete and that no game statistic is ever put behind a paywall; we want to keep it that way while covering infrastructure costs.
> **Compliance posture:** every page carries the standard fan-content disclaimer; all tournaments are free to enter with no exceptions; we do not run raffles, gambling, or fantasy betting; we do not promote crypto, blockchain, gem-selling, account-selling or boosting services; we use no Supercell trademarks in our domain or branding.

### 4.4 Ready-to-send: written request to Supercell for the paid organizer tier

*Send only after §4.2 step 4. Address it via the Creator Program contact if we have one, otherwise `tournaments@supercell.com` with a copy through supercell.com/en/support/. Keep it under one screen — the version below is deliberately tight.*

> **Subject:** Approval request — paid organizer services on a community tournament platform (BrawlMeta)
>
> Hi,
>
> I run **BrawlMeta** (https://brawl-meta.vercel.app), a Brawl Stars community site: Ranked analytics built on our own archive of ~1.5 million Ranked matches, plus an automated tournament system that community organizers use to run brackets — automatic seeding, screenshot and battle-log result verification, dispute handling and standings.
>
> I'm writing under the Fan Content Policy clause "unless this has expressly been approved by Supercell", and following the October 2023 update allowing community sites in the Creator Program to offer premium services. I'd like approval for **one specific paid product**, and I want to describe it precisely so you can say yes or no to exactly what it is.
>
> **What we want to charge for:** an optional paid tier **for tournament organizers only** — the person or team running an event — covering the operational work of running it on our platform: automated bracket management, match verification, dispute handling, custom branding for their event page, and our support during the event.
>
> **What we will never charge for, and will commit to in writing:**
> 1. **Players never pay anything, ever.** Entry is free with no exceptions — no entry fee, no membership, no season pass, no premium league. This is both your Tournament Guidelines rule and our own founding principle.
> 2. **No game statistic is ever paywalled.** Every win rate, tier list, map statistic and draft recommendation stays free to every visitor, permanently. We are not selling access to Brawl Stars data.
> 3. **Organizers may not recoup our fee from players.** We would make this an explicit term of service and enforce it by removing organizers who breach it.
> 4. **No gambling, paid raffles, fantasy betting, crypto or blockchain**, and none of the prohibited sponsor categories, anywhere on the platform or in any event we host.
> 5. Prizes remain the responsibility of the organizer, per the Tournament Guidelines, and we verify participant eligibility (13+, guardian consent where cash prizes are involved).
>
> **Why we think this is different from the fee the policy prohibits:** the payment is for our operational service in running an event, not for access to fan content or to game data — closer in spirit to the coaching/services exception than to a paywall. But we recognise it isn't one of the three named exceptions, which is exactly why we're asking rather than assuming.
>
> **If a fee from organizers isn't acceptable, would either of these be?**
> - **(a)** The same tier, **paid for by an event's sponsor** rather than by the organizer — i.e. funded as advertising.
> - **(b)** No organizer fee at all, and we fund the platform through **display advertising and an optional ad-free subscription** that unlocks no data and no features beyond removing ads.
> We would happily take (b) alone if that is the answer, and we'd like to know before we build any billing rather than after.
>
> **Compliance snapshot:** fan-content disclaimer on every page; no Supercell trademarks in our domain, name or branding; all data taken from the official Brawl Stars API under a developer key; no promotion of gem-selling, account-selling or boosting services; site currently has no paid features of any kind.
>
> Happy to provide traffic and usage figures, a walkthrough of the tournament flow, or to make any change you'd need. Thanks for the time — and thanks for the October 2023 community-sites update; it's the reason we're asking properly instead of guessing.
>
> Best,
> [Name] — BrawlMeta
> [contact email] · https://brawl-meta.vercel.app

### 4.5 What to do with the answer

- **Yes** → build billing, and put the approval in writing in the repo (a dated note in `CLAUDE.md`, not the approval text itself if they ask for confidentiality).
- **"Only (b)"** → that is a *good* outcome. Ad-free + ads + coaching is a real, durable stack (§6) and it is what Brawlify runs.
- **No answer within ~6 weeks** → treat as "no" for planning purposes and proceed on the §6 Phase-1 stack. Silence is not approval, and "we asked and they didn't reply" is not a defence.
- **No** → the tournament product stays free and becomes a distribution and audience asset that feeds the ad and coaching lines, plus the game-agnostic white-label hedge (§3.8).

---

## 5. The ad question in detail

Ads are the one unambiguously sanctioned line, so the question is not *whether* but *how*. The answer is unusually constrained here, because the audience is young and the owner is in the EU. Both of those facts cost real money, and pretending otherwise produces a revenue model that is wrong by a factor of several.

### 5.1 Which networks will realistically take a site this size

| Network | Stated entry bar | Fit for BrawlMeta |
|---|---|---|
| **Google AdSense** | None meaningful | **The realistic day-one option.** Approve-on-content, no traffic floor. Lowest RPM, but it works at zero traffic and requires no negotiation. **[V]** general knowledge; no traffic minimum published. |
| **Ezoic** | No hard minimum; sites under ~10k monthly pageviews go through the "Access Now" entry programme | **The realistic first upgrade.** Multivariate placement testing genuinely lifts RPM over bare AdSense. **[V]** https://support.ezoic.com/kb/article/getting-started-ezoics-requirements |
| **Raptive** (ex-AdThrive) | **25,000 monthly pageviews** (reduced from 100,000 in Oct 2025); between 25k–99,999 pageviews, **50% of traffic must come from US/UK/CA/NZ/AU** | Plausible mid-term target — but the **geo condition is the problem**: a Brawl Stars audience skews heavily toward Latin America, MENA, SE Asia and Eastern Europe, exactly the traffic that fails this test. **[V]** https://help.raptive.com/hc/en-us/articles/360032840891-Who-is-eligible-for-Raptive, https://ppc.land/raptive-drops-pageview-requirement-to-25-000-monthly-visits/ |
| **Mediavine** | **$5,000 in annual ad revenue** (a revenue floor, not a traffic floor); "Journey by Mediavine" entry tier at 1,000+ sessions | The revenue floor means you must already be earning before they will take you — a chicken-and-egg that AdSense/Ezoic solves. **[V]** https://help.mediavine.com/what-does-it-take-to-get-approved-by-mediavine |
| **Snigel** | **100,000 monthly pageviews and ~$50/day earnings** | Later-stage. **[V]** https://snigel.com/faq (via index) |
| **Playwire** | **500,000 monthly pageviews**, good English-speaking footprint | Gaming-specialist, but far out of reach for now. **[V]** https://www.playwire.com/faq |
| **Venatus** | No public hard minimum; selective, gaming/esports-focused | **The one to court.** Gaming-endemic demand means better fill for a gaming audience than generalist networks, and — a concrete signal — **Venatus already serves ads on brawltime.ninja**, a direct-category peer. **[V]** https://brawltime.ninja/about (**[BLOCKED]**, via index) |
| **Nitropay / AdinPlay / Snigel-style gaming specialists** | Varies, generally gaming-friendly at lower volumes | Worth a parallel enquiry alongside Venatus. **[I]** |

**Recommended path:** AdSense (day one, to establish revenue and learn the consent stack) → Ezoic (placement optimisation) → approach **Venatus** and **Nitropay** directly as soon as there is a monthly pageview figure worth quoting, because gaming-endemic demand beats geo-limited premium networks for this audience. Do not chase Raptive/Mediavine unless the traffic mix turns out to be unexpectedly Anglophone.

### 5.2 What RPM to actually expect

All figures below are **ASSUMPTIONS** drawn from publisher-survey aggregations, not audited data, and gaming is a **low-CPM vertical** — advertisers value a 13-year-old mobile gamer far below a B2B or finance reader.

| Scenario | Page RPM assumption | Source basis |
|---|---|---|
| Gaming display, broad international traffic | **$2–6 per 1,000 sessions** | **[V]** https://toolsignal.site/articles/blog-display-ad-rpm-by-niche-2026 |
| AdSense, gaming | **$3–12** | same |
| Ezoic, gaming, ~10k+ sessions | **$8–20** | same |
| Mediavine tier, gaming | **$15–40+** | same |

Then apply three multipliers that are specific to us and all point downward:
- **Geography:** non-US/UK/CA/AU traffic typically earns **50–80% less**. **[V]** same source. A Brawl Stars audience is mostly not in those markets.
- **Seasonality:** Q4 RPMs run **40–80% above Q1**. **[V]** same source. Do not annualise a December number.
- **Child-audience / non-personalised ads:** see §5.4. This is the big one, and it can be a **50–90% haircut** on the affected traffic.

**Realistic working assumption for planning: an effective blended page RPM of $1.50–4.00**, not the headline gaming numbers. Model:

| Monthly pageviews (assumption) | @ $1.50 RPM | @ $4.00 RPM |
|---|---|---|
| 25,000 | $38 | $100 |
| 100,000 | $150 | $400 |
| 500,000 | $750 | $2,000 |
| 2,000,000 | $3,000 | $8,000 |

**We do not have BrawlMeta's actual traffic figures and this document does not invent them.** Get them from Vercel Analytics before doing any planning against this table. The shape of the table is the point: **display ads are a hosting-cost offset until roughly half a million monthly pageviews**, and a salary somewhere north of two million. Anyone modelling ads as the primary funding line at current scale is modelling a fantasy.

### 5.3 Cost side — the number that decides whether ads are even worth it

Against that revenue sit the real costs: Supabase (the DB is ~221 MB and the archive is capped at 1.5M rows precisely because it grows), the **Webshare static-IP proxy** the scrapers and `api/player.js` depend on, Vercel functions, and the **Anthropic API for OCR verification** on every reported tournament result. The OCR line is the one that scales with tournament usage rather than with pageviews, i.e. it grows with the product we cannot charge for. **Instrument per-tournament OCR cost before promoting the tournament product**, or a successful tournament season becomes a loss-making one. **[I]** — no cost figures were measured in this session.

### 5.4 The child-audience problem — read this before signing any ad contract

This is the most serious and most specific constraint in the entire monetization plan, and it is routinely underestimated.

**The facts:**
- Brawl Stars is rated **9+ (App Store) / E10+ (Google Play)**; Supercell's own ToS sets a minimum age of 13; the actual player base runs from roughly **8 to 18**, with a significant portion below 13. **[V]** https://www.airdroid.com/parent-control/is-brawl-stars-safe-for-kids/, https://pinkcrow.net/brawl-stars/brawl-stars-explained-for-parents/ — no authoritative percentage breakdown is published by Supercell, so any specific share is **[I]**.
- **US — COPPA.** If a site is "directed to children" under 13, personalised/interest-based advertising is off. Google's mechanism is tagging the site or ad request for child-directed treatment (`tagForChildDirectedTreatment`, now migrating to Tag For Age Treatment), which **disables personalised and interest-based ads** for those requests. **[V]** https://support.google.com/adsense/answer/3248194, https://support.google.com/admanager/answer/4442399
- **Revenue impact is not marginal.** On YouTube's comparable "Made for Kids" regime, contextual-only serving reduces effective CPMs dramatically — reported ranges of **$0.25–$3 per 1,000 views versus $1–$5+ for general content**, with some operators reporting drops well past 90%. **[V]** https://www.auditsocials.com/blog/youtube-made-for-kids-ad-restrictions-update-2026-coppa-expansion-limited-ads-mode-family-friendly-compliance, https://gyre.pro/blog/how-to-monetize-a-youtube-kids-channel — these are YouTube figures, so treat the transfer to web display as **[I]**, but the direction and rough magnitude are not in doubt.
- **EU — DSA Article 28(2)** bans presenting advertising **based on profiling** to a recipient the platform is aware "with reasonable certainty" is a minor (under 18, not under 13). Critically, **this ban cannot be overridden by parental consent** — it is stricter than GDPR. Platforms are not obliged to collect extra data to determine age, but they cannot ignore what they plainly know. **[V]** https://www.eu-digital-services-act.com/Digital_Services_Act_Article_28.html, https://www.twobirds.com/en/insights/2023/global/dsa-publicite-ciblee-destinee-aux-mineurs-une-interdiction-a-venir
- **EU — GDPR Article 8**: member states set the digital-consent age between 13 and 16; **Hungary sits at 16**. **[V]** https://arxiv.org/pdf/2310.04104 and the DSA/GDPR comparisons above; treat the Hungary-specific figure as **[I]**-leaning-**[V]** and confirm with counsel.

**What this means concretely:**
1. **Do not build a revenue model on personalised ads.** For a meaningful share of our traffic, personalised ads are either illegal or contractually unavailable. Plan on **contextual** advertising as the base case and treat personalised inventory as upside on the adult slice.
2. **Contextual is not a disaster for us specifically.** A page about Brawl Stars draft strategy is a perfect contextual match for gaming-endemic advertisers — which is exactly the demand a network like **Venatus** carries and a generalist network does not. The child-audience haircut hurts generalist RPM far more than it hurts endemic gaming RPM. **[I]** This is a real argument for going gaming-specialist earlier than traffic alone would suggest.
3. **Do not attempt age gating you can't honour.** Asking for a birth date and then serving personalised ads to anyone who types 1990 is worse than not asking. Either serve contextual-only site-wide (simple, defensible, cheap) or implement genuine age assurance (expensive, out of scope).
4. **Recommended posture: contextual-only, site-wide, from day one.** It removes the COPPA question, removes the DSA Article 28 question, and simplifies the consent stack enormously. Revisit only if a network can prove they can segment adult traffic safely.

### 5.5 Consent management — mandatory, not optional, and it is a build task

The owner is in Hungary → GDPR and ePrivacy apply to us as publisher regardless of where visitors are.
- **Since 16 January 2024, any publisher serving Google ads to users in the EEA/UK/Switzerland must use a Google-certified CMP integrated with IAB TCF v2.2.** Non-certified CMPs send incomplete signals and personalised ads are cut off. **[V]** https://support.google.com/adsense/answer/13554116, https://blog.google/products/adsense/new-consent-management-platform-requirements-for-serving-ads-in-the-eea-and-uk/
- **Google Consent Mode v2 is not a substitute for a CMP.** **[V]** https://www.cookieyes.com/blog/iab-tcf-cmp-for-publishers/
- Practical stack: a Google-certified CMP (CookieYes, Cookiebot, Didomi, Sourcepoint, or Ezoic's built-in CMP if you go Ezoic), plus a privacy policy and cookie policy that actually describe what runs. The site currently has neither a CMP nor, as far as this analysis found, a privacy policy — **both are prerequisites for the first ad impression, not follow-ups.**
- If you go **contextual-only** (§5.4), the consent surface shrinks dramatically — you still need a cookie banner for any analytics/functional storage, but you are no longer dependent on consent rates for revenue. **This is a second, independent reason to choose contextual-only.**

### 5.6 Where to put ads without wrecking the product

BrawlMeta's value is a *tool* — draft assistant, tier list, tournament bracket. Tools tolerate ads far worse than articles do, and the two worst outcomes are (a) a mis-tap during a live draft and (b) Core Web Vitals collapse on a React SPA.

Rules:
1. **Never inside an interactive surface.** No ads in the draft assistant's pick area, no ads between bracket nodes, nothing that can be tapped by accident during a live tournament match. A mis-tap during a real draft is a product failure that costs a user permanently.
2. **Reserve the space in CSS.** Fixed-height ad containers with explicit `min-height` — otherwise CLS destroys mobile Core Web Vitals and, in an SPA, layout shift on route change is much worse than on a static page.
3. **Best inventory, in order:** a leaderboard above the fold on content pages (tier list, brawler guides, map pages), an in-content unit on brawler/map guide pages (these are the long-scroll SEO pages and the natural ad surface), a sidebar/anchor unit on desktop, and a **single** sticky bottom anchor on mobile — anchor units carry high viewability and are the most reliable RPM on mobile gaming traffic. **[I]**
4. **Tournament pages get at most one unit, above the header, and none during live match flow.** The tournament product is the relationship; do not tax it.
5. **Lazy-load below-fold units** and cap total requests per pageview — the archive-driven pages already do meaningful client work.
6. **Measure the counterfactual.** Instrument draft-assistant completion rate before and after ads go live. If completion drops materially, the ad is costing more than it earns.

---

## 6. Recommended strategy — phased

The organising idea: **stop trying to make the tournament product pay, and let it be the audience engine.** Everything Supercell has approved is player-facing information and coaching. Everything we planned to charge for is not. Invert.

### Phase 0 — this month, zero policy risk, mostly non-code
| Action | Why | Effort |
|---|---|---|
| **Get the actual traffic numbers** from Vercel Analytics (pageviews/month, geo split, device split) | Every number in §5.2 is unusable without this. No planning until this exists. | 10 min |
| **Add the fan-content disclaimer to every page footer** ("This material is unofficial and is not endorsed by Supercell") | Required by the Fan Content Policy; **[V]** — and a prerequisite for a credible Creator Program application. Currently a gap. | 30 min |
| **Publish a privacy policy + cookie policy** | Legally required in the EU before the first ad; also a Creator Program credibility signal. | 2 h |
| **Stand up a minimal social presence** (TikTok clips of draft verdicts / tournament highlights) targeting the **1,000-follower TikTok bar** | This is the *cheapest of the three Creator Program thresholds* and it is the gate to everything in §1.3. Treat as a compliance task. | Ongoing |
| **Write down the sponsor/affiliate category blacklist** (gem/account selling, boosting, gambling, crypto, other publishers' games) | Prevents the fastest possible route to a takedown. | 30 min |
| **Do NOT register any domain containing "brawlstars"** | Trademark clause. Current posture is tolerated; don't make it worse before applying. | — |

### Phase 1 — turn on the sanctioned lines (weeks 2–8)
1. **Display ads, contextual-only, via AdSense**, behind a **Google-certified TCF v2.2 CMP**, using the placement rules in §5.6. Contextual-only sidesteps COPPA and DSA Art. 28 entirely.
2. **A naked tip jar** (Ko-fi or Buy-Me-a-Coffee) with **zero perks**, plus **GitHub Sponsors framed strictly around the open-source codebase** (§3.3) — the one place perks are defensible.
3. **Apply to the Supercell Creator Program on the fan-site track** using the §4.3 body, the moment the follower bar is cleared.
4. **Keep the tournament product completely free** and instrument it: number of events, participants, organizers, repeat organizers. This is the evidence base for §4.4.

*Expected Phase 1 revenue: at the low end of §5.2's table — realistically **$0–200/month** unless traffic is already large. This phase is not about money; it is about being legally and structurally ready.*

### Phase 2 — build the coaching line (months 2–5, no approval required)
This is the highest return-on-risk work available, because §1.2 puts it inside a **named exception** that needs no relationship with Supercell at all.
1. **Productised prep packs** — per-map ban/first-pick sheets and comp templates generated from `mapRules` + the archive. Sold as a downloadable artefact. This is the direct analogue of "selling base layouts", which Supercell names as coaching. **[V]**
2. **Team scouting reports** — an opponent team's most-played brawlers, map preferences and draft tendencies from our archive. Priced per report, sold to teams. Note this requires the **player-identity match table** that `IMPLEMENTATION-PLAN` §5.1 already specifies as P0 — the two roadmaps converge here, which is a strong argument for building it.
3. **Optionally, a coach marketplace** later — first-party coaching is clean, third-party commission is **GREY** (§3.4). Do the clean one first.
4. **Resolve the core-principle wording** (§3.4) publicly and once: *no player pays to compete, and no statistic is ever paywalled.* Put it on the site.

*Expected: small but ~100%-margin, and it is the only paid line that carries no Supercell risk whatsoever.*

### Phase 3 — after Creator Program acceptance
1. **Read their premium-services policy** — it is not public, and it may permit or forbid things this document could not know. **Everything below is contingent on it.**
2. **Launch an ad-free subscription** priced around the category norm (Brawlify: **$4.99/mo per tag** **[V]**). Critically: **unlock nothing except the absence of ads.** No statistic moves behind it. This is fully consistent with core principle 1 as reworded, and it is the exact thing Brawlify and RoyaleAPI sell.
3. **Consider convenience-only premium** if their policy allows it — faster refresh, longer retained personal history, alerts. Note Brawlify's own approved tier is precisely this ("automatic tracking", "complete battle history"), and it is enumerated in Supercell's own announcement ("better match data, improved record keeping"). **[V]**
4. **Then, and only then, send the §4.4 organizer-tier request**, with real usage numbers attached.

### Phase 4 — the lines that survive a policy change
1. **Direct sponsorship of a recurring tournament series** (§3.2, §3.11) — advertiser money, inside the ads exception, and the highest-value use of the tournament product.
2. **Game-agnostic white-label bracket/verification SaaS** (§3.8) — the only revenue line outside Supercell's jurisdiction. Extract `bracket.js` + the report/verify/advance flow behind a game-adapter interface.

### 6.1 Modelled outcome (all figures ASSUMPTIONS, stated as functions of traffic we do not yet have)

| Line | At 100k pageviews/mo | At 500k pageviews/mo | Policy risk |
|---|---|---|---|
| Contextual display ads @ $1.50–4.00 RPM | $150–400 | $750–2,000 | none |
| Tip jar / GitHub Sponsors | $0–150 | $50–300 | none |
| Coaching products (prep packs, scouting) | $50–300 | $200–1,000 | none (named exception) |
| Ad-free subscription @ $4.99, **0.3–1.0%** of monthly uniques converting *(assumption; op.gg/Dotabuff-class conversion for a free-with-ads utility)* | not viable pre-approval | $500–2,500 | requires Creator Program |
| Series sponsorship | $0 | $200–2,000 per event | none, with category blacklist |
| Organizer tiers | **$0 — do not build** | **$0 — do not build** | requires express approval |

**Honest read: none of these is a salary at plausible near-term traffic.** The realistic goal for the next 12 months is **covering infrastructure and paying for the owner's time partially**, with the ad-free subscription as the only line with genuine scale — and that line is gated on the Creator Program. Which is why §4 is the most important section in this document.

---

## 7. Risk register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | **Supercell objects to a paid tier launched without Creator Program approval** | Medium if we launch one; ~zero if we don't | Takedown demand; loss of any future relationship; refunds | Do not launch any paid tier before §4. The whole Phase ordering exists for this. |
| R2 | **Creator Program application is rejected** (discretionary, and the follower bar is real) | Medium — we have no social channel today | Caps the ceiling: no ad-free tier, no approved premium | Phase 0's TikTok task is the mitigation. Fallback stack = ads + donations + coaching, which needs no approval and is a real business, just a smaller one. |
| R3 | **Supercell changes the community-sites policy again** (they changed it once in 2023; the announcement itself says it "may be amended") **[V]** | Low-medium | Could zero a subscription line overnight | Never let subscription exceed ~50% of revenue. Keep ads + coaching alive as the floor. Build the game-agnostic hedge (§3.8). |
| R4 | **Trademark exposure on the name/domain** | Low (universal in the category, never enforced) but non-zero | Forced rename; loss of SEO and links | Don't register a "brawlstars" domain. Secure a defensible brand name early so a rename is cheap. Being in the Creator Program materially reduces this risk. |
| R5 | **Child-audience / COPPA / DSA Art. 28 advertising violation** | Medium if personalised ads are enabled carelessly | Regulatory exposure (EU fines are not theoretical), network account termination | Contextual-only site-wide from day one (§5.4). This is the single cheapest risk elimination available. |
| R6 | **GDPR/consent non-compliance as an EU publisher** | High if ads launch without a certified CMP | Google cuts personalised ads; ICO/NAIH exposure | Google-certified TCF v2.2 CMP before the first impression (§5.5). |
| R7 | **Ads damage the product** (draft mis-taps, CLS, bounce) | Medium | Loses the audience that the whole model depends on | §5.6 placement rules; measure draft-completion rate as a guardrail metric. |
| R8 | **Prize liability** — we are responsible for prizes; minors, cross-border, tax | Medium once real prizes exist | Legal and financial exposure to an individual with no entity | In-kind prizes only until an entity exists. Sponsor delivers directly where possible. Guardian consent for cash prizes (13+ rule). **[V]** |
| R9 | **An organizer charges players an entry fee on our platform** | Medium — we cannot fully police it | Direct Tournament Guidelines breach attributed to us | Explicit ToS prohibition, a reporting mechanism, and enforcement (remove the organizer). Say so in the §4.4 letter — it shows we've thought about it. |
| R10 | **Cost growth outruns ad revenue** (OCR per verification, Supabase, proxy) | Medium — costs scale with the free product | Negative unit economics precisely when the product succeeds | Instrument per-tournament OCR/API cost now (§5.3); cap free-tier verifications if needed. |
| R11 | **Dependency on `cdn.brawlify.com` for art** (already flagged in the plan's §7.5) | Medium — and a paid competitor has a motive | Broken images across the site | Self-host assets. Now also a *monetization* risk, not just a technical one. |
| R12 | **Single-line concentration** | — | — | **Structural rule: no single revenue line above 50% of total, and at least one line (white-label / non-Supercell) fully outside Supercell's jurisdiction.** This is what makes a policy change survivable rather than fatal. |

### 7.1 What actually happens if Supercell objects
Realistically, enforcement against a good-faith fan site is a **request, not a lawsuit**: a message asking you to remove the offending feature, sometimes via the Creator Program contact, sometimes via a takedown to the host. The practical exposures are (a) losing the feature and refunding subscribers, (b) losing API key access — which is the one that actually kills the site, since the whole archive pipeline depends on a developer key, and (c) reputational damage in a community where Supercell's word is final. **[I]** — no enforcement precedent against a Brawl Stars fan site was locatable this session.
**The asymmetry that should drive every decision here:** the upside of an unapproved paid tier is a few hundred dollars a month; the downside is the API key. Ask first.

---

## 8. Uncertainties — where this analysis is weakest

1. **Every Supercell-domain source is [BLOCKED] here.** The Fan Content Policy, Tournament Guidelines, the October 2023 community-sites announcement and `creators.supercell.com` could not be read directly. Wording is reconstructed from search-index summaries of the exact canonical URLs, cross-checked against independent corroboration (RoyaleAPI's account, multiple secondary summaries). **Before acting on §1.3 or sending §4.4, someone with an unblocked browser must read https://supercell.com/en/news/next-step-community-sites/ and https://supercell.com/en/fan-content-policy/ in full and confirm the quotes.** This is the single most important verification task in the document.
2. **The Creator Program's premium-services policy is not public.** We are planning against rules we cannot read. Phase 3 is therefore contingent by construction.
3. **Whether Brawlify/brawlace hold express approval is inferred**, not confirmed. Brawlify holding a Creator Code is **[V]**; that this equals premium-services approval is **[I]** (though a strong inference given the timing and the feature match).
4. **The 5% Creator Code share** is from secondary sources only.
5. **No BrawlMeta traffic, cost or conversion data was available.** Every revenue figure is a stated assumption expressed as a function of traffic.
6. **No legal review.** GDPR Art. 8 Hungarian age threshold, DSA Art. 28 applicability to a site of our size, and COPPA "directed to children" classification all need a lawyer, not a research pass. DSA Art. 28 obligations vary by service classification, and whether a small fan site is an "online platform" under the DSA is genuinely arguable — this document assumes the conservative reading.
7. **No enforcement precedent found** in either direction for Brawl Stars fan sites. The "tolerated" bucket in §2.2 is an inference from the absence of visible enforcement, which is weak evidence.

---

STATUS: complete
