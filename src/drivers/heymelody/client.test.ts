import { afterEach, describe, expect, it, vi } from 'vitest';

import { HeyMelodyClient, HeyMelodyUnsupportedError } from './client';
import { Cmd, replyFor } from './commands';
import { encodeSppFrame } from './sppFrame';
import type { Transport } from '@/core/transport';

class FakeTransport implements Transport {
  written: Uint8Array[] = [];
  isOpen = true;

  async write(bytes: Uint8Array): Promise<void> {
    this.written.push(bytes);
  }

  async close(): Promise<void> {
    this.isOpen = false;
  }
}

function setup() {
  const transport = new FakeTransport();
  const client = new HeyMelodyClient(transport);
  return { transport, client };
}

/** Body offset 4 (seq) + header(2, since these test payloads all fit a 1-byte length). */
const sentSeq = (frame: Uint8Array): number => frame[6];

afterEach(() => {
  vi.useRealTimers();
});

describe('HeyMelodyClient.request', () => {
  it('writes an encoded frame and resolves with the reply payload', async () => {
    const { transport, client } = setup();
    const pending = client.request(Cmd.QueryProductId);
    await vi.waitFor(() => expect(transport.written).toHaveLength(1));

    client.handleData(
      encodeSppFrame(replyFor(Cmd.QueryProductId), sentSeq(transport.written[0]), [0x00, 0x10, 0xf0, 0x06]),
    );

    await expect(pending).resolves.toEqual(Uint8Array.from([0x00, 0x10, 0xf0, 0x06]));
  });

  it('rejects with HeyMelodyUnsupportedError after the timeout', async () => {
    vi.useFakeTimers();
    const { client } = setup();
    const pending = client.request(Cmd.QueryAncDirect, [], { timeoutMs: 100 });
    const assertion = expect(pending).rejects.toBeInstanceOf(HeyMelodyUnsupportedError);
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it('queues a second request until the first settles', async () => {
    const { transport, client } = setup();
    const first = client.request(Cmd.Battery);
    const second = client.request(Cmd.QueryEqCurrent);
    await vi.waitFor(() => expect(transport.written).toHaveLength(1));

    client.handleData(encodeSppFrame(replyFor(Cmd.Battery), sentSeq(transport.written[0]), [0x00]));
    await first;
    await vi.waitFor(() => expect(transport.written).toHaveLength(2));

    client.handleData(
      encodeSppFrame(replyFor(Cmd.QueryEqCurrent), sentSeq(transport.written[1]), [0x01, 0x00]),
    );
    await expect(second).resolves.toEqual(Uint8Array.from([0x01, 0x00]));
  });

  it('routes an unmatched frame to notification listeners', () => {
    const { client } = setup();
    const notified: number[] = [];
    client.onNotification((frame) => notified.push(frame.cmd));
    client.handleData(encodeSppFrame(Cmd.ActiveReport, 0x01, [3, 1, 1, 0]));
    expect(notified).toEqual([Cmd.ActiveReport]);
  });

  it('abort() rejects a pending request', async () => {
    const { client } = setup();
    const pending = client.request(Cmd.Battery);
    client.abort(new Error('disconnected'));
    await expect(pending).rejects.toThrow('disconnected');
  });

  it('abort() rejects all queued requests when multiple are pending', async () => {
    const { client } = setup();
    const first = client.request(Cmd.Battery);
    const second = client.request(Cmd.QueryEqCurrent);
    client.abort(new Error('connection lost'));
    await expect(first).rejects.toThrow('connection lost');
    await expect(second).rejects.toThrow('connection lost');
  });

  it('abort() prevents transport write for queued requests', async () => {
    const { transport, client } = setup();
    const pending = client.request(Cmd.Battery);
    client.abort(new Error('aborted'));
    await Promise.resolve(); // Microtask flush
    expect(transport.written).toHaveLength(0);
    await expect(pending).rejects.toThrow('aborted');
  });
});
