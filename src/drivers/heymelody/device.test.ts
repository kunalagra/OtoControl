import { describe, expect, it } from 'vitest';

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
    replies.set(Cmd.SetEqPreset, []);
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
