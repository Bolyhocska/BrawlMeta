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
                <Link key={t.id} to={`/tournaments/${t.id}`} style={{ ...page.card, padding: 24, textDecoration: "none", color: "inherit", display: "flex", flexDirection: "column", gap: 14, transition: "border-color .15s" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1.5, fontWeight: 700, color: st.color, padding: "4px 11px", borderRadius: 999, background: `${st.color}18`, border: `1px solid ${st.color}40` }}>{st.label}</span>
                    <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10, color: "#6f7180" }}>3v3 · SINGLE ELIM</span>
                  </div>
                  <div style={{ fontFamily: DISPLAY, fontSize: 24, fontWeight: 700, color: "#f4f4fa" }}>{t.name}</div>
                  <div style={{ display: "flex", gap: 18, fontFamily: MONO, fontSize: 12 }}>
                    <span style={{ color: "#ffce7a" }}><Trophy size={11} style={{ verticalAlign: -1 }} /> ${Number(t.prize_pool_total).toLocaleString()} pool</span>
                    <span style={{ color: "#9a9aab" }}><Users size={11} style={{ verticalAlign: -1 }} /> {players} registered</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: "auto", color: "#d9b8ff", fontSize: 13, fontWeight: 700 }}>
                    {t.status === "registration" ? "Register free" : "View bracket"} <ChevronRight size={14} />
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
            Results come from the official battle log, verified against all six registered player tags.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Registration form ───────────────────────────────────────────────────────
function RegistrationForm({ tournament, onRegistered, showToast }) {
  const { user, profile, openAuth, updateProfile } = useAuth();
  const [form, setForm] = useState({ tag: "", name: "", team: "" });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  // Prefill from the signed-in profile once it loads.
  useEffect(() => {
    if (profile) setForm(f => ({ ...f, tag: f.tag || profile.player_tag || "", name: f.name || profile.display_name || "" }));
  }, [profile]);

  if (!user) {
    return (
      <div style={{ ...page.card, padding: 26, display: "flex", flexDirection: "column", gap: 14, alignItems: "flex-start" }}>
        <span style={page.eyebrow}>◈ FREE REGISTRATION</span>
        <p style={{ fontSize: 13, color: "#8b8b9c", margin: 0 }}>
          Sign in to register your trio. Your account remembers your player tag and tracks every tournament you enter.
        </p>
        <button onClick={() => openAuth("signup")} style={{ ...page.btn, display: "inline-flex", alignItems: "center", gap: 8 }}>
          <LogIn size={15} /> Sign in to register
        </button>
        <span style={{ fontFamily: MONO, fontSize: 10, color: "#5a5a6a" }}>NO ENTRY FEE · EVER</span>
      </div>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const { data, error } = await supabase.rpc("tournament_register", {
      p_tournament_id: tournament.id,
      p_email: user.email,
      p_player_tag: form.tag,
      p_display_name: form.name,
      p_team_name: form.team,
      p_is_premium: false, // ignored server-side; premium is read from the profile
    });
    if (error) {
      setBusy(false);
      const code = error.message?.match(/[A-Z_]{4,}/)?.[0];
      const msg = {
        LOGIN_REQUIRED: "Please sign in again — your session expired.",
        ALREADY_REGISTERED: "You're already registered for this tournament.",
        INVALID_TAG: "That player tag doesn't look right — copy it from your in-game profile (e.g. #2C20JJRG).",
        INVALID_EMAIL: "Your account email looks invalid.",
        MISSING_FIELDS: "Fill in every field.",
        REGISTRATION_CLOSED: "Registration is closed for this tournament.",
        TEAM_FULL: "That team already has 3 players — pick a different team name.",
      }[code] || (error.message?.includes("duplicate") ? "This player tag is already registered." : `Registration failed: ${error.message}`);
      showToast(msg, "error");
      return;
    }
    // Persist tag / name to the profile so check-in & verify buttons target this
    // player everywhere, without re-typing it next time.
    const patch = {};
    if (normalizeTag(form.tag) !== (profile?.player_tag || "")) patch.player_tag = normalizeTag(form.tag);
    if (form.name.trim() && form.name.trim() !== (profile?.display_name || "")) patch.display_name = form.name.trim();
    if (Object.keys(patch).length) await updateProfile(patch);
    setBusy(false);
    showToast("Registered! Get 2 teammates to join with the same team name.", "success");
    onRegistered?.(data);
  };

  return (
    <form onSubmit={submit} style={{ ...page.card, padding: 26, display: "flex", flexDirection: "column", gap: 12 }}>
      <span style={page.eyebrow}>◈ FREE REGISTRATION</span>
      <p style={{ fontSize: 12.5, color: "#8b8b9c", margin: "2px 0 6px" }}>
        Confirm your in-game player tag. Teammates register with the <strong style={{ color: "#c9c9d6" }}>same team name</strong> — a team locks in at 3 players.
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: MONO, fontSize: 11, color: "#8a7fa6", padding: "2px 4px" }}>
        <CheckCircle2 size={13} color="#8ee6b0" /> Registering as {user.email}
      </div>
      <input style={page.input} placeholder="Player tag (e.g. #2C20JJRG)" value={form.tag} onChange={set("tag")} required />
      <input style={page.input} placeholder="Display name" value={form.name} onChange={set("name")} required maxLength={30} />
      <input style={page.input} placeholder="Team name" value={form.team} onChange={set("team")} required maxLength={30} />
      <button type="submit" style={{ ...page.btn, opacity: busy ? .6 : 1 }} disabled={busy}>
        {busy ? "Registering…" : "Register — Free"}
      </button>
      <span style={{ fontFamily: MONO, fontSize: 10, color: "#5a5a6a", textAlign: "center" }}>NO ENTRY FEE · EVER</span>
    </form>
  );
}

// ─── Match card (check-in + verify) ──────────────────────────────────────────
function MatchCard({ match, myTag, onAction, showToast }) {
  const [busy, setBusy] = useState(false);
  const mine = myTag && [...(match.team_a_tags || []), ...(match.team_b_tags || [])].includes(myTag);
  const checkedIn = (tags) => (tags || []).filter(t => match.checkin_status?.[t]).length;
  const iCheckedIn = myTag && match.checkin_status?.[myTag];

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

  const verify = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/verify-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId: match.id, playerTag: myTag }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 429) showToast(`Cooldown active — try again in ${Math.ceil((body.retryAfterMs || 0) / 1000)}s.`, "error");
      else if (res.status === 404 && body.status === "not_found") showToast(body.message || "Battle not found yet — logs sync with a delay. Retry in a minute.", "info");
      else if (body.result === "tie") showToast(body.message, "info");
      else if (body.status === "found") showToast(`Verified — ${body.winner} advances! 🏆`, "success");
      else showToast(body.message || body.reason || "Verification unavailable right now.", "error");
    } catch {
      showToast("Verification service unreachable (it runs on the deployed site).", "error");
    }
    setBusy(false);
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

  return (
    <div style={{ ...page.card, padding: 16, display: "flex", flexDirection: "column", gap: 8, minWidth: 230 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: 1, color: "#6f7180" }}>M{match.match_number + 1}</span>
        {match.status === "bye" && <span style={{ fontFamily: MONO, fontSize: 10, color: "#9a9aab" }}>BYE — AUTO-ADVANCE</span>}
        {["pending", "checkin"].includes(match.status) && match.checkin_deadline && <Countdown deadline={match.checkin_deadline} />}
        {match.status === "active" && <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: GOLD }}>● LIVE</span>}
        <span style={{ marginLeft: "auto" }}>{resultBadge}</span>
      </div>
      <div style={sideStyle(match.result === "team_a", match.team_a_name)}>
        {match.team_a_name || "TBD"}
        {(match.team_a_tags || []).length > 0 && ["pending", "checkin"].includes(match.status) && (
          <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10, color: "#9a9aab" }}>{checkedIn(match.team_a_tags)}/{match.team_a_tags.length} ✓</span>
        )}
      </div>
      <div style={sideStyle(match.result === "team_b", match.team_b_name)}>
        {match.team_b_name || (match.status === "bye" ? "—" : "TBD")}
        {(match.team_b_tags || []).length > 0 && ["pending", "checkin"].includes(match.status) && (
          <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10, color: "#9a9aab" }}>{checkedIn(match.team_b_tags)}/{match.team_b_tags.length} ✓</span>
        )}
      </div>
      {mine && ["pending", "checkin"].includes(match.status) && !iCheckedIn && (
        <button style={{ ...page.btn, padding: "10px 18px", fontSize: 12, opacity: busy ? .6 : 1 }} disabled={busy} onClick={checkin}>
          {busy ? "…" : "CHECK IN"}
        </button>
      )}
      {mine && ["pending", "checkin"].includes(match.status) && iCheckedIn && (
        <span style={{ fontFamily: MONO, fontSize: 10.5, color: "#8ee6b0", textAlign: "center" }}>✓ You're checked in — waiting on the lobby</span>
      )}
      {mine && match.status === "active" && (
        <button style={{ ...page.btnGhost, opacity: busy ? .6 : 1 }} disabled={busy} onClick={verify}>
          {busy ? "Checking battle log…" : "⚡ VERIFY MATCH RESULTS"}
        </button>
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
  const incomplete = useMemo(() => {
    const full = new Set(teams.map(t => t.name.toLowerCase()));
    const partial = new Map();
    for (const r of registrations) {
      const k = r.team_name.trim().toLowerCase();
      if (!full.has(k)) partial.set(k, [...(partial.get(k) || []), r]);
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

  return (
    <div style={page.root}>
      <div style={page.glow} />
      <SiteHeader />
      <div style={page.wrap}>
        <Link to="/tournaments" style={{ fontFamily: MONO, fontSize: 11, color: "#8a7fa6", textDecoration: "none" }}>← ALL TOURNAMENTS</Link>

        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginTop: 16, marginBottom: 8 }}>
          <h1 style={{ fontFamily: DISPLAY, fontSize: "clamp(30px,4vw,48px)", fontWeight: 700, color: "#f4f4fa", margin: 0 }}>{tournament.name}</h1>
          <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1.5, fontWeight: 700, color: st.color, padding: "5px 12px", borderRadius: 999, background: `${st.color}18`, border: `1px solid ${st.color}40` }}>{st.label}</span>
        </div>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", fontFamily: MONO, fontSize: 12, marginBottom: 30 }}>
          <span style={{ color: "#ffce7a" }}><Trophy size={12} style={{ verticalAlign: -1 }} /> ${Number(tournament.prize_pool_total).toLocaleString()} PRIZE POOL</span>
          <span style={{ color: "#9a9aab" }}><Users size={12} style={{ verticalAlign: -1 }} /> {teams.length} COMPLETE TEAMS · {registrations.length} PLAYERS</span>
          <span style={{ color: "#9a9aab" }}><Swords size={12} style={{ verticalAlign: -1 }} /> 3v3 SINGLE ELIM</span>
        </div>

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
              ? <p style={{ fontFamily: MONO, fontSize: 10.5, color: "#5a5a6a" }}>PLAYING AS {myTag} — check-in and verify buttons appear on your matches.</p>
              : <p style={{ fontFamily: MONO, fontSize: 10.5, color: "#5a5a6a" }}>REGISTERED? Set your tag on the <Link to="/tournaments/profile" style={{ color: "#c98bff" }}>profile page</Link> to unlock check-in buttons.</p>}
          </section>
        )}
      </div>
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
