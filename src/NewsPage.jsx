// ─── /news — reads news_posts directly, nothing here writes to it ───────────
// Two content sources land in this one feed, and the page treats them
// identically — the trust distinction (reviewed vs auto) is enforced upstream
// by RLS and the approval gate, not by anything this page decides:
//   internal_stats — our own measured win-rate deltas (patch impact, weekly
//     movers), written straight to news_posts with no review step.
//   news_watch     — a websearch finding, but ONLY ever inserted here after a
//     human approved it via the GitHub issue flow. By the time a row with this
//     source exists, it has already been reviewed; the page has no further
//     judgment to apply.
// See scrapers/news_watch.py and scrapers/news_digest.py for how rows get here.

import { useEffect, useState } from "react";
import { supabase } from "./appCore";
import SiteHeader from "./SiteHeader";

const MONO = "'JetBrains Mono', monospace";
const DISPLAY = "'Baloo 2', sans-serif";

const CATEGORY_STYLE = {
  balance:   { label: "BALANCE",   color: "#ffb43d", bg: "rgba(255,180,61,.12)" },
  brawler:   { label: "BRAWLER",   color: "#c98bff", bg: "rgba(179,107,255,.12)" },
  event:     { label: "EVENT",     color: "#7cc4ff", bg: "rgba(124,196,255,.12)" },
  community: { label: "COMMUNITY", color: "#8ee6b0", bg: "rgba(142,230,176,.12)" },
};

function useNewsPosts() {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    supabase.from("news_posts").select("*").order("published_at", { ascending: false }).limit(100)
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) setError(err.message);
        else setPosts(data || []);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return { posts, loading, error };
}

const formatDate = (iso) => new Date(iso).toLocaleDateString("en-US", {
  month: "short", day: "numeric", year: "numeric",
});

function PostCard({ post }) {
  const cat = CATEGORY_STYLE[post.category] || CATEGORY_STYLE.community;
  const sources = Array.isArray(post.source_urls) ? post.source_urls : [];
  return (
    <article style={{
      background: "rgba(255,255,255,.025)", border: "1px solid rgba(255,255,255,.08)",
      borderRadius: 18, padding: "22px 26px", display: "flex", flexDirection: "column", gap: 12,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{
          fontFamily: MONO, fontSize: 10.5, fontWeight: 700, letterSpacing: 1.4,
          color: cat.color, background: cat.bg, padding: "4px 10px", borderRadius: 999,
        }}>{cat.label}</span>
        {post.patch && (
          <span style={{ fontFamily: MONO, fontSize: 10.5, color: "#8b8b9c" }}>PATCH {post.patch}</span>
        )}
        <span style={{ fontFamily: MONO, fontSize: 10.5, color: "#6f7180", marginLeft: "auto" }}>
          {formatDate(post.published_at)}
        </span>
      </div>
      <h2 style={{ fontFamily: DISPLAY, fontSize: 20, fontWeight: 700, color: "#f4f4fa", margin: 0 }}>
        {post.title}
      </h2>
      <p style={{ fontSize: 14, lineHeight: 1.65, color: "#c9c9d6", margin: 0, whiteSpace: "pre-line" }}>
        {post.summary}
      </p>
      {sources.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 4 }}>
          {sources.map((s, i) => (
            <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
              style={{ fontFamily: MONO, fontSize: 11, color: "#7cc4ff", textDecoration: "none" }}>
              ↗ {s.title || "Source"}
            </a>
          ))}
        </div>
      )}
    </article>
  );
}

export default function NewsPage() {
  const { posts, loading, error } = useNewsPosts();

  return (
    <div style={{ minHeight: "100vh", background: "#08080c", color: "#e9e9f2", fontFamily: "'Chakra Petch', sans-serif" }}>
      <SiteHeader />
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 5vw 80px", display: "flex", flexDirection: "column", gap: 24 }}>
        <div>
          <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 2, color: "#8b8b9c" }}>META NEWS</div>
          <h1 style={{ fontFamily: DISPLAY, fontSize: 32, fontWeight: 800, margin: "6px 0 8px", color: "#f4f4fa" }}>
            News
          </h1>
          <p style={{ fontSize: 13.5, color: "#8b8b9c", lineHeight: 1.6, maxWidth: 560 }}>
            Balance-patch impact and weekly meta movers, measured directly from our own match data —
            plus the occasional community update, always human-checked before it lands here.
          </p>
        </div>

        {loading && <div style={{ color: "#8b8b9c", fontSize: 13.5 }}>Loading…</div>}
        {error && <div style={{ color: "#ff8f8f", fontSize: 13.5 }}>Could not load news right now.</div>}
        {!loading && !error && posts.length === 0 && (
          <div style={{
            background: "rgba(255,255,255,.025)", border: "1px solid rgba(255,255,255,.08)",
            borderRadius: 18, padding: "32px 26px", textAlign: "center", color: "#8b8b9c", fontSize: 13.5,
          }}>
            Nothing posted yet — the first patch-impact and weekly-movers reports land here automatically
            once there's enough data to say something real.
          </div>
        )}
        {posts.map(p => <PostCard key={p.id} post={p} />)}
      </main>
    </div>
  );
}
