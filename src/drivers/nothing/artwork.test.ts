import { describe, expect, it } from 'vitest';

import { nothingArtwork } from './artwork';

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
