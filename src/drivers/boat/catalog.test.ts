import { describe, expect, it } from 'vitest';
import { BOAT_PRODUCTS } from './products.generated';
import { lookupBoatProduct } from './catalog';
import { boatArtwork } from './assets';

describe('BOAT_PRODUCTS', () => {
  it('indexes the authenticated hearables catalog with BLE names and sdk types', () => {
    expect(BOAT_PRODUCTS.length).toBeGreaterThan(100);
    const entry = BOAT_PRODUCTS.find((p) => p.bleName === '393ANC_BLE');
    expect(entry?.name).toBe('Airdopes 393ANC');
    expect(entry?.sdkType).toBe('BLUETRUM_SDK');
    expect(entry?.image).toMatch(/^https:\/\/d26hy1p90ps6ht\.cloudfront\.net\//);
  });
});

describe('lookupBoatProduct', () => {
  it('matches the BLE advertisement name first', () => {
    expect(lookupBoatProduct('393ANC_BLE')?.name).toBe('Airdopes 393ANC');
  });

  it('falls back to the marketing name case-insensitively', () => {
    expect(lookupBoatProduct('airdopes 393anc')?.bleName).toBe('393ANC_BLE');
  });

  it('returns null when nothing matches', () => {
    expect(lookupBoatProduct('Not A Boat')).toBeNull();
  });
});

describe('boatArtwork', () => {
  it('uses the product render and per-bud images', () => {
    const entry = lookupBoatProduct('393ANC_BLE');
    const art = boatArtwork(entry);
    expect(art.hero).toMatch(/^https:\/\//);
    expect(art.heroInactive).toBe(art.hero);
    expect(art.aspect).toBe(1);
  });

  it('returns the placeholder frame for unknown models', () => {
    expect(boatArtwork(null)).toEqual({ hero: '', heroInactive: '', aspect: 1 });
  });
});
