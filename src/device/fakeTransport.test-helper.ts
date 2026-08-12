/**
 * Test doubles for the transport seam. Not imported by the app.
 *
 * `gaiaHarness` answers every request the device sends, because the connect
 * sequence issues dozens of reads and would otherwise stall on the first one.
 * Individual failures are already tolerated by `#refreshAll`, so a responder
 * that errors everything still reaches `connected` — which lets each test
 * script only the commands it actually cares about.
 *
 * `FakeTransport` here is the device-layer double: it implements `Transport`
 * and is handed to `MomentumDevice` via an injected `TransportOpener`, so
 * bytes flow through the same `onData`/`onClose` handlers a real transport
 * would call. `client.test.ts` in this same directory also has a (local,
 * unexported) class of the same name, one layer down — it feeds bytes
 * straight into a `GaiaClient` for request/response tests and never sees a
 * `TransportOpener`. No collision, since neither is imported by the other,
 * but worth knowing both exist before assuming either is the harness.
 */

import { onTestFinished, vi } from 'vitest';

import { encodeFrame } from '../gaia/frame';
import type { Transport, TransportHandlers, TransportOpener } from './transport';

/**
 * Every by-design, tolerated warning `MomentumDevice` logs while connecting
 * when a command goes unanswered — each site wraps its request in its own
 * try/catch specifically so one missing feature does not fail the whole
 * connect. Grounded in the literal templates at each call site in
 * `device.ts`, not guessed:
 *   - `read()` inside `#refreshAll`: `` `[device] ${command.name} failed` ``
 *   - the inlined `getTimer(PowerOff)` read in `#refreshAll`, same wording
 *   - `#probeCapabilities`, called from `#refreshAll`: `getSupportedFeatures
 *     failed — falling back ...`, `getApiVersion failed`
 *   - `refreshConnections`: `getPairedDeviceCount failed`,
 *     `` `getPairedDevice(${index}) failed` ``, `getMaxConnections failed`,
 *     `getOwnDeviceIndex failed`
 *   - `#refreshEq`: `getEqConfig failed — equaliser unavailable`,
 *     `` `getEqBand(${band}) failed` ``
 *   - `#subscribe`: `` `[device] could not subscribe to feature ${feature}` ``
 *
 * A harness that answers nothing — `gaiaHarness()`'s default — makes every
 * one of these fire on every connect, and the noise multiplies across every
 * test that reuses this harness. Matched by this shape rather than muting
 * `console.warn` wholesale, so a warning outside it — a real regression —
 * still reaches the output.
 */
const TOLERATED_CONNECT_WARNING = /^\[device\] (.*\bfailed\b|could not subscribe to feature \d+)/;

/**
 * Quiets the tolerated-connect noise for the currently running test only.
 *
 * Uses `onTestFinished` rather than an `afterEach` because `gaiaHarness()` is
 * called from inside a test body, where `afterEach` cannot be registered —
 * `onTestFinished` is the hook meant for exactly that. Restoring there, not
 * just at the end of the file, is what stops the spy leaking into whichever
 * test runs next.
 */
function quietToleratedConnectWarnings(): void {
  const original = console.warn.bind(console);
  const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    if (typeof args[0] === 'string' && TOLERATED_CONNECT_WARNING.test(args[0])) return;
    original(...args);
  });
  onTestFinished(() => spy.mockRestore());
}

export class FakeTransport implements Transport {
  readonly written: Uint8Array[] = [];
  /**
   * Deliberately diverges from `SerialTransport`: the real one only nulls
   * `#writer` in `close()`, so it leaves `isOpen` true — and `write()` still
   * succeeding — after an *unexpected* drop (see `transport.ts:232-234,
   * 240-260`). Nothing reads `isOpen` today, so that quirk is harmless in
   * production, but a fake that copied it would happily serve replies to a
   * broken implementation that keeps writing after a drop — precisely what
   * phase 2's "a drop mid-connect aborts the in-flight work" tests need to
   * catch. So here, both `close()` and `drop()` flip this false, and `write()`
   * throws once it does.
   */
  isOpen = true;
  onWrite?: (bytes: Uint8Array) => void;
  readonly #handlers: TransportHandlers;

  constructor(handlers: TransportHandlers) {
    this.#handlers = handlers;
  }

  async write(bytes: Uint8Array): Promise<void> {
    // Matches the real transport's message (`transport.ts:263`) so a test
    // asserting on it sees the same string it would against hardware.
    if (!this.isOpen) throw new Error('transport is closed');
    this.written.push(bytes);
    this.onWrite?.(bytes);
  }

  async close(): Promise<void> {
    this.isOpen = false;
  }

  /** Deliver bytes as though the device sent them. */
  receive(bytes: Uint8Array): void {
    this.#handlers.onData(bytes);
  }

  /** Simulate the link going away. */
  drop(reason?: Error): void {
    this.isOpen = false;
    this.#handlers.onClose(reason);
  }
}

export interface SentFrame {
  vendor: number;
  command: number;
  payload: Uint8Array;
}

/** One entry of a `GaiaReplies` map — a scripted reply or a fixed payload. */
export type GaiaReply = number[] | ((payload: Uint8Array, call: number) => number[] | undefined);

export type GaiaReplies = Map<number, GaiaReply>;

const parse = (frame: Uint8Array): SentFrame => {
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  return {
    vendor: view.getUint16(4, false),
    command: view.getUint16(6, false),
    payload: frame.slice(8),
  };
};

export function gaiaHarness(replies: GaiaReplies = new Map()) {
  quietToleratedConnectWarnings();

  let transport: FakeTransport | null = null;
  const sent: SentFrame[] = [];
  const calls = new Map<number, number>();

  const open: TransportOpener = async (_port, handlers) => {
    transport = new FakeTransport(handlers);
    transport.onWrite = (bytes) => {
      const frame = parse(bytes);
      sent.push(frame);
      const call = (calls.get(frame.command) ?? 0) + 1;
      calls.set(frame.command, call);

      const scripted = replies.get(frame.command);
      const payload =
        typeof scripted === 'function' ? scripted(frame.payload, call) : scripted;

      // Reply on a later microtask: the client registers its pending request
      // around the write, and answering inline would be a tighter race than
      // any real transport produces.
      queueMicrotask(() => {
        transport?.receive(
          payload === undefined
            ? encodeFrame(frame.vendor, frame.command | 0x0180, [0x01])
            : encodeFrame(frame.vendor, frame.command | 0x0100, payload),
        );
      });
    };
    return transport;
  };

  return {
    open,
    transport: () => {
      if (!transport) {
        throw new Error(
          'gaiaHarness: no transport yet — connect the device (e.g. adoptPort) before calling transport()',
        );
      }
      return transport;
    },
    sent: () => sent,
    /** Every command ID written, for "did it poll X?" assertions. */
    commands: () => sent.map((frame) => frame.command),
  };
}

export const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));
