/**
 * One "selected" look, everywhere — DESIGN-GUIDE §1.1, §1.2, §5.3.
 *
 * This is the rule that no single component can hold. Fourteen open-coded
 * `<button>`s across nine driver sections each wrote their own pair of class
 * strings, and the ones a *driver* owns had never been through the primitives
 * restyle, because `mono.test.tsx` renders the primitives and the restyle
 * reached the app through them. What shipped was two selected looks side by side
 * on the same kind of control: the pre-Mono `border-primary bg-primary/10` — a
 * red outline over a 10% wash — on a driver's noise mode, and the Mono
 * `bg-signal text-black font-bold` on a Soundcore one.
 *
 * A test that renders one component cannot see this, because the defect is a
 * *disagreement between* components, and the disagreement is invisible in each
 * of them. So the rule is asserted over the tree, the way `a11y.test.ts`
 * asserts the focus ring, plus a render of two real driver sections so the
 * assertion is about what a user would see and not only about the absence of a
 * string.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import type { ComponentType, ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { NOTHING_DRIVER } from '@/core/driver'
import type { ActiveDevice } from '@/core/manager'
import { SONY_DRIVER } from '@/core/driver'
import { initialNothingState } from '@/drivers/nothing/device'
import type { NothingState } from '@/drivers/nothing/device'
import { initialSonyState, type SonyState } from '@/drivers/sony/sony'
import { SonyFunction } from '@/drivers/sony/mdr/commands'
import { componentFor } from '@/ui/sections/registry'

const SRC = resolve(process.cwd(), 'src')

/** Every non-test source file, by path relative to the project root. */
const files = (dir = SRC): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return files(path)
    if (extname(path) !== '.tsx' && extname(path) !== '.ts') return []
    // This file asserts about sources; its own needles would read as hits.
    if (/\.test(-helper)?\.tsx?$/.test(path)) return []
    return [path]
  })

const read = (path: string) => readFileSync(path, 'utf8')
const name = (path: string) => relative(process.cwd(), path)

/** The files whose contents match `needle`, by name. */
const withNeedle = (needle: string): string[] =>
  files().filter((path) => read(path).includes(needle)).map(name)

describe('the pre-Mono selected look (DESIGN-GUIDE 1.1, 1.2, 5.3)', () => {
  it('appears in no file, so no driver can open-code it again', () => {
    // Both needles are the *selected* markers and neither has a legitimate use
    // in this design system:
    //
    // - `bg-primary/10` is a 10% red wash. Red is a fill (a selected segment) or
    //   a mark (a live dot, the EQ preview's peak band); a 10% wash is neither,
    //   and §1.1's own test — "if two things on screen are red, one of them is
    //   probably wrong" — is aimed squarely at it.
    // - `border-primary` is a red outline on a control. §1.2 retires outlines
    //   as grouping, and a selected block is a *fill* here.
    //
    // The one file allowed to contain the strings is the component that
    // replaced them, which quotes them to say what it replaced. Naming it keeps
    // the exception visible rather than making the needle untypeable.
    expect(withNeedle('bg-primary/10')).toEqual(['src/ui/controls/SegmentButton.tsx'])
    expect(withNeedle('border-primary')).toEqual(['src/ui/controls/SegmentButton.tsx'])
  })

  it('is not what a driver section paints as its selected option either', () => {
    // The same two needles, this time over the *markup* rather than the source,
    // for the sections that carry the most of them. A scan cannot tell a class
    // in a comment from a class on an element; this can.
    for (const markup of renderings()) {
      expect(markup).not.toContain('bg-primary/10')
      expect(markup).not.toContain('border-primary')
    }
  })
})

/** A device that answers no-op to everything, cast through `never`. */
const device = new Proxy({}, { get: () => () => undefined }) as never

const section = (
  driver: typeof SONY_DRIVER | typeof NOTHING_DRIVER,
  id: string,
  state: unknown,
): ReactElement => {
  const active = { id: driver.id, driver, device, state } as ActiveDevice
  const Component = componentFor(active, id) as unknown as ComponentType<Record<string, unknown>>
  if (!Component) throw new Error(`no component for ${driver.id} section "${id}"`)
  return <Component device={device} state={state} onNavigate={() => undefined} />
}

/** Two real driver sections, in the two shapes the option buttons come in. */
const renderings = (): string[] => {
  // Sony's connection-quality cards: a 2-up grid of label + hint.
  const sonySound: SonyState = {
    ...initialSonyState,
    status: 'connected',
    info: { ...initialSonyState.info, model: 'WH-1000XM5' },
    connectionMode: 0,
    capabilities: new Set([SonyFunction.ConnectionQualityMode]),
  }
  // Sony's prompt-volume chips: a row of one-line pills, plus the capability
  // chips in the same file, which carried the same wash for a different reason.
  const sonySystem: SonyState = {
    ...initialSonyState,
    status: 'connected',
    info: { ...initialSonyState.info, model: 'WH-1000XM5' },
    voiceGuidance: { enabled: true, volume: 1 },
    touchAssignment: { left: 0, right: 0 },
    capabilities: new Set([SonyFunction.VoiceGuidanceWithVolume, SonyFunction.AssignableSetting]),
  }
  // Nothing's ANC levels: the same card shape, a second driver, so the rule is
  // not satisfied by Sony alone.
  const nothingNoise: NothingState = {
    ...initialNothingState,
    status: 'connected',
    anc: 1,
    capabilities: new Set(['anc']),
  }
  return [
    renderToStaticMarkup(section(SONY_DRIVER, 'sound', sonySound)),
    renderToStaticMarkup(section(SONY_DRIVER, 'system', sonySystem)),
    renderToStaticMarkup(section(NOTHING_DRIVER, 'noise', nothingNoise)),
  ]
}

/** The opening tags of every element whose `aria-pressed` is `true`. */
const pressedTags = (markup: string): string[] =>
  (markup.match(/<button[^>]*>/g) ?? []).filter((tag) => /\saria-pressed="true"/.test(tag))

/** The opening tags of every element whose `aria-pressed` is `false`. */
const unpressedTags = (markup: string): string[] =>
  (markup.match(/<button[^>]*>/g) ?? []).filter((tag) => /\saria-pressed="false"/.test(tag))

const classesOf = (tag: string): string[] => {
  const match = tag.match(/class="([^"]*)"/)
  if (!match?.[1]) throw new Error(`no class on ${tag}`)
  return match[1].split(/\s+/).filter(Boolean)
}

describe('a driver section’s selected option (Sony sound, Sony system, Nothing noise)', () => {
  it('is the signal fill with black bold text, from the primitive that owns it', () => {
    const [sound, system, noise] = renderings()
    // There is a selection to look at in each: the cards, the volume chips and
    // the ANC levels all have one chosen.
    for (const markup of [sound, system, noise]) {
      expect(pressedTags(markup).length).toBeGreaterThan(0)
    }
    for (const tag of [...pressedTags(sound), ...pressedTags(system), ...pressedTags(noise)]) {
      const tokens = classesOf(tag)
      // The recipe, spelled as the utilities that carry it. Base UI puts
      // `data-pressed` on the element and the class list names the state, so a
      // component that computed the right classes and dropped them would fail
      // here.
      for (const wanted of [
        'rounded-[14px]',
        'bg-surface-raised',
        'data-pressed:bg-signal',
        'data-pressed:text-black',
        'data-pressed:font-bold',
      ]) {
        expect(tokens, tag).toContain(wanted)
      }
      // §1.2: the selected block is a fill, never an outline.
      expect(tokens.filter((token) => /^border(-|$)/.test(token))).toEqual([])
      // …and the state attribute that selects the fill is on this element.
      expect(tag).toContain('data-pressed')
    }
  })

  it('leaves the unselected options as raised blocks, not outlines either', () => {
    const [sound, system, noise] = renderings()
    for (const tag of [...unpressedTags(sound), ...unpressedTags(system), ...unpressedTags(noise)]) {
      const tokens = classesOf(tag)
      expect(tokens).toContain('rounded-[14px]')
      expect(tokens).toContain('bg-surface-raised')
      // The class list is the same on every option — that is what a state
      // variant is — so what says "this one is not the selection" is the
      // *attribute* being absent, not a different set of utilities. The
      // lookahead is load-bearing for the same reason `a11y.test.ts` and
      // `mono.test.tsx` need one: `data-pressed` sits in the class list as
      // `data-pressed:bg-signal`, and a bare `\b` or a plain substring matches
      // that half of it.
      expect(tag).not.toMatch(/\sdata-pressed(?![-\w:])/)
      // The old unselected half was `border-border
      // hover:border-muted-foreground/40`; the border is gone and the hover is
      // the surface swap the primitive does.
      expect(tokens.filter((token) => /^border(-|$)/.test(token))).toEqual([])
      expect(tokens).toContain('hover:bg-accent')
    }
  })

  it('keeps the hint legible on the red it is painted over', () => {
    // `--muted-foreground` on `#ff4d3d` is 1.6 : 1 in light and 1.1 : 1 in dark,
    // so a hint that keeps its muted colour goes unreadable exactly when the
    // card is the chosen one. The pressed twin is on the hint itself.
    const [, , noise] = renderings()
    expect(noise).toContain('group-data-pressed/toggle:text-black/80')
  })
})
