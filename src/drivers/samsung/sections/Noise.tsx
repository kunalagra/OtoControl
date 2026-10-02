import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SegmentButton } from '@/ui/controls/SegmentButton'
import type { SamsungDevice, SamsungState } from '../device'
import { NOISE_LABEL, noiseOptions } from '../labels'
import { modelById } from '../models'

interface Props {
  device: SamsungDevice
  state: SamsungState
}

export function SamsungNoise({ device, state }: Props) {
  const disabled = state.status !== 'connected'
  const model = modelById(state.info.modelId)
  const options = model ? noiseOptions(model) : []

  if (model && options.length === 0) {
    return (
      <Card data-size="sm">
        <CardContent>
          <p className="text-muted-foreground text-sm">
            {model.id === 'unknown'
              ? 'This model is not in the table yet, so its noise controls are not offered.'
              : 'This model has no noise control.'}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card data-size="sm">
      <CardHeader>
        <CardTitle>Noise control</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {options.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {state.status === 'connected' ? 'Waiting for the earbuds to identify their model.' : 'Connect to load noise control.'}
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {options.map((mode) => (
              <SegmentButton
                key={mode}
                size="lg"
                pressed={state.noiseMode === mode}
                disabled={disabled}
                onSelect={() => void device.setNoiseMode(mode)}
                label={NOISE_LABEL[mode]}
                className="px-2.5 py-2"
              />
            ))}
          </div>
        )}
        {state.noiseMode === 3 && !options.includes(3) && (
          <p className="text-muted-foreground text-xs">The earbuds report Adaptive, which this app cannot set yet.</p>
        )}
      </CardContent>
    </Card>
  )
}
