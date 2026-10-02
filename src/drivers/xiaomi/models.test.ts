import { describe, expect, it } from 'vitest';

import { XIAOMI_VID, catalogName, modelHints, ncStrengthOptions, transparencyStrengthOptions } from './models';

describe('catalogName', () => {
  it('names a PID from the vendor catalog', () => {
    expect(catalogName(XIAOMI_VID, 0x5034)).toBe('Redmi Buds 4');
    expect(catalogName(XIAOMI_VID, 0x511c)).toBe('REDMI Buds 8S');
  });

  it('does not name another vendor or an unlisted PID', () => {
    expect(catalogName(0x1234, 0x5034)).toBeNull();
    expect(catalogName(XIAOMI_VID, 0x9999)).toBeNull();
    expect(catalogName(null, null)).toBeNull();
  });
});

describe('modelHints', () => {
  it('offers three strengths of each kind by default', () => {
    expect(modelHints('Redmi Buds 5 Pro', null)).toMatchObject({ noiseControl: true, ncStrengths: [0, 1, 2], transparencyStrengths: [0, 1, 2] });
  });

  it('narrows transparency and adds Adaptive for the Redmi Buds 3 Pro', () => {
    expect(modelHints('Redmi Buds 3 Pro')).toMatchObject({ ncStrengths: [0, 1, 2, 3], transparencyStrengths: [0, 1] });
  });

  it('marks the Active line as having no noise control', () => {
    expect(modelHints('Redmi Buds 6 Active').noiseControl).toBe(false);
    expect(modelHints('REDMI Buds 8 Active').noiseControl).toBe(false);
  });

  it('tries each name in turn', () => {
    expect(modelHints(null, 'Redmi Buds 6 Active').noiseControl).toBe(false);
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
