// ─── Site footer with the required Supercell fan-content disclaimer ──────────
// Shown across the app. BrawlMeta reads only the official public API and is not
// a Supercell product; the disclaimer follows Supercell's Fan Content Policy.

export default function SiteFooter() {
  return (
    <footer style={{
      position: "relative", zIndex: 1, borderTop: "1px solid rgba(255,255,255,.07)",
      padding: "26px 5vw 34px", marginTop: 40, textAlign: "center",
      fontFamily: "'JetBrains Mono', monospace", fontSize: 11, lineHeight: 1.7, color: "#6f7180",
    }}>
      <div style={{ maxWidth: 760, margin: "0 auto" }}>
        This material is unofficial and is not endorsed by Supercell. For more information see
        {" "}
        <a href="https://supercell.com/en/fan-content-policy/" target="_blank" rel="noreferrer" style={{ color: "#9a8fc0" }}>
          Supercell's Fan Content Policy
        </a>.
        <div style={{ marginTop: 8, color: "#4a4a58" }}>
          BrawlMeta is a fan-made stats & tournament platform. Brawl Stars and its assets are trademarks of Supercell.
        </div>
      </div>
    </footer>
  );
}
