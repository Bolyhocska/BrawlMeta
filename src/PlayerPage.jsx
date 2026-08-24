// ─── /player/:tag — a player's profile and stored match history ──────────────
// Phase 2 of the player-stat plan ("make it visible"). Deliberately NOT the
// analytical layer: "you vs the world", session/tilt analysis and personal
// matchup tables are Phase 3, and they need volume this database does not have
// yet (as of 2026-08-24 the average tracked player has ~17 stored matches,
// because most have been polled once). Shipping the statistics now would mean
// computing a per-brawler win rate off two games, which is exactly the kind of
// confident-sounding noise the rest of this site refuses to print.
//
// Two data sources, for two different reasons:
//   · the LIVE header comes from /api/player, because the browser cannot call
//     the Supercell API (key + IP allowlist). It works for any tag, including
//     one we have never seen, so the page is never blank.
//   · the HISTORY comes straight from Supabase with the anon key. player_matches
//     has a public-read RLS policy, and this is how the rest of the app reads
//     data — no serverless function in between to keep in sync.

import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import SiteHeader from "./SiteHeader";
import { supabase, formatBrawlerName, MODE_COLORS, formatMode } from "./appCore";
import BRAWLER_META from "./data/brawlerMeta.json";

const MONO = "'JetBrains Mono', monospace";
const DISPLAY = "'Baloo 2', sans-serif";

const normalizeTag = (raw) => `#${String(raw || "").toUpperCase().replace(/[^0-9A-Z]/g, "")}`;

const brawlerArt = (name) => BRAWLER_META[String(name || "").toUpperCase()]?.imageUrl || null;

// ── data ─────────────────────────────────────────────────────────────────────

function usePlayerHistory(tag) {
  const [state, setState] = useState({ loading: true, rows: [], tracked: null, error: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setState(s => ({ ...s, loading: true }));
      try {
        const [{ data: brawlers }, { data: maps }] = await Promise.all([
          supabase.from("brawlers").select("id,name"),
          supabase.from("maps").select("id,name,mode"),
        ]);
        const bById = Object.fromEntries((brawlers || []).map(b => [b.id, b.name]));
        const mById = Object.fromEntries((maps || []).map(m => [m.id, m]));

        const [{ data: rows, error }, { data: trackedRows }] = await Promise.all([
          supabase
            .from("player_matches")
            .select("match_key,battle_time,map_id,brawler_id,result,is_star_player,team_brawlers,enemy_brawlers,team_tags,enemy_tags")
            .eq("player_tag", tag)
            .order("battle_time", { ascending: false })
            .limit(300),
          supabase
            .from("tracked_players")
            .select("player_tag,boosted,opted_out,last_seen_name,first_seen_at")
            .eq("player_tag", tag)
            .limit(1),
        ]);
        if (error) throw error;
        if (cancelled) return;

        const hydrated = (rows || []).map(r => ({
          ...r,
          brawler: bById[r.brawler_id] || "?",
          map: mById[r.map_id]?.name || "Unknown",
          mode: mById[r.map_id]?.mode || "",
          teamNames: (r.team_brawlers || []).map(id => bById[id] || "?"),
          enemyNames: (r.enemy_brawlers || []).map(id => bById[id] || "?"),
        }));
        setState({ loading: false, rows: hydrated, tracked: trackedRows?.[0] || null, error: null });
      } catch (e) {
        if (!cancelled) setState({ loading: false, rows: [], tracked: null, error: e.message });
      }
    })();
    return () => { cancelled = true; };
  }, [tag]);

  return state;
}

// Consecutive rows sharing a map and the same six brawlers, close together in
// time, are the rounds of ONE Ranked series — the game keeps the draft and
// replays it. Stored separately on purpose (a player's history needs every
// round), but listing them as three near-identical entries reads like a bug, so
// they are folded into one card that shows the rounds it contains.
const SERIES_GAP_MS = 15 * 60 * 1000;

function groupIntoSeries(rows) {
  const out = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    const sameLineup =
      last &&
      last.map === r.map &&
      last.teamNames.join() === r.teamNames.join() &&
      last.enemyNames.join() === r.enemyNames.join() &&
      Math.abs(new Date(last.oldest).getTime() - new Date(r.battle_time).getTime()) <= SERIES_GAP_MS;
    if (sameLineup) {
      last.rounds.push(r);
      last.oldest = r.battle_time;
    } else {
      out.push({
        key: r.match_key,
        map: r.map, mode: r.mode, brawler: r.brawler,
        teamNames: r.teamNames, enemyNames: r.enemyNames,
        newest: r.battle_time, oldest: r.battle_time,
        rounds: [r],
      });
    }
  }
  return out;
}

// ── presentation ─────────────────────────────────────────────────────────────

function BrawlerChip({ name, size = 26, dim = false }) {
  const art = brawlerArt(name);
  return (
    <span title={formatBrawlerName(name)} style={{
      width: size, height: size, borderRadius: 8, flexShrink: 0, overflow: "hidden",
      background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.10)",
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      opacity: dim ? .55 : 1,
    }}>
      {art
        ? <img src={art} alt="" width={size} height={size} style={{ objectFit: "cover" }} loading="lazy" />
        : <span style={{ fontFamily: MONO, fontSize: 9, color: "#8a8a9c" }}>{String(name).slice(0, 2)}</span>}
    </span>
  );
}

function Stat({ label, value, color = "#e9e9f2", sub }) {
  return (
    <div style={{
      padding: "13px 15px", borderRadius: 12, background: "rgba(255,255,255,.03)",
      border: "1px solid rgba(255,255,255,.07)", minWidth: 0,
    }}>
      <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: 1.6, color: "#6f7180" }}>{label}</div>
      <div style={{ fontFamily: DISPLAY, fontSize: 22, fontWeight: 800, color, marginTop: 3 }}>{value}</div>
      {sub && <div style={{ fontFamily: MONO, fontSize: 10, color: "#5a5a6a", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function SeriesCard({ s }) {
  const wins = s.rounds.filter(r => r.result === 1).length;
  const losses = s.rounds.length - wins;
  const won = wins > losses;
  const modeColor = MODE_COLORS[s.mode] || "#9a8fc0";
  const when = new Date(s.newest);
  const star = s.rounds.some(r => r.is_star_player === true);

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "auto minmax(0,1fr) auto", gap: 14, alignItems: "center",
      padding: "12px 14px", borderRadius: 12, marginBottom: 8,
      background: won ? "rgba(142,230,176,.05)" : "rgba(255,143,143,.04)",
      border: `1px solid ${won ? "rgba(142,230,176,.20)" : "rgba(255,143,143,.16)"}`,
      borderLeft: `3px solid ${won ? "#8ee6b0" : "#ff8f8f"}`,
    }}>
      <BrawlerChip name={s.brawler} size={38} />

      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontFamily: DISPLAY, fontSize: 15, fontWeight: 700, color: "#e9e9f2" }}>
            {formatBrawlerName(s.brawler)}
          </span>
          {star && <span title="Star player" style={{ fontSize: 11 }}>⭐</span>}
          <span style={{ fontFamily: MONO, fontSize: 10, color: modeColor, letterSpacing: 1 }}>
            {formatMode(s.mode).toUpperCase()}
          </span>
          <span style={{ fontFamily: MONO, fontSize: 10.5, color: "#8a8a9c" }}>{s.map}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 7, flexWrap: "wrap" }}>
          {s.teamNames.map((n, i) => <BrawlerChip key={`t${i}`} name={n} size={22} />)}
          <span style={{ fontFamily: MONO, fontSize: 10, color: "#5a5a6a", margin: "0 4px" }}>VS</span>
          {s.enemyNames.map((n, i) => <BrawlerChip key={`e${i}`} name={n} size={22} dim />)}
        </div>
      </div>

      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{
          fontFamily: DISPLAY, fontSize: 17, fontWeight: 800,
          color: won ? "#8ee6b0" : "#ff8f8f",
        }}>
          {s.rounds.length > 1 ? `${wins}–${losses}` : (won ? "WIN" : "LOSS")}
        </div>
        <div style={{ fontFamily: MONO, fontSize: 9.5, color: "#5a5a6a", marginTop: 2 }}>
          {s.rounds.length > 1 ? `${s.rounds.length} rounds · ` : ""}
          {when.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </div>
      </div>
    </div>
  );
}

function TrackingBox({ tag, tracked, historyCount }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const call = async (action) => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/track-player", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag, action }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(body.message || "That didn't work — try again."); return; }
      setState(action === "boost" ? "boosted" : "untracked");
    } catch { setErr("That didn't work — try again."); }
    finally { setBusy(false); }
  };

  const box = {
    padding: "14px 16px", borderRadius: 12, marginBottom: 18,
    background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)",
    fontFamily: MONO, fontSize: 11.5, lineHeight: 1.7, color: "#8a8a9c",
  };

  if (state === "untracked") {
    return <div style={box}>Tracking stopped and stored history deleted. This tag won't be re-added by future lookups.</div>;
  }
  if (state === "boosted" || tracked?.boosted) {
    return (
      <div style={{ ...box, borderColor: "rgba(142,230,176,.32)", background: "rgba(142,230,176,.07)", color: "#8ee6b0" }}>
        ⚡ Boosted — this profile updates several times a day and records trophy history.
      </div>
    );
  }

  return (
    <div style={box}>
      <div style={{ marginBottom: 10 }}>
        {historyCount > 0
          ? <>We're recording this profile's ranked matches — free, and it stays free.</>
          : <>This profile is now being tracked. Matches played from here on will appear below.</>}
      </div>
      <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
        <button onClick={() => call("boost")} disabled={busy} style={{
          fontFamily: MONO, fontSize: 11, letterSpacing: 1.2, cursor: busy ? "default" : "pointer",
          padding: "8px 15px", borderRadius: 999, color: "#0d0d14", fontWeight: 700,
          background: "linear-gradient(135deg,#ffce7a,#ffb43d)", border: "none", opacity: busy ? .6 : 1,
        }}>⚡ BOOST TRACKING</button>
        <button onClick={() => call("untrack")} disabled={busy} style={{
          fontFamily: MONO, fontSize: 11, letterSpacing: 1.2, cursor: busy ? "default" : "pointer",
          padding: "8px 15px", borderRadius: 999, color: "#8a8a9c",
          background: "transparent", border: "1px solid rgba(255,255,255,.14)", opacity: busy ? .6 : 1,
        }}>STOP TRACKING</button>
      </div>
      <div style={{ marginTop: 9, fontSize: 10.5, color: "#6f7180" }}>
        Boost checks this profile every few hours instead of twice a day and adds trophy progression.
        It's free — <Link to="/privacy" style={{ color: "#9a8fc0" }}>how we handle your data</Link>.
      </div>
      {err && <div style={{ marginTop: 8, color: "#ff8f8f" }}>{err}</div>}
    </div>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function PlayerPage() {
  const { tag: rawTag } = useParams();
  const navigate = useNavigate();
  const tag = normalizeTag(rawTag);

  const [live, setLive] = useState(null);
  const [liveErr, setLiveErr] = useState(null);
  const { loading, rows, tracked } = usePlayerHistory(tag);

  useEffect(() => {
    let cancelled = false;
    setLive(null); setLiveErr(null);
    fetch(`/api/player?tag=%23${tag.slice(1)}`)
      .then(r => r.json().then(b => ({ ok: r.ok, b })))
      .then(({ ok, b }) => { if (!cancelled) ok ? setLive(b) : setLiveErr(b.message || "Lookup failed."); })
      .catch(() => { if (!cancelled) setLiveErr("Lookup failed."); });
    return () => { cancelled = true; };
  }, [tag]);

  const series = useMemo(() => groupIntoSeries(rows), [rows]);
  const wins = rows.filter(r => r.result === 1).length;
  const wr = rows.length ? (wins / rows.length) * 100 : null;
  const starGames = rows.filter(r => r.is_star_player === true).length;
  const starKnown = rows.filter(r => r.is_star_player !== null).length;

  const name = live?.name || tracked?.last_seen_name || tag;

  return (
    <div style={{
      position: "relative", minHeight: "100vh", background: "#08080c",
      backgroundImage: "linear-gradient(rgba(179,107,255,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(179,107,255,.04) 1px, transparent 1px)",
      backgroundSize: "44px 44px", color: "#e9e9f2",
      fontFamily: "'Chakra Petch', sans-serif", WebkitFontSmoothing: "antialiased",
    }}>
      <SiteHeader />
      <div style={{ position: "relative", zIndex: 2, maxWidth: 880, margin: "0 auto", padding: "34px 5vw 60px" }}>

        <button onClick={() => navigate("/app?tab=leaderboards")} style={{
          fontFamily: MONO, fontSize: 11, letterSpacing: 1.4, color: "#8a8a9c",
          background: "transparent", border: "none", cursor: "pointer", padding: 0, marginBottom: 18,
        }}>← LEADERBOARDS</button>

        {/* Header — always renders, even for a tag we have never stored */}
        <div style={{
          display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
          padding: "18px 20px", borderRadius: 16, marginBottom: 18,
          background: "linear-gradient(160deg, rgba(179,107,255,.10), rgba(13,13,20,.6))",
          border: "1px solid rgba(179,107,255,.30)",
        }}>
          {live?.iconId && (
            <img src={`https://cdn.brawlify.com/profile-icons/regular/${live.iconId}.png`} alt=""
              width={54} height={54} loading="lazy"
              style={{ borderRadius: 14, border: "2px solid rgba(179,107,255,.5)" }}
              onError={e => { e.currentTarget.style.display = "none"; }} />
          )}
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontFamily: DISPLAY, fontSize: 26, fontWeight: 800, lineHeight: 1.1 }}>{name}</div>
            <div style={{ fontFamily: MONO, fontSize: 11, color: "#8a7fa6", marginTop: 3 }}>
              {tag}{live?.club ? ` · ${live.club}` : ""}
            </div>
          </div>
          {live && (
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: 1.4, color: "#6f7180" }}>TROPHIES</div>
                <div style={{ fontFamily: DISPLAY, fontSize: 20, fontWeight: 800, color: "#ffce7a" }}>
                  🏆 {live.trophies.toLocaleString("en-US")}
                </div>
              </div>
              <div>
                <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: 1.4, color: "#6f7180" }}>3V3 WINS</div>
                <div style={{ fontFamily: DISPLAY, fontSize: 20, fontWeight: 800, color: "#8ee6b0" }}>
                  {live.victories3v3.toLocaleString("en-US")}
                </div>
              </div>
            </div>
          )}
        </div>

        {liveErr && (
          <div style={{
            padding: "12px 15px", borderRadius: 10, marginBottom: 18, fontFamily: MONO, fontSize: 11.5,
            background: "rgba(255,143,143,.07)", border: "1px solid rgba(255,143,143,.25)", color: "#ff8f8f",
          }}>{liveErr}</div>
        )}

        <TrackingBox tag={tag} tracked={tracked} historyCount={rows.length} />

        {/* Record from stored history */}
        {rows.length > 0 && (
          <div style={{
            display: "grid", gap: 10, marginBottom: 22,
            gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
          }}>
            <Stat label="RANKED RECORD" value={`${wins}–${rows.length - wins}`} />
            <Stat label="WIN RATE" value={`${wr.toFixed(1)}%`} color={wr >= 50 ? "#8ee6b0" : "#ff8f8f"}
                  sub={`${rows.length} match${rows.length === 1 ? "" : "es"} tracked`} />
            <Stat label="SERIES" value={series.length} sub="drafts played" />
            {starKnown > 0 && (
              <Stat label="STAR PLAYER" value={`${((starGames / starKnown) * 100).toFixed(0)}%`}
                    color="#ffce7a" sub={`of ${starKnown} known`} />
            )}
          </div>
        )}

        {/* History */}
        <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 2, color: "#6f7180", margin: "0 0 12px" }}>
          [ MATCH HISTORY ]
        </div>

        {loading && <div style={{ fontFamily: MONO, fontSize: 12, color: "#6f7180" }}>Loading history…</div>}

        {!loading && rows.length === 0 && (
          <div style={{
            padding: "22px 20px", borderRadius: 14, textAlign: "center",
            background: "rgba(255,255,255,.02)", border: "1px dashed rgba(255,255,255,.12)",
          }}>
            <div style={{ fontFamily: DISPLAY, fontSize: 17, fontWeight: 700, marginBottom: 6 }}>
              No stored matches yet
            </div>
            <div style={{ fontFamily: MONO, fontSize: 11.5, color: "#8a8a9c", lineHeight: 1.75, maxWidth: 430, margin: "0 auto" }}>
              We started tracking this profile today. The Brawl Stars API only exposes recent
              battles, so history builds from now on — check back after a few ranked games.
            </div>
          </div>
        )}

        {!loading && series.map(s => <SeriesCard key={s.key} s={s} />)}

        {rows.length >= 300 && (
          <div style={{ fontFamily: MONO, fontSize: 10.5, color: "#5a5a6a", marginTop: 10 }}>
            Showing the 300 most recent matches.
          </div>
        )}

        {rows.length > 0 && (
          <div style={{ fontFamily: MONO, fontSize: 10.5, color: "#5a5a6a", marginTop: 16, lineHeight: 1.7 }}>
            Tracked since {tracked?.first_seen_at
              ? new Date(tracked.first_seen_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
              : "recently"}. Competitive Ranked only — trophy and friendly games are not recorded.
            This is not a complete record of every game played.
          </div>
        )}
      </div>
    </div>
  );
}
