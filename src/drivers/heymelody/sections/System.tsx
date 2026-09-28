import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BatteryBar } from '@/ui/device/DeviceImage'
import { SystemTail } from '@/ui/sections/SystemTail'
import { OEM_BRAND_NAME } from '../catalog'
import type { HeyMelodyDevice, HeyMelodyState } from '../device'
import { BATTERY_LABEL } from '../protocol/battery'
import type { BatteryDevice } from '../protocol/battery'
import type { HeyMelodyCapability } from '../state'

interface Props {
  device: HeyMelodyDevice
  state: HeyMelodyState
}

export function HeyMelodySystem({ device, state }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <Card data-size="sm">
        <CardHeader>
          <CardTitle>Device</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm">
          <p>
            <span className="text-muted-foreground">Model </span>
            {state.info.catalog?.name ?? 'Unknown'}
          </p>
          <p>
            <span className="text-muted-foreground">Brand </span>
            {state.info.catalog ? OEM_BRAND_NAME[state.info.catalog.brand] : 'Unknown'}
          </p>
          <p>
            <span className="text-muted-foreground">Product ID </span>
            {state.info.productId ?? '—'}
          </p>
          {state.info.version.length > 0 && (
            <p>
              <span className="text-muted-foreground">Firmware </span>
              {state.info.version
                .map((entry) => `${entry.device === 'other' ? '' : `${BATTERY_LABEL[entry.device]} `}${entry.version}`)
                .join(' · ')}
            </p>
          )}
        </CardContent>
      </Card>

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
                  {wearLabel(state.wear, cell.device)}
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
            <p className="text-muted-foreground">Remove the earbuds before ringing them.</p>
            <Button
              variant={state.finding ? 'destructive' : 'outline'}
              disabled={state.status !== 'connected'}
              onClick={() => void device.setFinding(!state.finding)}
            >
              {state.finding ? 'Stop ringing' : 'Ring earbuds'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* No model profiles yet, so no not-supported-yet list: the tail shows
          what the device reported and the shared About. */}
      <SystemTail capabilities={<Capabilities reported={state.capabilities} />} profile={null} />
    </div>
  )
}

/** What each capability is called, in the order the card lists them. */
const CAPABILITY_NAMES: ReadonlyArray<[HeyMelodyCapability, string]> = [
  ['version', 'Firmware version'],
  ['battery', 'Battery'],
  ['wear', 'Wear detection'],
  ['find', 'Find my earbuds'],
  ['anc', 'Noise control'],
  ['eq', 'EQ presets'],
  ['eqCustom', 'Custom EQ'],
]

/** The features the device's command table (0x0100) says it supports. */
function Capabilities({ reported }: { reported: ReadonlySet<HeyMelodyCapability> }) {
  return (
    <Card data-size="sm">
      <CardHeader>
        <CardTitle>Reported capabilities</CardTitle>
        <p className="text-muted-foreground text-xs">
          Read from the command table the earbuds send when they connect.
        </p>
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

function wearLabel(wear: HeyMelodyState['wear'], device: BatteryDevice): string {
  const cell = wear.find((entry) => entry.device === device);
  if (!cell) return '';
  return cell.inEar ? ' · In ear' : cell.inBox ? ' · In case' : '';
}
