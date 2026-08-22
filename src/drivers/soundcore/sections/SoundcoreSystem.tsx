import type { SoundcoreDevice, SoundcoreState } from '@/drivers/soundcore/device'
import { BUTTON_ACTION_NAMES, Gesture } from '@/drivers/soundcore/commands'
import { profileFor } from '@/core/profiles'
import { SystemTail } from '@/ui/sections/SystemTail'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DeviceInfoPanel } from '@/ui/panels/DeviceInfoPanel'
import { SettingRow } from '@/ui/controls/SettingRow'

interface Props {
  device: SoundcoreDevice
  state: SoundcoreState
}

const cell = (value: { level: number | null; charging: boolean } | undefined): string =>
  value === undefined || value.level === null ? '—' : `${value.level}%${value.charging ? ' ⚡' : ''}`

const GESTURE_LABELS: Record<number, string> = { 2: 'Single tap', 0: 'Double tap', 1: 'Hold' }

/** Grouping order as the official app lays them out: taps first, hold last. */
const GESTURE_ORDER = [Gesture.Single, Gesture.Double, Gesture.Long] as const

const BUTTON_ACTION_OPTIONS = Object.entries(BUTTON_ACTION_NAMES).map(([value, label]) => ({
  value: Number(value),
  label,
}))

// base-ui's Select wants an `items` record alongside the children.
const BUTTON_ACTION_ITEMS = Object.fromEntries(
  BUTTON_ACTION_OPTIONS.map(({ value, label }) => [String(value), label]),
)

/**
 * One on/off feature. A null value still renders as an enabled switch
 * (defaulting to off): not every firmware's state packet carries every flag,
 * but setting one is safe either way — the device echoes the write back and
 * pushes the real value where it has a push.
 */
function FlagToggle({
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  label: string
  hint: string
  value: boolean | null
  disabled: boolean
  onChange(on: boolean): void
}) {
  return (
    <SettingRow label={label} hint={value === null ? 'Not reported yet — toggling sets it.' : hint}>
      <Switch checked={value === true} disabled={disabled} onCheckedChange={onChange} />
    </SettingRow>
  )
}

export function SoundcoreSystem({ device, state }: Props) {
  const disabled = state.status !== 'connected'

  const details: Array<[string, string]> = [
    ['Model', state.info.model ?? 'Soundcore (BLE)'],
    ['Product code', state.info.productCode ?? '—'],
    ['Firmware', state.info.firmware ?? '—'],
    ['Serial', state.info.serial ?? '—'],
    ['Left earbud', cell(state.battery?.left)],
    ['Right earbud', cell(state.battery?.right)],
  ]

  return (
    <div className="flex flex-col gap-4">
      <DeviceInfoPanel
        rows={details.map(([label, value]) => ({ label, value }))}
        footnote={
          state.info.model === null
            ? 'The model comes from the Bluetooth name at connect time — the protocol has no model query.'
            : undefined
        }
      />

      <Card data-size="sm">
        <CardHeader>
          <CardTitle>Controls &amp; feedback</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col">
          <FlagToggle
            label="Wear detection"
            hint="Auto-pauses when a bud comes off."
            value={state.wearDetection}
            disabled={disabled}
            onChange={(on) => void device.setWearDetection(on)}
          />
          <FlagToggle
            label="Voice prompts"
            hint="Spoken status like “Connected”."
            value={state.voicePrompt}
            disabled={disabled}
            onChange={(on) => void device.setVoicePrompt(on)}
          />
          <FlagToggle
            label="Tap sound"
            hint="The beep confirming a touch command."
            value={state.touchTone}
            disabled={disabled}
            onChange={(on) => void device.setTouchTone(on)}
          />
        </CardContent>
      </Card>

      <Card data-size="sm">
        <CardHeader>
          <CardTitle>Audio quality</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col">
          <FlagToggle
            label="Preferred audio quality (LDAC)"
            hint="Higher-bitrate streaming where the source supports it."
            value={state.ldac}
            disabled={disabled}
            onChange={(on) => void device.setLdac(on)}
          />
        </CardContent>
      </Card>

      {(state.buttons?.length ?? 0) > 0 && (
        <Card data-size="sm">
          <CardHeader>
            <CardTitle>Touch controls</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {/* One flat group per gesture — how the official app lays this
                out, and how the device behaves: single-tap disable is
                enforced per pair by the firmware (disabling one side
                disables the other), so the switch belongs to the group and
                writes both buds' flags. Only the pair-linked action is
                shown; the solo slot only matters when one bud is used
                alone, and remapping must not clobber it. Groups separate by
                spacing alone — no boxes, no rules between rows. */}
            {GESTURE_ORDER.map((gesture) => {
              const rows = state.buttons!.filter((button) => button.gesture === gesture)
              if (rows.length === 0) return null
              const enabled = rows.every((button) => button.enabled)
              return (
                <div key={gesture} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{GESTURE_LABELS[gesture]}</p>
                    <Switch
                      checked={enabled}
                      disabled={disabled}
                      onCheckedChange={(on) => {
                        for (const row of rows) {
                          void device.setButtonEnabled(row.side, gesture, on)
                        }
                      }}
                      aria-label={`${GESTURE_LABELS[gesture]} enabled`}
                    />
                  </div>
                  <div className={cn('flex flex-col gap-2 pl-4', !enabled && 'opacity-60')}>
                    {rows.map((button) => (
                      <div key={button.side} className="flex items-center justify-between gap-4">
                        <span className="text-muted-foreground text-sm">
                          {button.side === 0 ? 'Left' : 'Right'}
                        </span>
                        <Select
                          items={BUTTON_ACTION_ITEMS}
                          value={String(button.twsAction)}
                          disabled={disabled || !button.enabled}
                          onValueChange={(value) =>
                            void device.setButtonAction(
                              button.side,
                              gesture,
                              Number(value),
                              // Single tap has no solo slot; for the rest,
                              // remapping must not touch what happens when a
                              // bud is used alone.
                              gesture === Gesture.Single ? Number(value) : button.soloAction,
                            )
                          }
                        >
                          <SelectTrigger className="w-40" size="sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {BUTTON_ACTION_OPTIONS.map(({ value, label }) => (
                              <SelectItem key={value} value={String(value)}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
            <div className="flex justify-end pt-1">
              <Button variant="outline" size="sm" disabled={disabled} onClick={() => void device.resetButtons()}>
                Reset to defaults
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <SystemTail capabilities={null} profile={profileFor('soundcore', state.info.model)} />
    </div>
  )
}
