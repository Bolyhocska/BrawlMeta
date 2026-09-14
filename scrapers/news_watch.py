# ─── News watcher: daily websearch, human-reviewed before anything publishes ──
#
# Runs once a day. MOST DAYS FIND NOTHING, and that is success, not failure —
# real Brawl Stars news (balance patches, brawler reveals, Brawl Talk) lands
# roughly every two weeks, so a script that must produce something daily would
# be pressured into inventing it. This one is explicitly allowed to come back
# empty.
#
# WHY THIS CANNOT SCRAPE A KNOWN URL. There is no Supercell news API or RSS
# feed, and the sites that carry this info are unreliable for unattended
# fetching specifically (not for a human browsing them): supercell.com's own
# release-notes path 404'd, brawlstars.fandom.com returned 402, brawlify.com is
# Cloudflare-gated outright — all observed directly, 2026-09. A cron job with
# no one watching needs a source that does not silently fail, so this uses
# Anthropic's server-side web_search tool instead of fetching a fixed page:
# Claude decides whether/what to search, the search itself runs on Anthropic's
# infrastructure (no proxy, no Cloudflare wall to hit), and results come back
# with citations attached. Cost is trivial at this cadence — $10 per 1,000
# searches, so daily use is about 30 cents a month.
#
# WHY NOTHING HERE EVER TOUCHES THE PUBLIC SITE DIRECTLY. An LLM asked to
# summarize "today's news" from a search that came back thin or ambiguous does
# not reliably say so — it can produce a fluent, plausible patch note that
# never happened. That failure mode is exactly the risk on a page visitors
# would treat as fact. So every finding lands in `news_candidates` (no public
# read policy at all) and a GitHub issue, and NOTHING reaches `news_posts`
# (the public table) until a human adds the `approved` label. See
# news_publish() below for that half of the loop, run in the same job.
#
# Separate from the patch-impact posts in meta_weights.py, which write to
# news_posts directly with no review step — those are our own measured
# win-rate deltas, the same trust level as the tier list, not a websearch
# result that could be describing something that didn't happen.

import json
import os
import re
import requests
from datetime import datetime, timedelta, timezone

from scrapers.common import require_credentials, SUPABASE_URL, SUPABASE_HEADERS

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN")
GITHUB_REPO = os.environ.get("GITHUB_REPOSITORY")  # "owner/repo", auto-set in Actions

MODEL = "claude-sonnet-5"
LOOKBACK_DAYS = 14  # how far back to pull prior candidates for dedup context


def require_news_credentials():
    if not ANTHROPIC_API_KEY:
        print("Missing ANTHROPIC_API_KEY. Ensure it is set in Actions secrets.")
        raise SystemExit(1)
    if not GITHUB_TOKEN or not GITHUB_REPO:
        print("Missing GITHUB_TOKEN or GITHUB_REPOSITORY — must run inside a "
              "GitHub Actions job with `permissions: issues: write`.")
        raise SystemExit(1)


# ── Supabase helpers ─────────────────────────────────────────────────────────

def sb_get(table, params):
    res = requests.get(f"{SUPABASE_URL}/rest/v1/{table}", headers=SUPABASE_HEADERS, params=params, timeout=30)
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


def sb_patch(table, row_id, fields):
    res = requests.patch(
        f"{SUPABASE_URL}/rest/v1/{table}?id=eq.{row_id}",
        headers=SUPABASE_HEADERS, json=fields, timeout=30,
    )
    res.raise_for_status()


# ── GitHub helpers (REST API directly — gh CLI is not installed anywhere in
# this pipeline, and the Actions-provided GITHUB_TOKEN is all this needs) ────

def gh_headers():
    return {"Authorization": f"Bearer {GITHUB_TOKEN}", "Accept": "application/vnd.github+json"}


def gh_create_issue(title, body):
    res = requests.post(
        f"https://api.github.com/repos/{GITHUB_REPO}/issues",
        headers=gh_headers(), json={"title": title, "body": body, "labels": ["news-candidate"]},
        timeout=30,
    )
    res.raise_for_status()
    return res.json()["number"]


def gh_get_issue(number):
    res = requests.get(f"https://api.github.com/repos/{GITHUB_REPO}/issues/{number}", headers=gh_headers(), timeout=30)
    res.raise_for_status()
    return res.json()


def gh_comment_and_close(number, comment):
    requests.post(
        f"https://api.github.com/repos/{GITHUB_REPO}/issues/{number}/comments",
        headers=gh_headers(), json={"body": comment}, timeout=30,
    )
    requests.patch(
        f"https://api.github.com/repos/{GITHUB_REPO}/issues/{number}", headers=gh_headers(),
        json={"state": "closed"}, timeout=30,
    )


# ── Phase 1: search for something new ────────────────────────────────────────

SYSTEM_PROMPT = """You monitor Brawl Stars for news worth reporting on a fan stats site: \
balance-change patches, new brawler reveals, Brawl Talk announcements, or major event changes.

You will be given a list of items already reported in the last two weeks. Do NOT report \
anything that duplicates or is a minor rehash of one of those.

Rules, followed exactly:
- Report ONLY if you find something genuinely new, with an identifiable source you can cite.
- If you are not confident something is both NEW and REAL, respond with exactly: {"found": false}
- NEVER invent specifics (numbers, dates, brawler names, patch versions) that are not directly \
supported by a search result you can cite. If a detail is unclear, omit it rather than guess.
- Every claim in your summary must trace to at least one URL in source_urls.

If you find something, respond with ONLY this JSON shape, no other text:
{"found": true, "title": "short headline", "summary": "2-4 plain sentences, facts only", \
"patch": "69.230 or null", "source_urls": [{"title": "...", "url": "..."}]}"""


def find_candidate(known_titles):
    known = "\n".join(f"- {t}" for t in known_titles) or "(none yet)"
    user_msg = f"Already reported in the last {LOOKBACK_DAYS} days:\n{known}\n\nToday's date context: check for anything published very recently."

    res = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
        json={
            "model": MODEL,
            "max_tokens": 1024,
            "system": SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": user_msg}],
            "tools": [{"type": "web_search_20250305", "name": "web_search", "max_uses": 5}],
        },
        timeout=90,
    )
    res.raise_for_status()
    data = res.json()

    # The final text block is the model's answer after however many search
    # turns it took; tool_use/tool_result blocks are the search calls
    # themselves and are not the JSON we want.
    text_blocks = [b["text"] for b in data.get("content", []) if b.get("type") == "text"]
    if not text_blocks:
        print("news_watch: no text content in response (unexpected shape) — treating as nothing found")
        return None
    raw = text_blocks[-1].strip()

    # Defensive: the model was told to return bare JSON, but strip a code
    # fence if one shows up anyway rather than crash the whole job on it.
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip())
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        print(f"news_watch: could not parse model output as JSON, treating as nothing found. Raw: {raw[:300]}")
        return None

    if not parsed.get("found"):
        return None
    if not parsed.get("title") or not parsed.get("summary") or not parsed.get("source_urls"):
        print(f"news_watch: model said found=true but omitted a required field — discarding. Raw: {raw[:300]}")
        return None
    return parsed


def news_watch():
    since = (datetime.now(timezone.utc) - timedelta(days=LOOKBACK_DAYS)).isoformat()
    recent = sb_get("news_candidates", {"select": "title", "found_at": f"gte.{since}"})
    known_titles = [r["title"] for r in recent]

    candidate = find_candidate(known_titles)
    if candidate is None:
        print("news_watch: nothing new found today.")
        return

    row = sb_insert("news_candidates", {
        "title": candidate["title"],
        "summary": candidate["summary"],
        "patch": candidate.get("patch"),
        "source_urls": candidate["source_urls"],
        "status": "pending",
    })

    sources_md = "\n".join(f"- [{s['title']}]({s['url']})" for s in candidate["source_urls"])
    body = (
        f"**{candidate['summary']}**\n\n"
        f"Sources:\n{sources_md}\n\n"
        f"Patch: {candidate.get('patch') or '—'}\n\n"
        "---\n"
        "Found by the daily news watcher. To publish this to /news as-is, "
        "add the **approved** label. To discard it, just close this issue "
        "(or leave it — it will not publish itself either way)."
    )
    issue_number = gh_create_issue(f"News draft: {candidate['title']}", body)
    sb_patch("news_candidates", row["id"], {"github_issue_number": issue_number})
    print(f"news_watch: opened issue #{issue_number} for review — \"{candidate['title']}\"")


# ── Phase 2: publish anything a human approved since the last run ───────────

def slugify(title):
    s = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return f"{s}-{datetime.now(timezone.utc).strftime('%Y%m%d')}"


def news_publish():
    pending = sb_get("news_candidates", {"select": "*", "status": "eq.pending", "github_issue_number": "not.is.null"})
    if not pending:
        print("news_publish: nothing pending review.")
        return

    for c in pending:
        issue = gh_get_issue(c["github_issue_number"])
        labels = {l["name"] for l in issue.get("labels", [])}

        if "approved" in labels:
            post = sb_insert("news_posts", {
                "slug": slugify(c["title"]),
                "title": c["title"],
                "summary": c["summary"],
                "category": "balance" if c.get("patch") else "community",
                "patch": c.get("patch"),
                "source": "news_watch",
                "source_urls": c["source_urls"],
                "auto_generated": True,
            })
            sb_patch("news_candidates", c["id"], {
                "status": "published", "reviewed_at": datetime.now(timezone.utc).isoformat(),
                "published_post_id": post["id"],
            })
            gh_comment_and_close(c["github_issue_number"], f"✅ Published to /news: `{post['slug']}`")
            print(f"news_publish: published \"{c['title']}\"")

        elif issue.get("state") == "closed":
            sb_patch("news_candidates", c["id"], {
                "status": "rejected", "reviewed_at": datetime.now(timezone.utc).isoformat(),
            })
            print(f"news_publish: \"{c['title']}\" closed without approval — marked rejected.")


def main():
    require_credentials()  # Supabase creds, from common.py
    require_news_credentials()
    print("📰 News watcher: checking for approvals, then searching for new items...")
    # Publish first: today's approvals should close out before a fresh search
    # runs, so an issue never sits open for two review cycles by accident.
    news_publish()
    news_watch()


if __name__ == "__main__":
    main()
