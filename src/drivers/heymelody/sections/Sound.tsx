import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import type { HeyMelodyDevice, HeyMelodyState } from '../device'
import type { EqPreset } from '../protocol/eq'

interface Props {
  device: HeyMelodyDevice
  state: HeyMelodyState
}

export function HeyMelodySound({ device, state }: Props) {
  const disabled = state.status !== 'connected'

  // Only assert absence once something has actually been probed — before that,
  // fall through to the "Connect to load..." / "did not answer" messaging below.
  if (state.capabilities.size > 0 && !state.capabilities.has('eq') && !state.capabilities.has('eqCustom')) {
    return (
      <Card data-size="sm">
        <CardContent>
          <p className="text-muted-foreground text-sm">This device reports no equalizer.</p>
        </CardContent>
      </Card>
    )
  }

  // The optimistic write in `setEqPreset` patches `eqCurrentPreset`, not any
  // preset's own `isSelected` — that flag only ever comes from the device's
  // last `0x0122` reply. Preferring the optimistic field is what makes a click
  // show up immediately; falling back to `isSelected` is what shows the
  // device's own answer before any click has happened.
  //
  // Note: `0x010F` (QueryEqCurrent, `eqCurrentPreset`'s source) is documented
  // as a "preset index", while `eqId` is a per-preset byte from `0x0122`
  // (QueryEqAll). Comparing them assumes both share one namespace — an
  // untested assumption, not confirmed by the spec.
  const selectedEqId = state.eqCurrentPreset ?? state.eqPresets.find((p) => p.isSelected)?.eqId ?? null
  const editable = state.capabilities.has('eqCustom')

  return (
    <Card data-size="sm">
      <CardHeader>
        <CardTitle>Equalizer</CardTitle>
      </CardHeader>
      <CardContent>
        {state.eqPresets.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {state.status === 'connected'
              ? 'The device did not return an EQ preset list.'
              : 'Connect to load the equalizer.'}
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {state.eqPresets.map((preset) => (
              <div key={preset.eqId} className="flex flex-col gap-2">
                <button
                  type="button"
                  disabled={disabled}
                  aria-pressed={selectedEqId === preset.eqId}
                  onClick={() => void device.setEqPreset(preset.eqId)}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                    'focus-visible:ring-ring outline-none focus-visible:ring-2',
                    'disabled:cursor-default disabled:opacity-50',
                    selectedEqId === preset.eqId
                      ? 'border-primary bg-primary/10 font-medium'
                      : 'border-border hover:border-muted-foreground/40',
                  )}
                >
                  {preset.name}
                </button>
                {editable && preset.bands.length > 0 && (
                  <CurveEditor
                    preset={preset}
                    disabled={disabled}
                    onCommit={(gains) => void device.setEqCurve(preset.eqId, gains)}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function bandLabel(frequency: number): string {
  return frequency >= 1000 ? `${Number((frequency / 1000).toFixed(1))} kHz` : `${frequency} Hz`
}

/** One slider per band; drags stay local and the curve is written once, on release. */
function CurveEditor({
  preset,
  disabled,
  onCommit,
}: {
  preset: EqPreset
  disabled: boolean
  onCommit: (gains: number[]) => void
}) {
  const [draft, setDraft] = useState<number[] | null>(null)
  const gains = draft ?? preset.bands.map((band) => band.dbValue)
  return (
    <div className="flex flex-col gap-2 pl-2">
      {preset.bands.map((band, i) => (
        <div key={band.frequency} className="flex items-center gap-3">
          <span className="text-muted-foreground w-14 shrink-0 text-xs tabular-nums">{bandLabel(band.frequency)}</span>
          <Slider
            value={[gains[i]]}
            min={preset.minValue}
            max={preset.maxValue}
            step={1}
            disabled={disabled}
            aria-label={`${bandLabel(band.frequency)} gain`}
            onValueChange={(next) => {
              const value = Array.isArray(next) ? next[0] : next
              setDraft(gains.map((gain, j) => (j === i ? value : gain)))
            }}
            onValueCommitted={(committed) => {
              // Use the committed value, not `draft`: keyboard input fires change
              // and commit in one event, before `draft` has re-rendered.
              const value = Array.isArray(committed) ? committed[0] : committed
              onCommit(gains.map((gain, j) => (j === i ? value : gain)))
              setDraft(null)
            }}
          />
          <span className="w-8 shrink-0 text-right text-xs tabular-nums">{gains[i] > 0 ? `+${gains[i]}` : gains[i]}</span>
        </div>
      ))}
    </div>
  )
}
