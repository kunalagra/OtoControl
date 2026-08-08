/**
 * Request/response over the MDR transport.
 *
 * Two things make this unlike the GAIA client:
 *
 *  - **Every data frame must be acknowledged.** The device stops talking if we
 *    do not ACK, and it ACKs us before answering. ACKs are not responses.
 *  - **Unsupported queries are acknowledged and then ignored.** There is no
 *    error reply, so a timeout means "this device does not implement it" rather
 *    than a failure. `request` reflects that by throwing `MdrUnsupportedError`.
 */

import type { Transport } from '../device/transport';
import {
  DataType,
  MdrDecoder,
  encodeAck,
  encodeFrame,
  nextSequence,
  toHex,
} from './frame';
import type { MdrFrame } from './frame';

/** Long enough for a real reply, short enough that a sweep stays usable. */
export const DEFAULT_TIMEOUT_MS = 1200;

export class MdrUnsupportedError extends Error {
  readonly command: number;

  constructor(command: number, inquiry: number | undefined, ms: number) {
    super(
      `command 0x${command.toString(16).padStart(2, '0')}` +
        (inquiry === undefined ? '' : `/0x${inquiry.toString(16).padStart(2, '0')}`) +
        ` was acknowledged but not answered within ${ms}ms — the device does not implement it`,
    );
    this.name = 'MdrUnsupportedError';
    this.command = command;
  }
}

/**
 * Reply opcodes follow the request: GET n → RET n+1, SET n+2 → RET n+1,
 * NTFY n+3. Verified across CONNECT (0x00→0x01, 0x04→0x05, 0x06→0x07),
 * COMMON (0x12→0x13), POWER (0x22→0x23) and EQEBB (0x56→0x57).
 */
export const replyFor = (getCommand: number): number => getCommand + 1;

export type FrameListener = (frame: MdrFrame, direction: 'tx' | 'rx') => void;
export type NotificationListener = (frame: MdrFrame) => void;

interface PendingAck {
  resolve(): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

interface Pending {
  reply: number;
  /** Second payload byte, when the reply must match a specific inquiry. */
  inquiry: number | undefined;
  resolve(payload: Uint8Array): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export interface MdrClientOptions {
  timeoutMs?: number;
}

export class MdrClient {
  #transport: Transport;
  #decoder: MdrDecoder;
  #pending: Pending | null = null;
  #pendingAck: PendingAck | null = null;
  #queue: Promise<unknown> = Promise.resolve();
  #sequence = 0;
  #timeoutMs: number;
  #notificationListeners = new Set<NotificationListener>();
  #frameListeners = new Set<FrameListener>();

  constructor(transport: Transport, options: MdrClientOptions = {}) {
    this.#transport = transport;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#decoder = new MdrDecoder({
      onDesync: (dropped) => console.warn(`[mdr] discarded ${dropped} unaligned byte(s)`),
    });
  }

  handleData(chunk: Uint8Array): void {
    for (const frame of this.#decoder.push(chunk)) this.#dispatch(frame);
  }

  #dispatch(frame: MdrFrame): void {
    for (const listener of this.#frameListeners) listener(frame, 'rx');

    if (!frame.checksumOk) {
      console.warn(`[mdr] bad checksum, dropping ${toHex(frame.raw)}`);
      return;
    }

    // ACKs are flow control, never answers — but for a write they are the only
    // confirmation the device gives.
    if (frame.dataType === DataType.Ack) {
      const waiting = this.#pendingAck;
      if (waiting) {
        clearTimeout(waiting.timer);
        this.#pendingAck = null;
        waiting.resolve();
      }
      return;
    }

    // Anything else must be acknowledged or the device goes quiet.
    void this.#write(encodeAck(frame.sequence));

    const pending = this.#pending;
    const matches =
      pending &&
      frame.payload.length > 0 &&
      frame.payload[0] === pending.reply &&
      (pending.inquiry === undefined || frame.payload[1] === pending.inquiry);

    if (matches) {
      clearTimeout(pending.timer);
      const { resolve } = pending;
      this.#pending = null;
      resolve(frame.payload);
      return;
    }

    for (const listener of this.#notificationListeners) listener(frame);
  }

  async #write(frame: Uint8Array): Promise<void> {
    try {
      await this.#transport.write(frame);
    } catch (error) {
      console.warn('[mdr] write failed', error);
    }
  }

  /**
   * Sends a command and resolves with the reply payload.
   *
   * `inquiry` is the second payload byte — battery type, EQ inquiry type, and
   * so on. It is matched against the reply because one reply opcode serves
   * several inquiries, and asking for an unsupported one is how the WF-C500
   * silently ignored a battery query during bring-up.
   */
  request(
    command: number,
    inquiry?: number,
    options: { timeoutMs?: number } = {},
  ): Promise<Uint8Array> {
    return this.send(inquiry === undefined ? [command] : [command, inquiry], options);
  }

  /**
   * Sends an arbitrary payload and waits for its reply.
   *
   * `expectedReply` overrides the default `command + 1` for commands whose
   * reply does not follow it. Note that SET commands are *not* answered at all
   * on the devices seen so far — use `write` for those.
   */
  send(
    payload: number[],
    options: { timeoutMs?: number; expectedReply?: number } = {},
  ): Promise<Uint8Array> {
    const run = () =>
      this.#send(
        payload,
        options.expectedReply ?? replyFor(payload[0]),
        options.timeoutMs ?? this.#timeoutMs,
      );
    const result = this.#queue.then(run, run);
    this.#queue = result.catch(() => undefined);
    return result;
  }

  async #send(payload: number[], reply: number, timeoutMs: number): Promise<Uint8Array> {
    const command = payload[0];
    const inquiry = payload.length > 1 ? payload[1] : undefined;
    const frame = encodeFrame(DataType.Command1, this.#sequence, payload);
    this.#sequence = nextSequence(this.#sequence);

    return new Promise<Uint8Array>((resolve, reject) => {
      this.#pending = {
        reply,
        inquiry,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.#pending = null;
          reject(new MdrUnsupportedError(command, inquiry, timeoutMs));
        }, timeoutMs),
      };

      for (const listener of this.#frameListeners) {
        listener(
          {
            dataType: DataType.Command1,
            sequence: this.#sequence,
            payload: Uint8Array.from(payload),
            checksumOk: true,
            raw: frame,
          },
          'tx',
        );
      }

      this.#transport.write(frame).catch((error: Error) => {
        const pending = this.#pending;
        if (!pending) return;
        clearTimeout(pending.timer);
        this.#pending = null;
        pending.reject(error);
      });
    });
  }

  /**
   * Sends a payload the device acknowledges but does not answer.
   *
   * Sony SET commands work this way: the ACK confirms receipt, the change is
   * applied, and the new state arrives later as a notification rather than a
   * reply. Waiting for a RET here times out even though the write succeeded.
   */
  write(payload: number[], options: { timeoutMs?: number } = {}): Promise<void> {
    const run = () => this.#writeAndAwaitAck(payload, options.timeoutMs ?? this.#timeoutMs);
    const result = this.#queue.then(run, run);
    this.#queue = result.catch(() => undefined);
    return result;
  }

  async #writeAndAwaitAck(payload: number[], timeoutMs: number): Promise<void> {
    const frame = encodeFrame(DataType.Command1, this.#sequence, payload);
    this.#sequence = nextSequence(this.#sequence);

    return new Promise<void>((resolve, reject) => {
      this.#pendingAck = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.#pendingAck = null;
          reject(new Error(`no acknowledgement for 0x${payload[0].toString(16)} in ${timeoutMs}ms`));
        }, timeoutMs),
      };

      for (const listener of this.#frameListeners) {
        listener(
          {
            dataType: DataType.Command1,
            sequence: this.#sequence,
            payload: Uint8Array.from(payload),
            checksumOk: true,
            raw: frame,
          },
          'tx',
        );
      }

      this.#transport.write(frame).catch((error: Error) => {
        const waiting = this.#pendingAck;
        if (!waiting) return;
        clearTimeout(waiting.timer);
        this.#pendingAck = null;
        waiting.reject(error);
      });
    });
  }

  /** Sends a raw frame with no correlation. Used by the debug console. */
  async sendRaw(frame: Uint8Array): Promise<void> {
    await this.#transport.write(frame);
  }

  onNotification(listener: NotificationListener): () => void {
    this.#notificationListeners.add(listener);
    return () => this.#notificationListeners.delete(listener);
  }

  onFrame(listener: FrameListener): () => void {
    this.#frameListeners.add(listener);
    return () => this.#frameListeners.delete(listener);
  }

  abort(reason: Error): void {
    const pending = this.#pending;
    if (pending) {
      clearTimeout(pending.timer);
      this.#pending = null;
      pending.reject(reason);
    }
    const waiting = this.#pendingAck;
    if (waiting) {
      clearTimeout(waiting.timer);
      this.#pendingAck = null;
      waiting.reject(reason);
    }
    this.#decoder.reset();
    this.#sequence = 0;
  }
}
