import type { BoatDevice, BoatState } from '@/drivers/boat/device'
import { SettingRow } from '@/ui/controls/SettingRow'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'

interface Props {
  device: BoatDevice
  state: BoatState
}

export function BoatSystem({ device, state }: Props) {
  const disabled = state.status !== 'connected'
  return (
    <Card>
      <CardHeader>
        <CardTitle>System</CardTitle>
      </CardHeader>
      <CardContent>
        <SettingRow label="In-ear detection" hint="Auto-pause when a bud is removed.">
          <Switch
            checked={state.inEar === true}
            disabled={disabled}
            onCheckedChange={(on) => void device.setInEarDetect(on)}
          />
        </SettingRow>
        <SettingRow label="Find my buds" hint="Rings the buds until stopped.">
          <span>
            <Button disabled={disabled} onClick={() => void device.setFindDevice(true)}>
              Ring
            </Button>{' '}
            <Button disabled={disabled} onClick={() => void device.setFindDevice(false)}>
              Stop
            </Button>
          </span>
        </SettingRow>
      </CardContent>
    </Card>
  )
}
