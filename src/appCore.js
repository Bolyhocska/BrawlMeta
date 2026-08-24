// ─── Shared app core: supabase client, constants, formatting, data hooks ────
// Used by both the main app shell (App.jsx) and the draft assistant.

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import BRAWLER_META_IMPORT from "./data/brawlerMeta.json";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;
export const CURRENT_PATCH = "68.250";
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export const BRAWLERS = Object.entries(BRAWLER_META_IMPORT).map(([key, meta], i) => ({
  id: i + 1,
  key,
  name: key.toLowerCase().replace(/[a-z]+/g, w => w.charAt(0).toUpperCase() + w.slice(1)),
  role: meta.class || "Fighter",
  color: meta.rarityColor || "#94a3b8",
  rarity: meta.rarity || "Common",
  initial: key.slice(0, 2),
  imageUrl: meta.imageUrl || null,
})).sort((a, b) => a.name.localeCompare(b.name));

export const MODE_COLORS = {
  brawlBall:   "#3B82F6",
  brawlball:   "#3B82F6",
  gemGrab:     "#A855F7",
  gemgrab:     "#A855F7",
  knockout:    "#FF6B35",
  bounty:      "#06B6D4",
  heist:       "#F59E0B",
  hotZone:     "#EF4444",
  hotzone:     "#EF4444",
  wipeout:     "#FF6B35", duels: "#DC2626",
  showdown:    "#92400E", soloShowdown: "#92400E", duoShowdown: "#B45309",
};

// Official game-mode icons, self-hosted from public/icons/game-modes.
// Keyed by our camelCase mode ids; lowercase aliases mirror MODE_COLORS.
const MODE_ICON = (id) => `/icons/game-modes/${id}.png`;
export const MODE_ICONS = {
  gemGrab: MODE_ICON("48000000"), gemgrab: MODE_ICON("48000000"),
  brawlBall: MODE_ICON("48000005"), brawlball: MODE_ICON("48000005"),
  knockout: MODE_ICON("48000020"),
  bounty: MODE_ICON("48000003"),
  heist: MODE_ICON("48000002"),
  hotZone: MODE_ICON("48000017"), hotzone: MODE_ICON("48000017"),
};

// Official gear icons, self-hosted from public/icons/gears.
// The API exposes no gears endpoint, so these ids were identified by eye from
// the gear art: 0 Speed, 1 Health, 2 Damage, 3 Vision,
// 4 Shield, 5 Reload Speed.
const GEAR_ICON = (id) => `/icons/gears/${id}.png`;
export const GEAR_ICONS = {
  Speed: GEAR_ICON("62000000"),
  Health: GEAR_ICON("62000001"),
  Damage: GEAR_ICON("62000002"),
  Vision: GEAR_ICON("62000003"),
  Shield: GEAR_ICON("62000004"),
  Reload: GEAR_ICON("62000005"),
};

export const formatMode = (mode) => {
  if (!mode) return "Unknown";
  const spaced = mode.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
};

// Capitalize the first LETTER of each word, not the first character — "8-BIT"
// starts with a digit, so charAt(0).toUpperCase() was a no-op and the name
// rendered as "8-bit" everywhere it appeared. Hyphenated parts capitalize too,
// which is what "Jae-Yong" and "Mr. P" want anyway.
export const formatBrawlerName = (name) =>
  (name || "")
    .toLowerCase()
    .replace(/[a-z]+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1))
    .replace(/\s+/g, " ")
    .trim();

export const resolveMatchBracket = (match) => {
  if (match.rank_bracket) return match.rank_bracket;
  const avg = match.avg_brawler_trophies;
  if (typeof avg === "number") {
    return avg >= 2250 ? "masters_legendary" : "diamond_mythic";
  }
  return "diamond_mythic";
};

// Lazy per-map raw match loading — powers the draft assistant's map-aware
// suggestion engine.
// Raw rows are ONLY needed for exact-comp matchup stats (which brawlers beat a
// specific revealed enemy trio) — per-brawler map win rates come from the
// server-side BrawlerStats aggregate instead, which is why `enabled` should be
// false until an enemy pick actually exists.
//
// This used to pull every column with limit 100000 for every map selection:
// ~64k rows / ~10MB on a busy map. `anon` runs with statement_timeout = 3s, so
// past a certain table size the bigger maps started returning 57014 — and
// because the old code did `setMatches(data || [])` with no error check, a
// failed request was indistinguishable from "this map has no matches". The
// draft engine then scored every brawler on overall data alone, silently.
// Hence: bracket filtered server-side, only the two columns actually read, a
// limit that comfortably fits the timeout, and `failed` surfaced to callers.
export function useMapMatches(selectedPatch, mapName, enabled, rankBracket = null, limit = 20000) {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!enabled || !mapName) { setMatches([]); setFailed(false); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setMatches([]);
    setFailed(false);
    let q = supabase
      .from("Matches")
      .select("rank_bracket,winners,losers")
      .eq("patch", selectedPatch)
      .eq("map", mapName);
    if (rankBracket) q = q.eq("rank_bracket", rankBracket);
    q.limit(limit).then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        console.warn("[useMapMatches] match sample unavailable:", error.message);
        setFailed(true);
        setMatches([]);
      } else {
        setMatches(data || []);
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [selectedPatch, mapName, enabled, rankBracket, limit]);

  return { matches, loading, failed };
}
