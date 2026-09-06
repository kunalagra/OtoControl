import { describe, expect, it } from 'vitest';

import { HeyMelodyDevice } from './device';
import { Cmd, replyFor } from './commands';
import { SppFrameCodec, encodeSppFrame } from './sppFrame';
import { FakeTransport } from '@/core/fakeTransport.test-helper';
import type { TransportOpener } from '@/core/transport';

/** `adoptPort` is the test entry point — `connect()` would need the picker. */
const port = {} as SerialPort;

/** A responder keyed by command id, built on the real codec so fixtures can't drift from Task 2/6. */
function heyMelodyOpener(replies: Map<number, number[]>): TransportOpener {
  return async (_port, handlers) => {
    const transport = new FakeTransport(handlers);
    const decoder = new SppFrameCodec().createDecoder();
    transport.onWrite = (bytes) => {
      const [frame] = decoder.push(bytes);
      if (!frame) return;
      const reply = replies.get(frame.cmd);
      if (reply === undefined) return;
      queueMicrotask(() => transport.receive(encodeSppFrame(replyFor(frame.cmd), frame.seq, reply)));
    };
    return transport;
  };
}

const FULL_REPLIES = new Map<number, number[]>([
  [Cmd.QueryProductId, [0x00, 0x10, 0xf0, 0x06]], // -> productId "06F010", OPPO Enco Air4s
  [Cmd.Battery, [0x01, 0x01, 0xd4]], // count=1, left, packed 0xD4 -> level 84, charging
  [Cmd.QueryAncDirect, [2, 50]], // bare currentMode DTO (no envelope): mType=2, level=50
  [Cmd.QueryEqCurrent, [0x00, 0x01]], // status=0, presetId=1
  [Cmd.QueryEqAll, [0x00, 0]], // status=0, zero presets — simplest valid payload
  [Cmd.RegisterNotify, []],
]);

describe('HeyMelodyDevice connect', () => {
  it('identifies the device via the catalog and reads battery/ANC/EQ', async () => {
    const device = new HeyMelodyDevice(heyMelodyOpener(FULL_REPLIES), { timeoutMs: 50 });
    await device.adoptPort(port);

    expect(device.state.status).toBe('connected');
    expect(device.state.info.productId).toBe('06F010');
    expect(device.state.info.catalog?.name).toBe('OPPO Enco Air4s');
    expect(device.state.info.catalog?.brand).toBe('oppo');
    // `model` is the catalog-resolved display name the sidebar/manager read
    // generically off every driver — see the note on `HeyMelodyInfo`.
    expect(device.state.info.model).toBe('OPPO Enco Air4s');
    expect(device.state.battery).toEqual([{ device: 'left', level: 84, charging: true }]);
    expect(device.state.ancLevel).toBe(50);
    expect(device.state.eqCurrentPreset).toBe(1);
    expect(device.state.capabilities).toEqual(new Set(['battery', 'anc', 'eq']));
  });

  it('does not identify the device when QueryProductId reports a non-zero status', async () => {
    // Cross-checked directly against 1812z/OppoPods's ProductIdParser.parse()
    // current source, which gates on this exact byte for this exact command —
    // a non-zero status means the productId bytes alongside it are not
    // trustworthy.
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.QueryProductId, [0x01, 0x10, 0xf0, 0x06]);
    const device = new HeyMelodyDevice(heyMelodyOpener(replies), { timeoutMs: 50 });
    await device.adoptPort(port);

    expect(device.state.info.productId).toBeNull();
    expect(device.state.info.model).toBeNull();
  });

  it('does not apply eqCurrentPreset when QueryEqCurrent reports a non-zero status', async () => {
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.QueryEqCurrent, [0x01, 0x02]);
    const device = new HeyMelodyDevice(heyMelodyOpener(replies), { timeoutMs: 50 });
    await device.adoptPort(port);

    expect(device.state.eqCurrentPreset).toBeNull();
  });

  it('tolerates every command going unanswered', async () => {
    const device = new HeyMelodyDevice(heyMelodyOpener(new Map()), { timeoutMs: 20 });
    await device.adoptPort(port);

    expect(device.state.status).toBe('connected');
    expect(device.state.info.productId).toBeNull();
    expect(device.state.info.catalog).toBeNull();
    expect(device.state.capabilities.size).toBe(0);
  });

  it('does not mark ANC as a capability when the direct-query response fails to decode', async () => {
    // Exercises the documented risk (spec §6): 0x010C's response shape is
    // unconfirmed. A payload the bare CurrentNoiseModeInfo DTO can't parse
    // (here: an mType=2 claim with the level byte missing) must not be
    // silently accepted as ANC support.
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.QueryAncDirect, [2]);
    const device = new HeyMelodyDevice(heyMelodyOpener(replies), { timeoutMs: 50 });
    await device.adoptPort(port);

    expect(device.state.capabilities.has('anc')).toBe(false);
    expect(device.state.ancLevel).toBeNull();
  });

  it('still marks eq capable off QueryEqAll alone when QueryEqCurrent goes unanswered', async () => {
    // The two EQ reads must not be coupled in one try/catch (spec §3.5) —
    // 0x0122 (QueryEqAll) is what actually supplies the Sound section's
    // preset list, so it must still be attempted, and still count, even when
    // 0x010F (QueryEqCurrent) is left unanswered.
    const replies = new Map(FULL_REPLIES);
    replies.delete(Cmd.QueryEqCurrent);
    replies.set(Cmd.QueryEqAll, [
      0, // status
      1, // one preset
      1, // isSelected
      0xfa, // minValue -6
      0x06, // maxValue 6
      1, // eqId
      3, // name length
      0x50,
      0x6f,
      0x70, // "Pop"
      0, // frequencyNum
    ]);
    const device = new HeyMelodyDevice(heyMelodyOpener(replies), { timeoutMs: 50 });
    await device.adoptPort(port);

    expect(device.state.capabilities.has('eq')).toBe(true);
    expect(device.state.eqCurrentPreset).toBeNull();
    expect(device.state.eqPresets).toHaveLength(1);
    expect(device.state.eqPresets[0]).toMatchObject({ eqId: 1, name: 'Pop', isSelected: true });
  });
});

describe('HeyMelodyDevice subscribe handshake', () => {
  it('registers exactly the ids QueryNotificationSupport reports, filtering debug channels', async () => {
    let transport!: FakeTransport;
    const replies = new Map(FULL_REPLIES);
    // status=0, ids=[0x01, 0x02, 0xf5] — 0xf5 is a debug channel (>= 0xF0) and must be filtered out.
    replies.set(Cmd.QueryNotificationSupport, [0x00, 0x03, 0x01, 0x02, 0xf5]);
    const open: TransportOpener = async (_p, handlers) => {
      transport = new FakeTransport(handlers);
      const decoder = new SppFrameCodec().createDecoder();
      transport.onWrite = (bytes) => {
        const [frame] = decoder.push(bytes);
        if (!frame) return;
        const reply = replies.get(frame.cmd);
        if (reply === undefined) return;
        queueMicrotask(() => transport.receive(encodeSppFrame(replyFor(frame.cmd), frame.seq, reply)));
      };
      return transport;
    };
    const device = new HeyMelodyDevice(open, { timeoutMs: 50 });
    await device.adoptPort(port);

    const decoder = new SppFrameCodec().createDecoder();
    const sentFrames = transport.written.flatMap((bytes) => decoder.push(bytes));
    const registerFrame = sentFrames.find((frame) => frame.cmd === Cmd.RegisterNotify);
    expect(registerFrame).toBeDefined();
    expect(Array.from(registerFrame!.payload)).toEqual([2, 0x01, 0x02]);
  });

  it('falls back to a bare RegisterNotify when QueryNotificationSupport goes unanswered', async () => {
    // QueryNotificationSupport is deliberately absent from these replies —
    // losing the handshake must not stop the driver from still trying the
    // old empty-payload subscribe as a last resort.
    let transport!: FakeTransport;
    const open: TransportOpener = async (_p, handlers) => {
      transport = new FakeTransport(handlers);
      const decoder = new SppFrameCodec().createDecoder();
      transport.onWrite = (bytes) => {
        const [frame] = decoder.push(bytes);
        if (!frame) return;
        const reply = FULL_REPLIES.get(frame.cmd);
        if (reply === undefined) return;
        queueMicrotask(() => transport.receive(encodeSppFrame(replyFor(frame.cmd), frame.seq, reply)));
      };
      return transport;
    };
    const device = new HeyMelodyDevice(open, { timeoutMs: 50 });
    await device.adoptPort(port);

    expect(device.state.status).toBe('connected');
    const decoder = new SppFrameCodec().createDecoder();
    const sentFrames = transport.written.flatMap((bytes) => decoder.push(bytes));
    const registerFrame = sentFrames.find((frame) => frame.cmd === Cmd.RegisterNotify);
    expect(registerFrame).toBeDefined();
    expect(Array.from(registerFrame!.payload)).toEqual([]);
  });
});

describe('HeyMelodyDevice live ANC updates', () => {
  it('applies an unsolicited 0x0204 notification', async () => {
    let transport!: FakeTransport;
    const open: TransportOpener = async (_p, handlers) => {
      transport = new FakeTransport(handlers);
      const decoder = new SppFrameCodec().createDecoder();
      transport.onWrite = (bytes) => {
        const [frame] = decoder.push(bytes);
        if (!frame) return;
        const reply = FULL_REPLIES.get(frame.cmd);
        if (reply === undefined) return;
        queueMicrotask(() => transport.receive(encodeSppFrame(replyFor(frame.cmd), frame.seq, reply)));
      };
      return transport;
    };
    const device = new HeyMelodyDevice(open, { timeoutMs: 50 });
    await device.adoptPort(port);
    expect(device.state.ancLevel).toBe(50);

    transport.receive(encodeSppFrame(Cmd.ActiveReport, 0x01, [3, 1, 2, 75]));
    expect(device.state.ancLevel).toBe(75);
  });
});

describe('HeyMelodyDevice writes', () => {
  it('setAncMode resolves the key via the catalog, applies optimistically, and rolls back on failure', async () => {
    // '06F010' (OPPO Enco Air4s)'s real catalog noiseReductionMode resolves
    // 'nc' to protocolIndex 0 — see ancModel.test.ts's legacy-device case.
    const replies = new Map(FULL_REPLIES);
    // SetAncMode is left unanswered, so the client's own timeout rejects it.
    const device = new HeyMelodyDevice(heyMelodyOpener(replies), { timeoutMs: 20 });
    await device.adoptPort(port);
    const before = device.state.ancModeIndex;

    await device.setAncMode('nc');

    expect(device.state.ancModeIndex).toBe(before);
    expect(device.state.error).not.toBeNull();
  });

  it('setAncMode keeps the resolved index once acknowledged', async () => {
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.SetAncMode, []);
    const device = new HeyMelodyDevice(heyMelodyOpener(replies), { timeoutMs: 50 });
    await device.adoptPort(port);

    await device.setAncMode('transparency');

    expect(device.state.ancModeIndex).toBe(2); // '06F010' resolves 'transparency' to protocolIndex 2.
    expect(device.state.error).toBeNull();
  });

  it('setAncMode is a no-op for a mode this model has no catalog entry for', async () => {
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.SetAncMode, []);
    const device = new HeyMelodyDevice(heyMelodyOpener(replies), { timeoutMs: 50 });
    await device.adoptPort(port);
    const before = device.state.ancModeIndex;

    // '06F010' has no 'adaptive' entry in its noiseReductionMode.
    await device.setAncMode('adaptive');

    expect(device.state.ancModeIndex).toBe(before);
    expect(device.state.error).toBeNull();
  });

  it('setEqPreset applies optimistically and keeps the value once acknowledged', async () => {
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.SetEqPreset, []);
    const device = new HeyMelodyDevice(heyMelodyOpener(replies), { timeoutMs: 50 });
    await device.adoptPort(port);

    await device.setEqPreset(2);

    expect(device.state.eqCurrentPreset).toBe(2);
    expect(device.state.error).toBeNull();
  });
});

describe('HeyMelodyDevice disconnect caching', () => {
  it('keeps showing the identified device after an unexpected drop', async () => {
    let transport!: FakeTransport;
    const open: TransportOpener = async (_p, handlers) => {
      transport = new FakeTransport(handlers);
      const decoder = new SppFrameCodec().createDecoder();
      transport.onWrite = (bytes) => {
        const [frame] = decoder.push(bytes);
        if (!frame) return;
        const reply = FULL_REPLIES.get(frame.cmd);
        if (reply === undefined) return;
        queueMicrotask(() => transport.receive(encodeSppFrame(replyFor(frame.cmd), frame.seq, reply)));
      };
      return transport;
    };
    const device = new HeyMelodyDevice(open, { timeoutMs: 50 });
    await device.adoptPort(port);
    expect(device.state.info.productId).toBe('06F010');

    transport.drop(new Error('The device has been lost.'));

    // Same fix as every other driver's onDrop/disconnect (see
    // src/drivers/sony/sony.ts, src/drivers/nothing/device.ts, etc.) —
    // applied here from the start rather than as a later bugfix.
    expect(device.state.status).toBe('disconnected');
    expect(device.state.info.productId).toBe('06F010');
    expect(device.state.info.catalog?.name).toBe('OPPO Enco Air4s');
    expect(device.state.info.model).toBe('OPPO Enco Air4s');
    // Live-only fields still reset.
    expect(device.state.battery).toEqual([]);
  });

  it('keeps showing the identified device after a manual disconnect', async () => {
    const device = new HeyMelodyDevice(heyMelodyOpener(FULL_REPLIES), { timeoutMs: 50 });
    await device.adoptPort(port);
    expect(device.state.info.productId).toBe('06F010');

    await device.disconnect();

    expect(device.state.status).toBe('disconnected');
    expect(device.state.info.productId).toBe('06F010');
    expect(device.state.info.model).toBe('OPPO Enco Air4s');
  });

  it('makes no claim about a device that was never identified', async () => {
    const device = new HeyMelodyDevice();
    await device.disconnect();
    expect(device.state.info.productId).toBeNull();
    expect(device.state.info.model).toBeNull();
  });
});
