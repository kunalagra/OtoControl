import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { SegmentButton } from '@/ui/controls/SegmentButton'
import { AncMode, StrengthTarget } from '../commands'
import type { AncModeValue } from '../commands'
import type { XiaomiDevice, XiaomiState } from '../device'
import { isDepthScale, modelGates, ncStrengthOptions, transparencyStrengthOptions } from '../models'

interface Props {
  device: XiaomiDevice
  state: XiaomiState
}

const MODES: ReadonlyArray<{ mode: AncModeValue; label: string }> = [
  { mode: AncMode.Off, label: 'Off' },
  { mode: AncMode.NoiseCancelling, label: 'Noise cancelling' },
  { mode: AncMode.Transparency, label: 'Transparency' },
]

export function XiaomiNoise({ device, state }: Props) {
  const disabled = state.status !== 'connected'

  // Only assert absence once something has actually been probed.
  if (state.capabilities.size > 0 && !state.capabilities.has('anc')) {
    return (
      <Card data-size="sm">
        <CardContent>
          <p className="text-muted-foreground text-sm">This device reports no noise control.</p>
        </CardContent>
      </Card>
    )
  }

  const gates = modelGates(state.info)
  const showStrength = state.capabilities.has('strength')

  return (
    <div className="flex flex-col gap-4">
      <Card data-size="sm">
        <CardHeader>
          <CardTitle>Noise control</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {state.ancMode === null && (
            <p className="text-muted-foreground text-sm sm:col-span-3">
              {state.status === 'connected' ? 'The device did not report its noise control mode.' : 'Connect to load noise control.'}
            </p>
          )}
          {state.ancMode !== null &&
            MODES.map(({ mode, label }) => (
              <SegmentButton
                key={mode}
                size="lg"
                label={label}
                pressed={state.ancMode === mode}
                disabled={disabled}
                onSelect={() => void device.setAncMode(mode)}
                className="px-2.5 py-2"
              />
            ))}
        </CardContent>
      </Card>

      {showStrength && state.ancMode === AncMode.NoiseCancelling && gates.ncGear.length > 1 && (
        <Gear
          title="Noise cancelling strength"
          gear={gates.ncGear}
          options={ncStrengthOptions(gates.ncGear)}
          value={state.ncStrength}
          disabled={disabled}
          onSelect={(level) => void device.setStrength(StrengthTarget.NoiseCancelling, level)}
        />
      )}

      {showStrength && state.ancMode === AncMode.Transparency && gates.tpGear.length > 1 && (
        <Gear
          title="Transparency mode"
          gear={gates.tpGear}
          options={transparencyStrengthOptions(gates.tpGear)}
          value={state.transparencyStrength}
          disabled={disabled}
          onSelect={(level) => void device.setStrength(StrengthTarget.Transparency, level)}
        />
      )}
    </div>
  )
}

/** A handful of named strengths as buttons, or — for the models that list a 20-step gear — a depth slider. */
function Gear({
  title,
  gear,
  options,
  value,
  disabled,
  onSelect,
}: {
  title: string
  gear: number[]
  options: Array<{ id: number; label: string }>
  value: number | null
  disabled: boolean
  onSelect: (level: number) => void
}) {
  const [draft, setDraft] = useState<number | null>(null)
  if (isDepthScale(gear)) {
    const min = Math.min(...gear)
    const max = Math.max(...gear)
    const shown = draft ?? value ?? min
    return (
      <Card data-size="sm">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-3">
          <Slider
            value={[shown]}
            min={min}
            max={max}
            step={1}
            disabled={disabled}
            aria-label={title}
            onValueChange={(next) => setDraft(Array.isArray(next) ? next[0] : next)}
            onValueCommitted={(committed) => {
              // The committed value, not `draft`: keyboard input fires change and commit together.
              onSelect(Array.isArray(committed) ? committed[0] : committed)
              setDraft(null)
            }}
          />
          <span className="w-8 shrink-0 text-right text-xs tabular-nums">{shown}</span>
        </CardContent>
      </Card>
    )
  }
  return (
    <Card data-size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {options.map(({ id, label }) => (
          <SegmentButton key={id} label={label} pressed={value === id} disabled={disabled} onSelect={() => onSelect(id)} />
        ))}
      </CardContent>
    </Card>
  )
}
