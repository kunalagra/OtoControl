import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentType, ReactElement } from 'react'
import { describe, expect, it } from 'vitest'

import { initialState } from '@/drivers/sennheiser/state'
import type { DeviceState } from '@/drivers/sennheiser/state'
import { initialSonyState } from '@/drivers/sony/sony'
import type { SonyState } from '@/drivers/sony/sony'
import { SonyFunction } from '@/drivers/sony/mdr/commands'
import { SENNHEISER_DRIVER, SONY_DRIVER } from '@/core/driver'
import type { ActiveDevice } from '@/core/manager'
import { componentFor } from '@/ui/sections/registry'

/**
 * Render-snapshot safety net for the four assembled sections that the file
 * moves are about to churn through.
 *
 * `tsc -b` only catches a broken import, not a wrong one — a move that points
 * `SonySound` at Sennheiser's `Sound` still compiles and still passes every
 * behavioural test, because nothing else in the suite renders an assembled
 * section. These snapshots exist to fail loudly on exactly that mistake.
 *
 * Only markup is asserted, never behaviour, so a Proxy that hands back a
 * no-op function for anything the section calls is enough to stand in for a
 * real device — cast through `never`, which is assignable to any prop type.
 *
 * It lives at `src/` rather than in `ui/sections/` or inside either driver
 * because it renders four sections across two drivers: `ui/` may not name a
 * driver, and splitting it per driver would destroy the one thing it exists
 * to catch — a move that points `SonySound` at Sennheiser's section. `src/`
 * is the composition root, the one tier with no purity constraint on naming
 * drivers. It is not the only place that knows both — `core/driver.ts`
 * imports both descriptors by design — but those are allow-listed, and `ui/`
 * is not.
 */
const device = new Proxy({}, { get: () => () => undefined }) as never

/**
 * `useId` counters vary with render order rather than content, so they would
 * make these snapshots order-dependent rather than content-dependent. React's
 * default format is `«r0»`; the Base UI primitives underlying `Slider`/
 * `Switch` mint their own in the form `_R_19_` (and `base-ui-_R_19_-suffix`
 * variants) instead. Both get normalised away.
 */
const stripReactIds = (markup: string): string =>
  markup.replace(/«r[0-9a-z]*»/g, '«id»').replace(/_R_[0-9a-zA-Z]*_/g, '_R_id_')

const renderSnapshot = (element: ReactElement) => {
  expect(stripReactIds(renderToStaticMarkup(element))).toMatchSnapshot()
}

const noNavigate = () => undefined

interface SectionArgs {
  device: never
  state: unknown
  onNavigate?: (sectionId: string) => void
}

/**
 * Resolve the section the way the app does — through `componentFor`, which
 * reads the driver's own `components` map — rather than by importing the
 * component's module directly.
 *
 * This matters more than it looks. Importing `SonySound` by path asserts
 * "the module at `drivers/sony/sections/SonySound.tsx` renders this markup".
 * The fact this phase actually needed protected is "the **`sound` section of
 * the Sony driver** renders `SonySound`" — and that binding lives in the
 * `COMPONENTS` map each descriptor owns, which the moves relocated out of
 * `ui/sections/registry.ts`.
 *
 * Going by path walks straight past the map. A whole-branch mutation review
 * proved the gap: swapping a driver's `sound` and `system` entries left all
 * 549 tests green *and* `tsc -b` clean, because both imports stayed used and
 * no test ever called `componentFor`. Routing through it closes that, at no
 * cost to the snapshots — same component, same props, same markup.
 */
type Descriptor = typeof SENNHEISER_DRIVER | typeof SONY_DRIVER

/**
 * `componentFor` returns whatever the driver's own map holds, so the two
 * brands' sections come back as a union of prop types. Every one of them
 * takes the same three, so the union is collapsed here rather than at each of
 * the twelve call sites.
 *
 * Through `unknown` because the erased props are a *superset* of what these
 * sections declare: `componentFor` also hands a shell-owned section the whole
 * `ActiveDevice` (see `ResolvedSectionProps`), which no driver's component
 * takes. Only driver sections are rendered here, so that prop is never passed.
 */
const section = (driver: Descriptor, id: string, state: unknown): ComponentType<SectionArgs> => {
  const active = { id: driver.id, driver, device, state } as ActiveDevice
  const Component = componentFor(active, id)
  if (!Component) throw new Error(`no component for ${driver.id} section "${id}"`)
  return Component as unknown as ComponentType<SectionArgs>
}

/**
 * The section as an *element*, not as its return value.
 *
 * Rendering it as `Component(props)` — which is how the panel tests render a
 * component with no hooks — only works while a section uses none. Drafting a
 * slider means a section now calls `useState`, and a hook outside a render
 * throws. Handing `renderToStaticMarkup` the element renders it properly
 * either way.
 */
const sennheiser = (id: string, state: DeviceState): ReactElement => {
  const Component = section(SENNHEISER_DRIVER, id, state)
  return <Component device={device} state={state} onNavigate={noNavigate} />
}

const sony = (id: string, state: SonyState): ReactElement => {
  const Component = section(SONY_DRIVER, id, state)
  return <Component device={device} state={state} onNavigate={noNavigate} />
}

describe('Sound', () => {
  it('renders disconnected (initial state)', () => {
    renderSnapshot(sennheiser('sound', initialState))
  })

  it('renders connected with EQ and toggles populated', () => {
    const state: DeviceState = {
      ...initialState,
      status: 'connected',
      info: { ...initialState.info, model: 'MOMENTUM 4' },
      eq: {
        config: { bands: 5, minGain: -6, maxGain: 6 },
        gains: [0, 2, 2.5, 1.5, -2],
      },
      toggles: { ...initialState.toggles, bassBoost: true },
    }
    renderSnapshot(sennheiser('sound', state))
  })

  it('renders connected with no EQ config reported (unavailable branch)', () => {
    const state: DeviceState = {
      ...initialState,
      status: 'connected',
      info: { ...initialState.info, model: 'MOMENTUM 4' },
      eq: { config: null, gains: [] },
    }
    renderSnapshot(sennheiser('sound', state))
  })
})

describe('System', () => {
  it('renders disconnected (initial state)', () => {
    renderSnapshot(sennheiser('system', initialState))
  })

  it('renders connected with populated info and capabilities', () => {
    const state: DeviceState = {
      ...initialState,
      status: 'connected',
      info: { model: 'MOMENTUM 4', firmware: '1.2.3', serial: 'ABC123', codec: 1 },
      wearState: 1,
      sidetone: 5,
      powerOffSeconds: 300,
      supportedFeatures: new Map([[0x01, 1]]),
      apiVersion: [4, 2],
      toggles: { ...initialState.toggles, smartPause: true },
    }
    renderSnapshot(sennheiser('system', state))
  })

  it('renders connected with no reported capability table', () => {
    const state: DeviceState = {
      ...initialState,
      status: 'connected',
      info: { model: 'MOMENTUM 4', firmware: null, serial: null, codec: null },
      supportedFeatures: null,
    }
    renderSnapshot(sennheiser('system', state))
  })
})

describe('SonySound', () => {
  it('renders disconnected (initial state)', () => {
    renderSnapshot(sony('sound', initialSonyState))
  })

  it('renders connected with EQ, upscaling and connection mode', () => {
    const state: SonyState = {
      ...initialSonyState,
      status: 'connected',
      info: { ...initialSonyState.info, model: 'WH-1000XM5' },
      eq: { inquiryType: 0, preset: 0, gains: [0, 1, -1, 2, -2, 0] },
      upscaling: true,
      connectionMode: 0,
      capabilities: new Set([
        SonyFunction.PresetEq,
        SonyFunction.UpscalingAutoOff,
        SonyFunction.ConnectionQualityMode,
      ]),
    }
    renderSnapshot(sony('sound', state))
  })

  it('renders connected with no sound capabilities reported (empty-state branch)', () => {
    const state: SonyState = {
      ...initialSonyState,
      status: 'connected',
      info: { ...initialSonyState.info, model: 'WH-1000XM5' },
      capabilities: new Set(),
    }
    renderSnapshot(sony('sound', state))
  })
})

describe('SonySystem', () => {
  it('renders disconnected (initial state)', () => {
    renderSnapshot(sony('system', initialSonyState))
  })

  it('renders connected with battery, auto power off and power off support', () => {
    const state: SonyState = {
      ...initialSonyState,
      status: 'connected',
      info: { model: 'WH-1000XM5', firmware: '2.1.0', colour: { series: 1, colour: 0 } },
      battery: {
        left: { level: 80, status: 0, charging: false, onPower: false, present: true },
        right: { level: 75, status: 1, charging: true, onPower: true, present: true },
      },
      codec: 1,
      autoPowerOff: 1800,
      pauseOnRemoval: true,
      capabilities: new Set([
        SonyFunction.AutoPowerOff,
        SonyFunction.PauseOnRemoval,
        SonyFunction.PowerOff,
      ]),
    }
    renderSnapshot(sony('system', state))
  })

  it('renders connected with no capability table reported (nothing to show)', () => {
    const state: SonyState = {
      ...initialSonyState,
      status: 'connected',
      info: { model: 'WH-1000XM5', firmware: null, colour: null },
      capabilities: new Set(),
    }
    renderSnapshot(sony('system', state))
  })
})
