/**
 * The Nothing/CMF driver descriptor.
 *
 * The mirror of `drivers/sony/driver.ts`. Section gating runs off the probed
 * capability set rather than Sony's reported table — see `drivers/nothing/device.ts`
 * for why probing is this brand's equivalent of a capability query.
 */

import type { DeviceDriver, DriverSection } from '@/core/driver';
import { nothingArtwork } from './artwork';
import { CUSTOM_EQ_RANGE, DiracPreset, EqPreset, isWorn } from './commands';
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
  /**
   * The custom curve, when that is what the device is playing.
   *
   * Nothing's presets are chosen by id and their curves are the device's own —
   * not in a table here, and not in `customEq` either — so the only curve this
   * app can see is the one it can also edit: the custom profile, or the advanced
   * parametric one while it is overriding the preset row. On a named preset
   * there is genuinely nothing to draw, so this answers null and the Home tile
   * falls back to a link rather than pairing a preset's name with another
   * profile's bars.
   */
  eqPreview: (state: NothingState) => {
    const custom = state.eqPreset === EqPreset.Custom || state.diracEq === DiracPreset.Custom;
    if (!custom && state.advancedEq !== true) return null;
    const bands = state.customEq?.bands ?? state.advancedEqBands?.bands ?? null;
    if (bands === null || bands.length === 0) return null;
    return {
      // Null rather than "Custom": the tile says Custom itself, which is one less
      // place for the word to live.
      preset: null,
      gains: bands.map((band) => band.gain),
      range: CUSTOM_EQ_RANGE,
    };
  },
} as const satisfies DeviceDriver<NothingDevice, NothingState>;
