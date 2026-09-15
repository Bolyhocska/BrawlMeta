# ─── News digest: our own measured data, two INDEPENDENT triggers ───────────
#
# Writes DIRECTLY to news_posts, unlike news_watch.py — no review queue, no
# GitHub issue. That is deliberate and safe here specifically: the content is
# our own win-rate numbers, the same trust level as the tier list, never a
# websearch result that could be describing something that never happened.
# There is no fabrication risk to guard against, so TEXT IS TEMPLATED, not
# LLM-generated: Python string formatting cannot misstate a number the way an
# LLM asked to "write a nice paragraph" conceivably could, even from real data.
#
# TWO CONTENT TYPES, TWO SCHEDULES, DELIBERATELY NOT COMPETING FOR ONE SLOT
# (owner correction, 2026-09-15 — an earlier version tried patch-impact first
# and only fell through to the recurring post if it didn't fire, which meant
# a patch impact post could silently swallow that week's meta snapshot):
#
#   patch  — `python -m scrapers.news_digest patch`, run DAILY
#     (news-patch-impact.yml). Fires ONCE per patch: the first run where the
#     patch is old enough and enough brawlers clear the sample floor against
#     the previous patch. Every other day it's a silent no-op, same as
#     news_watch.py — checking daily and firing rarely is the same "usually
#     nothing, that's fine" pattern, not "once per update" happening to mean
#     "runs once".
#
#   meta   — `python -m scrapers.news_digest meta`, run WEEKLY
#     (news-meta-snapshot.yml, Mondays). EIGHT sections, each independently
#     gated on its own sample floor and each OMITTED (not forced) if it can't
#     clear that floor — same "say nothing rather than force it" discipline
#     as everywhere else in this pipeline. Only standings gates the post:
#       - standings   : strongest/weakest brawlers right now
#       - shifters    : week-over-week win-rate movers (meta_daily diff)
#       - classes     : which draft classes are most picked right now
#       - modes       : brawlers whose win rate swings hardest between their
#         best and worst mode — Nori is a heist monster and nearly unplayable
#         in knockout, and no patch-wide number says so.
#       - unusual     : a brawler's win rate on ONE map deviating hard from
#         their own overall rate. Floored at >=300 games on BOTH the map cell
#         and the brawler's overall sample, which is the exact guard that was
#         missing when a 34-game Angelo cell on Beach Ball read as 67.4% and
#         topped that map's chart — this is deliberately the same shape of
#         claim, so it gets the same protection from day one.
#       - ranks       : Masters+ against Diamond/Mythic, i.e. the brawlers a
#         player is most likely misjudging from their own rank.
#       - synergies   : best duo pairs by EXCESS over solo rates, never raw
#         duo win rate.
#       - counters    : most lopsided matchups by RESIDUAL after removing the
#         solo-strength difference, never raw head-to-head.
#
# THE LAST TWO SHARE ONE RULE AND TWO DIFFERENT COEFFICIENTS. Both subtract
# what raw brawler strength already explains, because otherwise each list just
# re-reports "strong brawlers are strong" — but the coefficient is NOT the same
# for the two, and CLAUDE.md has it measured: 1.004 for head-to-head (so
# counters use plain subtraction) and 0.508 for duo synergy (so synergies use
# the pair's solo MEAN instead). Assuming one number for both has produced a
# confidently wrong answer in this project twice already.
#
# meta_daily (used for `shifters`) IS A CUMULATIVE SNAPSHOT, NOT A DAILY
# DELTA — capture_meta_history in common.py writes "the freshly-rebuilt
# BrawlerStats" each day, i.e. the patch-to-date total as of that day.
# Summing several days' rows sums overlapping totals and wildly overcounts
# (caught before shipping the first version of this: summing 7 days gave
# NORI 6.16 million "picks" against far less total site volume). Every query
# here DIFFS two snapshot days instead — never sums a range.

import re
import sys
import requests
from datetime import datetime, timedelta, timezone

from scrapers.common import (
    require_credentials, SUPABASE_URL, SUPABASE_HEADERS, CURRENT_PATCH, PATCH_START_TIMES,
)

BRACKET = "masters_legendary"

# Per-brawler floor for the patch-impact comparison, in EACH patch being
# compared — consistent with every other "is this sample trustworthy" gate in
# this project (confidencePriorGames / minRecentPicks sit in the same
# neighbourhood in draft_logic_config.json).
PATCH_IMPACT_MIN_PICKS = 300
PATCH_IMPACT_MIN_DAYS = 3          # don't compare against a patch <3 days old
PATCH_IMPACT_MIN_MOVERS = 3        # skip the post if fewer than this many brawlers qualify
PATCH_IMPACT_TOP_N = 6

# Floor for the weekly snapshot — same 300-game neighbourhood, applied to
# brawler_intelligence.picks (patch-to-date, not a 7-day slice).
META_MIN_PICKS = 300
META_TOP_N = 8
META_BOTTOM_N = 4

# Week-over-week shifters (meta_daily diff) — per-brawler floor on EACH side
# of the 7-day split, same neighbourhood as everywhere else in this project.
SHIFTERS_MIN_PICKS = 1000
SHIFTERS_TOP_N = 5

# Best duo synergies — floor on the PAIR's own sample, not either brawler's
# overall sample (a pair can be well-measured even if one side is a niche
# pick elsewhere).
SYNERGY_MIN_PICKS = 300
SYNERGY_TOP_N = 5

# Unusual map cells — floored on BOTH the map cell's sample and the brawler's
# overall sample. This is the exact guard that was missing when a 34-game
# Angelo cell on Beach Ball read as 67.4% and topped that map's chart.
UNUSUAL_MIN_MAP_PICKS = 300
UNUSUAL_MIN_OVERALL_PICKS = 300
UNUSUAL_TOP_N = 5

# Mode specialists — a brawler's best mode against its worst. Needs a real
# sample in EACH mode compared, and enough modes present that the swing isn't
# just two thin readings at opposite ends of the noise.
MODE_MIN_PICKS = 2000
MODE_MIN_MODES = 4
MODE_MIN_SWING = 8.0
MODE_TOP_N = 4

# Rank-bracket divergence — Masters+ against Diamond/Mythic.
RANK_MIN_PICKS = 1000
RANK_MIN_GAP = 5.0
RANK_TOP_N = 4

# Hardest counters. The edge is the RESIDUAL after removing raw strength:
# a strong brawler beating a weak one is not a counter, it is just the
# stronger brawler. The strength coefficient is 1.0 by measurement, not by
# assumption — CLAUDE.md records it as 1.004 for head-to-head (against 0.508
# for duo synergy, which is why that section cannot use the same subtraction).
COUNTER_MIN_PICKS = 2000
COUNTER_MIN_RESIDUAL = 5.0
COUNTER_TOP_N = 5


def sb_get(table, params):
    res = requests.get(f"{SUPABASE_URL}/rest/v1/{table}", headers=SUPABASE_HEADERS, params=params, timeout=60)
    res.raise_for_status()
    return res.json()


def sb_insert(table, row):
    res = requests.post(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers={**SUPABASE_HEADERS, "Prefer": "return=representation"},
        json=row, timeout=30,
    )
    res.raise_for_status()
    return res.json()[0]


def slugify(title):
    s = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return f"{s}-{datetime.now(timezone.utc).strftime('%Y%m%d')}"


def fmt_pp(delta):
    return f"+{delta:.1f}" if delta >= 0 else f"{delta:.1f}"


def brawler_name(raw):
    """Title-case for prose. Matches the frontend's own hyphen-aware
    capitalization (formatBrawlerName in appCore.js) closely enough for a
    summary paragraph: Python's str.title() already capitalizes after a
    hyphen, so 'JAE-YONG' -> 'Jae-Yong' and 'EL PRIMO' -> 'El Primo'."""
    return raw.title()


# ── Patch impact (daily check, fires once per patch) ─────────────────────────

def prior_patch_of(patch):
    """The patch immediately before `patch` in PATCH_START_TIMES, skipping the
    catch-all floor entry. None if `patch` is the earliest real patch."""
    names = [n for n, start in PATCH_START_TIMES if start.year >= 2020]
    if patch not in names:
        return None
    i = names.index(patch)
    return names[i - 1] if i > 0 else None


def days_since_patch_start(patch):
    for name, start in PATCH_START_TIMES:
        if name == patch:
            return (datetime.now(timezone.utc) - start).total_seconds() / 86400
    return None


def already_posted_patch_impact(patch):
    rows = sb_get("news_posts", {
        "select": "id", "source": "eq.internal_stats", "patch": f"eq.{patch}",
        "slug": "like.patch-impact-*", "limit": "1",
    })
    return bool(rows)


def run_patch_impact():
    age = days_since_patch_start(CURRENT_PATCH)
    if age is None or age < PATCH_IMPACT_MIN_DAYS:
        print(f"news_digest[patch]: skipped — {CURRENT_PATCH} is "
              f"{'unknown age' if age is None else f'{age:.1f}d old'}, needs {PATCH_IMPACT_MIN_DAYS}d.")
        return

    prior = prior_patch_of(CURRENT_PATCH)
    if not prior:
        print("news_digest[patch]: skipped — no prior patch to compare against.")
        return

    if already_posted_patch_impact(CURRENT_PATCH):
        print(f"news_digest[patch]: already posted for {CURRENT_PATCH} — nothing to do.")
        return

    cur_rows = sb_get("BrawlerStats", {
        "select": "brawler,picks,wins", "patch": f"eq.{CURRENT_PATCH}",
        "rank_bracket": f"eq.{BRACKET}", "map": "is.null",
    })
    prior_rows = sb_get("BrawlerStats", {
        "select": "brawler,picks,wins", "patch": f"eq.{prior}",
        "rank_bracket": f"eq.{BRACKET}", "map": "is.null",
    })
    prior_by_name = {r["brawler"]: r for r in prior_rows}

    movers = []
    for c in cur_rows:
        p = prior_by_name.get(c["brawler"])
        if not p or c["picks"] < PATCH_IMPACT_MIN_PICKS or p["picks"] < PATCH_IMPACT_MIN_PICKS:
            continue
        cur_wr = 100.0 * c["wins"] / c["picks"]
        prior_wr = 100.0 * p["wins"] / p["picks"]
        movers.append({"brawler": c["brawler"], "delta": cur_wr - prior_wr, "cur_wr": cur_wr, "prior_wr": prior_wr})

    movers.sort(key=lambda m: abs(m["delta"]), reverse=True)
    if len(movers) < PATCH_IMPACT_MIN_MOVERS:
        print(f"news_digest[patch]: skipped — only {len(movers)} brawlers clear "
              f"{PATCH_IMPACT_MIN_PICKS} games in both {CURRENT_PATCH} and {prior}.")
        return

    top = movers[:PATCH_IMPACT_TOP_N]
    lines = [
        f"{brawler_name(m['brawler'])} {fmt_pp(m['delta'])}pp ({m['prior_wr']:.1f}% → {m['cur_wr']:.1f}%)"
        for m in top
    ]
    summary = (
        f"{age:.0f} days into patch {CURRENT_PATCH}, here's what actually moved in Masters+ win rates "
        f"versus {prior} (minimum {PATCH_IMPACT_MIN_PICKS} games measured on both patches):\n\n"
        + "\n".join(f"• {l}" for l in lines)
    )

    post = sb_insert("news_posts", {
        "slug": f"patch-impact-{CURRENT_PATCH}",
        "title": f"Patch {CURRENT_PATCH}: measured impact so far",
        "summary": summary,
        "category": "balance",
        "patch": CURRENT_PATCH,
        "source": "internal_stats",
        "source_urls": [],
        "auto_generated": True,
        # Structured numbers for the detail page's chart — the rendered
        # `summary` text above is for the feed card and for anyone reading
        # via the API directly; this is for anything that needs to draw it.
        "data": {
            "priorPatch": prior,
            "minPicks": PATCH_IMPACT_MIN_PICKS,
            "movers": [
                {
                    "brawler": brawler_name(m["brawler"]), "delta": round(m["delta"], 1),
                    "priorWr": round(m["prior_wr"], 1), "curWr": round(m["cur_wr"], 1),
                }
                for m in top
            ],
        },
    })
    print(f"news_digest[patch]: published \"{post['slug']}\" ({len(top)} movers).")


# ── Section: week-over-week shifters ─────────────────────────────────────────

def latest_meta_day():
    rows = sb_get("meta_daily", {
        "select": "day", "patch": f"eq.{CURRENT_PATCH}", "rank_bracket": f"eq.{BRACKET}",
        "order": "day.desc", "limit": "1",
    })
    return rows[0]["day"] if rows else None


def meta_day_totals(day):
    """{brawler: {picks, wins}} summed across every map for one snapshot day."""
    out = {}
    offset = 0
    while True:
        rows = sb_get("meta_daily", {
            "select": "brawler,picks,wins", "patch": f"eq.{CURRENT_PATCH}",
            "rank_bracket": f"eq.{BRACKET}", "day": f"eq.{day}",
            "limit": "1000", "offset": str(offset),
        })
        if not rows:
            break
        for r in rows:
            a = out.setdefault(r["brawler"], {"picks": 0, "wins": 0})
            a["picks"] += r["picks"]
            a["wins"] += r["wins"]
        if len(rows) < 1000:
            break
        offset += 1000
    return out


def run_shifters():
    latest = latest_meta_day()
    if not latest:
        print("news_digest[meta]: shifters — no meta_daily snapshot yet, omitting.")
        return []

    latest_dt = datetime.strptime(latest, "%Y-%m-%d")
    week_ago = (latest_dt - timedelta(days=7)).strftime("%Y-%m-%d")
    now_totals = meta_day_totals(latest)
    week_ago_totals = meta_day_totals(week_ago)
    if not week_ago_totals:
        print(f"news_digest[meta]: shifters — no snapshot from {week_ago} (patch <7d old), omitting.")
        return []

    shifters = []
    for name, now in now_totals.items():
        before = week_ago_totals.get(name)
        if not before:
            continue
        d_picks = now["picks"] - before["picks"]
        d_wins = now["wins"] - before["wins"]
        if d_picks < SHIFTERS_MIN_PICKS or before["picks"] < SHIFTERS_MIN_PICKS:
            continue
        last7d_wr = 100.0 * d_wins / d_picks
        before_wr = 100.0 * before["wins"] / before["picks"]
        shifters.append({
            "brawler": brawler_name(name), "delta": round(last7d_wr - before_wr, 1),
            "beforeWr": round(before_wr, 1), "last7dWr": round(last7d_wr, 1),
        })
    shifters.sort(key=lambda m: abs(m["delta"]), reverse=True)
    return shifters[:SHIFTERS_TOP_N]


# ── Section: most-drafted classes ────────────────────────────────────────────

def run_class_distribution(intel_rows):
    """intel_rows is already floored at META_MIN_PICKS, so a class's total here
    only counts brawlers with a real sample — a class of niche picks cannot
    look artificially large just because it has many members."""
    brawler_rows = sb_get("brawlers", {"select": "id,name"})
    class_rows = sb_get("brawler_classes", {"select": "brawler_id,draft_class"})
    id_to_name = {r["id"]: r["name"].upper() for r in brawler_rows}
    name_to_class = {}
    for r in class_rows:
        nm = id_to_name.get(r["brawler_id"])
        if nm:
            name_to_class[nm] = r["draft_class"]

    totals = {}
    for r in intel_rows:
        cls = name_to_class.get(r["brawler"])
        if not cls:
            continue
        totals[cls] = totals.get(cls, 0) + r["picks"]

    grand_total = sum(totals.values())
    if not grand_total:
        return []
    out = [
        {"class": cls, "picks": picks, "sharePct": round(100.0 * picks / grand_total, 1)}
        for cls, picks in totals.items()
    ]
    out.sort(key=lambda r: r["picks"], reverse=True)
    return out


# ── Section: best duo synergies ──────────────────────────────────────────────

def run_best_synergies(intel_rows):
    """EXCESS over the pair's own solo rates, never raw duo win rate — raw
    conflates synergy with two brawlers each independently being strong,
    exactly the mistake the draft engine's own duo-synergy term was
    corrected for (see CLAUDE.md's calibration section). with_brawler is
    stored symmetrically (A's entry for B equals B's entry for A), so pairs
    are deduped by a sorted tuple key to avoid reporting each one twice."""
    wr_by_brawler = {r["brawler"]: r["true_win_rate"] for r in intel_rows}
    seen_pairs = set()
    results = []
    for r in intel_rows:
        a = r["brawler"]
        partners = r.get("with_brawler") or {}
        for b, stats in partners.items():
            if b not in wr_by_brawler:
                continue  # partner doesn't clear the same overall-sample floor
            picks = stats.get("picks", 0)
            duo_wr = stats.get("winRate")
            if picks < SYNERGY_MIN_PICKS or duo_wr is None:
                continue
            pair_key = tuple(sorted((a, b)))
            if pair_key in seen_pairs:
                continue
            seen_pairs.add(pair_key)
            excess = duo_wr - (wr_by_brawler[a] + wr_by_brawler[b]) / 2
            results.append({
                "a": brawler_name(a), "b": brawler_name(b),
                "excess": round(excess, 1), "duoWr": round(duo_wr, 1), "picks": picks,
            })
    results.sort(key=lambda x: x["excess"], reverse=True)
    return results[:SYNERGY_TOP_N]


# ── Shared: every per-map row for this patch/bracket ────────────────────────

def fetch_map_rows():
    """All brawler-map cells, paged. Fetched ONCE and shared by the unusual-map
    and mode-specialist sections — they need different slices of the same data
    (one filters to well-sampled single cells, the other sums every cell into
    mode totals), so filtering server-side for either would break the other."""
    out = []
    offset = 0
    while True:
        rows = sb_get("BrawlerStats", {
            "select": "brawler,map,mode,picks,wins", "patch": f"eq.{CURRENT_PATCH}",
            "rank_bracket": f"eq.{BRACKET}", "map": "not.is.null",
            "limit": "1000", "offset": str(offset),
        })
        if not rows:
            break
        out.extend(rows)
        if len(rows) < 1000:
            break
        offset += 1000
    return out


# ── Section: unusual map cells ───────────────────────────────────────────────

def run_unusual_map_cells(intel_rows, map_rows):
    """A brawler's win rate on ONE map deviating hard from their own overall
    rate. Floored at UNUSUAL_MIN_MAP_PICKS on the map cell AND
    UNUSUAL_MIN_OVERALL_PICKS on the brawler's overall sample — the exact
    guard that was missing when a 34-game Angelo cell on Beach Ball read as
    67.4% and topped that map's chart. This is deliberately the same shape
    of claim, so it gets the same protection from the start."""
    wr_by_brawler = {r["brawler"]: r["true_win_rate"] for r in intel_rows if r["picks"] >= UNUSUAL_MIN_OVERALL_PICKS}
    results = []
    for r in map_rows:
        if r["picks"] < UNUSUAL_MIN_MAP_PICKS:
            continue
        overall = wr_by_brawler.get(r["brawler"])
        if overall is None:
            continue
        map_wr = 100.0 * r["wins"] / r["picks"]
        results.append({
            "brawler": brawler_name(r["brawler"]), "map": r["map"],
            "mapWr": round(map_wr, 1), "overallWr": round(overall, 1),
            "deviation": round(map_wr - overall, 1), "picks": r["picks"],
        })
    results.sort(key=lambda x: abs(x["deviation"]), reverse=True)
    return results[:UNUSUAL_TOP_N]


# ── Section: mode specialists ────────────────────────────────────────────────

def run_mode_specialists(map_rows):
    """Brawlers whose win rate swings hardest between their best and worst
    mode — Nori is a heist monster and nearly unplayable in knockout, and
    nothing in a patch-wide win rate says so. Requires MODE_MIN_MODES modes
    each clearing MODE_MIN_PICKS, so a big swing can't come from two thin
    readings sitting at opposite ends of their own noise."""
    totals = {}
    for r in map_rows:
        if not r.get("mode"):
            continue
        key = (r["brawler"], r["mode"])
        a = totals.setdefault(key, {"picks": 0, "wins": 0})
        a["picks"] += r["picks"]
        a["wins"] += r["wins"]

    by_brawler = {}
    for (brawler, mode), v in totals.items():
        if v["picks"] < MODE_MIN_PICKS:
            continue
        by_brawler.setdefault(brawler, []).append({
            "mode": mode, "wr": 100.0 * v["wins"] / v["picks"], "picks": v["picks"],
        })

    results = []
    for brawler, modes in by_brawler.items():
        if len(modes) < MODE_MIN_MODES:
            continue
        modes.sort(key=lambda m: m["wr"], reverse=True)
        best, worst = modes[0], modes[-1]
        swing = best["wr"] - worst["wr"]
        if swing < MODE_MIN_SWING:
            continue
        results.append({
            "brawler": brawler_name(brawler), "swing": round(swing, 1),
            "bestMode": best["mode"], "bestWr": round(best["wr"], 1), "bestPicks": best["picks"],
            "worstMode": worst["mode"], "worstWr": round(worst["wr"], 1), "worstPicks": worst["picks"],
        })
    results.sort(key=lambda x: x["swing"], reverse=True)
    return results[:MODE_TOP_N]


# ── Section: rank-bracket divergence ─────────────────────────────────────────

def run_rank_divergence(intel_rows):
    """Brawlers that perform very differently in Masters+ than in
    Diamond/Mythic — i.e. the ones a player is most likely to be misjudging
    from their own rank. Both sides need RANK_MIN_PICKS, and the gap is
    reported as Masters MINUS Diamond, so a negative number means the brawler
    is better down there than up here."""
    other = sb_get("brawler_intelligence", {
        "select": "brawler,picks,true_win_rate", "patch": f"eq.{CURRENT_PATCH}",
        "rank_bracket": "eq.diamond_mythic", "picks": f"gte.{RANK_MIN_PICKS}",
    })
    other_by_name = {r["brawler"]: r for r in other}

    results = []
    for r in intel_rows:
        if r["picks"] < RANK_MIN_PICKS:
            continue
        d = other_by_name.get(r["brawler"])
        if not d:
            continue
        gap = r["true_win_rate"] - d["true_win_rate"]
        if abs(gap) < RANK_MIN_GAP:
            continue
        results.append({
            "brawler": brawler_name(r["brawler"]), "gap": round(gap, 1),
            "mastersWr": round(r["true_win_rate"], 1), "diamondWr": round(d["true_win_rate"], 1),
            "mastersPicks": r["picks"], "diamondPicks": d["picks"],
        })
    results.sort(key=lambda x: abs(x["gap"]), reverse=True)
    return results[:RANK_TOP_N]


# ── Section: hardest counters ────────────────────────────────────────────────

def run_counters(intel_rows):
    """The matchups that are lopsided BEYOND what raw strength explains.

    A head-to-head win rate on its own mostly measures which brawler is
    better, not who counters whom — so the reported edge is the residual
    after subtracting the solo-strength difference. The coefficient is 1.0 by
    MEASUREMENT (CLAUDE.md records 1.004 for head-to-head), which is why plain
    subtraction is correct here and would NOT be for duo synergy, where the
    measured coefficient is 0.508.

    What survives is genuinely counter-intuitive and genuinely useful: Mortis
    beats Sprout while being the weaker brawler overall, and Bolt loses to
    Wendy by far less than an 11-point strength gap says he should.

    vs_brawler is antisymmetric (A-vs-B is 100 minus B-vs-A), so a pair's two
    residuals are negatives of each other and keeping only the positive side
    deduplicates the list for free."""
    solo = {r["brawler"]: r["true_win_rate"] for r in intel_rows}
    results = []
    for r in intel_rows:
        a = r["brawler"]
        for b, stats in (r.get("vs_brawler") or {}).items():
            if b not in solo:
                continue
            picks = stats.get("picks", 0)
            wr = stats.get("winRate")
            if picks < COUNTER_MIN_PICKS or wr is None:
                continue
            residual = (wr - 50.0) - (solo[a] - solo[b])
            if residual < COUNTER_MIN_RESIDUAL:
                continue
            results.append({
                "winner": brawler_name(a), "loser": brawler_name(b),
                "edge": round(residual, 1), "matchupWr": round(wr, 1),
                "winnerSolo": round(solo[a], 1), "loserSolo": round(solo[b], 1),
                "picks": picks,
            })
    results.sort(key=lambda x: x["edge"], reverse=True)
    return results[:COUNTER_TOP_N]


# ── Weekly meta snapshot: standings + all four sections above ───────────────

def run_meta_snapshot():
    intel_rows = sb_get("brawler_intelligence", {
        "select": "brawler,picks,true_win_rate,with_brawler,vs_brawler", "patch": f"eq.{CURRENT_PATCH}",
        "rank_bracket": f"eq.{BRACKET}", "picks": f"gte.{META_MIN_PICKS}",
    })
    if len(intel_rows) < META_TOP_N:
        print(f"news_digest[meta]: skipped — only {len(intel_rows)} brawlers clear {META_MIN_PICKS} games.")
        return

    intel_rows.sort(key=lambda r: r["true_win_rate"], reverse=True)
    top = intel_rows[:META_TOP_N]
    bottom = intel_rows[-META_BOTTOM_N:][::-1]  # weakest first, still descending order

    map_rows = fetch_map_rows()

    shifters = run_shifters()
    classes = run_class_distribution(intel_rows)
    synergies = run_best_synergies(intel_rows)
    unusual = run_unusual_map_cells(intel_rows, map_rows)
    modes = run_mode_specialists(map_rows)
    ranks = run_rank_divergence(intel_rows)
    counters = run_counters(intel_rows)

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # Every section below is OMITTED, not forced, when it can't clear its own
    # floor — same discipline as the rest of this pipeline. Only standings is
    # required to publish at all.
    sections = [
        "Strongest:\n" + "\n".join(f"• {brawler_name(r['brawler'])} {r['true_win_rate']:.1f}%" for r in top),
        "Weakest:\n" + "\n".join(f"• {brawler_name(r['brawler'])} {r['true_win_rate']:.1f}%" for r in bottom),
    ]
    if shifters:
        sections.append("Biggest week-over-week shifts:\n" + "\n".join(
            f"• {m['brawler']} {fmt_pp(m['delta'])}pp ({m['beforeWr']}% → {m['last7dWr']}%)" for m in shifters))
    if classes:
        sections.append("Most drafted classes:\n" + "\n".join(
            f"• {c['class'].replace('_', ' ').title()} — {c['sharePct']}% of picks" for c in classes[:5]))
    if synergies:
        sections.append("Best duos right now:\n" + "\n".join(
            f"• {s['a']} + {s['b']} — {fmt_pp(s['excess'])}pp above their solo average ({s['duoWr']}% together)"
            for s in synergies))
    if unusual:
        sections.append("Unusual on a specific map:\n" + "\n".join(
            f"• {u['brawler']} is {fmt_pp(u['deviation'])}pp off their own average on {u['map']} "
            f"({u['overallWr']}% overall → {u['mapWr']}% there, {u['picks']} games)" for u in unusual))

    if modes:
        sections.append("Mode specialists:\n" + "\n".join(
            f"• {m['brawler']} swings {m['swing']}pp — {m['bestWr']}% in {m['bestMode']} "
            f"against {m['worstWr']}% in {m['worstMode']}" for m in modes))
    if ranks:
        sections.append("Plays differently by rank:\n" + "\n".join(
            f"• {r['brawler']} {r['mastersWr']}% in Masters+ against {r['diamondWr']}% in Diamond/Mythic "
            f"({fmt_pp(r['gap'])}pp)" for r in ranks))
    if counters:
        sections.append("Hardest counters, beyond raw strength:\n" + "\n".join(
            f"• {c['winner']} beats {c['loser']} {c['matchupWr']}% — {fmt_pp(c['edge'])}pp more than "
            f"their {c['winnerSolo']}% vs {c['loserSolo']}% overall rates predict" for c in counters))

    summary = (
        f"Current Masters+ standings on patch {CURRENT_PATCH} (minimum {META_MIN_PICKS} games):\n\n"
        + "\n\n".join(sections)
    )

    data = {
        "minPicks": META_MIN_PICKS,
        "strongest": [{"brawler": brawler_name(r["brawler"]), "winRate": round(r["true_win_rate"], 1), "picks": r["picks"]} for r in top],
        "weakest": [{"brawler": brawler_name(r["brawler"]), "winRate": round(r["true_win_rate"], 1), "picks": r["picks"]} for r in bottom],
    }
    if shifters:
        data["shifters"] = shifters
    if classes:
        data["classes"] = classes
    if synergies:
        data["synergies"] = synergies
    if unusual:
        data["unusual"] = unusual
    if modes:
        data["modes"] = modes
    if ranks:
        data["ranks"] = ranks
    if counters:
        data["counters"] = counters

    post = sb_insert("news_posts", {
        "slug": f"meta-snapshot-{today}",
        "title": f"The meta this week — {today}",
        "summary": summary,
        "category": "balance",
        "patch": CURRENT_PATCH,
        "source": "internal_stats",
        "source_urls": [],
        "auto_generated": True,
        "data": data,
    })
    print(f"news_digest[meta]: published \"{post['slug']}\" "
          f"({len(top)} strong, {len(bottom)} weak, {len(shifters)} shifters, "
          f"{len(classes)} classes, {len(synergies)} synergies, {len(unusual)} unusual).")


def main():
    require_credentials()
    mode = sys.argv[1] if len(sys.argv) > 1 else None
    if mode not in ("patch", "meta"):
        print("Usage: python -m scrapers.news_digest [patch|meta]")
        raise SystemExit(1)
    print(f"📊 News digest [{mode}]: patch {CURRENT_PATCH}...")
    if mode == "patch":
        run_patch_impact()
    else:
        run_meta_snapshot()


if __name__ == "__main__":
    main()
