// @vitest-environment jsdom
/**
 * The device menu beside the name: the one place that says whether the
 * headphones are live, switches between granted devices, adds new ones and
 * holds the connection actions.
 */
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SENNHEISER_DRIVER } from '@/core/driver'
import type { ConnectionStatus } from '@/core/connection'
import type { ActiveDevice, DeviceManager } from '@/core/manager'
import { M4_SERVICE_UUID, SONY_MDR_V2_UUID } from '@/core/transport'
import { DeviceMenu } from '@/ui/layout/DeviceMenu'

afterEach(cleanup)

const manager = (available: DeviceManager['available'] = []): DeviceManager =>
  ({
    hasDevice: true,
    available,
    connect: vi.fn(async () => undefined),
    connectBluetooth: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    select: vi.fn(async () => undefined),
    autoConnect: vi.fn(async () => true),
  }) as unknown as DeviceManager

const device = (status: ConnectionStatus): ActiveDevice => {
  const real = SENNHEISER_DRIVER.create({})
  return {
    id: SENNHEISER_DRIVER.id,
    driver: SENNHEISER_DRIVER,
    device: real,
    state: { ...real.state, status, info: { ...real.state.info, model: 'MOMENTUM 4' } },
  }
}

const openPanel = (): HTMLElement => {
  const open = [...document.querySelectorAll('[data-slot="popover-content"]')].find(
    (panel) => panel.getAttribute('data-open') !== null,
  )
  if (!open) throw new Error('no popover is open')
  return open as HTMLElement
}

const open = (known: DeviceManager, status: ConnectionStatus = 'connected') => {
  const view = render(<DeviceMenu manager={known} active={device(status)} />)
  fireEvent.click(view.getByLabelText('Devices and connection'))
  return within(openPanel())
}

describe('DeviceMenu', () => {
  it('is there with a single device, since it is also where devices are added', () => {
    const view = render(<DeviceMenu manager={manager()} active={device('connected')} />)
    expect(view.getByLabelText('Devices and connection')).toBeTruthy()
  })

  it('says when the device is not live, in words, and says nothing extra when it is', () => {
    const status = (state: ConnectionStatus) => {
      open(manager(), state)
      const line = openPanel().querySelector('[data-slot="device-menu-status"]')?.textContent
      cleanup()
      return line
    }
    // Connected says nothing: the page is live and Refresh / Disconnect only exist then.
    expect(status('connected')).toBeUndefined()
    expect(status('disconnected')).toBe('Disconnected')
    expect(status('connecting')).toBe('Connecting')
  })

  it('adds a device through the serial picker, the way most brands connect', () => {
    const known = manager()
    fireEvent.click(open(known).getByRole('button', { name: 'Add device' }))
    expect(known.connect).toHaveBeenCalled()
    expect(known.connectBluetooth).not.toHaveBeenCalled()
  })

  it('keeps Bluetooth behind "My device isn’t listed", and says who it is for', () => {
    const panel = open(manager())
    expect(panel.queryByRole('button', { name: 'Connect over Bluetooth' })).toBeNull()
    fireEvent.click(panel.getByRole('button', { name: 'My device isn’t listed' }))
    // Revealing it is not an action: the menu stays open to show what it revealed.
    const still = within(openPanel())
    expect(still.getByText(/Soundcore/)).toBeTruthy()
    expect(still.getByRole('button', { name: 'Connect over Bluetooth' })).toBeTruthy()
  })

  it('holds refresh and disconnect while connected, and closes once one is used', () => {
    const known = manager()
    const panel = open(known)
    expect(panel.getByRole('button', { name: /Refresh/ })).toBeTruthy()
    fireEvent.click(panel.getByRole('button', { name: 'Disconnect' }))
    expect(known.disconnect).toHaveBeenCalled()
    expect(() => openPanel()).toThrow()
  })

  it('offers no refresh or disconnect while disconnected', () => {
    const panel = open(manager(), 'disconnected')
    expect(panel.queryByRole('button', { name: 'Disconnect' })).toBeNull()
  })

  it('lists every granted device and switches to another', () => {
    const known = manager([
      { uuid: M4_SERVICE_UUID, brand: 'sennheiser', label: 'MOMENTUM 4' },
      { uuid: SONY_MDR_V2_UUID, brand: 'sony', label: 'WF-C500' },
    ])
    const panel = open(known)
    fireEvent.click(panel.getByRole('button', { name: 'WF-C500' }))
    expect(known.select).toHaveBeenCalledWith(SONY_MDR_V2_UUID)
  })

  it('marks the device in use rather than offering to switch to it', () => {
    const known = manager([
      { uuid: M4_SERVICE_UUID, brand: 'sennheiser', label: 'MOMENTUM 4' },
      { uuid: SONY_MDR_V2_UUID, brand: 'sony', label: 'WF-C500' },
    ])
    const current = open(known).getByRole('button', { name: /MOMENTUM 4/ })
    expect(current.getAttribute('aria-current')).toBe('true')
    fireEvent.click(current)
    expect(known.select).not.toHaveBeenCalled()
  })
})
