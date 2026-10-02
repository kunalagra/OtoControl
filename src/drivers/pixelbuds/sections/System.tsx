import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ToggleRow } from '@/ui/controls/SettingRow'
import { BatteryBar } from '@/ui/device/DeviceImage'
import { SystemTail } from '@/ui/sections/SystemTail'
import type { PixelBudsDevice, PixelBudsState } from '../device'
import type { BatteryCell } from '../maestro'
import type { PixelBudsCapability } from '../state'
import { ProtocolLog } from './ProtocolLog'

interface Props {
  device: PixelBudsDevice
  state: PixelBudsState
}

const CELL_LABEL: Record<BatteryCell['device'], string> = { left: 'Left', right: 'Right', case: 'Case' }

export function PixelBudsSystem({ device, state }: Props) {
  const disabled = state.status !== 'connected'
  const { firmware, serials } = state.info
  const versions = firmware
    ? (['left', 'right', 'case'] as const).flatMap((part) => (firmware[part] ? [`${CELL_LABEL[part]} ${firmware[part]}`] : []))
    : []
  const serialList = serials
    ? (['left', 'right', 'case'] as const).flatMap((part) => (serials[part] ? [`${CELL_LABEL[part]} ${serials[part]}`] : []))
    : []

  return (
    <div className="flex flex-col gap-4">
      <Card data-size="sm">
        <CardHeader>
          <CardTitle>Device</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm">
          <p>
            <span className="text-muted-foreground">Model </span>
            {state.info.model ?? 'Unknown'}
          </p>
          {versions.length > 0 && (
            <p>
              <span className="text-muted-foreground">Firmware </span>
              {versions.join(' · ')}
            </p>
          )}
          {serialList.length > 0 && (
            <p>
              <span className="text-muted-foreground">Serial </span>
              <span className="select-all">{serialList.join(' · ')}</span>
            </p>
          )}
          {state.channel !== null && (
            <p className="text-xs">
              <span className="text-muted-foreground">Maestro channel </span>
              {state.channel}
              {state.channelProbed && ' (found by asking)'}
            </p>
          )}
        </CardContent>
      </Card>

      {(state.capabilities.has('multipoint') || state.capabilities.has('onHead')) && (
        <Card data-size="sm">
          <CardHeader>
            <CardTitle>Controls</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col">
            {state.capabilities.has('multipoint') && (
              <ToggleRow
                label="Multipoint"
                hint="Stay connected to two devices at once."
                value={state.multipoint}
                disabled={disabled}
                onChange={(value) => void device.setMultipoint(value)}
              />
            )}
            {state.capabilities.has('onHead') && (
              <ToggleRow
                label="On-head detection"
                hint="Pauses when you take an earbud out."
                value={state.onHeadDetection}
                disabled={disabled}
                onChange={(value) => void device.setOnHeadDetection(value)}
              />
            )}
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
                  {CELL_LABEL[cell.device]}
                  {placementLabel(state.placement, cell.device)}
                  {cell.charging && ' · Charging'}
                </span>
                <BatteryBar battery={cell.level} charging={cell.charging} />
              </div>
            ))}
            {!state.battery.some((cell) => cell.device === 'case') && (
              <p className="text-muted-foreground text-xs">The case reports its level only while a bud is in it.</p>
            )}
          </CardContent>
        </Card>
      )}

      <ProtocolLog device={device} connected={!disabled} />
      {/* No model profiles: the tail shows what the buds answered and the shared About. */}
      <SystemTail capabilities={<Capabilities reported={state.capabilities} />} profile={null} />
    </div>
  )
}

/** What each capability is called, in the order the card lists them. */
const CAPABILITY_NAMES: ReadonlyArray<[PixelBudsCapability, string]> = [
  ['firmware', 'Firmware version'],
  ['battery', 'Battery'],
  ['anc', 'Noise control'],
  ['eq', 'Equalizer'],
  ['volumeEq', 'Volume EQ'],
  ['multipoint', 'Multipoint'],
  ['onHead', 'On-head detection'],
]

/** The features the earbuds answered for when they connected. */
function Capabilities({ reported }: { reported: ReadonlySet<PixelBudsCapability> }) {
  return (
    <Card data-size="sm">
      <CardHeader>
        <CardTitle>Reported capabilities</CardTitle>
        <p className="text-muted-foreground text-xs">Each one the earbuds answered a read for when they connected.</p>
      </CardHeader>
      <CardContent>
        {reported.size === 0 ? (
          <p className="text-muted-foreground text-sm">Connect to read the earbuds' capabilities.</p>
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

function placementLabel(placement: PixelBudsState['placement'], device: BatteryCell['device']): string {
  if (!placement || device === 'case') return ''
  return (device === 'left' ? placement.leftInCase : placement.rightInCase) ? ' · In case' : ''
}
