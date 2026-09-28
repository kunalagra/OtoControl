import { useId, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import { valueToFraction } from './knobGeometry'
import type { Range } from './knobGeometry'

interface FaderProps {
  value: number | undefined
  /** Called once, when the interaction ends. This is the only device write. */
  onCommit(value: number): void
  /**
   * Per-tick, for a live preview only. Nothing writes to a device from here —
   * see `useCommittedValue` for why.
   */
  onChange?(value: number): void
  range: Range
  step?: number
  disabled?: boolean
  label: string
  /** Shown under the fader, e.g. the band's centre frequency. */
  caption: string
  /** Minimum height of the whole column, readout and caption included. */
  height?: number
}

/** The chunky Mono track, DESIGN-GUIDE §5.7. */
const TRACK_WIDTH = 44

/**
 * Keys a native range input moves itself with. Each one is a whole
 * interaction: the browser changes the value between keydown and keyup, and
 * that pair is where the commit belongs. Anything else on the key — Tab,
 * Escape, a shortcut — must not write.
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

/**
 * The Mono equaliser fader — spec §7.3, DESIGN-GUIDE §5.7.
 *
 * Two things matter here, and the first is the reason this component exists.
 *
 * **A drag writes once.** The value is drafted locally while the pointer or a
 * key is down, and `onCommit` fires once when the interaction ends. Writing on
 * every tick is what made the old fader fight the user: a burst of writes went
 * out per drag and whichever reply landed last won, so the thumb snapped back.
 * A `value` prop that changes mid-drag is ignored for the same reason — the
 * device answering a write, or a preset clicked elsewhere, must not move a
 * fader under the finger. After the commit the prop owns the value again.
 *
 * **It is a native range input wearing a costume.** Keyboard support, dragging
 * and the accessibility tree come from the platform rather than from a
 * reimplementation; the track, fill and readout are drawn behind an invisible
 * copy of it. That is also why the committed value is read back off the
 * element rather than out of state: a key press delivers keydown, the value
 * change and keyup before React re-renders anything.
 *
 * Nothing about the position transitions. The fill follows the finger, and
 * easing on it is lag. Only the colour swaps are animated, because a band going
 * active is a state change rather than a movement.
 */
export function Fader({
  value,
  onCommit,
  onChange,
  range,
  step = 0.5,
  disabled = false,
  label,
  caption,
  height = 220,
}: FaderProps) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<number | null>(null)
  const [held, setHeld] = useState(false)
  const [focused, setFocused] = useState(false)
  /** The value when the current interaction began, or null when none is live. */
  const startRef = useRef<number | null>(null)

  const unknown = value === undefined
  const current = draft ?? value ?? 0
  const active = !disabled && !unknown && (held || focused)

  // Where zero sits, so the fill can grow up or down from it like a real EQ.
  const fraction = valueToFraction(current, range)
  const zero = valueToFraction(0, range)
  const top = Math.max(fraction, zero)
  const bottom = Math.min(fraction, zero)

  /**
   * The value the element is showing, which is not always `current`: a key press
   * moves the native input between events React can see.
   */
  const shown = (): number => {
    const input = inputRef.current
    return input ? Number(input.value) : current
  }

  const begin = (): void => {
    startRef.current = shown()
    setHeld(true)
  }

  /** Ends the interaction: one write, if the value actually moved. */
  const commit = (): void => {
    const next = shown()
    if (startRef.current !== next) onCommit(next)
    startRef.current = null
    setDraft(null)
    setHeld(false)
  }

  return (
    // The column stretches, so whatever box it is in decides the height, and
    // `height` is the floor under that — spec §7.3's 220. Which box that is
    // depends on the width: on a phone the panel is content-height, so the floor
    // *is* the height; from `lg` (1024px, where `EqualizerPanel` asks to fill)
    // the desk's own box does, with the desk's `lg:min-h-[240px]` under it. The
    // two rules that make stretching *safe* are on the track's wrapper and on the
    // input below, and both are about the same thing; see there.
    <div
      data-slot="fader-column"
      className="flex flex-1 flex-col items-center gap-2"
      style={{ minHeight: height }}
    >
      <span
        data-slot="fader-readout"
        className={cn(
          'text-[18px] font-extrabold tabular-nums transition-colors duration-150 ease-out',
          // The active readout is red text, so it goes through the strong token
          // (spec §8): the desk is a block, and `#ff4d3d` on `#f2f2f2` is
          // 2.9 : 1 — below AA in the light theme, and the one value the user is
          // meant to read while adjusting. The token is the same red in dark.
          unknown ? 'text-muted-foreground' : active ? 'text-signal-strong' : 'text-foreground',
        )}
      >
        {unknown ? '—' : `${current > 0 ? '+' : ''}${current.toFixed(1)}`}
      </span>

      {/* `min-h-0` here and `absolute` on the input below are one fix, and the
          bug it fixes is a percentage height in an indefinite chain. This box is
          a flex item, so its `min-height: auto` becomes *its content's* minimum,
          and its content is a `h-full` input several `flex-1` boxes away from
          anything with a definite height — so the percentage has nothing definite
          to resolve against and the layout above it ends up sized by the page
          rather than by the fader.

          `min-h-0` removes that automatic minimum, and taking the input out of
          flow means a hit layer can never size a layout again. The two together
          are the fix; neither alone is sufficient, which is why the third class
          below (`h-full`) can be a percentage again without reopening this.

          Chrome 154 does not reproduce the *original* failure — the track is the
          column's height here, not the window's — so treat the symptom reports
          (an 844px track in an 844px viewport) as the reason this rule is here
          rather than as something you can re-measure. The mechanism is what is
          load-bearing: a percentage with no definite ancestor is a latent
          bug that a later edit anywhere above this box can wake up. */}
      <div className="relative flex min-h-0 w-full flex-1 justify-center">
        <div
          data-slot="fader-track"
          data-active={active || undefined}
          className={cn(
            'bg-surface-raised absolute inset-y-0 rounded-full transition-[opacity,box-shadow] duration-150 ease-out',
            (disabled || unknown) && 'opacity-40',
            active && 'ring-2 ring-signal',
          )}
          // The full 44px where the column allows it, and no wider than the
          // column where it does not — eight bands on a 390px phone.
          style={{ width: TRACK_WIDTH, maxWidth: '100%' }}
        >
          <div
            data-slot="fader-fill"
            className={cn(
              'absolute inset-x-0 transition-colors duration-150 ease-out',
              active ? 'bg-signal' : 'bg-foreground',
            )}
            style={{ top: `${(1 - top) * 100}%`, bottom: `${bottom * 100}%` }}
          />
          <div
            aria-hidden
            data-slot="fader-zero"
            className="bg-foreground/30 absolute inset-x-0 h-px"
            style={{ top: `${(1 - zero) * 100}%` }}
          />
        </div>

        <input
          id={id}
          ref={inputRef}
          type="range"
          min={range.min}
          max={range.max}
          step={step}
          value={current}
          disabled={disabled || unknown}
          aria-label={label}
          onChange={(event) => {
            const next = Number(event.target.value)
            setDraft(next)
            onChange?.(next)
          }}
          onPointerDown={(event) => {
            if (disabled || unknown) return
            // **Capture the pointer for the length of the drag.** A touch
            // pointer is captured implicitly — the spec hands it to the target
            // on `touchstart` — so a finger that wanders off the fader and lifts
            // still delivers the release. A mouse pointer is not: it goes to
            // whatever is under it, and a release over the page rather than over
            // this 44px input never reaches the handler below. The fader then
            // drafts a value nothing will ever confirm and writes nothing at
            // all, which is the one outcome a commit-on-release design must not
            // have. `Knob` has taken this capture since Task 3; the invisible
            // range input had been left out of it.
            event.currentTarget.setPointerCapture(event.pointerId)
            begin()
          }}
          onPointerUp={() => {
            if (disabled || unknown) return
            commit()
          }}
          onPointerCancel={() => {
            if (disabled || unknown) return
            commit()
          }}
          onKeyDown={(event) => {
            if (disabled || unknown || !MOVING_KEYS.has(event.key)) return
            begin()
          }}
          onKeyUp={(event) => {
            if (disabled || unknown || !MOVING_KEYS.has(event.key)) return
            commit()
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            // A release the page never delivered — focus taken away mid-drag.
            if (startRef.current !== null) commit()
          }}
          className={cn(
            // `absolute` puts the hit layer out of flow, so it cannot size the
            // column it sits in (the wrapper's comment has the mechanism), and
            // `h-full` then makes it cover the track. Both are needed: `h-full`
            // alone is an in-flow percentage in an indefinite chain again, and
            // `absolute` alone leaves the input at whatever height the platform
            // gives a `range` — Chrome's is 129px, which is a drag area covering
            // a third of a 427px track.
            //
            // **Centred explicitly, not by the wrapper's `justify-center`.** The
            // visible track is absolutely positioned with `left`/`right` unset,
            // so it takes its static position from the container's
            // `justify-content` and lands centred. This input cannot rely on
            // that: it carries its own `writing-mode: vertical-lr`, so its axes
            // are not the container's, and an absolutely positioned child's
            // static position is not a thing to depend on across a writing-mode
            // change. `left-1/2 -translate-x-1/2` states the intent outright and
            // holds whatever the axes are.
            //
            // The class list is deliberately not tightened further: `inset-y-0`
            // and `h-full` both say "the track's height", and which of them wins
            // is a browser detail. What matters is that the input covers the
            // track and sizes nothing.
            'absolute inset-y-0 left-1/2 z-10 h-full -translate-x-1/2 cursor-pointer opacity-0 touch-none select-none disabled:cursor-default',
            'focus-visible:opacity-20',
          )}
          style={{
            writingMode: 'vertical-lr',
            direction: 'rtl',
            width: TRACK_WIDTH,
            maxWidth: '100%',
          }}
        />
      </div>

      <span
        data-slot="fader-caption"
        className={cn(
          'text-[10px] font-medium tracking-[.14em] uppercase transition-colors duration-150 ease-out',
          active ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {caption}
      </span>
    </div>
  )
}
