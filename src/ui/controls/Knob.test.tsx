// @vitest-environment jsdom
/**
 * `Knob.onCommit`, spec §7.2: the noise dial drafts while the pointer is down
 * and writes once, on release.
 *
 * The trap this file exists for is that the knob's `value` prop *is* the draft
 * once a caller wires it to `useCommittedValue` — the last `pointermove` has
 * already moved it, so "has the value changed?" asked against that prop is
 * always false at release. The gesture has to be measured against the value it
 * started from, as `Fader` does with its `startRef`.
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { fractionToValue } from './knobGeometry'
import { Knob } from './Knob'
import { useCommittedValue } from './useCommittedValue'

const RANGE = { min: 0, max: 100 }
/** The 200×200 box jsdom reports, so the geometry below is a real one. */
const BOX = { left: 0, top: 0, width: 200, height: 200 }

/**
 * jsdom has no layout and no pointer capture. The box is stubbed so
 * `getBoundingClientRect` is meaningful, and the two capture calls are stubbed
 * because the component makes them unconditionally — a real browser has both.
 */
Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
  return { ...BOX, right: BOX.left + BOX.width, bottom: BOX.top + BOX.height, x: BOX.left, y: BOX.top, toJSON: () => BOX } as DOMRect
}
Element.prototype.setPointerCapture = () => undefined
Element.prototype.releasePointerCapture = () => undefined

afterEach(cleanup)

/** A point on the dial `degrees` clockwise from 12 o'clock, as the knob measures it. */
const at = (degrees: number) => ({
  clientX: BOX.left + BOX.width / 2 + 60 * Math.sin((degrees * Math.PI) / 180),
  clientY: BOX.top + BOX.height / 2 - 60 * Math.cos((degrees * Math.PI) / 180),
})

/** The value the knob derives from a point, so the test never hardcodes one. */
const valueAt = (degrees: number): number =>
  Math.round(fractionToValue((degrees + 135) / 270, RANGE))

interface Dial {
  knob(): HTMLElement
  readout(): string
  onCommit: ReturnType<typeof vi.fn>
}

/**
 * The knob wired the way `sennheiser/sections/Noise.tsx` wires it: the prop is
 * the device's reading, the draft is local, and only the commit writes.
 */
function dial(level: number, options: { detent?: number } = {}): Dial {
  const onCommit = vi.fn()

  function NoiseDial() {
    const [draft, setDraft, commit] = useCommittedValue(level)
    return (
      <>
        <Knob
          value={draft}
          onChange={setDraft}
          onCommit={(next) => {
            commit(next)
            onCommit(next)
          }}
          range={RANGE}
          step={1}
          detent={options.detent}
          label="Noise control level"
          caption={`${draft}`}
        />
        <span data-slot="readout">{draft}</span>
      </>
    )
  }

  const view = render(<NoiseDial />)
  return {
    knob: () => view.getByLabelText('Noise control level'),
    readout: () => view.container.querySelector('[data-slot="readout"]')?.textContent ?? '',
    onCommit,
  }
}

describe('Knob commit', () => {
  it('writes once on release, not once per move, and lets the draft go', () => {
    const { knob, readout, onCommit } = dial(50)
    const svg = knob()

    fireEvent.pointerDown(svg, at(0))
    fireEvent.pointerMove(svg, at(60))
    expect(readout()).toBe(String(valueAt(60)))

    // The whole point: at release the knob's `value` prop already *is* the
    // draft, so a change measured against it looks like no change at all.
    fireEvent.pointerUp(svg, at(60))

    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(valueAt(60))
    // And the draft is released, so the device's own reading is on show again
    // rather than the dragged value being pinned there for good.
    expect(readout()).toBe('50')
    expect(knob().getAttribute('aria-valuenow')).toBe('50')
  })

  it('writes nothing when the pointer goes down and up without moving', () => {
    const { knob, readout, onCommit } = dial(50)
    const svg = knob()

    fireEvent.pointerDown(svg, at(0))
    fireEvent.pointerUp(svg, at(0))

    expect(onCommit).not.toHaveBeenCalled()
    expect(readout()).toBe('50')
  })

  it('commits the detent a release snaps to', () => {
    // The snap is only applied on release, so a release near the detent has to
    // commit the snapped value rather than the raw one — or the dial and the
    // headphones would disagree about what was set.
    const { knob, readout, onCommit } = dial(20, { detent: 50 })
    const svg = knob()

    fireEvent.pointerDown(svg, at(180))
    expect(readout()).toBe(String(valueAt(180)))

    // 9° clockwise is within the default 4 of the detent.
    fireEvent.pointerUp(svg, at(9))

    expect(onCommit).toHaveBeenCalledExactlyOnceWith(50)
    expect(readout()).toBe('20')
  })

  it('releases the draft when a gesture is cancelled, rather than pinning it', () => {
    // A cancelled drag has still moved the dial. Leaving the draft there would
    // show a value the headphones never took and mask every later reading.
    const { knob, readout, onCommit } = dial(50)
    const svg = knob()

    fireEvent.pointerDown(svg, at(0))
    fireEvent.pointerMove(svg, at(60))
    expect(readout()).toBe(String(valueAt(60)))

    fireEvent.pointerCancel(svg)

    expect(onCommit).toHaveBeenCalledExactlyOnceWith(valueAt(60))
    expect(readout()).toBe('50')
  })

  it('commits one write per key press, as the pointer path does', () => {
    const { knob, readout, onCommit } = dial(50)
    const svg = knob()

    fireEvent.keyDown(svg, { key: 'ArrowUp' })

    expect(onCommit).toHaveBeenCalledExactlyOnceWith(51)
    expect(readout()).toBe('50')
  })
})
