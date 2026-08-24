import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { AMBIENT_LEVEL_MAX, NcAsmMode } from '@/drivers/sony/mdr/noise'
import {
  SPEAK_TO_CHAT_SENSITIVITY_OPTIONS,
  SPEAK_TO_CHAT_TIMEOUT_OPTIONS,
} from '@/drivers/sony/mdr/speakToChat'
import type { SonyDevice, SonyState } from '@/drivers/sony/sony'
import { SettingRow } from '@/ui/controls/SettingRow'

interface Props {
  device: SonyDevice
  state: SonyState
}

const MODES = [
  {
    value: NcAsmMode.NoiseCancelling,
    label: 'Noise cancelling',
    hint: 'Blocks out what is around you',
  },
  { value: NcAsmMode.Ambient, label: 'Ambient sound', hint: 'Lets the room through' },
]

export function SonyNoise({ device, state }: Props) {
  const disabled = state.status !== 'connected'
  const { noise, noiseVariant } = state

  // A variant with no reading means the device has noise control we cannot
  // drive — worth saying, rather than showing an empty page. Speak-to-chat
  // is a separate capability and shows regardless of the noise one.
  if (noise === null) {
    return (
      <div className="flex flex-col gap-4">
        <Card data-size="sm">
          <CardContent>
            <p className="text-muted-foreground text-sm">
              {noiseVariant === null
                ? 'This device reports no noise control.'
                : 'These headphones have noise control, but in a protocol variant this app does not support yet.'}
            </p>
          </CardContent>
        </Card>
        <SpeakToChatCard device={device} state={state} />
      </div>
    )
  }

  const ambient = noise.mode === NcAsmMode.Ambient

  return (
    <div className="flex flex-col gap-4">
      <Card data-size="sm">
        <CardHeader>
          <CardTitle>Noise control</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <SettingRow label="Processing" hint="Off uses the least battery.">
            <Switch
              checked={noise.enabled}
              disabled={disabled}
              onCheckedChange={(enabled) => void device.setNoise({ enabled })}
            />
          </SettingRow>

          <div
            className={cn(
              'grid grid-cols-2 gap-2 transition-opacity',
              !noise.enabled && 'pointer-events-none opacity-40',
            )}
          >
            {MODES.map(({ value, label, hint }) => (
              <button
                key={value}
                type="button"
                disabled={disabled}
                aria-pressed={noise.mode === value}
                onClick={() => void device.setNoise({ mode: value })}
                className={cn(
                  'flex flex-col gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors',
                  'focus-visible:ring-ring outline-none focus-visible:ring-2',
                  'disabled:cursor-default disabled:opacity-50',
                  noise.mode === value
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-muted-foreground/40',
                )}
              >
                <span className="text-sm font-medium">{label}</span>
                <span className="text-muted-foreground text-[11px] leading-tight">{hint}</span>
              </button>
            ))}
          </div>

          {/* Only meaningful in ambient mode, and only on variants that have
              a level at all rather than a plain on/off. */}
          {noise.ambientLevel !== null && (
            <div
              className={cn(
                'flex flex-col gap-3 transition-opacity',
                (!noise.enabled || !ambient) && 'pointer-events-none opacity-40',
              )}
            >
              <SettingRow label="Ambient level" hint="How much of the room comes through.">
                <div className="flex w-40 items-center gap-3">
                  <Slider
                    value={[noise.ambientLevel]}
                    min={0}
                    max={AMBIENT_LEVEL_MAX}
                    step={1}
                    disabled={disabled}
                    aria-label="Ambient sound level"
                    onValueChange={(value) =>
                      void device.setNoise({
                        ambientLevel: Array.isArray(value) ? value[0] : value,
                      })
                    }
                  />
                  <span className="text-muted-foreground w-6 text-right text-xs tabular-nums">
                    {noise.ambientLevel}
                  </span>
                </div>
              </SettingRow>

              {noise.voiceFocus !== null && (
                <SettingRow label="Focus on voice" hint="Passes speech through, not everything.">
                  <Switch
                    checked={noise.voiceFocus}
                    disabled={disabled}
                    onCheckedChange={(voiceFocus) => void device.setNoise({ voiceFocus })}
                  />
                </SettingRow>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <SpeakToChatCard device={device} state={state} />
    </div>
  )
}

/**
 * Speak-to-chat: the headphones notice you are talking and dip to ambient on
 * their own. A separate card rather than a row inside the noise card, because
 * it is a separate capability — a device can report either without the other.
 */
function SpeakToChatCard({ device, state }: Props) {
  const disabled = state.status !== 'connected'
  const speakToChat = state.speakToChat
  if (speakToChat === null) return null

  const optionButton = (
    value: number,
    current: number | null,
    label: string,
    pick: () => void,
  ) => (
    <button
      key={value}
      type="button"
      disabled={disabled}
      aria-pressed={current === value}
      onClick={pick}
      className={cn(
        'rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors',
        'focus-visible:ring-ring outline-none focus-visible:ring-2',
        'disabled:cursor-default disabled:opacity-50',
        current === value
          ? 'border-primary bg-primary/10'
          : 'border-border hover:border-muted-foreground/40',
      )}
    >
      {label}
    </button>
  )

  return (
    <Card data-size="sm">
      <CardHeader>
        <CardTitle>Speak-to-chat</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <SettingRow
          label="Enabled"
          hint="Dips to ambient sound automatically while you talk."
        >
          <Switch
            checked={speakToChat.enabled === true}
            disabled={disabled || speakToChat.enabled === null}
            onCheckedChange={(enabled) => void device.setSpeakToChatEnabled(enabled)}
          />
        </SettingRow>

        {speakToChat.sensitivity !== null && speakToChat.timeout !== null && (
          <div
            className={cn(
              'flex flex-col gap-3 transition-opacity',
              speakToChat.enabled !== true && 'pointer-events-none opacity-40',
            )}
          >
            <SettingRow label="Sensitivity" hint="How readily talking triggers it.">
              <div className="flex flex-wrap justify-end gap-1.5">
                {SPEAK_TO_CHAT_SENSITIVITY_OPTIONS.map((option) =>
                  optionButton(
                    option.value,
                    speakToChat.sensitivity,
                    option.label,
                    () => void device.setSpeakToChatConfig(option.value, speakToChat.timeout!),
                  ),
                )}
              </div>
            </SettingRow>
            <SettingRow label="Returns after" hint="How long it waits after you stop talking.">
              <div className="flex flex-wrap justify-end gap-1.5">
                {SPEAK_TO_CHAT_TIMEOUT_OPTIONS.map((option) =>
                  optionButton(
                    option.value,
                    speakToChat.timeout,
                    option.label,
                    () => void device.setSpeakToChatConfig(speakToChat.sensitivity!, option.value),
                  ),
                )}
              </div>
            </SettingRow>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
