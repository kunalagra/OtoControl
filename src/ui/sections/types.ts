import type { MomentumDevice } from '@/device/device'
import type { DeviceState } from '@/device/state'

/** Every section takes the same pair, so the registry can render them uniformly. */
export interface SectionProps {
  device: MomentumDevice
  state: DeviceState
  /** Lets a section hand off to another, e.g. System opening the debug console. */
  onNavigate(sectionId: string): void
}
