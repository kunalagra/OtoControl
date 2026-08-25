import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ConnectionControls } from './Sidebar'
import type { ActiveDevice, DeviceManager } from '@/core/manager'
import type { ConnectionStatus } from '@/core/connection'

/**
 * `ConnectionControls` reads only `active.state.status` and calls four manager
 * methods, so a fake of exactly that surface is enough — and keeps the test
 * from depending on any driver's state shape.
 */
const controls = (status: ConnectionStatus, compact = false) => {
  const manager = {
    connect: async () => undefined,
    connectBluetooth: async () => undefined,
    disconnect: async () => undefined,
    refresh: async () => undefined,
  } as unknown as DeviceManager
  const active = { state: { status } } as unknown as ActiveDevice
  return renderToStaticMarkup(
    <ConnectionControls manager={manager} active={active} compact={compact} />,
  )
}

describe('ConnectionControls', () => {
  it('offers both pickers while disconnected', () => {
    const html = controls('disconnected')
    expect(html).toContain('Connect over serial')
    expect(html).toContain('Connect over Bluetooth')
  })

  it('still offers both pickers while connected', () => {
    // The regression this guards: the connected branch used to return early
    // with only Refresh and Disconnect, so a second device could not be added
    // without disconnecting the first — even though `manager.connect()` never
    // needed that.
    const html = controls('connected')
    expect(html).toContain('Add over serial')
    expect(html).toContain('Add over Bluetooth')
  })

  it('keeps Refresh and Disconnect while connected', () => {
    const html = controls('connected')
    expect(html).toContain('Refresh')
    expect(html).toContain('Disconnect')
  })

  it('leaves the compact layout alone, which has no room for them', () => {
    const html = controls('connected', true)
    expect(html).not.toContain('Add over serial')
    expect(html).not.toContain('Disconnect')
  })

  it('disables the pickers mid-connect rather than hiding them', () => {
    const html = controls('connecting')
    expect(html).toContain('Connecting')
    expect(html).toContain('disabled')
  })

  it('says so when the browser has neither transport', () => {
    expect(controls('unsupported')).toContain('Web Serial')
  })
})
