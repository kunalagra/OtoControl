/**
 * Soundcore SPP-style packet framing over BLE GATT.
 *
 * Outbound (host → device):
 *
 *   7-byte command | total length (u16 LE) | payload | checksum (u8)
 *
 * Inbound (device → host):
 *
 *   09 FF 00 00 01 | kind (u16) | total length (u16 LE) | payload | checksum
 *
 * The length is the whole packet, header and checksum included, on both
 * directions. The checksum is an 8-bit wrapping additive sum of everything
 * before it.
 *
 * Ported byte-for-byte from gmallios/SoundcoreManager (`soundcore-lib`), and
 * verified against its A3951 test captures — including the total-length
 * semantics, which the unit tests there leave ambiguous.
 */

export const RESPONSE_PREFIX = [0x09, 0xff, 0x00, 0x00, 0x01] as const;
export const RESPONSE_HEADER_LENGTH = 9;

export interface SoundcoreFrame {
  /** The u16 kind from header bytes 5–6, host byte order (e.g. 0x0101). */
  kind: number;
  payload: Uint8Array;
  /** False when the trailing checksum disagrees with the computed sum. */
  checksumOk: boolean;
  raw: Uint8Array;
}

/** 8-bit wrapping additive checksum — the last byte of every packet. */
export const checksum = (bytes: ArrayLike<number>): number => {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 1) sum = (sum + bytes[i]) & 0xff;
  return sum;
};

/** Builds a host packet around a 7-byte command and its payload. */
export function encodePacket(command: readonly number[], payload: ArrayLike<number> = []): Uint8Array {
  if (command.length !== 7) throw new Error('Soundcore commands are 7 bytes');
  const total = 10 + payload.length;
  const packet = new Uint8Array(total);
  packet.set(command, 0);
  packet[7] = total & 0xff;
  packet[8] = total >> 8;
  packet.set(payload, 9);
  packet[total - 1] = checksum(packet.subarray(0, total - 1));
  return packet;
}

export interface DecoderEvents {
  /** Bytes discarded while looking for a response prefix. */
  onDesync?: (droppedBytes: number) => void;
}

/**
 * Reassembles response packets from a byte stream.
 *
 * Length-driven: after the 5-byte prefix and the kind, the header's length
 * says where the packet ends. A bad checksum or a corrupted length is
 * unrecoverable in place — the next prefix is the only resync point.
 */
export class SoundcoreDecoder {
  #buffer = new Uint8Array(0);
  #events: DecoderEvents;

  constructor(events: DecoderEvents = {}) {
    this.#events = events;
  }

  push(chunk: Uint8Array): SoundcoreFrame[] {
    const merged = new Uint8Array(this.#buffer.length + chunk.length);
    merged.set(this.#buffer, 0);
    merged.set(chunk, this.#buffer.length);
    this.#buffer = merged;

    const frames: SoundcoreFrame[] = [];

    for (;;) {
      const start = this.#indexOfPrefix();
      if (start === -1) {
        // Keep a tail that could still become a prefix.
        const keep = Math.min(this.#buffer.length, RESPONSE_PREFIX.length - 1);
        if (this.#buffer.length > keep) this.#events.onDesync?.(this.#buffer.length - keep);
        this.#buffer = this.#buffer.slice(this.#buffer.length - keep);
        break;
      }
      if (start > 0) {
        this.#events.onDesync?.(start);
        this.#buffer = this.#buffer.slice(start);
      }

      if (this.#buffer.length < RESPONSE_HEADER_LENGTH) break;
      const view = new DataView(this.#buffer.buffer, this.#buffer.byteOffset, this.#buffer.byteLength);
      const total = view.getUint16(7, true);
      if (total < RESPONSE_HEADER_LENGTH + 1) {
        // A length that cannot hold a packet is corruption; resync.
        this.#buffer = this.#buffer.slice(1);
        continue;
      }
      if (this.#buffer.length < total) break; // wait for the rest

      const raw = this.#buffer.slice(0, total);
      this.#buffer = this.#buffer.slice(total);
      frames.push({
        kind: view.getUint16(5, false),
        payload: raw.slice(RESPONSE_HEADER_LENGTH, total - 1),
        checksumOk: raw[total - 1] === checksum(raw.subarray(0, total - 1)),
        raw,
      });
    }

    return frames;
  }

  #indexOfPrefix(): number {
    outer: for (let i = 0; i <= this.#buffer.length - RESPONSE_PREFIX.length; i += 1) {
      for (let j = 0; j < RESPONSE_PREFIX.length; j += 1) {
        if (this.#buffer[i + j] !== RESPONSE_PREFIX[j]) continue outer;
      }
      return i;
    }
    return -1;
  }

  reset(): void {
    this.#buffer = new Uint8Array(0);
  }
}

export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
