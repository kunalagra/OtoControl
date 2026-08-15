/**
 * Brand-neutral test doubles for the transport seam. Not imported by the app.
 *
 * `FakeTransport` is the device-layer double: it implements `Transport` and is
 * handed to a device via an injected `TransportOpener`, so bytes flow through
 * the same `onData`/`onClose` handlers a real transport would call. Both
 * drivers' tests use it, which is why it lives in `core/` and knows nothing
 * about GAIA or MDR framing.
 *
 * The GAIA-speaking harness that drives it is
 * `@/drivers/sennheiser/gaiaHarness.test-helper` — it encodes GAIA frames, so
 * it belongs to that driver rather than here.
 */

import type { Transport, TransportHandlers } from './transport';

export class FakeTransport implements Transport {
  readonly written: Uint8Array[] = [];
  /**
   * Deliberately diverges from `SerialTransport`: the real one only nulls
   * `#writer` in `close()`, so it leaves `isOpen` true — and `write()` still
   * succeeding — after an *unexpected* drop (see `close()` and the read loop
   * in `transport.ts`). Nothing reads `isOpen` today, so that quirk is
   * harmless in production, but a fake that copied it would serve replies to a
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
    // Matches the real transport's message (the `write()` throw in
    // `transport.ts`) so a test asserting on it sees the same string it
    // would against hardware.
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

export const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));
