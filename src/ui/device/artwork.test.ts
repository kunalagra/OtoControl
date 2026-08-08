import { describe, expect, it } from 'vitest';

import {
  DEFAULT_COLOURWAY,
  SENNHEISER_COLOURWAYS,
  artworkFor,
  colourwayFromModel,
  SONY_VIEWS,
  normaliseSonyColour,
  sonyColourName,
  sonyColourSlug,
  sonyView,
} from './artwork';

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
});

describe('artworkFor', () => {
  it('resolves Sennheiser renders by colourway, under the brand folder', () => {
    const art = artworkFor('sennheiser', 'M4AEBT Black');
    expect(art.hero).toContain('devices/sennheiser/black_hero.webp');
    expect(art.heroInactive).toContain('devices/sennheiser/black_hero_inactive.webp');
  });

  it('resolves the Sony render, including the colourway', () => {
    // 0x01 = black, the one pairing verified on hardware.
    const art = artworkFor('sony', 'WF-C500', 0x01);
    expect(art.hero).toContain('devices/sony/wf-c500_black_hero.webp');
  });

  it('falls back to a render we have when there is no artwork for the colour', () => {
    // 0x04 Red is a real colour with no WF-C500 render.
    for (const code of [undefined, null, 0x00, 0x04, 0xff]) {
      expect(artworkFor('sony', 'WF-C500', code).hero).toContain('wf-c500_black_hero.webp');
    }
  });

  it("names colours from Sony's own ModelColor enum", () => {
    expect(sonyColourName(0x01)).toBe('Black');
    expect(sonyColourName(0x02)).toBe('White');
    expect(sonyColourName(0x08)).toBe('Green');
    expect(sonyColourName(0x0c)).toBe('Orange');
    expect(sonyColourName(0x00)).toBe('Default');
  });

  it('treats the "-I" variants as the same colour, offset by 16', () => {
    // Black 1 / Black-I 17, Green 8 / Green-I 24.
    expect(sonyColourName(0x11)).toBe('Black');
    expect(sonyColourName(0x18)).toBe('Green');
    expect(normaliseSonyColour(0x1e)).toBe(0x0e);
  });

  it('returns null for a byte outside the enum', () => {
    expect(sonyColourName(0x7f)).toBeNull();
    expect(sonyColourName(null)).toBeNull();
    expect(sonyColourName(undefined)).toBeNull();
  });

  it('has a render only for the colours the WF-C500 ships in', () => {
    expect(sonyColourSlug('WF-C500', 0x01)).toBe('black');
    expect(sonyColourSlug('WF-C500', 0x02)).toBe('white');
    expect(sonyColourSlug('WF-C500', 0x08)).toBe('green');
    expect(sonyColourSlug('WF-C500', 0x0c)).toBe('orange');
    // Named, but no artwork — must not resolve to a missing file.
    expect(sonyColourSlug('WF-C500', 0x04)).toBeNull();
  });

  it('scopes colour artwork to the model that ships in it', () => {
    // Silver and blue are XM5 colourways. Asking for them on a WF-C500 must
    // not resolve, or the app requests a file only the XM5 has.
    expect(sonyColourSlug('WH-1000XM5', 0x03)).toBe('silver');
    expect(sonyColourSlug('WH-1000XM5', 0x05)).toBe('blue');
    expect(sonyColourSlug('WF-C500', 0x03)).toBeNull();
    expect(sonyColourSlug('WF-C500', 0x05)).toBeNull();
    // And the reverse: green is a C500 colour, not an XM5 one.
    expect(sonyColourSlug('WH-1000XM5', 0x08)).toBeNull();
  });

  it('resolves an inactive-variant byte to the same render', () => {
    expect(sonyColourSlug('WF-C500', 0x11)).toBe('black');
  });

  it('falls back to the hero for a case shot Sony does not publish', () => {
    // Orange and green have no standalone charging-case image.
    expect(sonyView('WF-C500', 0x01, 'case')).toContain('black_case.webp');
    expect(sonyView('WF-C500', 0x99, 'case')).toContain('black_case.webp');
  });

  it('serves every published view', () => {
    for (const view of SONY_VIEWS) {
      expect(sonyView('WF-C500', 0x01, view)).toContain(`black_${view}.webp`);
    }
  });

  it('ignores a colour code for Sennheiser, which encodes it in the model', () => {
    expect(artworkFor('sennheiser', 'M4AEBT White', 0x01).hero).toContain('white_hero.webp');
  });

  it('reuses the Sony hero when disconnected, since no greyed render exists', () => {
    const art = artworkFor('sony', 'WF-C500');
    expect(art.heroInactive).toBe(art.hero);
  });

  it('gives each brand the aspect of its own source images', () => {
    // Letterboxing was the bug that made the M4 render look tiny; the frame
    // must match the file, and the two vendors do not agree.
    expect(artworkFor('sennheiser', null).aspect).toBeCloseTo(1125 / 558, 3);
    expect(artworkFor('sony', null).aspect).toBeCloseTo(2028 / 792, 3);
  });

  it('still returns artwork for an unrecognised model', () => {
    for (const brand of ['sennheiser', 'sony'] as const) {
      const art = artworkFor(brand, 'Something Unknown');
      expect(art.hero).toMatch(/devices\/(sennheiser|sony)\//);
      expect(art.aspect).toBeGreaterThan(1);
    }
  });
});

describe('Sony over-ear artwork', () => {
  it('uses the model slug from the device profile', () => {
    expect(artworkFor('sony', 'WH-1000XM5', 0x01).hero).toContain('wh-1000xm5_black_hero')
  })

  it('takes each model’s aspect from its own artwork', () => {
    // The two sets came from different sources: square catalogue renders for
    // the XM5, wide product-page shots for the C500.
    expect(artworkFor('sony', 'WH-1000XM5', 0x01).aspect).toBe(1)
    expect(artworkFor('sony', 'WF-C500', 0x01).aspect).toBeCloseTo(2028 / 792, 3)
  })

  it('falls back to black for an XM5 colour we have no render of', () => {
    expect(artworkFor('sony', 'WH-1000XM5', 0x07).hero).toContain('wh-1000xm5_black_hero')
  })

  it('never asks for a case shot of headphones that have no case', () => {
    // The file would not exist; falling back to hero keeps the image real.
    expect(sonyView('WH-1000XM5', 0x01, 'case')).toContain('_hero')
    expect(sonyView('WH-1000XM5', 0x01, 'case-open')).toContain('_hero')
  })

  it('still serves case shots for earbuds that have one', () => {
    expect(sonyView('WF-C500', 0x01, 'case-open')).toContain('_case-open')
  })
})
