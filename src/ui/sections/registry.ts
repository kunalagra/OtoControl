import {
  RiBugLine,
  RiEqualizerLine,
  RiHeadphoneLine,
  RiLinksLine,
  RiSettings3Line,
  RiVolumeDownLine,
} from '@remixicon/react'
import type { RemixiconComponentType } from '@remixicon/react'
import type { ComponentType } from 'react'

import type { ActiveDevice } from '@/core/manager'
import type { DriverSection } from '@/core/driver'
import { Home } from './Home'

/**
 * A section as the nav renders it: a driver's own `DriverSection` plus the
 * icon that names it visually, and the word the pill bar has room for. Both are
 * attached here, in the UI layer, rather than carried on `DriverSection` itself
 * — see the comment on `DriverSection` in `core/driver.ts` for why that split
 * exists.
 */
export interface Section extends DriverSection {
  icon: RemixiconComponentType
  /**
   * The label for the 56px pill bar, which is not always the first word of the
   * full one: `system` is "More" there and "System" in the rail.
   */
  shortLabel: string
}

/**
 * One icon per section id, shared across every driver.
 *
 * Keyed by id rather than duplicated per driver: "noise control" draws the
 * same glyph whether it is GAIA's or MDR's, so a driver only ever needs to
 * decide *which* ids it has, never which icon goes with one.
 */
const SECTION_ICONS: Record<string, RemixiconComponentType> = {
  home: RiHeadphoneLine,
  noise: RiVolumeDownLine,
  sound: RiEqualizerLine,
  devices: RiLinksLine,
  system: RiSettings3Line,
  debug: RiBugLine,
}

/**
 * What each nav section is called, in each of the nav's two layouts — spec §3.1.
 *
 * One table for both because they are the same decision at two sizes: the rail
 * has room for "System", the pill bar does not, so System is "More" there and
 * nowhere else. `devices` needs a full label of its own too — both drivers that
 * declare it call it "Connections", which is right for a full-width block and
 * two words too long for a 64px rail.
 *
 * This replaces `label.split(' ')[0]`, which was right by luck rather than by
 * decision: it shortened "Noise control" to "Noise", and it would have turned a
 * future "Device information" into "Device". An id with no entry here falls back
 * to the driver's own label, which is the safe direction — a long pill label
 * wraps rather than lying about what the tab is.
 */
const NAV_NAMES: Record<string, { label: string; shortLabel: string }> = {
  home: { label: 'Home', shortLabel: 'Home' },
  sound: { label: 'Sound', shortLabel: 'Sound' },
  devices: { label: 'Devices', shortLabel: 'Devices' },
  system: { label: 'System', shortLabel: 'More' },
}

const withIcon = (section: DriverSection): Section => ({
  ...section,
  // Every id a real driver declares has an entry above; the settings icon is
  // a defensive fallback for one that somehow doesn't, not an expected path.
  icon: SECTION_ICONS[section.id] ?? RiSettings3Line,
  shortLabel: NAV_NAMES[section.id]?.shortLabel ?? section.label,
})

/**
 * A section as the *nav* names it, which is not always how the section's own body
 * names it — see `NAV_NAMES`. Applied here rather than inside `withIcon` so that
 * a hidden section, which has no tab but keeps its own heading, is untouched.
 */
const forNav = (section: Section): Section => {
  const label = NAV_NAMES[section.id]?.label
  return label ? { ...section, label } : section
}

/**
 * The sections a *particular* device should show, in nav order.
 *
 * Goes through `active.driver` rather than switching on a brand: the driver
 * already knows its own section list and, for Sony, the one rule that gates
 * noise control on capabilities read from the device (see the descriptor in
 * `drivers/sony/driver.ts`). This function used to restate that rule itself, with
 * a "keep in sync" comment tying it to the driver's copy; now there is only
 * one copy, so there is nothing left to drift.
 *
 * `active.driver`, `active.device` and `active.state` are correlated by
 * construction — every real `ActiveDevice` pairs a driver with its own
 * device and state — but the union that is `ActiveDevice` carries no
 * discriminant TypeScript can use to see that once `driver` and `state` are
 * read as separate expressions. The local widening below is how that gets
 * past the type checker; it mirrors the one cast `DRIVERS` itself needs in
 * `core/driver.ts`, for the same reason, and costs nothing at this call site
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

/**
 * Home, the landing tab, owned by this layer rather than by any driver: which
 * tiles it holds is the shell's business, and every driver has one.
 */
const HOME: DriverSection = { id: 'home', label: 'Home' }

/**
 * The sections that appear in the nav, in order: Home first, then the driver's
 * own, minus the two kinds that stay out of it.
 *
 * - `noise` leaves the nav (spec §3.1). The section itself does not go away —
 *   the driver still declares it, Sony still gates it on a capability, and Home
 *   renders the component — but a tab for it is a second way into a control
 *   that already has a home, and the pill bar has room for four.
 * - `hidden` sections were never tabs. `debug` and HeyMelody's extras are
 *   reached deliberately from another section and return to it.
 *
 * Both rules live here, in the shell, rather than in each driver: a driver
 * declaring a section is a statement about what hardware can do, and whether
 * that has a tab is a question about navigation.
 */
export function navSections(active: ActiveDevice): Section[] {
  // `sectionsForDevice` has already attached icon and shortLabel to the driver's
  // own entries; Home is declared here, so it needs the same treatment.
  return [withIcon(HOME), ...sectionsForDevice(active).filter(inNav)].map(forNav)
}

const inNav = (section: Section): boolean => !section.hidden && section.id !== 'noise'

/**
 * The props every section is rendered with, whichever tier owns it.
 *
 * A driver section declares the three its own state needs — `{ device, state,
 * onNavigate }`, which is `SectionComponent` in `core/driver.ts` — while a
 * section the *shell* owns needs the whole `ActiveDevice`, because what it
 * draws is a reading of the driver and its state together. `Home` is that case:
 * it asks the driver which peers are paired, whether it declares a `devices`
 * section at all, and for its own noise component.
 *
 * So the shell hands every section the union, and a driver section simply
 * ignores the prop it never declared. The alternative — two lookup tables and a
 * branch on which one answered — is how the interim shell ended up with a
 * fallback that resolved `home` differently from `componentFor` and had to be
 * deleted the moment Home landed. This way there is one table, one lookup, and
 * the extra prop is a value, not a claim.
 */
export interface ResolvedSectionProps {
  device: unknown
  state: unknown
  onNavigate(sectionId: string): void
  /** The whole active device. Read by shell-owned sections; ignored by drivers. */
  active: ActiveDevice
}

/** A section component as `componentFor` hands it back, props erased. */
export type ResolvedSection = ComponentType<ResolvedSectionProps>

/**
 * Sections the shell owns rather than any driver.
 *
 * `home` is the only one, and spec §3.1 puts it in this tier on purpose: which
 * tiles it holds is a layout decision, and a driver declaring it would mean
 * every `components` map restating a component none of them owns. So it is
 * registered here, once, and `componentFor` consults this table first.
 */
const UI_SECTIONS: Record<string, ResolvedSection> = { home: Home }

/** The component for one of `active`'s own sections, or undefined for an unknown id. */
export function componentFor(
  active: ActiveDevice,
  sectionId: string,
): ResolvedSection | undefined {
  const own = UI_SECTIONS[sectionId]
  if (own) return own
  const components: Record<string, unknown> = active.driver.components
  return components[sectionId] as ResolvedSection | undefined
}

/**
 * The section the shell should show for the id it is holding, given the nav and
 * the driver's own full list.
 *
 * The full list is in scope as well as the nav's because hidden sections have no
 * tab but do have a place to be reached from — Sennheiser's `debug` is the case
 * — so an id the shell was sent can legitimately be absent from `nav`.
 *
 * Falling back to the first nav tab is the stale-id rule: drivers do not share a
 * section list, so an id from the previous device can mean nothing to this one.
 * Resolving during render rather than in an effect means the switch lands on the
 * right tab in the same paint, instead of one render of the old section first.
 */
export function sectionFor(active: ActiveDevice, sectionId: string): Section {
  const known = [...navSections(active), ...sectionsForDevice(active)]
  return known.find((entry) => entry.id === sectionId) ?? known[0]
}
