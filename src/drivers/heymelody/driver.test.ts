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
});
