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

/** A Redmi Buds 4: 85% left (charging), 90% right, 70% case; ANC on, in-ear on. */
const FULL: Replies = new Map<number, number[]>([
  [0x50, [1, ...new Array<number>(16).fill(0)]],
  [0x51, [1]],
  [
    0x02,
    [
      5, 3, 0x27, 0x17, 0x50, 0x34, // VID/PID -> Redmi Buds 4
      5, 1, 0x12, 0x34, 0x56, 0x78, // firmware
      4, 7, 0xd5, 90, 70, // battery
    ],
  ],
  [0x09, [2, 9, 1, 2, 10, 0]],
  [0xf3, [0]],
]);

/** Config reads answer per id, as the earbuds do. */
const withConfigs = (replies: Replies, configs: Record<number, number[]>): Replies =>
  new Map(replies).set(0xf3, (frame) => {
    const id = frame.payload[1];
    return { payload: configs[id] ?? [], status: configs[id] ? 0 : 1 };
  });

const CONFIGS = withConfigs(FULL, { 0x0b: [4, 0, 0x0b, 1, 2, 4, 0, 0x0b, 2, 1], 0x07: [3, 0, 7, 5] });

describe('XiaomiDevice connect', () => {
  it('runs the handshake, identifies the model and reads state', async () => {
    const h = harness(CONFIGS);
    const device = new XiaomiDevice(h.opener, OPTIONS);
    await device.adoptPort(port);

    expect(device.state.status).toBe('connected');
    expect(device.state.handshake).toBe('complete');
    expect(device.state.info).toMatchObject({ model: 'Redmi Buds 4', vid: 0x2717, pid: 0x5034, firmware: ['1.2.3.4', '5.6.7.8'] });
    expect(device.state.battery).toEqual([
      { device: 'left', level: 85, charging: true },
      { device: 'right', level: 90, charging: false },
      { device: 'case', level: 70, charging: false },
    ]);
    expect(device.state.ancMode).toBe(1);
    expect(device.state.wearDetection).toBe(true);
    expect(device.state.ncStrength).toBe(2);
    expect(device.state.transparencyStrength).toBe(1);
    expect(device.state.eqPreset).toBe(5);
    expect(device.state.capabilities).toEqual(new Set(['find', 'version', 'battery', 'anc', 'wear', 'strength', 'eq']));
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

  it('asks for info and run info with the all-attributes mask', async () => {
    const h = harness(CONFIGS);
    await new XiaomiDevice(h.opener, OPTIONS).adoptPort(port);
    const byOpcode = (opcode: number) => h.requests.filter((r) => r.opcode === opcode).map((r) => Array.from(r.payload));
    expect(byOpcode(0x02)).toEqual([[0xff, 0xff, 0xff, 0xff]]);
    expect(byOpcode(0x09)).toEqual([[0xff, 0xff, 0xff, 0xff]]);
    expect(byOpcode(0xf3)).toEqual([[0, 0x0b], [0, 0x07]]);
  });

  it('still reads a model that skips the handshake', async () => {
    const replies = new Map(CONFIGS);
    replies.delete(0x50);
    replies.delete(0x51);
    const device = new XiaomiDevice(harness(replies, false).opener, OPTIONS);
    await device.adoptPort(port);
    expect(device.state.status).toBe('connected');
    expect(device.state.handshake).toBe('skipped');
    expect(device.state.info.model).toBe('Redmi Buds 4');
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
    expect(device.state.info.model).toBe('Redmi Buds 4');
  });

  it('names an unlisted model from its Bluetooth name and hides noise control on an Active', async () => {
    const name = Array.from(new TextEncoder().encode('Redmi Buds 6 Active'));
    const replies = new Map(CONFIGS).set(0x02, [name.length + 1, 0, ...name, 5, 3, 0x27, 0x17, 0x60, 0x00, 4, 7, 50, 60, 255]);
    const device = new XiaomiDevice(harness(replies).opener, OPTIONS);
    await device.adoptPort(port);
    expect(device.state.info.model).toBe('Redmi Buds 6 Active');
    expect(device.state.capabilities.has('anc')).toBe(false);
    expect(device.state.capabilities.has('strength')).toBe(false);
    expect(device.state.capabilities.has('eq')).toBe(true);
  });

  it('leaves out controls whose reads are refused', async () => {
    const replies = new Map(FULL).set(0x09, () => ({ payload: [], status: 1 }));
    const h = harness(withConfigs(replies, {}));
    const device = new XiaomiDevice(h.opener, OPTIONS);
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
  it('keeps identity and settings but drops battery and handshake', async () => {
    const h = harness(CONFIGS);
    const device = new XiaomiDevice(h.opener, OPTIONS);
    await device.adoptPort(port);
    await device.disconnect();
    expect(device.state.status).toBe('disconnected');
    expect(device.state.info.model).toBe('Redmi Buds 4');
    expect(device.state.ancMode).toBe(1);
    expect(device.state.battery).toEqual([]);
    expect(device.state.handshake).toBeNull();
  });

  it('does the same when the link drops', async () => {
    const h = harness(CONFIGS);
    const device = new XiaomiDevice(h.opener, OPTIONS);
    await device.adoptPort(port);
    h.transport().drop(new Error('link lost'));
    expect(device.state.status).toBe('disconnected');
    expect(device.state.error).toBeTruthy();
    expect(device.state.info.model).toBe('Redmi Buds 4');
    expect(device.state.battery).toEqual([]);
  });

  it('does not take a Bluetooth GATT target', async () => {
    const device = new XiaomiDevice(harness(CONFIGS).opener, OPTIONS);
    await device.adoptPort({ gatt: {} } as never);
    expect(device.state.error).toContain('GATT');
  });
});
