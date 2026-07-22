import { useEffect, useMemo, useState } from "react";
import { X, RotateCcw, ChevronDown } from "lucide-react";
import BRAWLER_META_IMPORT from "./data/brawlerMeta.json";
import { BRAWLERS, MODE_COLORS, formatMode, formatBrawlerName, resolveMatchBracket, useMapMatches, supabase } from "./appCore";
import { getDraftProfile } from "./data/draftMeta";
import { getDraftAdvice, computeWinSplit, draftClassOf, classLabel, abilityOf, abilityLabel } from "./data/draftEngine";
import { useAuth } from "./auth";
import { tileStyles } from "./data/brawlerTile";

// Daily statistical intelligence (true win rates, popularity-trap/broken/
// inflation flags, per-class matchup WRs) — refreshed by scrapers/meta_weights.py.
function useBrawlerIntelligence(selectedPatch, rankBracket) {
  const [intel, setIntel] = useState({});
  useEffect(() => {
    if (!selectedPatch || !rankBracket) return;
    supabase
      .from("brawler_intelligence")
      .select("*")
      .eq("patch", selectedPatch)
      .eq("rank_bracket", rankBracket)
      .then(({ data }) => {
        const byKey = {};
        for (const row of data || []) byKey[row.brawler.toUpperCase()] = row;
        setIntel(byKey);
      });
  }, [selectedPatch, rankBracket]);
  return intel;
}

const MONO = "'JetBrains Mono', monospace";
const DISPLAY = "'Baloo 2', sans-serif";
const PANEL = { background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 28 };

// Compact game counts: 1904 → "1.9K", 24310 → "24K"
const fmtGames = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "")}K` : `${n}`);

// ─── Small primitives (homepage design language) ────────────────────────────

function Eyebrow({ children }) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 9, padding: "9px 18px 9px 14px", borderRadius: 999,
      background: "rgba(13,13,20,.6)", border: "1px solid rgba(179,107,255,.3)",
      fontFamily: MONO, fontSize: 12, letterSpacing: 2.5, color: "#c98bff",
    }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#b36bff", boxShadow: "0 0 8px #b36bff" }} />
      {children}
    </div>
  );
}

function PhaseStepper({ phase, bansEnabled, done }) {
  const steps = [
    { id: "setup", label: "SETUP" },
    ...(bansEnabled ? [{ id: "ban", label: "BANS" }] : []),
    { id: "pick", label: "PICKS" },
    { id: "done", label: "REVIEW" },
  ];
  const activeId = done ? "done" : phase;
  const activeIdx = steps.findIndex(s => s.id === activeId);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {steps.map((s, i) => {
        const state = i < activeIdx ? "past" : i === activeIdx ? "active" : "next";
        return (
          <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderRadius: 999,
              fontFamily: MONO, fontSize: 11, letterSpacing: 1.5, fontWeight: 700,
              background: state === "active" ? "rgba(179,107,255,.16)" : "rgba(255,255,255,.04)",
              border: `1px solid ${state === "active" ? "rgba(179,107,255,.5)" : "rgba(255,255,255,.08)"}`,
              color: state === "active" ? "#e9d5ff" : state === "past" ? "#8ee6b0" : "#6f7180",
              boxShadow: state === "active" ? "0 0 18px rgba(179,107,255,.25)" : "none",
            }}>
              <span>{state === "past" ? "✓" : String(i + 1).padStart(2, "0")}</span>
              {s.label}
            </div>
            {i < steps.length - 1 && <span style={{ width: 14, height: 1, background: "rgba(255,255,255,.15)" }} />}
          </div>
        );
      })}
    </div>
  );
}

function BrawlerTile({ brawler, size = 44, dim, banned, onClick, title }) {
  const [imgErr, setImgErr] = useState(false);
  const t = tileStyles({ key: brawler.key, rarity: brawler.rarity, rarityColor: brawler.color, size });
  return (
    <div onClick={onClick} title={title} style={{ position: "relative", ...t.outer, cursor: onClick ? "pointer" : "default", opacity: dim ? 0.32 : 1 }}>
      <div style={t.inner}>
        {!imgErr && brawler.imageUrl
          ? <img src={brawler.imageUrl} alt={brawler.name} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={() => setImgErr(true)} />
          : <span style={{ fontSize: size * 0.28, fontWeight: 800, color: brawler.color }}>{brawler.initial}</span>}
      </div>
      {banned && (
        <div style={{ position: "absolute", inset: 0, borderRadius: t.outer.borderRadius, background: "rgba(20,6,10,.55)", display: "flex", alignItems: "center", justifyContent: "center", color: "#ff8f8f", fontWeight: 900, fontSize: size * 0.5 }}>✕</div>
      )}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function DraftAssistant({ selectedPatch, rankBracket, maps, brawlerStats }) {
  const [selectedMap, setSelectedMap] = useState(null);
  const [mapOpen, setMapOpen] = useState(false);
  const { matches: mapMatches } = useMapMatches(selectedPatch, selectedMap?.name, !!selectedMap);
  const intelligence = useBrawlerIntelligence(selectedPatch, rankBracket);

  const [blueTeam, setBlueTeam] = useState([null, null, null]);
  const [redTeam, setRedTeam] = useState([null, null, null]);
  const [blueBans, setBlueBans] = useState([null, null, null]);
  const [redBans, setRedBans] = useState([null, null, null]);
  const [bansEnabled, setBansEnabled] = useState(false);
  const [phase, setPhase] = useState("setup"); // setup | ban | pick
  const [firstPick, setFirstPick] = useState(null); // blue | red
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState("All");
  const [suggestions, setSuggestions] = useState([]);
  const [recommendedBans, setRecommendedBans] = useState([]);
  // Pro map intel for the selected map — advisory text, never part of scoring.
  const [mapNote, setMapNote] = useState(null);
  const [banAdvice, setBanAdvice] = useState([]);
  const [mapStatsByKey, setMapStatsByKey] = useState({});
  const [quickInfo, setQuickInfo] = useState(null);
  const [animKey, setAnimKey] = useState(0);

  // Auto-select first map when maps load or patch changes
  useEffect(() => {
    if (maps.length > 0) {
      setSelectedMap(prev => (!prev || !maps.find(m => m.name === prev.name)) ? maps[0] : prev);
    }
  }, [maps]);

  // Pick sequence 1-2-2-1; bans are 3 then 3.
  const pickSequence = useMemo(() => {
    if (!firstPick) return [];
    const a = firstPick, b = a === "blue" ? "red" : "blue";
    return [
      { team: a, idx: 0 }, { team: b, idx: 0 }, { team: b, idx: 1 },
      { team: a, idx: 1 }, { team: a, idx: 2 }, { team: b, idx: 2 },
    ];
  }, [firstPick]);

  const banSequence = useMemo(() => [
    { team: "blue", idx: 0 }, { team: "blue", idx: 1 }, { team: "blue", idx: 2 },
    { team: "red", idx: 0 }, { team: "red", idx: 1 }, { team: "red", idx: 2 },
  ], []);

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

  useEffect(() => {
    if (phase === "ban" && bansEnabled && [...blueBans, ...redBans].every(b => b !== null)) setPhase("pick");
  }, [blueBans, redBans, phase, bansEnabled]);

  const allBanned = [...blueBans, ...redBans].filter(Boolean).map(b => b.id);
  const allPicked = [...blueTeam, ...redTeam].filter(Boolean).map(b => b.id);
  const allUsed = [...allBanned, ...allPicked];
  const draftDone = phase === "pick" && allPicked.length === 6;

  // Confidence-weighted score: penalises small samples so niche brawlers don't dominate
  const CONFIDENCE = 30;
  const confidenceScore = (wins, picks) =>
    picks === 0 ? 0 : (wins / picks) * 100 * (picks / (picks + CONFIDENCE));

  // ── Suggestion engine (identical logic to before, now also exporting the
  //    per-brawler map stats so team strength is computed from real data) ──
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
      for (const b of winners) { if (!stats[b]) stats[b] = { picks: 0, wins: 0 }; stats[b].picks++; stats[b].wins++; }
      for (const b of losers)  { if (!stats[b]) stats[b] = { picks: 0, wins: 0 }; stats[b].picks++; }
    }
    setMapStatsByKey(stats);

    const bans = Object.entries(stats)
      .filter(([, s]) => s.picks >= 15)
      .map(([key, s]) => ({
        key, name: formatBrawlerName(key),
        winRate: Math.round((s.wins / s.picks) * 1000) / 10,
        picks: s.picks, score: confidenceScore(s.wins, s.picks),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
    setRecommendedBans(bans);

    const matchupStats = {};
    if (enemyKeys.length > 0) {
      for (const match of bracketMatches) {
        const winners = (match.winners || []).map(b => b.toUpperCase());
        const losers = (match.losers || []).map(b => b.toUpperCase());
        const enemyInLosers  = enemyKeys.every(e => losers.includes(e));
        const enemyInWinners = enemyKeys.every(e => winners.includes(e));
        let myTeam = null;
        if (enemyInLosers)  myTeam = { side: winners, won: true };
        else if (enemyInWinners) myTeam = { side: losers, won: false };
        if (myTeam) {
          for (const b of myTeam.side) {
            if (!matchupStats[b]) matchupStats[b] = { picks: 0, wins: 0 };
            matchupStats[b].picks++;
            if (myTeam.won) matchupStats[b].wins++;
          }
        }
      }
    }

    // The 5-pass Intelligence Engine: statistical truth → counter-intel →
    // preventative blocking → strategic/map filters → composition sanity.
    const myTeam = (pickerTeam === "blue" ? blueTeam : redTeam).filter(Boolean).map(b => b.name.toUpperCase());
    const { suggestions: advice, mapNote: note, banSuggestions: proBans } = getDraftAdvice({
      mode: selectedMap?.mode,
      mapName: selectedMap?.name,
      pickSlot: [...blueTeam, ...redTeam].filter(Boolean).length + 1,
      myTeam,
      enemyTeam: enemyKeys,
      unavailable: allUsedNames,
      banned: [...blueBans, ...redBans].filter(Boolean).map(b => b.name.toUpperCase()),
      mapStats: stats,
      matchupStats,
      intelligence,
    });

    setSuggestions(advice);
    setMapNote(note);
    setBanAdvice(proBans);
    setAnimKey(k => k + 1);
  }, [blueTeam, redTeam, blueBans, redBans, selectedMap, mapMatches, rankBracket, activeSlot, firstPick, intelligence]);

  // Live comp strength — average confidence-weighted map win rate of each
  // team's picks, from the real per-map stats (no mock values).
  const teamStrength = useMemo(() => {
    const avg = (team) => {
      const rates = team.filter(Boolean).map(b => {
        const s = mapStatsByKey[b.name.toUpperCase()];
        return s && s.picks >= 10 ? (s.wins / s.picks) * 100 : null;
      }).filter(v => v !== null);
      return rates.length ? rates.reduce((a, v) => a + v, 0) / rates.length : null;
    };
    return { blue: avg(blueTeam), red: avg(redTeam) };
  }, [blueTeam, redTeam, mapStatsByKey]);

  // Intelligence Engine verdict once all six picks are locked: win probability
  // split (always sums to 100) + per-team composition sanity report.
  const winSplit = useMemo(() => {
    if (!draftDone) return null;
    return computeWinSplit({
      blueTeam: blueTeam.filter(Boolean).map(b => b.name.toUpperCase()),
      redTeam: redTeam.filter(Boolean).map(b => b.name.toUpperCase()),
      mode: selectedMap?.mode,
      mapStats: mapStatsByKey,
      intelligence,
    });
  }, [draftDone, blueTeam, redTeam, selectedMap, mapStatsByKey, intelligence]);

  // Filter by Bobby's DRAFT class (same taxonomy as the suggestion chips), not
  // the official Supercell class — otherwise new brawlers with no official class
  // fall into an "Unknown" tab and the filter labels contradict the card labels.
  const draftClassName = (b) => classLabel(draftClassOf(b.key));
  const roles = ["All", ...Array.from(new Set(BRAWLERS.map(draftClassName))).sort()];
  const filtered = BRAWLERS.filter(b =>
    b.name.toLowerCase().includes(search.toLowerCase()) &&
    (filterRole === "All" || draftClassName(b) === filterRole)
  );

  const handleBrawlerSelect = (brawler) => {
    if (allUsed.includes(brawler.id) || !activeSlot) return;
    if (activeSlot.phase === "ban") {
      if (activeSlot.team === "blue") { const next = [...blueBans]; next[activeSlot.idx] = brawler; setBlueBans(next); }
      else { const next = [...redBans]; next[activeSlot.idx] = brawler; setRedBans(next); }
    } else {
      if (activeSlot.team === "blue") { const next = [...blueTeam]; next[activeSlot.idx] = brawler; setBlueTeam(next); }
      else { const next = [...redTeam]; next[activeSlot.idx] = brawler; setRedTeam(next); }
    }
  };

  const removePickSlot = (team, idx) => {
    if (team === "blue") { const next = [...blueTeam]; next[idx] = null; setBlueTeam(next); }
    else { const next = [...redTeam]; next[idx] = null; setRedTeam(next); }
  };
  const removeBanSlot = (team, idx) => {
    if (team === "blue") { const next = [...blueBans]; next[idx] = null; setBlueBans(next); }
    else { const next = [...redBans]; next[idx] = null; setRedBans(next); }
    if (phase === "pick") setPhase("ban");
  };
  const resetDraft = () => {
    setBlueTeam([null, null, null]); setRedTeam([null, null, null]);
    setBlueBans([null, null, null]); setRedBans([null, null, null]);
    setPhase("setup"); setFirstPick(null); setSearch(""); setFilterRole("All");
  };

  const mc = selectedMap ? (MODE_COLORS[selectedMap.mode?.replace(/\s/g, "")] ?? MODE_COLORS[selectedMap.mode?.toLowerCase?.()] ?? "#64748b") : "#64748b";

  return (
    <div style={{ position: "relative", zIndex: 10, maxWidth: 1280, margin: "0 auto", padding: "26px 5vw 80px" }}>

      {/* Header row: eyebrow + stepper */}
      <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap", marginBottom: 22 }}>
        <Eyebrow>LIVE DRAFT · {rankBracket === "masters_legendary" ? "MASTERS+" : "DIAMOND & MYTHIC"}</Eyebrow>
        <div style={{ marginLeft: "auto" }}>
          <PhaseStepper phase={phase} bansEnabled={bansEnabled} done={draftDone} />
        </div>
      </div>

      {/* Map row */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 22 }}>
        <div style={{ position: "relative" }}>
          {selectedMap ? (
            <button onClick={() => setMapOpen(o => !o)} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "12px 22px", borderRadius: 999,
              background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)", cursor: "pointer",
            }}>
              <span style={{ color: "#f4f4fa", fontSize: 15, fontWeight: 700, fontFamily: DISPLAY }}>{selectedMap.name}</span>
              <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1, fontWeight: 700, padding: "3px 10px", borderRadius: 999, background: mc + "26", color: mc, border: `1px solid ${mc}50` }}>
                {formatMode(selectedMap.mode).toUpperCase()}
              </span>
              <ChevronDown size={14} color="#8b8b9c" style={{ transform: mapOpen ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
            </button>
          ) : (
            <span style={{ fontSize: 13, color: "#6f7180" }}>Loading maps…</span>
          )}
          {mapOpen && maps.length > 0 && (
            <MapFlyout maps={maps} selectedMap={selectedMap} onSelect={m => { setSelectedMap(m); setMapOpen(false); }} />
          )}
        </div>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {phase !== "setup" && !draftDone && (
            <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 1, color: "#8b8b9c" }}>
              {phase === "ban" ? `BANNING ${allBanned.length}/6` : `PICK ${allPicked.length}/6`}
            </span>
          )}
          <button onClick={resetDraft} style={{
            display: "inline-flex", alignItems: "center", gap: 7, padding: "10px 20px", borderRadius: 999,
            background: "rgba(255,122,122,.08)", border: "1px solid rgba(255,122,122,.3)", color: "#ff8f8f",
            fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "'Chakra Petch', sans-serif",
          }}>
            <RotateCcw size={13} /> Reset
          </button>
        </div>
      </div>

      {/* Main grid */}
      <div className="da-grid" style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 22, alignItems: "start" }}>

        {/* ── LEFT: draft board ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>

          {phase === "setup" && (
            <div style={{ ...PANEL, padding: 38, display: "flex", flexDirection: "column", gap: 26 }}>
              <div>
                <h2 style={{ fontFamily: DISPLAY, fontSize: "clamp(28px,3.4vw,40px)", fontWeight: 700, color: "#f4f4fa", letterSpacing: "-.5px" }}>
                  Set up the <span style={{ color: "#b36bff", textShadow: "0 0 30px rgba(179,107,255,.5)" }}>draft</span>
                </h2>
                <p style={{ marginTop: 8, fontSize: 15, color: "#9a9aab", lineHeight: 1.6 }}>
                  Pick the map, decide who drafts first, and the assistant reads live {rankBracket === "masters_legendary" ? "Masters+" : "Diamond & Mythic"} data on every turn.
                </p>
              </div>

              {/* Bans toggle */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "18px 22px", borderRadius: 20, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)" }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#f4f4fa" }}>Enable bans</div>
                  <div style={{ fontSize: 12.5, color: "#6f7180", marginTop: 2 }}>3 bans per team before picking, blue bans first</div>
                </div>
                <button onClick={() => setBansEnabled(v => !v)} style={{
                  width: 52, height: 28, borderRadius: 999, border: "none", cursor: "pointer", position: "relative",
                  background: bansEnabled ? "#b36bff" : "rgba(255,255,255,.1)", transition: "background .2s",
                  boxShadow: bansEnabled ? "0 0 18px rgba(179,107,255,.4)" : "none",
                }}>
                  <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: bansEnabled ? 27 : 3, transition: "left .2s" }} />
                </button>
              </div>

              {/* First pick */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 2, color: "#8b8b9c" }}>WHO PICKS FIRST?</span>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {[["blue", "Blue Team", "#7cc4ff"], ["random", "Coin Flip", "#ffce7a"], ["red", "Red Team", "#ff8f8f"]].map(([id, label, color]) => {
                    const active = firstPick === id || (id !== "random" && firstPick === id);
                    return (
                      <button key={id}
                        onClick={() => id === "random" ? setFirstPick(Math.random() < 0.5 ? "blue" : "red") : setFirstPick(id)}
                        style={{
                          flex: id === "random" ? "0 0 auto" : 1, minWidth: 130, padding: "16px 22px", borderRadius: 999, cursor: "pointer",
                          fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: 15,
                          background: firstPick === id ? `${color}1f` : "rgba(255,255,255,.03)",
                          border: `1px solid ${firstPick === id ? color + "80" : "rgba(255,255,255,.1)"}`,
                          color: firstPick === id ? color : "#b7b7c6",
                          boxShadow: firstPick === id ? `0 0 22px ${color}30` : "none",
                        }}>
                        {label}
                      </button>
                    );
                  })}
                </div>
                {firstPick && (
                  <p style={{ fontFamily: MONO, fontSize: 11, letterSpacing: .5, color: "#8b8b9c" }}>
                    ORDER · {(firstPick === "blue" ? ["BLUE", "RED", "RED", "BLUE", "BLUE", "RED"] : ["RED", "BLUE", "BLUE", "RED", "RED", "BLUE"]).join(" → ")}
                  </p>
                )}
              </div>

              <button
                onClick={() => firstPick && setPhase(bansEnabled ? "ban" : "pick")}
                disabled={!firstPick}
                style={{
                  padding: "17px 34px", borderRadius: 999, border: "none",
                  background: firstPick ? "#ffb43d" : "rgba(255,255,255,.06)",
                  color: firstPick ? "#1a1206" : "#6f7180",
                  fontWeight: 700, fontSize: 16, letterSpacing: .5, cursor: firstPick ? "pointer" : "not-allowed",
                  fontFamily: "'Chakra Petch', sans-serif",
                  boxShadow: firstPick ? "0 0 30px rgba(255,180,61,.35)" : "none",
                }}>
                {firstPick ? "Start the draft →" : "Select who picks first"}
              </button>
            </div>
          )}

          {phase !== "setup" && (
            <div style={{ ...PANEL, padding: 30, display: "flex", flexDirection: "column", gap: 24 }}>
              {/* Teams */}
              <div className="da-teams" style={{ display: "grid", gridTemplateColumns: "1fr 52px 1fr", gap: 14, alignItems: "start" }}>
                {/* BLUE */}
                <TeamColumn
                  label="BLUE TEAM" color="#7cc4ff" team={blueTeam} bans={blueBans} bansEnabled={bansEnabled}
                  phase={phase} activeSlot={activeSlot} side="blue"
                  strength={teamStrength.blue}
                  onSlotClick={(b) => b && setQuickInfo({ key: b.name.toUpperCase(), name: b.name })}
                  onRemovePick={(i) => removePickSlot("blue", i)}
                  onRemoveBan={(i) => removeBanSlot("blue", i)}
                />
                <div style={{ display: "flex", justifyContent: "center", paddingTop: 44 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: "50%", background: "rgba(13,13,20,.8)",
                    border: "1px solid rgba(255,255,255,.12)", display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: MONO, fontSize: 11, fontWeight: 700, color: "#8b8b9c",
                  }}>VS</div>
                </div>
                {/* RED */}
                <TeamColumn
                  label="RED TEAM" color="#ff8f8f" team={redTeam} bans={redBans} bansEnabled={bansEnabled}
                  phase={phase} activeSlot={activeSlot} side="red" alignRight
                  strength={teamStrength.red}
                  onSlotClick={(b) => b && setQuickInfo({ key: b.name.toUpperCase(), name: b.name })}
                  onRemovePick={(i) => removePickSlot("red", i)}
                  onRemoveBan={(i) => removeBanSlot("red", i)}
                />
              </div>

              {/* Draft complete verdict — Intelligence Engine win split */}
              {draftDone && winSplit && (
                <div style={{
                  borderRadius: 20, padding: "22px 26px",
                  background: "linear-gradient(160deg, rgba(255,180,61,.10), rgba(20,14,32,.3))",
                  border: "1px solid rgba(255,180,61,.24)",
                  display: "flex", flexDirection: "column", gap: 14,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 2, color: "#ffce7a" }}>DRAFT COMPLETE · ENGINE VERDICT</span>
                      <p style={{ marginTop: 6, fontSize: 15.5, fontWeight: 700, color: "#f4f4fa", fontFamily: DISPLAY }}>
                        {winSplit.winner === "even"
                          ? "Dead even draft — execution decides it."
                          : <>{winSplit.winner === "blue" ? "Blue" : "Red"} team wins the draft <span style={{ color: winSplit.winner === "blue" ? "#7cc4ff" : "#ff8f8f" }}>{Math.max(winSplit.blue, winSplit.red)}–{Math.min(winSplit.blue, winSplit.red)}</span></>}
                      </p>
                    </div>
                    <button onClick={resetDraft} style={{
                      padding: "13px 26px", borderRadius: 999, border: "none", background: "#ffb43d", color: "#1a1206",
                      fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "'Chakra Petch', sans-serif",
                      boxShadow: "0 0 26px rgba(255,180,61,.35)",
                    }}>Run it back →</button>
                  </div>
                  {/* 100-point probability bar */}
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontFamily: MONO, fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                      <span style={{ color: "#7cc4ff" }}>BLUE {winSplit.blue}%</span>
                      <span style={{ color: "#ff8f8f" }}>{winSplit.red}% RED</span>
                    </div>
                    <div style={{ display: "flex", height: 10, borderRadius: 999, overflow: "hidden", background: "rgba(255,255,255,.06)" }}>
                      <div style={{ width: `${winSplit.blue}%`, background: "linear-gradient(90deg, #4a9fe8, #7cc4ff)", boxShadow: "0 0 12px rgba(124,196,255,.5)", transition: "width .7s ease" }} />
                      <div style={{ width: `${winSplit.red}%`, background: "linear-gradient(90deg, #ff8f8f, #e85a5a)", transition: "width .7s ease" }} />
                    </div>
                  </div>
                  {(winSplit.blueSanity.missing.length > 0 || winSplit.redSanity.missing.length > 0) && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {winSplit.blueSanity.missing.length > 0 && (
                        <span style={{ fontFamily: MONO, fontSize: 10.5, color: "#7cc4ff" }}>⚠ BLUE comp lacks a {winSplit.blueSanity.missing.join(" and a ")}</span>
                      )}
                      {winSplit.redSanity.missing.length > 0 && (
                        <span style={{ fontFamily: MONO, fontSize: 10.5, color: "#ff8f8f" }}>⚠ RED comp lacks a {winSplit.redSanity.missing.join(" and a ")}</span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Picker */}
              {!draftDone && (
                <div style={{ display: "flex", flexDirection: "column", gap: 14, borderTop: "1px solid rgba(255,255,255,.07)", paddingTop: 20 }}>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 2, color: activeSlot?.phase === "ban" ? "#ff8f8f" : "#c98bff" }}>
                      {activeSlot ? `${activeSlot.team.toUpperCase()} ${activeSlot.phase === "ban" ? "BANS" : "PICKS"} NOW` : "DRAFT BOARD"}
                    </span>
                    <input
                      value={search} onChange={e => setSearch(e.target.value)} placeholder="Search brawlers…"
                      style={{
                        marginLeft: "auto", width: 200, padding: "9px 18px", borderRadius: 999,
                        background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)",
                        color: "#e9e9f2", fontSize: 13, fontFamily: "'Chakra Petch', sans-serif", outline: "none",
                      }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {roles.map(r => (
                      <button key={r} onClick={() => setFilterRole(r)} style={{
                        padding: "6px 14px", borderRadius: 999, cursor: "pointer", fontSize: 11.5, fontWeight: 600,
                        fontFamily: "'Chakra Petch', sans-serif",
                        background: filterRole === r ? "rgba(179,107,255,.16)" : "rgba(255,255,255,.03)",
                        border: `1px solid ${filterRole === r ? "rgba(179,107,255,.45)" : "rgba(255,255,255,.08)"}`,
                        color: filterRole === r ? "#e9d5ff" : "#8b8b9c",
                      }}>{r}</button>
                    ))}
                  </div>
                  <div style={{
                    display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(76px, 1fr))", gap: 10,
                    maxHeight: 300, overflowY: "auto", paddingRight: 4,
                  }}>
                    {filtered.map(b => {
                      const used = allUsed.includes(b.id);
                      const isBanned = allBanned.includes(b.id);
                      return (
                        <div key={b.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
                          <BrawlerTile brawler={b} size={52} dim={used && !isBanned} banned={isBanned}
                            onClick={() => !used && handleBrawlerSelect(b)} title={b.name} />
                          <span style={{ fontSize: 10, color: used ? "#4a4a58" : "#c9c9d6", fontWeight: 600, textAlign: "center", lineHeight: 1.1 }}>{b.name}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {draftDone && winSplit && (
            <DraftFeedbackCard
              map={selectedMap?.name} mode={selectedMap?.mode}
              rankBracket={rankBracket} patch={selectedPatch}
              blueTeam={blueTeam.filter(Boolean).map(b => b.name.toUpperCase())}
              redTeam={redTeam.filter(Boolean).map(b => b.name.toUpperCase())}
              winSplit={winSplit}
            />
          )}
        </div>

        {/* ── RIGHT: draft intel ── */}
        <div className="da-sidebar" style={{ ...PANEL, padding: 26, display: "flex", flexDirection: "column", gap: 16, position: "sticky", top: 20 }}>
          <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 2, color: "#c98bff" }}>◈ DRAFT INTEL</span>

          {/* Pro map read — advisory context from the map-rules config. Never
              part of scoring; the engine already applied the numeric half. */}
          {mapNote && (
            <div style={{
              padding: "11px 13px", borderRadius: 16,
              background: "rgba(255,206,122,.06)", border: "1px solid rgba(255,206,122,.18)",
            }}>
              <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: 1.4, color: "#ffce7a", marginBottom: 5 }}>
                MAP READ
              </div>
              <p style={{ fontSize: 12.5, color: "#c9c9d6", lineHeight: 1.55, margin: 0 }}>{mapNote}</p>
              {phase === "ban" && banAdvice.length > 0 && (
                <p style={{ fontSize: 12, color: "#ff8f8f", lineHeight: 1.5, margin: "7px 0 0" }}>
                  Priority ban: <strong style={{ color: "#ffb3b3" }}>{banAdvice.map(formatBrawlerName).join(", ")}</strong>
                </p>
              )}
            </div>
          )}

          {phase === "setup" && (
            <p style={{ fontSize: 13.5, color: "#8b8b9c", lineHeight: 1.6 }}>
              Start the draft to get live pick and ban intel for <span style={{ color: "#ffce7a" }}>{selectedMap?.name ?? "this map"}</span> — first-pick safety, counters to enemy picks, and matchup win rates.
            </p>
          )}

          {phase === "ban" && (
            <>
              <p style={{ fontSize: 12.5, color: "#8b8b9c", lineHeight: 1.5 }}>
                Biggest threats on <span style={{ color: "#ffce7a" }}>{selectedMap?.name}</span> — ban these first.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {recommendedBans.map(b => {
                  const full = BRAWLERS.find(x => x.key === b.key);
                  return (
                    <div key={b.key} onClick={() => full && handleBrawlerSelect(full)} style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 16,
                      background: "rgba(255,122,122,.06)", border: "1px solid rgba(255,122,122,.2)", cursor: "pointer",
                    }}>
                      {full && <BrawlerTile brawler={full} size={34} />}
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: "#f4f4fa", fontFamily: DISPLAY }}>{b.name}</span>
                      <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 13, fontWeight: 700, color: "#ff8f8f" }}>{b.winRate}%</span>
                    </div>
                  );
                })}
                {recommendedBans.length === 0 && <p style={{ fontSize: 12, color: "#6f7180" }}>Not enough map data yet for ban intel.</p>}
              </div>
            </>
          )}

          {phase === "pick" && !draftDone && (
            <>
              <p style={{ fontSize: 12.5, color: "#8b8b9c", lineHeight: 1.5 }}>
                {(() => {
                  const pickerTeam = activeSlot?.team ?? (firstPick || "blue");
                  const enemyTeam = pickerTeam === "blue" ? redTeam : blueTeam;
                  const enemies = enemyTeam.filter(Boolean);
                  return enemies.length === 0
                    ? <>Best blind picks on <span style={{ color: "#ffce7a" }}>{selectedMap?.name}</span> — safety-weighted, hard to punish.</>
                    : <>Best on <span style={{ color: "#ffce7a" }}>{selectedMap?.name}</span> against {enemies.map(b => b.name).join(", ")}.</>;
                })()}
              </p>
              <div key={animKey} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {suggestions.map((s, i) => {
                  const full = BRAWLERS.find(x => x.key === s.key);
                  const color = s.winRate >= 55 ? "#8ee6b0" : s.winRate >= 50 ? "#ffce7a" : "#ff8f8f";
                  return (
                    <div key={s.key} className="da-sugg" style={{
                      display: "flex", alignItems: "center", gap: 12, padding: 14, borderRadius: 20,
                      background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)",
                      cursor: "pointer", animationDelay: `${i * 0.06}s`,
                    }} onClick={() => full && handleBrawlerSelect(full)}>
                      {full && <BrawlerTile brawler={full} size={46} />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 15, fontWeight: 700, color: "#f4f4fa", fontFamily: DISPLAY }}>{s.name}</span>
                          {s.classLabel && (
                            <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: .8, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "rgba(179,107,255,.12)", color: "#c98bff", border: "1px solid rgba(179,107,255,.3)" }}>
                              {s.classLabel.toUpperCase()}
                            </span>
                          )}
                          {s.ability && (
                            <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: .8, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "rgba(124,196,255,.12)", color: "#7cc4ff", border: "1px solid rgba(124,196,255,.3)" }}>
                              {s.ability.toUpperCase()}
                            </span>
                          )}
                        </div>
                        {s.reasons?.length > 0 && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 5 }}>
                            {s.reasons.map((r, ri) => (
                              <span key={ri} style={{
                                fontFamily: MONO, fontSize: 9, letterSpacing: .5, fontWeight: 700, padding: "2px 8px", borderRadius: 999,
                                color: r.tone === "good" ? "#8ee6b0" : "#ff8f8f",
                                background: r.tone === "good" ? "rgba(142,230,176,.12)" : "rgba(255,122,122,.12)",
                                border: `1px solid ${r.tone === "good" ? "rgba(142,230,176,.3)" : "rgba(255,122,122,.3)"}`,
                              }}>{r.label.toUpperCase()}</span>
                            ))}
                          </div>
                        )}
                        {s.matchupNote && (
                          <div style={{ fontSize: 11.5, color: "#c9c9d6", marginTop: 5, fontFamily: "'Chakra Petch', sans-serif" }}>
                            {s.matchupNote}
                          </div>
                        )}
                      </div>
                      <div style={{ textAlign: "center", flexShrink: 0 }}>
                        <div style={{ fontFamily: MONO, fontSize: 16, fontWeight: 700, color }}>{s.winRate}%</div>
                        <div style={{ fontFamily: MONO, fontSize: 8, letterSpacing: 1, color: "#6f7180" }}>
                          {s.sampleGames > 0 ? `${fmtGames(s.sampleGames)} ${s.sampleScope === "overall" ? "OVERALL" : "MAP"}` : "WIN"}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {suggestions.length === 0 && (
                  <p style={{ fontSize: 12, color: "#6f7180", textAlign: "center", padding: "14px 0" }}>
                    Not enough data for this matchup — pick from the board.
                  </p>
                )}
              </div>
              <p style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: .5, color: "#4a4a58" }}>
                TAP A SUGGESTION TO LOCK IT INTO THE ACTIVE SLOT
              </p>
            </>
          )}

          {draftDone && winSplit && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <p style={{ fontSize: 13, color: "#8b8b9c", lineHeight: 1.6 }}>
                Engine verdict for {selectedMap?.name}: statistical strength, class counters, synergy and comp structure — from live {rankBracket === "masters_legendary" ? "Masters+" : "Diamond & Mythic"} data.
              </p>
              <div style={{ textAlign: "center", padding: "10px 0 4px" }}>
                <div style={{ fontFamily: DISPLAY, fontSize: 30, fontWeight: 700 }}>
                  <span style={{ color: "#7cc4ff" }}>{winSplit.blue}</span>
                  <span style={{ color: "#4a4a58", fontSize: 20 }}> — </span>
                  <span style={{ color: "#ff8f8f" }}>{winSplit.red}</span>
                </div>
                <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1.5, color: "#8b8b9c", marginTop: 2 }}>
                  {winSplit.winner === "even" ? "DEAD EVEN DRAFT" : `${winSplit.winner.toUpperCase()} TEAM WINS THE DRAFT`}
                </div>
              </div>
              <div style={{ display: "flex", height: 8, borderRadius: 999, overflow: "hidden", background: "rgba(255,255,255,.06)" }}>
                <div style={{ width: `${winSplit.blue}%`, background: "#7cc4ff", boxShadow: "0 0 12px rgba(124,196,255,.5)", transition: "width .7s ease" }} />
                <div style={{ width: `${winSplit.red}%`, background: "#ff8f8f", transition: "width .7s ease" }} />
              </div>
              <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 1, color: "#6f7180", textAlign: "center", marginTop: -4 }}>
                MATCHUP EDGE · AFTER COUNTERS & STRUCTURE
              </div>

              {/* Second lens: raw roster strength on the map, before any head-to-head. */}
              <div style={{ borderTop: "1px solid rgba(255,255,255,.07)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 7 }}>
                <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: 1.5, color: "#6f7180" }}>
                  ROSTER STRENGTH · SOLO WR ON MAP
                </span>
                {[["BLUE", teamStrength.blue, "#7cc4ff", winSplit.blueSanity], ["RED", teamStrength.red, "#ff8f8f", winSplit.redSanity]].map(([label, v, color, sanity]) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontFamily: MONO, fontSize: 10.5 }}>
                    <span style={{ color }}>{label} · {v != null ? `${v.toFixed(1)}% solo WR` : "NO MAP DATA"}</span>
                    {sanity.missing.length > 0 && <span style={{ color: "#ffce7a", textAlign: "right" }}>⚠ no {sanity.missing[0]}</span>}
                  </div>
                ))}
                <span style={{ fontSize: 10, color: "#6f7180", lineHeight: 1.4 }}>
                  Each side's average brawler win rate on this map on its own — not the matchup. The {winSplit.blue}–{winSplit.red} above is who wins once counters, synergy and comp gaps are applied.
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Quick info modal (real overall stats) */}
      {quickInfo && (
        <QuickInfoModal brawlerKey={quickInfo.key} brawlerStats={brawlerStats} rankBracket={rankBracket} onClose={() => setQuickInfo(null)} />
      )}

      <style>{`
        .da-sugg { animation: daFadeUp .3s ease both; }
        @keyframes daFadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        @keyframes daPulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(179,107,255,.35); } 50% { box-shadow: 0 0 0 6px rgba(179,107,255,0); } }
        @media (max-width: 980px) {
          .da-grid { grid-template-columns: 1fr !important; }
          .da-sidebar { position: static !important; }
          .da-teams { grid-template-columns: 1fr !important; }
          .da-teams > div:nth-child(2) { display: none !important; }
        }
      `}</style>
    </div>
  );
}

// ─── Team column ─────────────────────────────────────────────────────────────

function TeamColumn({ label, color, team, bans, bansEnabled, phase, activeSlot, side, alignRight, strength, onSlotClick, onRemovePick, onRemoveBan }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: alignRight ? "flex-end" : "flex-start" }}>
        <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, letterSpacing: 2, color }}>{label}</span>
        {strength != null && (
          <span style={{ fontFamily: MONO, fontSize: 10, padding: "2px 9px", borderRadius: 999, background: `${color}18`, border: `1px solid ${color}40`, color }}>
            {strength.toFixed(1)}% AVG
          </span>
        )}
      </div>

      {bansEnabled && (
        <div style={{ display: "flex", gap: 6, justifyContent: alignRight ? "flex-end" : "flex-start" }}>
          {bans.map((b, idx) => {
            const active = phase === "ban" && activeSlot?.team === side && activeSlot?.idx === idx;
            return (
              <div key={idx} style={{
                flex: 1, maxWidth: 90, height: 34, borderRadius: 999, position: "relative",
                display: "flex", alignItems: "center", justifyContent: "center",
                background: active ? "rgba(255,122,122,.12)" : b ? "rgba(255,122,122,.06)" : "rgba(255,255,255,.03)",
                border: `1px solid ${active ? "rgba(255,122,122,.6)" : b ? "rgba(255,122,122,.28)" : "rgba(255,255,255,.08)"}`,
                animation: active ? "daPulse 1.6s infinite" : "none",
              }}>
                {b ? (
                  <>
                    <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: "#ff8f8f", textDecoration: "line-through" }}>
                      {b.name.slice(0, 6).toUpperCase()}
                    </span>
                    <button onClick={() => onRemoveBan(idx)} style={{ position: "absolute", top: 2, right: 4, background: "none", border: "none", color: "#6f7180", cursor: "pointer", padding: 0 }}>
                      <X size={9} />
                    </button>
                  </>
                ) : (
                  <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 1, color: active ? "#ff8f8f" : "#4a4a58" }}>{active ? "BAN" : "—"}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {team.map((brawler, idx) => {
        const active = phase === "pick" && activeSlot?.team === side && activeSlot?.idx === idx;
        return (
          <div key={idx} onClick={() => onSlotClick(brawler)} style={{
            display: "flex", alignItems: "center", gap: 12, padding: "9px 14px", borderRadius: 999,
            minHeight: 62, cursor: brawler ? "pointer" : "default",
            background: active ? `${color}10` : brawler ? "rgba(255,255,255,.04)" : "rgba(255,255,255,.02)",
            border: `1px solid ${active ? color : brawler ? `${color}40` : "rgba(255,255,255,.07)"}`,
            animation: active ? "daPulse 1.6s infinite" : "none",
            flexDirection: alignRight ? "row-reverse" : "row",
          }}>
            {brawler ? (
              <>
                <BrawlerTile brawler={brawler} size={42} />
                <span style={{ fontSize: 15, fontWeight: 700, color: "#f4f4fa", fontFamily: DISPLAY, flex: 1, textAlign: alignRight ? "right" : "left" }}>{brawler.name}</span>
                <button onClick={(e) => { e.stopPropagation(); onRemovePick(idx); }} style={{ background: "none", border: "none", color: "#6f7180", cursor: "pointer", padding: 4 }}>
                  <X size={13} />
                </button>
              </>
            ) : (
              <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 1.5, color: active ? color : "#4a4a58", flex: 1, textAlign: alignRight ? "right" : "left" }}>
                {active ? "PICKING…" : `PICK ${idx + 1}`}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Map flyout (mode → maps) ────────────────────────────────────────────────

function MapFlyout({ maps, selectedMap, onSelect }) {
  const [hoveredMode, setHoveredMode] = useState(null);
  const grouped = maps.reduce((acc, m) => {
    const mode = m.mode || "Unknown";
    (acc[mode] = acc[mode] || []).push(m);
    return acc;
  }, {});
  const modes = Object.keys(grouped).sort();

  return (
    <div style={{ position: "absolute", top: "calc(100% + 8px)", left: 0, zIndex: 300, display: "flex" }}>
      <div style={{ background: "rgba(13,13,20,.95)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 20, overflow: "hidden", minWidth: 170, backdropFilter: "blur(14px)", boxShadow: "0 24px 60px rgba(0,0,0,.5)", padding: 6 }}>
        {modes.map(mode => {
          const mc = MODE_COLORS[mode?.replace(/\s/g, "")] ?? MODE_COLORS[mode?.toLowerCase?.()] ?? "#64748b";
          const isHovered = hoveredMode === mode;
          return (
            <div key={mode} onMouseEnter={() => setHoveredMode(mode)} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
              padding: "10px 14px", cursor: "pointer", borderRadius: 999,
              background: isHovered ? `${mc}18` : "transparent",
            }}>
              <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, letterSpacing: 1, color: mc }}>{formatMode(mode).toUpperCase()}</span>
              <span style={{ color: "#4a4a58", fontSize: 10 }}>›</span>
            </div>
          );
        })}
      </div>
      {hoveredMode && (
        <div style={{ background: "rgba(13,13,20,.95)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 20, overflow: "auto", maxHeight: 320, minWidth: 200, marginLeft: 6, backdropFilter: "blur(14px)", boxShadow: "0 24px 60px rgba(0,0,0,.5)", padding: 6 }}>
          {grouped[hoveredMode].map(m => (
            <button key={m.name} onClick={() => onSelect(m)} style={{
              display: "block", width: "100%", textAlign: "left", padding: "10px 16px", borderRadius: 999,
              background: selectedMap?.name === m.name ? "rgba(179,107,255,.14)" : "transparent",
              border: "none", color: selectedMap?.name === m.name ? "#e9d5ff" : "#c9c9d6",
              fontSize: 13, fontWeight: selectedMap?.name === m.name ? 700 : 400, cursor: "pointer",
              fontFamily: "'Chakra Petch', sans-serif",
            }}>
              {m.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Quick info modal ────────────────────────────────────────────────────────

function QuickInfoModal({ brawlerKey, brawlerStats, rankBracket, onClose }) {
  const meta = BRAWLER_META_IMPORT[brawlerKey] || {};
  const full = BRAWLERS.find(b => b.key === brawlerKey);
  const overall = (brawlerStats || []).find(r => r.rank_bracket === rankBracket && r.map === null && r.brawler === brawlerKey);
  const profile = getDraftProfile(brawlerKey);
  const safety = profile.firstPickSafety >= 0.75 ? { text: "SAFE EARLY PICK", color: "#8ee6b0" }
    : profile.firstPickSafety <= 0.42 ? { text: "SAVE FOR LATE — COUNTERABLE", color: "#ff8f8f" }
    : { text: "FLEXIBLE TIMING", color: "#ffce7a" };
  const abilityCode = abilityOf(brawlerKey);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(5,4,10,.75)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 400, background: "#0d0d14", border: "1px solid rgba(255,255,255,.1)", borderRadius: 28, padding: 26, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          {full && <BrawlerTile brawler={full} size={60} />}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 22, fontWeight: 700, fontFamily: DISPLAY, color: "#f4f4fa" }}>{formatBrawlerName(brawlerKey)}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
              <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 1, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: "rgba(179,107,255,.12)", color: "#c98bff", border: "1px solid rgba(179,107,255,.3)" }}>{profile.class.toUpperCase()}</span>
              {abilityCode && (
                <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 1, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: "rgba(124,196,255,.12)", color: "#7cc4ff", border: "1px solid rgba(124,196,255,.3)" }}>{abilityLabel(abilityCode).toUpperCase()}</span>
              )}
              <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 1, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: `${safety.color}15`, color: safety.color, border: `1px solid ${safety.color}40` }}>{safety.text}</span>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "rgba(255,122,122,.1)", border: "1px solid rgba(255,122,122,.3)", color: "#ff8f8f", borderRadius: 999, padding: 8, cursor: "pointer", display: "flex" }}>
            <X size={14} />
          </button>
        </div>
        {meta.description && <p style={{ fontSize: 13, color: "#9a9aab", lineHeight: 1.6 }}>{meta.description}</p>}
        <div style={{ borderRadius: 18, padding: "14px 18px", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", textAlign: "center" }}>
          {overall ? (
            <>
              <div style={{ fontFamily: MONO, fontSize: 22, fontWeight: 700, color: "#8ee6b0" }}>{parseFloat(overall.win_rate)}%</div>
              <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 1.5, color: "#6f7180", marginTop: 2 }}>OVERALL WIN RATE · {overall.picks} GAMES</div>
            </>
          ) : (
            <div style={{ fontSize: 12, color: "#6f7180" }}>No overall data for this bracket yet.</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Post-draft feedback ─────────────────────────────────────────────────────
// Signed-in users rate the engine's advice and (optionally) report who actually
// won, so the win-probability model can be calibrated against real outcomes.
// Stored in draft_feedback (RLS: authenticated INSERT only). Top-level component
// (never nested in render) so its inputs don't remount and lose focus.
function DraftFeedbackCard({ map, mode, rankBracket, patch, blueTeam, redTeam, winSplit }) {
  const { user, openAuth } = useAuth();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [winner, setWinner] = useState(null); // 'blue' | 'red' | 'skip'
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  if (done) {
    return (
      <div style={{ ...PANEL, padding: 22, display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 20 }}>💜</span>
        <span style={{ fontSize: 14, color: "#c9c9d6", fontFamily: DISPLAY, fontWeight: 700 }}>
          Thanks — your feedback trains the engine.
        </span>
      </div>
    );
  }

  const submit = async () => {
    if (!rating) { setError("Pick a star rating first."); return; }
    if (!winner) { setError("Tell us who won — or that you haven't played it."); return; }
    setBusy(true); setError(null);
    const { error: err } = await supabase.from("draft_feedback").insert({
      user_id: user.id,
      map, mode, rank_bracket: rankBracket, patch,
      blue_team: blueTeam, red_team: redTeam,
      engine_blue: winSplit.blue, engine_red: winSplit.red,
      actual_winner: winner === "skip" ? null : winner,
      rating, comment: comment.trim() || null,
    });
    setBusy(false);
    if (err) { setError(err.message); return; }
    setDone(true);
  };

  const winnerOpts = [
    ["blue", "Blue won", "#7cc4ff"],
    ["red", "Red won", "#ff8f8f"],
    ["skip", "Haven't played it", "#8b8b9c"],
  ];

  return (
    <div style={{ ...PANEL, padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 2, color: "#c98bff" }}>◈ RATE THIS DRAFT</span>
        <p style={{ marginTop: 6, fontSize: 13.5, color: "#9a9aab", lineHeight: 1.5 }}>
          Was the engine's read useful? Your rating and the real result help calibrate it.
        </p>
      </div>

      {!user ? (
        <button onClick={openAuth} style={{
          padding: "13px 24px", borderRadius: 999, border: "1px solid rgba(179,107,255,.5)",
          background: "rgba(179,107,255,.14)", color: "#e9d5ff", fontWeight: 700, fontSize: 14,
          cursor: "pointer", fontFamily: "'Chakra Petch', sans-serif", alignSelf: "flex-start",
        }}>
          Sign in to leave feedback
        </button>
      ) : (
        <>
          {/* Star rating */}
          <div style={{ display: "flex", gap: 6 }} onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} type="button" onClick={() => setRating(n)} onMouseEnter={() => setHover(n)} style={{
                background: "none", border: "none", cursor: "pointer", padding: 2, fontSize: 26, lineHeight: 1,
                color: n <= (hover || rating) ? "#ffb43d" : "rgba(255,255,255,.16)",
                textShadow: n <= (hover || rating) ? "0 0 14px rgba(255,180,61,.5)" : "none",
                transition: "color .12s, transform .12s", transform: n === hover ? "scale(1.18)" : "scale(1)",
              }}>★</button>
            ))}
          </div>

          {/* Who actually won */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: 1.5, color: "#8b8b9c" }}>
              WHO ACTUALLY WON? · ENGINE SAID {winSplit.winner === "even" ? "EVEN" : winSplit.winner.toUpperCase()}
            </span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {winnerOpts.map(([id, label, color]) => (
                <button key={id} type="button" onClick={() => setWinner(id)} style={{
                  padding: "9px 16px", borderRadius: 999, cursor: "pointer", fontSize: 12.5, fontWeight: 700,
                  fontFamily: "'Chakra Petch', sans-serif",
                  background: winner === id ? `${color}22` : "rgba(255,255,255,.03)",
                  border: `1px solid ${winner === id ? color + "88" : "rgba(255,255,255,.1)"}`,
                  color: winner === id ? color : "#b7b7c6",
                }}>{label}</button>
              ))}
            </div>
          </div>

          {/* Optional comment */}
          <textarea value={comment} onChange={e => setComment(e.target.value)}
            placeholder="Anything the engine got wrong or right? (optional)" rows={2} style={{
              width: "100%", padding: "10px 14px", borderRadius: 14, resize: "vertical", boxSizing: "border-box",
              background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.1)",
              color: "#e9e9f2", fontSize: 13, fontFamily: "'Chakra Petch', sans-serif", outline: "none",
            }} />

          {error && <span style={{ fontSize: 12, color: "#ff8f8f" }}>{error}</span>}

          <button onClick={submit} disabled={busy} style={{
            padding: "13px 26px", borderRadius: 999, border: "none",
            background: busy ? "rgba(255,255,255,.06)" : "#ffb43d", color: busy ? "#6f7180" : "#1a1206",
            fontWeight: 700, fontSize: 14, cursor: busy ? "default" : "pointer",
            fontFamily: "'Chakra Petch', sans-serif", alignSelf: "flex-start",
            boxShadow: busy ? "none" : "0 0 22px rgba(255,180,61,.3)",
          }}>
            {busy ? "Saving…" : "Submit feedback"}
          </button>
        </>
      )}
    </div>
  );
}
