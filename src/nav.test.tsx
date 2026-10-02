/**
 * The nav model and the one nav that renders it — spec §3.1, DESIGN-GUIDE §5.9.
 *
 * Lives in `src/` rather than `ui/layout/` because it is a cross-driver test, for
 * the same reason and with the same method as `summary.test.ts`: the truth table
 * is per driver, so it has to name drivers, and `ui/` may not. Each state below
 * is the one its driver's own `create()` builds rather than a hand-written
 * stand-in section list — a stand-in is a claim about what a driver declares
 * that nothing keeps honest, and noticing when one renames, reorders or hides a
 * section is this file's whole job.
 *
 * Markup is asserted rather than behaviour, so `renderToStaticMarkup` in the
 * node environment is enough — the trade `components/ui/mono.test.tsx` makes.
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RiHeadphoneLine } from '@remixicon/react'

import {
  HEYMELODY_DRIVER,
  PIXELBUDS_DRIVER,
  NOTHING_DRIVER,
  SENNHEISER_DRIVER,
  SONY_DRIVER,
  SOUNDCORE_DRIVER,
} from '@/core/driver'
import type { ActiveDevice } from '@/core/manager'
import { Nav } from '@/ui/layout/Nav'
import { navSections, sectionFor } from '@/ui/sections/registry'

/** Sections are rendered, never called, so a device of no consequence is enough. */
const device = new Proxy({}, { get: () => () => undefined }) as never

type Descriptor =
  | typeof SENNHEISER_DRIVER
  | typeof SONY_DRIVER
  | typeof NOTHING_DRIVER
  | typeof SOUNDCORE_DRIVER
  | typeof HEYMELODY_DRIVER
  | typeof PIXELBUDS_DRIVER

const realState = (driver: Descriptor): unknown => (driver.create({}) as { state: unknown }).state

/** The shape `useDevices()` hands the shell: one driver with its own real state. */
const active = (driver: Descriptor, state: unknown = realState(driver)): ActiveDevice =>
  ({ id: driver.id, driver, device, state }) as ActiveDevice

/**
 * A Sony that has answered and has no noise-control hardware: a capability
 * table is present, so the driver stops holding every tab in reserve, and the
 * noise variant is still absent. The gate reads `capabilities.size` only to
 * decide that the device answered at all, so one opaque entry is all it needs.
 */
const sonyWithoutNoise = (): ActiveDevice =>
  active(SONY_DRIVER, {
    ...(realState(SONY_DRIVER) as Record<string, unknown>),
    capabilities: new Set<number>([0x11]),
    noiseVariant: null,
    // A paired-device list with an entry, so `devices` survives the same gate —
    // an empty list reads as no pairing support (WF-C500) and drops the tab.
    connections: {
      devices: [{ mac: 'AA', name: 'Phone', status: 1, connected: true, classOfDevice: null }],
      playbackMac: 'AA',
      playbackFixed: null,
    },
  })

const idsOf = (device: ActiveDevice) => navSections(device).map((section) => section.id)
const labelsOf = (device: ActiveDevice) => navSections(device).map((section) => section.label)
const shortLabelsOf = (device: ActiveDevice) =>
  navSections(device).map((section) => section.shortLabel)

describe('navSections', () => {
  it('puts Home first, whichever driver is active', () => {
    // Home is the landing tab, so its position is not negotiable per brand —
    // the regression this pins is a driver's own list ending up ahead of it.
    // Written out rather than read off `DRIVERS`, because a driver added later
    // has to be added here too to be covered.
    for (const driver of [SENNHEISER_DRIVER, SONY_DRIVER, NOTHING_DRIVER, SOUNDCORE_DRIVER, HEYMELODY_DRIVER, PIXELBUDS_DRIVER]) {
      expect(idsOf(active(driver))[0]).toBe('home')
    }
  })

  it('gives Sennheiser Home, Sound, Devices, System', () => {
    expect(idsOf(active(SENNHEISER_DRIVER))).toEqual(['home', 'sound', 'devices', 'system'])
    expect(labelsOf(active(SENNHEISER_DRIVER))).toEqual(['Home', 'Sound', 'Devices', 'System'])
  })

  it('gives Nothing Home, Sound, System', () => {
    // Nothing declares no `devices` section, so the nav must not invent one.
    expect(idsOf(active(NOTHING_DRIVER))).toEqual(['home', 'sound', 'system'])
  })

  it('gives Pixel Buds Home, Sound, System', () => {
    // Noise lives on Home, and Pixel Buds declare no `devices` section.
    expect(idsOf(active(PIXELBUDS_DRIVER))).toEqual(['home', 'sound', 'system'])
  })

  it('gives a Sony without noise control Home, Sound, Devices, System', () => {
    expect(idsOf(sonyWithoutNoise())).toEqual(['home', 'sound', 'devices', 'system'])
  })

  it('never offers noise, however loudly the driver declares it', () => {
    // The section still exists — the driver gates Sony's on a capability read
    // from the device, and `Home` renders it. The shell is what keeps it out of
    // the nav, and that is the rule under test here, not each driver's list.
    for (const driver of [SENNHEISER_DRIVER, SONY_DRIVER, NOTHING_DRIVER, SOUNDCORE_DRIVER, HEYMELODY_DRIVER, PIXELBUDS_DRIVER]) {
      expect(idsOf(active(driver))).not.toContain('noise')
    }
  })

  it('keeps hidden sections out of the nav', () => {
    // Sennheiser's Debug console is reached from System and returns to it; the
    // nav has no business offering it as a tab.
    expect(idsOf(active(SENNHEISER_DRIVER))).not.toContain('debug')
    expect(navSections(active(SENNHEISER_DRIVER)).every((section) => !section.hidden)).toBe(true)
  })

  it('shortens only what the pill bar cannot fit: System becomes More', () => {
    // The old `label.split(' ')[0]` hack happened to shorten "Noise control" to
    // "Noise", and would have turned a future "Device information" into
    // "Device"; each entry now carries the word it wants.
    expect(shortLabelsOf(active(SENNHEISER_DRIVER))).toEqual(['Home', 'Sound', 'Devices', 'More'])
    expect(shortLabelsOf(active(NOTHING_DRIVER))).toEqual(['Home', 'Sound', 'More'])
  })

  it('resolves an id the driver has, including a hidden one with no tab', () => {
    // The Debug console is not in the nav, and System sends the shell there, so
    // resolution has to consult the driver's own list as well as the nav's.
    expect(sectionFor(active(SENNHEISER_DRIVER), 'debug').id).toBe('debug')
    expect(sectionFor(active(SENNHEISER_DRIVER), 'system').id).toBe('system')
  })

  it('lands a stale id on the first tab rather than on nothing', () => {
    // What a device switch leaves behind: an id the new driver never declared.
    // Falling back during render is the rule — the old shell did it in an
    // effect, so a switch showed one frame of the previous device's section.
    expect(sectionFor(active(NOTHING_DRIVER), 'devices').id).toBe('home')
    expect(sectionFor(active(SENNHEISER_DRIVER), '').id).toBe('home')
  })

  it('gives Home the headphone glyph, and every entry some icon', () => {
    expect(navSections(active(NOTHING_DRIVER))[0].icon).toBe(RiHeadphoneLine)
    for (const section of navSections(active(SENNHEISER_DRIVER))) {
      expect(typeof section.icon).toBe('function')
    }
  })
})

describe('Nav', () => {
  const sections = navSections(active(SENNHEISER_DRIVER))
  const render = (props: Partial<Parameters<typeof Nav>[0]> = {}) =>
    renderToStaticMarkup(
      <Nav sections={sections} active="home" onSelect={() => undefined} {...props} />,
    )

  /** Every opening tag carrying `attribute` as an attribute of its own. */
  const tagsWith = (markup: string, attribute: string): string[] => {
    // The lookahead is what keeps `aria-current:` inside a class list from
    // reading as the attribute — the same guard `mono.test.tsx` needs.
    const pattern = new RegExp(`\\s${attribute}(?![-\\w:])`)
    return (markup.match(/<[a-z][^>]*>/g) ?? []).filter((tag) => pattern.test(tag))
  }

  const navTag = (markup: string): string => {
    const tags = tagsWith(markup, 'aria-label').filter((tag) => tag.includes('Sections'))
    expect(tags).toHaveLength(1)
    return tags[0]
  }

  it('is one nav element laid out two ways, not two copies', () => {
    // Two `<nav>`s, one hidden per breakpoint, would read as two tab bars to a
    // screen reader and could disagree after a device switch.
    const markup = render()
    expect(tagsWith(markup, 'aria-label').filter((tag) => tag.includes('Sections'))).toHaveLength(1)
    expect(tagsWith(markup, 'data-slot="nav-item"')).toHaveLength(sections.length)
  })

  it('floats as a pill below md and stands as an 88px rail from md up', () => {
    const tag = navTag(render())
    for (const wanted of [
      'fixed',
      'inset-x-4',
      'h-14',
      'rounded-full',
      'bg-card',
      'md:static',
      'md:w-[88px]',
    ]) {
      expect(tag).toContain(wanted)
    }
    // 16px from the bottom, plus the home indicator's inset.
    expect(tag).toContain('bottom-[calc(16px+env(safe-area-inset-bottom))]')
  })

  it('shows the rail with a rule on its right edge only, not on all four', () => {
    // The regression this pins. `border` is Tailwind's `border-width:1px`
    // *shorthand* — it sets all four sides at once — and the rail needs the
    // shorthand for the pill and a single side for itself. Adding only
    // `md:border-r` on top of it therefore leaves a 1px box on every side, which
    // is a visible ring around the whole rail, not the one rule spec §4.2 asks
    // for. The three `md:` resets are what make the `md:border-r` a working rule
    // rather than a redundant one, so they are asserted alongside it: an
    // assertion that only checked for `md:border-r` would pass on the broken
    // layout too.
    //
    // Per-side zeros rather than `md:border-x-0` / `md:border-y-0`: `cn` is
    // tailwind-merge, which treats an axis-wide width as conflicting with a
    // single-side one and keeps only the last, so the axis form drops
    // `md:border-r` from the class list entirely and then zeroes all four sides.
    // Measured in a browser, the axis form renders the rail with *no* rule at all
    // (left/right/top/bottom all 0px) — a different wrong from the ring above,
    // not the same one. Asserting the axis form's absence here would pin a
    // claim no test can check, so what is asserted is the per-side form's
    // presence.
    const classes = navTag(render()).match(/class="([^"]*)"/)?.[1].split(/\s+/) ?? []
    expect(classes).toContain('border')
    expect(classes).toContain('md:border-r')
    for (const wanted of ['md:border-l-0', 'md:border-t-0', 'md:border-b-0']) {
      expect(classes).toContain(wanted)
    }
  })

  it('drops the pill radius for the rail, which has square corners', () => {
    // Same class of bug as the border, found while measuring that one: the rail
    // is the pill's own element, so `rounded-full` rides along and the 1px rule
    // curves away at the top and bottom. `rounded-full` on an 88x800 box resolves
    // to a radius of half its width, so the rule bows 44px at each end — the
    // rail stops reading as a straight column against the page edge.
    const classes = navTag(render()).match(/class="([^"]*)"/)?.[1].split(/\s+/) ?? []
    expect(classes).toContain('rounded-full')
    expect(classes).toContain('md:rounded-none')
  })

  it('gives every tab an icon over a label, spelled in full for the rail', () => {
    const markup = render()
    // The rail says System, the pill says More; both are in the markup of the one
    // nav, and only one of them is ever on screen.
    expect(markup).toContain('System')
    expect(markup).toContain('More')
    expect(tagsWith(markup, 'data-slot="nav-item"')[0]).toContain('md:w-16')
  })

  it('marks the active tab for assistive technology, and only it', () => {
    const current = tagsWith(render({ active: 'sound' }), 'aria-current')
    expect(current).toHaveLength(1)
    expect(current[0]).toContain('aria-current="page"')
    // Selection is the one thing the design animates (DESIGN-GUIDE §6).
    expect(current[0]).toContain('transition-colors')
  })

  it('dims an inactive tab with a colour, not with opacity', () => {
    // Spec §4.1 asks for "inactive tabs are 55% opacity text", and §8 asks for
    // AA. On the surfaces this nav actually sits on those two cannot both hold:
    // `#777` at 55% is 2.1 : 1 over the pill's `#111` and 2.0 : 1 over the light
    // pill's `#f2f2f2`, and the bare `#777` on the rail was 4.48 : 1 in light —
    // short of the 4.5 a 9px label needs. The *hierarchy* §4.1 is after is kept
    // (the active tab inverts); the dimming is the part that had to go, because
    // it was carrying a distinction the fill already draws.
    //
    // Computed ratios, in a browser against the built stylesheet:
    //   `--muted-foreground` on the pill — 4.76 : 1 light, 5.33 : 1 dark
    //   `--muted-foreground` on the page — 5.33 : 1 light, 5.92 : 1 dark
    const inactive = tagsWith(render({ active: 'sound' }), 'data-slot="nav-item"')
      .filter((tag) => !tag.includes('aria-current'))
      .map((tag) => tag.match(/class="([^"]*)"/)?.[1].split(/\s+/) ?? [])
      .flat()
    expect(inactive).toContain('text-muted-foreground')
    expect(inactive).not.toContain('opacity-55')
    expect(inactive).not.toContain('md:opacity-100')
    // No arbitrary grey anywhere: the token is the same value in both themes, so
    // a hex here is a value someone chose twice and will change once.
    expect(inactive.some((token) => /^text-\[/.test(token))).toBe(false)
  })

  it('has nothing to navigate to, and no floating pill, with no device', () => {
    // Spec §3.2: with nothing granted there is no nav at all, rather than one
    // brand's section list guessed at. The rail column stays, because that is
    // also where the app mark and the connection menu live.
    const markup = render({ sections: [] })
    expect(tagsWith(markup, 'data-slot="nav-item"')).toHaveLength(0)
    expect(navTag(markup)).not.toContain('fixed')
  })

  it('marks the rail with a headphone glyph, not a letter', () => {
    // The inverted 38px square carries the shared headphone glyph (the Home
    // tab's icon), so the mark needs no asset and stays monochrome.
    const markup = render({ sections: [] })
    expect(markup).toContain('size-[38px]')
    expect(markup).not.toContain('>O<')
  })
})
