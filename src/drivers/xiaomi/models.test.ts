import { describe, expect, it } from 'vitest';

import { XIAOMI_CATALOG } from './catalog.generated';
import {
  XIAOMI_VID,
  catalogEntry,
  catalogImage,
  catalogName,
  isDepthScale,
  modelGates,
  ncStrengthOptions,
  transparencyStrengthOptions,
} from './models';

describe('catalogName', () => {
  it('names a PID from the vendor catalog, in English', () => {
    expect(catalogName(XIAOMI_VID, 0x5034)).toBe('Redmi Buds 4');
    expect(catalogName(XIAOMI_VID, 0x511c)).toBe('REDMI Buds 8S');
    expect(catalogName(XIAOMI_VID, 0x5088)).toBe('Redmi Buds 6 Active');
    expect(catalogName(XIAOMI_VID, 0x50e3)).toBe('REDMI Buds 8 Pro');
  });

  it('knows the Redmi Buds 6 Lite by the PID seen on hardware (Gadgetbridge #6818) and by the catalog’s own', () => {
    expect(catalogName(XIAOMI_VID, 0x508b)).toBe('Redmi Buds 6 Lite');
    expect(catalogName(XIAOMI_VID, 0x508a)).toBe('Redmi Buds 6 Lite');
  });

  it('does not name another vendor or an unlisted PID', () => {
    expect(catalogName(0x1234, 0x5034)).toBeNull();
    expect(catalogName(XIAOMI_VID, 0x9999)).toBeNull();
    expect(catalogName(null, null)).toBeNull();
  });

  it('carries no untranslated Chinese in a name', () => {
    for (const entry of Object.values(XIAOMI_CATALOG)) expect(entry.name).not.toMatch(/[　-鿿]/);
  });
});

describe('modelGates for a catalog model', () => {
  const gates = (pid: number) => modelGates({ vid: XIAOMI_VID, pid, btName: null });

  it('reads the Redmi Buds 5 Pro: three gears each way, five presets with custom, find, gestures', () => {
    const g = gates(0x506c);
    expect(g.noiseControl).toBe(true);
    expect(g.ncGear).toEqual([1, 0, 2]);
    expect(g.tpGear).toEqual([0, 1, 2]);
    expect(g.effects).toEqual([0, 6, 5, 1, 10]);
    expect(g.customEq).toBe(true);
    expect(g.find).toBe(true);
    expect(g.taps?.get(1)).toEqual([2, 3, 4, 5, 1]);
    expect(g.taps?.get(3)).toEqual([0, 6]);
    expect(g.longPressCycle).toBe(true);
  });

  it('marks the Active line as having no noise control but find and gestures, like Gadgetbridge’s tested models', () => {
    const g = gates(0x5088);
    expect(g.noiseControl).toBe(false);
    expect(g.find).toBe(true);
    expect(g.effects).toEqual([0, 6, 5, 1, 7]);
    expect(g.customEq).toBe(false);
    // The catalog also lists an action id (9) no source names; the gesture UI leaves it out.
    expect(g.taps?.get(4)).toEqual([8, 2, 3, 4, 5, 1, 9]);
  });

  it('gives the Redmi Buds 3 Pro two transparency gears and the common action set on its older taps', () => {
    const g = gates(0x5025);
    expect(g.tpGear).toEqual([0, 1]);
    expect(g.taps?.get(1)).toEqual([1, 2, 3, 4, 5]);
    expect(g.taps?.get(2)).toEqual([1, 2, 3, 4, 5]);
    expect(g.find).toBe(false);
  });

  it('keeps a 20-step depth gear whole for the models that list one', () => {
    const g = gates(0x50e3);
    expect(g.ncGear).toHaveLength(20);
    expect(isDepthScale(g.ncGear)).toBe(true);
    expect(isDepthScale([1, 0, 2, 4])).toBe(false);
  });

  it('offers no strength choice where the catalog lists a single gear', () => {
    expect(gates(0x508a).ncGear).toEqual([0]);
  });

  it('has no find on models whose catalog entry lacks it', () => {
    expect(gates(0x5026).find).toBe(false);
  });
});

describe('modelGates for a model the catalog lacks', () => {
  const unknown = (btName: string | null) => modelGates({ vid: XIAOMI_VID, pid: 0x9999, btName });

  it('offers the common options and leaves the probes to decide', () => {
    const g = unknown('Redmi Buds 9 Pro');
    expect(g).toMatchObject({ noiseControl: true, ncGear: [0, 1, 2], tpGear: [0, 1, 2], customEq: false, find: true, taps: null });
    expect(g.effects).toEqual([0, 6, 5, 1]);
  });

  it('still recognises an Active by its Bluetooth name', () => {
    expect(unknown('Redmi Buds 9 Active').noiseControl).toBe(false);
  });
});

describe('catalogImage', () => {
  it('picks the render for the unit’s own colour', () => {
    const entry = catalogEntry(XIAOMI_VID, 0x506c)!;
    expect(catalogImage(XIAOMI_VID, 0x506c, 2)).toBe(entry.images['2']);
    expect(catalogImage(XIAOMI_VID, 0x506c, 2)).not.toBe(entry.images['1']);
  });

  it('falls back to the default colour for an unknown or absent colour', () => {
    const entry = catalogEntry(XIAOMI_VID, 0x506c)!;
    const fallback = entry.images[String(entry.defaultColour)];
    expect(catalogImage(XIAOMI_VID, 0x506c, 99)).toBe(fallback);
    expect(catalogImage(XIAOMI_VID, 0x506c, null)).toBe(fallback);
  });

  it('has no image for a model the catalog lacks', () => {
    expect(catalogImage(XIAOMI_VID, 0x9999, 1)).toBeNull();
  });

  it('only ships plain https image URLs, no credentials', () => {
    for (const entry of Object.values(XIAOMI_CATALOG)) {
      for (const url of Object.values(entry.images)) expect(url).toMatch(/^https:\/\/cdn\.cnbj1\.fds\.api\.mi-img\.com\/[^?#]+\.png$/);
    }
  });
});

describe('strength options', () => {
  it('labels known ids and invents none for unknown ones', () => {
    expect(ncStrengthOptions([0, 3, 9])).toEqual([
      { id: 0, label: 'Balanced' },
      { id: 3, label: 'Adaptive' },
      { id: 9, label: 'Level 9' },
    ]);
    expect(transparencyStrengthOptions([1])).toEqual([{ id: 1, label: 'Voice' }]);
  });
});
