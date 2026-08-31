// ─── Chart primitives ────────────────────────────────────────────────────────
// Hand-rolled SVG, deliberately. The app ships no charting dependency and the
// bundle is already over Vite's 500 kB warning in a single chunk — Recharts
// alone would add more than everything here weighs, to draw four shapes.
//
// Every chart takes the same honesty line the rest of the site does: an empty
// series renders a stated reason, never an empty axis that looks like zero, and
// a thin sample is labelled rather than smoothed into looking solid.
//
// All of these scale with their container: a viewBox plus `width: 100%` means
// one implementation covers phone and desktop, and the caller controls height.

import { useEffect, useRef, useState } from "react";

// Every chart used to declare `viewBox="0 0 600 H"` alongside an explicit pixel
// height. That combination letterboxes: preserveAspectRatio defaults to "meet",
// so on a 1200px-wide card the scale is min(1200/600, H/H) = 1 and the chart
// rendered at 600px natural size, centred, with dead space either side. It read
// as a small chart in a big box because that is exactly what it was.
//
// Measuring the container and setting the viewBox width to the real pixel width
// fixes it properly: the drawing fills the width, and because the mapping is now
// 1:1 a fontSize of 12 is 12 real pixels on every screen instead of whatever the
// scale factor happened to make it.
function useMeasuredWidth(fallback = 600) {
  const ref = useRef(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width);
      if (next > 0) setW(next);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const MONO = "'JetBrains Mono', monospace";
const AXIS = "#3a3a46";
const DIM = "#8b8b9c";
const MUTED = "#8b8b9c";
const TEXT = "#e9e9f2";

export const CHART_COLORS = {
  blue: "#7cc4ff", green: "#8ee6b0", red: "#ff8f8f",
  amber: "#ffce7a", purple: "#c98bff", muted: "#8b8b9c",
};

// Win rate is the site's universal y-axis, and it is never a 0-100 quantity in
// practice — real brawler rates live between about 40 and 60. Plotting the full
// range would flatten every line into the middle of the chart, so the default
// domain is the data's own span, padded, with a floor on how narrow it can get
// (otherwise a half-point wobble looks like a cliff).
const niceDomain = (values, { minSpan = 4, pad = 0.15 } = {}) => {
  const vals = values.filter(v => Number.isFinite(v));
  if (!vals.length) return [45, 55];
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = mid - minSpan / 2; hi = mid + minSpan / 2;
  }
  const p = (hi - lo) * pad;
  return [lo - p, hi + p];
};

function EmptyState({ height, message }) {
  return (
    <div style={{
      height, display: "flex", alignItems: "center", justifyContent: "center",
      textAlign: "center", padding: "0 18px",
      border: "1px dashed rgba(255,255,255,.10)", borderRadius: 10,
      fontFamily: MONO, fontSize: 10.5, color: DIM, lineHeight: 1.6,
    }}>{message}</div>
  );
}

// ── Trend line ───────────────────────────────────────────────────────────────
// One or more series over time, with an optional shaded band per point. The
// band is what makes a sparse early history readable: two days of data should
// look uncertain, not authoritative.
export function TrendChart({
  series = [], height = 240, yDomain, yUnit = "%",
  emptyMessage = "No history yet.", showBand = true,
}) {
  const [wrapRef, W] = useMeasuredWidth();
  const withPoints = series.filter(s => s.points?.length);
  if (!withPoints.length) return <EmptyState height={height} message={emptyMessage} />;

  const all = withPoints.flatMap(s => s.points);
  const xs = all.map(p => +p.x);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const [lo, hi] = yDomain || niceDomain(
    all.flatMap(p => [p.y, showBand ? p.lo : null, showBand ? p.hi : null]).filter(v => v != null));

  const H = height, L = 50, R = 16, T = 18, B = 30;
  const px = (x) => (x1 === x0 ? L + (W - L - R) / 2 : L + ((+x - x0) / (x1 - x0)) * (W - L - R));
  const py = (y) => T + (1 - (y - lo) / (hi - lo)) * (H - T - B);

  // A single point has no line to draw, so it renders as a dot. Silently
  // drawing nothing would read as "no data" when we do have one reading.
  const single = all.length === withPoints.length && withPoints.every(s => s.points.length === 1);
  // Five gridlines instead of three: with only a top, middle and bottom rule a
  // reader has to interpolate every value in between by eye.
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => lo + (hi - lo) * f);
  const fmtDate = (x) => new Date(x).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <div ref={wrapRef} style={{ width: "100%" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height, display: "block" }}
           role="img" aria-label="Trend over time">
        <defs>
          {withPoints.map((s, si) => (
            <linearGradient key={si} id={`bmFade${si}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color || CHART_COLORS.blue} stopOpacity="0.26" />
              <stop offset="100%" stopColor={s.color || CHART_COLORS.blue} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={py(t)} y2={py(t)} stroke={AXIS} strokeWidth="1"
                  strokeDasharray={i === 2 ? undefined : "2 5"} opacity={i === 2 ? 0.9 : 0.5} />
            <text x={L - 8} y={py(t) + 4} textAnchor="end" fontFamily={MONO} fontSize="11" fill={MUTED}>
              {t.toFixed(1)}{yUnit}
            </text>
          </g>
        ))}
        <text x={L} y={H - 8} fontFamily={MONO} fontSize="11" fill={MUTED}>{fmtDate(x0)}</text>
        {x1 !== x0 && (
          <text x={W - R} y={H - 8} textAnchor="end" fontFamily={MONO} fontSize="11" fill={MUTED}>{fmtDate(x1)}</text>
        )}

        {withPoints.map((s, si) => {
          const colour = s.color || CHART_COLORS.blue;
          const pts = [...s.points].sort((a, b) => +a.x - +b.x);
          const band = showBand && pts.every(p => p.lo != null && p.hi != null);
          const last = pts[pts.length - 1];
          return (
            <g key={s.label || si}>
              {band && (
                <path
                  d={`M ${pts.map(p => `${px(p.x)},${py(p.hi)}`).join(" L ")} L ${
                    [...pts].reverse().map(p => `${px(p.x)},${py(p.lo)}`).join(" L ")} Z`}
                  fill={colour} opacity="0.13" />
              )}
              {/* Soft fill under the line. Reads as volume at a glance without
                  adding a second thing to decode. */}
              {!band && pts.length > 1 && (
                <path d={`M ${px(pts[0].x)},${H - B} L ${pts.map(p => `${px(p.x)},${py(p.y)}`).join(" L ")} L ${px(last.x)},${H - B} Z`}
                      fill={`url(#bmFade${si})`} />
              )}
              {pts.length > 1 && (
                <polyline points={pts.map(p => `${px(p.x)},${py(p.y)}`).join(" ")}
                          fill="none" stroke={colour} strokeWidth="2.6"
                          strokeLinejoin="round" strokeLinecap="round" />
              )}
              {(single || pts.length <= 24) && pts.map((p, i) => (
                <circle key={i} cx={px(p.x)} cy={py(p.y)} r={single ? 5.5 : 3.4}
                        fill={colour} stroke="#12121a" strokeWidth="1.5" />
              ))}
              {/* The latest reading is the one people look for, so it is stated
                  rather than left to be traced back to the axis. */}
              {!single && pts.length > 1 && (
                <g>
                  <circle cx={px(last.x)} cy={py(last.y)} r="5" fill={colour} stroke="#12121a" strokeWidth="2" />
                  <text x={px(last.x) - 9} y={py(last.y) - 11} textAnchor="end"
                        fontFamily={MONO} fontSize="12" fontWeight="700" fill={colour}>
                    {last.y.toFixed(1)}{yUnit}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>

      {withPoints.length > 1 && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 8 }}>
          {withPoints.map((s, i) => (
            <span key={s.label || i} style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: MONO, fontSize: 11, color: MUTED }}>
              <span style={{ width: 12, height: 3, borderRadius: 2, background: s.color || CHART_COLORS.blue }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Ranked bars ──────────────────────────────────────────────────────────────
// A leaderboard where the bar length carries the comparison. Bars start at the
// series minimum rather than zero: every win rate is near 50, so a zero-based
// axis makes 46% and 56% look identical.
export function BarList({ rows = [], height = 26, unit = "%", emptyMessage = "No data.", accent }) {
  if (!rows.length) return <EmptyState height={90} message={emptyMessage} />;
  const vals = rows.map(r => r.value).filter(Number.isFinite);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {rows.map((r, i) => {
        const pct = ((r.value - lo) / span) * 100;
        const colour = r.color || accent
          || (r.value >= 52 ? CHART_COLORS.green : r.value <= 48 ? CHART_COLORS.red : CHART_COLORS.amber);
        return (
          <div key={r.label} className="bm-rise" style={{ display: "flex", alignItems: "center", gap: 11, animationDelay: `${Math.min(i, 12) * 0.03}s` }}>
            <span style={{ flex: "0 0 118px", fontSize: 13, color: TEXT, overflow: "hidden",
                           textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.label}>{r.label}</span>
            <div style={{ flex: 1, height, background: "rgba(255,255,255,.045)", borderRadius: 7, overflow: "hidden", minWidth: 40 }}>
              <div style={{
                width: `${Math.max(3, pct)}%`, height: "100%", borderRadius: 7,
                background: `linear-gradient(90deg, ${colour}66, ${colour})`,
                boxShadow: `0 0 14px -4px ${colour}`,
                transition: "width .55s cubic-bezier(.2,.7,.3,1)",
              }} />
            </div>
            <span style={{ flex: "0 0 62px", textAlign: "right", fontFamily: MONO, fontSize: 13, fontWeight: 700, color: colour }}>
              {r.value.toFixed(1)}{unit}
            </span>
            {r.sub != null && (
              <span style={{ flex: "0 0 66px", textAlign: "right", fontFamily: MONO, fontSize: 10.5, color: DIM }}>{r.sub}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Pick rate vs win rate ────────────────────────────────────────────────────
// The one chart that shows the shape of a meta rather than a ranking. The
// quadrants are the site's existing vocabulary made visible: high pick + low
// win is the popularity trap, low pick + high win is the sleeper nobody has
// noticed. Reference lines are the actual medians, not 50 — half the field
// sitting below a hardcoded 50% would misread as a broken meta.
export function ScatterChart({ points = [], height = 360, emptyMessage = "No data.", xLabel = "Pick rate", yLabel = "Win rate" }) {
  const [wrapRef, W] = useMeasuredWidth();
  if (!points.length) return <EmptyState height={height} message={emptyMessage} />;

  const H = height, L = 52, R = 18, T = 18, B = 38;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const [ylo, yhi] = niceDomain(ys);
  const xhi = Math.max(...xs) * 1.06, xlo = 0;
  const med = (a) => { const s2 = [...a].sort((m, n) => m - n); return s2[Math.floor(s2.length / 2)]; };
  const mx = med(xs), my = med(ys);

  const px = (x) => L + ((x - xlo) / (xhi - xlo || 1)) * (W - L - R);
  const py = (y) => T + (1 - (y - ylo) / (yhi - ylo || 1)) * (H - T - B);

  return (
    <div ref={wrapRef} style={{ width: "100%" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height, display: "block" }}
           role="img" aria-label={`${xLabel} against ${yLabel}`}>
        {/* Quadrant tint, so the four regions read as regions before any label
            is read. Kept very low contrast — this is orientation, not data. */}
        <rect x={px(mx)} y={T} width={Math.max(0, W - R - px(mx))} height={Math.max(0, py(my) - T)}
              fill={CHART_COLORS.green} opacity="0.045" />
        <rect x={L} y={T} width={Math.max(0, px(mx) - L)} height={Math.max(0, py(my) - T)}
              fill={CHART_COLORS.blue} opacity="0.04" />
        <rect x={px(mx)} y={py(my)} width={Math.max(0, W - R - px(mx))} height={Math.max(0, H - B - py(my))}
              fill={CHART_COLORS.red} opacity="0.045" />

        <line x1={px(mx)} x2={px(mx)} y1={T} y2={H - B} stroke={AXIS} strokeDasharray="3 5" />
        <line x1={L} x2={W - R} y1={py(my)} y2={py(my)} stroke={AXIS} strokeDasharray="3 5" />
        <text x={px(mx) + 6} y={T + 12} fontFamily={MONO} fontSize="10" fill={DIM}>median pick</text>
        <text x={L + 4} y={py(my) - 6} fontFamily={MONO} fontSize="10" fill={DIM}>median win</text>

        <text x={W - R} y={py(yhi) + 26} textAnchor="end" fontFamily={MONO} fontSize="11" fontWeight="700" fill={CHART_COLORS.green}>
          POPULAR &amp; STRONG
        </text>
        <text x={L + 5} y={py(yhi) + 26} fontFamily={MONO} fontSize="11" fontWeight="700" fill={CHART_COLORS.blue}>
          SLEEPER · LOW PICK, HIGH WIN
        </text>
        <text x={W - R} y={H - B - 8} textAnchor="end" fontFamily={MONO} fontSize="11" fontWeight="700" fill={CHART_COLORS.red}>
          POPULARITY TRAP
        </text>

        {[ylo, (ylo + yhi) / 2, yhi].map((t, i) => (
          <text key={i} x={L - 8} y={py(t) + 4} textAnchor="end" fontFamily={MONO} fontSize="11" fill={MUTED}>
            {t.toFixed(0)}%
          </text>
        ))}
        <text x={(L + W - R) / 2} y={H - 10} textAnchor="middle" fontFamily={MONO} fontSize="11" fill={MUTED}>
          {xLabel} →
        </text>

        {points.map((p, i) => (
          <g key={p.label || i}>
            <circle cx={px(p.x)} cy={py(p.y)} r={p.highlight ? 7 : 4.4}
                    fill={p.color || (p.y >= my && p.x >= mx ? CHART_COLORS.green
                          : p.y >= my ? CHART_COLORS.blue
                          : p.x >= mx ? CHART_COLORS.red : CHART_COLORS.muted)}
                    opacity={p.highlight ? 1 : 0.75}
                    stroke={p.highlight ? "#fff" : "none"} strokeWidth={p.highlight ? 1.6 : 0}>
              <title>{`${p.label}: ${p.y.toFixed(1)}% win · ${p.x.toFixed(1)}% pick`}</title>
            </circle>
            {p.highlight && (
              <text x={px(p.x) + 10} y={py(p.y) + 4} fontFamily={MONO} fontSize="11.5" fontWeight="700" fill={TEXT}>{p.label}</text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}
