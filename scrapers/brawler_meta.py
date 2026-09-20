"""Refresh src/data/brawlerMeta.json from the OFFICIAL Brawl Stars API.

Why this exists: brawlerMeta.json was hand-maintained, so a new brawler landed
structurally broken and nobody noticed until a guide page rendered blank. WENDY
(16000108) shipped with an empty description, no star powers and no gadgets and
sat that way; Cosmo and Vince would have done the same.

WHAT THIS CAN AND CANNOT FILL — read this before trusting the output.

The `/brawlers` endpoint returns identity and STRUCTURE only:

    {"items": [{"id": 16000000, "name": "SHELLY",
                "starPowers": [{"id": 23000076, "name": "SHELL SHOCK"}],
                "gadgets":    [{"id": 23000255, "name": "FAST FORWARD"}]}]}

There are no description strings anywhere in it — not for the brawler, not for
each star power or gadget. Nor is there rarity, class or portrait art. So this
script authoritatively fills NAMES and STRUCTURE, and REPORTS everything it
cannot know instead of inventing it. An invented star power name is worse than
an empty one: it renders as fact on the guide page and nothing flags it.

Merge rules, in order of importance:

  1. NEVER overwrite a non-empty human-written field. Descriptions are curated
     and the API has nothing to replace them with, so a re-run must be safe to
     do at any time.
  2. Add brawlers the file is missing, and add star powers / gadgets the file is
     missing, keyed by the API's id.
  3. Report, loudly and by name, every gap a human still has to fill.

Run:  python -m scrapers.brawler_meta            # fetch + merge + report
      python -m scrapers.brawler_meta --report   # report gaps only, no network
"""

import json
import os
import sys

import requests

from .common import BASE_URL, HEADERS, PROXIES, require_credentials

# The other scrapers only ever run on Actions, where stdout is UTF-8. This one
# is meant to be run locally too, and the Windows console defaults to cp1252 —
# which turns the report's emoji into a UnicodeEncodeError and kills the run
# after the work is done. Reconfigure rather than drop to ASCII, so the output
# matches the rest of the scrapers.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
META_PATH = os.path.join(REPO_ROOT, "src", "data", "brawlerMeta.json")
ICON_DIR = os.path.join(REPO_ROOT, "public", "icons", "brawlers")

# Written for a brawler the API knows about but the file has never seen. These
# are deliberately obvious placeholders rather than plausible guesses — the
# report lists them, and a wrong rarity colour on the tier list is a visible
# prompt to fix it, where an invented one silently looks correct.
NEW_BRAWLER_DEFAULTS = {
    "rarity": "",
    "rarityColor": "#888888",
    "class": "",
    "description": "",
}


def fetch_brawlers():
    """Official brawler list. Proxied: the Supercell key is IP-allowlisted."""
    res = requests.get(f"{BASE_URL}/brawlers", headers=HEADERS,
                       proxies=PROXIES, timeout=60)
    res.raise_for_status()
    items = res.json().get("items", [])
    if not items:
        raise SystemExit("brawler_meta: /brawlers returned no items — refusing "
                         "to rewrite the file from an empty response.")
    return items


def load_meta():
    with open(META_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def save_meta(meta):
    # Keys sorted so a re-run produces a minimal, reviewable diff instead of
    # reordering 106 entries. ensure_ascii=False keeps accented brawler names
    # readable in the file rather than as \uXXXX escapes.
    with open(META_PATH, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(meta, fh, indent=2, ensure_ascii=False, sort_keys=True)
        fh.write("\n")


def merge_entries(meta, api_items):
    """Fold the API's structure into the file. Returns (changed, added_names)."""
    changed = False
    added = []

    for item in api_items:
        key = (item.get("name") or "").strip().upper()
        if not key:
            continue
        entry = meta.get(key)

        if entry is None:
            entry = dict(NEW_BRAWLER_DEFAULTS)
            entry["id"] = item["id"]
            entry["imageUrl"] = f"/icons/brawlers/{item['id']}.png"
            entry["starPowers"] = []
            entry["gadgets"] = []
            meta[key] = entry
            added.append(key)
            changed = True

        # The id is the stable identity and the portrait path derives from it,
        # so repair both if they drifted — but only these two, because they are
        # the only fields the API is authoritative about.
        if entry.get("id") != item["id"]:
            entry["id"] = item["id"]
            entry["imageUrl"] = f"/icons/brawlers/{item['id']}.png"
            changed = True

        for field in ("starPowers", "gadgets"):
            have = entry.setdefault(field, [])
            have_names = {(e.get("name") or "").strip().upper() for e in have}
            for api_entry in item.get(field, []) or []:
                name = (api_entry.get("name") or "").strip()
                if not name or name.upper() in have_names:
                    continue
                # desc left empty on purpose: the API does not carry one, and a
                # generated sentence would read as sourced fact on the guide.
                have.append({"name": name, "desc": "", "img": None})
                changed = True

    return changed, added


def report(meta):
    """Everything a human still has to fill. Exit code is informational only."""
    no_desc, no_kit, no_meta_fields, no_icon, empty_subdesc = [], [], [], [], []

    # An UNRELEASED brawler cannot have art, a rarity or a description yet, so
    # nagging about it every day until it ships trains you to ignore the whole
    # report. The official /brawlers endpoint lists brawlers BEFORE release —
    # VINCE was in it in September for an October launch. Mark it by hand with
    # "released": false; merge_entries never touches that key, so it survives.
    unreleased = sorted(k for k, e in meta.items() if e.get("released") is False)

    for key, entry in sorted(meta.items()):
        if entry.get("released") is False:
            continue
        if not (entry.get("description") or "").strip():
            no_desc.append(key)
        if not entry.get("starPowers") or not entry.get("gadgets"):
            no_kit.append(key)
        if not (entry.get("rarity") or "").strip() or not (entry.get("class") or "").strip():
            no_meta_fields.append(key)
        if entry.get("id") and not os.path.exists(
                os.path.join(ICON_DIR, f"{entry['id']}.png")):
            no_icon.append(f"{key} ({entry['id']})")
        for field in ("starPowers", "gadgets"):
            for sub in entry.get(field) or []:
                if not (sub.get("desc") or "").strip():
                    empty_subdesc.append(f"{key}/{sub.get('name')}")

    print(f"\nbrawlerMeta.json: {len(meta)} brawlers")
    if unreleased:
        print("  . " + str(len(unreleased)) + " not released yet, skipped: "
              + ", ".join(unreleased))
    for label, rows in (
        ("MISSING PORTRAIT (page renders broken)", no_icon),
        ("MISSING rarity/class (tier list colour wrong)", no_meta_fields),
        ("MISSING star powers or gadgets", no_kit),
        ("MISSING description", no_desc),
        ("star power / gadget with no description", empty_subdesc),
    ):
        if rows:
            shown = ", ".join(rows[:12]) + (f" … +{len(rows) - 12} more" if len(rows) > 12 else "")
            print(f"  ⚠️ {len(rows):3} {label}: {shown}")
    if not any((no_icon, no_meta_fields, no_kit, no_desc, empty_subdesc)):
        print("  ✅ nothing missing")
    return len(no_icon) + len(no_meta_fields)


def main():
    meta = load_meta()

    if "--report" in sys.argv:
        report(meta)
        return

    require_credentials()
    api_items = fetch_brawlers()
    print(f"brawler_meta: API returned {len(api_items)} brawlers, "
          f"file has {len(meta)}.")

    changed, added = merge_entries(meta, api_items)
    if added:
        print(f"➕ NEW brawlers added: {', '.join(added)} — these need a rarity, "
              f"a class, a description and a portrait by hand.")
    if changed:
        save_meta(meta)
        print("✏️  brawlerMeta.json updated.")
    else:
        print("brawlerMeta.json already up to date.")

    report(meta)


if __name__ == "__main__":
    main()
