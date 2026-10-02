/**
 * Samsung Galaxy Buds SPP/RFCOMM framing.
 *
 *   standard (Buds+ and every later model)
 *     0xFD | len(2, LE; low 10 bits) | id | payload | crc16(2, LE) | 0xDD
 *   legacy (the 2019 Galaxy Buds only)
 *     0xFE | type(1) | len(1) | id | payload | crc16(2, LE) | 0xEE
 *
 * `len` counts `id + payload + crc`, so a frame is `len + 4` bytes long. In the
 * standard header the high byte also carries two flag bits: 0x10 marks a
 * response-type frame (the phone sets it when it echoes a push) and 0x20 a
 * fragment of a larger transfer (firmware update, core dumps) — fragments are
 * not used by anything this driver does.
 *
 * The CRC is CRC-16/XMODEM (poly 0x1021, init 0) over `id | payload`. The
 * vendor app computes it on send and never checks it on receive; this decoder
 * does check it, so a frame with a bad CRC is skipped rather than believed.
 *
 * Sources and the one place they disagree (the vendor plugin's own
 * `FD…DD` is the framing for every model but the 2019 Buds, not a refutation of
 * `FE…EE`): docs/superpowers/specs/2026-10-02-samsung-driver-design.md §3.
 */

export const SOM = 0xfd;
export const EOM = 0xdd;
export const LEGACY_SOM = 0xfe;
export const LEGACY_EOM = 0xee;

const RESPONSE_BIT = 0x10;
const FRAGMENT_BIT = 0x20;
/** `id` + the two CRC bytes: the smallest value `len` can hold. */
const MIN_LENGTH = 3;

export type FrameVariant = 'standard' | 'legacy';

export interface SamsungFrame {
  id: number;
  payload: Uint8Array;
  /** The response flag (0x10 of the header's high byte; the legacy header's `type`). */
  response: boolean;
  fragment: boolean;
}

/** CRC-16/XMODEM. Bitwise rather than a 256-entry table: frames are a few dozen bytes. */
export function crc16(bytes: ArrayLike<number>): number {
  let crc = 0;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= (bytes[i] & 0xff) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

export interface EncodeOptions {
  /** Sets the response flag — a phone echoing a push, not a request. */
  response?: boolean;
  variant?: FrameVariant;
}

export function encodeFrame(id: number, payload: ArrayLike<number> = [], options: EncodeOptions = {}): Uint8Array {
  const body = [id & 0xff, ...Array.from(payload, (byte) => byte & 0xff)];
  const crc = crc16(body);
  const length = body.length + 2;
  const response = options.response ?? false;
  if (options.variant === 'legacy') {
    return Uint8Array.from([LEGACY_SOM, response ? 1 : 0, length & 0xff, ...body, crc & 0xff, crc >> 8, LEGACY_EOM]);
  }
  const high = ((length >> 8) & 0x03) | (response ? RESPONSE_BIT : 0);
  return Uint8Array.from([SOM, length & 0xff, high, ...body, crc & 0xff, crc >> 8, EOM]);
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Reassembles frames from an arbitrarily chunked byte stream, resyncing past garbage and bad CRCs. */
export class FrameDecoder {
  readonly #variant: FrameVariant;
  #buffer: Uint8Array = new Uint8Array(0);

  constructor(variant: FrameVariant = 'standard') {
    this.#variant = variant;
  }

  push(chunk: Uint8Array): SamsungFrame[] {
    this.#buffer = concat(this.#buffer, chunk);
    const legacy = this.#variant === 'legacy';
    const som = legacy ? LEGACY_SOM : SOM;
    const eom = legacy ? LEGACY_EOM : EOM;
    const headerLength = 3; // SOM + the two header bytes, in either variant
    const frames: SamsungFrame[] = [];

    for (;;) {
      const start = this.#buffer.indexOf(som);
      if (start === -1) {
        this.#buffer = new Uint8Array(0);
        break;
      }
      if (start > 0) this.#buffer = this.#buffer.slice(start);
      if (this.#buffer.length < headerLength) break;

      const buf = this.#buffer;
      const length = legacy ? buf[2] : (buf[1] | (buf[2] << 8)) & 0x03ff;
      if (length < MIN_LENGTH) {
        this.#buffer = buf.slice(1); // this SOM was data
        continue;
      }
      const total = length + 4;
      if (buf.length < total) break; // the rest of the frame is not in yet

      const id = buf[3];
      const payload = buf.slice(4, total - 3);
      const crc = buf[total - 3] | (buf[total - 2] << 8);
      if (buf[total - 1] !== eom || crc !== crc16([id, ...payload])) {
        this.#buffer = buf.slice(1); // not a frame after all: rescan from the next byte
        continue;
      }

      this.#buffer = buf.slice(total);
      frames.push(
        legacy
          ? { id, payload, response: buf[1] === 1, fragment: false }
          : { id, payload, response: (buf[2] & RESPONSE_BIT) !== 0, fragment: (buf[2] & FRAGMENT_BIT) !== 0 },
      );
    }

    return frames;
  }

  reset(): void {
    this.#buffer = new Uint8Array(0);
  }
}
