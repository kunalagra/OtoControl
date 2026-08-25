import { describe, expect, it } from 'vitest';

import { nothingArtwork, nothingHasColourRender } from './artwork';

describe('nothingArtwork', () => {
  it('serves the official CDN render for a known model', () => {
    const art = nothingArtwork('Nothing Ear (1)');
    expect(art.hero).toMatch(/^https:\/\/.+\.png$/);
    expect(art.aspect).toBe(1);
  });

  it('falls back to the bundled webp when the model is unknown', () => {
    const art = nothingArtwork('Something else entirely');
    expect(art.hero).toContain('devices/nothing/fallback.webp');
  });

  it('always carries the offline fallback alongside a CDN hero', () => {
    const art = nothingArtwork('CMF Buds Pro 2');
    expect(art.fallback).toContain('devices/nothing/fallback.webp');
    expect(art.fallback).not.toBe(art.hero);
  });

  it('prefers a black render when the colour is unknowable over serial', () => {
    // B155's config has colourId 01 pointing at a White file, so the pick
    // must be made from the URL, not the id.
    const art = nothingArtwork('Nothing Ear (2)');
    expect(art.hero).toMatch(/black/i);
  });
});

describe('nothingArtwork colourways', () => {
  it('uses the render for the colour the device reported', () => {
    // B175 ships three: 01, 02 and 06.
    const art = nothingArtwork('CMF Headphone Pro', '06');
    expect(art.hero).toContain('_06.png');
  });

  it('falls back to the table default for an unreported colour', () => {
    const plain = nothingArtwork('CMF Headphone Pro');
    const unknown = nothingArtwork('CMF Headphone Pro', '99');
    expect(unknown.hero).toBe(plain.hero);
  });

  it('still resolves a model the table has no entry for', () => {
    const art = nothingArtwork('Something else entirely', '01');
    expect(art.hero).toBe(art.fallback);
  });
});


describe('nothingHasColourRender', () => {
  it('is false for a colour the SKU catalogue never listed', () => {
    // The CMF Headphone Pro ships in blue, but this app build's catalogue only
    // knows black, white and green for it — so the colour is nameable and the
    // picture is not available. That must be distinguishable from a match.
    expect(nothingHasColourRender('CMF Headphone Pro', '03')).toBe(false);
    expect(nothingHasColourRender('CMF Headphone Pro', '01')).toBe(true);
    expect(nothingHasColourRender('CMF Headphone Pro', '06')).toBe(true);
  });

  it('is false when the colour is unknown or the model is', () => {
    expect(nothingHasColourRender('CMF Headphone Pro', null)).toBe(false);
    expect(nothingHasColourRender('Something else entirely', '01')).toBe(false);
  });

  it('still falls back to a render of the right product', () => {
    // Wrong colour beats no picture: the hero is the model's default finish.
    const art = nothingArtwork('CMF Headphone Pro', '03');
    expect(art.hero).toContain('device_sku');
    expect(art.hero).not.toBe(art.fallback);
  });
});

describe('the light-green CMF Headphone Pro', () => {
  it('resolves its own render, not the default finish', () => {
    // Colour id 06 in Nothing's `DeviceColor` enum, and B175 has a 06 SKU —
    // so this is the case that exercises the whole colour path end to end.
    const green = nothingArtwork('CMF Headphone Pro', '06');
    const black = nothingArtwork('CMF Headphone Pro', '01');
    expect(nothingHasColourRender('CMF Headphone Pro', '06')).toBe(true);
    expect(green.hero).toContain('_06.png');
    expect(green.hero).not.toBe(black.hero);
  });
});

describe('the CMF Buds Neo', () => {
  it('serves a distinct render for each of its three finishes', () => {
    // B193 ships in dark grey (01), orange (02) and blue (03) — the SKU
    // catalogue names the files after its codename, larvitar.
    const heroes = ['01', '02', '03'].map((c) => nothingArtwork('CMF Buds Neo', c).hero);
    expect(new Set(heroes).size).toBe(3);
    for (const colour of ['01', '02', '03']) {
      expect(nothingHasColourRender('CMF Buds Neo', colour)).toBe(true);
    }
  });
});
