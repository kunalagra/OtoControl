/**
 * Nothing/CMF SPP wire framing.
 *
 *   0x55 | 0x60 | 0x01 | command(u16 LE) | length | seq | payload | crc(LE)
 *
 * The CRC is Modbus (poly 0xA001, init 0xFFFF) over everything before it,
 * appended low byte first. There is no trailing delimiter, so decoding is
 * length-driven: the header's length byte says where the frame ends.
 *
 * Ported byte-for-byte from radiance-project/ear-web `res/js/bluetooth_socket.js`
 * — including its quirks, which are load-bearing for interop.
 */

/** Maximum sequence id before the rolling counter wraps — matches ear-web. */
export const MAX_SEQUENCE = 250;

export const SYNC = 0x55;

/** Header: sync, packet type, fixed, command lo, command hi, length, reserved, seq. */
export const HEADER_LENGTH = 8;

export interface NothingFrame {
  /** The u16 command id from bytes 3–4, little-endian. */
  command: number;
  sequence: number;
  payload: Uint8Array;
  /** False when the trailing CRC disagrees with the computed one. */
  crcOk: boolean;
  raw: Uint8Array;
}

/** CRC-16 Modbus: init 0xFFFF, reflected poly 0xA001. */
export function crc16(bytes: ArrayLike<number>): number {
  let crc = 0xffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1;
    }
  }
  return crc & 0xffff;
}

export function encodePacket(command: number, sequence: number, payload: ArrayLike<number> = []): Uint8Array {
  const body = new Uint8Array(HEADER_LENGTH + payload.length);
  body[0] = SYNC;
  body[1] = 0x60;
  body[2] = 0x01;
  body[3] = command & 0xff;
  body[4] = (command >> 8) & 0xff;
  body[5] = payload.length;
  // Byte 6 stays 0 in every packet ear-web sends.
  body[7] = sequence;
  body.set(payload, HEADER_LENGTH);

  const crc = crc16(body);
  const packet = new Uint8Array(body.length + 2);
  packet.set(body, 0);
  packet[body.length] = crc & 0xff;
  packet[body.length + 1] = crc >> 8;
  return packet;
}

export interface DecoderEvents {
  /** Bytes discarded while looking for a frame start. */
  onDesync?: (droppedBytes: number) => void;
}

/**
 * Reassembles frames from a byte stream.
 *
 * Length-driven rather than delimiter-driven: after the sync byte, the header's
 * length field says exactly how many bytes remain, so a corrupted length is the
 * one unrecoverable case — resynchronising on the next 0x55 is the best anyone
 * can do, and matches how ear-web simply drops non-0x55 reads.
 */
export class NothingDecoder {
  #buffer = new Uint8Array(0);
  #events: DecoderEvents;

  constructor(events: DecoderEvents = {}) {
    this.#events = events;
  }

  push(chunk: Uint8Array): NothingFrame[] {
    const merged = new Uint8Array(this.#buffer.length + chunk.length);
    merged.set(this.#buffer, 0);
    merged.set(chunk, this.#buffer.length);
    this.#buffer = merged;

    const frames: NothingFrame[] = [];

    for (;;) {
      const start = this.#buffer.indexOf(SYNC);
      if (start === -1) {
        if (this.#buffer.length) this.#events.onDesync?.(this.#buffer.length);
        this.#buffer = new Uint8Array(0);
        break;
      }
      if (start > 0) {
        this.#events.onDesync?.(start);
        this.#buffer = this.#buffer.slice(start);
      }

      // Command + length not fully arrived yet, let alone payload and CRC.
      if (this.#buffer.length < HEADER_LENGTH) break;

      const length = this.#buffer[5];
      const total = HEADER_LENGTH + length + 2;
      if (this.#buffer.length < total) break; // wait for the rest of the frame

      const raw = this.#buffer.slice(0, total);
      this.#buffer = this.#buffer.slice(total);

      const body = raw.slice(0, total - 2);
      const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      const crc = view.getUint16(total - 2, true);
      frames.push({
        command: view.getUint16(3, true),
        sequence: raw[7],
        payload: raw.slice(HEADER_LENGTH, HEADER_LENGTH + length),
        crcOk: crc === crc16(body),
        raw,
      });
    }

    return frames;
  }

  reset(): void {
    this.#buffer = new Uint8Array(0);
  }
}

export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
