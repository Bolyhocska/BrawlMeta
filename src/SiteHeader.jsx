import { Link } from "react-router-dom";

const NAV_STYLE = {
  display: "inline-flex", alignItems: "center", textDecoration: "none", color: "#b7b7c6",
  fontFamily: "'Chakra Petch', sans-serif", fontWeight: 600, fontSize: 14, letterSpacing: ".3px",
  padding: "10px 20px", borderRadius: 999, transition: "background .18s, color .18s",
};

// Master top-row navigation, shared across every page (Home, Draft Assistant,
// Tier List, brawler guides, etc). Nav pills route to real pages now — not
// same-page anchors — since this header lives on more than just the homepage.
// This is the ONLY navigation into the app's tabs; there's no secondary
// in-app tab switcher anymore.
const NAV_ITEMS = [
  { label: "News", to: "/news" },
  { label: "Tier List", to: "/app?tab=brawlers" },
  { label: "Leaderboards", to: "/app?tab=trending" },
  { label: "Ranked", to: "/app?tab=meta" },
  { label: "Scrims", to: "/scrims" },
  { label: "Premium", to: "/app?tab=premium" },
];

function NavLink({ to, children }) {
  return (
    <Link
      to={to}
      style={NAV_STYLE}
      onMouseEnter={e => { e.currentTarget.style.background = "rgba(179,107,255,.16)"; e.currentTarget.style.color = "#f4f4fa"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#b7b7c6"; }}
    >
      {children}
    </Link>
  );
}

export default function SiteHeader() {
  return (
    <header className="site-header" style={{ position: "relative", zIndex: 40, display: "flex", alignItems: "center", gap: 22, padding: "22px 5vw", flexWrap: "wrap" }}>
      <Link to="/" aria-label="BrawlMeta home" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none", flexShrink: 0 }}>
        <div style={{
          position: "relative", width: 42, height: 42, borderRadius: 13, background: "#08080b",
          border: "1px solid rgba(255,255,255,.14)", display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 0 0 1px rgba(255,255,255,.04) inset, 0 6px 16px rgba(0,0,0,.5)",
        }}>
          <div style={{ position: "relative", width: 24, height: 20 }}>
            <div style={{ position: "absolute", top: 0, left: 0, width: 24, height: 5, borderRadius: 3, background: "#f4f4f6", transform: "skewX(-22deg)" }} />
            <div style={{ position: "absolute", top: 7, left: 3, width: 18, height: 5, borderRadius: 3, background: "#f4f4f6", transform: "skewX(-22deg)" }} />
            <div style={{ position: "absolute", top: 14, left: 6, width: 12, height: 5, borderRadius: 3, background: "#f4f4f6", transform: "skewX(-22deg)" }} />
          </div>
        </div>
        <div style={{ lineHeight: .9 }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 20, letterSpacing: 1, color: "#f4f4fa" }}>
            Brawl<span style={{ color: "#b36bff" }}>Meta</span>
          </div>
        </div>
      </Link>

      <nav className="site-nav" style={{ display: "flex", alignItems: "center", gap: 2, marginLeft: 6, padding: 6, borderRadius: 999, background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", overflowX: "auto" }}>
        {NAV_ITEMS.map(n => <NavLink key={n.label} to={n.to}>{n.label}</NavLink>)}
      </nav>

      <div className="site-header-right" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 999,
          border: "1px solid rgba(255,180,61,.28)", background: "rgba(13,13,20,.6)",
          fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: 2, color: "#ffce7a",
        }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ffb43d", boxShadow: "0 0 8px #ffb43d", animation: "bm-pulse 1.5s infinite" }} />
          LIVE
        </div>
        <a
          href="#"
          style={{
            display: "inline-flex", alignItems: "center", padding: "12px 26px", borderRadius: 999,
            background: "#ffb43d", color: "#1a1206", fontWeight: 700, fontSize: 14, letterSpacing: .5,
            textDecoration: "none", boxShadow: "0 0 26px rgba(255,180,61,.4)", whiteSpace: "nowrap",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = "#ffc663"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "#ffb43d"; }}
        >
          Sign Up
        </a>
      </div>

      {/* Self-contained responsive rules — SiteHeader is used on multiple
          top-level routes (Home, App, placeholders), each its own route
          without a shared layout, so these can't live in a page-level
          stylesheet or they'd only apply on some pages. */}
      <style>{`
        @keyframes bm-pulse { 0%, 100% { opacity: .45; } 50% { opacity: 1; } }
        .site-nav { max-width: 100%; scrollbar-width: none; }
        .site-nav::-webkit-scrollbar { display: none; }
        .site-nav a { white-space: nowrap; }
        @media (max-width: 860px) {
          .site-header { padding: 14px 4vw !important; gap: 12px !important; }
          .site-nav a { padding: 8px 14px !important; font-size: 13px !important; }
        }
        @media (max-width: 560px) {
          .site-header-right > div:first-child { display: none; }
        }
      `}</style>
    </header>
  );
}
