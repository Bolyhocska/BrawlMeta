// ─── Map meta pages ──────────────────────────────────────────────────────────
// 31 maps, 29 of them in rotation, every one carrying all 105 brawlers with
// 350k+ picks — and until now there was no page anywhere on the site that
// showed any of it. This is the densest data in the database.
//
// The flagship is the pick-rate/win-rate scatter, which makes the site's own
// vocabulary visible: "popularity trap" and "sleeper" stop being labels the
// engine asserts and become quadrants you can see a brawler sitting in.

import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  supabase, CURRENT_PATCH, MODE_COLORS, MODE_ICONS, formatMode,
  formatBrawlerName, useSmartBack,
} from "./appCore";
import { draftClassOf, classLabel } from "./data/draftEngine";
import { TrendChart, BarList, ScatterChart, CHART_COLORS } from "./Charts";
import SiteHeader from "./SiteHeader";

export const mapSlug = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const MONO = "'JetBrains Mono', monospace";
const DISPLAY = "'Baloo 2', sans-serif";
const BRACKETS = [
  { id: "masters_legendary", label: "Masters+" },
  { id: "diamond_mythic", label: "Diamond & Mythic" },
];

// A brawler needs a real sample on a map before its rate means anything. The
// engine uses 30 for map stats; the same floor is used here so a page and the
// draft advisor never disagree about who has enough data to rank.
const MIN_PICKS = 30;

const card = {
  background: "rgba(255,255,255,.025)", border: "1px solid rgba(255,255,255,.08)",
  borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 12,
};
const eyebrow = { fontFamily: MONO, fontSize: 9.5, letterSpacing: 1.5, color: "#6f7180" };

// ── data ─────────────────────────────────────────────────────────────────────

function useMapStats(patch) {
  const [rows, setRows] = useState([]);
  const [pool, setPool] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      supabase.from("BrawlerStats").select("brawler,map,mode,rank_bracket,picks,wins")
        .eq("patch", patch).not("map", "is", null).limit(100000),
      supabase.from("ranked_map_pool").select("map_name,mode,in_rotation,last_seen"),
    ]).then(([stats, mp]) => {
      if (cancelled) return;
      // Surfaced rather than swallowed: a half-loaded page that looks complete
      // is the failure mode that hid the upgrade advisor's paging bug.
      if (stats.error) setError(stats.error.message);
      else setRows(stats.data || []);
      if (!mp.error) setPool(mp.data || []);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [patch]);

  return { rows, pool, loading, error };
}

// meta_daily is written once a day by the scraper. Until a few days accumulate
// there is nothing to plot, and the charts say so rather than drawing a line
// through a single point and calling it a trend.
function useMapHistory(mapName, bracket, patch) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (!mapName) return;
    let cancelled = false;
    supabase.from("meta_daily")
      .select("day,brawler,win_rate,picks,window_matches")
      .eq("map", mapName).eq("rank_bracket", bracket).eq("patch", patch)
      .order("day").limit(20000)
      .then(({ data }) => { if (!cancelled) setRows(data || []); });
    return () => { cancelled = true; };
  }, [mapName, bracket, patch]);
  return rows;
}

// Per-map brawler table. pick rate is share of MATCHES the brawler appears in,
// the same definition brawler_intelligence uses — every match fills six slots,
// so total picks / 6 is the match count.
function buildTable(rows, mapName, bracket) {
  const mine = rows.filter(r => r.map === mapName && r.rank_bracket === bracket);
  const totalPicks = mine.reduce((a, r) => a + (r.picks || 0), 0);
  const matches = totalPicks / 6 || 1;
  return {
    matches: Math.round(matches),
    brawlers: mine.map(r => ({
      key: String(r.brawler).toUpperCase(),
      name: formatBrawlerName(r.brawler),
      picks: r.picks || 0,
      winRate: r.picks ? (r.wins / r.picks) * 100 : null,
      pickRate: (r.picks / matches) * 100,
      cls: classLabel(draftClassOf(String(r.brawler).toUpperCase())),
    })).filter(b => b.winRate != null),
  };
}

// ── landing ──────────────────────────────────────────────────────────────────

export function MapsLandingPage() {
  const { rows, pool, loading, error } = useMapStats(CURRENT_PATCH);
  const [bracket, setBracket] = useState("masters_legendary");

  const byMode = useMemo(() => {
    const rotation = new Map(pool.map(p => [mapSlug(p.map_name), p.in_rotation]));
    const names = [...new Set(rows.filter(r => r.rank_bracket === bracket).map(r => r.map))];
    const built = names.map(name => {
      const t = buildTable(rows, name, bracket);
      const ranked = t.brawlers.filter(b => b.picks >= MIN_PICKS).sort((a, b) => b.winRate - a.winRate);
      const mode = rows.find(r => r.map === name)?.mode;
      return {
        name, mode, matches: t.matches, top: ranked.slice(0, 3),
        inRotation: rotation.get(mapSlug(name)) !== false,
      };
    }).sort((a, b) => b.matches - a.matches);

    const groups = {};
    for (const m of built) (groups[m.mode] = groups[m.mode] || []).push(m);
    return groups;
  }, [rows, pool, bracket]);

  return (
    <div style={{ minHeight: "100vh", background: "#0c0c12", color: "#e9e9f2" }}>
      <SiteHeader />
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "22px 16px 60px", display: "flex", flexDirection: "column", gap: 18 }}>
        <div>
          <div style={eyebrow}>RANKED MAP META · PATCH {CURRENT_PATCH}</div>
          <h1 style={{ fontFamily: DISPLAY, fontSize: 30, fontWeight: 800, margin: "4px 0 6px" }}>Maps</h1>
          <p style={{ fontSize: 13.5, color: "#8b8b9c", lineHeight: 1.6, maxWidth: 760 }}>
            Every ranked map, with the brawlers that actually win on it — measured from live match data,
            not opinion. A brawler needs {MIN_PICKS}+ games on a map before it is ranked here.
          </p>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {BRACKETS.map(b => (
            <button key={b.id} onClick={() => setBracket(b.id)} style={{
              fontFamily: MONO, fontSize: 10, letterSpacing: 1, cursor: "pointer", padding: "7px 13px",
              borderRadius: 8, color: bracket === b.id ? "#0c0c12" : "#8b8b9c",
              background: bracket === b.id ? "#7cc4ff" : "rgba(255,255,255,.04)",
              border: `1px solid ${bracket === b.id ? "#7cc4ff" : "rgba(255,255,255,.12)"}`,
            }}>{b.label.toUpperCase()}</button>
          ))}
        </div>

        {error && <div style={{ ...card, borderColor: "rgba(255,143,143,.4)", color: "#ff8f8f", fontSize: 13 }}>Could not load map stats: {error}</div>}
        {loading && <div style={{ ...card, color: "#8b8b9c", fontSize: 13 }}>Loading map data…</div>}

        {Object.entries(byMode).sort().map(([mode, maps]) => (
          <div key={mode} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {MODE_ICONS[mode] && <img src={MODE_ICONS[mode]} alt="" width={20} height={20} style={{ objectFit: "contain" }} />}
              <span style={{ fontFamily: DISPLAY, fontSize: 17, fontWeight: 700, color: MODE_COLORS[mode] || "#e9e9f2" }}>
                {formatMode(mode)}
              </span>
              <span style={{ fontFamily: MONO, fontSize: 9.5, color: "#6f7180" }}>{maps.length} MAPS</span>
            </div>
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill,minmax(268px,1fr))" }}>
              {maps.map(m => (
                <Link key={m.name} to={`/maps/${mapSlug(m.name)}`} style={{ textDecoration: "none", color: "inherit" }}>
                  <div style={{ ...card, gap: 9, padding: 14, height: "100%" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                      <span style={{ fontFamily: DISPLAY, fontSize: 15.5, fontWeight: 700 }}>{m.name}</span>
                      {!m.inRotation && (
                        <span style={{ fontFamily: MONO, fontSize: 8, color: "#6f7180", border: "1px solid rgba(255,255,255,.14)", borderRadius: 4, padding: "1px 5px" }}>OUT</span>
                      )}
                    </div>
                    <span style={{ fontFamily: MONO, fontSize: 9, color: "#6f7180" }}>
                      {m.matches.toLocaleString("en-US")} MATCHES
                    </span>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      {m.top.length ? m.top.map((b, i) => (
                        <div key={b.key} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
                          <span style={{ color: "#c9c9d6" }}>{i + 1}. {b.name}</span>
                          <span style={{ fontFamily: MONO, color: CHART_COLORS.green }}>{b.winRate.toFixed(1)}%</span>
                        </div>
                      )) : <span style={{ fontSize: 11, color: "#6f7180" }}>Not enough games yet.</span>}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── detail ───────────────────────────────────────────────────────────────────

export function MapDetailPage() {
  const { mapSlug: slug } = useParams();
  const back = useSmartBack("/maps", "Maps");
  const { rows, pool, loading, error } = useMapStats(CURRENT_PATCH);
  const [bracket, setBracket] = useState("masters_legendary");

  const mapName = useMemo(
    () => [...new Set(rows.map(r => r.map))].find(n => mapSlug(n) === slug) || null,
    [rows, slug]);
  const mode = useMemo(() => rows.find(r => r.map === mapName)?.mode, [rows, mapName]);
  const history = useMapHistory(mapName, bracket, CURRENT_PATCH);

  const table = useMemo(
    () => (mapName ? buildTable(rows, mapName, bracket) : { matches: 0, brawlers: [] }),
    [rows, mapName, bracket]);

  const ranked = useMemo(
    () => table.brawlers.filter(b => b.picks >= MIN_PICKS).sort((a, b) => b.winRate - a.winRate),
    [table]);

  // Class performance on this map, weighted by picks so one 40-game specialist
  // cannot outvote a class that is played thousands of times.
  const byClass = useMemo(() => {
    const acc = {};
    for (const b of table.brawlers) {
      if (b.picks < MIN_PICKS) continue;
      const c = acc[b.cls] = acc[b.cls] || { picks: 0, wins: 0 };
      c.picks += b.picks; c.wins += (b.winRate / 100) * b.picks;
    }
    return Object.entries(acc)
      .map(([label, v]) => ({ label, value: (v.wins / v.picks) * 100, sub: `${Math.round(v.picks).toLocaleString("en-US")} picks` }))
      .sort((a, b) => b.value - a.value);
  }, [table]);

  const trend = useMemo(() => {
    if (!history.length || !ranked.length) return [];
    const top = ranked.slice(0, 3).map(b => b.key);
    const palette = [CHART_COLORS.green, CHART_COLORS.blue, CHART_COLORS.amber];
    return top.map((key, i) => ({
      label: formatBrawlerName(key), color: palette[i],
      points: history.filter(h => String(h.brawler).toUpperCase() === key && h.win_rate != null)
        .map(h => ({ x: new Date(h.day).getTime(), y: Number(h.win_rate) })),
    })).filter(s => s.points.length);
  }, [history, ranked]);

  const inRotation = pool.find(p => mapSlug(p.map_name) === slug)?.in_rotation;

  if (!loading && !mapName) {
    return (
      <div style={{ minHeight: "100vh", background: "#0c0c12", color: "#e9e9f2" }}>
        <SiteHeader />
        <div style={{ maxWidth: 700, margin: "0 auto", padding: "60px 16px", textAlign: "center" }}>
          <h1 style={{ fontFamily: DISPLAY, fontSize: 24 }}>No data for this map</h1>
          <p style={{ color: "#8b8b9c", fontSize: 13.5, lineHeight: 1.6 }}>
            {error ? `Stats could not be loaded: ${error}` : "It may have rotated out before we collected any ranked games on it."}
          </p>
          <Link to="/maps" style={{ color: "#7cc4ff", fontSize: 13 }}>← All maps</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0c0c12", color: "#e9e9f2" }}>
      <SiteHeader />
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "18px 16px 60px", display: "flex", flexDirection: "column", gap: 16 }}>
        <button onClick={back.goBack} style={{ alignSelf: "flex-start", background: "none", border: "none", color: "#7cc4ff", fontSize: 12.5, cursor: "pointer", padding: 0 }}>
          ← {back.label}
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 11, flexWrap: "wrap" }}>
          {MODE_ICONS[mode] && <img src={MODE_ICONS[mode]} alt="" width={30} height={30} style={{ objectFit: "contain" }} />}
          <div>
            <div style={eyebrow}>
              {formatMode(mode).toUpperCase()} · {table.matches.toLocaleString("en-US")} MATCHES
              {inRotation === false ? " · OUT OF ROTATION" : ""}
            </div>
            <h1 style={{ fontFamily: DISPLAY, fontSize: 28, fontWeight: 800, margin: "2px 0 0" }}>
              {mapName || "…"}
            </h1>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {BRACKETS.map(b => (
            <button key={b.id} onClick={() => setBracket(b.id)} style={{
              fontFamily: MONO, fontSize: 10, letterSpacing: 1, cursor: "pointer", padding: "7px 13px",
              borderRadius: 8, color: bracket === b.id ? "#0c0c12" : "#8b8b9c",
              background: bracket === b.id ? "#7cc4ff" : "rgba(255,255,255,.04)",
              border: `1px solid ${bracket === b.id ? "#7cc4ff" : "rgba(255,255,255,.12)"}`,
            }}>{b.label.toUpperCase()}</button>
          ))}
        </div>

        {loading && <div style={{ ...card, color: "#8b8b9c", fontSize: 13 }}>Loading…</div>}

        {!loading && (
          <>
            <div style={card}>
              <div>
                <div style={eyebrow}>THE SHAPE OF THIS MAP'S META</div>
                <p style={{ fontSize: 12.5, color: "#8b8b9c", lineHeight: 1.6, margin: "5px 0 0" }}>
                  Every brawler with {MIN_PICKS}+ games here, plotted by how often it is picked against how
                  often it wins. The dashed lines are the medians of this map, not a hardcoded 50% — half the
                  field sitting under an arbitrary line would misread as a broken meta. Hover any dot.
                </p>
              </div>
              <ScatterChart
                points={ranked.map(b => ({
                  x: b.pickRate, y: b.winRate, label: b.name,
                  highlight: b.pickRate > 12 || b.winRate >= (ranked[2]?.winRate ?? 99),
                }))}
                emptyMessage={`No brawler has ${MIN_PICKS}+ games on this map in this bracket yet.`}
              />
            </div>

            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(330px,1fr))" }}>
              <div style={card}>
                <div style={eyebrow}>STRONGEST HERE · TOP 12</div>
                <BarList rows={ranked.slice(0, 12).map(b => ({
                  label: b.name, value: b.winRate, sub: `${b.picks.toLocaleString("en-US")}` }))} />
              </div>
              <div style={card}>
                <div style={eyebrow}>WEAKEST HERE · BOTTOM 12</div>
                <BarList rows={ranked.slice(-12).reverse().map(b => ({
                  label: b.name, value: b.winRate, sub: `${b.picks.toLocaleString("en-US")}` }))} />
              </div>
            </div>

            <div style={card}>
              <div>
                <div style={eyebrow}>WHICH ROLES WIN HERE</div>
                <p style={{ fontSize: 12.5, color: "#8b8b9c", lineHeight: 1.6, margin: "5px 0 0" }}>
                  Draft class win rate on this map, weighted by picks so one niche specialist cannot outvote a
                  class played thousands of times. This is the fastest read on what the map actually rewards.
                </p>
              </div>
              <BarList rows={byClass} emptyMessage="Not enough games to break down by role yet." />
            </div>

            <div style={card}>
              <div>
                <div style={eyebrow}>WIN RATE OVER TIME · TOP 3</div>
                <p style={{ fontSize: 12.5, color: "#8b8b9c", lineHeight: 1.6, margin: "5px 0 0" }}>
                  Daily snapshots of this map's meta. Match storage is a rolling window that drops its oldest
                  games, so these snapshots are the only lasting record — the line grows one point per day from
                  the day the snapshot job started.
                </p>
              </div>
              <TrendChart
                series={trend}
                emptyMessage="History starts collecting today — a trend line needs at least two days of snapshots."
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
