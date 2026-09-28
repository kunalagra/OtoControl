import { RiFlashlightLine } from '@remixicon/react'

import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { ConnectionStatus } from '@/core/connection'
import type { ConnectionSummary, EqPreview } from '@/core/driver'
import type { ActiveDevice } from '@/core/manager'
import { BATTERY_SEGMENTS, SegmentMeter } from '../controls/SegmentMeter'
import { DeviceImage } from '../device/DeviceImage'
import { summarise } from '../device/summary'
import type { BatteryCellSummary, DeviceSummary } from '../device/summary'
import { placeTiles, TILE_PRIORITY } from './homeTiles'
import type { TileId } from './homeTiles'
import { componentFor, sectionsForDevice } from './registry'

/**
 * Home, the landing tab. Props in `HomeProps`, below.
 *
 * The two tiles that lead somewhere are buttons over their whole area rather
 * than a link in a corner: on a phone a corner link is a 20px target, and the
 * point of a preview is to invite the tap.
 */
export interface HomeProps {
  active: ActiveDevice
  onNavigate(sectionId: string): void
}

/**
 * The two optional descriptor methods, widened over the driver union.
 *
 * The same move as `sectionsForDevice`: `ActiveDevice` pairs a driver with its
 * own state by construction, but the union carries no discriminant a method
 * call can use, and calling `eqPreview` across all five states would need a
 * parameter that is all five states at once. Interface methods are checked
 * bivariantly, so this one widening is sound — and it costs nothing at the call
 * site, where the pairing always genuinely holds.
 */
interface DriverReadouts {
  eqPreview?(state: unknown): EqPreview | null
  connections?(state: unknown): ConnectionSummary[] | null
  wearCaption?(state: unknown): string | null
}

/**
 * Home — spec §4.3, DESIGN-GUIDE §5.12.
 *
 * Five slots, in the order the spec gives them: hero, battery, the driver's own
 * noise section, an EQ preview, and a connections tile. Only the noise slot is
 * borrowed from a driver; the rest is a reading of state the shared summary
 * already normalises, which is what lets one component serve five brands whose
 * state shapes have nothing in common.
 *
 * Props are not the usual `{ device, state, onNavigate }`. This section is not
 * one driver's — it reads the driver *and* its state together (the descriptor's
 * optional `eqPreview`/`connections`/`wearCaption`, the driver's own noise
 * component, whether it declares `noise` or `devices` at all), which is what
 * `ActiveDevice` is. The shell hands both; a driver section receives the three it
 * declares and ignores the rest. See `componentFor` and `SectionBody` for the
 * other side of that.
 */
export function Home({ active, onNavigate }: HomeProps) {
  const summary = summarise(active)
  const connected = active.state.status === 'connected'
  const readouts: DriverReadouts = active.driver
  const eq = readouts.eqPreview?.(active.state) ?? null
  const connections = readouts.connections?.(active.state) ?? null
  // Which slots exist is the driver's *section list* saying so, never its
  // `components` map: a descriptor holds a component for every id it might
  // declare, and one driver gates `noise` on a capability it reads from the
  // device — so asking the map would put a noise control on hardware that has
  // none. It is the same list the nav reads, which is what keeps the two halves
  // of the page agreeing about what this device can do.
  const declared = sectionsForDevice(active)
  // A driver that declares no `noise` section has no slot at all, rather than an
  // empty frame where a control would be.
  const Noise = declared.some((section) => section.id === 'noise')
    ? componentFor(active, 'noise')
    : undefined
  const has = (id: string) => declared.some((section) => section.id === id)
  // `connected/total` is the figure a person can act on — "3" alone says
  // nothing about whether the headphones are holding two links or one.
  const links =
    connections === null
      ? null
      : `${connections.filter((entry) => entry.connected).length}/${connections.length}`
  // The wear caption comes from the driver, or from nothing: what the driver
  // names beats a blunter "Not worn" ("In case" says more about a pair of
  // earbuds), and no `detail` line is read for it — `detail` is free to be a
  // battery line or a case-status line instead.
  const wear = readouts.wearCaption?.(active.state) ?? (summary.worn ? null : 'Not worn')
  // The idle dim, per spec §4.3: not connected means the values on screen are the
  // last ones read, so they are shown but not offered as current. The shell
  // leaves this section undimmed so the hero can stay at full strength — a page
  // that keeps showing a disconnected device must not dim the one thing that
  // says it is — so every tile but the hero wears the dim itself.
  const dim = connected ? undefined : 'pointer-events-none opacity-50'

  // Every tile this device can fill, in priority order. A tile exists only when
  // the driver declares the section behind it — an EQ tile that opens a Sound
  // section the driver does not have is a button that does nothing — and the
  // battery and system tiles always exist.
  const present = TILE_PRIORITY.filter((id) => {
    if (id === 'noise') return Noise !== undefined
    if (id === 'eq') return has('sound')
    if (id === 'devices') return has('devices')
    return true
  })
  const columns = placeTiles(present)

  const tile = (id: TileId, fills: boolean) => {
    const order = PHONE_ORDER[present.indexOf(id)]
    const size = fills ? FILL.yes : FILL.no
    switch (id) {
      case 'battery':
        // Never grows: the strip is compact at every width.
        return <BatteryTile key={id} className={cn(FILL.no, order, dim)} summary={summary} connected={connected} />
      case 'noise':
        return Noise ? (
          <div
            key={id}
            data-slot="home-noise"
            className={cn(fills ? cn(FILL.yes, FILL_THROUGH) : FILL.no, order, dim)}
          >
            <Noise device={active.device} state={active.state} active={active} onNavigate={onNavigate} />
          </div>
        ) : null
      case 'eq':
        return <EqPreviewTile key={id} className={cn(size, order, dim)} eq={eq} onOpen={() => onNavigate('sound')} />
      case 'devices':
        return (
          <DevicesTile
            key={id}
            className={cn(size, order, dim)}
            connections={connections}
            onOpen={() => onNavigate('devices')}
          />
        )
      case 'system':
        return (
          <SystemTile
            key={id}
            className={cn(size, order, dim)}
            facts={[
              { label: 'Model', value: summary.hasDevice ? summary.model : null },
              { label: 'Firmware', value: summary.firmware },
              { label: 'Codec', value: summary.codec },
              { label: 'Links', value: links },
            ]}
            onOpen={() => onNavigate('system')}
          />
        )
    }
  }

  const column = (ids: TileId[]) => ids.map((id, index) => tile(id, index === ids.length - 1))

  return (
    <div
      data-slot="home"
      className={cn(
        // Phone: one column, in priority order at the phone gap.
        'flex flex-col gap-2',
        // Desktop: a bento that fills what the shell hands it. `md:flex-1` is a
        // flex *item* size — the body above is a flex column with a definite
        // height — so the grid takes the leftover viewport rather than a
        // viewport height of its own.
        //
        // One row per width, and the columns below it are stacks: a grid row is
        // as tall as the tallest thing in it, so tiles sharing rows across
        // columns leave gaps. From 768 to 1100px the hero runs across the top
        // and the two stacks sit under it; from `bento:` the hero is the first
        // of three columns. `bento:` sorts after `md:` in the built stylesheet.
        'md:grid md:flex-1 md:grid-cols-2 md:auto-rows-fr md:gap-3',
        'md:grid-rows-[auto_1fr] bento:grid-rows-1',
        'bento:grid-cols-[1.35fr_1fr_1fr]',
      )}
    >
      <HeroTile
        className={SLOT.hero}
        summary={summary}
        status={active.state.status}
        brand={brandOf(active.driver.label)}
        wear={wear}
      />

      {/* `contents` on a phone, so the tiles are one column there and read in
          priority order through `PHONE_ORDER`; a flex column from `md`. */}
      <div data-slot="home-col-middle" className={cn(COLUMN, SLOT.middle)}>
        {column(columns.middle)}
      </div>
      <div data-slot="home-col-right" className={cn(COLUMN, SLOT.right)}>
        {column(columns.right)}
      </div>
    </div>
  )
}

/** "Sony (MDR)" → "Sony": the caption is the brand, not the protocol. */
function brandOf(label: string): string {
  return label.replace(/\s*\(.*\)\s*$/, '')
}

/**
 * Where each slot lands at each width — spec §4.2, in one table so the grid is
 * readable as a layout rather than as arithmetic.
 *
 * Three entries for three grid items, which is fewer than the seven this table
 * used to have, and the difference is the finding: the old table placed five
 * tiles into shared grid rows, and §4.2's columns are not rows. A grid row is
 * as tall as the tallest thing in it, so "the battery strip is auto height and
 * the EQ tile is below it" was unrepresentable — the strip got the row (sized by
 * the noise section beside it) and the EQ tile got the next one, 400px down.
 *
 * `bento:` is a *named* breakpoint (`--breakpoint-bento`, 1100px in
 * `index.css`), and it has to be one: Tailwind emits an arbitrary `min-[…]`
 * variant ahead of the named ones, so the two families' rules settled the
 * 2-col/3-col question by source order rather than by width and the later `md:`
 * rule won everywhere. Named breakpoints are ordered by their width, which is
 * also the order the layout means.
 */
const SLOT = {
  /** Across the top on two columns, then the whole first column on three. */
  hero: 'md:col-span-2 bento:col-span-1',
  /** §4.2 column 2: left of the two-column grid, middle of the three. */
  middle: 'md:col-start-1 md:row-start-2 bento:col-start-2 bento:row-start-1',
  /** §4.2 column 3: right of the two-column grid, rightmost of the three. */
  right: 'md:col-start-2 md:row-start-2 bento:col-start-3 bento:row-start-1',
}

/**
 * The wrapper around a column, and why it is `display: contents` on a phone.
 *
 * A phone has one column in §4.1's order — hero, battery, noise, EQ, devices —
 * and the columns above are a desktop arrangement, so on a phone they must not
 * be boxes. `contents` says "my children are the layout" without reordering
 * them; from `md` each becomes a flex column at the bento's own 12px gap.
 *
 * `md:min-h-0` is what lets a stack shorter than the window overflow visibly
 * and scroll, rather than the filler being squeezed under its own minimum.
 */
const COLUMN = 'contents md:flex md:min-h-0 md:flex-col md:gap-3'

/**
 * Whether a tile fills its column or stands at its own height.
 *
 * §4.2 is explicit about which is which — "compact battery strip (**auto
 * height**), then the EQ preview tile (**fills the rest**)" and the same for the
 * noise section and the devices tile — and in a flex column the two are one class
 * apart, with no row arithmetic anywhere.
 */
const FILL = {
  /** Auto height: the top of a column with something under it. */
  no: 'shrink-0',
  /** Fills: the bottom of a column, and the whole of it when it is alone. */
  yes: 'md:flex-1',
} as const

/**
 * `FILL.yes` is not enough for the noise slot, and the reason is a layer of box
 * that is not ours. The grown wrapper is this component's; the thing inside it is
 * the driver's own noise section, whose root is a `flex flex-col` div of its own
 * (or, for HeyMelody, a single `Card`) and is **content-height**. So the wrapper
 * filled the column and the page showed through below the last block — measured
 * in Chrome at 1280×800, before this: **526px** below Soundcore's single noise
 * card and **136.2px** below Nothing's third. Every driver without a `devices`
 * section lands here (Nothing, Soundcore, HeyMelody), which is every Home where
 * the case is reachable at all.
 *
 * Two descendant rules carry the height the last two links are missing:
 *
 * - `md:flex md:flex-col` turns the wrapper into the flex column its child can
 *   be *given* height in at all — a block's height is its content's;
 * - `md:[&>*]:flex-1` hands it to the driver's root, and
 *   `md:[&>*>*:last-child]:flex-1` hands the remainder to the last block inside
 *   that root, which is the edge the eye actually reaches the bottom of.
 *
 * The block that grows has its content at the top and space below it, which is
 * what the approved mockup draws (desktop.html:100 — a `flex:1` spacer inside the
 * block, and one inside the devices block below it).
 *
 * Applied only when there is no devices tile: with one below, §4.2 says this is
 * the auto-height half of the column and stretching would push the connections
 * tile off the bottom of a `md:min-h-0` column.
 *
 * Reached from here rather than through a `className` prop on the driver's
 * section for the reason `AppShell` carries `md:[&>*]:min-h-0` on seventeen
 * section roots: a prop puts a bento layout concern inside five driver files,
 * and the sixth driver gets it wrong.
 */
const FILL_THROUGH =
  'md:flex md:flex-col md:[&>*]:flex-1 md:[&>*>*:last-child]:flex-1'

/**
 * The phone's reading order, by priority index. The column wrappers are
 * `display: contents` on a phone, so document order would be column order;
 * `order` puts the tiles back in priority order, and `md:order-none` hands each
 * stack its own document order again. The hero is `order-1`.
 */
const PHONE_ORDER = [
  'order-2 md:order-none',
  'order-3 md:order-none',
  'order-4 md:order-none',
  'order-5 md:order-none',
  'order-6 md:order-none',
] as const

/** The Caption role (DESIGN-GUIDE §4), which every tile's label uses. */
const CAPTION = 'text-muted-foreground text-[10px] font-medium tracking-[.14em] uppercase'

interface HeroTileProps {
  summary: DeviceSummary
  status: ConnectionStatus
  /** The brand, e.g. "Sony". */
  brand: string
  /**
   * Where the headphones are, or null. Resolved by `Home` from the driver's own
   * wear readout, never from its `detail` — see `DeviceDriver.wearCaption`.
   */
  wear: string | null
  className?: string
}

/**
 * The showpiece: the product and its brand. Dotted, because this is a tile the
 * texture is for (DESIGN-GUIDE §1.4). The facts that used to sit along its foot
 * are on the system tile, so the render can take the whole of it.
 */
export function HeroTile({ summary, status, brand, wear, className }: HeroTileProps) {
  return (
    // `order-1`: the hero is first in the phone's reading order.
    <Card variant="hero" data-slot="home-hero" className={cn('min-h-0 order-1', className)}>
      <div className="flex items-start justify-between gap-3">
        <span className={CAPTION}>{brand}</span>
        {wear && <span className={CAPTION}>{wear}</span>}
      </div>

      <div className="flex min-h-[200px] flex-1 items-center justify-center md:min-h-0">
        <DeviceImage
          status={status}
          model={summary.hasDevice ? summary.model : null}
          hasDevice={summary.hasDevice}
          artwork={summary.artwork}
          // The hero is a product shot, not a control: the ANC glow and the
          // incoming-sound rings are driven by one driver's noise state, and a
          // shared tile has no business reading it.
          noiseLevel={null}
          ancEnabled={null}
          worn={summary.worn}
          budCharging={summary.budCharging}
          // In colour, and as large as the tile allows: the full width, held to
          // the tile's height, with `object-contain` keeping the shape.
          className="max-h-full"
        />
      </div>
    </Card>
  )
}

interface BatteryTileProps {
  summary: DeviceSummary
  connected: boolean
  className?: string
}

/**
 * Battery, inverted: a white block on a phone and a compact strip on a desktop
 * (spec §4.3, DESIGN-GUIDE §5.12).
 *
 * One block at both widths rather than two components, so there is no second
 * place for the rules below to be stated twice. Per-cell rows when the device
 * reports more than one cell, because "60%" on earbuds is a claim about three
 * batteries at once and the case is the one that runs out at the wrong moment.
 */
export function BatteryTile({ summary, connected, className }: BatteryTileProps) {
  const cells = summary.cells
  // One cell is the whole device, so it gets the number; more than one gets a
  // row each, and a single number for three batteries would say nothing.
  const single = cells.length === 1
  // Nothing live to show means a dash, whatever the cell count — which is the
  // one case where the numeral appears without a single cell behind it. The
  // same is true of a *connected* device that reports no cell at all: a WF-C500
  // with both buds in their case answers with two present flags off, so
  // `summary.cells` is empty and the tile would otherwise be an inverted block
  // with a caption and nothing in it — which reads as a tile that failed, not as
  // a battery we cannot read (DESIGN-GUIDE §7: show "—" with a caption when a
  // value is unknown).
  const showNumber = cells.length <= 1 || !connected
  const value = connected ? summary.battery : null

  return (
    <Card
      variant="inverted"
      data-slot="home-battery"
      className={cn(
        // The desktop strip (spec §4.2, DESIGN-GUIDE §5.12): numeral left, then
        // caption over meter over the charging line, on the guide's own
        // `flex items-center gap-3.5 px-[18px] py-3.5`.
        //
        // `md:flex-row` is not redundant with `md:flex`, and the block was a
        // column at every width without it: `Card`'s base is `flex flex-col`, and
        // `md:flex` sets `display` only — it does not reset a direction. The
        // result was the phone layout with a 40px numeral stacked above the
        // caption and meter, ~180px of void beside it, and three times the
        // height §4.2 calls *auto*.
        //
        // **No `align-self`, deliberately.** An earlier version carried
        // `md:self-start` for the *auto* in "auto height" (§4.2), and that was
        // right while this tile was a *grid* item: a grid item's block axis is
        // vertical, so `self-start` meant "auto height" and left the width
        // stretched. Inside §4.2's column — a `flex-direction: column` — the
        // cross axis is horizontal, and the same class shrank the strip to its
        // content. Measured in Chrome at four desktop widths: a 175.7px strip in
        // columns of 334.3 / 280.6 / 376.0 / 360.6px, a 105-200px deficit against
        // the tile below it, at the same 86px height.
        //
        // The mockup has it the other way round (desktop.html:71-76 — a plain
        // child of a `flex-direction: column`, so `align-self: stretch` and full
        // column width), and that is what §4.2's "compact battery strip" means.
        // Auto height needs no class in a flex column: it is the *absence* of a
        // grow, which the column applies on its own.
        'md:flex md:flex-row md:items-center md:gap-3.5 md:px-[18px] md:py-3.5',
        className,
      )}
    >
      <div className="flex flex-col md:flex-1">
        {/* Two captions, one per breakpoint: the desktop strip reads numeral,
            then caption over meter (spec §4.2), and the phone reads caption over
            numeral. Only one is ever displayed, which is also what keeps the
            other out of the accessibility tree — the same trade `EqualizerPanel`
            makes with its two preset layouts. */}
        <span data-slot="battery-caption" className={cn(CAPTION, 'md:hidden')}>
          {connected ? 'Battery' : 'Live only'}
        </span>
        {showNumber && (
          <span
            data-slot="battery-value"
            className="text-[44px] leading-none font-extrabold tracking-[-.04em] tabular-nums md:text-[40px]"
          >
            {value === null ? (
              '—'
            ) : (
              <>
                {value}
                {/* The unit at 45% of the numeral (DESIGN-GUIDE §4). */}
                <span className="text-[20px] md:text-[18px]">%</span>
              </>
            )}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2 md:flex-1">
        <span data-slot="battery-caption" className={cn(CAPTION, 'hidden md:block')}>
          {connected ? 'Battery' : 'Live only'}
        </span>

        {/* Battery is never cached, so a bar drawn from a stale reading would be
            a claim about the present (spec §4.3). Disconnected means no segments
            at all, not zero of them. */}
        {connected && single && (
          <SegmentMeter value={value ?? 0} segments={BATTERY_SEGMENTS} tone="inverted" />
        )}
        {connected && !single && cells.map((entry) => (
          <CellRow key={entry.label} cell={entry} />
        ))}

        {connected && summary.charging && (
          <span data-slot="battery-charging" className="flex items-center gap-1.5 text-[11px]">
            <RiFlashlightLine className="size-3" aria-hidden />
            Charging
          </span>
        )}
      </div>
    </Card>
  )
}

/** One battery cell: a short heading, its own segment bar, its own number. */
function CellRow({ cell }: { cell: BatteryCellSummary }) {
  return (
    <div data-slot="battery-cell" className="flex items-center gap-2">
      <span className="w-7 shrink-0 text-[11px] font-medium">{cell.label}</span>
      <SegmentMeter
        value={cell.level}
        segments={BATTERY_SEGMENTS}
        tone="inverted"
        className="min-w-0 flex-1"
      />
      <span className="w-9 shrink-0 text-right text-[11px] tabular-nums">{cell.level}%</span>
      {/* The bolt is not the whole story: a cell that is charging says so. */}
      {cell.charging && (
        <>
          <RiFlashlightLine className="size-3 shrink-0" aria-hidden />
          <span className="sr-only">charging</span>
        </>
      )}
    </div>
  )
}

interface EqPreviewTileProps {
  eq: EqPreview | null
  onOpen(): void
  className?: string
}

/**
 * The EQ as a shape, and a way into it (spec §4.3).
 *
 * Bar heights are each gain's *position in the reported range*, so flat sits
 * halfway up a signed curve and the tallest bar is the biggest boost — the same
 * arithmetic the approved mockup draws with, and the reason the range travels
 * with the gains. The peak band wears the signal colour: red means "the value
 * you are changing" (DESIGN-GUIDE §1.1), and on a five-band preview the peak is
 * the one worth pointing at.
 *
 * A driver with no `eqPreview`, or one that answers null — or with no bands to
 * draw — gets the caption and a link. Never an empty row of bars, and never a
 * preset name over nothing: both read as a tile that failed to load.
 */
export function EqPreviewTile({ eq, onOpen, className }: EqPreviewTileProps) {
  const curve = eq !== null && eq.gains.length > 0 ? eq : null
  // The largest boost, which on a signed range is also the tallest bar — and
  // none at all when nothing is boosted: a flat or all-cut curve has no value
  // worth the signal colour.
  const peak =
    curve === null
      ? -1
      : curve.gains.reduce((best, gain, index) => (gain > 0 && (best < 0 || gain > curve.gains[best]) ? index : best), -1)

  return (
    <Card variant="hero" data-slot="home-eq" className={cn('min-h-0 p-0', className)}>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'flex min-h-0 flex-1 cursor-pointer flex-col gap-2 p-[14px] text-left md:p-[18px]',
          // The one place the focus ring is drawn *inside* the control, and the
          // reason is geometric: the button is the whole tile, so a ring with a
          // 2px offset would be drawn outside the tile's own box and clipped by
          // the block's `overflow-hidden` — half a ring, on the two tiles where
          // the whole point is that the tile is the button. A 2px inset ring is
          // the same indicator, kept inside the thing it outlines. Everywhere
          // else in the app the ring is offset; `a11y.test.ts` pins that this
          // form is confined to this file.
          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-inset outline-none',
        )}
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className={CAPTION}>Equalizer</span>
          {curve && <span className="text-muted-foreground text-[11px]">Open ↗</span>}
        </div>

        {curve === null ? (
          <span className="truncate text-[30px] font-extrabold tracking-[-.03em]">
            Sound settings ↗
          </span>
        ) : (
          <>
            <span className="truncate text-[30px] font-extrabold tracking-[-.03em]">
              {curve.preset ?? 'Custom'}
            </span>
            <div aria-hidden className="flex min-h-[64px] flex-1 items-end gap-2 pt-3">
              {curve.gains.map((gain, index) => (
                <span
                  key={index}
                  data-slot="eq-bar"
                  data-peak={index === peak ? 'true' : undefined}
                  className={cn('flex-1 rounded-[10px]', index === peak ? 'bg-signal' : 'bg-foreground')}
                  style={{ height: `${barHeight(gain, curve.range)}%` }}
                />
              ))}
            </div>
          </>
        )}
      </button>
    </Card>
  )
}

/** How much of the range a gain sits at, as a share of the bar's height. */
function barHeight(gain: number, range: { min: number; max: number }): number {
  const span = range.max - range.min
  if (span <= 0) return 50
  const share = Math.max(4, Math.min(100, ((gain - range.min) / span) * 100))
  // Two decimals rather than the float's own tail: the same curve should draw
  // the same markup every render, and a snapshot of it should be readable.
  return Math.round(share * 100) / 100
}

interface DevicesTileProps {
  connections: ConnectionSummary[] | null
  onOpen(): void
  className?: string
}

/**
 * Who the headphones are holding on to (spec §4.3, DESIGN-GUIDE §5.12).
 *
 * Rows with dividers, the entry this app is talking through marked "· this",
 * and a dot per row. The dot is never the only signal: each row says Connected
 * or Not connected in text for anyone who cannot see the fill, and a muted row
 * for one that is not holding a link (DESIGN-GUIDE §1.1).
 */
export function DevicesTile({ connections, onOpen, className }: DevicesTileProps) {
  const rows = connections ?? []

  return (
    <Card data-slot="home-devices" className={cn('min-h-0 p-0', className)}>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'flex min-h-0 flex-1 cursor-pointer flex-col gap-2 p-[14px] text-left md:p-[18px]',
          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-inset outline-none',
        )}
      >
        <span className={CAPTION}>Connected to</span>

        {rows.length === 0 ? (
          <span className="text-[13px]">Connections ↗</span>
        ) : (
          <ul className="flex flex-col">
            {rows.map((entry, index) => (
              <li
                key={`${entry.name}-${index}`}
                data-slot="device-row"
                className={cn(
                  'flex items-center justify-between gap-3 border-b py-2 last:border-b-0',
                  entry.connected ? '' : 'text-muted-foreground',
                )}
              >
                <span className="min-w-0 truncate text-[13px] font-bold">
                  {entry.name}
                  {entry.isThisDevice && (
                    <span className="text-muted-foreground ml-1 text-[11px] font-normal">
                      · this
                    </span>
                  )}
                  <span className="sr-only">
                    {entry.connected ? ' — Connected' : ' — Not connected'}
                  </span>
                </span>
                <span
                  aria-hidden
                  className={cn(
                    'size-2 shrink-0 rounded-full',
                    entry.connected ? 'bg-foreground' : 'bg-segment-off',
                  )}
                />
              </li>
            ))}
          </ul>
        )}
      </button>
    </Card>
  )
}

interface SystemTileProps {
  facts: Array<{ label: string; value: string | null }>
  onOpen(): void
  className?: string
}

/**
 * What the device is: model, firmware, codec and links, and a way into System.
 * A fact the device has not reported is left out rather than shown as a dash,
 * and a tile with none left is the caption and a link.
 */
export function SystemTile({ facts, onOpen, className }: SystemTileProps) {
  const rows = facts.filter((fact): fact is { label: string; value: string } => fact.value !== null)

  return (
    <Card data-slot="home-system" className={cn('min-h-0 p-0', className)}>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'flex min-h-0 flex-1 cursor-pointer flex-col gap-2 p-[14px] text-left md:p-[18px]',
          'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-inset outline-none',
        )}
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className={CAPTION}>System</span>
          <span className="text-muted-foreground text-[11px]">Open ↗</span>
        </div>

        {rows.length === 0 ? (
          <span className="text-[13px]">System settings ↗</span>
        ) : (
          <dl className="flex flex-col">
            {rows.map((fact) => (
              <div
                key={fact.label}
                data-slot="system-row"
                className="flex items-baseline justify-between gap-3 border-b py-2 last:border-b-0"
              >
                <dt className="text-muted-foreground text-[13px]">{fact.label}</dt>
                <dd className="min-w-0 truncate text-[13px] font-bold tabular-nums">{fact.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </button>
    </Card>
  )
}
