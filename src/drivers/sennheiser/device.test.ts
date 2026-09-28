import { afterEach, describe, expect, it, vi } from 'vitest';

import { MomentumDevice } from './device';
import { ascii } from '@/core/fakeTransport.test-helper';
import { gaiaHarness } from './gaiaHarness.test-helper';
import type { GaiaReplies, GaiaReply } from './gaiaHarness.test-helper';
import type { Transport, TransportOpener } from '@/core/transport';
import { captureDurable, initialState } from './state';

/** `adoptPort` is the test entry point — `connect()` would need the picker. */
const port = {} as SerialPort;

describe('MomentumDevice connect', () => {
  it('reaches connected and reads the model, tolerating every other failure', async () => {
    const harness = gaiaHarness(new Map([[0x1206, ascii('M4AEBT Black')]]));
    const device = new MomentumDevice(harness.open);

    await device.adoptPort(port);

    expect(device.state.status).toBe('connected');
    expect(device.state.info.model).toBe('M4AEBT Black');
  });
});

describe('MomentumDevice connect race', () => {
  it('does not report connected when the transport drops before open resolves', async () => {
    // Mirrors a real, deterministic race: SerialTransport's read loop queues
    // its continuation before open()'s own promise resolves, so an
    // already-errored `readable` makes onClose fire first every time — not
    // merely sometimes. An opener that fires onClose before its returned
    // promise settles reproduces that ordering without needing real timing.
    let closed = false;
    const opener: TransportOpener = (_port, handlers) => {
      handlers.onClose(new Error('gone before open finished'));
      const deadTransport: Transport = {
        write: async () => {
          throw new Error('transport is closed');
        },
        close: async () => {
          closed = true;
        },
        isOpen: false,
      };
      return Promise.resolve(deadTransport);
    };

    const device = new MomentumDevice(opener);
    await device.adoptPort(port);

    // The drop landed first, so the connect that resumes afterward must not
    // clobber it with `connected` — that would tell the app a dead transport
    // is a live link.
    expect(device.state.status).toBe('disconnected');
    expect(device.state.error).toBe('gone before open finished');
    // The transport opened for the superseded connect must not be leaked.
    expect(closed).toBe(true);
  });
});

describe('MomentumDevice as a Persistable', () => {
  it('saves nothing before the device has identified itself', () => {
    // Mirrors the equivalent SonyDevice test (sony.test.ts) — pins
    // MomentumDevice's own `isUnread` hook rather than relying on
    // stateStore.test.ts's fake state shape to catch a broken predicate here.
    expect(new MomentumDevice().snapshot()).toBeNull();
  });

  it('refuses to restore over a live connection', async () => {
    // Pins MomentumDevice's own `isConnected` hook. stateStore.test.ts proves
    // the refusal policy against a fake shape; nothing there ties it to
    // `state.status === 'connected'` specifically — a typo'd predicate here
    // (e.g. checking 'connecting' instead) would leave every existing test
    // green while letting a stale cache silently overwrite a live reading.
    const harness = gaiaHarness(new Map([[0x1206, ascii('M4AEBT Black')]]));
    const device = new MomentumDevice(harness.open);
    await device.adoptPort(port);
    expect(device.state.status).toBe('connected');

    const before = device.state.info.model;
    device.restore(
      captureDurable({ ...initialState, info: { ...initialState.info, model: 'SOME-OTHER-MODEL' } }),
    );

    // A stale cache must never overwrite what the hardware just reported.
    expect(device.state.info.model).toBe(before);
  });
});

/** Answers enough of the connect sequence to populate the paired-device list. */
const withPairedDevices = (): GaiaReplies =>
  // An explicit type argument is needed here: the entries mix plain payload
  // arrays with reply functions, and without it TS infers each tuple's value
  // type independently and rejects the union against every `Map` overload.
  new Map<number, GaiaReply>([
    [0x1206, ascii('M4AEBT Black')],
    [0x1400, [0x00, 0x02]],            // list size 2 (u16 BE)
    [0x1407, [0x00]],                  // own device is index 0
    [0x1409, [0x02]],                  // two connections at once
    [
      0x1401,
      (payload) =>
        payload[0] === 0
          ? [0x00, 0x00, 0x01, ...ascii('This Mac')]   // index 0, connected
          : [0x01, 0x01, 0x01, ...ascii('iPhone')],    // index 1, connected
    ],
  ]);

describe('MomentumDevice.removePairedDevice', () => {
  // Only the two re-read tests below fake timers (to skip the real
  // DELETE_REREAD_DELAY_MS wait), but restoring here rather than inside each
  // one guarantees it happens even if a test fails midway.
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refuses a connected entry and sends nothing', async () => {
    const harness = gaiaHarness(withPairedDevices());
    const device = new MomentumDevice(harness.open);
    await device.adoptPort(port);

    await device.removePairedDevice(1);

    expect(harness.commands()).not.toContain(0x1405);
    expect(device.state.error).toBe('Disconnect the device before removing it.');
  });

  it('keeps the last known list when the re-read fails after a delete', async () => {
    // This model has a firmware bug where the list is unavailable right after a
    // removal — the vendor app names it. A delete that actually succeeded must
    // not surface as an error, and must not wipe the list it just changed.
    //
    // 0x1400 (the count) keeps answering 2 throughout: it is an upper bound,
    // not a live count, so deleting an entry does not shrink it — indices
    // develop holes instead. (The vendor app's "Encountered gap in paired
    // devices list at index" log, cited in `device.ts`, is about exactly
    // those holes; it is not evidence for the count-doesn't-shrink claim,
    // which is a separate, correct observation.) What goes away here is every
    // per-index read (0x1401): a count that still says 2 with nothing behind
    // it is exactly the guarded case in `refreshConnections` —
    // `count > 0 && devices.length === 0` — not a `getPairedDeviceCount`
    // failure, which already short-circuits earlier and would not exercise
    // that guard at all.
    //
    // This test alone does not prove the retry runs — both the first re-read
    // and its retry fail here, so the assertions below hold whether or not a
    // retry is attempted at all. The next test is the one that pins the
    // retry; this one covers a different, real behaviour: staying quiet and
    // keeping the old list when the FW bug outlasts the retry too.
    let listAvailable = true;
    const replies = withPairedDevices();
    // Entry 1 must be disconnected, or removal is refused before it starts.
    replies.set(0x1401, (payload) => {
      if (!listAvailable) return undefined;
      return payload[0] === 0
        ? [0x00, 0x00, 0x01, ...ascii('This Mac')]
        : [0x01, 0x01, 0x00, ...ascii('iPhone')];
    });
    replies.set(0x1405, () => {
      listAvailable = false;   // the delete lands, and the list goes away
      return [];
    });

    const harness = gaiaHarness(replies);
    const device = new MomentumDevice(harness.open);
    await device.adoptPort(port);
    expect(device.state.connections.devices).toHaveLength(2);

    // Fakes only setTimeout: the harness always answers requests (success or
    // NACK) on a microtask, so no client-side request timer ever fires, and
    // this only needs to skip DELETE_REREAD_DELAY_MS.
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const removal = device.removePairedDevice(1);
    await vi.runAllTimersAsync();
    await removal;

    expect(harness.commands()).toContain(0x1405);
    expect(device.state.connections.devices).toHaveLength(2);
    expect(device.state.error).toBeNull();
  });

  it('retries once and picks up the real list when the first re-read fails', async () => {
    // Pins the retry itself. Mutation testing on the previous test found that
    // deleting the retry in `device.ts` — leaving just
    // `await this.refreshConnections();` — left every existing test green:
    // that test fails both the first re-read and the retry, so it cannot tell
    // "the retry ran and failed too" from "there was no retry at all".
    //
    // Here only the *first* re-read fails; the retry, 500ms later, succeeds
    // with index 1 genuinely gone (a hole — the real shape of a successful
    // removal, per the comment above). If the retry were deleted, this would
    // stay at the pre-delete list of 2 forever, because the lone read would
    // hit the FW bug and `refreshConnections` would bail out before patching
    // anything.
    const replies = withPairedDevices();
    // Entry 1 must be disconnected, or removal is refused before it starts.
    replies.set(0x1401, (payload, call) => {
      // Calls 1-2: the initial connect — both entries present.
      // Calls 3-4: the first re-read after the delete — the FW bug, nothing
      // behind the count.
      // Calls 5-6: the retry — index 0 is still there, index 1 is gone.
      if (call <= 2) {
        return payload[0] === 0
          ? [0x00, 0x00, 0x01, ...ascii('This Mac')]
          : [0x01, 0x01, 0x00, ...ascii('iPhone')];
      }
      if (call <= 4) return undefined;
      return payload[0] === 0 ? [0x00, 0x00, 0x01, ...ascii('This Mac')] : undefined;
    });
    replies.set(0x1405, []); // delete accepted

    const harness = gaiaHarness(replies);
    const device = new MomentumDevice(harness.open);
    await device.adoptPort(port);
    expect(device.state.connections.devices).toHaveLength(2);

    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const removal = device.removePairedDevice(1);
    await vi.runAllTimersAsync();
    await removal;

    expect(device.state.connections.devices).toHaveLength(1);
    expect(device.state.connections.devices[0]?.index).toBe(0);
    expect(device.state.error).toBeNull();
  });
});

describe('MomentumDevice polling', () => {
  it('does not ask an M4 for a setting it never enables', async () => {
    // The M4 profile's feature list omits LowLatency, so togglesFor filters
    // getLowLatency (0x0818) out of the poll; TouchControls is on the list.
    const harness = gaiaHarness(new Map([[0x1206, ascii('M4AEBT Black')]]));
    const device = new MomentumDevice(harness.open);
    await device.adoptPort(port);

    expect(harness.commands()).not.toContain(0x0818);
    expect(harness.commands()).toContain(0x1607);   // touch controls, which it has
  });

  it('asks an unrecognised model for everything', async () => {
    const harness = gaiaHarness(new Map([[0x1206, ascii('SOME-NEW-MODEL')]]));
    const device = new MomentumDevice(harness.open);
    await device.adoptPort(port);

    expect(harness.commands()).toContain(0x0818);
  });
});

describe('MomentumDevice self-disconnect', () => {
  // Only the grace-window test fakes timers, but restoring here rather than
  // inside that test guarantees it happens even if the test fails midway.
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports a deliberate self-disconnect as a clean end of session', async () => {
    const replies = withPairedDevices();
    replies.set(0x1403, []);                     // disconnect accepted
    const harness = gaiaHarness(replies);
    const device = new MomentumDevice(harness.open);
    await device.adoptPort(port);

    await device.setDeviceConnected(0, false);   // index 0 is us
    harness.transport().drop(new Error('connection lost'));

    expect(device.state.status).toBe('disconnected');
    expect(device.state.error).toBeNull();
  });

  it('reports an unrelated drop as an error', async () => {
    const harness = gaiaHarness(withPairedDevices());
    const device = new MomentumDevice(harness.open);
    await device.adoptPort(port);

    harness.transport().drop(new Error('headphones powered off'));

    expect(device.state.status).toBe('disconnected');
    expect(device.state.error).toBe('headphones powered off');
  });

  it('stops treating drops as intentional once the window passes', async () => {
    const replies = withPairedDevices();
    replies.set(0x1403, []);
    const harness = gaiaHarness(replies);
    const device = new MomentumDevice(harness.open);
    await device.adoptPort(port);

    await device.setDeviceConnected(0, false);

    // Well past INTENTIONAL_DROP_GRACE_MS. A close this late is someone
    // walking out of range, not the echo of the click.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 60_000);

    harness.transport().drop(new Error('out of range'));

    expect(device.state.error).toBe('out of range');
  });
});

describe('MomentumDevice disconnect caching', () => {
  it('keeps showing the identified model after an unexpected drop', async () => {
    const harness = gaiaHarness(withPairedDevices());
    const device = new MomentumDevice(harness.open);
    await device.adoptPort(port);
    expect(device.state.info.model).toBe('M4AEBT Black');

    harness.transport().drop(new Error('The device has been lost.'));

    // The sidebar identifies the device off `info.model` — losing it here
    // is what makes a known Momentum 4 render as the generic "no device"
    // placeholder the moment it drops, instead of its own dimmed artwork.
    expect(device.state.status).toBe('disconnected');
    expect(device.state.info.model).toBe('M4AEBT Black');
    // The paired-device list is a live reading, not a setting — it must not
    // survive alongside the identity fields above.
    expect(device.state.connections.devices).toEqual([]);
  });

  it('keeps showing the identified model after a manual disconnect', async () => {
    const harness = gaiaHarness(withPairedDevices());
    const device = new MomentumDevice(harness.open);
    await device.adoptPort(port);
    expect(device.state.info.model).toBe('M4AEBT Black');

    await device.disconnect();

    expect(device.state.status).toBe('disconnected');
    expect(device.state.info.model).toBe('M4AEBT Black');
  });

  it('makes no claim about a device that was never identified', async () => {
    // `#lastKnownDurable()` is shared by `onDrop` and `disconnect()` — pinning
    // it here against a device that never read anything is enough to cover
    // both call sites without standing up a transport for each.
    const device = new MomentumDevice();
    await device.disconnect();

    expect(device.state.status).toBe('disconnected');
    expect(device.state.info.model).toBeNull();
  });
});

/**
 * The equaliser write path, spec §7.4.
 *
 * Both tests below need a *confirmed* baseline: the harness answers `getEqConfig`
 * and every `getEqBand` with a flat curve, so `#confirmedEqGains` starts as five
 * zeros rather than the empty array the UI ships with.
 *
 * `setEqBand` is the only GAIA write the app issues per pointer tick, which is
 * exactly why its rollback is the one that has to be careful about ordering.
 */
const withFlatEq = (setEqBandReplies?: GaiaReply): GaiaReplies =>
  new Map<number, GaiaReply>([
    [0x1206, ascii('M4AEBT Black')],
    [0x1000, [5, 100, 100]],                        // getEqConfig: 5 bands, ±10 dB
    [0x1002, [0]],                                  // getEqBand: one bare gain, 0.0 dB
    ...(setEqBandReplies === undefined ? [] : [[0x1001, setEqBandReplies] as const]),
  ]);

describe('MomentumDevice.setEqBand', () => {
  it('leaves the newer value alone when an earlier overlapping write fails', async () => {
    // The shape a drag used to produce, and the cause of the snap-back in
    // spec §7.1: the second call is optimistic before the first one's failure
    // comes back, and rolling back to what the *first* call saw would restore
    // the pre-drag gain over the newer one.
    const harness = gaiaHarness(withFlatEq((_payload, call) => (call === 1 ? undefined : [])));
    const device = new MomentumDevice(harness.open);
    await device.adoptPort(port);
    expect(device.state.eq.gains).toEqual([0, 0, 0, 0, 0]);

    // Issued together rather than awaited in turn, which is what "overlapping"
    // means here — the GAIA client serialises the wire, not the optimistic
    // patch, and the patch is the part the user can see.
    const first = device.setEqBand(2, 3);
    const second = device.setEqBand(2, -4);
    await Promise.all([first, second]);

    expect(device.state.eq.gains[2]).toBe(-4);
  });

  it('rolls a lone failed write back to the last gains the device confirmed', async () => {
    // Not to the value that happened to be in state when the write was issued:
    // after a successful write that value is itself optimistic, and rolling
    // back to it would leave the UI showing a gain the headphones never took.
    const harness = gaiaHarness(
      withFlatEq((_payload, call) => (call === 2 ? undefined : [])),
    );
    const device = new MomentumDevice(harness.open);
    await device.adoptPort(port);

    await device.setEqBand(2, -4);
    expect(device.state.eq.gains[2]).toBe(-4);

    await device.setEqBand(2, 6);

    expect(device.state.eq.gains[2]).toBe(-4);
  });

  it('keeps a successful write to one band when another band\'s write fails', async () => {
    // Different bands are different writes. Band 3's failure must not take the
    // gain band 2's write had already put on the headphones with it — the
    // rollback target is the last *confirmed* curve, and band 2's success is
    // part of it.
    //
    // Issued together, as a drag across two faders can be, because the client
    // serialises the wire: the first write is still in flight when the second
    // is issued, which is exactly when the first's confirmation used to be
    // thrown away.
    const harness = gaiaHarness(
      withFlatEq((_payload, call) => (call === 2 ? undefined : [])),
    );
    const device = new MomentumDevice(harness.open);
    await device.adoptPort(port);

    const first = device.setEqBand(2, 7);
    const second = device.setEqBand(3, -9);
    await Promise.all([first, second]);

    expect(device.state.eq.gains[2]).toBe(7);
    // The failed write is the only one that rolls back.
    expect(device.state.eq.gains[3]).toBe(0);
  });

  it('keeps a band that was written while another band\'s write failed', async () => {
    // The mirror of the case above, and the other half of the same problem. A
    // failed write rolls the *whole* curve back to the confirmed snapshot, and
    // that rollback lands before the sibling's confirmation — so the sibling's
    // gain is wiped from state even though the headphones took it.
    const harness = gaiaHarness(
      withFlatEq((_payload, call) => (call === 1 ? undefined : [])),
    );
    const device = new MomentumDevice(harness.open);
    await device.adoptPort(port);

    const first = device.setEqBand(2, 5);
    const second = device.setEqBand(3, 7);
    await Promise.all([first, second]);

    expect(device.state.eq.gains[3]).toBe(7);
  });

  it('never folds a rejected band into the curve a later failure rolls back to', async () => {
    // The confirmed curve is what every future rollback restores, so it has to
    // hold gains the device *took* and nothing else. Building it from the curve
    // that was in state when a write started sweeps in its neighbours'
    // optimistic values — including a neighbour the device has just rejected.
    const harness = gaiaHarness(
      withFlatEq((_payload, call) => (call === 1 || call === 3 ? undefined : [])),
    );
    const device = new MomentumDevice(harness.open);
    await device.adoptPort(port);

    const rejected = device.setEqBand(2, 5);
    const accepted = device.setEqBand(3, 7);
    await Promise.all([rejected, accepted]);

    // A third write that fails restores the confirmed curve. Band 2's 5 dB was
    // refused, so it must not come back with it.
    await device.setEqBand(4, 1);

    expect(device.state.eq.gains).toEqual([0, 0, 0, 7, 0]);
  });

  it('keeps an earlier write to the same band when the newer one fails', async () => {
    // The headphones took the first write and refused the second, so they sit
    // at the first gain. A success that is no longer the newest word on its band
    // still happened, and the rollback has to land on it — not on the gain from
    // before both.
    const harness = gaiaHarness(withFlatEq((_payload, call) => (call === 2 ? undefined : [])));
    const device = new MomentumDevice(harness.open);
    await device.adoptPort(port);

    const first = device.setEqBand(2, 3);
    const second = device.setEqBand(2, -4);
    await Promise.all([first, second]);

    expect(device.state.eq.gains[2]).toBe(3);
  });
});

/** Every `setEqBand` the device was sent, as `[band, raw gain byte]`. */
const bandWrites = (harness: ReturnType<typeof gaiaHarness>): Array<[number, number]> =>
  harness
    .sent()
    .filter((frame) => frame.command === 0x1001)
    .map((frame) => [frame.payload[0], frame.payload[1]]);

describe('MomentumDevice.setEqGains', () => {
  it('does not overwrite a band the user moved while the preset was being written', async () => {
    const harness = gaiaHarness(withFlatEq([]));
    const device = new MomentumDevice(harness.open);
    await device.adoptPort(port);

    const preset = device.setEqGains([1, 1, 1, 1, 1]);
    const moved = device.setEqBand(4, -5);
    await Promise.all([preset, moved]);

    expect(device.state.eq.gains[4]).toBe(-5);
    // The user's write is the last word on band 4 at the headphones too.
    const band4 = bandWrites(harness).filter(([band]) => band === 4);
    expect(band4).toHaveLength(1);
  });

  it('confirms a preset even when a band write landed during it', async () => {
    // Calls: preset band 0 (1), the user's band 4 (2), preset bands 1–3 (3–5),
    // then a failing write to band 0 (6). That failure must restore the
    // preset's gain, which the headphones took, not the curve from before it.
    const harness = gaiaHarness(withFlatEq((_payload, call) => (call === 6 ? undefined : [])));
    const device = new MomentumDevice(harness.open);
    await device.adoptPort(port);

    await Promise.all([device.setEqGains([1, 1, 1, 1, 1]), device.setEqBand(4, -5)]);
    await device.setEqBand(0, 9);

    expect(device.state.eq.gains).toEqual([1, 1, 1, 1, -5]);
  });

  it('rolls back the bands a failed preset never wrote, and only those', async () => {
    // Calls: preset band 0 (1), the user's band 4 (2), preset band 1 (3),
    // preset band 2 fails (4). Bands 0–1 took the preset, band 4 took the
    // user's gain, bands 2–3 never changed on the headphones.
    const harness = gaiaHarness(withFlatEq((_payload, call) => (call === 4 ? undefined : [])));
    const device = new MomentumDevice(harness.open);
    await device.adoptPort(port);

    await Promise.all([device.setEqGains([1, 1, 1, 1, 1]), device.setEqBand(4, -5)]);

    expect(device.state.eq.gains).toEqual([1, 1, 0, 0, -5]);
  });
});
