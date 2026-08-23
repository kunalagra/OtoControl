/**
 * The asset catalog for the Soundcore products we bundle renders for — one
 * entry per product, keyed by the artwork slug the device profile carries.
 *
 * `hero` is the main render (`com_device` in the app's resources); `buds`,
 * when present, are the separate per-bud renders the official app's home
 * screen uses to fade the one docked in the case charging — photos
 * (`home_device_l/_r`) where the app ships them, line-art equivalents
 * otherwise. The over-ears and a few older models (a3951 among them) ship no
 * per-bud art and stay on the hero alone.
 *
 * Filenames carry their actual format — the vendor ships WebP for most of
 * these and PNG for the rest, and files are bundled exactly as they came
 * rather than re-encoded into one format. A new product's entry is whatever
 * its extraction produced, extension included.
 */

import { asset } from '@/core/artwork'
import type { DeviceArtwork } from '@/core/artwork'
import { profileFor } from '@/core/profiles'

export const SOUNDCORE_ASSETS: Record<string, { hero: string; buds?: { left: string; right: string } }> = {
  a3951: { hero: 'a3951_hero.webp' },
  a3035: { hero: 'a3035_hero.webp' },
  a3040: { hero: 'a3040_hero.webp' },
  a3062: { hero: 'a3062_hero.webp' },
  a3927: { hero: 'a3927_hero.webp', buds: { left: 'a3927_bud_l.webp', right: 'a3927_bud_r.webp' } },
  a3933: { hero: 'a3933_hero.webp', buds: { left: 'a3933_bud_l.webp', right: 'a3933_bud_r.webp' } },
  a3936: { hero: 'a3936_hero.webp', buds: { left: 'a3936_bud_l.webp', right: 'a3936_bud_r.webp' } },
  a3937: { hero: 'a3937_hero.webp', buds: { left: 'a3937_bud_l.webp', right: 'a3937_bud_r.webp' } },
  a3939: { hero: 'a3939_hero.webp', buds: { left: 'a3939_bud_l.webp', right: 'a3939_bud_r.webp' } },
  a3943: { hero: 'a3943_hero.webp', buds: { left: 'a3943_bud_l.png', right: 'a3943_bud_r.png' } },
  a3944: { hero: 'a3944_hero.webp', buds: { left: 'a3944_bud_l.png', right: 'a3944_bud_r.png' } },
  a3945: { hero: 'a3945_hero.webp' },
  a3947: { hero: 'a3947_hero.webp', buds: { left: 'a3947_bud_l.webp', right: 'a3947_bud_r.webp' } },
  a3948: { hero: 'a3948_hero.webp', buds: { left: 'a3948_bud_l.webp', right: 'a3948_bud_r.webp' } },
  a3949: { hero: 'a3949_hero.webp', buds: { left: 'a3949_bud_l.webp', right: 'a3949_bud_r.webp' } },
  a3952: { hero: 'a3952_hero.webp', buds: { left: 'a3952_bud_l.png', right: 'a3952_bud_r.png' } },
  a3953: { hero: 'a3953_hero.webp', buds: { left: 'a3953_bud_l.webp', right: 'a3953_bud_r.webp' } },
  a3954: { hero: 'a3954_hero.webp', buds: { left: 'a3954_bud_l.webp', right: 'a3954_bud_r.webp' } },
  a3955: { hero: 'a3955_hero.webp', buds: { left: 'a3955_bud_l.webp', right: 'a3955_bud_r.webp' } },
  a3957: { hero: 'a3957_hero.webp', buds: { left: 'a3957_bud_l.webp', right: 'a3957_bud_r.webp' } },
  a3958: { hero: 'a3958_hero.webp', buds: { left: 'a3958_bud_l.png', right: 'a3958_bud_r.png' } },
  a3959: { hero: 'a3959_hero.webp', buds: { left: 'a3959_bud_l.webp', right: 'a3959_bud_r.webp' } },
  a3982: { hero: 'a3982_hero.webp' },
  a3983: { hero: 'a3983_hero.webp' },
  a3994: { hero: 'a3994_hero.webp', buds: { left: 'a3994_bud_l.webp', right: 'a3994_bud_r.webp' } },
}

export function soundcoreArtwork(model: string | null, productCode?: string | null): DeviceArtwork {
  // The product code wins: it is read off the serial itself, while the model
  // string is whatever the device puts in its advertisement — a name that can
  // be shortened ("Liberty Air 2 Pro") or missing entirely.
  const slug =
    productCode && SOUNDCORE_ASSETS[productCode]
      ? productCode
      : profileFor('soundcore', model)?.artwork
  const entry = slug ? SOUNDCORE_ASSETS[slug] : undefined
  const hero = entry ? asset(`soundcore/${entry.hero}`) : asset('soundcore/placeholder.svg')
  return {
    hero,
    heroInactive: hero,
    aspect: 1,
    ...(entry?.buds
      ? {
          budLeft: asset(`soundcore/${entry.buds.left}`),
          budRight: asset(`soundcore/${entry.buds.right}`),
        }
      : {}),
  }
}
