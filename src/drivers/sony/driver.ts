/**
 * The Sony (MDR) driver descriptor.
 *
 * The mirror of `drivers/sennheiser/driver.ts`, and there for the same
 * reason: the components map belongs beside the sections it names, not in
 * `ui/sections/registry.ts` where `core/driver.ts` had to reach up for it.
 *
 * Nothing but *types* comes back from `@/core/driver` — see the note in the
 * Sennheiser descriptor for why that asymmetry matters.
 */

import type { DeviceDriver, DriverSection, EqPresets, QuickSetting } from '@/core/driver';
import { sonyArtwork } from './artwork';
import { servicesFor } from '@/core/transport';
import { PROFILES } from '@/core/profiles';
import { OFFERED_EQ_PRESETS, PRIOR_MODE_OPTIONS, SonyFunction, codecName, eqPresetName, EQ_RANGE } from './mdr/commands';
import { SonyDevice } from './sony';
import type { SonyState } from './sony';
import { SonyNoise } from './sections/SonyNoise';
import { SonySound } from './sections/SonySound';
import { SonySystem } from './sections/SonySystem';
import { SonyConnections } from './sections/SonyConnections';

/**
 * No debug section for Sony yet: the console decodes GAIA frames and sweeps
 * GAIA command IDs, neither of which applies to MDR. `spike/sony.html` covers
 * Sony debugging until there is an MDR equivalent.
 */
const SONY_SECTIONS: DriverSection[] = [
  { id: 'noise', label: 'Noise control' },
  { id: 'sound', label: 'Sound' },
  { id: 'devices', label: 'Connections' },
  { id: 'system', label: 'System' },
];

/**
 * Whether the pairing list is something a person can act on: the device
 * answered the query *and* named at least one device. A non-null but empty
 * list (WF-C500) means the model has no list to manage, which is the same
 * absence as never having answered as far as every consumer is concerned.
 */
function hasPairingList(state: SonyState): boolean {
  const list = state.connections;
  return list !== null && list.devices.length > 0;
}

/**
 * Which component renders each of the ids above — formerly
 * `SONY_COMPONENTS` in `ui/sections/registry.ts`.
 *
 * Four entries to Sennheiser's five, and no `debug`: the map is keyed by
 * whatever ids this driver actually declares, never by a shared union of
 * every driver's.
 */
const COMPONENTS = {
  noise: SonyNoise,
  sound: SonySound,
  devices: SonyConnections,
  system: SonySystem,
} as const;

/**
 * One earbud's level plus what its charge status implies.
 *
 * A bud in the case leaves the tandem link, so the device reports UNKNOWN with
 * level 0 rather than a charge state. That absence — not the charge status —
 * is what indicates the case.
 */
const earbud = (cell: {
  level: number
  charging: boolean
  onPower: boolean
  present: boolean
}): string => {
  if (!cell.present) return 'in case';
  return `${cell.level}%${cell.charging ? ' ⚡' : cell.onPower ? ' ⏻' : ''}`;
};

export const SONY_DRIVER = {
  id: 'sony-mdr',
  label: 'Sony (MDR)',
  brand: 'sony',
  services: servicesFor('sony'),
  profiles: PROFILES.filter((profile) => profile.brand === 'sony'),
  create: (deps) => new SonyDevice(deps.openTransport),
  // The one gating rule for Sony's sections lives here and only here — see
  // the note on `DriverSection`; `ui/sections/registry.ts` used to restate
  // this same rule in `sectionsForDevice`'s Sony branch, and the two had a
  // "keep in sync" comment to prove it. That branch is gone now that
  // `sectionsForDevice` calls this instead of a parallel Sony-specific path.
  sections: (state) => {
    // Before a capability table has been read, keep the tab rather than
    // hiding a section that is about to appear.
    const known = state.capabilities.size > 0;
    const hasNoise = !known || state.noiseVariant !== null;
    const hasPairing = !known || hasPairingList(state);
    return SONY_SECTIONS.filter(
      (section) =>
        (section.id !== 'noise' || hasNoise) && (section.id !== 'devices' || hasPairing),
    );
  },
  components: COMPONENTS,
  codecName: (state: SonyState) => (state.codec === null ? null : codecName(state.codec)),
  // Reported per earbud, so shown per earbud rather than collapsed. Moved
  // here from `ui/device/summary.ts`, whose Sennheiser branch had nothing to
  // say about it; the shared summary now asks the driver instead.
  statusLine: (state: SonyState) =>
    state.battery
      ? `L ${earbud(state.battery.left)} · R ${earbud(state.battery.right)}`
      : null,
  // MDR has a pause-on-removal capability but this driver never decodes a
  // wear state from it, so there is nothing to report and the render is left
  // undimmed — exactly what both callers got by hardcoding `null` before.
  worn: (_state: SonyState) => true,
  // Catalog-only artwork; Sony's colour byte picks the render — see
  // `./artwork.ts`.
  artwork: (state: SonyState) => sonyArtwork(state.info.model, state.info.colour?.colour ?? null),
  // The curve and the preset id the device last reported, which is what the
  // Sound page already shows. A device with no EQ capability never fills `eq`,
  // so the Home tile falls back to a link rather than drawing an empty curve.
  eqPreview: (state: SonyState) =>
    state.eq === null
      ? null
      : { preset: eqPresetName(state.eq.preset), gains: state.eq.gains, range: EQ_RANGE },
  // The paired-device list `sections/SonyConnections.tsx` renders. Sony has no
  // "own index" the way GAIA does, so no entry is marked as this one.
  //
  // An empty list reads as unsupported, not as "zero paired": entry-level
  // models (WF-C500) answer the pairing query with no devices, and there is
  // nothing to tab to, tile, or count. `sections()` above applies the same
  // predicate, so the tab, the Home tile and the LINKS chip disappear together.
  connections: (state: SonyState) => {
    if (!hasPairingList(state)) return null;
    // `playbackMac` is the peer audio is playing from ("Audio here" in the
    // Connections section), not the peer this app talks through, and MDR has
    // no field for the latter — so no entry claims to be this one.
    return state.connections!.devices.map((entry) => ({
      name: entry.name || entry.mac,
      connected: entry.connected,
      isThisDevice: false,
    }));
  },
  // Each gated the way its own section gates it: a capability the device
  // reported, or a reading it answered. Nothing is offered on a guess.
  quickSettings: (device: SonyDevice, state: SonyState): QuickSetting[] => {
    const has = (id: number) => state.capabilities.has(id);
    const settings: QuickSetting[] = [];
    if (has(SonyFunction.PauseOnRemoval)) {
      settings.push({
        kind: 'toggle',
        id: 'pauseOnRemoval',
        label: 'Pause when removed',
        value: state.pauseOnRemoval,
        set: (value: boolean) => void device.setPauseOnRemoval(value),
      });
    }
    if (state.speakToChat !== null) {
      settings.push({
        kind: 'toggle',
        id: 'speakToChat',
        label: 'Speak-to-chat',
        value: state.speakToChat.enabled,
        set: (value: boolean) => void device.setSpeakToChatEnabled(value),
      });
    }
    if (has(SonyFunction.UpscalingAutoOff) || has(SonyFunction.UpscalingIndicator)) {
      settings.push({
        kind: 'toggle',
        id: 'upscaling',
        label: 'DSEE',
        value: state.upscaling,
        set: (value: boolean) => void device.setUpscaling(value),
      });
    }
    if (state.voiceGuidance !== null) {
      settings.push({
        kind: 'toggle',
        id: 'voiceGuidance',
        label: 'Voice prompts',
        value: state.voiceGuidance.enabled,
        set: (value: boolean) => void device.setVoiceGuidance(value),
      });
    }
    if (has(SonyFunction.ConnectionQualityMode)) {
      settings.push({
        kind: 'choice',
        id: 'connectionMode',
        label: 'Connection',
        value: state.connectionMode === null ? null : String(state.connectionMode),
        options: PRIOR_MODE_OPTIONS.map(({ value, label }) => ({ value: String(value), label })),
        set: (value: string) => void device.setConnectionMode(Number(value)),
      });
    }
    return settings;
  },
  eqPresets: (device: SonyDevice, state: SonyState): EqPresets | null => {
    const { eq } = state;
    if (!state.capabilities.has(SonyFunction.PresetEq) || eq === null) return null;
    return {
      presets: OFFERED_EQ_PRESETS.map((preset) => ({
        id: String(preset),
        name: eqPresetName(preset),
        active: eq.preset === preset,
      })),
      select: (id: string) => void device.setEqPreset(Number(id)),
    };
  },
} as const satisfies DeviceDriver<SonyDevice, SonyState>;
