import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BatteryBar } from '@/ui/device/DeviceImage'
import { OEM_BRAND_NAME } from '../catalog'
import type { HeyMelodyState } from '../device'
import { BATTERY_LABEL } from '../commands'

interface Props {
  state: HeyMelodyState
}

export function HeyMelodySystem({ state }: Props) {
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
                  {cell.charging && ' · Charging'}
                </span>
                <BatteryBar battery={cell.level} charging={cell.charging} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
