import { describe, expect, it } from 'vitest';
import { catalogEntryFor, OEM_BRAND_NAME } from './catalog';

describe('catalogEntryFor', () => {
  it('resolves a known productId', () => {
    // Real entry from the extracted catalog — OPPO Enco Air4s.
    expect(catalogEntryFor('06F010')).toEqual({
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
    expect(catalogEntryFor('067414')).toEqual({
      productId: '067414',
      name: 'OnePlus Flow Buds',
      brand: 'oneplus',
      type: 'T1',
    });
  });

  it('returns null for an unknown productId', () => {
    expect(catalogEntryFor('FFFFFF')).toBeNull();
  });
});

describe('OEM_BRAND_NAME', () => {
  it('has a display name for every catalog brand', () => {
    expect(OEM_BRAND_NAME.oppo).toBe('OPPO');
    expect(OEM_BRAND_NAME.realme).toBe('realme');
    expect(OEM_BRAND_NAME.oneplus).toBe('OnePlus');
  });
});
