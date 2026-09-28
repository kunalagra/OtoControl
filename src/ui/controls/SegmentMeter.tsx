import { useId, useRef } from 'react'

import { cn } from '@/lib/utils'
import { useCommittedValue } from './useCommittedValue'

/**
 * The segment meter — DESIGN-GUIDE §5.6.
 *
 * The Mono replacement for a continuous progress bar, and the one piece of
 * "how full is this" that a phone-width tile can afford: a battery needs to be
 * readable at a glance from across a desk, and ten blocks say that where a
 * hairline fill does not. It is also honest in a way a smooth bar is not — a
 * tenth is a step the device actually has, not a fraction of a pixel.
 */

/** §5.6: battery reads in tens, a level under a finger in twenties. */
export const BATTERY_SEGMENTS = 10
export const LEVEL_SEGMENTS = 20

/** Within the 8–16px band, and 3px of corner radius, per §5.6 and §3. */
const SEGMENT_HEIGHT = 12

/**
 * What a lit segment is painted in.
 *
 * - `foreground` — the ordinary case, on any tile of its own colour.
 * - `signal` — the value you are changing, which is one of the three things red
 *   is allowed to mean (DESIGN-GUIDE §1.1).
 * - `inverted` — the battery block, which is foreground-*background* in both
 *   themes. A lit segment there is the block's own text colour, not the page's
 *   foreground: white-on-white would read as empty, which is the one thing a
 *   battery meter must never do.
 */
export type SegmentTone = 'foreground' | 'signal' | 'inverted'

const LIT: Record<SegmentTone, string> = {
  foreground: 'bg-foreground',
  signal: 'bg-signal',
  inverted: 'bg-background',
}

interface SegmentMeterProps {
  value: number
  /** The top of the scale. 100 unless the value means something else. */
  max?: number
  segments?: number
  tone?: SegmentTone
  className?: string
  /**
   * Spoken to assistive technology, or omitted when the number is already on
   * screen beside it — a battery tile shows "78%" in 44px type, and a second
   * announcement of the same figure is noise.
   */
  label?: string
}

/**
 * N blocks, as many lit as the level fills.
 *
 * Read-only on purpose: the whole point of the interactive form below is that
 * this stays a picture, so a device reply can redraw it without a drag in
 * progress ever losing its place.
 */
export function SegmentMeter({
  value,
  max = 100,
  segments = BATTERY_SEGMENTS,
  tone = 'foreground',
  className,
  label,
}: SegmentMeterProps) {
  const filled = Math.max(0, Math.min(segments, Math.round((value / max) * segments)))

  return (
    <div
      data-slot="segment-meter"
      className={cn('flex w-full gap-[3px]', className)}
      role={label ? 'meter' : undefined}
      aria-label={label}
      aria-valuenow={label ? Math.round(value) : undefined}
      aria-valuemin={label ? 0 : undefined}
      aria-valuemax={label ? max : undefined}
    >
      {Array.from({ length: segments }, (_, index) => (
        <span
          key={index}
          data-slot="segment"
          data-lit={index < filled ? 'true' : undefined}
          className={cn('flex-1 rounded-[3px]', index < filled ? LIT[tone] : 'bg-segment-off')}
          style={{ height: SEGMENT_HEIGHT }}
        />
      ))}
    </div>
  )
}

/**
 * Keys a native range input moves itself with, each of which is one whole
 * interaction — the browser changes the value between keydown and keyup, and
 * that pair is where the commit belongs. Copied from `Fader`, which measures the
 * same thing for the same reason.
 */
const MOVING_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'PageUp',
  'PageDown',
  'Home',
  'End',
])

interface SegmentLevelProps {
  value: number
  /**
   * Called once, when the interaction ends — spec §7.2. This is the only write.
   */
  onCommit(value: number): void
  /** Per-tick, for the live preview. Nothing writes to a device from here. */
  onChange?(value: number): void
  max?: number
  segments?: number
  step?: number
  tone?: SegmentTone
  disabled?: boolean
  label: string
  className?: string
}

/**
 * The meter as a control: the same picture, with an invisible native range over
 * it — DESIGN-GUIDE §5.6.
 *
 * A native input because the platform owns dragging, the keyboard and the
 * accessibility tree, and a row of eleven divs with a pointer handler owns none
 * of them. It is invisible because the meter is already the thing being looked
 * at; a second thumb beside it would be a second answer to the same question.
 *
 * And it goes through `useCommittedValue` like every other control here: a drag
 * drafts, a release writes once, and a device reply arriving mid-drag cannot
 * move the level under the finger.
 */
export function SegmentLevel({
  value,
  onCommit,
  onChange,
  max = 100,
  segments = LEVEL_SEGMENTS,
  step = 1,
  tone = 'foreground',
  disabled = false,
  label,
  className,
}: SegmentLevelProps) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft, clearDraft] = useCommittedValue(value)
  /**
   * The value the interaction began at. Not the `value` prop: a caller that
   * drafts passes the draft back in, so by release the prop has already moved
   * and "did anything change?" would always be false.
   */
  const startRef = useRef<number | null>(null)

  /**
   * The value the element is showing, which is not always `draft`: a key press
   * moves the native input between the events React can see.
   */
  const shown = (): number => {
    const input = inputRef.current
    return input ? Number(input.value) : draft
  }

  /** Ends the interaction: one write, and only if the value actually moved. */
  const commit = (): void => {
    const next = shown()
    if (startRef.current !== null && startRef.current !== next) onCommit(next)
    startRef.current = null
    clearDraft(next)
  }

  return (
    <div className={cn('relative w-full', className)}>
      <SegmentMeter value={draft} max={max} segments={segments} tone={tone} />
      <input
        id={id}
        ref={inputRef}
        type="range"
        min={0}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => {
          const next = Number(event.target.value)
          setDraft(next)
          onChange?.(next)
        }}
        onPointerDown={(event) => {
          if (disabled) return
          // The same capture `Fader` and `Knob` take, for the same reason: touch
          // pointers are captured implicitly and mouse pointers are not, so a
          // drag released off the meter would deliver its `pointerup` to the
          // page. The level would sit at a draft the device never hears about
          // and the write would never happen.
          event.currentTarget.setPointerCapture(event.pointerId)
          startRef.current = shown()
        }}
        onPointerUp={() => {
          if (disabled) return
          commit()
        }}
        onPointerCancel={() => {
          if (disabled) return
          commit()
        }}
        onKeyDown={(event) => {
          if (disabled || !MOVING_KEYS.has(event.key)) return
          // First keydown only: auto-repeat must not re-anchor (see `Fader`).
          if (startRef.current === null) startRef.current = shown()
        }}
        onKeyUp={(event) => {
          if (disabled || !MOVING_KEYS.has(event.key)) return
          commit()
        }}
        className={cn(
          'absolute inset-0 h-full w-full cursor-pointer opacity-0 touch-none select-none disabled:cursor-default',
          'focus-visible:opacity-20',
        )}
      />
    </div>
  )
}
