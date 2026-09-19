// ─── Player insight panels ────────────────────────────────────────────────────
// The analytical half of a player profile, shared by /player/:tag and /profile.
// Implements the first block of docs/brawlify-analysis/PROFILE-FEATURE-SPEC.md
// §6's build order: OV-1 Above Draft, DR-2 draft buckets, OV-2 event facts,
// OV-4 coverage, OP-3/OP-4 squad and rivals.
//
// Every panel goes through the display ladder in playerStats.js:
//   n = 0          → the panel does not render at all. No empty charts.
//   n < threshold  → the raw record and how far off we are. Never a percentage.
//   n ≥ threshold  → the shrunk estimate with a band.
//   band clears 0  → and only now, a sentence with an opinion in it.
// The point is that this page must never sound confident about noise. Most of
// what a tracked player has today is noise, and saying so is the feature.

import { useState, useEffect, useMemo } from "react";
import {
  toSeries, gradeSeries, aboveDraft, draftBuckets, eventFacts,
  squadAndRivals, ladderState, LADDER, classFingerprint, nemesisTable,
  loadIntelligence, DEFAULT_BRACKET, draftTracking,
  baselineRate, vsBrawlers, withBrawlers, vsClassRates, modeRates, mapRates,
  brawlerModeOutliers, classSplit, PANEL_MIN_ROWS,
  mostEncountered, lossConcentration, modeImprovement,
  partyBreakdown, tiltCurve, sessionDepth, timeOfDay, poolBreadth, starRates,
} from "./data/playerStats";
import { DonutChart } from "./Charts";
import { classLabel } from "./data/draftEngine";
import { formatBrawlerName, formatMode } from "./appCore";
import { BrawlerIcon, MapThumb, ModeIcon } from "./MetaIcons";

const MONO = "'JetBrains Mono', monospace";
const DISPLAY = "'Baloo 2', sans-serif";

const CARD = {
  padding: "18px 20px", borderRadius: 16, marginBottom: 14,
  background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)",
};
const EYEBROW = { fontFamily: MONO, fontSize: 11, letterSpacing: 1.9, color: "#8b8b9c", marginBottom: 10 };
const NOTE = { fontFamily: MONO, fontSize: 10, color: "#7c7e8f", marginTop: 10, lineHeight: 1.65 };

// ── collapsible section ──────────────────────────────────────────────────────
// Every panel is a Section so the page can be folded down to the parts a
// player cares about. Eleven cards is a long scroll, and which ones matter
// differs per person — someone checking matchups does not want to pass the
// donut every time.
//
// Open/closed is remembered per section in localStorage, keyed by title.
// Deliberately per-browser rather than in the profile: it is a reading
// preference, not data about the player, and it must work for a signed-out
// visitor reading someone else's profile. Every access is wrapped — Safari
// private mode THROWS on localStorage rather than returning null, and an
// unhandled throw here would take the whole page down to save a chevron.
const SECTION_STATE_PREFIX = "bm.profile.open.";

function readSectionOpen(key, fallback) {
  try {
    const v = window.localStorage.getItem(SECTION_STATE_PREFIX + key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

function Section({ title, children, defaultOpen = true, storageKey }) {
  const key = storageKey || (typeof title === "string" ? title : "section");
  const [open, setOpen] = useState(() => readSectionOpen(key, defaultOpen));

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev;
      try { window.localStorage.setItem(SECTION_STATE_PREFIX + key, next ? "1" : "0"); } catch { /* unavailable */ }
      return next;
    });
  };

  return (
    <div style={{ ...CARD, padding: 0, overflow: "hidden" }}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
          width: "100%", padding: "15px 20px", cursor: "pointer", textAlign: "left",
          background: "transparent", border: "none",
          ...EYEBROW, marginBottom: 0,
        }}
      >
        <span style={{ minWidth: 0 }}>{title}</span>
        {/* A caret rather than +/-: it rotates, so the open state is legible
            at a glance across a column of eleven headers. */}
        <span aria-hidden="true" style={{
          flexShrink: 0, color: "#8b8b9c", fontSize: 10, lineHeight: 1,
          transform: open ? "rotate(180deg)" : "none", transition: "transform .15s ease",
        }}>▼</span>
      </button>
      {open && <div style={{ padding: "0 20px 18px" }}>{children}</div>}
    </div>
  );
}

// ── OV-1 Above Draft ─────────────────────────────────────────────────────────

function AboveDraftChart({ points }) {
  if (points.length < 2) return null;
  const W = 560, H = 130, PAD = 8;
  const maxAbs = Math.max(1, ...points.map(p => Math.abs(p.delta) + 2 * p.se));
  const x = (i) => PAD + (i / (points.length - 1)) * (W - 2 * PAD);
  const y = (v) => H / 2 - (v / maxAbs) * (H / 2 - PAD);

  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.delta).toFixed(1)}`).join("");
  const upper = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.delta + 2 * p.se).toFixed(1)}`).join("");
  const lower = points.slice().reverse()
    .map((p, i) => `L${x(points.length - 1 - i).toFixed(1)},${y(p.delta - 2 * p.se).toFixed(1)}`).join("");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      {/* the ribbon is the honesty: the reader sees the uncertainty instead of
          being told about it in a footnote they will not read */}
      <path d={`${upper}${lower}Z`} fill="rgba(179,107,255,.16)" />
      <line x1={PAD} x2={W - PAD} y1={y(0)} y2={y(0)} stroke="rgba(255,255,255,.22)" strokeDasharray="3 4" />
      <path d={line} fill="none" stroke="#c9a6ff" strokeWidth="2.2" strokeLinejoin="round" />
      <circle cx={x(points.length - 1)} cy={y(points[points.length - 1].delta)} r="3.6" fill="#c9a6ff" />
    </svg>
  );
}

// ── the two "so what do I do" leads ──────────────────────────────────────────
// Both exist because a diagnosis with no lead is just a scoreboard. Both are
// also careful about the line they must not cross: we can see WHERE results
// go wrong, never WHY, because a battlelog records outcomes and compositions
// and nothing about how the game was played. Every sentence below is a
// pointer at the player's own measured splits, not coaching inferred from
// them.

/** Where a negative Above-Draft gap concentrates. */
function LossLead({ series }) {
  const { worstMode, worstClass } = useMemo(() => lossConcentration(series || []), [series]);
  if (!worstMode && !worstClass) return null;

  return (
    <div style={{
      marginTop: 11, padding: "11px 13px", borderRadius: 10,
      background: "rgba(255,143,143,.06)", border: "1px solid rgba(255,143,143,.18)",
    }}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1.4, color: "#ff8f8f", marginBottom: 6 }}>
        WHERE IT GOES WRONG
      </div>
      <div style={{ fontSize: 13.5, lineHeight: 1.7, color: "#c9c9d6" }}>
        {worstMode && (
          <>
            Those losses are not spread evenly — you are{" "}
            <strong style={{ color: "#ff8f8f" }}>{signed(worstMode.delta * 100)}</strong> in{" "}
            <strong style={{ color: "#e9e9f2" }}>{formatMode(worstMode.key)}</strong>{" "}
            ({worstMode.wins}&ndash;{worstMode.n - worstMode.wins}).{" "}
          </>
        )}
        {worstClass && (
          <>
            Against <strong style={{ color: "#e9e9f2" }}>{classLabel(worstClass.key)}</strong> you are{" "}
            <strong style={{ color: "#ff8f8f" }}>{signed(worstClass.delta * 100)}</strong>{" "}
            ({worstClass.wins}&ndash;{worstClass.n - worstClass.wins}).{" "}
          </>
        )}
        Start there — it is the largest measured gap you have.
      </div>
      <div style={{ ...NOTE, marginTop: 8 }}>
        This says where, not why. Positioning, trades and objective timing are not in a
        battlelog, so nothing here can separate a bad rotation from bad luck — only tell you
        which games to go and watch.
      </div>
    </div>
  );
}

/** What the player brings to their worst mode versus their best ones. */
function ModeLead({ series }) {
  const lead = useMemo(() => modeImprovement(series || []), [series]);
  if (!lead) return null;
  const { mode, over } = lead;

  return (
    <div style={{
      marginTop: 16, padding: "11px 13px", borderRadius: 10,
      background: "rgba(255,206,122,.06)", border: "1px solid rgba(255,206,122,.18)",
    }}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1.4, color: "#ffce7a", marginBottom: 6 }}>
        YOUR WEAKEST MODE
      </div>
      <div style={{ fontSize: 13.5, lineHeight: 1.7, color: "#c9c9d6" }}>
        <strong style={{ color: "#e9e9f2" }}>{formatMode(mode.key)}</strong> is your worst mode at{" "}
        {Math.round(mode.raw * 100)}% ({mode.wins}&ndash;{mode.n - mode.wins}),{" "}
        <strong style={{ color: "#ff8f8f" }}>{signed(mode.delta * 100)}</strong> on your own rate.{" "}
        {over ? (
          <>
            The clearest difference in what you bring: you draft{" "}
            <strong style={{ color: "#e9e9f2" }}>{classLabel(over.cls)}</strong> in{" "}
            {Math.round((over.inBad / over.badTotal) * 100)}% of your {formatMode(mode.key)} games,
            about {Math.round(over.gap * 100)} points more than in the modes you win. Worth trying a
            draft there that looks more like the ones that work for you.
          </>
        ) : (
          <>
            Your draft mix there looks much like the modes you win, so this is not a pick-pattern
            problem — compare it against the map pages for {formatMode(mode.key)} instead.
          </>
        )}
      </div>
    </div>
  );
}

function AboveDraftPanel({ ad, series }) {
  if (!ad.n) return null;
  const state = ladderState(ad.n, 10, ad.bandExcludesZero);
  const sign = ad.delta >= 0 ? "+" : "";
  const colour = !ad.bandExcludesZero ? "#c9c9d6" : ad.delta > 0 ? "#8ee6b0" : "#ff8f8f";

  return (
    <Section title="ABOVE DRAFT">

      {state === LADDER.RECORD_ONLY ? (
        <>
          <div style={{ fontFamily: DISPLAY, fontSize: 19, fontWeight: 700, color: "#e9e9f2" }}>
            {ad.n} draft{ad.n === 1 ? "" : "s"} graded so far
          </div>
          <div style={NOTE}>
            Your drafts were worth about {ad.expected.toFixed(1)} wins and you took {ad.actual}.
            We need {10 - ad.n} more before this is worth charting.
          </div>
        </>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
            <span style={{ fontFamily: DISPLAY, fontSize: 34, fontWeight: 800, color: colour, lineHeight: 1 }}>
              {sign}{ad.delta.toFixed(1)}
            </span>
            <span style={{ fontFamily: MONO, fontSize: 11, color: "#8a8a9c" }}>
              wins vs what your drafts were worth
            </span>
          </div>
          <div style={{ fontFamily: MONO, fontSize: 11.5, color: "#8a8a9c", marginBottom: 12 }}>
            {ad.n} drafts · worth {ad.expected.toFixed(1)} · you took {ad.actual} · ±{(2 * ad.se).toFixed(1)}
          </div>

          <AboveDraftChart points={ad.points} />

          <div style={{ marginTop: 10, fontSize: 13.5, lineHeight: 1.7, color: "#c9c9d6" }}>
            {ad.bandExcludesZero
              ? (ad.delta > 0
                  ? "You win more than your drafts deserve — you're taking games the picks didn't give you."
                  : "You're losing games your drafts had already won. The picks aren't the problem.")
              : "So far, indistinguishable from your drafts — which is most players. Come back with more games."}
          </div>

          {/* Nothing in a battlelog records execution, so this panel cannot say
              WHY a won draft was lost. What it can do is say where those losses
              cluster, which is a lead rather than a guess — and saying "we
              cannot see the rest" is the honest other half. */}
          {ad.bandExcludesZero && ad.delta < 0 && <LossLead series={series} />}

          <div style={NOTE}>
            Each draft is graded by the same engine the Draft Assistant uses, on measured win rates
            for that map — matchup edge, not skill. The shaded band is two standard errors; a verdict
            only appears once it clears zero. It widens with more drafts because it tracks a running
            total, while the gap it has to beat grows faster.
          </div>
        </>
      )}
    </Section>
  );
}

// ── DR-2 favoured / even / underdog ──────────────────────────────────────────

function BucketsPanel({ buckets }) {
  const order = [
    ["favoured", "DRAFTS YOU WERE FAVOURED IN", "#8ee6b0"],
    ["even", "COIN-FLIP DRAFTS", "#ffce7a"],
    ["underdog", "DRAFTS AGAINST YOU", "#ff8f8f"],
  ];
  const total = order.reduce((a, [k]) => a + buckets[k].n, 0);
  if (!total) return null;
  const tracking = draftTracking(buckets);

  return (
    <Section title="PICKS OR PLAY?">
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
        {order.map(([k, label, colour]) => {
          const b = buckets[k];
          const show = b.n >= 12;
          return (
            <div key={k} style={{
              padding: "12px 14px", borderRadius: 12,
              background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.07)",
            }}>
              <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: 1.3, color: "#8b8b9c", lineHeight: 1.4 }}>
                {label}
              </div>
              <div style={{ fontFamily: DISPLAY, fontSize: 21, fontWeight: 800, color: show ? colour : "#c9c9d6", marginTop: 5 }}>
                {show ? `${(b.rate * 100).toFixed(0)}%` : `${b.wins}–${b.n - b.wins}`}
              </div>
              <div style={{ fontFamily: MONO, fontSize: 11, color: "#7c7e8f", marginTop: 2 }}>
                {show ? `${b.wins}–${b.n - b.wins} in ${b.n} drafts` : `needs ${12 - b.n} more`}
              </div>
            </div>
          );
        })}
      </div>
      {tracking.verdict && (
        <div style={{ marginTop: 12, fontSize: 13.5, lineHeight: 1.7, color: "#c9c9d6" }}>
          {tracking.verdict === "tracks"
            ? "You convert the drafts you should win and rarely steal the others — your results follow your picks closely."
            : "You win a lot of drafts you shouldn't. Your results are less tied to the picks than most."}
        </div>
      )}
      <div style={NOTE}>
        A draft counts as favoured above 56% and against you below 44%. Drafts cluster near even, so
        the outer buckets fill slowest.
      </div>
    </Section>
  );
}

// ── OV-2 event facts ─────────────────────────────────────────────────────────

function FactsStrip({ facts }) {
  if (!facts.length) return null;
  return (
    <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
      {facts.slice(0, 4).map((f, i) => (
        <div key={i} style={{
          display: "flex", gap: 11, alignItems: "flex-start",
          padding: "12px 15px", borderRadius: 12,
          background: "linear-gradient(160deg, rgba(179,107,255,.10), rgba(13,13,20,.4))",
          border: "1px solid rgba(179,107,255,.24)",
        }}>
          <span style={{ fontSize: 15, lineHeight: 1.35 }}>{f.icon}</span>
          <span style={{ fontSize: 13.5, lineHeight: 1.6, color: "#e2e2ec" }}>{f.text}</span>
        </div>
      ))}
    </div>
  );
}

// ── OP-3 / OP-4 squad and rivals ─────────────────────────────────────────────

function PeoplePanel({ squad, rivals, onOpen }) {
  if (!squad.length && !rivals.length) return null;
  const Row = ({ p, kind }) => (
    <button onClick={() => onOpen(p.tag)} style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
      width: "100%", padding: "8px 11px", borderRadius: 9, cursor: "pointer", textAlign: "left",
      background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.06)", color: "#c9c9d6",
      fontFamily: MONO, fontSize: 11,
    }}>
      <span>{p.tag}</span>
      <span style={{ color: "#8b8b9c", display: "flex", gap: 8, alignItems: "baseline" }}>
        {/* A rate only once the pair has 10 together/against — below that the
            count is the honest output and a percentage would be theatre. */}
        {p.n >= 10 && (
          <span style={{ color: (p.wins / p.n) >= 0.5 ? "#8ee6b0" : "#ff8f8f", fontWeight: 700 }}>
            {Math.round((p.wins / p.n) * 100)}%
          </span>
        )}
        <span>{p.wins}&ndash;{p.n - p.wins} {kind === "squad" ? "together" : "against"}</span>
      </span>
    </button>
  );
  return (
    <Section title="PEOPLE YOU KEEP MEETING">
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))" }}>
        {squad.length > 0 && (
          <div>
            <div style={{ fontFamily: MONO, fontSize: 11, color: "#8ee6b0", marginBottom: 7 }}>TEAMMATES</div>
            <div style={{ display: "grid", gap: 5 }}>
              {squad.slice(0, 5).map(p => <Row key={p.tag} p={p} kind="squad" />)}
            </div>
          </div>
        )}
        {rivals.length > 0 && (
          <div>
            <div style={{ fontFamily: MONO, fontSize: 11, color: "#ff8f8f", marginBottom: 7 }}>OPPONENTS</div>
            <div style={{ display: "grid", gap: 5 }}>
              {rivals.slice(0, 5).map(p => <Row key={p.tag} p={p} kind="rival" />)}
            </div>
          </div>
        )}
      </div>
      <div style={NOTE}>
        Your record with or against each person. The percentage appears once you have
        met them 10 times; the raw record below that is true at any sample.
        For teammates this is a PLAYER, not a brawler — the brawler version is in
        &ldquo;best alongside you&rdquo; above.
      </div>
    </Section>
  );
}


// ── BR-2 draft fingerprint ───────────────────────────────────────────────────
// The cold-start feature, and the reason it works is that it is a DISTRIBUTION
// rather than a rate. At 20 drafts a win rate is worthless, but someone who has
// picked 20 times genuinely does have a taste — and "you have never once picked
// a tank" is true and interesting from the very first week.

function FingerprintPanel({ rows, n }) {
  if (!rows || !rows.length) return null;
  const max = Math.max(...rows.map(r => Math.max(r.mine, r.theirs)), 0.1);
  const never = rows.filter(r => r.count === 0 && r.theirs > 0.05);
  const top = rows.find(r => r.notable && r.diff > 0);

  return (
    <Section title="YOUR DRAFT FINGERPRINT">

      <div style={{ display: "grid", gap: 7 }}>
        {rows.filter(r => r.mine > 0 || r.theirs > 0.02).map(r => (
          <div key={r.cls} style={{ display: "grid", gridTemplateColumns: "104px 1fr 62px", gap: 10, alignItems: "center" }}>
            <span style={{ fontFamily: MONO, fontSize: 10, color: r.notable ? "#e9e9f2" : "#8a8a9c" }}>
              {classLabel(r.cls)}
            </span>
            <div style={{ display: "grid", gap: 3 }}>
              <div style={{ height: 7, borderRadius: 999, background: "rgba(255,255,255,.05)" }}>
                <div style={{ width: `${(r.mine / max) * 100}%`, height: "100%", borderRadius: 999, background: "#c9a6ff" }} />
              </div>
              <div style={{ height: 7, borderRadius: 999, background: "rgba(255,255,255,.05)" }}>
                <div style={{ width: `${(r.theirs / max) * 100}%`, height: "100%", borderRadius: 999, background: "rgba(255,255,255,.20)" }} />
              </div>
            </div>
            <span style={{ fontFamily: MONO, fontSize: 10, color: "#8b8b9c", textAlign: "right" }}>
              {(r.mine * 100).toFixed(0)}% / {(r.theirs * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 14, marginTop: 10, fontFamily: MONO, fontSize: 11, color: "#8b8b9c" }}>
        <span><span style={{ color: "#c9a6ff" }}>▬</span> you</span>
        <span><span style={{ color: "rgba(255,255,255,.4)" }}>▬</span> everyone in your bracket</span>
      </div>

      {/* Prose only where the gap clears 2 SE of a multinomial share at this n. */}
      {(top || never.length > 0) && (
        <div style={{ marginTop: 11, fontSize: 13.5, lineHeight: 1.7, color: "#c9c9d6" }}>
          {top && `You reach for ${classLabel(top.cls)} far more than the field — ${(top.mine * 100).toFixed(0)}% of your drafts against ${(top.theirs * 100).toFixed(0)}%. `}
          {never.length > 0 && `You have never once picked ${never.map(x => classLabel(x.cls)).join(" or ")}.`}
        </div>
      )}

      <div style={NOTE}>
        Share of picks, not win rate — so this is meaningful long before any rate is.
        {n < 20 && ` Differences aren't called out until 20 drafts; you have ${n}.`}
      </div>
    </Section>
  );
}


// ── OP-2 the nemesis table ───────────────────────────────────────────────────
// Two columns on purpose. The field column is real today, from 1.8M matches.
// The personal column will take most players months to fill for most brawlers,
// so it shows its own progress instead of pretending. Watching your column
// arrive is the point, not a consolation for it being empty.

function NemesisPanel({ table }) {
  if (!table || table.rows.length < 3) return null;
  const worst = table.rows.slice(0, 6);

  return (
    <Section title={<>WHAT BEATS YOUR {formatBrawlerName(table.brawler).toUpperCase()}</>}>

      <div style={{ fontFamily: MONO, fontSize: 10.5, color: "#8a8a9c", marginBottom: 11 }}>
        Your most-drafted brawler — {table.played} draft{table.played === 1 ? "" : "s"}.
        Hardest matchups across everyone in your bracket:
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        {worst.map(r => (
          <div key={r.enemy} style={{
            display: "grid", gridTemplateColumns: "1fr auto auto", gap: 12, alignItems: "center",
            padding: "9px 12px", borderRadius: 10,
            background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.06)",
          }}>
            <span style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: "#e2e2ec", minWidth: 0 }}>
              <BrawlerIcon name={r.enemy} size={24} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {formatBrawlerName(r.enemy)}
              </span>
            </span>
            <span style={{ fontFamily: MONO, fontSize: 11, color: r.popRate < 45 ? "#ff8f8f" : "#c9c9d6", textAlign: "right" }}>
              {r.popRate.toFixed(1)}%
              {/* the sample is what justifies trusting this column, so show it */}
              <span style={{ color: "#7c7e8f", fontSize: 10.5 }}> · {r.popPicks.toLocaleString("en-US")} games</span>
            </span>
            <span style={{ fontFamily: MONO, fontSize: 10, color: "#8b8b9c", textAlign: "right", minWidth: 96 }}>
              {r.mine
                ? (r.qualified
                    ? `you ${((r.mine.wins / r.mine.n) * 100).toFixed(0)}%`
                    : `you ${r.mine.wins}–${r.mine.n - r.mine.wins} · +${table.personalMin - r.mine.n} more`)
                : "not faced yet"}
            </span>
          </div>
        ))}
      </div>

      <div style={NOTE}>
        Field rates come from every ranked match we hold at your bracket, so they are solid now.
        Your own column needs {table.personalMin} drafts against a brawler before it becomes a
        percentage — until then it shows the raw record and how far off it is.
      </div>
    </Section>
  );
}


// ── PR-1 trophy curve ────────────────────────────────────────────────────────
// Free, for every tracked player, no account and no boost. Brawlify charges
// $4.99/mo for roughly this and our own analysis called that "the least
// defensible paywall on the site" — shipping it behind a signup wall would have
// been the same shape. Boost only buys per-brawler detail daily instead of
// weekly; the curve itself is never withheld.

// MOVED OFF THE PROFILE 2026-09-19 (owner): trophies are a TROPHY-LADDER
// stat and this page is explicitly ranked-only — the header says
// "competitive Ranked only" and every other panel honours that, so a
// trophy curve sitting among them invited exactly the comparison the rest
// of the page is careful to avoid. Still exported, and it fetches nothing
// itself: pass it rows from player_snapshots wherever trophies belong.
export function TrophyCurve({ snapshots }) {
  if (!snapshots || snapshots.length < 2) return null;
  const pts = snapshots
    .filter(s => Number.isFinite(Number(s.trophies)))
    .map(s => ({ t: new Date(s.taken_at).getTime(), v: Number(s.trophies) }))
    .sort((a, b) => a.t - b.t);
  if (pts.length < 2) return null;

  const W = 560, H = 110, PAD = 8;
  const lo = Math.min(...pts.map(p => p.v)), hi = Math.max(...pts.map(p => p.v));
  const span = Math.max(1, hi - lo);
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
  const x = (t) => PAD + ((t - t0) / Math.max(1, t1 - t0)) * (W - 2 * PAD);
  const y = (v) => H - PAD - ((v - lo) / span) * (H - 2 * PAD);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const net = pts[pts.length - 1].v - pts[0].v;
  const days = Math.max(1, Math.round((t1 - t0) / 86400000));

  return (
    <Section title="TROPHY HISTORY">
      <div style={{ display: "flex", alignItems: "baseline", gap: 11, flexWrap: "wrap", marginBottom: 10 }}>
        <span style={{ fontFamily: DISPLAY, fontSize: 26, fontWeight: 800, color: "#ffce7a" }}>
          {pts[pts.length - 1].v.toLocaleString("en-US")}
        </span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: net >= 0 ? "#8ee6b0" : "#ff8f8f" }}>
          {net >= 0 ? "+" : ""}{net.toLocaleString("en-US")} over {days} day{days === 1 ? "" : "s"}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
        <path d={d} fill="none" stroke="#ffce7a" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(pts[pts.length - 1].t)} cy={y(pts[pts.length - 1].v)} r="3.4" fill="#ffce7a" />
      </svg>
      <div style={NOTE}>
        One point a day from when tracking started — free for everyone, no account needed.
        {pts.length < 7 && ` ${pts.length} days so far; the shape gets meaningful after a week or two.`}
      </div>
    </Section>
  );
}

// ── OV-4 coverage ────────────────────────────────────────────────────────────

export function CoverageLine({ tracked, seriesCount }) {
  if (!tracked) return null;
  // The tracker halves poll_interval_mins whenever a poll returned >=20 new
  // battles — i.e. it was outrun and lost games. Anything below the tier-2
  // default of 720 means that has happened.
  const outrun = (tracked.poll_interval_mins || 720) < 720;
  return (
    <div style={{ ...NOTE, marginTop: 0, marginBottom: 14 }}>
      {seriesCount} draft{seriesCount === 1 ? "" : "s"} tracked
      {tracked.first_seen_at && ` since ${new Date(tracked.first_seen_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`}
      {" · competitive Ranked only."}
      {outrun && (
        <span style={{ color: "#ffce7a" }}>
          {" "}You play faster than we poll, so we're probably missing games — boost to narrow the gap.
        </span>
      )}
    </div>
  );
}

// ── the composed section ─────────────────────────────────────────────────────

/**
 * @param compact  Hub mode: the headline number and the form only, with a link
 *   through to the full public profile. /profile is a hub — it should summarise
 *   and route, not re-render everything that lives on /player/:tag.
 */
// ── OP-3 breakdowns: opponents, teammates, context ───────────────────────────
// All of these read "against YOUR OWN normal", so a +6pp row means six points
// better than this player's overall rate, not six points above 50. That framing
// is what makes them useful at these sample sizes: a 48% player who is 54% into
// throwers has learned something real about themselves.
//
// Every row prints its record, and the delta is the SHRUNK one. Rows under
// their floor are still listed — the count is honest information — but greyed
// and never given a percentage.

const pct = (x) => `${(x * 100).toFixed(0)}%`;
const signed = (pts) => `${pts >= 0 ? "+" : ""}${pts.toFixed(1)}pp`;
const deltaColor = (pts, qualified) =>
  !qualified ? "#6b6d7c" : pts >= 0 ? "#8ee6b0" : "#ff8f8f";

/** One list of bucketed rates. Shared by every breakdown below. */
function RateRows({
  rows, labelOf = (r) => r.key, max = 6, emptyMessage = "Nothing yet.",
  iconOf = null, showRate = false,
}) {
  const shown = rows.slice(0, max);
  if (!shown.length) {
    return <div style={{ fontFamily: MONO, fontSize: 11, color: "#7c7e8f" }}>{emptyMessage}</div>;
  }
  // Scale from RATED rows only. An unqualified row's shrunk delta can be the
  // largest on the panel (a 11-2 record shrinks to a big number on a small n),
  // and letting it set the scale draws the eye straight to the one row we are
  // deliberately not rating.
  const rated = shown.filter((r) => r.qualified);
  const widest = Math.max(...(rated.length ? rated : shown).map((r) => Math.abs(r.delta * 100)), 3);
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {shown.map((r) => {
        const pts = r.delta * 100;
        const col = deltaColor(pts, r.qualified);
        return (
          <div key={r.key} style={{
            display: "grid", gap: 8, alignItems: "center",
            gridTemplateColumns: showRate ? "1fr 44px 56px 42px" : "1fr 64px 46px",
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{
                display: "flex", alignItems: "center", gap: 6,
                fontFamily: MONO, fontSize: 11.5, color: r.qualified ? "#e9e9f2" : "#8a8a9c",
              }}>
                {iconOf ? iconOf(r) : null}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {labelOf(r)}
                </span>
              </div>
              {/* Centred on the player's own baseline, so left of centre is
                  literally "worse than you usually are". */}
              <div style={{ position: "relative", height: 5, borderRadius: 999, background: "rgba(255,255,255,.05)", marginTop: 3 }}>
                <div style={{ position: "absolute", left: "50%", top: -1, bottom: -1, width: 1, background: "rgba(255,255,255,.18)" }} />
                {/* No bar at all below the floor. A dimmed bar still asserts a
                    magnitude, and an 11-2 record shrinks to a large delta, so the
                    row we are explicitly refusing to rate was drawing the longest
                    bar on the panel. The record on the right is the honest output. */}
                {r.qualified && (
                  <div style={{
                    position: "absolute", top: 0, bottom: 0, borderRadius: 999, background: col,
                    left: pts >= 0 ? "50%" : `${50 - Math.min(Math.abs(pts) / widest, 1) * 50}%`,
                    width: `${Math.min(Math.abs(pts) / widest, 1) * 50}%`,
                  }} />
                )}
              </div>
            </div>
            {showRate && (
              /* The absolute rate, which is what people actually want to read off
                 a map or mode row. The delta beside it is what makes it mean
                 something — 57% is only good if you are not a 60% player. */
              <span style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 700,
                             color: r.qualified ? "#e9e9f2" : "#6b6d7c", textAlign: "right" }}>
                {r.n ? `${Math.round(r.raw * 100)}%` : "—"}
              </span>
            )}
            <span style={{ fontFamily: MONO, fontSize: 11, color: col, textAlign: "right" }}>
              {r.qualified ? signed(pts) : "—"}
            </span>
            <span style={{ fontFamily: MONO, fontSize: 10, color: "#7c7e8f", textAlign: "right" }}>
              {r.wins}-{r.n - r.wins}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Pick share by class as a donut, with each class's own win rate alongside. */
function ClassDonutPanel({ series }) {
  const rows = classSplit(series);
  if (rows.length < 2) return null;
  const base = baselineRate(series);

  return (
    <Section title="WHAT YOU PLAY · SHARE OF DRAFTS">
      <DonutChart
        size={180}
        thickness={30}
        centreLabel={series.length}
        centreSub="drafts"
        rows={rows.map((r) => ({
          label: r.label,
          value: r.n,
          note: r.qualified ? pct(r.rate) : `${r.n}`,
          noteColor: r.qualified ? (r.rate >= base ? "#8ee6b0" : "#ff8f8f") : "#6b6d7c",
        }))}
      />
      <div style={NOTE}>
        Slice size is share of your drafts. The figure on the right is your win rate on
        that class once it clears 15 drafts, green if it beats your own {pct(base)}{" "}
        overall — otherwise it shows the draft count so far.
      </div>
    </Section>
  );
}

/** Win rate INTO each enemy class — the "how do I do against throwers" panel. */
function VsClassPanel({ series }) {
  const rows = vsClassRates(series).filter((r) => r.n > 0);
  if (rows.filter((r) => r.qualified).length < PANEL_MIN_ROWS) return null;
  const best = rows.find((r) => r.qualified);
  const worst = [...rows].reverse().find((r) => r.qualified);

  return (
    <Section title="HOW YOU DO AGAINST EACH CLASS">
      <RateRows rows={rows} max={8} showRate labelOf={(r) => classLabel(r.key) || r.key} />
      {best && worst && best.key !== worst.key && (
        <div style={{ marginTop: 11, fontSize: 13.5, lineHeight: 1.7, color: "#c9c9d6" }}>
          You handle <strong style={{ color: "#8ee6b0" }}>{classLabel(best.key)}</strong> better
          than anything else ({signed(best.delta * 100)} on your own rate), and{" "}
          <strong style={{ color: "#ff8f8f" }}>{classLabel(worst.key)}</strong> worst (
          {signed(worst.delta * 100)}).
        </div>
      )}
      <div style={NOTE}>
        Measured against your own overall rate, not 50%. A draft with two of a class counts
        once — the unit is the draft, and double-counting would shrink the error bar on a
        sample that never grew.
      </div>
    </Section>
  );
}

/** Best and worst specific opponents, and best teammate brawlers. */
function MatchupPanel({ series }) {
  const vs = vsBrawlers(series).filter((r) => r.qualified);
  const wth = withBrawlers(series).filter((r) => r.qualified);
  if (vs.length < PANEL_MIN_ROWS && wth.length < PANEL_MIN_ROWS) return null;

  return (
    <Section title="SPECIFIC BRAWLERS">
      <div style={{ display: "grid", gap: 18, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        {vs.length >= PANEL_MIN_ROWS && (
          <div>
            <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: 1.2, color: "#8ee6b0", marginBottom: 8 }}>
              YOU BEAT
            </div>
            <RateRows rows={vs.slice(0, 5)} max={5} labelOf={(r) => formatBrawlerName(r.key)} iconOf={(r) => <BrawlerIcon name={r.key} size={20} />} />
            <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: 1.2, color: "#ff8f8f", margin: "14px 0 8px" }}>
              YOU LOSE TO
            </div>
            <RateRows rows={vs.slice(-5).reverse()} max={5} labelOf={(r) => formatBrawlerName(r.key)} iconOf={(r) => <BrawlerIcon name={r.key} size={20} />} />
          </div>
        )}
        {wth.length >= PANEL_MIN_ROWS && (
          <div>
            <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: 1.2, color: "#c9a6ff", marginBottom: 8 }}>
              BEST ALONGSIDE YOU
            </div>
            <RateRows rows={wth.slice(0, 6)} max={6} labelOf={(r) => formatBrawlerName(r.key)} iconOf={(r) => <BrawlerIcon name={r.key} size={20} />} />
            <div style={NOTE}>
              A teammate&apos;s BRAWLER, not a teammate player — your win rate when someone on
              your side drafted them.
            </div>
          </div>
        )}
      </div>
      <div style={NOTE}>
        Only brawlers you have met at least 8 times. At a typical sample very few qualify;
        that is the honest state of this data, not a missing feature.
      </div>
    </Section>
  );
}

/** Mode and map context, plus brawler-in-a-mode outliers. */
function ContextPanel({ series }) {
  const modes = modeRates(series).filter((r) => r.n > 0);
  const maps = mapRates(series);
  const outliers = brawlerModeOutliers(series);
  if (!modes.length && !maps.length && !outliers.length) return null;

  // Rated maps first (best to worst), then the rest by how close they are to
  // qualifying — so the list degrades into "and here is what you are still
  // building" rather than stopping dead at the floor.
  const mapRows = [
    ...maps.filter((r) => r.qualified),
    ...maps.filter((r) => !r.qualified).sort((a, b) => b.n - a.n),
  ];

  return (
    <Section title="WHERE YOU PLAY">
      <div style={{ display: "grid", gap: 18, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        {modes.length > 0 && (
          <div>
            <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: 1.2, color: "#8b8b9c", marginBottom: 8 }}>
              BY MODE
            </div>
            <RateRows rows={modes} max={8} showRate
              labelOf={(r) => formatMode(r.key)}
              iconOf={(r) => <ModeIcon mode={r.key} size={15} inline={false} />} />
          </div>
        )}
        {mapRows.length > 0 && (
          <div>
            <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: 1.2, color: "#8b8b9c", marginBottom: 8 }}>
              BY MAP
            </div>
            <RateRows rows={mapRows} max={10} showRate
              iconOf={(r) => <MapThumb name={r.key} size={20} />} />
          </div>
        )}
      </div>

      <ModeLead series={series} />

      {outliers.length > 0 && (
        <>
          <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: 1.2, color: "#ffce7a", margin: "16px 0 8px" }}>
            A BRAWLER THAT BEHAVES DIFFERENTLY IN ONE MODE
          </div>
          <div style={{ display: "grid", gap: 7 }}>
            {outliers.slice(0, 4).map((o, i) => (
              <div key={i} style={{ fontSize: 13.5, lineHeight: 1.65, color: "#c9c9d6" }}>
                <strong style={{ color: "#e9e9f2" }}>{formatBrawlerName(o.brawler)}</strong> is{" "}
                {pct(o.brawlerRate)} for you overall ({o.brawlerN} drafts) but{" "}
                <strong style={{ color: o.gapPts >= 0 ? "#8ee6b0" : "#ff8f8f" }}>{pct(o.rate)}</strong>{" "}
                in {o.mode} ({o.n} drafts).
              </div>
            ))}
          </div>
        </>
      )}

      <div style={NOTE}>
        A <strong style={{ color: "#8a8a9c" }}>dimmed</strong> win rate is your raw record on a
        sample too small to read as a rate — it is shown because it is your real record, but it
        gets no &plusmn;pp and should not be treated as a finding. 75% off 6&ndash;2 and 75% off
        60&ndash;20 are not the same claim. Maps need 10 drafts, modes 10.
        <br /><br />
        The outliers above are by mode, not map, and that is a data limit rather than a choice:
        across every tracked player the largest brawler-on-one-map sample in the database is 9
        drafts, which cannot separate a real weakness from a run of bad luck. A mode pools six
        times as many games, and a gap is only listed when it beats the cell&apos;s own error.
      </div>
    </Section>
  );
}

/**
 * Who you actually face, and what the field answers them with.
 *
 * Sorted by ENCOUNTERS rather than by how badly each beats you. The brawler
 * you meet in a third of your games is worth preparing for at an even record;
 * the one that crushes you twice a season is not. "You lose to" in the panel
 * above already covers the other ordering.
 *
 * The counter column is the FIELD's answer, not yours — it comes from
 * vs_brawler over the whole bracket. It is not filtered to brawlers you own or
 * play, because ownership is invisible to us and quietly withholding the real
 * answer would be worse than naming one you cannot pick yet.
 */
function EncounterPanel({ series, intel }) {
  const rows = useMemo(() => mostEncountered(series, intel, 6), [series, intel]);
  if (!intel || rows.length < 3) return null;

  return (
    <Section title="WHO YOU FACE MOST · AND WHAT BEATS THEM">

      <div style={{ display: "grid", gap: 6 }}>
        {rows.map((r) => (
          <div
            key={r.key}
            style={{
              display: "grid", gap: 10, alignItems: "center",
              gridTemplateColumns: "minmax(0,1.1fr) 62px minmax(0,1.2fr)",
              padding: "8px 11px", borderRadius: 10,
              background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.06)",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
              <BrawlerIcon name={r.key} size={24} />
              <span style={{ minWidth: 0 }}>
                <span style={{
                  display: "block", fontSize: 12.5, color: "#e2e2ec",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {formatBrawlerName(r.key)}
                </span>
                <span style={{ fontFamily: MONO, fontSize: 10, color: "#7c7e8f" }}>
                  {r.n} faced
                </span>
              </span>
            </span>

            <span style={{ fontFamily: MONO, fontSize: 11, textAlign: "right" }}>
              <span style={{
                display: "block", fontWeight: 700,
                color: r.qualified ? (r.delta >= 0 ? "#8ee6b0" : "#ff8f8f") : "#6b6d7c",
              }}>
                {Math.round(r.raw * 100)}%
              </span>
              <span style={{ fontSize: 10, color: "#7c7e8f" }}>
                {r.wins}&ndash;{r.n - r.wins}
              </span>
            </span>

            <span style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0, justifyContent: "flex-end" }}>
              {r.counters.length ? (
                r.counters.map((c) => (
                  <span key={c.brawler} title={`${formatBrawlerName(c.brawler)} wins ${c.rate.toFixed(1)}% of ${c.picks.toLocaleString("en-US")} games vs ${formatBrawlerName(r.key)}`}
                        style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                    <BrawlerIcon name={c.brawler} size={20} />
                    <span style={{ fontFamily: MONO, fontSize: 10, color: "#8ee6b0" }}>
                      {c.rate.toFixed(0)}%
                    </span>
                  </span>
                ))
              ) : (
                <span style={{ fontFamily: MONO, fontSize: 10, color: "#6b6d7c" }}>no clear answer</span>
              )}
            </span>
          </div>
        ))}
      </div>

      <div style={NOTE}>
        Left is how often you meet them and your record. Right is what the field beats them
        with — a brawler needs 200+ games into that matchup and a 53%+ edge to be listed, so
        &ldquo;no clear answer&rdquo; means the matchup genuinely has no strong counter rather
        than that we lack data. These are the bracket&apos;s answers, not filtered to brawlers
        you own or play.
      </div>
    </Section>
  );
}

// ── OP-6 the coaching panels ─────────────────────────────────────────────────
// These answer "under what conditions do you play well", which is the only
// part of this page a player can change tonight. They are also the panels
// most able to mislead, so each one states its own weakness in the note.

/** Solo vs duo vs trio. Inferred, and labelled as inferred. */
function PartyPanel({ series, selfTag }) {
  const rows = useMemo(() => partyBreakdown(series, selfTag), [series, selfTag]);
  const rated = rows.filter((r) => r.qualified);
  if (rated.length < 2) return null;

  const best = rated[0];
  const worst = rated[rated.length - 1];
  const spread = (best.rate - worst.rate) * 100;

  return (
    <Section title="WHO YOU QUEUE WITH">
      <RateRows rows={rows} max={3} showRate />
      {spread >= 4 && (
        <div style={{ marginTop: 11, fontSize: 13.5, lineHeight: 1.7, color: "#c9c9d6" }}>
          <strong style={{ color: "#e9e9f2" }}>{best.key}</strong> is worth about{" "}
          <strong style={{ color: "#8ee6b0" }}>{spread.toFixed(0)} points</strong> of win rate
          over <strong style={{ color: "#e9e9f2" }}>{worst.key.toLowerCase()}</strong> for you.
          {best.mates > 0 && " If you are climbing, queue with people."}
        </div>
      )}
      <div style={NOTE}>
        The game never tells us who queued together, so this is inferred: a teammate counts as
        a regular when they turn up in at least two different drafts of the same session. It
        will call a long coincidence a duo, and a party that only played once solo. Counted in
        drafts, never rounds — your teammates are the same in every round of one draft, so
        counting rounds would report almost everyone as a regular.
      </div>
    </Section>
  );
}

/** Tilt, fatigue and clock. The three conditions a player actually controls. */
function SessionPanel({ series }) {
  const tilt = useMemo(() => tiltCurve(series), [series]);
  const depth = useMemo(() => sessionDepth(series), [series]);
  const clock = useMemo(() => timeOfDay(series), [series]);
  if (!tilt.some((r) => r.qualified)) return null;

  const fresh = tilt.find((r) => r.lo === 0 && r.qualified);
  const tilted = [...tilt].reverse().find((r) => r.lo >= 2 && r.qualified);
  const drop = fresh && tilted ? (fresh.rate - tilted.rate) * 100 : null;

  return (
    <Section title="SESSIONS · TILT, FATIGUE AND CLOCK">
      <div style={{ display: "grid", gap: 18, gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" }}>
        <div>
          <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: 1.2, color: "#ff8f8f", marginBottom: 8 }}>
            AFTER LOSING IN A ROW
          </div>
          <RateRows rows={tilt} max={4} showRate />
        </div>
        <div>
          <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: 1.2, color: "#8b8b9c", marginBottom: 8 }}>
            HOW DEEP INTO A SESSION
          </div>
          <RateRows rows={depth} max={4} showRate />
        </div>
        {clock.length > 1 && (
          <div>
            <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: 1.2, color: "#8b8b9c", marginBottom: 8 }}>
              TIME OF DAY
            </div>
            <RateRows rows={clock} max={4} showRate />
          </div>
        )}
      </div>

      {drop != null && drop >= 5 && (
        <div style={{
          marginTop: 14, padding: "11px 13px", borderRadius: 10,
          background: "rgba(255,143,143,.06)", border: "1px solid rgba(255,143,143,.18)",
        }}>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1.4, color: "#ff8f8f", marginBottom: 6 }}>
            THE ONE YOU CAN FIX TONIGHT
          </div>
          <div style={{ fontSize: 13.5, lineHeight: 1.7, color: "#c9c9d6" }}>
            You win <strong style={{ color: "#8ee6b0" }}>{Math.round(fresh.raw * 100)}%</strong>{" "}
            fresh and <strong style={{ color: "#ff8f8f" }}>{Math.round(tilted.raw * 100)}%</strong>{" "}
            once you are two losses down — a <strong>{drop.toFixed(0)} point</strong> swing.
            Stopping after two is the cheapest rating you will ever save.
          </div>
        </div>
      )}

      <div style={NOTE}>
        A session is games with less than 45 minutes between them, and streaks reset between
        sessions — a loss last week does not tilt you tonight. Time of day is read from{" "}
        <strong style={{ color: "#8a8a9c" }}>your browser&apos;s clock</strong>, not the
        player&apos;s, so on someone else&apos;s profile those blocks are your evening rather
        than theirs.
      </div>
    </Section>
  );
}

/** Pool breadth and the star-player rate, both with their coverage stated. */
function PoolPanel({ series }) {
  const pool = useMemo(() => poolBreadth(series), [series]);
  const star = useMemo(() => starRates(series), [series]);
  if (!pool.onMains.qualified && !pool.offMains.qualified && !star.known) return null;

  const gap = (pool.onMains.rate - pool.offMains.rate) * 100;
  const bothRated = pool.onMains.qualified && pool.offMains.qualified;

  return (
    <Section title="YOUR BRAWLER POOL">
      <div style={{ fontFamily: MONO, fontSize: 11, color: "#8a8a9c", marginBottom: 10 }}>
        {pool.distinct} brawlers drafted · mains:{" "}
        {pool.mains.map((m) => formatBrawlerName(m)).join(", ")}
      </div>
      <RateRows rows={[pool.onMains, pool.offMains]} max={2} showRate />

      {bothRated && Math.abs(gap) >= 4 && (
        <div style={{ marginTop: 11, fontSize: 13.5, lineHeight: 1.7, color: "#c9c9d6" }}>
          {/* The quoted gap is the SHRUNK one, so it is smaller than the two raw
              rates above imply. Saying which is the difference between a reader
              trusting the number and thinking we cannot subtract. */}
          {gap > 0
            ? <>Your mains run about <strong style={{ color: "#8ee6b0" }}>{gap.toFixed(0)} points</strong> ahead of the rest of your pool once the smaller samples are accounted for. Narrowing it when it matters is worth real rating.</>
            : <>You run about <strong style={{ color: "#8ee6b0" }}>{Math.abs(gap).toFixed(0)} points</strong> better OUTSIDE your three most-played brawlers, sample-adjusted — worth asking whether your mains are actually your best.</>}
        </div>
      )}

      {star.known > 0 && (
        <>
          <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: 1.2, color: "#ffce7a", margin: "16px 0 8px" }}>
            STAR PLAYER
          </div>
          <div style={{ fontSize: 13.5, lineHeight: 1.7, color: "#c9c9d6" }}>
            You were star player in{" "}
            <strong style={{ color: "#ffce7a" }}>{Math.round(star.rate * 100)}%</strong> of the{" "}
            {star.known} rounds where the game told us — against a{" "}
            <strong>16.7%</strong> baseline if it were random across six players.
          </div>
          {star.perBrawler.length > 0 && (
            <div style={{ display: "grid", gap: 5, marginTop: 9 }}>
              {star.perBrawler.slice(0, 4).map((p) => (
                <div key={p.key} style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: MONO, fontSize: 11 }}>
                  <BrawlerIcon name={p.key} size={18} />
                  <span style={{ flex: 1, color: "#c9c9d6" }}>{formatBrawlerName(p.key)}</span>
                  <span style={{ color: p.rate >= 0.167 ? "#ffce7a" : "#7c7e8f", fontWeight: 700 }}>
                    {Math.round(p.rate * 100)}%
                  </span>
                  <span style={{ color: "#7c7e8f", minWidth: 58, textAlign: "right" }}>
                    of {p.known}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <div style={NOTE}>
        Star player is only reported on some battlelog shapes, so it is counted over the rounds
        where the game actually told us — {star.known} of them here — and the denominator is
        shown on every row rather than hidden. 16.7% is what pure chance would give across six
        players, so it is the line to beat, not 50%.
      </div>
    </Section>
  );
}

export default function PlayerInsights({ rows, tracked, selfTag, onOpenPlayer, compact = false }) {
  const [graded, setGraded] = useState(null);
  const series = useMemo(() => toSeries(rows || []), [rows]);

  useEffect(() => {
    let cancelled = false;
    if (!series.length) { setGraded([]); return; }
    setGraded(null);
    gradeSeries(series)
      .then(g => { if (!cancelled) setGraded(g); })
      .catch(() => { if (!cancelled) setGraded([]); });
    return () => { cancelled = true; };
  }, [series]);

  const starWins = (rows || []).filter(r => r.is_star_player === true && r.result === 1).length;
  const starKnownWins = (rows || []).filter(r => r.is_star_player !== null && r.result === 1).length;

  const people = useMemo(() => squadAndRivals(series, selfTag), [series, selfTag]);

  // Population pick distribution for the fingerprint's comparison bars.
  const [intel, setIntel] = useState(null);
  useEffect(() => {
    const first = series[0];
    if (!first) return;
    let cancelled = false;
    loadIntelligence(first.patch, first.bracket || DEFAULT_BRACKET)
      .then(i => { if (!cancelled) setIntel(i); })
      .catch(() => { if (!cancelled) setIntel({}); });
    return () => { cancelled = true; };
  }, [series]);

  if (!series.length) return null;
  if (graded === null) {
    return <div style={{ ...NOTE, marginBottom: 14 }}>Grading {series.length} drafts…</div>;
  }

  const ad = aboveDraft(graded);
  const buckets = draftBuckets(graded);
  const facts = eventFacts(graded, { starWins, starKnownWins });

  if (compact) {
    return (
      <>
        <CoverageLine tracked={tracked} seriesCount={series.length} />
        <FactsStrip facts={facts.slice(0, 2)} />
        <AboveDraftPanel ad={ad} series={series} />
      </>
    );
  }

  return (
    <>
      <CoverageLine tracked={tracked} seriesCount={series.length} />
      <FactsStrip facts={facts} />
      <AboveDraftPanel ad={ad} series={series} />
      <BucketsPanel buckets={buckets} />
      {intel && <FingerprintPanel rows={classFingerprint(series, intel)} n={series.length} />}

      {/* Ordered by how soon each becomes real for a typical player. Class
          breakdowns survive a median sample (seven buckets over three enemies
          a draft); per-brawler ones need a heavy one; each panel hides itself
          until it has something true to say, so a thin profile simply shows
          fewer cards rather than a wall of empty ones. */}
      <SessionPanel series={series} />
      <PartyPanel series={series} selfTag={selfTag} />
      <ClassDonutPanel series={series} />
      <VsClassPanel series={series} />
      <ContextPanel series={series} />
      <MatchupPanel series={series} />
      <EncounterPanel series={series} intel={intel} />
      <PoolPanel series={series} />

      {intel && <NemesisPanel table={nemesisTable(series, intel)} />}
      <PeoplePanel squad={people.squad} rivals={people.rivals} onOpen={onOpenPlayer} />
    </>
  );
}
