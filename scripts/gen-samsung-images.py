#!/usr/bin/env python3
"""Regenerate src/drivers/samsung/images.generated.ts from Samsung's own storefront.

Standard library only, no files outside this repo.

Galaxy Buds product renders are the transparent PNGs samsung.com serves from
its image CDN (`images.samsung.com/is/image/samsung/p6pim/...`). They are
public and unsigned; nothing here is a secret and the app makes no vendor API
call at runtime — it only shows the URLs this script writes.

How a model's images are found: each region's audio listing page is fetched,
and every gallery image whose path carries a Galaxy Buds SKU
(`sm-r<model>nz<colour>a...`) is kept, keyed by model and by the SKU's colour
letter. Samsung's own JSON-LD on the page names some of those letters (a
`.../galaxy-buds4-pro-white-sku-sm-r640nzwaxar` link says W is white); the rest
fall back to the table below.

Only models Samsung still sells are on those pages. Anything it has delisted
(Buds, Buds+, Live, Pro, Buds2, Buds2 Pro, FE) has no stable official image URL
this script can reach, so `docs/reference/samsung-images-extra.json` is the
place to add one by hand:

    { "buds2Pro": { "gray": "https://…/render.png" }, "budsLive": "https://…" }

A string is a model's one image; an object maps a colour name to its image. The
file is optional, and an entry in it wins over a scraped one.

    python3 scripts/gen-samsung-images.py            # fetch and rewrite
    python3 scripts/gen-samsung-images.py --self-test
"""

import argparse
import json
import re
import ssl
import sys
import urllib.error
import urllib.request
from pathlib import Path

OUTPUT = Path("src/drivers/samsung/images.generated.ts")
EXTRA = Path("docs/reference/samsung-images-extra.json")

# Listing pages that carry the current line-up. Regions differ in what they still list, so all are read.
LISTINGS = (
    "https://www.samsung.com/us/mobile/audio/all-audio/",
    "https://www.samsung.com/uk/audio-sound/all-audio-sound/",
    "https://www.samsung.com/in/audio-sound/all-audio-sound/",
    "https://www.samsung.com/de/audio-sound/all-audio-sound/",
    "https://www.samsung.com/fr/audio-sound/all-audio-sound/",
    "https://www.samsung.com/au/audio-sound/all-audio-sound/",
    "https://www.samsung.com/sg/audio-sound/all-audio-sound/",
    "https://www.samsung.com/ae/audio-sound/all-audio-sound/",
)

# SKU number (the part after "SM-R") -> the driver's model id (models.ts).
MODELS = {
    "170": "buds",
    "175": "budsPlus",
    "180": "budsLive",
    "190": "budsPro",
    "177": "buds2",
    "510": "buds2Pro",
    "400": "budsFe",
    "410": "budsCore",
    "530": "buds3",
    "630": "buds3Pro",
    "420": "buds3Fe",
    "540": "buds4",
    "640": "buds4Pro",
}

# Samsung's colour letter in a SKU (SM-R640NZ<K>A...), when a page does not say.
LETTERS = {
    "a": "gray",
    "k": "black",
    "w": "white",
    "v": "violet",
    "p": "pink",
    "b": "blue",
    "l": "lavender",
    "d": "gray",
    "g": "green",
    "y": "yellow",
    "z": "beige",
}

# Words in a Samsung product slug that name the product or the sale, not the finish.
NOT_COLOUR = {
    "galaxy", "buds", "buds2", "buds3", "buds4", "2", "3", "4", "pro", "fe", "core", "live", "plus",
    "online", "exclusive", "special", "colour", "color", "samsung", "com", "only", "sku", "buy",
}

# `…/p6pim/uk/…/gallery/uk-galaxy-buds3-pro-r630-sm-r630nzaaeua-thumb-542217309`
IMAGE_RE = re.compile(
    r"(?:https?:)?//images\.samsung\.com/is/image/samsung/p6pim/[a-z]{2}/[a-z0-9/_.-]*?gallery/"
    r"[a-z0-9-]*?sm-r(?P<num>\d{3})[nb]?z(?P<letter>[a-z])a[a-z0-9-]*",
    re.I,
)
# `…galaxy-buds4-pro-white-sku-sm-r640nzwaxar`, `…galaxy-buds4-pro-pink-gold-online-exclusive-sm-r640nzdaeub/`
SLUG_RE = re.compile(
    r"(?<=/)galaxy-buds(?P<slug>[a-z0-9-]*?)-sm-r(?P<num>\d{3})[nb]?z(?P<letter>[a-z])a",
    re.I,
)

# 650x519 transparent PNG: the size the product pages themselves use for a card.
RENDER_SUFFIX = "?$650_519_PNG$"


def fetch(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Macintosh)"})
    context = ssl.create_default_context()
    with urllib.request.urlopen(request, timeout=40, context=context) as response:
        return response.read().decode("utf-8", errors="replace")


def scrape(html: str) -> dict:
    """{ modelId: { colour: url } } for one page."""
    names = {}
    for match in SLUG_RE.finditer(html):
        words = [word for word in match["slug"].lower().split("-") if word and word not in NOT_COLOUR and not re.fullmatch(r"r\d{3}\w?", word)]
        if words:
            names[(match["num"].lower(), match["letter"].lower())] = " ".join(words).replace("grey", "gray")
    found: dict = {}
    for match in IMAGE_RE.finditer(html):
        model = MODELS.get(match["num"].lower())
        if model is None:
            continue
        letter = match["letter"].lower()
        colour = names.get((match["num"].lower(), letter)) or LETTERS.get(letter)
        if colour is None:
            continue
        url = match[0].split("?")[0]
        if url.startswith("//"):
            url = "https:" + url
        found.setdefault(model, {}).setdefault(colour, url)
    return found


def merge(into: dict, more: dict) -> None:
    for model, colours in more.items():
        for colour, url in colours.items():
            # A page that sells the product (us-, no "thumb") is a better render than a listing thumbnail.
            existing = into.setdefault(model, {}).get(colour)
            if existing is None or ("thumb" in existing and "thumb" not in url):
                into[model][colour] = url


def render(images: dict) -> str:
    lines = [
        "// Generated by scripts/gen-samsung-images.py — do not edit.",
        "// Public product renders from samsung.com's image CDN; see the script for how they were found.",
        "",
        "export interface SamsungRender {",
        "  /** Samsung's name for the finish, lower case (`white`, `black`, `gray`, …). */",
        "  colour: string",
        "  url: string",
        "}",
        "",
        "export const SAMSUNG_RENDERS: Readonly<Record<string, readonly SamsungRender[]>> = {",
    ]
    for model in sorted(images):
        lines.append(f"  {model}: [")
        for colour in sorted(images[model]):
            url = images[model][colour]
            suffix = "" if "?" in url else RENDER_SUFFIX
            lines.append(f"    {{ colour: {json.dumps(colour)}, url: {json.dumps(url + suffix)} }},")
        lines.append("  ],")
    lines += ["}", ""]
    return "\n".join(lines)


def load_extra() -> dict:
    if not EXTRA.exists():
        return {}
    extra = json.loads(EXTRA.read_text())
    out: dict = {}
    for model, value in extra.items():
        out[model] = {"default": value} if isinstance(value, str) else dict(value)
    return out


def self_test() -> None:
    html = (
        '<a href="/us/audio-sound/galaxy-buds4-pro/buy/galaxy-buds4-pro-white-sku-sm-r640nzwaxar">x</a>'
        '"https://images.samsung.com/is/image/samsung/p6pim/us/sm-r640nzwaxar/gallery/us-galaxy-buds4-r640-sm-r640nzwaxar-553270130?$PD_GALLERY_PNG$"'
        '"https://images.samsung.com/is/image/samsung/p6pim/uk/s2602/gallery/uk-galaxy-buds4-r640-sm-r640nzkaeub-thumb-551034371"'
        '"//images.samsung.com/is/image/samsung/p6pim/in/sm-r410nzwainu/gallery/in-galaxy-buds-core-r410-sm-r410nzwainu-thumb-547798416"'
    )
    html += '<a href="/uk/audio-sound/galaxy-buds/galaxy-buds4-pro-pink-gold-online-exclusive-sm-r640nzdaeub/">x</a>'
    html += '"https://images.samsung.com/is/image/samsung/p6pim/uk/s2602/gallery/uk-galaxy-buds4-r640-sm-r640nzdaeub-thumb-551034243"'
    found = scrape(html)
    assert found["buds4Pro"]["pink gold"].endswith("thumb-551034243"), found
    assert found["buds4Pro"]["white"].endswith("us-galaxy-buds4-r640-sm-r640nzwaxar-553270130"), found
    assert found["buds4Pro"]["black"].endswith("thumb-551034371"), found  # letter K, from the table
    assert found["budsCore"]["white"].startswith("https://images.samsung.com/"), found  # protocol-relative src
    assert found["budsCore"]["white"].endswith("thumb-547798416"), found
    merged: dict = {}
    merge(merged, {"buds4Pro": {"black": "https://x/a-thumb-1"}})
    merge(merged, {"buds4Pro": {"black": "https://x/a-2"}})
    assert merged["buds4Pro"]["black"] == "https://x/a-2"
    assert "SAMSUNG_RENDERS" in render(found)
    print("self-test ok")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--self-test", action="store_true", help="offline check of the parsing")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0

    images: dict = {}
    for url in LISTINGS:
        try:
            merge(images, scrape(fetch(url)))
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            print(f"skipped {url}: {error}", file=sys.stderr)
    for model, colours in load_extra().items():
        images.setdefault(model, {}).update(colours)

    if not images:
        print("no renders found; leaving the generated file alone", file=sys.stderr)
        return 1
    OUTPUT.write_text(render(images))
    total = sum(len(colours) for colours in images.values())
    print(f"wrote {OUTPUT}: {total} renders across {len(images)} models")
    return 0


if __name__ == "__main__":
    sys.exit(main())
