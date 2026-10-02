/**
 * Pigweed HDLC framing, as the Pixel Buds speak it over RFCOMM.
 *
 *   0x7E | address (varint) | control (0x03) | data | CRC-32 (u32 LE) | 0x7E
 *
 * `0x7D` and `0x7E` inside the body are sent as `0x7D, byte ^ 0x20`; the CRC
 * runs over the unescaped address, control and data. The address is Pigweed's
 * HDLC varint, not a protobuf one: seven data bits per byte, shifted left by
 * one, with bit 0 set on the last byte. Verified against the companion app
 * (`gkn.d`, `hcl.g`) and qzed/pbpctrl (`libmaestro/src/hdlc/`) — see
 * docs/superpowers/specs/2026-10-02-pixelbuds-driver-design.md §3.
 */

const FLAG = 0x7e;
const ESCAPE = 0x7d;
const ESCAPE_MASK = 0x20;
/** An unnumbered-information frame: the only control byte either side sends. */
export const CONTROL_UI = 0x03;
/** Address (1+) + control (1) + CRC (4). */
const MIN_FRAME_BYTES = 6;
/** Far above any reply the buds send; a run past this without a flag is noise. */
const MAX_FRAME_BYTES = 4096;

export interface HdlcFrame {
  address: number;
  control: number;
  data: Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32/IEEE, the one zlib and Ethernet use. */
export function crc32(bytes: ArrayLike<number>): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Pigweed's HDLC address varint: `(value & 0x7f) << 1`, bit 0 marking the last byte. */
export function encodeAddress(address: number): number[] {
  const out: number[] = [];
  let rest = address;
  while (rest >= 0x80) {
    out.push((rest & 0x7f) << 1);
    rest = Math.floor(rest / 0x80);
  }
  out.push(((rest & 0x7f) << 1) | 1);
  return out;
}

/** The address and how many bytes it took, or null if the run never terminates. */
export function decodeAddress(bytes: ArrayLike<number>): { address: number; length: number } | null {
  let address = 0;
  for (let i = 0; i < bytes.length && i < 5; i += 1) {
    address += (bytes[i] >> 1) * 2 ** (7 * i);
    if (bytes[i] & 1) return { address, length: i + 1 };
  }
  return null;
}

export function encodeFrame(address: number, data: ArrayLike<number>, control: number = CONTROL_UI): Uint8Array {
  const body = [...encodeAddress(address), control, ...Array.from(data)];
  const crc = crc32(body);
  const unescaped = [...body, crc & 0xff, (crc >>> 8) & 0xff, (crc >>> 16) & 0xff, (crc >>> 24) & 0xff];
  const out: number[] = [FLAG];
  for (const byte of unescaped) {
    if (byte === FLAG || byte === ESCAPE) out.push(ESCAPE, byte ^ ESCAPE_MASK);
    else out.push(byte);
  }
  out.push(FLAG);
  return Uint8Array.from(out);
}

export interface HdlcDecoder {
  /** Feeds a chunk of the byte stream and returns every frame it completed. */
  push(chunk: Uint8Array): HdlcFrame[];
  /** Frames dropped for a bad checksum, escape or length since the last `reset`. */
  readonly dropped: number;
  reset(): void;
}

/**
 * A stream decoder that resynchronises on the next flag after any damage.
 * Bytes before the first flag are discarded, and a flag both closes one frame
 * and may open the next, so back-to-back frames sharing a flag decode.
 */
export function createHdlcDecoder(): HdlcDecoder {
  let body: number[] = [];
  let inFrame = false;
  let escaped = false;
  let dropped = 0;

  const discard = (): void => {
    body = [];
    escaped = false;
  };

  const finish = (): HdlcFrame | null => {
    const bytes = body;
    discard();
    if (bytes.length === 0) return null;
    if (bytes.length < MIN_FRAME_BYTES) {
      dropped += 1;
      return null;
    }
    const payload = bytes.slice(0, -4);
    const expected = (bytes[bytes.length - 4] | (bytes[bytes.length - 3] << 8) | (bytes[bytes.length - 2] << 16) | (bytes[bytes.length - 1] << 24)) >>> 0;
    if (crc32(payload) !== expected) {
      dropped += 1;
      return null;
    }
    const address = decodeAddress(payload);
    if (!address || address.length >= payload.length) {
      dropped += 1;
      return null;
    }
    return {
      address: address.address,
      control: payload[address.length],
      data: Uint8Array.from(payload.slice(address.length + 1)),
    };
  };

  return {
    push(chunk) {
      const frames: HdlcFrame[] = [];
      for (const byte of chunk) {
        if (byte === FLAG) {
          // A flag straight after an escape means the frame was cut short.
          if (escaped) {
            dropped += 1;
            discard();
          } else if (inFrame) {
            const frame = finish();
            if (frame) frames.push(frame);
          }
          inFrame = true;
        } else if (!inFrame) {
          continue;
        } else if (escaped) {
          body.push(byte ^ ESCAPE_MASK);
          escaped = false;
        } else if (byte === ESCAPE) {
          escaped = true;
        } else {
          body.push(byte);
        }
        if (body.length > MAX_FRAME_BYTES) {
          dropped += 1;
          discard();
          inFrame = false;
        }
      }
      return frames;
    },
    get dropped() {
      return dropped;
    },
    reset() {
      discard();
      inFrame = false;
      dropped = 0;
    },
  };
}
