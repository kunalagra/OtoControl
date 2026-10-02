/**
 * The HeyMelody driver descriptor — OPPO/realme/OnePlus earbuds sharing one
 * app and protocol. Capability gating runs off the opportunistically-probed
 * set (`device.ts`), the same shape as `drivers/nothing/driver.ts`, not
 * Sony's live bitmap negotiation — see spec §3.5 for why.
 */

import type { DeviceDriver, DriverSection, EqPresets, QuickSetting } from '@/core/driver';
import { servicesFor } from '@/core/transport';
import { heymelodyArtwork } from './assets';
import { HeyMelodyDevice } from './device';
import { heymelodyProbe } from './probe';
import { builtinPresets } from './eqModes';
import type { HeyMelodyState } from './device';
import { BATTERY_LABEL } from './protocol/battery';
import { FeatureId, gameModeIds } from './protocol/feature';
import { HeyMelodyDevices } from './sections/Devices';
import { HeyMelodyNoise } from './sections/Noise';
import { HeyMelodySound } from './sections/Sound';
import { HeyMelodySystem } from './sections/System';

const HEYMELODY_SECTIONS: DriverSection[] = [
  { id: 'noise', label: 'Noise control' },
  { id: 'sound', label: 'Sound' },
  { id: 'devices', label: 'Connections' },
  { id: 'system', label: 'System' },
];

const COMPONENTS = {
  noise: HeyMelodyNoise,
  sound: HeyMelodySound,
  devices: HeyMelodyDevices,
  system: HeyMelodySystem,
} as const;

export const HEYMELODY_DRIVER = {
  id: 'heymelody',
  label: 'HeyMelody (OPPO / realme / OnePlus)',
  brand: 'heymelody',
  services: servicesFor('heymelody'),
  probe: heymelodyProbe,
  profiles: [],
  create: (deps) => new HeyMelodyDevice(deps.openTransport),
  sections: (state) => {
    // Before a probe has run, keep every tab rather than hiding one about to appear.
    const known = state.capabilities.size > 0;
    return HEYMELODY_SECTIONS.filter((section) => {
      if (section.id === 'noise') return !known || state.capabilities.has('anc');
      if (section.id === 'sound') return !known || state.capabilities.has('eq') || state.capabilities.has('eqCustom');
      // Nothing to show without the list, so unlike the others this stays hidden until it is known.
      if (section.id === 'devices') return state.capabilities.has('multiDevice');
      return true;
    });
  },
  components: COMPONENTS,
  // Null until the list has been read, so Home shows its own empty state rather than an empty tile.
  connections: (state: HeyMelodyState) =>
    state.peers.length === 0 ? null : state.peers.map(({ name, connected, isThisDevice }) => ({ name, connected, isThisDevice })),
  codecName: (_state: HeyMelodyState) => null,
  statusLine: (state: HeyMelodyState) => {
    if (state.battery.length === 0) return null;
    return state.battery
      .map((cell) => `${BATTERY_LABEL[cell.device]} ${cell.level}%${cell.charging ? ' ⚡' : ''}`)
      .join(' · ');
  },
  // True when wear is unknown, per the interface's own contract.
  worn: (state: HeyMelodyState) => state.wear.length === 0 || state.wear.some((cell) => cell.inEar),
  artwork: (state: HeyMelodyState) => heymelodyArtwork(state.info.productId, state.info.colourId),
  /**
   * The curve of whichever preset is playing, and the range that preset itself
   * reports — this protocol's presets carry their own min/max, so nothing here
   * is assumed. Null for a built-in preset (no curve on the wire) or when the
   * device has answered no preset list; the Home tile then shows the active chip's name.
   */
  eqPreview: (state: HeyMelodyState) => {
    const id = state.eqCurrentPreset ?? state.eqPresets.find((preset) => preset.isSelected)?.eqId ?? null;
    const preset = id === null ? null : state.eqPresets.find((entry) => entry.eqId === id);
    if (!preset || preset.bands.length === 0) return null;
    return {
      preset: preset.name,
      gains: preset.bands.map((band) => band.dbValue),
      range: { min: preset.minValue, max: preset.maxValue },
    };
  },
  // The model's built-ins, then the custom presets the device listed — the same two groups the Sound tab shows.
  eqPresets: (device: HeyMelodyDevice, state: HeyMelodyState): EqPresets | null => {
    const { capabilities } = state;
    const known = capabilities.size > 0;
    const hasBuiltins = !known || capabilities.has('eq');
    if (!hasBuiltins && !capabilities.has('eqCustom')) return null;
    const selected = state.eqCurrentPreset ?? state.eqPresets.find((preset) => preset.isSelected)?.eqId ?? null;
    const customIds = new Set(state.eqPresets.map((preset) => preset.eqId));
    const builtins = hasBuiltins ? builtinPresets(state.info.catalog).filter((preset) => !customIds.has(preset.id)) : [];
    const presets = [
      ...builtins.map((preset) => ({ id: String(preset.id), name: preset.name, active: selected === preset.id })),
      ...state.eqPresets.map((preset) => ({ id: String(preset.eqId), name: preset.name, active: selected === preset.eqId })),
    ];
    if (presets.length === 0) return null;
    return { presets, select: (id: string) => void device.setEqPreset(Number(id)) };
  },
  // Game mode first, then the rest in the order the System tab lists them; each only when the model reported it.
  quickSettings: (device: HeyMelodyDevice, state: HeyMelodyState): QuickSetting[] => {
    const { features } = state;
    const game = gameModeIds(features);
    const entries: Array<[number | null, string]> = [
      [game.main, 'Game mode'],
      [features.has(FeatureId.AutoPlay) ? FeatureId.AutoPlay : null, 'Auto play/pause'],
      [features.has(FeatureId.BassWave) ? FeatureId.BassWave : null, 'BassWave'],
      [game.lowLatency, 'Low latency'],
    ];
    return entries.flatMap(([id, label]): QuickSetting[] =>
      id === null
        ? []
        : [{ kind: 'toggle', id: `feature-${id}`, label, value: features.get(id) ?? null, set: (value) => void device.setFeature(id, value) }],
    );
  },
} as const satisfies DeviceDriver<HeyMelodyDevice, HeyMelodyState>;
