// ─── Brawler guide page ──────────────────────────────────────────────────────
// Full-page brawler guide, recreated from the Claude Design handoff
// ("Brock Guide.dc.html"). Layout, spacing and colour are the design's; all
// numbers are ours — live per-map/per-mode win rates from ranked_matches, the
// official ability names and art from brawlerMeta.json, and our own tier list
// in place of the mock's invented "Meta Score".
//
// Sections (mirroring the design's side rail): Overview · Best Build ·
// Combat Stats · Guide · Maps & Modes · Synergies · How to Counter.

import { useState, useMemo, useEffect } from "react";
import BRAWLER_META from "./data/brawlerMeta.json";
import { getExtendedGuide } from "./data/extendedGuides";
import { supabase, MODE_ICONS } from "./appCore";
import { draftClassOf, classLabel } from "./data/draftEngine";
import {
  getBrawlerGuide, getGeneralTier, scaleStatValue, POWER_LEVELS,
} from "./data/brawlerTips";

const DISPLAY = "'Baloo 2', sans-serif";
const BODY = "'Chakra Petch', sans-serif";
const MONO = "'JetBrains Mono', monospace";

const CARD = { borderRadius: 24, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)" };
const H2 = { fontFamily: DISPLAY, fontSize: "clamp(24px,3vw,30px)", color: "#f4f4fa", letterSpacing: "-.3px" };
const SUB = { fontSize: 13.5, color: "#8b8b9c", marginTop: 4 };

const FORMAT_MODE = (m) => (m || "").replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase()).trim();
const fmtName = (key) => (key || "").toLowerCase().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
const wrColor = (wr) => (wr >= 53 ? "#8ee6b0" : wr >= 49 ? "#ffce7a" : "#ff8f8f");
// Capitalize the first letter of each space-separated word, leaving
// separators (·, —, #2) and apostrophes intact: "kill confirm" → "Kill Confirm".
const titleCase = (s) => (s || "").split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "best-build", label: "Best Build" },
  { id: "combat-stats", label: "Combat Stats" },
  { id: "guide", label: "Guide" },
  { id: "maps-modes", label: "Maps & Modes" },
  { id: "matchups", label: "Match-ups" },
  { id: "counter", label: "How to Counter" },
];

// ── Shared primitives ────────────────────────────────────────────────────────
function Pill({ children, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      fontFamily: BODY, fontWeight: 600, fontSize: 13.5, letterSpacing: ".3px",
      padding: "10px 18px", borderRadius: 999, border: "none", cursor: "pointer",
      background: active ? "#b36bff" : "transparent", color: active ? "#0a0a0f" : "#b7b7c6",
      transition: "background .15s, color .15s",
    }}>{children}</button>
  );
}

function PillTrack({ children }) {
  return (
    <div style={{
      display: "flex", gap: 8, flexWrap: "wrap", padding: 6, borderRadius: 999,
      background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)", width: "fit-content",
    }}>{children}</div>
  );
}

// 16:9 media placeholder carrying the design's "LOOP · MUTED" chip. Renders a
// real YouTube embed when we have a verified video id for this brawler.
function ClipSlot({ label, videoId, title, tone = "#8ee6b0" }) {
  return (
    <div style={{
      position: "relative", borderRadius: 16, overflow: "hidden", aspectRatio: "16/9",
      background: "#0c0c14", border: `1px solid ${tone === "#ff8f8f" ? "rgba(255,122,122,.18)" : "rgba(255,255,255,.08)"}`,
    }}>
      {videoId ? (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${videoId}`} title={title || label}
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowFullScreen loading="lazy"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }}
        />
      ) : (
        <>
          <div style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 6, padding: 14, textAlign: "center",
            background: "linear-gradient(160deg, rgba(179,107,255,.10), rgba(20,14,32,.5))",
          }}>
            <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: 1.2, color: "#8b8b9c" }}>{label}</span>
          </div>
          <div style={{
            position: "absolute", top: 8, right: 8, fontFamily: MONO, fontSize: 8.5, letterSpacing: 1,
            color: "#e9e9f2", background: "rgba(0,0,0,.55)", padding: "3px 8px", borderRadius: 999,
            display: "flex", alignItems: "center", gap: 4,
          }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: tone }} />LOOP · MUTED
          </div>
        </>
      )}
    </div>
  );
}

// Owner-supplied muted loop clip. Autoplays only while on screen (one guide tab
// is visible at a time, so at most a handful ever play). Falls back to the
// design's placeholder if the file 404s.
function VideoSlot({ base, src, label, tone = "#8ee6b0" }) {
  const [failed, setFailed] = useState(false);
  const borderTone = tone === "#ff8f8f" ? "rgba(255,122,122,.18)" : "rgba(255,255,255,.08)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {label && (
        <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: .8, color: "#9a9aab" }}>{titleCase(label)}</span>
      )}
      <div style={{ position: "relative", borderRadius: 16, overflow: "hidden", aspectRatio: "16/9", background: "#0c0c14", border: `1px solid ${borderTone}` }}>
        {failed ? (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 12, textAlign: "center", background: "linear-gradient(160deg, rgba(179,107,255,.10), rgba(20,14,32,.5))" }}>
            <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1, color: "#8b8b9c" }}>CLIP UNAVAILABLE</span>
          </div>
        ) : (
          <video
            src={`${base}/${src}.mp4`} muted loop autoPlay playsInline preload="metadata"
            onError={() => setFailed(true)}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
          />
        )}
        <div style={{ position: "absolute", top: 8, right: 8, fontFamily: MONO, fontSize: 8.5, letterSpacing: 1, color: "#e9e9f2", background: "rgba(0,0,0,.55)", padding: "3px 8px", borderRadius: 999, display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: tone }} />LOOP · MUTED
        </div>
      </div>
    </div>
  );
}

// Official mode logo. `size` is the icon box; falls back silently (no broken
// image) if the CDN art doesn't resolve.
function ModeIcon({ mode, size = 22, title }) {
  const url = MODE_ICONS[mode];
  if (!url) return null;
  return <img src={url} alt={title || mode} title={title} width={size} height={size} style={{ objectFit: "contain", flexShrink: 0 }} />;
}

// The "General" build tab: three mode logos in a triangle, signalling "all
// modes" rather than any single one.
function GeneralTriangle({ size = 30 }) {
  const s = size / 2.4;
  const modes = ["gemGrab", "brawlBall", "knockout"];
  return (
    <span style={{ position: "relative", display: "inline-block", width: size, height: size, flexShrink: 0 }}>
      <img src={MODE_ICONS[modes[0]]} alt="" width={s} height={s} style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", objectFit: "contain" }} />
      <img src={MODE_ICONS[modes[1]]} alt="" width={s} height={s} style={{ position: "absolute", bottom: 0, left: 0, objectFit: "contain" }} />
      <img src={MODE_ICONS[modes[2]]} alt="" width={s} height={s} style={{ position: "absolute", bottom: 0, right: 0, objectFit: "contain" }} />
    </span>
  );
}

// Guide subtitle restyled from a plain comma sentence into a row of small
// labelled chips (one per tab) plus a "with video breakdowns" note.
function GuideSubtitle({ tabs }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {tabs.map(t => (
        <span key={t.key} style={{
          fontFamily: MONO, fontSize: 10.5, letterSpacing: .6, color: "#c9c9d6",
          padding: "4px 11px", borderRadius: 999,
          background: "rgba(179,107,255,.10)", border: "1px solid rgba(179,107,255,.22)",
        }}>{t.label}</span>
      ))}
      <span style={{ fontSize: 12.5, color: "#6f7180", fontStyle: "italic" }}>with video breakdowns</span>
    </div>
  );
}

function NumberedTip({ n, lead, rest, tone = "violet" }) {
  const c = tone === "red"
    ? { bg: "rgba(255,122,122,.14)", fg: "#ff8f8f" }
    : { bg: "rgba(179,107,255,.14)", fg: "#c98bff" };
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <span style={{
        flexShrink: 0, width: 26, height: 26, borderRadius: 9, background: c.bg, color: c.fg,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: MONO, fontWeight: 700, fontSize: 11,
      }}>{String(n).padStart(2, "0")}</span>
      <p style={{ fontSize: 14.5, lineHeight: 1.65, color: "#c9c9d6" }}>
        <strong style={{ color: "#f4f4fa" }}>{lead}</strong> {rest}
      </p>
    </div>
  );
}

function Accordion({ id, title, subtitle, open, onToggle, children }) {
  return (
    <section id={id} style={{ ...CARD, scrollMarginTop: 110, overflow: "hidden" }}>
      <button onClick={onToggle} aria-expanded={open} style={{
        width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 16, padding: 26, background: "transparent", border: "none", cursor: "pointer", textAlign: "left",
      }}>
        <div>
          <h2 style={H2}>{title}</h2>
          {typeof subtitle === "string" ? <p style={SUB}>{subtitle}</p> : <div style={{ marginTop: 8 }}>{subtitle}</div>}
        </div>
        <span style={{
          display: "inline-block", flexShrink: 0, fontSize: 18, color: "#8b8b9c",
          transform: `rotate(${open ? 180 : 0}deg)`, transition: "transform .18s",
        }}>▾</span>
      </button>
      {open && <div style={{ padding: "0 26px 26px" }}>{children}</div>}
    </section>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function BrawlerGuidePage({ brawler, byMode, byMap, allBrawlers = [], onBack }) {
  const guide = getBrawlerGuide(brawler.key);
  const ext = getExtendedGuide(brawler.key);
  const { tier, provisional } = getGeneralTier(brawler.key);

  const [power, setPower] = useState(11);
  const [buildTab, setBuildTab] = useState("General");
  const [guideTab, setGuideTab] = useState(0);
  const [guideOpen, setGuideOpen] = useState(true);
  const [mapsOpen, setMapsOpen] = useState(true);
  const [modeIdx, setModeIdx] = useState(0);
  const [mapIdx, setMapIdx] = useState(0);
  const [activeSection, setActiveSection] = useState("overview");
  const [liveSynergies, setLiveSynergies] = useState(null);
  const [liveCounters, setLiveCounters] = useState(null);

  // Live match-up data from brawler_intelligence (Masters+, current patch):
  //  • with_brawler → best teammates (highest win rate together)
  //  • vs_brawler   → worst opponents (lowest win rate against)
  // Both ranked with a 300-game floor so they're real, top 6 each. Reasons are
  // hand-written where we have them, class-derived otherwise.
  useEffect(() => {
    let cancelled = false;
    const rank = (obj, dir) => Object.entries(obj || {})
      .map(([key, v]) => ({ key: key.toUpperCase(), winRate: Math.round(Number(v.winRate) * 10) / 10, games: Number(v.picks) }))
      .filter(r => r.games >= 300 && Number.isFinite(r.winRate) && r.key !== brawler.key)
      .sort((a, b) => dir * (b.winRate - a.winRate))
      .slice(0, 6);
    supabase
      .from("brawler_intelligence")
      .select("with_brawler, vs_brawler")
      .eq("brawler", brawler.key)
      .eq("patch", "68.250")
      .eq("rank_bracket", "masters_legendary")
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        setLiveSynergies(rank(data.with_brawler, 1));   // highest win rate with
        setLiveCounters(rank(data.vs_brawler, -1));      // lowest win rate against
      });
    return () => { cancelled = true; };
  }, [brawler.key]);

  // ── Live stats ─────────────────────────────────────────────────────────────
  const modeStats = useMemo(() => Object.entries(byMode).map(([mode, brawlers]) => {
    const s = brawlers[brawler.key];
    if (!s || s.picks < 30) return null;
    return { mode, picks: s.picks, winRate: Math.round((s.wins / s.picks) * 1000) / 10 };
  }).filter(Boolean).sort((a, b) => b.winRate - a.winRate), [byMode, brawler.key]);

  const mapsByMode = useMemo(() => {
    const out = {};
    for (const [map, data] of Object.entries(byMap)) {
      const s = data.brawlers[brawler.key];
      if (!s || s.picks < 30) continue;
      (out[data.mode] ||= []).push({ map, picks: s.picks, winRate: Math.round((s.wins / s.picks) * 1000) / 10 });
    }
    for (const list of Object.values(out)) list.sort((a, b) => b.winRate - a.winRate);
    return out;
  }, [byMap, brawler.key]);

  // Overall rank across every brawler with a real sample — a real number from
  // our data, replacing the design's hardcoded "#8".
  const overallRank = useMemo(() => {
    const ranked = allBrawlers
      .filter(b => b.winRate != null && b.picks >= 500)
      .sort((a, b) => b.winRate - a.winRate);
    const i = ranked.findIndex(b => b.key === brawler.key);
    return i >= 0 ? { rank: i + 1, of: ranked.length } : null;
  }, [allBrawlers, brawler.key]);

  const modeKeys = useMemo(() => modeStats.map(m => m.mode), [modeStats]);
  const activeMode = modeKeys[modeIdx] ?? modeKeys[0];
  const activeMaps = (activeMode && mapsByMode[activeMode]) || [];
  const activeMap = activeMaps[mapIdx] || activeMaps[0] || null;

  // Scroll-spy for the side rail. Computed from scroll position rather than an
  // IntersectionObserver: the observer only reports intersection CHANGES, so
  // jumping past several sections at once (anchor click, scrollIntoView) can
  // leave the rail highlighting a section that's no longer on screen.
  useEffect(() => {
    const onScroll = () => {
      const line = 140; // just under the sticky header
      let current = SECTIONS[0].id;
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= line) current = s.id;
      }
      // At the very bottom the last section may never cross the line.
      if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 8) {
        const last = SECTIONS.filter(s => document.getElementById(s.id)).pop();
        if (last) current = last.id;
      }
      setActiveSection(current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [guideOpen, mapsOpen]);

  // ── Build tab wiring ───────────────────────────────────────────────────────
  const buildTabs = useMemo(() => {
    if (!guide?.builds) return [];
    return ["General", ...modeKeys.filter(m => guide.builds[m])];
  }, [guide, modeKeys]);

  const build = guide?.builds?.[buildTab] || guide?.builds?.General || null;

  // Resolve a build's named abilities back to the official entries + art.
  const buildItems = useMemo(() => {
    if (!build) return [];
    const find = (list, name) => (list || []).find(x => x.name === name);
    const items = [];
    const sp = find(brawler.starPowers, build.starPower);
    const gd = find(brawler.gadgets, build.gadget);
    if (sp) items.push({ kind: "STAR POWER", accent: "#ffb43d", ...sp });
    if (gd) items.push({ kind: "GADGET", accent: "#c98bff", ...gd });
    for (const g of build.gears || []) {
      items.push({ kind: "GEAR", accent: "#8ee6b0", name: `${g} Gear`, desc: GEAR_DESC[g] || "", img: null });
    }
    return items;
  }, [build, brawler.starPowers, brawler.gadgets]);

  const tierBand = TIER_BANDS[tier] || TIER_BANDS.S;

  // The rail only lists sections this brawler actually renders — a link to a
  // section that isn't on the page is a dead click.
  const present = {
    overview: true,
    "best-build": Boolean(guide && build),
    "combat-stats": Boolean(guide?.combatStats),
    guide: Boolean(guide?.guideTabs?.length),
    "maps-modes": true,
    matchups: Boolean(guide && (liveSynergies?.length || liveCounters?.length)),
    counter: Boolean(guide?.counterTips?.length),
  };
  const railSections = SECTIONS.filter(s => present[s.id]);

  return (
    <div style={{
      position: "relative", zIndex: 10, maxWidth: 1360, margin: "0 auto",
      padding: "20px 5vw 0", display: "flex", gap: 36, alignItems: "flex-start",
    }}>
      {/* ── Sticky side rail (follows scroll; the header isn't fixed, so it
             parks near the top) ── */}
      <aside className="guide-rail" style={{
        flexShrink: 0, width: 190, position: "sticky", top: 24, alignSelf: "flex-start",
        padding: "8px 0 8px 18px", borderLeft: "2px solid rgba(255,255,255,.08)",
      }}>
        {railSections.map(s => {
          const on = activeSection === s.id;
          const go = (e) => {
            e.preventDefault();
            const el = document.getElementById(s.id);
            if (el) {
              el.scrollIntoView({ behavior: "smooth", block: "start" });
              setActiveSection(s.id);
              history.replaceState(null, "", `#${s.id}`);
            }
          };
          return (
            <a key={s.id} href={`#${s.id}`} onClick={go} style={{
              display: "flex", alignItems: "center", textDecoration: "none", fontFamily: BODY,
              fontWeight: 600, fontSize: 15, padding: "11px 0 11px 16px", marginLeft: -20,
              borderLeft: `2px solid ${on ? "#ffb43d" : "transparent"}`,
              color: on ? "#f4f4fa" : "#9a9aab", transition: "color .15s",
            }}>{s.label}</a>
          );
        })}
      </aside>

      <div style={{ flex: 1, minWidth: 0, maxWidth: 1160, paddingBottom: 100, display: "flex", flexDirection: "column", gap: 22 }}>
        <button onClick={onBack} style={{
          display: "inline-flex", alignItems: "center", gap: 8, fontFamily: MONO, fontSize: 12,
          letterSpacing: 1, color: "#8b8b9c", background: "none", border: "none",
          cursor: "pointer", padding: 0, width: "fit-content",
        }}>← Tier List</button>

        {/* ── 1. Overview ── */}
        <div id="overview" style={{
          scrollMarginTop: 110, borderRadius: 28,
          background: "linear-gradient(160deg, rgba(179,107,255,.10), rgba(20,14,32,.5))",
          border: "1px solid rgba(255,255,255,.08)", padding: "34px 36px",
          display: "flex", flexDirection: "column", gap: 26,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap" }}>
            <div style={{
              width: 96, height: 96, borderRadius: 26, overflow: "hidden", flexShrink: 0,
              border: "1px solid rgba(255,255,255,.1)", background: "#0c0c14",
            }}>
              {brawler.imageUrl
                ? <img src={brawler.imageUrl} alt={brawler.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", fontFamily: MONO, fontSize: 10, color: "#5a5a6a" }}>NO ART</div>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <h1 style={{ fontFamily: DISPLAY, fontSize: "clamp(32px,4vw,44px)", color: "#f4f4fa", letterSpacing: "-.5px" }}>
                {brawler.name}
              </h1>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span style={{
                  fontFamily: MONO, fontSize: 11, letterSpacing: 1, padding: "6px 14px", borderRadius: 999,
                  background: `${brawler.rarityColor}1f`, color: brawler.rarityColor, border: `1px solid ${brawler.rarityColor}4d`,
                }}>{brawler.rarity}</span>
                <span style={{
                  fontFamily: MONO, fontSize: 11, letterSpacing: 1, padding: "6px 14px", borderRadius: 999,
                  background: "rgba(255,255,255,.05)", color: "#c9c9d6", border: "1px solid rgba(255,255,255,.1)",
                }}>{brawler.class}</span>
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>
            <StatCard label="Overall Rank" value={overallRank ? `#${overallRank.rank}` : "—"} sub={overallRank ? `of ${overallRank.of} ranked` : null} />
            <StatCard label="Overall Win Rate" value={brawler.winRate != null ? `${brawler.winRate}%` : "—"} color={brawler.winRate != null ? wrColor(brawler.winRate) : "#f4f4fa"} />
            <StatCard label="Overall Use Rate" value={brawler.pickRate != null ? `${brawler.pickRate}%` : "—"} color="#8ee6b0" />
            {/* The design's "Meta Score" is replaced by OUR tier classification. */}
            <div title={provisional ? "Provisional — the general tier list is still being curated" : "BrawlMeta general tier list"}
              style={{ padding: "20px 22px", borderRadius: 20, background: tierBand.bg, border: `1px solid ${tierBand.border}` }}>
              <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 1, color: "#9a9aab" }}>BrawlMeta Tier</div>
              <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6, color: tierBand.color, fontFamily: DISPLAY }}>
                {tier}-Tier
              </div>
              {provisional && <div style={{ fontSize: 10.5, color: "#6f7180", marginTop: 2 }}>Provisional</div>}
            </div>
          </div>
        </div>

        {/* ── 2. Best build ── */}
        {guide && build && (
          <section id="best-build" style={{ scrollMarginTop: 110 }}>
            <h2 style={{ ...H2, marginBottom: 6 }}>Best {brawler.name} build</h2>
            <p style={{ fontSize: 13.5, color: "#8b8b9c", marginBottom: 18 }}>
              Recommended gadget, star power &amp; gear — {buildTab === "General" ? "general purpose" : FORMAT_MODE(buildTab)}
            </p>
            {buildTabs.length > 1 && (
              <div style={{ marginBottom: 18 }}>
                <PillTrack>
                  {buildTabs.map(t => {
                    const on = t === buildTab;
                    return (
                      <button key={t} onClick={() => setBuildTab(t)}
                        title={t === "General" ? "General — all modes" : FORMAT_MODE(t)}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 16px",
                          borderRadius: 999, border: "none", cursor: "pointer",
                          background: on ? "#b36bff" : "transparent",
                          fontFamily: BODY, fontWeight: 600, fontSize: 13.5, color: on ? "#0a0a0f" : "#b7b7c6",
                          transition: "background .15s, color .15s",
                        }}>
                        {t === "General" ? <GeneralTriangle size={26} /> : <ModeIcon mode={t} size={22} title={FORMAT_MODE(t)} />}
                        {t === "General" && <span>General</span>}
                      </button>
                    );
                  })}
                </PillTrack>
              </div>
            )}
            {build.note && (
              <p style={{ fontSize: 14, lineHeight: 1.7, color: "#c9c9d6", marginBottom: 18, maxWidth: 760 }}>{build.note}</p>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 16 }}>
              {buildItems.map((item, i) => {
                const note = guide.abilityNotes?.[item.name];
                return (
                  <div key={i} style={{ ...CARD, borderRadius: 22, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: 11, overflow: "hidden", flexShrink: 0,
                        border: "1px solid rgba(255,255,255,.1)", background: "#0c0c14",
                        display: "grid", placeItems: "center",
                      }}>
                        {item.img
                          ? <img src={item.img} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                          : <span style={{ fontSize: 15, color: item.accent, opacity: .75 }}>⬢</span>}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: 1.5, color: item.accent }}>{item.kind}</div>
                        <div style={{ fontSize: 14.5, fontWeight: 700, color: "#f4f4fa" }}>{item.name}</div>
                      </div>
                    </div>
                    <p style={{ fontSize: 12.5, lineHeight: 1.55, color: "#9a9aab" }}>{note?.body || item.desc}</p>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── 3. Combat stats ── */}
        {guide?.combatStats && (
          <section id="combat-stats" style={{ ...CARD, scrollMarginTop: 110, padding: 26 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, flexWrap: "wrap", marginBottom: 18 }}>
              <div>
                <h2 style={H2}>Combat stats</h2>
                <p style={SUB}>
                  {power === 11 ? "Power 11 — the level ranked is played at" : `Power ${power} — scaled from the Power 11 values`}
                </p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 2, color: "#8ee6b0" }}>POWER LEVEL</span>
                <select value={power} onChange={e => setPower(Number(e.target.value))} style={{
                  fontFamily: BODY, fontWeight: 600, fontSize: 14, color: "#f4f4fa",
                  background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.12)",
                  borderRadius: 999, padding: "10px 18px", cursor: "pointer",
                }}>
                  {POWER_LEVELS.map(p => <option key={p} value={p} style={{ background: "#12121a" }}>Power {p}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
              {guide.combatStats.map((c, i) => (
                <div key={i} style={{ padding: "16px 18px", borderRadius: 16, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)" }}>
                  <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: .5, color: "#8b8b9c" }}>{c.label}</div>
                  <div style={{ fontSize: 17, fontWeight: 700, marginTop: 5, color: "#f4f4fa" }}>
                    {c.scaled ? scaleStatValue(c.value, power).toLocaleString("en-US") : (typeof c.value === "number" ? c.value.toLocaleString("en-US") : c.value)}
                  </div>
                  {c.tag && <div style={{ fontSize: 11, color: "#8ee6b0", marginTop: 2 }}>{c.tag}</div>}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── 4. Guide (aim / gadget / star power / hyper) ── */}
        {guide?.guideTabs?.length > 0 && (
          <Accordion
            id="guide" title={`${brawler.name} Guide`}
            subtitle={<GuideSubtitle tabs={guide.guideTabs} />}
            open={guideOpen} onToggle={() => setGuideOpen(o => !o)}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <PillTrack>
                {guide.guideTabs.map((t, i) => (
                  <Pill key={t.key} active={i === guideTab} onClick={() => setGuideTab(i)}>{t.label}</Pill>
                ))}
              </PillTrack>
              <div className="guide-split" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr)", gap: 20, alignItems: "start" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 2, color: "#c98bff" }}>
                    {guide.guideTabs[guideTab].label.toUpperCase()}
                  </div>
                  {guide.guideTabs[guideTab].tips.map((t, i) => (
                    <NumberedTip key={i} n={i + 1} lead={t.lead} rest={t.rest} />
                  ))}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {(guide.guideTabs[guideTab].videos || []).length > 0
                    ? guide.guideTabs[guideTab].videos.map(v => (
                        <VideoSlot key={v.src} base={guide.videoBase} src={v.src} label={v.label} />
                      ))
                    : <ClipSlot label={`▶ ${guide.guideTabs[guideTab].label.toUpperCase()} BREAKDOWN`} />}
                </div>
              </div>
            </div>
          </Accordion>
        )}

        {/* ── 5. Maps & modes (live data) ── */}
        <Accordion
          id="maps-modes" title="Maps &amp; modes"
          subtitle="Ranked map pool &amp; win rates by mode — live Masters+ data"
          open={mapsOpen} onToggle={() => setMapsOpen(o => !o)}
        >
          {modeKeys.length === 0 ? (
            <p style={{ fontSize: 13.5, color: "#8b8b9c" }}>Not enough ranked data for {brawler.name} yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <PillTrack>
                {modeStats.map((m, i) => {
                  const on = i === modeIdx;
                  return (
                    <button key={m.mode} onClick={() => { setModeIdx(i); setMapIdx(0); }}
                      title={FORMAT_MODE(m.mode)}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 16px",
                        borderRadius: 999, border: "none", cursor: "pointer",
                        background: on ? "#b36bff" : "transparent",
                        fontFamily: MONO, fontWeight: 700, fontSize: 13, color: on ? "#0a0a0f" : "#b7b7c6",
                        transition: "background .15s, color .15s",
                      }}>
                      <ModeIcon mode={m.mode} size={22} title={FORMAT_MODE(m.mode)} />
                      {m.winRate}%
                    </button>
                  );
                })}
              </PillTrack>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {activeMaps.map((mp, i) => {
                  const on = i === mapIdx;
                  const strong = mp.winRate >= 55;
                  return (
                    <button key={mp.map} onClick={() => setMapIdx(i)} style={{
                      display: "inline-flex", alignItems: "center", fontFamily: MONO, fontSize: 12,
                      letterSpacing: .5, padding: "9px 14px 9px 18px", borderRadius: 999,
                      border: `1px solid ${on ? "rgba(255,180,61,.5)" : "rgba(255,255,255,.1)"}`, cursor: "pointer",
                      background: on ? "rgba(255,180,61,.12)" : "rgba(255,255,255,.03)",
                      color: on ? "#ffce7a" : "#9a9aab", transition: "all .15s",
                    }}>
                      {mp.map}
                      <span style={{
                        marginLeft: 8, fontFamily: MONO, fontSize: 9.5, letterSpacing: .5,
                        padding: "2px 8px", borderRadius: 999,
                        background: strong ? "rgba(142,230,176,.16)" : "rgba(255,255,255,.08)",
                        color: strong ? "#8ee6b0" : "#9a9aab",
                      }}>{strong ? "STRONG" : `${mp.winRate}%`}</span>
                    </button>
                  );
                })}
              </div>

              {activeMap && (
                <div style={{
                  borderRadius: 20, background: "linear-gradient(160deg, rgba(179,107,255,.08), rgba(20,14,32,.35))",
                  border: "1px solid rgba(179,107,255,.2)", padding: "24px 26px", display: "flex", gap: 14,
                }}>
                  <span style={{ flexShrink: 0, width: 8, height: 8, borderRadius: "50%", background: "#b36bff", marginTop: 8, boxShadow: "0 0 8px #b36bff" }} />
                  <div>
                    <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 2, color: "#c98bff", marginBottom: 6 }}>
                      {FORMAT_MODE(activeMode)} · {activeMap.map.toUpperCase()} · {activeMap.winRate}% WIN RATE · {activeMap.picks.toLocaleString("en-US")} GAMES
                    </div>
                    <p style={{ fontSize: 15, lineHeight: 1.7, color: "#c9c9d6" }}>
                      {guide?.mapNotes?.[activeMap.map]
                        || `${brawler.name} sits at ${activeMap.winRate}% here across ${activeMap.picks.toLocaleString("en-US")} Masters+ games. No hand-written note for this map yet — the number is the read.`}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </Accordion>

        {/* ── 6. Match-ups (live from with_brawler + vs_brawler) ── */}
        {guide && (liveSynergies?.length > 0 || liveCounters?.length > 0) && (
          <section id="matchups" style={{ scrollMarginTop: 110 }}>
            <h2 style={{ ...H2, marginBottom: 6 }}>Match-ups</h2>
            <p style={{ fontSize: 13.5, color: "#8b8b9c", marginBottom: 18 }}>
              Live Masters+ pair data — min 300 games, best teammates and worst opponents
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {liveSynergies?.length > 0 && (
                <MatchupPanel
                  eyebrow="SYNERGIES · GOOD WITH" accent="#8ee6b0"
                  rows={liveSynergies}
                  reasonFor={s => guide.synergyReasons?.[s.key]
                    || `${classLabel(draftClassOf(s.key))} that pairs cleanly with ${brawler.name}'s range — a top win-rate teammate in the data.`}
                />
              )}
              {liveCounters?.length > 0 && (
                <MatchupPanel
                  eyebrow="COUNTERS · WORST AGAINST" accent="#ff8f8f"
                  rows={liveCounters}
                  reasonFor={s => guide.counterReasons?.[s.key]
                    || `${classLabel(draftClassOf(s.key))} that punishes ${brawler.name} — one of his lowest win rates in the data.`}
                />
              )}
            </div>
          </section>
        )}

        {/* ── 7. How to counter ── */}
        {guide?.counterTips?.length > 0 && (
          <section id="counter" style={{ scrollMarginTop: 110 }}>
            <h2 style={{ ...H2, marginBottom: 18 }}>How to counter {brawler.name}</h2>
            <div className="guide-split" style={{
              borderRadius: 24, background: "rgba(255,122,122,.04)", border: "1px solid rgba(255,122,122,.18)",
              padding: 26, display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr)", gap: 20, alignItems: "start",
            }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {guide.counterTips.map((t, i) => (
                  <NumberedTip key={i} n={i + 1} lead={t.lead} rest={t.rest} tone="red" />
                ))}
              </div>
              {guide.counterVideos?.length > 0
                ? <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {guide.counterVideos.map(v => (
                      <VideoSlot key={v.src} base={guide.videoBase} src={v.src} label={v.label} tone="#ff8f8f" />
                    ))}
                  </div>
                : <ClipSlot label={`▶ COUNTERING ${brawler.name.toUpperCase()}`} tone="#ff8f8f" />}
            </div>
          </section>
        )}

        {/* Generated fallback for brawlers with no hand-written guide yet */}
        {!guide && (
          <section style={{ ...CARD, padding: 26, display: "flex", flexDirection: "column", gap: 12 }}>
            <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 2, color: "#c98bff" }}>GAME PLAN · {ext.class.toUpperCase()}</span>
            {ext.gameplan.map((p, i) => <p key={i} style={{ fontSize: 14.5, lineHeight: 1.7, color: "#b0b0c0" }}>{p}</p>)}
            <p style={{ fontSize: 13, color: "#6f7180", marginTop: 6 }}>
              A full guide for {brawler.name} — build, combat stats, aim and counter-play — hasn't been written yet.
            </p>
          </section>
        )}
      </div>

      <style>{`
        @media (max-width: 980px) {
          .guide-rail { display: none !important; }
          .guide-split { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

// One half of the Match-ups section — a titled grid of brawler rows with the
// live win rate + game count and a reason line. Used for both Synergies
// (best teammates) and Counters (worst opponents).
function MatchupPanel({ eyebrow, accent, rows, reasonFor }) {
  return (
    <div style={{ ...CARD, padding: 26, display: "flex", flexDirection: "column", gap: 16 }}>
      <span style={{ fontFamily: MONO, fontSize: 12, letterSpacing: 2, color: accent }}>{eyebrow}</span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
        {rows.map(s => {
          const meta = BRAWLER_META[s.key] || {};
          return (
            <div key={s.key} style={{ display: "flex", gap: 14, alignItems: "center", padding: 14, borderRadius: 16, background: "rgba(255,255,255,.03)" }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, overflow: "hidden", flexShrink: 0, border: "1px solid rgba(255,255,255,.1)", background: "#0c0c14" }}>
                {meta.imageUrl && <img src={meta.imageUrl} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, fontSize: 15, color: "#f4f4fa" }}>{fmtName(s.key)}</span>
                  <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: accent }}>{s.winRate}%</span>
                  <span style={{ fontFamily: MONO, fontSize: 10, color: "#6f7180" }}>{s.games.toLocaleString("en-US")} games</span>
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.5, color: "#9a9aab", marginTop: 3 }}>{reasonFor(s)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, color = "#f4f4fa" }) {
  return (
    <div style={{ padding: "20px 22px", borderRadius: 20, background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)" }}>
      <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 1, color: "#9a9aab" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6, color }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: "#6f7180", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

const TIER_BANDS = {
  "S+": { color: "#ffc663", bg: "rgba(251,191,36,0.14)", border: "rgba(251,191,36,0.45)" },
  "S":  { color: "#ffb43d", bg: "rgba(245,158,11,0.13)", border: "rgba(245,158,11,0.40)" },
  "A":  { color: "#b36bff", bg: "rgba(168,85,247,0.13)", border: "rgba(168,85,247,0.40)" },
  "B":  { color: "#60a5fa", bg: "rgba(96,165,250,0.12)", border: "rgba(96,165,250,0.38)" },
  "C":  { color: "#94a3b8", bg: "rgba(148,163,184,0.10)", border: "rgba(148,163,184,0.35)" },
  "D":  { color: "#fb923c", bg: "rgba(251,146,60,0.11)", border: "rgba(251,146,60,0.38)" },
  "F":  { color: "#ef4444", bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.40)" },
};

// Gears have no art in brawlerMeta.json (the Brawlify payload we sync doesn't
// carry them), so the recommendation carries its own one-liner.
const GEAR_DESC = {
  Speed: "Movement speed boost below 50% health — helps you disengage after overextending on a poke.",
  Shield: "Damage reduction below 50% health — buys an extra hit of survivability while kiting back.",
  Damage: "Bonus damage below 50% health — punishes anyone who tries to trade back at close range.",
  Vision: "Reveals enemies hiding in bushes nearby — spots the flank before it lines up.",
};
