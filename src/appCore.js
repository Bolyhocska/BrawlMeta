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
  name: key.toLowerCase().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
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

// Official game-mode icons (Brawlify CDN — same source as the brawler art).
// Keyed by our camelCase mode ids; lowercase aliases mirror MODE_COLORS.
const MODE_ICON = (id) => `https://cdn.brawlify.com/game-modes/regular/${id}.png`;
export const MODE_ICONS = {
  gemGrab: MODE_ICON("48000000"), gemgrab: MODE_ICON("48000000"),
  brawlBall: MODE_ICON("48000005"), brawlball: MODE_ICON("48000005"),
  knockout: MODE_ICON("48000020"),
  bounty: MODE_ICON("48000003"),
  heist: MODE_ICON("48000002"),
  hotZone: MODE_ICON("48000017"), hotzone: MODE_ICON("48000017"),
};

export const formatMode = (mode) => {
  if (!mode) return "Unknown";
  const spaced = mode.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
};

export const formatBrawlerName = (name) =>
  name
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

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
export function useMapMatches(selectedPatch, mapName, enabled) {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !mapName) return;
    setLoading(true);
    setMatches([]);
    supabase
      .from("Matches")
      .select("map,mode,rank_bracket,winners,losers")
      .eq("patch", selectedPatch)
      .eq("map", mapName)
      .limit(100000)
      .then(({ data }) => {
        setMatches(data || []);
        setLoading(false);
      });
  }, [selectedPatch, mapName, enabled]);

  return { matches, loading };
}
