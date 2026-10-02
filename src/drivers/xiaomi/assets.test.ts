import { describe, expect, it } from 'vitest';

import { xiaomiArtwork } from './assets';
import { XIAOMI_VID } from './models';

describe('xiaomiArtwork', () => {
  it('serves the vendor catalog render for a known model', () => {
    const art = xiaomiArtwork(XIAOMI_VID, 0x506c, null);
    expect(art.hero).toMatch(/^https:\/\/cdn\.cnbj1\.fds\.api\.mi-img\.com\/.+\.png$/);
    expect(art.aspect).toBeCloseTo(860 / 580);
  });

  it('picks the render for the unit’s own colour', () => {
    expect(xiaomiArtwork(XIAOMI_VID, 0x506c, 2).hero).toContain('black');
    expect(xiaomiArtwork(XIAOMI_VID, 0x506c, 10).hero).toContain('blue');
  });

  it('falls back to the default render for an unknown colour', () => {
    expect(xiaomiArtwork(XIAOMI_VID, 0x506c, 99).hero).toBe(xiaomiArtwork(XIAOMI_VID, 0x506c, null).hero);
  });

  it('gives a model the catalog lacks the placeholder frame', () => {
    expect(xiaomiArtwork(XIAOMI_VID, 0x9999, 1)).toEqual({ hero: '', heroInactive: '', aspect: 1 });
    expect(xiaomiArtwork(null, null, null).hero).toBe('');
  });

  it('reuses the hero when disconnected, since no greyed render exists', () => {
    const art = xiaomiArtwork(XIAOMI_VID, 0x506c, 1);
    expect(art.heroInactive).toBe(art.hero);
  });
});
