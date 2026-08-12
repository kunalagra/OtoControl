import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EQ_PRESETS, eqBandLabel } from '@/gaia/commands'
import { togglesFor } from '@/device/state'
import { cn } from '@/lib/utils'
import { Fader } from '../controls/Fader'
import { ToggleRow } from '../controls/SettingRow'
import type { SectionProps } from './types'

/** True when every band matches the preset, within rounding. */
function matchesPreset(gains: Array<number | undefined>, preset: number[]): boolean {
  if (gains.length !== preset.length) return false
  return preset.every((value, index) => Math.abs((gains[index] ?? 0) - value) < 0.05)
}

export function Sound({ device, state }: SectionProps) {
  const { config, gains } = state.eq
  const disabled = state.status !== 'connected'
  const soundToggles = togglesFor(state.info.model).filter((toggle) => toggle.group === 'sound')

  return (
    <div className="flex flex-col gap-4">
      <Card data-size="sm">
        <CardHeader>
          <CardTitle>Equalizer</CardTitle>
        </CardHeader>
        <CardContent>
          {config === null ? (
            <p className="text-muted-foreground text-sm">
              {state.status === 'connected'
                ? 'This firmware did not answer the equaliser query.'
                : 'Connect to load the equaliser.'}
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {config.bands === EQ_PRESETS[0].gains.length && (
                <div className="flex flex-wrap gap-1.5">
                  {EQ_PRESETS.map((preset) => {
                    const active = matchesPreset(gains, preset.gains)
                    return (
                      <Button
                        key={preset.name}
                        type="button"
                        size="sm"
                        variant={active ? 'default' : 'outline'}
                        disabled={disabled}
                        className={cn('rounded-full', !active && 'text-muted-foreground')}
                        onClick={() => void device.setEqGains(preset.gains)}
                      >
                        {preset.name}
                      </Button>
                    )
                  })}
                </div>
              )}

              <div className="flex justify-between gap-2">
                {Array.from({ length: config.bands }, (_, band) => (
                  <Fader
                    key={band}
                    value={gains[band]}
                    onChange={(gain) => void device.setEqBand(band, gain)}
                    range={{ min: config.minGain, max: config.maxGain }}
                    disabled={disabled}
                    label={`${eqBandLabel(band, config.bands)} gain in decibels`}
                    caption={eqBandLabel(band, config.bands)}
                  />
                ))}
              </div>

              <p className="text-muted-foreground text-xs">
                {config.minGain} to +{config.maxGain} dB, reported by the headphones
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {soundToggles.length > 0 && (
        <Card data-size="sm">
          <CardContent className="flex flex-col">
            {soundToggles.map(({ key, label, description }) => (
              <ToggleRow
                key={key}
                label={label}
                hint={description}
                value={state.toggles[key]}
                disabled={disabled}
                onChange={(value) => void device.setToggle(key, value)}
              />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
