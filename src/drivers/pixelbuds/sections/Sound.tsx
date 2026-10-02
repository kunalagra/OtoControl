import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { ToggleRow } from '@/ui/controls/SettingRow'
import type { PixelBudsDevice, PixelBudsState } from '../device'
import { EQ_BANDS, EQ_RANGE } from '../maestro'

interface Props {
  device: PixelBudsDevice
  state: PixelBudsState
}

const FLAT = [0, 0, 0, 0, 0]

const signed = (gain: number): string => (gain > 0 ? `+${gain}` : String(gain))

export function PixelBudsSound({ device, state }: Props) {
  const disabled = state.status !== 'connected'
  if (state.capabilities.size > 0 && !state.capabilities.has('eq')) {
    return (
      <Card data-size="sm">
        <CardContent>
          <p className="text-muted-foreground text-sm">These earbuds report no equalizer.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Card data-size="sm">
        <CardHeader>
          <CardTitle>Equalizer</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {state.eq === null ? (
            <p className="text-muted-foreground text-sm">
              {state.status === 'connected' ? 'The earbuds did not report an equalizer.' : 'Connect to load the equalizer.'}
            </p>
          ) : (
            <CurveEditor gains={state.eq} disabled={disabled} onCommit={(gains) => void device.setEq(gains)} />
          )}
          <div>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || state.eq === null || state.eq.every((gain) => gain === 0)}
              onClick={() => void device.setEq(FLAT)}
            >
              Reset to flat
            </Button>
          </div>
        </CardContent>
      </Card>
      {state.capabilities.has('volumeEq') && (
        <Card data-size="sm">
          <CardContent className="flex flex-col">
            <ToggleRow
              label="Volume EQ"
              hint="Adjusts the balance of the sound as you change the volume."
              value={state.volumeEq}
              disabled={disabled}
              onChange={(value) => void device.setVolumeEq(value)}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}

/** One slider per band; drags stay local and the curve is written once, on release. */
function CurveEditor({
  gains,
  disabled,
  onCommit,
}: {
  gains: readonly number[]
  disabled: boolean
  onCommit: (gains: number[]) => void
}) {
  const [draft, setDraft] = useState<number[] | null>(null)
  const shown = draft ?? [...gains]
  return (
    <div className="flex flex-col gap-2">
      {EQ_BANDS.map((name, i) => (
        <div key={name} className="flex items-center gap-3">
          <span className="text-muted-foreground w-24 shrink-0 text-xs">{name}</span>
          <Slider
            value={[shown[i]]}
            min={EQ_RANGE.min}
            max={EQ_RANGE.max}
            step={0.5}
            disabled={disabled}
            aria-label={`${name} gain`}
            onValueChange={(next) => {
              const value = Array.isArray(next) ? next[0] : next
              setDraft(shown.map((gain, j) => (j === i ? value : gain)))
            }}
            onValueCommitted={(committed) => {
              // The committed value, not `draft`: keyboard input fires change and commit together.
              const value = Array.isArray(committed) ? committed[0] : committed
              onCommit(shown.map((gain, j) => (j === i ? value : gain)))
              setDraft(null)
            }}
          />
          <span className="w-10 shrink-0 text-right text-xs tabular-nums">{signed(shown[i])}</span>
        </div>
      ))}
    </div>
  )
}
