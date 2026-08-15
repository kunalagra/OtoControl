import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ANTI_WIND_OPTIONS, AncMode, AntiWind } from '@/drivers/sennheiser/gaia/commands'
import { cn } from '@/lib/utils'
import { Knob } from '@/ui/controls/Knob'
import { SettingRow } from '@/ui/controls/SettingRow'
import { Switch } from '@/components/ui/switch'
import { NEUTRAL_LEVEL, describeLevel, noiseReadout } from '../noiseLevel'
import type { SectionProps } from './types'

type NoiseMode = 'adaptive' | 'custom' | 'off'

/** Base UI needs this to render the label rather than the raw value. */
const ANTI_WIND_ITEMS = ANTI_WIND_OPTIONS.map(({ value, label }) => ({
  value: String(value),
  label,
}))

const MODES: Array<{ id: NoiseMode; label: string; hint: string }> = [
  { id: 'adaptive', label: 'Adaptive', hint: 'Adjusts to your surroundings' },
  { id: 'custom', label: 'Custom', hint: 'Set the level yourself' },
  { id: 'off', label: 'Off', hint: 'Longest battery life' },
]

/** ANC on/off and adaptive together imply the mode; there is no mode command. */
function currentMode(state: SectionProps['state']): NoiseMode | null {
  const { ancEnabled, modes } = state.noise
  if (ancEnabled === null) return null
  if (!ancEnabled) return 'off'
  return modes?.adaptive === 1 ? 'adaptive' : 'custom'
}

export function Noise({ device, state }: SectionProps) {
  const mode = currentMode(state)
  const { transparencyLevel, modes } = state.noise
  const disabled = state.status !== 'connected'
  const level = transparencyLevel ?? NEUTRAL_LEVEL
  const readout = noiseReadout(level)

  async function selectMode(next: NoiseMode) {
    if (next === 'off') {
      await device.setAnc(false)
      return
    }
    await device.setAnc(true)
    await device.setAncMode(AncMode.Adaptive, next === 'adaptive' ? 1 : 0)
    if (next === 'custom') {
      // Custom in the phone app lands on cancelling with wind reduction on.
      await device.setAncMode(AncMode.AntiWind, AntiWind.Auto)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card data-size="sm">
        <CardContent className="flex flex-col items-center gap-4">
          <Knob
            value={level}
            onChange={(next) => void device.setTransparencyLevel(next)}
            detent={NEUTRAL_LEVEL}
            disabled={disabled || mode !== 'custom' || transparencyLevel === null}
            label="Noise control level, from cancelling to transparency"
            caption={describeLevel(level)}
          >
            {transparencyLevel === null ? (
              <span className="text-muted-foreground text-sm">Unknown</span>
            ) : (
              <>
                <span className="text-3xl font-semibold tabular-nums">
                  {readout.kind === 'neutral' ? '—' : `${readout.percent}%`}
                </span>
                <span className="text-muted-foreground text-xs">{readout.label}</span>
              </>
            )}
          </Knob>

          <div className="text-muted-foreground flex w-full max-w-xs justify-between text-[11px]">
            <span>Cancelling</span>
            <span>Transparency</span>
          </div>

          <div className="grid w-full grid-cols-3 gap-2">
            {MODES.map(({ id, label, hint }) => (
              <button
                key={id}
                type="button"
                disabled={disabled}
                aria-pressed={mode === id}
                onClick={() => void selectMode(id)}
                className={cn(
                  'flex flex-col gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors',
                  'focus-visible:ring-ring outline-none focus-visible:ring-2',
                  'disabled:cursor-default disabled:opacity-50',
                  mode === id
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-muted-foreground/40',
                )}
              >
                <span className="text-sm font-medium">{label}</span>
                <span className="text-muted-foreground text-[11px] leading-tight">{hint}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {modes && (
        <Card data-size="sm">
          <CardContent className="flex flex-col">
            {/* Three-state, not a toggle: the app config lists
                supported_anti_wind_values as off / max / auto. */}
            <SettingRow label="Wind noise reduction" hint="Reduces wind rumble outdoors.">
              <Select
                items={ANTI_WIND_ITEMS}
                value={String(modes.antiWind)}
                disabled={disabled}
                onValueChange={(value) =>
                  void device.setAncMode(AncMode.AntiWind, Number(value))
                }
              >
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ANTI_WIND_OPTIONS.map(({ value, label }) => (
                    <SelectItem key={value} value={String(value)}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>
            <SettingRow label="Comfort" hint="Gentler cancelling, less ear pressure.">
              <Switch
                checked={modes.comfort === 1}
                disabled={disabled}
                onCheckedChange={(on) => void device.setAncMode(AncMode.Comfort, on ? 1 : 0)}
              />
            </SettingRow>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
