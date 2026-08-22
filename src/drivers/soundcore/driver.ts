/**
 * The Soundcore driver descriptor.
 *
 * BLE-only: these earbuds expose no serial service, which is what kept them
 * out of a WebSerial app until `core/gattTransport.ts` existed. `services` is
 * therefore empty — no serial picker entry can name this driver — and the
 * manager resolves it through the GATT service family instead
 * (`core/gattTransport.ts`'s `KNOWN_GATT_SERVICES`).
 */

import type { DeviceDriver, DriverSection } from '@/core/driver';
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
} as const satisfies DeviceDriver<SoundcoreDevice, SoundcoreState>;
