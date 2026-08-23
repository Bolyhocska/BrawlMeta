// ─── Privacy policy, cookie notice, and About ────────────────────────────────
// Required before running ads in the EU, and a credibility signal for the
// Supercell Creator Program application (see docs/brawlify-analysis).
//
// EVERY factual claim below was checked against the code rather than assumed —
// a privacy policy that describes collection the site doesn't do (or, worse,
// omits collection it does) is more dangerous than none at all. Specifically:
//   · auth providers          src/auth.jsx (email/password + OAuth)
//   · profile fields          Profiles: id, email, display_name, player_tag,
//                             is_premium, avatar_url, provider, timestamps
//   · registration fields     Registrations: email, player_tag, display_name,
//                             team_name, friend_id, friend_qr_url
//   · uploads                 supabase.storage buckets match-proof,
//                             dodge-reports, tournament-banners — all served
//                             through getPublicUrl, i.e. PUBLIC once uploaded
//   · OCR                     api/_lib/ocr.js sends screenshots to Anthropic
//   · analytics               none — no gtag/plausible/posthog anywhere
//
// OWNER TODO before this is legally complete: fill in CONTROLLER below. A
// privacy policy has to name a real, contactable data controller; a site that
// won't say who runs it cannot claim GDPR compliance. Left as a placeholder
// deliberately rather than publishing a personal address without permission.

import { Link } from "react-router-dom";
import { GuideShell } from "./GuidesPages";

const MONO = "'JetBrains Mono', monospace";

// ⚠️ OWNER: replace both fields before relying on this page.
const CONTROLLER = {
  name: "[YOUR NAME OR REGISTERED ENTITY]",
  email: "[CONTACT EMAIL]",
};

const LAST_UPDATED = "24 August 2026";

function Page({ eyebrow, title, lead, children }) {
  return (
    <GuideShell>
      <div style={{ position: "relative", zIndex: 2, maxWidth: 860, margin: "0 auto", padding: "48px 5vw 20px" }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 9, padding: "9px 18px 9px 14px",
          borderRadius: 999, background: "rgba(13,13,20,.6)", border: "1px solid rgba(179,107,255,.3)",
          fontFamily: MONO, fontSize: 12, letterSpacing: 2.5, color: "#c98bff",
        }}>
          <span style={{ width: 7, height: 7, borderRadius: 999, background: "#b36bff" }} />
          {eyebrow}
        </div>
        <h1 style={{
          fontFamily: "'Baloo 2', sans-serif", fontSize: "clamp(30px, 5vw, 46px)",
          margin: "18px 0 10px", lineHeight: 1.12,
        }}>{title}</h1>
        {lead && <p style={{ margin: 0, color: "#a6a6b8", fontSize: 15, lineHeight: 1.75, maxWidth: 700 }}>{lead}</p>}
        <div style={{ marginTop: 10, fontFamily: MONO, fontSize: 11, letterSpacing: 1.4, color: "#5a5a6a" }}>
          LAST UPDATED · {LAST_UPDATED.toUpperCase()}
        </div>
        <div style={{ marginTop: 34 }}>{children}</div>
      </div>
    </GuideShell>
  );
}

function Section({ title, children }) {
  return (
    <section style={{
      marginBottom: 18, padding: "22px 24px", borderRadius: 14,
      background: "rgba(13,13,20,.55)", border: "1px solid rgba(255,255,255,.07)",
    }}>
      <h2 style={{
        fontFamily: MONO, fontSize: 12, letterSpacing: 2.2, color: "#ffce7a",
        margin: "0 0 14px", textTransform: "uppercase",
      }}>{title}</h2>
      <div style={{ color: "#c4c4d2", fontSize: 14.5, lineHeight: 1.78 }}>{children}</div>
    </section>
  );
}

const P = ({ children }) => <p style={{ margin: "0 0 12px" }}>{children}</p>;
const UL = ({ children }) => <ul style={{ margin: "0 0 12px", paddingLeft: 20 }}>{children}</ul>;
const LI = ({ children }) => <li style={{ marginBottom: 7 }}>{children}</li>;
const Term = ({ children }) => <strong style={{ color: "#e9e9f2" }}>{children}</strong>;
const Ext = ({ href, children }) => (
  <a href={href} target="_blank" rel="noreferrer" style={{ color: "#9a8fc0" }}>{children}</a>
);

export function PrivacyPolicyPage() {
  return (
    <Page
      eyebrow="LEGAL · PRIVACY"
      title="Privacy & Cookies"
      lead="What BrawlApex stores, why, who else sees it, and how to get it deleted. Written to be read, not to be survived."
    >
      <Section title="Who is responsible">
        <P>
          BrawlApex is run by <Term>{CONTROLLER.name}</Term>, who is the data controller for the
          purposes of the UK/EU GDPR. Questions, access requests and deletion requests go
          to <Term>{CONTROLLER.email}</Term>.
        </P>
        <P>
          BrawlApex is an independent fan project. It is not affiliated with, endorsed by, or
          operated by Supercell.
        </P>
      </Section>

      <Section title="You can use most of the site without an account">
        <P>
          The tier list, brawler guides, draft assistant and leaderboards need no account and no
          personal data. Browsing them stores nothing about you.
        </P>
      </Section>

      <Section title="What we store when you do sign up">
        <P>Accounts exist for one reason: entering and running tournaments. If you create one, we store:</P>
        <UL>
          <LI><Term>Your email address</Term> — to identify the account and contact you about tournaments you entered.</LI>
          <LI><Term>Your display name</Term> — public, permanent and unique. Chosen once, then locked.</LI>
          <LI><Term>Your Brawl Stars player tag</Term> — public. It freezes after your first tournament, which is what stops accounts being sold or impersonated.</LI>
          <LI><Term>Your sign-in method</Term> and, for Google/Discord sign-ins, the avatar image those services return.</LI>
          <LI><Term>Whether your account is premium</Term>, and your tournament winnings balance.</LI>
        </UL>
        <P>
          Passwords are handled entirely by our authentication provider and are never visible to
          BrawlApex.
        </P>
      </Section>

      <Section title="What you upload during a tournament">
        <P>Entering or running a tournament can involve uploading:</P>
        <UL>
          <LI><Term>Result screenshots</Term>, to verify who won a match.</LI>
          <LI><Term>Dodge reports</Term> (screenshots or video), if you report an opponent for not showing up.</LI>
          <LI><Term>Tournament banners</Term>, if you organise a tournament.</LI>
          <LI><Term>An in-game friend ID or friend QR code</Term>, so opponents can add you for the match.</LI>
        </UL>
        <P style={{
          margin: "14px 0 4px", padding: "13px 15px", borderRadius: 10,
          background: "rgba(255,180,61,.09)", border: "1px solid rgba(255,180,61,.28)", color: "#ffce7a",
        }}>
          Please read this one carefully: <Term>uploaded files are stored at public web addresses.</Term>{" "}
          Anyone holding the link can open them without signing in. Do not upload anything you would
          not be comfortable making public — in particular, crop out anything private before
          uploading a screenshot.
        </P>
      </Section>

      <Section title="Who else your data reaches">
        <P>BrawlApex uses a small number of processors, and no advertising or data brokers:</P>
        <UL>
          <LI><Ext href="https://supabase.com/privacy">Supabase</Ext> — database, authentication and file storage.</LI>
          <LI><Ext href="https://vercel.com/legal/privacy-policy">Vercel</Ext> — hosting. Vercel processes server logs, including IP addresses, to serve and secure the site.</LI>
          <LI><Ext href="https://www.anthropic.com/legal/privacy">Anthropic</Ext> — result screenshots are sent for automated reading so a match result can be verified without a human looking at it. They are not used to train models.</LI>
          <LI><Ext href="https://supercell.com/en/privacy-policy/">Supercell</Ext> — we read the official public Brawl Stars API to look up player and match information. We send them a player tag; we do not send them anything about you as a BrawlApex user.</LI>
        </UL>
        <P>We do not sell personal data, and we do not share it for advertising.</P>
      </Section>

      <Section title="Match data we collect about players generally">
        <P>
          BrawlApex analyses public ranked match data from the official Brawl Stars API to build the
          tier list and draft engine. This data records <Term>which brawlers were played on which
          map and who won</Term>. It does not identify players, and it is not linked to BrawlApex
          accounts.
        </P>
      </Section>

      <Section title="Cookies">
        <P>
          BrawlApex uses <Term>essential cookies only</Term>. They keep you signed in and nothing
          else. There are no analytics cookies, no advertising cookies and no third-party trackers
          on this site — so there is no consent banner, because there is nothing to consent to.
        </P>
        <P>
          If that ever changes, this page will say so before it happens, and a consent banner will
          appear.
        </P>
      </Section>

      <Section title="How long we keep things">
        <UL>
          <LI><Term>Account data</Term> — until you delete your account.</LI>
          <LI><Term>Tournament records and uploaded proof</Term> — kept after the tournament, because results, disputes and payouts have to stay auditable.</LI>
          <LI><Term>Anonymous match statistics</Term> — kept on a rolling window; the oldest data is deleted automatically as new matches arrive.</LI>
        </UL>
      </Section>

      <Section title="Your rights">
        <P>Under the GDPR you can ask us to:</P>
        <UL>
          <LI>give you a copy of your data, or a portable export of it;</LI>
          <LI>correct anything inaccurate;</LI>
          <LI>delete your account and personal data;</LI>
          <LI>restrict or object to how we use it.</LI>
        </UL>
        <P>
          Email <Term>{CONTROLLER.email}</Term> and we will respond within 30 days. You also have the
          right to complain to your national data protection authority.
        </P>
        <P>
          Two honest caveats on deletion. Your <Term>display name and player tag stay locked</Term>{" "}
          even after deletion, because releasing them would let someone else claim your competitive
          identity. And results of tournaments you already played remain in the record, since
          erasing one participant would corrupt everyone else's bracket.
        </P>
      </Section>

      <Section title="Children">
        <P>
          Accounts are for users aged 16 and over. If you believe a younger child has created one,
          contact us and we will remove it.
        </P>
      </Section>

      <Section title="Changes">
        <P>
          If this policy changes materially, the date at the top changes and signed-in users are
          notified.
        </P>
      </Section>

      <div style={{ padding: "6px 2px 30px", fontFamily: MONO, fontSize: 12, color: "#6f7180" }}>
        <Link to="/about" style={{ color: "#9a8fc0" }}>About BrawlApex →</Link>
      </div>
    </Page>
  );
}

export function AboutPage() {
  return (
    <Page
      eyebrow="ABOUT · BRAWLAPEX"
      title="What this is"
      lead="A free Brawl Stars stats and tournament site, built on real ranked match data rather than opinion."
    >
      <Section title="The idea">
        <P>
          Most Brawl Stars tier lists are somebody's opinion with a nice layout. BrawlApex is built
          the other way round: every rating starts from real ranked matches, collected continuously
          from the official Brawl Stars API, and separated by rank bracket — because what wins in
          Diamond is not what wins in Masters, and averaging the two hides exactly the thing a
          competitive player needs to know.
        </P>
      </Section>

      <Section title="What you can do here">
        <UL>
          <LI><Term>Tier list</Term> — win rates per map and mode, with confidence-honest sample sizes rather than a letter grade pulled from nowhere.</LI>
          <LI><Term>Draft assistant</Term> — pick and ban suggestions from measured head-to-head win rates, plus a read on which side the finished draft favours.</LI>
          <LI><Term>Brawler guides</Term> — written guides with real gameplay footage, per map and per mode.</LI>
          <LI><Term>Tournaments</Term> — automated brackets with screenshot and battle-log verification. Free to enter, always.</LI>
        </UL>
      </Section>

      <Section title="The rules this site runs on">
        <UL>
          <LI><Term>Players never pay to compete.</Term> Tournament entry is free and will stay free.</LI>
          <LI><Term>No statistic is ever paywalled.</Term> If the data answers a question, the answer is free.</LI>
          <LI><Term>Display names and player tags are permanent.</Term> Your competitive identity cannot be sold, transferred or impersonated.</LI>
        </UL>
      </Section>

      <Section title="Where the data comes from">
        <P>
          Match data comes from the official Brawl Stars API. Nothing is scraped from other fan
          sites, and nothing comes from modified clients or private endpoints. Statistics are
          rebuilt continuously as new matches arrive, and each balance patch is treated as its own
          era so a nerfed brawler's old numbers never prop up its current rating.
        </P>
      </Section>

      <Section title="Who runs it">
        <P>
          BrawlApex is built and maintained by <Term>{CONTROLLER.name}</Term>. It is an independent
          project, not a company, and not affiliated with Supercell.
        </P>
        <P>Get in touch: <Term>{CONTROLLER.email}</Term></P>
      </Section>

      <Section title="Legal">
        <P>
          This material is unofficial and is not endorsed by Supercell. For more information see{" "}
          <Ext href="https://supercell.com/en/fan-content-policy/">Supercell's Fan Content Policy</Ext>.
          Brawl Stars and its assets are trademarks of Supercell.
        </P>
        <P><Link to="/privacy" style={{ color: "#9a8fc0" }}>Privacy &amp; cookie policy →</Link></P>
      </Section>
    </Page>
  );
}
