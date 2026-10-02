import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DeviceManager } from './manager';
import { identifiedDriver } from './knownDevices';
import { STANDARD_SPP_UUID } from './transport';
import { FrameDecoder, encodeFrame } from '@/drivers/samsung/frame';
import { SppFrameDecoder, encodeSppFrame } from '@/drivers/heymelody/sppFrame';
import { replyFor } from '@/drivers/heymelody/protocol/cmd';

/**
 * The shared standard-SPP service, end to end through the manager: a fake port
 * that behaves like a real RFCOMM channel (a reader that waits, a writer that
 * records), with a device scripted behind it.
 */

const installStorage = (): void => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    },
  });
};

interface FakePort {
  port: SerialPort;
  opens: () => number;
  writes: Uint8Array[];
  /** Deliver bytes as though the earbuds sent them. */
  push(bytes: Uint8Array): void;
}

function fakePort(onWrite: (bytes: Uint8Array, port: FakePort) => void = () => {}): FakePort {
  let opens = 0;
  let waiting: ((result: ReadableStreamReadResult<Uint8Array>) => void) | null = null;
  const queued: Uint8Array[] = [];
  const writes: Uint8Array[] = [];
  const handle: FakePort = {
    opens: () => opens,
    writes,
    push(bytes) {
      if (waiting) {
        const resolve = waiting;
        waiting = null;
        resolve({ value: bytes, done: false });
      } else queued.push(bytes);
    },
    port: {
      connected: true,
      getInfo: () => ({ bluetoothServiceClassId: STANDARD_SPP_UUID }),
      async open() {
        opens += 1;
      },
      async close() {},
      readable: {
        getReader: () => ({
          read: () =>
            queued.length > 0
              ? Promise.resolve({ value: queued.shift()!, done: false })
              : new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => (waiting = resolve)),
          cancel: async () => {
            waiting?.({ value: undefined, done: true });
          },
          releaseLock: () => {},
        }),
      },
      writable: {
        getWriter: () => ({
          write: async (bytes: Uint8Array) => {
            writes.push(bytes);
            onWrite(bytes, handle);
          },
          releaseLock: () => {},
        }),
      },
    } as unknown as SerialPort,
  };
  return handle;
}

const stubGranted = (port: SerialPort): void => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { serial: { getPorts: async () => [port] } },
  });
};

const ascii = (text: string, length: number): number[] => [...text.padEnd(length, '\0')].map((c) => c.charCodeAt(0));

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
beforeEach(installStorage);
afterEach(() => {
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
  else Reflect.deleteProperty(globalThis, 'navigator');
  vi.restoreAllMocks();
});

describe('DeviceManager on a shared standard-SPP port', () => {
  it('hands Galaxy Buds the same open port, having recognised their unprompted push', async () => {
    const buds = fakePort((bytes, self) => {
      for (const frame of new FrameDecoder().push(bytes)) {
        if (frame.id === 0x22) self.push(encodeFrame(0x22, [...ascii('SM-R190NZ', 14), ...ascii('SM-R190NZ', 14)]));
      }
    });
    stubGranted(buds.port);
    const manager = new DeviceManager();
    await manager.refreshAvailable();
    setTimeout(() => {
      buds.push(encodeFrame(0x60, [11, 80, 75, 1, 1, 0x11, 60, 0]));
      buds.push(encodeFrame(0x61, [11, 0, 80, 75, 1, 1, 0x11, 60, 0, 3, 1, 0, 1, 0]));
    }, 5);

    await manager.select(STANDARD_SPP_UUID);

    expect(manager.active.id).toBe('samsung');
    expect(manager.brand).toBe('samsung');
    expect(buds.opens()).toBe(1); // listened to and driven on one open: no reconnect between
    expect(manager.active.state.status).toBe('connected');
    expect(manager.active.state.info.model).toBe('Galaxy Buds Pro');
    expect(identifiedDriver(STANDARD_SPP_UUID)).toBe('samsung');
  });

  it('hands HeyMelody earbuds the same open port, having recognised their reply to its query', async () => {
    const earbuds = fakePort((bytes, self) => {
      for (const frame of new SppFrameDecoder().push(bytes)) {
        self.push(encodeSppFrame(replyFor(frame.cmd), frame.seq, [0x00]));
      }
    });
    stubGranted(earbuds.port);
    const manager = new DeviceManager();
    await manager.refreshAvailable();

    await manager.select(STANDARD_SPP_UUID);

    expect(manager.active.id).toBe('heymelody');
    expect(earbuds.opens()).toBe(1);
    expect(identifiedDriver(STANDARD_SPP_UUID)).toBe('heymelody');
    // Nothing but HeyMelody's own framing went out: the Galaxy Buds query waits its turn behind a recognised device.
    expect(earbuds.writes.every((bytes) => bytes[0] === 0xaa)).toBe(true);
  });

  it('labels and files a shared port by the driver it was last identified as', async () => {
    const buds = fakePort();
    stubGranted(buds.port);
    localStorage.setItem('otocontrol:identified-driver', JSON.stringify({ [STANDARD_SPP_UUID]: 'samsung' }));
    const manager = new DeviceManager();
    await manager.refreshAvailable();
    expect(manager.available[0].brand).toBe('samsung');
    expect(manager.active.id).toBe('samsung');
  });

  it('falls back to the port’s first candidate, opening it itself, when listening is impossible', async () => {
    const unreachable = fakePort();
    (unreachable.port as { connected: boolean }).connected = false;
    stubGranted(unreachable.port);
    const manager = new DeviceManager();
    await manager.refreshAvailable();

    await manager.select(STANDARD_SPP_UUID);

    // HeyMelody's own adoptPort reports an unreachable port as plain disconnected, no banner.
    expect(manager.active.id).toBe('heymelody');
    expect(manager.active.state.status).toBe('disconnected');
    expect(manager.active.state.error).toBeNull();
  });
});
