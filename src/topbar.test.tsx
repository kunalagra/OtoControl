// @vitest-environment jsdom
/**
 * The top bar — spec §4.4, DESIGN-GUIDE §5.10. The connection state, switching
 * and adding devices moved into `DeviceMenu` (see `deviceMenu.test.tsx`); the bar
 * holds the name, that menu, and Reconnect.
 *
 * Lives in `src/` rather than `ui/layout/` because it names a driver, which
 * `ui/` may not — see `summary.test.ts` for the rule and `nav.test.tsx` for the
 * same method one file over. The driver is named for one concrete reason: the
 * bar reads the model through `summarise`, which asks the descriptor for the
 * codec, the status line and the artwork, and a hand-rolled stand-in would have
 * to restate all three and would then be the thing under test.
 *
 * It needs jsdom and a real click: the device menu is a *disclosure*, and a
 * closed disclosure is absent from the DOM, so asserting markup alone would only
 * ever prove the closed state.
 */
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SENNHEISER_DRIVER } from '@/core/driver'
import type { ActiveDevice, DeviceManager } from '@/core/manager'
import type { ConnectionStatus } from '@/core/connection'
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
    autoConnect: vi.fn(async () => true),
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

const bar = (status: ConnectionStatus, hasDevice = true) =>
  render(<TopBar manager={manager(hasDevice)} active={device(status)} />)

/** Class list of the element carrying `data-slot="…"`; the parts under test. */
const classesOf = (view: { container: HTMLElement }, slot: string): string[] => {
  const element = view.container.querySelector(`[data-slot="${slot}"]`)
  if (!element) throw new Error(`nothing carries data-slot="${slot}"`)
  return element.className.split(/\s+/).filter(Boolean)
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

  it('carries no LIVE token: a connected device needs no word for it', () => {
    const view = bar('connected')
    expect(view.container.querySelector('[data-slot="status-token"]')).toBeNull()
    expect(view.queryByText(/^live$/i)).toBeNull()
    fireEvent.click(view.getByLabelText('Devices and connection'))
    expect(within(menuPanel()).queryByText(/^live$/i)).toBeNull()
  })

  it('shows the device menu beside the name with a single device, as the place to add the next one', () => {
    const view = bar('connected')
    const trigger = view.getByLabelText('Devices and connection')
    // 44px floor per spec §8 as hit slop on a phone, without growing the glyph.
    const classes = trigger.className.split(/\s+/)
    expect(classes).toContain('min-h-11')
    expect(classes).toContain('min-w-11')
    expect(classes.filter((token) => token === 'size-11')).toEqual([])
    fireEvent.click(trigger)
    expect(within(menuPanel()).getByRole('button', { name: 'Add device' })).toBeTruthy()
  })

  it('has no ⋯ menu: every width uses the device menu', () => {
    expect(bar('connected').queryByLabelText('More actions')).toBeNull()
  })

  it('offers no button with a device connected or connecting', () => {
    for (const status of ['connected', 'connecting'] as const) {
      const view = bar(status)
      expect(view.queryByText('Reconnect')).toBeNull()
      cleanup()
    }
  })

  it('reconnects to the device it knows, and falls back to the picker when that fails', async () => {
    const known = manager()
    const view = render(<TopBar manager={known} active={device('disconnected')} />)
    fireEvent.click(view.getByText('Reconnect'))
    await vi.waitFor(() => expect(known.autoConnect).toHaveBeenCalled())
    expect(known.connect).not.toHaveBeenCalled()
    cleanup()

    const lost = { ...manager(), autoConnect: vi.fn(async () => false) } as unknown as DeviceManager
    const again = render(<TopBar manager={lost} active={device('disconnected')} />)
    fireEvent.click(again.getByText('Reconnect'))
    await vi.waitFor(() => expect(lost.connect).toHaveBeenCalled())
  })

  it('names itself in the title when there is no device', () => {
    const view = bar('disconnected', false)
    const h1 = () => within(view.container).getByRole('heading', { level: 1 })
    expect(h1().textContent).toBe('OtoControl')
    // And the page keeps exactly one `<h1>` either way, so the hero's heading
    // stays an `h2` under it.
    expect(within(view.container).getAllByRole('heading', { level: 1 })).toHaveLength(1)
    // With a device the bar still names the device.
    const live = bar('connected')
    expect(within(live.container).getByRole('heading', { level: 1 }).textContent).toBe('MOMENTUM 4')
  })

  it('adds nothing with no device: the empty state holds Add device', () => {
    const view = bar('disconnected', false)
    expect(view.queryByLabelText('Devices and connection')).toBeNull()
    expect(view.container.querySelectorAll('button')).toHaveLength(0)
  })
})
