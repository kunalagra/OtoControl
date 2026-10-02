import { describe, expect, it } from 'vitest';

import { FakeTransport } from '@/core/fakeTransport.test-helper';
import { PixelBudsChannelError, PixelBudsClient, PixelBudsTimeoutError } from './client';
import { createHdlcDecoder, encodeFrame } from './hdlc';
import { MAESTRO_SERVICE, Method } from './maestro';
import { ANNOUNCE_CALL_ID, decodeRpcPacket, encodeRpcPacket, hdlcAddress, PacketType, Peer, RpcError, rpcHash } from './rpc';
import type { RpcPacket } from './rpc';

const SERVICE = rpcHash(MAESTRO_SERVICE);
const frameOf = (packet: Parameters<typeof encodeRpcPacket>[0]) =>
  encodeFrame(hdlcAddress(Peer.LeftBtCore, Peer.MaestroA), encodeRpcPacket(packet));

interface Rig {
  client: PixelBudsClient;
  transport: FakeTransport;
  sent: RpcPacket[];
  deliver(packet: Parameters<typeof encodeRpcPacket>[0]): void;
}

function rig(options: ConstructorParameters<typeof PixelBudsClient>[1] = {}): Rig {
  let client!: PixelBudsClient;
  const transport = new FakeTransport({ onData: (chunk) => client.handleData(chunk), onClose: () => {} });
  client = new PixelBudsClient(transport, { timeoutMs: 40, discoveryWaitMs: 30, channelProbeMs: 15, ...options });
  const sent: RpcPacket[] = [];
  const decoder = createHdlcDecoder();
  transport.onWrite = (bytes) => {
    for (const frame of decoder.push(bytes)) sent.push(decodeRpcPacket(frame.data));
  };
  return { client, transport, sent, deliver: (packet) => transport.receive(frameOf(packet)) };
}

/** Lets the call queue send what it holds. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const announce = (channel: number) => ({
  type: PacketType.Response,
  channelId: channel,
  serviceId: SERVICE,
  methodId: rpcHash(Method.GetSoftwareInfo),
  callId: ANNOUNCE_CALL_ID,
});

describe('channel discovery', () => {
  it('takes the channel from the buds’ own announcement, even one that arrived before the question', async () => {
    const { client, deliver, sent } = rig();
    deliver(announce(21));
    expect(await client.discoverChannel()).toBe(21);
    expect(client.channel).toBe(21);
    expect(client.channelWasProbed).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('waits for an announcement that arrives during the wait', async () => {
    const { client, deliver } = rig({ discoveryWaitMs: 200 });
    const found = client.discoverChannel();
    setTimeout(() => deliver(announce(24)), 10);
    expect(await found).toBe(24);
  });

  it('ignores traffic on a channel that is not a candidate', async () => {
    const { client, deliver } = rig({ discoveryWaitMs: 20, channelProbeMs: 5 });
    deliver(announce(20));
    await expect(client.discoverChannel()).rejects.toBeInstanceOf(PixelBudsChannelError);
  });

  // Active probe, as MagicPodsCore and pb2pcd send it on real Pro 2 hardware: GetSoftwareInfo with call id
  // 0xffffffff on channel 18, the reply naming whichever channel the buds serve (spec §9, 1).
  it('asks once on channel 18 with the announcement call id when nothing is announced, and takes the reply’s channel', async () => {
    const { client, deliver, sent } = rig();
    const found = client.discoverChannel();
    const timer = setInterval(() => {
      if (sent.length > 0) deliver(announce(21));
    }, 2);
    expect(await found).toBe(21);
    clearInterval(timer);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: PacketType.Request,
      channelId: 18,
      serviceId: SERVICE,
      methodId: rpcHash(Method.GetSoftwareInfo),
      callId: ANNOUNCE_CALL_ID,
    });
    expect(client.channelWasProbed).toBe(true);
  });

  it('then tries the bud channels before the second case channel, all with the announcement call id', async () => {
    const { client, sent } = rig();
    await expect(client.discoverChannel()).rejects.toBeInstanceOf(PixelBudsChannelError);
    expect(sent.map((packet) => packet.channelId)).toEqual([18, 19, 21, 24, 26, 23]);
    expect(sent.every((packet) => packet.callId === ANNOUNCE_CALL_ID && packet.type === PacketType.Request)).toBe(true);
  });

  it('stops waiting when aborted', async () => {
    const { client } = rig({ discoveryWaitMs: 5000 });
    const found = client.discoverChannel();
    client.abort(new Error('link lost'));
    await expect(found).rejects.toThrow('link lost');
  });
});

describe('unary calls', () => {
  async function ready() {
    const r = rig();
    r.deliver(announce(19));
    await r.client.discoverChannel();
    return r;
  }

  it('sends an HDLC-framed request on the discovered channel and resolves with the payload', async () => {
    const { client, sent, deliver, transport } = await ready();
    const call = client.call(Method.ReadSetting, Uint8Array.of(0x20, 0x0d));
    await tick();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 0, channelId: 19, serviceId: SERVICE, methodId: rpcHash(Method.ReadSetting), callId: 0 });
    expect(Array.from(sent[0].payload)).toEqual([0x20, 0x0d]);
    // The wire bytes begin with a flag, the MaestroA -> LeftBtCore address, and control 03.
    expect(Array.from(transport.written[0].slice(0, 4))).toEqual([0x7e, 0x00, 0x3b, 0x03]);
    deliver({ type: PacketType.Response, channelId: 19, serviceId: SERVICE, methodId: rpcHash(Method.ReadSetting), payload: Uint8Array.of(7) });
    expect(Array.from(await call)).toEqual([7]);
  });

  it('rejects with the status the buds answered', async () => {
    const { client, deliver } = await ready();
    const call = client.call(Method.ReadSetting, Uint8Array.of(0x20, 0x08));
    await tick();
    deliver({ type: PacketType.Response, channelId: 19, serviceId: SERVICE, methodId: rpcHash(Method.ReadSetting), status: 2 });
    await expect(call).rejects.toMatchObject({ name: 'RpcError', status: 2 });
    await expect(call).rejects.toBeInstanceOf(RpcError);
  });

  it('rejects on a server error packet, even with a zero status', async () => {
    const { client, deliver } = await ready();
    const call = client.call(Method.GetHardwareInfo);
    await tick();
    deliver({ type: PacketType.ServerError, channelId: 19, serviceId: SERVICE, methodId: rpcHash(Method.GetHardwareInfo), status: 5 });
    await expect(call).rejects.toMatchObject({ status: 5 });
  });

  it('times out an unanswered call and carries on with the next', async () => {
    const { client, deliver } = await ready();
    const first = client.call(Method.GetHardwareInfo, undefined, { timeoutMs: 10 });
    const second = client.call(Method.GetSoftwareInfo);
    await expect(first).rejects.toBeInstanceOf(PixelBudsTimeoutError);
    await tick();
    deliver({ type: PacketType.Response, channelId: 19, serviceId: SERVICE, methodId: rpcHash(Method.GetSoftwareInfo), payload: Uint8Array.of(1) });
    expect(Array.from(await second)).toEqual([1]);
  });

  it('keeps one call in flight at a time, in order', async () => {
    const { client, sent, deliver } = await ready();
    const a = client.call(Method.GetSoftwareInfo);
    const b = client.call(Method.GetHardwareInfo);
    await tick();
    expect(sent).toHaveLength(1);
    deliver({ type: PacketType.Response, channelId: 19, serviceId: SERVICE, methodId: rpcHash(Method.GetSoftwareInfo) });
    await a;
    await tick();
    expect(sent).toHaveLength(2);
    deliver({ type: PacketType.Response, channelId: 19, serviceId: SERVICE, methodId: rpcHash(Method.GetHardwareInfo) });
    await b;
  });

  it('rejects before a channel is known', async () => {
    const { client } = rig();
    await expect(client.call(Method.GetSoftwareInfo)).rejects.toBeInstanceOf(PixelBudsChannelError);
  });

  it('rejects a pending call and queued ones on abort', async () => {
    const { client } = await ready();
    const first = client.call(Method.GetSoftwareInfo);
    const second = client.call(Method.GetHardwareInfo);
    client.abort(new Error('gone'));
    await expect(first).rejects.toThrow('gone');
    await expect(second).rejects.toThrow('gone');
  });

  it('rejects the call when the write fails', async () => {
    const { client, transport } = await ready();
    transport.isOpen = false;
    await expect(client.call(Method.GetSoftwareInfo)).rejects.toThrow('transport is closed');
  });
});

describe('server streams', () => {
  async function ready() {
    const r = rig();
    r.deliver(announce(19));
    await r.client.discoverChannel();
    return r;
  }

  it('sends a request and delivers each pushed message', async () => {
    const { client, sent, deliver } = await ready();
    const got: number[][] = [];
    client.subscribe(Method.SubscribeRuntimeInfo, (payload) => got.push(Array.from(payload)));
    expect(sent[0]).toMatchObject({ type: 0, channelId: 19, methodId: rpcHash(Method.SubscribeRuntimeInfo) });
    const push = (payload: number[]) =>
      deliver({ type: PacketType.ServerStream, channelId: 19, serviceId: SERVICE, methodId: rpcHash(Method.SubscribeRuntimeInfo), payload: Uint8Array.from(payload) });
    push([1]);
    push([2, 3]);
    expect(got).toEqual([[1], [2, 3]]);
  });

  it('cancels with a client error when unsubscribed, and then ignores pushes', async () => {
    const { client, sent, deliver } = await ready();
    const got: number[][] = [];
    const cancel = client.subscribe(Method.SubscribeRuntimeInfo, (payload) => got.push(Array.from(payload)));
    cancel();
    expect(sent[1]).toMatchObject({ type: PacketType.ClientError, status: 1, methodId: rpcHash(Method.SubscribeRuntimeInfo) });
    deliver({ type: PacketType.ServerStream, channelId: 19, serviceId: SERVICE, methodId: rpcHash(Method.SubscribeRuntimeInfo), payload: Uint8Array.of(1) });
    expect(got).toEqual([]);
    cancel();
    expect(sent).toHaveLength(2);
  });

  it('reports the status when the server ends the stream, and when aborted', async () => {
    const { client, deliver } = await ready();
    const ended: number[] = [];
    client.subscribe(Method.SubscribeRuntimeInfo, () => {}, (status) => ended.push(status));
    client.subscribe(Method.SubscribeToSettingsChanges, () => {}, (status) => ended.push(status));
    deliver({ type: PacketType.Response, channelId: 19, serviceId: SERVICE, methodId: rpcHash(Method.SubscribeRuntimeInfo), status: 14 });
    expect(ended).toEqual([14]);
    client.abort(new Error('gone'));
    expect(ended).toEqual([14, 1]);
  });
});

describe('raw tap and damage', () => {
  it('reports bytes both ways, including frames the decoder drops', async () => {
    const { client, transport, deliver } = rig();
    const seen: string[] = [];
    client.onRaw((bytes, direction) => seen.push(`${direction}:${bytes.length}`));
    deliver(announce(19));
    await client.discoverChannel();
    transport.receive(Uint8Array.of(0x7e, 1, 2, 3, 0x7e));
    void client.call(Method.GetSoftwareInfo).catch(() => {});
    await tick();
    expect(seen[0]).toMatch(/^rx:/);
    expect(seen[1]).toBe('rx:5');
    expect(seen[2]).toMatch(/^tx:/);
  });

  it('survives a frame whose RpcPacket is not valid protobuf', async () => {
    const { client, transport } = rig();
    transport.receive(encodeFrame(3712, [0x0a, 0xff]));
    expect(client.channel).toBeNull();
  });

  it('unsubscribes a raw listener', () => {
    const { client, transport } = rig();
    const seen: number[] = [];
    const off = client.onRaw((bytes) => seen.push(bytes.length));
    off();
    transport.receive(Uint8Array.of(1));
    expect(seen).toEqual([]);
  });
});
