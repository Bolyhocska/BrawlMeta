import { useState, useMemo } from "react";
import { Star, Users, Map, X } from "lucide-react";
import BRAWLER_META from "./data/brawlerMeta.json";
import BRAWLER_GUIDES from "./data/brawlerGuides.json";
import GENERAL_TIER_LIST from "./data/generalTierList.json";

const RARITY_ORDER = ["Trophy Road", "Rare", "Super Rare", "Epic", "Mythic", "Legendary", "Ultra Legendary"];

const MIN_PICKS_OVERALL = 10;
const MIN_PICKS_MAP = 3;
const MIN_PICKS_TIER = 15; // minimum picks for a brawler to appear in a mode tier list

// Tier bands by win rate (%). First tier whose `min` is met wins.
const TIERS = [
  { id: "S+", color: "#fbbf24", bg: "rgba(251,191,36,0.14)", border: "rgba(251,191,36,0.45)", min: 57 },
  { id: "S",  color: "#f59e0b", bg: "rgba(245,158,11,0.13)", border: "rgba(245,158,11,0.40)", min: 54 },
  { id: "A",  color: "#a855f7", bg: "rgba(168,85,247,0.13)", border: "rgba(168,85,247,0.40)", min: 52 },
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
  name.toLowerCase().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

// Convert win rate (0-100) to 1-7 star rating
// 50% = 3.5 stars baseline, each ~3% above/below = 1 star
function toStars(winRate, pickRate, totalPicks, picks) {
  if (!picks || picks < MIN_PICKS_OVERALL) return null;
  const wr = winRate;
  const prBonus = Math.min(pickRate / 5, 0.5); // small bonus for high pick rate
  const raw = ((wr - 44) / (60 - 44)) * 6 + 1 + prBonus;
  return Math.min(7, Math.max(1, Math.round(raw * 2) / 2)); // round to 0.5
}

function computeStatsFromAggregated(rows, rankBracket) {
  const overall = rows.filter(r => r.rank_bracket === rankBracket && r.map === null);
  const mapRows = rows.filter(r => r.rank_bracket === rankBracket && r.map !== null);

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
  if (stars === null || stars === undefined) return <span style={{ fontSize: 10, color: "#475569" }}>—</span>;
  const sz = size === "sm" ? 10 : size === "lg" ? 18 : 13;
  return (
    <div style={{ display: "flex", gap: 1, alignItems: "center" }}>
      {[1, 2, 3, 4, 5, 6, 7].map(i => {
        const filled = stars >= i;
        const half = !filled && stars >= i - 0.5;
        const color = stars >= 6 ? "#f59e0b" : stars >= 4 ? "#60a5fa" : stars >= 2 ? "#94a3b8" : "#ef4444";
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

// ─── Brawler portrait ─────────────────────────────────────────────────────────
function BrawlerPortrait({ brawler, size = 56, onClick }) {
  const [imgErr, setImgErr] = useState(false);
  return (
    <div
      onClick={onClick}
      style={{
        width: size, height: size, borderRadius: size * 0.18,
        background: imgErr || !brawler.imageUrl ? `${brawler.rarityColor}20` : "transparent",
        border: `2px solid ${brawler.rarityColor}60`,
        overflow: "hidden", cursor: onClick ? "pointer" : "default",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {!imgErr && brawler.imageUrl ? (
        <img src={brawler.imageUrl} alt={brawler.name} style={{ width: "100%", height: "100%", objectFit: "cover" }}
          onError={() => setImgErr(true)} />
      ) : (
        <span style={{ fontSize: size * 0.22, fontWeight: 800, color: brawler.rarityColor }}>
          {brawler.name.slice(0, 2).toUpperCase()}
        </span>
      )}
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

function BrawlerDetail({ brawler, byMode, byMap, onClose, onOpenFullGuide }) {
  const [activeSection, setActiveSection] = useState("overview");
  const { mapStats, modeStats } = useMapModeStats(brawler, byMode, byMap);

  const sections = ["overview", "maps", "synergies", "abilities", "guide"];

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(5,11,20,0.92)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "100%", maxWidth: 760, maxHeight: "90vh",
        background: "#0f0b18", border: "1px solid #2c2140",
        borderRadius: 16, overflow: "hidden", display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{
          padding: "20px 24px", borderBottom: "1px solid #2c2140",
          background: `linear-gradient(135deg, ${brawler.rarityColor}10 0%, transparent 60%)`,
          display: "flex", gap: 16, alignItems: "center",
        }}>
          <BrawlerPortrait brawler={brawler} size={80} />
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <h2 style={{ fontSize: 24, fontWeight: 900, fontFamily: "'Barlow Condensed', sans-serif", color: "#f8fafc" }}>
                {brawler.name}
              </h2>
              <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: `${brawler.rarityColor}20`, color: brawler.rarityColor, border: `1px solid ${brawler.rarityColor}40` }}>
                {brawler.rarity}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <StarRating stars={brawler.stars} size="lg" />
              <button
                onClick={() => onOpenFullGuide?.(brawler)}
                style={{
                  display: "flex", alignItems: "center", gap: 4, background: "none", border: "none",
                  color: "#c084fc", fontSize: 11, fontWeight: 700, fontFamily: "'Space Mono', monospace",
                  letterSpacing: "0.04em", textTransform: "uppercase", cursor: "pointer", padding: 0,
                }}
              >
                Full Guide →
              </button>
            </div>
            <p style={{ fontSize: 12, color: "#64748b", marginTop: 6, lineHeight: 1.5, maxWidth: 480 }}>
              {brawler.description?.slice(0, 180)}{brawler.description?.length > 180 ? "…" : ""}
            </p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, textAlign: "center", flexShrink: 0 }}>
            <div style={{ background: "#150f22", borderRadius: 8, padding: "8px 16px", border: "1px solid #2c2140" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#10b981" }}>{brawler.winRate}%</div>
              <div style={{ fontSize: 9, color: "#475569", letterSpacing: "0.06em" }}>WIN RATE</div>
            </div>
            <div style={{ background: "#150f22", borderRadius: 8, padding: "8px 16px", border: "1px solid #2c2140" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#3b82f6" }}>{brawler.pickRate}%</div>
              <div style={{ fontSize: 9, color: "#475569", letterSpacing: "0.06em" }}>PICK RATE</div>
            </div>
            <div style={{ background: "#150f22", borderRadius: 8, padding: "8px 16px", border: "1px solid #2c2140", gridColumn: "1/-1" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#f59e0b" }}>{brawler.picks}</div>
              <div style={{ fontSize: 9, color: "#475569", letterSpacing: "0.06em" }}>TOTAL PICKS</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444", borderRadius: 8, padding: 6, cursor: "pointer", alignSelf: "flex-start" }}>
            <X size={16} />
          </button>
        </div>

        {/* Section tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid #2c2140", padding: "0 24px" }}>
          {sections.map(s => (
            <button key={s} onClick={() => setActiveSection(s)} style={{
              padding: "10px 16px", background: "none", border: "none",
              borderBottom: activeSection === s ? "2px solid #f59e0b" : "2px solid transparent",
              color: activeSection === s ? "#f59e0b" : "#64748b",
              fontSize: 12, fontWeight: 700, cursor: "pointer", textTransform: "capitalize",
              letterSpacing: "0.04em",
            }}>{s}</button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>

          {activeSection === "overview" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div>
                <h3 style={sectionTitle}>Performance by Mode</h3>
                {modeStats.length === 0 && <p style={emptyText}>Not enough data across modes.</p>}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8, marginTop: 10 }}>
                  {modeStats.map(m => (
                    <div key={m.mode} style={{ background: "#150f22", border: "1px solid #2c2140", borderRadius: 8, padding: 12 }}>
                      <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>{FORMAT_MODE(m.mode)}</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: m.winRate >= 52 ? "#10b981" : m.winRate >= 48 ? "#f59e0b" : "#ef4444" }}>
                        {m.winRate}%
                      </div>
                      <div style={{ fontSize: 10, color: "#475569" }}>{m.picks} picks</div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h3 style={sectionTitle}>Best Maps</h3>
                {mapStats.length === 0 && <p style={emptyText}>Not enough map data.</p>}
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
                  {mapStats.slice(0, 8).map(m => (
                    <div key={m.map} style={{ display: "flex", alignItems: "center", gap: 12, background: "#150f22", border: "1px solid #2c2140", borderRadius: 8, padding: "8px 12px" }}>
                      <Map size={12} color="#475569" />
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#cbd5e1" }}>{m.map}</span>
                      <span style={{ fontSize: 10, color: "#64748b" }}>{FORMAT_MODE(m.mode)}</span>
                      <span style={{ fontSize: 13, fontWeight: 800, color: m.winRate >= 52 ? "#10b981" : m.winRate >= 48 ? "#f59e0b" : "#ef4444", minWidth: 44, textAlign: "right" }}>
                        {m.winRate}%
                      </span>
                      <span style={{ fontSize: 10, color: "#475569", minWidth: 52, textAlign: "right" }}>{m.picks} picks</span>
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
                    <div key={m.map} style={{ background: "#150f22", border: "1px solid #2c2140", borderRadius: 8, padding: "10px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{m.map}</span>
                        <span style={{ fontSize: 10, color: "#475569" }}>{FORMAT_MODE(m.mode)} · {m.picks} picks</span>
                        <span style={{ fontSize: 14, fontWeight: 800, color: m.winRate >= 55 ? "#10b981" : m.winRate >= 50 ? "#f59e0b" : "#ef4444" }}>
                          {m.winRate}%
                        </span>
                      </div>
                      <div style={{ height: 4, background: "#2c2140", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: m.winRate >= 55 ? "#10b981" : m.winRate >= 50 ? "#f59e0b" : "#ef4444", borderRadius: 2, transition: "width 0.5s ease" }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {activeSection === "synergies" && (
            <div style={{ textAlign: "center", padding: "40px 20px", color: "#475569" }}>
              <Users size={32} style={{ marginBottom: 12, opacity: 0.4 }} />
              <p style={{ fontSize: 13, fontWeight: 600, color: "#64748b", marginBottom: 6 }}>Synergy data coming soon</p>
              <p style={{ fontSize: 12 }}>Teammate & counter stats require per-matchup aggregation which will be added in the next update.</p>
            </div>
          )}

          {activeSection === "abilities" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {brawler.starPowers?.length > 0 && (
                <div>
                  <h3 style={sectionTitle}>Star Powers</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                    {brawler.starPowers.map((sp, i) => (
                      <AbilityCard key={i} name={sp.name} desc={sp.desc} img={sp.img} color="#f59e0b" />
                    ))}
                  </div>
                </div>
              )}
              {brawler.gadgets?.length > 0 && (
                <div>
                  <h3 style={sectionTitle}>Gadgets</h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                    {brawler.gadgets.map((g, i) => (
                      <AbilityCard key={i} name={g.name} desc={g.desc} img={g.img} color="#a78bfa" />
                    ))}
                  </div>
                </div>
              )}
              {!brawler.starPowers?.length && !brawler.gadgets?.length && (
                <p style={emptyText}>No ability data available.</p>
              )}
            </div>
          )}

          {activeSection === "guide" && (
            <GuideSection guide={brawler.guide} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Full-page brawler guide (quick info + abilities + in-depth guide) ────────
function BrawlerGuidePage({ brawler, byMode, byMap, onBack }) {
  const { mapStats, modeStats } = useMapModeStats(brawler, byMode, byMap);

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <button
        onClick={onBack}
        style={{
          display: "flex", alignItems: "center", gap: 6, background: "none", border: "none",
          color: "#8a7fa6", fontSize: 11, fontWeight: 700, fontFamily: "'Space Mono', monospace",
          letterSpacing: "0.04em", textTransform: "uppercase", cursor: "pointer", padding: 0, marginBottom: 20,
        }}
      >
        ← Back to Tier List
      </button>

      {/* Quick info header */}
      <div style={{
        display: "flex", gap: 20, alignItems: "center", padding: 24, borderRadius: 14,
        background: `linear-gradient(135deg, ${brawler.rarityColor}12 0%, transparent 60%)`,
        border: "1px solid #2c2140", marginBottom: 24,
      }}>
        <BrawlerPortrait brawler={brawler} size={100} />
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <h1 style={{ fontSize: 32, fontWeight: 900, fontFamily: "'Barlow Condensed', sans-serif", color: "#f8fafc" }}>
              {brawler.name}
            </h1>
            <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 20, background: `${brawler.rarityColor}20`, color: brawler.rarityColor, border: `1px solid ${brawler.rarityColor}40` }}>
              {brawler.rarity}
            </span>
          </div>
          <StarRating stars={brawler.stars} size="lg" />
          <p style={{ fontSize: 13, color: "#94a3b8", marginTop: 10, lineHeight: 1.6, maxWidth: 560 }}>
            {brawler.description}
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, textAlign: "center", flexShrink: 0 }}>
          <div style={{ background: "#150f22", borderRadius: 8, padding: "10px 18px", border: "1px solid #2c2140" }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#10b981" }}>{brawler.winRate}%</div>
            <div style={{ fontSize: 9, color: "#475569", letterSpacing: "0.06em" }}>WIN RATE</div>
          </div>
          <div style={{ background: "#150f22", borderRadius: 8, padding: "10px 18px", border: "1px solid #2c2140" }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#3b82f6" }}>{brawler.pickRate}%</div>
            <div style={{ fontSize: 9, color: "#475569", letterSpacing: "0.06em" }}>PICK RATE</div>
          </div>
          <div style={{ background: "#150f22", borderRadius: 8, padding: "10px 18px", border: "1px solid #2c2140", gridColumn: "1/-1" }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#f59e0b" }}>{brawler.picks}</div>
            <div style={{ fontSize: 9, color: "#475569", letterSpacing: "0.06em" }}>TOTAL PICKS</div>
          </div>
        </div>
      </div>

      {/* Abilities */}
      <div style={{ display: "flex", flexDirection: "column", gap: 20, marginBottom: 28 }}>
        {brawler.starPowers?.length > 0 && (
          <div>
            <h3 style={sectionTitle}>Star Powers</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
              {brawler.starPowers.map((sp, i) => (
                <AbilityCard key={i} name={sp.name} desc={sp.desc} img={sp.img} color="#f59e0b" />
              ))}
            </div>
          </div>
        )}
        {brawler.gadgets?.length > 0 && (
          <div>
            <h3 style={sectionTitle}>Gadgets</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
              {brawler.gadgets.map((g, i) => (
                <AbilityCard key={i} name={g.name} desc={g.desc} img={g.img} color="#a78bfa" />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Performance by mode */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={sectionTitle}>Performance by Mode</h3>
        {modeStats.length === 0 && <p style={emptyText}>Not enough data across modes.</p>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8, marginTop: 10 }}>
          {modeStats.map(m => (
            <div key={m.mode} style={{ background: "#150f22", border: "1px solid #2c2140", borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>{FORMAT_MODE(m.mode)}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: m.winRate >= 52 ? "#10b981" : m.winRate >= 48 ? "#f59e0b" : "#ef4444" }}>
                {m.winRate}%
              </div>
              <div style={{ fontSize: 10, color: "#475569" }}>{m.picks} picks</div>
            </div>
          ))}
        </div>
      </div>

      {/* Best maps */}
      <div style={{ marginBottom: 28 }}>
        <h3 style={sectionTitle}>Best Maps</h3>
        {mapStats.length === 0 && <p style={emptyText}>Not enough map data.</p>}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
          {mapStats.slice(0, 10).map(m => (
            <div key={m.map} style={{ display: "flex", alignItems: "center", gap: 12, background: "#150f22", border: "1px solid #2c2140", borderRadius: 8, padding: "8px 12px" }}>
              <Map size={12} color="#475569" />
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#cbd5e1" }}>{m.map}</span>
              <span style={{ fontSize: 10, color: "#64748b" }}>{FORMAT_MODE(m.mode)}</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: m.winRate >= 52 ? "#10b981" : m.winRate >= 48 ? "#f59e0b" : "#ef4444", minWidth: 44, textAlign: "right" }}>
                {m.winRate}%
              </span>
              <span style={{ fontSize: 10, color: "#475569", minWidth: 52, textAlign: "right" }}>{m.picks} picks</span>
            </div>
          ))}
        </div>
      </div>

      {/* In-depth guide: tips, screenshots, video */}
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#8a7fa6", letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: "'Space Mono', monospace", marginBottom: 10 }}>
          In-Depth Guide
        </div>
        <GuideSection guide={brawler.guide} />
      </div>
    </div>
  );
}

function SynergyRow({ brawler, color }) {
  const [imgErr, setImgErr] = useState(false);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#150f22", border: "1px solid #2c2140", borderRadius: 8, marginBottom: 6 }}>
      <div style={{ width: 32, height: 32, borderRadius: 6, overflow: "hidden", background: `${brawler.rarityColor}20`, border: `1.5px solid ${brawler.rarityColor}50`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {!imgErr && brawler.imageUrl
          ? <img src={brawler.imageUrl} alt={brawler.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={() => setImgErr(true)} />
          : <span style={{ fontSize: 9, fontWeight: 800, color: brawler.rarityColor }}>{brawler.name.slice(0, 2).toUpperCase()}</span>
        }
      </div>
      <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#cbd5e1" }}>{brawler.name}</span>
      <span style={{ fontSize: 13, fontWeight: 800, color }}>{brawler.winRate}%</span>
      <span style={{ fontSize: 10, color: "#475569" }}>{brawler.picks}g</span>
    </div>
  );
}

function AbilityCard({ name, desc, img, color }) {
  return (
    <div style={{ display: "flex", gap: 12, padding: 12, background: "#150f22", border: "1px solid #2c2140", borderRadius: 8, alignItems: "flex-start" }}>
      {img && (
        <img src={img} alt={name} style={{ width: 40, height: 40, objectFit: "contain", flexShrink: 0, borderRadius: 6 }}
          onError={e => { e.target.style.display = "none"; }} />
      )}
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color, marginBottom: 4 }}>{name}</div>
        <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>{desc?.replace(/<[^>]*>/g, "") || "—"}</div>
      </div>
    </div>
  );
}

const sectionTitle = { fontSize: 13, fontWeight: 800, color: "#94a3b8", letterSpacing: "0.08em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: 6 };
const emptyText = { fontSize: 12, color: "#475569" };

function GuideSection({ guide }) {
  const [lightbox, setLightbox] = useState(null);
  const hasTips = guide?.tips?.length > 0;
  const hasScreenshots = guide?.screenshots?.length > 0;
  const videoUrl = guide?.videoUrl || null;

  if (!hasTips && !hasScreenshots && !videoUrl) {
    return (
      <div style={{ textAlign: "center", padding: "40px 20px", color: "#475569" }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: "#64748b", marginBottom: 6 }}>Guide coming soon</p>
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
            style={{ width: "100%", borderRadius: 10, border: "1px solid #2c2140", marginTop: 10, background: "#000" }}
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
                style={{ width: "100%", height: 100, objectFit: "cover", borderRadius: 8, border: "1px solid #2c2140", cursor: "pointer" }}
                onError={e => { e.target.style.display = "none"; }}
              />
            ))}
          </div>
        </div>
      )}

      {lightbox && (
        <div
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
  const [tierMode, setTierMode] = useState("general");
  const [selectedBrawler, setSelectedBrawler] = useState(null);
  const [fullGuideBrawler, setFullGuideBrawler] = useState(null);

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
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 300, color: "#475569", fontSize: 13 }}>
      Computing brawler ratings…
    </div>
  );

  if (fullGuideBrawler) {
    const live = brawlerByKey[fullGuideBrawler.key] || fullGuideBrawler;
    return (
      <BrawlerGuidePage
        brawler={live}
        byMode={byMode}
        byMap={byMap}
        onBack={() => setFullGuideBrawler(null)}
      />
    );
  }

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#8a7fa6", letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: "'Space Mono', monospace", marginBottom: 6 }}>
          02 / Meta Tier List
        </div>
        <h2 style={{ fontSize: 30, fontWeight: 900, fontFamily: "'Barlow Condensed', sans-serif", color: "#f8fafc", marginBottom: 4 }}>
          Draft power rankings
        </h2>
        <p style={{ fontSize: 12, color: "#64748b" }}>
          {tierMode === "general"
            ? "Hand-curated general meta ranking across all ranked modes."
            : <>Ranked by win rate on <span style={{ color: "#c084fc" }}>{FORMAT_MODE(tierMode)}</span> · {rankBracket === "masters_legendary" ? "Masters & Legendary" : "Diamond & Mythic"} · min {MIN_PICKS_TIER} games</>}
        </p>
      </div>

      {/* Mode tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
        {tierModes.map(m => {
          const active = tierMode === m;
          return (
            <button key={m} onClick={() => setTierMode(m)}
              style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid", fontSize: 11, fontWeight: 700, cursor: "pointer",
                fontFamily: "'Space Mono', monospace", letterSpacing: "0.04em", textTransform: "uppercase",
                background: active ? "rgba(168,85,247,0.14)" : "#150f22",
                borderColor: active ? "rgba(168,85,247,0.45)" : "#2c2140",
                color: active ? "#e9d5ff" : "#7c7490",
              }}>
              {m === "general" ? "General" : FORMAT_MODE(m)}
            </button>
          );
        })}
      </div>

      {/* Tier rows */}
      {tierMode !== "general" && totalRanked === 0 ? (
        <div style={{ textAlign: "center", color: "#475569", fontSize: 13, padding: 40 }}>
          Not enough data for this mode yet (min {MIN_PICKS_TIER} games per brawler).
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {TIERS.map(t => (
            <div key={t.id} style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
              {/* Tier label box */}
              <div style={{
                width: 60, flexShrink: 0, borderRadius: 10, background: t.bg, border: `1px solid ${t.border}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 22, fontWeight: 900, fontFamily: "'Barlow Condensed', sans-serif", color: t.color,
              }}>
                {t.id}
              </div>
              {/* Brawler chips */}
              <div style={{
                flex: 1, minHeight: 60, borderRadius: 10, background: "#120d1e", border: "1px solid #221a33",
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
          onClose={() => setSelectedBrawler(null)}
          onOpenFullGuide={(b) => { setSelectedBrawler(null); setFullGuideBrawler(b); }}
        />
      )}
    </div>
  );
}

function TierChip({ brawler, onClick }) {
  return (
    <button onClick={onClick} title={brawler.winRate != null ? `${brawler.name} · ${brawler.winRate}% WR · ${brawler.picks} picks` : brawler.name}
      style={{
        display: "flex", alignItems: "center", gap: 7, padding: "5px 10px 5px 5px",
        background: "#1a1329", border: `1px solid ${brawler.rarityColor}44`, borderRadius: 8, cursor: "pointer",
      }}>
      <BrawlerPortrait brawler={brawler} size={30} />
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.15 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>{brawler.name}</span>
        <span style={{ fontSize: 10, color: brawler.winRate != null ? (brawler.winRate >= 52 ? "#34d399" : brawler.winRate >= 48 ? "#fbbf24" : "#f87171") : "#64748b" }}>
          {brawler.winRate != null ? `${brawler.winRate}%` : "—"}
        </span>
      </div>
    </button>
  );
}

function BrawlerCard({ brawler, onClick }) {
  const starColor = brawler.stars >= 6 ? "#f59e0b" : brawler.stars >= 4 ? "#60a5fa" : brawler.stars >= 2 ? "#94a3b8" : "#ef4444";
  return (
    <div onClick={onClick} style={{
      background: "#150f22", border: `1px solid ${brawler.rarityColor}30`,
      borderRadius: 12, overflow: "hidden", cursor: "pointer",
      transition: "transform 0.15s, box-shadow 0.15s",
      position: "relative",
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 8px 24px ${brawler.rarityColor}20`; }}
      onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; }}
    >
      {/* Portrait */}
      <div style={{ height: 120, background: `linear-gradient(135deg, ${brawler.rarityColor}15 0%, #0a0711 100%)`, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
        <BrawlerPortrait brawler={brawler} size={80} />
        {/* Stars badge */}
        {brawler.stars !== null && (
          <div style={{ position: "absolute", top: 8, right: 8, background: "rgba(5,11,20,0.8)", borderRadius: 6, padding: "2px 6px", display: "flex", alignItems: "center", gap: 2 }}>
            <Star size={10} fill={starColor} color={starColor} />
            <span style={{ fontSize: 11, fontWeight: 800, color: starColor }}>{brawler.stars?.toFixed(1)}</span>
          </div>
        )}
        {/* Rarity strip */}
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2, background: brawler.rarityColor }} />
      </div>

      {/* Info */}
      <div style={{ padding: "10px 12px" }}>
        <div style={{ fontSize: 14, fontWeight: 800, fontFamily: "'Barlow Condensed', sans-serif", color: "#f8fafc", marginBottom: 2 }}>{brawler.name}</div>
        <div style={{ fontSize: 10, color: brawler.rarityColor, marginBottom: 8 }}>{brawler.rarity}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <div style={{ background: "#0a0711", borderRadius: 6, padding: "5px 8px", textAlign: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: brawler.winRate >= 52 ? "#10b981" : brawler.winRate >= 48 ? "#f59e0b" : "#ef4444" }}>
              {brawler.winRate}%
            </div>
            <div style={{ fontSize: 8, color: "#475569", letterSpacing: "0.06em" }}>WIN RATE</div>
          </div>
          <div style={{ background: "#0a0711", borderRadius: 6, padding: "5px 8px", textAlign: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#3b82f6" }}>{brawler.pickRate}%</div>
            <div style={{ fontSize: 8, color: "#475569", letterSpacing: "0.06em" }}>PICK RATE</div>
          </div>
        </div>
      </div>
    </div>
  );
}
