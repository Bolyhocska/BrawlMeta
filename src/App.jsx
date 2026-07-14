import { useState, useEffect, useMemo } from "react";
import { Routes, Route, useParams, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronDown, Star, TrendingUp, Check, Crown, LineChart, ArrowUpRight } from "lucide-react";
import BrawlersPage, { computeStatsFromAggregated, BrawlerGuidePage, findBrawlerKeyBySlug } from "./BrawlersPage";
import HomePage from "./HomePage";
import SiteHeader from "./SiteHeader";
import ComingSoonPage from "./ComingSoonPage";
import { GuidesLandingPage, SkillsGuidePage, ModesGuidesPage, ModeGuidePage, SafeZoneGuidePage, BrawlerGuidesPage } from "./GuidesPages";
import ScrimsPage from "./ScrimsPage";
import DraftAssistant from "./DraftAssistant";
import { TournamentLandingPage, TournamentDetailPage, TournamentProfilePage, CreateTournamentPage, ManageTournamentPage } from "./TournamentPages";
import BRAWLER_META_IMPORT from "./data/brawlerMeta.json";
import { supabase, CURRENT_PATCH, BRAWLERS, formatBrawlerName, formatMode, MODE_COLORS } from "./appCore";
import { tileStyles } from "./data/brawlerTile";

const RANK_BRACKETS = [
  { id: "masters_legendary", label: "Masters & Legendary", accent: "#ffb43d" },
  { id: "diamond_mythic", label: "Diamond & Mythic", accent: "#c98bff" },
];

const TIER_COLORS = { S: "#ffb43d", A: "#60a5fa", B: "#94a3b8", C: "#6b7280" };

const assignTier = (picks, wins, totalPicks) => {
  const winRate = picks ? (wins / picks) * 100 : 0;
  const pickRate = totalPicks ? (picks / totalPicks) * 100 : 0;
  if (winRate >= 55 && pickRate >= 2.5) return "S";
  if (winRate >= 52 && pickRate >= 1.5) return "A";
  if (winRate >= 48) return "B";
  return "C";
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

// Map list is fully data-driven: the scraper's RANKED_MAPS allowlist already
// guarantees only real ranked-rotation maps ever reach the database, so the
// frontend no longer needs its own hardcoded per-patch map list.
function useMaps(selectedPatch) {
  const [maps, setMaps] = useState([]);
  useEffect(() => {
    if (!selectedPatch) return;
    supabase
      .from("BrawlerStats")
      .select("map,mode,picks")
      .eq("patch", selectedPatch)
      .not("map", "is", null)
      .limit(100000)
      .then(({ data }) => {
        if (!data) return;
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

const VALID_TABS = ["trending", "meta", "brawlers", "premium"];

function BrawlMeta() {
  // Derived directly from the URL on every render, not stored in state —
  // navigating between /app?tab=X and /app?tab=Y stays on the same route, so
  // React Router doesn't remount this component; a useState initial value
  // would never update when only the query string changes.
  const [searchParams] = useSearchParams();
  const activeTab = VALID_TABS.includes(searchParams.get("tab")) ? searchParams.get("tab") : "meta";
  const [rankBracket, setRankBracket] = useState("masters_legendary");
  const [selectedPatch, setSelectedPatch] = useState(CURRENT_PATCH);
  const patches = usePatches();
  const maps = useMaps(selectedPatch);
  const { stats: brawlerStats, loading: statsLoading, error: statsError } = useBrawlerStats(selectedPatch);

  return (
    <div style={styles.root}>
      <div style={styles.scanlines} />

      {/* Master header shared across every page — the only app navigation */}
      <SiteHeader />

      <div style={styles.contentContainer}>
        {/* The rank-bracket + patch bar is only meaningful for the ranked meta
            (Ranked tab) and the Tier List; Leaderboards and Premium don't use it. */}
        {["meta", "brawlers"].includes(activeTab) && (
          <RankBracketSelector value={rankBracket} onChange={setRankBracket} selectedPatch={selectedPatch} onPatchChange={setSelectedPatch} patches={patches} />
        )}

        {activeTab === "trending" && (
          <LeaderboardsView
            rankBracket={rankBracket}
            brawlerStats={brawlerStats}
            loading={statsLoading}
            error={statsError}
          />
        )}
        {activeTab === "meta" && (
          <DraftAssistant
            selectedPatch={selectedPatch}
            rankBracket={rankBracket}
            maps={maps}
            brawlerStats={brawlerStats}
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
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @media (max-width: 640px) {
          .site-header { gap: 10px !important; padding: 14px 5vw !important; }
          .rank-bracket-bar { flex-wrap: wrap; gap: 10px !important; padding: 10px 14px !important; }
          .guide-header { flex-direction: column !important; align-items: flex-start !important; }
        }
      `}</style>
    </div>
  );
}

function RankBracketSelector({ value, onChange, selectedPatch, onPatchChange, patches }) {
  const [patchOpen, setPatchOpen] = useState(false);
  return (
    <div style={styles.rankBracketBar} className="rank-bracket-bar">
      <div style={styles.rankBracketLabel}>
        <Crown size={14} color="#b36bff" />
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
        <button onClick={() => setPatchOpen(o => !o)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 999, border: "1px solid rgba(255,255,255,.1)", background: "rgba(255,255,255,.04)", color: "#ffce7a", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "'JetBrains Mono', monospace", letterSpacing: ".5px" }}>
          <Star size={11} color="#ffb43d" fill="#ffb43d" />
          PATCH {selectedPatch}
          <ChevronDown size={11} color="#64748b" style={{ transform: patchOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
        </button>
        {patchOpen && patches.length > 0 && (
          <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 6, background: "rgba(13,13,20,.95)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 16, zIndex: 200, minWidth: 160, overflow: "hidden", padding: 5, backdropFilter: "blur(12px)" }}>
            {patches.map(p => (
              <button key={p} onClick={() => { onPatchChange(p); setPatchOpen(false); }}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 14px", borderRadius: 999, background: selectedPatch === p ? "rgba(255,180,61,.12)" : "transparent", border: "none", color: selectedPatch === p ? "#ffce7a" : "#94a3b8", fontSize: 12, fontWeight: selectedPatch === p ? 700 : 400, cursor: "pointer", fontFamily: "'JetBrains Mono', monospace" }}>
                {p === CURRENT_PATCH ? `${p} · CURRENT` : p}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Leaderboards tab (Brawlify-style: live trophy ladder + map rotation) ────

const MONO_FONT = "'JetBrains Mono', monospace";
const DISPLAY_FONT = "'Baloo 2', sans-serif";

// Reads a relay row from SiteFeed (scraper pushes Supercell API payloads
// there on every run — the browser can't call Supercell directly).
function useSiteFeed(kind) {
  const [feed, setFeed] = useState(null);
  useEffect(() => {
    supabase
      .from("SiteFeed")
      .select("payload,fetched_at")
      .eq("kind", kind)
      .eq("region", "global")
      .maybeSingle()
      .then(({ data }) => { if (data) setFeed(data); });
  }, [kind]);
  return feed;
}

// Map name -> { imageUrl, modeColor, modeName } from Brawlify's public API,
// used to give rotation slots their real map art.
function useBrawlifyMaps(enabled) {
  const [byName, setByName] = useState({});
  useEffect(() => {
    if (!enabled) return;
    fetch("https://api.brawlapi.com/v1/maps")
      .then(r => r.json())
      .then(data => {
        const m = {};
        for (const item of data.list || []) {
          m[(item.name || "").toLowerCase()] = {
            imageUrl: item.imageUrl,
            modeName: item.gameMode?.name,
            modeColor: item.gameMode?.color,
            modeImageUrl: item.gameMode?.imageUrl,
          };
        }
        setByName(m);
      })
      .catch(() => {});
  }, [enabled]);
  return byName;
}

// Supercell basic-ISO timestamp ("20260712T060000.000Z") -> Date
const parseScTime = (s) => {
  if (!s) return null;
  const iso = s.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, "$1-$2-$3T$4:$5:$6");
  const d = new Date(iso);
  return isNaN(d) ? null : d;
};

const timeUntil = (date) => {
  if (!date) return null;
  const ms = date.getTime() - Date.now();
  if (ms <= 0) return "now";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

// Supercell name colors come as "0xffRRGGBB"
const scNameColor = (c) => (c && /^0xff[0-9a-fA-F]{6}$/.test(c)) ? `#${c.slice(4)}` : "#f4f4fa";

const PODIUM = [
  { glow: "#ffce7a", label: "01" },
  { glow: "#cfd8e3", label: "02" },
  { glow: "#e0a35f", label: "03" },
];

function LeaderboardsView({ rankBracket, brawlerStats, loading, error }) {
  const rankingsFeed = useSiteFeed("player_rankings");
  const rotationFeed = useSiteFeed("event_rotation");
  const players = rankingsFeed?.payload?.items || [];
  const rotation = Array.isArray(rotationFeed?.payload) ? rotationFeed.payload : [];
  const mapsByName = useBrawlifyMaps(rotation.length > 0);

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
      {/* Hero */}
      <div style={{ textAlign: "center", padding: "10px 0 34px", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 9, padding: "9px 18px 9px 14px", borderRadius: 999, background: "rgba(13,13,20,.6)", border: "1px solid rgba(255,180,61,.3)", fontFamily: MONO_FONT, fontSize: 12, letterSpacing: 2.5, color: "#ffce7a" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ffb43d", boxShadow: "0 0 8px #ffb43d" }} />
          LEADERBOARDS · LIVE
        </div>
        <h1 style={{ marginTop: 20, fontFamily: DISPLAY_FONT, fontSize: "clamp(40px,5.5vw,72px)", fontWeight: 700, lineHeight: .95, letterSpacing: "-1px", color: "#f4f4fa" }}>
          Top of the <span style={{ color: "#ffb43d", textShadow: "0 0 40px rgba(255,180,61,.5)" }}>ladder</span>
        </h1>
      </div>

      {/* ── Map rotation ── */}
      <section style={{ marginBottom: 44 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <span style={{ fontFamily: MONO_FONT, fontSize: 11, letterSpacing: 2, color: "#c98bff" }}>◈ ON ROTATION NOW</span>
          {rotationFeed?.fetched_at && (
            <span style={{ fontFamily: MONO_FONT, fontSize: 10, color: "#5a5a6a" }}>
              UPDATED {new Date(rotationFeed.fetched_at).toLocaleString()}
            </span>
          )}
        </div>
        {rotation.length === 0 ? (
          <div style={{ borderRadius: 24, border: "1px dashed rgba(255,255,255,.14)", padding: "34px 24px", textAlign: "center", color: "#6f7180", fontSize: 13.5 }}>
            Rotation data lands here after the next scraper run — trigger the BrawlMeta Auto-Scraper workflow to fill it now.
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 16 }}>
            {rotation.map((slot, i) => {
              const ev = slot.event || {};
              const info = mapsByName[(ev.map || "").toLowerCase()] || {};
              const mc = MODE_COLORS[ev.mode?.replace(/\s/g, "")] ?? info.modeColor ?? "#64748b";
              const ends = timeUntil(parseScTime(slot.endTime));
              return (
                <div key={`${ev.map}-${i}`} style={{ borderRadius: 24, overflow: "hidden", background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)", display: "flex", flexDirection: "column" }}>
                  <div style={{ height: 150, position: "relative", background: `linear-gradient(160deg, ${mc}22, rgba(13,13,20,.6))` }}>
                    {info.imageUrl && (
                      <img src={info.imageUrl} alt={ev.map} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center top" }} />
                    )}
                    {ends && (
                      <span style={{ position: "absolute", top: 10, right: 10, fontFamily: MONO_FONT, fontSize: 10, letterSpacing: 1, fontWeight: 700, padding: "4px 10px", borderRadius: 999, background: "rgba(8,8,12,.8)", border: "1px solid rgba(255,255,255,.15)", color: "#ffce7a" }}>
                        ENDS IN {ends.toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 6 }}>
                    <span style={{ fontFamily: MONO_FONT, fontSize: 10, letterSpacing: 1.5, fontWeight: 700, color: mc }}>
                      {(info.modeName || formatMode(ev.mode)).toUpperCase()}
                    </span>
                    <span style={{ fontFamily: DISPLAY_FONT, fontSize: 17, fontWeight: 700, color: "#f4f4fa" }}>{ev.map || "Unknown map"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Global trophy leaderboard ── */}
      <section style={{ marginBottom: 44 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <span style={{ fontFamily: MONO_FONT, fontSize: 11, letterSpacing: 2, color: "#ffce7a" }}>◈ GLOBAL TROPHY LEADERBOARD</span>
          {rankingsFeed?.fetched_at && (
            <span style={{ fontFamily: MONO_FONT, fontSize: 10, color: "#5a5a6a" }}>
              UPDATED {new Date(rankingsFeed.fetched_at).toLocaleString()}
            </span>
          )}
        </div>

        {players.length === 0 ? (
          <div style={{ borderRadius: 24, border: "1px dashed rgba(255,255,255,.14)", padding: "34px 24px", textAlign: "center", color: "#6f7180", fontSize: 13.5 }}>
            The global top 200 lands here after the next scraper run.
          </div>
        ) : (
          <>
            {/* Podium */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 18 }}>
              {players.slice(0, 3).map((p, i) => (
                <div key={p.tag} style={{
                  borderRadius: 24, padding: "22px 24px", textAlign: "center",
                  background: `linear-gradient(160deg, ${PODIUM[i].glow}14, rgba(13,13,20,.5))`,
                  border: `1px solid ${PODIUM[i].glow}45`,
                  boxShadow: `0 0 30px ${PODIUM[i].glow}18`,
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                }}>
                  <span style={{ fontFamily: MONO_FONT, fontSize: 13, fontWeight: 700, letterSpacing: 2, color: PODIUM[i].glow }}>{PODIUM[i].label}</span>
                  {p.icon?.id && (
                    <img src={`https://cdn.brawlify.com/profile-icons/regular/${p.icon.id}.png`} alt="" loading="lazy"
                      style={{ width: 54, height: 54, borderRadius: 14, border: `2px solid ${PODIUM[i].glow}60` }}
                      onError={e => { e.currentTarget.style.display = "none"; }} />
                  )}
                  <span style={{ fontFamily: DISPLAY_FONT, fontSize: 19, fontWeight: 700, color: scNameColor(p.nameColor) }}>{p.name}</span>
                  {p.club?.name && <span style={{ fontSize: 11.5, color: "#8b8b9c" }}>{p.club.name}</span>}
                  <span style={{ fontFamily: MONO_FONT, fontSize: 17, fontWeight: 700, color: "#ffce7a" }}>🏆 {p.trophies.toLocaleString()}</span>
                </div>
              ))}
            </div>

            {/* Rows 4+ */}
            <div style={{ borderRadius: 24, background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.08)", overflow: "hidden" }}>
              <div style={{ maxHeight: 520, overflowY: "auto" }}>
                {players.slice(3).map((p) => (
                  <div key={p.tag} style={{ display: "flex", alignItems: "center", gap: 14, padding: "11px 20px", borderBottom: "1px solid rgba(255,255,255,.05)" }}>
                    <span style={{ fontFamily: MONO_FONT, fontSize: 12, color: "#6f7180", width: 34, flexShrink: 0 }}>{String(p.rank).padStart(2, "0")}</span>
                    {p.icon?.id ? (
                      <img src={`https://cdn.brawlify.com/profile-icons/regular/${p.icon.id}.png`} alt="" loading="lazy"
                        style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0 }}
                        onError={e => { e.currentTarget.style.visibility = "hidden"; }} />
                    ) : <span style={{ width: 30 }} />}
                    <span style={{ fontSize: 14, fontWeight: 700, color: scNameColor(p.nameColor), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                    <span style={{ fontSize: 11.5, color: "#6f7180", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{p.club?.name || ""}</span>
                    <span style={{ fontFamily: MONO_FONT, fontSize: 13, fontWeight: 700, color: "#ffce7a", flexShrink: 0 }}>{p.trophies.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </section>

      {/* ── Meta leaders (our own ranked data) ── */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4, flexWrap: "wrap" }}>
        <span style={{ fontFamily: MONO_FONT, fontSize: 11, letterSpacing: 2, color: "#8ee6b0" }}>◈ META LEADERS · {bracketLabel.toUpperCase()}</span>
        <span style={{ fontFamily: MONO_FONT, fontSize: 10, color: "#5a5a6a" }}>{Math.round(totalPicks / 6).toLocaleString()} MATCHES TRACKED</span>
      </div>
      {loading && <p style={{ fontSize: 12, color: "#475569", marginTop: 8 }}>Loading stats…</p>}
      {error && !loading && <p style={{ fontSize: 12, color: "#ef4444", marginTop: 8 }}>{error}</p>}
      {!loading && trendingBrawlers.length === 0 && (
        <p style={{ fontSize: 12, color: "#475569", marginTop: 8 }}>
          No stats found. Run the aggregation function in Supabase.
        </p>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginTop: 16 }}>
        {trendingBrawlers.map((b) => {
          const full = BRAWLERS.find(x => x.key === b.key);
          const t = full ? tileStyles({ key: full.key, rarity: full.rarity, rarityColor: full.color, size: 40 }) : null;
          return (
            <div key={b.key} style={{ padding: 16, borderRadius: 20, background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
                {full && t ? (
                  <div style={t.outer}><div style={t.inner}>
                    {full.imageUrl
                      ? <img src={full.imageUrl} alt={b.name} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      : <span style={{ color: full.color, fontWeight: 800, fontSize: 12 }}>{full.initial}</span>}
                  </div></div>
                ) : null}
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, fontFamily: "'Baloo 2', sans-serif", color: "#f4f4fa" }}>{b.name}</div>
                  <div style={{ fontSize: 11, color: TIER_COLORS[b.tier], fontFamily: "'JetBrains Mono', monospace" }}>TIER {b.tier}</div>
                </div>
                <span style={{ marginLeft: "auto", fontSize: 10, color: "#8ee6b0", background: "rgba(142,230,176,.1)", padding: "3px 9px", borderRadius: 999, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>
                  {b.picks.toLocaleString()} PICKS
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, width: "100%", borderTop: "1px solid rgba(255,255,255,.08)", paddingTop: 10, fontFamily: "'JetBrains Mono', monospace" }}>
                <div><div style={{ fontSize: 9, letterSpacing: 1, color: "#6f7180" }}>WIN RATE</div><div style={{ fontSize: 15, fontWeight: 700, color: "#e9e9f2" }}>{b.winRate}%</div></div>
                <div><div style={{ fontSize: 9, letterSpacing: 1, color: "#6f7180" }}>PICK RATE</div><div style={{ fontSize: 15, fontWeight: 700, color: "#7cc4ff" }}>{b.pickRate}%</div></div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PremiumView() {
  return (
    <div style={{ ...styles.viewPadding, maxWidth: 500, margin: "40px auto", textAlign: "center" }}>
      <div style={{ width: 48, height: 48, background: "rgba(255,180,61,0.1)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
        <Crown size={24} color="#ffb43d" />
      </div>
      <h2 style={{ fontSize: 20, fontWeight: 800, fontFamily: "'Baloo 2', sans-serif" }}>Unlock BrawlMeta Pro</h2>
      <p style={{ color: "#64748b", fontSize: 13, marginTop: 6 }}>Gain deep access to the raw machine logs that global professional clubs utilize.</p>
      <div style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 20, padding: 18, marginTop: 20, textAlign: "left", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 8, fontSize: 12 }}><Check size={14} color="#10b981" /> <span>Real-time companion overlay linkage</span></div>
        <div style={{ display: "flex", gap: 8, fontSize: 12 }}><Check size={14} color="#10b981" /> <span>Hypercharge availability & matchup prediction maps</span></div>
        <div style={{ display: "flex", gap: 8, fontSize: 12 }}><Check size={14} color="#10b981" /> <span>Deep premium structural party counters (3v3 Synergy Maps)</span></div>
        <button style={{ width: "100%", background: "#ffb43d", color: "#1a1206", border: "none", padding: "12px", borderRadius: 999, fontWeight: 700, fontSize: 13, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4, marginTop: 8, boxShadow: "0 0 22px rgba(255,180,61,.3)" }}>
          Upgrade Now <ArrowUpRight size={14} />
        </button>
      </div>
    </div>
  );
}

const styles = {
  root: {
    minHeight: "100vh", background: "#08080c", fontFamily: "'Chakra Petch', sans-serif", color: "#e9e9f2", position: "relative",
    backgroundImage: "linear-gradient(rgba(179,107,255,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(179,107,255,.04) 1px, transparent 1px)",
    backgroundSize: "44px 44px",
  },
  scanlines: { position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, backgroundImage: "radial-gradient(1200px 500px at 70% -10%, rgba(179,107,255,0.14), transparent 70%), radial-gradient(900px 500px at 0% 110%, rgba(255,180,61,0.07), transparent 70%)" },
  contentContainer: { position: "relative", zIndex: 1 },
  rankBracketBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: "14px 5vw",
    borderBottom: "1px solid rgba(255,255,255,.06)",
    background: "linear-gradient(180deg, rgba(179,107,255,0.06) 0%, transparent 100%)",
  },
  rankBracketLabel: { display: "flex", alignItems: "center", gap: 8, fontSize: 10, fontWeight: 700, color: "#8a7fa6", letterSpacing: "0.14em", textTransform: "uppercase", fontFamily: "'JetBrains Mono', monospace" },
  rankBracketGroup: { display: "flex", gap: 8, flexWrap: "wrap" },
  rankBracketBtn: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "9px 18px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,.1)",
    background: "rgba(255,255,255,.03)",
    color: "#8b8b9c",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    transition: "all 0.15s",
    fontFamily: "'Chakra Petch', sans-serif",
  },
  viewPadding: { padding: "26px 5vw 80px", maxWidth: 1280, margin: "0 auto" },
  viewHeading: { fontSize: 22, fontWeight: 700, fontFamily: "'Baloo 2', sans-serif", display: "flex", alignItems: "center", gap: 8, color: "#f4f4fa" },
  viewSubtext: { fontSize: 12.5, color: "#8b8b9c", marginTop: 4 },
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
      <div style={{ minHeight: "100vh", background: "#08080c", display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontFamily: "'Chakra Petch', sans-serif" }}>
        {brawlerKey ? "Loading brawler guide…" : "Brawler not found."}
      </div>
    );
  }

  return (
    <div style={styles.root}>
      <SiteHeader />
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
      <Route path="/news" element={<ComingSoonPage eyebrow="META NEWS · COMING SOON" title="News is on the way" description="Patch breakdowns, balance changes, and pro-scene highlights are coming to BrawlMeta soon." />} />
      <Route path="/scrims" element={<ScrimsPage />} />
      <Route path="/tournaments" element={<TournamentLandingPage />} />
      <Route path="/tournaments/create" element={<CreateTournamentPage />} />
      <Route path="/tournaments/profile" element={<TournamentProfilePage />} />
      <Route path="/tournaments/:tournamentId/manage" element={<ManageTournamentPage />} />
      <Route path="/tournaments/:tournamentId" element={<TournamentDetailPage />} />
      <Route path="/guides" element={<GuidesLandingPage />} />
      <Route path="/guides/skills" element={<SkillsGuidePage />} />
      <Route path="/guides/modes" element={<ModesGuidesPage />} />
      <Route path="/guides/modes/heist/safe-zone" element={<SafeZoneGuidePage />} />
      <Route path="/guides/modes/:modeId" element={<ModeGuidePage />} />
      <Route path="/guides/brawlers" element={<BrawlerGuidesPage />} />
      <Route path="*" element={<BrawlMeta />} />
    </Routes>
  );
}
