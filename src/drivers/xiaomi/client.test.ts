import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeTransport } from '@/core/fakeTransport.test-helper';
import { XiaomiClient, XiaomiRejectedError, XiaomiUnansweredError } from './client';
import { FrameType, createDeframer, encodeFrame } from './frame';
import type { XiaomiFrame } from './frame';

function setup(timeoutMs = 50) {
  let transport!: FakeTransport;
  const client = new XiaomiClient(
    (transport = new FakeTransport({ onData: (chunk) => client.handleData(chunk), onClose: () => undefined })),
    { timeoutMs },
  );
  const sent = (): XiaomiFrame[] => {
    const deframer = createDeframer();
    return transport.written.flatMap((bytes) => deframer.push(bytes));
  };
  const respond = (to: XiaomiFrame, payload: number[], status = 0) =>
    transport.receive(encodeFrame({ type: FrameType.Response, opcode: to.opcode, seq: to.seq, status, payload: Uint8Array.from(payload) }));
  return { client, transport, sent, respond };
}

describe('XiaomiClient', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends a request and resolves with the matching response payload', async () => {
    const { client, sent, respond } = setup();
    const reply = client.request(0x09, [0xff, 0xff, 0xff, 0xff]);
    const [request] = sent();
    expect(request).toMatchObject({ type: 0xc4, opcode: 0x09 });
    respond(request, [2, 9, 1]);
    expect(Array.from(await reply)).toEqual([2, 9, 1]);
  });

  it('matches replies by sequence number, whatever order they arrive in', async () => {
    const { client, sent, respond } = setup();
    const first = client.request(0xf3, [0, 0x0b]);
    const second = client.request(0xf3, [0, 0x07]);
    const [a, b] = sent();
    expect(a.seq).not.toBe(b.seq);
    respond(b, [3, 0, 7, 5]);
    respond(a, [4, 0, 0x0b, 1, 2]);
    expect(Array.from(await first)).toEqual([4, 0, 0x0b, 1, 2]);
    expect(Array.from(await second)).toEqual([3, 0, 7, 5]);
  });

  it('ignores a response whose opcode does not match its sequence number', async () => {
    const { client, sent, transport } = setup();
    const reply = client.request(0x09);
    const [request] = sent();
    transport.receive(encodeFrame({ type: FrameType.Response, opcode: 0x02, seq: request.seq, status: 0, payload: new Uint8Array() }));
    const settled = vi.fn();
    reply.then(settled, settled);
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    await expect(reply).rejects.toBeInstanceOf(XiaomiUnansweredError);
  });

  it('rejects a response with a non-zero status', async () => {
    const { client, sent, respond } = setup();
    const reply = client.request(0xf2, [3, 0, 7, 9]);
    const caught = reply.catch((error: unknown) => error);
    respond(sent()[0], [], 1);
    const error = await caught;
    expect(error).toBeInstanceOf(XiaomiRejectedError);
    expect((error as XiaomiRejectedError).status).toBe(1);
  });

  it('rejects an unanswered request after its timeout', async () => {
    const { client } = setup(30);
    const reply = client.request(0x02);
    const caught = reply.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(40);
    expect(await caught).toBeInstanceOf(XiaomiUnansweredError);
  });

  it('answers an earbud request with an echo of its opcode and sequence', () => {
    const { client, sent, transport } = setup();
    client.onInbound(() => [1]);
    transport.receive(encodeFrame({ type: FrameType.EarbudsRequest, opcode: 0x51, seq: 0x42, status: 0, payload: Uint8Array.of(1) }));
    expect(sent()).toEqual([{ type: 0x04, opcode: 0x51, seq: 0x42, status: 0, payload: Uint8Array.of(1) }]);
  });

  it('acknowledges a notification with an empty payload when nothing is returned', () => {
    const { client, sent, transport } = setup();
    const seen = vi.fn();
    client.onInbound(seen);
    transport.receive(encodeFrame({ type: FrameType.EarbudsNotify, opcode: 0xf4, seq: 3, status: 0, payload: Uint8Array.of(3, 0, 7, 1) }));
    expect(seen).toHaveBeenCalledOnce();
    expect(sent()).toEqual([{ type: 0x04, opcode: 0xf4, seq: 3, status: 0, payload: new Uint8Array() }]);
  });

  it('still acknowledges when the handler throws', () => {
    const { client, sent, transport } = setup();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    client.onInbound(() => {
      throw new Error('boom');
    });
    transport.receive(encodeFrame({ type: FrameType.EarbudsRequest, opcode: 0x0e, seq: 9, status: 0, payload: new Uint8Array() }));
    expect(sent()).toHaveLength(1);
  });

  it('reports raw bytes in both directions', () => {
    const { client, transport } = setup();
    const raw = vi.fn();
    client.onRaw(raw);
    void client.request(0x02).catch(() => undefined);
    transport.receive(Uint8Array.of(1, 2, 3));
    expect(raw.mock.calls.map(([, direction]) => direction)).toEqual(['tx', 'rx']);
  });

  it('rejects everything outstanding on abort', async () => {
    const { client } = setup();
    const a = client.request(0x02).catch((error: unknown) => error);
    const b = client.request(0x09).catch((error: unknown) => error);
    client.abort(new Error('closed'));
    expect(((await a) as Error).message).toBe('closed');
    expect(((await b) as Error).message).toBe('closed');
  });

  it('rejects when the write fails', async () => {
    const { client, transport } = setup();
    transport.isOpen = false;
    await expect(client.request(0x02)).rejects.toThrow('transport is closed');
  });
});
