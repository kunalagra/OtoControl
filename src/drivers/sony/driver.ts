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

import type { DeviceDriver, DriverSection } from '@/core/driver';
import { sonyArtwork } from './artwork';
import { servicesFor } from '@/core/transport';
import { PROFILES } from '@/core/profiles';
import { codecName } from './mdr/commands';
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
    const hasPairing = !known || state.connections !== null;
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
} as const satisfies DeviceDriver<SonyDevice, SonyState>;
