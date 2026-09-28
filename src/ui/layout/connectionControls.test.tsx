import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ConnectionControls, DevicePickers } from './ConnectionControls'
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

/**
 * Every button in the roomy layout, which is a phone menu and the empty-state
 * hero. Spec §8 asks for 44px targets on a phone, and the two pickers already
 * have it; the connected branch's Refresh / Disconnect pair did not, so a menu
 * whose first two rows are 31px pills and whose last two are 44px reads as two
 * different menus.
 */
describe('ConnectionControls — the phone menu rows are 44px', () => {
  /** The class list of every button in the markup, in document order. */
  const buttonsIn = (html: string): string[] =>
    [...html.matchAll(/<button[^>]*\sclass="([^"]*)"/g)].map((match) => match[1])

  it('grows the connected branch to the floor on a phone, and back from md', () => {
    // Refresh, Disconnect, Add over serial, Add over Bluetooth — all four.
    const buttons = buttonsIn(controls('connected'))
    expect(buttons).toHaveLength(4)
    for (const classes of buttons) {
      expect(classes).toContain('min-h-11')
      // …and the guide's own pill height from `md`, where this whole layout is
      // only reachable from the empty-state hero and the pointer is a mouse.
      expect(classes).toContain('md:min-h-0')
    }
  })

  it('keeps the two disconnected pickers at the floor too', () => {
    for (const classes of buttonsIn(controls('disconnected'))) {
      expect(classes).toContain('min-h-11')
    }
  })

  it('carries the same floor on the desktop bar’s own pickers', () => {
    // `DevicePickers` is a separate exported component and a separate call site:
    // the desktop bar's "Add device" popover and its "Connect" pill row both
    // render it directly, with no `ConnectionControls` around it. Rendering it
    // here is the point — the test above reaches it only through the connected
    // branch, so a change to *this* component could leave that test green while
    // the desktop bar's pair went back to 31px.
    const manager = {
      connect: async () => undefined,
      connectBluetooth: async () => undefined,
      disconnect: async () => undefined,
      refresh: async () => undefined,
    } as unknown as DeviceManager
    const html = renderToStaticMarkup(
      <DevicePickers manager={manager} status="disconnected" verb="Add" />,
    )
    const buttons = buttonsIn(html)
    expect(buttons).toHaveLength(2)
    for (const classes of buttons) {
      expect(classes).toContain('min-h-11')
      // …and the guide's own pill height from `md`: this component renders *in*
      // the desktop bar, so a 44px pill row there is the floor winning over the
      // design, and the `md:` twin is what stops it.
      expect(classes).toContain('md:min-h-0')
    }
  })
})
