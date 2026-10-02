/**
 * Request/reply over a Samsung Buds transport.
 *
 * Replies are not one shape: a read (`DebugSku`, `VersionInfo`) is answered
 * with a frame of the same id, a write with an `Ack` (0x42) whose first byte
 * echoes the id. Both resolve a pending request; one is in flight at a time.
 * Everything else — the status pushes, noise-control updates — goes to
 * notification listeners, as does a reply nobody was waiting for.
 */

import type { Transport } from '@/core/transport';
import { MsgId } from './ids';
import { FrameDecoder, encodeFrame } from './frame';
import type { FrameVariant, SamsungFrame } from './frame';

export const DEFAULT_TIMEOUT_MS = 1500;

export class SamsungUnansweredError extends Error {
  constructor(id: number, ms: number) {
    super(`message 0x${id.toString(16).padStart(2, '0')} was not answered within ${ms}ms`);
    this.name = 'SamsungUnansweredError';
  }
}

export type NotificationListener = (frame: SamsungFrame) => void;
/** Bytes as they crossed the link: whole frames out, chunks in — before any decoding can drop them. */
export type RawListener = (bytes: Uint8Array, direction: 'tx' | 'rx') => void;

interface Pending {
  id: number;
  resolve(payload: Uint8Array): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

interface QueuedRequest {
  cancelled: boolean;
  reject(reason: Error): void;
}

export interface SamsungClientOptions {
  timeoutMs?: number;
  variant?: FrameVariant;
}

export class SamsungClient {
  readonly #transport: Transport;
  readonly #variant: FrameVariant;
  readonly #decoder: FrameDecoder;
  readonly #timeoutMs: number;
  #pending: Pending | null = null;
  #queue: Promise<unknown> = Promise.resolve();
  readonly #queued = new Set<QueuedRequest>();
  readonly #notificationListeners = new Set<NotificationListener>();
  readonly #rawListeners = new Set<RawListener>();

  constructor(transport: Transport, options: SamsungClientOptions = {}) {
    this.#transport = transport;
    this.#variant = options.variant ?? 'standard';
    this.#decoder = new FrameDecoder(this.#variant);
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  handleData(chunk: Uint8Array): void {
    for (const listener of this.#rawListeners) listener(chunk, 'rx');
    for (const frame of this.#decoder.push(chunk)) this.#dispatch(frame);
  }

  #dispatch(frame: SamsungFrame): void {
    const pending = this.#pending;
    if (pending) {
      const isAck = frame.id === MsgId.Ack && frame.payload[0] === pending.id;
      if (isAck || frame.id === pending.id) {
        clearTimeout(pending.timer);
        this.#pending = null;
        pending.resolve(isAck ? frame.payload.subarray(1) : frame.payload);
        return;
      }
    }
    for (const listener of this.#notificationListeners) listener(frame);
  }

  /** Sends a message and waits for its reply (or its ack). One in flight at a time. */
  request(id: number, payload: number[] = [], options: { timeoutMs?: number } = {}): Promise<Uint8Array> {
    const entry: QueuedRequest = { cancelled: false, reject: () => {} };
    this.#queued.add(entry);

    const run = (): Promise<Uint8Array> => {
      this.#queued.delete(entry);
      if (entry.cancelled) return Promise.reject(new Error('aborted before this request could be sent'));
      return this.#request(id, payload, options.timeoutMs ?? this.#timeoutMs);
    };

    const result = new Promise<Uint8Array>((resolve, reject) => {
      entry.reject = reject;
      this.#queue.then(
        () => run().then(resolve, reject),
        () => run().then(resolve, reject),
      );
    });

    this.#queue = result.catch(() => undefined);
    return result;
  }

  #request(id: number, payload: number[], timeoutMs: number): Promise<Uint8Array> {
    const frame = encodeFrame(id, payload, { variant: this.#variant });
    return new Promise<Uint8Array>((resolve, reject) => {
      this.#pending = {
        id,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.#pending = null;
          reject(new SamsungUnansweredError(id, timeoutMs));
        }, timeoutMs),
      };
      this.#write(frame).catch((error: Error) => {
        const pending = this.#pending;
        if (!pending) return;
        clearTimeout(pending.timer);
        this.#pending = null;
        pending.reject(error);
      });
    });
  }

  /** Sends without waiting — the echo of a push, which has no reply of its own. */
  send(id: number, payload: number[] = [], options: { response?: boolean } = {}): Promise<void> {
    return this.#write(encodeFrame(id, payload, { response: options.response, variant: this.#variant }));
  }

  #write(frame: Uint8Array): Promise<void> {
    for (const listener of this.#rawListeners) listener(frame, 'tx');
    return this.#transport.write(frame);
  }

  onNotification(listener: NotificationListener): () => void {
    this.#notificationListeners.add(listener);
    return () => this.#notificationListeners.delete(listener);
  }

  onRaw(listener: RawListener): () => void {
    this.#rawListeners.add(listener);
    return () => this.#rawListeners.delete(listener);
  }

  abort(reason: Error): void {
    const pending = this.#pending;
    if (pending) {
      clearTimeout(pending.timer);
      this.#pending = null;
      pending.reject(reason);
    }
    for (const entry of this.#queued) {
      entry.cancelled = true;
      entry.reject(reason);
    }
    this.#queued.clear();
    this.#decoder.reset();
  }
}
