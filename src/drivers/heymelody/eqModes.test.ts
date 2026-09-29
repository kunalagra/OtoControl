import { describe, expect, it } from 'vitest';

import { catalogEntryFor } from './catalog';
import { DEFAULT_CUSTOM_EQ_CAP, builtinPresets, customEqCap } from './eqModes';

describe('builtinPresets', () => {
  it('names each wire id from the model mode types', () => {
    expect(builtinPresets(catalogEntryFor('065414'))).toEqual([
      { id: 0, name: 'Balanced' },
      { id: 1, name: 'Clear vocals' },
      { id: 2, name: 'Bass' },
    ]);
  });

  it('falls back to three numbered presets for a model the catalog does not describe', () => {
    expect(builtinPresets(null)).toEqual([
      { id: 0, name: 'Preset 1' },
      { id: 1, name: 'Preset 2' },
      { id: 2, name: 'Preset 3' },
    ]);
  });

  it('names an unknown mode type by its position rather than dropping it', () => {
    const entry = { productId: 'X', name: 'X', brand: 'oppo' as const, type: 'T1', equalizerMode: [{ protocolIndex: 3, modeType: 99 }] };
    expect(builtinPresets(entry)).toEqual([{ id: 3, name: 'Preset 4' }]);
  });
});

describe('customEqCap', () => {
  it('defaults to three and honours a model cap', () => {
    expect(customEqCap(null)).toBe(DEFAULT_CUSTOM_EQ_CAP);
    const entry = { productId: 'X', name: 'X', brand: 'oppo' as const, type: 'T1', customEqMax: 2 };
    expect(customEqCap(entry)).toBe(2);
  });
});
