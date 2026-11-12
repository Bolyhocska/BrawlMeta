// ─── Live feeds shared by several pages ─────────────────────────────────────
// The map rotation and the global top-200 trophy ladder. They used to exist
// only inside the Leaderboards tab; the nav simplification (owner, 2026-11-12)
// moved them to where people look for them — rotation on /maps, the ladder on
// the home page — and they live here so HomePage, MapsPages and App can all
// import them without a circular import through App.jsx.

import { useEffect, useState } from "react";
import { supabase, formatMode, MODE_COLORS } from "./appCore";

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

// Global top-200 trophy leaderboard from its own structured table (the scraper
// upserts a fresh snapshot every run). Rows are mapped to the same shape the
// old SiteFeed payload had so the render code stays unchanged.
function useTop200() {
  const [state, setState] = useState({ players: [], fetchedAt: null });
  useEffect(() => {
    supabase
      .from("top_200_leaderboard")
      .select("*")
      .order("rank", { ascending: true })
      .then(({ data }) => {
        if (!data?.length) return;
        setState({
          fetchedAt: data[0].fetched_at,
          players: data.map(r => ({
            rank: r.rank, tag: r.player_tag, name: r.name, nameColor: r.name_color,
            trophies: r.trophies, icon: r.icon_id ? { id: r.icon_id } : null,
            club: r.club_name ? { name: r.club_name } : null,
          })),
        });
      });
  }, []);
  return state;
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
export const scNameColor = (c) => (c && /^0xff[0-9a-fA-F]{6}$/.test(c)) ? `#${c.slice(4)}` : "#f4f4fa";

const PODIUM = [
  { glow: "#ffce7a", label: "01" },
  { glow: "#cfd8e3", label: "02" },
  { glow: "#e0a35f", label: "03" },
];

export function MapRotation() {
  const rotationFeed = useSiteFeed("event_rotation");
  const rotation = Array.isArray(rotationFeed?.payload) ? rotationFeed.payload : [];
  const mapsByName = useBrawlifyMaps(rotation.length > 0);
  return (
    <section style={{ marginBottom: 44 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <span style={{ fontFamily: MONO_FONT, fontSize: 11, letterSpacing: 2, color: "#c98bff" }}>◈ ON ROTATION NOW</span>
        {rotationFeed?.fetched_at && (
          <span style={{ fontFamily: MONO_FONT, fontSize: 10, color: "#7c7e8f" }}>
            UPDATED {new Date(rotationFeed.fetched_at).toLocaleString()}
          </span>
        )}
      </div>
      {rotation.length === 0 ? (
        <div style={{ borderRadius: 24, border: "1px dashed rgba(255,255,255,.14)", padding: "34px 24px", textAlign: "center", color: "#8b8b9c", fontSize: 13.5 }}>
          Rotation data lands here after the next scraper run — trigger the BrawlApex Auto-Scraper workflow to fill it now.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 16 }}>
          {rotation.map((slot, i) => {
            const ev = slot.event || {};
            const info = mapsByName[(ev.map || "").toLowerCase()] || {};
            const mc = MODE_COLORS[ev.mode?.replace(/\s/g, "")] ?? info.modeColor ?? "#8b98ad";
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

  );
}

export function GlobalTop200() {
  const { players, fetchedAt } = useTop200();
  return (
    <section style={{ marginBottom: 44 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <span style={{ fontFamily: MONO_FONT, fontSize: 11, letterSpacing: 2, color: "#ffce7a" }}>◈ GLOBAL TROPHY LEADERBOARD · TOP 200</span>
        {fetchedAt && (
          <span style={{ fontFamily: MONO_FONT, fontSize: 10, color: "#7c7e8f" }}>
            UPDATED {new Date(fetchedAt).toLocaleString()}
          </span>
        )}
      </div>

      {players.length === 0 ? (
        <div style={{ borderRadius: 24, border: "1px dashed rgba(255,255,255,.14)", padding: "34px 24px", textAlign: "center", color: "#8b8b9c", fontSize: 13.5 }}>
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
                  <span style={{ fontFamily: MONO_FONT, fontSize: 12, color: "#8b8b9c", width: 34, flexShrink: 0 }}>{String(p.rank).padStart(2, "0")}</span>
                  {p.icon?.id ? (
                    <img src={`https://cdn.brawlify.com/profile-icons/regular/${p.icon.id}.png`} alt="" loading="lazy"
                      style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0 }}
                      onError={e => { e.currentTarget.style.visibility = "hidden"; }} />
                  ) : <span style={{ width: 30 }} />}
                  <span style={{ fontSize: 14, fontWeight: 700, color: scNameColor(p.nameColor), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                  <span style={{ fontSize: 11.5, color: "#8b8b9c", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{p.club?.name || ""}</span>
                  <span style={{ fontFamily: MONO_FONT, fontSize: 13, fontWeight: 700, color: "#ffce7a", flexShrink: 0 }}>{p.trophies.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </section>

  );
}
