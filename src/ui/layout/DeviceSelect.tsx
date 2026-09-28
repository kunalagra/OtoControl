import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ActiveDevice, DeviceManager } from '@/core/manager'
import { M4_SERVICE_UUID } from '@/core/transport'

interface Props {
  manager: DeviceManager
  active: ActiveDevice
}

/**
 * How many granted devices it takes before switching between them is a
 * question worth asking at all.
 *
 * A dropdown of one is not a dropdown, and a "Switch" pill beside the only
 * device name in the app is a control that cannot do anything — so the top bar
 * asks this before it offers one, and `DeviceSelect` asks it before it renders.
 * A constant rather than a helper so both sides name the same rule without
 * either importing the other's component.
 */
export const MIN_DEVICES_TO_SWITCH = 2

/**
 * Switches between granted devices.
 *
 * Only shown when there are at least `MIN_DEVICES_TO_SWITCH`, for the reason
 * above. Labels come from the model string cached on a previous connection —
 * `port.getInfo()` exposes only a service ID, so an unvisited device can only
 * be named by brand.
 *
 * **Serial devices only.** `manager.available` comes from `listGrantedPorts()`,
 * so a BLE device — every Soundcore — never appears here and cannot be
 * switched back to once you move away from it; the only route back is the
 * Bluetooth picker or `autoConnect`'s BLE fallback. Listing them would need
 * `available` to merge `grantedGattDevices()` and to key entries on something
 * other than a service UUID, since BLE has none.
 */
export function DeviceSelect({ manager, active }: Props) {
  const available = manager.available
  if (available.length < MIN_DEVICES_TO_SWITCH) return null

  // The active entry is identified by brand, which is as precise as the port
  // information allows.
  const current =
    available.find((entry) => entry.brand === active.driver.brand)?.uuid ??
    (active.driver.brand === 'sennheiser' ? M4_SERVICE_UUID : available[0].uuid)

  return (
    <Select
      items={available.map(({ uuid, label }) => ({ value: uuid, label }))}
      value={current}
      onValueChange={(uuid) => {
        if (uuid) void manager.select(uuid)
      }}
    >
      <SelectTrigger size="sm" className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {available.map(({ uuid, label }) => (
          <SelectItem key={uuid} value={uuid}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
