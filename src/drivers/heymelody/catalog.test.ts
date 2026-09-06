import { describe, expect, it } from 'vitest';
import { catalogEntryFor, OEM_BRAND_NAME } from './catalog';

describe('catalogEntryFor', () => {
  it('resolves a known productId', () => {
    // Real entry from the extracted catalog — OPPO Enco Air4s. This model's
    // `noiseReductionMode` happens to be the "legacy" no-sub-modes shape
    // (see ancModel.test.ts), asserted separately below rather than inlined
    // here so this test still reads as "the basic fields resolve".
    expect(catalogEntryFor('06F010')).toMatchObject({
      productId: '06F010',
      name: 'OPPO Enco Air4s',
      brand: 'oppo',
      type: 'T1',
    });
  });

  it('normalises the OnePlus brand to lowercase', () => {
    // The source JSON has this entry's brand as "OnePlus"; the generated
    // table normalises every brand to lowercase so `HeyMelodyCatalogEntry['brand']`
    // is a clean 3-value union instead of carrying the source's inconsistent casing.
    expect(catalogEntryFor('067414')).toMatchObject({
      productId: '067414',
      name: 'OnePlus Flow Buds',
      brand: 'oneplus',
      type: 'T1',
    });
  });

  it('returns null for an unknown productId', () => {
    expect(catalogEntryFor('FFFFFF')).toBeNull();
  });

  it('carries noiseReductionMode for the subset of models the whitelist covers', () => {
    // Sourced from docs/reference/heymelody-anc-modes.json — see
    // ancModel.test.ts for what buildAncCapabilities() does with this shape.
    expect(catalogEntryFor('06F010')?.noiseReductionMode).toEqual([
      { protocolIndex: 0, modeType: 5 },
      { protocolIndex: 1, modeType: 1 },
      { protocolIndex: 2, modeType: 2 },
    ]);
  });

  it('omits noiseReductionMode for a model the whitelist does not cover', () => {
    // The main 137-device catalog and the 41-device ANC-mode whitelist are
    // separate sources (81/82 overlap) — a catalog hit must not imply ANC
    // data exists too.
    expect(catalogEntryFor('06B450')?.noiseReductionMode).toBeUndefined();
  });
});

describe('OEM_BRAND_NAME', () => {
  it('has a display name for every catalog brand', () => {
    expect(OEM_BRAND_NAME.oppo).toBe('OPPO');
    expect(OEM_BRAND_NAME.realme).toBe('realme');
    expect(OEM_BRAND_NAME.oneplus).toBe('OnePlus');
  });
});
