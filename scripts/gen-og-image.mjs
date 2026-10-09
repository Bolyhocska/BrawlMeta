// ─── Social share card generator ─────────────────────────────────────────────
// Writes public/og.png (1200x630), the image every shared link renders.
//
// RUN BY HAND, NOT FROM `npm run build`, and the PNG is COMMITTED. The card is
// static, so generating it on every deploy would add a network fetch (Google
// Fonts) to the build for a file that never changes -- a new way for a deploy
// to fail in exchange for nothing. Re-run it only when the wording or design
// changes:  node scripts/gen-og-image.mjs
//
// NOT @vercel/og, which is the usual answer. That renders the card from a
// serverless function on each request, which means the one asset every shared
// link depends on acquires a runtime failure mode, and the result cannot be
// looked at before shipping. A committed PNG is served from the CDN, costs
// nothing, and can be reviewed like any other file.
//
// satori renders text to SVG PATHS using a font buffer passed in, so resvg
// never needs a font installed on the machine -- which is the whole problem
// with rasterising an SVG that names "Baloo 2" on a box that does not have it.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

const OUT = join(process.cwd(), "public", "og.png");
const W = 1200, H = 630;

const PURPLE = "#b36bff";
const BG = "#08080c";

/**
 * Google Fonts picks the file format from the User-Agent, and satori can read
 * ttf/otf/woff but NOT woff2. Measured 2026-10-09, same family, same request:
 *
 *   no User-Agent header  -> font/ttf    <- what we want
 *   old Safari 5          -> font/ttf
 *   old Chrome 27 / IE 9  -> font/woff
 *   MSIE 6                -> font/eot    <- not a font satori understands
 *   modern browser        -> font/woff2
 *
 * So send NO User-Agent. The widely-copied "use an ancient IE string" trick is
 * actively wrong here: it lands on EOT. Google also no longer emits a format()
 * hint or a .ttf extension, returning an extensionless /l/font?kit=... URL, so
 * the filename proves nothing and the BYTES are checked below instead.
 */
async function font(family, weight) {
  const css = await fetch(
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}`,
  ).then(r => r.text());
  const url = css.match(/url\((https:[^)]+)\)/)?.[1];
  if (!url) throw new Error(`no font url for ${family} ${weight}
${css}`);
  const data = await fetch(url).then(r => r.arrayBuffer());
  const magic = Buffer.from(data.slice(0, 4));
  const tag = magic.toString("latin1");
  const ok = tag === "OTTO" || tag === "true" || tag === "ttcf" || tag === "wOFF"
          || magic.readUInt32BE(0) === 0x00010000;
  if (!ok) {
    throw new Error(
      `${family} ${weight}: got ${tag === "wOF2" ? "woff2" : `${magic.toString("hex")} (eot?)`}, ` +
      `which satori cannot parse. Google changed what it serves for this request — ` +
      `re-probe the format/User-Agent table in the comment above.`);
  }
  return { name: family, weight, data, style: "normal" };
}

const el = (type, style, children) => ({ type, props: { style, children } });
const text = (s, style) => ({ type: "div", props: { style, children: s } });

const card = el("div", {
  width: W, height: H, display: "flex", flexDirection: "column",
  justifyContent: "center", background: BG, color: "#e9e9f2",
  padding: "0 78px", position: "relative",
  // The site's own backdrop: a faint purple grid on near-black.
  backgroundImage:
    "linear-gradient(rgba(179,107,255,.07) 1px, transparent 1px)," +
    "linear-gradient(90deg, rgba(179,107,255,.07) 1px, transparent 1px)",
  backgroundSize: "44px 44px",
}, [
  // eyebrow
  text("RANKED DRAFT INTELLIGENCE", {
    fontFamily: "JetBrains Mono", fontSize: 21, letterSpacing: 5,
    color: "#8a7fa6", marginBottom: 20,
  }),

  // wordmark
  el("div", { display: "flex", alignItems: "baseline" }, [
    text("Brawl", { fontFamily: "Baloo 2", fontSize: 112, fontWeight: 800, color: "#f4f4fa", lineHeight: 1 }),
    text("Apex",  { fontFamily: "Baloo 2", fontSize: 112, fontWeight: 800, color: PURPLE,   lineHeight: 1 }),
  ]),

  text("Draft assistant, tier list and map stats for Brawl Stars Ranked — measured, not guessed.", {
    fontFamily: "Chakra Petch", fontSize: 33, color: "#c9c9d6",
    marginTop: 22, maxWidth: 900, lineHeight: 1.35,
  }),

  // The credibility strip. Real numbers, because the whole pitch of the site
  // is that its numbers are measured -- a card making a vague claim would be
  // the one place that stops being true.
  el("div", { display: "flex", marginTop: 44, alignItems: "center" }, [
    ...[
      ["1.5M", "RANKED MATCHES"],
      ["107",  "BRAWLERS"],
      ["33",   "MAPS"],
    ].flatMap(([v, k], i) => [
      ...(i ? [el("div", {
        width: 1, height: 46, background: "rgba(255,255,255,.13)", margin: "0 34px", display: "flex",
      }, [])] : []),
      el("div", { display: "flex", flexDirection: "column" }, [
        text(v, { fontFamily: "Baloo 2", fontSize: 46, fontWeight: 800, color: PURPLE, lineHeight: 1 }),
        text(k, { fontFamily: "JetBrains Mono", fontSize: 15, letterSpacing: 2.4, color: "#8b8b9c", marginTop: 7 }),
      ]),
    ]),
  ]),

  // free-forever line: the single most differentiating fact about the site
  text("Free. No account needed.", {
    fontFamily: "JetBrains Mono", fontSize: 19, letterSpacing: 1.6,
    color: "#8ee6b0", marginTop: 42,
  }),

  // accent rule down the left edge
  el("div", {
    position: "absolute", left: 0, top: 0, bottom: 0, width: 10,
    display: "flex", background: PURPLE,
  }, []),
]);

console.log("fetching fonts…");
const fonts = await Promise.all([
  font("Baloo 2", 800),
  font("Chakra Petch", 500),
  font("JetBrains Mono", 500),
]);

console.log("rendering…");
const svg = await satori(card, { width: W, height: H, fonts });
const png = new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng();
writeFileSync(OUT, png);
console.log(`og.png: ${W}x${H}, ${(png.length / 1024).toFixed(0)} kB -> public/og.png`);
