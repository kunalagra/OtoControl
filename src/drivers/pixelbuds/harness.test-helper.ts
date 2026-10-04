/**
 * A scripted pair of earbuds for tests: the Maestro end of the link.
 *
 * It decodes the HDLC frames a client writes, answers the RPCs a script names,
 * and pushes server-stream messages and the unsolicited channel announcement
 * the way real buds do. Frames are built with the production codec; the
 * fixtures that matter (packet bytes, message layouts) are pinned by the
 * hand-written vectors in `rpc.test.ts`, `maestro.test.ts` and `hdlc.test.ts`,
 * so reusing it here does not make those tests circular.
 */

import { FakeTransport } from '@/core/fakeTransport.test-helper';
import type { TransportOpener } from '@/core/transport';
import { createHdlcDecoder, encodeFrame } from './hdlc';
import { MAESTRO_SERVICE, Method } from './maestro';
import { ANNOUNCE_CALL_ID, decodeRpcPacket, encodeRpcPacket, hdlcAddress, PacketType, Peer, rpcHash } from './rpc';
import type { RpcPacket } from './rpc';

export interface UnaryReply {
  payload?: ArrayLike<number>;
  /** pw_rpc status; non-zero makes the reply an error response. */
  status?: number;
}

export interface BudsScript {
  /** The channel these buds serve. Requests on any other channel are ignored. */
  channel: number;
  /** Push the unsolicited `GetSoftwareInfo` reply a moment after connect. */
  announce: boolean;
  /** Answers by method name; `null` or a missing method stays silent. */
  unary: Record<string, (request: RpcPacket) => UnaryReply | null>;
  /** Messages pushed (in order) when a stream method is requested. */
  streams: Record<string, ArrayLike<number>[]>;
}

export const budsScript = (overrides: Partial<BudsScript> = {}): BudsScript => ({
  channel: 19,
  announce: true,
  unary: {},
  streams: {},
  ...overrides,
});

export interface FakeBuds {
  readonly open: TransportOpener;
  /** Every RpcPacket the client sent, in order. */
  readonly requests: RpcPacket[];
  /** The live transport, once opened. */
  transport(): FakeTransport;
  /** Pushes a server-stream message as though the buds sent it. */
  push(method: string, payload: ArrayLike<number>): void;
  /** Announces `channel` unprompted, as the buds do when the hosting bud changes; it serves requests from then on. */
  announce(channel: number): void;
}

const deviceFrame = (packet: Parameters<typeof encodeRpcPacket>[0]): Uint8Array =>
  encodeFrame(hdlcAddress(Peer.LeftBtCore, Peer.MaestroA), encodeRpcPacket(packet));

export function fakeBuds(script: BudsScript): FakeBuds {
  const requests: RpcPacket[] = [];
  let live: FakeTransport | null = null;
  const methodName = new Map(Object.values(Method).map((name) => [rpcHash(name), name as string]));

  const open: TransportOpener = async (_target, handlers) => {
    const transport = new FakeTransport(handlers);
    live = transport;
    const decoder = createHdlcDecoder();
    transport.onWrite = (bytes) => {
      for (const frame of decoder.push(bytes)) {
        const request = decodeRpcPacket(frame.data);
        requests.push(request);
        if (request.type !== PacketType.Request || request.channelId !== script.channel) continue;
        const name = methodName.get(request.methodId) ?? '';
        const streamed = script.streams[name];
        if (streamed) {
          for (const payload of streamed) {
            queueMicrotask(() =>
              transport.receive(
                deviceFrame({
                  type: PacketType.ServerStream,
                  channelId: request.channelId,
                  serviceId: request.serviceId,
                  methodId: request.methodId,
                  payload: Uint8Array.from(payload),
                }),
              ),
            );
          }
          continue;
        }
        const reply = script.unary[name]?.(request);
        if (!reply) continue;
        queueMicrotask(() =>
          transport.receive(
            deviceFrame({
              type: PacketType.Response,
              channelId: request.channelId,
              serviceId: request.serviceId,
              methodId: request.methodId,
              payload: Uint8Array.from(reply.payload ?? []),
              status: reply.status ?? 0,
            }),
          ),
        );
      }
    };
    if (script.announce) {
      setTimeout(() => {
        const info = script.unary[Method.GetSoftwareInfo]?.({} as RpcPacket);
        transport.receive(
          deviceFrame({
            type: PacketType.Response,
            channelId: script.channel,
            serviceId: rpcHash(MAESTRO_SERVICE),
            methodId: rpcHash(Method.GetSoftwareInfo),
            payload: Uint8Array.from(info?.payload ?? []),
            callId: ANNOUNCE_CALL_ID,
          }),
        );
      }, 0);
    }
    return transport;
  };

  return {
    open,
    requests,
    transport: () => {
      if (!live) throw new Error('not opened yet');
      return live;
    },
    announce: (channel) => {
      script.channel = channel;
      if (!live) throw new Error('not opened yet');
      live.receive(
        deviceFrame({
          type: PacketType.Response,
          channelId: channel,
          serviceId: rpcHash(MAESTRO_SERVICE),
          methodId: rpcHash(Method.GetSoftwareInfo),
          callId: ANNOUNCE_CALL_ID,
        }),
      );
    },
    push: (method, payload) => {
      live?.receive(
        deviceFrame({
          type: PacketType.ServerStream,
          channelId: script.channel,
          serviceId: rpcHash(MAESTRO_SERVICE),
          methodId: rpcHash(method),
          payload: Uint8Array.from(payload),
        }),
      );
    },
  };
}
