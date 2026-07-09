import { useState, useEffect, useMemo } from "react";
import { Routes, Route, useParams, useNavigate, Link } from "react-router-dom";
import { createClient } from "@supabase/supabase-js";
import {
  Swords, Shield, Zap, ChevronDown, Star, Target, TrendingUp, X, Check,
  RotateCcw, Map, Gamepad2, Cpu, Flame, ListOrdered, Crown, LineChart, ArrowUpRight
} from "lucide-react";
import BrawlersPage, { computeStatsFromAggregated, BrawlerGuidePage, findBrawlerKeyBySlug } from "./BrawlersPage";
import HomePage from "./HomePage";
import BRAWLER_META_IMPORT from "./data/brawlerMeta.json";

// ==========================================
// 🔌 SUPABASE CLOUD CONFIGURATION
// ==========================================
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;
const CURRENT_PATCH = "68.250";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);


const BRAWLERS = Object.entries(BRAWLER_META_IMPORT).map(([key, meta], i) => ({
  id: i + 1,
  key,
  name: key.toLowerCase().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
  role: meta.class || "Fighter",
  color: meta.rarityColor || "#94a3b8",
  initial: key.slice(0, 2),
  imageUrl: meta.imageUrl || null,
})).sort((a, b) => a.name.localeCompare(b.name));

const TIER_COLORS = { S: "#f59e0b", A: "#60a5fa", B: "#94a3b8", C: "#6b7280" };

const MODE_COLORS = {
  brawlBall:   "#3B82F6",
  brawlball:   "#3B82F6",
  gemGrab:     "#A855F7",
  gemgrab:     "#A855F7",
  knockout:    "#FF6B35",
  bounty:      "#06B6D4",
  heist:       "#F59E0B",
  hotZone:     "#EF4444",
  hotzone:     "#EF4444",
  wipeout:     "#FF6B35",
  duels:       "#DC2626",
  showdown:    "#92400E",
  soloShowdown:"#92400E",
  duoShowdown: "#B45309",
};

const RESULT_STYLES = {
  victory: { label: "Victory", color: "#10b981", bg: "rgba(16,185,129,0.12)", border: "rgba(16,185,129,0.35)" },
  defeat: { label: "Defeat", color: "#ef4444", bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.35)" },
  draw: { label: "Draw", color: "#94a3b8", bg: "rgba(148,163,184,0.12)", border: "rgba(148,163,184,0.35)" },
};

const formatMode = (mode) => {
  if (!mode) return "Unknown";
  const spaced = mode.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
};

const formatBrawlerName = (name) =>
  name
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

const getResultStyle = (result) => RESULT_STYLES[result?.toLowerCase()] ?? { label: result ?? "—", color: "#64748b", bg: "rgba(100,116,139,0.12)", border: "rgba(100,116,139,0.35)" };

const RANK_BRACKETS = [
  { id: "masters_legendary", label: "Masters & Legendary", accent: "#f59e0b" },
  { id: "diamond_mythic", label: "Diamond & Mythic", accent: "#a78bfa" },
];

const normalizeBrawlerKey = (name) => (name || "").toUpperCase().trim();

const resolveMatchBracket = (match) => {
  if (match.rank_bracket) return match.rank_bracket;
  const avg = match.avg_brawler_trophies;
  if (typeof avg === "number") {
    return avg >= 2250 ? "masters_legendary" : "diamond_mythic";
  }
  return "masters_legendary";
};

const filterMatchesByBracket = (matches, rankBracket) =>
  matches.filter((m) => resolveMatchBracket(m) === rankBracket);

const assignTier = (picks, wins, totalPicks) => {
  const winRate = picks ? (wins / picks) * 100 : 0;
  const pickRate = totalPicks ? (picks / totalPicks) * 100 : 0;
  if (winRate >= 55 && pickRate >= 2.5) return "S";
  if (winRate >= 52 && pickRate >= 1.5) return "A";
  if (winRate >= 48) return "B";
  return "C";
};

const MINIMUM_PICKS = 2;

const computeMetaFromMatches = (matches) => {
  const stats = {};
  let totalPicks = 0;

  for (const match of matches) {
    const winners = Array.isArray(match.winners) ? match.winners : [];
    const losers = Array.isArray(match.losers) ? match.losers : [];

    for (const raw of winners) {
      const key = normalizeBrawlerKey(raw);
      if (!key) continue;

      if (!stats[key]) {
        stats[key] = {
          key,
          name: formatBrawlerName(raw),
          picks: 0,
          wins: 0,
        };
      }

      stats[key].picks += 1;
      stats[key].wins += 1;
      totalPicks += 1;
    }

    for (const raw of losers) {
      const key = normalizeBrawlerKey(raw);
      if (!key) continue;

      if (!stats[key]) {
        stats[key] = {
          key,
          name: formatBrawlerName(raw),
          picks: 0,
          wins: 0,
        };
      }

      stats[key].picks += 1;
      totalPicks += 1;
    }
  }

  return Object.values(stats)
    .filter((b) => b.picks >= MINIMUM_PICKS)
    .map((b) => {
      const winRate =
        b.picks > 0
          ? Math.round((b.wins / b.picks) * 1000) / 10
          : 0;

      const pickRate =
        totalPicks > 0
          ? Math.round((b.picks / totalPicks) * 1000) / 10
          : 0;

      return {
        ...b,
        winRate,
        pickRate,
        tier: assignTier(b.picks, b.wins, totalPicks),
      };
    })
    .sort((a, b) => {
      if (b.winRate !== a.winRate) {
        return b.winRate - a.winRate;
      }
      return b.pickRate - a.pickRate;
    });
};

const getBrawlerVisual = (name) => {
  const key = normalizeBrawlerKey(name);
  const found = BRAWLERS.find((b) => b.key === key);
  if (found) return { color: found.color, initial: found.initial, imageUrl: found.imageUrl };
  const hash = [...key].reduce((sum, c) => sum + c.charCodeAt(0), 0);
  const palette = ["#60a5fa", "#a78bfa", "#f97316", "#34d399", "#f472b6"];
  return { color: palette[hash % palette.length], initial: key.slice(0, 2), imageUrl: null };
};

// ==========================================
// 🛰️ DYNAMIC SUPABASE HOOKS
// ==========================================
function usePatches() {
  const [patches, setPatches] = useState([CURRENT_PATCH]);
  useEffect(() => {
    supabase.from("BrawlerStats").select("patch").limit(100000).then(({ data }) => {
      if (!data) return;
      const unique = [...new Set([CURRENT_PATCH, ...data.map(r => r.patch).filter(Boolean)])].sort((a, b) => b.localeCompare(a));
      setPatches(unique);
    });
  }, []);
  return patches;
}

const PATCH_MAPS = {
  "67.306": [
    { name: "Dry Season",      mode: "bounty" },
    { name: "Hideout",         mode: "bounty" },
    { name: "Layer Cake",      mode: "bounty" },
    { name: "Shooting Star",   mode: "bounty" },
    { name: "Center Stage",    mode: "brawlBall" },
    { name: "Pinball Dreams",  mode: "brawlBall" },
    { name: "Sneaky Fields",   mode: "brawlBall" },
    { name: "Triple Dribble",  mode: "brawlBall" },
    { name: "Double Swoosh",   mode: "gemGrab" },
    { name: "Gem Fort",        mode: "gemGrab" },
    { name: "Hard Rock Mine",  mode: "gemGrab" },
    { name: "Undermine",       mode: "gemGrab" },
    { name: "Bridge Too Far",  mode: "heist" },
    { name: "Hot Potato",      mode: "heist" },
    { name: "Kaboom Canyon",   mode: "heist" },
    { name: "Safe Zone",       mode: "heist" },
    { name: "Dueling Beetles", mode: "hotZone" },
    { name: "In The Liminal",  mode: "hotZone" },
    { name: "Open Business",   mode: "hotZone" },
    { name: "Parallel Plays",  mode: "hotZone" },
    { name: "Quick Travel",    mode: "hotZone" },
    { name: "Ring Of Fire",    mode: "hotZone" },
    { name: "Belles Rock",     mode: "knockout" },
    { name: "Flaring Phoenix", mode: "knockout" },
    { name: "New Horizons",    mode: "knockout" },
    { name: "Out in the open", mode: "knockout" },
  ],
  "68.250": [
    { name: "Dry Season",      mode: "bounty" },
    { name: "Hideout",         mode: "bounty" },
    { name: "Layer Cake",      mode: "bounty" },
    { name: "Shooting Star",   mode: "bounty" },
    { name: "Center Stage",    mode: "brawlBall" },
    { name: "Pinball Dreams",  mode: "brawlBall" },
    { name: "Sneaky Fields",   mode: "brawlBall" },
    { name: "Triple Dribble",  mode: "brawlBall" },
    { name: "Double Swoosh",   mode: "gemGrab" },
    { name: "Gem Fort",        mode: "gemGrab" },
    { name: "Hard Rock Mine",  mode: "gemGrab" },
    { name: "Undermine",       mode: "gemGrab" },
    { name: "Bridge Too Far",  mode: "heist" },
    { name: "Hot Potato",      mode: "heist" },
    { name: "Kaboom Canyon",   mode: "heist" },
    { name: "Safe Zone",       mode: "heist" },
    { name: "Pit Stop",        mode: "heist" },
    { name: "Dueling Beetles", mode: "hotZone" },
    { name: "In The Liminal",  mode: "hotZone" },
    { name: "Open Business",   mode: "hotZone" },
    { name: "Parallel Plays",  mode: "hotZone" },
    { name: "Quick Travel",    mode: "hotZone" },
    { name: "Ring Of Fire",    mode: "hotZone" },
    { name: "Belles Rock",     mode: "knockout" },
    { name: "Flaring Phoenix", mode: "knockout" },
    { name: "New Horizons",    mode: "knockout" },
    { name: "Out in the open", mode: "knockout" },
  ],
};

function useMaps(selectedPatch) {
  const [maps, setMaps] = useState([]);
  useEffect(() => {
    if (!selectedPatch) return;
    if (PATCH_MAPS[selectedPatch]) { setMaps(PATCH_MAPS[selectedPatch]); return; }
    supabase
      .from("BrawlerStats")
      .select("map,mode,picks")
      .eq("patch", selectedPatch)
      .not("map", "is", null)
      .limit(100000)
      .then(({ data }) => {
        if (!data) return;
        // Count total picks per map, only include maps with enough data
        const mapPicks = {};
        const mapMode = {};
        for (const r of data) {
          if (!r.map) continue;
          mapPicks[r.map] = (mapPicks[r.map] || 0) + r.picks;
          mapMode[r.map] = r.mode;
        }
        const unique = Object.entries(mapPicks)
          .filter(([, picks]) => picks >= 200)
          .map(([name]) => ({ name, mode: mapMode[name] }));
        unique.sort((a, b) => {
          const modeCompare = (a.mode || "").localeCompare(b.mode || "");
          return modeCompare !== 0 ? modeCompare : a.name.localeCompare(b.name);
        });
        setMaps(unique);
      });
  }, [selectedPatch]);
  return maps;
}

function useBrawlerStats(selectedPatch) {
  const [stats, setStats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setStats([]);
    supabase
      .from("BrawlerStats")
      .select("*")
      .eq("patch", selectedPatch)
      .limit(100000)
      .then(({ data, error: err }) => {
        if (err) setError("Could not load stats.");
        else setStats(data || []);
        setLoading(false);
      });
  }, [selectedPatch]);

  return { stats, loading, error };
}

function useMapMatches(selectedPatch, mapName, enabled) {
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
      .then(({ data }) => {
        setMatches(data || []);
        setLoading(false);
      });
  }, [selectedPatch, mapName, enabled]);

  return { matches, loading };
}

const badgeStyles = {
  danger:  { bg: "rgba(239,68,68,0.18)",   color: "#fca5a5", border: "rgba(239,68,68,0.4)" },
  gold:    { bg: "rgba(245,158,11,0.18)",  color: "#fcd34d", border: "rgba(245,158,11,0.4)" },
  success: { bg: "rgba(16,185,129,0.18)",  color: "#6ee7b7", border: "rgba(16,185,129,0.4)" },
  warning: { bg: "rgba(251,191,36,0.18)",  color: "#fde68a", border: "rgba(251,191,36,0.4)" },
  info:    { bg: "rgba(96,165,250,0.18)",  color: "#93c5fd", border: "rgba(96,165,250,0.4)" },
};

function BrawlMeta() {
  const [activeTab, setActiveTab] = useState("meta");
  const [rankBracket, setRankBracket] = useState("masters_legendary");
  const [selectedPatch, setSelectedPatch] = useState(CURRENT_PATCH);
  const [selectedMap, setSelectedMap] = useState(null);
  const patches = usePatches();
  const maps = useMaps(selectedPatch);
  const { stats: brawlerStats, loading: statsLoading, error: statsError } = useBrawlerStats(selectedPatch);
  const { matches: mapMatches } = useMapMatches(selectedPatch, selectedMap?.name, activeTab === "meta" && !!selectedMap);
  const [mapOpen, setMapOpen] = useState(false);

  const [blueTeam, setBlueTeam] = useState([null, null, null]);
  const [redTeam, setRedTeam] = useState([null, null, null]);
  const [blueBans, setBlueBans] = useState([null, null, null]);
  const [redBans, setRedBans] = useState([null, null, null]);
  const [bansEnabled, setBansEnabled] = useState(false);
  // phase: "setup" | "ban" | "pick"
  const [phase, setPhase] = useState("setup");
  // firstPick: "blue" | "red"
  const [firstPick, setFirstPick] = useState(null);
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState("All");
  const [suggestions, setSuggestions] = useState([]);
  const [animKey, setAnimKey] = useState(0);
  const [quickInfoBrawler, setQuickInfoBrawler] = useState(null);

  // Auto-select first map when maps load or patch changes
  useEffect(() => {
    if (maps.length > 0) {
      setSelectedMap(prev => {
        if (!prev || !maps.find(m => m.name === prev.name)) return maps[0];
        return prev;
      });
    }
  }, [maps]);

  // Pick sequence 1-2-2-1: first picker gets slots 0,2 / second picker gets slots 0,1,2
  // blue first: B0, R0, R1, B1, B2, R2
  // red first:  R0, B0, B1, R1, R2, B2
  const pickSequence = useMemo(() => {
    if (!firstPick) return [];
    const a = firstPick;
    const b = a === "blue" ? "red" : "blue";
    return [
      { team: a, idx: 0 },
      { team: b, idx: 0 },
      { team: b, idx: 1 },
      { team: a, idx: 1 },
      { team: a, idx: 2 },
      { team: b, idx: 2 },
    ];
  }, [firstPick]);

  // Ban sequence: blue bans all 3 first, then red bans all 3
  const banSequence = useMemo(() => [
    { team: "blue", idx: 0 },
    { team: "blue", idx: 1 },
    { team: "blue", idx: 2 },
    { team: "red", idx: 0 },
    { team: "red", idx: 1 },
    { team: "red", idx: 2 },
  ], []);

  // Current active slot derived from game state
  const activeSlot = useMemo(() => {
    if (phase === "ban") {
      for (const slot of banSequence) {
        const bans = slot.team === "blue" ? blueBans : redBans;
        if (bans[slot.idx] === null) return { ...slot, phase: "ban" };
      }
      return null;
    }
    if (phase === "pick") {
      for (const slot of pickSequence) {
        const team = slot.team === "blue" ? blueTeam : redTeam;
        if (team[slot.idx] === null) return { ...slot, phase: "pick" };
      }
      return null;
    }
    return null;
  }, [phase, banSequence, pickSequence, blueBans, redBans, blueTeam, redTeam]);

  // Auto-advance from ban to pick phase when all bans done
  useEffect(() => {
    if (phase === "ban" && bansEnabled) {
      const allBansDone = [...blueBans, ...redBans].every(b => b !== null);
      if (allBansDone) setPhase("pick");
    }
  }, [blueBans, redBans, phase, bansEnabled]);

  const allBanned = [...blueBans, ...redBans].filter(Boolean).map(b => b.id);
  const allPicked = [...blueTeam, ...redTeam].filter(Boolean).map((b) => b.id);
  const allUsed = [...allBanned, ...allPicked];

  // Confidence-weighted score: penalises small samples so niche brawlers don't dominate
  const CONFIDENCE = 30;
  const confidenceScore = (wins, picks) =>
    picks === 0 ? 0 : (wins / picks) * 100 * (picks / (picks + CONFIDENCE));

  // Data-driven suggestions + recommended bans
  const [recommendedBans, setRecommendedBans] = useState([]);
  useEffect(() => {
    const pickerTeam = activeSlot?.team ?? (firstPick || "blue");
    const enemyTeam = pickerTeam === "blue" ? redTeam : blueTeam;
    const enemyKeys = enemyTeam.filter(Boolean).map(b => b.name.toUpperCase());
    const allUsedNames = [
      ...blueTeam.filter(Boolean).map(b => b.name.toUpperCase()),
      ...redTeam.filter(Boolean).map(b => b.name.toUpperCase()),
      ...blueBans.filter(Boolean).map(b => b.name.toUpperCase()),
      ...redBans.filter(Boolean).map(b => b.name.toUpperCase()),
    ];

    const stats = {};
    const bracketMatches = mapMatches.filter(m => resolveMatchBracket(m) === rankBracket);

    for (const match of bracketMatches) {
      const winners = (match.winners || []).map(b => b.toUpperCase());
      const losers = (match.losers || []).map(b => b.toUpperCase());

      // Always collect overall map stats for ban recommendations
      for (const b of winners) { if (!stats[b]) stats[b] = { picks: 0, wins: 0 }; stats[b].picks++; stats[b].wins++; }
      for (const b of losers)  { if (!stats[b]) stats[b] = { picks: 0, wins: 0 }; stats[b].picks++; }
    }

    // Recommended bans: top brawlers by confidence score on this map
    const bans = Object.entries(stats)
      .filter(([, s]) => s.picks >= 15)
      .map(([key, s]) => ({
        key,
        name: formatBrawlerName(key),
        winRate: Math.round((s.wins / s.picks) * 1000) / 10,
        picks: s.picks,
        score: confidenceScore(s.wins, s.picks),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
    setRecommendedBans(bans);

    // Pick suggestions
    const pickStats = {};
    for (const match of bracketMatches) {
      const winners = (match.winners || []).map(b => b.toUpperCase());
      const losers = (match.losers || []).map(b => b.toUpperCase());

      if (enemyKeys.length === 0) {
        for (const b of winners) { if (!pickStats[b]) pickStats[b] = { picks: 0, wins: 0 }; pickStats[b].picks++; pickStats[b].wins++; }
        for (const b of losers)  { if (!pickStats[b]) pickStats[b] = { picks: 0, wins: 0 }; pickStats[b].picks++; }
      } else {
        const enemyInLosers  = enemyKeys.every(e => losers.includes(e));
        const enemyInWinners = enemyKeys.every(e => winners.includes(e));
        let myTeam = null;
        if (enemyInLosers)  myTeam = { side: winners, won: true };
        else if (enemyInWinners) myTeam = { side: losers, won: false };
        if (myTeam) {
          for (const b of myTeam.side) {
            if (!pickStats[b]) pickStats[b] = { picks: 0, wins: 0 };
            pickStats[b].picks++;
            if (myTeam.won) pickStats[b].wins++;
          }
        }
      }
    }

    // Min picks raised to cut noisy low-sample suggestions (see confidenceScore
    // discussion — 15 picks carries a ±25% margin of error, not trustworthy).
    // Top 3 only: the assistant should give a confident short-list, not a long tail.
    const MIN_PICKS_SUGGESTION = 50;
    const results = Object.entries(pickStats)
      .filter(([key]) => !allUsedNames.includes(key))
      .filter(([, s]) => s.picks >= MIN_PICKS_SUGGESTION)
      .map(([key, s]) => ({
        key,
        name: formatBrawlerName(key),
        winRate: Math.round((s.wins / s.picks) * 1000) / 10,
        picks: s.picks,
        score: confidenceScore(s.wins, s.picks),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    setSuggestions(results);
    setAnimKey(k => k + 1);
  }, [blueTeam, redTeam, blueBans, redBans, selectedMap, mapMatches, rankBracket, activeSlot, firstPick]);

  const roles = ["All", ...Array.from(new Set(BRAWLERS.map((b) => b.role))).sort()];
  const filtered = BRAWLERS.filter((b) => {
    const matchSearch = b.name.toLowerCase().includes(search.toLowerCase());
    const matchRole = filterRole === "All" || b.role === filterRole;
    return matchSearch && matchRole;
  });

  const handleBrawlerSelect = (brawler) => {
    if (allUsed.includes(brawler.id)) return;
    if (!activeSlot) return;

    if (activeSlot.phase === "ban") {
      if (activeSlot.team === "blue") {
        const next = [...blueBans]; next[activeSlot.idx] = brawler; setBlueBans(next);
      } else {
        const next = [...redBans]; next[activeSlot.idx] = brawler; setRedBans(next);
      }
    } else {
      if (activeSlot.team === "blue") {
        const next = [...blueTeam]; next[activeSlot.idx] = brawler; setBlueTeam(next);
      } else {
        const next = [...redTeam]; next[activeSlot.idx] = brawler; setRedTeam(next);
      }
    }
  };

  const removePickSlot = (team, idx) => {
    if (team === "blue") { const next = [...blueTeam]; next[idx] = null; setBlueTeam(next); }
    else { const next = [...redTeam]; next[idx] = null; setRedTeam(next); }
  };

  const removeBanSlot = (team, idx) => {
    if (team === "blue") { const next = [...blueBans]; next[idx] = null; setBlueBans(next); }
    else { const next = [...redBans]; next[idx] = null; setRedBans(next); }
    // If bans were done, revert to ban phase
    if (phase === "pick") setPhase("ban");
  };

  const coinFlip = () => setFirstPick(Math.random() < 0.5 ? "blue" : "red");

  const startDraft = () => {
    if (!firstPick) return;
    setPhase(bansEnabled ? "ban" : "pick");
  };

  const resetDraft = () => {
    setBlueTeam([null, null, null]);
    setRedTeam([null, null, null]);
    setBlueBans([null, null, null]);
    setRedBans([null, null, null]);
    setPhase("setup");
    setFirstPick(null);
  };

  return (
    <div style={styles.root}>
      <div style={styles.scanlines} />

      {/* NAVBAR */}
      <nav style={styles.nav} className="app-nav">
        <Link to="/" style={{ ...styles.navBrand, textDecoration: "none" }}>
          <div style={styles.brandIcon}>
            <div style={styles.brandDiamond} />
          </div>
          <span style={styles.brandText}>BRAWL<span style={styles.brandAccent}>//</span>META</span>
          <span style={styles.brandBadge}>RANKED INTEL</span>
        </Link>

        {/* TAB NAVIGATION */}
        <div style={styles.tabGroup} className="tab-group">
          <button style={{ ...styles.tabBtn, ...(activeTab === "trending" ? styles.tabBtnActive : {}) }} onClick={() => setActiveTab("trending")}>
            <Flame size={14} /> Trending
          </button>
          <button style={{ ...styles.tabBtn, ...(activeTab === "meta" ? styles.tabBtnActive : {}) }} onClick={() => setActiveTab("meta")}>
            <Cpu size={14} /> Draft Assistant
          </button>
          <button style={{ ...styles.tabBtn, ...(activeTab === "brawlers" ? styles.tabBtnActive : {}) }} onClick={() => setActiveTab("brawlers")}>
            <ListOrdered size={14} /> Tier List
          </button>
          <button style={{ ...styles.tabBtn, ...(activeTab === "premium" ? styles.tabBtnActive : {}) }} onClick={() => setActiveTab("premium")}>
            <Crown size={14} color={activeTab === "premium" ? "#f59e0b" : "#64748b"} /> Premium
          </button>
        </div>

        <div style={styles.navRight}>
          {activeTab === "meta" && (
            <button style={styles.resetBtn} onClick={resetDraft}>
              <RotateCcw size={13} /> Reset
            </button>
          )}
        </div>
      </nav>

      {/* MAIN LAYOUT GATEWAY */}
      <div style={styles.contentContainer}>
        <RankBracketSelector value={rankBracket} onChange={setRankBracket} selectedPatch={selectedPatch} onPatchChange={setSelectedPatch} patches={patches} />
        {activeTab === "trending" && (
          <TrendingView
            rankBracket={rankBracket}
            brawlerStats={brawlerStats}
            loading={statsLoading}
            error={statsError}
          />
        )}
        {activeTab === "meta" && (
          <div style={styles.main} className="main-grid">
            {/* LEFT — DRAFT PANELS */}
            <div style={styles.draftPanel} className="draft-panel">
              {/* MAP + STATUS BAR */}
              <div style={styles.panelHeader}>
                <Map size={14} color="#94a3b8" />
                <div style={styles.mapDropdownWrapper}>
                  {selectedMap ? (() => {
                    const mc = MODE_COLORS[selectedMap.mode?.replace(/\s/g, "")] ?? MODE_COLORS[selectedMap.mode?.toLowerCase?.()] ?? "#64748b";
                    return (
                      <button style={styles.mapDropdown} onClick={() => setMapOpen(!mapOpen)}>
                        <span style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600 }}>{selectedMap?.name}</span>
                        <span style={{ ...styles.modeBadge, background: mc + "30", color: mc, border: `1px solid ${mc}50` }}>
                          {formatMode(selectedMap.mode)}
                        </span>
                        <ChevronDown size={13} color="#64748b" style={{ transform: mapOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
                      </button>
                    );
                  })() : <span style={{ fontSize: 13, color: "#475569" }}>Loading maps…</span>}
                  {mapOpen && maps.length > 0 && (
                    <MapFlyoutMenu
                      maps={maps}
                      selectedMap={selectedMap}
                      onSelect={(m) => { setSelectedMap(m); setMapOpen(false); }}
                    />
                  )}
                </div>
                {phase !== "setup" && (
                  <span style={styles.pickCounter}>
                    {phase === "ban" ? `Banning ${allBanned.length}/6` : `${allPicked.length}/6 Picked`}
                  </span>
                )}
              </div>

              {/* SETUP PHASE */}
              {phase === "setup" && (
                <div style={{ background: "#150f22", border: "1px solid #2c2140", borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#94a3b8", letterSpacing: "0.08em", textTransform: "uppercase" }}>Draft Setup</div>

                  {/* Bans toggle */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "#0a0711", borderRadius: 8, border: "1px solid #2c2140" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>Enable Bans</div>
                      <div style={{ fontSize: 11, color: "#475569" }}>3 bans per team before picking</div>
                    </div>
                    <button onClick={() => setBansEnabled(v => !v)} style={{
                      width: 44, height: 24, borderRadius: 12, border: "none", cursor: "pointer", position: "relative",
                      background: bansEnabled ? "#f59e0b" : "#2c2140", transition: "background 0.2s",
                    }}>
                      <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: bansEnabled ? 23 : 3, transition: "left 0.2s" }} />
                    </button>
                  </div>

                  {/* Coin flip */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 11, color: "#64748b" }}>Who picks first?</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => setFirstPick("blue")} style={{ flex: 1, padding: "10px", borderRadius: 8, border: `1.5px solid ${firstPick === "blue" ? "#3b82f6" : "#2c2140"}`, background: firstPick === "blue" ? "rgba(59,130,246,0.15)" : "#0a0711", color: firstPick === "blue" ? "#3b82f6" : "#64748b", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                        🔵 Blue Team
                      </button>
                      <button onClick={coinFlip} style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #2c2140", background: "#0a0711", color: "#f59e0b", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                        🎲 Random
                      </button>
                      <button onClick={() => setFirstPick("red")} style={{ flex: 1, padding: "10px", borderRadius: 8, border: `1.5px solid ${firstPick === "red" ? "#ef4444" : "#2c2140"}`, background: firstPick === "red" ? "rgba(239,68,68,0.15)" : "#0a0711", color: firstPick === "red" ? "#ef4444" : "#64748b", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                        🔴 Red Team
                      </button>
                    </div>
                    {firstPick && (
                      <div style={{ fontSize: 11, color: "#64748b", textAlign: "center" }}>
                        Pick order: {firstPick === "blue"
                          ? "Blue → Red Red → Blue Blue → Red"
                          : "Red → Blue Blue → Red Red → Blue"}
                        {bansEnabled && <span style={{ color: "#f59e0b" }}> · {firstPick === "blue" ? "Red" : "Blue"} bans first</span>}
                      </div>
                    )}
                  </div>

                  <button onClick={startDraft} disabled={!firstPick} style={{ padding: "12px", borderRadius: 8, border: "none", background: firstPick ? "#f59e0b" : "#2c2140", color: firstPick ? "#0a0711" : "#475569", fontWeight: 800, fontSize: 13, cursor: firstPick ? "pointer" : "not-allowed", letterSpacing: "0.06em" }}>
                    {firstPick ? `START DRAFT` : "SELECT WHO PICKS FIRST"}
                  </button>
                </div>
              )}

              {/* BAN PHASE indicator */}
              {phase === "ban" && activeSlot && (
                <div style={{ padding: "10px 14px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", animation: "pulse 1s infinite" }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: activeSlot.team === "blue" ? "#60a5fa" : "#f87171" }}>
                    {activeSlot.team === "blue" ? "Blue" : "Red"} Team
                  </span>
                  <span style={{ fontSize: 12, color: "#94a3b8" }}>is banning (ban {allBanned.length + 1}/6)</span>
                </div>
              )}

              {/* PICK PHASE indicator */}
              {phase === "pick" && activeSlot && (
                <div style={{ padding: "10px 14px", background: activeSlot.team === "blue" ? "rgba(59,130,246,0.08)" : "rgba(239,68,68,0.08)", border: `1px solid ${activeSlot.team === "blue" ? "rgba(59,130,246,0.25)" : "rgba(239,68,68,0.25)"}`, borderRadius: 8, display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: activeSlot.team === "blue" ? "#3b82f6" : "#ef4444", animation: "pulse 1s infinite" }} />
                  <span style={{ fontSize: 12, fontWeight: 700, color: activeSlot.team === "blue" ? "#60a5fa" : "#f87171" }}>
                    {activeSlot.team === "blue" ? "Blue" : "Red"} Team
                  </span>
                  <span style={{ fontSize: 12, color: "#94a3b8" }}>is picking (pick {allPicked.length + 1}/6)</span>
                </div>
              )}

              {/* TEAMS + BANS */}
              {phase !== "setup" && (
                <div style={styles.teamsGrid} className="teams-grid">
                  {/* BLUE */}
                  <div style={styles.teamColumn}>
                    <div style={styles.teamLabel}>
                      <Shield size={13} color="#3b82f6" />
                      <span style={{ color: "#3b82f6", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em" }}>BLUE TEAM</span>
                    </div>
                    {/* Blue bans */}
                    {bansEnabled && (
                      <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
                        {blueBans.map((b, idx) => (
                          <BanSlot key={idx} brawler={b} active={phase === "ban" && activeSlot?.team === "blue" && activeSlot?.idx === idx} onRemove={() => removeBanSlot("blue", idx)} />
                        ))}
                      </div>
                    )}
                    {blueTeam.map((brawler, idx) => (
                      <DraftSlot key={idx} brawler={brawler} team="blue" idx={idx}
                        active={phase === "pick" && activeSlot?.team === "blue" && activeSlot?.idx === idx}
                        onClick={() => brawler && setQuickInfoBrawler({ key: brawler.key, name: brawler.name, winRate: null, picks: null })}
                        onRemove={() => removePickSlot("blue", idx)} />
                    ))}
                  </div>
                  <div style={styles.vsDivider}><div style={styles.vsCircle}>VS</div></div>
                  {/* RED */}
                  <div style={styles.teamColumn}>
                    <div style={{ ...styles.teamLabel, justifyContent: "flex-end" }}>
                      <span style={{ color: "#ef4444", fontSize: 12, fontWeight: 700, letterSpacing: "0.08em" }}>RED TEAM</span>
                      <Swords size={13} color="#ef4444" />
                    </div>
                    {bansEnabled && (
                      <div style={{ display: "flex", gap: 4, marginBottom: 4, justifyContent: "flex-end" }}>
                        {redBans.map((b, idx) => (
                          <BanSlot key={idx} brawler={b} active={phase === "ban" && activeSlot?.team === "red" && activeSlot?.idx === idx} onRemove={() => removeBanSlot("red", idx)} />
                        ))}
                      </div>
                    )}
                    {redTeam.map((brawler, idx) => (
                      <DraftSlot key={idx} brawler={brawler} team="red" idx={idx}
                        active={phase === "pick" && activeSlot?.team === "red" && activeSlot?.idx === idx}
                        onClick={() => brawler && setQuickInfoBrawler({ key: brawler.key, name: brawler.name, winRate: null, picks: null })}
                        onRemove={() => removePickSlot("red", idx)} />
                    ))}
                  </div>
                </div>
              )}

              {/* BRAWLER PICKER — only shown during ban/pick phases */}
              {phase !== "setup" && (
                <div style={styles.pickerSection}>
                  <div style={styles.pickerHeader}>
                    <div style={styles.searchWrapper}>
                      <Target size={13} color="#64748b" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
                      <input style={styles.searchInput} placeholder="Search brawler…" value={search} onChange={(e) => setSearch(e.target.value)} />
                    </div>
                    <div style={styles.roleFilters}>
                      {roles.map((r) => (
                        <button key={r} style={{ ...styles.roleBtn, ...(filterRole === r ? styles.roleBtnActive : {}) }} onClick={() => setFilterRole(r)}>{r}</button>
                      ))}
                    </div>
                  </div>
                  <div style={styles.brawlerGrid}>
                    {filtered.map((b) => {
                      const used = allUsed.includes(b.id);
                      const isBan = phase === "ban";
                      return (
                        <BrawlerChip key={b.id} brawler={b} used={used} isBan={isBan} onSelect={handleBrawlerSelect} />
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* SIDEBAR AI MATCH RECOMMENDATIONS */}
            <div style={styles.sidebar} className="draft-sidebar">

              {/* RECOMMENDED BANS — shown during ban phase */}
              {phase === "ban" && recommendedBans.length > 0 && (
                <div>
                  <div style={{ ...styles.panelHeader, marginBottom: 8 }}>
                    <Shield size={15} color="#ef4444" />
                    <span style={{ ...styles.panelTitle, color: "#ef4444" }}>Recommended Bans</span>
                  </div>
                  <div style={{ fontSize: 10, color: "#475569", marginBottom: 8 }}>
                    Strongest brawlers on <span style={{ color: "#f59e0b" }}>{selectedMap?.name}</span> — ban these first
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {recommendedBans.map((b, i) => {
                      const meta = BRAWLER_META_IMPORT[b.key] || {};
                      const [imgErr, setImgErr] = useState(false);
                      return (
                        <div key={b.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8 }}>
                          <span style={{ fontSize: 10, fontWeight: 800, color: "#475569", width: 14 }}>#{i + 1}</span>
                          <div style={{ width: 28, height: 28, borderRadius: 5, overflow: "hidden", background: `${meta.rarityColor || "#475569"}20`, border: `1.5px solid ${meta.rarityColor || "#475569"}50`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {!imgErr && meta.imageUrl
                              ? <img src={meta.imageUrl} alt={b.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={() => setImgErr(true)} />
                              : <span style={{ fontSize: 8, fontWeight: 800, color: meta.rarityColor || "#94a3b8" }}>{b.key.slice(0, 2)}</span>
                            }
                          </div>
                          <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>{b.name}</span>
                          <span style={{ fontSize: 12, fontWeight: 800, color: "#ef4444" }}>{b.winRate}%</span>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ borderTop: "1px solid #2c2140", marginTop: 12 }} />
                </div>
              )}

              <div style={styles.panelHeader}>
                <Cpu size={15} color="#a78bfa" />
                <span style={{ ...styles.panelTitle, color: "#a78bfa" }}>AI Pick Suggestions</span>
              </div>

              {/* Context label */}
              <div style={{ fontSize: 10, color: "#475569", lineHeight: 1.5, padding: "0 2px" }}>
                {(() => {
                  const pickerTeam = activeSlot?.team ?? (firstPick || "blue");
                  const enemyTeam = pickerTeam === "blue" ? redTeam : blueTeam;
                  const enemyPicks = enemyTeam.filter(Boolean);
                  if (enemyPicks.length === 0)
                    return <>Best on <span style={{ color: "#f59e0b" }}>{selectedMap?.name}</span> overall</>;
                  return <>Wins on <span style={{ color: "#f59e0b" }}>{selectedMap?.name}</span> vs {enemyPicks.map(b => b.name).join(", ")}</>;
                })()}
              </div>

              <div style={styles.suggestionList} key={animKey}>
                {suggestions.length === 0 && phase !== "setup" && (
                  <div style={{ fontSize: 11, color: "#334155", textAlign: "center", padding: "16px 0" }}>
                    Not enough data for this matchup.<br />
                    <span style={{ color: "#475569" }}>Try selecting a different map.</span>
                  </div>
                )}
                {phase === "setup" && (
                  <div style={{ fontSize: 11, color: "#334155", textAlign: "center", padding: "16px 0" }}>
                    Start the draft to see suggestions.
                  </div>
                )}
                {suggestions.map((s, i) => (
                  <SuggestionCard key={s.key} s={s} i={i} onClick={() => {
                    const full = BRAWLERS.find(b => b.key === s.key);
                    if (full) handleBrawlerSelect(full);
                  }} />
                ))}
              </div>
              <div style={styles.synergyPanel}><SynergyBar blueTeam={blueTeam} redTeam={redTeam} /></div>
            </div>
          </div>
        )}
        {quickInfoBrawler && (
          <SuggestionQuickInfo
            suggestion={quickInfoBrawler}
            brawlerStats={brawlerStats}
            rankBracket={rankBracket}
            onClose={() => setQuickInfoBrawler(null)}
          />
        )}
        {activeTab === "brawlers" && (
          <BrawlersPage
            brawlerStats={brawlerStats}
            loading={statsLoading}
            error={statsError}
            rankBracket={rankBracket}
          />
        )}
        {activeTab === "premium" && <PremiumView />}
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;900&family=Barlow:wght@400;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .suggestion-anim { animation: fadeUp 0.3s ease both; }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

        /* ===== Responsive: tablet & phone ===== */
        @media (max-width: 900px) {
          .main-grid { grid-template-columns: 1fr !important; }
          .draft-sidebar { border-left: none !important; border-top: 1px solid #1b1329 !important; }
          .teams-grid { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 640px) {
          .app-nav { flex-wrap: wrap; gap: 8px; padding: 10px 14px !important; }
          .tab-group { margin-left: 0 !important; gap: 2px; overflow-x: auto; }
          .tab-group button { padding: 6px 9px !important; font-size: 10px !important; white-space: nowrap; }
          .rank-bracket-bar { flex-wrap: wrap; gap: 10px !important; padding: 10px 14px !important; }
          .draft-panel { padding: 12px !important; }
          .guide-header { flex-direction: column !important; align-items: flex-start !important; }
        }
      `}</style>
    </div>
  );
}

/* ==========================================
   SUB-VIEWS COMPONENT MODULES
   ========================================== */

function MapFlyoutMenu({ maps, selectedMap, onSelect }) {
  const [hoveredMode, setHoveredMode] = useState(null);

  const grouped = maps.reduce((acc, m) => {
    const mode = m.mode || "Unknown";
    if (!acc[mode]) acc[mode] = [];
    acc[mode].push(m);
    return acc;
  }, {});

  const modes = Object.keys(grouped).sort();

  return (
    <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, zIndex: 300, display: "flex" }}>
      {/* Mode list */}
      <div style={{ background: "#150f22", border: "1px solid #2c2140", borderRadius: 8, overflow: "hidden", minWidth: 160 }}>
        {modes.map(mode => {
          const mc = MODE_COLORS[mode?.replace(/\s/g, "")] ?? MODE_COLORS[mode?.toLowerCase?.()] ?? "#64748b";
          const isHovered = hoveredMode === mode;
          return (
            <button
              key={mode}
              onMouseEnter={() => setHoveredMode(mode)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                width: "100%", padding: "9px 14px", background: isHovered ? `${mc}15` : "transparent",
                border: "none", cursor: "pointer", gap: 10,
              }}
            >
              <span style={{ ...styles.modeBadge, background: mc + "25", color: mc, border: `1px solid ${mc}40`, fontSize: 11, padding: "2px 8px" }}>
                {formatMode(mode)}
              </span>
              <span style={{ color: "#475569", fontSize: 11 }}>›</span>
            </button>
          );
        })}
      </div>

      {/* Maps submenu */}
      {hoveredMode && (
        <div style={{ background: "#150f22", border: "1px solid #2c2140", borderRadius: 8, overflow: "hidden", minWidth: 200, marginLeft: 4, maxHeight: 320, overflowY: "auto" }}>
          {grouped[hoveredMode].map(m => (
            <button
              key={m.name}
              onClick={() => onSelect(m)}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "8px 14px",
                background: selectedMap?.name === m.name ? "rgba(245,158,11,0.1)" : "transparent",
                border: "none", color: selectedMap?.name === m.name ? "#f59e0b" : "#cbd5e1",
                fontSize: 12, fontWeight: selectedMap?.name === m.name ? 700 : 400, cursor: "pointer",
              }}
            >
              {m.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RankBracketSelector({ value, onChange, selectedPatch, onPatchChange, patches }) {
  const [patchOpen, setPatchOpen] = useState(false);
  return (
    <div style={styles.rankBracketBar} className="rank-bracket-bar">
      <div style={styles.rankBracketLabel}>
        <Crown size={14} color="#a855f7" />
        <span>Rank Bracket</span>
      </div>
      <div style={styles.rankBracketGroup}>
        {RANK_BRACKETS.map((bracket) => {
          const active = value === bracket.id;
          return (
            <button
              key={bracket.id}
              type="button"
              style={{
                ...styles.rankBracketBtn,
                ...(active
                  ? {
                      background: `${bracket.accent}18`,
                      border: `1px solid ${bracket.accent}70`,
                      color: "#f8fafc",
                      boxShadow: `0 0 12px ${bracket.accent}25`,
                    }
                  : {}),
              }}
              onClick={() => onChange(bracket.id)}
            >
              <Star size={12} color={active ? bracket.accent : "#475569"} fill={active ? bracket.accent : "none"} />
              {bracket.label}
            </button>
          );
        })}
      </div>

      {/* Patch dropdown */}
      <div style={{ position: "relative", marginLeft: "auto" }}>
        <button onClick={() => setPatchOpen(o => !o)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, border: "1px solid #2c2140", background: "#150f22", color: "#f59e0b", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
          <Star size={11} color="#f59e0b" fill="#f59e0b" />
          Patch {selectedPatch}
          <ChevronDown size={11} color="#64748b" style={{ transform: patchOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
        </button>
        {patchOpen && patches.length > 0 && (
          <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, background: "#150f22", border: "1px solid #2c2140", borderRadius: 8, zIndex: 200, minWidth: 140, overflow: "hidden" }}>
            {patches.map(p => (
              <button key={p} onClick={() => { onPatchChange(p); setPatchOpen(false); }}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 14px", background: selectedPatch === p ? "rgba(245,158,11,0.1)" : "transparent", border: "none", color: selectedPatch === p ? "#f59e0b" : "#94a3b8", fontSize: 12, fontWeight: selectedPatch === p ? 700 : 400, cursor: "pointer" }}>
                {p === CURRENT_PATCH ? `${p} ✦ Current` : p}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TrendingView({ rankBracket, brawlerStats, loading, error }) {
  const { trendingBrawlers, totalPicks } = useMemo(() => {
    const overall = brawlerStats.filter(s => s.rank_bracket === rankBracket && s.map === null);
    const totalPicks = overall.reduce((sum, s) => sum + s.picks, 0);
    const trendingBrawlers = overall
      .map(s => ({
        key: s.brawler,
        name: formatBrawlerName(s.brawler),
        picks: s.picks,
        winRate: parseFloat(s.win_rate),
        pickRate: parseFloat(s.pick_rate),
        tier: assignTier(s.picks, s.wins, totalPicks),
      }))
      .sort((a, b) => b.winRate - a.winRate)
      .slice(0, 8);
    return { trendingBrawlers, totalPicks };
  }, [brawlerStats, rankBracket]);

  const bracketLabel = RANK_BRACKETS.find((b) => b.id === rankBracket)?.label ?? rankBracket;

  return (
    <div style={styles.viewPadding}>
      <h2 style={styles.viewHeading}><LineChart size={18} color="#f59e0b" /> Real-Time Meta Trends</h2>
      <p style={styles.viewSubtext}>
        Pre-aggregated ranked data for {bracketLabel} — {Math.round(totalPicks / 6).toLocaleString()} matches tracked.
      </p>
      <h3 style={{ ...styles.viewHeading, fontSize: 16, marginTop: 28 }}><TrendingUp size={16} color="#60a5fa" /> Top Performers</h3>
      {loading && <p style={{ fontSize: 12, color: "#475569", marginTop: 8 }}>Loading stats…</p>}
      {error && !loading && <p style={{ fontSize: 12, color: "#ef4444", marginTop: 8 }}>{error}</p>}
      {!loading && trendingBrawlers.length === 0 && (
        <p style={{ fontSize: 12, color: "#475569", marginTop: 8 }}>
          No stats found. Run the aggregation function in Supabase.
        </p>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginTop: 16 }}>
        {trendingBrawlers.map((b) => {
          const visual = getBrawlerVisual(b.name);
          return (
            <div key={b.key} style={{ ...styles.suggestionCard, padding: 16, flexDirection: "column", alignItems: "flex-start", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
                <div style={{ ...styles.suggAvatarWrap, background: `${visual.color}20`, borderColor: visual.color }}>
                  <span style={{ color: visual.color, fontWeight: 800 }}>{visual.initial}</span>
                </div>
                <div>
                  <div style={styles.suggName}>{b.name}</div>
                  <div style={{ fontSize: 11, color: TIER_COLORS[b.tier] }}>Tier {b.tier}</div>
                </div>
                <span style={{ marginLeft: "auto", fontSize: 11, color: "#10b981", background: "rgba(16,185,129,0.1)", padding: "2px 6px", borderRadius: 4, fontWeight: 700 }}>
                  {b.picks.toLocaleString()} picks
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, width: "100%", borderTop: "1px solid #2c2140", paddingTop: 8 }}>
                <div><div style={{ fontSize: 9, color: "#475569" }}>WIN RATE</div><div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>{b.winRate}%</div></div>
                <div><div style={{ fontSize: 9, color: "#475569" }}>PICK RATE</div><div style={{ fontSize: 14, fontWeight: 700, color: "#3b82f6" }}>{b.pickRate}%</div></div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecentMatchesGrid({ rankBracket, matches, loading, error }) {
  const recentMatches = useMemo(() => matches.slice(-36).reverse(), [matches]);
  const bracketLabel = RANK_BRACKETS.find((b) => b.id === rankBracket)?.label ?? rankBracket;

  return (
    <section style={{ marginTop: 20 }}>
      <h3 style={{ ...styles.viewHeading, fontSize: 16 }}>
        <Gamepad2 size={16} color="#10b981" /> Recent Matches — {bracketLabel}
      </h3>
      <p style={styles.viewSubtext}>Filtered battle log for the active rank bracket — maps, teams, and outcomes.</p>
      {loading && <p style={{ fontSize: 12, color: "#475569", marginTop: 12 }}>Loading match feed…</p>}
      {error && !loading && <p style={{ fontSize: 12, color: "#ef4444", marginTop: 12 }}>{error}</p>}
      {!loading && !error && recentMatches.length === 0 && (
        <p style={{ fontSize: 12, color: "#475569", marginTop: 12 }}>No matches for this bracket. Run the scraper to populate your Supabase table.</p>
      )}
      <div style={styles.matchesGrid}>
        {recentMatches.map((match, i) => {
          const rs = getResultStyle(match.result);
          const modeKey = match.mode?.replace(/\s/g, "") ?? "";
          const modeColor = MODE_COLORS[modeKey] ?? MODE_COLORS[match.mode?.toLowerCase?.()] ?? "#64748b";
          
          // Supports both old static schema and new automated cloud schema
          const displayWinners = Array.isArray(match.winners) ? match.winners : match.blue_team || [];
          const displayLosers = Array.isArray(match.losers) ? match.losers : match.red_team || [];

          return (
            <div key={`${match.map}-${match.result}-${i}`} style={styles.matchCard}>
              <div style={styles.matchCardHeader}>
                <div>
                  <div style={styles.matchMapName}>{match.map}</div>
                  <span style={{ ...styles.modeBadge, background: modeColor + "25", color: modeColor, border: `1px solid ${modeColor}40` }}>
                    {formatMode(match.mode)}
                  </span>
                </div>
                <span style={{ ...styles.resultBadge, background: rs.bg, color: rs.color, border: `1px solid ${rs.border}` }}>
                  {rs.label}
                </span>
              </div>
              <div style={styles.matchTeams}>
                <div style={styles.matchTeamRow}>
                  <Shield size={11} color="#10b981" />
                  <span style={{ ...styles.matchTeamLabel, color: "#10b981" }}>Winners</span>
                  <div style={styles.matchBrawlerList}>
                    {displayWinners.map((b, j) => (
                      <span key={j} style={{ ...styles.matchBrawlerChip, borderColor: "#10b98140", color: "#6ee7b7" }}>
                        {formatBrawlerName(b)}
                      </span>
                    ))}
                  </div>
                </div>
                <div style={styles.matchTeamRow}>
                  <Swords size={11} color="#ef4444" />
                  <span style={{ ...styles.matchTeamLabel, color: "#fca5a5" }}>Losers</span>
                  <div style={styles.matchBrawlerList}>
                    {displayLosers.map((b, j) => (
                      <span key={j} style={{ ...styles.matchBrawlerChip, borderColor: "#ef444440", color: "#fca5a5" }}>
                        {formatBrawlerName(b)}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TierListView({ rankBracket, liveMatches, liveLoading, liveError }) {
  const tiers = ["S", "A", "B", "C"];
  const bracketLabel = RANK_BRACKETS.find((b) => b.id === rankBracket)?.label ?? rankBracket;

  const tierGroups = useMemo(() => {
    const filtered = filterMatchesByBracket(liveMatches, rankBracket);
    const stats = computeMetaFromMatches(filtered);
    return tiers.reduce((acc, tier) => {
      acc[tier] = stats.filter((b) => b.tier === tier);
      return acc;
    }, {});
  }, [liveMatches, rankBracket]);

  const matchCount = filterMatchesByBracket(liveMatches, rankBracket).length;

  return (
    <div style={styles.viewPadding}>
      <h2 style={styles.viewHeading}><ListOrdered size={18} color="#60a5fa" /> Ranked Draft Power Tier List</h2>
      <p style={styles.viewSubtext}>
        Pick & win rates from {matchCount} live {bracketLabel} matches (synced directly from Cloud Database).
      </p>
      {liveLoading && <p style={{ fontSize: 12, color: "#475569", marginTop: 8 }}>Loading tier data…</p>}
      {liveError && !liveLoading && <p style={{ fontSize: 12, color: "#ef4444", marginTop: 8 }}>{liveError}</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 16 }}>
        {tiers.map((tier) => (
          <div key={tier} style={{ display: "flex", background: "#150f22", border: "1px solid #2c2140", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ width: 60, background: TIER_COLORS[tier] + "15", display: "flex", alignItems: "center", justifyContent: "center", borderRight: "1px solid #2c2140", fontSize: 24, fontWeight: 900, color: TIER_COLORS[tier] }}>
              {tier}
            </div>
            <div style={{ flex: 1, padding: 12, display: "flex", flexWrap: "wrap", gap: 8 }}>
              {!liveLoading && tierGroups[tier].length === 0 && (
                <span style={{ fontSize: 11, color: "#475569" }}>No data for tier {tier}</span>
              )}
              {tierGroups[tier].map((b) => {
                const visual = getBrawlerVisual(b.name);
                return (
                  <div key={b.key} style={{ background: "rgba(15,23,42,0.6)", padding: "4px 10px", borderRadius: 6, border: `1px solid ${visual.color}30`, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 10, color: visual.color, fontWeight: 800 }}>{visual.initial}</span>
                    <span style={{ fontSize: 12, color: "#cbd5e1", fontWeight: 600 }}>{b.name}</span>
                    <span style={{ fontSize: 9, color: "#64748b" }}>{b.winRate}% WR · {b.pickRate}% PR</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PremiumView() {
  return (
    <div style={{ ...styles.viewPadding, maxWidth: 500, margin: "40px auto", textAlign: "center" }}>
      <div style={{ width: 48, height: 48, background: "rgba(245,158,11,0.1)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
        <Crown size={24} color="#f59e0b" />
      </div>
      <h2 style={{ fontSize: 20, fontWeight: 800, fontFamily: "'Barlow Condensed', sans-serif" }}>Unlock BrawlMeta Pro</h2>
      <p style={{ color: "#64748b", fontSize: 13, marginTop: 6 }}>Gain deep access to the raw machine logs that global professional clubs utilize.</p>
      <div style={{ background: "#150f22", border: "1px solid #2c2140", borderRadius: 12, padding: 16, marginTop: 20, textAlign: "left", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 8, fontSize: 12 }}><Check size={14} color="#10b981" /> <span>Real-time companion overlay linkage</span></div>
        <div style={{ display: "flex", gap: 8, fontSize: 12 }}><Check size={14} color="#10b981" /> <span>Hypercharge availability & matchup prediction maps</span></div>
        <div style={{ display: "flex", gap: 8, fontSize: 12 }}><Check size={14} color="#10b981" /> <span>Deep premium structural party counters (3v3 Synergy Maps)</span></div>
        <button style={{ width: "100%", background: "#f59e0b", color: "#0a0711", border: "none", padding: "10px", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4, marginTop: 8 }}>
          Upgrade Now <ArrowUpRight size={14} />
        </button>
      </div>
    </div>
  );
}

/* ==========================================
   SUPPORTING STRUCTURAL SUB-COMPONENTS
   ========================================== */

function SuggestionCard({ s, i, onClick }) {
  const [imgErr, setImgErr] = useState(false);
  const meta = BRAWLER_META_IMPORT[s.key] || {};
  const color = s.winRate >= 55 ? "#10b981" : s.winRate >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <div
      style={{ ...styles.suggestionCard, animationDelay: `${i * 0.05}s`, cursor: onClick ? "pointer" : "default" }}
      className="suggestion-anim"
      onClick={onClick}
    >
      <div style={{ ...styles.suggAvatarWrap, width: 36, height: 36, overflow: "hidden", background: `${meta.rarityColor || "#475569"}20`, borderColor: meta.rarityColor || "#2c2140" }}>
        {!imgErr && meta.imageUrl
          ? <img src={meta.imageUrl} alt={s.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={() => setImgErr(true)} />
          : <span style={{ fontSize: 10, fontWeight: 800, color: meta.rarityColor || "#94a3b8" }}>{s.name.slice(0, 2).toUpperCase()}</span>
        }
      </div>
      <div style={styles.suggInfo}>
        <span style={styles.suggName}>{s.name}</span>
        <span style={{ fontSize: 10, color: "#475569" }}>{s.picks} matches on map</span>
      </div>
      <div style={{ ...styles.winRateCol, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <span style={{ fontSize: 14, fontWeight: 800, color }}>{s.winRate}%</span>
        <span style={{ fontSize: 8, color: "#475569", letterSpacing: "0.04em" }}>WIN</span>
      </div>
    </div>
  );
}

function SuggestionQuickInfo({ suggestion, brawlerStats, rankBracket, onClose }) {
  const [imgErr, setImgErr] = useState(false);
  const meta = BRAWLER_META_IMPORT[suggestion.key] || {};
  const overall = brawlerStats.find(
    (r) => r.rank_bracket === rankBracket && r.map === null && r.brawler === suggestion.key
  );

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(5,4,10,0.75)", backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%", maxWidth: 380, background: "#0f0b18", border: "1px solid #2c2140",
          borderRadius: 14, padding: 20, display: "flex", flexDirection: "column", gap: 14,
        }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{
            width: 56, height: 56, borderRadius: 10, overflow: "hidden", flexShrink: 0,
            background: `${meta.rarityColor || "#475569"}20`, border: `2px solid ${meta.rarityColor || "#2c2140"}80`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {!imgErr && meta.imageUrl
              ? <img src={meta.imageUrl} alt={suggestion.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={() => setImgErr(true)} />
              : <span style={{ fontSize: 16, fontWeight: 800, color: meta.rarityColor || "#94a3b8" }}>{suggestion.name.slice(0, 2).toUpperCase()}</span>
            }
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 900, fontFamily: "'Barlow Condensed', sans-serif", color: "#f8fafc" }}>{suggestion.name}</div>
            {meta.rarity && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 20, background: `${meta.rarityColor || "#94a3b8"}20`, color: meta.rarityColor || "#94a3b8", border: `1px solid ${meta.rarityColor || "#94a3b8"}40` }}>
                {meta.rarity}
              </span>
            )}
          </div>
          <button onClick={onClose} style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444", borderRadius: 8, padding: 6, cursor: "pointer" }}>
            <X size={14} />
          </button>
        </div>

        {meta.description && (
          <p style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.5 }}>{meta.description}</p>
        )}

        <div style={{ display: "grid", gridTemplateColumns: suggestion.winRate != null ? "1fr 1fr" : "1fr", gap: 8 }}>
          {suggestion.winRate != null && (
            <div style={{ background: "#150f22", border: "1px solid #2c2140", borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#10b981" }}>{suggestion.winRate}%</div>
              <div style={{ fontSize: 9, color: "#475569", letterSpacing: "0.05em" }}>WIN RATE ON MAP</div>
              <div style={{ fontSize: 9, color: "#334155", marginTop: 2 }}>{suggestion.picks} games</div>
            </div>
          )}
          <div style={{ background: "#150f22", border: "1px solid #2c2140", borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
            {overall ? (
              <>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#3b82f6" }}>{parseFloat(overall.win_rate)}%</div>
                <div style={{ fontSize: 9, color: "#475569", letterSpacing: "0.05em" }}>OVERALL WIN RATE</div>
                <div style={{ fontSize: 9, color: "#334155", marginTop: 2 }}>{overall.picks} games</div>
              </>
            ) : (
              <div style={{ fontSize: 11, color: "#475569" }}>No overall data</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function BrawlerChip({ brawler, used, isBan, onSelect }) {
  const [imgErr, setImgErr] = useState(false);
  return (
    <button
      style={{ ...styles.brawlerChip, opacity: used ? 0.3 : 1, cursor: used ? "not-allowed" : "pointer", border: used ? "1px solid #2c2140" : isBan ? `1px solid rgba(239,68,68,0.4)` : `1px solid ${brawler.color}40`, background: used ? "#1b1329" : isBan ? "rgba(239,68,68,0.06)" : `${brawler.color}12` }}
      onClick={() => !used && onSelect(brawler)} disabled={used}>
      <div style={{ ...styles.brawlerAvatar, background: `${brawler.color}25`, border: `1.5px solid ${brawler.color}60`, overflow: "hidden" }}>
        {!imgErr && brawler.imageUrl
          ? <img src={brawler.imageUrl} alt={brawler.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={() => setImgErr(true)} />
          : <span style={{ fontSize: 9, fontWeight: 800, color: brawler.color }}>{brawler.initial}</span>
        }
      </div>
      <span style={{ fontSize: 10, color: used ? "#334155" : "#cbd5e1", fontWeight: 600, lineHeight: 1.1, textAlign: "center" }}>{brawler.name}</span>
    </button>
  );
}

function BanSlot({ brawler, active, onRemove }) {
  return (
    <div style={{ flex: 1, minWidth: 0, height: 36, borderRadius: 6, border: `1px solid ${active ? "rgba(239,68,68,0.6)" : brawler ? "rgba(239,68,68,0.3)" : "#2c2140"}`, background: active ? "rgba(239,68,68,0.1)" : brawler ? "rgba(239,68,68,0.05)" : "#0a0711", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" }}>
      {brawler ? (
        <>
          <span style={{ fontSize: 9, fontWeight: 800, color: "#ef4444", textDecoration: "line-through", opacity: 0.8 }}>{brawler.name.slice(0, 4).toUpperCase()}</span>
          <button onClick={onRemove} style={{ position: "absolute", top: 1, right: 1, background: "none", border: "none", color: "#475569", cursor: "pointer", padding: 1 }}><X size={9} /></button>
          <div style={{ position: "absolute", inset: 0, background: "repeating-linear-gradient(-45deg, transparent, transparent 3px, rgba(239,68,68,0.06) 3px, rgba(239,68,68,0.06) 4px)" }} />
        </>
      ) : (
        <span style={{ fontSize: 9, color: active ? "#ef4444" : "#334155", fontWeight: 700 }}>{active ? "BAN" : "—"}</span>
      )}
    </div>
  );
}

function DraftSlot({ brawler, team, idx, active, onClick, onRemove }) {
  const [imgErr, setImgErr] = useState(false);
  const teamColor = team === "blue" ? "#3b82f6" : "#ef4444";
  return (
    <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 10, border: active ? `1.5px solid ${teamColor}` : `1px solid ${brawler ? teamColor + "40" : "#2c2140"}`, background: active ? `${teamColor}08` : brawler ? `${brawler.color}0a` : "rgba(15,23,42,0.6)", minHeight: 52, cursor: "pointer" }}>
      {brawler ? (
        <>
          <div style={{ width: 32, height: 32, borderRadius: 6, background: `${brawler.color}25`, border: `1.5px solid ${brawler.color}70`, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {!imgErr && brawler.imageUrl
              ? <img src={brawler.imageUrl} alt={brawler.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={() => setImgErr(true)} />
              : <span style={{ fontSize: 11, fontWeight: 800, color: brawler.color }}>{brawler.initial}</span>
            }
          </div>
          <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>{brawler.name}</div></div>
          <button style={{ background: "none", border: "none", color: "#475569", cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onRemove(); }}><X size={12} /></button>
        </>
      ) : (
        <span style={{ fontSize: 12, color: active ? teamColor : "#334155" }}>{active ? "Selecting..." : `Pick ${idx + 1}`}</span>
      )}
    </div>
  );
}

function WinRateArc({ pct, color }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <span style={{ fontSize: 13, fontWeight: 800, color }}>{pct}%</span>
      <span style={{ fontSize: 8, color: "#475569", letterSpacing: "0.04em" }}>WIN</span>
    </div>
  );
}

function SynergyBar({ blueTeam, redTeam }) {
  const bluePicked = blueTeam.filter(Boolean).length;
  const redPicked = redTeam.filter(Boolean).length;
  if (bluePicked + redPicked === 0) return <p style={{ fontSize: 11, color: "#334155", textAlign: "center" }}>Awaiting drafting initialization...</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justify: "space-between", fontSize: 10 }}><span style={{ color: "#3b82f6" }}>Allies (68%)</span><span style={{ color: "#ef4444" }}>Enemies (52%)</span></div>
      <div style={{ height: 4, background: "#1b1329", borderRadius: 2, overflow: "hidden", display: "flex" }}>
        <div style={{ width: "55%", background: "#3b82f6" }} /><div style={{ width: "45%", background: "#ef4444" }} />
      </div>
    </div>
  );
}

const styles = {
  root: { minHeight: "100vh", background: "#0a0711", fontFamily: "'Barlow', sans-serif", color: "#e2e8f0", position: "relative" },
  scanlines: { position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, backgroundImage: "radial-gradient(1200px 500px at 70% -10%, rgba(168,85,247,0.10), transparent 70%), repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.05) 2px, rgba(0,0,0,0.05) 4px)" },
  nav: { display: "flex", alignItems: "center", justify: "space-between", padding: "12px 22px", borderBottom: "1px solid #1b1329", background: "rgba(10,7,17,0.82)", backdropFilter: "blur(10px)", position: "sticky", top: 0, zIndex: 100 },
  navBrand: { display: "flex", alignItems: "center", gap: 10 },
  brandIcon: { width: 30, height: 30, borderRadius: 7, background: "rgba(168,85,247,0.14)", border: "1px solid rgba(168,85,247,0.35)", display: "flex", alignItems: "center", justifyContent: "center" },
  brandDiamond: { width: 11, height: 11, background: "linear-gradient(135deg, #c084fc, #a855f7)", transform: "rotate(45deg)", borderRadius: 2 },
  brandText: { fontSize: 15, fontWeight: 700, fontFamily: "'Space Mono', monospace", letterSpacing: "0.08em", color: "#f1edf7" },
  brandAccent: { color: "#a855f7" },
  brandBadge: { fontSize: 8, fontWeight: 700, color: "#c084fc", fontFamily: "'Space Mono', monospace", background: "rgba(168,85,247,0.12)", border: "1px solid rgba(168,85,247,0.25)", padding: "2px 6px", borderRadius: 4, letterSpacing: "0.1em" },
  tabGroup: { display: "flex", gap: 4, marginLeft: 26 },
  tabBtn: { display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "1px solid transparent", color: "#7c7490", padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "'Space Mono', monospace", letterSpacing: "0.04em", transition: "all 0.15s" },
  tabBtnActive: { background: "rgba(168,85,247,0.10)", border: "1px solid rgba(168,85,247,0.35)", color: "#e9d5ff" },
  navRight: { marginLeft: "auto" },
  resetBtn: { display: "flex", alignItems: "center", gap: 5, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600 },
  contentContainer: { position: "relative", zIndex: 1 },
  rankBracketBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: "12px 24px",
    borderBottom: "1px solid #1b1329",
    background: "linear-gradient(180deg, rgba(168,85,247,0.07) 0%, transparent 100%)",
  },
  rankBracketLabel: { display: "flex", alignItems: "center", gap: 8, fontSize: 10, fontWeight: 700, color: "#8a7fa6", letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: "'Space Mono', monospace" },
  rankBracketGroup: { display: "flex", gap: 8, flexWrap: "wrap" },
  rankBracketBtn: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 14px",
    borderRadius: 10,
    border: "1px solid #2c2140",
    background: "#150f22",
    color: "#64748b",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    transition: "all 0.15s",
  },
  main: { display: "grid", gridTemplateColumns: "1fr 340px", minHeight: "calc(100vh - 57px)" },
  draftPanel: { padding: 20, borderRight: "1px solid #1b1329", display: "flex", flexDirection: "column", gap: 16 },
  sidebar: { padding: 16, background: "rgba(7,14,28,0.4)", display: "flex", flexDirection: "column", gap: 12 },
  panelHeader: { display: "flex", alignItems: "center", gap: 12 },
  panelTitle: { fontSize: 11, fontWeight: 700, color: "#c084fc", letterSpacing: "0.12em", fontFamily: "'Space Mono', monospace", textTransform: "uppercase" },
  mapDropdownWrapper: { position: "relative" },
  mapDropdown: { display: "flex", alignItems: "center", gap: 8, background: "#150f22", border: "1px solid #2c2140", borderRadius: 8, padding: "4px 10px", cursor: "pointer" },
  modeBadge: { fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 4 },
  pickCounter: { marginLeft: "auto", fontSize: 11, color: "#475569" },
  teamsGrid: { display: "grid", gridTemplateColumns: "1fr 40px 1fr", gap: 8, alignItems: "start" },
  teamColumn: { display: "flex", flexDirection: "column", gap: 6 },
  teamLabel: { display: "flex", alignItems: "center", gap: 6, pb: 4 },
  vsDivider: { display: "flex", justifyContent: "center", paddingTop: 34 },
  vsCircle: { width: 24, height: 24, borderRadius: "50%", background: "#1b1329", border: "1px solid #2c2140", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#475569", fontWeight: 800 },
  pickerSection: { borderTop: "1px solid #1b1329", paddingTop: 14, display: "flex", flexDirection: "column", gap: 10 },
  pickerHeader: { display: "flex", gap: 8, alignItems: "center" },
  searchWrapper: { position: "relative", width: 200 },
  searchInput: { width: "100%", background: "#150f22", border: "1px solid #2c2140", borderRadius: 8, padding: "5px 8px 5px 28px", color: "#cbd5e1", fontSize: 12 },
  roleFilters: { display: "flex", gap: 4 },
  roleBtn: { background: "transparent", border: "1px solid #2c2140", color: "#475569", borderRadius: 6, padding: "4px 10px", fontSize: 10, fontWeight: 600, cursor: "pointer" },
  roleBtnActive: { background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.4)", color: "#f59e0b" },
  brawlerGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(70px, 1fr))", gap: 6, maxHeight: 240, overflowY: "auto" },
  brawlerChip: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "6px", borderRadius: 8 },
  brawlerAvatar: { width: 32, height: 32, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" },
  suggestionList: { display: "flex", flexDirection: "column", gap: 6 },
  suggestionCard: { display: "flex", alignItems: "center", gap: 10, padding: 12, background: "#150f22", borderRadius: 10, border: "1px solid #2c2140" },
  suggAvatarWrap: { width: 34, height: 34, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid" },
  suggInfo: { flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  suggName: { fontSize: 13, fontWeight: 700, fontFamily: "'Barlow Condensed', sans-serif" },
  reasonBadge: { fontSize: 9, padding: "1px 5px", borderRadius: 4, display: "inline-block", width: "max-content" },
  winRateCol: { marginLeft: "auto" },
  synergyPanel: { background: "#150f22", borderRadius: 10, border: "1px solid #2c2140", padding: 12, marginTop: "auto" },
  dropdown: { position: "absolute", top: "100%", left: 0, background: "#150f22", border: "1px solid #2c2140", borderRadius: 8, overflow: "hidden", zIndex: 200, minWidth: 160 },
  dropdownItem: { display: "flex", justify: "space-between", width: "100%", padding: 8, background: "transparent", border: "none", color: "#cbd5e1", cursor: "pointer" },
  viewPadding: { padding: 24 },
  viewHeading: { fontSize: 20, fontWeight: 900, fontFamily: "'Barlow Condensed', sans-serif", display: "flex", alignItems: "center", gap: 8 },
  viewSubtext: { fontSize: 12, color: "#64748b", marginTop: 2 },
  matchesGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10, marginTop: 12, maxHeight: 520, overflowY: "auto", paddingRight: 4 },
  matchCard: { background: "#150f22", border: "1px solid #2c2140", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 10 },
  matchCardHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  matchMapName: { fontSize: 13, fontWeight: 700, color: "#e2e8f0", fontFamily: "'Barlow Condensed', sans-serif", marginBottom: 4 },
  resultBadge: { fontSize: 10, fontWeight: 800, padding: "3px 8px", borderRadius: 6, letterSpacing: "0.04em", flexShrink: 0 },
  matchTeams: { display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid #2c2140", paddingTop: 8 },
  matchTeamRow: { display: "flex", alignItems: "flex-start", gap: 6 },
  matchTeamLabel: { fontSize: 9, fontWeight: 800, color: "#3b82f6", letterSpacing: "0.06em", width: 45, flexShrink: 0, paddingTop: 2 },
  matchBrawlerList: { display: "flex", flexWrap: "wrap", gap: 4, flex: 1 },
  matchBrawlerChip: { fontSize: 9, fontWeight: 600, padding: "2px 6px", borderRadius: 4, border: "1px solid", background: "rgba(15,23,42,0.8)" },
};
// ─── Standalone, crawlable brawler guide page (real URL for SEO/prerendering) ──
function BrawlerGuideRoute() {
  const { brawlerSlug } = useParams();
  const navigate = useNavigate();
  const brawlerKey = findBrawlerKeyBySlug(brawlerSlug);
  const { stats: brawlerStats, loading } = useBrawlerStats(CURRENT_PATCH);

  const { brawlers, byMode, byMap } = useMemo(
    () => computeStatsFromAggregated(brawlerStats || [], "masters_legendary"),
    [brawlerStats]
  );

  const brawler = useMemo(() => {
    if (!brawlerKey) return null;
    const meta = BRAWLER_META_IMPORT[brawlerKey] || {};
    const live = brawlers.find(b => b.key === brawlerKey);
    if (live) return live;
    return {
      key: brawlerKey,
      name: brawlerKey.toLowerCase().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
      picks: 0, wins: 0, winRate: null, pickRate: null, stars: null,
      imageUrl: meta.imageUrl || null,
      rarity: meta.rarity || "Common",
      rarityColor: meta.rarityColor || "#94a3b8",
      class: meta.class || "Unknown",
      description: meta.description || "",
      starPowers: meta.starPowers || [],
      gadgets: meta.gadgets || [],
      guide: null,
    };
  }, [brawlerKey, brawlers]);

  useEffect(() => {
    if (!brawler) return;
    document.title = `${brawler.name} Guide — BrawlMeta`;
    const setMeta = (name, content) => {
      let tag = document.querySelector(`meta[name="${name}"]`) || document.querySelector(`meta[property="${name}"]`);
      if (!tag) {
        tag = document.createElement("meta");
        tag.setAttribute(name.startsWith("og:") ? "property" : "name", name);
        document.head.appendChild(tag);
      }
      tag.setAttribute("content", content);
    };
    const description = brawler.description || `${brawler.name} ranked stats, win rate, and draft guide on BrawlMeta.`;
    setMeta("description", description);
    setMeta("og:title", `${brawler.name} Guide — BrawlMeta`);
    setMeta("og:description", description);
    if (brawler.imageUrl) setMeta("og:image", brawler.imageUrl);
  }, [brawler]);

  if (loading || !brawler) {
    return (
      <div style={{ minHeight: "100vh", background: "#0a0711", display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontFamily: "'Barlow', sans-serif" }}>
        {brawlerKey ? "Loading brawler guide…" : "Brawler not found."}
      </div>
    );
  }

  return (
    <div style={styles.root}>
      <nav style={styles.nav} className="app-nav">
        <div style={styles.navBrand}>
          <div style={styles.brandIcon}><div style={styles.brandDiamond} /></div>
          <span style={styles.brandText}>BRAWL<span style={styles.brandAccent}>//</span>META</span>
        </div>
      </nav>
      <BrawlerGuidePage brawler={brawler} byMode={byMode} byMap={byMap} onBack={() => navigate("/app")} />
      <style>{`* { box-sizing: border-box; }`}</style>
    </div>
  );
}

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/app" element={<BrawlMeta />} />
      <Route path="/brawlers/:brawlerSlug" element={<BrawlerGuideRoute />} />
      <Route path="*" element={<BrawlMeta />} />
    </Routes>
  );
}
