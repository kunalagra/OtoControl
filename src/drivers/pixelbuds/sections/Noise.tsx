import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SegmentButton } from '@/ui/controls/SegmentButton'
import type { PixelBudsDevice, PixelBudsState } from '../device'
import { AncState, ANC_LABEL } from '../maestro'
import type { AncMode } from '../maestro'
import { offersAdaptive } from '../state'

interface Props {
  device: PixelBudsDevice
  state: PixelBudsState
}

const HINT: Record<AncMode, string> = {
  [AncState.Off]: 'No processing',
  [AncState.Active]: 'Blocks outside sound',
  [AncState.Aware]: 'Lets outside sound in',
  [AncState.Adaptive]: 'Adjusts to your surroundings',
}

export function PixelBudsNoise({ device, state }: Props) {
  const disabled = state.status !== 'connected'

  // Only assert absence once something has actually been read.
  if (state.capabilities.size > 0 && !state.capabilities.has('anc')) {
    return (
      <Card data-size="sm">
        <CardContent>
          <p className="text-muted-foreground text-sm">These earbuds report no noise control.</p>
        </CardContent>
      </Card>
    )
  }

  const modes: AncMode[] = [AncState.Off, AncState.Active, AncState.Aware]
  if (offersAdaptive(state)) modes.push(AncState.Adaptive)

  return (
    <Card data-size="sm">
      <CardHeader>
        <CardTitle>Noise control</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {state.ancMode === null && (
          <p className="text-muted-foreground text-sm">
            {state.status === 'connected' ? 'The earbuds did not report a mode yet.' : 'Connect to load noise control.'}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          {modes.map((mode) => (
            <SegmentButton
              key={mode}
              size="lg"
              pressed={state.ancMode === mode}
              disabled={disabled}
              onSelect={() => void device.setAncMode(mode)}
              label={ANC_LABEL[mode]}
              hint={HINT[mode]}
              className="px-2.5 py-2"
            />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
