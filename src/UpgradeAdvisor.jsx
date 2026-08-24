// ─── "What should I upgrade next?" ────────────────────────────────────────────
// Reads the player's own roster from /api/player, scores it against the current
// rotation with data/upgradeAdvisor.js, and shows the few upgrades worth making.
//
// Unlike the statistical panels this is ADVICE, not a measurement, so the
// display ladder does not apply in the same way — there is no sample size to be
// honest about. What it must be honest about instead is its inputs: it can see
// power level, star powers, gadgets, gears and buffies, and it cannot see how
// much currency the player has. It ranks what is worth buying, not what they
// can afford, and the footer says so.

import { useState, useEffect } from "react";
import { supabase, CURRENT_PATCH, formatBrawlerName } from "./appCore";
import { recommendUpgrades } from "./data/upgradeAdvisor";
import BRAWLER_META from "./data/brawlerMeta.json";

const MONO = "'JetBrains Mono', monospace";
const DISPLAY = "'Baloo 2', sans-serif";

const art = (name) => BRAWLER_META[String(name || "").toUpperCase()]?.imageUrl || null;

const TONE = {
  good: "#8ee6b0",
  warn: "#ffce7a",
  info: "#9a8fc0",
  muted: "#6f7180",
};

function useAdvice(tag, rankedRows) {
  const [state, setState] = useState({ loading: true, picks: [], classes: [], error: null });

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
            .eq("patch", CURRENT_PATCH).eq("rank_bracket", "masters_legendary"),
          supabase.from("ranked_map_pool").select("map_name").eq("in_rotation", true),
          supabase.from("brawlers").select("id,name"),
        ]);
        if (cancelled) return;
        const roster = profileRes?.roster;
        if (!Array.isArray(roster) || !roster.length) {
          setState({ loading: false, picks: [], classes: [], error: "no_roster" });
          return;
        }

        const intelligence = Object.fromEntries(
          (intelRes.data || []).map(r => [(r.brawler || "").toUpperCase(), r]));

        // Only the maps actually in rotation — an upgrade should be judged on
        // what the player will meet this week, not on a patch-wide average that
        // includes maps nobody is playing right now.
        const maps = (poolRes.data || []).map(m => m.map_name);
        const rotationStats = {};
        if (maps.length) {
          const { data: bs } = await supabase.from("BrawlerStats")
            .select("brawler,picks,wins")
            .eq("patch", CURRENT_PATCH).eq("rank_bracket", "masters_legendary")
            .in("map", maps);
          for (const r of bs || []) {
            const k = (r.brawler || "").toUpperCase();
            if (!k) continue;
            rotationStats[k] = rotationStats[k] || { picks: 0, wins: 0 };
            rotationStats[k].picks += Number(r.picks) || 0;
            rotationStats[k].wins += Number(r.wins) || 0;
          }
        }

        const byId = Object.fromEntries((brawlersRes.data || []).map(b => [b.id, (b.name || "").toUpperCase()]));
        const playedCounts = {};
        for (const r of rankedRows || []) {
          const n = byId[r.brawler_id];
          if (n) playedCounts[n] = (playedCounts[n] || 0) + 1;
        }

        if (cancelled) return;
        const { picks, classes } = recommendUpgrades({ roster, intelligence, rotationStats, playedCounts });
        setState({ loading: false, picks, classes, error: null });
      } catch (e) {
        if (!cancelled) setState({ loading: false, picks: [], classes: [], error: e.message });
      }
    })();
    return () => { cancelled = true; };
  }, [tag, rankedRows]);

  return state;
}

function Card({ p, rank }) {
  const image = art(p.name);
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "auto auto minmax(0,1fr)", gap: 13, alignItems: "start",
      padding: "13px 15px", borderRadius: 13, marginBottom: 9,
      background: rank === 1 ? "rgba(255,180,61,.07)" : "rgba(255,255,255,.03)",
      border: `1px solid ${rank === 1 ? "rgba(255,180,61,.28)" : "rgba(255,255,255,.08)"}`,
    }}>
      <span style={{
        fontFamily: MONO, fontSize: 11, color: rank === 1 ? "#ffce7a" : "#5a5a6a",
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
          <span style={{ fontFamily: MONO, fontSize: 9.5, color: "#8a7fa6" }}>{p.label.toUpperCase()}</span>
          <span style={{ fontFamily: MONO, fontSize: 9.5, color: "#5a5a6a" }}>POWER {p.power}</span>
        </div>

        <div style={{
          display: "inline-block", marginTop: 6, padding: "4px 10px", borderRadius: 999,
          background: "rgba(179,107,255,.14)", border: "1px solid rgba(179,107,255,.3)",
          fontFamily: MONO, fontSize: 10.5, color: "#c9a6ff",
        }}>{p.nextStep}</div>

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

function RoleCoverage({ classes }) {
  if (!classes.length) return null;
  const thin = classes.filter(c => c.maxed <= 1);
  return (
    <div style={{
      marginTop: 12, padding: "13px 15px", borderRadius: 12,
      background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.07)",
    }}>
      <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 1.6, color: "#6f7180", marginBottom: 9 }}>
        MAXED BRAWLERS BY ROLE
      </div>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        {classes.map(c => (
          <span key={c.cls} style={{
            fontFamily: MONO, fontSize: 10, padding: "5px 10px", borderRadius: 999,
            background: c.maxed <= 1 ? "rgba(255,143,143,.10)" : "rgba(255,255,255,.04)",
            border: `1px solid ${c.maxed <= 1 ? "rgba(255,143,143,.26)" : "rgba(255,255,255,.09)"}`,
            color: c.maxed <= 1 ? "#ff8f8f" : "#9a9aab",
          }}>{c.label} {c.maxed}/{c.owned}</span>
        ))}
      </div>
      {thin.length > 0 && (
        <div style={{ marginTop: 9, fontSize: 12.5, lineHeight: 1.6, color: "#c9c9d6" }}>
          A draft needs three working brawlers. You're thin on{" "}
          {thin.map(c => c.label).join(", ")} — which limits what you can pick into.
        </div>
      )}
    </div>
  );
}

export default function UpgradeAdvisor({ tag, rankedRows }) {
  const { loading, picks, classes, error } = useAdvice(tag, rankedRows);

  if (!tag) return null;
  if (loading) {
    return <div style={{ fontFamily: MONO, fontSize: 11, color: "#6f7180", padding: "8px 2px 18px" }}>
      Reading your roster…
    </div>;
  }
  if (error === "no_roster") {
    return <div style={{ fontFamily: MONO, fontSize: 11, color: "#6f7180", padding: "8px 2px 18px" }}>
      Couldn't read your roster from the Brawl Stars API just now — try again shortly.
    </div>;
  }
  if (error || !picks.length) {
    return <div style={{ fontFamily: MONO, fontSize: 11, color: "#6f7180", padding: "8px 2px 18px" }}>
      Nothing worth upgrading right now — your strong brawlers are already maxed.
    </div>;
  }

  return (
    <div style={{ marginBottom: 28 }}>
      {picks.slice(0, 5).map((p, i) => <Card key={p.name} p={p} rank={i + 1} />)}
      <RoleCoverage classes={classes} />
      <div style={{ fontFamily: MONO, fontSize: 10, color: "#5a5a6a", marginTop: 11, lineHeight: 1.65 }}>
        Ranked by what the next step actually buys: how strong the brawler is on the maps in rotation
        now, how much you have already sunk into it, and whether your maxed roster is short of that
        role. We can see your power levels, star powers, gadgets, gears and buffies — we cannot see
        your coins or power points, so this is what is worth buying, not what you can afford today.
      </div>
    </div>
  );
}
