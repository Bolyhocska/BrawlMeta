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
import { supabase, formatBrawlerName, MODE_COLORS, formatMode, CURRENT_PATCH } from "./appCore";
import { computeWinSplit } from "./data/draftEngine";
import { toSeries, bestSwap, loadIntelligence, loadMapStats, DEFAULT_BRACKET } from "./data/playerStats";
import PlayerInsights from "./PlayerInsights";
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
        const [{ data: brawlers }, { data: maps }, { data: patches }, { data: brackets }] = await Promise.all([
          supabase.from("brawlers").select("id,name"),
          supabase.from("maps").select("id,name,mode"),
          supabase.from("patches").select("id,name"),
          supabase.from("rank_brackets").select("id,name"),
        ]);
        const bById = Object.fromEntries((brawlers || []).map(b => [b.id, b.name]));
        const mById = Object.fromEntries((maps || []).map(m => [m.id, m]));
        const pById = Object.fromEntries((patches || []).map(x => [x.id, x.name]));
        const rById = Object.fromEntries((brackets || []).map(x => [x.id, x.name]));

        const [{ data: rows, error }, { data: trackedRows }] = await Promise.all([
          supabase
            .from("player_matches")
            .select("match_key,battle_time,map_id,brawler_id,patch_id,bracket_id,result,is_star_player,team_brawlers,enemy_brawlers,team_tags,enemy_tags")
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
          patch: pById[r.patch_id] || CURRENT_PATCH,
          // The API exposes no per-match rank tier, so bracket_id is NULL for
          // anyone we did not seed from a known list. Fall back to the Masters
          // aggregate — it is by far the largest sample — and SAY SO in the UI
          // rather than quietly grading a Diamond game against Masters data.
          bracket: rById[r.bracket_id] || null,
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

// Series grouping now lives in data/playerStats.js so the profile page and the
// insight panels can never disagree about what counts as one draft.

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

// ── the draft verdict ────────────────────────────────────────────────────────
// The most defensible thing this site can show on a match: not what happened,
// but whether the draft that produced it was any good. It runs the SAME
// computeWinSplit the Draft Assistant grades a live draft with, over the same
// aggregate — so a verdict here and a verdict there can never disagree.
//
// It needs no depth in the player's own history: one match plus a 1.8M-row
// aggregate is enough. That is why this ships before the Phase 3 statistics,
// which do need depth and do not have it yet.

// Aggregate loading and caching live in data/playerStats.js — the same caches
// the insight panels use, so expanding a verdict here warms the data the
// Above Draft chart needs and neither page fetches twice.

function verdictLine(mine, won) {
  const edge = mine - 50;
  const split = `${Math.round(mine)}/${100 - Math.round(mine)}`;
  if (Math.abs(edge) < 4) {
    return won
      ? `An even draft at ${split} — this one was decided by play, not picks.`
      : `An even draft at ${split} — the picks didn't lose this, so look at the play.`;
  }
  if (edge > 0) {
    return won
      ? `You were favoured at ${split}, and converted it.`
      : `You were favoured at ${split} and lost it — that's a game the draft had already given you.`;
  }
  return won
    ? `You were the underdog at ${split} and won anyway.`
    : `You were the underdog at ${split}. This was lost in the draft, not on the map.`;
}

function DraftVerdict({ s, won }) {
  const [state, setState] = useState({ loading: true, split: null, swap: null, error: null });
  const bracket = s.bracket || DEFAULT_BRACKET;
  const assumedBracket = !s.bracket;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [intelligence, mapStats] = await Promise.all([
          loadIntelligence(s.patch, bracket),
          loadMapStats(s.map, s.patch, bracket),
        ]);
        if (cancelled) return;
        const split = computeWinSplit({
          blueTeam: s.teamNames,
          redTeam: s.enemyNames,
          mode: s.mode,
          mapStats,
          intelligence,
        });
        // DR-3: rank every legal alternative in the player's own slot. Only
        // returns something when their pick was in the bottom slice of options
        // — see the note on PICK_PERCENTILE_MAX in playerStats.js.
        const swap = bestSwap(s, mapStats, intelligence, Number(split.blue));
        setState({ loading: false, split, swap, error: null });
      } catch (e) {
        if (!cancelled) setState({ loading: false, split: null, swap: null, error: e.message });
      }
    })();
    return () => { cancelled = true; };
  }, [s.key, bracket]);

  if (state.loading) {
    return <div style={{ fontFamily: MONO, fontSize: 11, color: "#6f7180", padding: "10px 2px" }}>Grading the draft…</div>;
  }
  if (state.error || !state.split) {
    return <div style={{ fontFamily: MONO, fontSize: 11, color: "#8a8a9c", padding: "10px 2px" }}>
      Couldn't grade this draft — no aggregate for {s.map} on patch {s.patch}.
    </div>;
  }

  const mine = Number(state.split.blue);
  const theirs = state.split.red;
  // finalSanityCheck reports missing structural ROLES — a mid holder, a lane
  // anchor, the mode's objective specialist — not brawlers with thin data.
  // (Checked: it returns strings like "lane anchor", not brawler names.) That
  // is the more useful thing to say after the fact anyway: a comp with no
  // anchor lost for a reason a player can act on next time.
  const myGaps = state.split.blueSanity?.missing || [];
  const theirGaps = state.split.redSanity?.missing || [];

  return (
    <div style={{ paddingTop: 12, marginTop: 12, borderTop: "1px solid rgba(255,255,255,.08)" }}>
      <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: 1.8, color: "#6f7180", marginBottom: 8 }}>
        DRAFT VERDICT
      </div>

      <div style={{ display: "flex", height: 9, borderRadius: 999, overflow: "hidden", marginBottom: 8 }}>
        <div style={{ width: `${mine}%`, background: "linear-gradient(90deg,#7cc4ff,#9a8fc0)" }} />
        <div style={{ width: `${theirs}%`, background: "rgba(255,143,143,.55)" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: MONO, fontSize: 11, marginBottom: 10 }}>
        <span style={{ color: "#7cc4ff" }}>YOUR COMP {mine.toFixed(0)}%</span>
        <span style={{ color: "#ff8f8f" }}>{theirs.toFixed(0)}% THEIRS</span>
      </div>

      <div style={{ fontSize: 13.5, lineHeight: 1.7, color: "#c9c9d6" }}>
        {verdictLine(mine, won)}
      </div>

      {(myGaps.length > 0 || theirGaps.length > 0) && (
        <div style={{ marginTop: 10, display: "flex", gap: 7, flexWrap: "wrap" }}>
          {myGaps.map(g => (
            <span key={`m${g}`} style={{
              fontFamily: MONO, fontSize: 10, padding: "5px 10px", borderRadius: 999,
              background: "rgba(255,143,143,.10)", border: "1px solid rgba(255,143,143,.28)", color: "#ff8f8f",
            }}>your comp had no {g}</span>
          ))}
          {theirGaps.map(g => (
            <span key={`t${g}`} style={{
              fontFamily: MONO, fontSize: 10, padding: "5px 10px", borderRadius: 999,
              background: "rgba(142,230,176,.09)", border: "1px solid rgba(142,230,176,.26)", color: "#8ee6b0",
            }}>they had no {g}</span>
          ))}
        </div>
      )}

      {state.swap && (
        <div style={{
          marginTop: 11, padding: "12px 14px", borderRadius: 11,
          background: "rgba(124,196,255,.07)", border: "1px solid rgba(124,196,255,.24)",
        }}>
          <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 1.6, color: "#7cc4ff", marginBottom: 6 }}>
            THE PICK THAT WAS THERE
          </div>
          <div style={{ fontSize: 13.5, lineHeight: 1.65, color: "#c9c9d6" }}>
            {formatBrawlerName(s.brawler)} was rated below {Math.round((1 - state.swap.percentile) * 100)}% of
            the options on {s.map}. Swapping to <strong style={{ color: "#e9e9f2" }}>{formatBrawlerName(state.swap.name)}</strong>{" "}
            grades this draft {state.swap.to.toFixed(0)}/{(100 - state.swap.to).toFixed(0)} instead
            of {state.swap.from.toFixed(0)}/{(100 - state.swap.from).toFixed(0)}.
          </div>
          <div style={{ fontFamily: MONO, fontSize: 9.5, color: "#5a5a6a", marginTop: 7, lineHeight: 1.6 }}>
            A straight swap with the other five held fixed — we don't know draft order, so this is
            not "you should have counter-picked". It also can't see bans or which brawlers you own.
          </div>
        </div>
      )}

      <div style={{ fontFamily: MONO, fontSize: 10, color: "#5a5a6a", marginTop: 9, lineHeight: 1.6 }}>
        Matchup edge only — measured win rates on {s.map} plus head-to-head data, not player skill.
        {assumedBracket && " Graded against Masters data, since this match's rank tier is unknown."}
      </div>
    </div>
  );
}

function SeriesCard({ s }) {
  const [open, setOpen] = useState(false);
  const wins = s.rounds.filter(r => r.result === 1).length;
  const losses = s.rounds.length - wins;
  const won = wins > losses;
  const modeColor = MODE_COLORS[s.mode] || "#9a8fc0";
  const when = new Date(s.newest);
  const star = s.rounds.some(r => r.is_star_player === true);

  return (
    <div style={{
      padding: "12px 14px", borderRadius: 12, marginBottom: 8,
      background: won ? "rgba(142,230,176,.05)" : "rgba(255,143,143,.04)",
      border: `1px solid ${won ? "rgba(142,230,176,.20)" : "rgba(255,143,143,.16)"}`,
      borderLeft: `3px solid ${won ? "#8ee6b0" : "#ff8f8f"}`,
    }}>
    <div
      role="button" tabIndex={0}
      onClick={() => setOpen(o => !o)}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(o => !o); } }}
      style={{
        display: "grid", gridTemplateColumns: "auto minmax(0,1fr) auto", gap: 14,
        alignItems: "center", cursor: "pointer",
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
        <div style={{ fontFamily: MONO, fontSize: 9, color: open ? "#c9a6ff" : "#5a5a6a", marginTop: 4, letterSpacing: 1 }}>
          {open ? "HIDE ▲" : "VERDICT ▼"}
        </div>
      </div>
    </div>

    {open && <DraftVerdict s={s} won={won} />}
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

  const series = useMemo(() => toSeries(rows), [rows]);
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

        <PlayerInsights rows={rows} tracked={tracked} selfTag={tag}
          onOpenPlayer={(t) => navigate(`/player/${t.replace("#", "")}`)} />

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
