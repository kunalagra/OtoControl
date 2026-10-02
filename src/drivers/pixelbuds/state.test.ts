import { describe, expect, it } from 'vitest';

import { AncState, SettingId } from './maestro';
import {
  applyDurable,
  applySetting,
  captureDurable,
  CAPABILITY_FOR_SETTING,
  initialPixelBudsState,
  offersAdaptive,
} from './state';

describe('applySetting', () => {
  it('folds each setting into its own field', () => {
    let state = initialPixelBudsState;
    state = applySetting(state, { setting: SettingId.AncState, value: AncState.Aware });
    state = applySetting(state, { setting: SettingId.Multipoint, value: true });
    state = applySetting(state, { setting: SettingId.OnHeadDetection, value: false });
    state = applySetting(state, { setting: SettingId.VolumeEq, value: true });
    state = applySetting(state, { setting: SettingId.UserEq, value: [1, 2, 3, 4, 5] });
    state = applySetting(state, { setting: SettingId.AncLoop, value: { active: true, off: false, aware: false, adaptive: false } });
    expect(state).toMatchObject({
      ancMode: AncState.Aware,
      multipoint: true,
      onHeadDetection: false,
      volumeEq: true,
      eq: [1, 2, 3, 4, 5],
      ancLoop: { active: true, off: false, aware: false, adaptive: false },
    });
  });

  it('keeps the current ANC mode when the buds report a value outside the enum', () => {
    const state = { ...initialPixelBudsState, ancMode: AncState.Active };
    expect(applySetting(state, { setting: SettingId.AncState, value: null })).toBe(state);
  });

  it('maps a capability to every setting that gates a control', () => {
    expect(CAPABILITY_FOR_SETTING[SettingId.AncState]).toBe('anc');
    expect(CAPABILITY_FOR_SETTING[SettingId.UserEq]).toBe('eq');
    expect(CAPABILITY_FOR_SETTING[SettingId.AncLoop]).toBeUndefined();
  });
});

describe('offersAdaptive', () => {
  const base = { ancMode: AncState.Active, ancLoop: null, adaptiveRefused: false };

  it('offers it while the loop is unread, and when the loop includes it', () => {
    expect(offersAdaptive(base)).toBe(true);
    expect(offersAdaptive({ ...base, ancLoop: { active: true, off: true, aware: true, adaptive: true } })).toBe(true);
  });

  it('hides it when the loop is known to lack it', () => {
    expect(offersAdaptive({ ...base, ancLoop: { active: true, off: true, aware: true, adaptive: false } })).toBe(false);
  });

  it('hides it once refused', () => {
    expect(offersAdaptive({ ...base, adaptiveRefused: true })).toBe(false);
  });

  it('always shows it while it is the current mode, whatever else says', () => {
    expect(
      offersAdaptive({ ancMode: AncState.Adaptive, ancLoop: { active: true, off: true, aware: true, adaptive: false }, adaptiveRefused: true }),
    ).toBe(true);
  });
});

describe('durable state', () => {
  it('round trips through JSON, turning the capability Set into an array and back', () => {
    const state = {
      ...initialPixelBudsState,
      info: { model: 'Pixel Buds Pro', firmware: { case: '1', left: '2', right: null }, serials: null },
      ancMode: AncState.Active,
      eq: [0, 1, 0, 0, 0] as [number, number, number, number, number],
      capabilities: new Set(['anc', 'eq'] as const),
      battery: [{ device: 'left' as const, level: 50, charging: false }],
    };
    const restored = applyDurable(JSON.parse(JSON.stringify(captureDurable(state))));
    expect(restored.info).toEqual(state.info);
    expect(restored.ancMode).toBe(AncState.Active);
    expect(restored.eq).toEqual([0, 1, 0, 0, 0]);
    expect(restored.capabilities).toEqual(new Set(['anc', 'eq']));
    expect(restored).not.toHaveProperty('battery');
  });

  it('tolerates an older or empty snapshot', () => {
    expect(applyDurable({})).toEqual({
      info: { model: null, firmware: null, serials: null },
      ancMode: null,
      ancLoop: null,
      multipoint: null,
      onHeadDetection: null,
      eq: null,
      volumeEq: null,
      capabilities: new Set(),
    });
  });
});
