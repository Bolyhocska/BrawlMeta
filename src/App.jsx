import { useState, useEffect, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  Swords, Shield, Zap, ChevronDown, Star, Target, TrendingUp, X, Check,
  RotateCcw, Map, Gamepad2, Cpu, Flame, ListOrdered, Crown, LineChart, ArrowUpRight
} from "lucide-react";
import BrawlersPage from "./BrawlersPage";
import BRAWLER_META_IMPORT from "./data/brawlerMeta.json";

// ==========================================
// 🔌 SUPABASE CLOUD CONFIGURATION
// ==========================================
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;
const CURRENT_PATCH = "68.250";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const MAPS = [
  { id: 1, name: "Belle's Rock", mode: "Knockout", modeColor: "#f59e0b" },
  { id: 2, name: "Backyard Bowl", mode: "Gem Grab", modeColor: "#8b5cf6" },
  { id: 3, name: "Super Stadium", mode: "Brawl Ball", modeColor: "#3b82f6" },
  { id: 4, name: "Kaboom Canyon", mode: "Bounty", modeColor: "#ef4444" },
  { id: 5, name: "Snake Prairie", mode: "Heist", modeColor: "#10b981" },
  { id: 6, name: "Galaxy Arena", mode: "Hot Zone", modeColor: "#ec4899" },
];

const BRAWLERS = [
  { id: 1,  name: "Shelly",    role: "Fighter",    tier: "A", color: "#f97316", initial: "SH", winRate: 54, banRate: 12, pickRate: 24, range: "Short",  tags: ["Frontline", "Reliable"] },
  { id: 2,  name: "Nita",     role: "Fighter",    tier: "B", color: "#a78bfa", initial: "NI", winRate: 51, banRate: 4,  pickRate: 11, range: "Mid",    tags: ["Tank", "Summoner"] },
  { id: 3,  name: "Colt",     role: "Sharpshooter",tier:"A", color: "#60a5fa", initial: "CO", winRate: 53, banRate: 18, pickRate: 35, range: "Long",   tags: ["Lane Control", "Wall Breaker"] },
  { id: 4,  name: "Bull",     role: "Tank",        tier: "S", color: "#ef4444", initial: "BU", winRate: 58, banRate: 32, pickRate: 14, range: "Short",  tags: ["Hard Counter Snipers", "Brute Force"] },
  { id: 5,  name: "Jessie",   role: "Fighter",    tier: "B", color: "#fbbf24", initial: "JE", winRate: 49, banRate: 5,  pickRate: 19, range: "Mid",    tags: ["Turret Control", "Area Denial"] },
  { id: 6,  name: "Brock",    role: "Sharpshooter",tier:"A", color: "#f472b6", initial: "BR", winRate: 52, banRate: 8,  pickRate: 28, range: "Long",   tags: ["Sniper", "Long Range Poke"] },
  { id: 7,  name: "Dynamike", role: "Thrower",    tier: "A", color: "#fb923c", initial: "DY", winRate: 55, banRate: 45, pickRate: 31, range: "Mid",    tags: ["Thrower", "Wall Ignorer"] },
  { id: 8,  name: "Tick",     role: "Thrower",    tier: "B", color: "#4ade80", initial: "TI", winRate: 50, banRate: 22, pickRate: 9,  range: "Long",   tags: ["Area Control", "Thrower"] },
  { id: 9,  name: "8-Bit",    role: "Sharpshooter",tier:"B", color: "#818cf8", initial: "8B", winRate: 48, banRate: 2,  pickRate: 7,  range: "Long",   tags: ["Support DPS", "Buff Zone"] },
  { id: 10, name: "Emz",      role: "Fighter",    tier: "A", color: "#c084fc", initial: "EM", winRate: 53, banRate: 14, pickRate: 18, range: "Mid",    tags: ["Lane Denial", "Area Control"] },
  { id: 11, name: "Piper",    role: "Sharpshooter",tier:"S", color: "#f9a8d4", initial: "PI", winRate: 57, banRate: 52, pickRate: 41, range: "Long",   tags: ["S-Tier Sniper", "Burst Damage"] },
  { id: 12, name: "Pam",      role: "Support",    tier: "C", color: "#6ee7b7", initial: "PA", winRate: 46, banRate: 1,  pickRate: 4,  range: "Mid",    tags: ["Healer", "Tank Support"] },
  { id: 13, name: "Frank",    role: "Tank",        tier: "A", color: "#94a3b8", initial: "FR", winRate: 54, banRate: 28, pickRate: 15, range: "Short",  tags: ["CC Machine", "Frontline"] },
  { id: 14, name: "Bibi",     role: "Fighter",    tier: "A", color: "#fb7185", initial: "BI", winRate: 53, banRate: 9,  pickRate: 16, range: "Short",  tags: ["Bounce Attack", "Frontline"] },
  { id: 15, name: "Bea",      role: "Sharpshooter",tier:"B", color: "#fde68a", initial: "BE", winRate: 51, banRate: 3,  pickRate: 12, range: "Long",   tags: ["Charged Shot", "Lane Control"] },
  { id: 16, name: "Nani",     role: "Sharpshooter",tier:"S", color: "#7dd3fc", initial: "NA", winRate: 56, banRate: 38, pickRate: 22, range: "Long",   tags: ["S-Tier Lane Control", "Peep Burst"] },
  { id: 17, name: "Edgar",    role: "Fighter",    tier: "B", color: "#f87171", initial: "ED", winRate: 49, banRate: 65, pickRate: 48, range: "Short",  tags: ["Self-Heal Rush", "Flanker"] },
  { id: 18, name: "Griff",    role: "Fighter",    tier: "A", color: "#fcd34d", initial: "GR", winRate: 52, banRate: 6,  pickRate: 14, range: "Mid",    tags: ["Coin Splash", "Area Clear"] },
  { id: 19, name: "Grom",     role: "Thrower",    tier: "C", color: "#86efac", initial: "GO", winRate: 47, banRate: 4,  pickRate: 8,  range: "Long",   tags: ["Thrower", "Map Control"] },
  { id: 20, name: "Bonnie",   role: "Fighter",    tier: "B", color: "#fdba74", initial: "BO", winRate: 50, banRate: 2,  pickRate: 10, range: "Mid",    tags: ["Dual Form", "Versatile"] },
  { id: 21, name: "Gale",     role: "Support",    tier: "A", color: "#bfdbfe", initial: "GA", winRate: 54, banRate: 19, pickRate: 20, range: "Mid",    tags: ["Knockback CC", "Support"] },
  { id: 22, name: "Colette",  role: "Fighter",    tier: "A", color: "#f9a8d4", initial: "CL", winRate: 54, banRate: 25, pickRate: 23, range: "Mid",    tags: ["Tank Shredder", "HP Damage"] },
  { id: 23, name: "Crow",     role: "Assassin",    tier: "S", color: "#a3e635", initial: "CR", winRate: 58, banRate: 44, pickRate: 33, range: "Long",   tags: ["S-Tier Poison", "Anti-Healer"] },
  { id: 24, name: "Leon",     role: "Assassin",    tier: "S", color: "#34d399", initial: "LE", winRate: 57, banRate: 41, pickRate: 29, range: "Mid",    tags: ["Invisible Flanker", "Burst Kill"] },
  { id: 25, name: "Sandy",    role: "Support",    tier: "A", color: "#fde68a", initial: "SA", winRate: 55, banRate: 15, pickRate: 17, range: "Mid",    tags: ["Sand Storm Vision", "Area Cover"] },
  { id: 26, name: "Amber",    role: "Fighter",    tier: "A", color: "#fb923c", initial: "AM", winRate: 54, banRate: 11, pickRate: 15, range: "Mid",    tags: ["DoT Fire", "Area Denial"] },
  { id: 27, name: "Meg",      role: "Tank",        tier: "A", color: "#c4b5fd", initial: "ME", winRate: 53, banRate: 21, pickRate: 13, range: "Mid",    tags: ["Mech Form", "Dual HP"] },
  { id: 28, name: "Surge",    role: "Fighter",    tier: "S", color: "#38bdf8", initial: "SU", winRate: 56, banRate: 39, pickRate: 30, range: "Mid",    tags: ["S-Tier Scaling", "Upgrade Threat"] },
  { id: 29, name: "Mortis",   role: "Assassin",    tier: "B", color: "#a78bfa", initial: "MO", winRate: 50, banRate: 34, pickRate: 42, range: "Short",  tags: ["Dash Flanker", "Low HP Threat"] },
  { id: 30, name: "Tara",     role: "Support",    tier: "B", color: "#818cf8", initial: "TA", winRate: 51, banRate: 8,  pickRate: 12, range: "Mid",    tags: ["Black Hole Super", "Support CC"] },
];

const SUGGESTION_POOL = [
  { brawlerId: 4,  reason: "Hard Counter to Snipers",    badge: "Hard Counter",   badgeType: "danger" },
  { brawlerId: 16, reason: "S-Tier Lane Control",        badge: "S-Tier",         badgeType: "gold" },
  { brawlerId: 24, reason: "Counters Throwers + CC",     badge: "Flanker Pick",   badgeType: "success" },
  { brawlerId: 23, reason: "Neutralizes Healers",        badge: "Anti-Support",   badgeType: "warning" },
  { brawlerId: 21, reason: "Enables Team Comp Synergy",  badge: "Synergy Pick",   badgeType: "info" },
  { brawlerId: 11, reason: "Dominates Open Maps",        badge: "Map Specialist", badgeType: "gold" },
];

const WIN_RATES = [78, 74, 71, 68, 65, 72];
const TIER_COLORS = { S: "#f59e0b", A: "#60a5fa", B: "#94a3b8", C: "#6b7280" };
const getBrawler = (id) => BRAWLERS.find((b) => b.id === id);

const MODE_COLORS = {
  brawlBall: "#3b82f6",
  brawlball: "#3b82f6",
  gemGrab: "#8b5cf6",
  knockout: "#f59e0b",
  bounty: "#ef4444",
  heist: "#10b981",
  hotZone: "#ec4899",
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
  const found = BRAWLERS.find((b) => normalizeBrawlerKey(b.name) === key);
  if (found) return { color: found.color, initial: found.initial };
  const hash = [...key].reduce((sum, c) => sum + c.charCodeAt(0), 0);
  const palette = ["#60a5fa", "#a78bfa", "#f97316", "#34d399", "#f472b6"];
  return { color: palette[hash % palette.length], initial: key.slice(0, 2) };
};

// ==========================================
// 🛰️ DYNAMIC SUPABASE HOOKS
// ==========================================
function usePatches() {
  const [patches, setPatches] = useState([]);
  useEffect(() => {
    supabase.from("BrawlerStats").select("patch").then(({ data }) => {
      if (!data) return;
      const unique = [...new Set(data.map(r => r.patch).filter(Boolean))].sort((a, b) => b.localeCompare(a));
      setPatches(unique);
    });
  }, []);
  return patches;
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

export default function BrawlMeta() {
  const [activeTab, setActiveTab] = useState("meta");
  const [rankBracket, setRankBracket] = useState("masters_legendary");
  const [selectedPatch, setSelectedPatch] = useState(CURRENT_PATCH);
  const [selectedMap, setSelectedMap] = useState(MAPS[0]);
  const patches = usePatches();
  const { stats: brawlerStats, loading: statsLoading, error: statsError } = useBrawlerStats(selectedPatch);
  const { matches: mapMatches } = useMapMatches(selectedPatch, selectedMap.name, activeTab === "meta");
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

  // Ban sequence: team that picks SECOND bans first, alternating
  // banFirst = opposite of firstPick
  const banSequence = useMemo(() => {
    if (!firstPick) return [];
    const banFirst = firstPick === "blue" ? "red" : "blue";
    const banSecond = firstPick;
    return [
      { team: banFirst, idx: 0 },
      { team: banSecond, idx: 0 },
      { team: banFirst, idx: 1 },
      { team: banSecond, idx: 1 },
      { team: banFirst, idx: 2 },
      { team: banSecond, idx: 2 },
    ];
  }, [firstPick]);

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

  // Data-driven suggestions: which brawlers win most on this map vs the enemy's current picks
  useEffect(() => {
    const pickerTeam = activeSlot?.team ?? (firstPick || "blue");
    const enemyTeam = pickerTeam === "blue" ? redTeam : blueTeam;
    const enemyKeys = enemyTeam.filter(Boolean).map(b => b.name.toUpperCase());
    const mapName = selectedMap.name;
    const allUsedNames = [
      ...blueTeam.filter(Boolean).map(b => b.name.toUpperCase()),
      ...redTeam.filter(Boolean).map(b => b.name.toUpperCase()),
      ...blueBans.filter(Boolean).map(b => b.name.toUpperCase()),
      ...redBans.filter(Boolean).map(b => b.name.toUpperCase()),
    ];

    const stats = {};
    const bracketMatches = mapMatches.filter(m =>
      resolveMatchBracket(m) === rankBracket
    );

    for (const match of bracketMatches) {
      const winners = (match.winners || []).map(b => b.toUpperCase());
      const losers = (match.losers || []).map(b => b.toUpperCase());

      let myTeam = null;
      if (enemyKeys.length === 0) {
        // No enemy picks yet — just show best brawlers on this map overall
        for (const b of winners) { if (!stats[b]) stats[b] = { picks: 0, wins: 0 }; stats[b].picks++; stats[b].wins++; }
        for (const b of losers)  { if (!stats[b]) stats[b] = { picks: 0, wins: 0 }; stats[b].picks++; }
      } else {
        const enemyInLosers  = enemyKeys.every(e => losers.includes(e));
        const enemyInWinners = enemyKeys.every(e => winners.includes(e));
        if (enemyInLosers)  myTeam = { side: winners, won: true };
        else if (enemyInWinners) myTeam = { side: losers, won: false };
        if (myTeam) {
          for (const b of myTeam.side) {
            if (!stats[b]) stats[b] = { picks: 0, wins: 0 };
            stats[b].picks++;
            if (myTeam.won) stats[b].wins++;
          }
        }
      }
    }

    const results = Object.entries(stats)
      .filter(([key]) => !allUsedNames.includes(key))
      .filter(([, s]) => s.picks >= 3)
      .map(([key, s]) => ({
        key,
        name: formatBrawlerName(key),
        winRate: Math.round((s.wins / s.picks) * 1000) / 10,
        picks: s.picks,
      }))
      .sort((a, b) => b.winRate - a.winRate)
      .slice(0, 5);

    setSuggestions(results);
    setAnimKey(k => k + 1);
  }, [blueTeam, redTeam, blueBans, redBans, selectedMap, mapMatches, rankBracket, activeSlot, firstPick]);

  const roles = ["All", ...Array.from(new Set(BRAWLERS.map((b) => b.role)))];
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
      <nav style={styles.nav}>
        <div style={styles.navBrand}>
          <div style={styles.brandIcon}>
            <Swords size={18} color="#f59e0b" />
          </div>
          <span style={styles.brandText}>Brawl<span style={styles.brandAccent}>Meta</span></span>
          <span style={styles.brandBadge}>ELITE</span>
        </div>

        {/* TAB NAVIGATION */}
        <div style={styles.tabGroup}>
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
          <div style={styles.main}>
            {/* LEFT — DRAFT PANELS */}
            <div style={styles.draftPanel}>
              {/* MAP + STATUS BAR */}
              <div style={styles.panelHeader}>
                <Map size={14} color="#94a3b8" />
                <div style={styles.mapDropdownWrapper}>
                  <button style={styles.mapDropdown} onClick={() => setMapOpen(!mapOpen)}>
                    <span style={{ color: "#e2e8f0", fontSize: 13, fontWeight: 600 }}>{selectedMap.name}</span>
                    <span style={{ ...styles.modeBadge, background: selectedMap.modeColor + "30", color: selectedMap.modeColor, border: `1px solid ${selectedMap.modeColor}50` }}>
                      {selectedMap.mode}
                    </span>
                    <ChevronDown size={13} color="#64748b" style={{ transform: mapOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
                  </button>
                  {mapOpen && (
                    <div style={styles.dropdown}>
                      {MAPS.map((m) => (
                        <button key={m.id} style={{ ...styles.dropdownItem, background: selectedMap.id === m.id ? "rgba(245,158,11,0.1)" : "transparent" }}
                          onClick={() => { setSelectedMap(m); setMapOpen(false); }}>
                          <span style={{ color: "#cbd5e1", fontSize: 13 }}>{m.name}</span>
                          <span style={{ ...styles.modeBadge, background: m.modeColor + "25", color: m.modeColor, border: `1px solid ${m.modeColor}40` }}>{m.mode}</span>
                        </button>
                      ))}
                    </div>
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
                <div style={{ background: "#0a1220", border: "1px solid #1e293b", borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#94a3b8", letterSpacing: "0.08em", textTransform: "uppercase" }}>Draft Setup</div>

                  {/* Bans toggle */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "#050b14", borderRadius: 8, border: "1px solid #1e293b" }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>Enable Bans</div>
                      <div style={{ fontSize: 11, color: "#475569" }}>3 bans per team before picking</div>
                    </div>
                    <button onClick={() => setBansEnabled(v => !v)} style={{
                      width: 44, height: 24, borderRadius: 12, border: "none", cursor: "pointer", position: "relative",
                      background: bansEnabled ? "#f59e0b" : "#1e293b", transition: "background 0.2s",
                    }}>
                      <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: bansEnabled ? 23 : 3, transition: "left 0.2s" }} />
                    </button>
                  </div>

                  {/* Coin flip */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 11, color: "#64748b" }}>Who picks first?</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => setFirstPick("blue")} style={{ flex: 1, padding: "10px", borderRadius: 8, border: `1.5px solid ${firstPick === "blue" ? "#3b82f6" : "#1e293b"}`, background: firstPick === "blue" ? "rgba(59,130,246,0.15)" : "#050b14", color: firstPick === "blue" ? "#3b82f6" : "#64748b", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                        🔵 Blue Team
                      </button>
                      <button onClick={coinFlip} style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #1e293b", background: "#050b14", color: "#f59e0b", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                        🎲 Random
                      </button>
                      <button onClick={() => setFirstPick("red")} style={{ flex: 1, padding: "10px", borderRadius: 8, border: `1.5px solid ${firstPick === "red" ? "#ef4444" : "#1e293b"}`, background: firstPick === "red" ? "rgba(239,68,68,0.15)" : "#050b14", color: firstPick === "red" ? "#ef4444" : "#64748b", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
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

                  <button onClick={startDraft} disabled={!firstPick} style={{ padding: "12px", borderRadius: 8, border: "none", background: firstPick ? "#f59e0b" : "#1e293b", color: firstPick ? "#050b14" : "#475569", fontWeight: 800, fontSize: 13, cursor: firstPick ? "pointer" : "not-allowed", letterSpacing: "0.06em" }}>
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
                <div style={styles.teamsGrid}>
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
                        onClick={() => {}} onRemove={() => removePickSlot("blue", idx)} />
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
                        onClick={() => {}} onRemove={() => removePickSlot("red", idx)} />
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
                        <button key={b.id} style={{ ...styles.brawlerChip, opacity: used ? 0.3 : 1, cursor: used ? "not-allowed" : "pointer", border: used ? "1px solid #1e293b" : isBan ? `1px solid rgba(239,68,68,0.4)` : `1px solid ${b.color}40`, background: used ? "#0f172a" : isBan ? "rgba(239,68,68,0.06)" : `${b.color}12` }}
                          onClick={() => !used && handleBrawlerSelect(b)} disabled={used}>
                          <div style={{ ...styles.brawlerAvatar, background: `${b.color}25`, border: `1.5px solid ${b.color}60` }}>
                            <span style={{ fontSize: 9, fontWeight: 800, color: b.color }}>{b.initial}</span>
                          </div>
                          <span style={{ fontSize: 10, color: used ? "#334155" : "#cbd5e1", fontWeight: 600 }}>{b.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* SIDEBAR AI MATCH RECOMMENDATIONS */}
            <div style={styles.sidebar}>
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
                    return <>Best on <span style={{ color: "#f59e0b" }}>{selectedMap.name}</span> overall</>;
                  return <>Wins on <span style={{ color: "#f59e0b" }}>{selectedMap.name}</span> vs {enemyPicks.map(b => b.name).join(", ")}</>;
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
                  <SuggestionCard key={s.key} s={s} i={i} />
                ))}
              </div>
              <div style={styles.synergyPanel}><SynergyBar blueTeam={blueTeam} redTeam={redTeam} /></div>
            </div>
          </div>
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
      `}</style>
    </div>
  );
}

/* ==========================================
   SUB-VIEWS COMPONENT MODULES
   ========================================== */

function RankBracketSelector({ value, onChange, selectedPatch, onPatchChange, patches }) {
  const [patchOpen, setPatchOpen] = useState(false);
  return (
    <div style={styles.rankBracketBar}>
      <div style={styles.rankBracketLabel}>
        <Crown size={14} color="#f59e0b" />
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
        <button onClick={() => setPatchOpen(o => !o)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, border: "1px solid #1e293b", background: "#0a1220", color: "#f59e0b", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
          <Star size={11} color="#f59e0b" fill="#f59e0b" />
          Patch {selectedPatch}
          <ChevronDown size={11} color="#64748b" style={{ transform: patchOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
        </button>
        {patchOpen && patches.length > 0 && (
          <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, background: "#0a1220", border: "1px solid #1e293b", borderRadius: 8, zIndex: 200, minWidth: 140, overflow: "hidden" }}>
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
        Pre-aggregated ranked data for {bracketLabel} — {totalPicks.toLocaleString()} total picks tracked.
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
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, width: "100%", borderTop: "1px solid #1e293b", paddingTop: 8 }}>
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
          <div key={tier} style={{ display: "flex", background: "#0a1220", border: "1px solid #1e293b", borderRadius: 10, overflow: "hidden" }}>
            <div style={{ width: 60, background: TIER_COLORS[tier] + "15", display: "flex", alignItems: "center", justifyContent: "center", borderRight: "1px solid #1e293b", fontSize: 24, fontWeight: 900, color: TIER_COLORS[tier] }}>
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
      <div style={{ background: "#0a1220", border: "1px solid #1e293b", borderRadius: 12, padding: 16, marginTop: 20, textAlign: "left", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 8, fontSize: 12 }}><Check size={14} color="#10b981" /> <span>Real-time companion overlay linkage</span></div>
        <div style={{ display: "flex", gap: 8, fontSize: 12 }}><Check size={14} color="#10b981" /> <span>Hypercharge availability & matchup prediction maps</span></div>
        <div style={{ display: "flex", gap: 8, fontSize: 12 }}><Check size={14} color="#10b981" /> <span>Deep premium structural party counters (3v3 Synergy Maps)</span></div>
        <button style={{ width: "100%", background: "#f59e0b", color: "#050b14", border: "none", padding: "10px", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4, marginTop: 8 }}>
          Upgrade Now <ArrowUpRight size={14} />
        </button>
      </div>
    </div>
  );
}

/* ==========================================
   SUPPORTING STRUCTURAL SUB-COMPONENTS
   ========================================== */

function SuggestionCard({ s, i }) {
  const [imgErr, setImgErr] = useState(false);
  const meta = BRAWLER_META_IMPORT[s.key] || {};
  const color = s.winRate >= 55 ? "#10b981" : s.winRate >= 50 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ ...styles.suggestionCard, animationDelay: `${i * 0.05}s` }} className="suggestion-anim">
      <div style={{ ...styles.suggAvatarWrap, width: 36, height: 36, overflow: "hidden", background: `${meta.rarityColor || "#475569"}20`, borderColor: meta.rarityColor || "#1e293b" }}>
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

function BanSlot({ brawler, active, onRemove }) {
  return (
    <div style={{ flex: 1, minWidth: 0, height: 36, borderRadius: 6, border: `1px solid ${active ? "rgba(239,68,68,0.6)" : brawler ? "rgba(239,68,68,0.3)" : "#1e293b"}`, background: active ? "rgba(239,68,68,0.1)" : brawler ? "rgba(239,68,68,0.05)" : "#050b14", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" }}>
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
  const teamColor = team === "blue" ? "#3b82f6" : "#ef4444";
  return (
    <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 10, border: active ? `1.5px solid ${teamColor}` : `1px solid ${brawler ? teamColor + "40" : "#1e293b"}`, background: active ? `${teamColor}08` : brawler ? `${brawler.color}0a` : "rgba(15,23,42,0.6)", minHeight: 52, cursor: "pointer" }}>
      {brawler ? (
        <>
          <div style={{ width: 32, height: 32, borderRadius: 6, background: `${brawler.color}25`, border: `1.5px solid ${brawler.color}70`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: brawler.color }}>{brawler.initial}</span>
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
      <div style={{ height: 4, background: "#0f172a", borderRadius: 2, overflow: "hidden", display: "flex" }}>
        <div style={{ width: "55%", background: "#3b82f6" }} /><div style={{ width: "45%", background: "#ef4444" }} />
      </div>
    </div>
  );
}

const styles = {
  root: { minHeight: "100vh", background: "#050b14", fontFamily: "'Barlow', sans-serif", color: "#e2e8f0", position: "relative" },
  scanlines: { position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.05) 2px, rgba(0,0,0,0.05) 4px)" },
  nav: { display: "flex", alignItems: "center", justify: "space-between", padding: "12px 20px", borderBottom: "1px solid #0f172a", background: "#050b14", position: "sticky", top: 0, zIndex: 100 },
  navBrand: { display: "flex", alignItems: "center", gap: 8 },
  brandIcon: { width: 32, height: 32, borderRadius: 8, background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.3)", display: "flex", alignItems: "center", justifyContent: "center" },
  brandText: { fontSize: 20, fontWeight: 900, fontFamily: "'Barlow Condensed', sans-serif", letterSpacing: "0.04em" },
  brandAccent: { color: "#f59e0b" },
  brandBadge: { fontSize: 8, fontWeight: 800, color: "#f59e0b", background: "rgba(245,158,11,0.15)", padding: "1px 5px", borderRadius: 4 },
  tabGroup: { display: "flex", gap: 4, marginLeft: 24 },
  tabBtn: { display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "none", color: "#64748b", padding: "6px 12px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, transition: "all 0.15s" },
  tabBtnActive: { background: "#0a1220", border: "1px solid #1e293b", color: "#e2e8f0" },
  navRight: { marginLeft: "auto" },
  resetBtn: { display: "flex", alignItems: "center", gap: 5, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 12, fontWeight: 600 },
  contentContainer: { position: "relative", zIndex: 1 },
  rankBracketBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: "12px 24px",
    borderBottom: "1px solid #0f172a",
    background: "linear-gradient(180deg, rgba(245,158,11,0.06) 0%, transparent 100%)",
  },
  rankBracketLabel: { display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 800, color: "#94a3b8", letterSpacing: "0.08em", textTransform: "uppercase" },
  rankBracketGroup: { display: "flex", gap: 8, flexWrap: "wrap" },
  rankBracketBtn: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 14px",
    borderRadius: 10,
    border: "1px solid #1e293b",
    background: "#0a1220",
    color: "#64748b",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    transition: "all 0.15s",
  },
  main: { display: "grid", gridTemplateColumns: "1fr 340px", minHeight: "calc(100vh - 57px)" },
  draftPanel: { padding: 20, borderRight: "1px solid #0f172a", display: "flex", flexDirection: "column", gap: 16 },
  sidebar: { padding: 16, background: "rgba(7,14,28,0.4)", display: "flex", flexDirection: "column", gap: 12 },
  panelHeader: { display: "flex", alignItems: "center", gap: 12 },
  panelTitle: { fontSize: 13, fontWeight: 700, color: "#f59e0b", letterSpacing: "0.06em", fontFamily: "'Barlow Condensed', sans-serif", textTransform: "uppercase" },
  mapDropdownWrapper: { position: "relative" },
  mapDropdown: { display: "flex", alignItems: "center", gap: 8, background: "#0a1220", border: "1px solid #1e293b", borderRadius: 8, padding: "4px 10px", cursor: "pointer" },
  modeBadge: { fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 4 },
  pickCounter: { marginLeft: "auto", fontSize: 11, color: "#475569" },
  teamsGrid: { display: "grid", gridTemplateColumns: "1fr 40px 1fr", gap: 8, alignItems: "start" },
  teamColumn: { display: "flex", flexDirection: "column", gap: 6 },
  teamLabel: { display: "flex", alignItems: "center", gap: 6, pb: 4 },
  vsDivider: { display: "flex", justifyContent: "center", paddingTop: 34 },
  vsCircle: { width: 24, height: 24, borderRadius: "50%", background: "#0f172a", border: "1px solid #1e293b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#475569", fontWeight: 800 },
  pickerSection: { borderTop: "1px solid #0f172a", paddingTop: 14, display: "flex", flexDirection: "column", gap: 10 },
  pickerHeader: { display: "flex", gap: 8, alignItems: "center" },
  searchWrapper: { position: "relative", width: 200 },
  searchInput: { width: "100%", background: "#0a1220", border: "1px solid #1e293b", borderRadius: 8, padding: "5px 8px 5px 28px", color: "#cbd5e1", fontSize: 12 },
  roleFilters: { display: "flex", gap: 4 },
  roleBtn: { background: "transparent", border: "1px solid #1e293b", color: "#475569", borderRadius: 6, padding: "4px 10px", fontSize: 10, fontWeight: 600, cursor: "pointer" },
  roleBtnActive: { background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.4)", color: "#f59e0b" },
  brawlerGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(70px, 1fr))", gap: 6, maxHeight: 240, overflowY: "auto" },
  brawlerChip: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "6px", borderRadius: 8 },
  brawlerAvatar: { width: 32, height: 32, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center" },
  suggestionList: { display: "flex", flexDirection: "column", gap: 6 },
  suggestionCard: { display: "flex", alignItems: "center", gap: 10, padding: 12, background: "#0a1220", borderRadius: 10, border: "1px solid #1e293b" },
  suggAvatarWrap: { width: 34, height: 34, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid" },
  suggInfo: { flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  suggName: { fontSize: 13, fontWeight: 700, fontFamily: "'Barlow Condensed', sans-serif" },
  reasonBadge: { fontSize: 9, padding: "1px 5px", borderRadius: 4, display: "inline-block", width: "max-content" },
  winRateCol: { marginLeft: "auto" },
  synergyPanel: { background: "#0a1220", borderRadius: 10, border: "1px solid #1e293b", padding: 12, marginTop: "auto" },
  dropdown: { position: "absolute", top: "100%", left: 0, background: "#0a1220", border: "1px solid #1e293b", borderRadius: 8, overflow: "hidden", zIndex: 200, minWidth: 160 },
  dropdownItem: { display: "flex", justify: "space-between", width: "100%", padding: 8, background: "transparent", border: "none", color: "#cbd5e1", cursor: "pointer" },
  viewPadding: { padding: 24 },
  viewHeading: { fontSize: 20, fontWeight: 900, fontFamily: "'Barlow Condensed', sans-serif", display: "flex", alignItems: "center", gap: 8 },
  viewSubtext: { fontSize: 12, color: "#64748b", marginTop: 2 },
  matchesGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10, marginTop: 12, maxHeight: 520, overflowY: "auto", paddingRight: 4 },
  matchCard: { background: "#0a1220", border: "1px solid #1e293b", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 10 },
  matchCardHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 },
  matchMapName: { fontSize: 13, fontWeight: 700, color: "#e2e8f0", fontFamily: "'Barlow Condensed', sans-serif", marginBottom: 4 },
  resultBadge: { fontSize: 10, fontWeight: 800, padding: "3px 8px", borderRadius: 6, letterSpacing: "0.04em", flexShrink: 0 },
  matchTeams: { display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid #1e293b", paddingTop: 8 },
  matchTeamRow: { display: "flex", alignItems: "flex-start", gap: 6 },
  matchTeamLabel: { fontSize: 9, fontWeight: 800, color: "#3b82f6", letterSpacing: "0.06em", width: 45, flexShrink: 0, paddingTop: 2 },
  matchBrawlerList: { display: "flex", flexWrap: "wrap", gap: 4, flex: 1 },
  matchBrawlerChip: { fontSize: 9, fontWeight: 600, padding: "2px 6px", borderRadius: 4, border: "1px solid", background: "rgba(15,23,42,0.8)" },
};