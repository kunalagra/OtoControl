import { useCallback, useId, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import { arcPath, keyboardValue, pointerToValue, polar, valueToAngle } from './knobGeometry'
import type { Range } from './knobGeometry'

interface KnobProps {
  value: number
  /** Per-tick, while dragging. For live preview only — see `onCommit`. */
  onChange(value: number): void
  /**
   * Called once, when the interaction ends. Where a device write belongs: the
   * knob is a custom control rather than a native input, so there is no
   * platform "commit" event to lean on, and per-tick writes are what make a
   * drag fight the device's replies (spec §7.1).
   */
  onCommit?(value: number): void
  range?: Range
  /** Arrow-key increment. Page keys move five of these. */
  step?: number
  /** Value the thumb snaps to when released nearby, e.g. a centre detent. */
  detent?: number
  detentTolerance?: number
  disabled?: boolean
  label: string
  /** Spoken instead of the bare number, and shown under the dial. */
  caption?: string
  /** Rendered in the middle of the dial. */
  children?: React.ReactNode
  size?: number
  className?: string
}

const RADIUS = 42
const TRACK_WIDTH = 8
const VIEWBOX = 112

/**
 * Radial control, the way a hardware noise-control dial works.
 *
 * Behaves as an ARIA slider: pointer drag, arrow/Page/Home/End keys, and an
 * `aria-valuetext` so assistive tech reads "Cancelling 60%" rather than "40".
 * All geometry lives in `knobGeometry.ts` and is unit-tested without a DOM.
 */
export function Knob({
  value,
  onChange,
  onCommit,
  range = { min: 0, max: 100 },
  step = 1,
  detent,
  detentTolerance = 4,
  disabled = false,
  label,
  caption,
  children,
  size = 168,
  className,
}: KnobProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragging, setDragging] = useState(false)
  const labelId = useId()
  /**
   * The value a pointer gesture started from, or null when none is live.
   *
   * This cannot be read off `value`: a caller that drafts (as `Noise` does)
   * passes the draft back in as `value`, so by release the prop has already
   * been moved by the last `pointermove` and "did anything change?" is always
   * false. Same reasoning as the fader's `startRef`.
   */
  const startRef = useRef<number | null>(null)

  /** The detent and the step, and nothing else. */
  const settle = useCallback(
    (next: number, snap: boolean): number => {
      const snapped =
        snap && detent !== undefined && Math.abs(next - detent) <= detentTolerance
          ? detent
          : next
      return step >= 1 ? Math.round(snapped) : snapped
    },
    [detent, detentTolerance, step],
  )

  /** The value a pointer position means, or null before the dial is measured. */
  const valueAt = useCallback(
    (event: { clientX: number; clientY: number }): number | null => {
      const svg = svgRef.current
      if (!svg) return null
      const box = svg.getBoundingClientRect()
      const dx = event.clientX - (box.left + box.width / 2)
      const dy = event.clientY - (box.top + box.height / 2)
      return pointerToValue(dx, dy, range)
    },
    [range],
  )

  /** Per tick: drafts only, and only where the value actually moved. */
  const draft = useCallback(
    (next: number, snap: boolean): number | null => {
      const rounded = settle(next, snap)
      if (rounded === value) return null
      onChange(rounded)
      return rounded
    },
    [onChange, settle, value],
  )

  /**
   * The end of an interaction: the value it landed on, or null when it landed
   * where it started. `from` is the value the interaction began at, which for a
   * drag is the gesture's own start rather than the live prop.
   */
  const release = useCallback(
    (from: number, next: number, snap: boolean): number | null => {
      const rounded = settle(next, snap)
      if (rounded === from) return null
      // A release can land somewhere the last tick did not — a detent snap, or
      // a pointerup without a final move — so the draft is brought into step
      // before the value is handed over as the committed one.
      if (rounded !== value) onChange(rounded)
      return rounded
    },
    [onChange, settle, value],
  )

  /**
   * Ends a pointer gesture. A gesture that landed somewhere new commits there.
   * One that moved the caller's draft but landed back where it started — a
   * release snapping onto the detent it began at, say — still has to hand
   * that draft back, or the caller keeps showing a value nothing confirmed.
   * Committing the start value is how it does: a no-op for the headphones,
   * and the one signal a drafting caller already listens for.
   */
  const finish = (from: number, next: number, snap: boolean): void => {
    const settled = release(from, next, snap)
    if (settled !== null) {
      onCommit?.(settled)
    } else if (value !== from) {
      onChange(from)
      onCommit?.(from)
    }
  }

  const thumb = polar(valueToAngle(value, range), RADIUS)
  const detentPoint =
    detent === undefined ? null : polar(valueToAngle(detent, range), RADIUS)

  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          ref={svgRef}
          viewBox={`${-VIEWBOX / 2} ${-VIEWBOX / 2} ${VIEWBOX} ${VIEWBOX}`}
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-labelledby={labelId}
          aria-valuemin={range.min}
          aria-valuemax={range.max}
          aria-valuenow={Math.round(value)}
          aria-valuetext={caption}
          aria-disabled={disabled}
          className={cn(
            'size-full touch-none select-none rounded-full outline-none transition-opacity',
            'focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2',
            'focus-visible:ring-offset-background',
            disabled ? 'opacity-40' : dragging ? 'cursor-grabbing' : 'cursor-grab',
          )}
          onPointerDown={(event) => {
            if (disabled) return
            event.currentTarget.setPointerCapture(event.pointerId)
            startRef.current = value
            setDragging(true)
            const next = valueAt(event)
            if (next !== null) draft(next, false)
          }}
          onPointerMove={(event) => {
            if (!dragging) return
            const next = valueAt(event)
            if (next !== null) draft(next, false)
          }}
          onPointerUp={(event) => {
            if (!dragging) return
            setDragging(false)
            const from = startRef.current
            startRef.current = null
            if (from === null) return
            // An unmeasured dial falls back to where the drag had got to, the
            // same value a cancelled gesture commits.
            finish(from, valueAt(event) ?? value, true)
          }}
          onPointerCancel={() => {
            setDragging(false)
            const from = startRef.current
            startRef.current = null
            if (from === null) return
            // The browser took the gesture away, but the value on screen is the
            // one the user was dragging to. Committing it keeps the dial and the
            // headphones in agreement — and, more to the point, releases the
            // caller's draft instead of leaving it pinned at a value nothing
            // will ever confirm.
            finish(from, value, false)
          }}
          onKeyDown={(event) => {
            if (disabled) return
            const next = keyboardValue(event.key, value, range, {
              shift: event.shiftKey,
              step,
            })
            if (next === null) return
            event.preventDefault()
            // One key press is one interaction, so the commit belongs here.
            // There is no release to wait for on a control this custom, and the
            // value it started at is the one the key was read against.
            const settled = release(value, next, false)
            if (settled !== null) onCommit?.(settled)
          }}
        >
          <path
            d={arcPath(range.min, range.max, RADIUS, range)}
            fill="none"
            strokeWidth={TRACK_WIDTH}
            strokeLinecap="round"
            className="stroke-muted"
          />

          {/* Filled from the detent when there is one, so the arc reads as a
              deviation from centre rather than an absolute amount. */}
          <path
            d={arcPath(detent ?? range.min, value, RADIUS, range)}
            fill="none"
            strokeWidth={TRACK_WIDTH}
            strokeLinecap="round"
            className="stroke-primary"
          />

          {detentPoint && (
            <line
              x1={detentPoint.x * 0.84}
              y1={detentPoint.y * 0.84}
              x2={detentPoint.x * 1.14}
              y2={detentPoint.y * 1.14}
              strokeWidth={1.5}
              strokeLinecap="round"
              className="stroke-muted-foreground/60"
            />
          )}

          <circle
            cx={thumb.x}
            cy={thumb.y}
            r={7}
            strokeWidth={3}
            className="fill-background stroke-primary"
          />
        </svg>

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5 text-center">
          {children}
        </div>
      </div>

      <span id={labelId} className="sr-only">
        {label}
      </span>
    </div>
  )
}
