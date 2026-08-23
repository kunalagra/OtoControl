import { describe, expect, it } from 'vitest';

import { soundcoreArtwork } from './assets';

describe('soundcoreArtwork', () => {
  it('serves the bundled render for a known product code alone', () => {
    // The code comes off the serial; the model name may never have arrived.
    const art = soundcoreArtwork(null, 'a3951');
    expect(art.hero).toContain('devices/soundcore/a3951_hero.webp');
  });

  it('resolves the render from a full or shortened advertised name', () => {
    expect(soundcoreArtwork('Soundcore Liberty Air 2 Pro').hero).toContain('a3951_hero.webp');
    expect(soundcoreArtwork('Liberty Air 2 Pro').hero).toContain('a3951_hero.webp');
  });

  it('prefers the serial-derived code over whatever the advertisement said', () => {
    // A renamed/odd advert must not cost the device its real render once the
    // serial has been read.
    const art = soundcoreArtwork('Buds (renamed)', 'a3951');
    expect(art.hero).toContain('a3951_hero.webp');
  });

  it('falls back to the placeholder for an unmapped code', () => {
    const art = soundcoreArtwork(null, 'a9999');
    expect(art.hero).toContain('placeholder.svg');
  });

  it('carries per-bud renders in whatever format the vendor shipped', () => {
    // Most bud renders are WebP; a handful of older products ship PNG, and
    // the catalog records each file as bundled rather than assuming one
    // format.
    const webp = soundcoreArtwork(null, 'a3936');
    expect(webp.budLeft).toContain('soundcore/a3936_bud_l.webp');
    expect(webp.budRight).toContain('soundcore/a3936_bud_r.webp');
    const png = soundcoreArtwork(null, 'a3943');
    expect(png.budLeft).toContain('soundcore/a3943_bud_l.png');
    expect(png.budRight).toContain('soundcore/a3943_bud_r.png');
  });

  it('has no per-bud renders for models without them, like the a3951', () => {
    const art = soundcoreArtwork(null, 'a3951');
    expect(art.budLeft).toBeUndefined();
    expect(art.budRight).toBeUndefined();
  });

  it('resolves every bundled file through the catalog', async () => {
    // Guards the asset catalog against drift in both directions: a file on
    // disk that no entry names (stale extraction), or an entry naming a file
    // that was never bundled (a 404 waiting for a connected device).
    const { readdirSync } = await import('node:fs');
    const files = readdirSync('public/devices/soundcore').filter((f) => f.includes('_'));
    for (const file of files) {
      const code = file.slice(0, file.indexOf('_'));
      const art = soundcoreArtwork(null, code);
      const named = [art.hero, art.budLeft, art.budRight].filter(Boolean);
      expect(named, file).toContain(`${import.meta.env.BASE_URL}devices/soundcore/${file}`);
    }
  });
});
