import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Fader } from '../controls/Fader'

export interface EqPresetOption {
  /** Opaque to this panel; handed straight back to `onPresetSelect`. */
  id: string
  name: string
  active: boolean
  /**
   * The preset's own band gains, for the mini preview. Optional: a driver whose
   * presets are chosen by name on the device (Sony) has no curve to draw, and
   * the panel omits the bars rather than inventing one.
   */
  gains?: number[]
}

export interface EqBand {
  value: number | undefined
  /** Accessible label, e.g. "100 Hz gain in decibels". */
  label: string
  /** Short text under the fader, e.g. "100". */
  caption: string
}

export interface EqualizerPanelProps {
  presets: readonly EqPresetOption[]
  bands: readonly EqBand[]
  range: { min: number; max: number }
  step?: number
  disabled: boolean
  /** A message to show *instead of* the controls, or null to show them. */
  unavailable: string | null
  /** Caption under the faders, e.g. "-10 to +10 dB, reported by the headphones". */
  footer: string
  onPresetSelect(id: string): void
  /** Called once per fader interaction, not once per tick — spec §7.2. */
  onBandCommit(index: number, value: number): void
}

/** The name a driver calls a flat curve. Matched on the name, not the id. */
const FLAT = /flat/i

/** Bars in a preset's mini preview. DESIGN-GUIDE §5.8. */
const BARS = 5

/**
 * Shared by both preset layouts, so a chip and a row cannot drift apart on
 * focus, disabled or the 150ms colour transition (DESIGN-GUIDE §6).
 *
 * The ring is spec §8's: 2px of foreground, 2px clear of the chip. Both halves
 * are load-bearing — the selected preset is `bg-foreground`, so an unoffset
 * foreground ring on it is the chip's own colour against itself.
 */
const PRESSABLE =
  'transition-colors duration-150 ease-out focus-visible:ring-ring outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-default disabled:opacity-50'
/** The selected look, and the only one: one red thing, inverted here. */
const SELECTED = 'bg-foreground text-background font-bold'

/**
 * Presets over a band desk.
 *
 * Which presets exist, whether one is active, how a band is labelled and what
 * the footer says are all decided by the caller. This panel decides only how
 * an equaliser looks — the property that lets a third driver reuse it without
 * either existing driver changing.
 *
 * Layout follows DESIGN-GUIDE §5.8: on a phone the presets are a four-column
 * chip grid above the desk, and from 1024px they become a 260px list of rows
 * beside it, each with a five-bar preview of its curve. Only one of the two is
 * ever displayed — the other stays in the tree and out of the layout, which
 * `display: none` also takes out of the accessibility tree.
 */
export function EqualizerPanel({
  presets,
  bands,
  range,
  step,
  disabled,
  unavailable,
  footer,
  onPresetSelect,
  onBandCommit,
}: EqualizerPanelProps) {
  const active = presets.find((preset) => preset.active)
  const flat = presets.find((preset) => FLAT.test(preset.name))
  const withPresets = presets.length > 0

  // Nothing to name, choose or draw: the caption and the reason it is missing
  // are all there is to say, and a preset name here would be a guess.
  if (unavailable !== null) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-muted-foreground text-[10px] font-medium tracking-[.14em] uppercase">
          Equalizer
        </span>
        <p className="text-muted-foreground text-sm">{unavailable}</p>
      </div>
    )
  }

  const desk = (
    <div
      data-slot="eq-desk"
      className="mono-dots-fader flex min-h-[220px] gap-1 rounded-[26px] p-3 lg:min-h-[240px] lg:gap-3 lg:p-4"
    >
      {bands.map(({ value, label, caption }, index) => (
        <Fader
          key={index}
          value={value}
          onCommit={(next) => onBandCommit(index, next)}
          range={range}
          step={step}
          disabled={disabled}
          label={label}
          caption={caption}
        />
      ))}
    </div>
  )

  return (
    // `lg:min-h-0 lg:flex-1` so the desk can fill what the shell hands it, the
    // same trade Home's bento makes: the section body is a flex column with a
    // definite height from `md` up, and a panel that does not ask to grow is a
    // 240px desk at the bottom of a 700px screen. `min-h-0` beside it so a window
    // too short for the 240px floor overflows and `main` scrolls, rather than
    // the desk being squeezed under its own minimum.
    <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1">
      <div className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="text-muted-foreground text-[10px] font-medium tracking-[.14em] uppercase">
            Equalizer
          </span>
          {/* Section display, DESIGN-GUIDE §4. A hand-edited curve matches no
              preset, and saying so is truer than naming one that is not playing. */}
          <span className="truncate text-[30px] font-extrabold tracking-[-.03em]">
            {active?.name ?? 'Custom'}
          </span>
        </div>
        {flat && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            className="shrink-0 rounded-full"
            onClick={() => onPresetSelect(flat.id)}
          >
            Reset to Flat
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1">
        {withPresets && (
          <div data-slot="eq-chips" className="grid grid-cols-4 gap-1.5 lg:hidden">
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                disabled={disabled}
                aria-pressed={preset.active}
                onClick={() => onPresetSelect(preset.id)}
                className={cn(
                  PRESSABLE,
                  // 44px on a phone (spec §8 lists the preset chips), which the
                  // guide's own `py-2` and 11px label do not reach on their own.
                  // Grown onto the chip rather than added as slop: a 4-column
                  // grid with 6px gutters has 3px of neighbour to borrow per
                  // edge, so invisible overflow here would either overlap the
                  // next chip's target or leave the row under 44 anyway. Back to
                  // the guide's height from `lg`, where the row becomes a
                  // 260px list of presets and the pointer is a mouse.
                  'min-h-11 rounded-[12px] py-2 text-[11px] lg:min-h-0',
                  preset.active ? SELECTED : 'bg-surface-raised text-foreground',
                )}
              >
                {preset.name}
              </button>
            ))}
          </div>
        )}

        <div
          className={cn(
            // The row the desk lives in takes the height the flex chain gives
            // it, so the desk fills rather than sitting at its minimum. Only
            // from `lg`: between `md` and `lg` this grid is one column with the
            // chips above it, and stretching *that* row would push the desk off
            // the bottom of a tablet screen.
            'grid gap-3 lg:min-h-0 lg:flex-1 lg:auto-rows-fr',
            withPresets && 'lg:grid-cols-[260px_1fr]',
          )}
        >
          {withPresets && (
            <div
              data-slot="eq-preset-list"
              className="bg-card hidden flex-col gap-1 rounded-[26px] p-2.5 lg:flex"
            >
              {presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  disabled={disabled}
                  aria-pressed={preset.active}
                  onClick={() => onPresetSelect(preset.id)}
                  className={cn(
                    PRESSABLE,
                    'flex items-center justify-between gap-2 rounded-[14px] px-2.5 py-2 text-left text-[13px]',
                    preset.active ? SELECTED : 'hover:bg-surface-raised',
                  )}
                >
                  <span className="truncate">{preset.name}</span>
                  {previewBars(preset, range)}
                </button>
              ))}
            </div>
          )}

          {desk}
        </div>

        {footer && <p className="text-muted-foreground text-xs">{footer}</p>}
      </div>
    </div>
  )
}

/**
 * Five bars standing in for a preset's curve — the shape of the sound, not its
 * numbers. The tallest bar is the curve's own peak, so a preset reads as
 * "bass-heavy" or "treble-forward" at a glance, and the selected row's peak
 * goes red because red is the only colour that means anything here.
 *
 * Bands are dropped to five evenly across the curve rather than truncated: an
 * eight-band preset previewed as its first five bands would describe a
 * different sound. A driver that supplies no gains gets no bars at all.
 */
function previewBars(preset: EqPresetOption, range: { min: number; max: number }): ReactNode {
  const gains = preset.gains
  if (!gains || gains.length === 0) return null

  const sampled = gains.length <= BARS ? gains : evenly(gains, BARS)
  const span = Math.max(Math.abs(range.min), Math.abs(range.max)) || 1
  const peak = sampled.reduce(
    (best, gain, index) => (Math.abs(gain) > Math.abs(sampled[best]) ? index : best),
    0,
  )

  return (
    <span aria-hidden className="flex h-[14px] shrink-0 items-end gap-[2px]">
      {sampled.map((gain, index) => (
        <span
          key={index}
          className={cn(
            'w-1 rounded-[1px]',
            preset.active
              ? index === peak
                ? 'bg-signal'
                : 'bg-background'
              : 'bg-foreground/40',
          )}
          // A flat band still gets a stub; a zero-height bar reads as broken.
          style={{ height: `${Math.max(15, Math.round((Math.abs(gain) / span) * 100))}%` }}
        />
      ))}
    </span>
  )
}

const evenly = (gains: number[], count: number): number[] =>
  Array.from({ length: count }, (_, index) =>
    gains[Math.round((index * (gains.length - 1)) / (count - 1))],
  )
