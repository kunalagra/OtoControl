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
 * Switches between granted devices.
 *
 * Only shown when there is more than one, since with a single device it would
 * be a dropdown with one entry. Labels come from the model string cached on a
 * previous connection — `port.getInfo()` exposes only a service ID, so an
 * unvisited device can only be named by brand.
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
  if (available.length < 2) return null

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
