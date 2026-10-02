/**
 * Xiaomi RCSP wire framing, as used over the earbuds' RFCOMM control service.
 *
 *   FE DC BA | type | opcode | length (u16 BE) | [status] | seq | payload | EF
 *
 * There is no checksum: integrity is the header, the length and the trailer.
 * `length` counts the status byte (responses only), the sequence byte and the
 * payload. Bit 6 of `type` marks a request, which carries no status byte.
 *
 * Decoding is length-driven rather than a scan for the next header, because a
 * payload may itself contain `FE DC BA`. Layout from Gadgetbridge's
 * `redmibuds/protocol/Message.java` and the vendor app's `f7/f.java:756-824`;
 * the resynchronising reader follows WinMi-Buds' `PacketReader`.
 */

export const SOF = [0xfe, 0xdc, 0xba] as const;
export const TRAILER = 0xef;

/** The type byte, by who sent the frame and whether it expects an answer. */
export const FrameType = {
  /** A command from this app. */
  PhoneRequest: 0xc4,
  /** An answer to either side's request; carries a status byte. */
  Response: 0x04,
  /** A command from the earbuds. */
  EarbudsRequest: 0xc0,
  /** An unsolicited notification from the earbuds. */
  EarbudsNotify: 0xc7,
} as const;

const KNOWN_TYPES: ReadonlySet<number> = new Set(Object.values(FrameType));

/** Longer than any real frame; a length beyond this is line noise, not a frame. */
export const MAX_LENGTH = 4096;

/** `FE DC BA`, type, opcode and the two length bytes. */
const HEADER_LENGTH = 7;

export interface XiaomiFrame {
  type: number;
  opcode: number;
  seq: number;
  /** Only responses carry one; 0 for a request. */
  status: number;
  payload: Uint8Array;
}

export const isRequestType = (type: number): boolean => (type & 0x40) !== 0;

export function encodeFrame(frame: Omit<XiaomiFrame, 'status'> & { status?: number }): Uint8Array {
  const request = isRequestType(frame.type);
  const prefix = request ? 1 : 2;
  const length = frame.payload.length + prefix;
  const out = new Uint8Array(HEADER_LENGTH + length + 1);
  out.set(SOF, 0);
  out[3] = frame.type;
  out[4] = frame.opcode;
  out[5] = (length >> 8) & 0xff;
  out[6] = length & 0xff;
  let at = HEADER_LENGTH;
  if (!request) out[at++] = frame.status ?? 0;
  out[at++] = frame.seq;
  out.set(frame.payload, at);
  out[out.length - 1] = TRAILER;
  return out;
}

export const encodeRequest = (opcode: number, seq: number, payload: ArrayLike<number> = []): Uint8Array =>
  encodeFrame({ type: FrameType.PhoneRequest, opcode, seq, payload: Uint8Array.from(payload) });

/** The answer to a frame the earbuds sent, echoing its opcode and sequence. */
export const encodeResponseTo = (frame: XiaomiFrame, payload: ArrayLike<number> = []): Uint8Array =>
  encodeFrame({ type: FrameType.Response, opcode: frame.opcode, seq: frame.seq, status: 0, payload: Uint8Array.from(payload) });

/**
 * Reassembles frames from a byte stream. RFCOMM reads can split a frame or
 * carry several, so bytes are buffered until `length` says a frame is whole.
 * Garbage, a bad trailer or an impossible length drops one byte and rescans.
 */
export function createDeframer() {
  let buffer: number[] = [];

  return {
    push(chunk: Uint8Array): XiaomiFrame[] {
      for (const byte of chunk) buffer.push(byte);
      const frames: XiaomiFrame[] = [];

      while (buffer.length >= SOF.length) {
        if (buffer[0] !== SOF[0] || buffer[1] !== SOF[1] || buffer[2] !== SOF[2]) {
          buffer.shift();
          continue;
        }
        if (buffer.length < HEADER_LENGTH) break;
        const type = buffer[3];
        const length = (buffer[5] << 8) | buffer[6];
        const prefix = isRequestType(type) ? 1 : 2;
        if (!KNOWN_TYPES.has(type) || length < prefix || length > MAX_LENGTH) {
          buffer.shift();
          continue;
        }
        const total = HEADER_LENGTH + length + 1;
        if (buffer.length < total) break;
        if (buffer[total - 1] !== TRAILER) {
          buffer.shift();
          continue;
        }
        const status = prefix === 2 ? buffer[HEADER_LENGTH] : 0;
        frames.push({
          type,
          opcode: buffer[4],
          seq: buffer[HEADER_LENGTH + prefix - 1],
          status,
          payload: Uint8Array.from(buffer.slice(HEADER_LENGTH + prefix, total - 1)),
        });
        buffer = buffer.slice(total);
      }
      return frames;
    },
    reset(): void {
      buffer = [];
    },
  };
}

export type Deframer = ReturnType<typeof createDeframer>;
