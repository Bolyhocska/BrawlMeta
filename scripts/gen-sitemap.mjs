// ─── Build-time sitemap generator ────────────────────────────────────────────
// Runs as part of `npm run build` and writes dist/sitemap.xml.
//
// WHY IT IS GENERATED AND NOT HAND-WRITTEN. The site is ~160 URLs, almost all
// of them derived: one page per brawler, one per map, one per news post. A
// hand-maintained list is wrong the day a brawler is released, and a sitemap
// full of 404s is worse than no sitemap — it is a direct quality signal to a
// crawler that the site does not know its own shape.
//
// FAIL-SOFT IS DELIBERATE. Brawlers and the static routes come from local
// files and can never fail. Maps and news posts need the database, so they are
// fetched with the anon key and a short timeout, and ANY failure drops just
// that section with a warning rather than failing the build. A deploy must
// never break because a sitemap could not be fully enumerated — losing the map
// URLs for one deploy costs almost nothing; a red build costs the deploy.
//
// The URLs must match the real routes in App.jsx and the real slug helpers.
// They are duplicated here rather than imported because this is plain Node
// running before the bundler, and importing the app's module graph (JSX, CSS,
// supabase client) to get two one-line functions is not worth it. If either
// slug rule changes in src/, change it here too — a mismatch shows up as
// indexed 404s, which is silent.

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ORIGIN = "https://brawl-meta.vercel.app";
const OUT = join(process.cwd(), "dist", "sitemap.xml");

// Mirrors slugifyBrawlerKey in src/BrawlersPage.jsx
const slugifyBrawlerKey = (k) =>
  k.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
// Mirrors mapSlug in src/MapsPages.jsx
const mapSlug = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** priority/changefreq are hints only; keep them honest rather than all 1.0. */
const urls = [];
const add = (path, priority, changefreq) =>
  urls.push({ loc: ORIGIN + path, priority, changefreq });

// ── static routes ────────────────────────────────────────────────────────────
// Deliberately absent: /profile, /tournaments/profile, /tournaments/create,
// /player/:tag and anything /manage. Account pages, auth-gated pages, and the
// player profiles we are choosing not to index (see public/robots.txt).
add("/",                 1.0, "daily");
add("/app",              0.9, "daily");    // tier list / leaderboards / draft
add("/maps",             0.9, "daily");
add("/guides",           0.8, "weekly");
add("/guides/brawlers",  0.8, "weekly");
add("/guides/modes",     0.8, "weekly");
add("/guides/skills",    0.7, "monthly");
add("/guides/modes/heist/safe-zone", 0.6, "monthly");
add("/news",             0.8, "daily");
add("/upgrade",          0.7, "weekly");
add("/tournaments",      0.6, "weekly");
add("/scrims",           0.5, "weekly");
add("/about",            0.3, "yearly");
add("/privacy",          0.3, "yearly");

// ── brawlers (local, cannot fail) ────────────────────────────────────────────
try {
  const meta = JSON.parse(readFileSync("src/data/brawlerMeta.json", "utf8"));
  let n = 0;
  for (const [key, b] of Object.entries(meta)) {
    // released === false is the "announced but not in Ranked yet" marker. Its
    // page renders, but there is nothing measured to put on it, so indexing it
    // just buys a thin page.
    if (b?.released === false) continue;
    add(`/brawlers/${slugifyBrawlerKey(key)}`, 0.7, "weekly");
    n++;
  }
  console.log(`  brawlers: ${n}`);
} catch (e) {
  console.warn(`  ! brawlers skipped: ${e.message}`);
}

// ── mode guides (local, cannot fail) ─────────────────────────────────────────
try {
  const src = readFileSync("src/GuidesPages.jsx", "utf8");
  const block = src.slice(src.indexOf("export const MODE_GUIDES = {"));
  const ids = [...block.slice(0, block.indexOf("\n};")).matchAll(/^\s{2}(\w+):\s*\{/gm)]
    .map(m => m[1]);
  ids.forEach(id => add(`/guides/modes/${id}`, 0.7, "monthly"));
  console.log(`  mode guides: ${ids.length}`);
} catch (e) {
  console.warn(`  ! mode guides skipped: ${e.message}`);
}

// ── maps + news (database, fail-soft) ────────────────────────────────────────
const SB_URL = process.env.VITE_SUPABASE_URL;
const SB_KEY = process.env.VITE_SUPABASE_KEY;

async function sb(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

if (SB_URL && SB_KEY) {
  try {
    const maps = await sb("maps?select=name&order=name");
    const seen = new Set();
    for (const m of maps) {
      const s = mapSlug(m.name);
      if (s && !seen.has(s)) { seen.add(s); add(`/maps/${s}`, 0.8, "daily"); }
    }
    console.log(`  maps: ${seen.size}`);
  } catch (e) {
    console.warn(`  ! maps skipped (build continues): ${e.message}`);
  }
  try {
    const posts = await sb("news_posts?select=slug,published_at&order=published_at.desc&limit=500");
    let n = 0;
    for (const p of posts) {
      if (!p.slug) continue;
      add(`/news/${p.slug}`, 0.6, "monthly");
      n++;
    }
    console.log(`  news posts: ${n}`);
  } catch (e) {
    console.warn(`  ! news skipped (build continues): ${e.message}`);
  }
} else {
  console.warn("  ! VITE_SUPABASE_URL/KEY not set — maps and news omitted");
}

// ── write ────────────────────────────────────────────────────────────────────
if (!existsSync("dist")) {
  console.error("dist/ does not exist — run this AFTER vite build.");
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const xml =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls.map(u =>
    `  <url>\n` +
    `    <loc>${u.loc}</loc>\n` +
    `    <lastmod>${today}</lastmod>\n` +
    `    <changefreq>${u.changefreq}</changefreq>\n` +
    `    <priority>${u.priority.toFixed(1)}</priority>\n` +
    `  </url>`
  ).join("\n") +
  `\n</urlset>\n`;

writeFileSync(OUT, xml, "utf8");
console.log(`sitemap.xml: ${urls.length} URLs -> dist/sitemap.xml`);
