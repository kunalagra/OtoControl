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
  /** The firmware string the device reported, or null when it has none. */
  firmware: string | null
  /**
   * Every battery cell the device reports, in display order. Empty when unknown.
   *
   * Separate from `battery` because a single number cannot describe a case: an
   * earbud reporting 60% says nothing about whether the buds in it will last
   * the train ride, and the Home tile shows one row per cell rather than
   * collapsing them (spec §5.1, §4.3). `battery` stays the minimum across the
   * cells that are actually reporting, for the callers that want the one number
   * that limits you.
   */
  cells: BatteryCellSummary[]
}

/**
 * One row of a battery readout, as every driver normalises its cells into.
 *
 * The label set is closed rather than free text because it is a *slot* name —
 * the tile renders it as a short heading beside a segment bar ("L", "R", "Case")
 * — and because a driver's own vocabulary for the same cell ("Left", "Right")
 * does not fit in that space. 'Battery' is the single-cell case, where the
 * heading would otherwise be empty.
 */
export interface BatteryCellSummary {
  label: 'Battery' | 'L' | 'R' | 'Case'
  level: number
  charging: boolean
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
 * One battery cell, or nothing where the driver has not read one.
 *
 * Every branch below has a fixed set of cells it knows about and fills in
 * whichever the device reported, so this is the shape all four share: a list
 * (`cells`) to spread into, and the same list to take the minimum from
 * (`battery`), which is why the two cannot drift apart.
 *
 * A cell that is absent, or present but reporting no level, contributes
 * nothing: Soundcore's other bud is a null level when it is docked as host, and
 * a level with no cell behind it would be a 0% on a battery that is merely out
 * of reach. (Sony's bud in the case is a different case again — a real 0 with
 * UNKNOWN status — and is filtered on `present` in that branch.)
 */
const cell = (
  label: BatteryCellSummary['label'],
  value: { level: number | null; charging: boolean } | null | undefined,
): BatteryCellSummary[] =>
  value == null || value.level === null
    ? []
    : [{ label, level: value.level, charging: value.charging }]

/** The one number that limits you: the lowest cell actually reporting. */
const lowest = (cells: BatteryCellSummary[]): number | null =>
  cells.length ? Math.min(...cells.map((entry) => entry.level)) : null

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
    const cells = [...cell('L', state.battery?.left), ...cell('R', state.battery?.right)]
    return {
      model: state.info.model ?? fallbackName(state.status, 'Soundcore earbuds'),
      hasDevice: state.info.model !== null || state.info.serial !== null,
      battery: lowest(cells),
      charging: state.battery ? state.battery.left.charging || state.battery.right.charging : false,
      codec: driver.codecName(state),
      detail: driver.statusLine(state),
      artwork: driver.artwork(state),
      budCharging: state.battery
        ? { left: state.battery.left.charging, right: state.battery.right.charging }
        : null,
      worn: driver.worn(state),
      firmware: state.info.firmware,
      cells,
    }
  }

  if (active.id === 'nothing-spp') {
    const { driver, state } = active
    // `single` is the over-ears' one cell; earbuds leave it null and report
    // the pair instead, so including all four needs no branch.
    const cells = [
      ...cell('L', state.battery.left),
      ...cell('R', state.battery.right),
      ...cell('Case', state.battery.case),
      ...cell('Battery', state.battery.single),
    ]
    return {
      model: state.info.model ?? fallbackName(state.status, 'Nothing / CMF earbuds'),
      hasDevice: state.info.model !== null || state.info.firmware !== null,
      battery: lowest(cells),
      charging: cells.some((entry) => entry.charging),
      codec: driver.codecName(state),
      detail: driver.statusLine(state),
      artwork: driver.artwork(state),
      worn: driver.worn(state),
      firmware: state.info.firmware,
      cells,
    }
  }

  if (active.id === 'sony-mdr') {
    const { driver, state } = active
    // Labelled by the field each cell arrived in, never by position in a filtered
    // list: an earbud in the case reports level 0 with UNKNOWN status, and
    // dropping it from the pair would leave the *other* bud first — filing the
    // right earbud's 80% under "L". Each side is therefore dropped on its own
    // terms and keeps its own name.
    const cells: BatteryCellSummary[] = state.battery
      ? [
          ...cell('L', state.battery.left.present ? state.battery.left : null),
          ...cell('R', state.battery.right.present ? state.battery.right : null),
        ]
      : cell('Battery', state.singleBattery?.present ? state.singleBattery : null)
    return {
      model: state.info.model ?? fallbackName(state.status, 'Sony headphones'),
      hasDevice: state.info.model !== null,
      // The lower of those actually reporting is what limits you.
      battery: lowest(cells),
      charging: cells.some((entry) => entry.charging),
      codec: driver.codecName(state),
      detail: driver.statusLine(state),
      artwork: driver.artwork(state),
      worn: driver.worn(state),
      firmware: state.info.firmware,
      cells,
    }
  }

  if (active.id === 'heymelody') {
    const { driver, state } = active
    // The protocol labels its cells "Left"/"Right"/"Case" (see `BATTERY_LABEL`,
    // which System uses); the tile's headings are the short forms, so the
    // mapping is written out here rather than importing that table.
    const CELL_LABEL: Record<(typeof state.battery)[number]['device'], BatteryCellSummary['label']> = {
      left: 'L',
      right: 'R',
      case: 'Case',
    }
    const cells: BatteryCellSummary[] = state.battery.map((entry) => ({
      label: CELL_LABEL[entry.device],
      level: entry.level,
      charging: entry.charging,
    }))
    return {
      model: state.info.model ?? fallbackName(state.status, 'HeyMelody earbuds'),
      // A valid `productId` with no catalog match (a model newer than this
      // driver's catalog) still means a real device answered — see how the
      // Soundcore and Nothing branches above use their own secondary identity
      // field (`serial`/`firmware`) for exactly this case.
      hasDevice: state.info.model !== null || state.info.productId !== null,
      battery: lowest(cells),
      charging: cells.some((entry) => entry.charging),
      codec: driver.codecName(state),
      detail: driver.statusLine(state),
      artwork: driver.artwork(state),
      worn: driver.worn(state),
      // One version per device (left, right, case, "other"). The single field a
      // hero chip can show is the first one reported; the System page lists them
      // all, which is where a per-device difference belongs.
      firmware: state.info.version[0]?.version ?? null,
      cells,
    }
  }

  if (active.id === 'pixelbuds') {
    const { driver, state } = active
    const CELL_LABEL: Record<(typeof state.battery)[number]['device'], BatteryCellSummary['label']> = {
      left: 'L',
      right: 'R',
      case: 'Case',
    }
    const cells: BatteryCellSummary[] = state.battery.map((entry) => ({
      label: CELL_LABEL[entry.device],
      level: entry.level,
      charging: entry.charging,
    }))
    return {
      model: state.info.model ?? fallbackName(state.status, 'Pixel Buds'),
      hasDevice: state.info.model !== null,
      battery: lowest(cells),
      charging: cells.some((entry) => entry.charging),
      codec: driver.codecName(state),
      detail: driver.statusLine(state),
      artwork: driver.artwork(state),
      worn: driver.worn(state),
      // The hero chip has room for one version; the System page lists each part's.
      firmware: state.info.firmware?.left ?? state.info.firmware?.right ?? state.info.firmware?.case ?? null,
      cells,
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
    firmware: state.info.firmware,
    cells: cell(
      'Battery',
      state.battery === null ? null : { level: state.battery, charging: state.charging === true },
    ),
  }
}
