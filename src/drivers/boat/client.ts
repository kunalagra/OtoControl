/**
 * Request/response over the Bluetrum SPP transport.
 *
 * One in-flight request per command: the app correlates a `Response` to its
 * `Request` by command-byte equality only
 * (`DeviceCommManager.a(Response, Entry)`). Unsolicited traffic — type-3
 * pushes and type-2 frames with no waiter — goes to the notification
 * listeners. OTA commands (`0xA0–0xA3`) are fire-and-forget
 * (`OtaRequest.withResponse() == false`) and resolve once written.
 */

import type { Transport } from '@/core/transport';
import { BluetrumDecoder, encodeFrames, toHex } from './bluetrumFrame';
import type { BluetrumFrame, SeqState } from './bluetrumFrame';
import { Cmd } from './commands';

export const DEFAULT_TIMEOUT_MS = 1500;

export class BoatUnsupportedError extends Error {
  constructor(cmd: number, ms: number) {
    super(
      `command 0x${(cmd & 0xff).toString(16).padStart(2, '0')} was not answered within ${ms}ms — ` +
        'this device does not implement it',
    );
    this.name = 'BoatUnsupportedError';
  }
}

export type NotificationListener = (frame: BluetrumFrame) => void;

interface Pending {
  cmd: number;
  resolve(payload: Uint8Array): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export interface BoatClientOptions {
  timeoutMs?: number;
}

/** Command bytes that expect no ack (signed Java bytes, normalised with & 0xff). */
const NO_RESPONSE = new Set([Cmd.OtaGetInfo, Cmd.OtaStart, Cmd.OtaSendData, Cmd.OtaState].map((c) => c & 0xff));

export class BoatClient {
  #transport: Transport;
  #decoder = new BluetrumDecoder();
  #seq: SeqState = { n: 0 };
  #maxPayload = 20;
  #pending: Pending | null = null;
  #queue: Promise<unknown> = Promise.resolve();
  #timeoutMs: number;
  #listeners = new Set<NotificationListener>();

  constructor(transport: Transport, options: BoatClientOptions = {}) {
    this.#transport = transport;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Info `-1` (max packet size) feeds `setMaxPacketSize` here. */
  setMaxPayload(n: number): void {
    if (n > 5) this.#maxPayload = n - 5;
  }

  handleData(chunk: Uint8Array): void {
    for (const frame of this.#decoder.push(chunk)) this.#dispatch(frame);
  }

  #dispatch(frame: BluetrumFrame): void {
    const pending = this.#pending;
    if (pending && frame.cmd === pending.cmd && frame.type === 2) {
      clearTimeout(pending.timer);
      this.#pending = null;
      pending.resolve(frame.payload);
      return;
    }
    for (const listener of this.#listeners) listener(frame);
  }

  request(cmd: number, payload: number[] = [], options: { timeoutMs?: number } = {}): Promise<Uint8Array> {
    const run = () => this.#request(cmd, payload, options.timeoutMs ?? this.#timeoutMs);
    const result = this.#queue.then(run, run);
    this.#queue = result.catch(() => undefined);
    return result;
  }

  #request(cmd: number, payload: number[], timeoutMs: number): Promise<Uint8Array> {
    const normalised = cmd & 0xff;
    const frames = encodeFrames(
      normalised,
      1,
      Uint8Array.from(payload.map((b) => b & 0xff)),
      this.#seq,
      this.#maxPayload,
    );
    const send = async (): Promise<void> => {
      for (const frame of frames) {
        // eslint-disable-next-line no-await-in-loop
        await this.#transport.write(frame);
      }
    };

    if (NO_RESPONSE.has(normalised)) {
      return send().then(() => new Uint8Array(0));
    }

    return new Promise<Uint8Array>((resolve, reject) => {
      this.#pending = {
        cmd: normalised,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.#pending = null;
          reject(new BoatUnsupportedError(normalised, timeoutMs));
        }, timeoutMs),
      };
      send().catch((error: Error) => {
        const pending = this.#pending;
        if (!pending) return;
        clearTimeout(pending.timer);
        this.#pending = null;
        pending.reject(error);
      });
    });
  }

  onNotification(listener: NotificationListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
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

export const debugHex = toHex;
