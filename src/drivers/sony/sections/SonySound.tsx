import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EqPreset, PRIOR_MODE_OPTIONS, SonyFunction, eqPresetName, EQ_RANGE } from '@/drivers/sony/mdr/commands'
import type { SonyDevice, SonyState } from '@/drivers/sony/sony'
import { EqualizerPanel } from '@/ui/panels/EqualizerPanel'
import { TogglesPanel } from '@/ui/panels/TogglesPanel'
import { SegmentButton } from '@/ui/controls/SegmentButton'

interface Props {
  device: SonyDevice
  state: SonyState
}

/**
 * Sony's EQ is a 6-band graphic with a signed range around flat, `EQ_RANGE` —
 * which lives beside the decoder rather than here, because the Home tile draws
 * its bars against the same numbers. Band centres are not reported by the
 * protocol, so bands are numbered below rather than given frequencies we would
 * be inventing.
 */

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
        <EqualizerPanel
          unavailable={
            eq === null
              ? state.status === 'connected'
                ? 'The device did not answer the equaliser query.'
                : 'Connect to load the equaliser.'
              : null
          }
          presets={OFFERED_PRESETS.map((preset) => ({
            id: String(preset),
            name: eqPresetName(preset),
            active: eq?.preset === preset,
          }))}
          bands={
            eq === null
              ? []
              : eq.gains.map((gain, band) => ({
                  value: gain,
                  label: `Band ${band + 1} gain`,
                  caption: `${band + 1}`,
                }))
          }
          range={EQ_RANGE}
          step={1}
          disabled={disabled}
          footer={
            eq === null
              ? ''
              : `${eq.gains.length} bands, ${EQ_RANGE.min} to +${EQ_RANGE.max} steps · preset ${eqPresetName(eq.preset)}`
          }
          onPresetSelect={(id) => void device.setEqPreset(Number(id))}
          onBandCommit={(band, next) => {
            if (eq === null) return
            const gains = [...eq.gains]
            gains[band] = next
            void device.setEqGains(gains)
          }}
        />
      )}

      <TogglesPanel
        disabled={disabled}
        toggles={
          hasUpscaling
            ? [
                {
                  key: 'dsee',
                  label: 'DSEE',
                  hint: 'Upscales compressed audio towards CD quality.',
                  value: state.upscaling,
                  disabled: state.upscaling === null,
                  onChange: (value) => void device.setUpscaling(value),
                },
              ]
            : []
        }
      />

      {hasConnectionMode && (
        <Card data-size="sm">
          <CardHeader>
            <CardTitle>Connection</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2">
              {PRIOR_MODE_OPTIONS.map(({ value, label, hint }) => (
                <SegmentButton
                  key={value}
                  pressed={state.connectionMode === value}
                  disabled={disabled}
                  onSelect={() => void device.setConnectionMode(value)}
                  label={label}
                  hint={hint}
                  size="lg"
                  className="px-2.5 py-2"
                />
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
