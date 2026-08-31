// ─── "What should I upgrade next?" ────────────────────────────────────────────
// Reads the player's own roster from /api/player, scores it against the current
// rotation with data/upgradeAdvisor.js, and shows the few upgrades worth making.
//
// Unlike the statistical panels this is ADVICE, not a measurement, so the
// display ladder does not apply — there is no sample size to be honest about.
// What it must be honest about instead is its inputs: it can see power levels,
// star powers, gadgets, gears, buffies and hypercharges, and it cannot see the
// player's coin or power-point balance. It ranks what is worth buying, not what
// they can afford, and the footer says so.
//
// It ALWAYS shows five, with reasons, rather than falling silent when the top
// pick is weak — a player asking "what next" wants ranked options even when the
// honest answer is "none of these are urgent". When the roster is deep enough
// that saving genuinely beats spending, that is said above the list rather than
// instead of it.

import { useState, useEffect } from "react";
import { supabase, CURRENT_PATCH, formatBrawlerName } from "./appCore";
import { recommendUpgrades, READY_WIN_RATE } from "./data/upgradeAdvisor";
import { draftClassOf } from "./data/draftEngine";
import { BUFFIE_PACKS, BUFFIE_COST } from "./data/upgradeCosts";
import BRAWLER_META from "./data/brawlerMeta.json";

export const MONO = "'JetBrains Mono', monospace";
export const DISPLAY = "'Baloo 2', sans-serif";

// Masters only, deliberately. Upgrade advice is about competitive ranked play,
// and Diamond/Mythic win rates describe a different game — different draft
// discipline, different comps. Named so it cannot drift apart between the two
// queries below.
const BRACKET = "masters_legendary";

const art = (name) => BRAWLER_META[String(name || "").toUpperCase()]?.imageUrl || null;

const TONE = {
  good: "#8ee6b0",
  warn: "#ffce7a",
  info: "#9a8fc0",
  muted: "#8b8b9c",
};

export function useAdvice(tag, rankedRows) {
  const [state, setState] = useState({
    loading: true, picks: [], classes: [], byMode: {}, byClass: {}, modeFreq: {}, statsError: null,
    builtNames: new Set(), strongNames: new Set(), saveAdvice: null,
    roster: [], intel: {}, error: null,
  });

  useEffect(() => {
    if (!tag) return;
    let cancelled = false;
    (async () => {
      setState(s => ({ ...s, loading: true }));
      try {
        const [profileRes, intelRes, poolRes, brawlersRes] = await Promise.all([
          fetch(`/api/player?tag=%23${tag.replace("#", "")}`).then(r => r.json()),
          supabase.from("brawler_intelligence")
            .select("brawler,true_win_rate,pick_rate")
            .eq("patch", CURRENT_PATCH).eq("rank_bracket", BRACKET),
          supabase.from("ranked_map_pool").select("map_name").eq("in_rotation", true),
          supabase.from("brawlers").select("id,name"),
        ]);
        if (cancelled) return;
        const roster = profileRes?.roster;
        if (!Array.isArray(roster) || !roster.length) {
          setState(s => ({ ...s, loading: false, picks: [], error: "no_roster" }));
          return;
        }

        const intelligence = Object.fromEntries(
          (intelRes.data || []).map(r => [(r.brawler || "").toUpperCase(), r]));

        // Only the maps actually in rotation — an upgrade should be judged on
        // what the player will meet this week, not on a patch-wide average that
        // includes maps nobody is playing right now. `mode` comes along because
        // the per-mode lists need it, and because the share each ROLE takes in
        // each mode is what stops the advisor demanding a Heist Thrower.
        const maps = (poolRes.data || []).map(m => m.map_name);
        // ALL-OR-NOTHING, and loudly. This paged read used to swallow its
        // error: `const { data }` discarded it, a failure left `data` null, the
        // loop broke, and the per-mode and per-role sections silently rendered
        // as nothing while the overall list carried on working off the global
        // win rates from a different query. That is exactly what it looked like
        // on a second account — top five present, everything else missing, no
        // error anywhere.
        //
        // Partial data is worse than none: pages 1-2 of 4 would produce mode
        // shares computed from half the rotation and show them as fact. So it
        // accumulates into scratch objects, retries once, and only commits if
        // every page arrived.
        let rotationStats = {}, modeStats = {}, cellPicks = {}, modeTotal = {};
        let grand = 0, statsError = null;
        if (maps.length) {
          for (let attempt = 0; attempt < 2; attempt++) {
            const rot = {}, byMode = {}, cells = {}, totals = {};
            let total = 0, failed = null, from = 0;
            for (;;) {
              const { data: bs, error } = await supabase.from("BrawlerStats")
                .select("brawler,mode,picks,wins")
                .eq("patch", CURRENT_PATCH).eq("rank_bracket", BRACKET)
                .in("map", maps).range(from, from + 999);
              if (error) { failed = error.message; break; }
              if (!bs || !bs.length) break;
              for (const r of bs) {
                const k = (r.brawler || "").toUpperCase(); if (!k) continue;
                const m = r.mode || "?";
                const picks = Number(r.picks) || 0, wins = Number(r.wins) || 0;
                rot[k] = rot[k] || { picks: 0, wins: 0 };
                rot[k].picks += picks; rot[k].wins += wins;
                ((byMode[k] = byMode[k] || {})[m] = byMode[k][m] || { picks: 0, wins: 0 });
                byMode[k][m].picks += picks; byMode[k][m].wins += wins;
                const c = draftClassOf(r.brawler);
                ((cells[m] = cells[m] || {})[c] = (cells[m][c] || 0) + picks);
                totals[m] = (totals[m] || 0) + picks; total += picks;
              }
              if (bs.length < 1000) break;
              from += 1000;
            }
            if (!failed) {
              rotationStats = rot; modeStats = byMode; cellPicks = cells;
              modeTotal = totals; grand = total; statsError = null;
              break;
            }
            statsError = failed;
          }
          if (statsError) {
            // Leave every accumulator empty. metaStrength then falls back to the
            // patch-wide win rate, which is a defined answer, and the UI is told
            // the mode split is unavailable rather than showing a blank section.
            console.error("BrawlerStats read failed, mode split unavailable:", statsError);
          }
        }
        const modeFreq = {}, modeUsage = {};
        for (const m of Object.keys(modeTotal)) {
          modeFreq[m] = modeTotal[m] / (grand || 1);
          modeUsage[m] = {};
          for (const c of Object.keys(cellPicks[m] || {})) {
            modeUsage[m][c] = 100 * cellPicks[m][c] / modeTotal[m];
          }
        }

        const byId = Object.fromEntries((brawlersRes.data || []).map(b => [b.id, (b.name || "").toUpperCase()]));
        const playedCounts = {};
        for (const r of rankedRows || []) {
          const n = byId[r.brawler_id];
          if (n) playedCounts[n] = (playedCounts[n] || 0) + 1;
        }

        if (cancelled) return;
        const { picks, classes, byMode, byClass, builtNames, strongNames, saveAdvice } =
          recommendUpgrades({ roster, intelligence, rotationStats, modeStats, modeUsage, modeFreq, playedCounts });
        setState({ loading: false, picks, classes, byMode, byClass, modeFreq,
                   builtNames, strongNames, saveAdvice, roster, intel: intelligence,
                   statsError, error: null });
      } catch (e) {
        if (!cancelled) setState(s => ({ ...s, loading: false, picks: [], error: e.message }));
      }
    })();
    return () => { cancelled = true; };
  }, [tag, rankedRows]);

  return state;
}

function Loadout({ owned }) {
  const items = [
    { label: "GADGETS", have: owned.gadgets, of: 2 },
    { label: "STAR POWERS", have: owned.starPowers, of: 2 },
    { label: "GEARS", have: owned.gears, of: 2 },
    { label: "BUFFIES", have: owned.buffies, of: 3 },
  ];
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
      {items.map(it => {
        const full = it.have >= it.of;
        return (
          <span key={it.label} style={{
            fontFamily: MONO, fontSize: 11, padding: "3px 8px", borderRadius: 999,
            background: full ? "rgba(142,230,176,.10)" : it.have > 0 ? "rgba(255,255,255,.05)" : "transparent",
            border: `1px solid ${full ? "rgba(142,230,176,.28)" : "rgba(255,255,255,.10)"}`,
            color: full ? "#8ee6b0" : it.have > 0 ? "#c9c9d6" : "#7c7e8f",
          }}>{it.label} {it.have}/{it.of}</span>
        );
      })}
      <span style={{
        fontFamily: MONO, fontSize: 11, padding: "3px 8px", borderRadius: 999,
        background: owned.hyper ? "rgba(142,230,176,.10)" : "transparent",
        border: `1px solid ${owned.hyper ? "rgba(142,230,176,.28)" : "rgba(255,143,143,.24)"}`,
        color: owned.hyper ? "#8ee6b0" : "#ff8f8f",
      }}>{owned.hyper ? "HYPERCHARGE ✓" : "NO HYPERCHARGE"}</span>
    </div>
  );
}

export function Card({ p, rank, note }) {
  const image = art(p.name);
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "auto auto minmax(0,1fr)", gap: 13, alignItems: "start",
      padding: "13px 15px", borderRadius: 13, marginBottom: 9,
      background: rank === 1 ? "rgba(255,180,61,.07)" : "rgba(255,255,255,.03)",
      border: `1px solid ${rank === 1 ? "rgba(255,180,61,.28)" : "rgba(255,255,255,.08)"}`,
    }}>
      <span style={{
        fontFamily: MONO, fontSize: 11, color: rank === 1 ? "#ffce7a" : "#7c7e8f",
        width: 14, textAlign: "right", paddingTop: 12,
      }}>{rank}</span>

      <span style={{
        width: 44, height: 44, borderRadius: 10, overflow: "hidden", flexShrink: 0,
        background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.1)",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
      }}>
        {image
          ? <img src={image} alt="" width={44} height={44} style={{ objectFit: "cover" }} loading="lazy" />
          : <span style={{ fontFamily: MONO, fontSize: 10, color: "#8a8a9c" }}>{p.name.slice(0, 2)}</span>}
      </span>

      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
          <span style={{ fontFamily: DISPLAY, fontSize: 16, fontWeight: 700, color: "#f4f4fa" }}>
            {formatBrawlerName(p.name)}
          </span>
          <span style={{ fontFamily: MONO, fontSize: 11, color: "#8a7fa6" }}>{p.label.toUpperCase()}</span>
          <span style={{ fontFamily: MONO, fontSize: 11, color: "#7c7e8f" }}>POWER {p.power}</span>
          {note && (
            <span style={{
              fontFamily: MONO, fontSize: 10.5, letterSpacing: .6, padding: "2px 7px", borderRadius: 999,
              background: note.tone === "new" ? "rgba(142,230,176,.12)" : "rgba(255,255,255,.05)",
              border: `1px solid ${note.tone === "new" ? "rgba(142,230,176,.32)" : "rgba(255,255,255,.10)"}`,
              color: note.tone === "new" ? "#8ee6b0" : "#8a8a9c",
            }}>{note.text}</span>
          )}
        </div>

        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
          <span style={{
            padding: "4px 10px", borderRadius: 999,
            background: "rgba(179,107,255,.14)", border: "1px solid rgba(179,107,255,.3)",
            fontFamily: MONO, fontSize: 10.5, color: "#c9a6ff",
          }}>{p.step.label}</span>
          {(p.step.coins > 0 || p.step.pp > 0) && (
            <span style={{ fontFamily: MONO, fontSize: 10, color: "#ffce7a" }}>
              {p.step.coins > 0 && `${p.step.coins.toLocaleString("en-US")} coins`}
              {p.step.coins > 0 && p.step.pp > 0 && " + "}
              {p.step.pp > 0 && `${p.step.pp.toLocaleString("en-US")} power points`}
            </span>
          )}
          {p.cost.totalCoins > p.step.coins && (
            <span style={{ fontFamily: MONO, fontSize: 11, color: "#7c7e8f" }}>
              · {p.cost.totalCoins.toLocaleString("en-US")} coins to finish entirely
            </span>
          )}
        </div>

        <Loadout owned={p.owned} />

        {p.reasons.length > 0 && (
          <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
            {p.reasons.map((r, i) => (
              <div key={i} style={{ fontSize: 12.5, lineHeight: 1.55, color: TONE[r.tone] || "#8a8a9c" }}>
                {r.text}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


// Buffies are bought by PACK, never by brawler — a draw returns one at random
// from the three brawlers in a pack, skipping what you already hold. So the
// only question a player can actually act on is "which pack still has room",
// and a full pack is money that cannot be spent there at all.
export function BuffiePacks({ roster }) {
  if (!roster || !roster.length) return null;
  const byName = Object.fromEntries(roster.map(b => [String(b.name || "").toUpperCase(), b]));
  const rows = BUFFIE_PACKS.map(pack => {
    const missing = pack.brawlers.reduce((a, n) => {
      const bf = byName[n]?.buffies;
      return a + (bf ? Object.values(bf).filter(v => !v).length : 3);
    }, 0);
    return { ...pack, missing, held: 9 - missing };
  }).sort((a, b) => b.missing - a.missing);

  const open = rows.filter(r => r.missing > 0);

  return (
    <div style={{
      marginTop: 12, padding: "13px 15px", borderRadius: 12,
      background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.07)",
    }}>
      <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: 1.6, color: "#8b8b9c", marginBottom: 9 }}>
        BUFFIE PACKS — {BUFFIE_COST.pp.toLocaleString("en-US")} POWER POINTS + {BUFFIE_COST.coins.toLocaleString("en-US")} GOLD PER DRAW
      </div>
      <div style={{ display: "grid", gap: 5 }}>
        {rows.map(r => (
          <div key={r.name} style={{
            display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto", gap: 10, alignItems: "center",
            fontFamily: MONO, fontSize: 10.5,
            color: r.missing === 0 ? "#7c7e8f" : "#c9c9d6",
          }}>
            <span>{r.name}
              <span style={{ color: "#7c7e8f" }}> · {r.brawlers.map(n => n[0] + n.slice(1).toLowerCase()).join(", ")}</span>
            </span>
            <span style={{ color: r.missing === 0 ? "#7c7e8f" : "#ffce7a" }}>{r.held}/9</span>
            <span style={{ color: "#7c7e8f", minWidth: 54, textAlign: "right" }}>
              {r.missing === 0 ? "full" : `${r.missing} open`}
            </span>
          </div>
        ))}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 10, color: "#7c7e8f", marginTop: 9, lineHeight: 1.6 }}>
        {open.length === 0
          ? "Every pack is full — buffie draws have nothing left to give you until the next wave."
          : `A draw returns one random buffie from the pack you buy, skipping ones you already hold, so a fuller pack is better odds on what's left. ${7 - open.length} of 7 packs are already complete.`}
      </div>
    </div>
  );
}

// The roster, as portraits, grouped by the role each brawler plays in a draft.
//
// Counts alone ("Control 6/17") could not show the thing that actually matters,
// which is WHICH brawlers those are — and it quietly contradicted the cards:
// the old "thin role" test counted MAXED brawlers, while the advice reasons in
// FIELDABLE ones, so this panel would call Thrower healthy at 2 maxed while the
// card above it said you were thin at 1 fieldable. Both now use the same test.
//
// Three states, because two would lie. Grey = not power 11, unusable in ranked
// from Mythic up. Full colour = maxed. Ringed = maxed AND holding its
// hypercharge AND good in the current meta, which is the only bar that makes a
// brawler a real draft option and the one every "you're thin on X" line counts.
function RosterFace({ b, built, strong, selected, onClick }) {
  const src = art(b.name);
  const maxed = (b.power || 0) >= 11;
  const state = strong ? "strong" : built ? "built" : maxed ? "maxed" : "low";
  const title = `${formatBrawlerName(b.name)} - power ${b.power || 1}`
    + (strong ? " - built, and winning right now" : built ? " - built" : maxed ? " - maxed, no hypercharge" : "");
  const ring = { strong: "rgba(142,230,176,.75)", built: "rgba(154,143,192,.75)",
                 maxed: "rgba(255,255,255,.12)", low: "rgba(255,255,255,.08)" }[state];
  return (
    <button type="button" onClick={onClick} title={title} aria-pressed={selected} style={{
      width: 34, height: 34, borderRadius: 9, overflow: "hidden", flexShrink: 0, padding: 0,
      position: "relative", cursor: "pointer", background: "rgba(255,255,255,.05)",
      border: `${built ? 1.5 : 1}px solid ${selected ? "#fff" : ring}`,
      boxShadow: selected ? "0 0 0 2px rgba(255,255,255,.25)"
        : strong ? "0 0 0 1px rgba(142,230,176,.16)" : "none",
      // Greyscale rather than hidden: seeing the brawlers you own but cannot
      // field is the point - that is the upgrade backlog.
      filter: maxed ? "none" : "grayscale(1) brightness(.62)",
      opacity: maxed ? 1 : .5,
    }}>
      {src
        ? <img src={src} alt="" width={34} height={34} style={{ objectFit: "cover", display: "block" }} loading="lazy" />
        : <span style={{ fontFamily: MONO, fontSize: 10.5, color: "#8a8a9c" }}>{String(b.name).slice(0, 2)}</span>}
      {strong && (
        <span style={{
          position: "absolute", right: -1, bottom: -1, width: 9, height: 9, borderRadius: "50%",
          background: "#8ee6b0", border: "1.5px solid #14141c",
        }} />
      )}
    </button>
  );
}

function Swatch({ ring, dot, fill }) {
  return (
    <span style={{
      display: "inline-block", position: "relative", width: 9, height: 9, borderRadius: 3,
      verticalAlign: "-1px", marginRight: 5, background: fill, border: `1.5px solid ${ring}`,
    }}>
      {dot && <span style={{
        position: "absolute", right: -3, bottom: -3, width: 5, height: 5, borderRadius: "50%",
        background: "#8ee6b0", border: "1px solid #14141c",
      }} />}
    </span>
  );
}

// What one brawler's situation is, opened by clicking its portrait. Most of this
// is already computed for the ranked cards; the panel exists because the ranked
// list only shows five, and the roster grid shows all hundred-odd.
function FaceDetail({ b, pick, rank, intel, built, strong, onClose }) {
  const key = String(b.name || "").toUpperCase();
  const wr = pick?.winRate ?? (Number.isFinite(+intel?.[key]?.true_win_rate) ? +intel[key].true_win_rate : null);
  const o = {
    gadgets: (b.gadgets || []).length, starPowers: (b.starPowers || []).length,
    gears: (b.gears || []).length,
    buffies: b.buffies ? Object.values(b.buffies).filter(Boolean).length : 0,
    hyper: (b.hyperCharges || []).length > 0,
  };
  const statusText = strong
    ? `Built and winning - power 11, hypercharge owned, and above ${READY_WIN_RATE}% right now.`
    : built
      ? `Built - power 11 with its hypercharge, so you can field it. It is under ${READY_WIN_RATE}% at the moment, which does not stop it being a legitimate pick.`
      : (b.power || 0) >= 11
        ? "Maxed, but the hypercharge is not owned - that is a tier down on every exchange."
        : `Power ${b.power || 1}. Ranked will not let you play it from Mythic upward until it is power 11.`;

  return (
    <div style={{
      marginTop: 9, padding: "12px 14px", borderRadius: 11,
      background: "rgba(255,255,255,.035)", border: "1px solid rgba(255,255,255,.10)",
    }}>
      <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
        <span style={{
          width: 40, height: 40, borderRadius: 10, overflow: "hidden", flexShrink: 0,
          background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.10)",
          filter: (b.power || 0) >= 11 ? "none" : "grayscale(1) brightness(.62)",
        }}>
          {art(b.name) && <img src={art(b.name)} alt="" width={40} height={40} style={{ objectFit: "cover", display: "block" }} />}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
            <span style={{ fontFamily: DISPLAY, fontSize: 16, fontWeight: 800, color: "#e9e9f2" }}>
              {formatBrawlerName(b.name)}
            </span>
            <span style={{ fontFamily: MONO, fontSize: 10, color: "#8b8b9c" }}>POWER {b.power || 1}</span>
            {wr != null && (
              <span style={{ fontFamily: MONO, fontSize: 10, color: wr >= READY_WIN_RATE ? "#8ee6b0" : "#9a9aab" }}>
                {wr.toFixed(1)}% WIN RATE
              </span>
            )}
            {rank != null && (
              <span style={{ fontFamily: MONO, fontSize: 10, color: "#9a8fc0" }}>#{rank} TO UPGRADE</span>
            )}
          </div>
          <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "#c9c9d6", marginTop: 5 }}>{statusText}</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" style={{
          background: "none", border: "none", cursor: "pointer", padding: 4,
          fontFamily: MONO, fontSize: 13, color: "#8b8b9c", lineHeight: 1,
        }}>x</button>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
        {[["GADGETS", o.gadgets, 2], ["STAR POWERS", o.starPowers, 2],
          ["GEARS", o.gears, 2], ["BUFFIES", o.buffies, 3]].map(([label, have, of]) => (
          <span key={label} style={{
            fontFamily: MONO, fontSize: 11, padding: "3px 8px", borderRadius: 999,
            background: have >= of ? "rgba(142,230,176,.10)" : have > 0 ? "rgba(255,255,255,.05)" : "transparent",
            border: `1px solid ${have >= of ? "rgba(142,230,176,.28)" : "rgba(255,255,255,.10)"}`,
            color: have >= of ? "#8ee6b0" : have > 0 ? "#c9c9d6" : "#7c7e8f",
          }}>{label} {have}/{of}</span>
        ))}
        <span style={{
          fontFamily: MONO, fontSize: 11, padding: "3px 8px", borderRadius: 999,
          background: o.hyper ? "rgba(142,230,176,.10)" : "transparent",
          border: `1px solid ${o.hyper ? "rgba(142,230,176,.28)" : "rgba(255,143,143,.24)"}`,
          color: o.hyper ? "#8ee6b0" : "#ff8f8f",
        }}>{o.hyper ? "HYPERCHARGE OWNED" : "NO HYPERCHARGE"}</span>
      </div>

      {pick ? (
        <>
          <div style={{ fontFamily: MONO, fontSize: 10.5, color: "#c9c9d6", marginTop: 10 }}>
            NEXT: {pick.step.label}
            <span style={{ color: "#8b8b9c" }}>
              {pick.step.coins ? ` - ${pick.step.coins.toLocaleString("en-US")} coins` : ""}
              {pick.step.pp ? ` + ${pick.step.pp.toLocaleString("en-US")} pp` : ""}
            </span>
          </div>
          {pick.reasons.slice(0, 2).map((r, i) => (
            <div key={i} style={{ fontSize: 12.5, lineHeight: 1.6, color: TONE[r.tone] || "#c9c9d6", marginTop: 5 }}>
              {r.text}
            </div>
          ))}
        </>
      ) : (
        <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "#8b8b9c", marginTop: 9 }}>
          Nothing left to buy on this one.
        </div>
      )}
    </div>
  );
}

export function RoleCoverage({ classes, roster, picks, intel, builtNames, strongNames }) {
  const [open, setOpen] = useState(null);
  if (!classes.length) return null;
  const built = builtNames || new Set();
  const strong = strongNames || new Set();
  const isBuilt = (b) => built.has(String(b.name || "").toUpperCase());
  const isStrong = (b) => strong.has(String(b.name || "").toUpperCase());

  const rankOf = {}, pickOf = {};
  (picks || []).forEach((p, i) => {
    const k = String(p.name || "").toUpperCase();
    rankOf[k] = i + 1; pickOf[k] = p;
  });

  const byClass = {};
  for (const b of roster || []) {
    const c = draftClassOf(b.name);
    (byClass[c] = byClass[c] || []).push(b);
  }
  // Strong first, then built, then maxed, then by how close it is - so each row
  // reads left to right as "what I can bring" then "what is next".
  const weight = (b) => (isStrong(b) ? 3 : isBuilt(b) ? 2 : (b.power || 0) >= 11 ? 1 : 0);
  for (const k of Object.keys(byClass)) {
    byClass[k].sort((a, b) => weight(b) - weight(a) || (b.power || 0) - (a.power || 0)
      || (b.trophies || 0) - (a.trophies || 0));
  }

  const thin = classes.filter(c => c.built <= 1);
  const noStrong = classes.filter(c => c.strong === 0);

  return (
    <div style={{
      marginTop: 12, padding: "13px 15px", borderRadius: 12,
      background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.07)",
    }}>
      <div style={{
        display: "flex", alignItems: "baseline", justifyContent: "space-between",
        gap: 12, flexWrap: "wrap", marginBottom: 11,
      }}>
        <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: 1.6, color: "#8b8b9c" }}>
          YOUR ROSTER BY ROLE
        </div>
        <div style={{ display: "flex", gap: 11, flexWrap: "wrap", fontFamily: MONO, fontSize: 10.5, color: "#8b8b9c" }}>
          <span><Swatch ring="rgba(142,230,176,.75)" fill="rgba(142,230,176,.25)" dot />BUILT + WINNING</span>
          <span><Swatch ring="rgba(154,143,192,.75)" fill="rgba(154,143,192,.25)" />BUILT</span>
          <span><Swatch ring="rgba(255,255,255,.12)" fill="rgba(255,255,255,.22)" />NO HYPERCHARGE</span>
          <span><Swatch ring="rgba(255,255,255,.08)" fill="rgba(255,255,255,.06)" />NOT POWER 11</span>
        </div>
      </div>

      <div style={{ fontSize: 12.5, lineHeight: 1.6, color: "#9a9aab", marginBottom: 13 }}>
        <strong style={{ color: "#c9c9d6", fontWeight: 600 }}>Built</strong> means power 11 with its
        hypercharge, so you can bring it to a draft. That is the bar the advice counts when it calls a
        role thin, because it is a fact about your account rather than something that moves on its own.
        The green dot marks the ones also above {READY_WIN_RATE}% right now. A built brawler without a
        dot is still a real pick: Chuck sits under {READY_WIN_RATE}% in Heist across tens of thousands
        of games and is still a Heist pick. Click any brawler for its details.
      </div>

      {classes.map(c => {
        const list = byClass[c.cls] || [];
        const isThin = c.built <= 1;
        const openB = list.find(b => (b.id ?? b.name) === open) || null;
        return (
          <div key={c.cls} style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
              <span style={{
                fontFamily: MONO, fontSize: 10.5, letterSpacing: .6,
                color: isThin ? "#ff8f8f" : "#c9c9d6",
              }}>{c.label}</span>
              <span style={{ fontFamily: MONO, fontSize: 11, color: "#7c7e8f" }}>
                {c.built} built - {c.strong} winning - {c.maxed} maxed - {c.owned} owned
              </span>
            </div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {list.map(b => {
                const id = b.id ?? b.name;
                return (
                  <RosterFace key={id} b={b} built={isBuilt(b)} strong={isStrong(b)}
                    selected={open === id}
                    onClick={() => setOpen(open === id ? null : id)} />
                );
              })}
            </div>
            {openB && (
              <FaceDetail b={openB} intel={intel}
                pick={pickOf[String(openB.name || "").toUpperCase()]}
                rank={rankOf[String(openB.name || "").toUpperCase()]}
                built={isBuilt(openB)} strong={isStrong(openB)}
                onClose={() => setOpen(null)} />
            )}
          </div>
        );
      })}

      {(thin.length > 0 || noStrong.length > 0) && (
        <div style={{ marginTop: 4, fontSize: 12.5, lineHeight: 1.6, color: "#c9c9d6" }}>
          {thin.length > 0 && (
            <>A draft needs three brawlers you can field in a role. You are thin on{" "}
            {thin.map(c => c.label).join(", ")} - not for lack of brawlers, but because so few are
            power 11 with a hypercharge. </>
          )}
          {noStrong.length > 0 && (
            <>Nothing you can field in {noStrong.map(c => c.label).join(", ")} is above{" "}
            {READY_WIN_RATE}% right now - playable, but you have no winning option there.</>
          )}
        </div>
      )}
    </div>
  );
}

export default function UpgradeAdvisor({ tag, rankedRows }) {
  const { loading, picks, classes, builtNames, strongNames, saveAdvice, roster, intel, error } = useAdvice(tag, rankedRows);

  if (!tag) return null;
  if (loading) {
    return <div style={{ fontFamily: MONO, fontSize: 11, color: "#8b8b9c", padding: "8px 2px 18px" }}>
      Reading your roster…
    </div>;
  }
  if (error === "no_roster") {
    return <div style={{ fontFamily: MONO, fontSize: 11, color: "#8b8b9c", padding: "8px 2px 18px" }}>
      Couldn't read your roster from the Brawl Stars API just now — try again shortly.
    </div>;
  }
  if (error || !picks.length) {
    // Only when there is genuinely nothing left to buy on any brawler.
    return <div style={{ fontFamily: MONO, fontSize: 11, color: "#8b8b9c", padding: "8px 2px 18px" }}>
      Every brawler we can price is already finished — there is nothing left to buy.
    </div>;
  }

  return (
    <div style={{ marginBottom: 28 }}>
      {saveAdvice && (
        <div style={{
          padding: "14px 16px", borderRadius: 12, marginBottom: 13,
          background: "rgba(255,180,61,.08)", border: "1px solid rgba(255,180,61,.28)",
        }}>
          <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 1.6, color: "#ffce7a", marginBottom: 6 }}>
            CONSIDER SAVING INSTEAD
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.65, color: "#e2d2b0" }}>{saveAdvice.text}</div>
        </div>
      )}
      {picks.slice(0, 5).map((p, i) => <Card key={p.name} p={p} rank={i + 1} />)}
      <RoleCoverage classes={classes} roster={roster} picks={picks} intel={intel}
        builtNames={builtNames} strongNames={strongNames} />
      <BuffiePacks roster={roster} />
      <div style={{ fontFamily: MONO, fontSize: 10, color: "#7c7e8f", marginTop: 11, lineHeight: 1.65 }}>
        Ranked by what the next step buys per coin: how strong the brawler is on the maps in rotation
        now, how much you've already sunk into it, and whether your maxed roster is short of that
        role. Levelling always targets power 11, because ranked only allows power-11 brawlers from
        Mythic upward. Gear prices assume the cheap tier — epic and mythic gears cost more and the
        API doesn't tell us which you'd get. We can see power levels, star powers, gadgets, gears,
        buffies and hypercharges; we cannot see your coin or power-point balance, so this is what's
        worth buying, not what you can afford today.
      </div>
    </div>
  );
}
