/**
 * Tests `ui/device/summary.ts` from outside `ui/`, because it is a
 * cross-driver test and `ui/` may not name a driver.
 *
 * The subject is driver-agnostic; this test cannot be, since the whole point
 * of `summarise` is that two real driver states collapse to one shape — the
 * fixtures below are the actual `initialState` and `initialSonyState`, not
 * hand-written stand-ins that could drift from them. That is the same reason
 * `sections.render.test.tsx` sits beside this file rather than in `ui/`:
 * `src/` is the composition root, the one tier with no purity constraint on
 * naming drivers. It is not the only place that knows both — `core/driver.ts`
 * imports both descriptors by design, and `manager.ts`'s `ActiveDevice` names
 * both — but those are allow-listed, and `ui/` is not.
 */

import { describe, expect, it } from 'vitest';

import { SENNHEISER_DRIVER, SONY_DRIVER } from '@/core/driver';
import { initialSonyState } from '@/drivers/sony/sony';
import { WearState } from '@/drivers/sennheiser/gaia/commands';
import { initialState } from '@/drivers/sennheiser/state';
import type { ActiveDevice } from '@/core/manager';
import { summarise } from '@/ui/device/summary';

/** Mirrors the decoder's derivation, so tests exercise realistic values. */
const cell = (level: number, status = 0x00) => ({
  level,
  status,
  charging: status === 0x01,
  onPower: status === 0x01 || status === 0x03,
  present: status !== 0x02,
});

const sony = (overrides: Partial<typeof initialSonyState>): ActiveDevice => ({
  id: SONY_DRIVER.id,
  driver: SONY_DRIVER,
  device: {} as never,
  state: { ...initialSonyState, ...overrides },
});

const sennheiser = (overrides: Partial<typeof initialState>): ActiveDevice => ({
  id: SENNHEISER_DRIVER.id,
  driver: SENNHEISER_DRIVER,
  device: {} as never,
  state: { ...initialState, ...overrides },
});

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

/**
 * `worn` is the only field `summarise` gained a descriptor method for that no
 * existing test covered, and it is the one whose *shape* changed rather than
 * just its home: `DeviceImage` took a required `wearState: number | null` and
 * derived the boolean itself, and now takes an optional `worn?: boolean`.
 *
 * Task 4b's plan claimed the section render net guarded this. It does not —
 * that net renders four sections, and `DeviceImage`'s only callers
 * (`Sidebar.tsx`, `MobileChrome.tsx`) are rendered by no test at all. So the
 * one behaviour-shaped change in the task shipped on hand-verification alone.
 *
 * These pin the exact truth table the old inline expression had, at the layer
 * the logic now lives in. `null` meaning "worn" is deliberate, not a fallback
 * that happens to work: nothing reported yet must not dim the product render.
 */
describe('summarise — worn', () => {
  it('treats an unreported wear state as worn, so the render is not dimmed', () => {
    expect(summarise(sennheiser({ wearState: null })).worn).toBe(true);
  });

  it('is worn when the headphones report on-head', () => {
    expect(summarise(sennheiser({ wearState: WearState.OnHead })).worn).toBe(true);
  });

  it('is not worn when the headphones report off-head', () => {
    expect(summarise(sennheiser({ wearState: WearState.NotOnHead })).worn).toBe(false);
  });

  it('is always worn for a driver with no wear detection', () => {
    expect(summarise(sony({})).worn).toBe(true);
  });
});
