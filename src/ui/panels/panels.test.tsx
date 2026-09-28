import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'

import { Button } from '@/components/ui/button'
import { CardTitle } from '@/components/ui/card'
import { Select, SelectItem, SelectTrigger } from '@/components/ui/select'
import { SettingRow, ToggleRow } from '../controls/SettingRow'
import { Fader } from '../controls/Fader'
import { AutoPowerOffPanel } from './AutoPowerOffPanel'
import { DeviceInfoPanel } from './DeviceInfoPanel'
import { EqualizerPanel } from './EqualizerPanel'
import type { EqPresetOption, EqualizerPanelProps } from './EqualizerPanel'
import { TogglesPanel } from './TogglesPanel'
import { elements, ofType, text } from './tree.test-helper'

describe('DeviceInfoPanel', () => {
  it('renders each row as a label/value pair', () => {
    // Merely finding each label and value *somewhere* in the flattened text
    // would pass even if every label rendered before every value. Instead,
    // walk each row's own subtree (the <div> wrapping a <dt>/<dd> pair) and
    // require the label and value to be siblings there, in that order —
    // pinning the actual pairing rather than mere co-occurrence.
    const rows = [
      { label: 'Model', value: 'MOMENTUM 4' },
      { label: 'Firmware', value: '1.2.3' },
    ]
    const tree = DeviceInfoPanel({ rows })

    const rowDivs = elements(tree).filter((element) => element.type === 'div')
    expect(rowDivs).toHaveLength(rows.length)

    rowDivs.forEach((rowDiv, index) => {
      const [, dt, dd] = elements(rowDiv)
      expect(dt?.type).toBe('dt')
      expect(dd?.type).toBe('dd')
      expect(text(dt)).toBe(rows[index]?.label)
      expect(text(dd)).toBe(rows[index]?.value)
    })
  })

  it('defaults the title to Device and overrides it when asked', () => {
    // `toContain('Device')` would pass even if the default became 'Devicez',
    // since the substring still matches. Assert the CardTitle's own children
    // exactly instead of scanning the flattened text for a substring.
    const [defaultTitle] = ofType(DeviceInfoPanel({ rows: [] }), CardTitle)
    expect((defaultTitle.props as { children: string }).children).toBe('Device')

    const [customTitle] = ofType(DeviceInfoPanel({ title: 'Headphones', rows: [] }), CardTitle)
    expect((customTitle.props as { children: string }).children).toBe('Headphones')
  })

  it('renders a footnote only when given one', () => {
    // `not.toContain('unmapped colour')` pins nothing about the *absence* of
    // a footnote wrapper — it would stay green even if an empty `<p>` were
    // rendered unconditionally. Pin the wrapper's absence directly, the way
    // EqualizerPanel's preset-row test does.
    const paras = elements(DeviceInfoPanel({ rows: [] })).filter((element) => element.type === 'p')
    expect(paras).toHaveLength(0)

    expect(
      text(DeviceInfoPanel({ rows: [], footnote: 'unmapped colour' })),
    ).toContain('unmapped colour')
  })
})

// Carried forward from Task 2's review: AutoPowerOffPanel landed with no
// render test of its own, verified only by manual diff inspection.
describe('AutoPowerOffPanel', () => {
  const baseProps = {
    options: [
      { value: 300, label: '5 minutes' },
      { value: 900, label: '15 minutes' },
    ],
    hint: 'When idle and not worn.',
    disabled: false,
    onChange: () => {},
  }

  it('wraps the select in a SettingRow labelled "Auto power off" with the driver hint', () => {
    const tree = AutoPowerOffPanel({ ...baseProps, value: 300 })
    expect(tree.type).toBe(SettingRow)
    expect((tree.props as { label: string }).label).toBe('Auto power off')
    expect((tree.props as { hint: string }).hint).toBe('When idle and not worn.')
  })

  it('disables the select when the caller disables it, even with a reported value', () => {
    const tree = AutoPowerOffPanel({ ...baseProps, value: 300, disabled: true })
    const selects = ofType(tree, Select)
    expect(selects).toHaveLength(1)
    expect((selects[0].props as { disabled: boolean }).disabled).toBe(true)
  })

  it('disables the select when the value is null, even though the caller does not disable it', () => {
    const tree = AutoPowerOffPanel({ ...baseProps, value: null, disabled: false })
    const selects = ofType(tree, Select)
    expect(selects).toHaveLength(1)
    expect((selects[0].props as { disabled: boolean }).disabled).toBe(true)
  })

  it('leaves the select enabled when neither the caller nor a null value disables it', () => {
    const tree = AutoPowerOffPanel({ ...baseProps, value: 300, disabled: false })
    const selects = ofType(tree, Select)
    expect(selects).toHaveLength(1)
    expect((selects[0].props as { disabled: boolean }).disabled).toBe(false)
  })

  it('defaults the trigger width to w-40 and lets the caller override it', () => {
    const defaultTree = AutoPowerOffPanel({ ...baseProps, value: 300 })
    const defaultTriggers = ofType(defaultTree, SelectTrigger)
    expect(defaultTriggers).toHaveLength(1)
    expect((defaultTriggers[0].props as { className: string }).className).toBe('w-40')

    const widerTree = AutoPowerOffPanel({ ...baseProps, value: 300, triggerClassName: 'w-44' })
    const widerTriggers = ofType(widerTree, SelectTrigger)
    expect(widerTriggers).toHaveLength(1)
    expect((widerTriggers[0].props as { className: string }).className).toBe('w-44')
  })

  it('renders one SelectItem per option, each labelled', () => {
    const tree = AutoPowerOffPanel({ ...baseProps, value: 300 })
    expect(ofType(tree, SelectItem)).toHaveLength(2)
    expect(text(tree)).toContain('5 minutes')
    expect(text(tree)).toContain('15 minutes')
  })

  it('gives each SelectItem the raw seconds value as its own value prop', () => {
    const tree = AutoPowerOffPanel({ ...baseProps, value: 300 })
    const items = ofType(tree, SelectItem)
    expect(items.map((item) => (item.props as { value: string }).value)).toEqual(['300', '900'])
  })

  it('builds the select items from the options, keyed by the seconds value', () => {
    const tree = AutoPowerOffPanel({ ...baseProps, value: 300 })
    const selects = ofType(tree, Select)
    expect((selects[0].props as { items: unknown }).items).toEqual([
      { value: '300', label: '5 minutes' },
      { value: '900', label: '15 minutes' },
    ])
  })

  it('passes the reported value to the select as its string form', () => {
    const tree = AutoPowerOffPanel({ ...baseProps, value: 300 })
    const selects = ofType(tree, Select)
    expect((selects[0].props as { value: string | undefined }).value).toBe('300')
  })

  it('passes undefined to the select when the value is unreported, never the string "null"', () => {
    const tree = AutoPowerOffPanel({ ...baseProps, value: null })
    const selects = ofType(tree, Select)
    expect((selects[0].props as { value: string | undefined }).value).toBeUndefined()
  })

  it('converts the select value string back to a number before writing it', () => {
    // This is the panel's one write path: a wrong or dropped conversion here
    // means the UI writes the wrong timeout — or always the same one — to
    // the headphones, silently.
    const written: number[] = []
    const tree = AutoPowerOffPanel({ ...baseProps, value: 300, onChange: (v) => written.push(v) })
    const selects = ofType(tree, Select)
    ;(selects[0].props as { onValueChange(next: string): void }).onValueChange('900')
    expect(written).toEqual([900])
    expect(typeof written[0]).toBe('number')
  })
})

describe('TogglesPanel', () => {
  it('renders nothing when there are no toggles', () => {
    expect(TogglesPanel({ toggles: [], disabled: false })).toBeNull()
  })

  it('renders a row per toggle and passes the change handler through', () => {
    const changed: Array<[string, boolean]> = []
    const tree = TogglesPanel({
      disabled: false,
      toggles: [
        {
          key: 'anc',
          label: 'Noise cancelling',
          value: false,
          onChange: (v) => changed.push(['anc', v]),
        },
        { key: 'dsee', label: 'DSEE', value: true, onChange: (v) => changed.push(['dsee', v]) },
      ],
    })

    const rows = ofType(tree, ToggleRow)
    expect(rows).toHaveLength(2)
    // `text()` only sees literal string children; ToggleRow's `label` is a
    // prop it renders internally on invocation, which the tree helpers never
    // do (see SystemTail.test.tsx's `child.type === About` precedent). So the
    // label is asserted on the row's own props, not via `text(tree)`.
    expect((rows[0].props as { label: string }).label).toBe('Noise cancelling')
    ;(rows[0].props as { onChange(value: boolean): void }).onChange(true)
    expect(changed).toEqual([['anc', true]])
  })

  it('disables every row when the panel is disabled', () => {
    const tree = TogglesPanel({
      disabled: true,
      toggles: [{ key: 'a', label: 'A', value: true, onChange: () => {} }],
    })
    expect((ofType(tree, ToggleRow)[0].props as { disabled: boolean }).disabled).toBe(true)
  })

  it('disables only the row that asks for it', () => {
    const tree = TogglesPanel({
      disabled: false,
      toggles: [
        { key: 'a', label: 'A', value: true, onChange: () => {} },
        { key: 'b', label: 'B', value: null, disabled: true, onChange: () => {} },
      ],
    })
    const rows = ofType(tree, ToggleRow)
    expect((rows[0].props as { disabled: boolean }).disabled).toBe(false)
    expect((rows[1].props as { disabled: boolean }).disabled).toBe(true)
  })

  it('passes the hint through and reports an unreported toggle as null, never as false', () => {
    // ToggleRow keys both the "Not reported by this firmware." substitution
    // and its own disabled state off `value === null`. Collapsing null (and
    // undefined) to false here would silently turn "not reported" into "off"
    // — in the very field this phase's one accepted output change lives in.
    const tree = TogglesPanel({
      disabled: false,
      toggles: [
        { key: 'a', label: 'A', hint: 'A hint', value: true, onChange: () => {} },
        { key: 'b', label: 'B', value: null, onChange: () => {} },
        { key: 'c', label: 'C', value: undefined, onChange: () => {} },
      ],
    })
    const rows = ofType(tree, ToggleRow)
    expect((rows[0].props as { hint: string }).hint).toBe('A hint')
    expect((rows[1].props as { value: boolean | null }).value).toBeNull()
    expect((rows[2].props as { value: boolean | null }).value).toBeNull()
  })
})

const BASE: EqualizerPanelProps = {
  presets: [],
  bands: [],
  range: { min: -10, max: 10 },
  disabled: false,
  unavailable: null,
  footer: '',
  onPresetSelect: () => {},
  onBandCommit: () => {},
}

/**
 * The preset controls are plain buttons in both layouts, so they are found by
 * host element rather than by component. The phone chips and the desktop rows
 * are the same list rendered twice — one is `lg:hidden`, the other `hidden` —
 * so a test can assert against either without knowing which one a given
 * viewport would show.
 */
const buttons = (tree: ReactNode) => elements(tree).filter((el) => el.type === 'button')

const slot = (tree: ReactNode, name: string) =>
  elements(tree).find((el) => (el.props as { 'data-slot'?: string })['data-slot'] === name)

const classesOf = (tree: ReactNode, name: string): string[] => {
  const found = slot(tree, name) as { props?: { className?: string } } | undefined
  return found?.props?.className?.split(' ') ?? []
}

const FLAT_AND_ROCK: EqPresetOption[] = [
  { id: 'flat', name: 'Flat', active: false, gains: [0, 0, 0, 0, 0] },
  { id: 'rock', name: 'Rock', active: true, gains: [0, 2, 2.5, 1.5, -2] },
]

describe('EqualizerPanel', () => {
  it('shows the unavailable message instead of controls', () => {
    const tree = EqualizerPanel({
      ...BASE,
      unavailable: 'Connect to load the equaliser.',
      presets: [{ id: 'flat', name: 'Flat', active: true }],
    })
    expect(text(tree)).toContain('Connect to load the equaliser.')
    expect(ofType(tree, Fader)).toHaveLength(0)
    // The Reset pill is a header control, not an equaliser control, but it
    // cannot select a curve the device has not reported — so it goes too.
    expect(ofType(tree, Button)).toHaveLength(0)
  })

  it('reports the selected preset by id, from either layout', () => {
    const picked: string[] = []
    const tree = EqualizerPanel({
      ...BASE,
      presets: FLAT_AND_ROCK,
      onPresetSelect: (id) => picked.push(id),
    })

    // Two layouts, so every choice is offered twice: a phone chip and a row.
    const all = buttons(tree)
    expect(all).toHaveLength(4)
    const flatChips = all.filter((el) => text(el).startsWith('Flat'))
    expect(flatChips).toHaveLength(2)
    for (const el of flatChips) (el.props as { onClick(): void }).onClick()
    expect(picked).toEqual(['flat', 'flat'])
  })

  it('marks only the active preset as pressed, and inverts it', () => {
    const tree = EqualizerPanel({ ...BASE, presets: FLAT_AND_ROCK })
    const pressed = buttons(tree).map(
      (el) => (el.props as { 'aria-pressed': boolean })['aria-pressed'],
    )
    expect(pressed).toEqual([false, true, false, true])

    const activeRow = buttons(tree).filter(
      (el) => (el.props as { 'aria-pressed': boolean })['aria-pressed'],
    )[0]
    const classes = (activeRow.props as { className: string }).className
    expect(classes).toContain('bg-foreground')
    expect(classes).toContain('text-background')

    const idleRow = buttons(tree)[0]
    expect((idleRow.props as { className: string }).className).not.toContain('bg-foreground')
  })

  it('renders the preset name, not its opaque id', () => {
    const tree = EqualizerPanel({
      ...BASE,
      presets: [{ id: 'preset-flat-id', name: 'Flat', active: true }],
    })
    expect(buttons(tree).map((el) => text(el))).toEqual(['Flat', 'Flat'])
  })

  it('omits both preset layouts entirely when there are no presets', () => {
    const tree = EqualizerPanel({ ...BASE, footer: '6 bands' })
    expect(buttons(tree)).toHaveLength(0)
    expect(slot(tree, 'eq-chips')).toBeUndefined()
    expect(slot(tree, 'eq-preset-list')).toBeUndefined()
    // Zero buttons is also true with presets present but none active, or if the
    // preset wrapper rendered empty — so pin the wrappers themselves being
    // absent, not just their (necessarily empty) contents.
    expect(text(tree)).toContain('6 bands')
  })

  it('previews a preset as five bars, with the active row\'s peak bar in red', () => {
    const tree = EqualizerPanel({ ...BASE, presets: FLAT_AND_ROCK })
    // Two previews, five bars each. The bars are 4px spans, which is the only
    // class they carry; what else is on one is the colour under test.
    const bars = elements(tree).filter(
      (el) => el.type === 'span' && (el.props as { className?: string }).className?.includes('w-1'),
    )
    expect(bars).toHaveLength(10)

    const heights = bars.map((el) => (el.props as { style: { height: string } }).style.height)
    // Rock's own peak is 2.5 dB of a 10 dB range: the tallest bar, and the one
    // that goes red on the inverted row. Its neighbours stay in the row colour.
    const peak = heights.indexOf('25%')
    expect(peak).toBe(7)
    expect((bars[peak].props as { className: string }).className).toContain('bg-signal')
    // The rest of the inverted row's bars take the row's own colour.
    expect((bars[6].props as { className: string }).className).toContain('bg-background')
    // Flat's bars are stubs, not nothing: a zero-height bar reads as broken.
    expect(heights[5]).toBe('15%')
  })

  it('omits the preview for a driver that supplies no per-preset gains', () => {
    const tree = EqualizerPanel({
      ...BASE,
      presets: [{ id: 'off', name: 'Off', active: true }],
    })
    expect(
      elements(tree).filter(
        (el) => (el.props as { className?: string }).className?.includes('w-1'),
      ),
    ).toHaveLength(0)
  })

  it('draws the desk at phone height, and taller from 1024px', () => {
    const classes = classesOf(EqualizerPanel({ ...BASE, bands: [{ value: 1, label: 'a', caption: 'a' }] }), 'eq-desk')
    expect(classes).toContain('min-h-[220px]')
    expect(classes).toContain('lg:min-h-[240px]')
    // The desk sits under the hand, so its texture steps back (DESIGN-GUIDE §3).
    expect(classes).toContain('mono-dots-fader')
  })

  it('fills the height it is given from 1024px, rather than sitting at its floor', () => {
    // Spec §7.3: "220px on the phone Sound tab, filling the desk on desktop
    // (minimum 240px)". The minimum is the *floor*, not the height — and a desk
    // pinned to 240px at the bottom of a 700px screen is the floor winning.
    //
    // Three links in one chain, and each is load-bearing: the panel asks to grow
    // (`lg:flex-1`), it is allowed to shrink below its content (`lg:min-h-0`),
    // and the row the desk sits in takes the height that growth produced
    // (`lg:auto-rows-fr`, with `lg:flex-1` on the grid itself). All three are
    // asserted because dropping any one of them leaves the desk at 240px with no
    // visible error anywhere.
    const tree = EqualizerPanel({ ...BASE, presets: FLAT_AND_ROCK, bands: [{ value: 1, label: 'a', caption: 'a' }] })
    const root = elements(tree)[0] as { props: { className: string } }
    expect(root.props.className).toContain('lg:flex-1')
    expect(root.props.className).toContain('lg:min-h-0')
    const row = elements(tree).find((el) => {
      const className = (el.props as { className?: string }).className ?? ''
      return className.split(' ').includes('lg:auto-rows-fr')
    })
    expect(row).toBeDefined()
    expect((row?.props as { className: string } | undefined)?.className).toContain('lg:flex-1')
  })

  it('makes a preset chip a 44px target on a phone, and a list row on a desktop', () => {
    // Spec §8 names the chips. The guide's own `py-2` + 11px label is 31px, and
    // hit slop cannot make up the difference in a 4-column grid with 6px gutters
    // (3px of neighbour per edge), so the chip itself is the floor — and only on
    // the phone, where the chip grid is the layout at all.
    const chip = buttons(EqualizerPanel({ ...BASE, presets: FLAT_AND_ROCK }))[0] as {
      props: { className: string }
    }
    expect(chip.props.className).toContain('min-h-11')
    expect(chip.props.className).toContain('lg:min-h-0')
  })

  it('puts the preset list in a 260px column beside the desk from 1024px', () => {
    const tree = EqualizerPanel({ ...BASE, presets: FLAT_AND_ROCK })
    const grid = elements(tree).find((el) => {
      const className = (el.props as { className?: string }).className ?? ''
      return className.split(' ').includes('lg:grid-cols-[260px_1fr]')
    })
    expect(grid).toBeDefined()
    // The phone chips step aside for it, rather than both showing at once.
    expect(classesOf(tree, 'eq-chips')).toContain('lg:hidden')
    expect(classesOf(tree, 'eq-preset-list')).toContain('lg:flex')
  })

  it('names the current preset in section display, and says Custom when none matches', () => {
    expect(text(EqualizerPanel({ ...BASE, presets: FLAT_AND_ROCK }))).toContain('Rock')
    // A hand-edited curve belongs to no preset, and saying so beats naming one
    // that is not playing.
    expect(
      text(
        EqualizerPanel({
          ...BASE,
          presets: [{ id: 'rock', name: 'Rock', active: false }],
        }),
      ),
    ).toContain('Custom')
  })

  it('offers Reset to Flat only when the driver has a Flat preset, and selects it', () => {
    const picked: string[] = []
    const withFlat = EqualizerPanel({
      ...BASE,
      presets: FLAT_AND_ROCK,
      onPresetSelect: (id) => picked.push(id),
    })
    const pill = ofType(withFlat, Button)[0]
    expect(text(pill)).toBe('Reset to Flat')
    ;(pill.props as { onClick(): void }).onClick()
    expect(picked).toEqual(['flat'])

    // Sony names its flat preset "Off", and there is nothing to reset to.
    const withoutFlat = EqualizerPanel({
      ...BASE,
      presets: [{ id: 'off', name: 'Off', active: true }],
    })
    expect(ofType(withoutFlat, Button)).toHaveLength(0)
  })

  it('disables the reset pill along with everything else', () => {
    const tree = EqualizerPanel({ ...BASE, presets: FLAT_AND_ROCK, disabled: true })
    expect((ofType(tree, Button)[0].props as { disabled: boolean }).disabled).toBe(true)
  })

  it('renders one fader per band, captioned, and reports the band index on commit', () => {
    const commits: Array<[number, number]> = []
    const tree = EqualizerPanel({
      ...BASE,
      bands: [
        { value: 3, label: '100 Hz gain', caption: '100' },
        { value: -2, label: '1 kHz gain', caption: '1k' },
      ],
      onBandCommit: (index, value) => commits.push([index, value]),
    })

    const faders = ofType(tree, Fader)
    expect(faders.map((f) => (f.props as { caption: string }).caption)).toEqual(['100', '1k'])
    ;(faders[1].props as { onCommit(value: number): void }).onCommit(5)
    expect(commits).toEqual([[1, 5]])
    // The panel hands the fader a commit hook and no per-tick one: a device
    // write from every tick of a drag is the bug this whole panel is built
    // around, and a live-preview prop is an invitation to reintroduce it.
    expect((faders[0].props as { onChange?: unknown }).onChange).toBeUndefined()
  })

  it("passes each band's value, range and label straight through to its fader", () => {
    const tree = EqualizerPanel({
      ...BASE,
      range: { min: -12, max: 12 },
      bands: [{ value: 3, label: '100 Hz gain', caption: '100' }],
    })
    const faders = ofType(tree, Fader)
    expect(faders).toHaveLength(1)
    const props = faders[0].props as {
      value: number
      range: { min: number; max: number }
      label: string
    }
    expect(props.value).toBe(3)
    expect(props.range).toEqual({ min: -12, max: 12 })
    expect(props.label).toBe('100 Hz gain')
  })

  it('disables every preset control and fader when the panel is disabled, and neither when it is not', () => {
    const disabledTree = EqualizerPanel({
      ...BASE,
      disabled: true,
      presets: FLAT_AND_ROCK,
      bands: [{ value: 3, label: '100 Hz gain', caption: '100' }],
    })
    for (const el of buttons(disabledTree)) {
      expect((el.props as { disabled: boolean }).disabled).toBe(true)
    }
    expect((ofType(disabledTree, Fader)[0].props as { disabled: boolean }).disabled).toBe(true)

    const enabledTree = EqualizerPanel({
      ...BASE,
      disabled: false,
      presets: FLAT_AND_ROCK,
      bands: [{ value: 3, label: '100 Hz gain', caption: '100' }],
    })
    for (const el of buttons(enabledTree)) {
      expect((el.props as { disabled: boolean }).disabled).toBe(false)
    }
    expect((ofType(enabledTree, Fader)[0].props as { disabled: boolean }).disabled).toBe(false)
  })

  it('passes the given step to the fader, and lets the fader default it to 0.5 when omitted (as Sennheiser does)', () => {
    // Two things have to hold: EqualizerPanel must forward `step` (or omit
    // it) to the Fader element, *and* Fader's own default must still be 0.5.
    // Checking only the element's prop would miss a change to Fader's
    // default; checking only Fader's rendered output would miss the panel
    // dropping the prop. So check both — the second by actually rendering
    // Fader with the exact props the panel produced. Fader calls `useId()`
    // and `useState`, so it cannot be invoked as a plain function the way the
    // top-level panels are; `renderToStaticMarkup` (SSR, no DOM) runs it for
    // real.
    const withStep = EqualizerPanel({
      ...BASE,
      step: 1,
      bands: [{ value: 3, label: '100 Hz gain', caption: '100' }],
    })
    const withStepFaderEl = ofType(withStep, Fader)[0]
    expect((withStepFaderEl.props as { step?: number }).step).toBe(1)
    const withStepHtml = renderToStaticMarkup(
      <Fader {...(withStepFaderEl.props as Parameters<typeof Fader>[0])} />,
    )
    expect(withStepHtml).toContain('step="1"')

    const withoutStep = EqualizerPanel({
      ...BASE,
      bands: [{ value: 3, label: '100 Hz gain', caption: '100' }],
    })
    const withoutStepFaderEl = ofType(withoutStep, Fader)[0]
    expect((withoutStepFaderEl.props as { step?: number }).step).toBeUndefined()
    const withoutStepHtml = renderToStaticMarkup(
      <Fader {...(withoutStepFaderEl.props as Parameters<typeof Fader>[0])} />,
    )
    expect(withoutStepHtml).toContain('step="0.5"')
  })
})
