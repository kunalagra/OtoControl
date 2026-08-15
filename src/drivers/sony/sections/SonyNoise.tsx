import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { AMBIENT_LEVEL_MAX, NcAsmMode } from '@/drivers/sony/mdr/noise'
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
  // drive — worth saying, rather than showing an empty page.
  if (noise === null) {
    return (
      <Card data-size="sm">
        <CardContent>
          <p className="text-muted-foreground text-sm">
            {noiseVariant === null
              ? 'This device reports no noise control.'
              : 'These headphones have noise control, but in a protocol variant this app does not support yet.'}
          </p>
        </CardContent>
      </Card>
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
    </div>
  )
}
