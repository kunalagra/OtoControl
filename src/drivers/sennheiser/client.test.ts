import { afterEach, describe, expect, it, vi } from 'vitest';

import { getAncEnabled, getBattery, getTransparencyLevel, setAncEnabled } from './gaia/commands';
import { Vendor, encodeFrame, toHex } from './gaia/frame';
import type { GaiaFrame } from './gaia/frame';
import { GaiaClient, GaiaError, GaiaTimeoutError } from './client';
import type { Transport } from '@/core/transport';

class FakeTransport implements Transport {
  written: Uint8Array[] = [];
  isOpen = true;
  failNextWrite: Error | null = null;

  async write(bytes: Uint8Array): Promise<void> {
    if (this.failNextWrite) {
      const error = this.failNextWrite;
      this.failNextWrite = null;
      throw error;
    }
    this.written.push(bytes);
  }

  async close(): Promise<void> {
    this.isOpen = false;
  }
}

function setup() {
  const transport = new FakeTransport();
  const client = new GaiaClient(transport);
  const reply = (command: number, payload: number[] = [], vendor = Vendor.Sennheiser) =>
    client.handleData(encodeFrame(vendor, command, payload));
  return { transport, client, reply };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('GaiaClient.request', () => {
  it('writes the encoded frame and resolves with the decoded response', async () => {
    const { transport, client, reply } = setup();

    const pending = client.request(getBattery, undefined);
    await vi.waitFor(() => expect(transport.written).toHaveLength(1));
    expect(toHex(transport.written[0])).toBe('FF 03 00 00 04 95 06 03');

    reply(0x0703, [0x46]);
    await expect(pending).resolves.toEqual([70]);
  });

  it('rejects with GaiaError when the device returns an error frame', async () => {
    const { client, reply, transport } = setup();

    const pending = client.request(setAncEnabled, true);
    await vi.waitFor(() => expect(transport.written).toHaveLength(1));

    reply(0x1b84, [0x05]); // 0x1A04 | 0x0180
    await expect(pending).rejects.toBeInstanceOf(GaiaError);
  });

  it('rejects when the transport write fails', async () => {
    const { client, transport } = setup();
    transport.failNextWrite = new Error('device disconnected');

    await expect(client.request(getBattery, undefined)).rejects.toThrow('device disconnected');
  });

  it('times out when no response arrives', async () => {
    vi.useFakeTimers();
    const transport = new FakeTransport();
    const client = new GaiaClient(transport, { timeoutMs: 100 });

    const pending = client.request(getBattery, undefined);
    const assertion = expect(pending).rejects.toBeInstanceOf(GaiaTimeoutError);
    await vi.advanceTimersByTimeAsync(150);
    await assertion;
  });

  it('does not resolve a pending request with a notification sharing its base ID', async () => {
    const { client, reply, transport } = setup();

    // 0x1A83 is the transparency notification; it maps back to request 0x1A03.
    const pending = client.request(getTransparencyLevel, undefined);
    await vi.waitFor(() => expect(transport.written).toHaveLength(1));

    const seen: GaiaFrame[] = [];
    client.onNotification((frame) => seen.push(frame));

    reply(0x1a83, [0x2a]);
    expect(seen.map((f) => f.command)).toEqual([0x1a83]);

    reply(0x1b03, [0x50]);
    await expect(pending).resolves.toBe(80);
  });

  it('serialises requests so only one is on the wire at a time', async () => {
    const { client, reply, transport } = setup();

    const first = client.request(getBattery, undefined);
    const second = client.request(getAncEnabled, undefined);

    await vi.waitFor(() => expect(transport.written).toHaveLength(1));
    expect(toHex(transport.written[0])).toContain('06 03');

    reply(0x0703, [0x46]);
    await expect(first).resolves.toEqual([70]);

    await vi.waitFor(() => expect(transport.written).toHaveLength(2));
    expect(toHex(transport.written[1])).toContain('1A 05');

    reply(0x1b05, [0x01]);
    await expect(second).resolves.toBe(true);
  });

  it('keeps the queue running after a failed request', async () => {
    vi.useFakeTimers();
    const transport = new FakeTransport();
    const client = new GaiaClient(transport, { timeoutMs: 50 });

    const failing = client.request(getBattery, undefined);
    const assertion = expect(failing).rejects.toBeInstanceOf(GaiaTimeoutError);
    await vi.advanceTimersByTimeAsync(80);
    await assertion;

    const next = client.request(getAncEnabled, undefined);
    // Flush microtasks only — advancing the clock here would trip the 50ms
    // timeout on this second request before it can be answered.
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.written).toHaveLength(2);

    client.handleData(encodeFrame(Vendor.Sennheiser, 0x1b05, [0x01]));
    await expect(next).resolves.toBe(true);
  });
});

describe('GaiaClient listeners', () => {
  it('reports both directions to frame listeners', async () => {
    const { client, reply, transport } = setup();
    const seen: Array<[string, number]> = [];
    client.onFrame((frame, direction) => seen.push([direction, frame.command]));

    const pending = client.request(getBattery, undefined);
    await vi.waitFor(() => expect(transport.written).toHaveLength(1));
    reply(0x0703, [0x46]);
    await pending;

    expect(seen).toEqual([
      ['tx', 0x0603],
      ['rx', 0x0703],
    ]);
  });

  it('treats an unsolicited response as an update, not noise', () => {
    // The headphones push PhysicalDevice_State as 0x0502 — a response-shaped
    // frame for a request nobody made. Dropping it lost the wear state.
    const { client, reply } = setup();
    const seen: GaiaFrame[] = [];
    client.onNotification((f) => seen.push(f));

    reply(0x0502, [0x03]);
    expect(seen.map((f) => f.command)).toEqual([0x0502]);
  });

  it('still warns about an unsolicited error frame', () => {
    const { client, reply } = setup();
    const seen: GaiaFrame[] = [];
    client.onNotification((f) => seen.push(f));

    reply(0x0582, [0x01]);
    expect(seen).toHaveLength(0);
  });

  it('unsubscribes cleanly', () => {
    const { client, reply } = setup();
    const listener = vi.fn();
    const off = client.onNotification(listener);

    reply(0x0683, [0x40]);
    expect(listener).toHaveBeenCalledTimes(1);

    off();
    reply(0x0683, [0x30]);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('unsafe command refusal', () => {
  const factoryReset = {
    name: 'factoryReset',
    vendor: Vendor.Sennheiser,
    id: 0x0040,
    encode: () => [],
    decode: () => undefined,
  };

  it('refuses a blocked command instead of writing it', async () => {
    const { client, transport } = setup();
    await expect(client.request(factoryReset, undefined)).rejects.toThrow('factory reset');
    expect(transport.written).toHaveLength(0);
  });

  it('refuses a blocked raw frame', async () => {
    const { client, transport } = setup();
    const frame = encodeFrame(Vendor.Sennheiser, 0x0200); // enter DFU mode
    await expect(client.sendRaw(frame)).rejects.toThrow('firmware upgrade');
    expect(transport.written).toHaveLength(0);
  });

  it('still sends a safe raw frame', async () => {
    const { client, transport } = setup();
    await client.sendRaw(encodeFrame(Vendor.Sennheiser, 0x0603));
    expect(transport.written).toHaveLength(1);
  });

  it('reports a blocked probe without sending anything', async () => {
    const { client, transport } = setup();
    const result = await client.probe(Vendor.Sennheiser, 0x0040);
    expect(result.outcome).toBe('blocked');
    expect(transport.written).toHaveLength(0);
  });
});

describe('GaiaClient.probe', () => {
  it('reports an implemented command with its payload', async () => {
    const { client, reply, transport } = setup();
    const pending = client.probe(Vendor.Sennheiser, 0x0603);
    await vi.waitFor(() => expect(transport.written).toHaveLength(1));

    reply(0x0703, [0x46]);
    const result = await pending;
    expect(result.outcome).toBe('response');
    expect(Array.from(result.payload!)).toEqual([0x46]);
  });

  it('reports a rejected command as an error rather than throwing', async () => {
    const { client, reply, transport } = setup();
    const pending = client.probe(Vendor.Sennheiser, 0x1010);
    await vi.waitFor(() => expect(transport.written).toHaveLength(1));

    reply(0x1190, [0x02]); // 0x1010 | 0x0180
    await expect(pending).resolves.toMatchObject({ outcome: 'error' });
  });

  it('reports silence when nothing comes back', async () => {
    const transport = new FakeTransport();
    const client = new GaiaClient(transport);
    await expect(client.probe(Vendor.Sennheiser, 0x1011, 20)).resolves.toMatchObject({
      outcome: 'silent',
    });
  });
});

describe('GaiaClient.abort', () => {
  it('rejects the in-flight request', async () => {
    const { client, transport } = setup();

    const pending = client.request(getBattery, undefined);
    await vi.waitFor(() => expect(transport.written).toHaveLength(1));

    client.abort(new Error('port closed'));
    await expect(pending).rejects.toThrow('port closed');
  });
});
