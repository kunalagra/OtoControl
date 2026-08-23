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
 * `Brand` directly. Sections do not reach into the UI layer to do it:
 * `DriverSection` (below) is this module's own core-side shape, so that a
 * driver's section list can be built without knowing what renders it — see
 * the note on `DriverSection` for why.
 *
 * What lives here is only what is true of *every* driver: the descriptor
 * types, the `DRIVERS` registry, and the service lookup over it. Each
 * concrete descriptor — and the components map it carries — lives beside the
 * sections it names, in `drivers/<vendor>/driver.ts`. Assembling them here
 * instead is what used to make this file import `@/ui/sections/registry`,
 * the one edge in the tree that pointed from the device tier up into the UI
 * tier; splitting the descriptors out is what removed it.
 *
 * The remaining edge runs one way only: this module imports the two
 * descriptors, and they import nothing back from here but *types*. That
 * asymmetry is load-bearing rather than incidental — a runtime import in the
 * other direction would close a cycle whose evaluation order decides whether
 * a descriptor is built before the helper it is built from exists. It is
 * also why `servicesFor` now lives in `transport.ts`, next to the
 * `KNOWN_SERVICES` table it filters, rather than here.
 */

import type { ComponentType } from 'react';

import type { Brand } from './brand';
import type { DeviceArtwork } from './artwork';
import type { DeviceProfile } from './profiles';
import type { TransportOpener } from './transport';
import { SENNHEISER_DRIVER } from '@/drivers/sennheiser/driver';
import { SONY_DRIVER } from '@/drivers/sony/driver';
import { NOTHING_DRIVER } from '@/drivers/nothing/driver';
import { SOUNDCORE_DRIVER } from '@/drivers/soundcore/driver';

/**
 * Re-exported so this module stays the single address for "a driver".
 *
 * This existed originally to spare three `ui/` files — `layout/Sidebar.tsx`,
 * `layout/MobileChrome.tsx`, `device/summary.ts` — from importing a whole
 * descriptor just to read `…_DRIVER.id` back out as a discriminant. That
 * reason is gone: all three now compare against a `DriverId` literal and
 * import nothing from here. Kept anyway, on the narrower ground that the
 * remaining consumers are the composition root and `manager.ts`, for which
 * one import site beats three — but it is a convenience now, not a boundary.
 *
 * `export { … } from` rather than a re-declaration, so the `as const
 * satisfies` literal types survive — `ActiveDevice` discriminates on
 * `typeof SENNHEISER_DRIVER.id` and would break the moment these widened.
 */
export { SENNHEISER_DRIVER } from '@/drivers/sennheiser/driver';
export { SONY_DRIVER } from '@/drivers/sony/driver';
export { NOTHING_DRIVER } from '@/drivers/nothing/driver';
export { SOUNDCORE_DRIVER } from '@/drivers/soundcore/driver';

/**
 * Every driver id this app can produce, as a closed union.
 *
 * Derived from the descriptors rather than written out, so it cannot drift
 * from them — rename `SENNHEISER_DRIVER.id` and every comparison against the
 * old literal stops compiling. Note what this does *not* buy: it is derived
 * from the two named constants, not from `DRIVERS`, so adding a third entry
 * to `DRIVERS` widens nothing here and raises no error. Only the two
 * `Extract` arms in `ActiveDevice` would fail to cover it.
 *
 * `ActiveDevice` discriminates on this — each arm is an `Extract` of it, so
 * the union cannot name an id this type does not — and it is the type a consumer
 * wants when all it needs is "which driver is this". Three files in `ui/`
 * used to import a whole descriptor — its device class, its React components,
 * its section list — purely to read `SENNHEISER_DRIVER.id` back out as a
 * string. Comparing against the literal instead is checked just as tightly:
 * `active.id === 'sennheiser'` is a type error, not a silently-false test,
 * because the operands have no overlap.
 *
 * **It is not `brand`.** The two are related but distinct string domains —
 * `'sennheiser-gaia'` / `'sony-mdr'` here against `'sennheiser'` / `'sony'`
 * for `Brand`, both pinned by tests (`core/driver.test.ts`,
 * `core/transport.test.ts`, `core/profiles.test.ts`) and both named in spec
 * §3.2. `DeviceDriver.brand` below is the map from one to the other.
 */
export type DriverId =
  | typeof SENNHEISER_DRIVER.id
  | typeof SONY_DRIVER.id
  | typeof NOTHING_DRIVER.id
  | typeof SOUNDCORE_DRIVER.id;

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
 * here: `src/drivers/sennheiser/gaia/unsafe.ts` is GAIA-shaped (`{ vendor, command }`) and Sony
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
   * are filed under — see `Brand` in `core/brand.ts`. Named separately from
   * `id` on purpose: `id` names *this driver*; `brand` names the vocabulary
   * that data tables outside this file (`core/profiles.ts`, `transport.ts`,
   * the vendor asset catalogs under `drivers/<vendor>/`) are still keyed by, and which the manager's
   * sticky selection (`resolveBrand`/`knowsDevice`) is pinned to by its own
   * tests. One driver per brand today; nothing requires that stay true if a
   * driver ever needs a `Brand` finer-grained than one driver.
   *
   * They are **not** interchangeable strings, and an attempt to retire
   * `Brand` by renaming it `DriverId` foundered on exactly that: the values
   * differ (`'sennheiser-gaia'` against `'sennheiser'`) and three test files
   * pin both sets. This field is the map between them, and remains the only
   * one.
   */
  brand: Brand;
  /** RFCOMM service UUIDs that identify this driver's devices. */
  services: readonly string[];
  profiles: readonly DeviceProfile[];
  create(deps: DriverDeps): TDevice;
  /** The driver decides how capability works — statically or negotiated. */
  sections(state: TState): readonly DriverSection[];
  components: Record<string, SectionComponent<TDevice, TState>>;
  /**
   * What to call the codec this driver is currently streaming, or null if it
   * has not reported one.
   *
   * Takes the whole state rather than a codec byte because the two drivers do
   * not agree on where it lives (`state.codec` for Sony, `state.info.codec`
   * for Sennheiser) *or* on what the byte means — 0x02 is AAC in the MDR
   * table and aptX in the GAIA one. `ui/device/summary.ts` used to import
   * both tables and pick between them; that was the shared tier knowing two
   * drivers by name, so the lookup lives with the table it reads instead.
   */
  codecName(state: TState): string | null;
  /**
   * The one extra line a device summary is worth beyond model and battery,
   * or null when there is nothing to add.
   *
   * `DeviceSummary.detail` has always been documented as "whatever else is
   * worth a line — wear state, or per-earbud levels", i.e. driver-shaped by
   * construction. Sennheiser reports a wear state and Sony reports two
   * battery cells; neither has anything to say about the other's, so each
   * writes its own rather than the shared summary branching on which it is.
   */
  statusLine(state: TState): string | null;
  /**
   * Whether the headphones are on the wearer's head, as far as this driver
   * can tell — **true when it cannot tell**, so a driver with no wear
   * detection reads as "nothing to dim" rather than "not worn".
   *
   * `ui/device/DeviceImage.tsx` took a raw `wearState: number | null` and
   * compared it against the GAIA `WearState` enum, which is the whole reason
   * a shared product-render component imported a Sennheiser vendor enum. Both
   * of its callers already passed `null` for Sony, so the true-when-unknown
   * fallback below is the behaviour that was already there, stated once here
   * instead of implied at two call sites.
   */
  worn(state: TState): boolean;
  /**
   * The artwork resolver for this vendor's devices: which renders exist and
   * how identity (model string, colour byte, product code — whichever this
   * protocol reports) maps onto them.
   *
   * The strategy lives here for the same reason `codecName` and `worn` do:
   * the brands genuinely disagree on how artwork is resolved, and one shared
   * resolver meant the UI tier held every vendor's catalog plus a branch per
   * brand. Each driver now owns its catalog beside the protocol it resolves
   * identity from (`drivers/<vendor>/assets.ts` or `artwork.ts`); the shared
   * tier keeps only the `DeviceArtwork` shape (`core/artwork.ts`).
   */
  artwork(state: TState): DeviceArtwork;
}

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
  NOTHING_DRIVER,
  SOUNDCORE_DRIVER,
] as unknown as readonly DeviceDriver<never, never>[];

/** The driver that speaks a given RFCOMM service, or null if none does. */
export function driverForService(uuid: string): DeviceDriver<never, never> | null {
  return DRIVERS.find((driver) => driver.services.includes(uuid)) ?? null;
}
