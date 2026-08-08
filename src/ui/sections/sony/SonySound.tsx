import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { EqPreset, PRIOR_MODE_OPTIONS, SonyFunction, eqPresetName } from '@/mdr/commands'
import { cn } from '@/lib/utils'
import type { SonyDevice, SonyState } from '@/device/sony'
import { Fader } from '../../controls/Fader'
import { SettingRow } from '../../controls/SettingRow'

interface Props {
  device: SonyDevice
  state: SonyState
}

/**
 * Sony's EQ is a 6-band graphic with a signed range around flat. Band centres
 * are not reported by the protocol, so bands are numbered rather than given
 * frequencies we would be inventing.
 */
const EQ_RANGE = { min: -10, max: 10 }

/** Presets worth offering; the device accepts more than it uses. */
const OFFERED_PRESETS = [
  EqPreset.Off,
  EqPreset.Bright,
  EqPreset.Excited,
  EqPreset.Mellow,
  EqPreset.Relaxed,
  EqPreset.Vocal,
  EqPreset.TrebleBoost,
  EqPreset.BassBoost,
  EqPreset.Speech,
]

export function SonySound({ device, state }: Props) {
  const disabled = state.status !== 'connected'
  const { eq, capabilities } = state
  const hasEq = capabilities.has(SonyFunction.PresetEq)
  // The toggle is UPSCALING_AUTO_OFF; UPSCALING_INDICATOR is a read-only badge.
  const hasUpscaling =
    capabilities.has(SonyFunction.UpscalingAutoOff) ||
    capabilities.has(SonyFunction.UpscalingIndicator)
  const hasConnectionMode = capabilities.has(SonyFunction.ConnectionQualityMode)

  return (
    <div className="flex flex-col gap-4">
      {hasEq && (
        <Card data-size="sm">
          <CardHeader>
            <CardTitle>Equalizer</CardTitle>
          </CardHeader>
          <CardContent>
            {eq === null ? (
              <p className="text-muted-foreground text-sm">
                {state.status === 'connected'
                  ? 'The device did not answer the equaliser query.'
                  : 'Connect to load the equaliser.'}
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="flex flex-wrap gap-1.5">
                  {OFFERED_PRESETS.map((preset) => {
                    const active = eq.preset === preset
                    return (
                      <Button
                        key={preset}
                        size="sm"
                        variant={active ? 'default' : 'outline'}
                        disabled={disabled}
                        className={cn('rounded-full', !active && 'text-muted-foreground')}
                        onClick={() => void device.setEqPreset(preset)}
                      >
                        {eqPresetName(preset)}
                      </Button>
                    )
                  })}
                </div>

                <div className="flex justify-between gap-2">
                  {eq.gains.map((gain, band) => (
                    <Fader
                      key={band}
                      value={gain}
                      onChange={(next) => {
                        const gains = [...eq.gains]
                        gains[band] = next
                        void device.setEqGains(gains)
                      }}
                      range={EQ_RANGE}
                      step={1}
                      disabled={disabled}
                      label={`Band ${band + 1} gain`}
                      caption={`${band + 1}`}
                    />
                  ))}
                </div>

                <p className="text-muted-foreground text-xs">
                  {eq.gains.length} bands, {EQ_RANGE.min} to +{EQ_RANGE.max} steps · preset{' '}
                  {eqPresetName(eq.preset)}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {hasUpscaling && (
        <Card data-size="sm">
          <CardContent className="flex flex-col">
            <SettingRow label="DSEE" hint="Upscales compressed audio towards CD quality.">
              <Switch
                checked={state.upscaling === true}
                disabled={disabled || state.upscaling === null}
                onCheckedChange={(value) => void device.setUpscaling(value)}
              />
            </SettingRow>
          </CardContent>
        </Card>
      )}

      {hasConnectionMode && (
        <Card data-size="sm">
          <CardHeader>
            <CardTitle>Connection</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2">
              {PRIOR_MODE_OPTIONS.map(({ value, label, hint }) => (
                <button
                  key={value}
                  type="button"
                  disabled={disabled}
                  aria-pressed={state.connectionMode === value}
                  onClick={() => void device.setConnectionMode(value)}
                  className={cn(
                    'flex flex-col gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors',
                    'focus-visible:ring-ring outline-none focus-visible:ring-2',
                    'disabled:cursor-default disabled:opacity-50',
                    state.connectionMode === value
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-muted-foreground/40',
                  )}
                >
                  <span className="text-sm font-medium">{label}</span>
                  <span className="text-muted-foreground text-[11px] leading-tight">
                    {hint}
                  </span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {!hasEq && !hasUpscaling && !hasConnectionMode && (
        <Card data-size="sm">
          <CardContent>
            <p className="text-muted-foreground text-sm">
              This device reports no sound settings.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
