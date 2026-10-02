import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { SegmentButton } from '@/ui/controls/SegmentButton'
import type { CustomEq } from '../commands'
import type { XiaomiDevice, XiaomiState } from '../device'
import { eqPresetOptions } from '../eqPresets'
import { CUSTOM_EQ_PRESET, modelGates } from '../models'

interface Props {
  device: XiaomiDevice
  state: XiaomiState
}

export function XiaomiSound({ device, state }: Props) {
  const disabled = state.status !== 'connected'
  if (state.capabilities.size > 0 && !state.capabilities.has('eq') && !state.capabilities.has('customEq')) {
    return (
      <Card data-size="sm">
        <CardContent>
          <p className="text-muted-foreground text-sm">This device reports no equalizer.</p>
        </CardContent>
      </Card>
    )
  }

  const gates = modelGates(state.info)
  return (
    <div className="flex flex-col gap-4">
      <Card data-size="sm">
        <CardHeader>
          <CardTitle>Equalizer</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {eqPresetOptions(gates.effects, state.eqPreset).map((preset) => (
            <SegmentButton
              key={preset.id}
              pressed={state.eqPreset === preset.id}
              disabled={disabled}
              onSelect={() => void device.setEqPreset(preset.id)}
              label={preset.name}
            />
          ))}
        </CardContent>
      </Card>

      {state.capabilities.has('customEq') && state.customEq && (
        <Card data-size="sm">
          <CardHeader>
            <CardTitle>Custom curve</CardTitle>
            {state.eqPreset !== CUSTOM_EQ_PRESET && (
              <p className="text-muted-foreground text-xs">Changing a band switches the equalizer to Custom.</p>
            )}
          </CardHeader>
          <CardContent>
            <CurveEditor curve={state.customEq} disabled={disabled} onCommit={(gains) => void device.setCustomEq(gains)} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}

const bandLabel = (frequency: number): string =>
  frequency >= 1000 ? `${Number((frequency / 1000).toFixed(1))} kHz` : `${frequency} Hz`

/** One slider per band; drags stay local and the curve is written once, on release. */
function CurveEditor({ curve, disabled, onCommit }: { curve: CustomEq; disabled: boolean; onCommit: (gains: number[]) => void }) {
  const [draft, setDraft] = useState<number[] | null>(null)
  const gains = draft ?? curve.bands.map((band) => band.gain)
  return (
    <div className="flex flex-col gap-2">
      {curve.bands.map((band, i) => (
        <div key={band.frequency} className="flex items-center gap-3">
          <span className="text-muted-foreground w-14 shrink-0 text-xs tabular-nums">{bandLabel(band.frequency)}</span>
          <Slider
            value={[gains[i]]}
            min={curve.min}
            max={curve.max}
            step={1}
            disabled={disabled}
            aria-label={`${bandLabel(band.frequency)} gain`}
            onValueChange={(next) => {
              const value = Array.isArray(next) ? next[0] : next
              setDraft(gains.map((gain, j) => (j === i ? value : gain)))
            }}
            onValueCommitted={(committed) => {
              // The committed value, not `draft`: keyboard input fires change and commit together.
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
