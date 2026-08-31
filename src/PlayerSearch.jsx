// ─── Look up another player ───────────────────────────────────────────────────
// Two ways in, because people arrive with either.
//
//   A TAG works for anyone. /player/:tag calls the Supercell API live, so a tag
//   we have never seen still resolves — and looking it up enrols them, so their
//   history starts accumulating from that moment.
//
//   A NAME can only match players we already know. player_directory is the
//   broad source — every battlelog the scrapers read carries {tag, name} for
//   all six players, so it grows on its own at no extra API cost — and the two
//   leaderboard tables are queried alongside it because a top-200 player is
//   almost always the one being searched for, so they are ranked above it.
//
// Tags are matched loosely on input (people paste "#2C20JJRG", "2c20jjrg", or
// with stray spaces) but normalised to one canonical form before navigating.

import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "./appCore";
import { Search, X } from "lucide-react";

const MONO = "'JetBrains Mono', monospace";

// Supercell tags use a restricted alphabet — anything outside it is a name, not
// a tag, which is what stops "Lola" being treated as a malformed tag.
const TAG_CHARS = /^[0289PYLQGRJCUVpylqgrjcuv]+$/;
const normalizeTag = (raw) => String(raw || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
const looksLikeTag = (raw) => {
  const t = String(raw || "").trim();
  const bare = t.replace(/^#/, "").replace(/\s/g, "");
  if (bare.length < 3 || bare.length > 14) return false;
  return t.startsWith("#") ? /^[0-9A-Za-z]+$/.test(bare) : TAG_CHARS.test(bare);
};

export default function PlayerSearch({ compact = false, placeholder = "Look up a player by tag or name" }) {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    const onClick = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRows([]); return; }
    let off = false;
    // Debounced: this fires on every keystroke otherwise, and the tables are
    // public-read so there is no reason to hammer them.
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const like = `%${term.replace(/[%_]/g, "")}%`;
        // tracked_players is third and last: only 4 of its 1,434 rows carry a
        // name TODAY, but the poller writes last_seen_name on every visit, so
        // this source fills in on its own as people get looked up. Ordering it
        // after the leaderboards keeps the ranked, recognisable names on top.
        const [top, masters, directory] = await Promise.all([
          supabase.from("top_200_leaderboard").select("player_tag,name,trophies,rank").ilike("name", like).limit(8),
          supabase.from("masters_players").select("player_tag,name").ilike("name", like).limit(8),
          // The view, not the table: it excludes anyone who opted out of
          // tracking, so one opt-out covers both polling and searchability.
          supabase.from("player_directory_public").select("player_tag,name,last_seen_at")
            .ilike("name", like).order("last_seen_at", { ascending: false }).limit(12),
        ]);
        if (off) return;
        const seen = new Set(), out = [];
        for (const r of top.data || []) {
          const tag = r.player_tag; if (!tag || seen.has(tag)) continue;
          seen.add(tag); out.push({ tag, name: r.name, note: `#${r.rank} global · ${Number(r.trophies || 0).toLocaleString("en-US")}` });
        }
        for (const r of masters.data || []) {
          const tag = r.player_tag; if (!tag || seen.has(tag)) continue;
          seen.add(tag); out.push({ tag, name: r.name, note: "Masters" });
        }
        for (const r of directory.data || []) {
          const tag = r.player_tag; if (!tag || seen.has(tag) || !r.name) continue;
          seen.add(tag); out.push({ tag, name: r.name, note: "Seen in ranked" });
        }
        setRows(out.slice(0, 10));
      } finally {
        if (!off) setBusy(false);
      }
    }, 250);
    return () => { off = true; clearTimeout(t); };
  }, [q]);

  const go = (tag) => {
    const t = normalizeTag(tag);
    if (t.length < 3) return;
    setOpen(false); setQ("");
    navigate(`/player/${t}`);
  };
  const tagCandidate = looksLikeTag(q) ? normalizeTag(q) : null;

  const submit = (e) => {
    e.preventDefault();
    if (tagCandidate) return go(tagCandidate);
    if (rows.length) return go(rows[0].tag);
  };

  return (
    <div ref={box} style={{ position: "relative", maxWidth: compact ? 420 : 620, width: "100%" }}>
      <form onSubmit={submit} style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <Search size={15} style={{ color: "#8b8b9c", position: "absolute", left: 13, pointerEvents: "none" }} />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          aria-label="Look up a player"
          style={{
            width: "100%", padding: "11px 34px 11px 36px", borderRadius: 11,
            background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.11)",
            color: "#e9e9f2", fontFamily: MONO, fontSize: 12.5, outline: "none",
          }} />
        {q && (
          <button type="button" onClick={() => { setQ(""); setRows([]); }} aria-label="Clear" style={{
            position: "absolute", right: 10, background: "none", border: "none",
            cursor: "pointer", color: "#8b8b9c", padding: 4, lineHeight: 1,
          }}><X size={14} /></button>
        )}
      </form>

      {open && (q.trim().length >= 2) && (
        <div style={{
          position: "absolute", zIndex: 30, top: "calc(100% + 6px)", left: 0, right: 0,
          borderRadius: 12, overflow: "hidden", background: "#14141c",
          border: "1px solid rgba(255,255,255,.12)", boxShadow: "0 14px 40px rgba(0,0,0,.55)",
        }}>
          {tagCandidate && (
            <button type="button" onClick={() => go(tagCandidate)} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
              width: "100%", textAlign: "left", cursor: "pointer", padding: "11px 13px",
              background: "rgba(179,107,255,.08)", border: "none",
              borderBottom: rows.length ? "1px solid rgba(255,255,255,.07)" : "none",
            }}>
              <span style={{ fontFamily: MONO, fontSize: 12.5, color: "#e9e9f2" }}>#{tagCandidate}</span>
              <span style={{ fontFamily: MONO, fontSize: 10, color: "#c9a6ff" }}>OPEN THIS TAG →</span>
            </button>
          )}
          {rows.map(r => (
            <button key={r.tag} type="button" onClick={() => go(r.tag)} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
              width: "100%", textAlign: "left", cursor: "pointer", padding: "10px 13px",
              background: "transparent", border: "none",
              borderBottom: "1px solid rgba(255,255,255,.05)",
            }}>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13.5, color: "#e9e9f2",
                               overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                <span style={{ display: "block", fontFamily: MONO, fontSize: 10, color: "#8b8b9c" }}>{r.tag}</span>
              </span>
              <span style={{ fontFamily: MONO, fontSize: 11, color: "#8a7fa6", flexShrink: 0 }}>{r.note}</span>
            </button>
          ))}
          {!busy && !rows.length && !tagCandidate && (
            <div style={{ padding: "12px 13px", fontFamily: MONO, fontSize: 11, color: "#8b8b9c", lineHeight: 1.6 }}>
              No player by that name. Name search covers players we've seen in ranked matches —
              it grows as we collect — so paste a tag to look up anyone else.
            </div>
          )}
          {busy && !rows.length && (
            <div style={{ padding: "12px 13px", fontFamily: MONO, fontSize: 11, color: "#8b8b9c" }}>Searching…</div>
          )}
        </div>
      )}
    </div>
  );
}
