"""One-time (re-runnable) fetch of ranked map art into public/maps/.

Self-hosted rather than hotlinked, exactly like scratchpad/fetch_icons.py did for
brawler / game-mode / gear icons: hotlinking someone else's CDN in production
spends their bandwidth, can break without warning, and this repo is public.

Getting a name -> id mapping is the awkward part. api.brawlify.com is behind a
Cloudflare interstitial and answers 403 to anything scripted (confirmed again
2026-08-30), so the ids are read off brawltime.ninja's tier-list pages, which the
map-pool scraper already reads successfully. The IMAGE itself then comes from
cdn.brawlify.com, the same origin fetch_icons.py used.

Resumable: a non-empty existing file is skipped, so re-running after a new map
enters rotation only fetches what is missing.
"""
import io, json, os, re, sys, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "maps")
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"}
MODES = ["gem-grab", "brawl-ball", "bounty", "heist", "hot-zone", "knockout"]
# Same slug rule the frontend uses (mapFileSlug in DraftAssistant.jsx) so a file
# dropped here is found without any lookup table.
slug = lambda s: re.sub(r"[^a-z0-9]", "", (s or "").lower())
PAT = re.compile(
    r"/tier-list/mode/[a-z-]+/map/([A-Za-z0-9\-\.'%]+)\"[^>]*>([^<]+)</a></h2>"
    r".{0,400}?media\.brawltime\.ninja/maps/(15\d{6})", re.S)


def get(url, timeout=30):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout).read()


def map_ids():
    pairs = {}
    for m in MODES + ["ranked"]:
        url = ("https://brawltime.ninja/tier-list/ranked" if m == "ranked"
               else f"https://brawltime.ninja/tier-list/mode/{m}")
        try:
            html = get(url).decode("utf-8", "replace")
        except Exception as e:
            print(f"  {m}: source unavailable ({e}) — skipping")
            continue
        for _, name, mid in PAT.findall(html):
            pairs.setdefault(name.strip(), mid)
        time.sleep(1)
    return pairs


def main():
    os.makedirs(OUT, exist_ok=True)
    pairs = map_ids()
    if len(pairs) < 10:
        # Same refusal shape as refresh_dynamic_map_pool: acting on a broken
        # parse is worse than doing nothing, because a half-written art set
        # silently leaves maps looking unsupported.
        sys.exit(f"only {len(pairs)} maps parsed — source shape probably changed, refusing to run")
    print(f"{len(pairs)} maps with an id")
    got = skipped = failed = 0
    for name, mid in sorted(pairs.items()):
        path = os.path.join(OUT, f"{slug(name)}.png")
        if os.path.exists(path) and os.path.getsize(path) > 0:
            skipped += 1
            continue
        try:
            data = get(f"https://cdn.brawlify.com/maps/regular/{mid}.png")
            if len(data) < 1000:
                raise ValueError(f"suspiciously small ({len(data)} bytes)")
            with open(path, "wb") as f:
                f.write(data)
            got += 1
            print(f"  {name:<20} {mid}  {len(data)//1024} KB")
        except Exception as e:
            failed += 1
            print(f"  {name:<20} {mid}  FAILED: {e}")
        time.sleep(0.3)
    print(f"\nfetched {got}, already present {skipped}, failed {failed} -> public/maps/")


if __name__ == "__main__":
    main()
