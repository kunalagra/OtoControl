import { describe, expect, it } from 'vitest';

import { heymelodyArtwork } from './assets';

describe('heymelodyArtwork', () => {
  it('serves HeyTap’s own catalog render for a known productId', () => {
    // 06F010 = OPPO Enco Air4s, live-verified against firmwareCoverImage.
    const art = heymelodyArtwork('06F010');
    expect(art.hero).toMatch(/^https:\/\/[^/]+\.heytapimg\.com\//);
    expect(art.aspect).toBe(1);
  });

  it('falls back to realme Link’s catalog for models HeyTap has no render for', () => {
    // 063012 = realme Buds Air6 Pro: absent from firmwareCoverImage, present
    // in realme Link's rus_img catalog.
    expect(heymelodyArtwork('063012').hero).toMatch(/^https:\/\/r35\.realme\.net\//);
  });

  it('picks the render for the unit’s own colour when the catalog has one', () => {
    // realme Buds Air6 Pro ships renders for colour buckets 5 and 11.
    const byColour = heymelodyArtwork('063012', 11).hero;
    expect(byColour).toMatch(/^https:\/\/r35\.realme\.net\//);
    expect(byColour).not.toBe(heymelodyArtwork('063012').hero);
  });

  it('falls back to the default render for an unknown or absent colour', () => {
    const fallback = heymelodyArtwork('063012').hero;
    for (const colourId of [0, 12, null]) {
      expect(heymelodyArtwork('063012', colourId).hero).toBe(fallback);
    }
    // HeyTap models have no per-colour renders at all.
    expect(heymelodyArtwork('06F010', 2).hero).toBe(heymelodyArtwork('06F010').hero);
  });

  it('matches productIds case-insensitively', () => {
    expect(heymelodyArtwork('06f010').hero).toBe(heymelodyArtwork('06F010').hero);
  });

  it('reuses the hero when disconnected, since no greyed render exists', () => {
    const art = heymelodyArtwork('06F010');
    expect(art.heroInactive).toBe(art.hero);
  });

  it('yields the placeholder for a productId the catalog has no render for', () => {
    for (const productId of ['FFFFFF', null]) {
      const art = heymelodyArtwork(productId);
      expect(art.hero).toBe('');
      expect(art.heroInactive).toBe('');
    }
  });
});
