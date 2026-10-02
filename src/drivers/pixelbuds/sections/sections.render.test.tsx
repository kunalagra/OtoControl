import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentType } from 'react';
import { describe, expect, it } from 'vitest';

import { AncState } from '../maestro';
import { initialPixelBudsState } from '../state';
import type { PixelBudsState } from '../state';
import { PixelBudsNoise } from './Noise';
import { PixelBudsSound } from './Sound';
import { PixelBudsSystem } from './System';

/** Markup only: a Proxy stands in for the device, handing back a no-op for any call. */
const device = new Proxy(
  {},
  { get: (_target, key) => (key === 'protocolLog' ? [] : key === 'onProtocolLog' ? () => () => undefined : () => undefined) },
) as never;

function render(Component: ComponentType<{ device: never; state: PixelBudsState }>, patch: Partial<PixelBudsState> = {}): string {
  return renderToStaticMarkup(<Component device={device} state={{ ...initialPixelBudsState, status: 'connected', ...patch }} />);
}

describe('Pixel Buds Noise section', () => {
  it('lists the three modes every pair has and Adaptive while it may exist', () => {
    const html = render(PixelBudsNoise, { ancMode: AncState.Active });
    for (const name of ['Off', 'Noise cancelling', 'Transparency', 'Adaptive']) expect(html).toContain(name);
  });

  it('drops Adaptive when the buds refused it or the loop lacks it', () => {
    expect(render(PixelBudsNoise, { ancMode: AncState.Active, adaptiveRefused: true })).not.toContain('Adaptive');
    expect(
      render(PixelBudsNoise, { ancMode: AncState.Active, ancLoop: { active: true, off: true, aware: true, adaptive: false } }),
    ).not.toContain('Adaptive');
  });

  it('marks the current mode pressed', () => {
    const html = render(PixelBudsNoise, { ancMode: AncState.Aware });
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it('says so when the buds report no noise control, and while nothing is loaded', () => {
    expect(render(PixelBudsNoise, { capabilities: new Set(['battery']) })).toContain('report no noise control');
    expect(render(PixelBudsNoise, { status: 'disconnected' })).toContain('Connect to load noise control');
  });
});

describe('Pixel Buds Sound section', () => {
  it('shows a slider per band with its signed gain', () => {
    const html = render(PixelBudsSound, { eq: [1.5, 0, -6, 0, 6], capabilities: new Set(['eq']) });
    for (const band of ['Low bass', 'Bass', 'Mid', 'Treble', 'Upper treble']) expect(html).toContain(band);
    expect(html).toContain('+1.5');
    expect(html).toContain('-6');
  });

  it('offers Volume EQ only when the buds reported it', () => {
    expect(render(PixelBudsSound, { capabilities: new Set(['eq', 'volumeEq']), volumeEq: false, eq: [0, 0, 0, 0, 0] })).toContain('Volume EQ');
    expect(render(PixelBudsSound, { capabilities: new Set(['eq']), eq: [0, 0, 0, 0, 0] })).not.toContain('Volume EQ');
  });

  it('says so when the buds report no equalizer', () => {
    expect(render(PixelBudsSound, { capabilities: new Set(['anc']) })).toContain('report no equalizer');
  });
});

describe('Pixel Buds System section', () => {
  it('shows firmware and serials per part, leaving out the ones not reported', () => {
    const html = render(PixelBudsSystem, {
      info: {
        model: 'Pixel Buds Pro',
        firmware: { case: '1.2.3', left: null, right: '9' },
        serials: { case: 'C1', left: 'L1', right: null },
      },
    });
    expect(html).toContain('Pixel Buds Pro');
    expect(html).toContain('Right 9 · Case 1.2.3');
    expect(html).toContain('Left L1 · Case C1');
  });

  it('flags a channel found by asking as unverified', () => {
    expect(render(PixelBudsSystem, { channel: 19 })).not.toContain('unverified');
    expect(render(PixelBudsSystem, { channel: 24, channelProbed: true })).toContain('found by asking');
  });

  it('shows the controls the buds reported, and only those', () => {
    const html = render(PixelBudsSystem, { capabilities: new Set(['multipoint']), multipoint: true });
    expect(html).toContain('Multipoint');
    expect(html).not.toContain('On-head detection');
    expect(render(PixelBudsSystem)).not.toContain('Controls');
  });

  it('labels each battery row with where the bud is, and explains a missing case', () => {
    const html = render(PixelBudsSystem, {
      battery: [
        { device: 'left', level: 80, charging: true },
        { device: 'right', level: 70, charging: false },
      ],
      placement: { leftInCase: true, rightInCase: false },
    });
    expect(html).toContain('Left · In case · Charging');
    expect(html).not.toContain('Right · In case');
    expect(html).toContain('only while a bud is in it');
  });

  it('carries the protocol log with a read-only query box, and the shared tail', () => {
    const html = render(PixelBudsSystem);
    expect(html).toContain('Protocol log');
    expect(html).toContain('Read-only query');
    expect(html).toContain('Reported capabilities');
  });

  it('names each capability the buds answered, and only those', () => {
    const html = render(PixelBudsSystem, { capabilities: new Set(['onHead', 'eq']) });
    expect(html).toContain('On-head detection');
    expect(html).toContain('Equalizer');
    expect(html).not.toContain('Volume EQ');
  });

  it('says so while nothing has been read yet', () => {
    expect(render(PixelBudsSystem)).toContain('Connect to read');
  });
});
