// @vitest-environment jsdom
/**
 * The top bar and the status token — spec §4.4, DESIGN-GUIDE §5.10–5.11.
 *
 * Lives in `src/` rather than `ui/layout/` because it names a driver, which
 * `ui/` may not — see `summary.test.ts` for the rule and `nav.test.tsx` for the
 * same method one file over. The driver is named for one concrete reason: the
 * bar reads the model through `summarise`, which asks the descriptor for the
 * codec, the status line and the artwork, and a hand-rolled stand-in would have
 * to restate all three and would then be the thing under test.
 *
 * It needs jsdom and a real click: the phone switcher, the phone ⋯ menu and the
 * desktop "Add device" pill are all *disclosures*, and a closed disclosure is
 * supposed to be absent from the DOM, so asserting markup alone would only ever
 * prove the closed state. The class contract — the part that can be read
 * statically — is pinned per state instead.
 */
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SENNHEISER_DRIVER } from '@/core/driver'
import type { ActiveDevice, DeviceManager } from '@/core/manager'
import type { ConnectionStatus } from '@/core/connection'
import { StatusToken } from '@/ui/layout/StatusToken'
import { TopBar } from '@/ui/layout/TopBar'

afterEach(cleanup)

/** The manager surface the top bar touches, and nothing more. */
const manager = (hasDevice = true): DeviceManager =>
  ({
    hasDevice,
    available: [],
    connect: vi.fn(async () => undefined),
    connectBluetooth: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    select: vi.fn(async () => undefined),
  }) as unknown as DeviceManager

/**
 * A real `ActiveDevice`, because the bar reads the model through `summarise` and
 * that asks the descriptor for the codec, the status line and the artwork. A
 * hand-rolled stand-in would have to restate all three, and would then be the
 * thing under test instead of the bar. Only `status` and the model vary.
 */
const device = (status: ConnectionStatus, model: string | null = 'MOMENTUM 4'): ActiveDevice => {
  const real = SENNHEISER_DRIVER.create({})
  return {
    id: SENNHEISER_DRIVER.id,
    driver: SENNHEISER_DRIVER,
    device: real,
    state: { ...real.state, status, info: { ...real.state.info, model } },
  }
}

const token = (status: ConnectionStatus, hasDevice = true) =>
  render(<StatusToken status={status} hasDevice={hasDevice} />)

const bar = (status: ConnectionStatus, hasDevice = true) =>
  render(<TopBar manager={manager(hasDevice)} active={device(status)} />)

/**
 * A bar with two granted devices, which is the only state the switcher renders
 * in — a dropdown of one is not a dropdown.
 */
const barWithSwitcher = (status: ConnectionStatus = 'connected') =>
  render(
    <TopBar
      manager={
        {
          ...manager(),
          available: [
            { uuid: 'a', label: 'MOMENTUM 4', brand: 'sennheiser' },
            { uuid: 'b', label: 'WH-1000XM5', brand: 'sony' },
          ],
        } as unknown as DeviceManager
      }
      active={device(status)}
    />,
  )

/** Class list of the element carrying `data-slot="…"`; the parts under test. */
const classesOf = (view: { container: HTMLElement }, slot: string): string[] => {
  const element = view.container.querySelector(`[data-slot="${slot}"]`)
  if (!element) throw new Error(`nothing carries data-slot="${slot}"`)
  return element.className.split(/\s+/).filter(Boolean)
}

/**
 * The bar's own row of desktop pills.
 *
 * Queried by slot rather than by label because the phone's open menu carries
 * some of the same words, and a test that cannot tell the two layouts apart is a
 * test that would pass whichever one was deleted.
 */
const desktopPills = (view: { container: HTMLElement }): HTMLElement => {
  const element = view.container.querySelector('[data-slot="top-bar-pills"]')
  if (!element) throw new Error('nothing carries data-slot="top-bar-pills"')
  return element as HTMLElement
}

/**
 * The open popover, whichever trigger opened it.
 *
 * Queried off `document` rather than the render container because Base UI
 * portals the popup out of the tree it was rendered into — which is also the
 * reason a closed one is absent from the DOM entirely, and therefore the reason
 * this test has to click before it can assert anything.
 */
const menuPanel = (): HTMLElement => {
  const panels = document.querySelectorAll('[data-slot="popover-content"]')
  const open = [...panels].find((panel) => panel.getAttribute('data-open') !== null)
  if (!open) throw new Error('no popover is open')
  return open as HTMLElement
}

describe('StatusToken (spec 4.4, DESIGN-GUIDE 5.11)', () => {
  it('marks a live connection with an 8px red dot, in the signal red', () => {
    const view = token('connected')
    // Matched case-insensitively: the token sets `uppercase` in CSS, so the
    // text node is the title-case word the guide prints in caps.
    expect(view.getByText(/^live$/i)).toBeTruthy()
    const dot = classesOf(view, 'status-dot')
    for (const wanted of ['size-2', 'rounded-full', 'bg-signal']) expect(dot).toContain(wanted)
    // Red text is 6.4:1 on black but only 3.3:1 on white, so it goes through the
    // strong token (spec §8) — and through *one* class, because that token is
    // the same red in dark: `--signal-strong dark:text-signal` was two ways to
    // write the same value, and the pair only differed if someone later changed
    // one of them.
    expect(classesOf(view, 'status-token')).toContain('text-signal-strong')
    expect(classesOf(view, 'status-token')).not.toContain('dark:text-signal')
  })

  it('does not pulse the live dot — a pulsing dot reads as loading', () => {
    // DESIGN-GUIDE §5.11, verbatim. Only the connecting spinner animates.
    expect(classesOf(token('connected'), 'status-token').filter((c) => c.startsWith('animate'))).toEqual([])
  })

  it('spins and stays muted while connecting', () => {
    const view = token('connecting')
    expect(view.getByText(/^connecting$/i)).toBeTruthy()
    expect(view.container.querySelector('[data-slot="spinner"]')).toBeTruthy()
    expect(classesOf(view, 'status-token')).toContain('text-muted-foreground')
  })

  it('inverts the pill when a known device has gone away', () => {
    // The page keeps showing the device and its last-known settings, so this one
    // is a fill: without a strong signal, cached values would read as current.
    const view = token('disconnected')
    expect(view.getByText(/^disconnected$/i)).toBeTruthy()
    for (const wanted of ['rounded-full', 'bg-foreground', 'text-background']) {
      expect(classesOf(view, 'status-token')).toContain(wanted)
    }
  })

  it('says so plainly, and neutrally, with no device at all', () => {
    const view = token('disconnected', false)
    expect(view.getByText(/^no device$/i)).toBeTruthy()
    expect(classesOf(view, 'status-token')).toContain('text-muted-foreground')
    // Nothing to be disconnected from, so no inverted pill either.
    expect(classesOf(view, 'status-token')).not.toContain('bg-foreground')
  })

  it('sets the nav-label role on every state: 11px, uppercase, wide tracking', () => {
    for (const status of ['connected', 'connecting', 'disconnected'] as const) {
      for (const wanted of ['text-[11px]', 'uppercase', 'tracking-[.1em]']) {
        expect(classesOf(token(status), 'status-token')).toContain(wanted)
      }
    }
  })
})

describe('TopBar (DESIGN-GUIDE 5.10)', () => {
  it('sticks to the top of a phone and stands still on a desktop', () => {
    const classes = classesOf(bar('connected'), 'top-bar')
    for (const wanted of ['sticky', 'top-0', 'h-[52px]', 'bg-background/85', 'backdrop-blur']) {
      expect(classes).toContain(wanted)
    }
    // "not sticky on desktop" is a rule, so it is asserted rather than assumed.
    expect(classes).toContain('md:static')
  })

  it('names the model at caption size on a phone and at Title size above', () => {
    const view = bar('connected')
    const title = view.container.querySelector('[data-slot="top-bar-title"]')
    const classes = classesOf(view, 'top-bar-title')
    for (const wanted of ['text-[10px]', 'uppercase', 'tracking-[.14em]']) expect(classes).toContain(wanted)
    // 22px / 800 / -2% — the Title role.
    for (const wanted of ['md:text-[22px]', 'md:font-extrabold', 'md:tracking-[-.02em]']) {
      expect(classes).toContain(wanted)
    }
    expect(title?.textContent).toBe('MOMENTUM 4')
  })

  it('carries the status token, so the bar says whether this is live', () => {
    expect(bar('connected').getByText(/^live$/i)).toBeTruthy()
    expect(bar('connecting').getByText(/^connecting$/i)).toBeTruthy()
  })

  it('puts the whole connection set behind one ⋯ button on a phone', () => {
    const view = bar('connected')
    const menu = view.getByLabelText('More actions')
    // The one phone affordance: nothing else competes for the 52px bar.
    expect(menu.className).toContain('md:hidden')
    // 44px floor per spec §8, hit slop rather than a 44px button (DESIGN-GUIDE
    // §5.2) — the bar is 52px, so a 44px button would be most of it.
    expect(menu.className).toContain('min-h-11')
    expect(menu.className).toContain('min-w-11')

    fireEvent.click(menu)
    // The guide's list, plus the theme — a phone has no rail to put it on.
    // Scoped to the open popover, because the desktop pills carry some of the
    // same labels and are in the DOM at the same time.
    const open = within(menuPanel())
    for (const label of ['Refresh', 'Disconnect', 'Add over serial', 'Add over Bluetooth']) {
      expect(open.getByText(label)).toBeTruthy()
    }
    expect(open.getByLabelText(/^Theme: /)).toBeTruthy()
  })

  it('gives both phone controls a 44px hit area without growing the glyph', () => {
    // Spec §8 asks for ≥44×44 on a phone; §5.2 says the way there without
    // changing the look is an invisible hit slop, not a taller button. Both
    // controls carry the floor as `min-*`, and neither carries a `size-11`,
    // which is what "grew the visual" would have looked like — a 44px glyph in a
    // 52px bar.
    const view = barWithSwitcher()
    for (const control of [view.getByLabelText('More actions'), view.getByLabelText('Switch device')]) {
      const classes = control.className.split(/\s+/)
      expect(classes).toContain('min-h-11')
      expect(classes).toContain('min-w-11')
      expect(classes.filter((token) => token === 'size-11')).toEqual([])
    }
  })

  it('drops the switcher entirely with only one device to move between', () => {
    // A "Switch" pill beside the only device name in the app is a control that
    // cannot do anything, so the bar offers none.
    expect(bar('connected').queryByLabelText('Switch device')).toBeNull()
    expect(barWithSwitcher().getByLabelText('Switch device')).toBeTruthy()
  })

  it('opens the switcher onto the current device, with the list one click away', () => {
    // The popover holds the existing `DeviceSelect`, which is itself a select —
    // so the popover shows the current device and the *options* live behind the
    // select's own trigger. Asserting both names are visible in the popover
    // would be wrong about how a select works, and would pass on a popover that
    // happened to render a flat list instead.
    const view = barWithSwitcher()
    const trigger = view.getByLabelText('Switch device')
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
    fireEvent.click(trigger)
    const open = within(menuPanel())
    expect(open.getByText('MOMENTUM 4')).toBeTruthy()
    expect(open.getByRole('combobox')).toBeTruthy()
  })

  it('offers a way back to a connection when nothing is connected', () => {
    // The guide's menu list is written for a live device; a phone whose
    // headphones are off needs the two pickers to be reachable at all.
    const view = bar('disconnected')
    fireEvent.click(view.getByLabelText('More actions'))
    const open = within(menuPanel())
    expect(open.getByText('Connect over serial')).toBeTruthy()
    expect(open.getByText('Connect over Bluetooth')).toBeTruthy()
  })

  it('lays the same actions out as pills above md, with Add device in a popover', () => {
    const view = bar('connected')
    for (const wanted of ['Refresh', 'Disconnect', 'Add device']) {
      // One implementation, two layouts: the pills exist in the phone markup too
      // and are hidden until md.
      const pill = desktopPills(view).querySelectorAll('button')
      expect([...pill].some((b) => b.textContent === wanted)).toBe(true)
    }
    expect(desktopPills(view).className).toContain('hidden')
    expect(desktopPills(view).className).toContain('md:flex')

    // "Add device" is a popover, so the pickers are absent until it is opened.
    const trigger = within(desktopPills(view)).getByText('Add device')
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
    expect(view.queryByText('Add over serial')).toBeNull()

    fireEvent.click(trigger)
    expect(within(menuPanel()).getByText('Add over serial')).toBeTruthy()
    expect(within(menuPanel()).getByText('Add over Bluetooth')).toBeTruthy()
  })

  it('disables the Bluetooth picker where the browser has no Web Bluetooth', () => {
    // jsdom has no `navigator.bluetooth`, so this is the unsupported case the
    // guide's hint exists for — a dead button, not a silent failure.
    const view = bar('connected')
    fireEvent.click(within(desktopPills(view)).getByText('Add device'))
    const bluetooth = within(menuPanel()).getByText('Add over Bluetooth').closest('button')
    expect(bluetooth?.disabled).toBe(true)
  })

  it('says "no device" in the token, rather than guessing a brand', () => {
    // Spec §3.2 with nothing granted, and §4.4's own row: `no device` → "NO
    // DEVICE", muted. Scoped to the token, because that is where the words now
    // live — the bar's title names the app (the test below), and a bare
    // `getByText` here would have been satisfied by either of the two.
    const view = bar('disconnected', false)
    const token = within(view.container).getByText(/^no device$/i)
    expect(token.getAttribute('data-slot')).toBe('status-token')
    expect(classesOf(view, 'status-token')).toContain('text-muted-foreground')
  })

  it('names itself in the title rather than repeating the status token', () => {
    // `summarise` answers "No device" for a model, because a field called
    // `model` should not hold the app's name — and the status token beside it
    // already says NO DEVICE (spec §4.4). Both rendered, the 52px bar said the
    // same three words twice, one of them in bold, 15px apart. The token's
    // wording is the spec's; the title is not, so the title is what moves.
    const view = bar('disconnected', false)
    const h1 = () => within(view.container).getByRole('heading', { level: 1 })
    expect(h1().textContent).toBe('OtoControl')
    // And the page keeps exactly one `<h1>` either way, so the hero's heading
    // stays an `h2` under it.
    expect(within(view.container).getAllByRole('heading', { level: 1 })).toHaveLength(1)
    // With a device the bar still names the device.
    const live = bar('connected')
    expect(within(live.container).getByRole('heading', { level: 1 }).textContent).toBe(
      'MOMENTUM 4',
    )
  })

  it('adds nothing to a desktop bar that has no device', () => {
    // The empty state is a full pair of connect buttons; the bar would only say
    // it again.
    const view = bar('disconnected', false)
    expect(desktopPills(view).querySelectorAll('button')).toHaveLength(0)
  })

  it('leaves the two pickers to the empty state, and keeps the theme in the phone menu', () => {
    // The same call as the desktop above, for the same reason, and it is Task 6
    // that makes it: the phone used to be the one surface where the ⋯ menu was
    // the *only* way in, but the empty state is now a full pair of connect
    // buttons on the page behind it. A menu offering the two buttons that are
    // already on screen is the duplicate, and the theme is the one thing a
    // phone bar has nowhere else to put.
    const view = bar('disconnected', false)
    fireEvent.click(view.getByLabelText('More actions'))
    const open = within(menuPanel())
    expect(open.getByLabelText(/^Theme: /)).toBeTruthy()
    expect(open.queryByText('Connect over serial')).toBeNull()
    expect(open.queryByText('Connect over Bluetooth')).toBeNull()
  })
})
