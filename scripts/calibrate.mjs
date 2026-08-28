// ─── Draft-engine calibration ────────────────────────────────────────────────
// Scores computeWinSplit against real outcomes and records the result, so the
// engine's honesty is monitored rather than assumed. Before this existed, every
// coefficient in draft_logic_config.json was hand-authored and had never been
// checked against a single game — and the shipped values turned out to be worse
// than always saying 50/50.
//
// LEAKAGE IS THE WHOLE DIFFICULTY. The live aggregates are computed FROM the
// games we would test on, so a naive backtest scores the engine on its own
// training data and flatters it. refresh_calibration_slice() rebuilds the
// aggregates from matches COLLECTED BEFORE the test window opens; a game played
// after the cutoff is collected after it, so it cannot leak in.
//
// Run: node scripts/calibrate.mjs [cutoffDays]
// Needs SUPABASE_URL + SUPABASE_KEY (service role — it calls a definer RPC).

import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_KEY;
if (!URL || !KEY) { console.error("SUPABASE_URL and SUPABASE_KEY are required."); process.exit(1); }
const CUTOFF_DAYS = Number(process.argv[2] || 7);
const sb = createClient(URL, KEY);

// The engine is ESM importing JSON and other modules, so bundle it rather than
// asking Node to resolve that graph.
const tmp = mkdtempSync(join(tmpdir(), "calib-"));
const bundle = join(tmp, "engine.mjs");
execSync(`npx --yes esbuild src/data/draftEngine.js --bundle --format=esm --platform=node --loader:.json=json --outfile="${bundle}" --log-level=error`, { stdio: "inherit" });
const { computeWinSplit } = await import(`file://${bundle.replace(/\\/g, "/")}`);
const CONFIG = (await import(`file://${process.cwd().replace(/\\/g, "/")}/src/data/draft_logic_config.json`, { with: { type: "json" } })).default;

const page = async (t, cols, order) => {
  const out = []; let from = 0;
  for (;;) {
    const { data, error } = await sb.from(t).select(cols).order(order).range(from, from + 999);
    if (error) throw new Error(`${t}: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
};

console.log(`rebuilding the calibration slice (cutoff ${CUTOFF_DAYS}d)…`);
const { data: slice, error: sliceErr } = await sb.rpc("refresh_calibration_slice", { cutoff_days: CUTOFF_DAYS });
if (sliceErr) { console.error("refresh_calibration_slice failed:", sliceErr.message); process.exit(1); }
console.log(`  train ${Number(slice.train_games).toLocaleString("en-US")} games · test ${Number(slice.test_games).toLocaleString("en-US")} games\n`);

const [mapRows, intelRows, pairRows, withRows, games] = await Promise.all([
  page("calib_train_mapstats", "map_name,mode,brawler,picks,wins", "map_name"),
  page("calib_train_intel", "brawler,picks,wins", "brawler"),
  page("calib_train_pairs", "brawler,foe,picks,wins", "brawler"),
  page("calib_train_with", "a,b,picks,wins", "a"),
  page("calib_test_games", "match_key,map_name,mode,blue,red,blue_won", "match_key"),
]);

const PRIOR = CONFIG.statisticalCoefficients.confidencePriorGames;
const trueWR = (w, p) => (p + PRIOR === 0 ? 50 : ((w + PRIOR * 0.5) / (p + PRIOR)) * 100);
const byMap = {};
for (const r of mapRows) {
  const k = r.map_name.toUpperCase();
  (byMap[k] = byMap[k] || {})[r.brawler.toUpperCase()] = { picks: r.picks, wins: r.wins };
}
const intel = {};
for (const r of intelRows) {
  intel[r.brawler.toUpperCase()] = { true_win_rate: trueWR(r.wins, r.picks), vs_brawler: {}, with_brawler: {} };
}
for (const r of pairRows) {
  const me = intel[r.brawler.toUpperCase()];
  if (me) me.vs_brawler[r.foe.toUpperCase()] = { picks: r.picks, winRate: (r.wins / r.picks) * 100 };
}
for (const r of withRows) {           // symmetric, both directions, as the RPC writes it
  const a = r.a.toUpperCase(), b = r.b.toUpperCase();
  const rec = { picks: r.picks, winRate: (r.wins / r.picks) * 100 };
  if (intel[a]) intel[a].with_brawler[b] = rec;
  if (intel[b]) intel[b].with_brawler[a] = rec;
}

const playable = games.filter(g => byMap[String(g.map_name).toUpperCase()]);
const ys = playable.map(g => (g.blue_won ? 1 : 0));
const diffs = playable.map(g => computeWinSplit({
  blueTeam: g.blue, redTeam: g.red, mode: g.mode,
  mapStats: byMap[String(g.map_name).toUpperCase()], intelligence: intel, minMapPicks: 30,
}).rawEdge);

const auc = (d) => {
  const s = d.map((v, i) => ({ v, y: ys[i] })).sort((a, b) => a.v - b.v);
  let i = 0; const rk = new Array(s.length);
  while (i < s.length) { let j = i; while (j + 1 < s.length && s[j + 1].v === s[i].v) j++;
    const r = (i + j + 2) / 2; for (let k = i; k <= j; k++) rk[k] = r; i = j + 1; }
  const n1 = s.filter(x => x.y === 1).length, n0 = s.length - n1;
  if (!n1 || !n0) return NaN;
  return (s.reduce((a, x, q) => a + (x.y === 1 ? rk[q] : 0), 0) - n1 * (n1 + 1) / 2) / (n1 * n0);
};
const clamp = p => Math.min(0.999999, Math.max(0.000001, p));
const P = (v, s) => 1 / (1 + Math.exp(-v / s));
const logloss = s => -diffs.reduce((a, v, i) => { const p = clamp(P(v, s));
  return a + (ys[i] * Math.log(p) + (1 - ys[i]) * Math.log(1 - p)); }, 0) / diffs.length;
const brier = s => diffs.reduce((a, v, i) => a + (P(v, s) - ys[i]) ** 2, 0) / diffs.length;

const shipped = CONFIG.winProbability.logisticScale;
let fitted = null;
for (let s = 1; s <= 200; s += 0.25) { const v = logloss(s); if (!fitted || v < fitted.v) fitted = { s, v }; }
const A = auc(diffs);
const acc = diffs.filter((v, i) => (P(v, shipped) >= 0.5) === (ys[i] === 1)).length / diffs.length;
const BASE = Math.log(2);

const buckets = [];
for (const [lo, hi] of [[0,.4],[.4,.45],[.45,.5],[.5,.55],[.55,.6],[.6,1.01]]) {
  const b = diffs.map((v, i) => ({ p: P(v, shipped), y: ys[i] })).filter(r => r.p >= lo && r.p < hi);
  if (!b.length) continue;
  const pred = b.reduce((a, r) => a + r.p, 0) / b.length;
  const act = b.reduce((a, r) => a + r.y, 0) / b.length;
  buckets.push({ lo, hi, n: b.length, predicted: +(100 * pred).toFixed(1), actual: +(100 * act).toFixed(1), gap: +(100 * (act - pred)).toFixed(1) });
}
const worstGap = Math.max(...buckets.map(b => Math.abs(b.gap)));

console.log(`ENGINE CALIBRATION — ${diffs.length.toLocaleString("en-US")} games`);
console.log(`  AUC              ${A.toFixed(4)}   (0.50 = coin flip)`);
console.log(`  logloss          ${logloss(shipped).toFixed(4)}   (always-50%: ${BASE.toFixed(4)})`);
console.log(`  brier            ${brier(shipped).toFixed(4)}   (always-50%: 0.2500)`);
console.log(`  accuracy         ${(100 * acc).toFixed(2)}%`);
console.log(`  logisticScale    shipped ${shipped} · best fit ${fitted.s}`);
console.log(`  worst bucket gap ${worstGap.toFixed(1)}pp`);
console.log(`\n  predicted      n      says    actual    gap`);
for (const b of buckets) {
  console.log(`  ${(100*b.lo).toFixed(0).padStart(3)}-${(100*b.hi).toFixed(0).padEnd(3)} ${String(b.n).padStart(7)}   ${b.predicted.toFixed(1)}%   ${b.actual.toFixed(1)}%   ${b.gap >= 0 ? "+" : ""}${b.gap.toFixed(1)}pp`);
}

const { error: insErr } = await sb.from("engine_calibration").insert({
  patch: CONFIG.currentPatch ?? null,
  test_games: diffs.length, train_games: Number(slice.train_games),
  auc: +A.toFixed(4), logloss: +logloss(shipped).toFixed(4), brier: +brier(shipped).toFixed(4),
  accuracy: +(100 * acc).toFixed(2), fitted_scale: fitted.s, shipped_scale: shipped,
  baseline_logloss: +BASE.toFixed(4), worst_bucket_gap_pp: +worstGap.toFixed(1),
  detail: { slice, buckets, config: CONFIG.winProbability, duoSynergy: CONFIG.duoSynergy },
});
if (insErr) console.error("could not record result:", insErr.message);
rmSync(tmp, { recursive: true, force: true });

// ── regression gates ─────────────────────────────────────────────────────────
// Loud, because both of these were true of the shipped engine before anyone
// measured it: it beat neither the coin flip nor its own stated confidence.
const problems = [];
if (logloss(shipped) >= BASE) problems.push(`logloss ${logloss(shipped).toFixed(4)} is no better than always saying 50/50 (${BASE.toFixed(4)})`);
if (Math.abs(fitted.s - shipped) / shipped > 0.5) problems.push(`logisticScale ${shipped} is far from the fitted ${fitted.s} — the engine is mis-stating its confidence`);
if (worstGap > 5) problems.push(`a calibration bucket is off by ${worstGap.toFixed(1)}pp`);
if (A < 0.52) problems.push(`AUC ${A.toFixed(4)} is barely better than a coin flip`);
if (problems.length) {
  console.log(`\nREGRESSIONS:`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log(`\nNo regressions.`);
