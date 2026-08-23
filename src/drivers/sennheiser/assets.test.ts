import { describe, expect, it } from 'vitest';

import {
  DEFAULT_COLOURWAY,
  SENNHEISER_COLOURWAYS,
  colourwayFromModel,
  sennheiserArtwork,
} from './assets';

describe('colourwayFromModel', () => {
  it('reads the colour the headphones actually report', () => {
    expect(colourwayFromModel('M4AEBT Black')).toBe('black');
  });

  it('recognises each plain colour name', () => {
    expect(colourwayFromModel('M4AEBT White')).toBe('white');
    expect(colourwayFromModel('M4AEBT Graphite')).toBe('graphite');
    expect(colourwayFromModel('M4AEBT Denim')).toBe('denim');
    expect(colourwayFromModel('M4AEBT Teal')).toBe('teal');
  });

  it('maps Black/Copper to the brown render, not black or copper', () => {
    expect(colourwayFromModel('M4AEBT Black Copper')).toBe('brown');
    expect(colourwayFromModel('M4AEBT Copper Black')).toBe('brown');
  });

  it('recognises the special editions', () => {
    expect(colourwayFromModel('M4AEBT Pride')).toBe('pride');
    expect(colourwayFromModel('M4AEBT Year of the Dragon')).toBe('yotd');
    expect(colourwayFromModel('M4AEBT 80 Anniversary')).toBe('se80y');
  });

  it('falls back to black rather than showing nothing', () => {
    expect(colourwayFromModel(null)).toBe(DEFAULT_COLOURWAY);
    expect(colourwayFromModel('')).toBe(DEFAULT_COLOURWAY);
    expect(colourwayFromModel('Some Unknown Headphone')).toBe(DEFAULT_COLOURWAY);
  });

  it('always returns a colourway we have assets for', () => {
    for (const model of ['M4AEBT Black', 'nonsense', '', 'M4AEBT Pride']) {
      expect(SENNHEISER_COLOURWAYS).toContain(colourwayFromModel(model));
    }
  });

  it('prefers the longest colour name and the spaced form via its pattern', () => {
    expect(sennheiserArtwork('AOWS1 Ice Blue').hero).toContain('aows1/iceblue_hero.webp');
    expect(sennheiserArtwork('AOWS1 Black').hero).toContain('aows1/black_hero.webp');
  });
});

describe('sennheiserArtwork', () => {
  it('resolves renders by colourway, under the product folder', () => {
    const art = sennheiserArtwork('M4AEBT Black');
    expect(art.hero).toContain('devices/sennheiser/m4/black_hero.webp');
    expect(art.heroInactive).toContain('devices/sennheiser/m4/black_hero_inactive.webp');
  });

  it('serves the newer GAIA family from their own render folders', () => {
    expect(sennheiserArtwork('M5AEBT Black').hero).toContain('sennheiser/m5/black_hero.webp');
    expect(sennheiserArtwork('MOMENTUM True Wireless 4').hero).toContain('sennheiser/mtw4/white_hero.webp');
    expect(sennheiserArtwork('ACCENTUM Wireless').hero).toContain('sennheiser/acc1/black_hero.webp');
    expect(sennheiserArtwork('CX 200BT TW').hero).toContain('sennheiser/cx200_tw/black_hero.webp');
  });

  it('maps MTW4 two-word colour names to the modifier render', () => {
    expect(sennheiserArtwork('MTW4 BLACK GRAPHITE').hero).toContain('mtw4/graphite_hero.webp');
    expect(sennheiserArtwork('MTW4 BLACK COPPER').hero).toContain('mtw4/copper_hero.webp');
    expect(sennheiserArtwork('MTW4 WHITE SILVER').hero).toContain('mtw4/white_hero.webp');
  });

  it('reuses the hero for earbuds, which ship no inactive render', () => {
    const art = sennheiserArtwork('MOMENTUM True Wireless 3');
    expect(art.heroInactive).toBe(art.hero);
  });

  it('yields the placeholder for a product whose renders are not extracted', () => {
    // MTW5 exists in the app only as encrypted blobs we have not mapped.
    const art = sennheiserArtwork('MTW5_WHITE');
    expect(art.hero).toBe('');
    expect(art.heroInactive).toBe('');
  });

  it('gives the M4 render width its own aspect', () => {
    expect(sennheiserArtwork('M4AEBT Black').aspect).toBeCloseTo(1125 / 558, 3);
  });

  it('yields the placeholder for a model no profile names', () => {
    // With per-product folders there is no honest picture for an unknown
    // model — the placeholder, same policy as Sony's catalog-only art.
    const art = sennheiserArtwork('Something Unknown');
    expect(art.hero).toBe('');
    expect(art.aspect).toBeGreaterThan(1);
  });
});
