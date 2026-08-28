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
} from "./data/playerStats";
import { classLabel } from "./data/draftEngine";
import { supabase } from "./appCore";
import { formatBrawlerName } from "./appCore";

const MONO = "'JetBrains Mono', monospace";
const DISPLAY = "'Baloo 2', sans-serif";

const CARD = {
  padding: "18px 20px", borderRadius: 16, marginBottom: 14,
  background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)",
};
const EYEBROW = { fontFamily: MONO, fontSize: 9.5, letterSpacing: 1.9, color: "#6f7180", marginBottom: 10 };
const NOTE = { fontFamily: MONO, fontSize: 10, color: "#5a5a6a", marginTop: 10, lineHeight: 1.65 };

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

function AboveDraftPanel({ ad }) {
  if (!ad.n) return null;
  const state = ladderState(ad.n, 10, ad.bandExcludesZero);
  const sign = ad.delta >= 0 ? "+" : "";
  const colour = !ad.bandExcludesZero ? "#c9c9d6" : ad.delta > 0 ? "#8ee6b0" : "#ff8f8f";

  return (
    <div style={CARD}>
      <div style={EYEBROW}>ABOVE DRAFT</div>

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

          <div style={NOTE}>
            Each draft is graded by the same engine the Draft Assistant uses, on measured win rates
            for that map — matchup edge, not skill. The shaded band is two standard errors; a verdict
            only appears once it clears zero. It widens with more drafts because it tracks a running
            total, while the gap it has to beat grows faster.
          </div>
        </>
      )}
    </div>
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
    <div style={CARD}>
      <div style={EYEBROW}>PICKS OR PLAY?</div>
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
        {order.map(([k, label, colour]) => {
          const b = buckets[k];
          const show = b.n >= 12;
          return (
            <div key={k} style={{
              padding: "12px 14px", borderRadius: 12,
              background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.07)",
            }}>
              <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: 1.3, color: "#6f7180", lineHeight: 1.4 }}>
                {label}
              </div>
              <div style={{ fontFamily: DISPLAY, fontSize: 21, fontWeight: 800, color: show ? colour : "#c9c9d6", marginTop: 5 }}>
                {show ? `${(b.rate * 100).toFixed(0)}%` : `${b.wins}–${b.n - b.wins}`}
              </div>
              <div style={{ fontFamily: MONO, fontSize: 9.5, color: "#5a5a6a", marginTop: 2 }}>
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
    </div>
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
      <span style={{ color: "#6f7180" }}>
        {kind === "squad" ? `${p.n} together` : `${p.n} against · ${p.wins}W`}
      </span>
    </button>
  );
  return (
    <div style={CARD}>
      <div style={EYEBROW}>PEOPLE YOU KEEP MEETING</div>
      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))" }}>
        {squad.length > 0 && (
          <div>
            <div style={{ fontFamily: MONO, fontSize: 9.5, color: "#8ee6b0", marginBottom: 7 }}>TEAMMATES</div>
            <div style={{ display: "grid", gap: 5 }}>
              {squad.slice(0, 5).map(p => <Row key={p.tag} p={p} kind="squad" />)}
            </div>
          </div>
        )}
        {rivals.length > 0 && (
          <div>
            <div style={{ fontFamily: MONO, fontSize: 9.5, color: "#ff8f8f", marginBottom: 7 }}>OPPONENTS</div>
            <div style={{ display: "grid", gap: 5 }}>
              {rivals.slice(0, 5).map(p => <Row key={p.tag} p={p} kind="rival" />)}
            </div>
          </div>
        )}
      </div>
      <div style={NOTE}>Counts of encounters, not win rates — so these need no sample size to be true.</div>
    </div>
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
    <div style={CARD}>
      <div style={EYEBROW}>YOUR DRAFT FINGERPRINT</div>

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
            <span style={{ fontFamily: MONO, fontSize: 10, color: "#6f7180", textAlign: "right" }}>
              {(r.mine * 100).toFixed(0)}% / {(r.theirs * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 14, marginTop: 10, fontFamily: MONO, fontSize: 9.5, color: "#6f7180" }}>
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
    </div>
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
    <div style={CARD}>
      <div style={EYEBROW}>WHAT BEATS YOUR {formatBrawlerName(table.brawler).toUpperCase()}</div>

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
            <span style={{ fontSize: 13, color: "#e2e2ec" }}>{formatBrawlerName(r.enemy)}</span>
            <span style={{ fontFamily: MONO, fontSize: 11, color: r.popRate < 45 ? "#ff8f8f" : "#c9c9d6", textAlign: "right" }}>
              {r.popRate.toFixed(1)}%
              {/* the sample is what justifies trusting this column, so show it */}
              <span style={{ color: "#5a5a6a", fontSize: 9 }}> · {r.popPicks.toLocaleString("en-US")} games</span>
            </span>
            <span style={{ fontFamily: MONO, fontSize: 10, color: "#6f7180", textAlign: "right", minWidth: 96 }}>
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
    </div>
  );
}


// ── PR-1 trophy curve ────────────────────────────────────────────────────────
// Free, for every tracked player, no account and no boost. Brawlify charges
// $4.99/mo for roughly this and our own analysis called that "the least
// defensible paywall on the site" — shipping it behind a signup wall would have
// been the same shape. Boost only buys per-brawler detail daily instead of
// weekly; the curve itself is never withheld.

function TrophyCurve({ snapshots }) {
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
    <div style={CARD}>
      <div style={EYEBROW}>TROPHY HISTORY</div>
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
    </div>
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
export default function PlayerInsights({ rows, tracked, selfTag, onOpenPlayer, compact = false }) {
  const [snapshots, setSnapshots] = useState([]);
  useEffect(() => {
    if (!selfTag) return;
    let cancelled = false;
    supabase.from("player_snapshots")
      .select("taken_at,trophies")
      .eq("player_tag", selfTag)
      .order("taken_at", { ascending: false })
      .limit(400)
      .then(({ data }) => { if (!cancelled) setSnapshots(data || []); });
    return () => { cancelled = true; };
  }, [selfTag]);

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
        <AboveDraftPanel ad={ad} />
        <TrophyCurve snapshots={snapshots} />
      </>
    );
  }

  return (
    <>
      <CoverageLine tracked={tracked} seriesCount={series.length} />
      <FactsStrip facts={facts} />
      <AboveDraftPanel ad={ad} />
      <BucketsPanel buckets={buckets} />
      {intel && <FingerprintPanel rows={classFingerprint(series, intel)} n={series.length} />}
      {intel && <NemesisPanel table={nemesisTable(series, intel)} />}
      <TrophyCurve snapshots={snapshots} />
      <PeoplePanel squad={people.squad} rivals={people.rivals} onOpen={onOpenPlayer} />
    </>
  );
}
