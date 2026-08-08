/**
 * Sony MDR wire framing.
 *
 *   0x3E | dataType seq length(u32 BE) payload checksum | 0x3C
 *
 * with 0x3E, 0x3C and 0x3D escaped inside the frame. Structurally unlike GAIA:
 * delimited rather than length-only, escaped, checksummed, and every data frame
 * must be acknowledged.
 *
 * Verified against a Sony WF-C500 (protocol v2, firmware 1.0.7).
 */

export const SOF = 0x3e;
export const EOF_MARKER = 0x3c;
export const ESC = 0x3d;

/** Header is dataType + seq + u32 length. */
export const HEADER_LENGTH = 6;

export const DataType = {
  Ack: 0x01,
  /** Table 1 — the main command set. */
  Command1: 0x0c,
  /** Table 2 — a small supplementary set (voice guidance). */
  Command2: 0x0e,
} as const;

export type DataTypeId = (typeof DataType)[keyof typeof DataType];

export interface MdrFrame {
  dataType: number;
  sequence: number;
  payload: Uint8Array;
  /** False when the trailing byte disagrees with the computed sum. */
  checksumOk: boolean;
  raw: Uint8Array;
}

export const checksum = (bytes: ArrayLike<number>): number => {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 1) sum = (sum + bytes[i]) & 0xff;
  return sum;
};

/**
 * The three framing bytes cannot appear raw inside a frame; each is replaced by
 * ESC followed by the byte with bit 4 cleared.
 */
export function escape(bytes: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i];
    if (byte === SOF || byte === EOF_MARKER || byte === ESC) out.push(ESC, byte & 0xef);
    else out.push(byte);
  }
  return out;
}

export function unescape(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] === ESC && i + 1 < bytes.length) {
      out.push(bytes[i + 1] | 0x10);
      i += 1;
    } else {
      out.push(bytes[i]);
    }
  }
  return Uint8Array.from(out);
}

export function encodeFrame(
  dataType: number,
  sequence: number,
  payload: ArrayLike<number> = [],
): Uint8Array {
  const inner = [
    dataType,
    sequence,
    (payload.length >>> 24) & 0xff,
    (payload.length >>> 16) & 0xff,
    (payload.length >>> 8) & 0xff,
    payload.length & 0xff,
    ...Array.from(payload as ArrayLike<number>),
  ];
  inner.push(checksum(inner));
  return Uint8Array.from([SOF, ...escape(inner), EOF_MARKER]);
}

/** The acknowledgement for a received frame: same shape, inverted sequence. */
export const encodeAck = (receivedSequence: number): Uint8Array =>
  encodeFrame(DataType.Ack, receivedSequence ? 0 : 1);

/** Sequence alternates 0,1,0,1… per data frame sent. */
export const nextSequence = (current: number): number => (current ? 0 : 1);

export interface DecoderEvents {
  /** Bytes discarded while looking for a frame start. */
  onDesync?: (droppedBytes: number) => void;
}

/**
 * Reassembles frames from a byte stream.
 *
 * Unlike GAIA this is delimiter-based, so a truncated frame is recoverable: the
 * next 0x3E starts a fresh one, and the checksum catches corruption rather than
 * it being silently accepted.
 */
export class MdrDecoder {
  #buffer = new Uint8Array(0);
  #events: DecoderEvents;

  constructor(events: DecoderEvents = {}) {
    this.#events = events;
  }

  push(chunk: Uint8Array): MdrFrame[] {
    const merged = new Uint8Array(this.#buffer.length + chunk.length);
    merged.set(this.#buffer, 0);
    merged.set(chunk, this.#buffer.length);
    this.#buffer = merged;

    const frames: MdrFrame[] = [];

    for (;;) {
      const start = this.#buffer.indexOf(SOF);
      if (start === -1) {
        if (this.#buffer.length) this.#events.onDesync?.(this.#buffer.length);
        this.#buffer = new Uint8Array(0);
        break;
      }
      if (start > 0) {
        this.#events.onDesync?.(start);
        this.#buffer = this.#buffer.slice(start);
      }

      const end = this.#buffer.indexOf(EOF_MARKER, 1);
      if (end === -1) break; // wait for the rest of the frame

      const inner = unescape(this.#buffer.slice(1, end));
      const raw = this.#buffer.slice(0, end + 1);
      this.#buffer = this.#buffer.slice(end + 1);

      // dataType + seq + length + at least the checksum byte.
      if (inner.length < HEADER_LENGTH + 1) continue;

      const view = new DataView(inner.buffer, inner.byteOffset, inner.byteLength);
      const length = view.getUint32(2, false);
      if (HEADER_LENGTH + length + 1 > inner.length) continue;

      const payload = inner.slice(HEADER_LENGTH, HEADER_LENGTH + length);
      const declared = inner[HEADER_LENGTH + length];
      frames.push({
        dataType: inner[0],
        sequence: inner[1],
        payload,
        checksumOk: declared === checksum(inner.slice(0, HEADER_LENGTH + length)),
        raw,
      });
    }

    return frames;
  }

  reset(): void {
    this.#buffer = new Uint8Array(0);
  }

  get buffered(): number {
    return this.#buffer.length;
  }
}

export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
