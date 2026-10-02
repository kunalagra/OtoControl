import { describe, expect, it } from 'vitest';

import { SamsungDevice } from './device';
import { FrameDecoder, encodeFrame } from './frame';
import type { FrameVariant, SamsungFrame } from './frame';
import { FakeTransport } from '@/core/fakeTransport.test-helper';
import { HandoffTransport } from '@/core/identify';
import { SAMSUNG_LEGACY_SPP_UUID } from '@/core/transport';
import type { TransportOpener } from '@/core/transport';

const OPTIONS = { timeoutMs: 40, probeTimeoutMs: 40, statusWaitMs: 40 };

/** `adoptPort` is the test entry point — `connect()` would need the picker. */
const port = {} as SerialPort;

const ascii = (text: string, length: number): number[] => [...text.padEnd(length, '\0')].map((c) => c.charCodeAt(0));
const sku = (text: string): number[] => [...ascii(text, 14), ...ascii(text, 14)];

interface Script {
  /** Replies by the id of the request that draws them. */
  replies?: Map<number, number[]>;
  /** Frames the earbuds push unprompted, once connected. */
  pushes?: Array<{ id: number; payload: number[] }>;
  variant?: FrameVariant;
  /** Ack every other request with `0x42 [id, 0]`. */
  ackWrites?: boolean;
}

interface Harness {
  open: TransportOpener;
  fake: () => FakeTransport;
  /** Every frame the driver wrote, decoded. */
  sent: SamsungFrame[];
}

function buds(script: Script = {}): Harness {
  const sent: SamsungFrame[] = [];
  let made: FakeTransport | null = null;
  const variant = script.variant ?? 'standard';
  const open: TransportOpener = async (_port, handlers) => {
    const transport = new FakeTransport(handlers);
    made = transport;
    const decoder = new FrameDecoder(variant);
    transport.onWrite = (bytes) => {
      for (const frame of decoder.push(bytes)) {
        sent.push(frame);
        const reply = script.replies?.get(frame.id);
        if (reply !== undefined) {
          queueMicrotask(() => transport.receive(encodeFrame(frame.id, reply, { variant })));
        } else if (script.ackWrites) {
          queueMicrotask(() => transport.receive(encodeFrame(0x42, [frame.id, 0], { variant })));
        }
      }
    };
    setTimeout(() => {
      for (const push of script.pushes ?? []) transport.receive(encodeFrame(push.id, push.payload, { variant }));
    }, 1);
    return transport;
  };
  return { open, fake: () => made as FakeTransport, sent };
}

/** Status: revision 11, L 80, R 75, coupled, main L, L in ear / R out, case 60, left charging. */
const STATUS = { id: 0x60, payload: [11, 80, 75, 1, 1, 0x12, 60, 0x10] };

/** Extended status (Buds2 Pro): EQ preset 3, touch enabled with every gesture, ANC on. */
const extended = (overrides: Record<number, number> = {}): { id: number; payload: number[] } => {
  const payload = new Array(40).fill(0);
  Object.assign(payload, { 0: 11, 2: 80, 3: 75, 4: 1, 5: 1, 6: 0x12, 7: 60, 9: 3, 10: 0x8f, 12: 1 }, overrides);
  return { id: 0x61, payload };
};

const VERSION = [0x12, 0x12, 0, 0x35, 4, 0, 0x35, 4, 0xa, 0xb];

const ids = (sent: SamsungFrame[]): number[] => sent.map((frame) => frame.id);

describe('SamsungDevice connect', () => {
  it('reads battery, placement and charging from the pushes, and the model from the SKU', async () => {
    const harness = buds({
      pushes: [STATUS, extended()],
      replies: new Map([
        [0x22, sku('SM-R510NZKAEUA')],
        [0x63, VERSION],
      ]),
    });
    const device = new SamsungDevice(harness.open, OPTIONS);
    await device.adoptPort(port);

    expect(device.state.status).toBe('connected');
    expect(device.state.info.model).toBe('Galaxy Buds2 Pro');
    expect(device.state.info.modelId).toBe('buds2Pro');
    expect(device.state.info.sku).toBe('SM-R510NZKAEUA');
    expect(device.state.info.revision).toBe(11);
    expect(device.state.battery).toEqual({ left: 80, right: 75, case: 60 });
    expect(device.state.placement).toEqual({ left: 'wearing', right: 'idle' });
    expect(device.state.charging).toEqual({ left: true, right: false, case: false });
    expect(device.state.eq).toBe(3);
    expect(device.state.noiseMode).toBe(1);
    expect(device.state.touchLocked).toBe(false);
    expect(device.state.info.firmware).toBe('R510XXE0ARF4');
    expect(device.state.info.hardware).toBe('rev1.2');
  });

  it('echoes the extended status as a response frame and announces itself, once', async () => {
    const harness = buds({ pushes: [STATUS, extended(), extended({ 9: 4 })] });
    const device = new SamsungDevice(harness.open, OPTIONS);
    await device.adoptPort(port);
    await new Promise((resolve) => setTimeout(resolve, 5));

    const echoes = harness.sent.filter((frame) => frame.id === 0x61);
    expect(echoes).toHaveLength(2); // one per push
    expect(echoes.every((frame) => frame.response && frame.payload.length === 1 && frame.payload[0] === 0)).toBe(true);
    const managerInfo = harness.sent.filter((frame) => frame.id === 0x88);
    expect(managerInfo).toHaveLength(1);
    expect([...managerInfo[0].payload]).toEqual([1, 2, 34]);
    expect(managerInfo[0].response).toBe(false);
  });

  it('does not echo the plain status push, which the vendor app leaves unanswered', async () => {
    const harness = buds({ pushes: [STATUS, extended()] });
    const device = new SamsungDevice(harness.open, OPTIONS);
    await device.adoptPort(port);
    expect(harness.sent.filter((frame) => frame.id === 0x60)).toEqual([]);
  });

  it('announces itself anyway when the earbuds stay quiet, and still connects', async () => {
    const harness = buds();
    const device = new SamsungDevice(harness.open, OPTIONS);
    await device.adoptPort(port);
    expect(device.state.status).toBe('connected');
    expect(ids(harness.sent)).toContain(0x88);
  });

  it('reads a Buds2-era extended status that arrived before the model was known, once the SKU answers', async () => {
    const harness = buds({ pushes: [extended()], replies: new Map([[0x22, sku('SM-R510')]]) });
    const device = new SamsungDevice(harness.open, OPTIONS);
    await device.adoptPort(port);
    // An unrecognised layout reads no noise mode; the SKU is what makes the 0x12 offset meaningful.
    expect(device.state.noiseMode).toBe(1);
    expect(device.state.touchLocked).toBe(false);
  });

  it('keeps the SKU and a reason when the model is not in the table, and offers no controls', async () => {
    const harness = buds({ pushes: [extended()], replies: new Map([[0x22, sku('SM-R999ZZ')]]) });
    const device = new SamsungDevice(harness.open, OPTIONS);
    await device.adoptPort(port);
    expect(device.state.info.modelId).toBe('unknown');
    expect(device.state.info.sku).toBe('SM-R999ZZ');
    expect(device.state.diagnostics.sku).toContain('unrecognised');
    harness.sent.length = 0;
    await device.setNoiseMode(1);
    expect(harness.sent).toEqual([]);
  });

  it('records why when the SKU read goes unanswered', async () => {
    const device = new SamsungDevice(buds({ pushes: [extended()] }).open, OPTIONS);
    await device.adoptPort(port);
    expect(device.state.diagnostics.sku).toBe('no reply');
    expect(device.state.diagnostics.version).toBe('no reply');
    expect(device.state.status).toBe('connected');
  });

  it('reads Buds Live from its SKU, as an ANC on/off with no ambient', async () => {
    const harness = buds({
      pushes: [extended({ 9: 2, 10: 1, 12: 1 })],
      replies: new Map([[0x22, sku('SM-R180NZ')]]),
      ackWrites: true,
    });
    const device = new SamsungDevice(harness.open, OPTIONS);
    await device.adoptPort(port);
    expect(device.state.info.model).toBe('Galaxy Buds Live');
    expect(device.state.noiseMode).toBe(1);
    expect(device.state.touchLocked).toBe(true);
    harness.sent.length = 0;
    await device.setNoiseMode(2); // ambient: none on a Live
    expect(harness.sent).toEqual([]);
    await device.setNoiseMode(0);
    expect(harness.sent[0]).toMatchObject({ id: 0x98 });
    expect([...harness.sent[0].payload]).toEqual([0]);
  });
});

describe('SamsungDevice on a shared port', () => {
  /** What `core/identify.ts` hands over: an open transport that has already been listened to. */
  async function handedOver(script: Script): Promise<{ device: SamsungDevice; harness: Harness }> {
    const harness = buds(script);
    const handoff = new HandoffTransport();
    handoff.bind(await harness.open(port, handoff.handlers));
    const device = new SamsungDevice(harness.open, OPTIONS);
    await device.adoptTransport(handoff);
    return { device, harness };
  }

  it('takes a Galaxy Buds+ for what answers the SKU with nothing but zeroes', async () => {
    const { device } = await handedOver({
      pushes: [STATUS, extended({ 8: 1, 11: 4, 12: 1, 9: 2, 10: 0 })],
      replies: new Map([[0x22, new Array(28).fill(0)]]),
    });
    expect(device.state.status).toBe('connected');
    expect(device.state.info.model).toBe('Galaxy Buds+');
    // Buds+ keeps its EQ at 11 and its touch lock at 12.
    expect(device.state.eq).toBe(4);
    expect(device.state.touchLocked).toBe(true);
    expect(device.state.noiseMode).toBe(2);
  });

  it('reads what the earbuds sent before the driver took over', async () => {
    const { device } = await handedOver({ pushes: [STATUS], replies: new Map([[0x22, sku('SM-R190NZ')]]) });
    expect(device.state.info.model).toBe('Galaxy Buds Pro');
    expect(device.state.battery.left).toBe(80);
  });

  it('shows an unrecognised SKU as an unknown model rather than guessing a layout', async () => {
    const { device } = await handedOver({ pushes: [extended()], replies: new Map([[0x22, sku('SM-R999')]]) });
    expect(device.state.info.modelId).toBe('unknown');
  });

  it('assumes no model when the SKU read is never answered', async () => {
    const { device } = await handedOver({ pushes: [extended()] });
    expect(device.state.info.modelId).toBe('unknown');
    expect(device.state.diagnostics.sku).toBe('no reply');
  });
});

describe('SamsungDevice on the 2019 Buds service', () => {
  it('speaks FE…EE and takes the model from the service, asking for no SKU', async () => {
    const legacyPort = { getInfo: () => ({ bluetoothServiceClassId: SAMSUNG_LEGACY_SPP_UUID }) } as unknown as SerialPort;
    const harness = buds({
      variant: 'legacy',
      pushes: [{ id: 0x60, payload: [0, 90, 40, 1, 0, 0x11] }],
      replies: new Map([[0x63, VERSION]]),
    });
    const device = new SamsungDevice(harness.open, OPTIONS);
    await device.adoptPort(legacyPort);

    expect(device.state.info.model).toBe('Galaxy Buds');
    expect(device.state.battery).toEqual({ left: 90, right: 40, case: null });
    expect(device.state.placement).toEqual({ left: 'wearing', right: 'wearing' });
    expect(ids(harness.sent)).not.toContain(0x22);
    expect(device.state.info.firmware).toMatch(/^R170XX/);
  });
});

describe('SamsungDevice settings', () => {
  async function connected(extra: Script = {}) {
    const harness = buds({ pushes: [STATUS, extended()], replies: new Map([[0x22, sku('SM-R510')]]), ackWrites: true, ...extra });
    const device = new SamsungDevice(harness.open, OPTIONS);
    await device.adoptPort(port);
    harness.sent.length = 0;
    return { device, harness };
  }

  it('sets the noise mode with 0x78, updating state at once', async () => {
    const { device, harness } = await connected();
    await device.setNoiseMode(2);
    expect(device.state.noiseMode).toBe(2);
    expect(harness.sent[0]).toMatchObject({ id: 0x78 });
    expect([...harness.sent[0].payload]).toEqual([2]);
  });

  it('sets an EQ preset with 0x86', async () => {
    const { device, harness } = await connected();
    await device.setEqPreset(5);
    expect(device.state.eq).toBe(5);
    expect([...harness.sent[0].payload]).toEqual([5]);
  });

  it('locks the touchpads by restating the gestures it last read', async () => {
    const { device, harness } = await connected();
    await device.setTouchLocked(true);
    expect(device.state.touchLocked).toBe(true);
    expect(harness.sent[0]).toMatchObject({ id: 0x90 });
    // [touch enabled = 0, single, double, triple, hold, doubleForCalls, holdForCalls] as read from 0x8f.
    expect([...harness.sent[0].payload]).toEqual([0, 1, 1, 1, 1, 0, 0]);
  });

  it('rings with 0xA6 on a model that can ring while worn, and stops with 0xA1', async () => {
    const { device, harness } = await connected();
    await device.setFinding(true);
    expect(device.state.finding).toBe(true);
    expect(harness.sent[0].id).toBe(0xa6);
    await device.setFinding(false);
    expect(device.state.finding).toBe(false);
    expect(harness.sent[1].id).toBe(0xa1);
  });

  it('clears finding when the earbuds report that ringing stopped', async () => {
    const { device, harness } = await connected();
    await device.setFinding(true);
    // The earbuds stopping on their own (a tap on the case) arrives as an unsolicited 0xA1.
    harness.fake().receive(encodeFrame(0xa1, []));
    expect(device.state.finding).toBe(false);
  });

  it('keeps an optimistic change when a write is simply not acknowledged', async () => {
    const { device } = await connected({ ackWrites: false });
    await device.setNoiseMode(0);
    expect(device.state.noiseMode).toBe(0);
    expect(device.state.error).toBeNull();
  });

  it('puts a setting back and says why when the write fails outright', async () => {
    const { device, harness } = await connected();
    harness.fake().isOpen = false; // writes now throw
    await device.setNoiseMode(0);
    expect(device.state.noiseMode).toBe(1);
    expect(device.state.error).toMatch(/closed/);
  });

  it('updates the noise mode from the earbuds own 0x77 push', async () => {
    const { device, harness } = await connected();
    harness.fake().receive(encodeFrame(0x77, [2]));
    expect(device.state.noiseMode).toBe(2);
  });
});

describe('SamsungDevice protocol log and queries', () => {
  it('records the connect, what it sent and every chunk it heard', async () => {
    const harness = buds({ pushes: [STATUS, extended()] });
    const device = new SamsungDevice(harness.open, OPTIONS);
    await device.adoptPort(port);
    const directions = device.protocolLog.entries.map((entry) => entry.direction);
    expect(directions[0]).toBe('connect');
    expect(directions).toContain('rx');
    expect(directions).toContain('tx');
  });

  it('sends a read from the console, and refuses a write', async () => {
    const harness = buds({ pushes: [extended()], replies: new Map([[0x22, sku('SM-R510')], [0x29, [1, 2, 3]]]) });
    const device = new SamsungDevice(harness.open, OPTIONS);
    await device.adoptPort(port);
    expect([...(await device.sendQuery(0x29, []))]).toEqual([1, 2, 3]);
    await expect(device.sendQuery(0x78, [1])).rejects.toThrow(/Only reads/);
    await expect(device.sendQuery(0x90, [1])).rejects.toThrow(/Only reads/);
  });

  it('refuses a console query while disconnected', async () => {
    await expect(new SamsungDevice(buds().open, OPTIONS).sendQuery(0x22, [])).rejects.toThrow('Not connected');
  });
});

describe('SamsungDevice drop and disconnect', () => {
  it('clears live readings on a drop but keeps what identifies the pair', async () => {
    const harness = buds({ pushes: [STATUS, extended()], replies: new Map([[0x22, sku('SM-R510')]]) });
    const device = new SamsungDevice(harness.open, OPTIONS);
    await device.adoptPort(port);
    harness.fake().drop(new Error('out of range'));

    expect(device.state.status).toBe('disconnected');
    expect(device.state.error).toMatch(/out of range/);
    expect(device.state.battery).toEqual({ left: null, right: null, case: null });
    expect(device.state.info.model).toBe('Galaxy Buds2 Pro');
    expect(device.state.eq).toBe(3);
  });

  it('closes the transport on disconnect', async () => {
    const harness = buds({ pushes: [extended()] });
    const device = new SamsungDevice(harness.open, OPTIONS);
    await device.adoptPort(port);
    await device.disconnect();
    expect(harness.fake().isOpen).toBe(false);
    expect(device.state.status).toBe('disconnected');
  });

  it('persists identity and settings only', async () => {
    const harness = buds({ pushes: [STATUS, extended()], replies: new Map([[0x22, sku('SM-R510')]]) });
    const device = new SamsungDevice(harness.open, OPTIONS);
    await device.adoptPort(port);
    const snapshot = device.snapshot() as Record<string, unknown>;
    expect(Object.keys(snapshot).sort()).toEqual(['eq', 'gestures', 'info', 'noiseMode', 'touchLocked']);
  });
});
