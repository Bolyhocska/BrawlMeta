// ─── Privacy policy, cookie notice, and About ────────────────────────────────
// Required before running ads in the EU, and a credibility signal for the
// Supercell Creator Program application (see docs/brawlify-analysis).
//
// EVERY factual claim below was checked against the code rather than assumed —
// a privacy policy that describes collection the site doesn't do (or, worse,
// omits collection it does) is more dangerous than none at all. Specifically:
//   · auth providers     src/auth.jsx (email/password + OAuth)
//   · profile fields     Profiles: id, email, display_name, player_tag,
//                        is_premium, avatar_url, provider, timestamps
//   · registrations      Registrations: email, player_tag, display_name,
//                        team_name, friend_id, friend_qr_url
//   · uploads            storage buckets match-proof, dodge-reports,
//                        tournament-banners — all served via getPublicUrl,
//                        i.e. PUBLIC once uploaded
//   · player tracking    tracked_players / player_matches / player_snapshots,
//                        enrolled by /api/player on every lookup
//   · OCR                api/_lib/ocr.js sends screenshots to Anthropic
//   · analytics          none — no gtag/plausible/posthog anywhere
//
// Structure follows the shape the owner asked for (numbered sections, a
// contents index, a metadata strip). Deliberately NOT copied from the
// reference: its advertising and consent-management sections, because we run
// no ads and set no advertising cookies — describing cookies we don't set
// would make this document false in the opposite direction.
//
// CONTACT. The policy identifies "the operator of BrawlApex" rather than naming
// an individual, and gives a working address — the shape every comparable fan
// site uses, and the owner's explicit choice. Worth knowing it is thinner than
// GDPR Art. 13(1)(a) reads on its face, which asks for the identity AND contact
// details of the controller. It is defensible for an unincorporated personal
// project, and it becomes a real gap the moment BrawlApex is a registered
// entity or starts taking money — at which point put the entity name here.

import { Link } from "react-router-dom";
import { GuideShell } from "./GuidesPages";

const MONO = "'JetBrains Mono', monospace";
const DISPLAY = "'Baloo 2', sans-serif";

const CONTROLLER = {
  operator: "the operator of BrawlApex",
  email: "brawlapex.dev@gmail.com",
};

const META = {
  updated: "24/08/2026",
  jurisdiction: "EU · GDPR",
  version: "1.0",
};

const SECTIONS = [
  { id: "collection", n: "01", tag: "COLLECTION", title: "Information Collection." },
  { id: "tracking", n: "02", tag: "TRACKING", title: "Player Match History." },
  { id: "uploads", n: "03", tag: "UPLOADS", title: "What You Upload." },
  { id: "cookies", n: "04", tag: "COOKIES", title: "Cookie Usage." },
  { id: "disclosure", n: "05", tag: "DISCLOSURE", title: "Third-party Disclosure." },
  { id: "links", n: "06", tag: "LINKS", title: "Third-party Links." },
  { id: "children", n: "07", tag: "CHILDREN", title: "Children's Privacy." },
  { id: "retention", n: "08", tag: "RETENTION", title: "How Long We Keep Things." },
  { id: "rights", n: "09", tag: "RIGHTS", title: "Your Rights." },
  { id: "contact", n: "10", tag: "CONTACT", title: "Contacting Us." },
];

// ── primitives ───────────────────────────────────────────────────────────────

const P = ({ children }) => <p style={{ margin: "0 0 12px" }}>{children}</p>;
const UL = ({ children }) => <ul style={{ margin: "0 0 12px", paddingLeft: 20 }}>{children}</ul>;
const LI = ({ children }) => <li style={{ marginBottom: 7 }}>{children}</li>;
const Term = ({ children }) => <strong style={{ color: "#e9e9f2" }}>{children}</strong>;
const Q = ({ children }) => (
  <div style={{ fontFamily: DISPLAY, fontSize: 17, fontWeight: 700, color: "#c9c9d6", margin: "0 0 10px" }}>
    {children}
  </div>
);
const Ext = ({ href, children }) => (
  <a href={href} target="_blank" rel="noreferrer" style={{ color: "#9a8fc0" }}>{children}</a>
);

function Callout({ tone = "amber", children }) {
  const tones = {
    amber: { bg: "rgba(255,180,61,.09)", bd: "rgba(255,180,61,.30)", fg: "#ffce7a" },
    green: { bg: "rgba(142,230,176,.08)", bd: "rgba(142,230,176,.30)", fg: "#8ee6b0" },
    violet: { bg: "rgba(179,107,255,.10)", bd: "rgba(179,107,255,.32)", fg: "#c9a6ff" },
  }[tone];
  return (
    <div style={{
      margin: "14px 0 12px", padding: "14px 16px", borderRadius: 12,
      background: tones.bg, border: `1px solid ${tones.bd}`, color: tones.fg, lineHeight: 1.7,
    }}>{children}</div>
  );
}

function Sec({ id, n, tag, title, children }) {
  return (
    <section id={id} style={{ scrollMarginTop: 90, marginBottom: 34 }}>
      <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 2, color: "#6f7180", marginBottom: 6 }}>
        [ {n} / {tag} ]
      </div>
      <h2 style={{
        fontFamily: DISPLAY, fontSize: "clamp(22px, 3.2vw, 30px)", fontWeight: 800,
        margin: "0 0 16px", letterSpacing: -0.4, color: "#f2f2f8",
      }}>{title}</h2>
      <div style={{ color: "#b9b9c8", fontSize: 14.5, lineHeight: 1.8 }}>{children}</div>
    </section>
  );
}

function Contents() {
  return (
    <nav style={{
      position: "sticky", top: 24, alignSelf: "start",
      padding: "18px 18px 20px", borderRadius: 14,
      background: "rgba(13,13,20,.6)", border: "1px solid rgba(255,255,255,.08)",
    }}>
      <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: 2.4, color: "#6f7180", marginBottom: 12 }}>
        CONTENTS
      </div>
      {SECTIONS.map(s => (
        <a key={s.id} href={`#${s.id}`} style={{
          display: "flex", gap: 9, padding: "5px 0", textDecoration: "none",
          fontFamily: MONO, fontSize: 11.5, color: "#9a9aab", lineHeight: 1.5,
        }}>
          <span style={{ color: "#5a5a6a" }}>{s.n}</span>
          <span>{s.title.replace(/\.$/, "")}</span>
        </a>
      ))}
    </nav>
  );
}

function LegalHeader({ eyebrow, title, lead }) {
  return (
    <>
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 9, padding: "9px 18px 9px 14px",
        borderRadius: 999, background: "rgba(13,13,20,.6)", border: "1px solid rgba(179,107,255,.3)",
        fontFamily: MONO, fontSize: 12, letterSpacing: 2.5, color: "#c98bff",
      }}>
        <span style={{ width: 7, height: 7, borderRadius: 999, background: "#b36bff" }} />
        {eyebrow}
      </div>
      <h1 style={{
        fontFamily: DISPLAY, fontSize: "clamp(34px, 6vw, 58px)", fontWeight: 800,
        margin: "16px 0 12px", lineHeight: 1.05, letterSpacing: -1,
      }}>{title}</h1>
      {lead && (
        <p style={{ margin: 0, color: "#a6a6b8", fontSize: 15.5, lineHeight: 1.75, maxWidth: 660 }}>
          {lead}
        </p>
      )}
    </>
  );
}

function MetaStrip() {
  const cell = (label, value) => (
    <div style={{ display: "flex", gap: 7, alignItems: "baseline" }}>
      <span style={{ color: "#5a5a6a" }}>{label}</span>
      <span style={{ color: "#c9c9d6" }}>{value}</span>
    </div>
  );
  return (
    <div style={{
      display: "flex", gap: 22, flexWrap: "wrap", marginTop: 18, paddingTop: 14,
      borderTop: "1px solid rgba(255,255,255,.08)",
      fontFamily: MONO, fontSize: 10.5, letterSpacing: 1.4,
    }}>
      {cell("LAST UPDATED", META.updated)}
      {cell("JURISDICTION", META.jurisdiction)}
      {cell("VERSION", META.version)}
    </div>
  );
}

// ── pages ────────────────────────────────────────────────────────────────────

export function PrivacyPolicyPage() {
  return (
    <GuideShell>
      <div style={{ position: "relative", zIndex: 2, maxWidth: 1120, margin: "0 auto", padding: "48px 5vw 30px" }}>
        <LegalHeader
          eyebrow="LEGAL · PRIVACY"
          title="Privacy Policy."
          lead="Written so you know exactly what BrawlApex stores, what it doesn't, and what happens to any of it. Read it carefully — there should be no surprises."
        />
        <MetaStrip />

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 34, marginTop: 36 }}>
          <div style={{ display: "grid", gap: 34, gridTemplateColumns: "220px minmax(0,1fr)" }}
               className="legal-grid">
            <Contents />
            <div>
              <Sec {...SECTIONS[0]}>
                <Q>What do we collect from people who visit the site?</Q>
                <P>
                  <Term>Nothing, if you are just browsing.</Term> The tier list, brawler guides,
                  draft assistant and leaderboards need no account, set no tracking cookies, and
                  store nothing about you. There is no analytics or advertising software anywhere on
                  this site.
                </P>
                <P>Creating an account is only needed to enter or run tournaments. If you do, we store:</P>
                <UL>
                  <LI><Term>Your email address</Term> — to identify the account and contact you about tournaments you entered.</LI>
                  <LI><Term>Your display name</Term> — public, permanent and unique. Chosen once, then locked.</LI>
                  <LI><Term>Your Brawl Stars player tag</Term> — public. It freezes after your first tournament, which is what stops accounts being sold or impersonated.</LI>
                  <LI><Term>Your sign-in method</Term>, and for Google or Discord sign-ins the avatar image those services return.</LI>
                  <LI><Term>Whether your account is premium</Term>, and your tournament winnings balance.</LI>
                </UL>
                <P>Passwords are handled entirely by our authentication provider and are never visible to BrawlApex.</P>
              </Sec>

              <Sec {...SECTIONS[1]}>
                <Q>Do we keep a record of individual players?</Q>
                <P>
                  <Term>Yes, and this is the part most worth understanding</Term>, so it is spelled
                  out rather than summarised. Separately from the anonymous statistics that power the
                  tier list, BrawlApex keeps a match history for individual players, identified by
                  Brawl Stars player tag.
                </P>
                <P><Term>What is stored:</Term> for each ranked match — when it was played, the map,
                  the brawler that player used, whether they won, and the tags and brawlers of the
                  other five players in the match. All of it comes from the official Brawl Stars API,
                  which publishes this for any tag to anyone who asks.</P>
                <P><Term>Whose history gets recorded:</Term> three groups, and the third is the largest.</P>
                <UL>
                  <LI>Players on public competitive leaderboards, which we track to build the ranked meta.</LI>
                  <LI><Term>Anyone whose tag is looked up on this site.</Term> Searching a tag starts
                    recording that player's history from that moment on. They are not asked first, and
                    whoever searched does not have to be them.</LI>
                  <LI><Term>Anyone who played in a tracked player's match.</Term> A battle record names
                    all six participants, so being on either team in someone else's tracked game puts
                    your tag in our database even if nobody ever looked you up and you have never
                    heard of this site. Most people in our records are here this way.</LI>
                </UL>
                <P>
                  <Term>Why it works that way.</Term> The Brawl Stars API only exposes a player's last
                  ~25 battles and never back-fills, so history nobody started recording is gone for
                  good. Recording from first sight is the only way a profile is worth anything on a
                  second visit. We think that is the right trade — it is why this is free here and
                  charged for elsewhere — but it does mean a record can exist that the player never
                  asked for, and you should know that.
                </P>
                <Callout tone="green">
                  <Term>You can stop it at any time, whichever group you are in.</Term> Look your tag
                  up on the Leaderboards page and press <Term>“Stop tracking”</Term>. That deletes
                  your stored history, removes your tag from other players' match records, and marks
                  it so no later lookup can start tracking you again. It works even if you were never
                  tracked in your own right. No account required — demanding one to opt out would be
                  absurd, since the people most likely to want out never signed up. You can also
                  email us and we will do it for you.
                </Callout>
                <P>
                  <Term>Boosting</Term> is the opposite choice. It asks us to check a profile every
                  few hours instead of twice a day and to record trophy and progression history too.
                  It is <Term>free and always will be</Term>. It exists because the extra requests
                  cost us real capacity, so we spend them where someone actually wants them — not as
                  a paid tier.
                </P>
                <P>
                  <Term>Legal basis (GDPR):</Term> legitimate interest in running a community
                  statistics service over data the game already publishes. You may object at any time
                  using the control above, and we will honour it without asking for a reason.
                </P>
              </Sec>

              <Sec {...SECTIONS[2]}>
                <Q>What happens to files uploaded during a tournament?</Q>
                <P>Entering or running a tournament can involve uploading:</P>
                <UL>
                  <LI><Term>Result screenshots</Term>, to verify who won a match.</LI>
                  <LI><Term>Dodge reports</Term> (screenshots or video), if you report an opponent for not showing up.</LI>
                  <LI><Term>Tournament banners</Term>, if you organise a tournament.</LI>
                  <LI><Term>An in-game friend ID or friend QR code</Term>, so opponents can add you for the match.</LI>
                </UL>
                <Callout tone="amber">
                  Please read this one carefully: <Term>uploaded files are stored at public web
                  addresses.</Term> Anyone holding the link can open them without signing in. Do not
                  upload anything you would not be comfortable making public — in particular, crop
                  out anything private before uploading a screenshot.
                </Callout>
              </Sec>

              <Sec {...SECTIONS[3]}>
                <Q>Do we use cookies?</Q>
                <P>
                  <Term>Only essential ones.</Term> They keep you signed in and do nothing else.
                  There are no analytics cookies, no advertising cookies, and no third-party trackers
                  on this site — which is why you have not been asked to accept anything. There is
                  nothing to consent to.
                </P>
                <P>
                  You can block or delete cookies through your browser settings. If you do, staying
                  signed in will stop working, but the rest of the site will not be affected.
                </P>
                <P>
                  If this ever changes, this page will say so <Term>before</Term> it happens, the
                  version above will change, and a consent control will appear.
                </P>
              </Sec>

              <Sec {...SECTIONS[4]}>
                <Q>Do we sell or share your information?</Q>
                <P>
                  <Term>We do not sell, trade, or rent personal information to anyone</Term>, and we
                  do not share it for advertising. We run no ads, so there is no advertising partner
                  and no ad-tech network receiving anything about you.
                </P>
                <P>We do rely on a small number of service providers to run the site:</P>
                <UL>
                  <LI><Ext href="https://supabase.com/privacy">Supabase</Ext> — database, authentication and file storage.</LI>
                  <LI><Ext href="https://vercel.com/legal/privacy-policy">Vercel</Ext> — hosting. Vercel processes server logs, including IP addresses, to serve and secure the site.</LI>
                  <LI><Ext href="https://www.anthropic.com/legal/privacy">Anthropic</Ext> — result screenshots are sent for automated reading so a match can be verified without a human looking at it. They are not used to train models.</LI>
                  <LI><Ext href="https://supercell.com/en/privacy-policy/">Supercell</Ext> — we read the official public Brawl Stars API. We send them a player tag; we send them nothing about you as a BrawlApex user.</LI>
                </UL>
              </Sec>

              <Sec {...SECTIONS[5]}>
                <Q>What about links to other sites?</Q>
                <P>
                  We occasionally link to third-party sites — Supercell's own pages, our service
                  providers' policies, and community resources. Those sites have their own,
                  independent privacy policies, and we have no responsibility or liability for their
                  content or practices. Once you follow a link, this policy no longer applies.
                </P>
              </Sec>

              <Sec {...SECTIONS[6]}>
                <Q>What about children?</Q>
                <P>
                  BrawlApex accounts are for people aged <Term>16 and over</Term>, and we do not
                  market the site to children. If you believe a younger child has created an account,
                  contact us and we will remove it.
                </P>
                <P>
                  Brawl Stars has a young player base, and we take one deliberate precaution because
                  of it: <Term>we do not offer a way to search for players by name.</Term> Match
                  history can only be reached by entering a player tag that you already have, so this
                  site is not a browsable directory of players. The opt-out in section 02 applies to
                  anyone, at any age, and a parent or guardian may use it on a child's behalf.
                </P>
              </Sec>

              <Sec {...SECTIONS[7]}>
                <Q>How long do you keep things?</Q>
                <UL>
                  <LI><Term>Account data</Term> — until you delete your account.</LI>
                  <LI><Term>Player match history</Term> — on a rolling window, oldest first, and deleted immediately if you opt out. Profiles that stop being active are dropped automatically.</LI>
                  <LI><Term>Tournament records and uploaded proof</Term> — kept after the tournament, because results, disputes and payouts have to stay auditable.</LI>
                  <LI><Term>Anonymous match statistics</Term> — kept on a rolling window; the oldest data is deleted automatically as new matches arrive.</LI>
                </UL>
              </Sec>

              <Sec {...SECTIONS[8]}>
                <Q>What rights do you have?</Q>
                <P>Under the GDPR you can ask us to:</P>
                <UL>
                  <LI>give you a copy of your data, or a portable export of it;</LI>
                  <LI>correct anything inaccurate;</LI>
                  <LI>delete your account and personal data;</LI>
                  <LI>restrict or object to how we use it.</LI>
                </UL>
                <P>
                  Email <Term>{CONTROLLER.email}</Term> and we will respond within 30 days. We honour
                  these requests wherever you live, not only in the EU. You also have the right to
                  complain to your national data protection authority.
                </P>
                <P>
                  Two honest limits on deletion. Your <Term>display name and player tag stay locked</Term>{" "}
                  even after deletion, because releasing them would let someone else claim your
                  competitive identity. And results of tournaments you already played remain in the
                  record, since erasing one participant would corrupt everyone else's bracket.
                </P>
              </Sec>

              <Sec {...SECTIONS[9]}>
                <Q>How do you get in touch?</Q>
                <P>
                  BrawlApex is an independent fan project, run by one person rather than a company.
                  For the purposes of the UK/EU GDPR, <Term>{CONTROLLER.operator}</Term> is the data
                  controller. Questions, access requests, deletion requests and tracking opt-outs all
                  go to the same place:
                </P>
                <Callout tone="violet">
                  <Term>{CONTROLLER.email}</Term>
                </Callout>
                <P>
                  BrawlApex is an independent fan project. It is not affiliated with, endorsed by, or
                  operated by Supercell.
                </P>
                <P><Link to="/about" style={{ color: "#9a8fc0" }}>About BrawlApex →</Link></P>
              </Sec>
            </div>
          </div>
        </div>

        <style>{`
          @media (max-width: 860px) {
            .legal-grid { grid-template-columns: minmax(0,1fr) !important; }
            .legal-grid > nav { position: static !important; }
          }
        `}</style>
      </div>
    </GuideShell>
  );
}

export function AboutPage() {
  const sections = [
    { id: "idea", n: "01", tag: "IDEA", title: "What This Is." },
    { id: "features", n: "02", tag: "FEATURES", title: "What You Can Do Here." },
    { id: "rules", n: "03", tag: "PRINCIPLES", title: "The Rules It Runs On." },
    { id: "data", n: "04", tag: "DATA", title: "Where The Data Comes From." },
    { id: "who", n: "05", tag: "WHO", title: "Who Runs It." },
  ];
  return (
    <GuideShell>
      <div style={{ position: "relative", zIndex: 2, maxWidth: 860, margin: "0 auto", padding: "48px 5vw 30px" }}>
        <LegalHeader
          eyebrow="ABOUT · BRAWLAPEX"
          title="About."
          lead="A free Brawl Stars stats and tournament site, built on real ranked match data rather than opinion."
        />
        <MetaStrip />
        <div style={{ marginTop: 36 }}>
          <Sec {...sections[0]}>
            <P>
              Most Brawl Stars tier lists are somebody's opinion with a nice layout. BrawlApex is
              built the other way round: every rating starts from real ranked matches, collected
              continuously from the official Brawl Stars API, and separated by rank bracket —
              because what wins in Diamond is not what wins in Masters, and averaging the two hides
              exactly the thing a competitive player needs to know.
            </P>
          </Sec>
          <Sec {...sections[1]}>
            <UL>
              <LI><Term>Tier list</Term> — win rates per map and mode, with honest sample sizes rather than a letter grade pulled from nowhere.</LI>
              <LI><Term>Draft assistant</Term> — pick and ban suggestions from measured head-to-head win rates, plus a read on which side the finished draft favours.</LI>
              <LI><Term>Brawler guides</Term> — written guides with real gameplay footage, per map and per mode.</LI>
              <LI><Term>Player history</Term> — free, permanent match history for any tag, with no paywall on your own past.</LI>
              <LI><Term>Tournaments</Term> — automated brackets with screenshot and battle-log verification. Free to enter, always.</LI>
            </UL>
          </Sec>
          <Sec {...sections[2]}>
            <UL>
              <LI><Term>Players never pay to compete.</Term> Tournament entry is free and will stay free.</LI>
              <LI><Term>No statistic is ever paywalled.</Term> If the data answers a question, the answer is free — including your own match history.</LI>
              <LI><Term>Display names and player tags are permanent.</Term> Your competitive identity cannot be sold, transferred or impersonated.</LI>
            </UL>
          </Sec>
          <Sec {...sections[3]}>
            <P>
              Match data comes from the official Brawl Stars API. Nothing is scraped from other fan
              sites, and nothing comes from modified clients or private endpoints. Statistics are
              rebuilt continuously as new matches arrive, and each balance patch is treated as its
              own era so a nerfed brawler's old numbers never prop up its current rating.
            </P>
            <P>
              How individual player history is handled — including how to stop it — is set out in
              the <Link to="/privacy" style={{ color: "#9a8fc0" }}>privacy policy</Link>.
            </P>
          </Sec>
          <Sec {...sections[4]}>
            <P>
              BrawlApex is built and maintained by one person. It is an independent project, not a
              company, and not affiliated with Supercell.
            </P>
            <P>Get in touch: <Term>{CONTROLLER.email}</Term></P>
            <P>
              This material is unofficial and is not endorsed by Supercell. For more information see{" "}
              <Ext href="https://supercell.com/en/fan-content-policy/">Supercell's Fan Content Policy</Ext>.
              Brawl Stars and its assets are trademarks of Supercell.
            </P>
          </Sec>
        </div>
      </div>
    </GuideShell>
  );
}
