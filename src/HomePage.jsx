import { Link } from "react-router-dom";
import SiteHeader from "./SiteHeader";

const SECTIONS = [
  {
    id: "news", tag: "META NEWS", badge: "UPDATED", accent: "#ffb43d", accentBg: "rgba(255,180,61,.14)",
    heading: "Meta News", desc: "Patch breakdowns, balance changes, and pro-scene highlights.",
    bullets: "Patch notes · Pro matches · Community", linkHref: "/news", linkLabel: "Read News",
    imgPlaceholder: "Drop news / patch art",
  },
  {
    id: "tier-list", tag: "TIER LIST", badge: "POPULAR", accent: "#b36bff", accentBg: "rgba(179,107,255,.14)",
    heading: "Tier List", desc: "See which brawlers are dominating this meta, updated daily.",
    bullets: "S-tier picks · Win rates · Map filters", linkHref: "/app?tab=brawlers", linkLabel: "View Tier List",
    imgPlaceholder: "Drop tier list art",
  },
  {
    id: "scrims", tag: "SCRIM FINDER", badge: "LIVE", accent: "#8ee6b0", accentBg: "rgba(142,230,176,.14)",
    heading: "Scrim Finder", desc: "Match with teams for practice scrims before tournament day.",
    bullets: "Team matching · Scheduling · Replay review", linkHref: "/scrims", linkLabel: "Find a Scrim",
    imgPlaceholder: "Drop scrims art",
  },
  {
    id: "ranked", tag: "RANKED", badge: "CLIMB", accent: "#ffb43d", accentBg: "rgba(255,180,61,.14)",
    heading: "Ranked Tracker", desc: "Live map-aware picks and climbing tools for ranked matches.",
    bullets: "Live picks · Map meta · Roster tips", linkHref: "/app?tab=meta", linkLabel: "Launch Ranked",
    imgPlaceholder: "Drop ranked mode art",
  },
];

function ImageSlot({ placeholder, style }) {
  return (
    <div style={{
      width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
      background: "linear-gradient(160deg, rgba(179,107,255,.10), rgba(20,14,32,.5))",
      color: "#5a5a6a", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: 1,
      textAlign: "center", padding: 12, ...style,
    }}>
      {placeholder}
    </div>
  );
}

function StatChip({ value, label, color }) {
  return (
    <div style={{
      flex: 1, padding: "22px 24px", borderRadius: 22, background: "rgba(255,255,255,.04)",
      border: "1px solid rgba(255,255,255,.08)", fontFamily: "'JetBrains Mono', monospace",
    }}>
      <div style={{ fontSize: 30, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 11, letterSpacing: 2, color: "#6f7180", marginTop: 4 }}>{label}</div>
    </div>
  );
}

export default function HomePage() {
  return (
    <div style={{
      position: "relative", minHeight: "100vh", background: "#08080c",
      backgroundImage: "linear-gradient(rgba(179,107,255,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(179,107,255,.04) 1px, transparent 1px)",
      backgroundSize: "44px 44px", overflow: "hidden",
      color: "#e9e9f2", fontFamily: "'Chakra Petch', sans-serif", WebkitFontSmoothing: "antialiased",
    }}>
      {/* ambient glows */}
      <div style={{ position: "absolute", top: -160, right: -120, width: 820, height: 720, background: "radial-gradient(ellipse, rgba(179,107,255,.20), transparent 68%)", pointerEvents: "none", filter: "blur(20px)" }} />
      <div style={{ position: "absolute", bottom: -260, left: -160, width: 760, height: 640, background: "radial-gradient(ellipse, rgba(255,180,61,.12), transparent 70%)", pointerEvents: "none", filter: "blur(20px)" }} />
      {/* vignette */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(ellipse 120% 80% at 50% 40%, transparent 55%, rgba(0,0,0,.55))" }} />

      <SiteHeader />

      {/* ================= HERO ================= */}
      <main id="top" style={{
        position: "relative", zIndex: 10, display: "grid", gridTemplateColumns: "1fr 1.05fr", gap: 40,
        alignItems: "center", padding: "20px 5vw 60px", minHeight: "calc(100vh - 130px)",
      }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", gap: 38, alignSelf: "stretch" }}>
          <h1 style={{
            fontFamily: "'Baloo 2', sans-serif", fontSize: "clamp(64px, 8.6vw, 136px)", fontWeight: 700,
            lineHeight: .92, letterSpacing: "-1px", color: "#f4f4fa",
          }}>
            Surge<br />Meta is<br />
            <span style={{ color: "#b36bff", textShadow: "0 0 46px rgba(179,107,255,.55)", animation: "bm-flicker 6s infinite" }}>Here</span>
          </h1>
          <div style={{ display: "flex", gap: 16 }}>
            <StatChip value="S+" label="TIER RATING" color="#f4f4fa" />
            <StatChip value="61%" label="WIN RATE" color="#ffb43d" />
            <StatChip value="4.2%" label="PICK RATE" color="#c98bff" />
          </div>
        </div>

        <div style={{
          position: "relative", alignSelf: "center", height: "min(72vh, 680px)", borderRadius: 28,
          overflow: "hidden", background: "linear-gradient(160deg, rgba(179,107,255,.14), rgba(20,14,32,.7))",
          border: "1px solid rgba(255,255,255,.08)", display: "flex", flexDirection: "column",
          boxShadow: "0 24px 60px rgba(0,0,0,.4)",
        }}>
          <div style={{ position: "relative", flex: 1 }}>
            <ImageSlot placeholder="Drop Surge Hypercharge splash art" />
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "linear-gradient(to top, rgba(8,8,12,.94), transparent 42%)" }} />
          </div>
          <Link
            to="/app"
            style={{
              position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between",
              gap: 14, margin: 20, padding: "18px 22px", borderRadius: 999, background: "rgba(13,13,20,.85)",
              border: "1px solid rgba(179,107,255,.4)", textDecoration: "none",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "#b36bff"; e.currentTarget.style.background = "rgba(179,107,255,.16)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(179,107,255,.4)"; e.currentTarget.style.background = "rgba(13,13,20,.85)"; }}
          >
            <div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: 3, color: "#b36bff" }}>FEATURED GUIDE</div>
              <div style={{ fontWeight: 700, fontSize: 19, color: "#f4f4fa", marginTop: 3 }}>Full Surge Guide</div>
            </div>
            <span style={{
              flexShrink: 0, width: 38, height: 38, borderRadius: "50%", background: "#b36bff", color: "#0a0a0f",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700,
            }}>→</span>
          </Link>
        </div>
      </main>

      {/* ================= SECTIONS ================= */}
      <div style={{
        position: "relative", zIndex: 10, padding: "0 5vw 100px",
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 26,
      }}>
        {SECTIONS.map(sec => {
          const isInternal = sec.linkHref.startsWith("/");
          const LinkTag = isInternal ? Link : "a";
          const linkProps = isInternal ? { to: sec.linkHref } : { href: sec.linkHref };
          return (
            <div key={sec.id} id={sec.id} style={{
              scrollMarginTop: 120, borderRadius: 24, background: "rgba(255,255,255,.03)",
              border: "1px solid rgba(255,255,255,.08)", padding: 26,
              display: "flex", flexDirection: "column", gap: 16,
            }}>
              <div style={{ height: 150, borderRadius: 16, overflow: "hidden", position: "relative" }}>
                <ImageSlot placeholder={sec.imgPlaceholder} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: 2, color: sec.accent }}>{sec.tag}</span>
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: 1, color: sec.accent,
                  background: sec.accentBg, padding: "3px 10px", borderRadius: 999,
                }}>{sec.badge}</span>
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, color: "#f4f4fa", letterSpacing: "-.3px" }}>{sec.heading}</div>
              <div style={{ color: "#9a9aab", fontSize: 14.5, lineHeight: 1.5 }}>{sec.desc}</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: .5, color: "#6f7180" }}>{sec.bullets}</div>
              <LinkTag
                {...linkProps}
                style={{ marginTop: "auto", display: "inline-flex", alignItems: "center", gap: 8, color: sec.accent, fontWeight: 700, fontSize: 14, textDecoration: "none" }}
                onMouseEnter={e => { e.currentTarget.style.gap = "12px"; }}
                onMouseLeave={e => { e.currentTarget.style.gap = "8px"; }}
              >
                {sec.linkLabel} <span>→</span>
              </LinkTag>
            </div>
          );
        })}
      </div>

      {/* ================= FOOTER ================= */}
      <footer style={{
        position: "relative", zIndex: 10, borderTop: "1px solid rgba(255,255,255,.06)", padding: "32px 5vw",
        display: "flex", justifyContent: "space-between", fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11, color: "#5a5a6a",
      }}>
        <span>BRAWLMETA — UNOFFICIAL STRATEGY GUIDE</span>
        <span>v2026.1 · META SNAPSHOT</span>
      </footer>

      <style>{`
        html { scroll-behavior: smooth; }
        @keyframes bm-pulse { 0%, 100% { opacity: .45; } 50% { opacity: 1; } }
        @keyframes bm-flicker { 0%, 100% { opacity: 1; } 92% { opacity: 1; } 94% { opacity: .4; } 96% { opacity: 1; } }
      `}</style>
    </div>
  );
}
