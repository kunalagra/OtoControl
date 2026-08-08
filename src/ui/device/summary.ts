import { codecName as gaiaCodecName, wearStateName } from '@/gaia/commands'
import { codecName as sonyCodecName } from '@/mdr/commands'
import type { ActiveDevice } from '@/device/manager'

/**
 * A brand-neutral view of what the sidebar and mobile header need.
 *
 * This is the one place the two protocols are genuinely normalised: both report
 * a model, a battery level and a codec, even though they get there by different
 * commands and Sony reports two cells where Sennheiser reports one.
 */
export interface DeviceSummary {
  model: string
  /** False when nothing has ever identified itself — show a neutral state. */
  hasDevice: boolean
  /** Lowest of the cells for earbuds; the single value for over-ears. */
  battery: number | null
  charging: boolean
  codec: string | null
  /** Whatever else is worth a line — wear state, or per-earbud levels. */
  detail: string | null
  colourCode: number | null
}

/**
 * What to call a device that has not identified itself.
 *
 * While connecting, the brand is the best guess available. Otherwise there is
 * genuinely nothing attached, and naming a model we have never spoken to is
 * worse than saying so.
 */
const fallbackName = (status: string, brandName: string): string =>
  status === 'connected' || status === 'connecting' ? brandName : 'No device'

/**
 * One earbud's level plus what its charge status implies.
 *
 * A bud in the case leaves the tandem link, so the device reports UNKNOWN with
 * level 0 rather than a charge state. That absence — not the charge status —
 * is what indicates the case.
 */
const earbud = (cell: {
  level: number
  charging: boolean
  onPower: boolean
  present: boolean
}): string => {
  if (!cell.present) return 'in case'
  return `${cell.level}%${cell.charging ? ' ⚡' : cell.onPower ? ' ⏻' : ''}`
}

export function summarise(active: ActiveDevice): DeviceSummary {
  if (active.brand === 'sony') {
    const { state } = active
    const cells = state.battery
      ? [state.battery.left, state.battery.right]
      : state.singleBattery
        ? [state.singleBattery]
        : []
    // An earbud in the case reports level 0 with status UNKNOWN. Including it
    // would show 0% while the bud you are wearing is full.
    const reporting = cells.filter((cell) => cell.present)
    return {
      model: state.info.model ?? fallbackName(state.status, 'Sony headphones'),
      hasDevice: state.info.model !== null,
      // The lower of those actually reporting is what limits you.
      battery: reporting.length ? Math.min(...reporting.map((cell) => cell.level)) : null,
      charging: reporting.some((cell) => cell.charging),
      codec: state.codec === null ? null : sonyCodecName(state.codec),
      // Reported per earbud, so shown per earbud rather than collapsed.
      detail: state.battery
        ? `L ${earbud(state.battery.left)} · R ${earbud(state.battery.right)}`
        : null,
      colourCode: state.info.colour?.colour ?? null,
    }
  }

  const { state } = active
  return {
    model: state.info.model ?? fallbackName(state.status, 'Sennheiser headphones'),
    hasDevice: state.info.model !== null,
    battery: state.battery,
    charging: state.charging === true,
    codec: state.info.codec === null ? null : gaiaCodecName(state.info.codec),
    detail: state.wearState === null ? null : wearStateName(state.wearState),
    colourCode: null,
  }
}
