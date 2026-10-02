/**
 * The Xiaomi / Redmi Buds driver descriptor. Capability gating runs off the
 * probed set (`device.ts`), the same shape as `drivers/heymelody/driver.ts`.
 */

import type { DeviceDriver, DriverSection, EqPresets, QuickSetting } from '@/core/driver';
import { servicesFor } from '@/core/transport';
import { xiaomiArtwork } from './assets';
import { AncMode, BATTERY_LABEL } from './commands';
import type { AncModeValue } from './commands';
import { XiaomiDevice } from './device';
import type { XiaomiState } from './device';
import { eqPresetOptions } from './eqPresets';
import { XiaomiNoise } from './sections/XiaomiNoise';
import { XiaomiSound } from './sections/XiaomiSound';
import { XiaomiSystem } from './sections/XiaomiSystem';

const XIAOMI_SECTIONS: DriverSection[] = [
  { id: 'noise', label: 'Noise control' },
  { id: 'sound', label: 'Sound' },
  { id: 'system', label: 'System' },
];

const COMPONENTS = {
  noise: XiaomiNoise,
  sound: XiaomiSound,
  system: XiaomiSystem,
} as const;

export const XIAOMI_DRIVER = {
  id: 'xiaomi-rcsp',
  label: 'Xiaomi / Redmi Buds',
  brand: 'xiaomi',
  services: servicesFor('xiaomi'),
  profiles: [],
  create: (deps) => new XiaomiDevice(deps.openTransport),
  sections: (state) => {
    // Before a probe has run, keep every tab rather than hiding one about to appear.
    const known = state.capabilities.size > 0;
    return XIAOMI_SECTIONS.filter((section) => {
      if (section.id === 'noise') return !known || state.capabilities.has('anc');
      if (section.id === 'sound') return !known || state.capabilities.has('eq');
      return true;
    });
  },
  components: COMPONENTS,
  codecName: (_state: XiaomiState) => null,
  statusLine: (state: XiaomiState) => {
    if (state.battery.length === 0) return null;
    return state.battery.map((cell) => `${BATTERY_LABEL[cell.device]} ${cell.level}%${cell.charging ? ' ⚡' : ''}`).join(' · ');
  },
  // The protocol reports no wear state, only whether detection is enabled, so it is always "unknown".
  worn: (_state: XiaomiState) => true,
  artwork: (_state: XiaomiState) => xiaomiArtwork(),
  eqPresets: (device: XiaomiDevice, state: XiaomiState): EqPresets | null => {
    if (state.capabilities.size > 0 && !state.capabilities.has('eq')) return null;
    return {
      presets: eqPresetOptions(state.eqPreset).map((preset) => ({ id: String(preset.id), name: preset.name, active: state.eqPreset === preset.id })),
      select: (id: string) => void device.setEqPreset(Number(id)),
    };
  },
  // Noise control first, as it is the thing this app is opened for; each only when the model answered it.
  quickSettings: (device: XiaomiDevice, state: XiaomiState): QuickSetting[] => {
    const settings: QuickSetting[] = [];
    if (state.capabilities.has('anc')) {
      settings.push({
        kind: 'choice',
        id: 'anc-mode',
        label: 'Noise control',
        value: state.ancMode === null ? null : String(state.ancMode),
        options: [
          { value: String(AncMode.Off), label: 'Off' },
          { value: String(AncMode.NoiseCancelling), label: 'Noise cancelling' },
          { value: String(AncMode.Transparency), label: 'Transparency' },
        ],
        set: (value) => void device.setAncMode(Number(value) as AncModeValue),
      });
    }
    if (state.capabilities.has('wear')) {
      settings.push({ kind: 'toggle', id: 'wear-detection', label: 'In-ear detection', value: state.wearDetection, set: (value) => void device.setWearDetection(value) });
    }
    return settings;
  },
} as const satisfies DeviceDriver<XiaomiDevice, XiaomiState>;
