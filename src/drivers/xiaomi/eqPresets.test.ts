import { describe, expect, it } from 'vitest';

import { eqPresetOptions } from './eqPresets';

describe('eqPresetOptions', () => {
  it('offers the four presets every model lists', () => {
    expect(eqPresetOptions(null).map((option) => option.name)).toEqual(['Standard', 'Treble', 'Bass', 'Voice']);
  });

  it('adds the playing preset when it is outside that set, and no other', () => {
    expect(eqPresetOptions(0x15).map((option) => option.name)).toEqual(['Standard', 'Treble', 'Bass', 'Voice', 'Balanced']);
    expect(eqPresetOptions(5)).toHaveLength(4);
  });

  it('names an unknown preset by its id rather than inventing a name', () => {
    expect(eqPresetOptions(0x33).at(-1)).toEqual({ id: 0x33, name: 'Preset 51' });
  });
});
