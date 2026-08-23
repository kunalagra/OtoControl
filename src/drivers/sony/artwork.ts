/**
 * Sony's artwork resolver: catalog-only, no bundled renders.
 *
 * `SONY_CATALOG_IMAGES` holds the URLs Sony publishes on its own product
 * pages, keyed by the exact model string the serial protocol reports. Offline
 * (or a rotated link) means the placeholder frame — the same trade Nothing's
 * CDN artwork makes, minus the one bundled fallback, because Sony's catalog
 * covers every model it has listed and an unknown model has no honest picture
 * to show.
 */

import type { DeviceArtwork } from '@/core/artwork'
import { SONY_CATALOG_IMAGES, defaultSonyCatalogUrl } from './sonyCatalog.generated'

/**
 * Sony's colour enum, from `com.sony.songpal.util.modelinfo.ModelColor` in the
 * Sound Connect app — not inferred. The same byte is broadcast in the BLE
 * advertisement (offset 5) and returned over RFCOMM by
 * `CONNECT_GET_DEVICE_INFO` value type 0x03.
 *
 * It is a manufacturing constant per SKU, so it identifies the colour the unit
 * was built as. It cannot know about a case or skin fitted afterwards.
 *
 * `0x01` = Black is confirmed against hardware; the rest come from the enum.
 */
const SONY_COLOUR_NAMES: Record<number, string> = {
  0x00: 'Default',
  0x01: 'Black',
  0x02: 'White',
  0x03: 'Silver',
  0x04: 'Red',
  0x05: 'Blue',
  0x06: 'Pink',
  0x07: 'Yellow',
  0x08: 'Green',
  0x09: 'Gray',
  0x0a: 'Gold',
  0x0b: 'Cream',
  0x0c: 'Orange',
  0x0d: 'Brown',
  0x0e: 'Violet',
}

/**
 * The enum also carries "-I" variants at `base + 16` (Black 1 / Black-I 17),
 * which are the same colour rendered inactive. Normalise before looking up.
 */
const INACTIVE_OFFSET = 16

export const normaliseSonyColour = (code: number): number =>
  code > INACTIVE_OFFSET ? code - INACTIVE_OFFSET : code

/** Display name for a colour byte, e.g. 'Black'. */
export const sonyColourName = (code: number | null | undefined): string | null =>
  code == null ? null : (SONY_COLOUR_NAMES[normaliseSonyColour(code)] ?? null)

/**
 * Sony's own catalog render for this model and colour, when the catalog
 * knows one. Keyed by the model string itself — the serial protocol reports
 * exactly the name the catalog carries — so artwork resolves for every model
 * Sony lists, profile or no profile. The catalog is also the authority on
 * which colours exist per model: a colour with no entry falls back to the
 * default-colour render.
 */
function sonyCatalogHero(model: string | null, colourCode?: number | null): string | null {
  if (!model) return null
  const colours = SONY_CATALOG_IMAGES[model.trim().toLowerCase()]
  if (!colours) return null
  if (colourCode != null) {
    const exact = colours[colourCode.toString(16).padStart(2, '0')]
    if (exact) return exact
  }
  return defaultSonyCatalogUrl(colours)
}

export function sonyArtwork(model: string | null, colourCode?: number | null): DeviceArtwork {
  const remote = sonyCatalogHero(model, colourCode)
  // No greyed variant exists, so the disconnected state reuses the hero and
  // relies on the desaturation the component applies. A model the catalog
  // does not know gets the placeholder frame — with no local renders left,
  // showing another device's picture would be the only alternative.
  if (!remote) return { hero: '', heroInactive: '', aspect: 1 }
  return { hero: remote, heroInactive: remote, aspect: 1 }
}
