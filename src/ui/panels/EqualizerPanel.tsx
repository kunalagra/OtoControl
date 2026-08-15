import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { Fader } from '../controls/Fader'

export interface EqPresetOption {
  /** Opaque to this panel; handed straight back to `onPresetSelect`. */
  id: string
  name: string
  active: boolean
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
  onBandChange(index: number, value: number): void
}

/**
 * Preset pills over a row of band faders.
 *
 * Which presets exist, whether one is active, how a band is labelled and what
 * the footer says are all decided by the caller. This panel decides only how
 * an equaliser looks — the property that lets a third driver reuse it without
 * either existing driver changing.
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
  onBandChange,
}: EqualizerPanelProps) {
  return (
    <Card data-size="sm">
      <CardHeader>
        <CardTitle>Equalizer</CardTitle>
      </CardHeader>
      <CardContent>
        {unavailable !== null ? (
          <p className="text-muted-foreground text-sm">{unavailable}</p>
        ) : (
          <div className="flex flex-col gap-4">
            {presets.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {presets.map(({ id, name, active }) => (
                  <Button
                    key={id}
                    type="button"
                    size="sm"
                    variant={active ? 'default' : 'outline'}
                    disabled={disabled}
                    className={cn('rounded-full', !active && 'text-muted-foreground')}
                    onClick={() => onPresetSelect(id)}
                  >
                    {name}
                  </Button>
                ))}
              </div>
            )}

            <div className="flex justify-between gap-2">
              {bands.map(({ value, label, caption }, index) => (
                <Fader
                  key={index}
                  value={value}
                  onChange={(next) => onBandChange(index, next)}
                  range={range}
                  step={step}
                  disabled={disabled}
                  label={label}
                  caption={caption}
                />
              ))}
            </div>

            <p className="text-muted-foreground text-xs">{footer}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
