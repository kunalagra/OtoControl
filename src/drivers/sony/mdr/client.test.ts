import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Transport } from '@/core/transport';
import { MdrClient, MdrUnsupportedError, replyFor } from './client';
import { DataType, MdrDecoder, encodeAck, encodeFrame, toHex } from './frame';

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

function setup(timeoutMs = 200) {
  const transport = new FakeTransport();
  const client = new MdrClient(transport, { timeoutMs });
  const reply = (seq: number, payload: number[]) =>
    client.handleData(encodeFrame(DataType.Command1, seq, payload));
  const ack = (seq: number) => client.handleData(encodeAck(seq));
  const decodeWritten = () =>
    transport.written.flatMap((f) => new MdrDecoder().push(f));
  return { transport, client, reply, ack, decodeWritten };
}

afterEach(() => vi.useRealTimers());

describe('replyFor', () => {
  it('follows the GET n -> RET n+1 rule seen across every family', () => {
    expect(replyFor(0x00)).toBe(0x01); // protocol info
    expect(replyFor(0x04)).toBe(0x05); // device info
    expect(replyFor(0x06)).toBe(0x07); // support function
    expect(replyFor(0x12)).toBe(0x13); // common status
    expect(replyFor(0x22)).toBe(0x23); // power status
    expect(replyFor(0x56)).toBe(0x57); // EQ
  });
});

describe('MdrClient.request', () => {
  it('writes the frame and resolves with the reply payload', async () => {
    const { client, transport, reply } = setup();

    const pending = client.request(0x22, 0x01);
    await vi.waitFor(() => expect(transport.written).toHaveLength(1));
    // Captured battery request at sequence 0. The log also has the sequence-1
    // form, '...22 01 32 3C' — the checksum covers the sequence byte.
    expect(toHex(transport.written[0])).toBe('3E 0C 00 00 00 00 02 22 01 31 3C');

    reply(0, [0x23, 0x01, 0x64, 0x00, 0x64, 0x00]);
    expect(Array.from(await pending)).toEqual([0x23, 0x01, 0x64, 0x00, 0x64, 0x00]);
  });

  it('alternates the sequence bit across sends', async () => {
    const { client, transport, reply } = setup();

    const first = client.request(0x00, 0x00);
    await vi.waitFor(() => expect(transport.written).toHaveLength(1));
    reply(0, [0x01, 0x00]);
    await first;

    const second = client.request(0x04, 0x02);
    await vi.waitFor(() => expect(transport.written.length).toBeGreaterThanOrEqual(2));
    // written[1] is our ACK of the first reply; the request follows it.
    const requests = transport.written.filter((f) => f[1] === DataType.Command1);
    expect(requests[0][2]).toBe(0);
    expect(requests[1][2]).toBe(1);

    reply(1, [0x05, 0x02, 0x01, 0x41]);
    await second;
  });

  it('acknowledges every data frame, because the device stops otherwise', async () => {
    const { client, transport, reply } = setup();
    const pending = client.request(0x22, 0x01);
    await vi.waitFor(() => expect(transport.written).toHaveLength(1));

    reply(1, [0x23, 0x01, 0x50, 0x00, 0x50, 0x00]);
    await pending;

    const acks = transport.written.filter((f) => f[1] === DataType.Ack);
    expect(acks).toHaveLength(1);
    // Received seq 1, so the ACK carries 0.
    expect(toHex(acks[0])).toBe('3E 01 00 00 00 00 00 01 3C');
  });

  it('does not treat an ACK as the answer', async () => {
    const { client, transport, reply, ack } = setup();
    const pending = client.request(0x22, 0x01);
    await vi.waitFor(() => expect(transport.written).toHaveLength(1));

    ack(1); // transport-level only
    let settled = false;
    void pending.then(() => (settled = true)).catch(() => (settled = true));
    await vi.waitFor(() => expect(transport.written).toHaveLength(1));
    expect(settled).toBe(false);

    reply(0, [0x23, 0x01, 0x64, 0x00, 0x64, 0x00]);
    await expect(pending).resolves.toBeInstanceOf(Uint8Array);
  });

  it('reports an unanswered query as unsupported, not as a failure', async () => {
    vi.useFakeTimers();
    const transport = new FakeTransport();
    const client = new MdrClient(transport, { timeoutMs: 100 });

    // 0x22/0x00 (single battery) is exactly what the WF-C500 ignored.
    const pending = client.request(0x22, 0x00);
    const assertion = expect(pending).rejects.toBeInstanceOf(MdrUnsupportedError);
    await vi.advanceTimersByTimeAsync(150);
    await assertion;
  });

  it('names the command in the unsupported error', async () => {
    vi.useFakeTimers();
    const client = new MdrClient(new FakeTransport(), { timeoutMs: 50 });
    const pending = client.request(0x26, 0x01);
    const assertion = expect(pending).rejects.toThrow(/0x26\/0x01.*does not implement/);
    await vi.advanceTimersByTimeAsync(80);
    await assertion;
  });

  it('ignores a reply for a different inquiry type', async () => {
    const { client, transport, reply } = setup();
    const pending = client.request(0x22, 0x01);
    await vi.waitFor(() => expect(transport.written).toHaveLength(1));

    const seen: number[][] = [];
    client.onNotification((f) => seen.push(Array.from(f.payload)));

    reply(0, [0x23, 0x02, 0x30, 0x00]); // case battery, not what we asked for
    expect(seen).toHaveLength(1);

    reply(1, [0x23, 0x01, 0x64, 0x00, 0x64, 0x00]);
    expect(Array.from(await pending)[1]).toBe(0x01);
  });

  it('serialises requests', async () => {
    const { client, transport, reply } = setup();
    const first = client.request(0x22, 0x01);
    const second = client.request(0x12, 0x02);

    await vi.waitFor(() => expect(transport.written).toHaveLength(1));
    const requests = () => transport.written.filter((f) => f[1] === DataType.Command1);
    expect(requests()).toHaveLength(1);

    reply(0, [0x23, 0x01, 0x64, 0x00, 0x64, 0x00]);
    await first;

    await vi.waitFor(() => expect(requests()).toHaveLength(2));
    reply(1, [0x13, 0x02, 0x02]);
    await expect(second).resolves.toBeInstanceOf(Uint8Array);
  });

  it('keeps the queue alive after an unsupported command', async () => {
    vi.useFakeTimers();
    const transport = new FakeTransport();
    const client = new MdrClient(transport, { timeoutMs: 50 });

    const failing = client.request(0x26, 0x01);
    const assertion = expect(failing).rejects.toBeInstanceOf(MdrUnsupportedError);
    await vi.advanceTimersByTimeAsync(80);
    await assertion;

    const next = client.request(0x22, 0x01);
    await vi.advanceTimersByTimeAsync(0);
    client.handleData(encodeFrame(DataType.Command1, 0, [0x23, 0x01, 0x64, 0x00, 0x64, 0x00]));
    await expect(next).resolves.toBeInstanceOf(Uint8Array);
  });

  it('rejects when the transport write fails', async () => {
    const { client, transport } = setup();
    transport.failNextWrite = new Error('port closed');
    await expect(client.request(0x22, 0x01)).rejects.toThrow('port closed');
  });
});

describe('MdrClient frame handling', () => {
  it('drops a frame with a bad checksum instead of decoding it', () => {
    const { client } = setup();
    const seen: unknown[] = [];
    client.onNotification((f) => seen.push(f));

    const frame = encodeFrame(DataType.Command1, 0, [0x25, 0x01, 0x64]);
    frame[frame.length - 2] ^= 0xff;
    client.handleData(frame);

    expect(seen).toHaveLength(0);
  });

  it('routes an unsolicited notification to listeners', () => {
    const { client, reply } = setup();
    const seen: number[][] = [];
    client.onNotification((f) => seen.push(Array.from(f.payload)));

    reply(0, [0x25, 0x01, 0x50, 0x00, 0x50, 0x00]); // battery notification
    expect(seen).toEqual([[0x25, 0x01, 0x50, 0x00, 0x50, 0x00]]);
  });

  it('reports both directions to frame listeners', async () => {
    const { client, transport, reply } = setup();
    const seen: Array<[string, number]> = [];
    client.onFrame((frame, direction) => seen.push([direction, frame.payload[0] ?? -1]));

    const pending = client.request(0x22, 0x01);
    await vi.waitFor(() => expect(transport.written).toHaveLength(1));
    reply(0, [0x23, 0x01, 0x64, 0x00, 0x64, 0x00]);
    await pending;

    expect(seen[0]).toEqual(['tx', 0x22]);
    expect(seen.some(([d, c]) => d === 'rx' && c === 0x23)).toBe(true);
  });
});

describe('MdrClient.send', () => {
  it('honours an explicit reply opcode', async () => {
    const { client, transport, reply } = setup();
    // For commands whose reply is not `command + 1`. Sony SETs go through
    // `write` instead, since the device never answers them.
    const pending = client.send([0x58, 0x00, 0xa0, 0x02, 0x0a, 0x0a], {
      expectedReply: 0x57,
    });
    await vi.waitFor(() => expect(transport.written).toHaveLength(1));

    reply(0, [0x57, 0x00, 0xa0, 0x02, 0x0a, 0x0a]);
    expect(Array.from(await pending)[0]).toBe(0x57);
  });

  it('times out when the default reply opcode is wrong', async () => {
    vi.useFakeTimers();
    const transport = new FakeTransport();
    const client = new MdrClient(transport, { timeoutMs: 60 });

    // Default correlation expects 0x59, which is the notification, not the reply.
    const pending = client.send([0x58, 0x00, 0xa0, 0x02, 0x0a, 0x0a]);
    const assertion = expect(pending).rejects.toBeInstanceOf(MdrUnsupportedError);
    await vi.advanceTimersByTimeAsync(0);
    client.handleData(encodeFrame(DataType.Command1, 0, [0x57, 0x00, 0xa0, 0x02, 0x0a, 0x0a]));
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it('sends multi-byte payloads intact', async () => {
    const { client, transport, decodeWritten } = setup();
    void client.send([0x58, 0x00, 0xa0, 0x06, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f], {
      expectedReply: 0x57,
    });
    await vi.waitFor(() => expect(transport.written).toHaveLength(1));

    const [frame] = decodeWritten();
    expect(Array.from(frame.payload)).toEqual([
      0x58, 0x00, 0xa0, 0x06, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
    ]);
    expect(frame.checksumOk).toBe(true);
  });
});

describe('MdrClient.write', () => {
  it('resolves on the ACK, since a SET gets no reply', async () => {
    const { client, transport, ack } = setup();
    // 0x58 SetEq is acknowledged and applied; no RET ever arrives.
    const pending = client.write([0x58, 0x00, 0xa0, 0x02, 0x0a, 0x0a]);
    await vi.waitFor(() => expect(transport.written).toHaveLength(1));

    ack(0);
    await expect(pending).resolves.toBeUndefined();
  });

  it('sends the payload intact with a valid checksum', async () => {
    const { client, transport, ack, decodeWritten } = setup();
    const pending = client.write([0x58, 0x00, 0xa0, 0x02, 0x0a, 0x0b]);
    await vi.waitFor(() => expect(transport.written).toHaveLength(1));

    const [frame] = decodeWritten();
    expect(Array.from(frame.payload)).toEqual([0x58, 0x00, 0xa0, 0x02, 0x0a, 0x0b]);
    expect(frame.checksumOk).toBe(true);
    ack(0);
    await pending;
  });

  it('fails when the device never acknowledges', async () => {
    vi.useFakeTimers();
    const client = new MdrClient(new FakeTransport(), { timeoutMs: 60 });
    const pending = client.write([0x58, 0x00]);
    const assertion = expect(pending).rejects.toThrow(/no acknowledgement/);
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it('does not consume a reply meant for a pending request', async () => {
    const { client, transport, ack, reply } = setup();
    const pending = client.write([0x58, 0x00, 0xa0, 0x02, 0x0a, 0x0a]);
    await vi.waitFor(() => expect(transport.written).toHaveLength(1));

    const seen: number[][] = [];
    client.onNotification((f) => seen.push(Array.from(f.payload)));

    // The post-write notification is not an ACK and must not resolve the write.
    reply(0, [0x59, 0x00, 0xa0, 0x02, 0x0a, 0x0a]);
    expect(seen).toHaveLength(1);

    ack(0);
    await expect(pending).resolves.toBeUndefined();
  });

  it('rejects an outstanding write on abort', async () => {
    const { client, transport } = setup();
    const pending = client.write([0x58, 0x00]);
    await vi.waitFor(() => expect(transport.written).toHaveLength(1));

    client.abort(new Error('disconnected'));
    await expect(pending).rejects.toThrow('disconnected');
  });
});

describe('MdrClient.abort', () => {
  it('rejects the in-flight request and resets the sequence', async () => {
    const { client, transport } = setup();
    const pending = client.request(0x22, 0x01);
    await vi.waitFor(() => expect(transport.written).toHaveLength(1));

    client.abort(new Error('disconnected'));
    await expect(pending).rejects.toThrow('disconnected');
  });
});
