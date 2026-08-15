/**
 * Request/response correlation over a GAIA transport.
 *
 * Requests are serialised — one in flight at a time. The headphones answer a
 * request `id` with `id | 0x0100` (or `id | 0x0180` on failure), and there is
 * no sequence number, so overlapping requests for the same feature would be
 * indistinguishable.
 */

import type { Command } from './gaia/commands';
import { FrameDecoder, encodeFrame, frameKind, requestIdFor, toHex } from './gaia/frame';
import type { GaiaFrame } from './gaia/frame';
import { blockedReason, isBlocked, sweepBlockedReason } from './gaia/unsafe';
import type { Transport } from '@/core/transport';

export const DEFAULT_TIMEOUT_MS = 5000;

export class GaiaError extends Error {
  readonly command: number;
  readonly status: number | undefined;

  constructor(name: string, command: number, payload: Uint8Array) {
    const status = payload.length > 0 ? payload[0] : undefined;
    super(
      `${name} failed (command 0x${command.toString(16).toUpperCase()}` +
        (status === undefined ? ')' : `, status 0x${status.toString(16)})`),
    );
    this.name = 'GaiaError';
    this.command = command;
    this.status = status;
  }
}

export class GaiaTimeoutError extends Error {
  constructor(name: string, ms: number) {
    super(`${name} timed out after ${ms}ms`);
    this.name = 'GaiaTimeoutError';
  }
}

interface Pending {
  vendor: number;
  requestId: number;
  name: string;
  resolve(payload: Uint8Array): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export interface ProbeResult {
  command: number;
  /** `response` = implemented, `error` = known but rejected, `silent` = no reply. */
  outcome: 'response' | 'error' | 'silent' | 'blocked';
  payload?: Uint8Array;
  detail?: string;
}

export type FrameListener = (frame: GaiaFrame, direction: 'tx' | 'rx') => void;
export type NotificationListener = (frame: GaiaFrame) => void;

export interface GaiaClientOptions {
  timeoutMs?: number;
}

export class GaiaClient {
  #transport: Transport;
  #decoder: FrameDecoder;
  #pending: Pending | null = null;
  #queue: Promise<unknown> = Promise.resolve();
  #timeoutMs: number;
  #notificationListeners = new Set<NotificationListener>();
  #frameListeners = new Set<FrameListener>();

  constructor(transport: Transport, options: GaiaClientOptions = {}) {
    this.#transport = transport;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#decoder = new FrameDecoder({
      onDesync: (dropped) => console.warn(`[gaia] discarded ${dropped} unaligned byte(s)`),
    });
  }

  /** Feed bytes straight from the transport. */
  handleData(chunk: Uint8Array): void {
    for (const frame of this.#decoder.push(chunk)) this.#dispatch(frame);
  }

  #dispatch(frame: GaiaFrame): void {
    for (const listener of this.#frameListeners) listener(frame, 'rx');

    const kind = frameKind(frame.command);

    if (kind === 'notification') {
      for (const listener of this.#notificationListeners) listener(frame);
      return;
    }

    const pending = this.#pending;
    if (
      !pending ||
      pending.vendor !== frame.vendor ||
      pending.requestId !== requestIdFor(frame.command)
    ) {
      // The headphones push some state changes as response-shaped frames
      // rather than notifications — PhysicalDevice_State (0x0502) does this.
      // Treat an unsolicited response as an update, not as noise.
      if (kind === 'response') {
        for (const listener of this.#notificationListeners) listener(frame);
      } else {
        console.warn(`[gaia] unmatched frame ${toHex(frame.raw)}`);
      }
      return;
    }

    this.#settle(() => {
      if (kind === 'error') {
        pending.reject(new GaiaError(pending.name, frame.command, frame.payload));
      } else {
        pending.resolve(frame.payload);
      }
    });
  }

  #settle(action: () => void): void {
    const pending = this.#pending;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pending = null;
    action();
  }

  /**
   * Sends a command and resolves with its decoded response.
   *
   * Calls are queued, so callers can fire several off in parallel without
   * interleaving them on the wire.
   */
  request<TArg, TResult>(
    command: Command<TArg, TResult>,
    arg: TArg,
    options: { timeoutMs?: number } = {},
  ): Promise<TResult> {
    const run = () => this.#send(command, arg, options.timeoutMs ?? this.#timeoutMs);
    // Keep the chain alive even if this request rejects.
    const result = this.#queue.then(run, run);
    this.#queue = result.catch(() => undefined);
    return result;
  }

  async #send<TArg, TResult>(
    command: Command<TArg, TResult>,
    arg: TArg,
    timeoutMs: number,
  ): Promise<TResult> {
    if (isBlocked(command.vendor, command.id)) {
      throw new Error(
        `refusing to send ${command.name}: ${blockedReason(command.vendor, command.id)}`,
      );
    }
    const payload = command.encode(arg);
    const frame = encodeFrame(command.vendor, command.id, payload);

    const responsePayload = await new Promise<Uint8Array>((resolve, reject) => {
      this.#pending = {
        vendor: command.vendor,
        requestId: command.id,
        name: command.name,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.#pending = null;
          reject(new GaiaTimeoutError(command.name, timeoutMs));
        }, timeoutMs),
      };

      for (const listener of this.#frameListeners) {
        listener(
          {
            flags: frame[1],
            vendor: command.vendor,
            command: command.id,
            payload: Uint8Array.from(payload),
            raw: frame,
          },
          'tx',
        );
      }

      this.#transport.write(frame).catch((error: Error) => {
        this.#settle(() => reject(error));
      });
    });

    return command.decode(responsePayload);
  }

  /**
   * Sends a raw frame with no correlation. Used by the debug console.
   *
   * Reports itself to the frame listeners like `#send` does. Without that a
   * hand-typed frame is invisible and only its reply appears, which reads as a
   * log that has lost the request — the one thing this console exists to show.
   */
  async sendRaw(frame: Uint8Array): Promise<void> {
    if (frame.length >= 8) {
      const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
      const vendor = view.getUint16(4, false);
      const command = view.getUint16(6, false);
      const reason = sweepBlockedReason(vendor, command);
      if (reason) throw new Error(`refusing to send this frame: ${reason}`);

      for (const listener of this.#frameListeners) {
        listener(
          { flags: frame[1], vendor, command, payload: frame.slice(8), raw: frame },
          'tx',
        );
      }
    }
    await this.#transport.write(frame);
  }

  /**
   * Sends a zero-payload request and reports what came back without throwing.
   * Used to discover which command IDs a firmware actually implements.
   */
  async probe(vendor: number, command: number, timeoutMs = 700): Promise<ProbeResult> {
    const reason = sweepBlockedReason(vendor, command);
    if (reason) return { command, outcome: 'blocked', detail: reason };
    const raw: Command<void, Uint8Array> = {
      name: `probe 0x${command.toString(16)}`,
      vendor,
      id: command,
      encode: () => [],
      decode: (payload) => payload,
    };
    try {
      const payload = await this.request(raw, undefined, { timeoutMs });
      return { command, outcome: 'response', payload };
    } catch (error) {
      if (error instanceof GaiaError) {
        return { command, outcome: 'error', detail: `status 0x${(error.status ?? 0).toString(16)}` };
      }
      if (error instanceof GaiaTimeoutError) return { command, outcome: 'silent' };
      throw error;
    }
  }

  onNotification(listener: NotificationListener): () => void {
    this.#notificationListeners.add(listener);
    return () => this.#notificationListeners.delete(listener);
  }

  onFrame(listener: FrameListener): () => void {
    this.#frameListeners.add(listener);
    return () => this.#frameListeners.delete(listener);
  }

  /** Fails any in-flight request; called when the transport drops. */
  abort(reason: Error): void {
    const pending = this.#pending;
    if (pending) this.#settle(() => pending.reject(reason));
    this.#decoder.reset();
  }
}
