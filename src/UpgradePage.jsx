// ─── /upgrade — "what should I upgrade next?", in full ────────────────────────
// Split out of the profile page because the answer is not one list. You know
// the map, and therefore the MODE, before you draft, and a rotation-wide
// average hides that completely: Nori is 63.8% in Heist and ~48% everywhere
// else, so flat he reads as an ordinary 53.5% brawler. And a comp needs
// complementary ROLES, so "which Control brawler next" is a real question the
// overall list never answers directly.
//
// Both views run the same scoring as the overall list — see `rank` in
// data/upgradeAdvisor.js — so a brawler cannot be first here and missing there
// for reasons the reader cannot see. They differ only in what counts as strong
// (win rate in that mode) and what counts as a hole (a role the meta actually
// drafts in that mode).

import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import SiteHeader from "./SiteHeader";
import { supabase, useSmartBack, CURRENT_PATCH, formatBrawlerName } from "./appCore";
import { useAuth } from "./auth";
import { useAdvice, Card, RoleCoverage, BuffiePacks, MONO, DISPLAY } from "./UpgradeAdvisor";
import { classLabel } from "./data/draftEngine";
import { READY_WIN_RATE } from "./data/upgradeAdvisor";

const MODE_LABEL = {
  gemGrab: "Gem Grab", brawlBall: "Brawl Ball", heist: "Heist",
  knockout: "Knockout", bounty: "Bounty", hotZone: "Hot Zone",
  duels: "Duels", basketBrawl: "Basket Brawl", brawlBall5v5: "Brawl Ball 5v5",
};
const modeName = (m) => MODE_LABEL[m] || m;

function Tabs({ items, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
      {items.map(it => {
        const on = it.key === value;
        return (
          <button key={it.key} type="button" onClick={() => onChange(it.key)} style={{
            fontFamily: MONO, fontSize: 10.5, letterSpacing: .4, cursor: "pointer",
            padding: "7px 13px", borderRadius: 999,
            background: on ? "rgba(154,143,192,.18)" : "rgba(255,255,255,.03)",
            border: `1px solid ${on ? "rgba(154,143,192,.55)" : "rgba(255,255,255,.09)"}`,
            color: on ? "#c9bfe8" : "#9a9aab",
          }}>
            {it.label}
            {it.hint != null && (
              <span style={{ color: on ? "#9a8fc0" : "#7c7e8f", marginLeft: 7 }}>{it.hint}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function SectionHead({ eyebrow, children }) {
  return (
    <>
      <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 2, color: "#8b8b9c", margin: "26px 0 8px" }}>
        {eyebrow}
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.65, color: "#9a9aab", marginBottom: 14 }}>{children}</div>
    </>
  );
}

export default function UpgradePage() {
  const { user, profile, loading: authLoading, openAuth } = useAuth();
  const navigate = useNavigate();
  const back = useSmartBack("/profile", "My Profile");
  const myTag = profile?.player_tag || null;

  const [ranked, setRanked] = useState([]);
  useEffect(() => {
    if (!myTag) return;
    let off = false;
    (async () => {
      const { data } = await supabase.from("player_matches")
        .select("brawler_id").eq("player_tag", myTag).limit(400);
      if (!off) setRanked(data || []);
    })();
    return () => { off = true; };
  }, [myTag]);

  const adv = useAdvice(myTag, ranked);
  const { loading, picks, classes, byMode, byClass, modeFreq, builtNames, strongNames,
          saveAdvice, roster, intel, error, statsError } = adv;

  const modes = useMemo(
    () => Object.keys(byMode || {}).sort((a, b) => (modeFreq[b] || 0) - (modeFreq[a] || 0)),
    [byMode, modeFreq]);
  // Which of the overall top 5 a per-mode list is merely repeating.
  const overallTop = useMemo(
    () => new Map(picks.slice(0, 5).map((p, i) => [p.name, i + 1])), [picks]);

  const [mode, setMode] = useState(null);
  const [cls, setCls] = useState(null);
  useEffect(() => { if (!mode && modes.length) setMode(modes[0]); }, [modes, mode]);
  useEffect(() => { if (!cls && classes.length) setCls(classes[0].cls); }, [classes, cls]);

  const shell = (body) => (
    <div style={{ minHeight: "100vh", background: "#0b0b10" }}>
      <SiteHeader />
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "22px 18px 70px" }}>
        <button type="button" onClick={back.goBack} style={{
          fontFamily: MONO, fontSize: 11, color: "#9a8fc0", background: "none",
          border: "none", cursor: "pointer", padding: "4px 0", marginBottom: 12,
        }}>← {back.label}</button>
        {body}
      </div>
    </div>
  );

  if (!authLoading && !user) {
    return shell(
      <div style={{ fontSize: 14, lineHeight: 1.7, color: "#c9c9d6" }}>
        <h1 style={{ fontFamily: DISPLAY, fontSize: 26, fontWeight: 800, color: "#e9e9f2", margin: "0 0 8px" }}>
          What to upgrade next
        </h1>
        <p style={{ color: "#9a9aab" }}>
          Sign in and add your player tag, and this reads your actual roster to work out which
          upgrades are worth the coins — overall, per mode, and per role.
        </p>
        <button type="button" onClick={openAuth} style={{
          fontFamily: MONO, fontSize: 12, padding: "10px 18px", borderRadius: 10, cursor: "pointer",
          background: "rgba(154,143,192,.18)", border: "1px solid rgba(154,143,192,.5)", color: "#c9bfe8",
        }}>Sign in</button>
      </div>
    );
  }
  if (!authLoading && user && !myTag) {
    return shell(
      <div style={{ fontSize: 14, lineHeight: 1.7, color: "#c9c9d6" }}>
        <h1 style={{ fontFamily: DISPLAY, fontSize: 26, fontWeight: 800, color: "#e9e9f2", margin: "0 0 8px" }}>
          What to upgrade next
        </h1>
        <p style={{ color: "#9a9aab" }}>Add your player tag on your profile and this fills in.</p>
        <button type="button" onClick={() => navigate("/profile")} style={{
          fontFamily: MONO, fontSize: 12, padding: "10px 18px", borderRadius: 10, cursor: "pointer",
          background: "rgba(154,143,192,.18)", border: "1px solid rgba(154,143,192,.5)", color: "#c9bfe8",
        }}>Go to profile</button>
      </div>
    );
  }

  return shell(
    <>
      <h1 style={{ fontFamily: DISPLAY, fontSize: 28, fontWeight: 800, color: "#e9e9f2", margin: "0 0 6px" }}>
        What to upgrade next
      </h1>
      <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "#8b98ad", margin: "0 0 8px", maxWidth: 620 }}>
        Your own brawlers, sorted by how much your next upgrade would actually help you win.
      </p>
      <div style={{ fontFamily: MONO, fontSize: 11, color: "#8b8b9c", marginBottom: 20 }}>
        {myTag} · patch {CURRENT_PATCH} · Masters data
      </div>

      {loading && (
        <div style={{ fontFamily: MONO, fontSize: 11, color: "#8b8b9c" }}>Reading your roster…</div>
      )}
      {!loading && error === "no_roster" && (
        <div style={{ fontFamily: MONO, fontSize: 11, color: "#8b8b9c" }}>
          Couldn't read your roster from the Brawl Stars API just now — try again shortly.
        </div>
      )}

      {!loading && !error && picks.length > 0 && (
        <>
          {saveAdvice && (
            <div style={{
              padding: "14px 16px", borderRadius: 12, marginBottom: 16,
              background: "rgba(255,180,61,.08)", border: "1px solid rgba(255,180,61,.28)",
            }}>
              <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 1.6, color: "#ffce7a", marginBottom: 6 }}>
                CONSIDER SAVING INSTEAD
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.65, color: "#e2d2b0" }}>{saveAdvice.text}</div>
            </div>
          )}

          <SectionHead eyebrow="[ OVERALL — TOP 5 ]">
            Ranked by what the next step buys per coin across the whole rotation.
          </SectionHead>
          {picks.slice(0, 5).map((p, i) => <Card key={p.name} p={p} rank={i + 1} />)}

          <SectionHead eyebrow="[ BY MODE — TOP 5 EACH ]">
            You know the map, and so the mode, before you draft — so the answer changes per mode,
            and the rotation-wide average hides it. Each list scores brawlers on their win rate in
            that mode, and counts a role as missing only when the meta actually drafts that role
            there.
          </SectionHead>
          {modes.length === 0 && (
            <div style={{
              fontFamily: MONO, fontSize: 11, lineHeight: 1.7, color: "#ffce7a",
              padding: "11px 13px", borderRadius: 10, marginBottom: 12,
              background: "rgba(255,180,61,.07)", border: "1px solid rgba(255,180,61,.26)",
            }}>
              The per-mode split couldn't be loaded just now, so this section and the role
              counts below fall back to patch-wide numbers. The top 5 above is unaffected.
              Reloading usually fixes it.
              {statsError && <span style={{ display: "block", color: "#8a8a9c", marginTop: 5 }}>{statsError}</span>}
            </div>
          )}
          <Tabs value={mode} onChange={setMode}
            items={modes.map(m => ({ key: m, label: modeName(m),
              hint: `${Math.round((modeFreq[m] || 0) * 100)}%` }))} />
          {mode && (() => {
            const list = (byMode[mode] || []).slice(0, 5);
            const fresh = list.filter(p => !overallTop.has(p.name));
            return (
              <>
                {/* Measured on a real roster: six mode lists of five held only
                    twelve distinct brawlers — 66% of the slots were repeats, and
                    three modes added nothing at all. So the useful thing to say
                    first is what this mode adds that the overall plan misses. */}
                <div style={{
                  fontFamily: MONO, fontSize: 10.5, lineHeight: 1.7, color: "#8a8a9c",
                  padding: "9px 12px", borderRadius: 10, marginBottom: 11,
                  background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.07)",
                }}>
                  {fresh.length === 0
                    ? `Nothing new here — all five are already in your overall top 5. ${modeName(mode)} needs no separate plan.`
                    : `${fresh.length} of these 5 are specific to ${modeName(mode)}: ${fresh.map(p => formatBrawlerName(p.name)).join(", ")}.`}
                </div>
                {list.map((p, i) => (
                  <Card key={`${mode}-${p.name}`} p={p} rank={i + 1}
                    note={overallTop.has(p.name)
                      ? { tone: "dup", text: `#${overallTop.get(p.name)} OVERALL` }
                      : { tone: "new", text: `${modeName(mode).toUpperCase()} ONLY` }} />
                ))}
              </>
            );
          })()}

          <SectionHead eyebrow="[ BY ROLE — TOP 5 EACH ]">
            The same ranking, filtered to one role — for when you already know the hole you are
            trying to fill. Counts are what you can field: {READY_WIN_RATE}%+ is a separate,
            smaller question.
          </SectionHead>
          <Tabs value={cls} onChange={setCls}
            items={classes.map(c => ({ key: c.cls, label: c.label, hint: `${c.built} built` }))} />
          {cls && (byClass[cls] || []).slice(0, 5).map((p, i) => (
            <Card key={`${cls}-${p.name}`} p={p} rank={i + 1} />
          ))}
          {cls && !(byClass[cls] || []).length && (
            <div style={{ fontFamily: MONO, fontSize: 11, color: "#8b8b9c", padding: "6px 2px 16px" }}>
              Nothing left to buy on any {classLabel(cls)} brawler you own.
            </div>
          )}

          <SectionHead eyebrow="[ YOUR BRAWLERS ]">
            Everything you own, grouped by the role it plays in a draft. Click any brawler for its
            details.
          </SectionHead>
          <RoleCoverage classes={classes} roster={roster} picks={picks} intel={intel}
            builtNames={builtNames} strongNames={strongNames} />

          <BuffiePacks roster={roster} />

          <div style={{ fontFamily: MONO, fontSize: 10, color: "#7c7e8f", marginTop: 16, lineHeight: 1.65 }}>
            Levelling always targets power 11, because ranked only allows power-11 brawlers from
            Mythic upward. Gear prices assume the cheap tier — epic and mythic gears cost more and
            the API doesn't tell us which you'd get. We can see power levels, star powers, gadgets,
            gears, buffies and hypercharges; we cannot see your coin or power-point balance, so this
            is what's worth buying, not what you can afford today. A brawler whose hypercharge has
            not been released yet reads the same as one whose hypercharge you simply have not
            bought — the API does not distinguish them.
          </div>
        </>
      )}
    </>
  );
}
