import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { SamsungDevice } from './device'
import { SamsungNoise } from './sections/Noise'
import { SamsungSound } from './sections/Sound'
import { SamsungSystem } from './sections/System'
import { initialSamsungState } from './state'
import type { SamsungState } from './state'
import type { SamsungModelId } from './models'

/** Markup only: a real device that is never connected is enough for the sections to read from. */
const device = new SamsungDevice()

const known = (modelId: SamsungModelId, extra: Partial<SamsungState> = {}): SamsungState => ({
  ...initialSamsungState,
  status: 'connected',
  info: { ...initialSamsungState.info, modelId, model: 'Galaxy Buds2 Pro' },
  ...extra,
})

const render = (node: React.ReactElement): string => renderToStaticMarkup(node)

describe('SamsungNoise', () => {
  it('offers off, ANC and ambient on a model with modes, marking the active one', () => {
    const html = render(<SamsungNoise device={device} state={known('buds2Pro', { noiseMode: 1 })} />)
    expect(html).toContain('Off')
    expect(html).toContain('Noise cancelling')
    expect(html).toContain('Ambient sound')
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
  })

  it('offers only off and ANC on Buds Live, and only off and ambient on Buds+', () => {
    const live = render(<SamsungNoise device={device} state={known('budsLive')} />)
    expect(live).toContain('Noise cancelling')
    expect(live).not.toContain('Ambient sound')
    const plus = render(<SamsungNoise device={device} state={known('budsPlus')} />)
    expect(plus).toContain('Ambient sound')
    expect(plus).not.toContain('Noise cancelling')
  })

  it('says why a model it cannot read has no controls', () => {
    expect(render(<SamsungNoise device={device} state={known('unknown')} />)).toContain('not in the table yet')
  })

  it('waits for the model rather than claiming there is no noise control', () => {
    const html = render(<SamsungNoise device={device} state={{ ...initialSamsungState, status: 'connected' }} />)
    expect(html).toContain('Waiting for the earbuds')
  })

  it('notes an Adaptive mode the earbuds report but the app cannot set', () => {
    expect(render(<SamsungNoise device={device} state={known('buds2Pro', { noiseMode: 3 })} />)).toContain('Adaptive')
  })

  it('disables the buttons while disconnected', () => {
    const html = render(<SamsungNoise device={device} state={known('buds2Pro', { status: 'disconnected' })} />)
    expect(html).toContain('disabled')
  })
})

describe('SamsungSound', () => {
  it('lists Normal and the five presets, marking the one in use', () => {
    const html = render(<SamsungSound device={device} state={known('buds2Pro', { eq: 2 })} />)
    for (const name of ['Normal', 'Bass boost', 'Soft', 'Dynamic', 'Clear', 'Treble boost']) expect(html).toContain(name)
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
  })

  it('notes a custom curve it cannot edit', () => {
    expect(render(<SamsungSound device={device} state={known('buds2Pro', { eq: 6 })} />)).toContain('custom curve')
  })

  it('declines for a model it cannot read', () => {
    expect(render(<SamsungSound device={device} state={known('unknown')} />)).toContain('not offered')
  })
})

describe('SamsungSystem', () => {
  const state = known('buds2Pro', {
    info: { ...initialSamsungState.info, modelId: 'buds2Pro', model: 'Galaxy Buds2 Pro', sku: 'SM-R510NZKAEUA', revision: 11, firmware: 'R510XXE0ARF4', hardware: 'rev1.2' },
    battery: { left: 80, right: 75, case: 60 },
    charging: { left: true, right: false, case: false },
    placement: { left: 'wearing', right: 'idle' },
    touchLocked: false,
  })

  it('shows what the earbuds reported about themselves', () => {
    const html = render(<SamsungSystem device={device} state={state} />)
    for (const text of ['Galaxy Buds2 Pro', 'SM-R510NZKAEUA', 'R510XXE0ARF4', 'rev1.2', 'Status revision']) expect(html).toContain(text)
  })

  it('shows each battery cell with its placement and charging', () => {
    const html = render(<SamsungSystem device={device} state={state} />)
    expect(html).toContain('In ear')
    expect(html).toContain('Out of ear')
    expect(html).toContain('Charging')
  })

  it('offers the touch lock, find my earbuds and the protocol log', () => {
    const html = render(<SamsungSystem device={device} state={state} />)
    expect(html).toContain('Lock touch controls')
    expect(html).toContain('Ring earbuds')
    expect(html).toContain('Protocol log')
    expect(html).toContain('Copy log')
  })

  it('offers no lock for a model it cannot read, and still shows the log a tester needs', () => {
    const html = render(<SamsungSystem device={device} state={known('unknown')} />)
    expect(html).not.toContain('Lock touch controls')
    expect(html).toContain('Protocol log')
  })

  it('shows why an identity read failed', () => {
    const html = render(
      <SamsungSystem device={device} state={known('unknown', { diagnostics: { sku: 'unrecognised SKU SM-R999', version: 'no reply' } })} />,
    )
    expect(html).toContain('unrecognised SKU SM-R999')
    expect(html).toContain('no reply')
  })

  it('renders before anything has been read', () => {
    expect(() => render(<SamsungSystem device={device} state={initialSamsungState} />)).not.toThrow()
  })
})
