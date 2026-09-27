import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentType } from 'react';
import { describe, expect, it } from 'vitest';

import { initialHeyMelodyState } from '../state';
import type { HeyMelodyState } from '../state';
import { HeyMelodySound } from './Sound';
import { HeyMelodySystem } from './System';

/** Markup only: a Proxy stands in for the device, handing back a no-op for any call. */
const device = new Proxy({}, { get: () => () => undefined }) as never;

function renderSection(
  Component: ComponentType<{ device: never; state: HeyMelodyState }>,
  patch: Partial<HeyMelodyState>,
): string {
  return renderToStaticMarkup(<Component device={device} state={{ ...initialHeyMelodyState, status: 'connected', ...patch }} />);
}

describe('HeyMelody System section', () => {
  it('shows each firmware version by device', () => {
    const html = renderSection(HeyMelodySystem, {
      info: { ...initialHeyMelodyState.info, version: [{ device: 'left', type: 0, version: '1.2.3' }] },
    });
    expect(html).toContain('Firmware');
    expect(html).toContain('Left 1.2.3');
  });

  it('labels each battery row with its in-ear status', () => {
    const html = renderSection(HeyMelodySystem, {
      battery: [{ device: 'left', level: 80, charging: false }],
      wear: [{ device: 'left', inEar: true, inBox: false }],
    });
    expect(html).toContain('In ear');
  });

  it('offers find-my-earbuds only when the device reports it', () => {
    expect(renderSection(HeyMelodySystem, { capabilities: new Set(['find']) })).toContain('Ring earbuds');
    expect(renderSection(HeyMelodySystem, { capabilities: new Set(['battery']) })).not.toContain('Ring earbuds');
    expect(renderSection(HeyMelodySystem, { capabilities: new Set(['find']), finding: true })).toContain('Stop ringing');
  });
});

describe('HeyMelody Sound section', () => {
  const preset = {
    isSelected: true,
    minValue: -6,
    maxValue: 6,
    eqId: 9,
    name: 'C1',
    bands: [
      { frequency: 100, dbValue: 0 },
      { frequency: 4300, dbValue: 2 },
    ],
  };

  it('shows a slider per band for custom EQs only when the device supports curve writes', () => {
    const html = renderSection(HeyMelodySound, { eqPresets: [preset], capabilities: new Set(['eq', 'eqCustom']) });
    expect(html).toContain('100 Hz');
    expect(html).toContain('4.3 kHz');
    expect(renderSection(HeyMelodySound, { eqPresets: [preset], capabilities: new Set(['eq']) })).not.toContain('100 Hz');
  });
});
