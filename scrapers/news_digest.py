# ─── News digest: our own measured data, published on a fixed 3x/week beat ──
#
# Writes DIRECTLY to news_posts, unlike news_watch.py — no review queue, no
# GitHub issue. That is deliberate and safe here specifically: the content is
# either "our own win-rate numbers, patch A vs patch B" or "our own win-rate
# numbers, this week vs before" — the same trust level as the tier list, not a
# websearch result that could be describing something that never happened.
# There is no fabrication risk to guard against, so TEXT IS TEMPLATED, not
# LLM-generated: Python string formatting cannot misstate a number the way an
# LLM asked to "write a nice paragraph" conceivably could, even from real data.
#
# Runs on a fixed schedule (Mon/Wed/Fri, see news-digest.yml) rather than only
# right after a patch, because patches land every few weeks and the owner
# wants a steady cadence on /news, not silence in between. Two content types,
# tried in priority order each run:
#
#   1. PATCH IMPACT — fires ONCE per patch, the first scheduled run after the
#      patch is old enough and has enough per-brawler sample to compare
#      honestly against the previous patch. This is the same computation done
#      by hand for 68.250 -> 69.230 earlier in this project (Amber +7.9pp,
#      El Primo +9.6pp, ...), now automated and gated on real sample floors
#      instead of eyeballed.
#   2. WEEKLY MOVERS — the steady content. Compares the last 7 days of a
#      brawler's win rate against everything in the patch BEFORE those 7 days,
#      using meta_daily. If nothing clears the significance bar this week
#      (rare but possible), the run publishes NOTHING rather than force a
#      post — same principle as news_watch.py: most days having nothing to
#      say is expected, not a failure.
#
# meta_daily IS A CUMULATIVE SNAPSHOT, NOT A DAILY DELTA — capture_meta_history
# in common.py writes "the freshly-rebuilt BrawlerStats" each day, i.e. the
# patch-to-date total as of that day. SUMMING several days' rows therefore
# sums overlapping totals and wildly overcounts (verified: summing 7 days gave
# NORI 6.16 MILLION "picks" against a total site volume far below that).
# Every query here DIFFS two snapshot days instead, the same pattern this
# codebase already uses for times_seen deltas in push_matches.

import re
import requests
from datetime import datetime, timedelta, timezone

from scrapers.common import (
    require_credentials, SUPABASE_URL, SUPABASE_HEADERS, CURRENT_PATCH, PATCH_START_TIMES,
)

BRACKET = "masters_legendary"

# Per-brawler floors, not an aggregate readiness percentage — simpler, and
# consistent with every other "is this sample trustworthy" gate in this
# project (see confidencePriorGames / minRecentPicks in draft_logic_config.json,
# all in the same 300-ish neighbourhood).
PATCH_IMPACT_MIN_PICKS = 300      # per brawler, in EACH patch being compared
PATCH_IMPACT_MIN_DAYS = 3         # don't compare against a patch <3 days old
PATCH_IMPACT_MIN_MOVERS = 3       # skip the post if fewer than this many brawlers qualify
PATCH_IMPACT_TOP_N = 6

WEEKLY_MIN_PICKS = 1000           # per brawler, on EACH side of the 7-day split
WEEKLY_MIN_DELTA = 2.0            # win-rate points; below this is noise at these sample sizes
WEEKLY_MIN_MOVERS = 3
WEEKLY_TOP_N = 6


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


# ── Patch impact ─────────────────────────────────────────────────────────────

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


def try_patch_impact():
    age = days_since_patch_start(CURRENT_PATCH)
    if age is None or age < PATCH_IMPACT_MIN_DAYS:
        print(f"news_digest: patch impact skipped — {CURRENT_PATCH} is "
              f"{'unknown age' if age is None else f'{age:.1f}d old'}, needs {PATCH_IMPACT_MIN_DAYS}d.")
        return False

    prior = prior_patch_of(CURRENT_PATCH)
    if not prior:
        print("news_digest: patch impact skipped — no prior patch to compare against.")
        return False

    if already_posted_patch_impact(CURRENT_PATCH):
        print(f"news_digest: patch impact already posted for {CURRENT_PATCH}.")
        return False

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
        print(f"news_digest: patch impact skipped — only {len(movers)} brawlers clear "
              f"{PATCH_IMPACT_MIN_PICKS} games in both {CURRENT_PATCH} and {prior}.")
        return False

    top = movers[:PATCH_IMPACT_TOP_N]
    lines = [
        f"{m['brawler'].title()} {fmt_pp(m['delta'])}pp ({m['prior_wr']:.1f}% → {m['cur_wr']:.1f}%)"
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
    })
    print(f"news_digest: published patch-impact post \"{post['slug']}\" ({len(top)} movers).")
    return True


# ── Weekly movers ─────────────────────────────────────────────────────────────

def latest_meta_day():
    rows = sb_get("meta_daily", {
        "select": "day", "patch": f"eq.{CURRENT_PATCH}", "rank_bracket": f"eq.{BRACKET}",
        "order": "day.desc", "limit": "1",
    })
    return rows[0]["day"] if rows else None


def meta_day_totals(day):
    """{brawler: {picks, wins}} summed across every map for one snapshot day.
    Paged, matching the paging pattern already used in calibrate.mjs and
    appCore.js — a single day's rows (all maps, one bracket, one patch) is a
    few hundred to ~2,700, comfortably under one page in practice, but this
    stays correct if that grows."""
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


def try_weekly_movers():
    latest = latest_meta_day()
    if not latest:
        print("news_digest: weekly movers skipped — no meta_daily snapshot yet for this patch.")
        return False

    latest_dt = datetime.strptime(latest, "%Y-%m-%d")
    week_ago = (latest_dt - timedelta(days=7)).strftime("%Y-%m-%d")

    now_totals = meta_day_totals(latest)
    week_ago_totals = meta_day_totals(week_ago)
    if not week_ago_totals:
        print(f"news_digest: weekly movers skipped — no snapshot from {week_ago} "
              f"(patch is younger than 7 days).")
        return False

    movers = []
    for name, now in now_totals.items():
        before = week_ago_totals.get(name)
        if not before:
            continue
        last7d_picks = now["picks"] - before["picks"]
        last7d_wins = now["wins"] - before["wins"]
        if last7d_picks < WEEKLY_MIN_PICKS or before["picks"] < WEEKLY_MIN_PICKS:
            continue
        last7d_wr = 100.0 * last7d_wins / last7d_picks
        before_wr = 100.0 * before["wins"] / before["picks"]
        movers.append({"brawler": name, "delta": last7d_wr - before_wr, "last7d_wr": last7d_wr, "before_wr": before_wr})

    movers = [m for m in movers if abs(m["delta"]) >= WEEKLY_MIN_DELTA]
    movers.sort(key=lambda m: abs(m["delta"]), reverse=True)
    if len(movers) < WEEKLY_MIN_MOVERS:
        print(f"news_digest: weekly movers skipped — only {len(movers)} brawlers moved "
              f"{WEEKLY_MIN_DELTA}pp+ this week (need {WEEKLY_MIN_MOVERS}).")
        return False

    top = movers[:WEEKLY_TOP_N]
    lines = [
        f"{m['brawler'].title()} {fmt_pp(m['delta'])}pp ({m['before_wr']:.1f}% → {m['last7d_wr']:.1f}%)"
        for m in top
    ]
    summary = (
        f"Over the last 7 days in Masters+ (patch {CURRENT_PATCH}, minimum {WEEKLY_MIN_PICKS} games "
        f"on each side of the split):\n\n" + "\n".join(f"• {l}" for l in lines)
    )

    post = sb_insert("news_posts", {
        "slug": f"weekly-movers-{latest}",
        "title": f"This week in the meta — {latest}",
        "summary": summary,
        "category": "balance",
        "patch": CURRENT_PATCH,
        "source": "internal_stats",
        "source_urls": [],
        "auto_generated": True,
    })
    print(f"news_digest: published weekly-movers post \"{post['slug']}\" ({len(top)} movers).")
    return True


def main():
    require_credentials()
    print(f"📊 News digest: patch {CURRENT_PATCH}...")
    if try_patch_impact():
        return  # one post per scheduled run — don't also post weekly movers today
    try_weekly_movers()


if __name__ == "__main__":
    main()
