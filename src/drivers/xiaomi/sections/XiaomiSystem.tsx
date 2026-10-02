import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ToggleRow } from '@/ui/controls/SettingRow'
import { BatteryBar } from '@/ui/device/DeviceImage'
import { SystemTail } from '@/ui/sections/SystemTail'
import { BATTERY_LABEL } from '../commands'
import type { XiaomiDevice, XiaomiState } from '../device'
import type { XiaomiCapability } from '../state'
import { ProtocolLog } from './ProtocolLog'

interface Props {
  device: XiaomiDevice
  state: XiaomiState
}

const hex4 = (value: number): string => value.toString(16).padStart(4, '0')

export function XiaomiSystem({ device, state }: Props) {
  const disabled = state.status !== 'connected'
  const { info } = state

  return (
    <div className="flex flex-col gap-4">
      <Card data-size="sm">
        <CardHeader>
          <CardTitle>Device</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm">
          <p>
            <span className="text-muted-foreground">Model </span>
            {info.model ?? 'Unknown'}
          </p>
          {info.btName && info.btName !== info.model && (
            <p>
              <span className="text-muted-foreground">Bluetooth name </span>
              {info.btName}
            </p>
          )}
          {info.vid !== null && info.pid !== null && (
            <p>
              <span className="text-muted-foreground">VID / PID </span>
              <span className="font-mono">
                {hex4(info.vid)} / {hex4(info.pid)}
              </span>
            </p>
          )}
          {info.firmware.length > 0 && (
            <p>
              <span className="text-muted-foreground">Firmware </span>
              {info.firmware.join(' · ')}
            </p>
          )}
          {state.handshake && (
            <p>
              <span className="text-muted-foreground">Handshake </span>
              {state.handshake === 'complete' ? 'Complete' : 'Skipped — the earbuds did not take part'}
            </p>
          )}
        </CardContent>
      </Card>

      {state.capabilities.has('wear') && state.wearDetection !== null && (
        <Card data-size="sm">
          <CardHeader>
            <CardTitle>Controls</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col">
            <ToggleRow
              label="In-ear detection"
              hint="Pauses when you take an earbud out."
              value={state.wearDetection}
              disabled={disabled}
              onChange={(value) => void device.setWearDetection(value)}
            />
          </CardContent>
        </Card>
      )}

      {state.battery.length > 0 && (
        <Card data-size="sm">
          <CardHeader>
            <CardTitle>Battery</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {state.battery.map((cell) => (
              <div key={cell.device} className="flex flex-col gap-1">
                <span className="text-muted-foreground text-xs">
                  {BATTERY_LABEL[cell.device]}
                  {cell.charging && ' · Charging'}
                </span>
                <BatteryBar battery={cell.level} charging={cell.charging} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {state.capabilities.has('find') && (
        <Card data-size="sm">
          <CardHeader>
            <CardTitle>Find my earbuds</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p className="text-muted-foreground">
              Remove the earbuds before ringing them. Not every model supports this.
            </p>
            {state.finding ? (
              <Button variant="destructive" disabled={disabled} onClick={() => void device.setFinding(false)}>
                Stop ringing
              </Button>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <Button variant="outline" disabled={disabled} onClick={() => void device.setFinding(true, 1)}>
                  Left
                </Button>
                <Button variant="outline" disabled={disabled} onClick={() => void device.setFinding(true, 2)}>
                  Right
                </Button>
                <Button variant="outline" disabled={disabled} onClick={() => void device.setFinding(true, 3)}>
                  Both
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <ProtocolLog device={device} connected={!disabled} />
      {/* No model profiles yet, so no not-supported-yet list: the tail shows
          what the device answered and the shared About. */}
      <SystemTail capabilities={<Capabilities reported={state.capabilities} />} profile={null} />
    </div>
  )
}

/** What each capability is called, in the order the card lists them. */
const CAPABILITY_NAMES: ReadonlyArray<[XiaomiCapability, string]> = [
  ['version', 'Firmware version'],
  ['battery', 'Battery'],
  ['wear', 'In-ear detection'],
  ['find', 'Find my earbuds'],
  ['anc', 'Noise control'],
  ['strength', 'Noise control strength'],
  ['eq', 'EQ presets'],
]

/** The features this connection actually answered. */
function Capabilities({ reported }: { reported: ReadonlySet<XiaomiCapability> }) {
  return (
    <Card data-size="sm">
      <CardHeader>
        <CardTitle>Reported capabilities</CardTitle>
        <p className="text-muted-foreground text-xs">Found by asking the earbuds when they connect.</p>
      </CardHeader>
      <CardContent>
        {reported.size === 0 ? (
          <p className="text-muted-foreground text-sm">Connect to read the device's capabilities.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {CAPABILITY_NAMES.filter(([id]) => reported.has(id)).map(([id, name]) => (
              <span key={id} className="bg-surface-raised rounded-full px-2.5 py-1 text-xs">
                {name}
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
