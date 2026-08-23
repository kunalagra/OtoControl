#!/usr/bin/env python3
"""Regenerate src/drivers/nothing/nothingCdn.generated.ts from the official app.

Source of truth: `devices_info_list.json` inside the decompiled Nothing X APK
(com.nothing.smartcenter), at
`assets/flutter_assets/assets/config/devices_info_list.json` after unzipping
the base APK. The app itself downloads these CloudFront URLs at runtime, so
they are the canonical per-model product renders.

Usage:
    python3 scripts/gen-nothing-cdn.py /path/to/devices_info_list.json
"""

import json
import sys
from pathlib import Path

# Every earphone model the driver knows, in drivers/nothing/models.ts order.
WANTED = [
    'B181', 'B157', 'B155', 'B162', 'B171', 'B174', 'B163', 'B168', 'B172', 'B164',
    'B173', 'B183', 'B190', 'B179', 'B184', 'B185', 'B187', 'B189',
    'B170', 'B186', 'B198', 'B175',
]

HEADER = '''/**
 * Nothing/CMF product render URLs, straight from the official Nothing X app's
 * `devices_info_list.json` (com.nothing.smartcenter, extracted from the APK's
 * flutter assets). GENERATED FILE — regenerate with scripts/gen-nothing-cdn.py
 * rather than editing here.
 *
 * Keyed by the lowercased B1xx base code (the artwork slug `PROFILES` carries
 * for this brand), then by the official colourId. The colourId itself is only
 * readable over BLE, never over serial, so the artwork picker defaults to
 * black and cannot follow the device's actual colour.
 *
 * Nothing's own app loads these same URLs at runtime; the CDN serves them
 * unauthenticated. One bundled webp (fallback.webp) covers offline use.
 */
'''

FOOTER = '''
/**
 * The colour to show when the device's own colour is unknowable over serial.
 * Prefers a URL that names black outright — B155's config has colourId 01
 * pointing at a "White" file, so the id alone is not trustworthy.
 */
export function defaultColourUrl(colours: Record<string, string>): string | null {
  const black = Object.values(colours).find((url) => /black/i.test(url))
  return black ?? Object.values(colours)[0] ?? null
}
'''


def main() -> None:
    config_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('devices_info_list.json')
    data = json.loads(config_path.read_text())

    models: dict[str, dict[str, str]] = {}
    for sku in data['deviceSkuResps']:
        spu = sku.get('deviceSpu', {})
        model_id = spu.get('modelId')
        url = sku.get('globalImageUrl')
        colour = sku.get('colorId')
        if spu.get('type') == 'earphone' and model_id and url and colour:
            models.setdefault(model_id, {})[colour] = url

    lines = []
    missing = []
    for model_id in WANTED:
        colours = models.get(model_id)
        if not colours:
            missing.append(model_id)
            continue
        entries = ',\n    '.join(
            f"'{colour}': {json.dumps(url)}" for colour, url in sorted(colours.items())
        )
        lines.append(f"  '{model_id.lower()}': {{\n    {entries},\n  }},")

    if missing:
        print(f'missing from config: {", ".join(missing)}', file=sys.stderr)

    out = Path('src/drivers/nothing/nothingCdn.generated.ts')
    out.write_text(
        HEADER
        + 'export const NOTHING_CDN_IMAGES: Record<string, Record<string, string>> = {\n'
        + '\n'.join(lines)
        + '\n};\n'
        + FOOTER
    )
    print(f'wrote {out} ({len(WANTED) - len(missing)}/{len(WANTED)} models)')


if __name__ == '__main__':
    main()
