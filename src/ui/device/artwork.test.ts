import { describe, expect, it } from 'vitest';

import {
  DEFAULT_COLOURWAY,
  SENNHEISER_COLOURWAYS,
  artworkFor,
  colourwayFromModel,
  SONY_VIEWS,
  normaliseSonyColour,
  sonyColourName,
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

  it('serves Sony’s own catalog render for a known model and colour', () => {
    // 0x01 = black, the one pairing verified on hardware. The hero is now
    // the official app's cloud render; the bundled shot is the fallback.
    const art = artworkFor('sony', 'WF-C500', 0x01);
    expect(art.hero).toMatch(/^https:\/\/hpc-image\.data-gateway\.seeds\.services\//);
    expect(art.fallback).toContain('devices/sony/wf-c500_black_hero.webp');
  });

  it('falls back to black when there is no artwork for the colour anywhere', () => {
    // 0x04 Red is a real colour with no WF-C500 render, locally or in
    // Sony's catalog; undefined/null/0x00 have no exact entry either.
    for (const code of [undefined, null, 0x04, 0xff]) {
      expect(artworkFor('sony', 'WF-C500', code).fallback).toContain('wf-c500_black_hero.webp');
      expect(artworkFor('sony', 'WF-C500', code).hero).toMatch(/^https:\/\//);
    }
    // 0x00 "Default" aliases black's own URL in the catalog.
    expect(artworkFor('sony', 'WF-C500', 0x00).hero).toBe(artworkFor('sony', 'WF-C500', 0x01).hero);
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

  it('resolves colours from Sony’s catalog, not from bundled renders', () => {
    // Green is a WF-C500 colourway: its cloud hero differs from black's,
    // while the bundled fallback stays the one local render we hold.
    const green = artworkFor('sony', 'WF-C500', 0x08);
    const black = artworkFor('sony', 'WF-C500', 0x01);
    expect(green.hero).not.toBe(black.hero);
    expect(green.fallback).toContain('wf-c500_black_hero.webp');
  });

  it('falls back to black when no colour render exists anywhere', () => {
    // 0x04 Red ships in no WF-C500 and is absent from the catalog: the
    // default-colour URL stands in, and it is black's.
    expect(artworkFor('sony', 'WF-C500', 0x04).hero).toBe(
      artworkFor('sony', 'WF-C500', 0x01).hero,
    );
  });

  it('treats inactive-variant bytes as their base colour', () => {
    // Black-I (base + 16) has no catalog entry of its own.
    expect(artworkFor('sony', 'WF-C500', 0x11).hero).toBe(
      artworkFor('sony', 'WF-C500', 0x01).hero,
    );
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

  it('serves catalog profiles for models nobody has written by hand', () => {
    // LinkBuds S comes from Sony's catalog: its own exact match, square like
    // the cloud render, with the conventional local-fallback path (which
    // simply shows the placeholder frame if that file was never bundled).
    const art = artworkFor('sony', 'LinkBuds S', 0x01)
    expect(art.hero).toMatch(/^https:\/\/hpc-image\.data-gateway\.seeds\.services\//)
    expect(art.aspect).toBe(1)
    expect(art.fallback).toContain('devices/sony/linkbuds-s_black_hero.webp')
  })

  it('never lets one catalog name swallow a longer sibling', () => {
    // 'LinkBuds' must not match 'LinkBuds S' — generated matches are anchored.
    expect(artworkFor('sony', 'LinkBuds S').hero).not.toBe(artworkFor('sony', 'LinkBuds').hero)
  })

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
    const art = artworkFor('sony', 'WH-1000XM5', 0x01)
    expect(art.hero).toMatch(/^https:\/\//)
    expect(art.fallback).toContain('wh-1000xm5_black_hero')
  })

  it('frames every Sony render square, like the cloud source', () => {
    // The catalog's renders are the heroes; the wide product-page shots
    // survive only as offline fallbacks inside the same square frame.
    expect(artworkFor('sony', 'WH-1000XM5', 0x01).aspect).toBe(1)
    expect(artworkFor('sony', 'WF-C500', 0x01).aspect).toBe(1)
  })

  it('falls back to black for an XM5 colour we have no render of', () => {
    const art = artworkFor('sony', 'WH-1000XM5', 0x07)
    expect(art.hero).toMatch(/^https:\/\//)
    expect(art.fallback).toContain('wh-1000xm5_black_hero')
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

describe('Nothing CDN artwork', () => {
  it('serves the official CDN render for a known model', () => {
    const art = artworkFor('nothing', 'Nothing Ear (1)')
    expect(art.hero).toMatch(/^https:\/\/.+\.png$/)
    expect(art.aspect).toBe(1)
  })

  it('falls back to the bundled webp when the model is unknown', () => {
    const art = artworkFor('nothing', 'Something else entirely')
    expect(art.hero).toContain('devices/nothing/fallback.webp')
  })

  it('always carries the offline fallback alongside a CDN hero', () => {
    const art = artworkFor('nothing', 'CMF Buds Pro 2')
    expect(art.fallback).toContain('devices/nothing/fallback.webp')
    expect(art.fallback).not.toBe(art.hero)
  })

  it('prefers a black render when the colour is unknowable over serial', () => {
    // B155's config has colourId 01 pointing at a White file, so the pick
    // must be made from the URL, not the id.
    const art = artworkFor('nothing', 'Nothing Ear (2)')
    expect(art.hero).toMatch(/black/i)
  })
})

describe('Soundcore artwork', () => {
  it('serves the bundled render for a known product code alone', () => {
    // The code comes off the serial; the model name may never have arrived.
    const art = artworkFor('soundcore', null, null, 'a3951')
    expect(art.hero).toContain('devices/soundcore/a3951_hero.webp')
  })

  it('resolves the render from a full or shortened advertised name', () => {
    expect(artworkFor('soundcore', 'Soundcore Liberty Air 2 Pro').hero).toContain(
      'a3951_hero.webp',
    )
    expect(artworkFor('soundcore', 'Liberty Air 2 Pro').hero).toContain('a3951_hero.webp')
  })

  it('prefers the serial-derived code over whatever the advertisement said', () => {
    // A renamed/odd advert must not cost the device its real render once the
    // serial has been read.
    const art = artworkFor('soundcore', 'Buds (renamed)', null, 'a3951')
    expect(art.hero).toContain('a3951_hero.webp')
  })

  it('falls back to the placeholder for an unmapped code', () => {
    const art = artworkFor('soundcore', null, null, 'a9999')
    expect(art.hero).toContain('placeholder.svg')
  })
})
