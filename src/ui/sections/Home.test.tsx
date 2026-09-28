// @vitest-environment jsdom
/**
 * Home's composition — spec §4.3, DESIGN-GUIDE §5.12.
 *
 * A **fake driver**, not a real one. The rule this tier works under is that a
 * shared component must not know which driver it is drawing for, and that rule
 * covers its tests: `nav.test.tsx`, `summary.test.ts` and `appShell.test.tsx`
 * all live in `src/` precisely because naming a driver is what forces them
 * there. So nothing below names one. The fake reads the same handful of fields
 * the shared normaliser reads of a single-cell device (a model, a firmware
 * string, one battery level) and answers the two optional readouts itself, which
 * is what makes it a fixture rather than a claim about any hardware.
 *
 * The tiles are tested through their own props as well as through `Home`, for
 * the one case a single-cell fake cannot reach: `DeviceSummary.cells` is
 * normalised per driver, so a two-cell device is a `BatteryTile` fixture with
 * two cells in it rather than a driver to invent.
 *
 * jsdom because two tiles are buttons that navigate, and what is under test
 * there is the click, not the markup.
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ConnectionSummary, EqPreview } from '@/core/driver'
import type { ActiveDevice } from '@/core/manager'
import type { DeviceSummary } from '@/ui/device/summary'
import { BatteryTile, Home } from './Home'

afterEach(cleanup)

/** The driver's own noise section, standing in for whatever it renders. */
const Noise = () => <div data-slot="driver-noise">Noise control</div>

/** The artwork a fake device resolves to — a real render, an invented URL. */
const ARTWORK = { hero: 'test/hero.webp', heroInactive: 'test/hero-off.webp', aspect: 2 }

interface FakeOptions {
  /** Section ids the driver declares, in its own order. */
  sections?: string[]
  /**
   * Omitted entirely when null, which is how "does not implement it" reads.
   *
   * Note what the fake *always* keeps: a `noise` component in its `components`
   * map. Every driver does, including the ones whose section list gates `noise`
   * out — a component existing is not a section existing, and the slot must
   * follow the list.
   */
  eqPreview?: (state: unknown) => EqPreview | null
  connections?: (state: unknown) => ConnectionSummary[] | null
  codec?: string | null
  detail?: string | null
  /** The driver's own words for where the headphones are, when it has any. */
  wearCaption?: string | null
  worn?: boolean
}

interface FakeState {
  status: string
  info: { model: string | null; firmware: string | null; serial: string | null; codec: number | null }
  battery: number | null
  charging: boolean | null
}

const connectedState: FakeState = {
  status: 'connected',
  info: { model: 'Test Buds', firmware: '2.12.4', serial: null, codec: null },
  battery: 78,
  charging: false,
}

const active = (options: FakeOptions = {}, state: Partial<FakeState> = {}): ActiveDevice => {
  const merged = { ...connectedState, ...state }
  const ids = options.sections ?? ['noise', 'sound', 'devices', 'system']
  const driver: Record<string, unknown> = {
    id: 'test',
    label: 'Test Audio',
    sections: () => ids.map((id) => ({ id, label: id })),
    // Always holds `noise`, whatever the section list says: that is the shape of
    // a driver whose capability gate is in `sections()`, and the two must not be
    // read as the same thing.
    components: { noise: Noise },
    codecName: () => options.codec ?? null,
    statusLine: () => options.detail ?? null,
    artwork: () => ARTWORK,
    worn: () => options.worn ?? true,
  }
  if (options.eqPreview) driver.eqPreview = options.eqPreview
  if (options.connections) driver.connections = options.connections
  if (options.wearCaption) driver.wearCaption = () => options.wearCaption ?? null
  return { id: 'test', driver, device: {}, state: merged } as unknown as ActiveDevice
}

const renderHome = (options: FakeOptions = {}, state: Partial<FakeState> = {}) => {
  const onNavigate = vi.fn()
  const view = render(<Home active={active(options, state)} onNavigate={onNavigate} />)
  return { ...view, onNavigate, node: view.container.firstElementChild as HTMLElement }
}

/** The one element carrying `slot`, or null. */
const slot = (node: HTMLElement, name: string): HTMLElement | null =>
  node.querySelector<HTMLElement>(`[data-slot="${name}"]`)

const all = (node: HTMLElement, name: string): HTMLElement[] =>
  Array.from(node.querySelectorAll<HTMLElement>(`[data-slot="${name}"]`))

/** An element's visible text, whitespace collapsed. */
const text = (node: HTMLElement | null): string =>
  (node?.textContent ?? '').replace(/\s+/g, ' ').trim()

/** A `DeviceSummary` fixture, for the tiles tested on their own. */
const summary = (overrides: Partial<DeviceSummary> = {}): DeviceSummary => ({
  model: 'Test Buds',
  hasDevice: true,
  battery: 78,
  charging: false,
  codec: null,
  detail: null,
  artwork: ARTWORK,
  worn: true,
  firmware: null,
  cells: [],
  ...overrides,
})

describe('Home — the noise slot', () => {
  it("renders the driver's own noise component, in its own words", () => {
    // Spec §4.3: the slot is the driver's section, not a shared rebuild of it.
    const { node } = renderHome()
    const noise = slot(node, 'home-noise')
    expect(noise).not.toBeNull()
    expect(slot(noise!, 'driver-noise')).not.toBeNull()
    expect(text(noise)).toContain('Noise control')
  })

  it('omits the slot for a driver that declares no noise section, even with a component', () => {
    // Spec §4.3.3 and §3.1: a driver's `components` map holds a component for
    // every id it *might* have — one driver's `noise` component exists on a
    // device with no noise control at all, and the gate is in its section list.
    // Reading the map would render a noise tile there; reading the list does not.
    // The fixture keeps the component on purpose: dropping both would make this
    // test pass whichever one Home read.
    const { node } = renderHome({ sections: ['sound', 'devices', 'system'] })
    expect(slot(node, 'home-noise')).toBeNull()
  })
})

describe('Home — the EQ preview tile', () => {
  const preview: EqPreview = { preset: 'Rock', gains: [0, 2, 2.5, 1.5, -2], range: { min: -6, max: 6 } }

  it('names the preset and draws one bar per band', () => {
    const { node } = renderHome({ eqPreview: () => preview })
    const tile = slot(node, 'home-eq')
    expect(text(tile)).toContain('Equalizer')
    expect(text(tile)).toContain('Open')
    expect(text(tile)).toContain('Rock')
    expect(all(tile!, 'eq-bar')).toHaveLength(5)
  })

  it('maps each gain onto the reported range, and marks the peak', () => {
    // Heights are the gain's position in `range`, so 0 dB sits halfway up a
    // ±6 dB curve and the largest boost is the tallest bar.
    const { node } = renderHome({ eqPreview: () => preview })
    const bars = all(slot(node, 'home-eq')!, 'eq-bar')
    expect(bars[0].style.height).toBe('50%')
    expect(bars[4].style.height).toBe('33.33%')
    expect(bars.filter((bar) => bar.dataset.peak !== undefined)).toHaveLength(1)
    expect(bars[2].dataset.peak).toBe('true')
    expect(bars[2].className).toContain('bg-signal')
  })

  it('calls a hand-edited curve Custom rather than naming a preset that is not playing', () => {
    const { node } = renderHome({
      eqPreview: () => ({ ...preview, preset: null }),
    })
    expect(text(slot(node, 'home-eq'))).toContain('Custom')
  })

  it('falls back to the caption and an arrow when the driver has no eqPreview', () => {
    // Spec §4.3: no method, or a null answer, is the same tile minus the curve.
    // The tile still leads to Sound, so it is never a dead end.
    const { node } = renderHome()
    const tile = slot(node, 'home-eq')
    expect(text(tile)).toContain('Equalizer')
    expect(text(tile)).toContain('Sound settings')
    expect(all(tile!, 'eq-bar')).toHaveLength(0)
  })

  it('falls back rather than naming a preset over no bars', () => {
    // A name with nothing under it reads as a tile that failed to load.
    const { node } = renderHome({ eqPreview: () => ({ preset: 'Rock', gains: [], range: { min: -6, max: 6 } }) })
    const tile = slot(node, 'home-eq')
    expect(text(tile)).toContain('Sound settings')
    expect(text(tile)).not.toContain('Rock')
  })

  it('is one button that opens Sound', () => {
    const { node, onNavigate } = renderHome()
    const tile = slot(node, 'home-eq')!
    // The whole tile is the target, not a link in its corner — on a phone a
    // corner link is a 20px target, and the point of a preview is the tap.
    const button = tile.querySelector('button')!
    expect(tile.querySelectorAll('button')).toHaveLength(1)
    fireEvent.click(button)
    expect(onNavigate).toHaveBeenCalledWith('sound')
  })
})

describe('Home — the devices tile', () => {
  const list: ConnectionSummary[] = [
    { name: 'MacBook Pro', connected: true, isThisDevice: true },
    { name: 'iPad Air', connected: false, isThisDevice: false },
  ]

  it('appears only for a driver with a devices section', () => {
    expect(slot(renderHome().node, 'home-devices')).not.toBeNull()
    const without = renderHome({ sections: ['noise', 'sound', 'system'] }).node
    expect(slot(without, 'home-devices')).toBeNull()
  })

  it('lists one row per known source, marking this one and saying which are linked', () => {
    const { node } = renderHome({ connections: () => list })
    const tile = slot(node, 'home-devices')!
    expect(text(tile)).toContain('Connected to')
    const rows = all(tile, 'device-row')
    expect(rows).toHaveLength(2)
    expect(text(rows[0])).toContain('MacBook Pro')
    expect(text(rows[0])).toContain('· this')
    expect(text(rows[1])).toContain('iPad Air')
    // The dot is not the only signal: a state the colour carries is also read
    // out, so the row does not depend on seeing red (DESIGN-GUIDE §1.1).
    expect(text(rows[0])).toContain('Connected')
    expect(text(rows[1])).toContain('Not connected')
  })

  it('falls back to a plain link for a driver with no connections list', () => {
    const { node } = renderHome({ sections: ['sound', 'devices', 'system'] })
    const tile = slot(node, 'home-devices')!
    expect(all(tile, 'device-row')).toHaveLength(0)
    expect(text(tile)).toContain('Connections')
  })

  it('is one button that opens the devices section', () => {
    const { node, onNavigate } = renderHome({ connections: () => list })
    const tile = slot(node, 'home-devices')!
    expect(tile.querySelectorAll('button')).toHaveLength(1)
    fireEvent.click(tile.querySelector('button')!)
    expect(onNavigate).toHaveBeenCalledWith('devices')
  })
})

describe('Home — the hero tile', () => {
  it('shows at most three facts, and only the ones the device reported', () => {
    const { node } = renderHome(
      { codec: 'AAC', connections: () => [{ name: 'A', connected: true, isThisDevice: false }, { name: 'B', connected: false, isThisDevice: false }] },
      { info: { model: 'Test Buds', firmware: '2.12.4', serial: null, codec: 1 } },
    )
    const hero = slot(node, 'home-hero')!
    const chips = all(hero, 'hero-chip')
    expect(chips).toHaveLength(3)
    expect(text(chips[0])).toContain('Codec')
    expect(text(chips[0])).toContain('AAC')
    expect(text(chips[1])).toContain('Firmware')
    expect(text(chips[2])).toContain('Links')
    // `connected/total`, which is the number a person can act on.
    expect(text(chips[2])).toContain('1/2')
  })

  it('drops a fact rather than showing an empty chip', () => {
    const { node } = renderHome({}, { info: { model: 'Test Buds', firmware: null, serial: null, codec: null } })
    expect(all(slot(node, 'home-hero')!, 'hero-chip')).toHaveLength(0)
  })

  it('names the brand, and the wear state the driver reports for it', () => {
    const { node } = renderHome({ wearCaption: 'On head' })
    const hero = slot(node, 'home-hero')!
    expect(text(hero)).toContain('Test Audio')
    expect(text(hero)).toContain('On head')
  })

  it('uses the driver’s own wear wording rather than a blunter "not worn"', () => {
    // "In case" says more about a pair of earbuds than "not worn" does.
    const { node } = renderHome({ wearCaption: 'In case', worn: false })
    expect(text(slot(node, 'home-hero'))).toContain('In case')
    expect(text(slot(node, 'home-hero'))).not.toContain('Not worn')
  })

  it('never takes the wear caption from a detail line', () => {
    // `detail` is free to be per-cell battery levels, and one driver's case
    // status ("L in case · R in case") is neither a wear state nor a level — a
    // hero caption read off either would be a claim the driver never made. The
    // caption comes from the driver's own wear readout or not at all.
    for (const detail of [
      'L 80% · R 75% · Case 60%',
      'L in case · R in case',
      'L in case · R 100%',
    ]) {
      const { node } = renderHome({ detail })
      expect(text(slot(node, 'home-hero'))).not.toContain(detail)
    }
  })

  it('says so when the headphones are off the head and the driver has no words for it', () => {
    const { node } = renderHome({ worn: false })
    expect(text(slot(node, 'home-hero'))).toContain('Not worn')
  })

  it('caps the product render at 320x260, in colour', () => {
    // The one place colour belongs (DESIGN-GUIDE §1.1), so no greyscale filter.
    const { node } = renderHome()
    const image = slot(node, 'home-hero')!.querySelector('img')!
    expect(image.getAttribute('src')).toBe(ARTWORK.hero)
    expect(image.className).toContain('object-contain')
    expect(image.className).not.toContain('grayscale')
    // The cap is on the frame the render fills, not on the image itself.
    const frame = image.parentElement!
    expect(frame.className).toContain('max-h-[260px]')
    expect(frame.className).toContain('max-w-[320px]')
  })
})

describe('Home — the layout', () => {
  it('is one column on a phone and a 1.35/1/1 bento from 1100px up', () => {
    const classes = renderHome().node.className
    expect(classes).toContain('flex flex-col')
    expect(classes).toContain('md:grid-cols-2')
    expect(classes).toContain('bento:grid-cols-[1.35fr_1fr_1fr]')
    // Sized from the shell's own flexed body rather than a viewport height.
    expect(classes).toContain('md:flex-1')
    expect(classes).not.toContain('100vh')
    expect(classes).not.toContain('100dvh')
  })

  /**
   * §4.2's three columns are three *stacks*, not three cells in a shared grid
   * row, and the difference is the whole of this describe.
   *
   * One grid with `auto 1fr` rows makes row 1 as tall as the tallest thing in it
   * — the noise section — so an auto-height battery strip in that row sat at the
   * top of 474px with the EQ tile 400px below it in row 2. Measured in Chrome at
   * 1280×800 before this change: 400px of page between an 86px strip and the
   * tile below it. The mockup has no such gap because each column is a nested
   * `flex-direction: column` (docs/design/mono/mockups/desktop.html:71-116), and
   * that is the structure §4.2 describes.
   */
  it('builds each spec column as its own stack, not cells in a shared row', () => {
    const { node } = renderHome()
    for (const name of ['home-col-middle', 'home-col-right']) {
      const column = slot(node, name)!
      const classes = column.className.split(' ')
      // No box on a phone: the tiles are the single column, in the spec's order,
      // so the wrapper must not become one. `display: contents` is what says
      // "my children are the layout" without reordering them.
      expect(classes).toContain('contents')
      // From `md` each is a flex column, at the bento's own 12px gap.
      expect(classes).toContain('md:flex')
      expect(classes).toContain('md:flex-col')
      expect(classes).toContain('md:gap-3')
      // `min-h-0` so a stack shorter than its window overflows visibly and
      // `main` scrolls, rather than the desk being squeezed under its floor.
      expect(classes).toContain('md:min-h-0')
      // The phone gap belongs to the single column above, not to a stack.
      expect(classes).not.toContain('gap-2')
    }
  })

  it('puts the strip and the EQ tile in the middle column, in that order', () => {
    // Spec §4.2 column 2: "compact battery strip (auto height), then the EQ
    // preview tile (fills the rest)". Two assertions per tile, because the
    // order and the fill are the two halves of that sentence.
    const column = slot(renderHome().node, 'home-col-middle')!
    expect(Array.from(column.children).map((child) => child.getAttribute('data-slot'))).toEqual([
      'home-battery',
      'home-eq',
    ])
    // Auto height in a flex column is the default, so the strip must *not* ask
    // to grow: this is what `md:self-start` was for when the row sized it, and
    // in a stack the absence of `flex-1` is the same statement.
    const strip = column.children[0] as HTMLElement
    expect(strip.className.split(' ')).not.toContain('flex-1')
    expect(strip.className.split(' ')).toContain('md:flex-row')
    // Fills the rest.
    const eq = column.children[1] as HTMLElement
    expect(eq.className.split(' ')).toContain('md:flex-1')
  })

  it('puts the noise section and the connections tile in the right column', () => {
    // Spec §4.2 column 3: "the noise section (auto height), then the devices
    // tile (fills the rest)".
    const column = slot(renderHome().node, 'home-col-right')!
    expect(Array.from(column.children).map((child) => child.getAttribute('data-slot'))).toEqual([
      'home-noise',
      'home-devices',
    ])
    const noise = column.children[0] as HTMLElement
    const devices = column.children[1] as HTMLElement
    // Neither asks to grow while the other is there to fill.
    expect(noise.className.split(' ')).not.toContain('flex-1')
    expect(devices.className.split(' ')).toContain('md:flex-1')
  })

  it('gives the hero the full height of the first column, alone in it', () => {
    // `md:col-span-2` because §4.2 puts the hero across the top between 768 and
    // 1100px; from `bento:` it is column 1 of three. No `row-span` any more: the
    // hero is a grid item in a single-row grid from `bento:` up, and the
    // two-column arrangement gets its height from `md:grid-rows-[auto_1fr]`.
    const { node } = renderHome()
    const hero = slot(node, 'home-hero')!.className
    expect(hero).toContain('md:col-span-2')
    expect(hero).toContain('bento:col-span-1')
    expect(hero).not.toContain('row-span')
    expect(node.className).toContain('md:grid-rows-[auto_1fr]')
    expect(node.className).toContain('bento:grid-rows-1')
  })

  it('places the two stacks in the columns §4.2 gives them', () => {
    // 768–1100: hero across the top, battery+EQ left, noise+devices right — the
    // spec's sentence, and the one arrangement that is not the three-column one.
    const { node } = renderHome()
    const middle = slot(node, 'home-col-middle')!.className
    expect(middle).toContain('md:col-start-1')
    expect(middle).toContain('md:row-start-2')
    expect(middle).toContain('bento:col-start-2')
    const right = slot(node, 'home-col-right')!.className
    expect(right).toContain('md:col-start-2')
    expect(right).toContain('md:row-start-2')
    expect(right).toContain('bento:col-start-3')
    // **`bento:row-start-1` on both, and this assertion is here because its
    // absence was measured rather than argued.** A `md:` placement keeps
    // applying at the bento width unless a `bento:` twin resets it, so the two
    // columns were held in row 2 while the hero sat in row 1: the three-column
    // bento had *two* equal rows and the columns occupied the lower one.
    // Measured at 1280x800 before this line: `rows = 685.953px 685.953px`.
    expect(middle).toContain('bento:row-start-1')
    expect(right).toContain('bento:row-start-1')
    // And each is one grid item: the tiles inside carry no placement at all, or
    // the row arithmetic this replaced would creep back in.
    for (const name of ['home-battery', 'home-eq', 'home-noise', 'home-devices']) {
      const classes = slot(node, name)!.className
      expect(classes).not.toMatch(/row-start|row-span|col-start|col-span/)
    }
  })

  it('reads in the spec’s order on a phone, whatever the column wrappers say', () => {
    // The wrappers are `display: contents` on a phone, so *document* order is
    // the phone's order — and the document order is the columns', which is
    // battery→EQ→noise→devices. §4.1 asks for hero → battery → noise → EQ →
    // devices, so the tiles carry explicit `order` on the phone and drop it
    // from `md` up, where each column's own order is the right one. Without
    // this the equaliser moves above the noise control on every phone.
    const { node } = renderHome()
    const order = (name: string) => slot(node, name)!.className.split(' ')
    expect(order('home-hero')).toContain('order-1')
    expect(order('home-battery')).toContain('order-2')
    expect(order('home-noise')).toContain('order-3')
    expect(order('home-eq')).toContain('order-4')
    expect(order('home-devices')).toContain('order-5')
    // …and the drop is stated, not assumed: `order-none` from `md` puts each
    // column back in its own document order.
    for (const name of ['home-battery', 'home-noise', 'home-eq', 'home-devices']) {
      expect(order(name)).toContain('md:order-none')
    }
  })

  it('lets the noise section fill the right column when there is no devices tile', () => {
    // Spec §4.2: "When there is no devices tile, the noise section fills the
    // column." In a stack this is one class rather than a row span — the tile
    // that is alone in the column is the one that grows. Every driver with noise
    // control and no `devices` section (three of five) lands here.
    const { node } = renderHome({ sections: ['noise', 'sound', 'system'] })
    expect(slot(node, 'home-devices')).toBeNull()
    const noise = slot(node, 'home-noise')!.className
    expect(noise.split(' ')).toContain('md:flex-1')
    // And it is still the only child, so it is the whole column.
    expect(slot(node, 'home-col-right')!.children).toHaveLength(1)
  })

  it('fills the column all the way down, not just the wrapper around the noise section', () => {
    // **`md:flex-1` on the wrapper was not enough, and the gap it left is the
    // finding.** The wrapper grows; what is inside it does not. A driver's noise
    // section root is its own `<div className="flex flex-col gap-4">` (or, for
    // HeyMelody, a single `Card`), and that box is content-height — so the
    // column reserved ~260px of page below the last card and the hero, the
    // middle column and this one all ended at different lines. Measured in
    // Chrome at 1280×800 before this test existed.
    //
    // The chain is two descendant rules, and both are load-bearing:
    //
    // 1. the wrapper is a flex column from `md`, so its child can be *given*
    //    height at all — a block's height is its content's;
    // 2. `[&>*]:flex-1` hands it to the driver's root, and
    //    `[&>*>*:last-child]:flex-1` hands the rest to the last block inside
    //    that root, which is the one whose bottom edge the user sees.
    //
    // A driver root is reached from here rather than given a `className` prop
    // for the same reason `AppShell` carries `md:[&>*]:min-h-0` on seventeen
    // section roots: a prop would put a bento layout concern in five driver
    // files and would be missed by the sixth.
    const { node } = renderHome({ sections: ['noise', 'sound', 'system'] })
    const classes = slot(node, 'home-noise')!.className.split(' ')
    expect(classes).toContain('md:flex')
    expect(classes).toContain('md:flex-col')
    expect(classes).toContain('md:[&>*]:flex-1')
    expect(classes).toContain('md:[&>*>*:last-child]:flex-1')
  })

  it('does not ask a noise section to stretch when a devices tile shares the column', () => {
    // The same classes with something below them would push the connections
    // tile off the bottom of the window, because §4.2 gives *that* tile the
    // leftover and the column is `md:min-h-0`. Auto height up here is the
    // spec's sentence: "the noise section (auto height), then the devices tile
    // (fills the rest)".
    const { node } = renderHome({ sections: ['noise', 'sound', 'devices', 'system'] })
    const classes = slot(node, 'home-noise')!.className.split(' ')
    expect(classes).toContain('shrink-0')
    expect(classes).not.toContain('md:flex-1')
    expect(classes.some((token) => token.includes('flex-1'))).toBe(false)
  })

  it('lets the connections tile fill the right column when there is no noise section', () => {
    // The reverse of the rule above, and the other half of the same §4.2
    // sentence. Nothing above it to share the column, so it is the only child and
    // it grows — which is what it already does, so the case needed no branch.
    const { node } = renderHome({ sections: ['sound', 'devices', 'system'] })
    expect(slot(node, 'home-noise')).toBeNull()
    const devices = slot(node, 'home-devices')!.className
    expect(devices.split(' ')).toContain('md:flex-1')
    expect(slot(node, 'home-col-right')!.children).toHaveLength(1)
  })

  it('still lays out for a driver that declares neither slot', () => {
    // Reachable, not hypothetical: a device whose probe answers "no ANC, no
    // pairing" leaves one of the two drivers with sections `sound` and `system`
    // alone. Nothing can fill the right-hand column, and the arrangement the
    // spec gives for a driver *with* both slots is kept rather than reshuffled
    // for a case it does not describe — which leaves that column empty. Recorded
    // here so it is a decision, not an oversight. The middle column is
    // unaffected: strip above EQ, which is the spec's column 2 either way.
    const { node } = renderHome({ sections: ['sound', 'system'] })
    expect(slot(node, 'home-noise')).toBeNull()
    expect(slot(node, 'home-devices')).toBeNull()
    expect(slot(node, 'home-col-right')!.children).toHaveLength(0)
    const column = slot(node, 'home-col-middle')!
    expect(Array.from(column.children).map((child) => child.getAttribute('data-slot'))).toEqual([
      'home-battery',
      'home-eq',
    ])
  })
})

/**
 * The widths Home uses, and why they are named ones.
 *
 * This is the regression guard for a bug no class-string assertion could see.
 * `bento:` and `md:` are the same specificity, so which of a pair of
 * conflicting rules wins is decided by their order in the *built* stylesheet —
 * and Tailwind emits arbitrary min-width variants ahead of the named ones, so
 * every `md:` rule beat its `bento:` twin. The bento's three columns had
 * never applied at any width: at 1400px the grid computed four tracks and the
 * hero rendered as a 356px sliver on the far right.
 *
 * So the rule is: the widths this bento switches at are named breakpoints, and
 * the bento's is declared in the theme. The proof that the cascade now agrees
 * lives where the order does — a build plus a browser — and is recorded in the
 * task report; what is testable here is that the shape of the fix survives.
 */
describe('Home — the widths it switches at', () => {
  // `process.cwd()` is the project root under vitest, and `import.meta.url` is
  // not a file URL once the module has been transformed for the browser-ish
  // environment, so the theme is read the way a build tool would find it.
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')

  const classNamesOf = (): string[] => {
    const { node } = renderHome({ sections: ['noise', 'sound', 'devices', 'system'] })
    return [
      node.className,
      ...['home-hero', 'home-battery', 'home-noise', 'home-eq', 'home-devices'].map(
        (name) => slot(node, name)?.className ?? '',
      ),
    ]
  }

  it('uses no arbitrary width variant, whose rules sort ahead of the named ones', () => {
    for (const classes of classNamesOf()) {
      expect(classes).not.toMatch(/min-\[/)
      expect(classes).not.toMatch(/@media/)
      expect(classes).not.toMatch(/max-\[/)
    }
  })

  it('declares the bento breakpoint, since an undeclared variant is silently ignored', () => {
    // Tailwind emits nothing at all for a variant name it has never heard of —
    // no warning, no class — so a removed or renamed declaration would take the
    // three-column layout away silently. This is the whole of the declaration.
    expect(css).toMatch(/--breakpoint-bento:\s*68\.75rem/)
  })
})

describe('Home — the idle dim', () => {
  const idle = { status: 'disconnected' }

  it('dims every tile but the hero, and keeps the hero at full strength', () => {
    // Spec §4.3: not connected means the values on screen are the last ones
    // read, so they are shown but not offered as current — and "the hero and top
    // bar stay at full strength", because a page that keeps showing a
    // disconnected device must not dim the one thing that says it is.
    const { node } = renderHome({}, idle)
    for (const name of ['home-battery', 'home-noise', 'home-eq', 'home-devices']) {
      expect(slot(node, name)!.className).toContain('opacity-50')
      expect(slot(node, name)!.className).toContain('pointer-events-none')
    }
    expect(slot(node, 'home-hero')!.className).not.toContain('opacity-50')
    expect(slot(node, 'home-hero')!.className).not.toContain('pointer-events-none')
  })

  it('dims nothing while connected', () => {
    const { node } = renderHome()
    expect(node.innerHTML).not.toContain('opacity-50')
    expect(node.innerHTML).not.toContain('pointer-events-none')
  })
})

describe('BatteryTile', () => {
  const renderTile = (overrides: Partial<DeviceSummary> = {}, connected = true) =>
    render(<BatteryTile summary={summary(overrides)} connected={connected} />)

  it('leads with the percentage for a device with one cell', () => {
    const { container } = renderTile({ cells: [{ label: 'Battery', level: 78, charging: false }] })
    const tile = container.firstElementChild as HTMLElement
    expect(text(slot(tile, 'battery-value'))).toBe('78%')
    // Ten segments, as many lit as the level fills.
    const meter = slot(tile, 'segment-meter')!
    expect(meter.children).toHaveLength(10)
    expect(meter.querySelectorAll('[data-lit="true"]')).toHaveLength(8)
  })

  it('shows one row per cell when there is more than one', () => {
    // Spec §4.3: L / R / Case as rows, instead of one number for the pair.
    const { container } = renderTile({
      cells: [
        { label: 'L', level: 80, charging: false },
        { label: 'R', level: 45, charging: true },
        { label: 'Case', level: 60, charging: false },
      ],
    })
    const tile = container.firstElementChild as HTMLElement
    const rows = all(tile, 'battery-cell')
    expect(rows).toHaveLength(3)
    expect(text(rows[0])).toContain('L')
    expect(text(rows[0])).toContain('80%')
    expect(text(rows[1])).toContain('45%')
    expect(slot(rows[1], 'segment-meter')!.querySelectorAll('[data-lit="true"]')).toHaveLength(5)
    // A single number would claim one level for a device that reports three.
    expect(slot(tile, 'battery-value')).toBeNull()
  })

  it('shows the bolt and the charging caption while charging', () => {
    const { container } = renderTile(
      { charging: true, cells: [{ label: 'Battery', level: 40, charging: true }] },
    )
    const tile = container.firstElementChild as HTMLElement
    expect(text(slot(tile, 'battery-charging'))).toContain('Charging')
    expect(slot(tile, 'battery-charging')!.querySelector('svg')).not.toBeNull()
  })

  it('says "—" and "Live only" while disconnected, with no segments to read', () => {
    // Battery is never cached, so a bar here would be a claim about the present.
    const { container } = renderTile(
      { cells: [{ label: 'Battery', level: 78, charging: false }] },
      false,
    )
    const tile = container.firstElementChild as HTMLElement
    expect(text(slot(tile, 'battery-value'))).toBe('—')
    expect(text(slot(tile, 'battery-caption'))).toContain('Live only')
    expect(slot(tile, 'segment-meter')).toBeNull()
    expect(all(tile, 'battery-cell')).toHaveLength(0)
  })

  it('says "—" while connected but reporting no cell at all', () => {
    // The WF-C500 case: both buds are in the case, each answers "not present",
    // and `summarise` drops both — so the tile has zero cells on a device that
    // is very much connected. Before this, `showNumber` was `single || !connected`
    // and the block rendered as an inverted caption over an empty hole, which
    // reads as a tile that failed rather than a level we cannot read.
    const { container } = renderTile({ cells: [], battery: null })
    const tile = container.firstElementChild as HTMLElement
    expect(text(slot(tile, 'battery-value'))).toBe('—')
    // Still "Battery", not "Live only": something *is* live, it just has nothing
    // to report from this pose.
    expect(text(slot(tile, 'battery-caption'))).toBe('Battery')
    expect(all(tile, 'battery-cell')).toHaveLength(0)
    expect(slot(tile, 'segment-meter')).toBeNull()
  })

  it('marks the whole block as the two captions the two widths share', () => {
    // One per breakpoint rather than one shared: the desktop strip reads
    // numeral, then caption over meter (spec §4.2), and only one of the two
    // copies is ever displayed.
    const { container } = renderTile()
    const captions = all(container.firstElementChild as HTMLElement, 'battery-caption')
    expect(captions).toHaveLength(2)
    expect(captions[0].className).toContain('md:hidden')
    expect(captions[1].className).toContain('hidden')
    expect(captions[1].className).toContain('md:block')
    expect(text(captions[0])).toBe(text(captions[1]))
  })

  it('is a row from md up, filling its column, at its own height', () => {
    // Spec §4.2 and DESIGN-GUIDE §5.12: "Battery, desktop: an inverted strip,
    // `flex items-center gap-3.5 px-[18px] py-3.5`: numeral left, then Caption
    // over SegmentMeter over the charging line" — and §4.2 puts it in a column
    // the mockup draws as a plain child of a `flex-direction: column`
    // (desktop.html:71-76), i.e. a full-width block at its own height.
    const { container } = renderTile()
    const tile = container.firstElementChild as HTMLElement
    const classes = tile.className.split(' ')
    expect(classes).toContain('md:flex')
    expect(classes).toContain('md:flex-row')
    // The guide's own padding and gap. `md:items-center` centres the numeral
    // against the caption-over-meter column, and it is useless without the row.
    expect(classes).toContain('md:items-center')
    expect(classes).toContain('md:gap-3.5')
    expect(classes).toContain('md:px-[18px]')
    expect(classes).toContain('md:py-3.5')
    // The phone is a column and says so: this is the phone's block padding, and
    // the one line above is what makes `md:items-center` mean anything.
    expect(classes).toContain('flex-col')
    expect(classes).not.toContain('md:flex-col')

    // **No `align-self` of any kind, and this is the assertion the bug needed.**
    // `md:self-start` was correct while the strip was a *grid* item — a grid
    // item's block axis is vertical, so `self-start` meant "auto height" and
    // left the width stretched. Inside §4.2's column, which is a flex column,
    // the cross axis is horizontal: the same class shrank the strip to its
    // content. Measured in Chrome before this line existed, at four desktop
    // widths: a 175.7px strip in columns of 334.3 / 280.6 / 376.0 / 360.6px —
    // a 105-200px deficit against the tile below it, at the same 86px height.
    //
    // The default (`stretch`) is what the mockup has, and it is what §4.2's
    // "compact battery strip" means: full column width, own height. Auto height
    // here is the *absence* of a grow, which the column's own flex does.
    expect(classes).not.toContain('md:self-start')
    expect(classes.some((token) => /^(md:)?(self|justify-self)-/.test(token))).toBe(false)
  })
})

describe('Home — which slots exist', () => {
  it('never invents a section the driver does not declare', () => {
    const { node } = renderHome({ sections: ['noise', 'sound', 'system'] })
    expect(slot(node, 'home-devices')).toBeNull()
    expect(slot(node, 'home-hero')).not.toBeNull()
    expect(slot(node, 'home-battery')).not.toBeNull()
    expect(slot(node, 'home-eq')).not.toBeNull()
  })
})
