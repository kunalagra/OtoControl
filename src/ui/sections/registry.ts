import {
  RiBugLine,
  RiEqualizerLine,
  RiLinksLine,
  RiSettings3Line,
  RiVolumeDownLine,
} from '@remixicon/react'
import type { RemixiconComponentType } from '@remixicon/react'

import type { Brand } from '@/device/brand'
import type { ActiveDevice } from '@/device/manager'
import { Debug } from './Debug'
import { Devices } from './Devices'
import { Noise } from './Noise'
import { Sound } from './Sound'
import { System } from './System'
import { SonyNoise } from './sony/SonyNoise'
import { SonySound } from './sony/SonySound'
import { SonySystem } from './sony/SonySystem'

export interface Section {
  id: string
  label: string
  icon: RemixiconComponentType
  /** Kept out of every nav; reached deliberately from another section. */
  hidden?: boolean
}

/**
 * Sections per brand.
 *
 * Deliberately not normalised: the Momentum 4's noise control and the WF-C500's
 * capability set have little in common, and one section list pretending
 * otherwise would mean an empty Noise page on a device with no ANC.
 */
export const SENNHEISER_SECTIONS: Section[] = [
  { id: 'noise', label: 'Noise control', icon: RiVolumeDownLine },
  { id: 'sound', label: 'Sound', icon: RiEqualizerLine },
  { id: 'devices', label: 'Connections', icon: RiLinksLine },
  { id: 'system', label: 'System', icon: RiSettings3Line },
  { id: 'debug', label: 'Debug console', icon: RiBugLine, hidden: true },
]

/**
 * No debug section for Sony yet: the console decodes GAIA frames and sweeps
 * GAIA command IDs, neither of which applies to MDR. `spike/sony.html` covers
 * Sony debugging until there is an MDR equivalent.
 */
export const SONY_SECTIONS: Section[] = [
  { id: 'noise', label: 'Noise control', icon: RiVolumeDownLine },
  { id: 'sound', label: 'Sound', icon: RiEqualizerLine },
  { id: 'system', label: 'System', icon: RiSettings3Line },
]

export const sectionsFor = (brand: Brand): Section[] =>
  brand === 'sony' ? SONY_SECTIONS : SENNHEISER_SECTIONS

/**
 * The sections a *particular* device should show.
 *
 * `sectionsFor` answers "what can this brand have"; this answers "what does
 * this unit actually have". The WF-C500 and the WH-1000XM5 are both Sony, but
 * only one of them has noise control, and a tab that opens onto "this device
 * reports no noise control" is worse than no tab.
 */
export function sectionsForDevice(active: ActiveDevice): Section[] {
  const sections = sectionsFor(active.brand)
  if (active.brand !== 'sony') return sections
  // Before connecting there is no capability table, so keep the tab rather
  // than hiding a section that is about to appear.
  const known = active.state.capabilities.size > 0
  const hasNoise = !known || active.state.noiseVariant !== null
  return hasNoise ? sections : sections.filter((section) => section.id !== 'noise')
}

export const defaultSectionFor = (brand: Brand): string => sectionsFor(brand)[0].id

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
