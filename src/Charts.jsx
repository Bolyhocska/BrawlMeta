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

const MONO = "'JetBrains Mono', monospace";
const AXIS = "#3a3a46";
const DIM = "#6f7180";
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
  series = [], height = 190, yDomain, yUnit = "%",
  emptyMessage = "No history yet.", showBand = true,
}) {
  const withPoints = series.filter(s => s.points?.length);
  if (!withPoints.length) return <EmptyState height={height} message={emptyMessage} />;

  const all = withPoints.flatMap(s => s.points);
  const xs = all.map(p => +p.x);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const [lo, hi] = yDomain || niceDomain(
    all.flatMap(p => [p.y, showBand ? p.lo : null, showBand ? p.hi : null]).filter(v => v != null));

  const W = 600, H = height, L = 38, R = 10, T = 12, B = 24;
  const px = (x) => (x1 === x0 ? L + (W - L - R) / 2 : L + ((+x - x0) / (x1 - x0)) * (W - L - R));
  const py = (y) => T + (1 - (y - lo) / (hi - lo)) * (H - T - B);

  // A single point has no line to draw, so it renders as a dot. Silently
  // drawing nothing would read as "no data" when we do have one reading.
  const single = all.length === withPoints.length && withPoints.every(s => s.points.length === 1);
  const ticks = [lo, (lo + hi) / 2, hi];
  const fmtDate = (x) => new Date(x).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <div style={{ width: "100%", overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height, display: "block" }}
           role="img" aria-label="Trend over time">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={L} x2={W - R} y1={py(t)} y2={py(t)} stroke={AXIS} strokeWidth="1"
                  strokeDasharray={i === 1 ? "3 4" : undefined} opacity={i === 1 ? 0.5 : 1} />
            <text x={L - 6} y={py(t) + 3.5} textAnchor="end" fontFamily={MONO} fontSize="9" fill={DIM}>
              {t.toFixed(1)}{yUnit}
            </text>
          </g>
        ))}
        <text x={L} y={H - 6} fontFamily={MONO} fontSize="9" fill={DIM}>{fmtDate(x0)}</text>
        {x1 !== x0 && (
          <text x={W - R} y={H - 6} textAnchor="end" fontFamily={MONO} fontSize="9" fill={DIM}>{fmtDate(x1)}</text>
        )}

        {withPoints.map((s, si) => {
          const colour = s.color || CHART_COLORS.blue;
          const pts = [...s.points].sort((a, b) => +a.x - +b.x);
          const band = showBand && pts.every(p => p.lo != null && p.hi != null);
          return (
            <g key={s.label || si}>
              {band && (
                <path
                  d={`M ${pts.map(p => `${px(p.x)},${py(p.hi)}`).join(" L ")} L ${
                    [...pts].reverse().map(p => `${px(p.x)},${py(p.lo)}`).join(" L ")} Z`}
                  fill={colour} opacity="0.13" />
              )}
              {pts.length > 1 && (
                <polyline points={pts.map(p => `${px(p.x)},${py(p.y)}`).join(" ")}
                          fill="none" stroke={colour} strokeWidth="2"
                          strokeLinejoin="round" strokeLinecap="round" />
              )}
              {(single || pts.length <= 12) && pts.map((p, i) => (
                <circle key={i} cx={px(p.x)} cy={py(p.y)} r={single ? 4 : 2.6}
                        fill={colour} stroke="#12121a" strokeWidth="1" />
              ))}
            </g>
          );
        })}
      </svg>

      {withPoints.length > 1 && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
          {withPoints.map((s, i) => (
            <span key={s.label || i} style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: MONO, fontSize: 9.5, color: MUTED }}>
              <span style={{ width: 9, height: 2.5, borderRadius: 2, background: s.color || CHART_COLORS.blue }} />
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
export function BarList({ rows = [], height = 18, unit = "%", emptyMessage = "No data.", accent }) {
  if (!rows.length) return <EmptyState height={90} message={emptyMessage} />;
  const vals = rows.map(r => r.value).filter(Number.isFinite);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {rows.map((r) => {
        const pct = ((r.value - lo) / span) * 100;
        const colour = r.color || accent
          || (r.value >= 52 ? CHART_COLORS.green : r.value <= 48 ? CHART_COLORS.red : CHART_COLORS.amber);
        return (
          <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ flex: "0 0 96px", fontSize: 11, color: TEXT, overflow: "hidden",
                           textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.label}>{r.label}</span>
            <div style={{ flex: 1, height, background: "rgba(255,255,255,.04)", borderRadius: 5, overflow: "hidden", minWidth: 40 }}>
              <div style={{ width: `${Math.max(3, pct)}%`, height: "100%", background: colour, opacity: 0.75,
                            borderRadius: 5, transition: "width .5s ease" }} />
            </div>
            <span style={{ flex: "0 0 54px", textAlign: "right", fontFamily: MONO, fontSize: 10.5, color: colour }}>
              {r.value.toFixed(1)}{unit}
            </span>
            {r.sub != null && (
              <span style={{ flex: "0 0 62px", textAlign: "right", fontFamily: MONO, fontSize: 9, color: DIM }}>{r.sub}</span>
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
export function ScatterChart({ points = [], height = 300, emptyMessage = "No data.", xLabel = "Pick rate", yLabel = "Win rate" }) {
  if (!points.length) return <EmptyState height={height} message={emptyMessage} />;

  const W = 600, H = height, L = 40, R = 14, T = 14, B = 30;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const [ylo, yhi] = niceDomain(ys);
  const xhi = Math.max(...xs) * 1.06, xlo = 0;
  const med = (a) => { const s = [...a].sort((m, n) => m - n); return s[Math.floor(s.length / 2)]; };
  const mx = med(xs), my = med(ys);

  const px = (x) => L + ((x - xlo) / (xhi - xlo || 1)) * (W - L - R);
  const py = (y) => T + (1 - (y - ylo) / (yhi - ylo || 1)) * (H - T - B);

  return (
    <div style={{ width: "100%", overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height, display: "block" }}
           role="img" aria-label={`${xLabel} against ${yLabel}`}>
        <line x1={px(mx)} x2={px(mx)} y1={T} y2={H - B} stroke={AXIS} strokeDasharray="3 4" />
        <line x1={L} x2={W - R} y1={py(my)} y2={py(my)} stroke={AXIS} strokeDasharray="3 4" />
        <text x={px(mx) + 5} y={T + 10} fontFamily={MONO} fontSize="8" fill={DIM}>median pick</text>
        <text x={L + 3} y={py(my) - 4} fontFamily={MONO} fontSize="8" fill={DIM}>median win</text>

        <text x={W - R} y={py(yhi) + 22} textAnchor="end" fontFamily={MONO} fontSize="8.5" fill={CHART_COLORS.green}>
          POPULAR &amp; STRONG
        </text>
        <text x={L + 4} y={py(yhi) + 22} fontFamily={MONO} fontSize="8.5" fill={CHART_COLORS.blue}>
          SLEEPER · LOW PICK, HIGH WIN
        </text>
        <text x={W - R} y={H - B - 6} textAnchor="end" fontFamily={MONO} fontSize="8.5" fill={CHART_COLORS.red}>
          POPULARITY TRAP
        </text>

        {[ylo, my, yhi].map((t, i) => (
          <text key={i} x={L - 6} y={py(t) + 3.5} textAnchor="end" fontFamily={MONO} fontSize="9" fill={DIM}>
            {t.toFixed(0)}%
          </text>
        ))}
        <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" fontFamily={MONO} fontSize="9" fill={DIM}>
          {xLabel} →
        </text>

        {points.map((p, i) => (
          <g key={p.label || i}>
            <circle cx={px(p.x)} cy={py(p.y)} r={p.highlight ? 5 : 3.2}
                    fill={p.color || (p.y >= my && p.x >= mx ? CHART_COLORS.green
                          : p.y >= my ? CHART_COLORS.blue
                          : p.x >= mx ? CHART_COLORS.red : CHART_COLORS.muted)}
                    opacity={p.highlight ? 1 : 0.72}
                    stroke={p.highlight ? "#fff" : "none"} strokeWidth={p.highlight ? 1.2 : 0}>
              <title>{`${p.label}: ${p.y.toFixed(1)}% win · ${p.x.toFixed(1)}% pick`}</title>
            </circle>
            {p.highlight && (
              <text x={px(p.x) + 7} y={py(p.y) + 3} fontFamily={MONO} fontSize="9" fill={TEXT}>{p.label}</text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}
