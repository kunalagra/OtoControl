/**
 * The driver registry: one descriptor per manufacturer, as a data table
 * rather than a class hierarchy — matching how `PROFILES`, `TOGGLES`,
 * `KNOWN_SERVICES` and `EQ_PRESETS` already express variation elsewhere in
 * this codebase. Abstract Factory in effect, without inheritance. See
 * `docs/superpowers/specs/2026-08-11-driver-architecture-design.md` §3.2.
 *
 * The manager and the UI now consume this: `manager.ts` holds devices keyed
 * by driver id, and `ui/sections/registry.ts` resolves sections and
 * components through whichever driver is active, rather than branching on
 * `Brand` directly. Components still live in `ui/` and are imported from
 * there — moving the files themselves is a later phase (§5, step 5),
 * deliberately not this one. Sections do not: `DriverSection` (below) is this
 * module's own core-side shape, so that a driver's section list can be built
 * without reaching into the UI layer at all — see the note on `DriverSection`
 * for why.
 */

import type { ComponentType } from 'react';

import type { Brand } from './brand';
import type { DeviceState } from './state';
import { MomentumDevice } from './device';
import type { DeviceProfile } from './profiles';
import { PROFILES } from './profiles';
import { SonyDevice } from './sony';
import type { SonyState } from './sony';
import type { TransportOpener } from './transport';
import { KNOWN_SERVICES } from './transport';
import { SENNHEISER_COMPONENTS, SONY_COMPONENTS } from '@/ui/sections/registry';

/**
 * How a driver obtains its device's transport.
 *
 * Mirrors `TransportOpener` from `transport.ts` rather than re-exporting it
 * verbatim, because the spec (§3.2) writes `DriverDeps` as its own interface
 * — a driver depends on "how to open a transport", not on the transport
 * module's internal naming for that function.
 */
export interface DriverDeps {
  /** Left undefined to fall back to the real one — both device classes already default this themselves. */
  openTransport?: TransportOpener;
}

/**
 * A section's own component, typed against its driver's device and state
 * rather than the union of every driver's.
 *
 * Sony's components (`SonyNoise`, `SonySound`, `SonySystem`) take only
 * `{ device, state }`, no `onNavigate` — narrower than this. A function
 * requiring fewer parameters is assignable wherever more are supplied, so
 * they satisfy this type unchanged; nothing about their signatures needs to
 * grow an unused prop just to fit the shared shape.
 */
export type SectionComponent<TDevice, TState> = ComponentType<{
  device: TDevice;
  state: TState;
  onNavigate: (sectionId: string) => void;
}>;

/**
 * A section's core-side description: what to call it, and whether it
 * belongs in the nav.
 *
 * Deliberately without an icon. `ui/sections/registry.ts`'s old `Section`
 * carried `icon: RemixiconComponentType`, which made it genuinely UI-shaped —
 * exactly the mistake `brand.ts` records having already made once with
 * `Brand` itself, living in `ui/device/artwork` before it belonged to
 * transport, profiles and this file too. A driver decides *which* sections
 * exist and in what order; which glyph represents "noise control" is a
 * rendering choice the UI layer owns. `withIcon` in `ui/sections/registry.ts`
 * attaches one per id on top of this.
 */
export interface DriverSection {
  id: string;
  label: string;
  /** Kept out of every nav; reached deliberately from another section. */
  hidden?: boolean;
}

/**
 * A manufacturer, as one entry in `DRIVERS` rather than a subclass.
 *
 * `guard` is part of the contract in spec §3.2, but deliberately absent
 * here: `src/gaia/unsafe.ts` is GAIA-shaped (`{ vendor, command }`) and Sony
 * has no guard at all today. Shaping a Sony guard just to fill this field
 * would be a fabricated safety net, which is worse than the honest gap —
 * introducing it properly is its own task.
 *
 * TODO(spec §3.2): add `guard: DriverGuard<TAddress>` (and the `TAddress`
 * generic it needs) once Sony has a guard of its own to generalise from.
 */
export interface DeviceDriver<TDevice, TState> {
  id: string;
  label: string;
  /**
   * The protocol family this driver's profiles, artwork and known services
   * are filed under — see `Brand` in `./brand.ts`. Named separately from
   * `id` on purpose: `id` names *this driver*; `brand` names the vocabulary
   * that data tables outside this file (`profiles.ts`, `transport.ts`,
   * `ui/device/artwork.ts`) are still keyed by, and which the manager's
   * sticky selection (`resolveBrand`/`knowsDevice`) is pinned to by its own
   * tests. The two happen to be in step today; nothing requires they stay
   * that way if a driver ever needs a `Brand` finer-grained than one driver.
   */
  brand: Brand;
  /** RFCOMM service UUIDs that identify this driver's devices. */
  services: readonly string[];
  profiles: readonly DeviceProfile[];
  create(deps: DriverDeps): TDevice;
  /** The driver decides how capability works — statically or negotiated. */
  sections(state: TState): readonly DriverSection[];
  components: Record<string, SectionComponent<TDevice, TState>>;
}

/**
 * A driver's services, taken from `KNOWN_SERVICES` rather than restated.
 *
 * The dependency runs this direction, not the other way, because the other
 * way is circular: `KNOWN_SERVICES` deriving from `DRIVERS` would need
 * `transport.ts` to import `driver.ts`, which imports `device.ts` and
 * `sony.ts`, both of which import `transport.ts` for `TransportOpener` and
 * `openSerialTransport`. `transport.ts` stays the one hand-maintained list;
 * this is the derived side, so the two cannot drift apart — see
 * `driver.test.ts` for the two-way check that would catch it if they ever did.
 */
const servicesFor = (brand: Brand): readonly string[] =>
  KNOWN_SERVICES.filter((service) => service.brand === brand).map((service) => service.uuid);

/**
 * Sections per driver, in nav order.
 *
 * Deliberately not normalised across drivers: the Momentum 4's noise control
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
 * No debug section for Sony yet: the console decodes GAIA frames and sweeps
 * GAIA command IDs, neither of which applies to MDR. `spike/sony.html` covers
 * Sony debugging until there is an MDR equivalent.
 */
const SONY_SECTIONS: DriverSection[] = [
  { id: 'noise', label: 'Noise control' },
  { id: 'sound', label: 'Sound' },
  { id: 'system', label: 'System' },
];

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
  // (`sectionsForDevice`, the tests below) calls this with a state argument.
  sections: (_state: DeviceState) => SENNHEISER_SECTIONS,
  components: SENNHEISER_COMPONENTS,
} as const satisfies DeviceDriver<MomentumDevice, DeviceState>;

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
    return hasNoise ? SONY_SECTIONS : SONY_SECTIONS.filter((section) => section.id !== 'noise');
  },
  components: SONY_COMPONENTS,
} as const satisfies DeviceDriver<SonyDevice, SonyState>;

/**
 * Every driver this app can offer, in one heterogeneous list.
 *
 * `TDevice` appears covariantly in `create()`'s return type, so
 * `DeviceDriver<MomentumDevice, DeviceState>` is not structurally assignable
 * to `DeviceDriver<never, never>` — nothing but `never` is assignable to
 * `never`. That is the one cast this file needs.
 *
 * It costs nothing at any real call site: iterating `DRIVERS` is for
 * driver-agnostic questions (which UUID belongs to which driver, are the ids
 * unique, does every service appear in `KNOWN_SERVICES`) and never calls
 * `.create()` off the erased list. A caller that actually needs to build a
 * device, or call `sections()`/`components` against a concrete state, already
 * knows which brand it is dealing with and reaches for `SENNHEISER_DRIVER` /
 * `SONY_DRIVER` above instead, which keep their real types.
 */
export const DRIVERS: readonly DeviceDriver<never, never>[] = [
  SENNHEISER_DRIVER,
  SONY_DRIVER,
] as unknown as readonly DeviceDriver<never, never>[];

/** The driver that speaks a given RFCOMM service, or null if none does. */
export function driverForService(uuid: string): DeviceDriver<never, never> | null {
  return DRIVERS.find((driver) => driver.services.includes(uuid)) ?? null;
}
