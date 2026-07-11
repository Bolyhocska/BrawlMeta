import SiteHeader from "./SiteHeader";

export default function ComingSoonPage({ eyebrow, title, description }) {
  return (
    <div style={{
      position: "relative", minHeight: "100vh", background: "#08080c",
      backgroundImage: "linear-gradient(rgba(179,107,255,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(179,107,255,.04) 1px, transparent 1px)",
      backgroundSize: "44px 44px", overflow: "hidden",
      color: "#e9e9f2", fontFamily: "'Chakra Petch', sans-serif", WebkitFontSmoothing: "antialiased",
      display: "flex", flexDirection: "column",
    }}>
      <div style={{ position: "absolute", top: -160, right: -120, width: 820, height: 720, background: "radial-gradient(ellipse, rgba(179,107,255,.20), transparent 68%)", pointerEvents: "none", filter: "blur(20px)" }} />
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(ellipse 120% 80% at 50% 40%, transparent 55%, rgba(0,0,0,.55))" }} />

      <SiteHeader />

      <main style={{
        position: "relative", zIndex: 10, flex: 1, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", textAlign: "center", padding: "40px 5vw", gap: 20,
      }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 18px", borderRadius: 999,
          background: "rgba(179,107,255,.10)", border: "1px solid rgba(179,107,255,.28)",
          fontFamily: "'JetBrains Mono', monospace", fontSize: 11, letterSpacing: 3, color: "#c98bff",
        }}>
          {eyebrow}
        </div>
        <h1 style={{
          fontFamily: "'Baloo 2', sans-serif", fontSize: "clamp(36px, 6vw, 64px)", fontWeight: 700,
          lineHeight: .95, letterSpacing: "-1px", color: "#f4f4fa",
        }}>{title}</h1>
        <p style={{ color: "#9a9aab", fontSize: 16, lineHeight: 1.6, maxWidth: 480 }}>{description}</p>
      </main>

      <footer style={{
        position: "relative", zIndex: 10, borderTop: "1px solid rgba(255,255,255,.06)", padding: "32px 5vw",
        display: "flex", justifyContent: "space-between", fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11, color: "#5a5a6a",
      }}>
        <span>BRAWLMETA — UNOFFICIAL STRATEGY GUIDE</span>
        <span>v2026.1 · META SNAPSHOT</span>
      </footer>
    </div>
  );
}
