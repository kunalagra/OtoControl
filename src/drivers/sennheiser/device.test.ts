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
