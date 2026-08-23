/**
 * Sennheiser's asset catalog and resolver: per-product render sets, keyed by
 * the artwork slug the device profile carries — the folder name under
 * `public/devices/sennheiser/`.
 *
 * Colourways come from the Smart Control Plus app's own image folders (one
 * render set per colour, e.g. `mtw4/graphite_hero.webp`); `patterns` carries
 * the multi-word and special-edition mappings a plain name-scan would miss
 * (M4's "Black Copper" is the brown render, its 80th-anniversary edition the
 * se80y one). Over-ears ship a greyed `_hero_inactive` per colour; earbuds do
 * not, and fall back to the hero, which the component desaturates.
 */

import { asset } from '@/core/artwork'
import type { DeviceArtwork } from '@/core/artwork'
import { profileFor } from '@/core/profiles'

export interface SennheiserArt {
  readonly colourways: readonly string[]
  readonly default: string
  readonly patterns: readonly (readonly [RegExp, string])[]
  readonly hasInactive: boolean
  readonly aspect: number
}

export const SENNHEISER_ART: Record<string, SennheiserArt> = {
  m4: {
    colourways: ['black', 'white', 'graphite', 'brown', 'copper', 'denim', 'teal', 'pride', 'se80y', 'yotd'],
    default: 'black',
    patterns: [
      [/\bblack\b.*\bcopper\b|\bcopper\b.*\bblack\b/i, 'brown'],
      [/\b(80|80y|anniversary)\b/i, 'se80y'],
      [/\bdragon\b/i, 'yotd'],
    ],
    hasInactive: true,
    aspect: 1125 / 558,
  },
  m5: {
    colourways: ['black', 'white', 'denim'],
    default: 'black',
    patterns: [],
    hasInactive: true,
    aspect: 1125 / 558,
  },
  acc1: {
    colourways: ['black', 'white', 'blue', 'copper', 'taupe'],
    default: 'black',
    patterns: [],
    hasInactive: true,
    aspect: 1125 / 558,
  },
  acc_plus1: {
    colourways: ['black', 'white'],
    default: 'black',
    patterns: [],
    hasInactive: true,
    aspect: 1125 / 558,
  },
  acc_tw1: {
    colourways: ['black', 'white', 'blue'],
    default: 'black',
    patterns: [],
    hasInactive: false,
    aspect: 1125 / 558,
  },
  aows1: {
    colourways: ['black', 'cream', 'iceblue'],
    default: 'black',
    patterns: [[/\bice[\s-]*blue\b/i, 'iceblue']],
    hasInactive: false,
    aspect: 1125 / 558,
  },
  cx200_tw: {
    colourways: ['black', 'white'],
    default: 'black',
    patterns: [],
    hasInactive: false,
    aspect: 1125 / 558,
  },
  cx200tw1_sport: {
    colourways: ['black'],
    default: 'black',
    patterns: [],
    hasInactive: false,
    aspect: 1125 / 558,
  },
  cx500_tw: {
    colourways: ['grey'],
    default: 'grey',
    patterns: [],
    hasInactive: false,
    aspect: 1125 / 558,
  },
  cx_plus_tw: {
    colourways: ['black', 'white', 'se'],
    default: 'black',
    patterns: [[/\bse\b/i, 'se']],
    hasInactive: false,
    aspect: 1125 / 558,
  },
  m_sport1: {
    colourways: ['black', 'graphite', 'olive'],
    default: 'black',
    patterns: [],
    hasInactive: false,
    aspect: 1125 / 558,
  },
  mtw3: {
    colourways: ['black', 'white', 'graphite'],
    default: 'black',
    patterns: [],
    hasInactive: false,
    aspect: 1125 / 635,
  },
  mtw4: {
    colourways: ['copper', 'denim', 'gold', 'graphite', 'white'],
    default: 'white',
    // "MTW4 BLACK GRAPHITE" and friends name two colours; the modifier wins.
    patterns: [
      [/\bblack\b.*\bgraphite\b|\bgraphite\b.*\bblack\b/i, 'graphite'],
      [/\bblack\b.*\bcopper\b|\bcopper\b.*\bblack\b/i, 'copper'],
      [/\bwhite\b.*\bsilver\b|\bsilver\b.*\bwhite\b/i, 'white'],
    ],
    hasInactive: false,
    aspect: 1125 / 558,
  },
}

/** The M4's set — the hardware-verified product, and the long-standing default. */
export const SENNHEISER_COLOURWAYS = SENNHEISER_ART.m4.colourways

export type Colourway = string

export const DEFAULT_COLOURWAY: Colourway = 'black'

const escapeForRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Works out the colourway from the model string the headphones report — the
 * M4 reports e.g. "M4AEBT Black", and the family behaves the same way where we
 * have evidence. Multi-word patterns are consulted before single names, so
 * "Black Copper" resolves to the brown render rather than copper. Falls back
 * to the product's default render rather than showing nothing.
 */
export function colourwayFromModel(
  model: string | null,
  art: SennheiserArt = SENNHEISER_ART.m4,
): Colourway {
  if (!model) return art.default
  for (const [pattern, colourway] of art.patterns) {
    if (pattern.test(model)) return colourway
  }
  // Longest names first, so "ice blue" is not claimed by "blue".
  for (const colourway of [...art.colourways].sort((a, b) => b.length - a.length)) {
    if (new RegExp(`\\b${escapeForRegExp(colourway)}\\b`, 'i').test(model)) return colourway
  }
  return art.default
}

export function sennheiserArtwork(model: string | null): DeviceArtwork {
  const profile = profileFor('sennheiser', model)
  const art = profile ? SENNHEISER_ART[profile.artwork] : undefined
  // Unrecognised model, or a product whose renders this app ships only in its
  // encrypted bundle (MTW5, HD 630, HDR 275): the placeholder frame — with no
  // render of the actual device, any other picture would misname it.
  if (!art || !profile) return { hero: '', heroInactive: '', aspect: SENNHEISER_ART.m4.aspect }
  const colourway = colourwayFromModel(model, art)
  const hero = asset(`sennheiser/${profile.artwork}/${colourway}_hero.webp`)
  return {
    hero,
    heroInactive: art.hasInactive
      ? asset(`sennheiser/${profile.artwork}/${colourway}_hero_inactive.webp`)
      : hero,
    aspect: art.aspect,
  }
}
