import { describe, expect, it } from 'vitest';

import { initialSonyState } from '@/device/sony';
import { initialState } from '@/device/state';
import type { ActiveDevice } from '@/device/manager';
import { summarise } from './summary';

/** Mirrors the decoder's derivation, so tests exercise realistic values. */
const cell = (level: number, status = 0x00) => ({
  level,
  status,
  charging: status === 0x01,
  onPower: status === 0x01 || status === 0x03,
  present: status !== 0x02,
});

const sony = (overrides: Partial<typeof initialSonyState>): ActiveDevice =>
  ({
    brand: 'sony',
    device: {} as never,
    state: { ...initialSonyState, ...overrides },
  }) as ActiveDevice;

const sennheiser = (overrides: Partial<typeof initialState>): ActiveDevice =>
  ({
    brand: 'sennheiser',
    device: {} as never,
    state: { ...initialState, ...overrides },
  }) as ActiveDevice;

describe('summarise — Sony', () => {
  it('reports the lower earbud, since that is what limits you', () => {
    const summary = summarise(
      sony({
        battery: {
          left: cell(80),
          right: cell(45),
        },
      }),
    );
    expect(summary.battery).toBe(45);
    expect(summary.detail).toBe('L 80% · R 45%');
  });

  it('is charging if either earbud is', () => {
    expect(
      summarise(
        sony({
          battery: {
            left: cell(50),
            right: cell(50, 0x01),
          },
        }),
      ).charging,
    ).toBe(true);
  });

  it('falls back to a single battery when there is no pair', () => {
    const summary = summarise(sony({ singleBattery: cell(62) }));
    expect(summary.battery).toBe(62);
    expect(summary.detail).toBeNull();
  });

  it('reports no battery rather than 0% when nothing has been read', () => {
    expect(summarise(sony({})).battery).toBeNull();
  });

  it('names the codec using the Sony enum, not the Sennheiser one', () => {
    // 0x02 is AAC for Sony; the same byte is aptX in the Sennheiser table.
    expect(summarise(sony({ codec: 0x02 })).codec).toBe('AAC');
  });

  it('carries the colour code through for artwork', () => {
    expect(summarise(sony({ info: { model: null, firmware: null, colour: { series: 0, colour: 1 } } })).colourCode).toBe(1);
  });
});

describe('summarise — Sennheiser', () => {
  it('uses the single battery value and wear state', () => {
    const summary = summarise(sennheiser({ battery: 70, wearState: 3 }));
    expect(summary.battery).toBe(70);
    expect(summary.detail).toBe('On head');
  });

  it('names the codec using the Sennheiser enum', () => {
    expect(summarise(sennheiser({ info: { ...initialState.info, codec: 0x02 } })).codec).toBe(
      'aptX',
    );
  });

  it('has no colour code — colour is in the model string', () => {
    expect(summarise(sennheiser({})).colourCode).toBeNull();
  });

  it('falls back to the brand only while there is a connection to speak of', () => {
    expect(summarise(sennheiser({ status: 'connected' })).model).toBe('Sennheiser headphones');
    expect(summarise(sony({ status: 'connected' })).model).toBe('Sony headphones');
  });
});

describe('summarise — no device', () => {
  it('says "No device" rather than naming hardware never spoken to', () => {
    expect(summarise(sennheiser({ status: 'disconnected' })).model).toBe('No device');
    expect(summarise(sony({ status: 'disconnected' })).model).toBe('No device');
  });

  it('flags that there is nothing to draw', () => {
    expect(summarise(sennheiser({ status: 'disconnected' })).hasDevice).toBe(false);
    expect(summarise(sony({ status: 'disconnected' })).hasDevice).toBe(false);
  });

  it('uses the brand while connecting, when it is the best guess available', () => {
    expect(summarise(sennheiser({ status: 'connecting' })).model).toBe('Sennheiser headphones');
    expect(summarise(sony({ status: 'connecting' })).model).toBe('Sony headphones');
  });

  it('says "No device" on an unsupported browser too', () => {
    expect(summarise(sennheiser({ status: 'unsupported' })).model).toBe('No device');
  });

  it('prefers the reported model once there is one', () => {
    const summary = summarise(
      sennheiser({ status: 'connected', info: { ...initialState.info, model: 'M4AEBT Black' } }),
    );
    expect(summary.model).toBe('M4AEBT Black');
    expect(summary.hasDevice).toBe(true);
  });

  it('keeps hasDevice true after a drop, so the last known device still shows', () => {
    // The model survives in state until the device object is reset.
    const summary = summarise(
      sennheiser({ status: 'disconnected', info: { ...initialState.info, model: 'M4AEBT Black' } }),
    );
    expect(summary.hasDevice).toBe(true);
    expect(summary.model).toBe('M4AEBT Black');
  });
});

describe('summarise — per-earbud state', () => {
  it('marks which earbud is charging, not just that one is', () => {
    const summary = summarise(
      sony({
        battery: {
          left: cell(80, 0x01),
          right: cell(45),
        },
      }),
    );
    expect(summary.detail).toBe('L 80% ⚡ · R 45%');
  });

  it('marks both when both are charging', () => {
    const summary = summarise(
      sony({
        battery: {
          left: cell(90, 0x01),
          right: cell(90, 0x01),
        },
      }),
    );
    expect(summary.detail).toBe('L 90% ⚡ · R 90% ⚡');
  });

  it('marks neither when neither is', () => {
    const summary = summarise(
      sony({
        battery: {
          left: cell(100),
          right: cell(100),
        },
      }),
    );
    expect(summary.detail).toBe('L 100% · R 100%');
  });
});

describe('summarise — an earbud in the case', () => {
  /** Left in the case, right worn: 23 01 00 02 64 00 from a real WF-C500. */
  const asymmetric = sony({
    battery: { left: cell(0, 0x02), right: cell(100, 0x00) },
  });

  it('ignores the non-reporting earbud instead of showing 0%', () => {
    expect(summarise(asymmetric).battery).toBe(100);
  });

  it('says which side is in the case', () => {
    expect(summarise(asymmetric).detail).toBe('L in case · R 100%');
  });

  it('still takes the lower of two reporting earbuds', () => {
    const both = sony({ battery: { left: cell(80), right: cell(45) } });
    expect(summarise(both).battery).toBe(45);
  });

  it('reports no battery when neither earbud is reporting', () => {
    const none = sony({ battery: { left: cell(0, 0x02), right: cell(0, 0x02) } });
    expect(summarise(none).battery).toBeNull();
    expect(summarise(none).detail).toBe('L in case · R in case');
  });

  it('does not call a flat earbud absent', () => {
    const flat = sony({ battery: { left: cell(0, 0x00), right: cell(50) } });
    expect(summarise(flat).battery).toBe(0);
    expect(summarise(flat).detail).toBe('L 0% · R 50%');
  });
});
