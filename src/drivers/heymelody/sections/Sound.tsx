import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { SegmentButton } from '@/ui/controls/SegmentButton'
import type { HeyMelodyDevice, HeyMelodyState } from '../device'
import { builtinPresets, customEqCap } from '../eqModes'
import type { EqPreset } from '../protocol/eq'

interface Props {
  device: HeyMelodyDevice
  state: HeyMelodyState
}

export function HeyMelodySound({ device, state }: Props) {
  const disabled = state.status !== 'connected'
  const known = state.capabilities.size > 0
  if (known && !state.capabilities.has('eq') && !state.capabilities.has('eqCustom')) {
    return (
      <Card data-size="sm">
        <CardContent>
          <p className="text-muted-foreground text-sm">This device reports no equalizer.</p>
        </CardContent>
      </Card>
    )
  }

  const customs = state.eqPresets
  // A custom preset's id wins over a built-in with the same id (the Home tile filters the same way).
  const customIds = new Set(customs.map((preset) => preset.eqId))
  const builtins = builtinPresets(state.info.catalog).filter((preset) => !customIds.has(preset.id))
  const cap = customEqCap(state.info.catalog)
  const selectedId = state.eqCurrentPreset ?? customs.find((preset) => preset.isSelected)?.eqId ?? null
  const selectedCustom = customs.find((preset) => preset.eqId === selectedId) ?? null
  const showBuiltins = !known || state.capabilities.has('eq')

  return (
    <div className="flex flex-col gap-4">
      {showBuiltins && (
        <Card data-size="sm">
          <CardHeader>
            <CardTitle>Equalizer</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {builtins.map((preset) => (
              <SegmentButton
                key={preset.id}
                pressed={selectedId === preset.id && !selectedCustom}
                disabled={disabled}
                onSelect={() => void device.setEqPreset(preset.id)}
                label={preset.name}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {state.capabilities.has('eqCustom') && (
        <Card data-size="sm">
          <CardHeader>
            <CardTitle>Custom</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {customs.length === 0 ? (
              <p className="text-muted-foreground text-sm">No custom presets yet.</p>
            ) : (
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {customs.map((preset) => (
                  <SegmentButton
                    key={preset.eqId}
                    pressed={selectedCustom?.eqId === preset.eqId}
                    disabled={disabled}
                    onSelect={() => void device.setEqPreset(preset.eqId)}
                    label={preset.name}
                  />
                ))}
              </div>
            )}
            {selectedCustom && selectedCustom.bands.length > 0 && (
              <CurveEditor
                key={selectedCustom.eqId}
                preset={selectedCustom}
                disabled={disabled}
                onCommit={(gains) => void device.setEqCurve(selectedCustom.eqId, gains)}
              />
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={disabled || customs.length >= cap}
                aria-describedby={customs.length >= cap ? 'heymelody-eq-cap' : undefined}
                onClick={() => void device.createCustomPreset()}
              >
                New preset
              </Button>
              {selectedCustom && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  aria-label={`Delete ${selectedCustom.name}`}
                  onClick={() => {
                    if (window.confirm(`Delete ${selectedCustom.name}?`)) void device.deleteCustomPreset(selectedCustom.eqId)
                  }}
                >
                  Delete
                </Button>
              )}
              {customs.length >= cap && (
                <span id="heymelody-eq-cap" className="text-muted-foreground text-xs">Up to {cap} custom presets</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
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
