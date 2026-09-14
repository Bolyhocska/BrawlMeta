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
#     (news-meta-snapshot.yml, Mondays). A snapshot of the CURRENT meta —
#     who is strong right now, who is weak — not a week-over-week delta. No
#     comparison needed, so no dependence on meta_daily history depth.
#
# meta_daily (used by an earlier version of this file for a movers-style
# delta) IS A CUMULATIVE SNAPSHOT, NOT A DAILY DELTA — capture_meta_history in
# common.py writes "the freshly-rebuilt BrawlerStats" each day, i.e. the
# patch-to-date total as of that day. Summing several days' rows sums
# overlapping totals and wildly overcounts (caught before shipping: summing 7
# days gave NORI 6.16 million "picks" against far less total site volume).
# Recorded here because the mistake is easy to re-make if a delta-style report
# is ever added back.

import re
import sys
import requests
from datetime import datetime, timezone

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


# ── Weekly meta snapshot (current standings, no delta) ───────────────────────

def run_meta_snapshot():
    rows = sb_get("brawler_intelligence", {
        "select": "brawler,picks,true_win_rate", "patch": f"eq.{CURRENT_PATCH}",
        "rank_bracket": f"eq.{BRACKET}", "picks": f"gte.{META_MIN_PICKS}",
    })
    if len(rows) < META_TOP_N:
        print(f"news_digest[meta]: skipped — only {len(rows)} brawlers clear {META_MIN_PICKS} games.")
        return

    rows.sort(key=lambda r: r["true_win_rate"], reverse=True)
    top = rows[:META_TOP_N]
    bottom = rows[-META_BOTTOM_N:][::-1]  # weakest first, still descending order

    strong_lines = [f"{brawler_name(r['brawler'])} {r['true_win_rate']:.1f}%" for r in top]
    weak_lines = [f"{brawler_name(r['brawler'])} {r['true_win_rate']:.1f}%" for r in bottom]

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    summary = (
        f"Current Masters+ standings on patch {CURRENT_PATCH} (minimum {META_MIN_PICKS} games):\n\n"
        f"Strongest:\n" + "\n".join(f"• {l}" for l in strong_lines) + "\n\n"
        f"Weakest:\n" + "\n".join(f"• {l}" for l in weak_lines)
    )

    post = sb_insert("news_posts", {
        "slug": f"meta-snapshot-{today}",
        "title": f"The meta this week — {today}",
        "summary": summary,
        "category": "balance",
        "patch": CURRENT_PATCH,
        "source": "internal_stats",
        "source_urls": [],
        "auto_generated": True,
        "data": {
            "minPicks": META_MIN_PICKS,
            "strongest": [
                {"brawler": brawler_name(r["brawler"]), "winRate": round(r["true_win_rate"], 1), "picks": r["picks"]}
                for r in top
            ],
            "weakest": [
                {"brawler": brawler_name(r["brawler"]), "winRate": round(r["true_win_rate"], 1), "picks": r["picks"]}
                for r in bottom
            ],
        },
    })
    print(f"news_digest[meta]: published \"{post['slug']}\" ({len(top)} strong, {len(bottom)} weak).")


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
