import { describe, expect, it } from 'vitest';

import { normaliseSonyColour, sonyArtwork, sonyColourName } from './artwork';

describe('sonyArtwork', () => {
  it('serves Sony’s own catalog render for a known model and colour', () => {
    // 0x01 = black, the one pairing verified on hardware. Catalog-only
    // artwork: no local files exist to fall back to.
    const art = sonyArtwork('WF-C500', 0x01);
    expect(art.hero).toMatch(/^https:\/\/hpc-image\.data-gateway\.seeds\.services\//);
    expect(art.fallback).toBeUndefined();
  });

  it('falls back to black when there is no artwork for the colour anywhere', () => {
    // 0x04 Red is a real colour with no WF-C500 render in Sony's catalog;
    // undefined/null/0x00 have no exact entry either.
    for (const code of [undefined, null, 0x04, 0xff]) {
      expect(sonyArtwork('WF-C500', code).hero).toMatch(/^https:\/\//);
    }
    // 0x00 "Default" aliases black's own URL in the catalog.
    expect(sonyArtwork('WF-C500', 0x00).hero).toBe(sonyArtwork('WF-C500', 0x01).hero);
  });

  it('resolves colours from Sony’s catalog', () => {
    // Green is a WF-C500 colourway: its cloud hero differs from black's.
    const green = sonyArtwork('WF-C500', 0x08);
    const black = sonyArtwork('WF-C500', 0x01);
    expect(green.hero).not.toBe(black.hero);
  });

  it('falls back to black when no colour render exists anywhere', () => {
    // 0x04 Red ships in no WF-C500 and is absent from the catalog: the
    // default-colour URL stands in, and it is black's.
    expect(sonyArtwork('WF-C500', 0x04).hero).toBe(sonyArtwork('WF-C500', 0x01).hero);
  });

  it('treats inactive-variant bytes as their base colour', () => {
    // Black-I (base + 16) has no catalog entry of its own.
    expect(sonyArtwork('WF-C500', 0x11).hero).toBe(sonyArtwork('WF-C500', 0x01).hero);
  });

  it('reuses the hero when disconnected, since no greyed render exists', () => {
    const art = sonyArtwork('WF-C500');
    expect(art.heroInactive).toBe(art.hero);
  });

  it('serves catalog profiles for models nobody has written by hand', () => {
    // LinkBuds S comes from Sony's catalog: its own exact match, square like
    // the cloud render, with no bundled fallback.
    const art = sonyArtwork('LinkBuds S', 0x01);
    expect(art.hero).toMatch(/^https:\/\/hpc-image\.data-gateway\.seeds\.services\//);
    expect(art.aspect).toBe(1);
    expect(art.fallback).toBeUndefined();
  });

  it('never lets one catalog name swallow a longer sibling', () => {
    // 'LinkBuds' must not match 'LinkBuds S' — generated matches are anchored.
    expect(sonyArtwork('LinkBuds S').hero).not.toBe(sonyArtwork('LinkBuds').hero);
  });

  it('yields the placeholder for a model the catalog does not know', () => {
    // With no local renders left, an uncataloged model has no honest picture:
    // the empty hero renders the placeholder frame instead.
    const art = sonyArtwork('Something Unknown');
    expect(art.hero).toBe('');
    expect(art.heroInactive).toBe('');
    expect(art.aspect).toBe(1);
  });
});

describe('sonyArtwork — over-ear', () => {
  it('resolves the catalog render for the model string', () => {
    const art = sonyArtwork('WH-1000XM5', 0x01);
    expect(art.hero).toMatch(/^https:\/\//);
    expect(art.fallback).toBeUndefined();
  });

  it('frames every Sony render square, like the cloud source', () => {
    expect(sonyArtwork('WH-1000XM5', 0x01).aspect).toBe(1);
    expect(sonyArtwork('WF-C500', 0x01).aspect).toBe(1);
  });

  it('falls back to black for an XM5 colour we have no render of', () => {
    const art = sonyArtwork('WH-1000XM5', 0x07);
    expect(art.hero).toMatch(/^https:\/\//);
  });
});

describe("colour names, from Sony's own ModelColor enum", () => {
  it('names the colours', () => {
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
});
