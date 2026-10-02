import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ToggleRow } from '@/ui/controls/SettingRow'
import { BatteryBar } from '@/ui/device/DeviceImage'
import { SystemTail } from '@/ui/sections/SystemTail'
import type { SamsungDevice, SamsungState } from '../device'
import { PLACEMENT_LABEL } from '../labels'
import { modelById } from '../models'
import { ProtocolLog } from './ProtocolLog'

interface Props {
  device: SamsungDevice
  state: SamsungState
}

const CELLS = [
  { key: 'left', label: 'Left' },
  { key: 'right', label: 'Right' },
  { key: 'case', label: 'Case' },
] as const

export function SamsungSystem({ device, state }: Props) {
  const disabled = state.status !== 'connected'
  const model = modelById(state.info.modelId)
  const hasBattery = CELLS.some(({ key }) => state.battery[key] !== null)

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
          {state.info.sku && (
            <p>
              <span className="text-muted-foreground">SKU </span>
              <span className="font-mono select-all">{state.info.sku}</span>
            </p>
          )}
          {state.info.revision !== null && (
            <p>
              <span className="text-muted-foreground">Status revision </span>
              {state.info.revision}
            </p>
          )}
          {state.info.firmware && (
            <p>
              <span className="text-muted-foreground">Firmware </span>
              <span className="font-mono select-all break-all">{state.info.firmware}</span>
            </p>
          )}
          {state.info.hardware && (
            <p>
              <span className="text-muted-foreground">Hardware </span>
              {state.info.hardware}
            </p>
          )}
          {state.diagnostics.sku && (
            <p className="text-xs">
              <span className="text-muted-foreground">SKU reply </span>
              <span className="font-mono select-all break-all">{state.diagnostics.sku}</span>
            </p>
          )}
          {state.diagnostics.version && (
            <p className="text-xs">
              <span className="text-muted-foreground">Firmware reply </span>
              <span className="font-mono select-all break-all">{state.diagnostics.version}</span>
            </p>
          )}
        </CardContent>
      </Card>

      {model?.lock && (
        <Card data-size="sm">
          <CardHeader>
            <CardTitle>Controls</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col">
            <ToggleRow
              label="Lock touch controls"
              hint="Ignores taps and holds on the earbuds."
              value={state.touchLocked}
              disabled={disabled}
              onChange={(locked) => void device.setTouchLocked(locked)}
            />
          </CardContent>
        </Card>
      )}

      {hasBattery && (
        <Card data-size="sm">
          <CardHeader>
            <CardTitle>Battery</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {CELLS.filter(({ key }) => state.battery[key] !== null).map(({ key, label }) => (
              <div key={key} className="flex flex-col gap-1">
                <span className="text-muted-foreground text-xs">
                  {label}
                  {key !== 'case' && ` · ${PLACEMENT_LABEL[state.placement[key]]}`}
                  {state.charging[key] && ' · Charging'}
                </span>
                <BatteryBar battery={state.battery[key]} charging={state.charging[key]} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card data-size="sm">
        <CardHeader>
          <CardTitle>Find my earbuds</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm">
          <p className="text-muted-foreground">Remove the earbuds before ringing them.</p>
          <Button
            variant={state.finding ? 'destructive' : 'outline'}
            disabled={disabled}
            onClick={() => void device.setFinding(!state.finding)}
          >
            {state.finding ? 'Stop ringing' : 'Ring earbuds'}
          </Button>
        </CardContent>
      </Card>

      <ProtocolLog device={device} connected={!disabled} />
      <SystemTail capabilities={null} profile={null} />
    </div>
  )
}
