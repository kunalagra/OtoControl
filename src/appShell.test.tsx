// @vitest-environment jsdom
/**
 * The shell's own resolution of "which section is on screen", and what the nav
 * is told about it — spec §3.1, §4.3.
 *
 * Lives in `src/` rather than `ui/layout/` because it names a driver, which
 * `ui/` may not — see `summary.test.ts:13`, where `core/driver.ts` and
 * `manager.ts` are allow-listed and `ui/` is not. Naming one driver is the same
 * violation as naming five; the rule is about the test, not the import list.
 *
 * jsdom for the last describe, which renders `AppShell` itself. Everything else
 * is `renderToStaticMarkup`, which is enough for a component with no state of its
 * own — but the shell reads the device through `useSyncExternalStore`, and a
 * server render of that is an error rather than a snapshot. A real client render
 * is also the only way to see the *whole* column at once, which is what the
 * layout assertions are about: the padding, the gaps and the max width are one
 * element's class string, and each of them has been wrong on its own once.
 *
 * `home` is a section the *shell* owns: no driver's `components` map holds it,
 * and the registry's `UI_SECTIONS` table registers it — one line, `home: Home`.
 * From that line the shell has exactly one way to resolve a section id, so the
 * disagreement this file originally guarded against (Home marked current while
 * the body rendered Sound, because a fallback branch resolved the id a second
 * way) can no longer be written. What replaces it is the invariant behind that
 * branch: every section the nav offers must resolve to a component, or the body
 * would render nothing under a tab claiming to be on screen.
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SENNHEISER_DRIVER, SONY_DRIVER } from '@/core/driver'
import { initialSonyState } from '@/drivers/sony/sony'
import type { SonyState } from '@/drivers/sony/sony'
import type { ActiveDevice } from '@/core/manager'
import { AppShell } from '@/ui/layout/AppShell'
import { Nav } from '@/ui/layout/Nav'
import { Home } from '@/ui/sections/Home'
import { componentFor, navSections, sectionFor } from '@/ui/sections/registry'

afterEach(cleanup)

/**
 * Whether the shell believes a device is granted. Off by default, which is what
 * the first three describes here are about; the section-chain test switches it
 * on because the wrapper only exists once something is connected.
 */
const granted = { on: false }

vi.mock('@/ui/useDevice', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/ui/useDevice')>()
  return {
    ...original,
    useDevices: () => {
      if (!granted.on) return original.useDevices()
      return {
        manager: { hasDevice: true, available: [], has: false } as never,
        active: {
          id: SENNHEISER_DRIVER.id,
          driver: SENNHEISER_DRIVER,
          device: new Proxy({}, { get: () => () => undefined }),
          state: SENNHEISER_DRIVER.create({}).state,
        } as ActiveDevice,
      }
    },
  }
})

/** Sections are rendered, never called, so a device of no consequence is enough. */
const device = new Proxy({}, { get: () => () => undefined }) as never

const active = SENNHEISER_DRIVER.create({}) as { state: unknown }
const forSennheiser = {
  id: SENNHEISER_DRIVER.id,
  driver: SENNHEISER_DRIVER,
  device,
  state: active.state,
} as ActiveDevice

/**
 * The resolution `AppShell` performs: `sectionFor` resolves the id during
 * render, and `componentFor` is what the body renders for it.
 */
const rendered = (active: ActiveDevice, sectionId: string) => sectionFor(active, sectionId)

const renderNav = (sectionId: string) =>
  renderToStaticMarkup(
    <Nav
      sections={navSections(forSennheiser)}
      active={rendered(forSennheiser, sectionId).id}
      onSelect={() => undefined}
    />,
  )

/** The whole `<button>` carrying `aria-current`, opening tag and both labels. */
const currentItem = (markup: string): string =>
  markup.match(/<button[^>]*aria-current="page"[^]*?<\/button>/)?.[0] ?? ''

describe('AppShell section resolution', () => {
  it('leaves a section the driver can render exactly where the id points', () => {
    expect(rendered(forSennheiser, 'sound').id).toBe('sound')
    expect(rendered(forSennheiser, 'system').id).toBe('system')
    // A hidden section is reachable and has a component, so nothing shifts.
    expect(rendered(forSennheiser, 'debug').id).toBe('debug')
  })

  it('renders the landing tab, because Home resolves to a component', () => {
    // The one line `ui/sections/registry.ts` registers: `home: Home`, consulted
    // before the driver's own map. With that in place the shell resolves the
    // landing tab the same way it resolves every other one.
    expect(componentFor(forSennheiser, 'home')).toBeDefined()
    expect(rendered(forSennheiser, 'home').id).toBe('home')
  })

  it('gives every tab in the nav a component, so no tab can be marked over nothing', () => {
    // The invariant the deleted fallback branch used to paper over. A nav entry
    // with no component renders an empty body under `aria-current="page"`, which
    // is the disagreement that branch existed to prevent — now it is prevented by
    // every entry resolving, not by a second way of resolving the id.
    for (const section of navSections(forSennheiser)) {
      expect(componentFor(forSennheiser, section.id)).toBeDefined()
    }
  })

  it('never marks a tab current that the body cannot show', () => {
    // The rendered markup is the whole claim: whichever tab carries
    // `aria-current` has to be the one whose component was found. An id is not in
    // the markup, so the labels stand in for it — `shortLabel` is unique across
    // the nav (Home, Sound, Devices, More) and each item carries both of its
    // own.
    for (const sectionId of ['home', 'sound', 'system', 'devices']) {
      const current = currentItem(renderNav(sectionId))
      expect(current).toContain(rendered(forSennheiser, sectionId).shortLabel)
    }
  })

  it('marks no tab at all while a hidden section is showing', () => {
    // `debug` has a component but no tab, so there is nothing correct to mark
    // current — and marking a tab it is not on would be the same disagreement
    // the previous test rules out. The back button in the body is the way back.
    expect(currentItem(renderNav('debug'))).toBe('')
  })

  it('drops the tab bar entirely when there is no device, so nothing is claimed', () => {
    // Spec §3.2: no device, no nav. A pill bar over the empty state would both
    // be a guess about hardware and carry an `aria-current` nothing on screen
    // backs up.
    const markup = renderToStaticMarkup(
      <Nav sections={[]} active={rendered(forSennheiser, 'home').id} onSelect={() => undefined} />,
    )
    expect(currentItem(markup)).toBe('')
    expect(markup).not.toContain('aria-current')
  })

  it('marks Home, not a neighbour, as current on the landing tab', () => {
    // The exact regression the interim branch was deleted over: `aria-current`
    // on Home while the body renders Sound. Home is what the id names, so Home
    // is what the nav says.
    const current = currentItem(renderNav('home'))
    expect(current).toContain('Home')
    expect(current).not.toContain('Sound')
  })
})

/**
 * Home rendered for a real driver, through the same resolution the shell uses.
 *
 * `ui/sections/Home.test.tsx` drives the tiles from a fake driver, because a
 * shared component's test may not name one. This is the other half: a real
 * descriptor, its real initial state, and the real `summarise` — which is where a
 * Home that only works against a fixture would show up, since the slots read
 * five different state shapes through the shared normaliser and ask each driver
 * for two optional readouts it may not have.
 */
describe('Home, for a real driver', () => {
  const markup = renderToStaticMarkup(
    <Home active={forSennheiser} onNavigate={() => undefined} />,
  )

  it('renders every slot a Sennheiser declares', () => {
    for (const slot of ['home', 'home-hero', 'home-battery', 'home-noise', 'home-eq', 'home-devices']) {
      expect(markup).toContain(`data-slot="${slot}"`)
    }
  })

  it('says nothing it cannot know, before anything has been read', () => {
    // A disconnected, never-identified device: no battery figure, no firmware,
    // no codec — and the connections tile falls back to a link because the
    // driver has reported no paired devices.
    expect(markup).toContain('Live only')
    expect(markup).not.toContain('%</span>')
    expect(markup).toContain('Connections ↗')
    expect(markup).toContain('Sound settings ↗')
  })
})

/**
 * The two Home claims that only a real driver can settle, because both are about
 * a driver's own vocabulary rather than about the shared component.
 *
 * The first is the capability gate. A driver's `components` map holds a component
 * for every id it *might* declare, so reading the map renders a noise tile on a
 * Sony with no noise control — the gate is in the section list, and it is the
 * same list the nav reads. The fixture is a real Sony state: capabilities read, so
 * the driver has stopped holding every tab in reserve, and no noise variant.
 */
describe('Home, for a real Sony', () => {
  /**
   * A real device and its real initial state with the given overrides, plus the
   * state itself — the descriptor is asked questions about it directly below, and
   * `ActiveDevice`'s union would widen those answers back to five brands.
   */
  const sony = (
    overrides: Partial<SonyState>,
  ): { active: ActiveDevice; state: SonyState } => {
    const state: SonyState = { ...initialSonyState, ...overrides }
    return { active: { id: SONY_DRIVER.id, driver: SONY_DRIVER, device, state } as ActiveDevice, state }
  }

  const noNoiseControl = sony({
    status: 'connected',
    info: { model: 'WH-1000XM5', firmware: null, colour: null },
    // One opaque capability is enough: the gate reads `capabilities.size` only to
    // decide the device answered at all.
    capabilities: new Set<number>([0x11]),
    noiseVariant: null,
    // One paired entry: this test is about the noise omission, and an empty
    // list reads as no pairing support (no devices tab, no tile).
    connections: {
      devices: [{ mac: 'AA', name: 'Phone', status: 1, connected: true, classOfDevice: null }],
      playbackMac: 'AA',
      playbackFixed: null,
    },
  })

  it('leaves the noise slot out on a device with no noise control', () => {
    const markup = renderToStaticMarkup(
      <Home active={noNoiseControl.active} onNavigate={() => undefined} />,
    )
    expect(markup).not.toContain('data-slot="home-noise"')
    // The rest of the bento is unaffected: the omission is the slot, not the page.
    for (const slot of ['home-hero', 'home-battery', 'home-eq', 'home-devices']) {
      expect(markup).toContain(`data-slot="${slot}"`)
    }
  })

  it('fills the noise slot once the device reports the capability', () => {
    const { state } = sony({ ...noNoiseControl.state, noiseVariant: 0x01 })
    const markup = renderToStaticMarkup(
      <Home active={{ id: SONY_DRIVER.id, driver: SONY_DRIVER, device, state } as ActiveDevice} onNavigate={() => undefined} />,
    )
    expect(markup).toContain('data-slot="home-noise"')
  })

  it('does not read a case status as a wear caption', () => {
    // This driver's `detail` is a status line — "L in case · R in case" — which
    // reads like a wear state without being one, and used to be shown in the
    // hero as one. The hero caption comes from a driver's own wear readout, and
    // this driver has none, so the hero says only what it knows: the brand.
    const { active, state } = sony({
      status: 'connected',
      info: { model: 'WF-C500', firmware: null, colour: null },
      capabilities: new Set<number>([0x21]),
      battery: {
        left: { level: 0, status: 0x02, charging: false, onPower: false, present: false },
        right: { level: 0, status: 0x02, charging: false, onPower: false, present: false },
      },
    })
    // The premise, from the driver rather than from the markup: this is the
    // string that used to reach the hero.
    expect(SONY_DRIVER.statusLine(state)).toBe('L in case · R in case')

    const markup = renderToStaticMarkup(<Home active={active} onNavigate={() => undefined} />)
    const hero = markup.slice(
      markup.indexOf('data-slot="home-hero"'),
      markup.indexOf('data-slot="home-battery"'),
    )
    expect(hero).not.toContain('in case')
    // Not even the blunter fallback: this driver reports the headphones as worn
    // whatever the buds are doing, and "Not worn" would contradict it.
    expect(hero).not.toContain('Not worn')
    // The brand, without the protocol the driver's own label carries.
    expect(hero).toContain('Sony')
    expect(hero).not.toContain('(MDR)')
  })
})

/**
 * The shell as a page, with no device — which is what the app shows on first
 * run, and the one configuration every other layout claim can be checked
 * against.
 *
 * The values below are the guide's own width rules (DESIGN-GUIDE §3, spec §4.1
 * and §4.2), asserted as class strings because that is the layer they are
 * written at. Three of them were wrong in the same direction before this pass —
 * the first block sat flush against the 52px bar, the gap under the desktop bar
 * was 20px where the approved mockup has 14px, and nothing said so anywhere.
 */
describe('AppShell — the body column, with no device', () => {
  const shell = () => {
    const { container } = render(<AppShell />)
    return container.querySelector<HTMLElement>('[data-slot="section-body"]')!
  }

  it('is the whole body, and holds the empty state rather than a tab', () => {
    const { container } = render(<AppShell />)
    // Spec §3.2: with nothing granted there is no nav, so the hero is the page.
    expect(container.querySelector('[data-slot="no-device"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-slot="nav-item"]')).toHaveLength(0)
  })

  it('holds one column, 16px in from each side on a phone and 24px on a desktop', () => {
    const classes = shell().className
    expect(classes).toContain('max-w-[1280px]')
    expect(classes).toContain('px-4')
    expect(classes).toContain('md:px-6')
  })

  it('leaves room under the sticky bar, which it had none of', () => {
    // The regression: with a sticky 52px bar and no top padding, the first block
    // was flush against it — the only place in the column with no gap at all,
    // because everything below it was measured from the bottom for the pill.
    // 12px on a phone is the guide's own grid gap (DESIGN-GUIDE §3).
    const tokens = shell().className.split(' ')
    expect(tokens).toContain('pt-3')
    // Split, not `toContain`: `toContain('pt-3')` also matches the `md:pt-3.5`
    // below, so it passed with the phone's own padding deleted — and the phone
    // is the width this was written for, since the bar is only sticky there.
    expect(tokens).not.toContain('md:pt-3')
    expect(tokens).toContain('gap-2')
    expect(tokens).toContain('md:gap-3.5')
  })

  it('bounds the body on Home, so its tiles fit the window instead of scrolling it', () => {
    // Without a bounded height the columns grow to their content and no tile
    // ever learns it is out of room — measured: 121px of page scroll at
    // 1280x720 with a Momentum's five tiles, before this class.
    granted.on = true
    const { container, unmount } = render(<AppShell />)
    const tokens = container.querySelector<HTMLElement>('[data-slot="section-body"]')!.className.split(' ')
    unmount()
    granted.on = false
    expect(tokens).toContain('md:min-h-0')
  })

  it('ends System with the App settings, then About, outside the idle dim', () => {
    // App-level settings belong with the other things about this app, above the
    // disclaimer rather than under it — and both stay readable and usable while
    // the headphones are away.
    granted.on = true
    const view = render(<AppShell />)
    fireEvent.click(view.getAllByRole('button', { name: /system/i })[0])
    const app = view.container.querySelector('[data-slot="app-settings"]')!
    const about = view.container.querySelector('[data-slot="about"]')!
    granted.on = false
    expect(app).toBeTruthy()
    expect(about).toBeTruthy()
    expect(app.compareDocumentPosition(about) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const wrap = view.container.querySelector('[data-slot="section-wrap"]')!
    expect(wrap.contains(app)).toBe(false)
    expect(wrap.contains(about)).toBe(false)
    view.unmount()
  })

  it('clears the floating pill, and only when there is one', () => {
    // Spec §4.1: "Bottom padding = pill height + 16 px + safe-area-inset-bottom".
    // The pill *is* the nav bar, and with nothing granted there is no nav at all
    // (spec §3.2) — so on the empty state the 72px was reserving room for a bar
    // that is not rendered, and the hero ended 74px above the bottom of a 390px
    // screen with nothing in that space. The safe-area inset is not conditional:
    // a phone with a home indicator needs the page to stop above it whatever else
    // is at the foot.
    const padding = () => {
      const { container, unmount } = render(<AppShell />)
      const tokens = container
        .querySelector<HTMLElement>('[data-slot="section-body"]')!
        .className.split(' ')
      unmount()
      return tokens
    }

    // No device: the hero's own bottom padding, and the inset.
    const withoutDevice = padding()
    expect(withoutDevice).toContain('pb-[env(safe-area-inset-bottom)]')
    expect(withoutDevice.some((token) => token.startsWith('pb-[calc('))).toBe(false)
    // The desktop is unaffected either way: the pill is a phone-only layout, and
    // the desktop bar is in the flow, so there is nothing to clear from `md` up.
    expect(withoutDevice).not.toContain('md:pb-5')

    // A device granted: the pill is on the page. It floats 16px above the
    // inset and is 56px tall, so 72px only reaches its top edge — the last
    // block ended flush against it. Another 16px is the gap the spec meant.
    granted.on = true
    const withDevice = padding()
    granted.on = false
    expect(withDevice).toContain('pb-[calc(56px+16px+16px+env(safe-area-inset-bottom))]')
    expect(withDevice).toContain('md:pb-5')
  })

  it('gives the bar 20px above it and the body 14px below, each owned once', () => {
    // The desktop bar used to pad itself 20px on *both* sides while the body
    // added another 20px of gap, for 40px between the bar and the section
    // against the approved mockup's 14.
    const { container } = render(<AppShell />)
    const bar = container.querySelector<HTMLElement>('[data-slot="top-bar"]')!
    expect(bar.className).toContain('md:pt-5')
    expect(bar.className).not.toContain('md:pb-5')

    // …and the space below it belongs to the body, which is the one place that
    // has a `gap` to be consistent with. `md:pt-0` here was the bug it fixed
    // into existence: a flex column's `gap` adds nothing *before* the first
    // child, so zeroing the body's own top padding with the bar's also put the
    // hero flat against the bar — measured at 0px, not the 14 the mockup has.
    // One owner: the body, at the gap's own value.
    expect(shell().className).toContain('md:pt-3.5')
    expect(shell().className).not.toContain('md:pt-0')
  })
})

/**
 * The one rule that makes "a section fills the body" true, and it is two classes
 * on a wrapper rather than a prop on seventeen section roots.
 *
 * `main` is the only box in the column with a definite height (`md:h-dvh`), and
 * every link below it is a flex item whose `min-height: auto` refuses to shrink
 * — so the height stopped one box short of the section, and anything asking to
 * fill it filled nothing. Measured in Chrome at 1280×800 with the rule absent: a
 * 890px fader desk in an 800px window, a page that scrolled to 1273px, and a
 * track that took its height from the scroll container rather than the desk.
 */
describe('AppShell — the section chain', () => {
  it('lets a section shrink and grow inside the body from md up', () => {
    // With a device, so the wrapper exists: with nothing granted the body holds
    // the empty state, which is deliberately not inside it. The grant comes from
    // the `useDevices` mock above rather than from a prop, because the shell
    // takes none — it reads the device through the store, and a mock of that is
    // the only way to see the *connected* column from jsdom.
    granted.on = true
    const { container } = render(<AppShell />)
    const wrap = container.querySelector<HTMLElement>('[data-slot="section-wrap"]')!
    const classes = wrap.className
    expect(classes).toContain('md:flex-1')
    expect(classes).toContain('md:min-h-0')
    // The rule, applied to the section rather than to seventeen section roots.
    expect(classes).toContain('md:[&>*]:flex-1')
    expect(classes).toContain('md:[&>*]:min-h-0')
    // And the section is a direct child, which is what the descendant rule needs:
    // a rule aimed at a grandchild would silently match nothing.
    expect(wrap.firstElementChild).toBe(container.querySelector('[data-slot="home"]'))
  })
})
