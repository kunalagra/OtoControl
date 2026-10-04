// @vitest-environment jsdom
/**
 * The empty state — spec §3.2, DESIGN-GUIDE §5.13.
 *
 * A **fake manager and a fake state**, for the same reason `Home.test.tsx` uses
 * a fake driver: what is under test is the shape of the page before any brand
 * is known, and naming a driver would import the thing this state exists
 * because we have not got one.
 *
 * jsdom because the two buttons are the whole point of the page, and what is
 * under test about them is that they still call the manager — the restyling must
 * not have become a second, quieter set of controls.
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ConnectionStatus } from '@/core/connection'
import type { ActiveDevice, DeviceManager } from '@/core/manager'
import { NoDevice } from './NoDevice'

afterEach(cleanup)

/**
 * jsdom's `navigator` has no Web Bluetooth, which is the one thing
 * `AddDevice` asks the browser about — and the Bluetooth button is
 * disabled without it. Declaring the key is the whole of the stub: the picker
 * is only ever called from a click the fake manager never follows.
 */
Object.defineProperty(navigator, 'bluetooth', { value: {}, configurable: true })

const fake = (status: ConnectionStatus = 'disconnected') => {
  const manager = {
    connect: vi.fn(async () => undefined),
    connectBluetooth: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
  } as unknown as DeviceManager
  const active = { state: { status } } as unknown as ActiveDevice
  return { manager, active }
}

/** The hero block itself, which every assertion below is about. */
const hero = (container: HTMLElement): HTMLElement =>
  container.querySelector<HTMLElement>('[data-slot="no-device"]')!

const buttonNamed = (container: HTMLElement, label: string): HTMLButtonElement =>
  Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.textContent?.trim() === label,
  )!

const text = (node: HTMLElement): string => (node.textContent ?? '').replace(/\s+/g, ' ').trim()

describe('NoDevice — one dotted hero', () => {
  it('is a Mono block, not the stock dashed empty frame', () => {
    // DESIGN-GUIDE §5.13: "One .mono-dots hero block that fills the body". The
    // dashed outline it replaces is §1.2's exact prohibition — outlines as
    // grouping — so this is the assertion that the old frame is gone.
    const { container } = render(<NoDevice {...fake()} />)
    const classes = hero(container).className
    expect(classes).toContain('mono-dots')
    expect(classes).toContain('rounded-[26px]')
    expect(classes).not.toContain('border-dashed')
    expect(classes).not.toMatch(/\bborder\b/)
  })

  it('fills the body it is given', () => {
    // The shell hands it a flex column, and a hero that does not grow is a
    // card floating at the top of an empty screen.
    const { container } = render(<NoDevice {...fake()} />)
    expect(hero(container).className).toContain('flex-1')
  })

  it('shows a 96px headphone glyph at 30% foreground, and hides it from a reader', () => {
    const { container } = render(<NoDevice {...fake()} />)
    const glyph = hero(container).querySelector('svg')!
    // `getAttribute`, not `.className`: on an SVG element jsdom hands back an
    // SVGAnimatedString, which `toContain` would read as an empty list.
    const classes = glyph.getAttribute('class') ?? ''
    expect(classes).toContain('size-24')
    expect(classes).toContain('text-foreground/30')
    // A decorative glyph read aloud is noise: the heading below it is the
    // sentence, and this is the picture of it.
    expect(glyph.getAttribute('aria-hidden')).toBe('true')
  })

  it('heads the page with the one line the guide names', () => {
    const { container } = render(<NoDevice {...fake()} />)
    const heading = hero(container).querySelector('h2')!
    expect(text(heading)).toBe('Connect your headphones')
    // Section display: 30px, the top of the guide's 800–850 range, tight
    // tracking (DESIGN-GUIDE §4).
    for (const wanted of ['text-[30px]', 'font-[850]', 'tracking-[-.03em]']) {
      expect(heading.className).toContain(wanted)
    }
  })

  it('explains itself once, in the muted role', () => {
    // The honest half of the old copy stays: which controls appear depends on
    // what the device reports, so a greyed-out dial would be a claim we cannot
    // make. One muted paragraph, and not a second explanation below it.
    const { container } = render(<NoDevice {...fake()} />)
    const paragraphs = Array.from(hero(container).querySelectorAll('p'))
    expect(paragraphs).toHaveLength(1)
    expect(paragraphs[0].className).toContain('text-muted-foreground')
    expect(text(paragraphs[0])).toContain('depend on what they report')
  })
})

describe('NoDevice — the way in', () => {
  it('leads with Add device, which opens the serial picker most brands answer on', () => {
    const { manager, active } = fake()
    const { container } = render(<NoDevice manager={manager} active={active} />)
    const add = buttonNamed(container, 'Add device')
    expect(add.className).toContain('bg-foreground')
    fireEvent.click(add)
    expect(manager.connect).toHaveBeenCalledTimes(1)
    expect(manager.connectBluetooth).not.toHaveBeenCalled()
  })

  it('keeps Bluetooth behind "My device isn\u2019t listed", for the brands that need it', () => {
    // People reached for Bluetooth first, and it is only right for Soundcore and some Nothing models.
    const { manager, active } = fake()
    const { container } = render(<NoDevice manager={manager} active={active} />)
    expect(buttonNamed(container, 'Connect over Bluetooth')).toBeUndefined()
    fireEvent.click(buttonNamed(container, 'My device isn\u2019t listed'))
    expect(text(hero(container))).toContain('Soundcore')
    fireEvent.click(buttonNamed(container, 'Connect over Bluetooth'))
    expect(manager.connectBluetooth).toHaveBeenCalledTimes(1)
  })

  it('keeps Add device a 44px target on a phone', () => {
    const { container } = render(<NoDevice {...fake()} />)
    expect(buttonNamed(container, 'Add device').className).toContain('min-h-11')
  })

  it('disables Add device rather than hiding it while connecting', () => {
    // A button that vanishes mid-connect leaves nothing to retry with.
    const { container } = render(<NoDevice {...fake('connecting')} />)
    expect(buttonNamed(container, 'Connecting').disabled).toBe(true)
  })

  it('names the missing browser instead of offering a button that cannot work', () => {
    // No Web Serial and no Web Bluetooth is not a state to retry, so the hero
    // keeps its heading and swaps the buttons for the reason.
    const { container } = render(<NoDevice {...fake('unsupported')} />)
    const markup = hero(container).outerHTML
    expect(markup).toContain('Connect your headphones')
    expect(markup).toContain('Web Serial')
    expect(container.querySelectorAll('button')).toHaveLength(0)
  })
})
