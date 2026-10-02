import { describe, expect, it } from 'vitest';

import { applyDurable, captureDurable, initialXiaomiState } from './state';

describe('durable state', () => {
  it('round-trips identity and settings through JSON, capabilities as an array', () => {
    const state = {
      ...initialXiaomiState,
      info: { model: 'Redmi Buds 4', btName: 'Redmi Buds 4', vid: 0x2717, pid: 0x5034, firmware: ['1.2.3.4'], colour: 2 },
      ancMode: 1 as const,
      ncStrength: 2,
      eqPreset: 5,
      wearDetection: true,
      capabilities: new Set(['anc', 'eq'] as const),
      battery: [{ device: 'left' as const, level: 50, charging: false }],
      finding: true,
    };
    const restored = applyDurable(JSON.parse(JSON.stringify(captureDurable(state))));
    expect(restored.info).toEqual(state.info);
    expect(restored.ancMode).toBe(1);
    expect(restored.ncStrength).toBe(2);
    expect(restored.eqPreset).toBe(5);
    expect(restored.wearDetection).toBe(true);
    expect(restored.capabilities).toEqual(new Set(['anc', 'eq']));
  });

  it('keeps battery, find and handshake out of the snapshot', () => {
    const captured = captureDurable({ ...initialXiaomiState, finding: true, handshake: 'complete' });
    expect(captured).not.toHaveProperty('battery');
    expect(captured).not.toHaveProperty('finding');
    expect(captured).not.toHaveProperty('handshake');
    expect(captured).not.toHaveProperty('gestures');
    expect(captured).not.toHaveProperty('customEq');
  });

  it('fills defaults for a sparse or older snapshot', () => {
    const restored = applyDurable({});
    expect(restored.info).toEqual(initialXiaomiState.info);
    expect(restored.ancMode).toBeNull();
    expect(restored.capabilities).toEqual(new Set());
  });
});
