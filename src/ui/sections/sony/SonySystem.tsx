import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SonyFunction, codecName } from '@/mdr/commands'
import type { SonyDevice, SonyState } from '@/device/sony'
import { sonyColourName } from '../../device/artwork'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { AUTO_POWER_OFF_OPTIONS, autoPowerOffLabel } from '@/mdr/settings'
import { PowerOffButton } from './PowerOffButton'
import { SystemTail } from '../SystemTail'
import { SettingRow } from '../../controls/SettingRow'

interface Props {
  device: SonyDevice
  state: SonyState
}

/** Function IDs worth naming when listing what the device reports. */
const NAMED_FUNCTIONS: Array<[number, string]> = [
  [SonyFunction.LeftRightBatteryLevel, 'Per-earbud battery'],
  [SonyFunction.BatteryLevel, 'Battery'],
  [SonyFunction.CaseBatteryLevel, 'Case battery'],
  [SonyFunction.CodecIndicator, 'Codec'],
  [SonyFunction.UpscalingIndicator, 'DSEE upscaling'],
  [SonyFunction.UpscalingAutoOff, 'DSEE auto off'],
  [SonyFunction.UpscalingAutoOffWithDisableReason, 'DSEE auto off (with reason)'],
  [SonyFunction.AssignableSetting, 'Touch control assignment'],
  [SonyFunction.AssignableSettingWithLimitation, 'Touch control assignment (limited)'],
  [SonyFunction.QuickAccess, 'Quick access'],
  [SonyFunction.PresetEq, 'Preset equalizer'],
  [SonyFunction.CustomEq, 'Custom equalizer'],
  [SonyFunction.PowerOff, 'Power off from app'],
  [SonyFunction.AutoPowerOff, 'Auto power off'],
  [SonyFunction.AutoPowerOffWithWearingDetection, 'Auto power off (wear aware)'],
  [SonyFunction.PauseOnRemoval, 'Pause when removed'],
  [SonyFunction.SpeakToChat, 'Speak-to-chat'],
  [SonyFunction.SpeakToChatType2, 'Speak-to-chat (type 2)'],
  [SonyFunction.WearingStatusDetector, 'Wear detection'],
  [SonyFunction.NoiseCancellingOnOff, 'Noise cancelling'],
  [SonyFunction.AmbientSoundMode, 'Ambient sound'],
  [SonyFunction.ConnectionStatus, 'Connection status'],
  [SonyFunction.ConnectionQualityMode, 'Connection quality mode'],
  [SonyFunction.PlaybackController, 'Playback controls'],
  [SonyFunction.BleSetup, 'BLE setup'],
  [SonyFunction.TandemKeepAlive, 'Keep-alive'],
  [SonyFunction.FirmwareUpdate, 'Firmware update'],
  [SonyFunction.ConciergeData, 'Concierge data'],
  [SonyFunction.FixedMessage, 'Fixed messages'],
  [SonyFunction.FixedMessageWithLrSelection, 'Fixed messages (L/R)'],
  [SonyFunction.ActionLogNotifier, 'Action logging'],
]

export function SonySystem({ device, state }: Props) {
  const colour = sonyColourName(state.info.colour?.colour)

  /**
   * Each earbud reported separately rather than summarised into one sentence.
   *
   * A phrase like "Right in the case" is an inference two steps from the wire,
   * so when it disagrees with the earbuds in front of you there is no way to
   * tell whether the device said something unexpected or we read it wrong.
   * Stating each side's own reading keeps the claim to what was actually
   * reported, and makes a mismatch obvious.
   */
  const earbud = (side: 'left' | 'right'): string => {
    if (!state.battery) return '—'
    const cell = state.battery[side]
    // Not present means the bud left the tandem link; its level is meaningless.
    return cell.present ? `${cell.level}%${cell.charging ? ' · charging' : ''}` : 'In the case'
  }

  const details: Array<[string, string]> = [
    ['Model', state.info.model ?? '—'],
    ...(state.battery
      ? ([
          ['Left earbud', earbud('left')],
          ['Right earbud', earbud('right')],
        ] as Array<[string, string]>)
      : []),
    ['Firmware', state.info.firmware ?? '—'],
    ['Codec', state.codec === null ? '—' : codecName(state.codec)],
    [
      'Colour',
      state.info.colour === null
        ? '—'
        : (colour ??
          `unmapped (0x${state.info.colour.colour.toString(16).padStart(2, '0')})`),
    ],
  ]
  const capabilities = (
    <Card data-size="sm">
      <CardHeader>
        <CardTitle>Reported capabilities</CardTitle>
        <p className="text-muted-foreground text-xs">
          Read from the device itself, not assumed. Only what appears here is queried.
        </p>
      </CardHeader>
      <CardContent>
        {state.capabilities.size === 0 ? (
          <p className="text-muted-foreground text-sm">Connect to read the capability table.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {NAMED_FUNCTIONS.filter(([id]) => state.capabilities.has(id)).map(([id, name]) => (
              <span
                key={id}
                className="border-primary/40 bg-primary/10 rounded-full border px-2.5 py-1 text-xs"
              >
                {name}
              </span>
            ))}
            {(() => {
              const named = NAMED_FUNCTIONS.filter(([id]) => state.capabilities.has(id)).length
              const unnamed = state.capabilities.size - named
              return unnamed > 0 ? (
                <span className="text-muted-foreground self-center text-xs">
                  + {unnamed} unnamed
                </span>
              ) : null
            })()}
          </div>
        )}
      </CardContent>
    </Card>
  )

  const hasAutoOff = state.capabilities.has(SonyFunction.AutoPowerOff)
  const hasPauseOnRemoval = state.capabilities.has(SonyFunction.PauseOnRemoval)

  // The device may report a timeout outside our list; keep it rather than
  // silently snapping the dropdown to a different value.
  const timeouts =
    state.autoPowerOff === null ||
    AUTO_POWER_OFF_OPTIONS.some((option) => option.value === state.autoPowerOff)
      ? AUTO_POWER_OFF_OPTIONS
      : [...AUTO_POWER_OFF_OPTIONS, { value: state.autoPowerOff, label: autoPowerOffLabel(state.autoPowerOff) }]

  const behaviour =
    hasAutoOff || hasPauseOnRemoval ? (
      <Card data-size="sm">
        <CardContent className="flex flex-col">
          {hasPauseOnRemoval && (
            <SettingRow
              label="Pause when removed"
              hint="Stops playback when you take them off, resumes when you put them back."
            >
              <Switch
                checked={state.pauseOnRemoval === true}
                disabled={state.status !== 'connected' || state.pauseOnRemoval === null}
                onCheckedChange={(on) => void device.setPauseOnRemoval(on)}
              />
            </SettingRow>
          )}

          {hasAutoOff && (
            <SettingRow label="Auto power off" hint="When idle and not connected to anything.">
              <Select
                items={timeouts.map(({ value, label }) => ({ value: String(value), label }))}
                value={state.autoPowerOff === null ? undefined : String(state.autoPowerOff)}
                disabled={state.status !== 'connected' || state.autoPowerOff === null}
                onValueChange={(value) => void device.setAutoPowerOff(Number(value))}
              >
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Not reported" />
                </SelectTrigger>
                <SelectContent>
                  {timeouts.map(({ value, label }) => (
                    <SelectItem key={value} value={String(value)}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>
          )}
        </CardContent>
      </Card>
    ) : null

  const power = state.capabilities.has(SonyFunction.PowerOff) ? (
    <Card data-size="sm">
      <CardHeader>
        <CardTitle>Power</CardTitle>
      </CardHeader>
      <CardContent>
        <SettingRow
          label="Turn off"
          hint="Powers the earbuds off. The connection will drop; put them in the case and take them out again to reconnect."
        >
          <PowerOffButton
            disabled={state.status !== 'connected'}
            onConfirm={() => void device.powerOff()}
          />
        </SettingRow>
      </CardContent>
    </Card>
  ) : null

  return (
    <div className="flex flex-col gap-4">
      <Card data-size="sm">
        <CardHeader>
          <CardTitle>Device</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="flex flex-col">
            {details.map(([label, value]) => (
              <div
                key={label}
                className="border-border flex items-baseline justify-between gap-4 border-b py-1.5 text-[13px] last:border-b-0"
              >
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-right font-mono text-xs break-all">{value}</dd>
              </div>
            ))}
          </dl>
          {colour === null && state.info.colour !== null && (
            <p className="text-muted-foreground mt-3 text-xs">
              This colour byte is outside Sony's <code>ModelColor</code> enum. See
              <code> docs/PROTOCOL-UNKNOWNS.md</code>.
            </p>
          )}
        </CardContent>
      </Card>

      {behaviour}

      {power}

      <SystemTail capabilities={capabilities} brand="sony" model={state.info.model} />
    </div>
  )
}
