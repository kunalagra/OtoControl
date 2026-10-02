/**
 * The Google Pixel Buds driver descriptor — Pixel Buds Pro and Pro 2, spoken to
 * over the Maestro pw_rpc service. Capability gating runs off the settings the
 * buds actually answered (`device.ts`), the same shape as
 * `drivers/heymelody/driver.ts`: nothing on the wire names the model, so the
 * buds themselves are the only authority on what they have.
 */

import type { DeviceDriver, DriverSection, QuickSetting } from '@/core/driver';
import { servicesFor } from '@/core/transport';
import { pixelBudsArtwork } from './artwork';
import { PixelBudsDevice } from './device';
import type { PixelBudsState } from './device';
import { EQ_RANGE } from './maestro';
import { PixelBudsNoise } from './sections/Noise';
import { PixelBudsSound } from './sections/Sound';
import { PixelBudsSystem } from './sections/System';

const PIXELBUDS_SECTIONS: DriverSection[] = [
  { id: 'noise', label: 'Noise control' },
  { id: 'sound', label: 'Sound' },
  { id: 'system', label: 'System' },
];

const COMPONENTS = {
  noise: PixelBudsNoise,
  sound: PixelBudsSound,
  system: PixelBudsSystem,
} as const;

const CELL_LABEL = { left: 'L', right: 'R', case: 'Case' } as const;

export const PIXELBUDS_DRIVER = {
  id: 'pixelbuds',
  label: 'Google Pixel Buds',
  brand: 'pixelbuds',
  services: servicesFor('pixelbuds'),
  profiles: [],
  create: (deps) => new PixelBudsDevice(deps.openTransport),
  sections: (state) => {
    // Before the buds have answered, keep every tab rather than hiding one about to appear.
    const known = state.capabilities.size > 0;
    return PIXELBUDS_SECTIONS.filter((section) => {
      if (section.id === 'noise') return !known || state.capabilities.has('anc');
      if (section.id === 'sound') return !known || state.capabilities.has('eq');
      return true;
    });
  },
  components: COMPONENTS,
  codecName: (_state: PixelBudsState) => null,
  statusLine: (state: PixelBudsState) => {
    if (state.battery.length === 0) return null;
    return state.battery.map((cell) => `${CELL_LABEL[cell.device]} ${cell.level}%${cell.charging ? ' ⚡' : ''}`).join(' · ');
  },
  // The buds report only whether each bud is in the case, so "not worn" is the one thing it can say: both in.
  worn: (state: PixelBudsState) => !(state.placement?.leftInCase && state.placement.rightInCase),
  artwork: (_state: PixelBudsState) => pixelBudsArtwork(),
  // The range is the one pbpctrl documents for the five bands; the buds report none of their own.
  eqPreview: (state: PixelBudsState) =>
    state.eq === null ? null : { preset: null, gains: [...state.eq], range: { min: EQ_RANGE.min, max: EQ_RANGE.max } },
  quickSettings: (device: PixelBudsDevice, state: PixelBudsState): QuickSetting[] => {
    const entries: QuickSetting[] = [];
    if (state.capabilities.has('multipoint')) {
      entries.push({ kind: 'toggle', id: 'multipoint', label: 'Multipoint', value: state.multipoint, set: (value) => void device.setMultipoint(value) });
    }
    if (state.capabilities.has('onHead')) {
      entries.push({
        kind: 'toggle',
        id: 'on-head-detection',
        label: 'On-head detection',
        value: state.onHeadDetection,
        set: (value) => void device.setOnHeadDetection(value),
      });
    }
    return entries;
  },
} as const satisfies DeviceDriver<PixelBudsDevice, PixelBudsState>;
