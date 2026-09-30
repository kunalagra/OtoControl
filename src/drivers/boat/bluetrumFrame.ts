/**
 * Bluetrum SPP frame codec.
 *
 * Byte-exact port of the two code sites in the boAt Hearables decompile
 * (`boat/jadx_out/sources/com/bluetrum/devicemanager/`):
 *
 * - TX: `DeviceCommManager.a()` — each frame is
 *   `[seq:4-bit rolling][cmd][type 1/2/3][frag hi=total-1 lo=index][len][chunk]`.
 *   Empty payload → single frame with `[frag=0,len=0]`. Chunk size comes
 *   from `setMaxPacketSize(i)` → `i - 5`, read at runtime from info `-1`;
 *   until then the caller passes its own cap.
 * - RX: `c.java:b()` walks 5-byte headers (low nibble of byte 0 against a
 *   rolling expected value, length fit) and `d.java` reassembles keyed on
 *   `(command, type, totalFrags)`, emitting a message once frags
 *   `0..total-1` arrive. First frag must have index 0.
 *
 * There is no SOF, no length-varint and no checksum at this layer — do not
 * add one.
 */

export interface SeqState {
  n: number;
}

export interface BluetrumFrame {
  /** Seq of the frame that completed the message (low nibble of its byte 0). */
  seq: number;
  cmd: number;
  /** 1 = request, 2 = response, 3 = notification. */
  type: number;
  /** Reassembled payload across all frags. */
  payload: Uint8Array;
  raw: Uint8Array;
}

export interface DecoderEvents {
  onSeqMismatch?: (expected: number, got: number) => void;
  onFragMismatch?: (reason: string) => void;
}

/** Fallback chunk cap until info `-1` (max packet size) is read. */
export const DEFAULT_MAX_PAYLOAD = 20;

/**
 * Splits a payload into wire frames, advancing `seq.n` per frame (mod 16).
 * `maxPayload` is the per-frame chunk cap (`setMaxPacketSize(i)` → `i - 5`).
 */
export function encodeFrames(
  cmd: number,
  type: number,
  payload: Uint8Array,
  seq: SeqState,
  maxPayload: number = DEFAULT_MAX_PAYLOAD,
): Uint8Array[] {
  if (payload.length === 0) {
    const frame = Uint8Array.from([seq.n & 15, cmd & 0xff, type & 0xff, 0x00, 0x00]);
    seq.n = (seq.n + 1) & 15;
    return [frame];
  }
  const total = Math.ceil(payload.length / maxPayload);
  const frames: Uint8Array[] = [];
  for (let index = 0; index < total; index += 1) {
    const chunk = payload.subarray(index * maxPayload, (index + 1) * maxPayload);
    const frame = new Uint8Array(5 + chunk.length);
    frame[0] = seq.n & 15;
    frame[1] = cmd & 0xff;
    frame[2] = type & 0xff;
    frame[3] = (((total - 1) & 15) << 4) | (index & 15);
    frame[4] = chunk.length;
    frame.set(chunk, 5);
    frames.push(frame);
    seq.n = (seq.n + 1) & 15;
  }
  return frames;
}

interface Pending {
  cmd: number;
  type: number;
  total: number;
  received: number;
  chunks: Uint8Array[];
  raw: Uint8Array[];
}

/**
 * Streaming reassembler. Emits one `BluetrumFrame` per complete message;
 * per-frame wire errors are reported through `DecoderEvents` and do not
 * throw, mirroring the app (which posts `RESPONSE_ERROR_*` and carries on).
 */
export class BluetrumDecoder {
  #buffer = new Uint8Array(0);
  #expectedSeq = 0;
  #pending: Pending | null = null;
  #events: DecoderEvents;

  constructor(events: DecoderEvents = {}) {
    this.#events = events;
  }

  push(chunk: Uint8Array): BluetrumFrame[] {
    const merged = new Uint8Array(this.#buffer.length + chunk.length);
    merged.set(this.#buffer, 0);
    merged.set(chunk, this.#buffer.length);
    this.#buffer = merged;

    const out: BluetrumFrame[] = [];
    for (;;) {
      if (this.#buffer.length < 5) break;
      const seq = this.#buffer[0] & 15;
      if (seq !== this.#expectedSeq) this.#events.onSeqMismatch?.(this.#expectedSeq, seq);
      this.#expectedSeq = (seq + 1) & 15;
      const cmd = this.#buffer[1];
      const type = this.#buffer[2];
      const index = this.#buffer[3] & 15;
      const total = ((this.#buffer[3] >> 4) & 15) + 1;
      const len = this.#buffer[4];
      if (this.#buffer.length < 5 + len) break; // wait for the rest
      const raw = this.#buffer.slice(0, 5 + len);
      const payload = this.#buffer.slice(5, 5 + len);
      this.#buffer = this.#buffer.slice(5 + len);

      const pending = this.#pending;
      if (pending === null) {
        if (index !== 0) {
          this.#events.onFragMismatch?.(`first frag index ${index}, expected 0`);
          continue;
        }
        if (total === 1) {
          out.push({ seq, cmd, type, payload, raw });
        } else {
          this.#pending = { cmd, type, total, received: 1, chunks: [payload], raw: [raw] };
        }
        continue;
      }
      if (pending.cmd !== cmd || pending.type !== type || pending.total !== total || pending.received !== index) {
        this.#events.onFragMismatch?.('continuation does not match the pending message');
        this.#pending = null;
        if (index !== 0) continue;
        if (total === 1) {
          out.push({ seq, cmd, type, payload, raw });
        } else {
          this.#pending = { cmd, type, total, received: 1, chunks: [payload], raw: [raw] };
        }
        continue;
      }
      pending.chunks.push(payload);
      pending.raw.push(raw);
      pending.received += 1;
      if (pending.received === pending.total) {
        const size = pending.chunks.reduce((n, c) => n + c.length, 0);
        const joined = new Uint8Array(size);
        let at = 0;
        for (const c of pending.chunks) {
          joined.set(c, at);
          at += c.length;
        }
        const rawSize = pending.raw.reduce((n, r) => n + r.length, 0);
        const rawJoined = new Uint8Array(rawSize);
        at = 0;
        for (const r of pending.raw) {
          rawJoined.set(r, at);
          at += r.length;
        }
        this.#pending = null;
        out.push({ seq, cmd, type, payload: joined, raw: rawJoined });
      }
    }
    return out;
  }

  reset(): void {
    this.#buffer = new Uint8Array(0);
    this.#pending = null;
  }
}

export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
