import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentType } from 'react';
import { describe, expect, it } from 'vitest';

import { catalogEntryFor } from '../catalog';
import { initialHeyMelodyState } from '../state';
import type { HeyMelodyState } from '../state';
import { HeyMelodyDevices } from './Devices';
import { HeyMelodySound } from './Sound';
import { HeyMelodySystem } from './System';

/** Markup only: a Proxy stands in for the device, handing back a no-op for any call. */
const device = new Proxy(
  {},
  { get: (_target, key) => (key === 'protocolLog' ? [] : key === 'onProtocolLog' ? () => () => undefined : () => undefined) },
) as never;

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

  it('lists multi-device support among the reported capabilities', () => {
    expect(renderSection(HeyMelodySystem, { capabilities: new Set(['multiDevice']) })).toContain('Connected devices');
    expect(renderSection(HeyMelodySystem, { capabilities: new Set(['battery']) })).not.toContain('Connected devices');
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

  it('offers the switches the device reported, and only those', () => {
    const html = renderSection(HeyMelodySystem, { features: new Map([[4, true], [40, false]]) });
    expect(html).toContain('Auto play/pause');
    expect(html).toContain('Game mode');
    expect(html).not.toContain('Low latency');
    expect(html).not.toContain('BassWave');
    expect(renderSection(HeyMelodySystem, {})).not.toContain('Controls');
  });

  it('shows the BassWave and alert volume sliders when the device reported them', () => {
    const html = renderSection(HeyMelodySystem, {
      features: new Map([[29, true]]),
      bassLevel: { min: -5, max: 5, level: 2 },
      alertVolume: 8,
    });
    expect(html).toContain('BassWave');
    expect(html).toContain('Alert volume');
  });

  it('ends with the shared System tail, like every other brand', () => {
    expect(renderSection(HeyMelodySystem, {})).toContain('Reported capabilities');
  });

  it('names each capability the device reported, and only those', () => {
    const html = renderSection(HeyMelodySystem, { capabilities: new Set(['wear', 'eqCustom']) });
    expect(html).toContain('Wear detection');
    expect(html).toContain('Custom EQ');
    expect(html).not.toContain('Noise control');
  });

  it('says so while nothing has been read yet', () => {
    expect(renderSection(HeyMelodySystem, { capabilities: new Set() })).toContain('Connect to read');
  });
});

describe('HeyMelody Sound section', () => {
  const custom = (eqId: number, name: string, isSelected = false) => ({
    isSelected,
    minValue: -6,
    maxValue: 6,
    eqId,
    name,
    bands: [
      { frequency: 100, dbValue: 0 },
      { frequency: 4300, dbValue: 2 },
    ],
  });
  const buds4 = { ...initialHeyMelodyState.info, productId: '065414', catalog: catalogEntryFor('065414') };

  it('shows the model built-ins even when the device lists no custom presets', () => {
    const html = renderSection(HeyMelodySound, { info: buds4, capabilities: new Set(['eq', 'eqCustom']) });
    for (const name of ['Balanced', 'Clear vocals', 'Bass']) expect(html).toContain(name);
    expect(html).toContain('No custom presets yet');
    expect(html).toContain('New preset');
  });

  it('shows sliders for the selected custom preset only', () => {
    const html = renderSection(HeyMelodySound, {
      info: buds4,
      eqCurrentPreset: 9,
      eqPresets: [custom(9, 'Mine', true), custom(10, 'Other')],
      capabilities: new Set(['eq', 'eqCustom']),
    });
    expect(html.match(/>100 Hz</g)).toHaveLength(1);
    expect(html).toContain('Mine');
    expect(html).toContain('Other');
  });

  it('shows no Custom card without curve writes', () => {
    const html = renderSection(HeyMelodySound, { info: buds4, eqPresets: [custom(9, 'Mine', true)], capabilities: new Set(['eq']) });
    expect(html).not.toContain('New preset');
    expect(html).not.toContain('100 Hz');
  });

  it('disables New preset at the model cap and says why', () => {
    const html = renderSection(HeyMelodySound, {
      info: buds4,
      eqPresets: [custom(9, 'A'), custom(10, 'B'), custom(11, 'C')],
      capabilities: new Set(['eq', 'eqCustom']),
    });
    expect(html).toContain('Up to 3 custom presets');
  });
});

describe('HeyMelody touch controls', () => {
  it('lists the table by side once the device reported it', () => {
    const html = renderSection(HeyMelodySystem, {
      gestures: [
        { deviceType: 1, button: 1, action: 2, fn: 1 },
        { deviceType: 2, button: 1, action: 2, fn: 6 },
      ],
    });
    expect(html).toContain('Touch controls');
    expect(html).toContain('Left');
    expect(html).toContain('Double tap');
    expect(html).toContain('Play/pause');
  });

  it('shows nothing without a table', () => {
    expect(renderSection(HeyMelodySystem, {})).not.toContain('Touch controls');
  });
});

describe('HeyMelody Connections section', () => {
  const peer = (name: string, patch: Partial<HeyMelodyState['peers'][number]> = {}) => ({
    mac: '01:02:03:04:05:06',
    name,
    connected: true,
    isThisDevice: false,
    audioActive: false,
    ...patch,
  });

  it('lists every paired peer with its connection state and badges', () => {
    const html = renderSection(HeyMelodyDevices, {
      peers: [
        peer('Phone', { isThisDevice: true }),
        peer('Laptop', { audioActive: true }),
        peer('Old tablet', { connected: false }),
      ],
    });
    expect(html).toContain('Phone');
    expect(html).toContain('This device');
    expect(html).toContain('Laptop');
    expect(html).toContain('Playing audio');
    expect(html).toContain('Old tablet');
    expect(html.match(/Not connected/g)).toHaveLength(1);
    expect(html.match(/>Connected</g)).toHaveLength(2);
    expect(html).toContain("Switching devices from here isn&#x27;t supported yet.");
  });

  it('says so when no device is paired', () => {
    expect(renderSection(HeyMelodyDevices, { peers: [] })).toContain('No paired devices.');
  });
});
