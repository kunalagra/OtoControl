/**
 * Pixel Buds Pro / Pro 2 earbud renders, copied from the companion app's own
 * drawables (`budtype_4_*` Pro, `budtype_6_*` Pro 2). GENERATED FILE —
 * regenerate with scripts/gen-pixelbuds-artwork.py rather than editing here.
 *
 * Keyed by model slug, then colour. Nothing on the wire names the colour, so
 * only DEFAULT_COLOUR is ever shown; the rest are here for a future source.
 */

export interface PixelBudsRender { file: string; width: number; height: number }

export const PIXELBUDS_RENDERS: Record<string, Record<string, PixelBudsRender>> = {
  'pro': {
    'charcoal': { file: 'pixelbuds/pro-charcoal.png', width: 360, height: 289 },
    'fog': { file: 'pixelbuds/pro-fog.png', width: 360, height: 289 },
    'lemongrass': { file: 'pixelbuds/pro-lemongrass.png', width: 360, height: 289 },
    'coral': { file: 'pixelbuds/pro-coral.png', width: 360, height: 289 },
  },
  'pro2': {
    'hazel': { file: 'pixelbuds/pro2-hazel.png', width: 512, height: 512 },
    'wintergreen': { file: 'pixelbuds/pro2-wintergreen.png', width: 512, height: 512 },
    'porcelain': { file: 'pixelbuds/pro2-porcelain.png', width: 512, height: 512 },
    'peony': { file: 'pixelbuds/pro2-peony.png', width: 512, height: 512 },
    'sterling': { file: 'pixelbuds/pro2-sterling.png', width: 512, height: 512 },
  },
};

export const PIXELBUDS_DEFAULT_COLOUR: Record<string, string> = {
  'pro': 'fog',
  'pro2': 'porcelain',
};
