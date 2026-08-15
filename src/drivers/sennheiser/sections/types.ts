import type { ComponentProps } from 'react'

import type { SectionComponent } from '@/core/driver'
import type { MomentumDevice } from '@/drivers/sennheiser/device'
import type { DeviceState } from '@/drivers/sennheiser/state'

/**
 * Every Sennheiser section takes the same pair, so the registry can render
 * them uniformly.
 *
 * Derived from `SectionComponent` rather than restated, because the two are
 * duals rather than duplicates: `SectionComponent<TDevice, TState>` types the
 * *slot* `SENNHEISER_DRIVER.components` stores and the registry renders, while
 * this types the *parameter* each implementation destructures. Writing the
 * triple out twice would let the contract and the slot it fills drift apart;
 * deriving it means a change to the slot is a compile error in every section
 * that no longer fits.
 *
 * Sony's sections never used this — they declare their own local `Props` — so
 * despite its former home in the shared `ui/sections/` tree it has always been
 * the Sennheiser section contract, and it lives beside those sections now.
 */
export type SectionProps = ComponentProps<SectionComponent<MomentumDevice, DeviceState>>
