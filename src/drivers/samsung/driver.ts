/**
 * The Samsung Galaxy Buds driver descriptor. The earbuds report no capability
 * list, so what a tab offers comes from the static model table in
 * `models.ts`, keyed by the model the SKU named — see `device.ts`.
 *
 * Its own services are the two that name Galaxy Buds outright. The third way
 * to reach one — standard SPP, shared with other brands — is `sharedServices`,
 * which `core/identify.ts` resolves by listening to the port.
 */

import type { DeviceDriver, DriverSection, EqPresets, QuickSetting } from '@/core/driver';
import { servicesFor, sharedServicesFor } from '@/core/transport';
import { samsungArtwork } from './assets';
import { SamsungDevice } from './device';
import type { SamsungState } from './device';
import { PLACEMENT_LABEL, noiseOptions } from './labels';
import { EQ_PRESETS, modelById } from './models';
import { samsungProbe } from './probe';
import { SamsungNoise } from './sections/Noise';
import { SamsungSound } from './sections/Sound';
import { SamsungSystem } from './sections/System';

const SAMSUNG_SECTIONS: DriverSection[] = [
  { id: 'noise', label: 'Noise control' },
  { id: 'sound', label: 'Sound' },
  { id: 'system', label: 'System' },
];

const COMPONENTS = {
  noise: SamsungNoise,
  sound: SamsungSound,
  system: SamsungSystem,
} as const;

export const SAMSUNG_DRIVER = {
  id: 'samsung',
  label: 'Samsung Galaxy Buds',
  brand: 'samsung',
  services: servicesFor('samsung'),
  sharedServices: sharedServicesFor('samsung'),
  probe: samsungProbe,
  profiles: [],
  create: (deps) => new SamsungDevice(deps.openTransport),
  sections: (state) => {
    // Before the model is known, keep every tab rather than hiding one about to appear.
    const model = modelById(state.info.modelId);
    return SAMSUNG_SECTIONS.filter((section) => {
      if (!model) return true;
      if (section.id === 'noise') return noiseOptions(model).length > 0;
      if (section.id === 'sound') return model.eq;
      return true;
    });
  },
  components: COMPONENTS,
  codecName: (_state: SamsungState) => null,
  statusLine: (state: SamsungState) => {
    const parts = (['left', 'right', 'case'] as const).flatMap((key) =>
      state.battery[key] === null
        ? []
        : [`${key === 'left' ? 'L' : key === 'right' ? 'R' : 'Case'} ${state.battery[key]}%${state.charging[key] ? ' ⚡' : ''}`],
    );
    return parts.length === 0 ? null : parts.join(' · ');
  },
  // True when wear is unknown, per the interface's own contract.
  worn: (state: SamsungState) =>
    state.placement.left === 'disconnected' && state.placement.right === 'disconnected'
      ? true
      : state.placement.left === 'wearing' || state.placement.right === 'wearing',
  wearCaption: (state: SamsungState) =>
    state.placement.left === 'disconnected' && state.placement.right === 'disconnected'
      ? null
      : `L ${PLACEMENT_LABEL[state.placement.left].toLowerCase()} · R ${PLACEMENT_LABEL[state.placement.right].toLowerCase()}`,
  artwork: (_state: SamsungState) => samsungArtwork(),
  eqPresets: (device: SamsungDevice, state: SamsungState): EqPresets | null => {
    const model = modelById(state.info.modelId);
    if (!model?.eq) return null;
    const presets = [
      { id: '0', name: 'Normal', active: state.eq === 0 },
      ...EQ_PRESETS.map((name, index) => ({ id: String(index + 1), name, active: state.eq === index + 1 })),
    ];
    return { presets, select: (id: string) => void device.setEqPreset(Number(id)) };
  },
  quickSettings: (device: SamsungDevice, state: SamsungState): QuickSetting[] =>
    modelById(state.info.modelId)?.lock
      ? [{ kind: 'toggle', id: 'touch-lock', label: 'Lock touch controls', value: state.touchLocked, set: (value) => void device.setTouchLocked(value) }]
      : [],
} as const satisfies DeviceDriver<SamsungDevice, SamsungState>;
