// @vitest-environment jsdom
/**
 * The segment meter, and the control built on it — DESIGN-GUIDE §5.6.
 *
 * Two things are worth testing and neither is about pixels: how many segments a
 * level lights (so 78% is 8 of 10, not 7 or all of them), and that the
 * interactive form writes once on release. The second is the §7.2 contract
 * every control here shares, and it is the one a drag gets wrong.
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SegmentLevel, SegmentMeter } from './SegmentMeter'
import {
  deliverPointer,
  installPointerCapture,
  resetPointerCapture,
} from './pointerCapture.test-helper'

// jsdom has no pointer capture; the shim models its one rule, and the tests
// below are the ones that depend on it.
installPointerCapture()

afterEach(() => {
  cleanup()
  resetPointerCapture()
})

const lit = (container: HTMLElement): number =>
  container.querySelectorAll('[data-slot="segment"][data-lit="true"]').length

describe('SegmentMeter', () => {
  it('draws the segments it is asked for, and lights the level', () => {
    const { container } = render(<SegmentMeter value={78} segments={10} />)
    const meter = container.querySelector('[data-slot="segment-meter"]')!
    expect(meter.children).toHaveLength(10)
    expect(lit(container)).toBe(8)
  })

  it('is denser for a noise level than for a battery', () => {
    // §5.6: ten for a battery, twenty for a level that moves under a finger.
    const { container } = render(<SegmentMeter value={35} segments={20} />)
    expect(container.querySelectorAll('[data-slot="segment"]')).toHaveLength(20)
    expect(lit(container)).toBe(7)
  })

  it('reads the value against a max other than 100', () => {
    const { container } = render(<SegmentMeter value={5} max={10} segments={10} />)
    expect(lit(container)).toBe(5)
  })

  it('never lights more than it drew, whatever the level says', () => {
    const { container } = render(<SegmentMeter value={140} segments={10} />)
    expect(lit(container)).toBe(10)
  })

  it('lights the signal tone on request, and leaves the rest unlit in one colour', () => {
    const { container } = render(<SegmentMeter value={50} segments={4} tone="signal" />)
    const segments = Array.from(container.querySelectorAll<HTMLElement>('[data-slot="segment"]'))
    expect(segments[0].className).toContain('bg-signal')
    // Unlit segments read as unlit, whatever the tone: the lit ones are the
    // only ones wearing the accent.
    expect(segments[3].className).toContain('bg-segment-off')
    expect(segments[3].className).not.toContain('bg-signal')
  })

  it('is the block’s own contrast colour on the inverted battery strip', () => {
    // White block in dark mode, black in light: `--background` is the colour
    // that contrasts with whichever way the block went, so the meter follows the
    // theme rather than hard-coding a second black.
    const { container } = render(<SegmentMeter value={5} segments={10} tone="inverted" />)
    const segment = container.querySelector<HTMLElement>('[data-slot="segment"][data-lit="true"]')!
    expect(segment.className).toContain('bg-background')
    expect(segment.className).not.toContain('bg-foreground')
  })
})

describe('SegmentLevel', () => {
  const level = (value: number) => {
    const onCommit = vi.fn()
    const onChange = vi.fn()
    const view = render(
      <SegmentLevel
        value={value}
        onCommit={onCommit}
        onChange={onChange}
        label="Noise control level"
      />,
    )
    return {
      input: view.getByLabelText('Noise control level') as HTMLInputElement,
      view,
      onCommit,
      onChange,
    }
  }

  /** Pointer down, one `input` event per tick, then the release. */
  const drag = (input: HTMLInputElement, ...ticks: string[]) => {
    fireEvent.pointerDown(input)
    for (const tick of ticks) fireEvent.change(input, { target: { value: tick } })
    fireEvent.pointerUp(input)
  }

  it('writes nothing while the pointer is down, then commits once on release', () => {
    // The §7.2 contract, same as the fader: a burst of writes per drag is what
    // made the control fight the device's replies.
    const { input, view, onCommit, onChange } = level(40)
    fireEvent.pointerDown(input)
    fireEvent.change(input, { target: { value: '55' } })
    fireEvent.change(input, { target: { value: '70' } })
    // The meter followed the pointer, with no transition to lag behind it.
    expect(lit(view.container)).toBe(14)
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.pointerUp(input)
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(70)
  })

  it('does not write at all when the drag ends where it started', () => {
    const { input, onCommit } = level(40)
    drag(input, '40')
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('treats a key press as one interaction, not a per-tick write', () => {
    const { input, onCommit } = level(40)
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.change(input, { target: { value: '41' } })
    fireEvent.keyUp(input, { key: 'ArrowUp' })
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(41)
  })

  it('keeps the draft on screen until the commit lands', () => {
    // A device reply arriving mid-drag must not move the control under the
    // finger; the prop owns the value again only after the release.
    const { input, view, onCommit } = level(40)
    fireEvent.pointerDown(input)
    fireEvent.change(input, { target: { value: '90' } })
    expect(lit(view.container)).toBe(18)
    fireEvent.pointerUp(input)
    expect(onCommit).toHaveBeenCalledWith(90)
  })

  it('is disabled when the caller says the level is unknown or not connected', () => {
    const view = render(
      <SegmentLevel value={0} onCommit={() => undefined} label="Noise level, idle" disabled />,
    )
    expect((view.getByLabelText('Noise level, idle') as HTMLInputElement).disabled).toBe(true)
  })

  /**
   * The same off-element release the fader had, for the same reason: a mouse
   * pointer is not implicitly captured, so a drag off a 20-segment meter and a
   * release over the page never reached the `pointerup` handler — the level
   * moved under the finger and was never written. The shim in
   * `pointerCapture.test-helper.ts` makes `document.body` the real target of
   * the release, so this fails for the bug rather than for a missing stub.
   */
  it('commits when a mouse drag is released outside the meter', () => {
    const { input, onCommit } = level(40)
    const POINTER = 3

    fireEvent.pointerDown(input, { pointerId: POINTER })
    fireEvent.change(input, { target: { value: '75' } })
    expect(onCommit).not.toHaveBeenCalled()

    deliverPointer('pointerup', { pointerId: POINTER }, document.body)

    expect(onCommit).toHaveBeenCalledExactlyOnceWith(75)
  })
})
