import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Star, Users, Map, X } from "lucide-react";
import BRAWLER_META from "./data/brawlerMeta.json";
import BRAWLER_GUIDES from "./data/brawlerGuides.json";
import GENERAL_TIER_LIST from "./data/generalTierList.json";
import { tileStyles } from "./data/brawlerTile";
import { getExtendedGuide } from "./data/extendedGuides";
import { iconOverride, hasBrawlerGuide, getBrawlerGuide } from "./data/brawlerTips";
import { supabase, CURRENT_PATCH, GEAR_ICONS } from "./appCore";

// URL-safe slug for a brawler key, e.g. "MR. P" -> "mr-p", "LARRY & LAWRIE" -> "larry-lawrie"
export const slugifyBrawlerKey = (key) =>
  key.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export const findBrawlerKeyBySlug = (slug) =>
  Object.keys(BRAWLER_META).find(key => slugifyBrawlerKey(key) === slug) || null;

const RARITY_ORDER = ["Trophy Road", "Rare", "Super Rare", "Epic", "Mythic", "Legendary", "Ultra Legendary"];

const MIN_PICKS_OVERALL = 10;
const MIN_PICKS_MAP = 3;
const MIN_PICKS_TIER = 15; // minimum picks for a brawler to appear in a mode tier list

// Tier bands by win rate (%). First tier whose `min` is met wins.
const TIERS = [
  { id: "S+", color: "#ffc663", bg: "rgba(251,191,36,0.14)", border: "rgba(251,191,36,0.45)", min: 57 },
  { id: "S",  color: "#ffb43d", bg: "rgba(245,158,11,0.13)", border: "rgba(245,158,11,0.40)", min: 54 },
  { id: "A",  color: "#b36bff", bg: "rgba(168,85,247,0.13)", border: "rgba(168,85,247,0.40)", min: 52 },
  { id: "B",  color: "#60a5fa", bg: "rgba(96,165,250,0.12)", border: "rgba(96,165,250,0.38)", min: 50 },
  { id: "C",  color: "#94a3b8", bg: "rgba(148,163,184,0.10)", border: "rgba(148,163,184,0.35)", min: 47 },
  { id: "D",  color: "#fb923c", bg: "rgba(251,146,60,0.11)", border: "rgba(251,146,60,0.38)", min: 44 },
  { id: "F",  color: "#ef4444", bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.40)", min: -Infinity },
];

const tierForWinRate = (wr) => TIERS.find(t => wr >= t.min) || TIERS[TIERS.length - 1];

// Canonical mode order for the tier-list tabs
const MODE_ORDER = ["gemGrab", "brawlBall", "knockout", "heist", "hotZone", "bounty"];

const FORMAT_MODE = (mode) => {
  if (!mode) return "Unknown";
  return mode.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, c => c.toUpperCase());
};

const FORMAT_NAME = (name) =>
  name.toLowerCase().replace(/[a-z]+/g, w => w.charAt(0).toUpperCase() + w.slice(1));

// Convert win rate (0-100) to 1-7 star rating
// 50% = 3.5 stars baseline, each ~3% above/below = 1 star
function toStars(winRate, pickRate, totalPicks, picks) {
  if (!picks || picks < MIN_PICKS_OVERALL) return null;
  const wr = winRate;
  const prBonus = Math.min(pickRate / 5, 0.5); // small bonus for high pick rate
  const raw = ((wr - 44) / (60 - 44)) * 6 + 1 + prBonus;
  return Math.min(7, Math.max(1, Math.round(raw * 2) / 2)); // round to 0.5
}

// Collab brawlers removed from the game — excluded from every stats-derived
// list even though old match rows in the DB may still reference them.
const EXCLUDED_BRAWLERS = new Set(["BUZZ LIGHTYEAR"]);

export function computeStatsFromAggregated(rows, rankBracket) {
  const overall = rows.filter(r => r.rank_bracket === rankBracket && r.map === null && !EXCLUDED_BRAWLERS.has(r.brawler));
  const mapRows = rows.filter(r => r.rank_bracket === rankBracket && r.map !== null && !EXCLUDED_BRAWLERS.has(r.brawler));

  const totalPicks = overall.reduce((sum, r) => sum + r.picks, 0);

  const brawlers = overall
    .filter(r => r.picks >= MIN_PICKS_OVERALL)
    .map(r => {
      const wr = parseFloat(r.win_rate);
      const pr = parseFloat(r.pick_rate);
      const stars = toStars(wr, pr, totalPicks, r.picks);
      const meta = BRAWLER_META[r.brawler] || {};
      return {
        key: r.brawler,
        name: FORMAT_NAME(r.brawler),
        picks: r.picks,
        wins: r.wins,
        winRate: wr,
        pickRate: pr,
        stars,
        imageUrl: meta.imageUrl || null,
        rarity: meta.rarity || "Common",
        rarityColor: meta.rarityColor || "#94a3b8",
        class: meta.class || "Unknown",
        description: meta.description || "",
        starPowers: meta.starPowers || [],
        gadgets: meta.gadgets || [],
        guide: BRAWLER_GUIDES[r.brawler] || null,
      };
    })
    .sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0) || b.winRate - a.winRate);

  const byMap = {};
  for (const r of mapRows) {
    if (!byMap[r.map]) byMap[r.map] = { mode: r.mode, brawlers: {} };
    byMap[r.map].brawlers[r.brawler] = { picks: r.picks, wins: r.wins };
  }

  const byMode = {};
  for (const r of mapRows) {
    if (!r.mode) continue;
    if (!byMode[r.mode]) byMode[r.mode] = {};
    if (!byMode[r.mode][r.brawler]) byMode[r.mode][r.brawler] = { picks: 0, wins: 0 };
    byMode[r.mode][r.brawler].picks += r.picks;
    byMode[r.mode][r.brawler].wins += r.wins;
  }

  return { brawlers, byMode, byMap, totalPicks };
}

function computeSynergies(matches, brawlerKey) {
  const with_ = {};
  const against = {};

  for (const match of matches) {
    const winners = (match.winners || []).map(b => b.toUpperCase().trim());
    const losers = (match.losers || []).map(b => b.toUpperCase().trim());

    const isWinner = winners.includes(brawlerKey);
    const isLoser = losers.includes(brawlerKey);
    if (!isWinner && !isLoser) continue;

    const allies = isWinner ? winners : losers;
    const enemies = isWinner ? losers : winners;
    const won = isWinner;

    for (const ally of allies) {
      if (ally === brawlerKey) continue;
      if (!with_[ally]) with_[ally] = { picks: 0, wins: 0 };
      with_[ally].picks++;
      if (won) with_[ally].wins++;
    }

    for (const enemy of enemies) {
      if (!against[enemy]) against[enemy] = { picks: 0, wins: 0 };
      against[enemy].picks++;
      if (won) against[enemy].wins++;
    }
  }

  const toList = (obj) =>
    Object.entries(obj)
      .filter(([, s]) => s.picks >= MIN_PICKS_MAP)
      .map(([key, s]) => ({
        key,
        name: FORMAT_NAME(key),
        picks: s.picks,
        winRate: Math.round((s.wins / s.picks) * 1000) / 10,
        imageUrl: BRAWLER_META[key]?.imageUrl || null,
        rarityColor: BRAWLER_META[key]?.rarityColor || "#94a3b8",
      }))
      .sort((a, b) => b.winRate - a.winRate);

  return { synergies: toList(with_).slice(0, 6), counters: toList(against).slice(0, 6) };
}

// ─── Star display ─────────────────────────────────────────────────────────────
function StarRating({ stars, size = "md" }) {
  if (stars === null || stars === undefined) return <span style={{ fontSize: 10, color: "#7c8aa3" }}>—</span>;
  const sz = size === "sm" ? 10 : size === "lg" ? 18 : 13;
  return (
    <div style={{ display: "flex", gap: 1, alignItems: "center" }}>
      {[1, 2, 3, 4, 5, 6, 7].map(i => {
        const filled = stars >= i;
        const half = !filled && stars >= i - 0.5;
        const color = stars >= 6 ? "#ffb43d" : stars >= 4 ? "#60a5fa" : stars >= 2 ? "#94a3b8" : "#ef4444";
        return (
          <svg key={i} width={sz} height={sz} viewBox="0 0 24 24" fill={filled ? color : half ? "url(#half)" : "none"} stroke={color} strokeWidth={1.5}>
            {half && (
              <defs>
                <linearGradient id="half" x1="0" x2="1" y1="0" y2="0">
                  <stop offset="50%" stopColor={color} />
                  <stop offset="50%" stopColor="transparent" />
                </linearGradient>
              </defs>
            )}
            <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
          </svg>
        );
      })}
      <span style={{ fontSize: sz - 1, color: "#94a3b8", marginLeft: 3 }}>{stars.toFixed(1)}</span>
    </div>
  );
}

// ─── "Has a hand-written guide" marker ────────────────────────────────────────
// Only a handful of the 105 brawlers have a full written guide (build reasoning,
// video breakdowns, per-map positioning); the rest fall back to generated copy.
// Nothing used to distinguish them, so the deep guides were unfindable unless
// you already knew which brawler to open. Gold, matching the site's "this is the
// good stuff" accent.
const GUIDE_GOLD = "#ffb43d";

function GuideBadge({ compact = false }) {
  return (
    <span title="Full written guide — build reasoning, video breakdowns and map positioning"
      style={{
        display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0,
        fontFamily: "'JetBrains Mono', monospace", fontSize: compact ? 8 : 9,
        fontWeight: 700, letterSpacing: compact ? 0.6 : 1,
        padding: compact ? "2px 5px" : "3px 8px", borderRadius: 999,
        background: "rgba(255,180,61,.15)", color: GUIDE_GOLD, border: `1px solid ${GUIDE_GOLD}55`,
        whiteSpace: "nowrap",
      }}>
      {compact ? "★" : "★ GUIDE"}
    </span>
  );
}

// ─── Brawler portrait ─────────────────────────────────────────────────────────
function BrawlerPortrait({ brawler, size = 56, onClick }) {
  const [imgErr, setImgErr] = useState(false);
  const { outer, inner } = tileStyles({ key: brawler.key || brawler.name, rarity: brawler.rarity, rarityColor: brawler.rarityColor, size });
  return (
    <div className="bm-tap" onClick={onClick} style={{ ...outer, cursor: onClick ? "pointer" : "default" }}>
      <div style={inner}>
        {!imgErr && brawler.imageUrl ? (
          <img src={brawler.imageUrl} alt={brawler.name} style={{ width: "100%", height: "100%", objectFit: "cover" }}
            onError={() => setImgErr(true)} />
        ) : (
          <span style={{ fontSize: size * 0.22, fontWeight: 800, color: brawler.rarityColor }}>
            {brawler.name.slice(0, 2).toUpperCase()}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Brawler detail modal ──────────────────────────────────────────────────────
function useMapModeStats(brawler, byMode, byMap) {
  const mapStats = useMemo(() => {
    return Object.entries(byMap)
      .map(([map, data]) => {
        const s = data.brawlers[brawler.key];
        if (!s || s.picks < MIN_PICKS_MAP) return null;
        const wr = Math.round((s.wins / s.picks) * 1000) / 10;
        const stars = toStars(wr, 0, 1000, s.picks >= MIN_PICKS_MAP ? MIN_PICKS_OVERALL : 0);
        return { map, mode: data.mode, picks: s.picks, winRate: wr, stars };
      })
      .filter(Boolean)
      .sort((a, b) => b.winRate - a.winRate);
  }, [byMap, brawler.key]);

  const modeStats = useMemo(() => {
    return Object.entries(byMode).map(([mode, brawlers]) => {
      const s = brawlers[brawler.key];
      if (!s || s.picks < MIN_PICKS_MAP) return null;
      const wr = Math.round((s.wins / s.picks) * 1000) / 10;
      return { mode, picks: s.picks, winRate: wr };
    }).filter(Boolean).sort((a, b) => b.winRate - a.winRate);
  }, [byMode, brawler.key]);

  return { mapStats, modeStats };
}

function BrawlerDetail({ brawler, byMode, byMap, onClose, onOpenFullGuide, rankBracket = "masters_legendary" }) {
  const [activeSection, setActiveSection] = useState("overview");
  const { mapStats, modeStats } = useMapModeStats(brawler, byMode, byMap);

  // Live pair data. The Synergies tab used to be a hardcoded "coming soon"
  // saying this "requires per-matchup aggregation which will be added in the
  // next update" — that aggregation has existed for a while in
  // brawler_intelligence.with_brawler / vs_brawler, and the full guide page has
  // been rendering it. Only this modal never caught up.
  const [pairs, setPairs] = useState({ loading: true, with: [], vs: [] });
  useEffect(() => {
    let cancelled = false;
    setPairs({ loading: true, with: [], vs: [] });
    const rank = (obj, dir) => Object.entries(obj || {})
      .map(([key, v]) => ({ key: key.toUpperCase(), winRate: Math.round(Number(v.winRate) * 10) / 10, picks: Number(v.picks) }))
      .filter(r => r.picks >= 300 && Number.isFinite(r.winRate) && r.key !== brawler.key)
      .sort((a, b) => dir * (b.winRate - a.winRate))
      .slice(0, 6);
    supabase
      .from("brawler_intelligence")
      .select("with_brawler, vs_brawler")
      .eq("brawler", brawler.key).eq("patch", CURRENT_PATCH).eq("rank_bracket", rankBracket)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setPairs({ loading: false, with: data ? rank(data.with_brawler, 1) : [], vs: data ? rank(data.vs_brawler, -1) : [] });
      });
    return () => { cancelled = true; };
  }, [brawler.key, rankBracket]);

  const writtenGuide = getBrawlerGuide(brawler.key);
  const generalBuild = writtenGuide?.builds?.General || null;

  const sections = ["overview", "maps", "synergies", "abilities", "guide"];

  return (
    <div className="bm-tap" style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(5,11,20,0.92)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20,
    }} onClick={onClose}>
      <div className="bm-tap" onClick={e => e.stopPropagation()} style={{
        width: "100%", maxWidth: 760, maxHeight: "90vh",
        background: "#0d0d14", border: "1px solid rgba(255,255,255,.1)",
        borderRadius: 16, overflow: "hidden", display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{
          padding: "20px 24px", borderBottom: "1px solid rgba(255,255,255,.1)",
          background: `linear-gradient(135deg, ${brawler.rarityColor}10 0%, transparent 60%)`,
          display: "flex", gap: 16, alignItems: "center",
        }}>
          <BrawlerPortrait brawler={brawler} size={80} />
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <h2 style={{ fontSize: 24, fontWeight: 900, fontFamily: "'Baloo 2', sans-serif", color: "#f8fafc" }}>
                {brawler.name}
              </h2>
              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: `${brawler.rarityColor}20`, color: brawler.rarityColor, border: `1px solid ${brawler.rarityColor}40` }}>
                {brawler.rarity}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <StarRating stars={brawler.stars} size="lg" />
              {/* A hand-written guide and a generated one are very different
                  things behind the same link, so the button says which. */}
              {(() => {
                const written = hasBrawlerGuide(brawler.key || brawler.name);
                return (
                  <button
                    onClick={() => onOpenFullGuide?.(brawler)}
                    title={written
                      ? "Full written guide — build reasoning, video breakdowns and map positioning"
                      : "Overview, live map and mode win rates"}
                    style={{
                      display: "flex", alignItems: "center", gap: 5, border: "none", cursor: "pointer", padding: 0,
                      background: "none", fontSize: 11, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace",
                      letterSpacing: "0.04em", textTransform: "uppercase",
                      color: written ? GUIDE_GOLD : "#c98bff",
                    }}
                  >
                    {written ? "★ Full Written Guide →" : "Stats & Overview →"}
                  </button>
                );
              })()}
            </div>
            <p style={{ fontSize: 12, color: "#8b98ad", marginTop: 6, lineHeight: 1.5, maxWidth: 480 }}>
              {brawler.description?.slice(0, 180)}{brawler.description?.length > 180 ? "…" : ""}
            </p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, textAlign: "center", flexShrink: 0 }}>
            <div style={{ background: "rgba(255,255,255,.04)", borderRadius: 14, padding: "8px 16px", border: "1px solid rgba(255,255,255,.1)" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#10b981" }}>{brawler.winRate}%</div>
              <div style={{ fontSize: 10.5, color: "#7c8aa3", letterSpacing: "0.06em" }}>WIN RATE</div>
            </div>
            <div style={{ background: "rgba(255,255,255,.04)", borderRadius: 14, padding: "8px 16px", border: "1px solid rgba(255,255,255,.1)" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#3b82f6" }}>{brawler.pickRate}%</div>
              <div style={{ fontSize: 10.5, color: "#7c8aa3", letterSpacing: "0.06em" }}>PICK RATE</div>
            </div>
            <div style={{ background: "rgba(255,255,255,.04)", borderRadius: 14, padding: "8px 16px", border: "1px solid rgba(255,255,255,.1)", gridColumn: "1/-1" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#ffb43d" }}>{brawler.picks}</div>
              <div style={{ fontSize: 10.5, color: "#7c8aa3", letterSpacing: "0.06em" }}>TOTAL PICKS</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444", borderRadius: 8, padding: 6, cursor: "pointer", alignSelf: "flex-start" }}>
            <X size={16} />
          </button>
        </div>

        {/* Section tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,.1)", padding: "0 24px" }}>
          {sections.map(s => (
            <button key={s} onClick={() => setActiveSection(s)} style={{
              padding: "10px 16px", background: "none", border: "none",
              borderBottom: activeSection === s ? "2px solid #ffb43d" : "2px solid transparent",
              color: activeSection === s ? "#ffb43d" : "#8b98ad",
              fontSize: 12, fontWeight: 700, cursor: "pointer", textTransform: "capitalize",
              letterSpacing: "0.04em",
            }}>{s}</button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>

          {activeSection === "overview" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {/* The recommended loadout, for brawlers we've written one for.
                  It's the first thing most people open a brawler to find. */}
              {generalBuild && (
                <div>
                  <h3 style={sectionTitle}>Best Build</h3>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                    {[
                      { kind: "STAR POWER", name: generalBuild.starPower, color: "#ffb43d",
                        img: iconOverride(brawler.key, generalBuild.starPower) || brawler.starPowers?.find(x => x.name === generalBuild.starPower)?.img },
                      { kind: "GADGET", name: generalBuild.gadget, color: "#c98bff",
                        img: iconOverride(brawler.key, generalBuild.gadget) || brawler.gadgets?.find(x => x.name === generalBuild.gadget)?.img },
                      ...(generalBuild.gears || []).map(g => ({ kind: "GEAR", name: `${g} Gear`, color: "#8ee6b0", img: GEAR_ICONS[g] })),
                    ].filter(x => x.name).map((x, i) => (
                      <div key={i} title={`${x.kind} · ${x.name}`} style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 12,
                        background: "rgba(255,255,255,.04)", border: `1px solid ${x.color}33`,
                      }}>
                        {x.img && <img src={x.img} alt="" style={{ width: 26, height: 26, objectFit: "contain", flexShrink: 0 }} />}
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 10.5, letterSpacing: "0.1em", color: x.color, fontFamily: "'JetBrains Mono', monospace" }}>{x.kind}</div>
                          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#e2e8f0" }}>{x.name}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {generalBuild.note && (
                    <p style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.55, marginTop: 10 }}>{generalBuild.note}</p>
                  )}
                </div>
              )}

              <div>
                <h3 style={sectionTitle}>Performance by Mode</h3>
                {modeStats.length === 0 && <p style={emptyText}>Not enough data across modes.</p>}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8, marginTop: 10 }}>
                  {modeStats.map(m => (
                    <div key={m.mode} style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 14, padding: 12 }}>
                      <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>{FORMAT_MODE(m.mode)}</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: m.winRate >= 52 ? "#10b981" : m.winRate >= 48 ? "#ffb43d" : "#ef4444" }}>
                        {m.winRate}%
                      </div>
                      <div style={{ fontSize: 10, color: "#7c8aa3" }}>{m.picks} picks</div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 style={sectionTitle}>Best Maps</h3>
                {mapStats.length === 0 && <p style={emptyText}>Not enough map data.</p>}
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
                  {mapStats.slice(0, 8).map(m => (
                    <div key={m.map} style={{ display: "flex", alignItems: "center", gap: 12, background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 14, padding: "8px 12px" }}>
                      <Map size={12} color="#7c8aa3" />
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#cbd5e1" }}>{m.map}</span>
                      <span style={{ fontSize: 10, color: "#8b98ad" }}>{FORMAT_MODE(m.mode)}</span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: m.winRate >= 52 ? "#10b981" : m.winRate >= 48 ? "#ffb43d" : "#ef4444", minWidth: 44, textAlign: "right" }}>
                        {m.winRate}%
                      </span>
                      <span style={{ fontSize: 10, color: "#7c8aa3", minWidth: 52, textAlign: "right" }}>{m.picks} picks</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeSection === "maps" && (
            <div>
              <h3 style={sectionTitle}>Win Rate on Every Map</h3>
              {mapStats.length === 0 && <p style={emptyText}>Not enough map data (minimum {MIN_PICKS_MAP} picks per map).</p>}
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
                {mapStats.map(m => {
                  const pct = Math.max(0, Math.min(100, (m.winRate - 40) / 25 * 100));
                  return (
                    <div key={m.map} style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 14, padding: "10px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{m.map}</span>
                        <span style={{ fontSize: 10, color: "#7c8aa3" }}>{FORMAT_MODE(m.mode)} · {m.picks} picks</span>
                        <span style={{ fontSize: 14, fontWeight: 800, color: m.winRate >= 55 ? "#10b981" : m.winRate >= 50 ? "#ffb43d" : "#ef4444" }}>
                          {m.winRate}%
                        </span>
                      </div>
                      <div style={{ height: 4, background: "rgba(255,255,255,.1)", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: m.winRate >= 55 ? "#10b981" : m.winRate >= 50 ? "#ffb43d" : "#ef4444", borderRadius: 2, transition: "width 0.5s ease" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeSection === "synergies" && (
            pairs.loading ? (
              <div style={{ textAlign: "center", padding: "40px 20px", color: "#7c8aa3" }}>
                <Users size={32} style={{ marginBottom: 12, opacity: 0.4 }} />
                <p style={{ fontSize: 13, fontWeight: 600, color: "#8b98ad" }}>Loading match-up data…</p>
              </div>
            ) : (pairs.with.length === 0 && pairs.vs.length === 0) ? (
              <div style={{ textAlign: "center", padding: "40px 20px", color: "#7c8aa3" }}>
                <Users size={32} style={{ marginBottom: 12, opacity: 0.4 }} />
                <p style={{ fontSize: 13, fontWeight: 600, color: "#8b98ad", marginBottom: 6 }}>Not enough pair data yet</p>
                <p style={{ fontSize: 12 }}>{brawler.name} has no teammate or opponent pairing with 300+ games in this bracket.</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                {pairs.with.length > 0 && (
                  <div>
                    <h3 style={sectionTitle}>Best Teammates</h3>
                    <p style={{ ...emptyText, marginTop: 4, marginBottom: 10 }}>Highest win rate playing alongside {brawler.name} — min 300 games.</p>
                    {pairs.with.map(p => <PairRow key={p.key} entry={p} color="#10b981" />)}
                  </div>
                )}
                {pairs.vs.length > 0 && (
                  <div>
                    <h3 style={sectionTitle}>Worst Opponents</h3>
                    <p style={{ ...emptyText, marginTop: 4, marginBottom: 10 }}>{brawler.name}'s lowest win rates against — min 300 games.</p>
                    {pairs.vs.map(p => <PairRow key={p.key} entry={p} color="#ef4444" />)}
                  </div>
                )}
              </div>
            )
          )}

          {activeSection === "abilities" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {brawler.starPowers?.length > 0 && (
                <div>
                  <h3 style={sectionTitle}>Star Powers</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                    {brawler.starPowers.map((sp, i) => (
                      <AbilityCard key={i} name={sp.name} desc={sp.desc} img={iconOverride(brawler.key, sp.name) || sp.img} color="#ffb43d" />
                    ))}
                  </div>
                </div>
              )}
              {brawler.gadgets?.length > 0 && (
                <div>
                  <h3 style={sectionTitle}>Gadgets</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                    {brawler.gadgets.map((g, i) => (
                      <AbilityCard key={i} name={g.name} desc={g.desc} img={iconOverride(brawler.key, g.name) || g.img} color="#c98bff" />
                    ))}
                  </div>
                </div>
              )}
              {!brawler.starPowers?.length && !brawler.gadgets?.length && (
                <p style={emptyText}>No ability data available.</p>
              )}
            </div>
          )}

          {/* A brawler with a full written guide gets a real preview and a way
              into it. It used to say "Guide coming soon" on Surge, whose guide
              has four tabs and fifteen clips — brawler.guide reads the legacy
              brawlerGuides.json, which only ever had one entry. */}
          {activeSection === "guide" && (
            writtenGuide
              ? <WrittenGuidePreview brawler={brawler} guide={writtenGuide} onOpen={() => onOpenFullGuide?.(brawler)} />
              : <GuideSection guide={brawler.guide} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Full-page brawler guide (quick info + abilities + in-depth guide) ────────
// The full brawler guide page lives in its own module (recreated from the
// Claude Design handoff). Re-exported here so existing imports keep working.
export { default as BrawlerGuidePage } from "./BrawlerGuidePage";

function SynergyRow({ brawler, color }) {
  const [imgErr, setImgErr] = useState(false);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 14, marginBottom: 6 }}>
      <div style={{ width: 32, height: 32, borderRadius: 6, overflow: "hidden", background: `${brawler.rarityColor}20`, border: `1.5px solid ${brawler.rarityColor}50`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {!imgErr && brawler.imageUrl
          ? <img src={brawler.imageUrl} alt={brawler.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={() => setImgErr(true)} />
          : <span style={{ fontSize: 10.5, fontWeight: 800, color: brawler.rarityColor }}>{brawler.name.slice(0, 2).toUpperCase()}</span>
        }
      </div>
      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#cbd5e1" }}>{brawler.name}</span>
      <span style={{ fontSize: 13, fontWeight: 800, color }}>{brawler.winRate}%</span>
      <span style={{ fontSize: 10, color: "#7c8aa3" }}>{brawler.picks}g</span>
    </div>
  );
}

// One live pair row in the modal's Synergies tab. Art and display name come
// from BRAWLER_META so a key like "8-BIT" renders as the real brawler.
function PairRow({ entry, color }) {
  const meta = BRAWLER_META[entry.key] || {};
  const name = entry.key.toLowerCase().replace(/[a-z]+/g, w => w.charAt(0).toUpperCase() + w.slice(1));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 14, marginBottom: 6 }}>
      <div style={{ width: 32, height: 32, borderRadius: 6, overflow: "hidden", background: `${meta.rarityColor || "#94a3b8"}20`, flexShrink: 0 }}>
        {meta.imageUrl && <img src={meta.imageUrl} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
      </div>
      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#cbd5e1" }}>{name}</span>
      <span style={{ fontSize: 13, fontWeight: 800, color }}>{entry.winRate}%</span>
      <span style={{ fontSize: 10, color: "#7c8aa3", minWidth: 46, textAlign: "right" }}>{entry.picks.toLocaleString("en-US")}g</span>
    </div>
  );
}

// Shown in place of "Guide coming soon" for brawlers that actually have one.
// Lists what's in the guide and links to it rather than duplicating it here.
function WrittenGuidePreview({ brawler, guide, onOpen }) {
  const tabs = (guide.guideTabs || []).map(t => t.label);
  const clips = new Set();
  for (const t of guide.guideTabs || [])
    for (const tip of t.tips || [])
      for (const v of [...(tip.videos || []), ...(tip.noteVideos || [])]) if (v.src) clips.add(v.src);
  for (const list of Object.values(guide.mapVideos || {})) for (const v of list) if (v.src) clips.add(v.src);
  for (const list of Object.values(guide.modeVideos || {})) for (const v of list) if (v.src) clips.add(v.src);
  const mapNotes = Object.keys(guide.mapNotes || {}).length;

  const Bullet = ({ children }) => (
    <li style={{ fontSize: 12.5, color: "#94a3b8", lineHeight: 1.7 }}>{children}</li>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <h3 style={sectionTitle}>★ Full written guide</h3>
        <p style={{ fontSize: 12.5, color: "#94a3b8", lineHeight: 1.6, marginTop: 8 }}>
          {brawler.name} has a complete hand-written guide — not generated copy.
        </p>
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 2 }}>
        {tabs.length > 0 && <Bullet><strong style={{ color: "#e2e8f0" }}>{tabs.length} sections</strong> — {tabs.join(", ")}</Bullet>}
        {clips.size > 0 && <Bullet><strong style={{ color: "#e2e8f0" }}>{clips.size} gameplay clips</strong> with do/don't breakdowns</Bullet>}
        {mapNotes > 0 && <Bullet><strong style={{ color: "#e2e8f0" }}>{mapNotes} map notes</strong> — where to play on every ranked map</Bullet>}
        {guide.combatStats?.length > 0 && <Bullet>Combat stats at every power level, and a full build breakdown</Bullet>}
        {guide.counterTips?.length > 0 && <Bullet>How to counter {brawler.name}</Bullet>}
      </ul>
      <button onClick={onOpen} style={{
        alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
        padding: "10px 18px", borderRadius: 999, background: "rgba(255,180,61,.14)",
        border: "1px solid rgba(255,180,61,.45)", color: GUIDE_GOLD,
        fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, fontWeight: 700, letterSpacing: "0.04em",
      }}>OPEN THE FULL GUIDE →</button>
    </div>
  );
}

function AbilityCard({ name, desc, img, color }) {
  return (
    <div style={{ display: "flex", gap: 12, padding: 12, background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 14, alignItems: "flex-start" }}>
      {img && (
        <img src={img} alt={name} style={{ width: 40, height: 40, objectFit: "contain", flexShrink: 0, borderRadius: 6 }}
          onError={e => { e.target.style.display = "none"; }} />
      )}
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color, marginBottom: 4 }}>{name}</div>
        <div style={{ fontSize: 12, color: "#8b98ad", lineHeight: 1.5 }}>{desc?.replace(/<[^>]*>/g, "") || "—"}</div>
      </div>
    </div>
  );
}

const sectionTitle = { fontSize: 13, fontWeight: 800, color: "#94a3b8", letterSpacing: "0.08em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 };
const emptyText = { fontSize: 12, color: "#7c8aa3" };

function GuideSection({ guide }) {
  const [lightbox, setLightbox] = useState(null);
  const hasTips = guide?.tips?.length > 0;
  const hasScreenshots = guide?.screenshots?.length > 0;
  const videoUrl = guide?.videoUrl || null;

  if (!hasTips && !hasScreenshots && !videoUrl) {
    return (
      <div style={{ textAlign: "center", padding: "40px 20px", color: "#7c8aa3" }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: "#8b98ad", marginBottom: 6 }}>Guide coming soon</p>
        <p style={{ fontSize: 12 }}>An in-depth write-up with screenshots and video is on the way for this brawler.</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {videoUrl && (
        <div>
          <h3 style={sectionTitle}>Video Guide</h3>
          <video
            src={videoUrl}
            controls
            playsInline
            style={{ width: "100%", borderRadius: 10, border: "1px solid rgba(255,255,255,.1)", marginTop: 10, background: "#000" }}
          />
        </div>
      )}

      {hasTips && (
        <div>
          <h3 style={sectionTitle}>Tips & Tricks</h3>
          <ul style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8, paddingLeft: 18 }}>
            {guide.tips.map((tip, i) => (
              <li key={i} style={{ fontSize: 13, color: "#cbd5e1", lineHeight: 1.6 }}>{tip}</li>
            ))}
          </ul>
        </div>
      )}

      {hasScreenshots && (
        <div>
          <h3 style={sectionTitle}>Screenshots</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10, marginTop: 10 }}>
            {guide.screenshots.map((src, i) => (
              <img
                key={i}
                src={src}
                alt={`Guide screenshot ${i + 1}`}
                onClick={() => setLightbox(src)}
                style={{ width: "100%", height: 100, objectFit: "cover", borderRadius: 8, border: "1px solid rgba(255,255,255,.1)", cursor: "pointer" }}
                onError={e => { e.target.style.display = "none"; }}
              />
            ))}
          </div>
        </div>
      )}

      {lightbox && (
        <div className="bm-tap"
          onClick={() => setLightbox(null)}
          style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, cursor: "zoom-out" }}
        >
          <img src={lightbox} alt="Screenshot enlarged" style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 8 }} />
        </div>
      )}
    </div>
  );
}

// ─── Main brawlers page ───────────────────────────────────────────────────────
export default function BrawlersPage({ brawlerStats, loading, error, rankBracket }) {
  const navigate = useNavigate();
  const [tierMode, setTierMode] = useState("general");
  const [selectedBrawler, setSelectedBrawler] = useState(null);

  const { brawlers, byMode, byMap, totalPicks } = useMemo(
    () => computeStatsFromAggregated(brawlerStats || [], rankBracket),
    [brawlerStats, rankBracket]
  );

  // Modes that actually have data, in canonical order
  const tierModes = useMemo(() => {
    const present = new Set(Object.keys(byMode));
    return ["general", ...MODE_ORDER.filter(m => present.has(m))];
  }, [byMode]);

  // Quick lookup of a brawler's live overall stats (for the hardcoded General tab)
  const brawlerByKey = useMemo(() => {
    const m = {};
    for (const b of brawlers) m[b.key] = b;
    return m;
  }, [brawlers]);

  // Build tier -> [brawlers sorted by win rate desc] for the active mode
  const tierRows = useMemo(() => {
    const rows = {};
    for (const t of TIERS) rows[t.id] = [];

    if (tierMode === "general") {
      for (const t of TIERS) {
        const keys = GENERAL_TIER_LIST[t.id] || [];
        rows[t.id] = keys.map(key => {
          const k = key.toUpperCase().trim();
          const live = brawlerByKey[k];
          const meta = BRAWLER_META[k] || {};
          return {
            key: k,
            name: FORMAT_NAME(k),
            winRate: live?.winRate ?? null,
            picks: live?.picks ?? 0,
            imageUrl: meta.imageUrl || null,
            rarityColor: meta.rarityColor || "#94a3b8",
            class: meta.class || "Unknown",
          };
        });
      }
      return rows;
    }

    const modeData = byMode[tierMode] || {};
    const entries = Object.entries(modeData)
      .filter(([, s]) => s.picks >= MIN_PICKS_TIER)
      .map(([key, s]) => {
        const wr = Math.round((s.wins / s.picks) * 1000) / 10;
        const meta = BRAWLER_META[key] || {};
        return {
          key, name: FORMAT_NAME(key), winRate: wr, picks: s.picks,
          imageUrl: meta.imageUrl || null,
          rarityColor: meta.rarityColor || "#94a3b8",
          class: meta.class || "Unknown",
        };
      });

    for (const b of entries) rows[tierForWinRate(b.winRate).id].push(b);
    for (const t of TIERS) rows[t.id].sort((a, b) => b.winRate - a.winRate);
    return rows;
  }, [tierMode, byMode, brawlerByKey]);

  const selectedBrawlerFull = useMemo(() =>
    selectedBrawler ? brawlers.find(b => b.key === selectedBrawler.key) || selectedBrawler : null,
    [selectedBrawler, brawlers]);

  const totalRanked = TIERS.reduce((sum, t) => sum + tierRows[t.id].length, 0);

  if (loading) return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 300, color: "#7c8aa3", fontSize: 13 }}>
      Computing brawler ratings…
    </div>
  );

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#8a7fa6", letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace", marginBottom: 6 }}>
          02 / Meta Tier List
        </div>
        <h2 style={{ fontSize: 30, fontWeight: 900, fontFamily: "'Baloo 2', sans-serif", color: "#f8fafc", marginBottom: 4 }}>
          Draft power rankings
        </h2>
        <p style={{ fontSize: 12, color: "#8b98ad" }}>
          {tierMode === "general"
            ? "Hand-curated general meta ranking across all ranked modes."
            : <>Ranked by win rate on <span style={{ color: "#c98bff" }}>{FORMAT_MODE(tierMode)}</span> · {rankBracket === "masters_legendary" ? "Masters & Legendary" : "Diamond & Mythic"} · min {MIN_PICKS_TIER} games</>}
        </p>
      </div>

      {/* Mode tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
        {tierModes.map(m => {
          const active = tierMode === m;
          return (
            <button key={m} onClick={() => setTierMode(m)}
              style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid", fontSize: 11, fontWeight: 700, cursor: "pointer",
                fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.04em", textTransform: "uppercase",
                background: active ? "rgba(168,85,247,0.14)" : "#12121b",
                borderColor: active ? "rgba(168,85,247,0.45)" : "rgba(255,255,255,.1)",
                color: active ? "#e9d5ff" : "#7c7490",
              }}>
              {m === "general" ? "General" : FORMAT_MODE(m)}
            </button>
          );
        })}
      </div>

      {/* Tier rows */}
      {tierMode !== "general" && totalRanked === 0 ? (
        <div style={{ textAlign: "center", color: "#7c8aa3", fontSize: 13, padding: 40 }}>
          Not enough data for this mode yet (min {MIN_PICKS_TIER} games per brawler).
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {TIERS.map(t => (
            <div key={t.id} style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
              {/* Tier label box */}
              <div style={{
                width: 60, flexShrink: 0, borderRadius: 16, background: t.bg, border: `1px solid ${t.border}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 22, fontWeight: 900, fontFamily: "'Baloo 2', sans-serif", color: t.color,
              }}>
                {t.id}
              </div>
              {/* Brawler chips */}
              <div style={{
                flex: 1, minHeight: 60, borderRadius: 16, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)",
                padding: 8, display: "flex", flexWrap: "wrap", gap: 6, alignContent: "flex-start",
              }}>
                {tierRows[t.id].length === 0 ? (
                  <span style={{ fontSize: 11, color: "#3f3654", alignSelf: "center", paddingLeft: 6 }}>—</span>
                ) : (
                  tierRows[t.id].map(b => (
                    <TierChip key={b.key} brawler={b} onClick={() => setSelectedBrawler(b)} />
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail modal */}
      {selectedBrawlerFull && (
        <BrawlerDetail
          brawler={selectedBrawlerFull}
          byMode={byMode}
          byMap={byMap}
          rankBracket={rankBracket}
          onClose={() => setSelectedBrawler(null)}
          onOpenFullGuide={(b) => { setSelectedBrawler(null); navigate(`/brawlers/${slugifyBrawlerKey(b.key)}`); }}
        />
      )}
    </div>
  );
}

function TierChip({ brawler, onClick }) {
  return (
    <button onClick={onClick} title={brawler.winRate != null ? `${brawler.name} · ${brawler.winRate}% WR · ${brawler.picks} picks` : brawler.name}
      style={{
        display: "flex", alignItems: "center", gap: 7, padding: "5px 12px 5px 5px",
        background: "rgba(255,255,255,.05)", border: `1px solid ${brawler.rarityColor}44`, borderRadius: 999, cursor: "pointer",
      }}>
      <BrawlerPortrait brawler={brawler} size={30} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.15 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>
          {brawler.name}
          {hasBrawlerGuide(brawler.key || brawler.name) && <GuideBadge compact />}
        </span>
        <span style={{ fontSize: 10, color: brawler.winRate != null ? (brawler.winRate >= 52 ? "#34d399" : brawler.winRate >= 48 ? "#ffc663" : "#f87171") : "#8b98ad" }}>
          {brawler.winRate != null ? `${brawler.winRate}%` : "—"}
        </span>
      </div>
    </button>
  );
}

function BrawlerCard({ brawler, onClick }) {
  const starColor = brawler.stars >= 6 ? "#ffb43d" : brawler.stars >= 4 ? "#60a5fa" : brawler.stars >= 2 ? "#94a3b8" : "#ef4444";
  return (
    <div className="bm-tap" onClick={onClick} style={{
      background: "#12121b", border: `1px solid ${brawler.rarityColor}30`,
      borderRadius: 12, overflow: "hidden", cursor: "pointer",
      transition: "transform 0.15s, box-shadow 0.15s",
      position: "relative",
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 8px 24px ${brawler.rarityColor}20`; }}
      onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; }}
    >
      {/* Portrait */}
      <div style={{ height: 120, background: `linear-gradient(135deg, ${brawler.rarityColor}15 0%, #08080c 100%)`, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
        <BrawlerPortrait brawler={brawler} size={80} />
        {/* Stars badge */}
        {brawler.stars !== null && (
          <div style={{ position: "absolute", top: 8, right: 8, background: "rgba(5,11,20,0.8)", borderRadius: 6, padding: "2px 6px", display: "flex", alignItems: "center", gap: 2 }}>
            <Star size={10} fill={starColor} color={starColor} />
            <span style={{ fontSize: 11, fontWeight: 800, color: starColor }}>{brawler.stars?.toFixed(1)}</span>
          </div>
        )}
        {/* Full-guide marker — top LEFT, since the stars badge owns top right */}
        {hasBrawlerGuide(brawler.key || brawler.name) && (
          <div style={{ position: "absolute", top: 8, left: 8 }}><GuideBadge /></div>
        )}
        {/* Rarity strip */}
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2, background: brawler.rarityColor }} />
      </div>

      {/* Info */}
      <div style={{ padding: "10px 12px" }}>
        <div style={{ fontSize: 14, fontWeight: 800, fontFamily: "'Baloo 2', sans-serif", color: "#f8fafc", marginBottom: 2 }}>{brawler.name}</div>
        <div style={{ fontSize: 10, color: brawler.rarityColor, marginBottom: 8 }}>{brawler.rarity}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <div style={{ background: "#08080c", borderRadius: 6, padding: "5px 8px", textAlign: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: brawler.winRate >= 52 ? "#10b981" : brawler.winRate >= 48 ? "#ffb43d" : "#ef4444" }}>
              {brawler.winRate}%
            </div>
            <div style={{ fontSize: 10, color: "#7c8aa3", letterSpacing: "0.06em" }}>WIN RATE</div>
          </div>
          <div style={{ background: "#08080c", borderRadius: 6, padding: "5px 8px", textAlign: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#3b82f6" }}>{brawler.pickRate}%</div>
            <div style={{ fontSize: 10, color: "#7c8aa3", letterSpacing: "0.06em" }}>PICK RATE</div>
          </div>
        </div>
      </div>
    </div>
  );
}
