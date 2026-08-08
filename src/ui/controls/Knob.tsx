import { useCallback, useId, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import { arcPath, keyboardValue, pointerToValue, polar, valueToAngle } from './knobGeometry'
import type { Range } from './knobGeometry'

interface KnobProps {
  value: number
  onChange(value: number): void
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

  const emit = useCallback(
    (next: number, snap: boolean) => {
      const settled =
        snap && detent !== undefined && Math.abs(next - detent) <= detentTolerance
          ? detent
          : next
      const rounded = step >= 1 ? Math.round(settled) : settled
      if (rounded !== value) onChange(rounded)
    },
    [detent, detentTolerance, onChange, step, value],
  )

  const track = useCallback(
    (event: { clientX: number; clientY: number }, snap: boolean) => {
      const svg = svgRef.current
      if (!svg) return
      const box = svg.getBoundingClientRect()
      const dx = event.clientX - (box.left + box.width / 2)
      const dy = event.clientY - (box.top + box.height / 2)
      emit(pointerToValue(dx, dy, range), snap)
    },
    [emit, range],
  )

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
            'focus-visible:ring-ring/60 focus-visible:ring-2 focus-visible:ring-offset-2',
            'focus-visible:ring-offset-background',
            disabled ? 'opacity-40' : dragging ? 'cursor-grabbing' : 'cursor-grab',
          )}
          onPointerDown={(event) => {
            if (disabled) return
            event.currentTarget.setPointerCapture(event.pointerId)
            setDragging(true)
            track(event, false)
          }}
          onPointerMove={(event) => {
            if (dragging) track(event, false)
          }}
          onPointerUp={(event) => {
            if (!dragging) return
            setDragging(false)
            track(event, true)
          }}
          onPointerCancel={() => setDragging(false)}
          onKeyDown={(event) => {
            if (disabled) return
            const next = keyboardValue(event.key, value, range, {
              shift: event.shiftKey,
              step,
            })
            if (next === null) return
            event.preventDefault()
            emit(next, false)
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
