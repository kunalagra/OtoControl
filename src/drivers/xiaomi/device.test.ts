import { describe, expect, it, vi } from 'vitest';

import { challengeResponse } from './auth';
import { XiaomiDevice } from './device';
import { FrameType, createDeframer, encodeFrame } from './frame';
import type { XiaomiFrame } from './frame';
import { FakeTransport } from '@/core/fakeTransport.test-helper';
import type { TransportOpener } from '@/core/transport';

/** `adoptPort` is the test entry point — `connect()` would need the picker. */
const port = {} as SerialPort;

const CHALLENGE = Array.from({ length: 16 }, (_, i) => i);

type Replies = Map<number, number[] | ((frame: XiaomiFrame) => { payload: number[]; status?: number })>;

interface Harness {
  opener: TransportOpener;
  transport: () => FakeTransport;
  /** Frames this app sent as requests. */
  requests: XiaomiFrame[];
  /** Frames this app sent as answers to the earbuds. */
  answers: XiaomiFrame[];
  /** Earbud-initiated frame, delivered as though sent. */
  earbudsSend: (opcode: number, payload: number[], type?: number, seq?: number) => void;
}

/**
 * Plays the earbuds: answers each request from `replies` (none for an opcode
 * means silence), and — when `handshake` is set — sends its own challenge and
 * confirm after receiving the phone's confirm, as real earbuds do.
 */
function harness(replies: Replies, handshake = true): Harness {
  let current: FakeTransport | undefined;
  const requests: XiaomiFrame[] = [];
  const answers: XiaomiFrame[] = [];
  const earbudsSend = (opcode: number, payload: number[], type: number = FrameType.EarbudsRequest, seq = 1) =>
    queueMicrotask(() => current?.receive(encodeFrame({ type, opcode, seq, status: 0, payload: Uint8Array.from(payload) })));

  const opener: TransportOpener = async (_port, handlers) => {
    const transport = new FakeTransport(handlers);
    current = transport;
    const deframer = createDeframer();
    transport.onWrite = (bytes) => {
      for (const frame of deframer.push(bytes)) {
        if (frame.type === FrameType.Response) {
          answers.push(frame);
          continue;
        }
        requests.push(frame);
        const reply = replies.get(frame.opcode);
        if (reply !== undefined) {
          const { payload, status = 0 } = typeof reply === 'function' ? reply(frame) : { payload: reply };
          queueMicrotask(() =>
            transport.receive(
              encodeFrame({ type: FrameType.Response, opcode: frame.opcode, seq: frame.seq, status, payload: Uint8Array.from(payload) }),
            ),
          );
        }
        if (handshake && frame.opcode === 0x51) {
          earbudsSend(0x50, [1, ...CHALLENGE], FrameType.EarbudsRequest, 0x10);
          earbudsSend(0x51, [1, 0], FrameType.EarbudsRequest, 0x11);
        }
      }
    };
    return transport;
  };
  return { opener, transport: () => current!, requests, answers, earbudsSend };
}

const OPTIONS = { timeoutMs: 50, probeTimeoutMs: 50, settleMs: 0, confirmWaitMs: 30, random: () => Uint8Array.from(CHALLENGE) };

/** Wire bytes of a captured custom-EQ read-back (REDMI Buds 8 Pro): ten flat bands, ±6 dB. */
const FLAT_CURVE = [0x27, 0, 0x37, 1, 0x0a, 6, 6, 0, 0, 10, ...[62, 125, 250, 500, 1000, 2000, 4000, 8000, 12000, 16000].flatMap((f) => [f >> 8, f & 0xff, 0])];

/** A Redmi Buds 5 Pro (PID 0x506C): 85% left (charging), 90% right, 70% case; ANC on, in-ear on. */
const FULL: Replies = new Map<number, number[]>([
  [0x50, [1, ...new Array<number>(16).fill(0)]],
  [0x51, [1]],
  [
    0x02,
    [
      5, 3, 0x27, 0x17, 0x50, 0x6c, // VID/PID -> Redmi Buds 5 Pro
      5, 1, 0x12, 0x34, 0x56, 0x78, // firmware
      4, 7, 0xd5, 90, 70, // battery
      2, 13, 2, // colour: black
    ],
  ],
  [0x09, [2, 9, 1, 2, 10, 0]],
  [0xf3, [0]],
]);

/** Config reads answer per id, as the earbuds do; a config it lacks gets an empty value, not an error. */
const withConfigs = (replies: Replies, configs: Record<number, number[]>): Replies =>
  new Map(replies).set(0xf3, (frame) => ({ payload: configs[frame.payload[1]] ?? [] }));

const TABLE = [4, 8, 8, 1, 1, 1, 2, 2, 3, 3, 6, 6]; // single none, double play/pause, triple prev/next, long noise control
const CONFIGS = withConfigs(FULL, {
  0x0b: [4, 0, 0x0b, 1, 2],
  0x07: [3, 0, 7, 5],
  0x02: [TABLE.length + 2, 0, 2, ...TABLE],
  0x0a: [4, 0, 0x0a, 6, 6],
  0x37: FLAT_CURVE,
});

describe('XiaomiDevice connect', () => {
  it('runs the handshake, identifies the model and reads state', async () => {
    const h = harness(CONFIGS);
    const device = new XiaomiDevice(h.opener, OPTIONS);
    await device.adoptPort(port);

    expect(device.state.status).toBe('connected');
    expect(device.state.handshake).toBe('complete');
    expect(device.state.info).toMatchObject({ model: 'Redmi Buds 5 Pro', vid: 0x2717, pid: 0x506c, firmware: ['1.2.3.4', '5.6.7.8'], colour: 2 });
    expect(device.state.battery).toEqual([
      { device: 'left', level: 85, charging: true },
      { device: 'right', level: 90, charging: false },
      { device: 'case', level: 70, charging: false },
    ]);
    expect(device.state.ancMode).toBe(1);
    expect(device.state.wearDetection).toBe(true);
    expect(device.state.ncStrength).toBe(2);
    expect(device.state.eqPreset).toBe(5);
    expect(device.state.gestures).toHaveLength(4);
    expect(device.state.longPressCycle).toEqual([6, 6]);
    expect(device.state.customEq?.bands).toHaveLength(10);
    expect(device.state.capabilities).toEqual(
      new Set(['find', 'version', 'battery', 'anc', 'wear', 'strength', 'eq', 'gestures', 'customEq']),
    );
  });

  it('sends our challenge, then our confirm, and answers the earbuds with the SAFER+ response', async () => {
    const h = harness(CONFIGS);
    await new XiaomiDevice(h.opener, OPTIONS).adoptPort(port);

    expect(h.requests.slice(0, 2).map((r) => [r.opcode, Array.from(r.payload)])).toEqual([
      [0x50, [1, ...CHALLENGE]],
      [0x51, [1, 0]],
    ]);
    const challengeAnswer = h.answers.find((frame) => frame.opcode === 0x50)!;
    expect(challengeAnswer.seq).toBe(0x10);
    expect(Array.from(challengeAnswer.payload)).toEqual([1, ...challengeResponse(Uint8Array.from(CHALLENGE))]);
    const confirmAnswer = h.answers.find((frame) => frame.opcode === 0x51)!;
    expect(confirmAnswer.seq).toBe(0x11);
    expect(Array.from(confirmAnswer.payload)).toEqual([1]);
  });

  it('asks for info and run info with the all-attributes mask, then reads only the configs the catalog lists', async () => {
    const h = harness(CONFIGS);
    await new XiaomiDevice(h.opener, OPTIONS).adoptPort(port);
    const byOpcode = (opcode: number) => h.requests.filter((r) => r.opcode === opcode).map((r) => Array.from(r.payload));
    expect(byOpcode(0x02)).toEqual([[0xff, 0xff, 0xff, 0xff]]);
    expect(byOpcode(0x09)).toEqual([[0xff, 0xff, 0xff, 0xff]]);
    expect(byOpcode(0xf3)).toEqual([[0, 0x0b], [0, 0x07], [0, 0x02], [0, 0x0a], [0, 0x37]]);
  });

  it('does not read configs a catalog model lacks', async () => {
    // Redmi Buds 4 (PID 0x5034) lists neither an EQ nor a long-press cycle.
    const replies = new Map(CONFIGS).set(0x02, [5, 3, 0x27, 0x17, 0x50, 0x34, 4, 7, 50, 60, 70]);
    const h = harness(replies);
    const device = new XiaomiDevice(h.opener, OPTIONS);
    await device.adoptPort(port);
    const ids = h.requests.filter((r) => r.opcode === 0xf3).map((r) => r.payload[1]);
    expect(ids).not.toContain(0x07);
    expect(ids).not.toContain(0x37);
    expect(device.state.capabilities.has('eq')).toBe(false);
    expect(device.state.capabilities.has('customEq')).toBe(false);
  });

  it('still reads a model that skips the handshake, and does not stall waiting for a confirm', async () => {
    const replies = new Map(CONFIGS);
    replies.delete(0x50);
    replies.delete(0x51);
    const device = new XiaomiDevice(harness(replies, false).opener, { ...OPTIONS, confirmWaitMs: 5000 });
    const started = Date.now();
    await device.adoptPort(port);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(device.state.status).toBe('connected');
    expect(device.state.handshake).toBe('skipped');
    expect(device.state.info.model).toBe('Redmi Buds 5 Pro');
  });

  it('treats a refused challenge like a skipped handshake', async () => {
    const replies = new Map(CONFIGS).set(0x50, () => ({ payload: [], status: 1 }));
    const device = new XiaomiDevice(harness(replies, false).opener, OPTIONS);
    await device.adoptPort(port);
    expect(device.state.status).toBe('connected');
    expect(device.state.handshake).toBe('skipped');
  });

  it('calls the handshake partial when the earbuds answer ours but send no confirm', async () => {
    const device = new XiaomiDevice(harness(CONFIGS, false).opener, OPTIONS);
    await device.adoptPort(port);
    expect(device.state.handshake).toBe('partial');
    expect(device.state.status).toBe('connected');
  });

  it('is complete when only the earbuds start the handshake', async () => {
    const replies = new Map(CONFIGS);
    replies.delete(0x50);
    replies.delete(0x51);
    const h = harness(replies, false);
    const device = new XiaomiDevice(h.opener, OPTIONS);
    const connected = device.adoptPort(port);
    await vi.waitFor(() => expect(h.requests.length).toBeGreaterThan(0));
    h.earbudsSend(0x51, [1, 0]);
    await connected;
    expect(device.state.handshake).toBe('complete');
  });

  it('releases a port that never answers GetInfo and says why', async () => {
    const device = new XiaomiDevice(harness(new Map(), false).opener, OPTIONS);
    await device.adoptPort(port);
    expect(device.state.status).toBe('disconnected');
    expect(device.state.error).toBe('This does not look like Xiaomi or Redmi earbuds.');
  });

  it('retries GetInfo once', async () => {
    let calls = 0;
    const replies = new Map(CONFIGS).set(0x02, () => {
      calls += 1;
      return calls === 1 ? { payload: [], status: 1 } : { payload: FULL.get(0x02) as number[] };
    });
    const device = new XiaomiDevice(harness(replies).opener, OPTIONS);
    await device.adoptPort(port);
    expect(calls).toBe(2);
    expect(device.state.info.model).toBe('Redmi Buds 5 Pro');
  });

  it('offers strength when it connects with noise control off, and reads it once a push carries it', async () => {
    // With ANC off a strength read answers [mode 0, level 0] (capture chan28.txt): no strength value yet.
    const h = harness(withConfigs(FULL, { 0x0b: [4, 0, 0x0b, 0, 0], 0x07: [3, 0, 7, 5] }));
    const device = new XiaomiDevice(h.opener, OPTIONS);
    await device.adoptPort(port);
    expect(device.state.capabilities.has('strength')).toBe(true);
    expect(device.state.ncStrength).toBeNull();

    h.earbudsSend(0xf4, [4, 0, 0x0b, 1, 2], FrameType.EarbudsNotify);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(device.state.ncStrength).toBe(2);
    expect(device.state.capabilities.has('strength')).toBe(true);
  });

  it('keeps strength hidden on a model whose strength read comes back empty', async () => {
    const h = harness(withConfigs(FULL, { 0x07: [3, 0, 7, 5] }));
    const device = new XiaomiDevice(h.opener, OPTIONS);
    await device.adoptPort(port);
    expect(device.state.capabilities.has('strength')).toBe(false);
  });

  it('names an unlisted model from its Bluetooth name, probes it fully, and hides noise control on an Active', async () => {
    const name = Array.from(new TextEncoder().encode('Redmi Buds 9 Active'));
    const replies = new Map(CONFIGS).set(0x02, [name.length + 1, 0, ...name, 5, 3, 0x27, 0x17, 0x60, 0x00, 4, 7, 50, 60, 255]);
    const h = harness(replies);
    const device = new XiaomiDevice(h.opener, OPTIONS);
    await device.adoptPort(port);
    expect(device.state.info.model).toBe('Redmi Buds 9 Active');
    expect(device.state.capabilities.has('anc')).toBe(false);
    expect(device.state.capabilities.has('strength')).toBe(false);
    expect(device.state.capabilities.has('eq')).toBe(true);
    // An unlisted model has the custom curve and gestures probed rather than assumed.
    expect(device.state.capabilities.has('customEq')).toBe(true);
    expect(device.state.capabilities.has('gestures')).toBe(true);
    expect(device.state.capabilities.has('find')).toBe(true);
  });

  it('offers noise control only where the catalog lists it, whatever the earbuds report', async () => {
    // Redmi Buds 6 Active (PID 0x5088): find and gestures, no noise control.
    const replies = new Map(CONFIGS).set(0x02, [5, 3, 0x27, 0x17, 0x50, 0x88, 4, 7, 50, 60, 255]);
    const device = new XiaomiDevice(harness(replies).opener, OPTIONS);
    await device.adoptPort(port);
    expect(device.state.info.model).toBe('Redmi Buds 6 Active');
    expect(device.state.capabilities.has('anc')).toBe(false);
    expect(device.state.capabilities.has('find')).toBe(true);
    expect(device.state.capabilities.has('gestures')).toBe(true);
  });

  it('offers find only where the catalog lists it', async () => {
    // Xiaomi Buds 3 (PID 0x5026) has no find-device function.
    const replies = new Map(CONFIGS).set(0x02, [5, 3, 0x27, 0x17, 0x50, 0x26, 4, 7, 50, 60, 70]);
    const device = new XiaomiDevice(harness(replies).opener, OPTIONS);
    await device.adoptPort(port);
    expect(device.state.capabilities.has('find')).toBe(false);
  });

  it('treats an empty config reply as "not on this model", not as an answer', async () => {
    const device = new XiaomiDevice(harness(withConfigs(FULL, {})).opener, OPTIONS);
    await device.adoptPort(port);
    expect(device.state.status).toBe('connected');
    expect(device.state.capabilities).toEqual(new Set(['find', 'version', 'battery', 'anc', 'wear']));
  });

  it('leaves out controls whose reads are refused', async () => {
    const replies = new Map(FULL).set(0x09, () => ({ payload: [], status: 1 })).set(0xf3, () => ({ payload: [], status: 1 }));
    const device = new XiaomiDevice(harness(replies).opener, OPTIONS);
    await device.adoptPort(port);
    expect(device.state.status).toBe('connected');
    expect(device.state.capabilities).toEqual(new Set(['find', 'version', 'battery']));
  });
});

describe('XiaomiDevice pushes', () => {
  async function connected() {
    const h = harness(CONFIGS);
    const device = new XiaomiDevice(h.opener, OPTIONS);
    await device.adoptPort(port);
    h.answers.length = 0;
    return { h, device };
  }

  it('applies a status push and acknowledges it', async () => {
    const { h, device } = await connected();
    h.earbudsSend(0x0e, [4, 0, 30, 40, 50, 2, 4, 2], FrameType.EarbudsRequest, 0xff);
    await vi.waitFor(() => expect(device.state.ancMode).toBe(2));
    expect(device.state.battery.map((cell) => cell.level)).toEqual([30, 40, 50]);
    expect(h.answers).toEqual([{ type: 0x04, opcode: 0x0e, seq: 0xff, status: 0, payload: new Uint8Array() }]);
  });

  it('applies a config notification and acknowledges it', async () => {
    const { h, device } = await connected();
    h.earbudsSend(0xf4, [4, 0, 0x0b, 2, 1], FrameType.EarbudsNotify, 5);
    await vi.waitFor(() => expect(device.state.ancMode).toBe(2));
    expect(device.state.transparencyStrength).toBe(1);
    expect(h.answers.map((frame) => [frame.opcode, frame.seq])).toEqual([[0xf4, 5]]);
  });

  it('follows the earbuds’ own gesture and EQ changes', async () => {
    const { h, device } = await connected();
    h.earbudsSend(0xf4, [5, 0, 2, 1, 5, 5], FrameType.EarbudsNotify, 6);
    h.earbudsSend(0xf4, [3, 0, 7, 6], FrameType.EarbudsNotify, 7);
    await vi.waitFor(() => expect(device.state.eqPreset).toBe(6));
    expect(device.state.gestures.find((record) => record.tap === 1)).toEqual({ tap: 1, left: 5, right: 5 });
    expect(device.state.gestures).toHaveLength(4);
  });

  it('acknowledges a push it does not model', async () => {
    const { h } = await connected();
    h.earbudsSend(0xf4, [3, 0, 0x0c, 3], FrameType.EarbudsNotify, 6);
    await vi.waitFor(() => expect(h.answers).toHaveLength(1));
  });

  it('survives garbage payloads in pushes', async () => {
    const { h, device } = await connected();
    h.earbudsSend(0x0e, [200, 1], FrameType.EarbudsRequest, 1);
    h.earbudsSend(0xf4, [9], FrameType.EarbudsNotify, 2);
    await vi.waitFor(() => expect(h.answers).toHaveLength(2));
    expect(device.state.status).toBe('connected');
  });
});

describe('XiaomiDevice settings', () => {
  async function connected(replies: Replies = CONFIGS) {
    const h = harness(replies);
    const device = new XiaomiDevice(h.opener, OPTIONS);
    await device.adoptPort(port);
    h.requests.length = 0;
    return { h, device };
  }
  const sentPayloads = (h: Harness, opcode: number) => h.requests.filter((r) => r.opcode === opcode).map((r) => Array.from(r.payload));

  it('sets the ANC mode with 08 02 04 mode', async () => {
    const { h, device } = await connected(new Map(CONFIGS).set(0x08, []));
    await device.setAncMode(2);
    expect(sentPayloads(h, 0x08)).toEqual([[2, 4, 2]]);
    expect(device.state.ancMode).toBe(2);
  });

  it('rolls the mode back and reports the reason when the earbuds refuse', async () => {
    const { device } = await connected(new Map(CONFIGS).set(0x08, () => ({ payload: [], status: 3 })));
    await device.setAncMode(0);
    expect(device.state.ancMode).toBe(1);
    expect(device.state.error).toContain('status 3');
  });

  it('rolls back when the earbuds do not answer', async () => {
    const { device } = await connected(CONFIGS);
    await device.setAncMode(0);
    expect(device.state.ancMode).toBe(1);
    expect(device.state.error).toContain('not answered');
  });

  it('sets each strength under its own target', async () => {
    const { h, device } = await connected(new Map(CONFIGS).set(0xf2, []));
    await device.setStrength(1, 0);
    await device.setStrength(2, 2);
    expect(sentPayloads(h, 0xf2)).toEqual([[4, 0, 0x0b, 1, 0], [4, 0, 0x0b, 2, 2]]);
    expect(device.state.ncStrength).toBe(0);
    expect(device.state.transparencyStrength).toBe(2);
  });

  it('sets the EQ preset as config 7', async () => {
    const { h, device } = await connected(new Map(CONFIGS).set(0xf2, []));
    await device.setEqPreset(6);
    expect(sentPayloads(h, 0xf2)).toEqual([[3, 0, 7, 6]]);
    expect(device.state.eqPreset).toBe(6);
  });

  it('sets in-ear detection inverted', async () => {
    const { h, device } = await connected(new Map(CONFIGS).set(0x08, []));
    await device.setWearDetection(false);
    expect(sentPayloads(h, 0x08)).toEqual([[2, 6, 1]]);
    expect(device.state.wearDetection).toBe(false);
  });

  it('stops, then rings, and stops again', async () => {
    const { h, device } = await connected(new Map(CONFIGS).set(0xf2, []));
    await device.setFinding(true);
    expect(device.state.finding).toBe(true);
    await device.setFinding(false);
    expect(device.state.finding).toBe(false);
    expect(sentPayloads(h, 0xf2)).toEqual([[4, 0, 9, 0, 3], [4, 0, 9, 1, 3], [4, 0, 9, 0, 3]]);
  });

  it('rings one earbud when asked', async () => {
    const { h, device } = await connected(new Map(CONFIGS).set(0xf2, []));
    await device.setFinding(true, 1);
    expect(sentPayloads(h, 0xf2)[1]).toEqual([4, 0, 9, 1, 1]);
  });

  describe('gestures', () => {
    it('writes one side with the other as it was read, then re-reads the table', async () => {
      const { h, device } = await connected(new Map(CONFIGS).set(0xf2, []));
      await device.setGesture(1, 'right', 4);
      expect(sentPayloads(h, 0xf2)).toEqual([[5, 0, 2, 1, 1, 4]]);
      expect(sentPayloads(h, 0xf3)).toEqual([[0, 0x02]]);
      // The re-read returns the earbuds' own table, which is what the state then shows.
      expect(device.state.gestures.find((record) => record.tap === 1)).toEqual({ tap: 1, left: 1, right: 1 });
    });

    it('shows what it wrote when the re-read agrees', async () => {
      const kept = [4, 8, 8, 1, 1, 4, 2, 2, 3, 3, 6, 6];
      const replies = withConfigs(new Map(CONFIGS).set(0xf2, []), { 0x02: [kept.length + 2, 0, 2, ...kept], 0x0b: [4, 0, 0x0b, 1, 2], 0x07: [3, 0, 7, 5] });
      const { device } = await connected(replies);
      await device.setGesture(1, 'right', 4);
      expect(device.state.gestures.find((record) => record.tap === 1)).toEqual({ tap: 1, left: 1, right: 4 });
    });

    it('rolls back and reports the reason when the earbuds refuse', async () => {
      const { device } = await connected(new Map(CONFIGS).set(0xf2, () => ({ payload: [], status: 2 })));
      await device.setGesture(3, 'left', 0);
      expect(device.state.gestures.find((record) => record.tap === 3)).toEqual({ tap: 3, left: 6, right: 6 });
      expect(device.state.error).toContain('status 2');
    });

    it('ignores a tap the earbuds never listed', async () => {
      const { h, device } = await connected(new Map(CONFIGS).set(0xf2, []));
      await device.setGesture(5, 'left', 11);
      expect(sentPayloads(h, 0xf2)).toEqual([]);
    });

    it('writes the long-press cycle for one side, keeping the other', async () => {
      const { h, device } = await connected(new Map(CONFIGS).set(0xf2, []));
      await device.setLongPressCycle('left', 7);
      expect(sentPayloads(h, 0xf2)).toEqual([[4, 0, 0x0a, 7, 6]]);
      expect(device.state.longPressCycle).toEqual([7, 6]);
    });
  });

  describe('custom EQ', () => {
    /** Earbuds that keep what they are sent: a curve write changes what the next read returns. */
    function keeping() {
      let curve = FLAT_CURVE;
      const replies = withConfigs(new Map(CONFIGS), {});
      return new Map(replies)
        .set(0xf2, (frame: XiaomiFrame) => {
          if (frame.payload[2] === 0x37) {
            const bands = frame.payload.subarray(7);
            curve = [...FLAT_CURVE.slice(0, 10)];
            for (let i = 0; i < bands.length; i += 3) curve.push(bands[i], bands[i + 1], bands[i + 2]);
          }
          return { payload: [] };
        })
        .set(0xf3, (frame: XiaomiFrame) => {
          const id = frame.payload[1];
          if (id === 0x37) return { payload: curve };
          if (id === 0x0b) return { payload: [4, 0, 0x0b, 1, 2] };
          if (id === 0x07) return { payload: [3, 0, 7, 5] };
          return { payload: [] };
        });
    }

    it('selects the custom preset first, writes the curve in the Gadgetbridge form and reads it back', async () => {
      const { h, device } = await connected(keeping());
      await device.setCustomEq([0, 1, 2, 3, 4, 5, 6, -1, -2, -6]);
      const writes = sentPayloads(h, 0xf2);
      expect(writes[0]).toEqual([3, 0, 7, 0x0a]);
      expect(writes[1].slice(0, 7)).toEqual([0x24, 0x00, 0x37, 0x05, 0x01, 0x01, 0x0a]);
      expect(writes[1].slice(7, 13)).toEqual([0, 62, 0, 0, 125, 1]);
      expect(writes[1].slice(-3)).toEqual([0x3e, 0x80, 0x86]);
      expect(device.state.eqPreset).toBe(0x0a);
      expect(device.state.customEq?.bands.map((band) => band.gain)).toEqual([0, 1, 2, 3, 4, 5, 6, -1, -2, -6]);
      expect(device.state.error).toBeNull();
    });

    it('does not reselect the preset when the custom curve is already playing', async () => {
      const replies = new Map(keeping()).set(0xf3, (frame: XiaomiFrame) =>
        frame.payload[1] === 0x07 ? { payload: [3, 0, 7, 0x0a] } : frame.payload[1] === 0x37 ? { payload: FLAT_CURVE } : { payload: [] },
      );
      const { h, device } = await connected(replies);
      await device.setCustomEq(new Array<number>(10).fill(1));
      expect(sentPayloads(h, 0xf2).filter((payload) => payload[2] === 0x07)).toEqual([]);
    });

    it('clamps each gain to the limits the earbuds reported', async () => {
      const { h, device } = await connected(keeping());
      await device.setCustomEq([99, -99, 0, 0, 0, 0, 0, 0, 0, 0]);
      const write = sentPayloads(h, 0xf2)[1];
      expect(write[9]).toBe(6);
      expect(write[12]).toBe(0x86);
      expect(device.state.customEq?.bands[0].gain).toBe(6);
    });

    it('shows what the earbuds hold and says so when they did not keep the curve', async () => {
      const { device } = await connected(new Map(keeping()).set(0xf2, () => ({ payload: [] })));
      await device.setCustomEq([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
      expect(device.state.customEq?.bands.every((band) => band.gain === 0)).toBe(true);
      expect(device.state.error).toBe('The earbuds did not keep the curve.');
    });

    it('rolls back to the curve it had when the write is refused', async () => {
      const { device } = await connected(new Map(keeping()).set(0xf2, () => ({ payload: [], status: 1 })));
      await device.setCustomEq([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
      expect(device.state.customEq?.bands.every((band) => band.gain === 0)).toBe(true);
      expect(device.state.eqPreset).toBe(5);
      expect(device.state.error).toContain('status 1');
    });

    it('does nothing for a model with no curve', async () => {
      const { h, device } = await connected(withConfigs(FULL, {}));
      await device.setCustomEq([1]);
      expect(sentPayloads(h, 0xf2)).toEqual([]);
    });
  });
});

describe('XiaomiDevice query console', () => {
  it('sends reads and refuses everything else', async () => {
    const h = harness(CONFIGS);
    const device = new XiaomiDevice(h.opener, OPTIONS);
    await expect(device.sendQuery(0x02, [])).rejects.toThrow('Not connected');
    await device.adoptPort(port);
    expect(Array.from(await device.sendQuery(0x09, [0xff, 0xff, 0xff, 0xff]))).toEqual([2, 9, 1, 2, 10, 0]);
    for (const opcode of [0x08, 0xf2, 0x50, 0x51, 0x03]) {
      await expect(device.sendQuery(opcode, [1])).rejects.toThrow('Only reads');
    }
    expect(h.requests.some((r) => r.opcode === 0x03)).toBe(false);
  });

  it('records raw tx and rx bytes from connect, with a marker per link', async () => {
    const h = harness(CONFIGS);
    const device = new XiaomiDevice(h.opener, OPTIONS);
    const changed = vi.fn();
    device.onProtocolLog(changed);
    await device.adoptPort(port);
    const log = device.protocolLog;
    expect(log[0].direction).toBe('connect');
    expect(log[1].direction).toBe('tx');
    expect(Array.from(log[1].bytes.subarray(0, 3))).toEqual([0xfe, 0xdc, 0xba]);
    expect(log.some((entry) => entry.direction === 'rx')).toBe(true);
    expect(changed).toHaveBeenCalled();
  });
});

describe('XiaomiDevice disconnect', () => {
  it('keeps identity and settings but drops battery, handshake and the live tables', async () => {
    const h = harness(CONFIGS);
    const device = new XiaomiDevice(h.opener, OPTIONS);
    await device.adoptPort(port);
    await device.disconnect();
    expect(device.state.status).toBe('disconnected');
    expect(device.state.info.model).toBe('Redmi Buds 5 Pro');
    expect(device.state.info.colour).toBe(2);
    expect(device.state.ancMode).toBe(1);
    expect(device.state.battery).toEqual([]);
    expect(device.state.handshake).toBeNull();
    expect(device.state.gestures).toEqual([]);
    expect(device.state.customEq).toBeNull();
  });

  it('does the same when the link drops', async () => {
    const h = harness(CONFIGS);
    const device = new XiaomiDevice(h.opener, OPTIONS);
    await device.adoptPort(port);
    h.transport().drop(new Error('link lost'));
    expect(device.state.status).toBe('disconnected');
    expect(device.state.error).toBeTruthy();
    expect(device.state.info.model).toBe('Redmi Buds 5 Pro');
    expect(device.state.battery).toEqual([]);
  });

  it('does not take a Bluetooth GATT target', async () => {
    const device = new XiaomiDevice(harness(CONFIGS).opener, OPTIONS);
    await device.adoptPort({ gatt: {} } as never);
    expect(device.state.error).toContain('GATT');
  });
});
