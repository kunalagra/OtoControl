/**
 * The two Home readouts that act: `quickSettings` and `eqPresets`.
 *
 * In `src/` rather than beside a driver for the reason `summary.test.ts` is:
 * these are the descriptors, read the way the shared Home tile reads them, and
 * the fixtures are each driver's real initial state. The device is a set of
 * spies — what is under test is which method a tap calls, with what.
 */
import { describe, expect, it, vi } from 'vitest'

import {
  HEYMELODY_DRIVER,
  NOTHING_DRIVER,
  SENNHEISER_DRIVER,
  SONY_DRIVER,
  SOUNDCORE_DRIVER,
} from '@/core/driver'
import type { QuickSetting } from '@/core/driver'
import { EQ_PRESETS as SENNHEISER_PRESETS, POWER_OFF_PRESETS } from '@/drivers/sennheiser/gaia/commands'
import { initialState } from '@/drivers/sennheiser/state'
import { EqPreset as SonyEqPreset, SonyFunction } from '@/drivers/sony/mdr/commands'
import { initialSonyState } from '@/drivers/sony/sony'
import { EqPreset as NothingEqPreset } from '@/drivers/nothing/commands'
import { initialNothingState } from '@/drivers/nothing/device'
import { EQ_PRESETS as SOUNDCORE_PRESETS } from '@/drivers/soundcore/commands'
import { initialSoundcoreState } from '@/drivers/soundcore/device'
import { initialHeyMelodyState } from '@/drivers/heymelody/state'

/** A device whose every method is a spy, whatever its name. */
const spyDevice = () => {
  const calls = new Map<string, ReturnType<typeof vi.fn>>()
  const device = new Proxy(
    {},
    {
      get: (_target, name: string) => {
        if (!calls.has(name)) calls.set(name, vi.fn(async () => undefined))
        return calls.get(name)
      },
    },
  )
  return { device: device as never, call: (name: string) => calls.get(name) }
}

const labels = (settings: QuickSetting[]) => settings.map((setting) => setting.label)

describe('Sennheiser', () => {
  it('leads with smart pause and auto power-off, then the rest of its behaviour toggles', () => {
    const { device } = spyDevice()
    const settings = SENNHEISER_DRIVER.quickSettings!(device, initialState)
    expect(labels(settings).slice(0, 4)).toEqual([
      'Smart pause',
      'Auto power-off',
      'Low-latency mode',
      'Touch controls',
    ])
  })

  it('writes a toggle and a power-off choice through the System tab’s own methods', () => {
    const { device, call } = spyDevice()
    const state = {
      ...initialState,
      toggles: { ...initialState.toggles, smartPause: false },
      powerOffSeconds: POWER_OFF_PRESETS[1].seconds,
    }
    const settings = SENNHEISER_DRIVER.quickSettings!(device, state)
    const pause = settings.find((setting) => setting.id === 'smartPause')!
    expect(pause).toMatchObject({ kind: 'toggle', value: false })
    if (pause.kind === 'toggle') pause.set(true)
    expect(call('setToggle')).toHaveBeenCalledWith('smartPause', true)

    const power = settings.find((setting) => setting.id === 'autoPowerOff')!
    expect(power).toMatchObject({ kind: 'choice', value: String(POWER_OFF_PRESETS[1].seconds) })
    if (power.kind === 'choice') power.set(String(POWER_OFF_PRESETS[2].seconds))
    expect(call('setPowerOff')).toHaveBeenCalledWith(POWER_OFF_PRESETS[2].seconds)
  })

  it('offers its presets once the device has reported a five-band curve, and applies one as a curve', () => {
    const { device, call } = spyDevice()
    expect(SENNHEISER_DRIVER.eqPresets!(device, initialState)).toBeNull()

    const rock = SENNHEISER_PRESETS.find((preset) => preset.name === 'Rock')!
    const state = {
      ...initialState,
      eq: { config: { bands: 5, minGain: -6, maxGain: 6 }, gains: [...rock.gains] },
    }
    const presets = SENNHEISER_DRIVER.eqPresets!(device, state)!
    expect(presets.presets.map((preset) => preset.name)).toEqual(SENNHEISER_PRESETS.map((preset) => preset.name))
    expect(presets.presets.filter((preset) => preset.active).map((preset) => preset.name)).toEqual(['Rock'])

    presets.select('Flat')
    expect(call('setEqGains')).toHaveBeenCalledWith(SENNHEISER_PRESETS[0].gains)
  })
})

describe('Sony', () => {
  it('offers only the settings the device reported a capability for', () => {
    const { device } = spyDevice()
    expect(SONY_DRIVER.quickSettings!(device, initialSonyState)).toEqual([])

    const state = {
      ...initialSonyState,
      capabilities: new Set([SonyFunction.PauseOnRemoval]),
      pauseOnRemoval: true,
      voiceGuidance: { enabled: false, volume: null },
    }
    expect(labels(SONY_DRIVER.quickSettings!(device, state))).toEqual(['Pause when removed', 'Voice prompts'])
  })

  it('writes pause-on-removal through the same method as the System tab', () => {
    const { device, call } = spyDevice()
    const state = { ...initialSonyState, capabilities: new Set([SonyFunction.PauseOnRemoval]), pauseOnRemoval: false }
    const pause = SONY_DRIVER.quickSettings!(device, state)[0]
    if (pause.kind === 'toggle') pause.set(true)
    expect(call('setPauseOnRemoval')).toHaveBeenCalledWith(true)
  })

  it('offers its presets only with the preset-EQ capability and a reading', () => {
    const { device, call } = spyDevice()
    expect(SONY_DRIVER.eqPresets!(device, initialSonyState)).toBeNull()

    const state = {
      ...initialSonyState,
      capabilities: new Set([SonyFunction.PresetEq]),
      eq: { inquiryType: 0, preset: SonyEqPreset.Bright, gains: [0, 0, 0, 0, 0, 0] },
    }
    const presets = SONY_DRIVER.eqPresets!(device, state)!
    expect(presets.presets.find((preset) => preset.active)?.id).toBe(String(SonyEqPreset.Bright))
    presets.select(String(SonyEqPreset.Off))
    expect(call('setEqPreset')).toHaveBeenCalledWith(SonyEqPreset.Off)
  })
})

describe('Nothing', () => {
  it('always offers low latency, and in-ear detection only with its capability', () => {
    const { device } = spyDevice()
    expect(labels(NOTHING_DRIVER.quickSettings!(device, initialNothingState))).toEqual(['Low latency'])

    const state = { ...initialNothingState, capabilities: new Set(['inEarDetection' as const]), inEarDetection: true }
    expect(labels(NOTHING_DRIVER.quickSettings!(device, state))).toEqual(['In-ear detection', 'Low latency'])
  })

  it('offers the classic presets, plus Custom when the model has a custom curve', () => {
    const { device, call } = spyDevice()
    expect(NOTHING_DRIVER.eqPresets!(device, initialNothingState)).toBeNull()

    const state = {
      ...initialNothingState,
      capabilities: new Set(['eq' as const, 'customEq' as const]),
      eqPreset: NothingEqPreset.Bass,
    }
    const presets = NOTHING_DRIVER.eqPresets!(device, state)!
    expect(presets.presets.at(-1)?.name).toBe('Custom')
    expect(presets.presets.find((preset) => preset.active)?.id).toBe(String(NothingEqPreset.Bass))
    presets.select(String(NothingEqPreset.Voice))
    expect(call('setEqPreset')).toHaveBeenCalledWith(NothingEqPreset.Voice)
  })
})

describe('Soundcore', () => {
  it('offers wear detection first', () => {
    const { device } = spyDevice()
    expect(labels(SOUNDCORE_DRIVER.quickSettings!(device, initialSoundcoreState))[0]).toBe('Wear detection')
  })

  it('offers the regular presets once the curve is read, not the artist ones', () => {
    const { device, call } = spyDevice()
    expect(SOUNDCORE_DRIVER.eqPresets!(device, initialSoundcoreState)).toBeNull()

    const regular = SOUNDCORE_PRESETS.filter((preset) => !preset.artist)
    const state = {
      ...initialSoundcoreState,
      eq: { profile: regular[1].id, left: [...regular[1].curve], right: [...regular[1].curve] },
    }
    const presets = SOUNDCORE_DRIVER.eqPresets!(device, state)!
    expect(presets.presets).toHaveLength(regular.length)
    expect(presets.presets.find((preset) => preset.active)?.id).toBe(String(regular[1].id))
    presets.select(String(regular[0].id))
    expect(call('setEqPreset')).toHaveBeenCalledWith(regular[0].id)
  })
})

describe('HeyMelody', () => {
  it('has no quick settings to offer: its System tab has none', () => {
    expect(HEYMELODY_DRIVER).not.toHaveProperty('quickSettings')
  })

  it('offers the presets the device itself listed', () => {
    const { device, call } = spyDevice()
    expect(HEYMELODY_DRIVER.eqPresets!(device, initialHeyMelodyState)).toBeNull()

    const preset = (eqId: number, name: string) => ({
      eqId,
      name,
      isSelected: false,
      minValue: -6,
      maxValue: 6,
      bands: [],
    })
    const state = { ...initialHeyMelodyState, eqPresets: [preset(1, 'Balanced'), preset(2, 'Bass')], eqCurrentPreset: 2 }
    const presets = HEYMELODY_DRIVER.eqPresets!(device, state)!
    expect(presets.presets).toEqual([
      { id: '1', name: 'Balanced', active: false },
      { id: '2', name: 'Bass', active: true },
    ])
    presets.select('1')
    expect(call('setEqPreset')).toHaveBeenCalledWith(1)
  })
})
