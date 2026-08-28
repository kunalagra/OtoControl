/**
 * Request/response over a HeyMelody transport, behind whichever `FrameCodec`
 * the caller is using (`SppFrameCodec` this phase — see `sppFrame.ts`).
 * Mirrors `SoundcoreClient`'s single-pending-request queue.
 */

import type { Transport } from '@/core/transport';
import { replyFor } from './commands';
import { SppFrameCodec, nextSeq } from './sppFrame';
import type { FrameCodec, HeyMelodyFrame } from './sppFrame';

export const DEFAULT_TIMEOUT_MS = 1500;

export class HeyMelodyUnsupportedError extends Error {
  constructor(cmd: number, ms: number) {
    super(
      `command 0x${cmd.toString(16).padStart(4, '0')} was not answered within ${ms}ms — ` +
        'this device does not implement it',
    );
    this.name = 'HeyMelodyUnsupportedError';
  }
}

export type NotificationListener = (frame: HeyMelodyFrame) => void;
export type FrameListener = (frame: HeyMelodyFrame, direction: 'tx' | 'rx') => void;

interface Pending {
  replyCmd: number;
  resolve(payload: Uint8Array): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

interface QueuedRequest {
  cancelled: boolean;
  reject(reason: Error): void;
}

export interface HeyMelodyClientOptions {
  timeoutMs?: number;
  codec?: FrameCodec;
}

export class HeyMelodyClient {
  #transport: Transport;
  #codec: FrameCodec;
  #decoder: ReturnType<FrameCodec['createDecoder']>;
  #pending: Pending | null = null;
  #queue: Promise<unknown> = Promise.resolve();
  #queued = new Set<QueuedRequest>();
  #seq = 0x00;
  #timeoutMs: number;
  #notificationListeners = new Set<NotificationListener>();
  #frameListeners = new Set<FrameListener>();

  constructor(transport: Transport, options: HeyMelodyClientOptions = {}) {
    this.#transport = transport;
    this.#codec = options.codec ?? new SppFrameCodec();
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#decoder = this.#codec.createDecoder();
  }

  handleData(chunk: Uint8Array): void {
    for (const frame of this.#decoder.push(chunk)) this.#dispatch(frame);
  }

  #dispatch(frame: HeyMelodyFrame): void {
    for (const listener of this.#frameListeners) listener(frame, 'rx');

    if (!frame.lengthOk) {
      console.warn(`[heymelody] payLen mismatch on cmd 0x${frame.cmd.toString(16)}, dropping`);
      return;
    }

    const pending = this.#pending;
    if (pending && frame.cmd === pending.replyCmd) {
      clearTimeout(pending.timer);
      this.#pending = null;
      pending.resolve(frame.payload);
      return;
    }

    for (const listener of this.#notificationListeners) listener(frame);
  }

  /** Sends a command and waits for `cmd | 0x8000`. One in flight at a time. */
  request(cmd: number, payload: number[] = [], options: { timeoutMs?: number } = {}): Promise<Uint8Array> {
    const entry: QueuedRequest = { cancelled: false, reject: () => {} };
    this.#queued.add(entry);

    const run = (): Promise<Uint8Array> => {
      this.#queued.delete(entry);
      if (entry.cancelled) {
        return Promise.reject(new Error('aborted before this request could be sent'));
      }
      return this.#request(cmd, payload, options.timeoutMs ?? this.#timeoutMs);
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

  #request(cmd: number, payload: number[], timeoutMs: number): Promise<Uint8Array> {
    this.#seq = nextSeq(this.#seq);
    const seq = this.#seq;
    const packet = this.#codec.encode(cmd, seq, payload);
    const replyCmd = replyFor(cmd);

    return new Promise<Uint8Array>((resolve, reject) => {
      this.#pending = {
        replyCmd,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.#pending = null;
          reject(new HeyMelodyUnsupportedError(cmd, timeoutMs));
        }, timeoutMs),
      };

      for (const listener of this.#frameListeners) {
        listener({ cmd, seq, payload: Uint8Array.from(payload), lengthOk: true }, 'tx');
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
    for (const entry of this.#queued) {
      entry.cancelled = true;
      entry.reject(reason);
    }
    this.#queued.clear();
    this.#decoder.reset();
  }
}
