// ─── Auth modal: sign in / sign up ──────────────────────────────────────────
// Google + Discord one-click, plus classic email + password for anyone who
// wants it. Opened from the header and anywhere that requires a login (e.g.
// tournament registration). Purely presentational auth calls live in auth.jsx.

import { useState } from "react";
import { X } from "lucide-react";
import { useAuth } from "./auth";

const GOLD = "#ffb43d";
const MONO = "'JetBrains Mono', monospace";
const DISPLAY = "'Baloo 2', sans-serif";

const input = {
  width: "100%", padding: "12px 16px", borderRadius: 12, border: "1px solid rgba(255,255,255,.12)",
  background: "rgba(13,13,20,.7)", color: "#f4f4fa", fontSize: 14, fontFamily: "'Chakra Petch', sans-serif", outline: "none",
};

// Inline brand marks so we stay CSP-safe (no external image hosts).
function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22 22-9.8 22-22c0-1.3-.1-2.3-.4-3.5z"/>
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 4.1 29.6 2 24 2 15.4 2 8 6.9 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 46c5.5 0 10.4-2.1 14.1-5.5l-6.5-5.5c-2 1.5-4.7 2.5-7.6 2.5-5.2 0-9.6-3.3-11.2-8l-6.6 5.1C8 41 15.4 46 24 46z"/>
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6.5 5.5c-.5.4 6.3-4.6 6.3-15 0-1.3-.1-2.3-.4-3.5z"/>
    </svg>
  );
}
function DiscordMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="#5865F2" aria-hidden>
      <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.2.5a18.3 18.3 0 0 1 4.3 1.4c-2.2-1-4.6-1.5-7-1.5s-4.8.5-7 1.5a18.3 18.3 0 0 1 4.3-1.4L9.6 3a19.8 19.8 0 0 0-5 1.4C1.6 8.9.8 13.3 1.2 17.6a19.9 19.9 0 0 0 6 3l.7-1.1a13 13 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l.7 1.1a19.9 19.9 0 0 0 6-3c.5-5-.8-9.4-3.2-13.2zM8.9 15c-1 0-1.7-.9-1.7-2s.8-2 1.7-2 1.8.9 1.7 2c0 1.1-.8 2-1.7 2zm6.2 0c-1 0-1.7-.9-1.7-2s.8-2 1.7-2 1.8.9 1.7 2c0 1.1-.8 2-1.7 2z"/>
    </svg>
  );
}

export default function AuthModal({ open, onClose, initialMode = "signin" }) {
  const { signInWithPassword, signUpWithPassword, signInWithOAuth } = useAuth();
  const [mode, setMode] = useState(initialMode); // "signin" | "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { tone, text }

  if (!open) return null;

  const oauth = async (provider) => {
    setMsg(null);
    const { error } = await signInWithOAuth(provider);
    if (error) setMsg({ tone: "err", text: error.message });
    // On success the browser redirects away — nothing more to do here.
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (mode === "signup") {
        const { data, error } = await signUpWithPassword(email, password, displayName);
        if (error) { setMsg({ tone: "err", text: error.message }); return; }
        if (data?.user && !data.session) {
          setMsg({ tone: "ok", text: "Check your email to confirm your account, then sign in." });
        } else {
          onClose?.();
        }
      } else {
        const { error } = await signInWithPassword(email, password);
        if (error) { setMsg({ tone: "err", text: error.message }); return; }
        onClose?.();
      }
    } finally {
      setBusy(false);
    }
  };

  const oauthBtn = {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 10, width: "100%",
    padding: "12px 16px", borderRadius: 12, border: "1px solid rgba(255,255,255,.14)",
    background: "rgba(255,255,255,.05)", color: "#f4f4fa", fontSize: 13.5, fontWeight: 700,
    cursor: "pointer", fontFamily: "'Chakra Petch', sans-serif",
  };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(4,4,8,.72)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 400, borderRadius: 22, background: "#0d0d14", border: "1px solid rgba(255,255,255,.1)", boxShadow: "0 30px 90px rgba(0,0,0,.6)", padding: 26, position: "relative" }}
      >
        <button onClick={onClose} aria-label="Close" style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", color: "#6f7180", cursor: "pointer" }}>
          <X size={18} />
        </button>

        <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 2, color: "#c98bff" }}>◈ BRAWLMETA ACCOUNT</div>
        <h2 style={{ fontFamily: DISPLAY, fontSize: 26, fontWeight: 700, color: "#f4f4fa", margin: "8px 0 18px" }}>
          {mode === "signup" ? "Create your account" : "Welcome back"}
        </h2>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <button style={oauthBtn} onClick={() => oauth("google")}><GoogleMark /> Continue with Google</button>
          <button style={oauthBtn} onClick={() => oauth("discord")}><DiscordMark /> Continue with Discord</button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "18px 0" }}>
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,.1)" }} />
          <span style={{ fontFamily: MONO, fontSize: 10, color: "#5a5a6a" }}>OR EMAIL</span>
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,.1)" }} />
        </div>

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {mode === "signup" && (
            <input style={input} placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={30} required />
          )}
          <input style={input} type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input style={input} type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
          <button type="submit" disabled={busy} style={{ padding: "13px", borderRadius: 12, border: "none", background: GOLD, color: "#1a1206", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "'Chakra Petch', sans-serif", boxShadow: "0 0 22px rgba(255,180,61,.3)", opacity: busy ? .6 : 1 }}>
            {busy ? "…" : mode === "signup" ? "Sign up" : "Sign in"}
          </button>
        </form>

        {msg && (
          <p style={{ marginTop: 12, fontSize: 12.5, textAlign: "center", color: msg.tone === "err" ? "#ff8f8f" : "#8ee6b0" }}>{msg.text}</p>
        )}

        <p style={{ marginTop: 16, textAlign: "center", fontSize: 12.5, color: "#8b8b9c" }}>
          {mode === "signup" ? "Already have an account?" : "New to BrawlMeta?"}{" "}
          <button
            onClick={() => { setMode(mode === "signup" ? "signin" : "signup"); setMsg(null); }}
            style={{ background: "none", border: "none", color: "#c98bff", fontWeight: 700, cursor: "pointer", fontSize: 12.5, fontFamily: "'Chakra Petch', sans-serif" }}
          >
            {mode === "signup" ? "Sign in" : "Create one"}
          </button>
        </p>
      </div>
    </div>
  );
}
