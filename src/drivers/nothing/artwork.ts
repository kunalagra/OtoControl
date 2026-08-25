/**
 * Nothing's artwork resolver: the app ships no product renders — it loads
 * them from their CDN at runtime, from the URLs in its own
 * `devices_info_list.json`. This driver does the same with that config's
 * URLs (`nothingCdn.generated.ts`), so no per-model art is bundled: a model
 * costs one table entry, and renders stay current with Nothing's. One
 * bundled webp covers offline use; the serial link itself needs nothing from
 * the CDN.
 *
 * No greyed variant exists, so the disconnected state reuses the hero and
 * relies on the desaturation the component applies.
 */

import { asset } from '@/core/artwork'
import type { DeviceArtwork } from '@/core/artwork'
import { profileFor } from '@/core/profiles'
import { NOTHING_CDN_IMAGES, defaultColourUrl } from './nothingCdn.generated'

const NOTHING_ASPECT = 1

export function nothingArtwork(model: string | null, colourId?: string | null): DeviceArtwork {
  const slug = profileFor('nothing', model)?.artwork
  const colours = slug ? NOTHING_CDN_IMAGES[slug] : undefined
  // The device's own colourway when it reported one and the table has that
  // render; otherwise the table's default, which is how this worked before
  // `Read.ColourId` was wired up.
  const exact = colours && colourId ? colours[colourId] : undefined
  const hero = exact ?? (colours && defaultColourUrl(colours)) ?? asset('nothing/fallback.webp')
  return { hero, heroInactive: hero, aspect: NOTHING_ASPECT, fallback: asset('nothing/fallback.webp') }
}

/**
 * Whether the render table has this model in this colour.
 *
 * False means the device named a colour the table has no picture of — the
 * table comes from the app's SKU catalogue, so a colourway released after that
 * app build simply is not in it. The hero falls back to the model's default
 * render, which is the right product in the wrong colour; this lets the UI say
 * so rather than quietly showing black.
 */
export function nothingHasColourRender(model: string | null, colourId: string | null): boolean {
  if (colourId === null) return false
  const slug = profileFor('nothing', model)?.artwork
  return slug ? NOTHING_CDN_IMAGES[slug]?.[colourId] !== undefined : false
}
