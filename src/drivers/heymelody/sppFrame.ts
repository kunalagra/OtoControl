/**
 * HeyMelody SPP/RFCOMM framing.
 *
 *   0xAA | length (1-2 byte varint, MSB continuation bit) | body
 *   body = ctrl(1) | reserved(1) | [frame counter, multi-frame only] | packet
 *   packet = cmd(2, LE) | seq(1) | payLen(2, LE) | commandPayload(payLen)
 *
 * `ctrl` bits 0-1 are the frame sequence number: 0 single, 1 first, 2 middle,
 * 3 last; a multi-frame run's parts concatenate into one packet
 * (realme `OPPOv1Wrapper.java:65-98`).
 *
 * The outer shell (0xAA + varint length) is derived directly from the app's
 * own decompiled read loop. The body layout is corroborated by three
 * independent open-source reimplementations of the OPPO protocol, generalised
 * from their fixed-single-length-byte assumption to work after either 1 or 2
 * varint length bytes — see
 * docs/superpowers/specs/2026-08-27-heymelody-driver-design.md §3.2 for the
 * full derivation and what remains unverified against the app itself.
 *
 * No checksum/CRC anywhere — confirmed, not a gap.
 */

const SYNC = 0xaa;
/** `ctrl` (single frame, FSN 0) and the reserved byte that follows it. */
const SINGLE_FRAME_PREFIX = [0x00, 0x00];
const PACKET_HEADER_LENGTH = 5; // cmd(2) + seq(1) + payLen(2)
const MAX_BODY_LENGTH = 2000;

export interface HeyMelodyFrame {
  cmd: number;
  seq: number;
  payload: Uint8Array;
  /** False when the body's own `payLen` field disagrees with the bytes actually carried. */
  lengthOk: boolean;
}

/** Encodes a varint length: 1 byte if it fits in 7 bits, else 2. */
function encodeLength(bodyLength: number): number[] {
  if (bodyLength < 0x80) return [bodyLength];
  return [(bodyLength & 0x7f) | 0x80, (bodyLength >> 7) & 0x7f];
}

export function encodeSppFrame(cmd: number, seq: number, payload: ArrayLike<number> = []): Uint8Array {
  const payloadArray = Array.from(payload);
  const body = [
    ...SINGLE_FRAME_PREFIX,
    cmd & 0xff,
    (cmd >> 8) & 0xff,
    seq & 0xff,
    payloadArray.length & 0xff,
    (payloadArray.length >> 8) & 0xff,
    ...payloadArray,
  ];
  const length = encodeLength(body.length);
  return Uint8Array.from([SYNC, ...length, ...body]);
}

/** Full-range per-client counter, wrapping 0xFF to 0x00 (HeyTap `PacketFactory`, `p072f7/b.java:26-45`). */
export function nextSeq(current: number): number {
  return (current + 1) & 0xff;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function parsePacket(packet: Uint8Array): HeyMelodyFrame | null {
  if (packet.length < PACKET_HEADER_LENGTH) return null;
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  const payload = packet.slice(PACKET_HEADER_LENGTH);
  return { cmd: view.getUint16(0, true), seq: packet[2], payload, lengthOk: view.getUint16(3, true) === payload.length };
}

export class SppFrameDecoder {
  #buffer: Uint8Array = new Uint8Array(0);
  #partial: Uint8Array | null = null;

  push(chunk: Uint8Array): HeyMelodyFrame[] {
    this.#buffer = concat(this.#buffer, chunk);
    const frames: HeyMelodyFrame[] = [];

    for (;;) {
      const start = this.#buffer.indexOf(SYNC);
      if (start === -1) {
        this.#buffer = new Uint8Array(0);
        break;
      }
      if (start > 0) this.#buffer = this.#buffer.slice(start);
      if (this.#buffer.length < 2) break; // need at least the sync byte + first length byte

      const firstLenByte = this.#buffer[1];
      const twoByteLength = (firstLenByte & 0x80) !== 0;
      const headerLength = twoByteLength ? 3 : 2;
      if (this.#buffer.length < headerLength) break; // second length byte not in yet

      const bodyLength = twoByteLength
        ? (firstLenByte & 0x7f) | ((this.#buffer[2] & 0x7f) << 7)
        : firstLenByte & 0x7f;

      if (bodyLength > MAX_BODY_LENGTH) {
        // Implausible — this 0xAA was data, not a real sync byte. Drop it and resync at the next one.
        this.#buffer = this.#buffer.slice(1);
        continue;
      }

      const total = headerLength + bodyLength;
      if (this.#buffer.length < total) break; // wait for the rest of the frame

      const body = this.#buffer.slice(headerLength, total);
      this.#buffer = this.#buffer.slice(total);

      const packet = this.#assemble(body);
      const frame = packet ? parsePacket(packet) : null;
      if (frame) frames.push(frame);
    }

    return frames;
  }

  /** The complete packet once a frame (or the last part of a run) completes it. */
  #assemble(body: Uint8Array): Uint8Array | null {
    if (body.length < 2) return null;
    const fsn = body[0] & 0x03;
    if (fsn === 0) {
      this.#partial = null;
      return body.slice(2);
    }
    if (body.length < 3) return null;
    const part = body.slice(3); // ctrl, reserved, frame counter
    if (fsn === 1) {
      this.#partial = part;
      return null;
    }
    if (!this.#partial) return null;
    this.#partial = concat(this.#partial, part);
    if (fsn === 2) return null;
    const packet = this.#partial;
    this.#partial = null;
    return packet;
  }

  reset(): void {
    this.#buffer = new Uint8Array(0);
    this.#partial = null;
  }
}

/**
 * The seam `HeyMelodyClient` depends on instead of a hardcoded byte shell —
 * `SppFrameCodec` is the only implementation this phase; phase B adds
 * `GattFrameCodec` behind the same interface with no client changes.
 */
export interface FrameCodec {
  encode(cmd: number, seq: number, payload: ArrayLike<number>): Uint8Array;
  createDecoder(): { push(chunk: Uint8Array): HeyMelodyFrame[]; reset(): void };
}

export class SppFrameCodec implements FrameCodec {
  encode(cmd: number, seq: number, payload: ArrayLike<number> = []): Uint8Array {
    return encodeSppFrame(cmd, seq, payload);
  }

  createDecoder(): SppFrameDecoder {
    return new SppFrameDecoder();
  }
}
