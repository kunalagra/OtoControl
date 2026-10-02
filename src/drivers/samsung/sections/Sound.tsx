import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SegmentButton } from '@/ui/controls/SegmentButton'
import type { SamsungDevice, SamsungState } from '../device'
import { EQ_CUSTOM, EQ_PRESETS, modelById } from '../models'

interface Props {
  device: SamsungDevice
  state: SamsungState
}

export function SamsungSound({ device, state }: Props) {
  const disabled = state.status !== 'connected'
  const model = modelById(state.info.modelId)

  if (model && !model.eq) {
    return (
      <Card data-size="sm">
        <CardContent>
          <p className="text-muted-foreground text-sm">This model's equalizer is not offered here.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card data-size="sm">
      <CardHeader>
        <CardTitle>Equalizer</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          <SegmentButton pressed={state.eq === 0} disabled={disabled} onSelect={() => void device.setEqPreset(0)} label="Normal" />
          {EQ_PRESETS.map((name, index) => (
            <SegmentButton
              key={name}
              pressed={state.eq === index + 1}
              disabled={disabled}
              onSelect={() => void device.setEqPreset(index + 1)}
              label={name}
            />
          ))}
        </div>
        {state.eq !== null && state.eq >= EQ_CUSTOM && (
          <p className="text-muted-foreground text-xs">The earbuds are using a custom curve, which this app cannot edit.</p>
        )}
      </CardContent>
    </Card>
  )
}
