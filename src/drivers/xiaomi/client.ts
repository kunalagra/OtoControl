/**
 * Request/response over an RFCOMM transport speaking Xiaomi RCSP.
 *
 * Unlike the single-in-flight clients elsewhere in this repo, replies are
 * matched by sequence number, so several requests can be outstanding. The
 * earbuds also send requests of their own (auth challenges, status pushes,
 * config notifications); every one must be answered with a type-`04` frame
 * echoing its opcode and sequence, and `onInbound` is where the device says
 * what to answer with.
 */

import type { Transport } from '@/core/transport';
import { FrameType, createDeframer, encodeRequest, encodeResponseTo } from './frame';
import type { XiaomiFrame } from './frame';

export const DEFAULT_TIMEOUT_MS = 1500;

export class XiaomiUnansweredError extends Error {
  constructor(opcode: number, ms: number) {
    super(`opcode 0x${opcode.toString(16).padStart(2, '0')} was not answered within ${ms}ms`);
    this.name = 'XiaomiUnansweredError';
  }
}

/** The earbuds answered, with a non-zero status. */
export class XiaomiRejectedError extends Error {
  readonly status: number;

  constructor(opcode: number, status: number) {
    super(`opcode 0x${opcode.toString(16).padStart(2, '0')} was refused with status ${status}`);
    this.name = 'XiaomiRejectedError';
    this.status = status;
  }
}

/** Bytes as they crossed the link: whole frames out, chunks in — before any decoding can drop them. */
export type RawListener = (bytes: Uint8Array, direction: 'tx' | 'rx') => void;

/**
 * Handles a frame the earbuds sent. Returns the payload of the answer, or
 * nothing for an empty one; the client sends the answer either way.
 */
export type InboundHandler = (frame: XiaomiFrame) => number[] | void;

interface Pending {
  opcode: number;
  resolve(payload: Uint8Array): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export interface XiaomiClientOptions {
  timeoutMs?: number;
}

export class XiaomiClient {
  #transport: Transport;
  #deframer = createDeframer();
  #pending = new Map<number, Pending>();
  #seq = 0;
  #timeoutMs: number;
  #inbound: InboundHandler = () => undefined;
  #rawListeners = new Set<RawListener>();

  constructor(transport: Transport, options: XiaomiClientOptions = {}) {
    this.#transport = transport;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  handleData(chunk: Uint8Array): void {
    for (const listener of this.#rawListeners) listener(chunk, 'rx');
    for (const frame of this.#deframer.push(chunk)) this.#dispatch(frame);
  }

  #dispatch(frame: XiaomiFrame): void {
    if (frame.type === FrameType.Response) {
      const pending = this.#pending.get(frame.seq);
      if (!pending || pending.opcode !== frame.opcode) return;
      clearTimeout(pending.timer);
      this.#pending.delete(frame.seq);
      if (frame.status !== 0) pending.reject(new XiaomiRejectedError(frame.opcode, frame.status));
      else pending.resolve(frame.payload);
      return;
    }

    let answer: number[] = [];
    try {
      answer = this.#inbound(frame) ?? [];
    } catch (error) {
      console.warn(`[xiaomi] unreadable 0x${frame.opcode.toString(16)} from the earbuds`, error);
    }
    this.#send(encodeResponseTo(frame, answer));
  }

  /** Sets what answers the earbuds' own requests and notifications. */
  onInbound(handler: InboundHandler): void {
    this.#inbound = handler;
  }

  onRaw(listener: RawListener): () => void {
    this.#rawListeners.add(listener);
    return () => this.#rawListeners.delete(listener);
  }

  #send(packet: Uint8Array): Promise<void> {
    for (const listener of this.#rawListeners) listener(packet, 'tx');
    return this.#transport.write(packet);
  }

  /** Sends a command and waits for the response with the same sequence number. */
  request(opcode: number, payload: number[] = [], options: { timeoutMs?: number } = {}): Promise<Uint8Array> {
    const timeoutMs = options.timeoutMs ?? this.#timeoutMs;
    do {
      this.#seq = (this.#seq + 1) & 0xff;
    } while (this.#pending.has(this.#seq));
    const seq = this.#seq;
    const packet = encodeRequest(opcode, seq, payload);

    return new Promise<Uint8Array>((resolve, reject) => {
      this.#pending.set(seq, {
        opcode,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.#pending.delete(seq);
          reject(new XiaomiUnansweredError(opcode, timeoutMs));
        }, timeoutMs),
      });
      this.#send(packet).catch((error: Error) => {
        const pending = this.#pending.get(seq);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.#pending.delete(seq);
        pending.reject(error);
      });
    });
  }

  abort(reason: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.#pending.clear();
    this.#deframer.reset();
  }
}
