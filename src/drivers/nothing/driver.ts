/**
 * The Nothing/CMF driver descriptor.
 *
 * The mirror of `drivers/sony/driver.ts`. Section gating runs off the probed
 * capability set rather than Sony's reported table — see `drivers/nothing/device.ts`
 * for why probing is this brand's equivalent of a capability query.
 */

import type { DeviceDriver, DriverSection } from '@/core/driver';
import { nothingArtwork } from './artwork';
import { isWorn } from './commands';
import { servicesFor } from '@/core/transport';
import { PROFILES } from '@/core/profiles';
import { NothingDevice } from './device';
import type { NothingState } from './device';
import { NothingNoise } from './sections/NothingNoise';
import { NothingSound } from './sections/NothingSound';
import { NothingSystem } from './sections/NothingSystem';

const NOTHING_SECTIONS: DriverSection[] = [
  { id: 'noise', label: 'Noise control' },
  { id: 'sound', label: 'Sound' },
  { id: 'system', label: 'System' },
];

const COMPONENTS = {
  noise: NothingNoise,
  sound: NothingSound,
  system: NothingSystem,
} as const;

const earbud = (cell: { level: number; charging: boolean } | null): string =>
  cell === null ? '—' : `${cell.level}%${cell.charging ? ' ⚡' : ''}`;

export const NOTHING_DRIVER = {
  id: 'nothing-spp',
  label: 'Nothing / CMF',
  brand: 'nothing',
  services: servicesFor('nothing'),
  profiles: PROFILES.filter((profile) => profile.brand === 'nothing'),
  create: (deps) => new NothingDevice(deps.openTransport),
  sections: (state) => {
    // Before a probe has run, keep every tab rather than hiding a section
    // that is about to appear.
    const known = state.capabilities.size > 0;
    const hasNoise = !known || state.capabilities.has('anc') || state.capabilities.has('personalizedAnc');
    return hasNoise ? NOTHING_SECTIONS : NOTHING_SECTIONS.filter((section) => section.id !== 'noise');
  },
  components: COMPONENTS,
  codecName: (_state: NothingState) => null,
  statusLine: (state: NothingState) => {
    const { left, right, case: caseCell, single } = state.battery;
    // A single-body device has no pair to lay out, and the level is already
    // the headline figure — repeating it as a detail line says nothing.
    if (single) return null;
    if (!left && !right && !caseCell) return null;
    return `L ${earbud(left)} · R ${earbud(right)} · Case ${earbud(caseCell)}`;
  },
  /**
   * Worn, from `GET_EARPHONE_STATUS`'s in-ear bit. Until that read was wired
   * this returned a constant `true` — "assume worn" — because in-ear detection
   * is a pause-on-removal *setting*, not a sensor reading. A device that does
   * not answer the status read keeps the old assumption rather than rendering
   * as taken off.
   */
  worn: (state: NothingState) => (state.earphoneStatus === null ? true : isWorn(state.earphoneStatus)),
  // Renders come from Nothing's CDN, keyed by the profile's slug and the
  // colourway the device reported — see `./artwork.ts`.
  artwork: (state: NothingState) => nothingArtwork(state.info.model, state.info.colourId),
} as const satisfies DeviceDriver<NothingDevice, NothingState>;
