/**
 * The Soundcore driver descriptor.
 *
 * BLE-only: these earbuds expose no serial service, which is what kept them
 * out of a WebSerial app until `core/gattTransport.ts` existed. `services` is
 * therefore empty — no serial picker entry can name this driver — and the
 * manager resolves it through the GATT service family instead
 * (`core/gattTransport.ts`'s `KNOWN_GATT_SERVICES`).
 *
 * **Do not retry the RFCOMM route.** An earlier spike reached an A3951 over
 * Web Serial on macOS on both the standard SPP service and Soundcore's vendor
 * one: Chrome enumerated and opened them, and the encoded request matched
 * OpenSCQ30's own test vector byte for byte, but nothing came back on either
 * channel — and operating the buds' own touch controls produced no inbound
 * bytes either, which rules out "wrong command" and points at the platform.
 * OpenSCQ30 supports Windows, Linux and Android but not macOS, and ships no
 * macOS backend. BLE GATT is what unblocked this brand; RFCOMM stays a dead
 * end until someone shows any macOS program talking to an A3951 over it.
 */

import type { DeviceDriver, DriverSection, EqPresets, QuickSetting } from '@/core/driver';
import { soundcoreArtwork } from './assets';
import { EQ_DB_RANGE, EQ_PRESETS, eqPresetName } from './commands';
import { PROFILES } from '@/core/profiles';
import { SoundcoreDevice } from './device';
import type { SoundcoreState } from './device';
import { SoundcoreNoise } from './sections/SoundcoreNoise';
import { SoundcoreSound } from './sections/SoundcoreSound';
import { SoundcoreSystem } from './sections/SoundcoreSystem';

const SOUNDCORE_SECTIONS: DriverSection[] = [
  { id: 'noise', label: 'Noise control' },
  { id: 'sound', label: 'Sound' },
  { id: 'system', label: 'System' },
];

const COMPONENTS = {
  noise: SoundcoreNoise,
  sound: SoundcoreSound,
  system: SoundcoreSystem,
} as const;

const earbud = (cell: { level: number | null; charging: boolean }): string =>
  `${cell.level ?? '—'}%${cell.charging ? ' ⚡' : ''}`;

export const SOUNDCORE_DRIVER = {
  id: 'soundcore-gatt',
  label: 'Soundcore',
  brand: 'soundcore',
  services: [],
  profiles: PROFILES.filter((profile) => profile.brand === 'soundcore'),
  create: (deps) => new SoundcoreDevice(deps.openTransport),
  sections: (_state: SoundcoreState) => SOUNDCORE_SECTIONS,
  components: COMPONENTS,
  codecName: (_state: SoundcoreState) => null,
  statusLine: (state: SoundcoreState) =>
    state.battery
      ? `L ${earbud(state.battery.left)} · R ${earbud(state.battery.right)}`
      : null,
  // The state response carries a wear-detection flag, but this driver never
  // decodes a worn state to act on, so the render stays undimmed.
  worn: (_state: SoundcoreState) => true,
  // The product code read off the serial wins over the advertised name —
  // see `./assets.ts`.
  artwork: (state: SoundcoreState) => soundcoreArtwork(state.info.model, state.info.productCode),
  // The curve the earbuds are playing, from the same state the Sound page's
  // faders read. Gains travel as signed tenths, hence the division; a Custom
  // profile is reported as the name 'Custom' by `eqPresetName`, which is what
  // the Sound page calls it too.
  eqPreview: (state: SoundcoreState) =>
    state.eq === null
      ? null
      : {
          preset: eqPresetName(state.eq.profile),
          // The left ear: the ears are edited together unless they differ, and
          // a per-side curve has no single set of bars to draw.
          gains: state.eq.left.map((tenths) => tenths / 10),
          range: EQ_DB_RANGE,
        },
  // The System tab's switches, none of them capability-gated there either.
  quickSettings: (device: SoundcoreDevice, state: SoundcoreState): QuickSetting[] => [
    {
      kind: 'toggle',
      id: 'wearDetection',
      label: 'Wear detection',
      value: state.wearDetection,
      set: (value: boolean) => void device.setWearDetection(value),
    },
    {
      kind: 'toggle',
      id: 'ldac',
      label: 'LDAC',
      value: state.ldac,
      set: (value: boolean) => void device.setLdac(value),
    },
    {
      kind: 'toggle',
      id: 'voicePrompt',
      label: 'Voice prompts',
      value: state.voicePrompt,
      set: (value: boolean) => void device.setVoicePrompt(value),
    },
    {
      kind: 'toggle',
      id: 'touchTone',
      label: 'Tap sound',
      value: state.touchTone,
      set: (value: boolean) => void device.setTouchTone(value),
    },
  ],
  // The regular presets only: the artist ones are a long second list that
  // belongs on the Sound tab rather than in a Home tile.
  eqPresets: (device: SoundcoreDevice, state: SoundcoreState): EqPresets | null => {
    const { eq } = state;
    if (eq === null) return null;
    return {
      presets: EQ_PRESETS.filter((preset) => !preset.artist).map((preset) => ({
        id: String(preset.id),
        name: preset.name,
        active: eq.profile === preset.id,
      })),
      select: (id: string) => void device.setEqPreset(Number(id)),
    };
  },
} as const satisfies DeviceDriver<SoundcoreDevice, SoundcoreState>;
