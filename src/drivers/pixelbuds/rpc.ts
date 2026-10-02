/**
 * Pigweed RPC packets and the Maestro addressing that carries them.
 *
 * A packet is a protobuf `pw.rpc.packet.RpcPacket`. Services and methods are
 * named on the wire by a hash of their name (never a table), and each earbud
 * conversation has a fixed channel id. Everything here is checked against
 * the companion app and qzed/pbpctrl — see
 * docs/superpowers/specs/2026-10-02-pixelbuds-driver-design.md §4.
 */

import { parseFields, pb, varintOf } from './protobuf';

export const PacketType = {
  Request: 0,
  Response: 1,
  ClientError: 4,
  ServerError: 5,
  ServerStream: 7,
} as const;

/** pw_rpc's `Status`, as far as a reply from the buds can use it. */
export const RpcStatus = {
  Ok: 0,
  Cancelled: 1,
  Unknown: 2,
  InvalidArgument: 3,
  NotFound: 5,
  Unimplemented: 12,
  Unavailable: 14,
} as const;

const STATUS_NAME: Record<number, string> = {
  0: 'OK',
  1: 'CANCELLED',
  2: 'UNKNOWN',
  3: 'INVALID_ARGUMENT',
  4: 'DEADLINE_EXCEEDED',
  5: 'NOT_FOUND',
  6: 'ALREADY_EXISTS',
  7: 'PERMISSION_DENIED',
  8: 'RESOURCE_EXHAUSTED',
  9: 'FAILED_PRECONDITION',
  10: 'ABORTED',
  11: 'OUT_OF_RANGE',
  12: 'UNIMPLEMENTED',
  13: 'INTERNAL',
  14: 'UNAVAILABLE',
  15: 'DATA_LOSS',
  16: 'UNAUTHENTICATED',
};

export const statusName = (status: number): string => STATUS_NAME[status] ?? `status ${status}`;

/** A call the buds answered with a non-zero status — a setting that this model does not have, typically. */
export class RpcError extends Error {
  readonly status: number;
  constructor(what: string, status: number) {
    super(`${what} failed: ${statusName(status)}`);
    this.name = 'RpcError';
    this.status = status;
  }
}

/** Pigweed's 65599 name hash, over the UTF-8 bytes, in wrapping 32-bit arithmetic. */
export function rpcHash(name: string): number {
  const encoded = new TextEncoder().encode(name);
  let hash = encoded.length;
  let coefficient = 65599;
  for (const byte of encoded) {
    hash = (hash + Math.imul(coefficient, byte)) >>> 0;
    coefficient = Math.imul(coefficient, 65599) >>> 0;
  }
  return hash >>> 0;
}

export interface RpcPacket {
  type: number;
  channelId: number;
  serviceId: number;
  methodId: number;
  payload: Uint8Array;
  status: number;
  callId: number;
}

/**
 * The call id the buds put on the unsolicited `GetSoftwareInfo` reply they send
 * at connect. pbpctrl names the channel by waiting for exactly this.
 */
export const ANNOUNCE_CALL_ID = 0xffffffff;

/** proto3: a zero field is left out, so a plain request carries neither `type` nor `call_id`. */
export function encodeRpcPacket(packet: Partial<RpcPacket> & Pick<RpcPacket, 'channelId' | 'serviceId' | 'methodId'>): Uint8Array {
  const { type = 0, channelId, serviceId, methodId, payload, status = 0, callId = 0 } = packet;
  return Uint8Array.from([
    ...(type !== 0 ? pb.varint(1, type) : []),
    ...pb.varint(2, channelId),
    ...pb.fixed32(3, serviceId),
    ...pb.fixed32(4, methodId),
    ...(payload && payload.length > 0 ? pb.bytes(5, payload) : []),
    ...(status !== 0 ? pb.varint(6, status) : []),
    ...(callId !== 0 ? pb.varint(7, callId) : []),
  ]);
}

export function decodeRpcPacket(bytes: Uint8Array): RpcPacket {
  const fields = parseFields(bytes);
  const payload = fields.filter((field) => field.field === 5 && field.wire === 2).pop()?.bytes ?? new Uint8Array(0);
  const fixed = (n: number): number => fields.filter((field) => field.field === n && field.wire === 5).pop()?.value ?? 0;
  return {
    type: varintOf(fields, 1),
    channelId: varintOf(fields, 2),
    serviceId: fixed(3),
    methodId: fixed(4),
    payload,
    status: varintOf(fields, 6),
    callId: varintOf(fields, 7),
  };
}

// --- addressing ------------------------------------------------------------------

/** Peers on the earbuds' internal bus; only these ever appear in a Maestro address. */
export const Peer = {
  Case: 2,
  LeftBtCore: 3,
  RightBtCore: 4,
  MaestroA: 10,
  MaestroB: 13,
} as const;

/** HDLC address for a frame from `source` to `target`: `(src & 15) << 6 | (dst & 15) << 10`. */
export const hdlcAddress = (source: number, target: number): number => ((source & 15) << 6) | ((target & 15) << 10);

/**
 * The six channels a Maestro server may speak on, in the order pbpctrl tries them
 * (MaestroA before MaestroB; case, left bud, right bud). The sensor-hub channels
 * (20, 22, 25, 27) exist but are not conversations with the settings service.
 */
export const CANDIDATE_CHANNELS: ReadonlyArray<{ channel: number; local: number; remote: number }> = [
  { channel: 18, local: Peer.MaestroA, remote: Peer.Case },
  { channel: 19, local: Peer.MaestroA, remote: Peer.LeftBtCore },
  { channel: 21, local: Peer.MaestroA, remote: Peer.RightBtCore },
  { channel: 23, local: Peer.MaestroB, remote: Peer.Case },
  { channel: 24, local: Peer.MaestroB, remote: Peer.LeftBtCore },
  { channel: 26, local: Peer.MaestroB, remote: Peer.RightBtCore },
];

/** The HDLC address to send a packet on `channel` with, or null for a channel we do not know. */
export function addressForChannel(channel: number): number | null {
  const entry = CANDIDATE_CHANNELS.find((candidate) => candidate.channel === channel);
  return entry ? hdlcAddress(entry.local, entry.remote) : null;
}
