// ─── In-game brawler tile styling ────────────────────────────────────────────
// Replicates the game's brawler-menu tiles:
//  • every tile gets a diagonal rarity-color gradient background
//  • Legendary brawlers get the radiant yellow starburst background
//  • Ultra Legendary gets the rainbow radial version
//  • brawlers with a Hypercharge get the iridescent silver-rainbow outer frame
//
// Brawlify's API exposes no hypercharge field, so ownership is maintained as
// an exception list: NO_HYPERCHARGE holds the (newest) brawlers that don't
// have one yet — everyone else is assumed to have it. Edit this set when new
// hypercharges ship.

export const NO_HYPERCHARGE = new Set([
  "BOLT", "STARR NOVA", "DAMIAN", "NAJIA", "SIRIUS", "GLOWY", "GIGI",
  "PIERCE", "ZIGGY", "MINA", "TRUNK", "ALLI", "KAZE",
  "JAE-YONG", "FINX", "LUMI", "OLLIE", "MEEPLE",
]);

export const hasHypercharge = (key) => !NO_HYPERCHARGE.has((key || "").toUpperCase().trim());

// Background for the tile interior, by rarity.
export function tileBackground(rarity, rarityColor = "#94a3b8") {
  if (rarity === "Legendary") {
    // In-game radiant gold starburst
    return "radial-gradient(circle at 50% 32%, #fff8d6 0%, #ffe14d 34%, #f5a623 68%, #b45309 100%)";
  }
  if (rarity === "Ultra Legendary") {
    // In-game rainbow radial
    return "conic-gradient(from 200deg at 50% 40%, #ff8f8f, #ffd166, #8ee6b0, #7cc4ff, #c98bff, #ff8f8f)";
  }
  return `linear-gradient(160deg, ${rarityColor}55 0%, ${rarityColor}22 55%, rgba(8,8,12,.9) 100%)`;
}

// The iridescent holographic frame worn by hypercharge tiles in the game.
// Used as the background of a thin wrapper square around the portrait.
export const HYPERCHARGE_FRAME =
  "conic-gradient(from 45deg, #dfe6f5, #ffd9f2 18%, #d1fff3 36%, #fff3c4 55%, #cfd8ff 72%, #f5d0ff 88%, #dfe6f5)";

// Convenience: outer-wrapper + inner-tile style pair for a square portrait of
// a given size. Callers spread these onto two nested divs with the <img>
// inside the inner one.
export function tileStyles({ key, rarity, rarityColor, size, radius }) {
  const r = radius ?? Math.round(size * 0.22);
  const holo = hasHypercharge(key);
  const framePad = holo ? Math.max(2, Math.round(size * 0.045)) : 0;
  return {
    outer: {
      width: size, height: size, borderRadius: r, padding: framePad, flexShrink: 0,
      background: holo ? HYPERCHARGE_FRAME : "transparent",
      boxShadow: holo ? "0 0 10px rgba(207,216,245,.35)" : "none",
    },
    inner: {
      width: "100%", height: "100%", borderRadius: Math.max(4, r - framePad),
      overflow: "hidden", background: tileBackground(rarity, rarityColor),
      display: "flex", alignItems: "center", justifyContent: "center",
      border: holo ? "none" : `2px solid ${rarityColor}60`,
    },
  };
}
