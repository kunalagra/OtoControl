import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SegmentButton } from '@/ui/controls/SegmentButton'
import type { SamsungDevice, SamsungState } from '../device'
import { NOISE_CYCLE_LABEL } from '../labels'
import { TOUCH_ACTION_LABEL, modelById } from '../models'
import type { NoiseCycle } from '../commands'

interface Props {
  device: SamsungDevice
  state: SamsungState
}

const SIDES = [
  { side: 'left', label: 'Left earbud' },
  { side: 'right', label: 'Right earbud' },
] as const

const CYCLES: NoiseCycle[] = ['ancOff', 'ambOff', 'ancAmb']

/**
 * What a touch-and-hold does, per earbud, and — where the model lets the
 * long press switch noise control — which two modes it switches between. Offered
 * only for what the earbuds have reported, since each write restates the other earbud.
 */
export function TouchControls({ device, state }: Props) {
  const model = modelById(state.info.modelId)
  if (!model || model.holdActions.length === 0) return null
  const disabled = state.status !== 'connected'
  const known = state.hold.left !== null && state.hold.right !== null
  const cycles = model.noiseCycle !== null && state.noiseCycle.left !== null && state.noiseCycle.right !== null

  return (
    <Card data-size="sm">
      <CardHeader>
        <CardTitle>Touch and hold</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!known && (
          <p className="text-muted-foreground text-sm">
            {state.status === 'connected' ? 'Waiting for the earbuds to report their settings.' : 'Connect to load touch controls.'}
          </p>
        )}
        {known &&
          SIDES.map(({ side, label }) => (
            <div key={side} className="flex flex-col gap-1.5">
              <span className="text-muted-foreground text-xs">{label}</span>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {model.holdActions.map((action) => (
                  <SegmentButton
                    key={action}
                    pressed={state.hold[side] === action}
                    disabled={disabled}
                    onSelect={() => void device.setHoldAction(side, action)}
                    label={TOUCH_ACTION_LABEL[action]}
                  />
                ))}
              </div>
              {cycles && state.hold[side] === 'noise' && (
                <div className="grid grid-cols-1 gap-1.5 pl-2 sm:grid-cols-3">
                  {CYCLES.map((cycle) => (
                    <SegmentButton
                      key={cycle}
                      pressed={state.noiseCycle[side] === cycle}
                      disabled={disabled}
                      onSelect={() => void device.setNoiseCycle(side, cycle)}
                      label={NOISE_CYCLE_LABEL[cycle]}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
      </CardContent>
    </Card>
  )
}
