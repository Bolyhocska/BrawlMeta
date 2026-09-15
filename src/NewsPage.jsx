// ─── /news — reads news_posts directly, nothing here writes to it ───────────
// Two content sources land in this one feed, and the page treats them
// identically — the trust distinction (reviewed vs auto) is enforced upstream
// by RLS and the approval gate, not by anything this page decides:
//   internal_stats — our own measured win-rate deltas (patch impact, weekly
//     meta snapshot), written straight to news_posts with no review step.
//   news_watch     — a websearch finding, but ONLY ever inserted here after a
//     human approved it via the GitHub issue flow. By the time a row with this
//     source exists, it has already been reviewed; the page has no further
//     judgment to apply.
// See scrapers/news_watch.py and scrapers/news_digest.py for how rows get here.
//
// A post's `data` jsonb (added alongside `summary` text) is what the DETAIL
// page charts — real numbers from the generating script, not text re-parsed
// with regex. It defaults to '{}' for any post type that never sets it, which
// NewsPostDetail below falls back on gracefully (text-only, no charts) rather
// than breaking.

import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase, useSmartBack } from "./appCore";
import { BarList, DeltaBarList } from "./Charts";
import SiteHeader from "./SiteHeader";

const MONO = "'JetBrains Mono', monospace";
const DISPLAY = "'Baloo 2', sans-serif";

const CATEGORY_STYLE = {
  balance:   { label: "BALANCE",   color: "#ffb43d", bg: "rgba(255,180,61,.12)" },
  brawler:   { label: "BRAWLER",   color: "#c98bff", bg: "rgba(179,107,255,.12)" },
  event:     { label: "EVENT",     color: "#7cc4ff", bg: "rgba(124,196,255,.12)" },
  community: { label: "COMMUNITY", color: "#8ee6b0", bg: "rgba(142,230,176,.12)" },
};

const card = {
  background: "rgba(255,255,255,.025)", border: "1px solid rgba(255,255,255,.08)",
  borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 12,
};
const eyebrow = { fontFamily: MONO, fontSize: 11, letterSpacing: 1.5, color: "#8b8b9c" };

const formatDate = (iso) => new Date(iso).toLocaleDateString("en-US", {
  month: "short", day: "numeric", year: "numeric",
});

function CategoryBadge({ post }) {
  const cat = CATEGORY_STYLE[post.category] || CATEGORY_STYLE.community;
  return (
    <span style={{
      fontFamily: MONO, fontSize: 10.5, fontWeight: 700, letterSpacing: 1.4,
      color: cat.color, background: cat.bg, padding: "4px 10px", borderRadius: 999,
    }}>{cat.label}</span>
  );
}

// ── list ──────────────────────────────────────────────────────────────────────

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

// The single biggest fact a card can lead with, without opening it — a mover's
// magnitude for a patch-impact post, or the top win rate for a meta snapshot.
// Returns null for anything without structured data, which is exactly the
// signal to fall back to the plain summary line.
function headlineFact(post) {
  const d = post.data || {};
  if (Array.isArray(d.movers) && d.movers.length) {
    const m = [...d.movers].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
    return { label: m.brawler, value: `${m.delta >= 0 ? "+" : ""}${m.delta}pp`, positive: m.delta >= 0 };
  }
  if (Array.isArray(d.strongest) && d.strongest.length) {
    const s = d.strongest[0];
    return { label: s.brawler, value: `${s.winRate}%`, positive: true };
  }
  return null;
}

function PostCard({ post }) {
  const fact = headlineFact(post);
  const sources = Array.isArray(post.source_urls) ? post.source_urls : [];
  return (
    <Link to={`/news/${post.slug}`} className="bm-lift" style={{ textDecoration: "none", color: "inherit" }}>
      <article style={{ ...card, padding: "22px 26px", cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <CategoryBadge post={post} />
          {post.patch && <span style={{ fontFamily: MONO, fontSize: 10.5, color: "#8b8b9c" }}>PATCH {post.patch}</span>}
          <span style={{ fontFamily: MONO, fontSize: 10.5, color: "#6f7180", marginLeft: "auto" }}>
            {formatDate(post.published_at)}
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <h2 style={{ fontFamily: DISPLAY, fontSize: 20, fontWeight: 700, color: "#f4f4fa", margin: 0, flex: 1, minWidth: 200 }}>
            {post.title}
          </h2>
          {fact && (
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: MONO, fontSize: 19, fontWeight: 800, color: fact.positive ? "#8ee6b0" : "#ff8f8f" }}>
                {fact.value}
              </div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: "#6f7180" }}>{fact.label}</div>
            </div>
          )}
        </div>

        <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "#9a9aab", margin: 0, whiteSpace: "pre-line",
                     display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {post.summary}
        </p>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: MONO, fontSize: 11, color: "#7cc4ff" }}>View full breakdown →</span>
          {sources.length > 0 && (
            <span style={{ fontFamily: MONO, fontSize: 10, color: "#6f7180" }}>{sources.length} source{sources.length > 1 ? "s" : ""}</span>
          )}
        </div>
      </article>
    </Link>
  );
}

export default function NewsPage() {
  const { posts, loading, error } = useNewsPosts();

  return (
    <div style={{ minHeight: "100vh", background: "#08080c", color: "#e9e9f2", fontFamily: "'Chakra Petch', sans-serif" }}>
      <SiteHeader />
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 5vw 80px", display: "flex", flexDirection: "column", gap: 20 }}>
        <div>
          <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 2, color: "#8b8b9c" }}>META NEWS</div>
          <h1 style={{ fontFamily: DISPLAY, fontSize: 32, fontWeight: 800, margin: "6px 0 8px", color: "#f4f4fa" }}>
            News
          </h1>
          <p style={{ fontSize: 13.5, color: "#8b8b9c", lineHeight: 1.6, maxWidth: 560 }}>
            Balance-patch impact and weekly meta snapshots, measured directly from our own match data —
            plus the occasional community update, always human-checked before it lands here.
          </p>
        </div>

        {loading && <div style={{ color: "#8b8b9c", fontSize: 13.5 }}>Loading…</div>}
        {error && <div style={{ color: "#ff8f8f", fontSize: 13.5 }}>Could not load news right now.</div>}
        {!loading && !error && posts.length === 0 && (
          <div style={{ ...card, padding: "32px 26px", textAlign: "center", color: "#8b8b9c", fontSize: 13.5 }}>
            Nothing posted yet — the first patch-impact and meta-snapshot reports land here automatically
            once there's enough data to say something real.
          </div>
        )}
        {posts.map(p => <PostCard key={p.id} post={p} />)}
      </main>
    </div>
  );
}

// ── detail ────────────────────────────────────────────────────────────────────

function useNewsPost(slug) {
  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    supabase.from("news_posts").select("*").eq("slug", slug).maybeSingle()
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) setError(err.message);
        else setPost(data);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [slug]);

  return { post, loading, error };
}

// A short, plain-English line stating the single most interesting fact in the
// post, ahead of any chart — the "most interesting facts first" the page is
// meant to lead with, not something a reader has to find by scanning bars.
function Headline({ post }) {
  const d = post.data || {};
  if (Array.isArray(d.movers) && d.movers.length) {
    const sorted = [...d.movers].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    const riser = sorted.find(m => m.delta > 0);
    const faller = sorted.find(m => m.delta < 0);
    return (
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {riser && <HeadlineStat label="BIGGEST RISER" name={riser.brawler} value={`+${riser.delta}pp`} positive />}
        {faller && <HeadlineStat label="BIGGEST FALLER" name={faller.brawler} value={`${faller.delta}pp`} positive={false} />}
      </div>
    );
  }
  if (Array.isArray(d.strongest) && d.strongest.length) {
    const top = d.strongest[0];
    const bottom = (d.weakest || [])[0];
    return (
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <HeadlineStat label="STRONGEST" name={top.brawler} value={`${top.winRate}%`} positive />
        {bottom && <HeadlineStat label="WEAKEST" name={bottom.brawler} value={`${bottom.winRate}%`} positive={false} />}
      </div>
    );
  }
  return null;
}

function HeadlineStat({ label, name, value, positive }) {
  const colour = positive ? "#8ee6b0" : "#ff8f8f";
  return (
    <div style={{
      flex: "1 1 220px", background: `${colour}0f`, border: `1px solid ${colour}33`,
      borderRadius: 16, padding: "18px 20px",
    }}>
      <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: 1.4, color: colour, marginBottom: 8 }}>{label}</div>
      <div style={{ fontFamily: DISPLAY, fontSize: 26, fontWeight: 800, color: "#f4f4fa" }}>{name}</div>
      <div style={{ fontFamily: MONO, fontSize: 20, fontWeight: 700, color: colour, marginTop: 2 }}>{value}</div>
    </div>
  );
}

export function NewsPostDetail() {
  const { slug } = useParams();
  const { post, loading, error } = useNewsPost(slug);
  const { goBack } = useSmartBack("/news", "News");

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: "#08080c" }}>
        <SiteHeader />
        <div style={{ padding: "60px 5vw", color: "#8b8b9c", fontSize: 13.5 }}>Loading…</div>
      </div>
    );
  }
  if (error || !post) {
    return (
      <div style={{ minHeight: "100vh", background: "#08080c" }}>
        <SiteHeader />
        <div style={{ padding: "60px 5vw", color: "#ff8f8f", fontSize: 13.5 }}>Couldn't find that post.</div>
      </div>
    );
  }

  const d = post.data || {};
  const hasMovers = Array.isArray(d.movers) && d.movers.length > 0;
  const hasStandings = Array.isArray(d.strongest) && d.strongest.length > 0;
  const hasShifters = Array.isArray(d.shifters) && d.shifters.length > 0;
  const hasClasses = Array.isArray(d.classes) && d.classes.length > 0;
  const hasSynergies = Array.isArray(d.synergies) && d.synergies.length > 0;
  const hasUnusual = Array.isArray(d.unusual) && d.unusual.length > 0;
  const sources = Array.isArray(post.source_urls) ? post.source_urls : [];

  return (
    <div style={{ minHeight: "100vh", background: "#08080c", color: "#e9e9f2", fontFamily: "'Chakra Petch', sans-serif" }}>
      <SiteHeader />
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "40px 5vw 80px", display: "flex", flexDirection: "column", gap: 22 }}>
        <button onClick={goBack} className="bm-tap" style={{
          alignSelf: "flex-start", background: "none", border: "none", color: "#8b8b9c",
          fontFamily: MONO, fontSize: 12, cursor: "pointer", padding: 0,
        }}>← News</button>

        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
            <CategoryBadge post={post} />
            {post.patch && <span style={{ fontFamily: MONO, fontSize: 10.5, color: "#8b8b9c" }}>PATCH {post.patch}</span>}
            <span style={{ fontFamily: MONO, fontSize: 10.5, color: "#6f7180" }}>{formatDate(post.published_at)}</span>
          </div>
          <h1 style={{ fontFamily: DISPLAY, fontSize: 30, fontWeight: 800, margin: 0, color: "#f4f4fa" }}>{post.title}</h1>
        </div>

        <Headline post={post} />

        {hasMovers && (
          <div style={card}>
            <div style={eyebrow}>WIN-RATE CHANGE VS {d.priorPatch} · MIN {d.minPicks} GAMES</div>
            <DeltaBarList rows={d.movers.map(m => ({ label: m.brawler, value: m.delta, sub: `${m.priorWr}% → ${m.curWr}%` }))} />
          </div>
        )}

        {hasStandings && (
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))" }}>
            <div style={card}>
              <div style={eyebrow}>STRONGEST · MIN {d.minPicks} GAMES</div>
              <BarList rows={d.strongest.map(r => ({ label: r.brawler, value: r.winRate, sub: r.picks.toLocaleString("en-US") }))} />
            </div>
            <div style={card}>
              <div style={eyebrow}>WEAKEST · MIN {d.minPicks} GAMES</div>
              <BarList rows={(d.weakest || []).map(r => ({ label: r.brawler, value: r.winRate, sub: r.picks.toLocaleString("en-US") }))} />
            </div>
          </div>
        )}

        {hasShifters && (
          <div style={card}>
            <div style={eyebrow}>BIGGEST SHIFTS · LAST 7 DAYS</div>
            <DeltaBarList rows={d.shifters.map(s => ({ label: s.brawler, value: s.delta, sub: `${s.beforeWr}% → ${s.last7dWr}%` }))} />
          </div>
        )}

        {hasClasses && (
          <div style={card}>
            <div style={eyebrow}>MOST DRAFTED CLASSES</div>
            {/* Neutral accent, not the win-rate green/red BarList defaults to —
                this is a SHARE OF PICKS, not a win rate, and 52/48 thresholds
                would color it meaninglessly. */}
            <BarList accent="#c98bff" unit="%"
              rows={d.classes.map(c => ({ label: c.class.replace(/_/g, " ").replace(/\b\w/g, ch => ch.toUpperCase()), value: c.sharePct, sub: c.picks.toLocaleString("en-US") }))} />
          </div>
        )}

        {hasSynergies && (
          <div style={card}>
            <div style={eyebrow}>BEST DUOS · ABOVE THEIR OWN SOLO AVERAGE</div>
            <DeltaBarList rows={d.synergies.map(s => ({ label: `${s.a} + ${s.b}`, value: s.excess, sub: `${s.duoWr}% together` }))} />
          </div>
        )}

        {hasUnusual && (
          <div style={card}>
            <div style={eyebrow}>UNUSUAL ON A SPECIFIC MAP</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {d.unusual.map((u, i) => {
                const colour = u.deviation >= 0 ? "#8ee6b0" : "#ff8f8f";
                return (
                  <div key={i} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "10px 14px", borderRadius: 10, background: "rgba(255,255,255,.03)",
                  }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#f4f4fa" }}>{u.brawler} on {u.map}</div>
                      <div style={{ fontFamily: MONO, fontSize: 11, color: "#8b8b9c", marginTop: 2 }}>
                        {u.overallWr}% overall → {u.mapWr}% here · {u.picks.toLocaleString("en-US")} games
                      </div>
                    </div>
                    <div style={{ fontFamily: MONO, fontSize: 16, fontWeight: 800, color: colour }}>
                      {u.deviation >= 0 ? "+" : ""}{u.deviation}pp
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!hasMovers && !hasStandings && (
          <p style={{ fontSize: 14, lineHeight: 1.7, color: "#c9c9d6", whiteSpace: "pre-line" }}>{post.summary}</p>
        )}

        {sources.length > 0 && (
          <div style={card}>
            <div style={eyebrow}>SOURCES</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {sources.map((s, i) => (
                <a key={i} href={s.url} target="_blank" rel="noopener noreferrer"
                  style={{ fontFamily: MONO, fontSize: 12.5, color: "#7cc4ff", textDecoration: "none" }}>
                  ↗ {s.title || "Source"}
                </a>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
