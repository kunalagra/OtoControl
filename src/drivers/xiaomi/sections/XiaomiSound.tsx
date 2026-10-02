import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SegmentButton } from '@/ui/controls/SegmentButton'
import type { XiaomiDevice, XiaomiState } from '../device'
import { eqPresetOptions } from '../eqPresets'

interface Props {
  device: XiaomiDevice
  state: XiaomiState
}

export function XiaomiSound({ device, state }: Props) {
  const disabled = state.status !== 'connected'
  if (state.capabilities.size > 0 && !state.capabilities.has('eq')) {
    return (
      <Card data-size="sm">
        <CardContent>
          <p className="text-muted-foreground text-sm">This device reports no equalizer.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card data-size="sm">
      <CardHeader>
        <CardTitle>Equalizer</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {eqPresetOptions(state.eqPreset).map((preset) => (
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
  )
}
