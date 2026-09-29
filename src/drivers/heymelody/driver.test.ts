import { describe, expect, it } from 'vitest';

import { HEYMELODY_DRIVER } from './driver';
import { initialHeyMelodyState } from './state';

describe('HEYMELODY_DRIVER.worn', () => {
  it('is true while wear is unknown', () => {
    expect(HEYMELODY_DRIVER.worn(initialHeyMelodyState)).toBe(true);
  });

  it('is true when any bud is in an ear, false when none is', () => {
    const left = { device: 'left' as const, inBox: false };
    expect(HEYMELODY_DRIVER.worn({ ...initialHeyMelodyState, wear: [{ ...left, inEar: true }] })).toBe(true);
    expect(HEYMELODY_DRIVER.worn({ ...initialHeyMelodyState, wear: [{ ...left, inEar: false, inBox: true }] })).toBe(false);
  });
});

describe('HEYMELODY_DRIVER.sections', () => {
  const ids = (capabilities: string[]) =>
    HEYMELODY_DRIVER.sections({ ...initialHeyMelodyState, capabilities: new Set(capabilities) as never }).map((s) => s.id);

  it('keeps Sound for a device with custom EQ writes only', () => {
    expect(ids(['eqCustom'])).toContain('sound');
  });

  it('hides Noise and Sound once probing found neither', () => {
    expect(ids(['battery'])).toEqual(['system']);
  });

  it('shows Connections, between Sound and System, only when multiDevice is known', () => {
    expect(ids(['anc', 'eq', 'multiDevice'])).toEqual(['noise', 'sound', 'devices', 'system']);
    expect(ids([])).not.toContain('devices');
    expect(ids(['anc', 'eq'])).not.toContain('devices');
  });
});

describe('HEYMELODY_DRIVER.eqPreview', () => {
  it('has no curve for a built-in preset', () => {
    expect(HEYMELODY_DRIVER.eqPreview({ ...initialHeyMelodyState, eqCurrentPreset: 1 })).toBeNull();
  });
});

describe('HEYMELODY_DRIVER.connections', () => {
  it('is null while no peers are known', () => {
    expect(HEYMELODY_DRIVER.connections(initialHeyMelodyState)).toBeNull();
  });

  it('maps every peer, connected or not', () => {
    const peer = { mac: '01:02:03:04:05:06', audioActive: false };
    expect(
      HEYMELODY_DRIVER.connections({
        ...initialHeyMelodyState,
        peers: [
          { ...peer, name: 'Phone', connected: true, isThisDevice: true },
          { ...peer, name: 'Old laptop', connected: false, isThisDevice: false },
        ],
      }),
    ).toEqual([
      { name: 'Phone', connected: true, isThisDevice: true },
      { name: 'Old laptop', connected: false, isThisDevice: false },
    ]);
  });
});
