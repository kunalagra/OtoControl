/**
 * The Sennheiser (GAIA) driver descriptor.
 *
 * One half of what `core/driver.ts` used to assemble centrally. It lives here,
 * beside the sections and the device class it names, because assembling it in
 * the core tier is what forced that tier to import `@/ui/sections/registry`
 * for its components map — the one edge in the tree that pointed from the
 * device tier up into the UI tier.
 *
 * Nothing but *types* comes back from `@/core/driver`, deliberately: that
 * module imports this one for `DRIVERS`, so a runtime import in this
 * direction would close a cycle. `servicesFor` comes from `@/core/transport`,
 * beside the `KNOWN_SERVICES` table it filters, for exactly that reason.
 */

import type { DeviceDriver, DriverSection } from '@/core/driver';
import { sennheiserArtwork } from './assets';
import { servicesFor } from '@/core/transport';
import { PROFILES } from '@/core/profiles';
import { WearState, codecName, eqPresetName, wearStateName } from './gaia/commands';
import { MomentumDevice } from './device';
import type { DeviceState } from './state';
import { Debug } from './sections/Debug';
import { Devices } from './sections/Devices';
import { Noise } from './sections/Noise';
import { Sound } from './sections/Sound';
import { System } from './sections/System';

/**
 * Sections in nav order.
 *
 * Deliberately not normalised against Sony's: the Momentum 4's noise control
 * and the WF-C500's capability set have little in common, and one shared
 * list pretending otherwise would mean an empty Noise page on a device with
 * no ANC.
 */
const SENNHEISER_SECTIONS: DriverSection[] = [
  { id: 'noise', label: 'Noise control' },
  { id: 'sound', label: 'Sound' },
  { id: 'devices', label: 'Connections' },
  { id: 'system', label: 'System' },
  { id: 'debug', label: 'Debug console', hidden: true },
];

/**
 * Which component renders each of the ids above.
 *
 * `ui/sections/registry.ts` used to export this map (as
 * `SENNHEISER_COMPONENTS`) and `driver.ts` used to import it from there. The
 * pairing is a fact about this driver, not about the UI layer, so it belongs
 * next to the section list it keys — `driver.test.ts` checks the two agree.
 */
const COMPONENTS = {
  noise: Noise,
  sound: Sound,
  devices: Devices,
  system: System,
  debug: Debug,
} as const;

/**
 * `as const satisfies` rather than a `DeviceDriver<...>` type annotation, so
 * that `id`'s literal type ('sennheiser-gaia') survives onto this constant
 * instead of widening to `string`. `manager.ts`'s `ActiveDevice` discriminates
 * on exactly that literal — see the comment on `ActiveDevice` for why a plain
 * `DeviceDriver<...>` annotation would not let it.
 */
export const SENNHEISER_DRIVER = {
  id: 'sennheiser-gaia',
  label: 'Sennheiser (GAIA)',
  brand: 'sennheiser',
  services: servicesFor('sennheiser'),
  profiles: PROFILES.filter((profile) => profile.brand === 'sennheiser'),
  create: (deps) => new MomentumDevice(deps.openTransport),
  // Sennheiser's section list never varies with state — GAIA has no live
  // capability table (see `profiles.ts`), so there is nothing to gate on.
  // The parameter stays declared (and ignored) rather than dropped: under
  // `satisfies`, a zero-parameter arrow keeps that literal, narrower type —
  // unlike a `DeviceDriver<...>`-annotated declaration, `satisfies` does not
  // widen it back to `(state: TState) => ...` — and every real caller
  // (`sectionsForDevice`, `core/driver.test.ts`) calls this with a state argument.
  sections: (_state: DeviceState) => SENNHEISER_SECTIONS,
  components: COMPONENTS,
  // GAIA reports the codec inside the device-info block, and names it from
  // the GAIA table — the same byte means something else to Sony.
  codecName: (state: DeviceState) =>
    state.info.codec === null ? null : codecName(state.info.codec),
  // An over-ear reports one battery and whether it is on your head, so the
  // line worth adding is the wear state.
  statusLine: (state: DeviceState) =>
    state.wearState === null ? null : wearStateName(state.wearState),
  // The same words, under the name Home asks for them by. GAIA is the one driver
  // that decodes a wear state at all, so it is the one that implements this.
  wearCaption: (state: DeviceState) =>
    state.wearState === null ? null : wearStateName(state.wearState),
  // Nothing reported yet counts as worn: the product render is dimmed to say
  // "off your head", and dimming it because the device has not answered yet
  // would be a claim we cannot make.
  worn: (state: DeviceState) => state.wearState === null || state.wearState === WearState.OnHead,
  // Renders resolve from the colour word in the model string itself —
  // see `./assets.ts`.
  artwork: (state: DeviceState) => sennheiserArtwork(state.info.model),
  // GAIA reports the band count and the gain range with the curve, so the Home
  // tile's bars mean the same thing on every Momentum: no guessed range, and no
  // bars at all until the device has answered the config query.
  eqPreview: (state: DeviceState) => {
    const { config, gains } = state.eq;
    if (config === null) return null;
    // Every band or none: an unread band drawn as 0 dB is a flat band nobody
    // reported, and it can match the curve to a preset the headphones are not
    // on. The tile falls back to its plain link until the read completes.
    const read: number[] = [];
    for (let band = 0; band < config.bands; band += 1) {
      const gain = gains[band];
      if (gain === undefined) return null;
      read.push(gain);
    }
    return {
      // Null for a hand-edited curve, which the tile shows as Custom — the same
      // answer `Sound` gives its preset list, from the same helper.
      preset: eqPresetName(read),
      gains: read,
      range: { min: config.minGain, max: config.maxGain },
    };
  },
  // The paired-device list `sections/Devices.tsx` renders, flattened for the
  // Home tile. `ownIndex` is the entry this machine is talking through, and the
  // tile marks it "· this" rather than leaving four rows to choose between.
  //
  // Null, not an empty list, until the device has named at least one entry: a
  // connected Momentum always lists the host it is talking to, so an empty
  // list is one that has not been read, and "0/0 links" would be invented.
  connections: (state: DeviceState) => {
    const { devices, ownIndex } = state.connections;
    if (devices.length === 0) return null;
    return devices.map((entry) => ({
      name: entry.name || `Device ${entry.index + 1}`,
      connected: entry.connected,
      isThisDevice: entry.index === ownIndex,
    }));
  },
} as const satisfies DeviceDriver<MomentumDevice, DeviceState>;
