import { describe, expect, it, vi } from 'vitest';

import { XIAOMI_SPP_UUID } from '@/core/transport';
import { XIAOMI_DRIVER } from './driver';
import { initialXiaomiState } from './state';
import type { XiaomiCapability, XiaomiState } from './state';

const withCapabilities = (...capabilities: XiaomiCapability[]): XiaomiState => ({ ...initialXiaomiState, capabilities: new Set(capabilities) });
const ids = (state: XiaomiState): string[] => XIAOMI_DRIVER.sections(state).map((section) => section.id);

function spyDevice() {
  const calls = new Map<string, ReturnType<typeof vi.fn>>();
  const device = new Proxy({}, { get: (_target, key: string) => calls.get(key) ?? calls.set(key, vi.fn()).get(key)! }) as never;
  return { device, call: (name: string) => calls.get(name) };
}

describe('XIAOMI_DRIVER', () => {
  it('speaks the 0xFD2D service and nothing else', () => {
    expect(XIAOMI_DRIVER.services).toEqual([XIAOMI_SPP_UUID]);
    expect(XIAOMI_DRIVER.brand).toBe('xiaomi');
  });

  it('has a component for every section it can list', () => {
    for (const section of XIAOMI_DRIVER.sections(withCapabilities('anc', 'eq'))) {
      expect(XIAOMI_DRIVER.components[section.id as keyof typeof XIAOMI_DRIVER.components]).toBeDefined();
    }
  });
});

describe('XIAOMI_DRIVER.sections', () => {
  it('keeps every tab before anything has been probed', () => {
    expect(ids(initialXiaomiState)).toEqual(['noise', 'sound', 'system']);
  });

  it('hides the tabs a probed model does not answer', () => {
    expect(ids(withCapabilities('battery'))).toEqual(['system']);
    expect(ids(withCapabilities('anc'))).toEqual(['noise', 'system']);
    expect(ids(withCapabilities('eq'))).toEqual(['sound', 'system']);
  });
});

describe('XIAOMI_DRIVER summary hooks', () => {
  it('writes the battery cells as one line, and none before they are read', () => {
    expect(XIAOMI_DRIVER.statusLine(initialXiaomiState)).toBeNull();
    expect(
      XIAOMI_DRIVER.statusLine({
        ...initialXiaomiState,
        battery: [
          { device: 'left', level: 80, charging: true },
          { device: 'case', level: 30, charging: false },
        ],
      }),
    ).toBe('Left 80% ⚡ · Case 30%');
  });

  it('never claims the earbuds are off the head, since the protocol cannot say', () => {
    expect(XIAOMI_DRIVER.worn(initialXiaomiState)).toBe(true);
  });

  it('uses the placeholder frame rather than another model’s picture', () => {
    expect(XIAOMI_DRIVER.artwork(initialXiaomiState).hero).toBe('');
  });
});

describe('XIAOMI_DRIVER.quickSettings', () => {
  it('offers nothing until a capability has been found', () => {
    const { device } = spyDevice();
    expect(XIAOMI_DRIVER.quickSettings(device, initialXiaomiState)).toEqual([]);
  });

  it('offers noise control as a choice that writes the mode', () => {
    const { device, call } = spyDevice();
    const [setting] = XIAOMI_DRIVER.quickSettings(device, { ...withCapabilities('anc'), ancMode: 1 });
    if (setting.kind !== 'choice') throw new Error('expected a choice');
    expect(setting.value).toBe('1');
    expect(setting.options.map((option) => option.label)).toEqual(['Off', 'Noise cancelling', 'Transparency']);
    setting.set('2');
    expect(call('setAncMode')).toHaveBeenCalledWith(2);
  });

  it('offers in-ear detection as a toggle', () => {
    const { device, call } = spyDevice();
    const [setting] = XIAOMI_DRIVER.quickSettings(device, { ...withCapabilities('wear'), wearDetection: true });
    if (setting.kind !== 'toggle') throw new Error('expected a toggle');
    expect(setting.value).toBe(true);
    setting.set(false);
    expect(call('setWearDetection')).toHaveBeenCalledWith(false);
  });
});

describe('XIAOMI_DRIVER.eqPresets', () => {
  it('returns nothing for a model that answered no EQ read', () => {
    const { device } = spyDevice();
    expect(XIAOMI_DRIVER.eqPresets(device, withCapabilities('battery'))).toBeNull();
  });

  it('marks the active preset and applies a pick', () => {
    const { device, call } = spyDevice();
    const presets = XIAOMI_DRIVER.eqPresets(device, { ...withCapabilities('eq'), eqPreset: 5 })!;
    expect(presets.presets.map((preset) => [preset.name, preset.active])).toEqual([
      ['Standard', false],
      ['Treble', false],
      ['Bass', true],
      ['Voice', false],
    ]);
    presets.select('6');
    expect(call('setEqPreset')).toHaveBeenCalledWith(6);
  });
});
