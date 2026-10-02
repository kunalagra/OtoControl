import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SegmentButton } from '@/ui/controls/SegmentButton'
import { AncMode, StrengthTarget } from '../commands'
import type { AncModeValue } from '../commands'
import type { XiaomiDevice, XiaomiState } from '../device'
import { modelHints, ncStrengthOptions, transparencyStrengthOptions } from '../models'

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

  const hints = modelHints(state.info.btName, state.info.model)
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

      {showStrength && state.ancMode === AncMode.NoiseCancelling && (
        <Card data-size="sm">
          <CardHeader>
            <CardTitle>Noise cancelling strength</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {ncStrengthOptions(hints.ncStrengths).map(({ id, label }) => (
              <SegmentButton
                key={id}
                label={label}
                pressed={state.ncStrength === id}
                disabled={disabled}
                onSelect={() => void device.setStrength(StrengthTarget.NoiseCancelling, id)}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {showStrength && state.ancMode === AncMode.Transparency && (
        <Card data-size="sm">
          <CardHeader>
            <CardTitle>Transparency mode</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {transparencyStrengthOptions(hints.transparencyStrengths).map(({ id, label }) => (
              <SegmentButton
                key={id}
                label={label}
                pressed={state.transparencyStrength === id}
                disabled={disabled}
                onSelect={() => void device.setStrength(StrengthTarget.Transparency, id)}
              />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
