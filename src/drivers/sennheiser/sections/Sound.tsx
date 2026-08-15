import { EQ_PRESETS, eqBandLabel } from '@/drivers/sennheiser/gaia/commands'
import { togglesFor } from '@/drivers/sennheiser/state'
import { EqualizerPanel } from '@/ui/panels/EqualizerPanel'
import { TogglesPanel } from '@/ui/panels/TogglesPanel'
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
      <EqualizerPanel
        unavailable={
          config === null
            ? state.status === 'connected'
              ? 'This firmware did not answer the equaliser query.'
              : 'Connect to load the equaliser.'
            : null
        }
        presets={
          config !== null && config.bands === EQ_PRESETS[0].gains.length
            ? EQ_PRESETS.map((preset) => ({
                id: preset.name,
                name: preset.name,
                active: matchesPreset(gains, preset.gains),
              }))
            : []
        }
        bands={
          config === null
            ? []
            : Array.from({ length: config.bands }, (_, band) => ({
                value: gains[band],
                label: `${eqBandLabel(band, config.bands)} gain in decibels`,
                caption: eqBandLabel(band, config.bands),
              }))
        }
        range={{ min: config?.minGain ?? 0, max: config?.maxGain ?? 0 }}
        disabled={disabled}
        footer={
          config === null
            ? ''
            : `${config.minGain} to +${config.maxGain} dB, reported by the headphones`
        }
        onPresetSelect={(name) => {
          const preset = EQ_PRESETS.find((p) => p.name === name)
          if (preset) void device.setEqGains(preset.gains)
        }}
        onBandChange={(band, gain) => void device.setEqBand(band, gain)}
      />

      <TogglesPanel
        disabled={disabled}
        toggles={soundToggles.map(({ key, label, description }) => ({
          key,
          label,
          hint: description,
          value: state.toggles[key],
          onChange: (value) => void device.setToggle(key, value),
        }))}
      />
    </div>
  )
}
