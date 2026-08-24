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
import { recommendUpgrades } from "./data/upgradeAdvisor";
import { BUFFIE_PACKS, BUFFIE_COST } from "./data/upgradeCosts";
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
  const [state, setState] = useState({ loading: true, picks: [], classes: [], saveAdvice: null, roster: [], error: null });

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
          setState({ loading: false, picks: [], classes: [], saveAdvice: null, error: "no_roster" });
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
        const { picks, classes, saveAdvice } = recommendUpgrades({ roster, intelligence, rotationStats, playedCounts });
        setState({ loading: false, picks, classes, saveAdvice, roster, error: null });
      } catch (e) {
        if (!cancelled) setState({ loading: false, picks: [], classes: [], saveAdvice: null, error: e.message });
      }
    })();
    return () => { cancelled = true; };
  }, [tag, rankedRows]);

  return state;
}


// What the player already owns on this brawler, stated as fact rather than left
// to the prose. The reasoning below mentions only what drives the score, which
// meant a brawler with both gadgets could be described purely in terms of its
// buffies — true, but it read as though the gadgets weren't noticed.
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
            fontFamily: MONO, fontSize: 9.5, padding: "3px 8px", borderRadius: 999,
            background: full ? "rgba(142,230,176,.10)" : it.have > 0 ? "rgba(255,255,255,.05)" : "transparent",
            border: `1px solid ${full ? "rgba(142,230,176,.28)" : "rgba(255,255,255,.10)"}`,
            color: full ? "#8ee6b0" : it.have > 0 ? "#c9c9d6" : "#5a5a6a",
          }}>{it.label} {it.have}/{it.of}</span>
        );
      })}
      <span style={{
        fontFamily: MONO, fontSize: 9.5, padding: "3px 8px", borderRadius: 999,
        background: owned.hyper ? "rgba(142,230,176,.10)" : "transparent",
        border: `1px solid ${owned.hyper ? "rgba(142,230,176,.28)" : "rgba(255,143,143,.24)"}`,
        color: owned.hyper ? "#8ee6b0" : "#ff8f8f",
      }}>{owned.hyper ? "HYPERCHARGE ✓" : "NO HYPERCHARGE"}</span>
    </div>
  );
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
            <span style={{ fontFamily: MONO, fontSize: 9.5, color: "#5a5a6a" }}>
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
function BuffiePacks({ roster }) {
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
      <div style={{ fontFamily: MONO, fontSize: 9, letterSpacing: 1.6, color: "#6f7180", marginBottom: 9 }}>
        BUFFIE PACKS — {BUFFIE_COST.pp.toLocaleString("en-US")} POWER POINTS + {BUFFIE_COST.coins.toLocaleString("en-US")} GOLD PER DRAW
      </div>
      <div style={{ display: "grid", gap: 5 }}>
        {rows.map(r => (
          <div key={r.name} style={{
            display: "grid", gridTemplateColumns: "minmax(0,1fr) auto auto", gap: 10, alignItems: "center",
            fontFamily: MONO, fontSize: 10.5,
            color: r.missing === 0 ? "#5a5a6a" : "#c9c9d6",
          }}>
            <span>{r.name}
              <span style={{ color: "#5a5a6a" }}> · {r.brawlers.map(n => n[0] + n.slice(1).toLowerCase()).join(", ")}</span>
            </span>
            <span style={{ color: r.missing === 0 ? "#5a5a6a" : "#ffce7a" }}>{r.held}/9</span>
            <span style={{ color: "#5a5a6a", minWidth: 54, textAlign: "right" }}>
              {r.missing === 0 ? "full" : `${r.missing} open`}
            </span>
          </div>
        ))}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 10, color: "#5a5a6a", marginTop: 9, lineHeight: 1.6 }}>
        {open.length === 0
          ? "Every pack is full — buffie draws have nothing left to give you until the next wave."
          : `A draw returns one random buffie from the pack you buy, skipping ones you already hold, so a fuller pack is better odds on what's left. ${7 - open.length} of 7 packs are already complete.`}
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
  const { loading, picks, classes, saveAdvice, roster, error } = useAdvice(tag, rankedRows);

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
    // Only when there is genuinely nothing left to buy on any brawler.
    return <div style={{ fontFamily: MONO, fontSize: 11, color: "#6f7180", padding: "8px 2px 18px" }}>
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
          <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: 1.6, color: "#ffce7a", marginBottom: 6 }}>
            CONSIDER SAVING INSTEAD
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.65, color: "#e2d2b0" }}>{saveAdvice.text}</div>
        </div>
      )}
      {picks.slice(0, 5).map((p, i) => <Card key={p.name} p={p} rank={i + 1} />)}
      <RoleCoverage classes={classes} />
      <BuffiePacks roster={roster} />
      <div style={{ fontFamily: MONO, fontSize: 10, color: "#5a5a6a", marginTop: 11, lineHeight: 1.65 }}>
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
