"""Dump EVERYTHING the Supercell API actually returns, field by field.

    python -m scrapers.probe_api_schema [#TAG] [--redact]

WHY THIS EXISTS. The game client started showing per-match performance stats
(damage dealt, healing done, and so on) and the question was whether the public
API exposes them too. Nothing in this repo could answer it: `parse_battle`
reads twelve keys and throws the rest of the response away, and no raw payload
is stored anywhere, so new fields could have been arriving in every call for
weeks and left no trace. This prints the whole shape so the question is settled
by observation instead of assumption.

DELIBERATELY STANDALONE. It is its own module with its own dispatch-only
workflow and is imported by nothing. The real scrapers run 4x/day against a
single shared, IP-allowlisted key, and a diagnostic has no business anywhere
near that path. It costs 2 API calls and writes to no table.

IT ALSO ANSWERS THE SECOND QUESTION. Listing the fields is only half of it;
the useful half is which fields we RECEIVE BUT IGNORE. CONSUMED_KEYS below is
what parse_battle actually reads, and the report diffs the two — so anything
Supercell has added since shows up under "NOT consumed" rather than having to
be spotted by eye.

ON VALUES: prints them in full by default. Brawl Stars tags and names are
public game data and this project already serves them on /player/:tag. Note
only that a battlelog names all six players, not just the subject, and that
Actions logs on a public repo are public — pass --redact to mask tags/names if
that ever matters.
"""

import json
import sys

import requests

# NOT common.require_credentials(): that also demands SUPABASE_URL/KEY, and
# SUPABASE_KEY is the SERVICE-ROLE key. This probe writes to no table, so it
# must not be handed a credential that can. Its workflow passes the Supercell
# key and the proxy only, and the check below matches that.
from .common import BASE_URL, HEADERS, PROXIES, SUPERCELL_API_KEY, PROXY_HOST

# Everything parse_battle() in common.py reads off the response. Keep in sync;
# a stale entry here shows up as a false "we already use this".
CONSUMED_KEYS = {
    "items", "battleTime", "event", "mode", "map", "battle", "type",
    "result", "starPlayer", "teams", "tag", "name", "brawler",
}

# The owner's own tag, so the default run inspects their own matches.
DEFAULT_TAG = "#28PJ2LUUC"

REDACT = "--redact" in sys.argv
SECRETISH = {"tag", "name"}


def mask(key, value):
    if REDACT and key in SECRETISH and isinstance(value, str):
        return f"<{key} redacted, {len(value)} chars>"
    return value


def walk(node, path="", out=None, seen=None):
    """Flatten to path -> (type, example). Arrays collapse to [*] so a 25-battle
    log reports one shape rather than twenty-five near-identical ones."""
    out = {} if out is None else out
    seen = set() if seen is None else seen
    if isinstance(node, dict):
        for k, v in node.items():
            walk(v, f"{path}.{k}" if path else k, out, seen)
    elif isinstance(node, list):
        if node:
            walk(node[0], f"{path}[*]", out, seen)
        else:
            out.setdefault(f"{path}[*]", ("empty array", None))
    else:
        leaf = path.rsplit(".", 1)[-1].replace("[*]", "")
        t = type(node).__name__
        if path in out:
            prev_t, prev_v = out[path]
            if prev_t != t:
                out[path] = (f"{prev_t}|{t}", prev_v)
        else:
            out[path] = (t, mask(leaf, node))
    return out


def get(url):
    res = requests.get(url, headers=HEADERS, proxies=PROXIES, timeout=30)
    print(f"  GET {url.replace(BASE_URL, '')} -> {res.status_code}")
    if res.status_code != 200:
        print(f"  !! {res.text[:400]}")
        return None
    return res.json()


def report(title, data):
    print()
    print("=" * 78)
    print(title)
    print("=" * 78)
    if data is None:
        print("  (no response)")
        return set()

    fields = walk(data)
    width = max(len(p) for p in fields) if fields else 10
    for path in sorted(fields):
        t, example = fields[path]
        shown = "" if example is None else f"  = {json.dumps(example, ensure_ascii=False)[:90]}"
        print(f"  {path.ljust(width)}  {t:<14}{shown}")

    leaves = {p.rsplit('.', 1)[-1].replace('[*]', '') for p in fields}
    leaves |= {seg.replace('[*]', '') for p in fields for seg in p.split('.')}
    leaves.discard("")

    unused = sorted(leaves - CONSUMED_KEYS)
    print()
    print(f"  fields present: {len(leaves)}   consumed by parse_battle: "
          f"{len(leaves & CONSUMED_KEYS)}   NOT consumed: {len(unused)}")
    if unused:
        print("  NOT consumed -> " + ", ".join(unused))
    return leaves


def main():
    if not SUPERCELL_API_KEY:
        print("SUPERCELL_API_KEY is not set.")
        raise SystemExit(1)
    if not PROXY_HOST:
        # The key is IP-allowlisted to the Webshare static IP, so a direct call
        # from anywhere else 403s. Saying so beats an opaque 403.
        print("PROXY_HOST is not set — the Supercell key is IP-allowlisted to "
              "the proxy, so a direct call will be rejected.")
        raise SystemExit(1)

    tag = next((a for a in sys.argv[1:] if not a.startswith("--")), DEFAULT_TAG)
    if not tag.startswith("#"):
        tag = "#" + tag
    enc = tag.replace("#", "%23")
    print(f"Probing {tag}{'  (values redacted)' if REDACT else ''}")

    blog = get(f"{BASE_URL}/players/{enc}/battlelog")
    prof = get(f"{BASE_URL}/players/{enc}")

    report("BATTLELOG  /v1/players/{tag}/battlelog", blog)
    report("PLAYER     /v1/players/{tag}", prof)

    # The literal first battle, verbatim. The flattened view collapses arrays,
    # so this is the one place a per-player field that exists on only SOME
    # players in a team would still be visible.
    items = (blog or {}).get("items") or []
    if items:
        print()
        print("=" * 78)
        print("RAW — first battle exactly as returned")
        print("=" * 78)
        print(json.dumps(items[0], indent=2, ensure_ascii=False))

        ranked = [b for b in items
                  if "ranked" in (b.get("battle", {}).get("type", "") or "").lower()
                  and b.get("battle", {}).get("type") != "ranked"]
        if ranked and ranked[0] is not items[0]:
            print()
            print("=" * 78)
            print("RAW — first COMPETITIVE RANKED battle (what we actually collect)")
            print("=" * 78)
            print(json.dumps(ranked[0], indent=2, ensure_ascii=False))
        elif not ranked:
            print()
            print("NOTE: no soloRanked/teamRanked battle in the last ~25 games for "
                  "this tag, so the raw sample above is a different mode. Ranked "
                  "is where any new per-match stats would matter most — re-run "
                  "with a tag that has played Ranked recently.")

    print()
    print("Done. 2 API calls, nothing written.")


if __name__ == "__main__":
    main()
