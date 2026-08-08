import { useId } from 'react'

import { cn } from '@/lib/utils'
import { valueToFraction } from './knobGeometry'
import type { Range } from './knobGeometry'

interface FaderProps {
  value: number | undefined
  onChange(value: number): void
  range: Range
  step?: number
  disabled?: boolean
  label: string
  /** Shown under the fader, e.g. the band's centre frequency. */
  caption: string
  height?: number
}

/**
 * Vertical EQ fader.
 *
 * Deliberately not animated: the fill and thumb follow the pointer directly.
 * A transition here lags behind the drag and makes a preset change look like
 * the bands are moving one after another.
 *
 * Built on a native range input rotated with `writing-mode`, so keyboard
 * behaviour, dragging and accessibility come from the platform rather than
 * being reimplemented. The visible track and fill are drawn behind it.
 */
export function Fader({
  value,
  onChange,
  range,
  step = 0.5,
  disabled = false,
  label,
  caption,
  height = 108,
}: FaderProps) {
  const id = useId()
  const unknown = value === undefined
  const current = value ?? 0
  const fraction = valueToFraction(current, range)

  // Where zero sits, so the fill can grow up or down from it like a real EQ.
  const zero = valueToFraction(0, range)
  const top = Math.max(fraction, zero)
  const bottom = Math.min(fraction, zero)

  return (
    <div className="flex flex-1 flex-col items-center gap-2">
      <span
        className={cn(
          'font-mono text-xs tabular-nums',
          unknown ? 'text-muted-foreground' : 'text-foreground font-medium',
        )}
      >
        {unknown ? '—' : `${current > 0 ? '+' : ''}${current.toFixed(1)}`}
      </span>

      <div className="relative flex justify-center" style={{ height }}>
        <div className="bg-muted absolute inset-y-0 w-1.5 rounded-full" />
        <div
          className="bg-primary absolute w-1.5 rounded-full"
          style={{
            top: `${(1 - top) * 100}%`,
            bottom: `${bottom * 100}%`,
          }}
        />
        <input
          id={id}
          type="range"
          min={range.min}
          max={range.max}
          step={step}
          value={current}
          disabled={disabled || unknown}
          aria-label={label}
          onChange={(event) => onChange(Number(event.target.value))}
          className={cn(
            'relative z-10 h-full cursor-pointer opacity-0 disabled:cursor-default',
            'focus-visible:opacity-20',
          )}
          style={{ writingMode: 'vertical-lr', direction: 'rtl', width: 28 }}
        />
        <span
          aria-hidden
          className={cn(
            'border-primary bg-background pointer-events-none absolute h-3 w-6 -translate-y-1/2',
            'rounded-full border-2',
            (disabled || unknown) && 'opacity-40',
          )}
          style={{ top: `${(1 - fraction) * 100}%` }}
        />
      </div>

      <span className="text-muted-foreground text-[11px]">{caption}</span>
    </div>
  )
}
