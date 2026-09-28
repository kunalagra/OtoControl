import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { CLASSIC_EQ_PRESETS, DIRAC_EQ_PRESETS, DiracPreset, DIRAC_PRESET_NAMES, EqPreset, EQ_PRESET_NAMES, ClarityLevel, CUSTOM_EQ_RANGE, eqBandLabel } from '@/drivers/nothing/commands'
import type { NothingDevice, NothingState } from '@/drivers/nothing/device'
import { SegmentButton } from '@/ui/controls/SegmentButton'
import { SettingRow } from '@/ui/controls/SettingRow'
import { useCommittedValue } from '@/ui/controls/useCommittedValue'

interface Props {
  device: NothingDevice
  state: NothingState
}

const PRESETS = CLASSIC_EQ_PRESETS

const DIRAC_PRESETS = DIRAC_EQ_PRESETS

/** `ClarityBoostEntity.Level`. */
const CLARITY_LEVELS: Array<[number, string]> = [
  [ClarityLevel.Low, 'Low'],
  [ClarityLevel.Mid, 'Medium'],
  [ClarityLevel.High, 'High'],
]

export function NothingSound({ device, state }: Props) {
  const disabled = state.status !== 'connected'
  const hasEq = state.capabilities.has('eq')
  const hasDiracEq = state.capabilities.has('diracEq')
  const hasCustomEq = state.capabilities.has('customEq')
  const hasAdvancedEq = state.capabilities.has('advancedEq')
  const hasBass = state.capabilities.has('enhancedBass')
  const hasSpatial = state.capabilities.has('spatialAudio')

  // Advanced EQ overrides the preset row; there is no preset id for it.
  const eqActive = state.eqPreset !== null && state.advancedEq !== true

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
                    <SegmentButton
                      key={preset}
                      pressed={eqActive && state.eqPreset === preset}
                      disabled={disabled}
                      onSelect={() => void device.setEqPreset(preset)}
                      label={EQ_PRESET_NAMES[preset]}
                      size="lg"
                      className="px-2.5 py-2 text-left justify-start"
                    />
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
                    <SegmentButton
                      pressed={state.eqPreset === EqPreset.Custom}
                      disabled={disabled}
                      onSelect={() => void device.setEqPreset(EqPreset.Custom)}
                      label="Custom"
                      size="lg"
                      className="w-full justify-start px-2.5 py-2 text-left"
                    />
                    {state.customEq?.bands.map((band, index) => (
                      <SettingRow key={index} label={eqBandLabel(band)} hint={`${Math.round(band.frequency)} Hz`}>
                        <BandSlider
                          value={band.gain}
                          min={CUSTOM_EQ_RANGE.min}
                          max={CUSTOM_EQ_RANGE.max}
                          disabled={disabled}
                          label={`${eqBandLabel(band)} gain`}
                          onCommit={(gain) => {
                            const eq = state.customEq
                            if (!eq) return
                            // Rebuild the whole structure: the write carries
                            // every band's frequency and Q as well.
                            void device.setCustomEq({
                              ...eq,
                              bands: eq.bands.map((b, i) => (i === index ? { ...b, gain } : b)),
                            })
                          }}
                        />
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
                <BandSlider
                  value={state.bassEnhance.level}
                  min={1}
                  max={5}
                  disabled={disabled}
                  label="Bass enhance strength"
                  onCommit={(level) => void device.setBassEnhance(true, level)}
                />
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
                    <SegmentButton
                      key={preset}
                      pressed={state.diracEq === preset}
                      disabled={disabled}
                      onSelect={() => void device.setDiracPreset(preset)}
                      label={DIRAC_PRESET_NAMES[preset]}
                      size="lg"
                      className="px-2.5 py-2 text-left justify-start"
                    />
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
                    <SegmentButton
                      pressed={state.diracEq === DiracPreset.Custom}
                      disabled={disabled}
                      onSelect={() => void device.setDiracPreset(DiracPreset.Custom)}
                      label="Custom"
                      size="lg"
                      className="w-full justify-start px-2.5 py-2 text-left"
                    />
                    {state.customEq?.bands.map((band, index) => (
                      <SettingRow key={index} label={eqBandLabel(band)} hint={`${Math.round(band.frequency)} Hz`}>
                        <BandSlider
                          value={band.gain}
                          min={CUSTOM_EQ_RANGE.min}
                          max={CUSTOM_EQ_RANGE.max}
                          disabled={disabled}
                          label={`${eqBandLabel(band)} gain`}
                          onCommit={(gain) => {
                            const eq = state.customEq
                            if (!eq) return
                            // Rebuild the whole structure: the write carries
                            // every band's frequency and Q as well.
                            void device.setCustomEq({
                              ...eq,
                              bands: eq.bands.map((b, i) => (i === index ? { ...b, gain } : b)),
                            })
                          }}
                        />
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

      {state.capabilities.has('advancedEqBands') && state.advancedEqBands && (
        <Card data-size="sm">
          <CardHeader>
            <CardTitle>Advanced equalizer</CardTitle>
            <p className="text-muted-foreground text-xs">
              Eight parametric bands. Frequency and Q come from the device;
              only the gains are edited here.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {state.advancedEqBands.bands.map((band, index) => (
              <SettingRow
                key={index}
                label={`${Math.round(band.frequency)} Hz`}
                hint={eqBandLabel(band)}
              >
                <BandSlider
                  value={band.gain}
                  min={CUSTOM_EQ_RANGE.min}
                  max={CUSTOM_EQ_RANGE.max}
                  disabled={disabled}
                  label={`${Math.round(band.frequency)} Hz gain`}
                  onCommit={(gain) => {
                    const eq = state.advancedEqBands
                    if (!eq) return
                    void device.setAdvancedEqBands({
                      ...eq,
                      bands: eq.bands.map((b, i) => (i === index ? { ...b, gain } : b)),
                    })
                  }}
                />
              </SettingRow>
            ))}
          </CardContent>
        </Card>
      )}

      {state.capabilities.has('clarityBoost') && state.clarityBoost && (
        <Card data-size="sm">
          <CardContent className="flex flex-col gap-3">
            <SettingRow
              label="Clarity boost"
              hint="Sharpens detail in the upper midrange."
            >
              <Switch
                checked={state.clarityBoost.enabled}
                disabled={disabled}
                onCheckedChange={(on) => void device.setClarityBoost(on)}
              />
            </SettingRow>
            <div
              className={cn(
                'flex flex-col gap-2 transition-opacity',
                !state.clarityBoost.enabled && 'pointer-events-none opacity-40',
              )}
            >
              <SettingRow label="Amount">
                <div className="flex gap-1.5">
                  {CLARITY_LEVELS.map(([level, name]) => (
                    <SegmentButton
                      key={level}
                      size="sm"
                      pressed={state.clarityBoost?.level === level}
                      disabled={disabled}
                      onSelect={() => void device.setClarityBoost(true, level)}
                      label={name}
                    />
                  ))}
                </div>
              </SettingRow>
            </div>
          </CardContent>
        </Card>
      )}

      {state.capabilities.has('lhdc') && (
        <Card data-size="sm">
          <CardContent>
            <SettingRow
              label="LHDC"
              hint="High-bitrate codec, where the phone supports it."
            >
              <Switch
                checked={state.lhdc === true}
                disabled={disabled || state.lhdc === null}
                onCheckedChange={(on) => void device.setLhdc(on)}
              />
            </SettingRow>
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

/** Base UI hands a single-value slider an array. */
const settle = (value: number | readonly number[]): number =>
  // `Array.isArray` cannot narrow a readonly array out of the union.
  typeof value === 'number' ? value : value[0]

/**
 * One band, and the reason it is a component: the draft has to live above the
 * slider.
 *
 * Every one of these writes carries the *whole* structure — frequencies and Q
 * alongside the gains — so a per-tick write means re-sending the entire curve
 * once per pixel of drag. The draft is local, so the drag is free and the
 * curve is written once, on release, with the committed value rather than the
 * one React has not re-rendered yet.
 */
function BandSlider({
  value,
  min,
  max,
  disabled,
  label,
  onCommit,
}: {
  value: number
  min: number
  max: number
  disabled: boolean
  label: string
  onCommit(value: number): void
}) {
  const [gain, setDraftGain, commitGain] = useCommittedValue(value)

  return (
    <div className="flex w-40 items-center gap-3">
      <Slider
        value={[gain]}
        min={min}
        max={max}
        step={1}
        disabled={disabled}
        aria-label={label}
        onValueChange={(next) => setDraftGain(settle(next))}
        onValueCommitted={(next) => {
          // The committed value, not `gain`: a key press fires change and
          // commit in one event, before React has re-rendered the draft.
          const settled = settle(next)
          commitGain(settled)
          onCommit(settled)
        }}
      />
      <span className="text-muted-foreground w-6 text-right text-xs tabular-nums">
        {gain}
      </span>
    </div>
  )
}
