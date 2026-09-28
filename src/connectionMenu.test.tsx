// @vitest-environment jsdom
/**
 * The rail's connection button: one control that says whether the headphones
 * are live and holds every connection action behind it.
 */
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SENNHEISER_DRIVER } from '@/core/driver'
import type { ConnectionStatus } from '@/core/connection'
import type { ActiveDevice, DeviceManager } from '@/core/manager'
import { ConnectionMenu } from '@/ui/layout/ConnectionMenu'

afterEach(cleanup)

const manager = (): DeviceManager =>
  ({
    hasDevice: true,
    available: [],
    connect: vi.fn(async () => undefined),
    connectBluetooth: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    autoConnect: vi.fn(async () => true),
  }) as unknown as DeviceManager

const device = (status: ConnectionStatus): ActiveDevice => {
  const real = SENNHEISER_DRIVER.create({})
  return { id: SENNHEISER_DRIVER.id, driver: SENNHEISER_DRIVER, device: real, state: { ...real.state, status } }
}

const openPanel = (): HTMLElement => {
  const open = [...document.querySelectorAll('[data-slot="popover-content"]')].find(
    (panel) => panel.getAttribute('data-open') !== null,
  )
  if (!open) throw new Error('no popover is open')
  return open as HTMLElement
}

describe('ConnectionMenu', () => {
  it('names the connection state on its face, so the rail says whether this is live', () => {
    const live = render(<ConnectionMenu manager={manager()} active={device('connected')} />)
    expect(live.getByLabelText(/^Connection: live/i)).toBeTruthy()
    cleanup()
    const off = render(<ConnectionMenu manager={manager()} active={device('disconnected')} />)
    expect(off.getByLabelText(/^Connection: offline/i)).toBeTruthy()
  })

  it('holds refresh, disconnect and the add pickers while connected', () => {
    const view = render(<ConnectionMenu manager={manager()} active={device('connected')} />)
    fireEvent.click(view.getByLabelText(/^Connection:/))
    const panel = within(openPanel())
    for (const label of ['Refresh', 'Disconnect', 'Add over serial', 'Add over Bluetooth']) {
      expect(panel.getByText(label)).toBeTruthy()
    }
  })

  it('holds both pickers while disconnected', () => {
    const view = render(<ConnectionMenu manager={manager()} active={device('disconnected')} />)
    fireEvent.click(view.getByLabelText(/^Connection:/))
    const panel = within(openPanel())
    expect(panel.getByText('Connect over serial')).toBeTruthy()
    expect(panel.getByText('Connect over Bluetooth')).toBeTruthy()
  })

  it('disables the Bluetooth picker where the browser has no Web Bluetooth', () => {
    // jsdom has no `navigator.bluetooth`: a dead button, not a silent failure.
    const view = render(<ConnectionMenu manager={manager()} active={device('connected')} />)
    fireEvent.click(view.getByLabelText(/^Connection:/))
    const bluetooth = within(openPanel()).getByText('Add over Bluetooth').closest('button')
    expect(bluetooth?.disabled).toBe(true)
  })

  it('closes once an action is taken, rather than sitting over the page', () => {
    const known = manager()
    const view = render(<ConnectionMenu manager={known} active={device('connected')} />)
    fireEvent.click(view.getByLabelText(/^Connection:/))
    fireEvent.click(within(openPanel()).getByText('Disconnect'))
    expect(known.disconnect).toHaveBeenCalled()
    expect(() => openPanel()).toThrow()
  })
})
