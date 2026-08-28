/**
 * HeyMelody SPP/RFCOMM framing.
 *
 *   0xAA | length (1-2 byte varint, MSB continuation bit) | body
 *   body = reserved(2, unidentified) | cmd(2, LE) | seq(1) | payLen(2, LE) | commandPayload(payLen)
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
/** The 2 reserved/unidentified bytes that sit between the length field and `cmd`. */
const RESERVED = [0x00, 0x00];
const BODY_HEADER_LENGTH = 7; // reserved(2) + cmd(2) + seq(1) + payLen(2)

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
    ...RESERVED,
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

/** Increments the sequence byte, wrapping 0x01-0xFE — see spec §3.2 for why this range and not 0x00-0xFF. */
export function nextSeq(current: number): number {
  const next = current + 1;
  return next > 0xfe ? 0x01 : next;
}

export class SppFrameDecoder {
  #buffer = new Uint8Array(0);

  push(chunk: Uint8Array): HeyMelodyFrame[] {
    const merged = new Uint8Array(this.#buffer.length + chunk.length);
    merged.set(this.#buffer, 0);
    merged.set(chunk, this.#buffer.length);
    this.#buffer = merged;

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

      const MAX_BODY_LENGTH = 512; // spec §3.2's documented SPP max frame size
      if (bodyLength > MAX_BODY_LENGTH) {
        // Implausible — this 0xAA was data, not a real sync byte. Drop it and resync at the next one.
        this.#buffer = this.#buffer.slice(1);
        continue;
      }

      const total = headerLength + bodyLength;
      if (this.#buffer.length < total) break; // wait for the rest of the frame

      const body = this.#buffer.slice(headerLength, total);
      this.#buffer = this.#buffer.slice(total);

      if (body.length < BODY_HEADER_LENGTH) continue; // too short to carry cmd/seq/payLen at all — drop

      const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
      const cmd = view.getUint16(2, true);
      const seq = body[4];
      const payLen = view.getUint16(5, true);
      const payload = body.slice(BODY_HEADER_LENGTH);

      frames.push({ cmd, seq, payload, lengthOk: payLen === payload.length });
    }

    return frames;
  }

  reset(): void {
    this.#buffer = new Uint8Array(0);
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
