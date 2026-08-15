/**
 * GAIA v3 wire framing.
 *
 *   byte 0     0xFF          frame marker
 *   byte 1     0x03          flags
 *   bytes 2-3  u16 BE        payload length
 *   bytes 4-5  u16 BE        vendor ID
 *   bytes 6-7  u16 BE        command ID
 *   bytes 8+   payload
 *
 * There is no checksum. Command IDs encode their own kind in two bits:
 * a request `id` is answered by `id | 0x0100`, an async notification arrives
 * as `id | 0x0080`, and a failure as `id | 0x0180`.
 */

export const FRAME_MARKER = 0xff;
export const FRAME_FLAGS = 0x03;
export const FRAME_HEADER_LENGTH = 8;

/** Sennheiser owns the product features; Qualcomm owns GAIA core and DFU. */
export const Vendor = {
  Sennheiser: 0x0495,
  Qualcomm: 0x001d,
} as const;

export type VendorId = (typeof Vendor)[keyof typeof Vendor];

const KIND_MASK = 0x0180;
const RESPONSE_BIT = 0x0100;
const NOTIFICATION_BIT = 0x0080;

export type FrameKind = 'request' | 'response' | 'notification' | 'error';

export interface GaiaFrame {
  flags: number;
  vendor: number;
  command: number;
  payload: Uint8Array;
  /** The full frame including header, kept for logging and debugging. */
  raw: Uint8Array;
}

export function frameKind(command: number): FrameKind {
  switch (command & KIND_MASK) {
    case KIND_MASK:
      return 'error';
    case RESPONSE_BIT:
      return 'response';
    case NOTIFICATION_BIT:
      return 'notification';
    default:
      return 'request';
  }
}

/**
 * The request ID a response/notification/error belongs to.
 *
 * Derived from the command bits rather than from a lookup table, because
 * `reference/m4.json` has copy-paste errors in several of its declared error
 * IDs (ANC_Transparency claims 0x1983/0x1982, which belong to the
 * TransparentHearing family, where the bit convention gives 0x1B83/0x1B82).
 */
export function requestIdFor(command: number): number {
  return command & ~KIND_MASK;
}

export function encodeFrame(
  vendor: number,
  command: number,
  payload: ArrayLike<number> = [],
): Uint8Array {
  const frame = new Uint8Array(FRAME_HEADER_LENGTH + payload.length);
  const view = new DataView(frame.buffer);
  frame[0] = FRAME_MARKER;
  frame[1] = FRAME_FLAGS;
  view.setUint16(2, payload.length, false);
  view.setUint16(4, vendor, false);
  view.setUint16(6, command, false);
  frame.set(Uint8Array.from(payload), FRAME_HEADER_LENGTH);
  return frame;
}

export interface DecoderEvents {
  /** Bytes discarded while resynchronising after a corrupt or partial frame. */
  onDesync?: (droppedBytes: number) => void;
}

/**
 * Reassembles frames from a byte stream.
 *
 * A single serial read can contain a partial frame, several frames, or a frame
 * boundary mid-header, so bytes are buffered until a whole frame is available.
 */
export class FrameDecoder {
  #buffer = new Uint8Array(0);
  #events: DecoderEvents;

  constructor(events: DecoderEvents = {}) {
    this.#events = events;
  }

  push(chunk: Uint8Array): GaiaFrame[] {
    const merged = new Uint8Array(this.#buffer.length + chunk.length);
    merged.set(this.#buffer, 0);
    merged.set(chunk, this.#buffer.length);
    this.#buffer = merged;

    const frames: GaiaFrame[] = [];

    for (;;) {
      if (this.#buffer.length < FRAME_HEADER_LENGTH) break;

      if (this.#buffer[0] !== FRAME_MARKER) {
        const next = this.#buffer.indexOf(FRAME_MARKER, 1);
        const dropped = next === -1 ? this.#buffer.length : next;
        this.#events.onDesync?.(dropped);
        this.#buffer = next === -1 ? new Uint8Array(0) : this.#buffer.slice(next);
        continue;
      }

      const view = new DataView(
        this.#buffer.buffer,
        this.#buffer.byteOffset,
        this.#buffer.byteLength,
      );
      const length = view.getUint16(2, false);
      const total = FRAME_HEADER_LENGTH + length;
      if (this.#buffer.length < total) break;

      frames.push({
        flags: this.#buffer[1],
        vendor: view.getUint16(4, false),
        command: view.getUint16(6, false),
        payload: this.#buffer.slice(FRAME_HEADER_LENGTH, total),
        raw: this.#buffer.slice(0, total),
      });
      this.#buffer = this.#buffer.slice(total);
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
