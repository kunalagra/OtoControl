import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { DiracPreset, DIRAC_PRESET_NAMES, EqPreset, EQ_PRESET_NAMES } from '@/drivers/nothing/commands'
import type { NothingDevice, NothingState } from '@/drivers/nothing/device'
import { SettingRow } from '@/ui/controls/SettingRow'

interface Props {
  device: NothingDevice
  state: NothingState
}

const PRESETS = [EqPreset.Balanced, EqPreset.Voice, EqPreset.Treble, EqPreset.Bass]

/** ear-web's order for the Dirac Opteo row, custom last. */
const DIRAC_PRESETS = [
  DiracPreset.Opteo,
  DiracPreset.Pop,
  DiracPreset.Rock,
  DiracPreset.Classical,
  DiracPreset.Electronic,
  DiracPreset.EnhanceVocals,
]

/** ear-web's custom slider range, 0–10 per band. */
const CUSTOM_RANGE = { min: 0, max: 10 }
const CUSTOM_BAND_NAMES = ['Bass', 'Mid', 'Treble']

export function NothingSound({ device, state }: Props) {
  const disabled = state.status !== 'connected'
  const hasEq = state.capabilities.has('eq')
  const hasDiracEq = state.capabilities.has('diracEq')
  const hasCustomEq = state.capabilities.has('customEq')
  const hasAdvancedEq = state.capabilities.has('advancedEq')
  const hasBass = state.capabilities.has('enhancedBass')
  const hasSpatial = state.capabilities.has('spatialAudio')

  const eqActive = state.eqPreset !== null && state.eqPreset !== EqPreset.Advanced

  return (
    <div className="flex flex-col gap-4">
      {hasEq && (
        <Card data-size="sm">
          <CardHeader>
            <CardTitle>Equalizer</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {state.eqPreset === null ? (
              <p className="text-muted-foreground text-sm">
                {state.status === 'connected'
                  ? 'The device did not answer the equalizer query.'
                  : 'Connect to load the equalizer.'}
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      disabled={disabled}
                      aria-pressed={eqActive && state.eqPreset === preset}
                      onClick={() => void device.setEqPreset(preset)}
                      className={cn(
                        'rounded-lg border px-2.5 py-2 text-left text-sm font-medium transition-colors',
                        'focus-visible:ring-ring outline-none focus-visible:ring-2',
                        'disabled:cursor-default disabled:opacity-50',
                        eqActive && state.eqPreset === preset
                          ? 'border-primary bg-primary/10'
                          : 'border-border hover:border-muted-foreground/40',
                      )}
                    >
                      {EQ_PRESET_NAMES[preset]}
                    </button>
                  ))}
                </div>

                {hasCustomEq && (
                  <div
                    className={cn(
                      'flex flex-col gap-3 rounded-lg border border-border p-3',
                      'transition-opacity',
                      state.eqPreset !== EqPreset.Custom && 'pointer-events-none opacity-40',
                    )}
                  >
                    <button
                      type="button"
                      disabled={disabled}
                      aria-pressed={state.eqPreset === EqPreset.Custom}
                      onClick={() => void device.setEqPreset(EqPreset.Custom)}
                      className={cn(
                        'rounded-lg border px-2.5 py-2 text-left text-sm font-medium transition-colors',
                        state.eqPreset === EqPreset.Custom
                          ? 'border-primary bg-primary/10'
                          : 'border-border hover:border-muted-foreground/40',
                      )}
                    >
                      Custom
                    </button>
                    {state.customEq?.map((value, band) => (
                      <SettingRow key={band} label={CUSTOM_BAND_NAMES[band]}>
                        <div className="flex w-40 items-center gap-3">
                          <Slider
                            value={[value]}
                            min={CUSTOM_RANGE.min}
                            max={CUSTOM_RANGE.max}
                            step={1}
                            disabled={disabled}
                            aria-label={`${CUSTOM_BAND_NAMES[band]} level`}
                            onValueChange={(next) => {
                              if (!state.customEq) return
                              const bands = [...state.customEq] as [number, number, number]
                              bands[band] = Array.isArray(next) ? next[0] : next
                              void device.setCustomEq(bands)
                            }}
                          />
                          <span className="text-muted-foreground w-6 text-right text-xs tabular-nums">
                            {value}
                          </span>
                        </div>
                      </SettingRow>
                    ))}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {hasAdvancedEq && (
        <Card data-size="sm">
          <CardContent>
            <SettingRow
              label="Advanced EQ"
              hint="The onboard multi-band profile. Overrides the presets while on."
            >
              <Switch
                checked={state.advancedEq === true}
                disabled={disabled || state.advancedEq === null}
                onCheckedChange={(on) => void device.setAdvancedEq(on)}
              />
            </SettingRow>
          </CardContent>
        </Card>
      )}

      {hasBass && state.bassEnhance && (
        <Card data-size="sm">
          <CardHeader>
            <CardTitle>Bass enhance</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <SettingRow label="Enabled" hint="Boosts the low end.">
              <Switch
                checked={state.bassEnhance.enabled}
                disabled={disabled}
                onCheckedChange={(on) =>
                  void device.setBassEnhance(on, state.bassEnhance!.level)
                }
              />
            </SettingRow>
            <div
              className={cn(
                'flex flex-col gap-3 transition-opacity',
                !state.bassEnhance.enabled && 'pointer-events-none opacity-40',
              )}
            >
              <SettingRow label="Strength">
                <div className="flex w-40 items-center gap-3">
                  <Slider
                    value={[state.bassEnhance.level]}
                    min={1}
                    max={5}
                    step={1}
                    disabled={disabled}
                    aria-label="Bass enhance strength"
                    onValueChange={(next) =>
                      void device.setBassEnhance(
                        true,
                        Array.isArray(next) ? next[0] : next,
                      )
                    }
                  />
                  <span className="text-muted-foreground w-6 text-right text-xs tabular-nums">
                    {state.bassEnhance.level}
                  </span>
                </div>
              </SettingRow>
            </div>
          </CardContent>
        </Card>
      )}

      {hasDiracEq && (
        <Card data-size="sm">
          <CardHeader>
            <CardTitle>Dirac Opteo</CardTitle>
            <p className="text-muted-foreground text-xs">
              The tuned EQ this model ships with, in place of classic presets.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {state.diracEq === null ? (
              <p className="text-muted-foreground text-sm">
                {state.status === 'connected'
                  ? 'The device did not answer the Dirac Opteo query.'
                  : 'Connect to load the equalizer.'}
              </p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {DIRAC_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      disabled={disabled}
                      aria-pressed={state.diracEq === preset}
                      onClick={() => void device.setDiracPreset(preset)}
                      className={cn(
                        'rounded-lg border px-2.5 py-2 text-left text-sm font-medium transition-colors',
                        'focus-visible:ring-ring outline-none focus-visible:ring-2',
                        'disabled:cursor-default disabled:opacity-50',
                        state.diracEq === preset
                          ? 'border-primary bg-primary/10'
                          : 'border-border hover:border-muted-foreground/40',
                      )}
                    >
                      {DIRAC_PRESET_NAMES[preset]}
                    </button>
                  ))}
                </div>

                {hasCustomEq && (
                  <div
                    className={cn(
                      'flex flex-col gap-3 rounded-lg border border-border p-3',
                      'transition-opacity',
                      state.diracEq !== DiracPreset.Custom && 'pointer-events-none opacity-40',
                    )}
                  >
                    <button
                      type="button"
                      disabled={disabled}
                      aria-pressed={state.diracEq === DiracPreset.Custom}
                      onClick={() => void device.setDiracPreset(DiracPreset.Custom)}
                      className={cn(
                        'rounded-lg border px-2.5 py-2 text-left text-sm font-medium transition-colors',
                        state.diracEq === DiracPreset.Custom
                          ? 'border-primary bg-primary/10'
                          : 'border-border hover:border-muted-foreground/40',
                      )}
                    >
                      Custom
                    </button>
                    {state.customEq?.map((value, band) => (
                      <SettingRow key={band} label={CUSTOM_BAND_NAMES[band]}>
                        <div className="flex w-40 items-center gap-3">
                          <Slider
                            value={[value]}
                            min={CUSTOM_RANGE.min}
                            max={CUSTOM_RANGE.max}
                            step={1}
                            disabled={disabled}
                            aria-label={`${CUSTOM_BAND_NAMES[band]} level`}
                            onValueChange={(next) => {
                              if (!state.customEq) return
                              const bands = [...state.customEq] as [number, number, number]
                              bands[band] = Array.isArray(next) ? next[0] : next
                              void device.setCustomEq(bands)
                            }}
                          />
                          <span className="text-muted-foreground w-6 text-right text-xs tabular-nums">
                            {value}
                          </span>
                        </div>
                      </SettingRow>
                    ))}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {hasSpatial && state.spatialAudio !== null && (
        <Card data-size="sm">
          <CardHeader>
            <CardTitle>Spatial audio</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <SettingRow
              label="Spatial audio"
              hint="Places the sound in a fixed space around you."
            >
              <Switch
                checked={state.spatialAudio.enabled}
                disabled={disabled}
                onCheckedChange={(on) => void device.setSpatialAudio(on)}
              />
            </SettingRow>

            {/* Only the models whose reply carried a second byte have head
                tracking; on the rest there is no such setting to show. */}
            {state.spatialAudio.headTracking !== null && (
              <SettingRow
                label="Head tracking"
                hint="Anchors the sound to the source as you turn your head."
              >
                <Switch
                  checked={state.spatialAudio.headTracking}
                  disabled={disabled || !state.spatialAudio.enabled}
                  onCheckedChange={(on) =>
                    void device.setSpatialAudio(state.spatialAudio!.enabled, on)
                  }
                />
              </SettingRow>
            )}
          </CardContent>
        </Card>
      )}

      <Card data-size="sm">
        <CardContent>
          <SettingRow
            label="Low latency"
            hint="Prioritises sync over sound quality — for video and games."
          >
            <Switch
              checked={state.lowLatency === true}
              disabled={disabled || state.lowLatency === null}
              onCheckedChange={(on) => void device.setLowLatency(on)}
            />
          </SettingRow>
        </CardContent>
      </Card>

      {!hasEq && !hasDiracEq && !hasAdvancedEq && !hasBass && !hasSpatial && (
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
