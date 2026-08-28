// ─── Lane playstyle ──────────────────────────────────────────────────────────
// The written half of a lane matchup: the build your brawler should hold the
// lane with, and how to actually play the specific brawler standing across
// from you.
//
// Two sources, and the split is the point. The BUILD comes from brawlerTips.js
// — hand-written, mode-specific, and present only for brawlers someone
// actually wrote up. The PLAN comes from the ENEMY's counterTips, which is
// literally "how to beat this brawler" and is therefore exactly the advice the
// player in this lane needs. Nothing is generated to fill a gap.
//
// brawlerTips.js states the rule this file follows: "an absent section is
// honest, a generic one pretends to know something." So a brawler with no
// guide gets its class game plan, labelled as class-level, and NO gadget or
// star-power pick at all. Recommending a loadout we have never evaluated —
// when the whole point of the panel is "run this build" — would be worse than
// saying nothing, and the reader has no way to tell the two apart.

import { getBrawlerGuide } from "./brawlerTips";
import { getExtendedGuide } from "./extendedGuides";

const norm = (k) => (k || "").toUpperCase().trim();

export function getLanePlaystyle({ mine, enemy, mode }) {
  const me = norm(mine), foe = norm(enemy);
  const myGuide = getBrawlerGuide(me);
  const foeGuide = getBrawlerGuide(foe);

  // Prefer the build written for THIS mode; fall back to the General tab. The
  // flag is kept so the UI can say which one it is — "the Heist build" and
  // "the all-purpose build" are different promises.
  let build = null;
  if (myGuide?.builds) {
    const forMode = mode ? myGuide.builds[mode] : null;
    const b = forMode || myGuide.builds.General || null;
    if (b) build = { ...b, forMode: Boolean(forMode) };
  }

  const ext = getExtendedGuide(me);

  return {
    covered: Boolean(myGuide),
    build,
    // What your brawler wants out of this mode, if we wrote it down.
    modeNote: (mode && myGuide?.modeNotes?.[mode]) || null,
    // How to beat the brawler across from you, in the guide author's words.
    // Stripped to text — the clips belong on the guide page, not mid-draft.
    vsPlan: (foeGuide?.counterTips || []).slice(0, 2).map(t => ({ lead: t.lead, rest: t.rest })),
    vsCovered: Boolean(foeGuide),
    // Only used when your brawler has no written guide.
    classPlan: myGuide ? null : (ext?.gameplan?.[0] || null),
    classOf: ext?.class || null,
  };
}
