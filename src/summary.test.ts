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

import {
  HEYMELODY_DRIVER,
  XIAOMI_DRIVER,
  NOTHING_DRIVER,
  PIXELBUDS_DRIVER,
  SAMSUNG_DRIVER,
  SENNHEISER_DRIVER,
  SONY_DRIVER,
  SOUNDCORE_DRIVER,
} from '@/core/driver';
import { initialSonyState } from '@/drivers/sony/sony';
import { EQ_PRESET_NAMES } from '@/drivers/sony/mdr/commands';
import { WearState } from '@/drivers/sennheiser/gaia/commands';
import { initialState } from '@/drivers/sennheiser/state';
import { initialNothingState } from '@/drivers/nothing/device';
import { EqPreset } from '@/drivers/nothing/commands';
import { initialSoundcoreState } from '@/drivers/soundcore/device';
import { EQ_PRESETS } from '@/drivers/soundcore/commands';
import { initialHeyMelodyState } from '@/drivers/heymelody/state';
import { initialPixelBudsState } from '@/drivers/pixelbuds/state';
import { initialXiaomiState } from '@/drivers/xiaomi/state';
import { initialSamsungState } from '@/drivers/samsung/state';
import type { DeviceDriver } from '@/core/driver';
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

  it('resolves artwork through the driver, not the summary', () => {
    // The colour byte never travels through the summary any more: the Sony
    // driver's artwork strategy reads it off its own state.
    expect(summarise(sony({ info: { model: null, firmware: null, colour: { series: 0, colour: 1 } } })).artwork)
      .toBeDefined();
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

  it('resolves artwork from the model string, where colour lives', () => {
    const summary = summarise(sennheiser({ info: { ...initialState.info, model: 'M4AEBT White' } }));
    expect(summary.artwork.hero).toContain('sennheiser/m4/white_hero.webp');
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

/**
 * `cells` and `firmware` (spec §5.1), per driver, because the whole point of the
 * two fields is that five protocols normalise into them — and the normalisation
 * is where the interesting decisions are: which cells exist, what a cell with no
 * reading contributes, and that `battery` is the same minimum in every case.
 */
describe('summarise — cells and firmware', () => {
  const active = <TState>(
    driver: typeof SENNHEISER_DRIVER | typeof SONY_DRIVER | typeof NOTHING_DRIVER | typeof SOUNDCORE_DRIVER | typeof HEYMELODY_DRIVER | typeof PIXELBUDS_DRIVER | typeof XIAOMI_DRIVER | typeof SAMSUNG_DRIVER,
    state: TState,
  ): ActiveDevice => ({ id: driver.id, driver, device: {} as never, state }) as ActiveDevice;

  it('gives an over-ear one cell, under the heading that suits one cell', () => {
    const summary = summarise(sennheiser({ battery: 70, charging: true }));
    expect(summary.cells).toEqual([{ label: 'Battery', level: 70, charging: true }]);
    expect(summary.battery).toBe(70);
  });

  it('reports no cell at all before anything has been read', () => {
    expect(summarise(sennheiser({})).cells).toEqual([]);
    expect(summarise(sennheiser({})).battery).toBeNull();
  });

  it('names a Sony earbud pair, and leaves out the bud that is in its case', () => {
    // A bud in the case reports level 0 with UNKNOWN status: as a row that would
    // read as "this earbud is flat", which is the one thing the driver is not saying.
    const summary = summarise(
      sony({ battery: { left: cell(80), right: cell(0, 0x02) } }),
    );
    expect(summary.cells).toEqual([{ label: 'L', level: 80, charging: false }]);
    expect(summary.battery).toBe(80);
  });

  it('names the ear the level came from, whichever one that is', () => {
    // The mirror of the case above, and the regression it invited: filtering the
    // pair down to "the buds reporting" and then labelling what is left by
    // position would file the right earbud's 80% under "L".
    const summary = summarise(
      sony({ battery: { left: cell(0, 0x02), right: cell(80) } }),
    );
    expect(summary.cells).toEqual([{ label: 'R', level: 80, charging: false }]);
    expect(summary.battery).toBe(80);
  });

  it('keeps both Sony cells labelled by side when the ears disagree on presence', () => {
    const summary = summarise(
      sony({ battery: { left: cell(0, 0x02), right: cell(45, 0x01) } }),
    );
    expect(summary.cells).toEqual([{ label: 'R', level: 45, charging: true }]);
    expect(summary.battery).toBe(45);
    expect(summary.charging).toBe(true);
  });

  it('calls a Sony over-ear a single cell rather than an unlabelled left', () => {
    expect(summarise(sony({ singleBattery: cell(62) })).cells).toEqual([
      { label: 'Battery', level: 62, charging: false },
    ]);
  });

  it('keeps every Nothing cell the device reported, in display order', () => {
    const summary = summarise(
      active(
        NOTHING_DRIVER,
        {
          ...initialNothingState,
          battery: {
            left: { level: 80, charging: false },
            right: { level: 45, charging: true },
            case: { level: 60, charging: false },
            single: null,
          },
        },
      ),
    );
    expect(summary.cells.map((entry) => [entry.label, entry.level])).toEqual([
      ['L', 80],
      ['R', 45],
      ['Case', 60],
    ]);
    expect(summary.battery).toBe(45);
    expect(summary.charging).toBe(true);
  });

  it('skips a Nothing side that is absent, rather than showing it as flat', () => {
    const summary = summarise(
      active(
        NOTHING_DRIVER,
        {
          ...initialNothingState,
          battery: {
            left: null,
            right: { level: 90, charging: false },
            case: null,
            single: null,
          },
        },
      ),
    );
    expect(summary.cells).toEqual([{ label: 'R', level: 90, charging: false }]);
  });

  it('skips a Soundcore bud that is not reporting, for the same reason', () => {
    const summary = summarise(
      active(
        SOUNDCORE_DRIVER,
        {
          ...initialSoundcoreState,
          battery: { left: { level: 55, charging: false }, right: { level: null, charging: false } },
        },
      ),
    );
    expect(summary.cells).toEqual([{ label: 'L', level: 55, charging: false }]);
    expect(summary.battery).toBe(55);
  });

  it('maps HeyMelody’s own cell names onto the short headings', () => {
    const summary = summarise(
      active(
        HEYMELODY_DRIVER,
        {
          ...initialHeyMelodyState,
          battery: [
            { device: 'left', level: 70, charging: false },
            { device: 'right', level: 70, charging: false },
            { device: 'case', level: 30, charging: true },
          ],
        },
      ),
    );
    expect(summary.cells.map((entry) => [entry.label, entry.level])).toEqual([
      ['L', 70],
      ['R', 70],
      ['Case', 30],
    ]);
    expect(summary.battery).toBe(30);
  });

  it('maps Pixel Buds’ cells onto the short headings, charging included', () => {
    const summary = summarise(
      active(PIXELBUDS_DRIVER, {
        ...initialPixelBudsState,
        status: 'connected' as const,
        battery: [
          { device: 'case', level: 90, charging: false },
          { device: 'left', level: 60, charging: true },
          { device: 'right', level: 0, charging: false },
        ],
      }),
    );
    expect(summary.cells.map((entry) => [entry.label, entry.level, entry.charging])).toEqual([
      ['Case', 90, false],
      ['L', 60, true],
      ['R', 0, false],
    ]);
    expect(summary.battery).toBe(0);
    expect(summary.charging).toBe(true);
    expect(summary.model).toBe('Pixel Buds');
    expect(summary.hasDevice).toBe(false);
  });

  it('maps Xiaomi’s cells onto the short headings and takes the first firmware version', () => {
    const summary = summarise(
      active(XIAOMI_DRIVER, {
        ...initialXiaomiState,
        info: { ...initialXiaomiState.info, model: 'Redmi Buds 4', vid: 0x2717, firmware: ['1.2.3.4', '5.6.7.8'] },
        battery: [
          { device: 'left', level: 80, charging: true },
          { device: 'right', level: 75, charging: false },
          { device: 'case', level: 40, charging: false },
        ],
      }),
    );
    expect(summary.model).toBe('Redmi Buds 4');
    expect(summary.hasDevice).toBe(true);
    expect(summary.cells.map((entry) => [entry.label, entry.level])).toEqual([
      ['L', 80],
      ['R', 75],
      ['Case', 40],
    ]);
    expect(summary.battery).toBe(40);
    expect(summary.charging).toBe(true);
    expect(summary.firmware).toBe('1.2.3.4');
  });

  it('has no Xiaomi device until something identified itself', () => {
    const summary = summarise(active(XIAOMI_DRIVER, initialXiaomiState));
    expect(summary.hasDevice).toBe(false);
    expect(summary.firmware).toBeNull();
    expect(summary.cells).toEqual([]);
  });

  it('gives Galaxy Buds a cell per reporting bud and the case, skipping one that reports nothing', () => {
    const summary = summarise(
      active(SAMSUNG_DRIVER, {
        ...initialSamsungState,
        info: { ...initialSamsungState.info, model: 'Galaxy Buds2 Pro', firmware: 'R510XXE0ARF4' },
        battery: { left: 70, right: null, case: 30 },
        charging: { left: false, right: false, case: true },
      }),
    );
    expect(summary.model).toBe('Galaxy Buds2 Pro');
    expect(summary.hasDevice).toBe(true);
    expect(summary.cells).toEqual([
      { label: 'L', level: 70, charging: false },
      { label: 'Case', level: 30, charging: true },
    ]);
    expect(summary.battery).toBe(30);
    expect(summary.charging).toBe(true);
    expect(summary.firmware).toBe('R510XXE0ARF4');
  });

  it('shows Galaxy Buds as no device until a model has been read', () => {
    const summary = summarise(active(SAMSUNG_DRIVER, initialSamsungState));
    expect(summary.hasDevice).toBe(false);
    expect(summary.cells).toEqual([]);
    expect(summary.battery).toBeNull();
  });

  it('reads the firmware each driver already holds, and null for the ones with none', () => {
    expect(summarise(sennheiser({ info: { ...initialState.info, firmware: '1.2.3' } })).firmware).toBe(
      '1.2.3',
    );
    expect(
      summarise(sony({ info: { model: 'WH-1000XM5', firmware: '2.1.0', colour: null } })).firmware,
    ).toBe('2.1.0');
    expect(
      summarise(active(NOTHING_DRIVER, { ...initialNothingState, info: { ...initialNothingState.info, firmware: 'B1' } }))
        .firmware,
    ).toBe('B1');
    expect(
      summarise(active(SOUNDCORE_DRIVER, initialSoundcoreState)).firmware,
    ).toBeNull();
    // Pixel Buds report one version per part; the chip shows the first the buds named.
    expect(
      summarise(
        active(PIXELBUDS_DRIVER, {
          ...initialPixelBudsState,
          info: { model: 'Pixel Buds Pro', firmware: { case: 'c1', left: null, right: 'r1' }, serials: null },
        }),
      ).firmware,
    ).toBe('r1');
    expect(summarise(active(PIXELBUDS_DRIVER, initialPixelBudsState)).firmware).toBeNull();
    // HeyMelody reports one version per device; the chip shows the first.
    expect(
      summarise(
        active(HEYMELODY_DRIVER, {
          ...initialHeyMelodyState,
          info: { ...initialHeyMelodyState.info, version: [{ device: 'left', type: 1, version: 'v2.1' }] },
        }),
      ).firmware,
    ).toBe('v2.1');
  });
});

/**
 * The two optional readouts Home asks a driver for (spec §5.2, §5.3).
 *
 * Per driver for the same reason as above: each is a few lines over that
 * driver's own state, and the one thing worth checking is that a driver which
 * has not been asked yet answers null rather than an empty-but-confident value.
 */
describe('eqPreview and connections', () => {
  it('reads the Sennheiser curve, the range the device reported and the preset it matches', () => {
    const driver = SENNHEISER_DRIVER;
    const state = {
      ...initialState,
      status: 'connected' as const,
      eq: { config: { bands: 5, minGain: -6, maxGain: 6 }, gains: [0, 2, 2.5, 1.5, -2] },
    };
    expect(driver.eqPreview!(state)).toEqual({
      preset: 'Rock',
      gains: [0, 2, 2.5, 1.5, -2],
      range: { min: -6, max: 6 },
    });
  });

  it('calls a Sennheiser curve that matches no preset custom, not its nearest neighbour', () => {
    const driver = SENNHEISER_DRIVER;
    const state = {
      ...initialState,
      status: 'connected' as const,
      eq: { config: { bands: 5, minGain: -6, maxGain: 6 }, gains: [0.4, 2, 2.5, 1.5, -2] },
    };
    expect(driver.eqPreview!(state)?.preset).toBeNull();
  });

  it('has no Sennheiser preview while any band is still unread', () => {
    // An unread band drawn as 0 dB is a flat band the device never reported,
    // and it can make the curve match a preset name the headphones are not on.
    const state = {
      ...initialState,
      status: 'connected' as const,
      eq: { config: { bands: 5, minGain: -6, maxGain: 6 }, gains: [0, 0, undefined, 0, 0] },
    };
    expect(SENNHEISER_DRIVER.eqPreview!(state)).toBeNull();
  });

  it('has no Sennheiser connection list before the device has named one', () => {
    // A connected Momentum always lists at least this host, so an empty list is
    // one that has not been read — not "0 of 0 links".
    expect(SENNHEISER_DRIVER.connections!(initialState)).toBeNull();
  });

  it('has no Sennheiser preview to draw before the config query is answered', () => {
    expect(SENNHEISER_DRIVER.eqPreview!(initialState)).toBeNull();
  });

  it('names a Sony preset and uses the fixed range the protocol implies', () => {
    const driver = SONY_DRIVER;
    const state = { ...initialSonyState, eq: { inquiryType: 0, preset: 4, gains: [0, 1, -1, 2, -2, 0] } };
    expect(driver.eqPreview!(state)).toEqual({
      preset: EQ_PRESET_NAMES[4],
      gains: [0, 1, -1, 2, -2, 0],
      range: { min: -10, max: 10 },
    });
    // A device that reports no EQ capability never fills the field, so the tile
    // falls back rather than drawing a curve of silence.
    expect(driver.eqPreview!(initialSonyState)).toBeNull();
  });

  it('marks no Sony entry as this device, since MDR cannot say which one it is', () => {
    const driver = SONY_DRIVER;
    const state = {
      ...initialSonyState,
      connections: {
        devices: [
          { mac: 'aa', name: 'MacBook Pro', status: 1, connected: true, classOfDevice: 0x0100 },
          { mac: 'bb', name: 'Pixel 8', status: 0, connected: false, classOfDevice: 0x0100 },
        ],
        playbackMac: 'aa',
        playbackFixed: null,
      },
    };
    // `playbackMac` is the peer the headphones are *playing from*, which the
    // Sony section labels "Audio here". It says nothing about which peer this
    // app is talking through — a phone streaming music is not "· this" on the
    // laptop — and MDR reports nothing that does, so no entry is marked.
    expect(driver.connections!(state)).toEqual([
      { name: 'MacBook Pro', connected: true, isThisDevice: false },
      { name: 'Pixel 8', connected: false, isThisDevice: false },
    ]);
    expect(driver.connections!(initialSonyState)).toBeNull();
  });

  it('marks the Sennheiser entry at the index the device calls its own', () => {
    const driver = SENNHEISER_DRIVER;
    const state = {
      ...initialState,
      connections: {
        devices: [
          { index: 0, priority: 1, name: 'iPad Air', connected: false },
          { index: 1, priority: 2, name: '', connected: true },
        ],
        maxConnections: 2,
        ownIndex: 1,
      },
    };
    expect(driver.connections!(state)).toEqual([
      { name: 'iPad Air', connected: false, isThisDevice: false },
      // An unnamed entry is named after its slot rather than shown blank.
      { name: 'Device 2', connected: true, isThisDevice: true },
    ]);
  });

  it('gives the Soundcore curve in decibels, from its signed tenths', () => {
    const driver = SOUNDCORE_DRIVER;
    const state = {
      ...initialSoundcoreState,
      eq: { profile: EQ_PRESETS[1].id, left: [40, 10, 20, 20, 40, 40, 40, 20], right: [40, 10, 20, 20, 40, 40, 40, 20] },
    };
    expect(driver.eqPreview!(state)).toEqual({
      preset: EQ_PRESETS[1].name,
      gains: [4, 1, 2, 2, 4, 4, 4, 2],
      range: { min: -12, max: 6 },
    });
    expect(driver.eqPreview!(initialSoundcoreState)).toBeNull();
  });

  it('draws the Nothing custom bands, and leaves the name to the tile', () => {
    const driver = NOTHING_DRIVER;
    const state = {
      ...initialNothingState,
      eqPreset: EqPreset.Custom,
      customEq: {
        totalGain: 0,
        bands: [
          { filterType: 0, gain: 0, frequency: 100, q: 1 },
          { filterType: 0, gain: 3, frequency: 1000, q: 1 },
        ],
      },
    };
    expect(driver.eqPreview!(state)).toEqual({
      // No preset name: the curve is hand-set, and the tile says Custom.
      preset: null,
      gains: [0, 3],
      range: { min: -10, max: 10 },
    });
    expect(driver.eqPreview!(initialNothingState)).toBeNull();
  });

  it('draws nothing for a Nothing preset, whose curve this app cannot see', () => {
    // Pairing a named preset with the custom profile's bars would be two
    // different curves in one tile, so a named preset answers null instead.
    const driver = NOTHING_DRIVER;
    const state = {
      ...initialNothingState,
      eqPreset: EqPreset.Bass,
      customEq: { totalGain: 0, bands: [{ filterType: 0, gain: 5, frequency: 100, q: 1 }] },
    };
    expect(driver.eqPreview!(state)).toBeNull();
  });

  it('draws whichever HeyMelody preset is selected, against the range it reports', () => {
    const driver = HEYMELODY_DRIVER;
    const state = {
      ...initialHeyMelodyState,
      eqPresets: [
        {
          isSelected: true,
          minValue: -6,
          maxValue: 6,
          eqId: 2,
          name: 'Bass Boost',
          bands: [
            { frequency: 60, dbValue: 4 },
            { frequency: 1000, dbValue: -2 },
          ],
        },
      ],
    };
    expect(driver.eqPreview!(state)).toEqual({
      preset: 'Bass Boost',
      gains: [4, -2],
      range: { min: -6, max: 6 },
    });
    expect(driver.eqPreview!(initialHeyMelodyState)).toBeNull();
  });

  it('draws the Pixel Buds curve against the documented ±6 dB range, with no preset name', () => {
    const state = { ...initialPixelBudsState, eq: [1, 0, -2, 0, 3] as [number, number, number, number, number] };
    expect(PIXELBUDS_DRIVER.eqPreview(state)).toEqual({ preset: null, gains: [1, 0, -2, 0, 3], range: { min: -6, max: 6 } });
    expect(PIXELBUDS_DRIVER.eqPreview(initialPixelBudsState)).toBeNull();
  });

  it('leaves connections unimplemented for the drivers with no pairing table', () => {
    // Two of five drivers read no paired-device list at all; the method being
    // absent is what makes the Home tile show a plain link rather than an empty
    // heading over nothing. Read through the interface, because each descriptor
    // is a literal whose own type has no such key to ask about.
    const asDriver = (descriptor: unknown) => descriptor as DeviceDriver<never, never>;
    expect(asDriver(NOTHING_DRIVER).connections).toBeUndefined();
    expect(asDriver(SOUNDCORE_DRIVER).connections).toBeUndefined();
    expect(asDriver(PIXELBUDS_DRIVER).connections).toBeUndefined();
    expect(asDriver(HEYMELODY_DRIVER).connections).toBeTypeOf('function');
    expect(asDriver(SENNHEISER_DRIVER).connections).toBeTypeOf('function');
    expect(asDriver(SONY_DRIVER).connections).toBeTypeOf('function');
  });
});

/**
 * `wearCaption` — the one readout Home takes by name rather than inferring.
 *
 * It exists because `statusLine` is free to be about something else, and one
 * driver's is a status line ("L in case · R in case") that reads like a wear
 * state without being one. GAIA is the only driver that decodes a wear state, so
 * it is the only one that implements it, and "no caption" is the honest answer
 * everywhere else.
 */
describe('wearCaption', () => {
  it('names the Sennheiser wear state in the driver’s own words', () => {
    expect(SENNHEISER_DRIVER.wearCaption!({ ...initialState, wearState: WearState.OnHead })).toBe(
      'On head',
    );
    expect(SENNHEISER_DRIVER.wearCaption!({ ...initialState, wearState: WearState.InCase })).toBe(
      'In case',
    );
  });

  it('has nothing to say before the device has reported one', () => {
    expect(SENNHEISER_DRIVER.wearCaption!(initialState)).toBeNull();
  });

  it('is unimplemented for the drivers that do not decode a wear state', () => {
    const asDriver = (descriptor: unknown) => descriptor as DeviceDriver<never, never>;
    expect(asDriver(SONY_DRIVER).wearCaption).toBeUndefined();
    expect(asDriver(NOTHING_DRIVER).wearCaption).toBeUndefined();
    expect(asDriver(SOUNDCORE_DRIVER).wearCaption).toBeUndefined();
    expect(asDriver(HEYMELODY_DRIVER).wearCaption).toBeUndefined();
    expect(asDriver(PIXELBUDS_DRIVER).wearCaption).toBeUndefined();
  });

  it('describes each Galaxy Buds earbud, and says nothing until placement is known', () => {
    expect(SAMSUNG_DRIVER.wearCaption(initialSamsungState)).toBeNull();
    expect(
      SAMSUNG_DRIVER.wearCaption({ ...initialSamsungState, placement: { left: 'wearing', right: 'case' } }),
    ).toBe('L in ear · R in case');
  });
});
