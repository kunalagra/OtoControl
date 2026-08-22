/**
 * Request/response over the Nothing SPP transport.
 *
 * Two properties of the protocol shape this client:
 *
 *  - **Reads are answered, writes are not.** A read command (0xC0xx) gets a
 *    reply whose command id is the read with bit 15 cleared (0xC007 → 0x4007);
 *    a write (0xF0xx) is applied silently, with the new state arriving later
 *    as a notification (0xE0xx) or on the next read. So `write` is
 *    fire-and-forget and confirmation is a deliberate re-read.
 *  - **An unanswered read means "not implemented on this model."** There is no
 *    error reply, so a timeout is the device's way of saying it lacks the
 *    feature — the driver turns that into a capability flag, exactly as the
 *    Sony side treats `MdrUnsupportedError`.
 */

import type { Transport } from '@/core/transport';
import { MAX_SEQUENCE, NothingDecoder, encodePacket, toHex } from './frame';
import type { NothingFrame } from './frame';

/** ear-web polls at 100 ms intervals; replies come well inside this. */
export const DEFAULT_TIMEOUT_MS = 1500;

export class NothingUnsupportedError extends Error {
  constructor(command: number, ms: number) {
    super(
      `command 0x${command.toString(16).padStart(4, '0')} was not answered within ${ms}ms — ` +
        'this model does not implement it',
    );
    this.name = 'NothingUnsupportedError';
  }
}

/** The reply command id for a read: the read with bit 15 cleared. */
export const replyFor = (readCommand: number): number => readCommand & 0x7fff;

export type FrameListener = (frame: NothingFrame, direction: 'tx' | 'rx') => void;
export type NotificationListener = (frame: NothingFrame) => void;

interface Pending {
  reply: number;
  resolve(payload: Uint8Array): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export interface NothingClientOptions {
  timeoutMs?: number;
}

export class NothingClient {
  #transport: Transport;
  #decoder: NothingDecoder;
  #pending: Pending | null = null;
  #queue: Promise<unknown> = Promise.resolve();
  #sequence = 0;
  #timeoutMs: number;
  #notificationListeners = new Set<NotificationListener>();
  #frameListeners = new Set<FrameListener>();

  constructor(transport: Transport, options: NothingClientOptions = {}) {
    this.#transport = transport;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#decoder = new NothingDecoder({
      onDesync: (dropped) => console.warn(`[nothing] discarded ${dropped} unaligned byte(s)`),
    });
  }

  handleData(chunk: Uint8Array): void {
    for (const frame of this.#decoder.push(chunk)) this.#dispatch(frame);
  }

  #dispatch(frame: NothingFrame): void {
    for (const listener of this.#frameListeners) listener(frame, 'rx');

    if (!frame.crcOk) {
      console.warn(`[nothing] bad CRC, dropping ${toHex(frame.raw)}`);
      return;
    }

    const pending = this.#pending;
    if (pending && frame.command === pending.reply) {
      clearTimeout(pending.timer);
      this.#pending = null;
      pending.resolve(frame.payload);
      return;
    }

    for (const listener of this.#notificationListeners) listener(frame);
  }

  #nextSequence(): number {
    this.#sequence += 1;
    if (this.#sequence > MAX_SEQUENCE) this.#sequence = 1;
    return this.#sequence;
  }

  /** Sends a read command and resolves with its reply payload. */
  request(command: number, options: { timeoutMs?: number } = {}): Promise<Uint8Array> {
    const run = () => this.#request(command, options.timeoutMs ?? this.#timeoutMs);
    const result = this.#queue.then(run, run);
    this.#queue = result.catch(() => undefined);
    return result;
  }

  #request(command: number, timeoutMs: number): Promise<Uint8Array> {
    const sequence = this.#nextSequence();
    const packet = encodePacket(command, sequence);

    return new Promise<Uint8Array>((resolve, reject) => {
      this.#pending = {
        reply: replyFor(command),
        resolve,
        reject,
        timer: setTimeout(() => {
          this.#pending = null;
          reject(new NothingUnsupportedError(command, timeoutMs));
        }, timeoutMs),
      };

      for (const listener of this.#frameListeners) {
        listener(
          {
            command,
            sequence,
            payload: new Uint8Array(0),
            crcOk: true,
            raw: packet,
          },
          'tx',
        );
      }

      this.#transport.write(packet).catch((error: Error) => {
        const pending = this.#pending;
        if (!pending) return;
        clearTimeout(pending.timer);
        this.#pending = null;
        pending.reject(error);
      });
    });
  }

  /** Sends a write command. The device does not answer writes. */
  async write(command: number, payload: ArrayLike<number> = []): Promise<void> {
    const sequence = this.#nextSequence();
    const packet = encodePacket(command, sequence, payload);
    for (const listener of this.#frameListeners) {
      listener(
        {
          command,
          sequence,
          payload: Uint8Array.from(payload),
          crcOk: true,
          raw: packet,
        },
        'tx',
      );
    }
    await this.#transport.write(packet);
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
    this.#decoder.reset();
    this.#sequence = 0;
  }
}
