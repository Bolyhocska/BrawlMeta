// ─── Brawler guide page ──────────────────────────────────────────────────────
// Full-page brawler guide, recreated from the Claude Design handoff
// ("Brock Guide.dc.html"). Layout, spacing and colour are the design's; all
// numbers are ours — live per-map/per-mode win rates from ranked_matches, the
// official ability names and art from brawlerMeta.json, and our own tier list
// in place of the mock's invented "Meta Score".
//
// Sections (mirroring the design's side rail): Overview · Best Build ·
// Combat Stats · Guide · Maps & Modes · Synergies · How to Counter.

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import BRAWLER_META from "./data/brawlerMeta.json";
import { getExtendedGuide } from "./data/extendedGuides";
import { supabase, MODE_ICONS, GEAR_ICONS } from "./appCore";
import { draftClassOf, classLabel } from "./data/draftEngine";
import {
  getBrawlerGuide, getGeneralTier, scaleStatValue, POWER_LEVELS, iconOverride,
} from "./data/brawlerTips";

const DISPLAY = "'Baloo 2', sans-serif";
const BODY = "'Chakra Petch', sans-serif";
const MONO = "'JetBrains Mono', monospace";

const CARD = { borderRadius: 24, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)" };
const H2_SIZE = "clamp(24px,3vw,30px)";
// margin:0 matters — the app resets html/body margins but not headings, so an
// h2 otherwise carries ~25px of default top margin (which threw the chevron
// alignment off and quietly padded every section header).
const H2 = { fontFamily: DISPLAY, fontSize: H2_SIZE, lineHeight: 1.2, color: "#f4f4fa", letterSpacing: "-.3px", margin: 0 };
// Height of the H2's line box — used to centre the collapse chevron on the
// TITLE rather than on the whole header block (which includes the subtitle).
const H2_LINE = `calc(${H2_SIZE} * 1.2)`;
const SUB = { fontFamily: BODY, fontSize: 13.5, color: "#8b8b9c", margin: "4px 0 0" };

const FORMAT_MODE = (m) => (m || "").replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase()).trim();
// Capitalize the first LETTER of each word, not the first character — "8-BIT"
// starts with a digit, so charAt(0) had no uppercase form and the name rendered
// as "8-bit". Hyphenated parts capitalize too ("8-Bit", "Mr. P").
const fmtName = (key) => (key || "").toLowerCase()
  .replace(/[a-z]+/g, w => w.charAt(0).toUpperCase() + w.slice(1))
  .replace(/\s+/g, " ").trim();
const wrColor = (wr) => (wr >= 53 ? "#8ee6b0" : wr >= 49 ? "#ffce7a" : "#ff8f8f");
// Title-case a video label: capitalize each word, but leave short connecting
// words lowercase unless they lead a phrase — otherwise proper map names come
// out wrong ("Ring Of Fire", "Out In The Open"). Separators (·, —, #2) and
// apostrophes pass through untouched.
const MINOR_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "vs", "w", "with"]);
const titleCase = (s) => (s || "").split(" ").map((w, i, arr) => {
  const lower = w.toLowerCase();
  // Lead word of the string, or the word right after a — / · separator, always caps.
  const leadsPhrase = i === 0 || ["—", "·", "-"].includes(arr[i - 1]);
  if (!leadsPhrase && MINOR_WORDS.has(lower)) return lower;
  return w.charAt(0).toUpperCase() + w.slice(1);
}).join(" ");

// Combat-stat values may be a plain number, a level-invariant string, or a
// composite like "9 × {0}" / "{0} main + {1} × 2". `parts` are scaled by the
// power selector individually so every number inside a breakdown stays honest,
// not just the headline figure.
const fillParts = (tpl, parts = [], power) =>
  tpl.replace(/\{(\d+)\}/g, (_, i) => scaleStatValue(parts[+i] ?? 0, power).toLocaleString("en-US"));

const statText = (c, power) => {
  if (c.tpl) return fillParts(c.tpl, c.parts, c.scaled ? power : 11);
  if (c.scaled) return scaleStatValue(c.value, power).toLocaleString("en-US");
  return typeof c.value === "number" ? c.value.toLocaleString("en-US") : c.value;
};

// Map clips render in this order: the right way first, the wrong way second,
// then anything untagged (mode-wide technique, which is neither).
const CLIP_GROUPS = [
  { kind: "do", label: "DO", color: "#8ee6b0", mark: "do" },
  { kind: "dont", label: "DON'T", color: "#ff8f8f", mark: "dont" },
  { kind: null, label: null, color: null, mark: null },
];

const SECTIONS = [
  { id: "overview", label: "Overview" },
  // Generated-page sections. They only render for brawlers with no written
  // guide, and `present` below drops them from the rail otherwise.
  { id: "game-plan", label: "How to Play" },
  { id: "abilities", label: "Abilities" },
  { id: "best-build", label: "Best Build" },
  { id: "combat-stats", label: "Combat Stats" },
  { id: "guide", label: "Guide" },
  { id: "maps-modes", label: "Maps & Modes" },
  { id: "matchups", label: "Match-ups" },
  { id: "counter", label: "How to Counter" },
];

// ── Shared primitives ────────────────────────────────────────────────────────
function Pill({ children, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      fontFamily: BODY, fontWeight: 600, fontSize: 13.5, letterSpacing: ".3px",
      padding: "10px 18px", borderRadius: 999, border: "none", cursor: "pointer",
      background: active ? "#b36bff" : "transparent", color: active ? "#0a0a0f" : "#b7b7c6",
      transition: "background .15s, color .15s",
    }}>{children}</button>
  );
}

function PillTrack({ children }) {
  return (
    <div style={{
      display: "flex", gap: 8, flexWrap: "wrap", padding: 6, borderRadius: 999,
      background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)", width: "fit-content",
    }}>{children}</div>
  );
}

// Tick and cross drawn as SVG paths rather than the "✓"/"✕" glyphs. Those two
// characters sit off-centre inside a small round badge — their ink doesn't fill
// the em box symmetrically, so no amount of grid/flex centring moves them, and
// the exact offset changes with whichever font the browser falls back to. Same
// reasoning as the Chevron above.
function MarkGlyph({ kind, size = 9 }) {
  const d = kind === "do" ? "M4 12.5l5 5 11-11" : "M5.5 5.5l13 13M18.5 5.5l-13 13";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
      <path d={d} />
    </svg>
  );
}

// Shared chrome for a media slot: the verdict badge + caption above the frame,
// and the frame's border tint. A do/dont clip carries its verdict on the label
// and in the frame colour, so a "wrong way" demo can never be mistaken for
// instruction.
function slotMark(kind) {
  return kind === "do" ? { c: "#8ee6b0", kind: "do" } : kind === "dont" ? { c: "#ff8f8f", kind: "dont" } : null;
}

function SlotLabel({ label, mark }) {
  if (!label) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: MONO, fontSize: 10, letterSpacing: .8, color: mark ? mark.c : "#9a9aab" }}>
      {mark && (
        <span style={{
          width: 15, height: 15, borderRadius: 999, flexShrink: 0,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          color: mark.c, background: `${mark.c}1f`, border: `1px solid ${mark.c}59`,
        }}><MarkGlyph kind={mark.kind} size={8} /></span>
      )}
      {titleCase(label)}
    </span>
  );
}

const slotBorder = (mark, tone) => mark ? `${mark.c}3d`
  : tone === "#ff8f8f" ? "rgba(255,122,122,.18)" : "rgba(255,255,255,.08)";

// Owner-supplied still, for the cases where a single annotated frame teaches
// better than motion (Bibi's bubble-bounce angle). Same chrome as VideoSlot
// minus the LOOP chip. `src` carries its own extension, since stills aren't
// all one format the way the clips are.
//
// The frame keeps VideoSlot's 16:9 box by default and the image is `contain`,
// not `cover`: a diagram must not be cropped, and reserving the height stops
// the slot laying out at 0px before the image arrives. `ratio` overrides the
// box for stills that aren't landscape — a portrait detail crop in a 16:9 frame
// shrinks to the point of being unreadable.
//
// Deliberately NOT `loading="lazy"`. Guide stills sit inside a collapsible
// section that UNMOUNTS when closed, so the section already does the deferring
// that lazy would — and lazy actively broke it here: the request returned 200
// but the element never decoded or painted.
function ImageSlot({ base, src, label, tone = "#8ee6b0", kind, ratio = "16/9" }) {
  const [failed, setFailed] = useState(false);
  const mark = slotMark(kind);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <SlotLabel label={label} mark={mark} />
      <div style={{ position: "relative", borderRadius: 16, overflow: "hidden", aspectRatio: ratio, background: "#0c0c14", border: `1px solid ${slotBorder(mark, tone)}` }}>
        {failed ? (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 12, textAlign: "center", background: "linear-gradient(160deg, rgba(179,107,255,.10), rgba(20,14,32,.5))" }}>
            <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1, color: "#8b8b9c" }}>IMAGE UNAVAILABLE</span>
          </div>
        ) : (
          <img src={`${base}/${src}`} alt={label || ""} onError={() => setFailed(true)}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} />
        )}
      </div>
    </div>
  );
}

// Owner-supplied muted loop clip, gated on visibility in two stages:
//
//   armed   — within 400px of the viewport, so the file is worth downloading
//   visible — at least a quarter on screen, so it should actually be playing
//
// Both matter. This used to be a plain `autoPlay` with `preload="metadata"`,
// and the comment above it claimed clips played "only while on screen" — they
// didn't. Every mounted clip downloaded and decoded immediately regardless of
// scroll position: 3.4 MB before the first interaction on Brock, and up to 13
// clips decoding at once with the map section open. Only tab switches and
// section collapses stopped anything, because those unmount.
//
// play() is driven from an effect rather than the observer callback so it can't
// fire before `src` exists, and its promise is caught — it rejects whenever the
// element unmounts mid-call, which happens constantly on fast tab switching.
function VideoSlot({ base, src, label, tone = "#8ee6b0", kind }) {
  const [failed, setFailed] = useState(false);
  const [armed, setArmed] = useState(false);
  const [visible, setVisible] = useState(false);
  const boxRef = useRef(null);
  const vidRef = useRef(null);
  const sawObserver = useRef(false);
  const mark = slotMark(kind);

  useEffect(() => {
    const el = boxRef.current;
    // No IntersectionObserver: load and play everything, i.e. the old
    // behaviour. A clip that never plays would be worse than a heavy page.
    if (!el || typeof IntersectionObserver === "undefined") {
      setArmed(true); setVisible(true);
      return;
    }
    const seen = () => { sawObserver.current = true; };
    const preload = new IntersectionObserver(([e]) => {
      seen();
      if (e.isIntersecting) { setArmed(true); preload.disconnect(); }
    }, { rootMargin: "400px 0px" });
    const playback = new IntersectionObserver(([e]) => { seen(); setVisible(e.isIntersecting); }, { threshold: 0.25 });
    preload.observe(el);
    playback.observe(el);

    // Safety net. An observer normally delivers its first callback almost
    // immediately, even for an off-screen element — but a page that never
    // composites (hidden pane, occluded webview) delivers NOTHING, and the clip
    // would then sit black forever because `src` is gated on that callback.
    // If nothing has arrived at all, assume gating is unavailable and load.
    const bail = setTimeout(() => {
      if (!sawObserver.current) { setArmed(true); setVisible(true); }
    }, 1500);

    return () => { clearTimeout(bail); preload.disconnect(); playback.disconnect(); };
  }, []);

  useEffect(() => {
    const v = vidRef.current;
    if (!v || !armed) return;
    if (visible) v.play().catch(() => {});
    else v.pause();
  }, [armed, visible]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <SlotLabel label={label} mark={mark} />
      <div ref={boxRef} style={{ position: "relative", borderRadius: 16, overflow: "hidden", aspectRatio: "16/9", background: "#0c0c14", border: `1px solid ${slotBorder(mark, tone)}` }}>
        {failed ? (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 12, textAlign: "center", background: "linear-gradient(160deg, rgba(179,107,255,.10), rgba(20,14,32,.5))" }}>
            <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1, color: "#8b8b9c" }}>CLIP UNAVAILABLE</span>
          </div>
        ) : (
          <video
            ref={vidRef}
            src={armed ? `${base}/${src}.mp4` : undefined}
            muted loop playsInline preload={armed ? "auto" : "none"}
            onError={() => { if (armed) setFailed(true); }}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
          />
        )}
        <div style={{ position: "absolute", top: 8, right: 8, fontFamily: MONO, fontSize: 10.5, letterSpacing: 1, color: "#e9e9f2", background: "rgba(0,0,0,.55)", padding: "3px 8px", borderRadius: 999, display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: tone }} />LOOP · MUTED
        </div>
      </div>
    </div>
  );
}

// Renders one media entry as either a clip or a still, so tips and the map
// grid can mix them freely in authored order. An entry is a still when it
// carries `image` (a filename WITH its extension) rather than `src` (a clip
// stem, which always resolves to .mp4). `kind` may be forced by the caller —
// the map grid groups its clips into do/don't blocks before rendering them.
function MediaSlot({ base, item, tone, kind }) {
  const common = { base, label: item.label, kind: kind === undefined ? item.kind : kind, tone };
  return item.image
    ? <ImageSlot {...common} src={item.image} ratio={item.ratio} />
    : <VideoSlot {...common} src={item.src} />;
}

const mediaKey = (item) => item.image || item.src;

// Official mode logo. `size` is the icon box; falls back silently (no broken
// image) if the CDN art doesn't resolve.
function ModeIcon({ mode, size = 22, title }) {
  const url = MODE_ICONS[mode];
  if (!url) return null;
  return <img src={url} alt={title || mode} title={title} width={size} height={size} style={{ objectFit: "contain", flexShrink: 0 }} />;
}

// The "General" build tab: three mode logos in a triangle, signalling "all
// modes" rather than any single one.
function GeneralTriangle({ size = 30 }) {
  const s = size / 2.4;
  const modes = ["gemGrab", "brawlBall", "knockout"];
  return (
    <span style={{ position: "relative", display: "inline-block", width: size, height: size, flexShrink: 0 }}>
      <img src={MODE_ICONS[modes[0]]} alt="" width={s} height={s} style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", objectFit: "contain" }} />
      <img src={MODE_ICONS[modes[1]]} alt="" width={s} height={s} style={{ position: "absolute", bottom: 0, left: 0, objectFit: "contain" }} />
      <img src={MODE_ICONS[modes[2]]} alt="" width={s} height={s} style={{ position: "absolute", bottom: 0, right: 0, objectFit: "contain" }} />
    </span>
  );
}

// Collapse affordance. An inline SVG rather than a "▾" glyph so it renders
// identically everywhere instead of depending on font fallback, drawn with
// rounded caps and sat in a rounded-999px chip to match the design system's
// "everything rounded, nothing sharp" shape language.
function Chevron({ open, size = 24 }) {
  return (
    <span aria-hidden="true" style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
      width: size + 14, height: size + 14, borderRadius: 999,
      background: open ? "rgba(179,107,255,.12)" : "rgba(255,255,255,.05)",
      border: `1px solid ${open ? "rgba(179,107,255,.28)" : "rgba(255,255,255,.10)"}`,
      transform: `rotate(${open ? 180 : 0}deg)`,
      transition: "transform .22s ease, background .18s, border-color .18s",
    }}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
        stroke={open ? "#c98bff" : "#9a9aab"} strokeWidth="2.6"
        strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 9.5l6 6 6-6" />
      </svg>
    </span>
  );
}

const TIP_TONE = {
  violet: { bg: "rgba(179,107,255,.14)", fg: "#c98bff", noteBorder: "rgba(179,107,255,.35)" },
  red: { bg: "rgba(255,122,122,.14)", fg: "#ff8f8f", noteBorder: "rgba(255,122,122,.35)" },
};

// Verdict on an ability, shown on every star power and gadget rather than only
// the recommended one — "why not the other gadget" is the question a build page
// exists to answer, and the guides already carry the answer in
// abilityNotes[].pick. Reuses the site's existing green/amber/red vocabulary.
const VERDICTS = {
  best: { label: "BEST PICK", fg: "#8ee6b0", bg: "rgba(142,230,176,.14)", border: "rgba(142,230,176,.40)", dim: false },
  strong: { label: "ALSO STRONG", fg: "#8ee6b0", bg: "rgba(142,230,176,.10)", border: "rgba(142,230,176,.28)", dim: false },
  situational: { label: "SITUATIONAL", fg: "#ffce7a", bg: "rgba(255,180,61,.13)", border: "rgba(255,180,61,.38)", dim: false },
  skip: { label: "SKIP", fg: "#ff8f8f", bg: "rgba(255,122,122,.13)", border: "rgba(255,122,122,.38)", dim: true },
  alt: { label: "ALTERNATIVE", fg: "#9a9aab", bg: "rgba(255,255,255,.05)", border: "rgba(255,255,255,.12)", dim: true },
};

function VerdictBadge({ v }) {
  return (
    <span style={{
      fontFamily: MONO, fontSize: 10.5, letterSpacing: 1.2, fontWeight: 700, whiteSpace: "nowrap",
      padding: "3px 9px", borderRadius: 999, color: v.fg, background: v.bg, border: `1px solid ${v.border}`,
    }}>{v.label}</span>
  );
}

function NumberedTip({ n, lead, rest, tone = "violet" }) {
  const c = TIP_TONE[tone] || TIP_TONE.violet;
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <span style={{
        flexShrink: 0, width: 26, height: 26, borderRadius: 9, background: c.bg, color: c.fg,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: MONO, fontWeight: 700, fontSize: 11,
      }}>{String(n).padStart(2, "0")}</span>
      <p style={{ fontSize: 14.5, lineHeight: 1.65, color: "#c9c9d6" }}>
        <strong style={{ color: "#f4f4fa" }}>{lead}</strong> {rest}
      </p>
    </div>
  );
}

// Italic follow-up note under a tip, marked with a left rule so it reads as a
// child of the tip rather than a new point.
function TipNote({ children, tone = "violet" }) {
  const c = TIP_TONE[tone] || TIP_TONE.violet;
  return (
    <p style={{
      margin: 0, paddingLeft: 12, borderLeft: `2px solid ${c.noteBorder}`,
      fontSize: 13.5, lineHeight: 1.6, color: "#a4a4b5", fontStyle: "italic",
    }}>{children}</p>
  );
}

// Titled figures table (damage breakdowns). Monospace numbers so they line up.
function FiguresBlock({ title, rows }) {
  return (
    <div style={{
      borderRadius: 16, padding: "14px 16px",
      background: "rgba(255,180,61,.06)", border: "1px solid rgba(255,180,61,.20)",
    }}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1.4, color: "#ffce7a", marginBottom: 10 }}>
        {title.toUpperCase()}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={{ flex: 1, minWidth: 150, fontSize: 13, color: "#c9c9d6" }}>{r.label}</span>
            <span style={{ fontFamily: MONO, fontSize: 13.5, fontWeight: 700, color: "#f4f4fa" }}>{r.value}</span>
            {r.extra && <span style={{ fontFamily: MONO, fontSize: 11, color: "#8b8b9c" }}>{r.extra}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// A tip paired with the footage that demonstrates it: text and clips side by
// side on desktop (text vertically centred against the video), text stacked
// above the clips on mobile. Falls back to full-width text when there's no
// clip, so tips without footage don't leave a hole in the layout.
function TipRow({ n, tip, tone = "violet", videoBase }) {
  const vids = tip.videos || [];
  const noteVids = tip.noteVideos || [];
  const text = (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      <NumberedTip n={n} lead={tip.lead} rest={tip.rest} tone={tone} />
      {tip.note && noteVids.length === 0 && <TipNote tone={tone}>{tip.note}</TipNote>}
      {tip.block && <FiguresBlock title={tip.block.title} rows={tip.block.rows} />}
    </div>
  );

  // Stills and clips interleave in one column, in authored order, so a diagram
  // can sit directly above the footage that demonstrates it.
  const clips = (list) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      {list.map(v => (
        <MediaSlot key={mediaKey(v)} base={videoBase} item={v}
          tone={tone === "red" ? "#ff8f8f" : "#8ee6b0"} />
      ))}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {vids.length > 0
        ? <div className="guide-split" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.1fr) minmax(0,1fr)", gap: 20, alignItems: "center" }}>
            {text}{clips(vids)}
          </div>
        : text}
      {/* A note with its own footage becomes its own aligned row. */}
      {tip.note && noteVids.length > 0 && (
        <div className="guide-split" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.1fr) minmax(0,1fr)", gap: 20, alignItems: "center" }}>
          <TipNote tone={tone}>{tip.note}</TipNote>
          {clips(noteVids)}
        </div>
      )}
    </div>
  );
}

// Renders a tab's tips, honouring `header` entries that open a labelled
// sub-group and restart the numbering (Gadget 1 / Gadget 2).
function TipList({ tips, tone = "violet", videoBase }) {
  let n = 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {tips.map((t, i) => {
        if (t.header) {
          n = 0;
          return (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 12, marginTop: i === 0 ? 0 : 6,
            }}>
              <span style={{ fontFamily: DISPLAY, fontSize: 19, fontWeight: 700, color: "#f4f4fa" }}>{t.header}</span>
              <span style={{ flex: 1, height: 1, background: "rgba(255,255,255,.10)" }} />
            </div>
          );
        }
        n += 1;
        return <TipRow key={i} n={n} tip={t} tone={tone} videoBase={videoBase} />;
      })}
    </div>
  );
}

// Collapsible section. Every content section on the page uses this so the
// chevron affordance is consistent, and because collapsing UNMOUNTS the section
// — which matters here: Guide and Maps & Modes can each hold five autoplaying
// muted loops, so closing them genuinely stops that decode work.
//
// Two variants, mirroring the design handoff's two section shapes:
//   "card" — heading lives inside a bordered panel (Combat Stats, Guide, Maps)
//   "bare" — heading sits above unwrapped content (Best Build, Match-ups, …)
// `right` is an optional header slot (e.g. the power-level select) that must
// not toggle the section when clicked.
function Section({ id, title, subtitle, right, open, onToggle, variant = "card", children }) {
  const card = variant === "card";
  const headerPad = card ? 26 : 0;

  const toggle = () => onToggle();
  const onKeyDown = (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
  };

  return (
    <section id={id} style={card
      ? { ...CARD, scrollMarginTop: 110, overflow: "hidden" }
      : { scrollMarginTop: 110 }}>
      {/* A div rather than a <button> so an interactive `right` slot can nest
          legally; keyboard semantics are restored explicitly. */}
      <div className="bm-tap"
        role="button" tabIndex={0} aria-expanded={open} aria-controls={`${id}-content`}
        onClick={toggle} onKeyDown={onKeyDown}
        style={{
          // flex-start so the chevron can be pinned to the title's line box
          // rather than floating to the middle of title + subtitle.
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
          gap: 16, padding: headerPad, cursor: "pointer", textAlign: "left",
          marginBottom: card ? 0 : (open ? 18 : 0), transition: "margin-bottom .18s",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h2 style={H2}>{title}</h2>
          {subtitle && (typeof subtitle === "string"
            ? <p style={SUB}>{subtitle}</p>
            : <div style={{ marginTop: 8 }}>{subtitle}</div>)}
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexShrink: 0 }}>
          {right && <div onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>{right}</div>}
          {/* Fixed-height box equal to the H2 line, so the chevron centres on
              the title no matter how tall the subtitle or `right` slot is. */}
          <span style={{ display: "flex", alignItems: "center", height: H2_LINE }}>
            <Chevron open={open} />
          </span>
        </div>
      </div>
      {open && (
        <div id={`${id}-content`} style={card ? { padding: "0 26px 26px" } : undefined}>
          {children}
        </div>
      )}
    </section>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function BrawlerGuidePage({
  brawler, byMode, byMap, allBrawlers = [], onBack, backLabel = "Tier List",
  rankBracket = "masters_legendary", onRankBracketChange, rankBrackets = [],
}) {
  // Every number on this page — overall rate, per-mode, per-map, match-ups —
  // comes from ONE bracket. Labels are derived from it rather than hardcoded,
  // so nothing can say "Masters+" while showing Diamond data.
  const bracketMeta = rankBrackets.find(b => b.id === rankBracket);
  const bracketLabel = bracketMeta?.label
    || (rankBracket === "masters_legendary" ? "Masters & Legendary" : "Diamond & Mythic");
  const bracketShort = rankBracket === "masters_legendary" ? "Masters+" : "Diamond & Mythic";
  const bracketAccent = bracketMeta?.accent || "#ffb43d";
  // The hand-written map and mode notes were researched against Masters+. They
  // stay visible on the other bracket, but the page says so rather than letting
  // prose written for one population sit unlabelled under another's numbers.
  const notesMatchBracket = rankBracket === "masters_legendary";

  const guide = getBrawlerGuide(brawler.key);
  const ext = getExtendedGuide(brawler.key);
  const { tier, provisional } = getGeneralTier(brawler.key);

  const [power, setPower] = useState(11);
  const [buildTab, setBuildTab] = useState("General");
  const [guideTab, setGuideTab] = useState(0);
  // Every content section is collapsible, all open by default — nothing is
  // hidden from someone landing here for the first time; collapsing is a tool
  // for readers who already know what they came for.
  const [openSections, setOpenSections] = useState({
    "best-build": true, "combat-stats": true, guide: true,
    "maps-modes": true, matchups: true, counter: true,
  });
  const isOpen = (id) => openSections[id] !== false;
  const toggleSection = (id) => setOpenSections(s => ({ ...s, [id]: s[id] === false }));
  const [modeIdx, setModeIdx] = useState(0);
  const [mapIdx, setMapIdx] = useState(0);
  const [activeSection, setActiveSection] = useState("overview");
  const [liveSynergies, setLiveSynergies] = useState(null);
  const [liveCounters, setLiveCounters] = useState(null);

  // Live match-up data from brawler_intelligence (Masters+, current patch):
  //  • with_brawler → best teammates (highest win rate together)
  //  • vs_brawler   → worst opponents (lowest win rate against)
  // Both ranked with a 300-game floor so they're real, top 6 each. Reasons are
  // hand-written where we have them, class-derived otherwise.
  useEffect(() => {
    let cancelled = false;
    const rank = (obj, dir) => Object.entries(obj || {})
      .map(([key, v]) => ({ key: key.toUpperCase(), winRate: Math.round(Number(v.winRate) * 10) / 10, games: Number(v.picks) }))
      .filter(r => r.games >= 300 && Number.isFinite(r.winRate) && r.key !== brawler.key)
      .sort((a, b) => dir * (b.winRate - a.winRate))
      .slice(0, 6);
    supabase
      .from("brawler_intelligence")
      .select("with_brawler, vs_brawler")
      .eq("brawler", brawler.key)
      .eq("patch", "68.250")
      .eq("rank_bracket", rankBracket)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        // A bracket with no row must clear the old one, or switching brackets
        // leaves the previous bracket's pairs on screen under the new label.
        setLiveSynergies(data ? rank(data.with_brawler, 1) : []);   // highest win rate with
        setLiveCounters(data ? rank(data.vs_brawler, -1) : []);     // lowest win rate against
      });
    return () => { cancelled = true; };
  }, [brawler.key, rankBracket]);

  // ── Live stats ─────────────────────────────────────────────────────────────
  const modeStats = useMemo(() => Object.entries(byMode).map(([mode, brawlers]) => {
    const s = brawlers[brawler.key];
    if (!s || s.picks < 30) return null;
    return { mode, picks: s.picks, winRate: Math.round((s.wins / s.picks) * 1000) / 10 };
  }).filter(Boolean).sort((a, b) => b.winRate - a.winRate), [byMode, brawler.key]);

  const mapsByMode = useMemo(() => {
    const out = {};
    for (const [map, data] of Object.entries(byMap)) {
      const s = data.brawlers[brawler.key];
      if (!s || s.picks < 30) continue;
      (out[data.mode] ||= []).push({ map, picks: s.picks, winRate: Math.round((s.wins / s.picks) * 1000) / 10 });
    }
    for (const list of Object.values(out)) list.sort((a, b) => b.winRate - a.winRate);
    return out;
  }, [byMap, brawler.key]);

  // Overall rank across every brawler with a real sample — a real number from
  // our data, replacing the design's hardcoded "#8".
  const overallRank = useMemo(() => {
    const ranked = allBrawlers
      .filter(b => b.winRate != null && b.picks >= 500)
      .sort((a, b) => b.winRate - a.winRate);
    const i = ranked.findIndex(b => b.key === brawler.key);
    return i >= 0 ? { rank: i + 1, of: ranked.length } : null;
  }, [allBrawlers, brawler.key]);

  const modeKeys = useMemo(() => modeStats.map(m => m.mode), [modeStats]);
  const activeMode = modeKeys[modeIdx] ?? modeKeys[0];
  const activeMaps = (activeMode && mapsByMode[activeMode]) || [];
  const activeMap = activeMaps[mapIdx] || activeMaps[0] || null;

  // Clips for the selected map: its own first, then any mode-wide technique
  // (Brawl Ball goal tricks are general, so they ride along on every BB map).
  const activeMapVideos = useMemo(() => {
    if (!guide) return [];
    const own = (guide.mapVideos?.[activeMap?.map] || []).map(v => ({ ...v, scope: "map" }));
    const modeWide = (guide.modeVideos?.[activeMode] || []).map(v => ({ ...v, scope: "mode" }));
    return [...own, ...modeWide];
  }, [guide, activeMap, activeMode]);

  // Scroll-spy for the side rail. Computed from scroll position rather than an
  // IntersectionObserver: the observer only reports intersection CHANGES, so
  // jumping past several sections at once (anchor click, scrollIntoView) can
  // leave the rail highlighting a section that's no longer on screen.
  useEffect(() => {
    const onScroll = () => {
      const line = 140; // just under the sticky header
      let current = SECTIONS[0].id;
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= line) current = s.id;
      }
      // At the very bottom the last section may never cross the line.
      if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 8) {
        const last = SECTIONS.filter(s => document.getElementById(s.id)).pop();
        if (last) current = last.id;
      }
      setActiveSection(current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [openSections]);

  // ── Build tab wiring ───────────────────────────────────────────────────────
  const buildTabs = useMemo(() => {
    if (!guide?.builds) return [];
    return ["General", ...modeKeys.filter(m => guide.builds[m])];
  }, [guide, modeKeys]);

  const build = guide?.builds?.[buildTab] || guide?.builds?.General || null;

  // Resolve a build's named abilities back to the official entries + art.
  const resolveBuild = useCallback((b) => {
    if (!b) return [];
    const find = (list, name) => (list || []).find(x => x.name === name);
    const items = [];
    const sp = find(brawler.starPowers, b.starPower);
    const gd = find(brawler.gadgets, b.gadget);
    if (sp) items.push({ kind: "STAR POWER", accent: "#ffb43d", ...sp, img: iconOverride(brawler.key, sp.name) || sp.img });
    if (gd) items.push({ kind: "GADGET", accent: "#c98bff", ...gd, img: iconOverride(brawler.key, gd.name) || gd.img });
    for (const g of b.gears || []) {
      items.push({ kind: "GEAR", accent: GEAR_TINT[g] || "#8ee6b0", gear: g, name: `${g} Gear`, desc: GEAR_DESC[g] || "", img: null });
    }
    return items;
  }, [brawler.starPowers, brawler.gadgets]);

  const buildItems = useMemo(() => resolveBuild(build), [resolveBuild, build]);

  // EVERY star power and gadget, not just the recommended pair — a build page
  // that hides the options it rejected can't explain itself. The verdict comes
  // from the current build first (whatever this mode picks is the best pick),
  // then falls back to the guide's own `pick` field for the rest.
  const abilityCards = useMemo(() => {
    const verdictFor = (name) => {
      if (build && (name === build.starPower || name === build.gadget)) return VERDICTS.best;
      const pick = guide?.abilityNotes?.[name]?.pick;
      if (pick === "main") return VERDICTS.strong;
      if (pick === "situational") return VERDICTS.situational;
      if (pick === "skip") return VERDICTS.skip;
      return VERDICTS.alt;
    };
    const row = (list, kind, accent) => (list || []).map(a => ({
      kind, accent, ...a,
      img: iconOverride(brawler.key, a.name) || a.img,
      verdict: verdictFor(a.name),
      body: guide?.abilityNotes?.[a.name]?.body || a.desc,
    }));
    return [...row(brawler.starPowers, "STAR POWER", "#ffb43d"), ...row(brawler.gadgets, "GADGET", "#c98bff")];
  }, [brawler.starPowers, brawler.gadgets, brawler.key, guide, build]);

  const gearItems = useMemo(() => buildItems.filter(i => i.kind === "GEAR"), [buildItems]);
  // The header strip always shows the GENERAL build, independent of which mode
  // tab is open further down the page.
  const generalBuildItems = useMemo(
    () => resolveBuild(guide?.builds?.General), [resolveBuild, guide]);

  const tierBand = TIER_BANDS[tier] || TIER_BANDS.S;

  // Built from the tabs this brawler actually has. It used to be hardcoded and
  // promised "pro gameplay" on every guide, including ones with no Pro tab.
  const guideSubtitle = useMemo(() => {
    const labels = (guide?.guideTabs || []).map(t => t.label.toLowerCase());
    if (!labels.length) return "Video breakdowns";
    // A label can itself contain an ampersand ("Star Power & Super"), which
    // would read as "... & super & hyper" if we also joined with one — so fall
    // back to plain commas whenever that happens.
    const anyAmpersand = labels.some(l => l.includes("&"));
    const list = labels.length === 1 ? labels[0]
      : anyAmpersand ? labels.join(", ")
      : `${labels.slice(0, -1).join(", ")} & ${labels[labels.length - 1]}`;
    return `${list.charAt(0).toUpperCase()}${list.slice(1)} — with video breakdowns`;
  }, [guide]);

  // Brawlers that show up as BOTH a top teammate and a top opponent. That is a
  // real and common result — "good beside you" and "bad across from you" are
  // different questions — but rendered as two near-identical rows it reads as
  // the page contradicting itself, so both panels call the overlap out.
  const bothSides = useMemo(() => {
    const syn = new Set((liveSynergies || []).map(s => s.key));
    return new Set((liveCounters || []).map(c => c.key).filter(k => syn.has(k)));
  }, [liveSynergies, liveCounters]);

  // The rail only lists sections this brawler actually renders — a link to a
  // section that isn't on the page is a dead click.
  const present = {
    overview: true,
    "game-plan": !guide,
    abilities: !guide && Boolean(brawler.starPowers?.length || brawler.gadgets?.length),
    "best-build": Boolean(guide && build),
    "combat-stats": Boolean(guide?.combatStats),
    guide: Boolean(guide?.guideTabs?.length),
    "maps-modes": true,
    // Not gated on `guide`: the pair data is live for every brawler, and the
    // reason lines fall back to generated copy. Requiring a written guide hid
    // real measured data on ~100 pages for no reason.
    matchups: Boolean(liveSynergies?.length || liveCounters?.length),
    counter: Boolean(guide?.counterTips?.length),
  };
  const railSections = SECTIONS.filter(s => present[s.id]);

  return (
    <div style={{
      position: "relative", zIndex: 10, maxWidth: 1360, margin: "0 auto",
      padding: "20px 5vw 0", display: "flex", gap: 36, alignItems: "flex-start",
    }}>
      {/* ── Sticky side rail (follows scroll; the header isn't fixed, so it
             parks near the top) ── */}
      <aside className="guide-rail" style={{
        flexShrink: 0, width: 190, position: "sticky", top: 24, alignSelf: "flex-start",
        padding: "8px 0 8px 18px", borderLeft: "2px solid rgba(255,255,255,.08)",
      }}>
        {railSections.map(s => {
          const on = activeSection === s.id;
          const go = (e) => {
            e.preventDefault();
            const el = document.getElementById(s.id);
            if (el) {
              el.scrollIntoView({ behavior: "smooth", block: "start" });
              setActiveSection(s.id);
              history.replaceState(null, "", `#${s.id}`);
            }
          };
          return (
            <a  className="bm-lift"key={s.id} href={`#${s.id}`} onClick={go} style={{
              display: "flex", alignItems: "center", textDecoration: "none", fontFamily: BODY,
              fontWeight: 600, fontSize: 15, padding: "11px 0 11px 16px", marginLeft: -20,
              borderLeft: `2px solid ${on ? "#ffb43d" : "transparent"}`,
              color: on ? "#f4f4fa" : "#9a9aab", transition: "color .15s",
            }}>{s.label}</a>
          );
        })}
      </aside>

      <div style={{ flex: 1, minWidth: 0, maxWidth: 1160, paddingBottom: 100, display: "flex", flexDirection: "column", gap: 22 }}>
        <button onClick={onBack} style={{
          display: "inline-flex", alignItems: "center", gap: 8, fontFamily: MONO, fontSize: 12,
          letterSpacing: 1, color: "#8b8b9c", background: "none", border: "none",
          cursor: "pointer", padding: 0, width: "fit-content",
        }}>← {backLabel}</button>

        {/* ── 1. Overview ── */}
        <div id="overview" style={{
          scrollMarginTop: 110, borderRadius: 28,
          background: "linear-gradient(160deg, rgba(179,107,255,.10), rgba(20,14,32,.5))",
          border: "1px solid rgba(255,255,255,.08)", padding: "34px 36px",
          display: "flex", flexDirection: "column", gap: 26,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 22, flexWrap: "wrap" }}>
            <div style={{
              width: 96, height: 96, borderRadius: 26, overflow: "hidden", flexShrink: 0,
              border: "1px solid rgba(255,255,255,.1)", background: "#0c0c14",
            }}>
              {brawler.imageUrl
                ? <img src={brawler.imageUrl} alt={brawler.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", fontFamily: MONO, fontSize: 10, color: "#7c7e8f" }}>NO ART</div>}
            </div>
            {/* margin:0 on the h1 — the app resets html/body margins but not
                headings, and the default ~29px was pushing the chips clear of
                the portrait. gap alone controls the spacing now. */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <h1 style={{ fontFamily: DISPLAY, fontSize: "clamp(32px,4vw,44px)", lineHeight: 1.1, margin: 0, color: "#f4f4fa", letterSpacing: "-.5px" }}>
                {brawler.name}
              </h1>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span style={{
                  fontFamily: MONO, fontSize: 11, letterSpacing: 1, padding: "6px 14px", borderRadius: 999,
                  background: `${brawler.rarityColor}1f`, color: brawler.rarityColor, border: `1px solid ${brawler.rarityColor}4d`,
                }}>{brawler.rarity}</span>
                {/* OUR draft class (Sniper), not Supercell's official one (Marksman) */}
                <span title="BrawlApex draft class" style={{
                  fontFamily: MONO, fontSize: 11, letterSpacing: 1, padding: "6px 14px", borderRadius: 999,
                  background: "rgba(179,107,255,.12)", color: "#c98bff", border: "1px solid rgba(179,107,255,.28)",
                }}>{classLabel(draftClassOf(brawler.key))}</span>
              </div>
            </div>

            {/* Best general build at a glance — art only, no names. */}
            {generalBuildItems.length > 0 && (
              <div style={{ marginLeft: "auto", display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1.6, color: "#9a9aab" }}>BEST BUILD</span>
                <div style={{ display: "flex", gap: 10 }}>
                  {generalBuildItems.map((item, i) => (
                    <div key={i} title={`${item.kind} · ${item.name}`} style={{
                      width: 48, height: 48, borderRadius: 15, display: "grid", placeItems: "center",
                      background: "rgba(255,255,255,.04)", border: `1px solid ${item.accent}3d`, flexShrink: 0,
                    }}>
                      {item.img
                        ? <img src={item.img} alt={item.name} style={{ width: "84%", height: "84%", objectFit: "contain" }} />
                        : <GearIcon name={item.gear} size={24} />}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Rank-bracket switch. Sits with the headline numbers because it
              governs every figure on the page, not just one section. */}
          {rankBrackets.length > 1 && onRankBracketChange && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1.6, color: "#8b8b9c" }}>RANK BRACKET</span>
              <div style={{ display: "flex", gap: 8, padding: 5, borderRadius: 999, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)" }}>
                {rankBrackets.map(b => {
                  const on = b.id === rankBracket;
                  return (
                    <button key={b.id} onClick={() => onRankBracketChange(b.id)} style={{
                      fontFamily: BODY, fontWeight: 600, fontSize: 13, padding: "7px 16px", borderRadius: 999, cursor: "pointer",
                      background: on ? `${b.accent}1f` : "transparent",
                      border: `1px solid ${on ? `${b.accent}70` : "transparent"}`,
                      color: on ? b.accent : "#b7b7c6",
                      transition: "background .15s, color .15s, border-color .15s",
                    }}>{b.label}</button>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14 }}>
            <StatCard label="Overall Rank" value={overallRank ? `#${overallRank.rank}` : "—"} sub={overallRank ? `of ${overallRank.of} ranked` : null} />
            <StatCard label={`Win Rate · ${bracketShort}`} value={brawler.winRate != null ? `${brawler.winRate}%` : "—"} color={brawler.winRate != null ? wrColor(brawler.winRate) : "#f4f4fa"} />
            <StatCard label={`Use Rate · ${bracketShort}`} value={brawler.pickRate != null ? `${brawler.pickRate}%` : "—"} color="#8ee6b0" />
            {/* The design's "Meta Score" is replaced by OUR tier classification. */}
            <div title={provisional ? "Provisional — the general tier list is still being curated" : "BrawlApex general tier list"}
              style={{ padding: "20px 22px", borderRadius: 20, background: tierBand.bg, border: `1px solid ${tierBand.border}` }}>
              <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 1, color: "#9a9aab" }}>BrawlApex Tier</div>
              <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6, color: tierBand.color, fontFamily: DISPLAY }}>
                {tier}-Tier
              </div>
              {provisional && <div style={{ fontSize: 10.5, color: "#8b8b9c", marginTop: 2 }}>Provisional</div>}
            </div>
          </div>
        </div>

        {/* Generated guide for the ~100 brawlers with nothing hand-written.
            extendedGuides has always produced strengths, weaknesses, draft
            timing, counter-play and the ability list; the page rendered only
            the class and the game plan and discarded the rest, so these pages
            were two paragraphs and an apology. Everything below is that same
            generator, finally shown. */}
        {!guide && (
          <>
            <Section
              id="game-plan" variant="card" title={`How to play ${brawler.name}`}
              subtitle={`${classLabel(draftClassOf(brawler.key))} game plan — generated from class archetype and draft profile`}
              open={isOpen("game-plan")} onToggle={() => toggleSection("game-plan")}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {ext.gameplan.map((p, i) => (
                  <p key={i} style={{ fontSize: 14.5, lineHeight: 1.7, color: "#c9c9d6", margin: 0, maxWidth: 800 }}>{p}</p>
                ))}
              </div>

              {(ext.strengths?.length > 0 || ext.weaknesses?.length > 0) && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginTop: 22 }}>
                  <TraitPanel title="STRENGTHS" accent="#8ee6b0" kind="do" items={ext.strengths} />
                  <TraitPanel title="WEAKNESSES" accent="#ff8f8f" kind="dont" items={ext.weaknesses} />
                </div>
              )}

              {(ext.draftTiming || ext.counterText) && (
                <div style={{
                  marginTop: 22, borderRadius: 18, padding: "16px 18px",
                  background: "rgba(255,180,61,.06)", border: "1px solid rgba(255,180,61,.20)",
                }}>
                  <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1.4, color: "#ffce7a", marginBottom: 8 }}>
                    DRAFT TIMING
                  </div>
                  {ext.draftTiming && <p style={{ fontSize: 14, lineHeight: 1.65, color: "#c9c9d6", margin: 0 }}>{ext.draftTiming}</p>}
                  {ext.counterText && <p style={{ fontSize: 13.5, lineHeight: 1.6, color: "#a4a4b5", margin: "10px 0 0" }}>{ext.counterText}</p>}
                </div>
              )}
            </Section>

            {/* Abilities. Every brawler has these from brawlerMeta, and a page
                that lists them is strictly more useful than one that doesn't —
                they just carry no recommendation until someone writes one. */}
            {(brawler.starPowers?.length > 0 || brawler.gadgets?.length > 0) && (
              <Section
                id="abilities" variant="card" title="Star powers & gadgets"
                subtitle="Official descriptions — no recommendation until this brawler has a written guide"
                open={isOpen("abilities")} onToggle={() => toggleSection("abilities")}
              >
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 16 }}>
                  {[
                    ...(brawler.starPowers || []).map(a => ({ ...a, kind: "STAR POWER", accent: "#ffb43d" })),
                    ...(brawler.gadgets || []).map(a => ({ ...a, kind: "GADGET", accent: "#c98bff" })),
                  ].map((item, i) => (
                    <div key={i} style={{ ...CARD, borderRadius: 22, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{
                          width: 36, height: 36, borderRadius: 11, overflow: "hidden", flexShrink: 0,
                          border: "1px solid rgba(255,255,255,.1)", background: "#0c0c14", display: "grid", placeItems: "center",
                        }}>
                          {(iconOverride(brawler.key, item.name) || item.img) &&
                            <img src={iconOverride(brawler.key, item.name) || item.img} alt="" loading="lazy"
                              style={{ width: "100%", height: "100%", objectFit: "contain" }} />}
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 1.5, color: item.accent }}>{item.kind}</div>
                          <div style={{ fontSize: 14.5, fontWeight: 700, color: "#f4f4fa" }}>{item.name}</div>
                        </div>
                      </div>
                      <p style={{ fontSize: 12.5, lineHeight: 1.55, color: "#9a9aab" }}>
                        {(item.desc || "").replace(/<[^>]*>/g, "") || "—"}
                      </p>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </>
        )}

        {/* ── 2. Best build ── */}
        {guide && build && (
          <Section
            id="best-build" variant="card"
            title={`Best ${brawler.name} build`}
            subtitle={`Every star power and gadget rated, plus gear — ${buildTab === "General" ? "general purpose" : FORMAT_MODE(buildTab)}`}
            open={isOpen("best-build")} onToggle={() => toggleSection("best-build")}
          >
            {buildTabs.length > 1 && (
              <div style={{ marginBottom: 18 }}>
                <PillTrack>
                  {buildTabs.map(t => {
                    const on = t === buildTab;
                    return (
                      <button key={t} onClick={() => setBuildTab(t)}
                        title={t === "General" ? "General — all modes" : FORMAT_MODE(t)}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 16px",
                          borderRadius: 999, border: "none", cursor: "pointer",
                          background: on ? "#b36bff" : "transparent",
                          fontFamily: BODY, fontWeight: 600, fontSize: 13.5, color: on ? "#0a0a0f" : "#b7b7c6",
                          transition: "background .15s, color .15s",
                        }}>
                        {t === "General" ? <GeneralTriangle size={26} /> : <ModeIcon mode={t} size={22} title={FORMAT_MODE(t)} />}
                        {t === "General" && <span>General</span>}
                      </button>
                    );
                  })}
                </PillTrack>
              </div>
            )}
            {build.note && (
              <p style={{ fontSize: 14, lineHeight: 1.7, color: "#c9c9d6", margin: "0 0 10px", maxWidth: 760 }}>{build.note}</p>
            )}
            {build.gearNote && (
              <p style={{ fontSize: 13, lineHeight: 1.6, color: "#a4a4b5", fontStyle: "italic", margin: "0 0 18px", maxWidth: 760 }}>{build.gearNote}</p>
            )}
            {/* Every star power and gadget, with the verdict on each. The
                recommended pair carries the accent border and a BEST PICK
                badge; the rejected ones stay on the page, dimmed, so the
                reasoning for NOT taking them is visible instead of implied. */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 16 }}>
              {abilityCards.map((item, i) => (
                <div key={i} style={{
                  ...CARD, borderRadius: 22, padding: 18, display: "flex", flexDirection: "column", gap: 12,
                  border: `1px solid ${item.verdict.border}`,
                  background: item.verdict.dim ? "rgba(255,255,255,.015)" : "rgba(255,255,255,.03)",
                  opacity: item.verdict.dim ? 0.62 : 1,
                  transition: "opacity .18s, border-color .18s",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 11, overflow: "hidden", flexShrink: 0,
                      border: "1px solid rgba(255,255,255,.1)", background: "#0c0c14",
                      display: "grid", placeItems: "center",
                      filter: item.verdict.dim ? "grayscale(.55)" : "none",
                    }}>
                      {item.img && <img src={item.img} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "contain" }} />}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 1.5, color: item.accent }}>{item.kind}</div>
                      <div style={{ fontSize: 14.5, fontWeight: 700, color: "#f4f4fa" }}>{item.name}</div>
                    </div>
                  </div>
                  <div><VerdictBadge v={item.verdict} /></div>
                  <p style={{ fontSize: 12.5, lineHeight: 1.55, color: "#9a9aab" }}>{item.body}</p>
                </div>
              ))}
            </div>

            {/* Gears are a separate decision from the ability pair, so they get
                their own row rather than sitting in the same grid. */}
            {gearItems.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1.6, color: "#9a9aab", marginBottom: 12 }}>GEARS</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 16 }}>
                  {gearItems.map((item, i) => (
                    <div key={i} style={{ ...CARD, borderRadius: 22, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{
                          width: 36, height: 36, borderRadius: 11, overflow: "hidden", flexShrink: 0,
                          border: "1px solid rgba(255,255,255,.1)", background: "#0c0c14",
                          display: "grid", placeItems: "center",
                        }}>
                          <GearIcon name={item.gear} size={20} />
                        </div>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 1.5, color: item.accent }}>{item.kind}</div>
                          <div style={{ fontSize: 14.5, fontWeight: 700, color: "#f4f4fa" }}>{item.name}</div>
                        </div>
                      </div>
                      <p style={{ fontSize: 12.5, lineHeight: 1.55, color: "#9a9aab" }}>{item.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Section>
        )}

        {/* ── 3. Combat stats ── */}
        {guide?.combatStats && (
          <Section
            id="combat-stats" variant="card"
            title="Combat stats"
            subtitle={power === 11 ? "Power 11 — the level ranked is played at" : `Power ${power} — scaled from the Power 11 values`}
            open={isOpen("combat-stats")} onToggle={() => toggleSection("combat-stats")}
            right={
              <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 2, color: "#8ee6b0" }}>POWER LEVEL</span>
                <select value={power} onChange={e => setPower(Number(e.target.value))} style={{
                  fontFamily: BODY, fontWeight: 600, fontSize: 14, color: "#f4f4fa",
                  background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.12)",
                  borderRadius: 999, padding: "10px 18px", cursor: "pointer",
                }}>
                  {POWER_LEVELS.map(p => <option key={p} value={p} style={{ background: "#12121a" }}>Power {p}</option>)}
                </select>
              </div>
            }
          >
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
              {guide.combatStats.map((c, i) => (
                <div key={i} style={{ padding: "16px 18px", borderRadius: 16, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)" }}>
                  <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: .5, color: "#8b8b9c" }}>{c.label}</div>
                  <div style={{ fontSize: 17, fontWeight: 700, marginTop: 5, color: "#f4f4fa" }}>
                    {statText(c, power)}
                  </div>
                  {(c.tag || c.tagTpl) && (
                    <div style={{ fontSize: 11, color: "#8ee6b0", marginTop: 2 }}>
                      {c.tagTpl ? fillParts(c.tagTpl, c.tagParts, c.scaled ? power : 11) : c.tag}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── 4. Guide (aim / gadget / star power / hyper) ── */}
        {guide?.guideTabs?.length > 0 && (
          <Section
            id="guide" variant="card" title={`Best ${brawler.name} Guide`}
            subtitle={guideSubtitle}
            open={isOpen("guide")} onToggle={() => toggleSection("guide")}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <PillTrack>
                {guide.guideTabs.map((t, i) => (
                  <Pill key={t.key} active={i === guideTab} onClick={() => setGuideTab(i)}>{t.label}</Pill>
                ))}
              </PillTrack>
              <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 2, color: "#c98bff" }}>
                {guide.guideTabs[guideTab].label.toUpperCase()}
              </div>
              {guide.guideTabs[guideTab].intro && (
                <p style={{ fontSize: 14.5, lineHeight: 1.7, color: "#c9c9d6", margin: 0, maxWidth: 780 }}>
                  {guide.guideTabs[guideTab].intro}
                </p>
              )}
              <TipList tips={guide.guideTabs[guideTab].tips} videoBase={guide.videoBase} />
            </div>
          </Section>
        )}

        {/* ── 5. Maps & modes (live data) ── */}
        <Section
          id="maps-modes" variant="card" title="Maps & modes"
          subtitle={`Ranked map pool & win rates by mode — live ${bracketShort} data`}
          open={isOpen("maps-modes")} onToggle={() => toggleSection("maps-modes")}
        >
          {modeKeys.length === 0 ? (
            <p style={{ fontSize: 13.5, color: "#8b8b9c" }}>Not enough ranked data for {brawler.name} yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              {/* The written notes below were researched against Masters+. Say
                  so when the numbers beside them come from anywhere else. */}
              {!notesMatchBracket && guide?.mapNotes && (
                <div style={{
                  borderRadius: 14, padding: "11px 14px", fontSize: 12.5, lineHeight: 1.55, color: "#c9c9d6",
                  background: `${bracketAccent}12`, border: `1px solid ${bracketAccent}38`,
                }}>
                  Win rates here are <strong style={{ color: bracketAccent }}>{bracketLabel}</strong>. The written map and
                  mode notes were researched on Masters+ and can read differently against these numbers — the two brackets
                  genuinely disagree on some maps.
                </div>
              )}
              <PillTrack>
                {modeStats.map((m, i) => {
                  const on = i === modeIdx;
                  return (
                    <button key={m.mode} onClick={() => { setModeIdx(i); setMapIdx(0); }}
                      title={FORMAT_MODE(m.mode)}
                      style={{
                        display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 16px",
                        borderRadius: 999, border: "none", cursor: "pointer",
                        background: on ? "#b36bff" : "transparent",
                        fontFamily: MONO, fontWeight: 700, fontSize: 13, color: on ? "#0a0a0f" : "#b7b7c6",
                        transition: "background .15s, color .15s",
                      }}>
                      <ModeIcon mode={m.mode} size={22} title={FORMAT_MODE(m.mode)} />
                      {m.winRate}%
                    </button>
                  );
                })}
              </PillTrack>

              {/* Mode-level read: whether this brawler belongs in the mode at
                  all, before you get down to individual maps. */}
              {guide?.modeNotes?.[activeMode] && (
                <div style={{
                  borderRadius: 18, padding: "16px 18px", display: "flex", gap: 12,
                  background: "rgba(255,180,61,.06)", border: "1px solid rgba(255,180,61,.20)",
                }}>
                  <ModeIcon mode={activeMode} size={24} title={FORMAT_MODE(activeMode)} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1.4, color: "#ffce7a", marginBottom: 5 }}>
                      {FORMAT_MODE(activeMode).toUpperCase()} · MODE READ
                    </div>
                    <p style={{ fontSize: 14, lineHeight: 1.65, color: "#c9c9d6", margin: 0 }}>
                      {guide.modeNotes[activeMode]}
                    </p>
                  </div>
                </div>
              )}

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {activeMaps.map((mp, i) => {
                  const on = i === mapIdx;
                  const strong = mp.winRate >= 55;
                  return (
                    <button key={mp.map} onClick={() => setMapIdx(i)} style={{
                      display: "inline-flex", alignItems: "center", fontFamily: MONO, fontSize: 12,
                      letterSpacing: .5, padding: "9px 14px 9px 18px", borderRadius: 999,
                      border: `1px solid ${on ? "rgba(255,180,61,.5)" : "rgba(255,255,255,.1)"}`, cursor: "pointer",
                      background: on ? "rgba(255,180,61,.12)" : "rgba(255,255,255,.03)",
                      color: on ? "#ffce7a" : "#9a9aab", transition: "all .15s",
                    }}>
                      {mp.map}
                      <span style={{
                        marginLeft: 8, fontFamily: MONO, fontSize: 11, letterSpacing: .5,
                        padding: "2px 8px", borderRadius: 999,
                        background: strong ? "rgba(142,230,176,.16)" : "rgba(255,255,255,.08)",
                        color: strong ? "#8ee6b0" : "#9a9aab",
                        // Always the number. This used to print "STRONG" instead of
                        // the rate above 55%, which hid the figure on exactly the
                        // maps worth comparing — you couldn't tell a 55% map from a
                        // 60% one. The green tint already carries "this is strong".
                      }}>{mp.winRate}%</span>
                    </button>
                  );
                })}
              </div>

              {activeMap && (
                <div style={{
                  borderRadius: 20, background: "linear-gradient(160deg, rgba(179,107,255,.08), rgba(20,14,32,.35))",
                  border: "1px solid rgba(179,107,255,.2)", padding: "24px 26px", display: "flex", gap: 14,
                }}>
                  <span style={{ flexShrink: 0, width: 8, height: 8, borderRadius: "50%", background: "#b36bff", marginTop: 8, boxShadow: "0 0 8px #b36bff" }} />
                  <div>
                    <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 2, color: "#c98bff", marginBottom: 6 }}>
                      {FORMAT_MODE(activeMode)} · {activeMap.map.toUpperCase()} · {activeMap.winRate}% WIN RATE · {activeMap.picks.toLocaleString("en-US")} GAMES
                    </div>
                    {/* Notes may hold multiple paragraphs (a base read plus a
                        pro tip), separated by a blank line in the data.
                        There is deliberately no fallback paragraph: the old one
                        restated the win rate and game count printed directly
                        above it and then apologised for having nothing to add,
                        which read as filler on every map without a note. When
                        there's nothing written, the eyebrow line stands alone. */}
                    {(guide?.mapNotes?.[activeMap.map] || "").split("\n\n").filter(Boolean).map((para, i) => (
                      <p key={i} style={{ fontSize: 15, lineHeight: 1.7, color: "#c9c9d6", margin: i === 0 ? 0 : "10px 0 0" }}>
                        {para}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {/* Map clips: this map's own wall-break/positioning tricks, plus
                  any mode-wide technique (Brawl Ball goal tricks apply to every
                  map in the mode, so they show alongside whichever is selected). */}
              {activeMapVideos.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                  <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 2, color: "#ffce7a" }}>
                    {activeMapVideos.some(v => v.scope === "map")
                      ? `${activeMap.map.toUpperCase()} · CLIPS`
                      : `${FORMAT_MODE(activeMode).toUpperCase()} · CLIPS`}
                  </span>
                  {/* Why the mode's clips matter, when the technique is
                      mode-wide rather than tied to one map. */}
                  {guide?.modeVideoNotes?.[activeMode] && activeMapVideos.some(v => v.scope === "mode") && (
                    <p style={{ fontSize: 14, lineHeight: 1.65, color: "#c9c9d6", margin: 0, maxWidth: 780 }}>
                      {guide.modeVideoNotes[activeMode]}
                    </p>
                  )}
                  {/* Clips tagged do/dont split into a right-way / wrong-way
                      pair so a bad wall break can't be mistaken for an option.
                      Untagged clips render as one plain group. */}
                  {CLIP_GROUPS.map(({ kind, label, color, mark }) => {
                    const list = activeMapVideos.filter(v => (v.kind || null) === kind);
                    if (!list.length) return null;
                    return (
                      <div key={String(kind)} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        {kind && (
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{
                              width: 20, height: 20, borderRadius: 999, flexShrink: 0,
                              display: "inline-flex", alignItems: "center", justifyContent: "center",
                              background: `${color}1f`, color, border: `1px solid ${color}59`,
                            }}><MarkGlyph kind={mark} size={11} /></span>
                            <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 1.6, color }}>{label}</span>
                          </div>
                        )}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
                          {list.map(v => (
                            <MediaSlot key={mediaKey(v)} base={guide.videoBase} item={v} kind={null}
                              tone={kind === "dont" ? "#ff8f8f" : "#8ee6b0"} />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </Section>

        {/* ── 6. Match-ups (live from with_brawler + vs_brawler) ── */}
        {(liveSynergies?.length > 0 || liveCounters?.length > 0) && (
          <Section
            id="matchups" variant="card" title="Match-ups"
            subtitle={`Live ${bracketShort} pair data — min 300 games, best teammates and worst opponents`}
            open={isOpen("matchups")} onToggle={() => toggleSection("matchups")}
          >
            {/* No per-brawler reason line. The panel heading already says what
                the list is, and the name + win rate + game count say the rest —
                a sentence under every row restating "this is a good teammate"
                six times was noise. The ONE thing worth a note is the genuinely
                surprising case: a brawler that is both a top teammate and a top
                opponent, which reads as a contradiction unless it's called out. */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {liveSynergies?.length > 0 && (
                <MatchupPanel
                  eyebrow="SYNERGIES · GOOD WITH" accent="#8ee6b0"
                  rows={liveSynergies} bothSides={bothSides}
                  bothNote="Also one of their worst opponents — strong alongside, painful across the net."
                />
              )}
              {liveCounters?.length > 0 && (
                <MatchupPanel
                  eyebrow="COUNTERS · WORST AGAINST" accent="#ff8f8f"
                  rows={liveCounters} bothSides={bothSides}
                  bothNote="Also one of their best teammates — the same strengths cut both ways."
                />
              )}
            </div>
          </Section>
        )}

        {/* ── 7. How to counter ── */}
        {guide?.counterTips?.length > 0 && (
          <Section
            id="counter" variant="card" title={`How to counter ${brawler.name}`}
            open={isOpen("counter")} onToggle={() => toggleSection("counter")}
          >
            {/* No inner card — the Section already provides the box, matching
                every other section. The red identity carries on the tips and
                the clip borders instead. Counter tips pair with their footage
                exactly like the guide tabs do. */}
            <TipList tips={guide.counterTips} tone="red" videoBase={guide.videoBase} />
          </Section>
        )}

      </div>

      <style>{`
        @media (max-width: 980px) {
          .guide-rail { display: none !important; }
          .guide-split { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

// One half of the Match-ups section — a titled grid of brawler rows with the
// live win rate + game count and a reason line. Used for both Synergies
// (best teammates) and Counters (worst opponents).
function MatchupPanel({ eyebrow, accent, rows, bothSides, bothNote }) {
  // Sub-panel inside a Section card — tinted to its accent rather than reusing
  // CARD, so it reads as nested content instead of a second identical box.
  return (
    <div style={{
      borderRadius: 20, padding: 22, display: "flex", flexDirection: "column", gap: 16,
      background: `${accent}0f`, border: `1px solid ${accent}2e`,
    }}>
      <span style={{ fontFamily: MONO, fontSize: 12, letterSpacing: 2, color: accent }}>{eyebrow}</span>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14 }}>
        {rows.map(s => {
          const meta = BRAWLER_META[s.key] || {};
          return (
            <div key={s.key} style={{ display: "flex", gap: 14, alignItems: "center", padding: 14, borderRadius: 16, background: "rgba(255,255,255,.03)" }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, overflow: "hidden", flexShrink: 0, border: "1px solid rgba(255,255,255,.1)", background: "#0c0c14" }}>
                {meta.imageUrl && <img src={meta.imageUrl} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, fontSize: 15, color: "#f4f4fa" }}>{fmtName(s.key)}</span>
                  <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: accent }}>{s.winRate}%</span>
                  <span style={{ fontFamily: MONO, fontSize: 10, color: "#8b8b9c" }}>{s.games.toLocaleString("en-US")} games</span>
                </div>
                {bothSides?.has(s.key) && bothNote && (
                  <div style={{ fontSize: 12, lineHeight: 1.45, color: "#8b8b9c", marginTop: 4, fontStyle: "italic" }}>
                    ↔ {bothNote}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Strengths / weaknesses list for the generated pages. Reuses the do/don't
// vocabulary from the guide clips so the two page types read as one system.
function TraitPanel({ title, accent, kind, items }) {
  if (!items?.length) return null;
  return (
    <div style={{ borderRadius: 20, padding: 20, background: `${accent}0f`, border: `1px solid ${accent}2e` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span style={{
          width: 20, height: 20, borderRadius: 999, flexShrink: 0,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          background: `${accent}1f`, color: accent, border: `1px solid ${accent}59`,
        }}><MarkGlyph kind={kind} size={11} /></span>
        <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 1.6, color: accent }}>{title}</span>
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((t, i) => (
          <li key={i} style={{ fontSize: 13.5, lineHeight: 1.6, color: "#c9c9d6" }}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

function StatCard({ label, value, sub, color = "#f4f4fa" }) {
  return (
    <div style={{ padding: "20px 22px", borderRadius: 20, background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)" }}>
      <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 1, color: "#9a9aab" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6, color }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: "#8b8b9c", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

const TIER_BANDS = {
  "S+": { color: "#ffc663", bg: "rgba(251,191,36,0.14)", border: "rgba(251,191,36,0.45)" },
  "S":  { color: "#ffb43d", bg: "rgba(245,158,11,0.13)", border: "rgba(245,158,11,0.40)" },
  "A":  { color: "#b36bff", bg: "rgba(168,85,247,0.13)", border: "rgba(168,85,247,0.40)" },
  "B":  { color: "#60a5fa", bg: "rgba(96,165,250,0.12)", border: "rgba(96,165,250,0.38)" },
  "C":  { color: "#94a3b8", bg: "rgba(148,163,184,0.10)", border: "rgba(148,163,184,0.35)" },
  "D":  { color: "#fb923c", bg: "rgba(251,146,60,0.11)", border: "rgba(251,146,60,0.38)" },
  "F":  { color: "#ef4444", bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.40)" },
};

// Gears have no art in brawlerMeta.json (the Brawlify payload we sync doesn't
// carry them), so the recommendation carries its own one-liner.
const GEAR_DESC = {
  Speed: "Movement speed boost below 50% health — helps you disengage after overextending on a poke.",
  Shield: "Damage reduction below 50% health — buys an extra hit of survivability while kiting back.",
  Damage: "Bonus damage below 50% health — punishes anyone who tries to trade back at close range.",
  Vision: "Reveals enemies hiding in bushes nearby — spots the flank before it lines up.",
  Health: "Heals faster out of combat — gets a slow, high-health brawler back to full without giving up the position.",
  Reload: "Faster reload below 50% health — keeps damage flowing through the window where you'd normally go quiet.",
};

// Gear artwork isn't in brawlerMeta.json (the Brawlify payload we sync carries
// star powers and gadgets only), so gears pull the official icons from the same
// CDN via GEAR_ICONS. Tints are only used for the card accent border.
const GEAR_TINT = {
  Speed: "#7cc4ff", Shield: "#8ee6b0", Damage: "#ff8f8f",
  Vision: "#ffce7a", Health: "#8ee6b0", Reload: "#c98bff",
};

function GearIcon({ name, size = 20 }) {
  const url = GEAR_ICONS[name];
  if (!url) return <span style={{ fontSize: size * 0.7, color: GEAR_TINT[name] || "#9a9aab" }}>⬢</span>;
  return <img src={url} alt={`${name} Gear`} width={size} height={size} style={{ objectFit: "contain" }} />;
}
