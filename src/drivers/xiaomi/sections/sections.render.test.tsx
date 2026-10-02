import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentType } from 'react';
import { describe, expect, it } from 'vitest';

import { initialXiaomiState } from '../state';
import type { XiaomiCapability, XiaomiState } from '../state';
import { XiaomiNoise } from './XiaomiNoise';
import { XiaomiSound } from './XiaomiSound';
import { XiaomiSystem } from './XiaomiSystem';

/** Markup only: a Proxy stands in for the device, handing back a no-op for any call. */
const device = new Proxy(
  {},
  { get: (_target, key) => (key === 'protocolLog' ? [] : key === 'onProtocolLog' ? () => () => undefined : () => undefined) },
) as never;

function render(Component: ComponentType<{ device: never; state: XiaomiState }>, patch: Partial<XiaomiState>): string {
  return renderToStaticMarkup(<Component device={device} state={{ ...initialXiaomiState, status: 'connected', ...patch }} />);
}

describe('Xiaomi Noise section', () => {
  it('offers the three modes and marks the active one', () => {
    const html = render(XiaomiNoise, { ancMode: 1, capabilities: new Set(['anc']) });
    expect(html).toContain('Noise cancelling');
    expect(html).toContain('Transparency');
    expect(html).toContain('Off');
    expect(html).toContain('aria-pressed="true"');
  });

  it('shows the noise-cancelling strengths only in that mode, and only when probed', () => {
    const state = { ancMode: 1 as const, capabilities: new Set<XiaomiCapability>(['anc', 'strength']) };
    const html = render(XiaomiNoise, state);
    expect(html).toContain('Balanced');
    expect(html).toContain('Deep');
    expect(html).not.toContain('Ambient');
    expect(render(XiaomiNoise, { ...state, capabilities: new Set(['anc']) })).not.toContain('Balanced');
    expect(render(XiaomiNoise, { ...state, ancMode: 0 })).not.toContain('Balanced');
  });

  it('shows the transparency strengths in transparency mode, narrowed for a Redmi Buds 3 Pro', () => {
    const html = render(XiaomiNoise, {
      ancMode: 2,
      capabilities: new Set(['anc', 'strength']),
      info: { ...initialXiaomiState.info, btName: 'Redmi Buds 3 Pro' },
    });
    expect(html).toContain('Regular');
    expect(html).toContain('Voice');
    expect(html).not.toContain('Ambient');
  });

  it('says so when a probed model has no noise control', () => {
    expect(render(XiaomiNoise, { capabilities: new Set(['battery']) })).toContain('no noise control');
  });

  it('says so while the mode is unread', () => {
    expect(render(XiaomiNoise, {})).toContain('did not report');
    expect(render(XiaomiNoise, { status: 'disconnected' })).toContain('Connect to load');
  });
});

describe('Xiaomi Sound section', () => {
  it('offers the common presets and marks the playing one', () => {
    const html = render(XiaomiSound, { eqPreset: 5, capabilities: new Set(['eq']) });
    for (const name of ['Standard', 'Treble', 'Bass', 'Voice']) expect(html).toContain(name);
  });

  it('says so when a probed model has no equalizer', () => {
    expect(render(XiaomiSound, { capabilities: new Set(['anc']) })).toContain('no equalizer');
  });
});

describe('Xiaomi System section', () => {
  it('shows identity, firmware and how the handshake went', () => {
    const html = render(XiaomiSystem, {
      info: { model: 'Redmi Buds 4', btName: 'Redmi Buds 4 Pro', vid: 0x2717, pid: 0x5034, firmware: ['1.2.3.4'] },
      handshake: 'skipped',
    });
    expect(html).toContain('Redmi Buds 4');
    expect(html).toContain('Redmi Buds 4 Pro');
    expect(html).toContain('2717 / 5034');
    expect(html).toContain('1.2.3.4');
    expect(html).toContain('Skipped');
  });

  it('shows the in-ear switch only when the model reported it', () => {
    expect(render(XiaomiSystem, { capabilities: new Set(['wear']), wearDetection: true })).toContain('In-ear detection');
    expect(render(XiaomiSystem, { capabilities: new Set(['battery']) })).not.toContain('In-ear detection');
  });

  it('lists each battery cell, with charging', () => {
    const html = render(XiaomiSystem, {
      battery: [
        { device: 'left', level: 80, charging: true },
        { device: 'case', level: 30, charging: false },
      ],
    });
    expect(html).toContain('Left');
    expect(html).toContain('Charging');
    expect(html).toContain('Case');
  });

  it('offers find-my-earbuds per side, and a stop while ringing', () => {
    const idle = render(XiaomiSystem, { capabilities: new Set(['find']) });
    expect(idle).toContain('Left');
    expect(idle).toContain('Right');
    expect(idle).toContain('Both');
    expect(render(XiaomiSystem, { capabilities: new Set(['find']), finding: true })).toContain('Stop ringing');
    expect(render(XiaomiSystem, { capabilities: new Set(['battery']) })).not.toContain('Find my earbuds');
  });

  it('has the protocol log and ends with the shared tail', () => {
    const html = render(XiaomiSystem, { capabilities: new Set(['anc']) });
    expect(html).toContain('Protocol log');
    expect(html).toContain('Reported capabilities');
    expect(html).toContain('Noise control');
  });

  it('says so while nothing has been read yet', () => {
    expect(render(XiaomiSystem, {})).toContain('Connect to read');
  });
});
