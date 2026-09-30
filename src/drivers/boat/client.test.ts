import { describe, expect, it, vi } from 'vitest';
import { BoatClient, BoatUnsupportedError } from './client';
import { Cmd } from './commands';
import type { Transport } from '@/core/transport';

const fakeTransport = () => {
  const writes: Uint8Array[] = [];
  return {
    writes,
    transport: {
      write: (bytes: Uint8Array) => {
        writes.push(bytes);
        return Promise.resolve();
      },
      close: () => Promise.resolve(),
      isOpen: true,
    } satisfies Transport,
  };
};

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const responseFrame = (seq: number, cmd: number, payload: number[]): Uint8Array => {
  const frame = new Uint8Array(5 + payload.length);
  frame[0] = seq;
  frame[1] = cmd;
  frame[2] = 2; // response
  frame[3] = 0x00; // single frag
  frame[4] = payload.length;
  frame.set(payload, 5);
  return frame;
};

describe('BoatClient', () => {
  it('sends a 5-byte-header request and resolves on the matching cmd byte', async () => {
    const { writes, transport } = fakeTransport();
    const client = new BoatClient(transport);
    const pending = client.request(Cmd.DeviceInfo, [0x01, 0x00]);
    await flush();
    // TX: [seq=0][39][type=1][frag=0][len=2][01 00].
    expect(Array.from(writes[0])).toEqual([0x00, 0x27, 0x01, 0x00, 0x02, 0x01, 0x00]);
    client.handleData(responseFrame(0, 0x27, [0x01, 0x05]));
    await expect(pending).resolves.toEqual(Uint8Array.from([0x01, 0x05]));
  });

  it('serialises concurrent requests in order', async () => {
    const { writes, transport } = fakeTransport();
    const client = new BoatClient(transport);
    const first = client.request(Cmd.DeviceInfo, [0x01, 0x00]);
    const second = client.request(Cmd.FindDevice, [0x01]);
    await Promise.resolve();
    expect(writes).toHaveLength(1);
    client.handleData(responseFrame(1, 0x27, [0x01]));
    await first;
    await Promise.resolve();
    expect(writes).toHaveLength(2);
    expect(writes[1][1]).toBe(0x2a);
    client.handleData(responseFrame(2, 0x2a, []));
    await second;
  });

  it('routes type-3 frames to notification listeners, not pending waiters', async () => {
    const { transport } = fakeTransport();
    const client = new BoatClient(transport);
    const listener = vi.fn();
    client.onNotification(listener);
    client.handleData(responseFrame(0, 0x27, [0x09]));
    // type 2 with no waiter → also a notification (unsolicited state).
    expect(listener).toHaveBeenCalledTimes(1);
    const notify = new Uint8Array(responseFrame(1, 0x27, [0x07]));
    notify[2] = 3;
    client.handleData(notify);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('resolves OTA commands without waiting for an ack', async () => {
    const { writes, transport } = fakeTransport();
    const client = new BoatClient(transport);
    await expect(client.request(Cmd.OtaSendData, [0x01, 0x02])).resolves.toEqual(new Uint8Array(0));
    expect(writes).toHaveLength(1);
  });

  it('rejects with BoatUnsupportedError after the timeout', async () => {
    const { transport } = fakeTransport();
    const client = new BoatClient(transport, { timeoutMs: 10 });
    await expect(client.request(Cmd.DeviceInfo, [0x01, 0x00])).rejects.toBeInstanceOf(BoatUnsupportedError);
  });

  it('abort rejects the pending request', async () => {
    const { transport } = fakeTransport();
    const client = new BoatClient(transport, { timeoutMs: 1000 });
    const pending = client.request(Cmd.DeviceInfo, [0x01, 0x00]);
    await flush();
    client.abort(new Error('closed'));
    await expect(pending).rejects.toThrow('closed');
  });
});
