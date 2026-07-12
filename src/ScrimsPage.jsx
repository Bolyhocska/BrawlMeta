import { useEffect, useMemo, useState } from "react";
import { GuideShell } from "./GuidesPages";

const MONO = "'JetBrains Mono', monospace";
const DISPLAY = "'Baloo 2', sans-serif";

// ─── Local persistence (demo backend until accounts exist) ──────────────────
// Postings, wagers, and the demo wallet live in localStorage so the whole
// flow — including escrow states — is fully usable without a payments backend.

const load = (key, fallback) => {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
};
const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));

const SEED_POSTS = [
  { id: "p1", team: "Void Circuit", region: "EU", rank: "Masters", modes: ["Knockout", "Brawl Ball"], note: "Tue/Thu evenings CET. Bo5 sets, serious practice only.", contact: "voidcircuit", ago: "2h ago" },
  { id: "p2", team: "Golden Gears", region: "NA", rank: "Legendary+", modes: ["Gem Grab", "Hot Zone"], note: "Prepping for monthly finals — want strong Gem Grab teams.", contact: "goldengears", ago: "5h ago" },
  { id: "p3", team: "Nightshade", region: "EU", rank: "Masters", modes: ["Heist", "Bounty", "Knockout"], note: "Full map pool scrims, we bring our own draft caller.", contact: "nightshade3", ago: "1d ago" },
  { id: "p4", team: "Tidal Wave", region: "APAC", rank: "Legendary+", modes: ["Brawl Ball"], note: "Brawl Ball specialists. Weekend blocks, 2hr sessions.", contact: "tidalwave", ago: "1d ago" },
];

const SEED_WAGERS = [
  { id: "w1", host: "Void Circuit", stake: 10, mode: "Knockout", bestOf: 3, status: "open", joiner: null, hostClaim: null, joinerClaim: null, mine: false },
  { id: "w2", host: "Golden Gears", stake: 25, mode: "Brawl Ball", bestOf: 5, status: "locked", joiner: "Nightshade", hostClaim: null, joinerClaim: null, mine: false },
  { id: "w3", host: "Tidal Wave", stake: 5, mode: "Gem Grab", bestOf: 3, status: "completed", joiner: "Ember Squad", winner: "Tidal Wave", hostClaim: "Tidal Wave", joinerClaim: "Tidal Wave", mine: false },
];

const REGIONS = ["EU", "NA", "SA", "APAC"];
const MODES = ["Gem Grab", "Brawl Ball", "Knockout", "Heist", "Hot Zone", "Bounty"];
const RANKS = ["Any rank", "Legendary+", "Masters"];

// ─── Small shared UI ─────────────────────────────────────────────────────────

function Tag({ children, color = "#c9c9d6", bg = "rgba(255,255,255,.05)", border = "rgba(255,255,255,.08)" }) {
  return (
    <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: ".5px", padding: "5px 11px", borderRadius: 999, background: bg, border: `1px solid ${border}`, color, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

function PillButton({ children, gold, violet, ghost, small, onClick, disabled, style }) {
  const base = gold
    ? { background: "#ffb43d", color: "#1a1206", boxShadow: "0 0 26px rgba(255,180,61,.35)" }
    : violet
    ? { background: "#b36bff", color: "#0a0a0f", boxShadow: "0 0 26px rgba(179,107,255,.35)" }
    : { background: "rgba(255,255,255,.05)", color: "#e9e9f2", border: "1px solid rgba(255,255,255,.1)" };
  return (
    <button onClick={onClick} disabled={disabled} style={{
      display: "inline-flex", alignItems: "center", gap: 8, padding: small ? "9px 18px" : "13px 26px",
      borderRadius: 999, border: "none", fontWeight: 700, fontSize: small ? 13 : 14, letterSpacing: ".4px",
      fontFamily: "'Chakra Petch', sans-serif", cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? .45 : 1, ...base, ...(ghost ? { background: "transparent" } : {}), ...style,
    }}>{children}</button>
  );
}

function Select({ value, onChange, options, style }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={{
      padding: "10px 16px", borderRadius: 999, background: "#12121b", color: "#e9e9f2",
      border: "1px solid rgba(255,255,255,.1)", fontFamily: "'Chakra Petch', sans-serif", fontSize: 13,
      outline: "none", cursor: "pointer", ...style,
    }}>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function Input(props) {
  return (
    <input {...props} style={{
      padding: "11px 18px", borderRadius: 999, background: "#12121b", color: "#e9e9f2",
      border: "1px solid rgba(255,255,255,.1)", fontFamily: "'Chakra Petch', sans-serif", fontSize: 13.5,
      outline: "none", width: "100%", ...props.style,
    }} />
  );
}

const STATUS_META = {
  open:      { label: "OPEN",            color: "#8ee6b0", bg: "rgba(142,230,176,.12)" },
  locked:    { label: "IN ESCROW",       color: "#ffce7a", bg: "rgba(255,180,61,.12)" },
  awaiting:  { label: "AWAITING RESULT", color: "#c98bff", bg: "rgba(179,107,255,.12)" },
  completed: { label: "PAID OUT",        color: "#8ee6b0", bg: "rgba(142,230,176,.12)" },
  disputed:  { label: "UNDER REVIEW",    color: "#ff8f8f", bg: "rgba(255,122,122,.12)" },
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ScrimsPage() {
  const [tab, setTab] = useState("finder");
  const [posts, setPosts] = useState(() => load("bm_scrim_posts", SEED_POSTS));
  const [wagers, setWagers] = useState(() => load("bm_wagers", SEED_WAGERS));
  const [wallet, setWallet] = useState(() => load("bm_wallet", 50));
  const [regionFilter, setRegionFilter] = useState("All regions");
  const [modeFilter, setModeFilter] = useState("All modes");
  const [showPostForm, setShowPostForm] = useState(false);
  const [showWagerForm, setShowWagerForm] = useState(false);
  const [toast, setToast] = useState(null);

  useEffect(() => save("bm_scrim_posts", posts), [posts]);
  useEffect(() => save("bm_wagers", wagers), [wagers]);
  useEffect(() => save("bm_wallet", wallet), [wallet]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const filteredPosts = useMemo(() => posts.filter(p =>
    (regionFilter === "All regions" || p.region === regionFilter) &&
    (modeFilter === "All modes" || p.modes.includes(modeFilter))
  ), [posts, regionFilter, modeFilter]);

  // ── Post form state ──
  const [form, setForm] = useState({ team: "", region: "EU", rank: "Any rank", modes: [], note: "", contact: "" });
  const submitPost = () => {
    if (!form.team.trim() || !form.contact.trim() || form.modes.length === 0) {
      setToast("Team name, contact, and at least one mode are required.");
      return;
    }
    setPosts([{ id: `p${Date.now()}`, ...form, team: form.team.trim(), contact: form.contact.trim(), ago: "just now" }, ...posts]);
    setForm({ team: "", region: "EU", rank: "Any rank", modes: [], note: "", contact: "" });
    setShowPostForm(false);
    setToast("Scrim posting is live.");
  };

  // ── Wager form state ──
  const [wagerForm, setWagerForm] = useState({ team: "", stake: 10, mode: "Knockout", bestOf: 3 });
  const submitWager = () => {
    if (!wagerForm.team.trim()) { setToast("Enter your team name."); return; }
    const stake = Math.max(1, Math.round(Number(wagerForm.stake) || 0));
    if (stake > wallet) { setToast("Stake exceeds your wallet balance."); return; }
    setWallet(w => w - stake);
    setWagers([{ id: `w${Date.now()}`, host: wagerForm.team.trim(), stake, mode: wagerForm.mode, bestOf: Number(wagerForm.bestOf), status: "open", joiner: null, hostClaim: null, joinerClaim: null, mine: true }, ...wagers]);
    setShowWagerForm(false);
    setToast(`${stake} credits moved to escrow. Challenge is live.`);
  };

  const joinWager = (id) => {
    const w = wagers.find(x => x.id === id);
    if (!w) return;
    if (w.stake > wallet) { setToast("Stake exceeds your wallet balance."); return; }
    setWallet(bal => bal - w.stake);
    setWagers(ws => ws.map(x => x.id === id ? { ...x, status: "locked", joiner: "Your Team", mine: true } : x));
    setToast(`Matched! ${w.stake} credits from each team are held in escrow.`);
  };

  // Both sides confirm a winner by "sending in the game" — matching claims
  // release escrow to the winner; conflicting claims freeze it for review.
  // The next wager state is computed OUTSIDE the setState updater: wallet and
  // toast updates are side effects, and updater functions must stay pure
  // (StrictMode double-invokes them, which would double-pay the pot).
  const submitResult = (id, claimant, claimedWinner) => {
    const current = wagers.find(x => x.id === id);
    if (!current) return;
    const next = { ...current, [claimant === "host" ? "hostClaim" : "joinerClaim"]: claimedWinner, status: "awaiting" };
    if (next.hostClaim && next.joinerClaim) {
      if (next.hostClaim === next.joinerClaim) {
        next.status = "completed";
        next.winner = next.hostClaim;
      } else {
        next.status = "disputed";
      }
    }
    setWagers(ws => ws.map(x => x.id === id ? next : x));
    if (next.status === "completed") {
      if (next.mine && next.winner === "Your Team") {
        setWallet(bal => bal + next.stake * 2);
        setToast(`Escrow released — ${next.stake * 2} credits paid out.`);
      } else {
        setToast(`Escrow released to ${next.winner}.`);
      }
    } else if (next.status === "disputed") {
      setToast("Conflicting results — escrow frozen for admin review.");
    } else {
      setToast("Result submitted. Waiting on the other team's confirmation.");
    }
  };

  const toggleMode = (m) => setForm(f => ({ ...f, modes: f.modes.includes(m) ? f.modes.filter(x => x !== m) : [...f.modes, m] }));

  return (
    <GuideShell>
      {/* Hero */}
      <section style={{ position: "relative", zIndex: 10, padding: "30px 5vw 40px", maxWidth: 860, margin: "0 auto", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 9, padding: "9px 18px 9px 14px", borderRadius: 999, background: "rgba(13,13,20,.6)", border: "1px solid rgba(142,230,176,.3)", fontFamily: MONO, fontSize: 12, letterSpacing: 2.5, color: "#8ee6b0" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#8ee6b0", boxShadow: "0 0 8px #8ee6b0" }} />
          SCRIMS · COMPETE
        </div>
        <h1 style={{ marginTop: 24, fontFamily: DISPLAY, fontSize: "clamp(48px,7vw,92px)", fontWeight: 700, lineHeight: .95, letterSpacing: "-1px", color: "#f4f4fa" }}>
          Find your <span style={{ color: "#8ee6b0", textShadow: "0 0 40px rgba(142,230,176,.5)" }}>opponent</span>
        </h1>
        <p style={{ marginTop: 22, maxWidth: 600, fontSize: 17, lineHeight: 1.6, color: "#a4a4b5" }}>
          Match with teams for practice scrims — or put credits on the line in escrow-backed wager matches.
        </p>

        {/* Tab switch */}
        <div style={{ display: "flex", gap: 2, marginTop: 30, padding: 6, borderRadius: 999, background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)" }}>
          {[["finder", "Team Finder"], ["wagers", "Wager Matches"]].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{
              padding: "11px 26px", borderRadius: 999, border: "none", cursor: "pointer",
              fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: 14,
              background: tab === id ? "rgba(142,230,176,.16)" : "transparent",
              color: tab === id ? "#f4f4fa" : "#b7b7c6",
            }}>{label}</button>
          ))}
        </div>
      </section>

      {/* ─── TEAM FINDER ─── */}
      {tab === "finder" && (
        <div style={{ position: "relative", zIndex: 10, maxWidth: 1000, margin: "0 auto", padding: "0 5vw 100px", display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <Select value={regionFilter} onChange={setRegionFilter} options={["All regions", ...REGIONS]} />
            <Select value={modeFilter} onChange={setModeFilter} options={["All modes", ...MODES]} />
            <div style={{ marginLeft: "auto" }}>
              <PillButton gold small onClick={() => setShowPostForm(v => !v)}>{showPostForm ? "Cancel" : "+ Post a scrim"}</PillButton>
            </div>
          </div>

          {showPostForm && (
            <div style={{ borderRadius: 24, padding: 26, background: "linear-gradient(160deg, rgba(255,180,61,.08), rgba(20,14,32,.4))", border: "1px solid rgba(255,180,61,.24)", display: "flex", flexDirection: "column", gap: 14 }}>
              <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 2, color: "#ffce7a" }}>NEW SCRIM POSTING</span>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                <Input placeholder="Team name" value={form.team} onChange={e => setForm(f => ({ ...f, team: e.target.value }))} />
                <Input placeholder="Discord tag (how teams reach you)" value={form.contact} onChange={e => setForm(f => ({ ...f, contact: e.target.value }))} />
                <Select value={form.region} onChange={v => setForm(f => ({ ...f, region: v }))} options={REGIONS} />
                <Select value={form.rank} onChange={v => setForm(f => ({ ...f, rank: v }))} options={RANKS} />
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {MODES.map(m => (
                  <button key={m} onClick={() => toggleMode(m)} style={{
                    padding: "7px 14px", borderRadius: 999, cursor: "pointer", fontSize: 12, fontWeight: 600,
                    fontFamily: "'Chakra Petch', sans-serif",
                    background: form.modes.includes(m) ? "rgba(142,230,176,.16)" : "rgba(255,255,255,.04)",
                    border: `1px solid ${form.modes.includes(m) ? "rgba(142,230,176,.4)" : "rgba(255,255,255,.1)"}`,
                    color: form.modes.includes(m) ? "#8ee6b0" : "#b7b7c6",
                  }}>{m}</button>
                ))}
              </div>
              <Input placeholder="Notes — availability, format, expectations…" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} style={{ borderRadius: 18 }} />
              <div><PillButton gold small onClick={submitPost}>Publish posting</PillButton></div>
            </div>
          )}

          {filteredPosts.map(p => (
            <div key={p.id} style={{ borderRadius: 24, padding: 26, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span style={{ fontFamily: DISPLAY, fontSize: 21, fontWeight: 700, color: "#f4f4fa" }}>{p.team}</span>
                <Tag color="#ffce7a" bg="rgba(255,180,61,.12)" border="rgba(255,180,61,.3)">{p.rank.toUpperCase()}</Tag>
                <Tag color="#8ee6b0" bg="rgba(142,230,176,.12)" border="rgba(142,230,176,.3)">{p.region}</Tag>
                <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 11, color: "#6f7180" }}>{p.ago}</span>
              </div>
              <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                {p.modes.map(m => <Tag key={m}>{m}</Tag>)}
              </div>
              {p.note && <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "#9a9aab" }}>{p.note}</p>}
              <div>
                <PillButton violet small onClick={() => { navigator.clipboard?.writeText(p.contact); setToast(`Discord tag "${p.contact}" copied.`); }}>
                  Contact team
                </PillButton>
              </div>
            </div>
          ))}
          {filteredPosts.length === 0 && (
            <p style={{ textAlign: "center", color: "#6f7180", padding: 40 }}>No postings match those filters yet — be the first to post.</p>
          )}
        </div>
      )}

      {/* ─── WAGER MATCHES ─── */}
      {tab === "wagers" && (
        <div style={{ position: "relative", zIndex: 10, maxWidth: 1000, margin: "0 auto", padding: "0 5vw 100px", display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Escrow explainer */}
          <div style={{ borderRadius: 28, padding: 32, background: "linear-gradient(160deg, rgba(179,107,255,.10), rgba(20,14,32,.4))", border: "1px solid rgba(179,107,255,.22)", display: "flex", flexDirection: "column", gap: 16 }}>
            <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 2, color: "#c98bff" }}>HOW ESCROW WORKS</span>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
              {[
                ["01", "Both teams stake", "Credits leave both wallets the moment a challenge is accepted and sit locked in escrow — nobody can touch them mid-match."],
                ["02", "Play the set", "Play your Bo3/Bo5 in a friendly room. Both teams then submit the result by sending in the final game screen."],
                ["03", "Escrow releases", "Matching results pay the full pot to the winner instantly. Conflicting results freeze the pot for admin review."],
              ].map(([num, title, desc]) => (
                <div key={num} style={{ display: "flex", gap: 12 }}>
                  <span style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 10, background: "rgba(179,107,255,.14)", color: "#c98bff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, fontWeight: 700, fontSize: 12 }}>{num}</span>
                  <div>
                    <div style={{ fontWeight: 700, color: "#f4f4fa", fontSize: 14.5, marginBottom: 4 }}>{title}</div>
                    <div style={{ fontSize: 13, lineHeight: 1.55, color: "#9a9aab" }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <p style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: .5, color: "#6f7180" }}>
              DEMO MODE — credits are practice currency while accounts & real payouts are in development.
            </p>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <Tag color="#ffce7a" bg="rgba(255,180,61,.12)" border="rgba(255,180,61,.3)">WALLET · {wallet} CREDITS</Tag>
            <div style={{ marginLeft: "auto" }}>
              <PillButton violet small onClick={() => setShowWagerForm(v => !v)}>{showWagerForm ? "Cancel" : "+ Create challenge"}</PillButton>
            </div>
          </div>

          {showWagerForm && (
            <div style={{ borderRadius: 24, padding: 26, background: "rgba(255,255,255,.03)", border: "1px solid rgba(179,107,255,.3)", display: "flex", flexDirection: "column", gap: 14 }}>
              <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 2, color: "#c98bff" }}>OPEN CHALLENGE</span>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                <Input placeholder="Your team name" value={wagerForm.team} onChange={e => setWagerForm(f => ({ ...f, team: e.target.value }))} />
                <Input type="number" min="1" placeholder="Stake (credits)" value={wagerForm.stake} onChange={e => setWagerForm(f => ({ ...f, stake: e.target.value }))} />
                <Select value={wagerForm.mode} onChange={v => setWagerForm(f => ({ ...f, mode: v }))} options={MODES} />
                <Select value={String(wagerForm.bestOf)} onChange={v => setWagerForm(f => ({ ...f, bestOf: v }))} options={["3", "5"]} />
              </div>
              <div><PillButton violet small onClick={submitWager}>Stake & publish</PillButton></div>
            </div>
          )}

          {wagers.map(w => {
            const st = STATUS_META[w.status];
            return (
              <div key={w.id} style={{ borderRadius: 24, padding: 26, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)", display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: DISPLAY, fontSize: 20, fontWeight: 700, color: "#f4f4fa" }}>
                    {w.host}{w.joiner ? ` vs ${w.joiner}` : " — open challenge"}
                  </span>
                  <Tag color={st.color} bg={st.bg} border={`${st.color}40`}>{st.label}</Tag>
                  <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 15, fontWeight: 700, color: "#ffce7a" }}>
                    {w.stake * 2} <span style={{ fontSize: 10, color: "#6f7180" }}>POT</span>
                  </span>
                </div>
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
                  <Tag>{w.mode}</Tag>
                  <Tag>Bo{w.bestOf}</Tag>
                  <Tag>{w.stake} credits / team</Tag>
                  {w.winner && <Tag color="#8ee6b0" bg="rgba(142,230,176,.12)" border="rgba(142,230,176,.3)">WINNER · {w.winner.toUpperCase()}</Tag>}
                </div>

                {w.status === "open" && !w.mine && (
                  <div><PillButton gold small onClick={() => joinWager(w.id)}>Accept — stake {w.stake} credits</PillButton></div>
                )}
                {w.status === "open" && w.mine && (
                  <p style={{ fontSize: 13, color: "#9a9aab" }}>Your stake is in escrow. Waiting for an opponent to accept…</p>
                )}
                {(w.status === "locked" || w.status === "awaiting") && w.mine && (
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    {!w.joinerClaim ? (
                      <>
                        <span style={{ fontSize: 13, color: "#9a9aab" }}>Match done? Send in the game result:</span>
                        <PillButton small onClick={() => submitResult(w.id, "joiner", "Your Team")}>We won</PillButton>
                        <PillButton small ghost onClick={() => submitResult(w.id, "joiner", w.host)}>They won</PillButton>
                      </>
                    ) : (
                      <span style={{ fontSize: 13, color: "#9a9aab" }}>Result sent — waiting on {w.host} to confirm.</span>
                    )}
                    {/* Demo-only: simulate the opposing team confirming honestly */}
                    {w.joinerClaim && !w.hostClaim && (
                      <PillButton small ghost onClick={() => submitResult(w.id, "host", w.joinerClaim)}>
                        (Demo: opponent confirms)
                      </PillButton>
                    )}
                  </div>
                )}
                {(w.status === "locked" || w.status === "awaiting") && !w.mine && (
                  <p style={{ fontSize: 13, color: "#9a9aab" }}>Stakes locked in escrow — match in progress.</p>
                )}
                {w.status === "disputed" && (
                  <p style={{ fontSize: 13, color: "#ff8f8f" }}>Teams reported different winners. Pot frozen — an admin will review both submitted game results.</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)", zIndex: 300,
          padding: "14px 26px", borderRadius: 999, background: "rgba(13,13,20,.95)",
          border: "1px solid rgba(179,107,255,.4)", color: "#e9e9f2", fontSize: 14, fontWeight: 600,
          boxShadow: "0 20px 50px rgba(0,0,0,.5)", fontFamily: "'Chakra Petch', sans-serif", maxWidth: "90vw",
        }}>{toast}</div>
      )}
    </GuideShell>
  );
}
