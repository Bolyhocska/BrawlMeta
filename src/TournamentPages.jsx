// ─── Tournament pages ────────────────────────────────────────────────────────
// Free-entry automated tournaments: browse → register (email + player tag +
// team) → bracket goes live → check in → play → press "Verify results" and
// the backend reads the Supercell battle log to advance the winner. No entry
// fees anywhere — prize pools are funded by premium subs & whitelabel fees.
//
// Reads go straight to Supabase (public-read RLS); writes go through the two
// security-definer RPCs (register / check-in) and the Vercel verify endpoint.

import { useState, useEffect, useMemo, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { Trophy, Users, ShieldCheck, Clock, Swords, Wallet, ChevronRight, CheckCircle2, AlertTriangle, LogIn } from "lucide-react";
import SiteHeader from "./SiteHeader";
import SiteFooter from "./SiteFooter";
import { supabase } from "./appCore";
import { useAuth } from "./auth";
import { groupIntoTeams, totalRoundsFor, roundLabel, nextPowerOfTwo, byesNeeded } from "./data/bracket";
import { normalizeTag } from "./data/verifyLogic";

const MONO = "'JetBrains Mono', monospace";
const DISPLAY = "'Baloo 2', sans-serif";
const GOLD = "#ffb43d";
const VIOLET = "#b36bff";

const page = {
  root: {
    minHeight: "100vh", background: "#08080c", fontFamily: "'Chakra Petch', sans-serif", color: "#e9e9f2", position: "relative",
    backgroundImage: "linear-gradient(rgba(179,107,255,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(179,107,255,.04) 1px, transparent 1px)",
    backgroundSize: "44px 44px",
  },
  glow: { position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, backgroundImage: "radial-gradient(1200px 500px at 70% -10%, rgba(179,107,255,0.14), transparent 70%), radial-gradient(900px 500px at 0% 110%, rgba(255,180,61,0.07), transparent 70%)" },
  wrap: { position: "relative", zIndex: 1, padding: "26px 5vw 80px", maxWidth: 1280, margin: "0 auto" },
  card: { borderRadius: 24, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)" },
  eyebrow: { fontFamily: MONO, fontSize: 11, letterSpacing: 2, color: "#c98bff" },
  input: {
    width: "100%", padding: "12px 16px", borderRadius: 999, border: "1px solid rgba(255,255,255,.12)",
    background: "rgba(13,13,20,.7)", color: "#f4f4fa", fontSize: 13.5, fontFamily: "'Chakra Petch', sans-serif", outline: "none",
    boxSizing: "border-box", // width:100% must include padding+border or inputs overflow their card
  },
  btn: {
    padding: "12px 24px", borderRadius: 999, border: "none", background: GOLD, color: "#1a1206",
    fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "'Chakra Petch', sans-serif",
    boxShadow: "0 0 22px rgba(255,180,61,.3)",
  },
  btnGhost: {
    padding: "10px 20px", borderRadius: 999, border: "1px solid rgba(179,107,255,.4)", background: "rgba(179,107,255,.1)",
    color: "#d9b8ff", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "'Chakra Petch', sans-serif",
  },
};

const STATUS_STYLE = {
  registration: { label: "REGISTRATION OPEN", color: "#8ee6b0" },
  live: { label: "LIVE", color: GOLD },
  completed: { label: "COMPLETED", color: "#94a3b8" },
  cancelled: { label: "CANCELLED", color: "#ef4444" },
};

// Start times are stored UTC; render them in the viewer's own timezone with a
// short zone label so a global audience reads one unambiguous local time.
const formatStart = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(d);
};

function Toast({ text, tone = "info" }) {
  if (!text) return null;
  const color = tone === "error" ? "#ff8f8f" : tone === "success" ? "#8ee6b0" : "#ffce7a";
  return (
    <div style={{ position: "fixed", bottom: 26, left: "50%", transform: "translateX(-50%)", zIndex: 500, padding: "12px 24px", borderRadius: 999, background: "rgba(13,13,20,.95)", border: `1px solid ${color}55`, color, fontSize: 13, fontWeight: 600, boxShadow: "0 12px 40px rgba(0,0,0,.6)", maxWidth: "88vw", textAlign: "center" }}>
      {text}
    </div>
  );
}

function useToast() {
  const [toast, setToast] = useState(null);
  const show = useCallback((text, tone) => {
    setToast({ text, tone });
    setTimeout(() => setToast(null), 5000);
  }, []);
  return [toast, show];
}

function Countdown({ deadline }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ms = deadline ? Date.parse(deadline) - now : 0;
  if (!deadline) return null;
  if (ms <= 0) return <span style={{ fontFamily: MONO, fontSize: 11, color: "#ff8f8f" }}>EXPIRED</span>;
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
  return (
    <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: ms < 120000 ? "#ff8f8f" : "#ffce7a" }}>
      <Clock size={10} style={{ verticalAlign: -1, marginRight: 4 }} />{m}:{String(s).padStart(2, "0")}
    </span>
  );
}

// ─── Landing: browse tournaments ─────────────────────────────────────────────
export function TournamentLandingPage() {
  const [tournaments, setTournaments] = useState(null);
  const [counts, setCounts] = useState({});

  useEffect(() => {
    supabase.from("Tournaments").select("*").order("created_at", { ascending: false })
      .then(({ data }) => setTournaments(data || []));
    supabase.from("Registrations").select("tournament_id")
      .then(({ data }) => {
        const c = {};
        for (const r of data || []) c[r.tournament_id] = (c[r.tournament_id] || 0) + 1;
        setCounts(c);
      });
  }, []);

  return (
    <div style={page.root}>
      <div style={page.glow} />
      <SiteHeader />
      <div style={page.wrap}>
        <div style={{ textAlign: "center", padding: "10px 0 34px", display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 9, padding: "9px 18px 9px 14px", borderRadius: 999, background: "rgba(13,13,20,.6)", border: "1px solid rgba(255,180,61,.3)", fontFamily: MONO, fontSize: 12, letterSpacing: 2.5, color: "#ffce7a" }}>
            <Trophy size={13} color={GOLD} /> TOURNAMENTS · FREE ENTRY · AUTO-VERIFIED
          </div>
          <h1 style={{ marginTop: 20, fontFamily: DISPLAY, fontSize: "clamp(40px,5.5vw,72px)", fontWeight: 700, lineHeight: .95, letterSpacing: "-1px", color: "#f4f4fa" }}>
            Play for the <span style={{ color: GOLD, textShadow: "0 0 40px rgba(255,180,61,.5)" }}>prize pool</span>
          </h1>
          <p style={{ marginTop: 14, fontSize: 14, color: "#8b8b9c", maxWidth: 560 }}>
            100% free to enter — always. Register your trio, check in, play, and the engine verifies
            results straight from the official battle log. No mods, no screenshots, no disputes.
          </p>
          <Link to="/tournaments/create" style={{ ...page.btnGhost, marginTop: 18, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Trophy size={13} /> Run your own tournament
          </Link>
        </div>

        {tournaments === null ? (
          <p style={{ color: "#475569", fontSize: 13, textAlign: "center" }}>Loading tournaments…</p>
        ) : tournaments.length === 0 ? (
          <div style={{ ...page.card, padding: "40px 24px", textAlign: "center", color: "#6f7180" }}>No tournaments yet — check back soon.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
            {tournaments.map(t => {
              const st = STATUS_STYLE[t.status] || STATUS_STYLE.registration;
              const players = counts[t.id] || 0;
              return (
                <Link key={t.id} to={`/tournaments/${t.id}`} style={{ ...page.card, overflow: "hidden", textDecoration: "none", color: "inherit", display: "flex", flexDirection: "column", transition: "border-color .15s" }}>
                  {/* Banner header — the uploaded image, or a branded gradient
                      fallback so cards stay uniform height with/without art. */}
                  <div style={{ position: "relative", height: 130, background: "linear-gradient(135deg, rgba(179,107,255,.25), rgba(255,180,61,.15))" }}>
                    {t.banner_url && (
                      <img src={t.banner_url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={e => { e.currentTarget.style.display = "none"; }} />
                    )}
                    <span style={{ position: "absolute", top: 12, left: 12, fontFamily: MONO, fontSize: 10, letterSpacing: 1.5, fontWeight: 700, color: st.color, padding: "4px 11px", borderRadius: 999, background: "rgba(8,8,12,.78)", border: `1px solid ${st.color}55` }}>{st.label}</span>
                    <span style={{ position: "absolute", top: 12, right: 12, fontFamily: MONO, fontSize: 10, color: "#e9e9f2", padding: "4px 10px", borderRadius: 999, background: "rgba(8,8,12,.78)" }}>{t.team_size}v{t.team_size}</span>
                  </div>
                  <div style={{ padding: 22, display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
                    <div style={{ fontFamily: DISPLAY, fontSize: 22, fontWeight: 700, color: "#f4f4fa", lineHeight: 1.1 }}>{t.name}</div>
                    <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontFamily: MONO, fontSize: 12 }}>
                      <span style={{ color: "#ffce7a" }}><Trophy size={11} style={{ verticalAlign: -1 }} /> ${Number(t.prize_pool_total).toLocaleString()} pool</span>
                      <span style={{ color: "#9a9aab" }}><Users size={11} style={{ verticalAlign: -1 }} /> {players} registered</span>
                    </div>
                    {t.starts_at && (
                      <span style={{ fontFamily: MONO, fontSize: 11, color: "#c98bff" }}><Clock size={10} style={{ verticalAlign: -1 }} /> {formatStart(t.starts_at)}</span>
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: "auto", color: "#d9b8ff", fontSize: 13, fontWeight: 700 }}>
                      {t.status === "registration" ? "Register free" : "View bracket"} <ChevronRight size={14} />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        <div style={{ ...page.card, marginTop: 40, padding: "22px 26px", display: "flex", gap: 22, flexWrap: "wrap", alignItems: "center" }}>
          <ShieldCheck size={22} color="#8ee6b0" style={{ flexShrink: 0 }} />
          <p style={{ fontSize: 12.5, color: "#8b8b9c", margin: 0, flex: 1, minWidth: 260 }}>
            <strong style={{ color: "#c9c9d6" }}>Fair by design:</strong> entry is always free and paid status can never buy a win —
            premium members only get priority for the bracket byes that the math already requires, plus deeper stats.
            The winner reports the result; if the other team doesn't dispute within a few minutes it advances automatically, and a quick screenshot settles anything contested.
          </p>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}

// ─── Registration form ───────────────────────────────────────────────────────
// Two paths: a captain registers their whole roster in one submission (no
// teammate accounts required), or a player queues solo and gets auto-grouped
// with other solo players into a full team when the bracket generates.
function RegistrationForm({ tournament, onRegistered, showToast }) {
  const { user, profile, openAuth, updateProfile } = useAuth();
  const [mode, setMode] = useState("team"); // "team" | "solo"
  const teamSize = tournament.team_size || 3;

  const [teamName, setTeamName] = useState("");
  const [players, setPlayers] = useState(() => Array.from({ length: teamSize }, () => ({ tag: "", name: "" })));
  const [soloTag, setSoloTag] = useState("");
  const [soloName, setSoloName] = useState("");
  const [busy, setBusy] = useState(false);

  // Prefill slot 1 (the captain) and the solo form from the signed-in profile.
  useEffect(() => {
    if (!profile) return;
    setPlayers(p => p.map((pl, i) => i === 0 ? { tag: pl.tag || profile.player_tag || "", name: pl.name || profile.display_name || "" } : pl));
    setSoloTag(t => t || profile.player_tag || "");
    setSoloName(n => n || profile.display_name || "");
  }, [profile]);

  if (!user) {
    return (
      <div style={{ ...page.card, padding: 26, display: "flex", flexDirection: "column", gap: 14, alignItems: "flex-start" }}>
        <span style={page.eyebrow}>◈ FREE REGISTRATION</span>
        <p style={{ fontSize: 13, color: "#8b8b9c", margin: 0 }}>
          Sign in to register your team — one account can enter your whole roster. Your player tag is remembered for next time.
        </p>
        <button onClick={() => openAuth("signup")} style={{ ...page.btn, display: "inline-flex", alignItems: "center", gap: 8 }}>
          <LogIn size={15} /> Sign in to register
        </button>
        <span style={{ fontFamily: MONO, fontSize: 10, color: "#5a5a6a" }}>NO ENTRY FEE · EVER</span>
      </div>
    );
  }

  const setPlayer = (i, k, v) => setPlayers(p => p.map((pl, idx) => idx === i ? { ...pl, [k]: v } : pl));

  const errMsg = (error, fallback) => {
    const code = error.message?.match(/[A-Z_]{4,}/)?.[0];
    return {
      LOGIN_REQUIRED: "Please sign in again — your session expired.",
      TAG_ALREADY_REGISTERED: "One of those player tags is already registered for this tournament.",
      INVALID_TAG: "A player tag doesn't look right — copy it from the in-game profile (e.g. #2C20JJRG).",
      MISSING_FIELDS: "Fill in every field.",
      REGISTRATION_CLOSED: "Registration is closed for this tournament.",
      WRONG_PLAYER_COUNT: `This tournament needs exactly ${teamSize} players per team.`,
      TEAM_NAME_TAKEN: "That team name is already taken — pick a different one.",
    }[code] || fallback;
  };

  const submitTeam = async (e) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc("tournament_register_team", {
      p_tournament_id: tournament.id,
      p_team_name: teamName,
      p_players: players.map(p => ({ tag: p.tag, name: p.name })),
    });
    setBusy(false);
    if (error) { showToast(errMsg(error, `Registration failed: ${error.message}`), "error"); return; }
    // Remember the captain's own tag/name (slot 1) on their profile.
    const captain = players[0];
    const patch = {};
    if (normalizeTag(captain.tag) !== (profile?.player_tag || "")) patch.player_tag = normalizeTag(captain.tag);
    if (captain.name.trim() && captain.name.trim() !== (profile?.display_name || "")) patch.display_name = captain.name.trim();
    if (Object.keys(patch).length) await updateProfile(patch);
    showToast(`Team "${teamName}" registered — all ${teamSize} players locked in!`, "success");
    onRegistered?.();
  };

  const submitSolo = async (e) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc("tournament_register_solo", {
      p_tournament_id: tournament.id,
      p_player_tag: soloTag,
      p_display_name: soloName,
    });
    setBusy(false);
    if (error) { showToast(errMsg(error, `Registration failed: ${error.message}`), "error"); return; }
    const patch = {};
    if (normalizeTag(soloTag) !== (profile?.player_tag || "")) patch.player_tag = normalizeTag(soloTag);
    if (soloName.trim() && soloName.trim() !== (profile?.display_name || "")) patch.display_name = soloName.trim();
    if (Object.keys(patch).length) await updateProfile(patch);
    showToast("Queued! You'll be auto-teamed with other solo players once the bracket is generated.", "success");
    onRegistered?.();
  };

  const tabBtn = (active) => ({
    flex: 1, padding: "9px 14px", borderRadius: 999, border: "1px solid " + (active ? "rgba(255,180,61,.4)" : "rgba(255,255,255,.1)"),
    background: active ? "rgba(255,180,61,.12)" : "transparent", color: active ? "#ffce7a" : "#8b8b9c",
    fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "'Chakra Petch', sans-serif",
  });

  return (
    <div style={{ ...page.card, padding: 26, display: "flex", flexDirection: "column", gap: 14 }}>
      <span style={page.eyebrow}>◈ FREE REGISTRATION</span>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" style={tabBtn(mode === "team")} onClick={() => setMode("team")}>REGISTER A TEAM</button>
        <button type="button" style={tabBtn(mode === "solo")} onClick={() => setMode("solo")}>JOIN SOLO</button>
      </div>

      {mode === "team" ? (
        <form onSubmit={submitTeam} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ fontSize: 12.5, color: "#8b8b9c", margin: "2px 0 4px" }}>
            Enter your whole roster at once — teammates don't need their own accounts. You're the captain (slot 1).
          </p>
          <input style={page.input} placeholder="Team name" value={teamName} onChange={e => setTeamName(e.target.value)} required maxLength={30} />
          {players.map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 8 }}>
              <input style={{ ...page.input, flex: 1 }} placeholder={i === 0 ? "Your tag (#2C20JJRG)" : `Teammate ${i + 1} tag`} value={p.tag} onChange={e => setPlayer(i, "tag", e.target.value)} required />
              <input style={{ ...page.input, flex: 1 }} placeholder={i === 0 ? "Your name" : `Teammate ${i + 1} name`} value={p.name} onChange={e => setPlayer(i, "name", e.target.value)} required maxLength={30} />
            </div>
          ))}
          <button type="submit" style={{ ...page.btn, opacity: busy ? .6 : 1 }} disabled={busy}>
            {busy ? "Registering…" : `Register Team of ${teamSize} — Free`}
          </button>
        </form>
      ) : (
        <form onSubmit={submitSolo} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ fontSize: 12.5, color: "#8b8b9c", margin: "2px 0 4px" }}>
            No squad? Queue solo and we'll auto-group you with other solo players into a full team of {teamSize} once the bracket generates.
          </p>
          <input style={page.input} placeholder="Player tag (e.g. #2C20JJRG)" value={soloTag} onChange={e => setSoloTag(e.target.value)} required />
          <input style={page.input} placeholder="Display name" value={soloName} onChange={e => setSoloName(e.target.value)} required maxLength={30} />
          <button type="submit" style={{ ...page.btn, opacity: busy ? .6 : 1 }} disabled={busy}>
            {busy ? "Joining queue…" : "Join Solo Queue — Free"}
          </button>
        </form>
      )}
      <span style={{ fontFamily: MONO, fontSize: 10, color: "#5a5a6a", textAlign: "center" }}>NO ENTRY FEE · EVER</span>
    </div>
  );
}

// ─── Match card (check-in + dual-confirmation reporting) ─────────────────────
function MatchCard({ match, myTag, onAction, showToast }) {
  const { user, session } = useAuth();
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const mine = myTag && [...(match.team_a_tags || []), ...(match.team_b_tags || [])].includes(myTag);
  const mySide = mine ? ((match.team_a_tags || []).includes(myTag) ? "A" : "B") : null;
  const myReport = mySide === "A" ? match.team_a_reported : mySide === "B" ? match.team_b_reported : null;
  const myProof = mySide === "A" ? match.team_a_proof_url : mySide === "B" ? match.team_b_proof_url : null;
  const otherSide = mySide === "A" ? "B" : mySide === "B" ? "A" : null;
  const otherReport = otherSide === "A" ? match.team_a_reported : otherSide === "B" ? match.team_b_reported : null;
  const otherProof = otherSide === "A" ? match.team_a_proof_url : otherSide === "B" ? match.team_b_proof_url : null;
  const teamName = (t) => (t === "team_a" ? match.team_a_name : match.team_b_name);
  const checkedIn = (tags) => (tags || []).filter(t => match.checkin_status?.[t]).length;
  const iCheckedIn = myTag && match.checkin_status?.[myTag];

  const authedFetch = (url, body) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      body: JSON.stringify(body),
    }).then(r => r.json().then(j => ({ ok: r.ok, status: r.status, body: j })));

  const checkin = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("tournament_checkin", { p_match_id: match.id, p_player_tag: myTag });
    setBusy(false);
    if (error) {
      const code = error.message?.match(/[A-Z_]{4,}/)?.[0];
      showToast({
        CHECKIN_EXPIRED: "Check-in window expired.",
        CHECKIN_CLOSED: "Check-in is closed for this match.",
        NOT_IN_MATCH: "Your saved tag isn't in this match.",
      }[code] || `Check-in failed: ${error.message}`, "error");
    } else {
      showToast("Checked in ✔", "success");
      onAction();
    }
  };

  // Report which team won. "winner" is a side letter relative to me: pass the
  // absolute team_a/team_b to the API.
  const report = async (winnerTeam) => {
    setBusy(true);
    const { ok, body } = await authedFetch("/api/report-result", { matchId: match.id, winner: winnerTeam });
    setBusy(false);
    if (!ok) { showToast(body.message || `Couldn't submit result: ${body.error}`, "error"); return; }
    showToast(body.message, body.status === "confirmed" ? "success" : body.status === "disputed" ? "error" : "info");
    onAction();
  };

  const uploadProof = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (file.size > 5 * 1024 * 1024) { showToast("Screenshot must be under 5 MB.", "error"); return; }
    if (!myReport) { showToast("Report who won first, then attach your proof.", "error"); return; }
    setUploading(true);
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = `${user.id}/${match.id}-${Date.now()}.${ext}`;
    const up = await supabase.storage.from("match-proof").upload(path, file, { contentType: file.type });
    if (up.error) { setUploading(false); showToast(`Upload failed: ${up.error.message}`, "error"); return; }
    const { data } = supabase.storage.from("match-proof").getPublicUrl(path);
    const { ok, body } = await authedFetch("/api/report-result", { matchId: match.id, winner: myReport, proofUrl: data.publicUrl });
    setUploading(false);
    if (!ok) { showToast(body.message || "Couldn't attach proof.", "error"); return; }
    // OCR may auto-confirm the moment the screenshot lands — surface its message.
    showToast(body.message || "Screenshot attached ✔", "success");
    onAction();
  };

  const resultBadge = match.status === "completed" && (
    <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: 1, color: "#8ee6b0", display: "inline-flex", alignItems: "center", gap: 4 }}>
      <CheckCircle2 size={11} /> {match.result === "team_a" ? match.team_a_name : match.team_b_name} WON
    </span>
  );

  const sideStyle = (isWinner, filled) => ({
    display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 12,
    background: isWinner ? "rgba(142,230,176,.08)" : "rgba(255,255,255,.03)",
    border: `1px solid ${isWinner ? "rgba(142,230,176,.3)" : "rgba(255,255,255,.06)"}`,
    color: filled ? "#f4f4fa" : "#5a5a6a", fontSize: 13, fontWeight: 700,
  });

  // A small reported-marker next to each side once they've confirmed.
  const reportMark = (side) => {
    const rep = side === "A" ? match.team_a_reported : match.team_b_reported;
    if (!rep || match.status === "completed") return null;
    return <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 9.5, color: "#8ee6b0" }}>reported ✓</span>;
  };

  return (
    <div style={{ ...page.card, padding: 16, display: "flex", flexDirection: "column", gap: 8, minWidth: 230, ...(match.disputed ? { border: "1px solid rgba(255,143,143,.45)" } : {}) }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: 1, color: "#6f7180" }}>M{match.match_number + 1}</span>
        {match.status === "bye" && <span style={{ fontFamily: MONO, fontSize: 10, color: "#9a9aab" }}>BYE — AUTO-ADVANCE</span>}
        {["pending", "checkin"].includes(match.status) && match.checkin_deadline && <Countdown deadline={match.checkin_deadline} />}
        {match.status === "active" && !match.disputed && <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: GOLD }}>● LIVE</span>}
        {match.disputed && <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: "#ff8f8f" }}>⚠ DISPUTED</span>}
        <span style={{ marginLeft: "auto" }}>{resultBadge}</span>
      </div>
      <div style={sideStyle(match.result === "team_a", match.team_a_name)}>
        {match.team_a_name || "TBD"}
        {(match.team_a_tags || []).length > 0 && ["pending", "checkin"].includes(match.status) && (
          <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10, color: "#9a9aab" }}>{checkedIn(match.team_a_tags)}/{match.team_a_tags.length} ✓</span>
        )}
        {match.status === "active" && reportMark("A")}
      </div>
      <div style={sideStyle(match.result === "team_b", match.team_b_name)}>
        {match.team_b_name || (match.status === "bye" ? "—" : "TBD")}
        {(match.team_b_tags || []).length > 0 && ["pending", "checkin"].includes(match.status) && (
          <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10, color: "#9a9aab" }}>{checkedIn(match.team_b_tags)}/{match.team_b_tags.length} ✓</span>
        )}
        {match.status === "active" && reportMark("B")}
      </div>

      {/* Check-in */}
      {mine && ["pending", "checkin"].includes(match.status) && !iCheckedIn && (
        <button style={{ ...page.btn, padding: "10px 18px", fontSize: 12, opacity: busy ? .6 : 1 }} disabled={busy} onClick={checkin}>
          {busy ? "…" : "CHECK IN"}
        </button>
      )}
      {mine && ["pending", "checkin"].includes(match.status) && iCheckedIn && (
        <span style={{ fontFamily: MONO, fontSize: 10.5, color: "#8ee6b0", textAlign: "center" }}>✓ You're checked in — waiting on the lobby</span>
      )}

      {/* Result reporting (active match, I'm a player) — single-upload + timer */}
      {mine && match.status === "active" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 2 }}>
          {/* State 1 — nobody has reported: I submit the result. */}
          {!myReport && !otherReport && (
            <>
              <span style={{ fontFamily: MONO, fontSize: 10, color: "#9a9aab", textAlign: "center" }}>WHO WON?</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button style={{ ...page.btn, flex: 1, padding: "9px 8px", fontSize: 11.5, opacity: busy ? .6 : 1 }} disabled={busy}
                  onClick={() => report(mySide === "A" ? "team_a" : "team_b")}>We won</button>
                <button style={{ ...page.btnGhost, flex: 1, padding: "9px 8px", fontSize: 11.5, opacity: busy ? .6 : 1 }} disabled={busy}
                  onClick={() => report(mySide === "A" ? "team_b" : "team_a")}>We lost</button>
              </div>
            </>
          )}

          {/* State 2 — the other team reported first: I confirm or dispute. */}
          {!myReport && otherReport && (
            <>
              <span style={{ fontSize: 11.5, color: "#c9c9d6", textAlign: "center", lineHeight: 1.4 }}>
                Reported result: <strong>{teamName(otherReport)} won</strong>.
              </span>
              {otherProof && (
                <a href={otherProof} target="_blank" rel="noreferrer" style={{ fontFamily: MONO, fontSize: 10, color: "#c98bff", textAlign: "center", textDecoration: "none" }}>view their screenshot →</a>
              )}
              <div style={{ display: "flex", gap: 8 }}>
                <button style={{ ...page.btn, flex: 1, padding: "9px 8px", fontSize: 11.5, opacity: busy ? .6 : 1 }} disabled={busy}
                  onClick={() => report(otherReport)}>Confirm</button>
                <button style={{ ...page.btnGhost, flex: 1, padding: "9px 8px", fontSize: 11.5, opacity: busy ? .6 : 1 }} disabled={busy}
                  onClick={() => report(otherReport === "team_a" ? "team_b" : "team_a")}>Dispute</button>
              </div>
              {match.report_deadline && (
                <span style={{ fontFamily: MONO, fontSize: 10, color: "#9a9aab", textAlign: "center" }}>
                  auto-confirms in <Countdown deadline={match.report_deadline} />
                </span>
              )}
            </>
          )}

          {/* State 3 — I reported and it's not disputed: waiting to advance. */}
          {myReport && !match.disputed && (
            <span style={{ fontFamily: MONO, fontSize: 10.5, color: "#8ee6b0", textAlign: "center", lineHeight: 1.5 }}>
              You reported {teamName(myReport)} won.
              {!otherReport && match.report_deadline && (
                <> Advances in <Countdown deadline={match.report_deadline} /> unless disputed.</>
              )}
            </span>
          )}

          {match.disputed && (
            <span style={{ fontSize: 11, color: "#ffce7a", textAlign: "center", lineHeight: 1.4 }}>
              Reports don't match. Attach a screenshot of the result screen — the organizer decides.
            </span>
          )}

          {/* Proof upload — auto-verifies via OCR when possible; essential on dispute */}
          {myReport && (
            myProof ? (
              <span style={{ fontFamily: MONO, fontSize: 10, color: "#8ee6b0", textAlign: "center" }}>✓ Your screenshot is attached</span>
            ) : (
              <>
                <label style={{ ...page.btnGhost, textAlign: "center", cursor: uploading ? "wait" : "pointer", padding: "8px 12px", fontSize: 11 }}>
                  {uploading ? "Verifying…" : "📷 Attach screenshot"}
                  <input type="file" accept="image/*" onChange={uploadProof} disabled={uploading} style={{ display: "none" }} />
                </label>
                {!match.disputed && (
                  <span style={{ fontFamily: MONO, fontSize: 9.5, color: "#5a5a6a", textAlign: "center" }}>a clear victory screenshot can advance you instantly</span>
                )}
              </>
            )
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tournament detail: registration list + live bracket ────────────────────
export function TournamentDetailPage() {
  const { tournamentId } = useParams();
  const [tournament, setTournament] = useState(null);
  const [registrations, setRegistrations] = useState([]);
  const [matches, setMatches] = useState([]);
  const [toast, showToast] = useToast();
  const [refresh, setRefresh] = useState(0);
  const { profile } = useAuth();
  const myTag = profile?.player_tag || null;

  const reload = useCallback(() => setRefresh(x => x + 1), []);

  useEffect(() => {
    supabase.from("Tournaments").select("*").eq("id", tournamentId).maybeSingle()
      .then(({ data }) => setTournament(data));
    supabase.from("Registrations").select("*").eq("tournament_id", tournamentId).order("joined_at")
      .then(({ data }) => setRegistrations(data || []));
    supabase.from("TournamentMatches").select("*").eq("tournament_id", tournamentId)
      .order("round").order("match_number")
      .then(({ data }) => setMatches(data || []));
    // Nudge the serverless sweep (check-in timeouts) — best-effort, works on
    // the deployed site; harmless 404 under the local dev server.
    fetch(`/api/bracket-state?tournamentId=${tournamentId}`).catch(() => {});
  }, [tournamentId, refresh]);

  // Live refresh while a bracket is running
  useEffect(() => {
    if (tournament?.status !== "live") return;
    const t = setInterval(reload, 15000);
    return () => clearInterval(t);
  }, [tournament?.status, reload]);

  const teams = useMemo(() => groupIntoTeams(registrations, tournament?.team_size || 3), [registrations, tournament]);
  const soloQueue = useMemo(() => registrations.filter(r => r.is_solo && !r.team_name), [registrations]);
  const incomplete = useMemo(() => {
    const full = new Set(teams.map(t => t.name.toLowerCase()));
    const partial = new Map();
    for (const r of registrations) {
      if (r.is_solo && !r.team_name) continue; // shown separately in the solo queue list
      const k = (r.team_name || "").trim().toLowerCase();
      if (!k || full.has(k)) continue;
      partial.set(k, [...(partial.get(k) || []), r]);
    }
    return [...partial.values()];
  }, [registrations, teams]);

  const rounds = useMemo(() => {
    const byRound = new Map();
    for (const m of matches) byRound.set(m.round, [...(byRound.get(m.round) || []), m]);
    return [...byRound.entries()].sort((a, b) => a[0] - b[0]);
  }, [matches]);

  const champion = useMemo(() => {
    if (tournament?.status !== "completed" || !matches.length) return null;
    const final = matches[matches.length - 1];
    if (!final.result) return null;
    return final.result === "team_a" ? final.team_a_name : final.team_b_name;
  }, [tournament, matches]);

  if (!tournament) {
    return (
      <div style={page.root}><div style={page.glow} /><SiteHeader />
        <div style={{ ...page.wrap, textAlign: "center", color: "#475569" }}>Loading tournament…</div>
      </div>
    );
  }

  const st = STATUS_STYLE[tournament.status] || STATUS_STYLE.registration;
  const totalRounds = teams.length >= 2 ? totalRoundsFor(teams.length) : 0;
  const isCreator = profile?.id && tournament.created_by === profile.id;

  return (
    <div style={page.root}>
      <div style={page.glow} />
      <SiteHeader />
      <div style={page.wrap}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
          <Link to="/tournaments" style={{ fontFamily: MONO, fontSize: 11, color: "#8a7fa6", textDecoration: "none" }}>← ALL TOURNAMENTS</Link>
          {isCreator && (
            <Link to={`/tournaments/${tournamentId}/manage`} style={{ ...page.btnGhost, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", fontSize: 11 }}>
              ⚙ Manage tournament
            </Link>
          )}
        </div>

        {tournament.banner_url && (
          <div style={{ marginTop: 16, borderRadius: 20, overflow: "hidden", border: "1px solid rgba(255,255,255,.1)" }}>
            <img src={tournament.banner_url} alt={tournament.name} style={{ display: "block", width: "100%", maxHeight: 260, objectFit: "cover" }} onError={e => { e.currentTarget.parentElement.style.display = "none"; }} />
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginTop: 16, marginBottom: 8 }}>
          <h1 style={{ fontFamily: DISPLAY, fontSize: "clamp(30px,4vw,48px)", fontWeight: 700, color: "#f4f4fa", margin: 0 }}>{tournament.name}</h1>
          <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1.5, fontWeight: 700, color: st.color, padding: "5px 12px", borderRadius: 999, background: `${st.color}18`, border: `1px solid ${st.color}40` }}>{st.label}</span>
        </div>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontFamily: MONO, fontSize: 12, marginBottom: 30 }}>
          <span style={{ color: "#ffce7a" }}><Trophy size={12} style={{ verticalAlign: -1 }} /> ${Number(tournament.prize_pool_total).toLocaleString()} PRIZE POOL</span>
          <span style={{ color: "#9a9aab" }}><Users size={12} style={{ verticalAlign: -1 }} /> {teams.length} COMPLETE TEAMS · {registrations.length} PLAYERS</span>
          <span style={{ color: "#9a9aab" }}><Swords size={12} style={{ verticalAlign: -1 }} /> {tournament.team_size}v{tournament.team_size} SINGLE ELIM</span>
          {tournament.starts_at && <span style={{ color: "#c98bff" }}><Clock size={12} style={{ verticalAlign: -1 }} /> STARTS {formatStart(tournament.starts_at)}</span>}
          {tournament.registration_deadline && tournament.status === "registration" && (
            <span style={{ color: "#ffce7a" }}><Clock size={12} style={{ verticalAlign: -1 }} /> REG CLOSES {formatStart(tournament.registration_deadline)}</span>
          )}
          {tournament.region && <span style={{ color: "#9a9aab" }}>◈ {tournament.region.toUpperCase()}</span>}
        </div>

        {tournament.rules && (
          <div style={{ ...page.card, padding: "18px 22px", marginBottom: 26 }}>
            <div style={{ ...page.eyebrow, marginBottom: 8 }}>◈ RULES</div>
            <p style={{ fontSize: 13, color: "#c9c9d6", margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{tournament.rules}</p>
          </div>
        )}

        {champion && (
          <div style={{ ...page.card, padding: "26px 30px", marginBottom: 26, textAlign: "center", background: "linear-gradient(160deg, rgba(255,180,61,.12), rgba(13,13,20,.5))", border: "1px solid rgba(255,180,61,.4)" }}>
            <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 2, color: "#ffce7a" }}>◈ CHAMPIONS</div>
            <div style={{ fontFamily: DISPLAY, fontSize: 36, fontWeight: 700, color: GOLD, textShadow: "0 0 40px rgba(255,180,61,.5)" }}>🏆 {champion}</div>
            <div style={{ fontSize: 12.5, color: "#9a9aab" }}>Prize pool credited to the winners' wallets.</div>
          </div>
        )}

        {tournament.status === "registration" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 20 }}>
            <RegistrationForm tournament={tournament} showToast={showToast} onRegistered={reload} />
            <div style={{ ...page.card, padding: 26 }}>
              <span style={page.eyebrow}>◈ TEAMS ({teams.length})</span>
              {teams.length === 0 && incomplete.length === 0 && (
                <p style={{ fontSize: 12.5, color: "#6f7180" }}>Nobody yet — be the first trio in.</p>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
                {teams.map(t => (
                  <div key={t.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 14, background: "rgba(142,230,176,.05)", border: "1px solid rgba(142,230,176,.2)" }}>
                    <CheckCircle2 size={14} color="#8ee6b0" />
                    <span style={{ fontWeight: 700, fontSize: 13.5 }}>{t.name}</span>
                    <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10.5, color: "#9a9aab" }}>{t.players.map(p => p.name).join(" · ")}</span>
                  </div>
                ))}
                {incomplete.map(members => (
                  <div key={members[0].team_name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 14, background: "rgba(255,255,255,.02)", border: "1px dashed rgba(255,255,255,.12)" }}>
                    <AlertTriangle size={13} color="#ffce7a" />
                    <span style={{ fontWeight: 700, fontSize: 13.5, color: "#c9c9d6" }}>{members[0].team_name}</span>
                    <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10.5, color: "#8a7fa6" }}>{members.length}/{tournament.team_size} — needs {tournament.team_size - members.length} more</span>
                  </div>
                ))}
                {soloQueue.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 14, background: "rgba(179,107,255,.06)", border: "1px solid rgba(179,107,255,.2)" }}>
                    <Users size={13} color={VIOLET} />
                    <span style={{ fontWeight: 700, fontSize: 13.5, color: "#d9b8ff" }}>Solo queue</span>
                    <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10.5, color: "#8a7fa6" }}>{soloQueue.length} player{soloQueue.length === 1 ? "" : "s"} waiting to be auto-teamed</span>
                  </div>
                )}
              </div>
              {teams.length >= 2 && (
                <p style={{ fontFamily: MONO, fontSize: 10.5, color: "#5a5a6a", marginTop: 14 }}>
                  BRACKET MATH: {teams.length} TEAMS → {nextPowerOfTwo(teams.length)}-SLOT BRACKET · {byesNeeded(teams.length)} BYES · {totalRounds} ROUNDS
                </p>
              )}
            </div>
          </div>
        )}

        {rounds.length > 0 && (
          <section style={{ marginTop: 30 }}>
            <span style={page.eyebrow}>◈ BRACKET</span>
            <div style={{ display: "flex", gap: 20, overflowX: "auto", paddingTop: 16, paddingBottom: 10 }}>
              {rounds.map(([round, ms]) => (
                <div key={round} style={{ display: "flex", flexDirection: "column", gap: 14, justifyContent: "space-around", minWidth: 250 }}>
                  <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: 1.5, color: "#ffce7a", textAlign: "center" }}>
                    {roundLabel(round, rounds.length).toUpperCase()}
                  </div>
                  {ms.map(m => <MatchCard key={m.id} match={m} myTag={myTag} onAction={reload} showToast={showToast} />)}
                </div>
              ))}
            </div>
            {myTag
              ? <p style={{ fontFamily: MONO, fontSize: 10.5, color: "#5a5a6a" }}>PLAYING AS {myTag} — check-in and result-report buttons appear on your matches.</p>
              : <p style={{ fontFamily: MONO, fontSize: 10.5, color: "#5a5a6a" }}>REGISTERED? Set your tag on the <Link to="/tournaments/profile" style={{ color: "#c98bff" }}>profile page</Link> to unlock check-in buttons.</p>}
          </section>
        )}
      </div>
      <SiteFooter />
      <Toast {...(toast || {})} />
    </div>
  );
}

// ─── Player profile: account, identity, wallet, history ──────────────────────
export function TournamentProfilePage() {
  const { user, profile, loading, openAuth, updateProfile } = useAuth();
  const [tagInput, setTagInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [saved, setSaved] = useState(false);
  const [wallet, setWallet] = useState(null);
  const [history, setHistory] = useState([]);
  const [matchHistory, setMatchHistory] = useState([]);

  const myTag = profile?.player_tag || null;

  useEffect(() => {
    if (profile) { setTagInput(profile.player_tag || ""); setNameInput(profile.display_name || ""); }
  }, [profile]);

  useEffect(() => {
    if (!myTag) { setWallet(null); setHistory([]); setMatchHistory([]); return; }
    supabase.from("UserWallets").select("*").eq("player_tag", myTag).maybeSingle()
      .then(({ data }) => setWallet(data));
    supabase.from("Registrations").select("*, Tournaments(name,status,prize_pool_total)").eq("player_tag", myTag)
      .order("joined_at", { ascending: false })
      .then(({ data }) => setHistory(data || []));
    supabase.from("TournamentMatches").select("*")
      .or(`team_a_tags.cs.{"${myTag}"},team_b_tags.cs.{"${myTag}"}`)
      .eq("status", "completed")
      .then(({ data }) => setMatchHistory(data || []));
  }, [myTag]);

  const wins = matchHistory.filter(m =>
    (m.result === "team_a" && (m.team_a_tags || []).includes(myTag)) ||
    (m.result === "team_b" && (m.team_b_tags || []).includes(myTag))
  ).length;

  const saveIdentity = async (e) => {
    e.preventDefault();
    await updateProfile({ player_tag: normalizeTag(tagInput), display_name: nameInput.trim() || null });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  // Gate the whole page behind login.
  if (!loading && !user) {
    return (
      <div style={page.root}>
        <div style={page.glow} />
        <SiteHeader />
        <div style={{ ...page.wrap, maxWidth: 440, textAlign: "center" }}>
          <div style={{ ...page.card, padding: "44px 30px", display: "flex", flexDirection: "column", alignItems: "center", gap: 16, marginTop: 40 }}>
            <Trophy size={30} color={GOLD} />
            <h1 style={{ fontFamily: DISPLAY, fontSize: 28, fontWeight: 700, color: "#f4f4fa", margin: 0 }}>Your tournament hub</h1>
            <p style={{ fontSize: 13.5, color: "#8b8b9c", margin: 0 }}>Sign in to set your player tag, track your wallet, and see every tournament you've entered.</p>
            <button onClick={() => openAuth("signin")} style={{ ...page.btn, display: "inline-flex", alignItems: "center", gap: 8 }}>
              <LogIn size={15} /> Sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={page.root}>
      <div style={page.glow} />
      <SiteHeader />
      <div style={page.wrap}>
        <span style={page.eyebrow}>◈ PLAYER PROFILE</span>
        <h1 style={{ fontFamily: DISPLAY, fontSize: "clamp(30px,4vw,48px)", fontWeight: 700, color: "#f4f4fa", margin: "10px 0 6px" }}>
          {profile?.display_name || "Your"} <span style={{ color: VIOLET }}>tournament hub</span>
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24, fontFamily: MONO, fontSize: 11, color: "#8a7fa6" }}>
          {user?.email}
          {profile?.is_premium && <span style={{ color: GOLD, fontWeight: 700 }}>👑 PREMIUM</span>}
        </div>

        <form onSubmit={saveIdentity} style={{ ...page.card, padding: 22, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 22 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontFamily: MONO, fontSize: 10, color: "#9a9aab" }}>DISPLAY NAME</span>
            <input style={{ ...page.input, maxWidth: 200 }} placeholder="Your name" value={nameInput} onChange={e => setNameInput(e.target.value)} maxLength={30} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontFamily: MONO, fontSize: 10, color: "#9a9aab" }}>PLAYER TAG</span>
            <input style={{ ...page.input, maxWidth: 200 }} placeholder="#2C20JJRG" value={tagInput} onChange={e => setTagInput(e.target.value)} />
          </div>
          <button type="submit" style={{ ...page.btn, padding: "11px 20px", fontSize: 12, alignSelf: "flex-end" }}>Save</button>
          {saved && <span style={{ fontFamily: MONO, fontSize: 11, color: "#8ee6b0", alignSelf: "flex-end", paddingBottom: 12 }}>SAVED ✔</span>}
        </form>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 28 }}>
          {[
            { label: "WALLET BALANCE", value: `$${Number(wallet?.balance || 0).toLocaleString()}`, icon: <Wallet size={15} color={GOLD} />, note: "withdrawals coming soon" },
            { label: "LIFETIME EARNINGS", value: `$${Number(wallet?.total_earned || 0).toLocaleString()}`, icon: <Trophy size={15} color={GOLD} /> },
            { label: "TOURNAMENTS ENTERED", value: history.length, icon: <Swords size={15} color={VIOLET} /> },
            { label: "MATCHES WON", value: wins, icon: <CheckCircle2 size={15} color="#8ee6b0" /> },
          ].map(s => (
            <div key={s.label} style={{ ...page.card, padding: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: MONO, fontSize: 9.5, letterSpacing: 1, color: "#6f7180" }}>{s.icon}{s.label}</div>
              <div style={{ fontFamily: DISPLAY, fontSize: 30, fontWeight: 700, color: "#f4f4fa", marginTop: 8 }}>{s.value}</div>
              {s.note && <div style={{ fontFamily: MONO, fontSize: 9.5, color: "#5a5a6a" }}>{s.note.toUpperCase()}</div>}
            </div>
          ))}
        </div>

        <span style={page.eyebrow}>◈ TOURNAMENT HISTORY</span>
        {!myTag ? (
          <p style={{ fontSize: 13, color: "#6f7180", marginTop: 10 }}>Save your player tag above to load your history.</p>
        ) : history.length === 0 ? (
          <p style={{ fontSize: 13, color: "#6f7180", marginTop: 10 }}>
            No tournaments yet — <Link to="/tournaments" style={{ color: "#c98bff" }}>join one free</Link>.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
            {history.map(h => (
              <Link key={h.id} to={`/tournaments/${h.tournament_id}`} style={{ ...page.card, padding: "16px 22px", display: "flex", alignItems: "center", gap: 14, textDecoration: "none", color: "inherit" }}>
                <Trophy size={15} color={GOLD} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14.5 }}>{h.Tournaments?.name || "Tournament"}</div>
                  <div style={{ fontFamily: MONO, fontSize: 10.5, color: "#8a7fa6" }}>TEAM {h.team_name?.toUpperCase()} · JOINED {new Date(h.joined_at).toLocaleDateString()}</div>
                </div>
                <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10, letterSpacing: 1, fontWeight: 700, color: (STATUS_STYLE[h.Tournaments?.status] || STATUS_STYLE.registration).color }}>
                  {(STATUS_STYLE[h.Tournaments?.status] || STATUS_STYLE.registration).label}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Create tournament (premium-gated) ───────────────────────────────────────
const REGIONS = ["Global", "Europe", "North America", "South America", "Asia", "Oceania", "Middle East"];

// A labelled field wrapper so every control lines up and breathes evenly.
// Defined at module scope (NOT inside the page component) — a component
// declared inside render is a new type each keystroke, which remounts the
// input and drops focus after every character.
function Field({ label, hint, children, style }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, ...style }}>
      <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1, color: "#9a9aab" }}>{label}</span>
      {children}
      {hint && <span style={{ fontFamily: MONO, fontSize: 9.5, color: "#5a5a6a" }}>{hint}</span>}
    </label>
  );
}
// The creator's own timezone — times are entered as their local wall clock and
// stored as UTC, so every viewer sees the start time in their own zone.
const LOCAL_TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "your local time"; } })();

export function CreateTournamentPage() {
  const { user, loading, isPremium, openAuth } = useAuth();
  const [form, setForm] = useState({
    name: "", prizePool: "0", teamSize: "3", maxTeams: "16",
    startsAt: "", region: "Global", checkinMinutes: "10", rules: "",
    registrationDeadline: "",
  });
  const [bannerUrl, setBannerUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, showToast] = useToast();
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const uploadBanner = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (file.size > 3 * 1024 * 1024) { showToast("Banner must be under 3 MB.", "error"); return; }
    setUploading(true);
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = `${user.id}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("tournament-banners").upload(path, file, { upsert: false, contentType: file.type });
    if (error) { setUploading(false); showToast(`Upload failed: ${error.message}`, "error"); return; }
    const { data } = supabase.storage.from("tournament-banners").getPublicUrl(path);
    setBannerUrl(data.publicUrl);
    setUploading(false);
    showToast("Banner uploaded ✔", "success");
  };

  if (!loading && !user) {
    return (
      <div style={page.root}>
        <div style={page.glow} /><SiteHeader />
        <div style={{ ...page.wrap, maxWidth: 440, textAlign: "center" }}>
          <div style={{ ...page.card, padding: "44px 30px", display: "flex", flexDirection: "column", alignItems: "center", gap: 16, marginTop: 40 }}>
            <Trophy size={30} color={GOLD} />
            <h1 style={{ fontFamily: DISPLAY, fontSize: 26, fontWeight: 700, color: "#f4f4fa", margin: 0 }}>Sign in to create a tournament</h1>
            <button onClick={() => openAuth("signin")} style={{ ...page.btn, display: "inline-flex", alignItems: "center", gap: 8 }}><LogIn size={15} /> Sign in</button>
          </div>
        </div>
      </div>
    );
  }

  if (!loading && user && !isPremium) {
    return (
      <div style={page.root}>
        <div style={page.glow} /><SiteHeader />
        <div style={{ ...page.wrap, maxWidth: 480, textAlign: "center" }}>
          <div style={{ ...page.card, padding: "44px 30px", display: "flex", flexDirection: "column", alignItems: "center", gap: 16, marginTop: 40 }}>
            <span style={{ fontSize: 32 }}>👑</span>
            <h1 style={{ fontFamily: DISPLAY, fontSize: 26, fontWeight: 700, color: "#f4f4fa", margin: 0 }}>Creating tournaments is a Premium feature</h1>
            <p style={{ fontSize: 13.5, color: "#8b8b9c", margin: 0 }}>Upgrade to run your own bracket, fund the prize pool, and manage it from your dashboard — check-in, verification, and payouts are all automated for you.</p>
            <Link to="/app?tab=premium" style={{ ...page.btn, textDecoration: "none" }}>Upgrade to Premium</Link>
          </div>
        </div>
      </div>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    // datetime-local is the creator's wall clock; new Date() reads it in their
    // browser timezone, toISOString() normalises to UTC for storage.
    const startsAtUtc = form.startsAt ? new Date(form.startsAt).toISOString() : null;
    const deadlineUtc = form.registrationDeadline ? new Date(form.registrationDeadline).toISOString() : null;
    const { data, error } = await supabase.rpc("tournament_create", {
      p_name: form.name,
      p_prize_pool_total: Number(form.prizePool) || 0,
      p_team_size: Number(form.teamSize) || 3,
      p_max_teams: Number(form.maxTeams) || 16,
      p_starts_at: startsAtUtc,
      p_region: form.region,
      p_rules: form.rules,
      p_checkin_minutes: Number(form.checkinMinutes) || 10,
      p_registration_deadline: deadlineUtc,
      p_banner_url: bannerUrl || null,
    });
    setBusy(false);
    if (error) {
      const code = error.message?.match(/[A-Z_]{4,}/)?.[0];
      showToast({
        PREMIUM_REQUIRED: "Your premium status lapsed — refresh and try again.",
        MISSING_FIELDS: "Give your tournament a name.",
        INVALID_TEAM_SIZE: "Team size must be between 1 and 5.",
        INVALID_PRIZE_POOL: "Prize pool can't be negative.",
        INVALID_CHECKIN_WINDOW: "Check-in window must be between 5 and 60 minutes.",
      }[code] || `Couldn't create tournament: ${error.message}`, "error");
      return;
    }
    window.location.href = `/tournaments/${data}/manage`;
  };

  const fieldInput = { ...page.input, borderRadius: 14 };

  return (
    <div style={page.root}>
      <div style={page.glow} />
      <SiteHeader />
      <div style={{ ...page.wrap, maxWidth: 620 }}>
        <span style={page.eyebrow}>◈ CREATE TOURNAMENT</span>
        <h1 style={{ fontFamily: DISPLAY, fontSize: "clamp(30px,4vw,44px)", fontWeight: 700, color: "#f4f4fa", margin: "10px 0 24px" }}>
          Set it up — <span style={{ color: VIOLET }}>we run it</span>
        </h1>
        <form onSubmit={submit} style={{ ...page.card, boxSizing: "border-box", padding: "26px", display: "flex", flexDirection: "column", gap: 18 }}>
          <Field label="BANNER IMAGE" hint="Optional. Shown across the top of your tournament page. Under 3 MB.">
            {bannerUrl ? (
              <div style={{ position: "relative", borderRadius: 16, overflow: "hidden", border: "1px solid rgba(255,255,255,.12)" }}>
                <img src={bannerUrl} alt="Banner preview" style={{ display: "block", width: "100%", maxHeight: 180, objectFit: "cover" }} />
                <button type="button" onClick={() => setBannerUrl("")} style={{ position: "absolute", top: 10, right: 10, padding: "6px 12px", borderRadius: 999, border: "none", background: "rgba(8,8,12,.85)", color: "#ff8f8f", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "'Chakra Petch', sans-serif" }}>Remove</button>
              </div>
            ) : (
              <label style={{ ...fieldInput, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: uploading ? "wait" : "pointer", color: "#8b8b9c", border: "1px dashed rgba(255,255,255,.18)", padding: "18px 16px" }}>
                {uploading ? "Uploading…" : "＋ Upload a banner image"}
                <input type="file" accept="image/*" onChange={uploadBanner} disabled={uploading} style={{ display: "none" }} />
              </label>
            )}
          </Field>

          <Field label="TOURNAMENT NAME">
            <input style={fieldInput} placeholder="e.g. Friday Night Brawl" value={form.name} onChange={set("name")} required maxLength={60} />
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label="START DATE & TIME" hint={`Your timezone — ${LOCAL_TZ}.`}>
              <input style={fieldInput} type="datetime-local" value={form.startsAt} onChange={set("startsAt")} />
            </Field>
            <Field label="REGISTRATION DEADLINE" hint="Optional. Sign-ups close at this time.">
              <input style={fieldInput} type="datetime-local" value={form.registrationDeadline} onChange={set("registrationDeadline")} />
            </Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Field label="REGION">
              <select style={fieldInput} value={form.region} onChange={set("region")}>
                {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            <Field label="TEAM SIZE">
              <select style={fieldInput} value={form.teamSize} onChange={set("teamSize")}>
                <option value="1">1 (solo)</option>
                <option value="2">2v2</option>
                <option value="3">3v3</option>
              </select>
            </Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
            <Field label="PRIZE POOL ($)">
              <input style={fieldInput} type="number" min="0" step="1" value={form.prizePool} onChange={set("prizePool")} />
            </Field>
            <Field label="MAX TEAMS">
              <input style={fieldInput} type="number" min="2" step="1" value={form.maxTeams} onChange={set("maxTeams")} />
            </Field>
            <Field label="CHECK-IN (MIN)" hint="5–60">
              <input style={fieldInput} type="number" min="5" max="60" step="1" value={form.checkinMinutes} onChange={set("checkinMinutes")} />
            </Field>
          </div>

          <Field label="RULES / NOTES" hint="Shown to players on the tournament page. Lag & disconnects, map pool, anything else.">
            <textarea style={{ ...fieldInput, minHeight: 90, borderRadius: 16, resize: "vertical", fontFamily: "'Chakra Petch', sans-serif" }}
              placeholder="e.g. Best of 3. Disconnect = round loss. No banned brawlers." value={form.rules} onChange={set("rules")} maxLength={1000} />
          </Field>

          <button type="submit" style={{ ...page.btn, opacity: busy ? .6 : 1 }} disabled={busy}>
            {busy ? "Creating…" : "Create Tournament"}
          </button>
        </form>
        <p style={{ fontFamily: MONO, fontSize: 10.5, color: "#5a5a6a", marginTop: 14 }}>
          After creation you'll land on your management dashboard — generate the bracket whenever registration is full.
        </p>
      </div>
      <Toast {...(toast || {})} />
    </div>
  );
}

// ─── Manage tournament (creator-only dashboard) ──────────────────────────────
export function ManageTournamentPage() {
  const { tournamentId } = useParams();
  const { user, session } = useAuth();
  const [tournament, setTournament] = useState(null);
  const [registrations, setRegistrations] = useState([]);
  const [matches, setMatches] = useState([]);
  const [busy, setBusy] = useState(false);
  const [toast, showToast] = useToast();
  const [refresh, setRefresh] = useState(0);
  const reload = () => setRefresh(x => x + 1);

  useEffect(() => {
    supabase.from("Tournaments").select("*").eq("id", tournamentId).maybeSingle().then(({ data }) => setTournament(data));
    supabase.from("Registrations").select("*").eq("tournament_id", tournamentId).order("joined_at").then(({ data }) => setRegistrations(data || []));
    supabase.from("TournamentMatches").select("*").eq("tournament_id", tournamentId).order("round").order("match_number").then(({ data }) => setMatches(data || []));
  }, [tournamentId, refresh]);

  const authedFetch = (url, body) => {
    const token = session?.access_token;
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    }).then(r => r.json().then(j => ({ ok: r.ok, body: j })));
  };

  const generateBracket = async () => {
    setBusy(true);
    const { ok, body } = await authedFetch("/api/generate-bracket", { tournamentId });
    setBusy(false);
    if (!ok) { showToast(body.error === "premium_required" ? "Your premium status lapsed." : `Failed: ${body.error}`, "error"); return; }
    showToast(`Bracket live — ${body.teams} teams, ${body.rounds} rounds.`, "success");
    reload();
  };

  const resetMatch = async (matchId) => {
    const { ok, body } = await authedFetch("/api/reset-match", { matchId });
    if (!ok) { showToast(`Failed: ${body.error}`, "error"); return; }
    showToast("Match reset — both teams get a fresh check-in window.", "success");
    reload();
  };

  const declareWinner = async (matchId, winner) => {
    const { ok, body } = await authedFetch("/api/declare-winner", { matchId, winner });
    if (!ok) { showToast(`Failed: ${body.error}`, "error"); return; }
    showToast("Winner declared — bracket advanced.", "success");
    reload();
  };

  // Creator adds a full roster directly (e.g. from tags collected in Discord).
  const [teamName, setTeamName] = useState("");
  const [teamTags, setTeamTags] = useState("");
  const addTeam = async (e) => {
    e.preventDefault();
    const size = tournament?.team_size || 3;
    const rows = teamTags.split("\n").map(l => l.trim()).filter(Boolean).map(l => {
      // "TAG, Name" or "TAG Name" — split on first comma or whitespace
      const [tag, ...rest] = l.split(/[,\s]+/);
      return { tag, name: rest.join(" ") || tag };
    });
    if (rows.length !== size) { showToast(`Enter exactly ${size} players (one per line).`, "error"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("tournament_register_team", { p_tournament_id: tournamentId, p_team_name: teamName, p_players: rows });
    setBusy(false);
    if (error) {
      const code = error.message?.match(/[A-Z_]{4,}/)?.[0];
      showToast({ TAG_ALREADY_REGISTERED: "One of those tags is already in this tournament.", TEAM_NAME_TAKEN: "That team name is taken.", INVALID_TAG: "A tag looks invalid.", WRONG_PLAYER_COUNT: `Need exactly ${size} players.` }[code] || `Failed: ${error.message}`, "error");
      return;
    }
    showToast(`Added team "${teamName}".`, "success");
    setTeamName(""); setTeamTags("");
    reload();
  };

  if (!tournament) {
    return <div style={page.root}><div style={page.glow} /><SiteHeader /><div style={{ ...page.wrap, textAlign: "center", color: "#475569" }}>Loading…</div></div>;
  }

  if (user && tournament.created_by && user.id !== tournament.created_by) {
    return (
      <div style={page.root}><div style={page.glow} /><SiteHeader />
        <div style={{ ...page.wrap, textAlign: "center", color: "#ff8f8f" }}>Only the tournament's creator can manage it.</div>
      </div>
    );
  }

  const registeredCount = registrations.length;
  const disputes = matches.filter(m => m.disputed && m.status !== "completed");
  const teamSize = tournament?.team_size || 3;
  // Group matches into rounds so the "all matches" section can gate on it.
  const rounds = (() => {
    const byRound = new Map();
    for (const m of matches) byRound.set(m.round, [...(byRound.get(m.round) || []), m]);
    return [...byRound.entries()].sort((a, b) => a[0] - b[0]);
  })();

  const proofView = (url, label) => url ? (
    <a href={url} target="_blank" rel="noreferrer" style={{ display: "block" }}>
      <img src={url} alt={label} style={{ width: "100%", maxHeight: 150, objectFit: "cover", borderRadius: 10, border: "1px solid rgba(255,255,255,.12)" }} />
    </a>
  ) : <div style={{ padding: "18px 10px", textAlign: "center", fontFamily: MONO, fontSize: 10, color: "#5a5a6a", border: "1px dashed rgba(255,255,255,.14)", borderRadius: 10 }}>no screenshot</div>;

  return (
    <div style={page.root}>
      <div style={page.glow} />
      <SiteHeader />
      <div style={page.wrap}>
        <Link to={`/tournaments/${tournamentId}`} style={{ fontFamily: MONO, fontSize: 11, color: "#8a7fa6", textDecoration: "none" }}>← VIEW PUBLIC PAGE</Link>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginTop: 16, marginBottom: 8 }}>
          <h1 style={{ fontFamily: DISPLAY, fontSize: "clamp(28px,4vw,42px)", fontWeight: 700, color: "#f4f4fa", margin: 0 }}>{tournament.name}</h1>
          <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1.5, fontWeight: 700, color: (STATUS_STYLE[tournament.status] || STATUS_STYLE.registration).color, padding: "5px 12px", borderRadius: 999, background: "rgba(255,255,255,.06)" }}>MANAGE MODE</span>
        </div>

        {/* Disputes needing a decision — most urgent, shown first */}
        {disputes.length > 0 && (
          <section style={{ marginBottom: 26 }}>
            <span style={{ ...page.eyebrow, color: "#ff8f8f" }}>⚠ DISPUTES — {disputes.length} NEED YOUR DECISION</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 12 }}>
              {disputes.map(m => (
                <div key={m.id} style={{ ...page.card, padding: 18, border: "1px solid rgba(255,143,143,.4)" }}>
                  <div style={{ fontFamily: MONO, fontSize: 11, color: "#9a9aab", marginBottom: 10 }}>R{m.round} M{m.match_number + 1} — teams reported different winners</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{m.team_a_name} <span style={{ fontFamily: MONO, fontSize: 10, color: "#8a7fa6" }}>· claims {m.team_a_reported === "team_a" ? "win" : m.team_a_reported === "team_b" ? "loss" : "—"}</span></div>
                      {proofView(m.team_a_proof_url, "Team A proof")}
                      <button onClick={() => declareWinner(m.id, "team_a")} style={{ ...page.btn, width: "100%", marginTop: 8, padding: "9px", fontSize: 12 }}>Declare {m.team_a_name} winner</button>
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{m.team_b_name} <span style={{ fontFamily: MONO, fontSize: 10, color: "#8a7fa6" }}>· claims {m.team_b_reported === "team_b" ? "win" : m.team_b_reported === "team_a" ? "loss" : "—"}</span></div>
                      {proofView(m.team_b_proof_url, "Team B proof")}
                      <button onClick={() => declareWinner(m.id, "team_b")} style={{ ...page.btn, width: "100%", marginTop: 8, padding: "9px", fontSize: 12 }}>Declare {m.team_b_name} winner</button>
                    </div>
                  </div>
                  <button onClick={() => resetMatch(m.id)} style={{ ...page.btnGhost, marginTop: 10, padding: "7px 14px", fontSize: 11 }}>Or force a rematch</button>
                </div>
              ))}
            </div>
          </section>
        )}

        {tournament.status === "registration" && (
          <div style={{ ...page.card, padding: 26, marginBottom: 24, display: "flex", flexDirection: "column", gap: 12 }}>
            <span style={page.eyebrow}>◈ REGISTRATION — {registeredCount} PLAYERS SIGNED UP</span>
            <p style={{ fontSize: 13, color: "#8b8b9c", margin: 0 }}>Share the tournament link. When you've got enough teams, generate the bracket — check-in windows and result reporting run automatically from there.</p>
            <button onClick={generateBracket} disabled={busy} style={{ ...page.btn, opacity: busy ? .6 : 1, alignSelf: "flex-start" }}>
              {busy ? "Generating…" : "Generate Bracket & Go Live"}
            </button>

            {/* Creator adds teams directly (e.g. tags collected in Discord) */}
            <form onSubmit={addTeam} style={{ borderTop: "1px solid rgba(255,255,255,.08)", paddingTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={{ fontFamily: MONO, fontSize: 11, color: "#c98bff" }}>◈ ADD A TEAM YOURSELF</span>
              <p style={{ fontSize: 12, color: "#8b8b9c", margin: 0 }}>Enter a team name, then {teamSize} players — one per line as <code style={{ color: "#c9c9d6" }}>#TAG, Name</code>.</p>
              <input style={page.input} placeholder="Team name" value={teamName} onChange={e => setTeamName(e.target.value)} maxLength={30} />
              <textarea style={{ ...page.input, minHeight: 84, borderRadius: 14, resize: "vertical", fontFamily: MONO }} placeholder={"#2C20JJRG, Alex\n#9YQ8RLP0, Sam\n#8UVP2QQL, Jo"} value={teamTags} onChange={e => setTeamTags(e.target.value)} />
              <button type="submit" disabled={busy} style={{ ...page.btnGhost, alignSelf: "flex-start", opacity: busy ? .6 : 1 }}>Add team</button>
            </form>
          </div>
        )}

        {rounds.length > 0 && (
          <section>
            <span style={page.eyebrow}>◈ ALL MATCHES — OVERRIDE</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
              {matches.map(m => (
                <div key={m.id} style={{ ...page.card, padding: 16, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: MONO, fontSize: 10.5, color: "#6f7180" }}>R{m.round} M{m.match_number + 1}</span>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{m.team_a_name || "TBD"} vs {m.team_b_name || (m.status === "bye" ? "—" : "TBD")}</span>
                  <span style={{ fontFamily: MONO, fontSize: 10.5, color: "#9a9aab" }}>{m.status.toUpperCase()}</span>
                  {m.result && <span style={{ fontFamily: MONO, fontSize: 10.5, color: "#8ee6b0" }}>WINNER: {m.result === "team_a" ? m.team_a_name : m.team_b_name}</span>}
                  {m.team_a_tags?.length > 0 && m.team_b_tags?.length > 0 && (
                    <button onClick={() => resetMatch(m.id)} style={{ ...page.btnGhost, marginLeft: "auto", padding: "8px 16px", fontSize: 11 }}>
                      Force Rematch
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
      <Toast {...(toast || {})} />
    </div>
  );
}
