import { describe, expect, it, vi } from 'vitest';

import { PIXELBUDS_MAESTRO_UUID } from '@/core/transport';
import { PIXELBUDS_DRIVER } from './driver';
import { initialPixelBudsState } from './state';
import type { PixelBudsState } from './state';

const state = (patch: Partial<PixelBudsState> = {}): PixelBudsState => ({ ...initialPixelBudsState, ...patch });

describe('PIXELBUDS_DRIVER', () => {
  it('speaks only the Maestro service', () => {
    expect(PIXELBUDS_DRIVER.services).toEqual([PIXELBUDS_MAESTRO_UUID]);
    expect(PIXELBUDS_DRIVER.brand).toBe('pixelbuds');
  });
});

describe('PIXELBUDS_DRIVER.sections', () => {
  const ids = (patch: Partial<PixelBudsState>) => PIXELBUDS_DRIVER.sections(state(patch)).map((section) => section.id);

  it('keeps every tab before the buds have answered', () => {
    expect(ids({})).toEqual(['noise', 'sound', 'system']);
  });

  it('shows a tab only for what the buds answered', () => {
    expect(ids({ capabilities: new Set(['battery']) })).toEqual(['system']);
    expect(ids({ capabilities: new Set(['anc']) })).toEqual(['noise', 'system']);
    expect(ids({ capabilities: new Set(['anc', 'eq']) })).toEqual(['noise', 'sound', 'system']);
  });

  it('gives every section a component', () => {
    const components: Record<string, unknown> = PIXELBUDS_DRIVER.components;
    for (const section of PIXELBUDS_DRIVER.sections(state())) expect(components[section.id]).toBeDefined();
  });
});

describe('PIXELBUDS_DRIVER readouts', () => {
  it('summarises battery in one line, bolting charging cells', () => {
    expect(PIXELBUDS_DRIVER.statusLine(state())).toBeNull();
    expect(
      PIXELBUDS_DRIVER.statusLine(
        state({
          battery: [
            { device: 'left', level: 80, charging: true },
            { device: 'right', level: 75, charging: false },
            { device: 'case', level: 40, charging: false },
          ],
        }),
      ),
    ).toBe('L 80% ⚡ · R 75% · Case 40%');
  });

  it('reads as worn unless both buds are known to be in the case', () => {
    expect(PIXELBUDS_DRIVER.worn(state())).toBe(true);
    expect(PIXELBUDS_DRIVER.worn(state({ placement: { leftInCase: true, rightInCase: false } }))).toBe(true);
    expect(PIXELBUDS_DRIVER.worn(state({ placement: { leftInCase: true, rightInCase: true } }))).toBe(false);
  });

  it('has no codec and a placeholder render, with nothing fetched', () => {
    expect(PIXELBUDS_DRIVER.codecName(state())).toBeNull();
    expect(PIXELBUDS_DRIVER.artwork(state())).toEqual({ hero: '', heroInactive: '', aspect: 1 });
  });

  it('offers multipoint and on-head detection as quick settings only when the buds have them', () => {
    const set = { setMultipoint: vi.fn(), setOnHeadDetection: vi.fn() };
    const device = set as never;
    expect(PIXELBUDS_DRIVER.quickSettings(device, state())).toEqual([]);
    const settings = PIXELBUDS_DRIVER.quickSettings(
      device,
      state({ capabilities: new Set(['multipoint', 'onHead']), multipoint: true, onHeadDetection: false }),
    );
    expect(settings.map((setting) => [setting.label, setting.kind === 'toggle' ? setting.value : undefined])).toEqual([
      ['Multipoint', true],
      ['On-head detection', false],
    ]);
    for (const setting of settings) if (setting.kind === 'toggle') setting.set(true);
    expect(set.setMultipoint).toHaveBeenCalledWith(true);
    expect(set.setOnHeadDetection).toHaveBeenCalledWith(true);
  });
});
