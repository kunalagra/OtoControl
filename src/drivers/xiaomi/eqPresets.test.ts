import { describe, expect, it } from 'vitest';

import { eqPresetOptions } from './eqPresets';

describe('eqPresetOptions', () => {
  it('lists a model’s presets in the catalog’s order, named', () => {
    expect(eqPresetOptions([0, 6, 5, 1, 10], null).map((option) => option.name)).toEqual(['Standard', 'Treble', 'Bass', 'Voice', 'Custom']);
    expect(eqPresetOptions([21, 5, 1, 6, 7, 10], null).map((option) => option.name)).toEqual([
      'Balanced',
      'Bass',
      'Voice',
      'Treble',
      'Volume',
      'Custom',
    ]);
  });

  it('adds the playing preset when the list lacks it, and no other', () => {
    expect(eqPresetOptions([0, 6], 0x15).map((option) => option.name)).toEqual(['Standard', 'Treble', 'Balanced']);
    expect(eqPresetOptions([0, 6], 6)).toHaveLength(2);
  });

  it('names an unknown preset by its id rather than inventing a name', () => {
    expect(eqPresetOptions([14], null)).toEqual([{ id: 14, name: 'Preset 14' }]);
  });

  it('offers nothing for a model that lists none and is not playing one', () => {
    expect(eqPresetOptions([], null)).toEqual([]);
  });
});
