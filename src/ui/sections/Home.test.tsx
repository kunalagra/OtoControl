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

import type { ConnectionSummary, EqPresets, EqPreview, QuickSetting } from '@/core/driver'
import type { ActiveDevice } from '@/core/manager'
import type { DeviceSummary } from '@/ui/device/summary'
import { BatteryTile, Home } from './Home'
import { placeTiles } from './homeTiles'

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
  quickSettings?: QuickSetting[]
  eqPresets?: EqPresets | null
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

const active = (options: FakeOptions = {}, state: Partial<FakeState> = {}, label = 'Test Audio'): ActiveDevice => {
  const merged = { ...connectedState, ...state }
  const ids = options.sections ?? ['noise', 'sound', 'devices', 'system']
  const driver: Record<string, unknown> = {
    id: 'test',
    label,
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
  if (options.quickSettings) driver.quickSettings = () => options.quickSettings
  if (options.eqPresets !== undefined) driver.eqPresets = () => options.eqPresets
  return { id: 'test', driver, device: {}, state: merged } as unknown as ActiveDevice
}

const renderHome = (options: FakeOptions = {}, state: Partial<FakeState> = {}, label?: string) => {
  const onNavigate = vi.fn()
  const view = render(<Home active={active(options, state, label)} onNavigate={onNavigate} />)
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

  it('draws each band from the 0 dB line, up for a boost and down for a cut', () => {
    // The Sound page's faders fill from zero, and the preview reads the same
    // way: on ±6 dB, +2.5 is a bar 20.83% of the height rising from the middle,
    // −2 one 16.67% falling from it, and 0 dB a dot on the line — so a Flat
    // curve is a row of dots, not six identical blocks.
    const { node } = renderHome({ eqPreview: () => preview })
    const bars = all(slot(node, 'home-eq')!, 'eq-bar')
    expect(bars[0].dataset.flat).toBe('true')
    expect(bars[2].style.bottom).toBe('50%')
    expect(bars[2].style.height).toBe('20.83%')
    expect(bars[4].style.top).toBe('50%')
    expect(bars[4].style.height).toBe('16.67%')
    expect(slot(node, 'eq-zero')!.style.top).toBe('50%')
    expect(bars.filter((bar) => bar.dataset.peak !== undefined)).toHaveLength(1)
    expect(bars[2].dataset.peak).toBe('true')
    expect(bars[2].className).toContain('bg-signal')
  })

  it('marks no peak on a curve with nothing boosted', () => {
    // Red is "the value you are changing" (DESIGN-GUIDE §1.1). On a flat or
    // all-cut curve nothing is boosted, so nothing wears it — not band 0 by
    // default, and not the smallest cut.
    for (const gains of [[0, 0, 0, 0, 0], [-1, -3, -2, -4, -5]]) {
      const { node } = renderHome({ eqPreview: () => ({ ...preview, gains }) })
      const bars = all(slot(node, 'home-eq')!, 'eq-bar')
      expect(bars.filter((bar) => bar.dataset.peak !== undefined)).toHaveLength(0)
      expect(bars.some((bar) => bar.className.includes('bg-signal'))).toBe(false)
      cleanup()
    }
  })

  it('is absent for a driver with no Sound section to open', () => {
    // A tile that navigates to a section the driver does not declare is a
    // button that does nothing: the shell resolves the unknown id back to Home.
    const { node } = renderHome({ sections: ['noise', 'system'], eqPreview: () => preview })
    expect(slot(node, 'home-eq')).toBeNull()
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

  it('opens Sound from its Open link', () => {
    const { node, onNavigate } = renderHome({ eqPreview: () => preview })
    fireEvent.click(slot(node, 'home-eq-open')!)
    expect(onNavigate).toHaveBeenCalledWith('sound')
  })

  it('opens Sound from the fallback too, so it is never a dead end', () => {
    const { node, onNavigate } = renderHome()
    fireEvent.click(slot(node, 'home-eq-open')!)
    expect(onNavigate).toHaveBeenCalledWith('sound')
  })

  it('applies a preset from its chip, and marks the one playing', () => {
    const select = vi.fn()
    const presets: EqPresets = {
      presets: [
        { id: 'flat', name: 'Flat', active: false },
        { id: 'rock', name: 'Rock', active: true },
      ],
      select,
    }
    const { node, onNavigate } = renderHome({ eqPreview: () => preview, eqPresets: presets })
    const chips = all(slot(node, 'home-eq')!, 'eq-chip')
    expect(chips.map(text)).toEqual(['Flat', 'Rock'])
    expect(chips[1].getAttribute('aria-pressed')).toBe('true')
    expect(chips[0].getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(chips[0])
    expect(select).toHaveBeenCalledWith('flat')
    // A chip applies a preset where it is; it does not leave the page.
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('puts the curve under the preset name and the chips under the curve', () => {
    // Name, then the shape, then the ways to change it — rather than chips at
    // the top, bars at the foot and the tile's spare height between them.
    const presets: EqPresets = { presets: [{ id: 'rock', name: 'Rock', active: true }], select: vi.fn() }
    const { node } = renderHome({ eqPreview: () => preview, eqPresets: presets })
    const tile = slot(node, 'home-eq')!
    const order = Array.from(tile.querySelectorAll('[data-slot="eq-bars"], [data-slot="eq-chip"]')).map((element) =>
      element.getAttribute('data-slot'),
    )
    expect(order).toEqual(['eq-bars', 'eq-chip'])
  })

  it('lets the curve take the leftover when the EQ ends its column, up to a cap', () => {
    // Nothing's shape: battery and EQ in the middle, EQ last. The spare height
    // goes to the curve, not to a gap under the chips — but only so far.
    const { node } = renderHome({ sections: ['noise', 'sound', 'system'], eqPreview: () => preview })
    const bars = slot(node, 'eq-bars')!.className.split(' ')
    expect(bars).toContain('md:flex-1')
    expect(bars).toContain('max-h-[240px]')
  })

  it('keeps the curve a 120px preview when another tile ends the column', () => {
    const { node } = renderHome({ eqPreview: () => preview })
    const bars = slot(node, 'eq-bars')!.className.split(' ')
    expect(bars).toContain('h-[120px]')
    expect(bars).not.toContain('md:flex-1')
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

  it('lets the product render fill the hero, in colour', () => {
    // The one place colour belongs (DESIGN-GUIDE §1.1), so no greyscale filter.
    // And no fixed cap: the hero is the tallest tile on the page, and a render
    // held to 320x260 in the middle of it read as a thumbnail.
    const { node } = renderHome()
    const image = slot(node, 'home-hero')!.querySelector('img')!
    expect(image.getAttribute('src')).toBe(ARTWORK.hero)
    expect(image.className).toContain('object-contain')
    expect(image.className).not.toContain('grayscale')
    const frame = image.parentElement!
    expect(frame.className).not.toContain('max-h-[260px]')
    expect(frame.className).not.toContain('max-w-[320px]')
    expect(frame.className).toContain('max-h-full')
  })

  it('carries no fact chips: the facts live on the system tile', () => {
    const { node } = renderHome({ codec: 'AAC' })
    expect(all(slot(node, 'home-hero')!, 'hero-chip')).toHaveLength(0)
  })

  it('names the brand without the protocol the driver label carries', () => {
    // "Sony (MDR)" is a driver's name for itself; the caption is the brand.
    const { node } = renderHome({}, {}, 'Sony (MDR)')
    const caption = text(slot(node, 'home-hero'))
    expect(caption).toContain('Sony')
    expect(caption).not.toContain('MDR')
  })
})

describe('Home — the system tile', () => {
  /** Each row as "label value". */
  const rowsOf = (node: HTMLElement) =>
    all(slot(node, 'home-system')!, 'system-row').map(
      (row) =>
        `${text(row.querySelector('[data-slot="system-row-label"]'))} ${text(row.querySelector('[data-slot="system-row-value"]'))}`,
    )

  it('lists the facts the device reported, and only those', () => {
    const { node } = renderHome(
      {
        codec: 'AAC',
        connections: () => [
          { name: 'A', connected: true, isThisDevice: false },
          { name: 'B', connected: false, isThisDevice: false },
        ],
      },
      { info: { model: 'Test Buds', firmware: '2.12.4', serial: null, codec: 1 } },
    )
    expect(rowsOf(node)).toEqual(['Model Test Buds', 'Firmware 2.12.4', 'Codec AAC', 'Links 1/2'])
  })

  it('drops a fact rather than showing an empty row', () => {
    const { node } = renderHome({}, { info: { model: 'Test Buds', firmware: null, serial: null, codec: null } })
    expect(rowsOf(node)).toEqual(['Model Test Buds'])
  })

  it('opens System from its Open link', () => {
    const { node, onNavigate } = renderHome()
    fireEvent.click(slot(node, 'home-system-open')!)
    expect(onNavigate).toHaveBeenCalledWith('system')
  })

  it('shows the first four quick settings, and a switch writes through the driver', () => {
    const set = vi.fn()
    const toggle = (id: string, value: boolean | null): QuickSetting => ({
      kind: 'toggle',
      id,
      label: `Setting ${id}`,
      value,
      set: id === 'a' ? set : vi.fn(),
    })
    const { node } = renderHome({
      quickSettings: [toggle('a', false), toggle('b', true), toggle('c', null), toggle('d', true), toggle('e', true)],
    })
    const rows = all(slot(node, 'home-system')!, 'quick-setting')
    expect(rows.map((row) => text(row.querySelector('[data-slot="quick-setting-label"]')))).toEqual([
      'Setting a',
      'Setting b',
      'Setting c',
      'Setting d',
    ])
    fireEvent.click(rows[0].querySelector('[role="switch"]')!)
    expect(set).toHaveBeenCalledWith(true)
    // Not reported: the control is there, but claims no position.
    expect(rows[2].querySelector('[role="switch"]')!.hasAttribute('data-disabled')).toBe(true)
  })

  it('draws a choice as a row of segments and writes the one tapped', () => {
    const set = vi.fn()
    const { node } = renderHome({
      quickSettings: [
        {
          kind: 'choice',
          id: 'power',
          label: 'Auto power-off',
          value: '900',
          options: [
            { value: '0', label: 'Never' },
            { value: '900', label: '15 min' },
          ],
          set,
        },
      ],
    })
    const segments = Array.from(slot(node, 'quick-setting')!.querySelectorAll('button'))
    expect(segments.map((segment) => segment.getAttribute('aria-pressed'))).toEqual(['false', 'true'])
    fireEvent.click(segments[0])
    expect(set).toHaveBeenCalledWith('0')
  })

  it('keeps the facts as a footer under the settings', () => {
    const { node } = renderHome({
      quickSettings: [{ kind: 'toggle', id: 'a', label: 'A', value: true, set: vi.fn() }],
    })
    const tile = slot(node, 'home-system')!
    const order = Array.from(tile.querySelectorAll('[data-slot="quick-setting"], [data-slot="system-row"]')).map(
      (element) => element.getAttribute('data-slot'),
    )
    expect(order[0]).toBe('quick-setting')
    expect(order.at(-1)).toBe('system-row')
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
    for (const name of ['home-battery', 'home-eq', 'home-noise', 'home-devices', 'home-system']) {
      const classes = slot(node, name)!.className
      expect(classes).not.toMatch(/row-start|row-span|col-start|col-span/)
    }
  })

  it('reads in priority order on a phone, whatever the column wrappers say', () => {
    // The wrappers are `display: contents` on a phone, so without an explicit
    // `order` the phone would read in column order rather than priority order.
    const { node } = renderHome()
    const order = (name: string) => slot(node, name)!.className.split(' ')
    expect(order('home-hero')).toContain('order-1')
    expect(order('home-battery')).toContain('order-2')
    expect(order('home-noise')).toContain('order-3')
    expect(order('home-eq')).toContain('order-4')
    expect(order('home-devices')).toContain('order-5')
    expect(order('home-system')).toContain('order-6')
    for (const name of ['home-battery', 'home-noise', 'home-eq', 'home-devices', 'home-system']) {
      expect(order(name)).toContain('md:order-none')
    }
  })

  it('ends every column on the hero’s line: the last tile takes the leftover, the rest stay content-height', () => {
    // Columns that stop at their content end at three different heights beside
    // a full-height hero. The leftover is small once a small set is one stack,
    // so the last tile absorbs it rather than the page showing ragged ends.
    const { node } = renderHome()
    for (const name of ['home-col-middle', 'home-col-right']) {
      const tiles = Array.from(slot(node, name)!.children) as HTMLElement[]
      tiles.forEach((tile, index) => {
        expect(tile.className.split(' ').includes('md:flex-1')).toBe(index === tiles.length - 1)
      })
    }
  })

  it('stacks a small set in one column and gives the hero the rest of the width', () => {
    // The WF-C500 shape: battery, EQ and System. Spread over two columns each
    // tile was a tall, mostly empty box; stacked, they are one column of
    // content beside a wider render.
    const { node } = renderHome({ sections: ['sound', 'system'] })
    expect(slot(node, 'home-col-right')).toBeNull()
    expect(Array.from(slot(node, 'home-col-middle')!.children).map((child) => child.getAttribute('data-slot'))).toEqual([
      'home-battery',
      'home-eq',
      'home-system',
    ])
    expect(node.className).toContain('bento:grid-cols-[1.35fr_1fr]')
    expect(slot(node, 'home-col-middle')!.className).toContain('md:col-span-2')
  })
})

describe('placeTiles', () => {
  it('balances a full set across the two columns, in priority order within each', () => {
    expect(placeTiles(['battery', 'noise', 'eq', 'devices', 'system'])).toEqual({
      middle: ['battery', 'eq', 'system'],
      right: ['noise', 'devices'],
    })
  })

  it('keeps the battery strip at the top of the middle column', () => {
    for (const ids of [
      ['battery', 'noise', 'eq', 'system'],
      ['battery', 'eq', 'system'],
      ['battery', 'system'],
    ] as const) {
      expect(placeTiles([...ids]).middle[0]).toBe('battery')
    }
  })

  it('keeps a small set in one stack, and splits only a set too tall for one', () => {
    for (const ids of [
      ['battery', 'system'],
      ['battery', 'eq', 'system'],
      ['battery', 'noise', 'system'],
    ] as const) {
      expect(placeTiles([...ids]).right).toEqual([])
    }
    const nothing = placeTiles(['battery', 'noise', 'eq', 'system'])
    expect(nothing.middle.length).toBeGreaterThan(0)
    expect(nothing.right.length).toBeGreaterThan(0)
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
    for (const name of ['home-battery', 'home-noise', 'home-eq', 'home-devices', 'home-system']) {
      expect(slot(node, name)!.className).toContain('opacity-50')
      expect(slot(node, name)!.className).toContain('pointer-events-none')
    }
    expect(slot(node, 'home-hero')!.className).not.toContain('opacity-50')
    expect(slot(node, 'home-hero')!.className).not.toContain('pointer-events-none')
  })

  it('keeps each tile’s Open link clickable while dimmed: opening a tab is harmless offline', () => {
    const { node, onNavigate } = renderHome({}, idle)
    for (const name of ['home-eq-open', 'home-system-open']) {
      expect(slot(node, name)!.className.split(' ')).toContain('pointer-events-auto')
    }
    fireEvent.click(slot(node, 'home-system-open')!)
    expect(onNavigate).toHaveBeenCalledWith('system')
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

  it('gives the rows the whole strip when there is no single number to show', () => {
    // Two cells means no headline number, and the half of the strip that holds
    // it was left in place, empty — pushing L and R to the right.
    const { container } = render(
      <BatteryTile
        summary={summary({
          cells: [
            { label: 'L', level: 100, charging: false },
            { label: 'R', level: 100, charging: false },
          ],
        })}
        connected
      />,
    )
    const lead = container.querySelector('[data-slot="battery-lead"]')!.className.split(' ')
    expect(lead).toContain('md:hidden')
    expect(lead).not.toContain('md:flex-1')
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
