import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "./auth";

const NAV_STYLE = {
  display: "inline-flex", alignItems: "center", textDecoration: "none", color: "#b7b7c6",
  fontFamily: "'Chakra Petch', sans-serif", fontWeight: 600, fontSize: 13.5, letterSpacing: ".2px",
  padding: "9px 14px", borderRadius: 999, transition: "background .18s, color .18s", whiteSpace: "nowrap",
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
  { label: "Guides", dropdown: [
    { label: "Skills Guide", desc: "Movement & shooting fundamentals", to: "/guides/skills" },
    { label: "Mode Guides", desc: "Every ranked mode + map guides", to: "/guides/modes" },
    { label: "Brawler Guides", desc: "Full guide for every brawler", to: "/guides/brawlers" },
  ] },
  { label: "Ranked", to: "/app?tab=meta" },
  { label: "Tournaments", to: "/tournaments" },
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

function NavDropdown({ item }) {
  // The dropdown panel uses position:fixed with coordinates measured from the
  // trigger button — the nav pill is a horizontal scroll container on small
  // screens (overflow-x), which would clip an absolutely-positioned child.
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef(null);

  const toggle = () => {
    if (!open && ref.current) {
      const r = ref.current.getBoundingClientRect();
      const width = 270;
      const left = Math.max(10, Math.min(window.innerWidth - width - 10, r.left + r.width / 2 - width / 2));
      setPos({ top: r.bottom + 10, left });
    }
    setOpen(o => !o);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target) && !e.target.closest?.(".nav-dropdown-panel")) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <>
      <button
        ref={ref}
        onClick={toggle}
        style={{ ...NAV_STYLE, background: open ? "rgba(179,107,255,.16)" : "transparent", color: open ? "#f4f4fa" : "#b7b7c6", border: "none", cursor: "pointer", gap: 6 }}
        onMouseEnter={e => { e.currentTarget.style.background = "rgba(179,107,255,.16)"; e.currentTarget.style.color = "#f4f4fa"; }}
        onMouseLeave={e => { if (!open) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#b7b7c6"; } }}
      >
        {item.label}
        <span style={{ fontSize: 9, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }}>▼</span>
      </button>
      {open && (
        <div className="nav-dropdown-panel" style={{
          position: "fixed", top: pos.top, left: pos.left, width: 270, padding: 10, borderRadius: 20, zIndex: 200,
          background: "rgba(13,13,20,.92)", border: "1px solid rgba(255,255,255,.1)",
          backdropFilter: "blur(14px)", boxShadow: "0 24px 60px rgba(0,0,0,.5)",
          display: "flex", flexDirection: "column", gap: 2,
        }}>
          {item.dropdown.map(d => (
            <Link key={d.to} to={d.to} onClick={() => setOpen(false)} style={{
              display: "flex", flexDirection: "column", gap: 2, padding: "12px 16px", borderRadius: 14, textDecoration: "none",
            }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(179,107,255,.14)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{ fontSize: 14, fontWeight: 700, color: "#f4f4fa" }}>{d.label}</span>
              <span style={{ fontSize: 12, color: "#9a9aab" }}>{d.desc}</span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

// Right-side account control: opens the login modal when signed out, or shows
// an avatar/name pill with a Profile + Sign-out menu when signed in.
function AccountMenu() {
  const { user, profile, openAuth, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  if (!user) {
    return (
      <button
        onClick={() => openAuth("signin")}
        style={{ display: "inline-flex", alignItems: "center", padding: "12px 26px", borderRadius: 999, background: "#ffb43d", color: "#1a1206", fontWeight: 700, fontSize: 14, letterSpacing: .5, border: "none", cursor: "pointer", boxShadow: "0 0 26px rgba(255,180,61,.4)", whiteSpace: "nowrap", fontFamily: "'Chakra Petch', sans-serif" }}
        onMouseEnter={e => { e.currentTarget.style.background = "#ffc663"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "#ffb43d"; }}
      >
        Sign In
      </button>
    );
  }

  const name = profile?.display_name || user.email?.split("@")[0] || "Player";
  const initial = name.charAt(0).toUpperCase();

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 12px 5px 6px", borderRadius: 999, background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.12)", color: "#f4f4fa", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "'Chakra Petch', sans-serif" }}
      >
        {profile?.avatar_url
          ? <img src={profile.avatar_url} alt="" style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover" }} onError={e => { e.currentTarget.style.display = "none"; }} />
          : <span style={{ width: 22, height: 22, borderRadius: "50%", background: "linear-gradient(135deg,#b36bff,#ffb43d)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#0d0d14", fontWeight: 800 }}>{initial}</span>}
        <span style={{ maxWidth: 88, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
        {profile?.is_premium && <span style={{ fontSize: 10 }}>👑</span>}
      </button>
      {open && (
        <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 8, width: 210, padding: 8, borderRadius: 16, background: "rgba(13,13,20,.96)", border: "1px solid rgba(255,255,255,.1)", boxShadow: "0 24px 60px rgba(0,0,0,.5)", zIndex: 200, backdropFilter: "blur(12px)" }}>
          <div style={{ padding: "8px 12px", borderBottom: "1px solid rgba(255,255,255,.07)", marginBottom: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#f4f4fa", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "#8a7fa6" }}>{profile?.player_tag || "no tag set"}</div>
          </div>
          <Link to="/tournaments/profile" onClick={() => setOpen(false)} style={{ display: "block", padding: "10px 12px", borderRadius: 10, textDecoration: "none", color: "#d9d9e6", fontSize: 13, fontWeight: 600 }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(179,107,255,.14)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
            My profile
          </Link>
          <button onClick={() => { setOpen(false); signOut(); }} style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 12px", borderRadius: 10, background: "none", border: "none", color: "#ff8f8f", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'Chakra Petch', sans-serif" }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,143,143,.1)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

// Phone navigation. The desktop pill nav is a horizontal scroller, which on a
// 375px screen showed about two and a half items with the rest hidden behind an
// invisible scroll — so on small screens the whole thing collapses into this
// single button and a full-width sheet listing every destination, dropdown
// children included (flattened, since a menu inside a menu on a phone is
// needless depth).
function MobileNav() {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();

  // Lock body scroll while the sheet is open so the page behind doesn't drift.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; document.removeEventListener("keydown", onKey); };
  }, [open]);

  const bar = { display: "block", width: 18, height: 2, borderRadius: 2, background: "#f4f4fa", transition: "transform .22s ease, opacity .18s ease" };

  return (
    <div className="mobile-nav">
      <button
        onClick={() => setOpen(o => !o)}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        style={{
          display: "inline-flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4,
          width: 42, height: 42, borderRadius: 13, cursor: "pointer",
          background: open ? "rgba(179,107,255,.16)" : "rgba(255,255,255,.05)",
          border: `1px solid ${open ? "rgba(179,107,255,.4)" : "rgba(255,255,255,.12)"}`,
          transition: "background .2s ease, border-color .2s ease",
        }}
      >
        <span style={{ ...bar, transform: open ? "translateY(6px) rotate(45deg)" : "none" }} />
        <span style={{ ...bar, opacity: open ? 0 : 1 }} />
        <span style={{ ...bar, transform: open ? "translateY(-6px) rotate(-45deg)" : "none" }} />
      </button>

      {/* Backdrop + sheet. Rendered together so one tap outside closes it. */}
      <div
        onClick={() => setOpen(false)}
        style={{
          position: "fixed", inset: 0, zIndex: 190, background: "rgba(6,6,10,.6)",
          backdropFilter: "blur(3px)", opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none", transition: "opacity .22s ease",
        }}
      />
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: "min(320px, 86vw)", zIndex: 200,
        background: "rgba(11,11,17,.98)", borderLeft: "1px solid rgba(255,255,255,.1)",
        boxShadow: "-24px 0 60px rgba(0,0,0,.55)", padding: "18px 16px",
        display: "flex", flexDirection: "column", gap: 4, overflowY: "auto",
        transform: open ? "translateX(0)" : "translateX(100%)",
        transition: "transform .26s cubic-bezier(.22,.75,.3,1)",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "2px 6px 12px", marginBottom: 6, borderBottom: "1px solid rgba(255,255,255,.08)",
        }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, letterSpacing: 2, color: "#8a7fa6" }}>MENU</span>
          <span style={{
            display: "flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999,
            border: "1px solid rgba(255,180,61,.28)", background: "rgba(13,13,20,.6)",
            fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: 1.5, color: "#ffce7a",
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ffb43d", boxShadow: "0 0 8px #ffb43d", animation: "bm-pulse 1.5s infinite" }} />
            LIVE
          </span>
        </div>

        {NAV_ITEMS.map(n => n.dropdown ? (
          <div key={n.label} style={{ marginTop: 6 }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: 1.6, color: "#6f7180", padding: "8px 14px 4px" }}>
              {n.label.toUpperCase()}
            </div>
            {n.dropdown.map(d => (
              <Link key={d.to} to={d.to} onClick={() => setOpen(false)} className="mobile-nav-link" style={{
                display: "flex", flexDirection: "column", gap: 1, padding: "11px 14px", borderRadius: 14,
                textDecoration: "none", color: "#d9d9e6", fontFamily: "'Chakra Petch', sans-serif",
              }}>
                <span style={{ fontSize: 14.5, fontWeight: 700, color: "#f4f4fa" }}>{d.label}</span>
                <span style={{ fontSize: 11.5, color: "#8b8b9c" }}>{d.desc}</span>
              </Link>
            ))}
          </div>
        ) : (
          <Link key={n.label} to={n.to} onClick={() => setOpen(false)} className="mobile-nav-link" style={{
            display: "block", padding: "13px 14px", borderRadius: 14, textDecoration: "none",
            color: "#e9e9f2", fontFamily: "'Chakra Petch', sans-serif", fontSize: 15, fontWeight: 600,
          }}>
            {n.label}
          </Link>
        ))}

        {!user && (
          <p style={{ margin: "14px 14px 0", fontSize: 11.5, lineHeight: 1.5, color: "#6f7180", fontFamily: "'Chakra Petch', sans-serif" }}>
            Sign in to save drafts and enter tournaments.
          </p>
        )}
      </div>
    </div>
  );
}

export default function SiteHeader() {
  return (
    <header className="site-header" style={{ position: "relative", zIndex: 40, display: "flex", alignItems: "center", gap: 22, padding: "22px 5vw", flexWrap: "nowrap" }}>
      <Link to="/" aria-label="BrawlApex home" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none", flexShrink: 0 }}>
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
            Brawl<span style={{ color: "#b36bff" }}>Apex</span>
          </div>
        </div>
      </Link>

      <nav className="site-nav" style={{ display: "flex", alignItems: "center", gap: 2, marginLeft: 6, padding: 6, borderRadius: 999, background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", overflowX: "auto", flex: "1 1 auto", minWidth: 0 }}>
        {NAV_ITEMS.map(n => n.dropdown
          ? <NavDropdown key={n.label} item={n} />
          : <NavLink key={n.label} to={n.to}>{n.label}</NavLink>)}
      </nav>

      <div className="site-header-right" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
        <AccountMenu />
        <div className="header-live desktop-live" style={{
          display: "flex", alignItems: "center", gap: 6, padding: "3px 10px", borderRadius: 999,
          border: "1px solid rgba(255,180,61,.28)", background: "rgba(13,13,20,.6)",
          fontFamily: "'JetBrains Mono', monospace", fontSize: 9, letterSpacing: 1.5, color: "#ffce7a",
        }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ffb43d", boxShadow: "0 0 8px #ffb43d", animation: "bm-pulse 1.5s infinite" }} />
          LIVE
        </div>
      </div>

      <MobileNav />

      {/* Self-contained responsive rules — SiteHeader is used on multiple
          top-level routes (Home, App, placeholders), each its own route
          without a shared layout, so these can't live in a page-level
          stylesheet or they'd only apply on some pages. */}
      <style>{`
        @keyframes bm-pulse { 0%, 100% { opacity: .45; } 50% { opacity: 1; } }
        .site-nav { max-width: 100%; scrollbar-width: none; }
        .site-nav::-webkit-scrollbar { display: none; }
        .site-nav a { white-space: nowrap; }
        .mobile-nav { display: none; }
        .mobile-nav-link { transition: background .18s ease, color .18s ease; }
        .mobile-nav-link:active { background: rgba(179,107,255,.18); }
        @media (hover: hover) { .mobile-nav-link:hover { background: rgba(179,107,255,.12); } }
        @media (max-width: 860px) {
          .site-header { padding: 14px 4vw !important; gap: 12px !important; }
          .site-nav a { padding: 8px 14px !important; font-size: 13px !important; }
        }
        /* Below 760px the pill nav can't show enough items to be useful, so it
           gives way entirely to the hamburger sheet. */
        @media (max-width: 760px) {
          .site-nav { display: none !important; }
          .mobile-nav { display: block; margin-left: auto; }
          .site-header-right { flex-direction: row !important; align-items: center !important; gap: 10px !important; }
          .desktop-live { display: none !important; }
        }
      `}</style>
    </header>
  );
}
