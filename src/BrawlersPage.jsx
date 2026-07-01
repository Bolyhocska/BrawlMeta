import { useState, useMemo } from "react";
import { Star, ChevronDown, ChevronLeft, Users, TrendingUp, Map, Gamepad2, X } from "lucide-react";
import BRAWLER_META from "./data/brawlerMeta.json";
import BRAWLER_GUIDES from "./data/brawlerGuides.json";

const RARITY_ORDER = ["Trophy Road", "Rare", "Super Rare", "Epic", "Mythic", "Legendary", "Ultra Legendary"];

const MIN_PICKS_OVERALL = 10;
const MIN_PICKS_MAP = 3;

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
function BrawlerDetail({ brawler, byMode, byMap, onClose }) {
  const [activeSection, setActiveSection] = useState("overview");

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
        background: "#070e1c", border: "1px solid #1e293b",
        borderRadius: 16, overflow: "hidden", display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{
          padding: "20px 24px", borderBottom: "1px solid #1e293b",
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
            <StarRating stars={brawler.stars} size="lg" />
            <p style={{ fontSize: 12, color: "#64748b", marginTop: 6, lineHeight: 1.5, maxWidth: 480 }}>
              {brawler.description?.slice(0, 180)}{brawler.description?.length > 180 ? "…" : ""}
            </p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, textAlign: "center", flexShrink: 0 }}>
            <div style={{ background: "#0a1220", borderRadius: 8, padding: "8px 16px", border: "1px solid #1e293b" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#10b981" }}>{brawler.winRate}%</div>
              <div style={{ fontSize: 9, color: "#475569", letterSpacing: "0.06em" }}>WIN RATE</div>
            </div>
            <div style={{ background: "#0a1220", borderRadius: 8, padding: "8px 16px", border: "1px solid #1e293b" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#3b82f6" }}>{brawler.pickRate}%</div>
              <div style={{ fontSize: 9, color: "#475569", letterSpacing: "0.06em" }}>PICK RATE</div>
            </div>
            <div style={{ background: "#0a1220", borderRadius: 8, padding: "8px 16px", border: "1px solid #1e293b", gridColumn: "1/-1" }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#f59e0b" }}>{brawler.picks}</div>
              <div style={{ fontSize: 9, color: "#475569", letterSpacing: "0.06em" }}>TOTAL PICKS</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", color: "#ef4444", borderRadius: 8, padding: 6, cursor: "pointer", alignSelf: "flex-start" }}>
            <X size={16} />
          </button>
        </div>

        {/* Section tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid #1e293b", padding: "0 24px" }}>
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
                    <div key={m.mode} style={{ background: "#0a1220", border: "1px solid #1e293b", borderRadius: 8, padding: 12 }}>
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
                    <div key={m.map} style={{ display: "flex", alignItems: "center", gap: 12, background: "#0a1220", border: "1px solid #1e293b", borderRadius: 8, padding: "8px 12px" }}>
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
                    <div key={m.map} style={{ background: "#0a1220", border: "1px solid #1e293b", borderRadius: 8, padding: "10px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{m.map}</span>
                        <span style={{ fontSize: 10, color: "#475569" }}>{FORMAT_MODE(m.mode)} · {m.picks} picks</span>
                        <span style={{ fontSize: 14, fontWeight: 800, color: m.winRate >= 55 ? "#10b981" : m.winRate >= 50 ? "#f59e0b" : "#ef4444" }}>
                          {m.winRate}%
                        </span>
                      </div>
                      <div style={{ height: 4, background: "#1e293b", borderRadius: 2, overflow: "hidden" }}>
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

function SynergyRow({ brawler, color }) {
  const [imgErr, setImgErr] = useState(false);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#0a1220", border: "1px solid #1e293b", borderRadius: 8, marginBottom: 6 }}>
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
    <div style={{ display: "flex", gap: 12, padding: 12, background: "#0a1220", border: "1px solid #1e293b", borderRadius: 8, alignItems: "flex-start" }}>
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
            style={{ width: "100%", borderRadius: 10, border: "1px solid #1e293b", marginTop: 10, background: "#000" }}
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
                style={{ width: "100%", height: 100, objectFit: "cover", borderRadius: 8, border: "1px solid #1e293b", cursor: "pointer" }}
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
  const [search, setSearch] = useState("");
  const [modeFilter, setModeFilter] = useState("all");
  const [mapFilter, setMapFilter] = useState("all");
  const [mapDropOpen, setMapDropOpen] = useState(false);
  const [selectedBrawler, setSelectedBrawler] = useState(null);
  const [sortBy, setSortBy] = useState("stars");

  const { brawlers, byMode, byMap, totalPicks } = useMemo(
    () => computeStatsFromAggregated(brawlerStats || [], rankBracket),
    [brawlerStats, rankBracket]
  );

  const modes = useMemo(() => ["all", ...Object.keys(byMode)], [byMode]);
  const maps = useMemo(() => {
    const eligible = Object.entries(byMap)
      .filter(([, d]) => Object.values(d.brawlers).reduce((s, b) => s + b.picks, 0) >= 20)
      .map(([name]) => name)
      .sort();
    return ["all", ...eligible];
  }, [byMap]);

  const filtered = useMemo(() => {
    let list = brawlers;

    // mode filter — recompute stats for that mode
    if (modeFilter !== "all" && byMode[modeFilter]) {
      const modeData = byMode[modeFilter];
      let modeTotalPicks = 0;
      for (const s of Object.values(modeData)) modeTotalPicks += s.picks;

      list = Object.entries(modeData)
        .filter(([, s]) => s.picks >= MIN_PICKS_MAP)
        .map(([key, s]) => {
          const wr = Math.round((s.wins / s.picks) * 1000) / 10;
          const pr = Math.round((s.picks / modeTotalPicks) * 1000) / 10;
          const stars = toStars(wr, pr, modeTotalPicks, s.picks);
          const base = brawlers.find(b => b.key === key) || {};
          return { ...base, key, name: base.name || FORMAT_NAME(key), winRate: wr, pickRate: pr, stars, picks: s.picks };
        });
    }

    // map filter
    if (mapFilter !== "all" && byMap[mapFilter]) {
      const mapData = byMap[mapFilter].brawlers;
      let mapTotalPicks = 0;
      for (const s of Object.values(mapData)) mapTotalPicks += s.picks;

      list = Object.entries(mapData)
        .filter(([, s]) => s.picks >= MIN_PICKS_MAP)
        .map(([key, s]) => {
          const wr = Math.round((s.wins / s.picks) * 1000) / 10;
          const pr = Math.round((s.picks / mapTotalPicks) * 1000) / 10;
          const stars = toStars(wr, pr, mapTotalPicks, s.picks);
          const base = brawlers.find(b => b.key === key) || {};
          return { ...base, key, name: base.name || FORMAT_NAME(key), winRate: wr, pickRate: pr, stars, picks: s.picks };
        });
    }

    // search
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(b => b.name?.toLowerCase().includes(q));
    }

    // sort
    list = [...list].sort((a, b) => {
      if (sortBy === "stars") return (b.stars ?? 0) - (a.stars ?? 0) || b.winRate - a.winRate;
      if (sortBy === "winRate") return b.winRate - a.winRate;
      if (sortBy === "pickRate") return b.pickRate - a.pickRate;
      if (sortBy === "picks") return b.picks - a.picks;
      return 0;
    });

    return list;
  }, [brawlers, modeFilter, mapFilter, search, sortBy, byMode, byMap]);

  const selectedBrawlerFull = useMemo(() =>
    selectedBrawler ? brawlers.find(b => b.key === selectedBrawler.key) || selectedBrawler : null,
    [selectedBrawler, brawlers]);

  if (loading) return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 300, color: "#475569", fontSize: 13 }}>
      Computing brawler ratings…
    </div>
  );

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 24, fontWeight: 900, fontFamily: "'Barlow Condensed', sans-serif", color: "#f8fafc", marginBottom: 4 }}>
          Brawler Rankings
        </h2>
        <p style={{ fontSize: 12, color: "#64748b" }}>
          7-star ratings from {Math.round(totalPicks / 6).toLocaleString()} {rankBracket === "masters_legendary" ? "Masters & Legendary" : "Diamond & Mythic"} matches · {brawlers.length} brawlers tracked
        </p>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        {/* Search */}
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search brawler…"
          style={{ background: "#0a1220", border: "1px solid #1e293b", borderRadius: 8, padding: "7px 12px", color: "#cbd5e1", fontSize: 12, width: 180 }}
        />

        {/* Mode filter */}
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {modes.map(m => (
            <button key={m} onClick={() => { setModeFilter(m); setMapFilter("all"); }}
              style={{ padding: "5px 12px", borderRadius: 6, border: "1px solid", fontSize: 11, fontWeight: 600, cursor: "pointer",
                background: modeFilter === m ? "rgba(245,158,11,0.15)" : "#0a1220",
                borderColor: modeFilter === m ? "rgba(245,158,11,0.5)" : "#1e293b",
                color: modeFilter === m ? "#f59e0b" : "#64748b",
              }}>
              {m === "all" ? "All Modes" : FORMAT_MODE(m)}
            </button>
          ))}
        </div>

        {/* Map dropdown */}
        <div style={{ position: "relative" }}>
          <button onClick={() => setMapDropOpen(o => !o)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 8, border: "1px solid", cursor: "pointer", fontSize: 11, fontWeight: 600,
              background: mapFilter !== "all" ? "rgba(96,165,250,0.15)" : "#0a1220",
              borderColor: mapFilter !== "all" ? "rgba(96,165,250,0.5)" : "#1e293b",
              color: mapFilter !== "all" ? "#60a5fa" : "#64748b",
            }}>
            <Map size={12} />
            {mapFilter === "all" ? "All Maps" : mapFilter}
            <ChevronDown size={11} style={{ transform: mapDropOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
          </button>
          {mapDropOpen && (
            <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, background: "#0a1220", border: "1px solid #1e293b", borderRadius: 8, zIndex: 50, minWidth: 200, maxHeight: 260, overflowY: "auto" }}>
              {maps.map(m => (
                <button key={m} onClick={() => { setMapFilter(m); setMapDropOpen(false); }}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 12px", background: mapFilter === m ? "rgba(96,165,250,0.1)" : "transparent", border: "none", color: mapFilter === m ? "#60a5fa" : "#94a3b8", fontSize: 12, cursor: "pointer" }}>
                  {m === "all" ? "All Maps" : m}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Sort */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 4, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "#475569" }}>Sort:</span>
          {[["stars", "Rating"], ["winRate", "Win Rate"], ["pickRate", "Pick Rate"], ["picks", "Picks"]].map(([val, label]) => (
            <button key={val} onClick={() => setSortBy(val)}
              style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid", fontSize: 10, fontWeight: 600, cursor: "pointer",
                background: sortBy === val ? "rgba(167,139,250,0.15)" : "#0a1220",
                borderColor: sortBy === val ? "rgba(167,139,250,0.5)" : "#1e293b",
                color: sortBy === val ? "#a78bfa" : "#475569",
              }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Brawler grid */}
      {filtered.length === 0 && (
        <div style={{ textAlign: "center", color: "#475569", fontSize: 13, padding: 40 }}>
          No brawlers found with enough data for this filter.
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
        {filtered.map(b => (
          <BrawlerCard key={b.key} brawler={b} onClick={() => setSelectedBrawler(b)} />
        ))}
      </div>

      {/* Detail modal */}
      {selectedBrawlerFull && (
        <BrawlerDetail
          brawler={selectedBrawlerFull}
          byMode={byMode}
          byMap={byMap}
          onClose={() => setSelectedBrawler(null)}
        />
      )}
    </div>
  );
}

function BrawlerCard({ brawler, onClick }) {
  const starColor = brawler.stars >= 6 ? "#f59e0b" : brawler.stars >= 4 ? "#60a5fa" : brawler.stars >= 2 ? "#94a3b8" : "#ef4444";
  return (
    <div onClick={onClick} style={{
      background: "#0a1220", border: `1px solid ${brawler.rarityColor}30`,
      borderRadius: 12, overflow: "hidden", cursor: "pointer",
      transition: "transform 0.15s, box-shadow 0.15s",
      position: "relative",
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = `0 8px 24px ${brawler.rarityColor}20`; }}
      onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "none"; }}
    >
      {/* Portrait */}
      <div style={{ height: 120, background: `linear-gradient(135deg, ${brawler.rarityColor}15 0%, #050b14 100%)`, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
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
          <div style={{ background: "#050b14", borderRadius: 6, padding: "5px 8px", textAlign: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: brawler.winRate >= 52 ? "#10b981" : brawler.winRate >= 48 ? "#f59e0b" : "#ef4444" }}>
              {brawler.winRate}%
            </div>
            <div style={{ fontSize: 8, color: "#475569", letterSpacing: "0.06em" }}>WIN RATE</div>
          </div>
          <div style={{ background: "#050b14", borderRadius: 6, padding: "5px 8px", textAlign: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#3b82f6" }}>{brawler.pickRate}%</div>
            <div style={{ fontSize: 8, color: "#475569", letterSpacing: "0.06em" }}>PICK RATE</div>
          </div>
        </div>
      </div>
    </div>
  );
}
