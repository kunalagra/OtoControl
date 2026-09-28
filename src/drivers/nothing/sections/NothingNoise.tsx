import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { AncLevel } from '@/drivers/nothing/commands'
import type { NothingDevice, NothingState } from '@/drivers/nothing/device'
import { SegmentButton } from '@/ui/controls/SegmentButton'
import { SettingRow } from '@/ui/controls/SettingRow'

interface Props {
  device: NothingDevice
  state: NothingState
}

/** ear-web's six levels, grouped the way the official app presents them. */
const LEVELS = [
  { value: AncLevel.Off, label: 'Off', hint: 'No processing' },
  { value: AncLevel.Transparency, label: 'Transparency', hint: 'Lets the room through' },
  { value: AncLevel.NcLow, label: 'Noise cancelling · low' },
  { value: AncLevel.NcMid, label: 'Noise cancelling · medium' },
  { value: AncLevel.NcHigh, label: 'Noise cancelling · high' },
  { value: AncLevel.Adaptive, label: 'Adaptive', hint: 'Adjusts to your surroundings' },
]

export function NothingNoise({ device, state }: Props) {
  const disabled = state.status !== 'connected'
  const hasAnc = state.capabilities.has('anc')
  const hasPersonalized = state.capabilities.has('personalizedAnc')

  if (!hasAnc && !hasPersonalized) {
    return (
      <Card data-size="sm">
        <CardContent>
          <p className="text-muted-foreground text-sm">
            This device reports no noise control.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {hasAnc && (
        <Card data-size="sm">
          <CardHeader>
            <CardTitle>Noise control</CardTitle>
          </CardHeader>
          <CardContent>
            {state.anc === null ? (
              <p className="text-muted-foreground text-sm">
                {state.status === 'connected'
                  ? 'The device did not answer the noise control query.'
                  : 'Connect to load noise control.'}
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {LEVELS.map(({ value, label, hint }) => (
                  <SegmentButton
                    key={value}
                    pressed={state.anc === value}
                    disabled={disabled}
                    onSelect={() => void device.setAncLevel(value)}
                    label={label}
                    hint={hint}
                    size="lg"
                    className="px-2.5 py-2"
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {hasPersonalized && (
        <Card data-size="sm">
          <CardContent className="flex flex-col gap-3">
            <SettingRow
              label="Personalized ANC"
              hint="Tunes the cancellation to the shape of your ears."
            >
              <Switch
                checked={state.personalizedAnc?.enabled === true}
                disabled={disabled || state.personalizedAnc === null}
                onCheckedChange={(on) => void device.setPersonalizedAnc(on)}
              />
            </SettingRow>
            {/* The fitting runs on the device; the calibration byte in the
                reply is how it reports where it got to. */}
            <SettingRow
              label="Fit calibration"
              hint={
                state.personalizedAnc && state.personalizedAnc.calibration > 0
                  ? `Last result: ${state.personalizedAnc.calibration}`
                  : 'Measures your ears to tune the cancellation.'
              }
            >
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => void device.startCalibration()}
              >
                Calibrate
              </Button>
            </SettingRow>
          </CardContent>
        </Card>
      )}

      {(state.capabilities.has('smartAnc') || state.capabilities.has('smartFree')) && (
        <Card data-size="sm">
          <CardContent className="flex flex-col gap-3">
            {state.capabilities.has('smartAnc') && (
              <SettingRow
                label="Smart noise cancelling"
                hint="Lets the device pick the level from your surroundings."
              >
                <Switch
                  checked={state.smartAnc === true}
                  disabled={disabled || state.smartAnc === null}
                  onCheckedChange={(on) => void device.setSmartAnc(on)}
                />
              </SettingRow>
            )}
            {state.capabilities.has('smartFree') && (
              <SettingRow
                label="Smart free"
                hint="Eases cancellation when nothing is playing."
              >
                <Switch
                  checked={state.smartFree === true}
                  disabled={disabled || state.smartFree === null}
                  onCheckedChange={(on) => void device.setSmartFree(on)}
                />
              </SettingRow>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
