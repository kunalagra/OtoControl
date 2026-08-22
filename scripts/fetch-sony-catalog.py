#!/usr/bin/env python3
"""Regenerate src/ui/device/sonyCatalog.generated.ts from Sony's own catalog.

Source of truth: the Sound Connect app's GraphQL gateway (extracted from
jp/co/sony/vim/framework/core/device/cloudmodelinfo/CloudModelInfoController).
The app refreshes this once a day; the images it points at live on an
unauthenticated CloudFront/S3 origin as stable GUID URLs, so shipping the URLs
is enough — the x-api-key never reaches the client, exactly like the Nothing
CDN table.

Every model the catalog carries is extracted — the catalog itself is the
model list, so artwork resolves for devices no profile describes yet.

Usage:
    SONY_API_KEY=<key> python3 scripts/fetch-sony-catalog.py
"""

import json
import os
import sys
import urllib.request
from pathlib import Path

ENDPOINT = "https://v1.api.data-gateway.seeds.services/graphql"

QUERY = """
query GetAllCloudModelInfos {
  HPC {
    getAllCloudModelInfos {
      model_id
      model_number
      model_name
      model_color_id
      model_category
      sca_image_image_url
    }
  }
}
"""

HEADER = '''/**
 * Sony product render URLs, from the Sound Connect app's own cloud catalog
 * (`getAllCloudModelInfos` on v1.api.data-gateway.seeds.services — the same
 * query the official app makes daily). GENERATED FILE — regenerate with
 * `SONY_API_KEY=<key> python3 scripts/fetch-sony-catalog.py`.
 *
 * Every model Sony's catalog carries, keyed by lowercased model name (what
 * the serial protocol reports as the model string), then by the two-hex-digit
 * colour code — the same ModelColor enum the BLE advertisement broadcasts and
 * `CONNECT_GET_DEVICE_INFO` returns. The URLs are unauthenticated, stable
 * GUID links; bundled webp renders cover offline use via the artwork
 * fallback chain where a profile exists.
 */
'''

FOOTER = '''
/**
 * The colour to show when the device reports none (0x00 "Default" aliases a
 * real colour in the catalog), or when the reported colour has no render.
 */
export function defaultSonyCatalogUrl(colours: Record<string, string>): string | null {
  return colours['01'] ?? Object.values(colours)[0] ?? null
}
'''

MODELS_HEADER = '''/**
 * Every headphone-class model in Sony\'s Sound Connect catalog, with its form
 * factor derived from Sony\'s own naming convention (WF-/LinkBuds/INZONE Buds
 * are earbuds; WH-/MDR-/WI-neckbands/INZONE H are head-worn). GENERATED FILE
 * — regenerate with `SONY_API_KEY=<key> python3 scripts/fetch-sony-catalog.py`.
 *
 * Speakers (SRS-, ULT FIELD/TOWER, BRAVIA Theatre) are excluded: they do not
 * speak this driver\'s serial protocol.
 *
 * These entries carry NO feature claims — the driver reads each device\'s
 * capability table live on connect, which always wins. A profile exists so
 * an untested model still presents itself correctly: name, form factor,
 * battery layout, square catalog render.
 */
export interface SonyCatalogModel {
  name: string
  form: 'earbuds' | 'over-ear'
}

export const SONY_CATALOG_MODELS: readonly SonyCatalogModel[] = ['''


def form_factor(name: str) -> str | None:
    """Head-worn or earbud, per Sony's own product naming; None for speakers."""
    lowered = name.lower()
    if lowered.startswith(("srs-", "ult field", "ult tower", "bravia")):
        return None
    if lowered == "linkbuds speaker":
        return None
    # ULT WEAR is an over-ear headphone despite the speaker-adjacent brand.
    if lowered.startswith(("wf-", "linkbuds", "inzone buds")):
        return "earbuds"
    return "over-ear"


def main() -> None:
    key = os.environ.get("SONY_API_KEY")
    if not key:
        sys.exit("set SONY_API_KEY (the Sound Connect app's catalog key)")

    body = json.dumps({"query": QUERY}).encode()
    request = urllib.request.Request(
        ENDPOINT,
        data=body,
        headers={"x-api-key": key, "Content-Type": "application/json;charset=utf-8"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.load(response)

    items = payload["data"]["HPC"]["getAllCloudModelInfos"]

    models: dict[str, dict[str, str]] = {}
    for item in items:
        slug = (item.get("model_name") or "").strip().lower()
        url = (item.get("sca_image_image_url") or "").strip()
        colour = (item.get("model_color_id") or "").removeprefix("0x").lower()
        if slug and url.startswith("https://") and colour:
            models.setdefault(slug, {})[colour] = url

    lines = []
    for slug in sorted(models):
        entries = ",\n    ".join(
            f"'{colour}': {json.dumps(url)}" for colour, url in sorted(models[slug].items())
        )
        lines.append(f"  '{slug}': {{\n    {entries},\n  }},")

    out = Path("src/ui/device/sonyCatalog.generated.ts")
    out.write_text(
        HEADER
        + "export const SONY_CATALOG_IMAGES: Record<string, Record<string, string>> = {\n"
        + "\n".join(lines)
        + "\n};\n"
        + FOOTER
    )
    print(f"wrote {out} ({len(models)} models, {sum(len(c) for c in models.values())} renders)")

    # The model list, classified. Drives blanket profiles in core/profiles.ts.
    catalog_names = {(item.get("model_name") or "").strip() for item in items}
    headphone = sorted(
        (name for name in catalog_names if form_factor(name)), key=str.lower
    )
    entries = "\n".join(
        f"  {{ name: {json.dumps(name)}, form: {json.dumps(form_factor(name))} }},"
        for name in headphone
    )
    models_out = Path("src/core/sonyModels.generated.ts")
    models_out.write_text(MODELS_HEADER + "\n" + entries + "\n] as const;\n")
    print(f"wrote {models_out} ({len(headphone)} headphone-class models)")


if __name__ == "__main__":
    main()
