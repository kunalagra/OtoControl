import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SettingRow } from '@/ui/controls/SettingRow'
import type { GestureRecord } from '../commands'
import type { XiaomiDevice, XiaomiState } from '../device'
import { CYCLE_LABEL, CYCLE_MASKS, TAP_LABEL, actionChoices, listedTaps, usesCycle } from '../gestures'
import { modelGates } from '../models'

interface Props {
  device: XiaomiDevice
  state: XiaomiState
}

const SIDES = ['left', 'right'] as const
const SIDE_LABEL = { left: 'Left', right: 'Right' } as const

/** The gesture table: one row per tap and side, each choosing among the actions its model offers. */
export function XiaomiTouchControls({ device, state }: Props) {
  const gates = modelGates(state.info)
  const disabled = state.status !== 'connected'
  const records = listedTaps(state.gestures, gates)
  if (records.length === 0) return null

  return (
    <Card data-size="sm">
      <CardHeader>
        <CardTitle>Touch controls</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {records.map((record) => (
          <div key={record.tap} className="flex flex-col">
            <span className="text-muted-foreground text-xs font-medium">{TAP_LABEL[record.tap] ?? `Tap ${record.tap}`}</span>
            {SIDES.map((side) => {
              const items = actionChoices(record.tap, record[side], gates).map(({ action, label }) => ({ value: String(action), label }))
              return (
                <SettingRow key={side} label={SIDE_LABEL[side]} name={`${SIDE_LABEL[side]} ${TAP_LABEL[record.tap] ?? `tap ${record.tap}`}`}>
                  <Select
                    items={items}
                    value={String(record[side])}
                    disabled={disabled}
                    onValueChange={(value) => void device.setGesture(record.tap, side, Number(value))}
                  >
                    <SelectTrigger className="w-44">
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
            {usesCycle(record as GestureRecord, gates) && state.longPressCycle && (
              <CycleRows device={device} cycle={state.longPressCycle} disabled={disabled} />
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

/** Which modes a long press cycles through, per side; shown under a long press set to noise control. */
function CycleRows({ device, cycle, disabled }: { device: XiaomiDevice; cycle: [number, number]; disabled: boolean }) {
  return (
    <>
      {SIDES.map((side, index) => {
        const mask = cycle[index]
        const items = (CYCLE_MASKS.includes(mask) ? [...CYCLE_MASKS] : [...CYCLE_MASKS, mask]).map((value) => ({
          value: String(value),
          label: CYCLE_LABEL[value] ?? `Mode ${value}`,
        }))
        return (
          <SettingRow key={side} label={`${SIDE_LABEL[side]} cycles`}>
            <Select
              items={items}
              value={String(mask)}
              disabled={disabled}
              onValueChange={(value) => void device.setLongPressCycle(side, Number(value))}
            >
              <SelectTrigger className="w-56">
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
    </>
  )
}
