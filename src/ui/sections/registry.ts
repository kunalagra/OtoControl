import {
  RiBugLine,
  RiEqualizerLine,
  RiLinksLine,
  RiSettings3Line,
  RiVolumeDownLine,
} from '@remixicon/react'
import type { RemixiconComponentType } from '@remixicon/react'

import type { ActiveDevice } from '@/device/manager'
import type { DriverSection, SectionComponent } from '@/device/driver'
import { Debug } from './Debug'
import { Devices } from './Devices'
import { Noise } from './Noise'
import { Sound } from './Sound'
import { System } from './System'
import { SonyNoise } from './sony/SonyNoise'
import { SonySound } from './sony/SonySound'
import { SonySystem } from './sony/SonySystem'

/**
 * A section as the nav renders it: a driver's own `DriverSection` plus the
 * icon that names it visually. The icon is attached here, in the UI layer,
 * rather than carried on `DriverSection` itself — see the comment on
 * `DriverSection` in `device/driver.ts` for why that split exists.
 */
export interface Section extends DriverSection {
  icon: RemixiconComponentType
}

/**
 * One icon per section id, shared across every driver.
 *
 * Keyed by id rather than duplicated per driver: "noise control" draws the
 * same glyph whether it is GAIA's or MDR's, so a driver only ever needs to
 * decide *which* ids it has, never which icon goes with one.
 */
const SECTION_ICONS: Record<string, RemixiconComponentType> = {
  noise: RiVolumeDownLine,
  sound: RiEqualizerLine,
  devices: RiLinksLine,
  system: RiSettings3Line,
  debug: RiBugLine,
}

const withIcon = (section: DriverSection): Section => ({
  ...section,
  // Every id a real driver declares has an entry above; the settings icon is
  // a defensive fallback for one that somehow doesn't, not an expected path.
  icon: SECTION_ICONS[section.id] ?? RiSettings3Line,
})

/**
 * The sections a *particular* device should show, in nav order.
 *
 * Goes through `active.driver` rather than switching on a brand: the driver
 * already knows its own section list and, for Sony, the one rule that gates
 * noise control on capabilities read from the device (see `SONY_DRIVER` in
 * `device/driver.ts`). This function used to restate that rule itself, with
 * a "keep in sync" comment tying it to the driver's copy; now there is only
 * one copy, so there is nothing left to drift.
 *
 * `active.driver`, `active.device` and `active.state` are correlated by
 * construction — every real `ActiveDevice` pairs a driver with its own
 * device and state — but the union that is `ActiveDevice` carries no
 * discriminant TypeScript can use to see that once `driver` and `state` are
 * read as separate expressions. The local widening below is how that gets
 * past the type checker; it mirrors the one cast `DRIVERS` itself needs in
 * `driver.ts`, for the same reason, and costs nothing at this call site
 * because the correlation always genuinely holds.
 */
export function sectionsForDevice(active: ActiveDevice): Section[] {
  // Only `sections` itself is widened, not the whole driver: interface
  // methods (this shorthand syntax) are checked bivariantly, so narrowing the
  // cast to just this one method is what keeps the widening sound for the
  // argument below, without also having to answer for `components`, whose
  // function-valued entries are checked contravariantly and would reject a
  // same-style widening (see `componentFor`, which erases through `unknown`
  // instead for exactly that reason).
  const driver: { sections(state: unknown): readonly DriverSection[] } = active.driver
  return driver.sections(active.state).map(withIcon)
}

/** The component for one of `active`'s own sections, or undefined for an unknown id. */
export function componentFor(
  active: ActiveDevice,
  sectionId: string,
): SectionComponent<unknown, unknown> | undefined {
  const components: Record<string, unknown> = active.driver.components
  return components[sectionId] as SectionComponent<unknown, unknown> | undefined
}

export const SENNHEISER_COMPONENTS = {
  noise: Noise,
  sound: Sound,
  devices: Devices,
  system: System,
  debug: Debug,
} as const

export const SONY_COMPONENTS = {
  noise: SonyNoise,
  sound: SonySound,
  system: SonySystem,
} as const
