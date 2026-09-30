import type { BoatDevice, BoatState } from '@/drivers/boat/device'
import { SettingRow } from '@/ui/controls/SettingRow'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface Props {
  device: BoatDevice
  state: BoatState
}

/**
 * ANC mode names from `AncRequest` (`ANC_MODE_OFF/ON/TRANSPARENCY/COMMUTE/
 * INDOOR/ADAPTIVE`) — the modes cmd 53 tag 1 accepts. The deprecated
 * single-byte setters (cmds 44/48/49) are not offered.
 */
const ANC_MODES = [
  { value: 0, label: 'Off' },
  { value: 1, label: 'Noise cancellation' },
  { value: 2, label: 'Transparency' },
  { value: 3, label: 'Commute' },
  { value: 4, label: 'Indoor' },
  { value: 5, label: 'Adaptive' },
]

export function BoatNoise({ device, state }: Props) {
  const disabled = state.status !== 'connected'
  return (
    <Card>
      <CardHeader>
        <CardTitle>Noise control</CardTitle>
      </CardHeader>
      <CardContent>
        <SettingRow label="ANC mode" hint={state.ancMode === null ? 'Not reported yet.' : undefined}>
          <Select
            value={state.ancMode === null ? undefined : String(state.ancMode)}
            onValueChange={(value) => void device.setAncMode(Number(value))}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select mode" />
            </SelectTrigger>
            <SelectContent>
              {ANC_MODES.map((mode) => (
                <SelectItem key={mode.value} value={String(mode.value)}>
                  {mode.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
      </CardContent>
    </Card>
  )
}
