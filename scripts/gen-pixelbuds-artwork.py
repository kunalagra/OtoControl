#!/usr/bin/env python3
"""Regenerate the Pixel Buds artwork: public/devices/pixelbuds/*.png and
src/drivers/pixelbuds/pixelbudsCatalog.generated.ts.

Source of truth: the per-colour earbud renders the Pixel Buds companion app
(com.google.android.apps.wearables.maestro.companion) bundles as drawables,
`budtype_<N>_<colour>.png` in `res/drawable` of the decoded base APK. The app
keys them by `bud_type` — 4 is the Pixel Buds Pro, 6 the Pro 2, as its own
strings.xml names them — and by the colour of the unit's SKU. They are
transparent single-earbud renders, 360x289 to 512x512.

Why not URLs, as the Nothing and HeyMelody drivers use: Google's Store no longer
lists the Pixel Buds Pro, the Pro 2's Store images are JPEGs with a baked-in
background behind a content-hash URL, and the APK references no image CDN (its
only remote asset base is an OTA download URL). The app's own drawables are the
one source that covers both models with transparency, so they are copied in.

The earbuds' Maestro service reports neither colour nor SKU, so the driver shows
each model's DEFAULT colour; the other colours are catalogued for when a source
for the SKU turns up.

Usage:
    python3 scripts/gen-pixelbuds-artwork.py /path/to/decoded/res/drawable
"""

import shutil
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# (model slug, bud_type, {colour key: drawable stem}). Hi-res `porcelain` and `sky`
# of bud type 4 (800 KB each) are left out; add them here if wanted.
MODELS = [
    ('pro', 4, {'charcoal': 'carbon', 'fog': 'fog', 'lemongrass': 'limoncello', 'coral': 'real_red'}),
    ('pro2', 6, {'hazel': 'dark_haze', 'wintergreen': 'mojito', 'porcelain': 'porcelain_white', 'peony': 'raspberry', 'sterling': 'sterling'}),
]
DEFAULT_COLOUR = {'pro': 'fog', 'pro2': 'porcelain'}

HEADER = '''/**
 * Pixel Buds Pro / Pro 2 earbud renders, copied from the companion app's own
 * drawables (`budtype_4_*` Pro, `budtype_6_*` Pro 2). GENERATED FILE —
 * regenerate with scripts/gen-pixelbuds-artwork.py rather than editing here.
 *
 * Keyed by model slug, then colour. Nothing on the wire names the colour, so
 * only DEFAULT_COLOUR is ever shown; the rest are here for a future source.
 */
'''


def png_size(path: Path) -> tuple[int, int]:
    data = path.read_bytes()[:24]
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise SystemExit(f'{path} is not a PNG')
    return struct.unpack('>II', data[16:24])


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    src = Path(sys.argv[1])
    out_dir = ROOT / 'public' / 'devices' / 'pixelbuds'
    out_dir.mkdir(parents=True, exist_ok=True)

    lines = [HEADER, "export interface PixelBudsRender { file: string; width: number; height: number }\n"]
    lines.append('export const PIXELBUDS_RENDERS: Record<string, Record<string, PixelBudsRender>> = {')
    for slug, bud_type, colours in MODELS:
        lines.append(f"  '{slug}': {{")
        for colour, stem in colours.items():
            source = src / f'budtype_{bud_type}_{stem}.png'
            if not source.exists():
                raise SystemExit(f'missing {source}')
            name = f'{slug}-{colour}.png'
            shutil.copyfile(source, out_dir / name)
            w, h = png_size(source)
            lines.append(f"    '{colour}': {{ file: 'pixelbuds/{name}', width: {w}, height: {h} }},")
        lines.append('  },')
    lines.append('};\n')
    lines.append('export const PIXELBUDS_DEFAULT_COLOUR: Record<string, string> = {')
    for slug, colour in DEFAULT_COLOUR.items():
        lines.append(f"  '{slug}': '{colour}',")
    lines.append('};\n')
    (ROOT / 'src' / 'drivers' / 'pixelbuds' / 'pixelbudsCatalog.generated.ts').write_text('\n'.join(lines))
    print('wrote catalog and', len(list(out_dir.glob('*.png'))), 'images')


if __name__ == '__main__':
    main()
