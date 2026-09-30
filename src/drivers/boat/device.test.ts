import { describe, expect, it } from 'vitest';
import { BoatDevice } from './device';
import { FakeTransport } from '@/core/fakeTransport.test-helper';
import type { TransportOpener } from '@/core/transport';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Encodes a device→host frame: [seq][cmd][type=2][frag=0][len][payload]. */
const response = (cmd: number, payload: number[]): Uint8Array => {
  const frame = new Uint8Array(5 + payload.length);
  frame[0] = 0;
  frame[1] = cmd & 0xff;
  frame[2] = 2;
  frame[3] = 0x00;
  frame[4] = payload.length;
  frame.set(payload, 5);
  return frame;
};

const batch = (entries: Array<[id: number, value: number[]]>): number[] =>
  entries.flatMap(([id, value]) => [id & 0xff, value.length, ...value]);

const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));

/** A Bluetrum Airdopes-393ANC-style batch: battery, name, EQ, keys, ANC, caps. */
const INFO_393 = batch([
  [1, [0x85, 0x64, 0x00]],
  [3, ascii('393ANC_BLE')],
  [4, [10, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  [5, [3, 1, 7]],
  [12, [0x01]],
  [254, [0x0d, 0x00]],
]);

interface Harness {
  device: BoatDevice;
  transports: FakeTransport[];
}

/**
 * Opens the device against scripted fakes: `respond` maps a request cmd byte
 * to its reply payload, or null to stay silent (timeout path).
 */
const setup = (respond: (cmd: number, payload: Uint8Array) => number[] | null): Harness => {
  const transports: FakeTransport[] = [];
  const opener: TransportOpener = (_target, handlers) => {
    const transport = new FakeTransport(handlers);
    transports.push(transport);
    transport.onWrite = (bytes) => {
      const reply = respond(bytes[1], bytes.subarray(5));
      if (reply) transport.receive(response(bytes[1], reply));
    };
    return Promise.resolve(transport);
  };
  const device = new BoatDevice(opener, { timeoutMs: 50 });
  return { device, transports };
};

const adopt = (device: BoatDevice) => device.adoptPort({} as never);

describe('BoatDevice', () => {
  it('connects a Bluetrum model: batch poll fills battery, identity, EQ, keys, ANC and capabilities', async () => {
    const { device } = setup((cmd) => (cmd === 0x27 ? INFO_393 : null));
    await adopt(device);
    await flush();
    const { state } = device;
    expect(state.status).toBe('connected');
    expect(state.info.model).toBe('Airdopes 393ANC');
    expect(state.info.sdkType).toBe('BLUETRUM_SDK');
    expect(state.battery?.left).toEqual({ level: 5, charging: true });
    expect(state.eq).toEqual({ mode: 5, gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], custom: false });
    expect(state.keys).toEqual([{ type: 3, fn: 7 }]);
    expect(state.ancMode).toBe(1);
    expect(state.capabilities.has('battery')).toBe(true);
    expect(state.capabilities.has('anc')).toBe(true);
    expect(state.capabilities.has('eq')).toBe(true);
    expect(state.capabilities.has('keys')).toBe(true);
    expect(state.capabilities.has('multipoint')).toBe(true);
  });

  it('rejects a non-Bluetrum Boat model without driving it', async () => {
    const { device } = setup((cmd) =>
      cmd === 0x27 ? batch([[3, ascii('Prime300_BLE')]]) : null,
    );
    await adopt(device);
    await flush();
    expect(device.state.status).toBe('disconnected');
    expect(device.state.error).toMatch(/not a Bluetrum/i);
  });

  it('releases the port when nothing answers the identity poll', async () => {
    const { device } = setup(() => null);
    await adopt(device);
    await flush();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(device.state.status).toBe('disconnected');
    expect(device.state.error).toMatch(/not look like a Boat/i);
  });

  it('applies a cmd-40 notification batch to live state', async () => {
    const { device, transports } = setup((cmd) => (cmd === 0x27 ? INFO_393 : null));
    await adopt(device);
    await flush();
    const payload = batch([[1, [0x01, 0x02, 0x80]]]);
    const frame = new Uint8Array(5 + payload.length);
    frame[0] = 1;
    frame[1] = 40;
    frame[2] = 3;
    frame[3] = 0x00;
    frame[4] = payload.length;
    frame.set(payload, 5);
    transports[0].receive(frame);
    await flush();
    expect(device.state.battery?.left).toEqual({ level: 1, charging: false });
    expect(device.state.battery?.case).toEqual({ level: 0, charging: true });
  });

  it('rolls back an ANC write the device never acknowledges', async () => {
    const { device } = setup((cmd) => (cmd === 0x27 ? INFO_393 : null));
    await adopt(device);
    await flush();
    expect(device.state.ancMode).toBe(1);
    await device.setAncMode(2);
    await flush();
    expect(device.state.ancMode).toBe(1);
    expect(device.state.error).toMatch(/not answered|does not implement/i);
  });

  it('keeps the model across a disconnect', async () => {
    const { device, transports } = setup((cmd) => (cmd === 0x27 ? INFO_393 : null));
    await adopt(device);
    await flush();
    expect(device.state.info.model).toBe('Airdopes 393ANC');
    transports[0].drop();
    await flush();
    expect(device.state.status).toBe('disconnected');
    expect(device.state.info.model).toBe('Airdopes 393ANC');
  });
});
