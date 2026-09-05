// ─── Shared app core: supabase client, constants, formatting, data hooks ────
// Used by both the main app shell (App.jsx) and the draft assistant.

import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { createClient } from "@supabase/supabase-js";
import BRAWLER_META_IMPORT from "./data/brawlerMeta.json";
import DRAFT_CONFIG from "./data/draft_logic_config.json";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;
// The patch the site READS. Moved to 69.230 on 2026-09-01, one day after the
// scraper constant in scrapers/common.py did, once the new epoch could actually
// carry the pages: 103 of 106 brawlers past 100 games, all 212 brawler_intelligence
// rows rebuilt, 175 of them with head-to-head data.
//
// What is still thin is MAP-level data - 527 brawler-map cells above 200 games
// against 2,422 on the patch we left. That degrades by design rather than
// breaking: mapPriority.blendPriorGames weights a map rate by its own sample
// and falls back to the brawler's mode and global rate for this patch, and
// map_pair_edges falls through to the patch-wide vs_brawler rate. Both fill in
// as the launch burst in scrapers/common.py collects.
//
// The two rebuild RPCs are scoped `WHERE patch = target_patch`, so 68.250 is
// still intact underneath and setting this back is a one-line revert.
export const CURRENT_PATCH = "69.230";
// The patch actually live in the game. Equal to CURRENT_PATCH once a rollover
// has completed, and AHEAD of it during the staging window between a patch going
// live and the site having enough of it to read - which is exactly when the UI
// must not call the older patch "current". Keeping the constant when the two
// agree costs nothing and makes the next rollover a one-line stage.
export const LIVE_PATCH = "69.230";
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Sample-weighted win rate ────────────────────────────────────────────────
// A map cell's win rate is only worth what its sample can carry, and right after
// a patch rollover almost none of them can carry much: on 69.230's first day the
// MEDIAN brawler-map cell held 59 games (±12.8 points at 95%) and 75% of them sat
// under 200. Printing "58.3%" off 59 games is noise dressed as evidence.
//
// So a displayed rate is pulled toward the brawler's own broader rate on the SAME
// patch, weighted by its own sample: weight = picks / (picks + prior). Thin cells
// lean on the broader rate, and the pull fades to nothing as games arrive — the
// weights let go by themselves, with no second deploy and no threshold to trip
// over.
//
// The prior target is the brawler's rate in this MODE on this patch, not the old
// patch's rate for the same cell. That distinction is the whole point and it was
// measured on the 68.250 -> 69.230 rollover: shrinking toward the previous
// patch showed El Primo at 48.7% when he measures 53.1%, Amber at 55.6% against
// 59.0%, Shade at 54.5% against 58.0%, and pulled the NERFED Nori UP from 45.0%
// to 48.6%. A balance patch is precisely the moment the old patch stops being a
// valid prior, and it is wrong hardest for the brawlers the patch changed —
// which are the ones anyone is looking up. Cross-patch priors are a trap here.
//
// Shared with the draft engine on purpose: the same constant the engine uses to
// weight a map rate in SCORING, so a map page and a suggestion card can never
// quote different numbers for the same brawler on the same map.
export const MAP_BLEND_PRIOR_GAMES = DRAFT_CONFIG?.mapPriority?.blendPriorGames ?? 400;
// A prior is only worth shrinking toward if it rests on more evidence than the
// cell it is stabilising. The engine enforces that in modeOrGlobalTWR - a mode
// rate under modeFallbackMinPicks is discarded for the brawler's global rate -
// and these two constants exist so a map PAGE applies the identical rule. When
// it did not, ANGELO's 34 games on Beach Ball were being pulled toward his 30
// games in that mode: noise stabilising noise, which put a brawler measured at
// 50.0% over 26,557 games top of the map at 67.4%.
export const MODE_FALLBACK_MIN_PICKS = DRAFT_CONFIG?.mapPriority?.modeFallbackMinPicks ?? 300;
export const CONFIDENCE_PRIOR_GAMES = DRAFT_CONFIG?.statisticalCoefficients?.confidencePriorGames ?? 30;

/** Win rate in percent, shrunk toward `priorRatePct` by sample size.
 *  Returns null for an empty cell, and the prior itself when there is no
 *  broader rate to fall back on. */
export const shrunkWinRate = (wins, picks, priorRatePct, priorGames = MAP_BLEND_PRIOR_GAMES) => {
  if (!picks) return null;
  if (priorRatePct == null || !Number.isFinite(priorRatePct)) return (wins / picks) * 100;
  return ((wins + priorGames * (priorRatePct / 100)) / (picks + priorGames)) * 100;
};

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

// ─── History-aware back control ──────────────────────────────────────────────
// A hardcoded back destination is wrong the moment a page can be reached from
// more than one place. /player/:tag is reachable from Leaderboards, from My
// Profile, and from a teammate link on another player's page — sending everyone
// to Leaderboards throws away where they actually came from.
//
// react-router sets location.key to "default" only for the first entry in the
// session, so it doubles as "is there anything to go back to". When there isn't
// — someone opened a shared link directly — we fall back to a sensible page
// rather than bouncing them off the site.
export function useSmartBack(fallbackTo, fallbackLabel) {
  const navigate = useNavigate();
  const location = useLocation();
  const canGoBack = location.key !== "default";
  return {
    label: canGoBack ? "Back" : fallbackLabel,
    goBack: () => (canGoBack ? navigate(-1) : navigate(fallbackTo)),
  };
}
