import { describe, expect, it, vi } from 'vitest';

import { HeyMelodyDevice } from './device';
import { Cmd, replyFor } from './protocol/cmd';
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
  [Cmd.Battery, [0x00, 0x01, 0x01, 0xd4]], // status=0, count=1, left, packed 0xD4 -> level 84, charging
  [Cmd.QueryAncDirect, [0x00, 1, 2, 50]], // status=0, action=1 (currentMode), type=2, level=50
  [Cmd.QueryColourId, [0x00, 0x02]], // status=0, colorId=2 (BLACK)
  [Cmd.QueryEqCurrent, [0x00, 0x01]], // status=0, presetId=1
  [Cmd.QueryEqAll, [0x00, 0]], // status=0, zero presets — simplest valid payload
  [Cmd.RegisterNotify, []],
]);

describe('HeyMelodyDevice connect', () => {
  it('identifies the device via the catalog and reads battery/ANC/EQ', async () => {
    const device = new HeyMelodyDevice(heyMelodyOpener(FULL_REPLIES), { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);

    expect(device.state.status).toBe('connected');
    expect(device.state.info.productId).toBe('06F010');
    expect(device.state.info.catalog?.name).toBe('OPPO Enco Air4s');
    expect(device.state.info.catalog?.brand).toBe('oppo');
    // `model` is the catalog-resolved display name the sidebar/manager read
    // generically off every driver — see the note on `HeyMelodyInfo`.
    expect(device.state.info.model).toBe('OPPO Enco Air4s');
    expect(device.state.info.colourId).toBe(2);
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
    const device = new HeyMelodyDevice(heyMelodyOpener(replies), { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);

    expect(device.state.info.productId).toBeNull();
    expect(device.state.info.model).toBeNull();
  });

  it('does not apply eqCurrentPreset when QueryEqCurrent reports a non-zero status', async () => {
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.QueryEqCurrent, [0x01, 0x02]);
    const device = new HeyMelodyDevice(heyMelodyOpener(replies), { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);

    expect(device.state.eqCurrentPreset).toBeNull();
  });

  it('flags and releases a port that answers neither identity query', async () => {
    let transport!: FakeTransport;
    const open: TransportOpener = async (p, handlers) => {
      transport = (await heyMelodyOpener(new Map())(p, handlers)) as FakeTransport;
      return transport;
    };
    const device = new HeyMelodyDevice(open, { timeoutMs: 20, probeTimeoutMs: 20 });
    await device.adoptPort(port);

    // A generic SPP port (phone, laptop, another brand's second service) must not stay held.
    expect(device.state.status).toBe('disconnected');
    expect(transport.isOpen).toBe(false);
    expect(device.state.error).toBe('This does not look like a HeyMelody or realme device.');
    expect(sentCommands(transport)).not.toContain(Cmd.Battery);
    expect(device.state.info.productId).toBeNull();
    expect(device.state.info.catalog).toBeNull();
    expect(device.state.info.colourId).toBeNull();
    expect(device.state.capabilities.size).toBe(0);
  });

  it('does not mark ANC as a capability when the direct-query response fails to decode', async () => {
    // A truncated body (a level claim with the level byte missing) must not
    // be silently accepted as ANC support.
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.QueryAncDirect, [0x00, 1, 2]);
    const device = new HeyMelodyDevice(heyMelodyOpener(replies), { timeoutMs: 50, probeTimeoutMs: 50 });
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
    const device = new HeyMelodyDevice(heyMelodyOpener(replies), { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);

    expect(device.state.capabilities.has('eq')).toBe(true);
    expect(device.state.eqCurrentPreset).toBeNull();
    expect(device.state.eqPresets).toHaveLength(1);
    expect(device.state.eqPresets[0]).toMatchObject({ eqId: 1, name: 'Pop', isSelected: true });
  });
});

describe('HeyMelodyDevice status-prefixed replies', () => {
  it('reads battery and the current ANC mode from a realme Buds Air6 Pro', async () => {
    // Regression for a beta tester's realme Buds Air6 Pro (2026-09-27): no
    // Battery card, and Noise said "did not answer the noise control query"
    // until a later push arrived. Both replies lead with a status byte
    // (realme Link's PollCommandManager.W()/a0()); read without it, battery
    // decoded as zero cells and ANC as {modeIndex: null, level: null} — both
    // probes "succeeded" with nothing to show.
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.QueryProductId, [0x00, 0x12, 0x30, 0x06]); // -> "063012", realme Buds Air6 Pro
    replies.set(Cmd.Battery, [0x00, 0x03, 0x01, 0x54, 0x02, 0x55, 0x03, 0xe0]);
    replies.set(Cmd.QueryAncDirect, [0x00, 1, 1, 0b0000_1000]); // action=1, type=1 (bitmask), mode 3
    const device = new HeyMelodyDevice(heyMelodyOpener(replies), { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);

    expect(device.state.info.catalog?.name).toBe('realme Buds Air6 Pro');
    expect(device.state.battery).toEqual([
      { device: 'left', level: 84, charging: false },
      { device: 'right', level: 85, charging: false },
      { device: 'case', level: 96, charging: true },
    ]);
    expect(device.state.ancModeIndex).toBe(3);
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
    const device = new HeyMelodyDevice(open, { timeoutMs: 50, probeTimeoutMs: 50 });
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
    const device = new HeyMelodyDevice(open, { timeoutMs: 50, probeTimeoutMs: 50 });
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
    const device = new HeyMelodyDevice(open, { timeoutMs: 50, probeTimeoutMs: 50 });
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
    const device = new HeyMelodyDevice(heyMelodyOpener(replies), { timeoutMs: 20, probeTimeoutMs: 20 });
    await device.adoptPort(port);
    const before = device.state.ancModeIndex;

    await device.setAncMode('nc');

    expect(device.state.ancModeIndex).toBe(before);
    expect(device.state.error).not.toBeNull();
  });

  it('setAncMode keeps the resolved index once acknowledged', async () => {
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.SetAncMode, []);
    const device = new HeyMelodyDevice(heyMelodyOpener(replies), { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);

    await device.setAncMode('transparency');

    expect(device.state.ancModeIndex).toBe(2); // '06F010' resolves 'transparency' to protocolIndex 2.
    expect(device.state.error).toBeNull();
  });

  it('setAncMode is a no-op for a mode this model has no catalog entry for', async () => {
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.SetAncMode, []);
    const device = new HeyMelodyDevice(heyMelodyOpener(replies), { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    const before = device.state.ancModeIndex;

    // '06F010' has no 'adaptive' entry in its noiseReductionMode.
    await device.setAncMode('adaptive');

    expect(device.state.ancModeIndex).toBe(before);
    expect(device.state.error).toBeNull();
  });

  it('setEqPreset applies optimistically and keeps the value once acknowledged', async () => {
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.SetEqPreset, [0x00]);
    const device = new HeyMelodyDevice(heyMelodyOpener(replies), { timeoutMs: 50, probeTimeoutMs: 50 });
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
    const device = new HeyMelodyDevice(open, { timeoutMs: 50, probeTimeoutMs: 50 });
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
    const device = new HeyMelodyDevice(heyMelodyOpener(FULL_REPLIES), { timeoutMs: 50, probeTimeoutMs: 50 });
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

/** status=0, then bits 1 (battery), 5 (find), 8 (anc), 10 (eq), 34 (eqAll/eqCustom). */
const BITMAP_REPLY = [0x00, 0x22, 0x05, 0x00, 0x00, 0x04];

/** Every command id the device was sent, decoded from the fake transport's writes. */
function sentCommands(transport: FakeTransport): number[] {
  const decoder = new SppFrameCodec().createDecoder();
  return transport.written.flatMap((bytes) => decoder.push(bytes)).map((frame) => frame.cmd);
}

describe('HeyMelodyDevice capability-driven connect', () => {
  it('identifies a device that ignores QueryProductId until the HeyTap handshake has run', async () => {
    // HeyTap sends 0x0100, then vendor id 0x0102, before 0x0103 (`commands/i.smali` 0x8100 case).
    const seen = new Set<number>();
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.QueryCapability, BITMAP_REPLY);
    replies.set(Cmd.SendVendorId, [0x00]);
    const open: TransportOpener = async (p, handlers) => {
      const transport = (await heyMelodyOpener(replies)(p, handlers)) as FakeTransport;
      const respond = transport.onWrite!;
      const decoder = new SppFrameCodec().createDecoder();
      transport.onWrite = (bytes) => {
        const [frame] = decoder.push(bytes);
        if (!frame) return;
        if (frame.cmd === Cmd.QueryProductId && !(seen.has(Cmd.QueryCapability) && seen.has(Cmd.SendVendorId))) return;
        seen.add(frame.cmd);
        respond(bytes);
      };
      return transport;
    };
    const device = new HeyMelodyDevice(open, { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    expect(device.state.info.productId).toBe('06F010');
    expect(device.state.info.model).toBe('OPPO Enco Air4s');
  });

  it('sends HeyTap\'s vendor id, 0x079A little-endian, before QueryProductId', async () => {
    let transport!: FakeTransport;
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.QueryCapability, BITMAP_REPLY);
    const open: TransportOpener = async (p, handlers) => {
      transport = (await heyMelodyOpener(replies)(p, handlers)) as FakeTransport;
      return transport;
    };
    const device = new HeyMelodyDevice(open, { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    const decoder = new SppFrameCodec().createDecoder();
    const frames = transport.written.flatMap((bytes) => decoder.push(bytes));
    const at = (cmd: number) => frames.findIndex((frame) => frame.cmd === cmd);
    expect(at(Cmd.QueryCapability)).toBeLessThan(at(Cmd.SendVendorId));
    expect(at(Cmd.SendVendorId)).toBeLessThan(at(Cmd.QueryProductId));
    expect(Array.from(frames[at(Cmd.SendVendorId)].payload)).toEqual([0x9a, 0x07]);
  });

  it('polls only what the bitmap reports and passes find/eqCustom through', async () => {
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.QueryCapability, BITMAP_REPLY);
    const device = new HeyMelodyDevice(heyMelodyOpener(replies), { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    expect(device.state.capabilities).toEqual(new Set(['battery', 'find', 'anc', 'eq', 'eqCustom']));
  });

  it('never sends a command the bitmap does not report', async () => {
    let transport!: FakeTransport;
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.QueryCapability, [0x00, 0x02]); // battery only
    const open: TransportOpener = async (p, handlers) => {
      transport = (await heyMelodyOpener(replies)(p, handlers)) as FakeTransport;
      return transport;
    };
    const device = new HeyMelodyDevice(open, { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    const cmds = sentCommands(transport);
    expect(cmds).not.toContain(Cmd.QueryAncDirect);
    expect(cmds).not.toContain(Cmd.QueryEqAll);
    expect(device.state.capabilities).toEqual(new Set(['battery']));
  });

  it('drops a reported feature whose query fails', async () => {
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.QueryCapability, BITMAP_REPLY);
    replies.set(Cmd.Battery, [0x01]); // non-zero status
    const device = new HeyMelodyDevice(heyMelodyOpener(replies), { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    expect(device.state.capabilities.has('battery')).toBe(false);
  });

  it('falls back to probing when the device ignores 0x0100', async () => {
    const device = new HeyMelodyDevice(heyMelodyOpener(FULL_REPLIES), { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    expect(device.state.capabilities).toEqual(new Set(['battery', 'anc', 'eq']));
    expect(device.state.error).toBeNull();
  });

  it('asks for all EQ presets with an empty payload, as both vendor apps do', async () => {
    let transport!: FakeTransport;
    const open: TransportOpener = async (p, handlers) => {
      transport = (await heyMelodyOpener(FULL_REPLIES)(p, handlers)) as FakeTransport;
      return transport;
    };
    const device = new HeyMelodyDevice(open, { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    const decoder = new SppFrameCodec().createDecoder();
    const eqAll = transport.written.flatMap((bytes) => decoder.push(bytes)).find((frame) => frame.cmd === Cmd.QueryEqAll);
    expect(Array.from(eqAll!.payload)).toEqual([]);
  });
});

describe('HeyMelodyDevice firmware version', () => {
  it('reads 0x0105 when the bitmap reports it', async () => {
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.QueryCapability, [0x00, 0x01]); // bit 0: version
    replies.set(Cmd.QueryVersion, [0x00, 0x01, ...[...'1,0,2.1'].map((c) => c.charCodeAt(0))]);
    const device = new HeyMelodyDevice(heyMelodyOpener(replies), { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    expect(device.state.info.version).toEqual([{ device: 'left', type: 0, version: '2.1' }]);
    // Battery is always allowed (HeyTap's bootstrap set), so it is read even without bit 1.
    expect(device.state.capabilities).toEqual(new Set(['version', 'battery']));
  });
});

describe('HeyMelodyDevice identity diagnostics', () => {
  it('records the raw productId reply when it does not decode', async () => {
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.QueryProductId, [0x01, 0x50, 0xa8, 0x06]);
    replies.set(Cmd.QueryCapability, BITMAP_REPLY);
    const device = new HeyMelodyDevice(heyMelodyOpener(replies), { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    expect(device.state.info.productId).toBeNull();
    expect(device.state.diagnostics.productId).toBe('status 1 · 01 50 a8 06');
  });

  it('records an unanswered productId query', async () => {
    const replies = new Map(FULL_REPLIES);
    replies.delete(Cmd.QueryProductId);
    replies.set(Cmd.QueryCapability, BITMAP_REPLY);
    const device = new HeyMelodyDevice(heyMelodyOpener(replies), { timeoutMs: 50, probeTimeoutMs: 50, productIdRetryTimeoutMs: 50 });
    await device.adoptPort(port);
    expect(device.state.diagnostics.productId).toBe('no reply');
  });

  it('records the raw version reply when a version string is blank', async () => {
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.QueryCapability, [0x00, 0x01]);
    replies.set(Cmd.QueryVersion, [0x00, 0x01, ...[...'1,0,'].map((c) => c.charCodeAt(0))]);
    const device = new HeyMelodyDevice(heyMelodyOpener(replies), { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    expect(device.state.diagnostics.version).toBe('00 01 31 2c 30 2c');
  });

  it('records nothing when identity reads cleanly', async () => {
    const device = new HeyMelodyDevice(heyMelodyOpener(FULL_REPLIES), { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    expect(device.state.diagnostics).toEqual({});
  });
});

describe('HeyMelodyDevice slow productId', () => {
  /** FULL_REPLIES with a bitmap, where `answer(n)` decides how the n-th 0x0103 is answered. */
  function slowOpener(answer: (n: number) => 'drop' | 'late' | 'now'): TransportOpener {
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.QueryCapability, BITMAP_REPLY);
    return async (p, handlers) => {
      const transport = (await heyMelodyOpener(replies)(p, handlers)) as FakeTransport;
      const respond = transport.onWrite!;
      const decoder = new SppFrameCodec().createDecoder();
      let asked = 0;
      transport.onWrite = (bytes) => {
        const [frame] = decoder.push(bytes);
        if (frame?.cmd !== Cmd.QueryProductId) return respond(bytes);
        const mode = answer(++asked);
        const reply = () => transport.receive(encodeSppFrame(replyFor(frame.cmd), frame.seq, [0x00, 0x50, 0xa8, 0x06]));
        if (mode === 'now') queueMicrotask(reply);
        else if (mode === 'late') setTimeout(reply, 80);
      };
      return transport;
    };
  }

  it('takes a productId reply that arrives after the request timed out', async () => {
    const device = new HeyMelodyDevice(slowOpener(() => 'late'), { timeoutMs: 50, probeTimeoutMs: 50, productIdRetryTimeoutMs: 50 });
    await device.adoptPort(port);
    await vi.waitFor(() => expect(device.state.info.productId).toBe('06A850'));
    expect(device.state.info.model).toBe('OPPO Enco Buds3 Pro');
    expect(device.state.diagnostics.productId).toBeUndefined();
  });

  it('asks again once the rest of connect is done when the first query went unanswered', async () => {
    const device = new HeyMelodyDevice(slowOpener((n) => (n === 1 ? 'drop' : 'now')), { timeoutMs: 50, probeTimeoutMs: 50, productIdRetryTimeoutMs: 50 });
    await device.adoptPort(port);
    expect(device.state.info.productId).toBe('06A850');
    expect(device.state.diagnostics.productId).toBeUndefined();
  });

  it('records no reply when neither query is answered', async () => {
    const device = new HeyMelodyDevice(slowOpener(() => 'drop'), { timeoutMs: 50, probeTimeoutMs: 50, productIdRetryTimeoutMs: 50 });
    await device.adoptPort(port);
    expect(device.state.info.productId).toBeNull();
    expect(device.state.diagnostics.productId).toBe('no reply');
  });
});

describe('HeyMelodyDevice protocol log', () => {
  it('records the raw connect conversation, including the productId query', async () => {
    const device = new HeyMelodyDevice(heyMelodyOpener(FULL_REPLIES), { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    const decoder = new SppFrameCodec().createDecoder();
    const sent = device.protocolLog.filter((entry) => entry.direction === 'tx').flatMap((entry) => decoder.push(entry.bytes));
    expect(sent.map((frame) => frame.cmd)).toContain(Cmd.QueryProductId);
    expect(device.protocolLog.some((entry) => entry.direction === 'rx')).toBe(true);
  });

  it('sends a query command and returns its reply', async () => {
    const replies = new Map(FULL_REPLIES);
    replies.set(0x0104, [0x00, 0x31]);
    const device = new HeyMelodyDevice(heyMelodyOpener(replies), { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    await expect(device.sendQuery(0x0104, [0x30])).resolves.toEqual(Uint8Array.from([0x00, 0x31]));
  });

  it('refuses anything outside the 0x01xx/0x02xx query range', async () => {
    const device = new HeyMelodyDevice(heyMelodyOpener(FULL_REPLIES), { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    await expect(device.sendQuery(0x0401, [])).rejects.toThrow(/query/);
  });
});

describe('HeyMelodyDevice live pushes', () => {
  it('replaces battery and wear from 0x0204 events 1 and 2', async () => {
    let transport!: FakeTransport;
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.QueryCapability, [0x00, 0x12]); // bits 1 battery, 4 wear
    replies.set(Cmd.QueryWear, [0x00, 0x01, 0x01, 0x03]);
    const open: TransportOpener = async (p, handlers) => {
      transport = (await heyMelodyOpener(replies)(p, handlers)) as FakeTransport;
      return transport;
    };
    const device = new HeyMelodyDevice(open, { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    expect(device.state.wear).toEqual([{ device: 'left', inEar: true, inBox: false }]);
    expect(device.state.capabilities).toEqual(new Set(['battery', 'wear']));

    transport.receive(encodeSppFrame(Cmd.ActiveReport, 0x09, [0x01, 0x01, 0x01, 0x32]));
    expect(device.state.battery).toEqual([{ device: 'left', level: 50, charging: false }]);
    transport.receive(encodeSppFrame(Cmd.ActiveReport, 0x0a, [0x02, 0x01, 0x01, 0x00]));
    expect(device.state.wear).toEqual([{ device: 'left', inEar: false, inBox: true }]);
  });

  it('ignores an unreadable push without disturbing state', async () => {
    let transport!: FakeTransport;
    const open: TransportOpener = async (p, handlers) => {
      transport = (await heyMelodyOpener(FULL_REPLIES)(p, handlers)) as FakeTransport;
      return transport;
    };
    const device = new HeyMelodyDevice(open, { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    const before = device.state.battery;
    transport.receive(encodeSppFrame(Cmd.ActiveReport, 0x0b, [0x02, 0x00]));
    expect(device.state.battery).toEqual(before);
    expect(device.state.wear).toEqual([]);
  });
});

describe('HeyMelodyDevice find my earbuds', () => {
  it('sends 0x0400 [1] then [0] and tracks finding', async () => {
    let transport!: FakeTransport;
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.FindEarbuds, [0x00]);
    const open: TransportOpener = async (p, handlers) => {
      transport = (await heyMelodyOpener(replies)(p, handlers)) as FakeTransport;
      return transport;
    };
    const device = new HeyMelodyDevice(open, { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    await device.setFinding(true);
    expect(device.state.finding).toBe(true);
    await device.setFinding(false);
    expect(device.state.finding).toBe(false);
    const decoder = new SppFrameCodec().createDecoder();
    const finds = transport.written.flatMap((bytes) => decoder.push(bytes)).filter((frame) => frame.cmd === Cmd.FindEarbuds);
    expect(finds.map((frame) => Array.from(frame.payload))).toEqual([[0x01], [0x00]]);
  });

  it('rolls back when the device refuses', async () => {
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.FindEarbuds, [0x01]);
    const device = new HeyMelodyDevice(heyMelodyOpener(replies), { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    await device.setFinding(true);
    expect(device.state.finding).toBe(false);
    expect(device.state.error).not.toBeNull();
  });

  it('stops showing ringing after a drop', async () => {
    let transport!: FakeTransport;
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.FindEarbuds, [0x00]);
    const open: TransportOpener = async (p, handlers) => {
      transport = (await heyMelodyOpener(replies)(p, handlers)) as FakeTransport;
      return transport;
    };
    const device = new HeyMelodyDevice(open, { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    await device.setFinding(true);
    transport.drop(new Error('gone'));
    expect(device.state.finding).toBe(false);
  });
});

/** status, 1 preset: selected, -6..6, eqId 9, name "C1", 2 flat bands (100 Hz, 4300 Hz). */
const CUSTOM_EQ = [0, 1, 1, 0xfa, 0x06, 9, 2, 0x43, 0x31, 2, 100, 0, 0, 0xcc, 0x10, 0];

/** Like heyMelodyOpener, but `script` can answer the nth request for a command differently (undefined = no reply). */
function scriptedOpener(
  replies: Map<number, number[]>,
  script: Map<number, (number[] | undefined)[]>,
  onTransport?: (transport: FakeTransport) => void,
): TransportOpener {
  const calls = new Map<number, number>();
  return async (_port, handlers) => {
    const transport = new FakeTransport(handlers);
    onTransport?.(transport);
    const decoder = new SppFrameCodec().createDecoder();
    transport.onWrite = (bytes) => {
      const [frame] = decoder.push(bytes);
      if (!frame) return;
      const n = calls.get(frame.cmd) ?? 0;
      calls.set(frame.cmd, n + 1);
      const reply = script.has(frame.cmd) ? script.get(frame.cmd)![n] : replies.get(frame.cmd);
      if (reply === undefined) return;
      queueMicrotask(() => transport.receive(encodeSppFrame(replyFor(frame.cmd), frame.seq, reply)));
    };
    return transport;
  };
}

describe('HeyMelodyDevice custom EQ', () => {
  const replies = new Map(FULL_REPLIES);
  replies.set(Cmd.QueryCapability, [0x00, 0x00, 0x04, 0x00, 0x00, 0x04]); // bits 10, 34
  replies.set(Cmd.QueryEqAll, CUSTOM_EQ);
  const gains = (device: HeyMelodyDevice) => device.state.eqPresets[0].bands.map((band) => band.dbValue);

  it('writes a curve and keeps it once acknowledged', async () => {
    const device = new HeyMelodyDevice(scriptedOpener(replies, new Map([[Cmd.SetEqCurve, [[0x00, 9]]]])), {
      timeoutMs: 50,
      probeTimeoutMs: 50,
    });
    await device.adoptPort(port);
    expect(device.state.capabilities.has('eqCustom')).toBe(true);
    await device.setEqCurve(9, [3, -2]);
    expect(gains(device)).toEqual([3, -2]);
    expect(device.state.error).toBeNull();
  });

  it('clamps gains to the preset range', async () => {
    const device = new HeyMelodyDevice(scriptedOpener(replies, new Map([[Cmd.SetEqCurve, [[0x00, 9]]]])), {
      timeoutMs: 50,
      probeTimeoutMs: 50,
    });
    await device.adoptPort(port);
    await device.setEqCurve(9, [20, -20]);
    expect(gains(device)).toEqual([6, -6]);
  });

  it('rolls back a failed curve write to the last confirmed curve', async () => {
    // First write acknowledged, second left unanswered (times out).
    const device = new HeyMelodyDevice(scriptedOpener(replies, new Map([[Cmd.SetEqCurve, [[0x00, 9], undefined]]])), {
      timeoutMs: 20,
      probeTimeoutMs: 20,
    });
    await device.adoptPort(port);
    await device.setEqCurve(9, [3, -2]);
    await device.setEqCurve(9, [5, 5]);
    expect(gains(device)).toEqual([3, -2]);
    expect(device.state.error).not.toBeNull();
  });

  it('follows 0x0504 and 0x0506 pushes', async () => {
    let transport!: FakeTransport;
    const device = new HeyMelodyDevice(scriptedOpener(replies, new Map(), (t) => (transport = t)), {
      timeoutMs: 50,
      probeTimeoutMs: 50,
    });
    await device.adoptPort(port);
    transport.receive(encodeSppFrame(Cmd.PushEqCurrent, 0x01, [9]));
    expect(device.state.eqCurrentPreset).toBe(9);
    transport.receive(encodeSppFrame(Cmd.PushEqCurves, 0x02, CUSTOM_EQ.slice(1).map((b, i) => (i === 11 ? 4 : b))));
    expect(gains(device)).toEqual([4, 0]);
  });

  const decodeWrites = (transport: FakeTransport, cmd: number) => {
    const decoder = new SppFrameCodec().createDecoder();
    return transport.written.flatMap((bytes) => decoder.push(bytes)).filter((frame) => frame.cmd === cmd).map((frame) => Array.from(frame.payload));
  };

  it('selects a custom preset with 0x0418 action 2, never 0x0406', async () => {
    let transport!: FakeTransport;
    const device = new HeyMelodyDevice(scriptedOpener(
        replies,
        new Map([
          [Cmd.SetEqCurve, [[0x00, 9]]],
          [Cmd.QueryEqCurrent, [[0x00, 1], [0x00, 9]]], // the buds report the new selection on the re-read
        ]),
        (t) => (transport = t),
      ),
      { timeoutMs: 50, probeTimeoutMs: 50 },
    );
    await device.adoptPort(port);
    await device.setEqPreset(9);
    expect(decodeWrites(transport, Cmd.SetEqPreset)).toEqual([]);
    expect(decodeWrites(transport, Cmd.SetEqCurve)[0][0]).toBe(0x02);
    expect(device.state.eqCurrentPreset).toBe(9);
  });

  it('selects a built-in preset with 0x0406', async () => {
    let transport!: FakeTransport;
    const device = new HeyMelodyDevice(scriptedOpener(replies, new Map([[Cmd.SetEqPreset, [[0x00]]]]), (t) => (transport = t)), { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    await device.setEqPreset(1);
    expect(decodeWrites(transport, Cmd.SetEqPreset)).toEqual([[1]]);
    expect(device.state.eqPresets.every((preset) => !preset.isSelected)).toBe(true);
  });

  it('creates a custom preset copying an existing one, then re-reads the current id and the list', async () => {
    let transport!: FakeTransport;
    const created = [...CUSTOM_EQ.slice(0, 1), 2, ...CUSTOM_EQ.slice(2), ...CUSTOM_EQ.slice(2).map((b, i) => (i === 3 ? 10 : b))];
    const device = new HeyMelodyDevice(
      scriptedOpener(replies, new Map([[Cmd.SetEqCurve, [[0x00, 10]]], [Cmd.QueryEqAll, [CUSTOM_EQ, created]]]), (t) => (transport = t)),
      { timeoutMs: 50, probeTimeoutMs: 50 },
    );
    await device.adoptPort(port);
    await device.createCustomPreset();
    const [add] = decodeWrites(transport, Cmd.SetEqCurve);
    expect(add[0]).toBe(0x01);
    expect(add[3]).toBe(0x00);
    expect(decodeWrites(transport, Cmd.QueryEqAll)).toHaveLength(2);
    expect(decodeWrites(transport, Cmd.QueryEqCurrent)).toHaveLength(2);
    expect(device.state.eqPresets.map((preset) => preset.eqId)).toEqual([9, 10]);
  });

  it('names a created preset after the lowest free slot number', async () => {
    let transport!: FakeTransport;
    const device = new HeyMelodyDevice(scriptedOpener(replies, new Map([[Cmd.SetEqCurve, [[0x00, 10]]]]), (t) => (transport = t)), { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    await device.createCustomPreset();
    const [add] = decodeWrites(transport, Cmd.SetEqCurve);
    const name = new TextDecoder().decode(Uint8Array.from(add.slice(5, 5 + add[4])));
    expect(name).toBe('Custom 1');
  });

  it('does not create beyond the model cap', async () => {
    let transport!: FakeTransport;
    const three = [0x00, 3, ...[9, 10, 11].flatMap((id) => [...CUSTOM_EQ.slice(2).map((b, i) => (i === 3 ? id : b))])];
    const full = new Map(replies);
    full.set(Cmd.QueryEqAll, three);
    const device = new HeyMelodyDevice(scriptedOpener(full, new Map(), (t) => (transport = t)), { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    expect(device.state.eqPresets).toHaveLength(3);
    await device.createCustomPreset();
    expect(decodeWrites(transport, Cmd.SetEqCurve)).toEqual([]);
  });

  it('deletes with the whole preset, then re-reads', async () => {
    let transport!: FakeTransport;
    const device = new HeyMelodyDevice(
      scriptedOpener(replies, new Map([[Cmd.SetEqCurve, [[0x00, 9]]], [Cmd.QueryEqAll, [CUSTOM_EQ, [0x00, 0]]]]), (t) => (transport = t)),
      { timeoutMs: 50, probeTimeoutMs: 50 },
    );
    await device.adoptPort(port);
    await device.deleteCustomPreset(9);
    const [del] = decodeWrites(transport, Cmd.SetEqCurve);
    expect(del[0]).toBe(0x03);
    expect(del[3]).toBe(9);
    expect(device.state.eqPresets).toEqual([]);
  });

  it('rolls a failed custom select back to the previous selection', async () => {
    // Select ack never arrives: the optimistic current id and isSelected flags return.
    const device = new HeyMelodyDevice(scriptedOpener(replies, new Map([[Cmd.SetEqCurve, [undefined]]])), { timeoutMs: 20, probeTimeoutMs: 20 });
    await device.adoptPort(port);
    const before = { current: device.state.eqCurrentPreset, flags: device.state.eqPresets.map((preset) => preset.isSelected) };
    await device.setEqPreset(9);
    expect(device.state.eqCurrentPreset).toBe(before.current);
    expect(device.state.eqPresets.map((preset) => preset.isSelected)).toEqual(before.flags);
    expect(device.state.error).not.toBeNull();
  });

  it('retries the preset list with 01 05 when the empty request is refused', async () => {
    let transport!: FakeTransport;
    const device = new HeyMelodyDevice(scriptedOpener(replies, new Map([[Cmd.QueryEqAll, [[0x01], CUSTOM_EQ]]]), (t) => (transport = t)), { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    expect(decodeWrites(transport, Cmd.QueryEqAll)).toEqual([[], [0x01, 0x05]]);
    expect(device.state.eqPresets).toHaveLength(1);
  });
});

describe('HeyMelodyDevice drop during connect', () => {
  it('keeps the drop reason instead of claiming the device is not HeyMelody', async () => {
    const open: TransportOpener = async (_p, handlers) => {
      const transport = new FakeTransport(handlers);
      const decoder = new SppFrameCodec().createDecoder();
      transport.onWrite = (bytes) => {
        const [frame] = decoder.push(bytes);
        // Buds go back in the case mid-handshake: the link drops on the identity query.
        if (frame?.cmd === Cmd.QueryProductId) queueMicrotask(() => transport.drop(new Error('The device has been lost.')));
      };
      return transport;
    };
    const device = new HeyMelodyDevice(open, { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    expect(device.state.status).toBe('disconnected');
    expect(device.state.error).not.toBe('This does not look like a HeyMelody or realme device.');
  });
});

describe('HeyMelodyDevice feature switches', () => {
  const FEATURE_REPLIES = (): Map<number, number[]> => {
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.QueryCapability, [0x00, 0x22, 0x05, 0x00, 0x00, 0x44]); // BITMAP_REPLY plus bit 38 (BassWave level)
    replies.set(Cmd.QueryFeatures, [0x00, 2, 0x04, 0x01, 0x28, 0x00]);
    replies.set(Cmd.QueryAlertVolume, [0x00, 0x08]);
    replies.set(Cmd.QueryBassLevel, [0x00, 0xfb, 0x05, 0x02]);
    return replies;
  };

  async function connect(replies: Map<number, number[]>) {
    let transport!: FakeTransport;
    const open: TransportOpener = async (p, handlers) => {
      transport = (await heyMelodyOpener(replies)(p, handlers)) as FakeTransport;
      return transport;
    };
    const device = new HeyMelodyDevice(open, { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    const sent = (cmd: number) => {
      const decoder = new SppFrameCodec().createDecoder();
      return transport.written.flatMap((bytes) => decoder.push(bytes)).filter((frame) => frame.cmd === cmd).map((frame) => Array.from(frame.payload));
    };
    return { device, sent };
  }

  it('reads the switches, alert volume and BassWave level on connect', async () => {
    const { device } = await connect(FEATURE_REPLIES());
    expect(device.state.features).toEqual(new Map([[4, true], [40, false]]));
    expect(device.state.alertVolume).toBe(8);
    expect(device.state.bassLevel).toEqual({ min: -5, max: 5, level: 2 });
  });

  it('setFeature sends 0x0403 and keeps the value on ack', async () => {
    const replies = FEATURE_REPLIES();
    replies.set(Cmd.SetFeature, [0x00]);
    const { device, sent } = await connect(replies);
    await device.setFeature(40, true);
    expect(sent(Cmd.SetFeature)).toEqual([[40, 1]]);
    expect(device.state.features.get(40)).toBe(true);
  });

  it('rolls setFeature back and reports an error when the device does not answer', async () => {
    const { device } = await connect(FEATURE_REPLIES());
    await device.setFeature(40, true);
    expect(device.state.features.get(40)).toBe(false);
    expect(device.state.error).not.toBeNull();
  });

  it('setAlertVolume sends 0x0427 and keeps the level on ack', async () => {
    const replies = FEATURE_REPLIES();
    replies.set(Cmd.SetAlertVolume, [0x00, 3]);
    const { device, sent } = await connect(replies);
    await device.setAlertVolume(3);
    expect(sent(Cmd.SetAlertVolume)).toEqual([[3]]);
    expect(device.state.alertVolume).toBe(3);
  });

  it('clamps the alert volume to its range', async () => {
    const replies = FEATURE_REPLIES();
    replies.set(Cmd.SetAlertVolume, [0x00]);
    const { device, sent } = await connect(replies);
    await device.setAlertVolume(99);
    expect(sent(Cmd.SetAlertVolume)).toEqual([[10]]);
  });

  it('setBassLevel writes the range back with the new level', async () => {
    const replies = FEATURE_REPLIES();
    replies.set(Cmd.SetBassLevel, [0x00]);
    const { device, sent } = await connect(replies);
    await device.setBassLevel(-1);
    expect(sent(Cmd.SetBassLevel)).toEqual([[0xfb, 0x05, 0xff]]);
    expect(device.state.bassLevel?.level).toBe(-1);
  });

  it('still connects, with no switches, when the device ignores 0x010D', async () => {
    const { device } = await connect(new Map(FULL_REPLIES));
    expect(device.state.status).toBe('connected');
    expect(device.state.features.size).toBe(0);
    expect(device.state.error).toBeNull();
  });
});

describe('HeyMelodyDevice touch controls', () => {
  const TABLE = [0x00, 2, 1, 1, 2, 1, 2, 1, 2, 6];
  const GESTURE_REPLIES = (): Map<number, number[]> => {
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.QueryCapability, [0x00, 0x22 | 0x08, 0x05, 0x00, 0x00, 0x04]);
    replies.set(Cmd.QueryGestures, TABLE);
    return replies;
  };

  async function connect(replies: Map<number, number[]>, scripted?: Map<number, number[][]>) {
    let transport!: FakeTransport;
    const open: TransportOpener = async (_p, handlers) => {
      transport = new FakeTransport(handlers);
      const decoder = new SppFrameCodec().createDecoder();
      transport.onWrite = (bytes) => {
        const [frame] = decoder.push(bytes);
        if (!frame) return;
        const reply = scripted?.get(frame.cmd)?.shift() ?? replies.get(frame.cmd);
        if (reply === undefined) return;
        queueMicrotask(() => transport.receive(encodeSppFrame(replyFor(frame.cmd), frame.seq, reply)));
      };
      return transport;
    };
    const device = new HeyMelodyDevice(open, { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    const sent = (cmd: number) => {
      const decoder = new SppFrameCodec().createDecoder();
      return transport.written.flatMap((bytes) => decoder.push(bytes)).filter((frame) => frame.cmd === cmd).map((frame) => Array.from(frame.payload));
    };
    return { device, sent };
  }

  it('reads the table on connect and reports the capability', async () => {
    const { device } = await connect(GESTURE_REPLIES());
    expect(device.state.gestures).toEqual([
      { deviceType: 1, button: 1, action: 2, fn: 1 },
      { deviceType: 2, button: 1, action: 2, fn: 6 },
    ]);
    expect(device.state.capabilities.has('gestures')).toBe(true);
  });

  it('retries the read with 02 03 01 when the empty request is refused', async () => {
    const { device, sent } = await connect(GESTURE_REPLIES(), new Map([[Cmd.QueryGestures, [[0x01], TABLE]]]));
    expect(sent(Cmd.QueryGestures)).toEqual([[], [0x02, 0x03, 0x01]]);
    expect(device.state.gestures).toHaveLength(2);
  });

  it('setGesture writes one record, re-reads, and never sends 0x0402', async () => {
    const replies = GESTURE_REPLIES();
    replies.set(Cmd.SetGestures, [0x00]);
    const { device, sent } = await connect(replies);
    await device.setGesture(device.state.gestures[0], 5);
    expect(sent(Cmd.SetGestures)).toEqual([[1, 1, 1, 2, 5]]);
    expect(sent(Cmd.QueryGestures)).toHaveLength(2);
    expect(sent(0x0402)).toEqual([]);
  });

  it('rolls setGesture back when the write is refused', async () => {
    const replies = GESTURE_REPLIES();
    replies.set(Cmd.SetGestures, [0x01]);
    const { device } = await connect(replies);
    await device.setGesture(device.state.gestures[0], 5);
    expect(device.state.gestures[0].fn).toBe(1);
    expect(device.state.error).not.toBeNull();
  });
});

describe('HeyMelodyDevice connected devices', () => {
  // Bitmap bit 29 (0x0112) is byte 3, bit 5.
  const ENTRY = [1, 2, 3, 4, 5, 6, 0x08, 0x02, 0x01, 5, ...Array.from('Phone', (c) => c.charCodeAt(0))];
  const withOne = (): number[] => [1, ...ENTRY];
  const REPLIES = (): Map<number, number[]> => {
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.QueryCapability, [0x00, 0x00, 0x00, 0x00, 0x20]);
    replies.set(Cmd.QueryDevices, [0x00, ...withOne()]);
    return replies;
  };
  let transport!: FakeTransport;
  const connect = async (replies: Map<number, number[]>) => {
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
    const device = new HeyMelodyDevice(open, { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    return device;
  };

  it('reads the peer list on connect and reports the capability', async () => {
    const device = await connect(REPLIES());
    expect(device.state.peers).toEqual([
      { mac: '06:05:04:03:02:01', name: 'Phone', connected: true, isThisDevice: true, audioActive: false },
    ]);
    expect(device.state.capabilities.has('multiDevice')).toBe(true);
  });

  it('replaces peers on a 0x0204 push with event 6', async () => {
    const replies = REPLIES();
    replies.set(Cmd.QueryDevices, [0x00, 0]);
    const device = await connect(replies);
    expect(device.state.peers).toEqual([]);
    transport.receive(encodeSppFrame(Cmd.ActiveReport, 0x20, [0x06, ...withOne()]));
    expect(device.state.peers.map((p) => p.name)).toEqual(['Phone']);
  });
});

describe('HeyMelodyDevice switching to another pair without a disconnect', () => {
  it('drops the previous pair’s live-only readings before polling the new one', async () => {
    const first = new Map(FULL_REPLIES);
    first.set(Cmd.QueryCapability, [0x00, 0x22 | 0x08, 0x05, 0x00, 0x20, 0x44]); // gestures, multiDevice, BassWave level
    first.set(Cmd.QueryGestures, [0x00, 1, 1, 1, 2, 1]);
    first.set(Cmd.QueryFeatures, [0x00, 1, 0x28, 0x01]);
    first.set(Cmd.QueryAlertVolume, [0x00, 0x08]);
    first.set(Cmd.QueryBassLevel, [0x00, 0xfb, 0x05, 0x02]);
    first.set(Cmd.QueryDevices, [0x00, 1, 0x66, 0x55, 0x44, 0x33, 0x22, 0x11, 0x07, 0x02, 0x01, 0x04, ...new TextEncoder().encode('Desk')]);
    const pairs = [first, FULL_REPLIES];
    let opened = 0;
    const open: TransportOpener = (target, handlers) => heyMelodyOpener(pairs[opened++])(target, handlers);
    const device = new HeyMelodyDevice(open, { timeoutMs: 50, probeTimeoutMs: 50 });

    await device.adoptPort(port);
    expect(device.state.gestures).toHaveLength(1);
    expect(device.state.peers).toHaveLength(1);

    await device.adoptPort(port);
    expect(device.state.status).toBe('connected');
    expect(device.state.gestures).toEqual([]);
    expect(device.state.features.size).toBe(0);
    expect(device.state.alertVolume).toBeNull();
    expect(device.state.bassLevel).toBeNull();
    expect(device.state.peers).toEqual([]);
  });
});
