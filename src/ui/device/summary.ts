import type { DeviceArtwork } from '@/core/artwork'
import type { ActiveDevice } from '@/core/manager'

/**
 * A brand-neutral view of what the sidebar and mobile header need.
 *
 * This is the one place the two protocols are genuinely normalised: both report
 * a model, a battery level and a codec, even though they get there by different
 * commands and Sony reports two cells where Sennheiser reports one.
 *
 * Normalising is all it does. It used to import both codec tables and the GAIA
 * wear-state names to fill `codec` and `detail`, which made the shared tier
 * know two drivers by name for the sake of two enum lookups. It branched on
 * the driver id and picked the matching table, so it was correct — but only
 * because a hand-maintained pairing of branch to import alias stayed in step.
 * The tables share no meaning at all: 0x00 is SBC to Sennheiser and Unsettled
 * to Sony, 0x01 AAC vs SBC, 0x02 aptX vs AAC, 0xff None vs Other, and even
 * their fallbacks differ (decimal vs hex). One mistaken alias would have
 * silently mislabelled every codec, with no test able to see it.
 * Both now come off the descriptor (`codecName`, `statusLine`), so the
 * naming lives with the table it reads. What is left below still branches on
 * `active.id`, but only to read plain fields of that driver's own state — no
 * vendor table, no enum, nothing that needed importing a driver.
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
  /**
   * The active driver's resolved artwork. Identity plumbing (colour bytes,
   * product codes) used to travel through here as loose fields for
   * `DeviceImage` to re-resolve; the driver's `artwork` strategy now does
   * that with the state it is entitled to read.
   */
  artwork: DeviceArtwork
  /**
   * Per-bud charging flags, when the driver reports them — Soundcore pushes
   * them live. Drives the official app's trick of fading the bud that is
   * docked in the case charging; null when there is nothing per-bud to say.
   */
  budCharging?: { left: boolean; right: boolean } | null
  /** True when worn, or when the driver cannot tell — see `DeviceDriver.worn`. */
  worn: boolean
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

export function summarise(active: ActiveDevice): DeviceSummary {
  // The `DriverId` literal, rather than reading `.id` back off the Sony
  // descriptor: this needs one string to narrow the union on, and importing a
  // whole descriptor — device class, React components, section list — to get
  // that string is a dependency on the Sony driver that the shared tier must
  // not have. It also hid behind `core/driver.ts`'s re-export, so the
  // `ui -> drivers` check passed while the coupling was still there. The
  // check is no weaker for the change: `active.id` is a union of literals, so
  // a wrong one is a compile error, not a branch that is quietly never taken.
  if (active.id === 'soundcore-gatt') {
    const { driver, state } = active
    // A side reporting null is absent (bud docked with the other one as host,
    // say), not flat — it limits you no less than the lowest present cell.
    const levels = state.battery
      ? [state.battery.left.level, state.battery.right.level].filter(
          (level): level is number => level !== null,
        )
      : []
    return {
      model: state.info.model ?? fallbackName(state.status, 'Soundcore earbuds'),
      hasDevice: state.info.model !== null || state.info.serial !== null,
      battery: levels.length ? Math.min(...levels) : null,
      charging: state.battery ? state.battery.left.charging || state.battery.right.charging : false,
      codec: driver.codecName(state),
      detail: driver.statusLine(state),
      artwork: driver.artwork(state),
      budCharging: state.battery
        ? { left: state.battery.left.charging, right: state.battery.right.charging }
        : null,
      worn: driver.worn(state),
    }
  }

  if (active.id === 'nothing-spp') {
    const { driver, state } = active
    // `single` is the over-ears' one cell; earbuds leave it null and report
    // the pair instead, so including all four needs no branch.
    const cells = [
      state.battery.left,
      state.battery.right,
      state.battery.case,
      state.battery.single,
    ].filter(
      (cell): cell is { level: number; charging: boolean } => cell !== null,
    )
    return {
      model: state.info.model ?? fallbackName(state.status, 'Nothing / CMF earbuds'),
      hasDevice: state.info.model !== null || state.info.firmware !== null,
      battery: cells.length ? Math.min(...cells.map((cell) => cell.level)) : null,
      charging: cells.some((cell) => cell.charging),
      codec: driver.codecName(state),
      detail: driver.statusLine(state),
      artwork: driver.artwork(state),
      worn: driver.worn(state),
    }
  }

  if (active.id === 'sony-mdr') {
    const { driver, state } = active
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
      codec: driver.codecName(state),
      detail: driver.statusLine(state),
      artwork: driver.artwork(state),
      worn: driver.worn(state),
    }
  }

  const { driver, state } = active
  return {
    model: state.info.model ?? fallbackName(state.status, 'Sennheiser headphones'),
    hasDevice: state.info.model !== null,
    battery: state.battery,
    charging: state.charging === true,
    codec: driver.codecName(state),
    detail: driver.statusLine(state),
    artwork: driver.artwork(state),
    worn: driver.worn(state),
  }
}
