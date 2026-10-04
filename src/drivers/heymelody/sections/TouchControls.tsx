import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SettingRow } from '@/ui/controls/SettingRow'
import type { HeyMelodyDevice, HeyMelodyState } from '../device'
import { ACTION_LABEL, SIDE_LABEL, functionChoices } from '../protocol/gesture'

interface Props {
  device: HeyMelodyDevice
  state: HeyMelodyState
}

/** The touch-control table, grouped by side; each gesture picks from the functions its model accepts, when the catalog knows them. */
export function TouchControls({ device, state }: Props) {
  const { gestures } = state
  const brand = state.info.catalog?.brand ?? null
  const disabled = state.status !== 'connected'
  const sides = [...new Set(gestures.map((record) => record.deviceType))].sort((a, b) => a - b)

  return (
    <Card data-size="sm">
      <CardHeader>
        <CardTitle>Touch controls</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {sides.map((side) => (
          <div key={side} className="flex flex-col">
            <span className="text-muted-foreground text-xs font-medium">{SIDE_LABEL[side] ?? `Side ${side}`}</span>
            {gestures
              .filter((record) => record.deviceType === side)
              .map((record) => {
                const choices = functionChoices(record, gestures, brand, state.info.catalog)
                const items = choices.map(({ fn, label }) => ({ value: String(fn), label }))
                const name = ACTION_LABEL[record.action] ?? `Action ${record.action}`
                return (
                  <SettingRow
                    key={`${record.button}-${record.action}`}
                    label={record.button === 6 ? `${name} (calls)` : name}
                    name={`${SIDE_LABEL[side] ?? `Side ${side}`} ${record.button === 6 ? `${name} (calls)` : name}`}
                  >
                    <Select
                      items={items}
                      value={String(record.fn)}
                      disabled={disabled}
                      onValueChange={(value) => void device.setGesture(record, Number(value))}
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {items.map(({ value, label }) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </SettingRow>
                )
              })}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
