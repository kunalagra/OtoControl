/**
 * Product renders, per brand.
 *
 * Vendors' own artwork, used here for a personal interop tool. Files live in
 * `public/devices/<brand>/` and are referenced by URL rather than bundled, so
 * the browser only downloads the one device in use.
 *
 * Aspect ratios differ per vendor — Sennheiser's heroes are 2.016:1, Sony's
 * 2.561:1 — so each entry carries its own, and the frame matches the source
 * rather than letterboxing it.
 *
 * Keyed on `Brand` rather than `DriverId`, deliberately: the key *is* the
 * asset folder name under `public/devices/`, and it is the same key
 * `PROFILES` is filed under — this module reads a profile for every aspect
 * and slug it resolves. A driver id would fork the two apart for no gain.
 */

import type { Brand } from '@/core/brand'
import { profileFor } from '@/core/profiles'
import { NOTHING_CDN_IMAGES, defaultColourUrl } from './nothingCdn.generated'
import { SONY_CATALOG_IMAGES, defaultSonyCatalogUrl } from './sonyCatalog.generated'

export interface DeviceArtwork {
  hero: string
  /** Greyed render for the disconnected state; falls back to `hero`. */
  heroInactive: string
  /** width / height of the source image. */
  aspect: number
  /**
   * A bundled URL to swap in when `hero`/`heroInactive` fail to load — for
   * artwork served from a CDN, offline. Absent when the hero is already local
   * (Sony, Sennheiser) and cannot 404.
   */
  fallback?: string
}

const asset = (path: string): string => `${import.meta.env.BASE_URL}devices/${path}`

// --- Sennheiser -----------------------------------------------------------

/** Extracted from the Smart Control APK; one set per colourway. */
export const SENNHEISER_COLOURWAYS = [
  'black',
  'white',
  'graphite',
  'brown',
  'copper',
  'denim',
  'teal',
  'pride',
  'se80y',
  'yotd',
] as const

export type Colourway = (typeof SENNHEISER_COLOURWAYS)[number]

export const DEFAULT_COLOURWAY: Colourway = 'black'

const SENNHEISER_ASPECT = 1125 / 558

/** Colour names as they appear in the model string, mapped to asset prefixes. */
const COLOURWAY_MATCHES: Array<[RegExp, Colourway]> = [
  [/\bblack\b.*\bcopper\b|\bcopper\b.*\bblack\b/i, 'brown'],
  [/\bgraphite\b/i, 'graphite'],
  [/\bcopper\b/i, 'copper'],
  [/\bdenim\b/i, 'denim'],
  [/\bteal\b/i, 'teal'],
  [/\bpride\b/i, 'pride'],
  [/\b(80|80y|anniversary)\b/i, 'se80y'],
  [/\bdragon\b/i, 'yotd'],
  [/\bwhite\b/i, 'white'],
  [/\bblack\b/i, 'black'],
]

/**
 * Works out the colourway from the model string the headphones report, e.g.
 * "M4AEBT Black". Falls back to black rather than showing nothing.
 */
export function colourwayFromModel(model: string | null): Colourway {
  if (!model) return DEFAULT_COLOURWAY
  for (const [pattern, colourway] of COLOURWAY_MATCHES) {
    if (pattern.test(model)) return colourway
  }
  return DEFAULT_COLOURWAY
}

function sennheiserArtwork(model: string | null): DeviceArtwork {
  const colourway = colourwayFromModel(model)
  return {
    hero: asset(`sennheiser/${colourway}_hero.webp`),
    heroInactive: asset(`sennheiser/${colourway}_hero_inactive.webp`),
    aspect: profileFor('sennheiser', model)?.artworkAspect ?? SENNHEISER_ASPECT,
  }
}

// --- Sony -----------------------------------------------------------------

/** Used only when no profile matches, so no profile can supply an aspect. */
const SONY_ASPECT = 2028 / 792

/**
 * Sony publishes transparent renders on its product pages; these came from
 * there via `scripts/fetch-sony-assets.sh`. No greyed variant exists, so the
 * disconnected state reuses the same image and relies on the desaturation the
 * component applies.
 */
const SONY_FALLBACK_MODEL = 'wf-c500'
const SONY_FALLBACK_COLOUR = 'black'

/**
 * Views available per colourway, named from Sony's own alt text.
 *
 * Orange and green have no standalone `case` shot on the product page, so
 * `sonyView` falls back rather than pointing at a file that does not exist.
 */
export const SONY_VIEWS = ['hero', 'front', 'case-open', 'case'] as const

export type SonyView = (typeof SONY_VIEWS)[number]

const SONY_COLOURS_WITH_CASE_SHOT = new Set(['black', 'white'])

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
 * Asset slug for a colour byte, or null when we have no render for it.
 *
 * Only the four the WF-C500 ships in are present — knowing a colour's name
 * does not mean we have artwork for it.
 */
const SONY_COLOUR_SLUGS: Record<number, string> = {
  0x01: 'black',
  0x02: 'white',
  0x03: 'silver',
  0x05: 'blue',
  0x06: 'pink',
  0x08: 'green',
  0x0c: 'orange',
}

/**
 * Asset slug for a colour byte, or null when this model has no render for it.
 *
 * Both halves matter: the colour has to be one we can name, *and* one this
 * particular model shipped in. A WF-C500 reporting Silver is a colour we know
 * the name of and have no picture of, so it falls back rather than requesting
 * a file that only exists for the XM5.
 */
export function sonyColourSlug(
  model: string | null,
  code: number | null | undefined,
): string | null {
  if (code == null) return null
  const normalised = normaliseSonyColour(code)
  const profile = profileFor('sony', model)
  if (profile && !profile.artworkColours.includes(normalised)) return null
  return SONY_COLOUR_SLUGS[normalised] ?? null
}

/**
 * The asset prefix comes from the device profile, so a new model is added in
 * one place rather than here and there.
 */
const sonyModelSlug = (model: string | null): string =>
  profileFor('sony', model)?.artwork ?? SONY_FALLBACK_MODEL

/**
 * A specific view of a Sony device — used for the in-case state, which earbuds
 * report and over-ears do not. Falls back to `hero` for combinations Sony does
 * not publish.
 */
export function sonyView(
  model: string | null,
  colourCode: number | null | undefined,
  view: SonyView,
): string {
  const colour = sonyColourSlug(model, colourCode) ?? SONY_FALLBACK_COLOUR
  // Over-ears have no charging case, so those views can never resolve.
  const hasCase = profileFor('sony', model)?.hasCase ?? true
  const caseView = view === 'case' || view === 'case-open'
  const available =
    (!caseView || hasCase) && (view !== 'case' || SONY_COLOURS_WITH_CASE_SHOT.has(colour))
  return asset(`sony/${sonyModelSlug(model)}_${colour}_${available ? view : 'hero'}.webp`)
}

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

function sonyArtwork(model: string | null, colourCode?: number | null): DeviceArtwork {
  const profile = profileFor('sony', model)
  const local = sonyView(model, colourCode, 'hero')
  const remote = sonyCatalogHero(model, colourCode)

  // Cataloged but not yet profiled: Sony's render in its native square
  // frame, and no bundled fallback — the only local art we hold belongs to
  // other models, and showing one device's picture for another's would be
  // worse than an empty frame.
  if (remote && !profile) {
    return { hero: remote, heroInactive: remote, aspect: 1 }
  }

  return {
    // Sony's own render when the catalog knows this model+colour; the
    // bundled product-page shot covers offline use and rotated links.
    hero: remote ?? local,
    heroInactive: remote ?? local,
    aspect: profile?.artworkAspect ?? SONY_ASPECT,
    ...(remote ? { fallback: local } : {}),
  }
}

// --- Nothing ---------------------------------------------------------------

/**
 * Nothing's app ships no product renders either — it loads them from their
 * CDN at runtime, from the URLs in its own `devices_info_list.json`. This app
 * does the same with that config's URLs (`nothingCdn.generated.ts`), so no
 * per-model art is bundled: a model costs one table entry, and renders stay
 * current with Nothing's. One bundled webp covers offline use; the serial link
 * itself needs nothing from the CDN.
 *
 * No greyed variant exists, so the disconnected state reuses the hero and
 * relies on the desaturation the component applies.
 */
const NOTHING_FALLBACK = 'devices/nothing/fallback.webp'
const NOTHING_ASPECT = 1

function nothingArtwork(model: string | null): DeviceArtwork {
  const slug = profileFor('nothing', model)?.artwork
  const colours = slug ? NOTHING_CDN_IMAGES[slug] : undefined
  const hero = (colours && defaultColourUrl(colours)) ?? import.meta.env.BASE_URL + NOTHING_FALLBACK
  return { hero, heroInactive: hero, aspect: NOTHING_ASPECT, fallback: import.meta.env.BASE_URL + NOTHING_FALLBACK }
}

// --- Soundcore ---------------------------------------------------------------

/**
 * The official app bundles these renders in its APK (unlike Nothing, whose
 * are on a CDN); extracted from the decompiled resources and resized. The
 * A3951's render comes from SoundcoreManager's own assets instead — the
 * current app no longer ships art for it. Anything else unmapped falls back
 * to a placeholder.
 *
 * Colour variants exist in the resource naming for a couple of models, but
 * the wire protocol carries no colour: the app reads it from BLE advertising
 * this serial link cannot see, so every model shows its default render.
 */
const SOUNDCORE_HEROES = new Set([
  'a3951',
  'a3035', 'a3040', 'a3062', 'a3927', 'a3933', 'a3936', 'a3937', 'a3939', 'a3943', 'a3944',
  'a3945', 'a3947', 'a3948', 'a3949', 'a3952', 'a3953', 'a3954', 'a3955', 'a3957', 'a3958',
  'a3959', 'a3982', 'a3983', 'a3994',
])

function soundcoreArtwork(model: string | null, productCode?: string | null): DeviceArtwork {
  // The product code wins: it is read off the serial itself, while the model
  // string is whatever the device puts in its advertisement — a name that can
  // be shortened ("Liberty Air 2 Pro") or missing entirely.
  const slug =
    (productCode && SOUNDCORE_HEROES.has(productCode) && productCode) ||
    profileFor('soundcore', model)?.artwork
  const hero =
    slug && SOUNDCORE_HEROES.has(slug)
      ? asset(`soundcore/${slug}_hero.webp`)
      : asset('soundcore/placeholder.svg')
  return { hero, heroInactive: hero, aspect: 1 }
}

// --- dispatch -------------------------------------------------------------

/**
 * `colourCode` is only meaningful for brands that report colour separately;
 * Sennheiser carries it in the model string and ignores this.
 * `productCode` is only meaningful for Soundcore.
 */
export function artworkFor(
  brand: Brand,
  model: string | null,
  colourCode?: number | null,
  productCode?: string | null,
): DeviceArtwork {
  if (brand === 'soundcore') return soundcoreArtwork(model, productCode)
  if (brand === 'nothing') return nothingArtwork(model)
  return brand === 'sony' ? sonyArtwork(model, colourCode) : sennheiserArtwork(model)
}
