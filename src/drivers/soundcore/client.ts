/**
 * Request/response over the Soundcore GATT transport.
 *
 * Every request is a 7-byte command; the answer comes back as a response
 * packet whose kind names it (`01 01` answers the state request, `06 81`
 * acknowledges a sound-mode write). State changes the device makes on its own
 * arrive unsolicited — `06 01` for sound mode, `01 01` for the rest of the
 * state — and go to the notification listeners.
 */

import type { Transport } from '@/core/transport';
import { SoundcoreDecoder, encodePacket, toHex } from './frame';
import type { SoundcoreFrame } from './frame';

export const DEFAULT_TIMEOUT_MS = 1500;

export class SoundcoreUnsupportedError extends Error {
  constructor(kind: number, ms: number) {
    super(
      `command answering 0x${kind.toString(16).padStart(4, '0')} did not arrive within ${ms}ms — ` +
        'this device does not implement it',
    );
    this.name = 'SoundcoreUnsupportedError';
  }
}

/** Frame logging is off unless this localStorage flag is set — see the debug notes. */
export const frameDebugEnabled = (): boolean => {
  try {
    return localStorage.getItem('otocontrol:debug-frames') === '1';
  } catch {
    return false;
  }
};

export type FrameListener = (frame: SoundcoreFrame, direction: 'tx' | 'rx') => void;
export type NotificationListener = (frame: SoundcoreFrame) => void;

interface Pending {
  /** The response kind that resolves this request. */
  replyKind: number;
  resolve(payload: Uint8Array): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export interface SoundcoreClientOptions {
  timeoutMs?: number;
}

export class SoundcoreClient {
  #transport: Transport;
  #decoder: SoundcoreDecoder;
  #pending: Pending | null = null;
  #queue: Promise<unknown> = Promise.resolve();
  #timeoutMs: number;
  #notificationListeners = new Set<NotificationListener>();
  #frameListeners = new Set<FrameListener>();

  constructor(transport: Transport, options: SoundcoreClientOptions = {}) {
    this.#transport = transport;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#decoder = new SoundcoreDecoder({
      onDesync: (dropped) => console.warn(`[soundcore] discarded ${dropped} unaligned byte(s)`),
    });
  }

  handleData(chunk: Uint8Array): void {
    for (const frame of this.#decoder.push(chunk)) this.#dispatch(frame);
  }

  #dispatch(frame: SoundcoreFrame): void {
    if (frameDebugEnabled()) {
      console.info(
        `[soundcore rx] kind=0x${frame.kind.toString(16).padStart(4, '0')} ${toHex(frame.raw)}`,
      );
    }
    for (const listener of this.#frameListeners) listener(frame, 'rx');

    if (!frame.checksumOk) {
      console.warn(`[soundcore] bad checksum, dropping ${toHex(frame.raw)}`);
      return;
    }

    const pending = this.#pending;
    if (pending && frame.kind === pending.replyKind) {
      clearTimeout(pending.timer);
      this.#pending = null;
      pending.resolve(frame.payload);
      return;
    }

    for (const listener of this.#notificationListeners) listener(frame);
  }

  /**
   * Sends a 7-byte command and waits for the response kind that answers it.
   * Requests carry no payload today; `payload` exists for the EQ write.
   */
  request(command: readonly number[], replyKind: number, payload: number[] = [], options: { timeoutMs?: number } = {}): Promise<Uint8Array> {
    const run = () => this.#request(command, replyKind, payload, options.timeoutMs ?? this.#timeoutMs);
    const result = this.#queue.then(run, run);
    this.#queue = result.catch(() => undefined);
    return result;
  }

  #request(
    command: readonly number[],
    replyKind: number,
    payload: number[],
    timeoutMs: number,
  ): Promise<Uint8Array> {
    const packet = encodePacket(command, payload);
    if (frameDebugEnabled()) {
      console.info(`[soundcore tx] expect=0x${replyKind.toString(16).padStart(4, '0')} ${toHex(packet)}`);
    }

    return new Promise<Uint8Array>((resolve, reject) => {
      this.#pending = {
        replyKind,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.#pending = null;
          reject(new SoundcoreUnsupportedError(replyKind, timeoutMs));
        }, timeoutMs),
      };

      for (const listener of this.#frameListeners) {
        listener(
          {
            kind: replyKind,
            payload: Uint8Array.from(payload),
            checksumOk: true,
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
  }
}
