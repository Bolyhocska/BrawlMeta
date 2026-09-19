// ─── Shared meta icons ───────────────────────────────────────────────────────
// Brawler portraits, map thumbnails and mode badges, in one place.
//
// These started life inside NewsPage and are now used by the player profile
// too. Copying them was the obvious move and the wrong one: the brawler
// portrait carries the site's rarity-tile treatment (the same one
// DraftAssistant's BrawlerTile and the tier list use), so a second copy is a
// second place for that treatment to drift out of step.
//
// Every one of these fails SOFT. A missing portrait falls back to the
// brawler's initial on its rarity colour, and a missing map image renders
// nothing at all rather than a broken-image glyph — a new brawler or a newly
// rotated map arrives in the data before its art does, so the absent case is
// normal rather than exceptional.

import { useState } from "react";
import { BRAWLERS, MODE_ICONS } from "./appCore";
import { tileStyles } from "./data/brawlerTile";
import { mapSlug } from "./MapsPages";

export function findBrawler(label) {
  const key = (label || "").toUpperCase();
  return BRAWLERS.find((b) => b.key === key) || null;
}

/** Brawler portrait with the site-wide rarity tile, falling back to initials. */
export function BrawlerIcon({ name, size = 26 }) {
  const [broken, setBroken] = useState(false);
  const b = findBrawler(name);
  if (!b) return null;
  const t = tileStyles({ key: b.key, rarity: b.rarity, rarityColor: b.color, size });
  return (
    <div style={t.outer}>
      <div style={t.inner}>
        {!broken && b.imageUrl ? (
          <img
            src={b.imageUrl}
            alt=""
            loading="lazy"
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            onError={() => setBroken(true)}
          />
        ) : (
          <span style={{ fontSize: size * 0.4, fontWeight: 800, color: b.color }}>{b.initial}</span>
        )}
      </div>
    </div>
  );
}

/** Self-hosted map art from public/maps/, the same source MapsPages uses. */
export function MapThumb({ name, size = 26 }) {
  const [ok, setOk] = useState(true);
  if (!name || !ok) return null;
  return (
    <img
      src={`/maps/${mapSlug(name)}.png`}
      alt=""
      aria-hidden="true"
      onError={() => setOk(false)}
      style={{
        width: size, height: size, objectFit: "cover",
        borderRadius: Math.round(size * 0.2),
        border: "1px solid rgba(255,255,255,.12)", flexShrink: 0,
      }}
    />
  );
}

/** Small mode badge — mode recognition in this game is visual. */
export function ModeIcon({ mode, size = 14, inline = true }) {
  const src = MODE_ICONS[mode];
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      style={{
        width: size, height: size, flexShrink: 0,
        ...(inline ? { verticalAlign: "-2px", marginRight: 4 } : {}),
      }}
    />
  );
}
