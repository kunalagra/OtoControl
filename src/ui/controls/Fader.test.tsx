// @vitest-environment jsdom
/**
 * The fader's contract with a device, spec §7.2: a drag writes nothing until
 * the pointer is released, then writes exactly once.
 *
 * The rest of the UI tier is asserted against `renderToStaticMarkup` in the
 * node environment, which cannot fire a pointer. This file is the one place
 * that needs an interaction, so it asks for jsdom with the docblock above
 * rather than moving the whole suite off node.
 *
 * A drag is scripted the way the browser delivers it: pointerdown, then an
 * `input` event per tick (React surfaces that as `onChange`), then pointerup.
 * Keyboard is the same shape, with the tick between keydown and keyup.
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Fader } from './Fader'
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

const RANGE = { min: -10, max: 10 }

interface Harness {
  /** The invisible native range input, which is the whole hit area. */
  input: HTMLInputElement
  readout(): string
  onCommit: ReturnType<typeof vi.fn>
  onChange: ReturnType<typeof vi.fn>
}

function fader(value: number | undefined, props: Partial<Parameters<typeof Fader>[0]> = {}): Harness {
  const onCommit = vi.fn()
  const onChange = vi.fn()
  const view = render(
    <Fader
      value={value}
      onCommit={onCommit}
      onChange={onChange}
      range={RANGE}
      label="100 Hz gain in decibels"
      caption="100"
      {...props}
    />,
  )
  const input = view.getByLabelText('100 Hz gain in decibels') as HTMLInputElement
  const readout = () =>
    view.container.querySelector('[data-slot="fader-readout"]')?.textContent ?? ''
  return { input, readout, onCommit, onChange }
}

/** Pointer down, one `input` event per tick, then the release. */
function drag(input: HTMLInputElement, ...ticks: string[]): void {
  fireEvent.pointerDown(input)
  for (const tick of ticks) fireEvent.change(input, { target: { value: tick } })
  fireEvent.pointerUp(input)
}

describe('Fader', () => {
  it('writes nothing while the pointer is down, then commits exactly once on release', () => {
    const { input, onCommit } = fader(0)

    fireEvent.pointerDown(input)
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.change(input, { target: { value: '7.5' } })
    expect(onCommit).not.toHaveBeenCalled()

    fireEvent.pointerUp(input)

    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(7.5)
  })

  it('keeps rendering the draft while a value prop arrives mid-drag, and takes the prop back after', () => {
    // The device answers a write a beat later, and a preset click elsewhere can
    // land mid-drag. Neither may yank the fader out from under the pointer.
    const onCommit = vi.fn()
    const view = render(
      <Fader
        value={0}
        onCommit={onCommit}
        range={RANGE}
        label="100 Hz gain in decibels"
        caption="100"
      />,
    )
    const input = view.getByLabelText('100 Hz gain in decibels') as HTMLInputElement
    const readout = () =>
      view.container.querySelector('[data-slot="fader-readout"]')?.textContent ?? ''

    fireEvent.pointerDown(input)
    fireEvent.change(input, { target: { value: '5' } })
    view.rerender(
      <Fader
        value={-2}
        onCommit={onCommit}
        range={RANGE}
        label="100 Hz gain in decibels"
        caption="100"
      />,
    )
    expect(readout()).toBe('+5.0')

    fireEvent.pointerUp(input)
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(5)

    // Commit ended the interaction, so the caller owns the value again.
    view.rerender(
      <Fader
        value={-2}
        onCommit={onCommit}
        range={RANGE}
        label="100 Hz gain in decibels"
        caption="100"
      />,
    )
    expect(readout()).toBe('-2.0')
  })

  it('drops a drag that the fader was disabled in the middle of', () => {
    // The headphones dropped mid-drag: the pointerup never reaches a disabled
    // input. On reconnect the fader must show what was read back, not the
    // abandoned draft, and the next interaction must start from scratch.
    const onCommit = vi.fn()
    const props = { onCommit, range: RANGE, label: '100 Hz gain in decibels', caption: '100' }
    const view = render(<Fader value={0} {...props} />)
    const input = view.getByLabelText('100 Hz gain in decibels') as HTMLInputElement
    const readout = () =>
      view.container.querySelector('[data-slot="fader-readout"]')?.textContent ?? ''

    fireEvent.pointerDown(input)
    fireEvent.change(input, { target: { value: '5' } })
    view.rerender(<Fader value={0} disabled {...props} />)
    view.rerender(<Fader value={-2} {...props} />)

    expect(readout()).toBe('-2.0')
    expect(onCommit).not.toHaveBeenCalled()

    // A fresh key press is judged against the value it started at, -2.
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.change(input, { target: { value: '-1.5' } })
    fireEvent.keyUp(input, { key: 'ArrowUp' })
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(-1.5)
  })

  it('commits once per arrow key, not once per event', () => {
    const { input, onCommit } = fader(0)

    // A browser delivers keydown, the value change, then keyup — all before
    // React re-renders, so the commit cannot read state the change set.
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.change(input, { target: { value: '0.5' } })
    fireEvent.keyUp(input, { key: 'ArrowUp' })
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(0.5)

    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.change(input, { target: { value: '1' } })
    fireEvent.keyUp(input, { key: 'ArrowUp' })
    expect(onCommit).toHaveBeenCalledTimes(2)
    expect(onCommit).toHaveBeenLastCalledWith(1)
  })

  it('commits the end of the range when a key is held until it stops moving', () => {
    // Auto-repeat delivers a keydown per repeat and one keyup at the end. The
    // repeats that can no longer move the value must not re-anchor the start,
    // or the keyup sees "no change" and the fader snaps back to where it was.
    const top = String(RANGE.max)
    const nearTop = String(RANGE.max - 0.5)
    const { input, onCommit } = fader(RANGE.max - 1)

    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.change(input, { target: { value: nearTop } })
    fireEvent.keyDown(input, { key: 'ArrowUp', repeat: true })
    fireEvent.change(input, { target: { value: top } })
    // Pinned at the top: the repeat arrives, the value cannot move.
    fireEvent.keyDown(input, { key: 'ArrowUp', repeat: true })
    fireEvent.keyUp(input, { key: 'ArrowUp' })

    expect(onCommit).toHaveBeenCalledExactlyOnceWith(RANGE.max)
  })

  it('does not write at all when a key press leaves the value where it was', () => {
    const { input, onCommit } = fader(10)

    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyUp(input, { key: 'ArrowUp' })

    expect(onCommit).not.toHaveBeenCalled()
  })

  it('reports every tick to the optional live-preview hook without treating it as a commit', () => {
    const { input, onCommit, onChange } = fader(0)

    drag(input, '5', '7.5')

    expect(onChange.mock.calls).toEqual([[5], [7.5]])
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(7.5)
  })

  it('shows a dash rather than a zero for a band it has no reading for', () => {
    const { readout } = fader(undefined)
    expect(readout()).toBe('—')
  })

  /**
   * The mouse release that leaves the fader.
   *
   * A touch pointer is captured implicitly — the spec hands it to the target on
   * touchstart — so dragging off a fader and lifting works. A mouse pointer is
   * not: it is delivered to whatever is under it, so a drag that leaves the 44px
   * input and is released over the page sends its `pointerup` to the page. The
   * fader never hears about it, the draft stays pinned at a value nothing will
   * ever confirm, and the band is never written at all.
   *
   * `setPointerCapture` on `pointerdown` is the whole fix, and the release below
   * is delivered to `document.body` on purpose: with the shim in
   * `pointerCapture.test-helper.ts` this is the real browser event, and without
   * the capture call there is nothing to deliver it to.
   */
  it('commits when a mouse drag is released outside the fader', () => {
    const { input, onCommit } = fader(0)
    const POINTER = 7

    fireEvent.pointerDown(input, { pointerId: POINTER })
    fireEvent.change(input, { target: { value: '5' } })
    expect(onCommit).not.toHaveBeenCalled()

    // The pointer is over the page by now, not over the fader.
    deliverPointer('pointerup', { pointerId: POINTER }, document.body)

    expect(onCommit).toHaveBeenCalledExactlyOnceWith(5)
  })

  it('takes the capture on pointerdown, for the pointer that started the drag', () => {
    // The mechanism, asserted directly rather than only through its effect: a
    // future edit that captures the wrong pointer id, or captures on `pointerup`
    // — too late, the release has already been delivered elsewhere — would
    // still pass a test that only watched the commit.
    const { input } = fader(0)
    expect(input.hasPointerCapture(7)).toBe(false)
    fireEvent.pointerDown(input, { pointerId: 7 })
    expect(input.hasPointerCapture(7)).toBe(true)
  })
})

/**
 * The look, DESIGN-GUIDE §5.7. Nothing here measures a box — jsdom has no
 * layout — so what it pins is the class contract: which utility carries which
 * intent. A 44px track, a 1px zero line at 30% foreground and an 18px/800
 * readout are the whole difference between the Mono fader and a grey bar, and
 * a regression that swaps one for another has to fail here.
 */
describe('Fader look', () => {
  const slots = (view: ReturnType<typeof render>, name: string) => {
    const el = view.container.querySelector(`[data-slot="${name}"]`)
    if (!el) throw new Error(`no ${name} in the fader`)
    return el
  }

  it('draws a 44px rounded track on the raised surface, with a 1px zero line', () => {
    const view = render(
      <Fader value={0} onCommit={() => {}} range={RANGE} label="100 Hz gain" caption="100" />,
    )
    const track = slots(view, 'fader-track')
    expect(track.className).toContain('bg-surface-raised')
    expect(track.className).toContain('rounded-full')
    expect(track.getAttribute('style')).toContain('width: 44px')
    // Eight bands on a 390px phone cannot each have 44px, so the track gives way
    // rather than overlapping its neighbour.
    expect(track.getAttribute('style')).toContain('max-width: 100%')

    const zero = slots(view, 'fader-zero')
    expect(zero.className).toContain('bg-foreground/30')
    expect(zero.className).toContain('h-px')
  })

  it('grows the fill from the zero line, up for a boost and down for a cut', () => {
    const boosted = render(
      <Fader value={5} onCommit={() => {}} range={RANGE} label="100 Hz gain" caption="100" />,
    )
    const boostFill = slots(boosted, 'fader-fill').getAttribute('style') ?? ''
    // Halfway up a -10…+10 range: from the middle to a quarter from the top.
    expect(boostFill).toContain('top: 25%')
    expect(boostFill).toContain('bottom: 50%')

    const cut = render(
      <Fader value={-5} onCommit={() => {}} range={RANGE} label="100 Hz gain" caption="100" />,
    )
    const cutFill = slots(cut, 'fader-fill').getAttribute('style') ?? ''
    expect(cutFill).toContain('top: 50%')
    expect(cutFill).toContain('bottom: 25%')
  })

  it('moves no position by transition: colour and the ring only', () => {
    const view = render(
      <Fader value={0} onCommit={() => {}} range={RANGE} label="100 Hz gain" caption="100" />,
    )
    // `transition-colors` cannot animate `top` or `bottom`, which is the point:
    // the fill follows the finger, and easing on it would be lag.
    for (const slot of ['fader-fill', 'fader-readout', 'fader-caption']) {
      expect(slots(view, slot).className).toContain('transition-colors')
    }
    for (const slot of ['fader-fill', 'fader-readout', 'fader-caption']) {
      expect(slots(view, slot).className).not.toMatch(/transition-all|transition-\[all/)
    }
  })

  it('rings the track and reddens the fill and readout only while it is held', () => {
    const view = render(
      <Fader value={0} onCommit={() => {}} range={RANGE} label="100 Hz gain" caption="100" />,
    )
    const input = view.getByLabelText('100 Hz gain')
    expect(slots(view, 'fader-track').className).not.toContain('ring-signal')
    expect(slots(view, 'fader-fill').className).toContain('bg-foreground')

    fireEvent.pointerDown(input)

    expect(slots(view, 'fader-track').className).toContain('ring-2')
    expect(slots(view, 'fader-track').className).toContain('ring-signal')
    expect(slots(view, 'fader-track').getAttribute('data-active')).toBe('true')
    expect(slots(view, 'fader-fill').className).toContain('bg-signal')
    // Split into a token list, not `toContain`: `text-signal` is a *prefix* of
    // `text-signal-strong`, so the substring form passed with the wrong class in
    // place — and the wrong class is the whole point of this assertion. Red text
    // goes through `--signal-strong` (spec §8: `#ff4d3d` is 3.3:1 on white, and
    // the desk is `#f2f2f2` in light), so this must name the strong token and
    // nothing else.
    const readoutClasses = slots(view, 'fader-readout').className.split(' ')
    expect(readoutClasses).toContain('text-signal-strong')
    expect(readoutClasses).not.toContain('text-signal')
    // The caption goes to full foreground rather than red: red marks the value
    // being changed, and the caption is not a value.
    expect(slots(view, 'fader-caption').className).toContain('text-foreground')
  })

  it('sets the readout in the readout role: 18px, 800, tabular, one decimal', () => {
    const view = render(
      <Fader value={2.5} onCommit={() => {}} range={RANGE} label="100 Hz gain" caption="100" />,
    )
    const readout = slots(view, 'fader-readout')
    for (const wanted of ['text-[18px]', 'font-extrabold', 'tabular-nums']) {
      expect(readout.className).toContain(wanted)
    }
    expect(readout.textContent).toBe('+2.5')
  })

  it('keeps the native range input invisible and on top of the drawn track', () => {
    const view = render(
      <Fader value={0} onCommit={() => {}} range={RANGE} label="100 Hz gain" caption="100" />,
    )
    const input = view.getByLabelText('100 Hz gain')
    expect(input.className).toContain('opacity-0')
    expect(input.className).toContain('z-10')
    // A vertical range, so the platform's own dragging maps to the track.
    expect(input.getAttribute('style')).toContain('writing-mode: vertical-lr')
  })

  it('sizes the track from the column, and never from a percentage of the page', () => {
    // The bug this pins, measured in Chrome before it was fixed: a 220px fader
    // drew an 844px track inside an 844px phone viewport, and an 890px desk in an
    // 800px desktop window. The input was an in-flow flex item with `h-full`, and
    // the chain above it was `flex-1` all the way into an indefinite column — so
    // the percentage resolved against the nearest ancestor with a definite height,
    // which was the scroll container, and the whole fader grew to the window.
    //
    // Three assertions, one per link in the fix: the input is out of flow, the
    // box it is positioned against has no automatic minimum, and the column is
    // the one that carries the 220px floor. A class-shape test cannot see the
    // resolved height, so this is a guard against the shape coming back rather
    // than proof of the number — the numbers are in the task report.
    const view = render(
      <Fader value={0} onCommit={() => {}} range={RANGE} label="100 Hz gain" caption="100" />,
    )
    const input = view.getByLabelText('100 Hz gain')
    // `absolute` is the half that stops it sizing anything…
    expect(input.className).toContain('absolute')
    expect(input.className).not.toMatch(/(^|\s)relative(\s|$)/)
    // …and `h-full` is the half that makes the drag area the whole track, because
    // Chrome's intrinsic height for a range is 129px and only a percentage beats
    // it. The two together are only safe because of the `min-h-0` asserted below.
    expect(input.className).toContain('h-full')
    // `inset-y-0` and never `inset-0`: a `left: 0` would win over `right: 0` and
    // pin the hit area to the wrapper's left edge.
    expect(input.className).toContain('inset-y-0')
    expect(input.className).not.toMatch(/(^|\s)inset-0(\s|$)/)
    // Centred by hand, because the wrapper's `justify-center` cannot centre an
    // absolutely positioned child that carries its own `writing-mode` — measured
    // 57px off the track it belongs to.
    expect(input.className).toContain('left-1/2')
    expect(input.className).toContain('-translate-x-1/2')

    const wrapper = input.parentElement!
    expect(wrapper.className.split(' ')).toContain('min-h-0')
    expect(wrapper.className).toContain('flex-1')

    const column = view.container.querySelector<HTMLElement>('[data-slot="fader-column"]')!
    expect(column.className).toContain('flex-1')
    expect(column.style.minHeight).toBe('220px')
  })
})
