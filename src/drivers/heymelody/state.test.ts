import { describe, expect, it } from 'vitest';
import {
  applyAncEvent,
  applyDurable,
  captureDurable,
  initialHeyMelodyState,
} from './state';
import type { HeyMelodyState } from './state';

describe('captureDurable / applyDurable', () => {
  it('round-trips info, ANC and EQ state, dropping battery and status', () => {
    const state: HeyMelodyState = {
      ...initialHeyMelodyState,
      status: 'connected',
      info: {
        model: 'OPPO Enco Air4s',
        productId: '06F010',
        catalog: { productId: '06F010', name: 'OPPO Enco Air4s', brand: 'oppo', type: 'T1' },
      },
      battery: [{ device: 'left', level: 80, charging: false }],
      ancSupportedModes: [0, 1, 2],
      ancLevel: 50,
      eqCurrentPreset: 1,
      eqPresets: [{ isSelected: true, minValue: -6, maxValue: 6, eqId: 1, name: 'Pop', bands: [] }],
      capabilities: new Set(['battery', 'anc', 'eq']),
    };

    const durable = captureDurable(state);

    // Direct assertion on captureDurable's output — ensure live-only fields are not captured
    expect(durable).not.toHaveProperty('battery');
    expect(durable).not.toHaveProperty('status');
    expect(durable).not.toHaveProperty('error');

    const patch = applyDurable(durable);

    expect(patch.info).toEqual(state.info);
    expect(patch.ancSupportedModes).toEqual([0, 1, 2]);
    expect(patch.ancLevel).toBe(50);
    expect(patch.eqCurrentPreset).toBe(1);
    expect(patch.eqPresets).toEqual(state.eqPresets);
    expect(patch.capabilities).toEqual(new Set(['battery', 'anc', 'eq']));
    // Live-only fields are not part of the durable slice at all.
    expect(patch).not.toHaveProperty('battery');
    expect(patch).not.toHaveProperty('status');
  });
});

describe('applyAncEvent', () => {
  it('updates supportedModes from a currentMode bitmask event', () => {
    // outer=3, inner=1 (CurrentNoiseModeInfo), mType=1, mask=0b101 -> bits [0,2]
    const next = applyAncEvent(initialHeyMelodyState, Uint8Array.from([3, 1, 1, 0b101]));
    expect(next.ancSupportedModes).toEqual([0, 2]);
    expect(next.ancLevel).toBeNull();
  });

  it('updates ancLevel from a currentMode level event without clearing supportedModes', () => {
    const withModes: HeyMelodyState = { ...initialHeyMelodyState, ancSupportedModes: [0, 1] };
    const next = applyAncEvent(withModes, Uint8Array.from([3, 1, 2, 75]));
    expect(next.ancLevel).toBe(75);
    expect(next.ancSupportedModes).toEqual([0, 1]);
  });

  it('leaves state unchanged for an unrecognised notification', () => {
    const next = applyAncEvent(initialHeyMelodyState, Uint8Array.from([9, 9, 9]));
    expect(next).toBe(initialHeyMelodyState);
  });
});
