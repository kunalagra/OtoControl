/**
 * Telling apart what is behind a shared serial service.
 *
 * Most services name their device: the UUID a port was granted for is the
 * protocol. Standard SPP (0x1101) does not — realme/OPPO earbuds and Samsung's
 * Galaxy Buds+/Live/Pro all answer on it — so a port granted for it has to be
 * *listened to* before anyone knows which driver should have it.
 *
 * `identifyOnPort` opens the port once, runs each candidate protocol's own
 * recogniser over what comes back, and hands the same open transport to the
 * winner (`HandoffTransport`), replaying what was heard so nothing the device
 * sent during classification is lost. No close and reopen in between: an
 * RFCOMM channel is exclusive, and a quick reopen is exactly what
 * `PortOpenError` warns about.
 *
 * The order is deliberately gentle. Listening first costs nothing and is
 * decisive for earbuds that talk unprompted (Galaxy Buds push their status the
 * moment they connect). Only then does anything get sent — each candidate's
 * own harmless read, never a write — so a device that stays quiet still
 * identifies itself without being addressed in another protocol's words
 * before it has had the chance to speak in its own.
 */

import type { Brand } from './brand';
import type { Transport, TransportHandlers, TransportOpener } from './transport';

/** How a protocol recognises itself on a link and, if it can, provokes an answer. */
export interface ProtocolProbe {
  /**
   * Whether the bytes heard so far are unmistakably this protocol's — framed
   * and checked, not merely starting with its sync byte. Gets everything heard
   * since the port opened, so it may be handed a partial frame; it must say no.
   */
  recognises(heard: Uint8Array): boolean;
  /** A read-only request that makes a silent device of this protocol answer. */
  query?: Uint8Array;
}

export interface ProbeCandidate {
  brand: Brand;
  probe: ProtocolProbe;
}

export interface IdentifyOptions {
  /** How long to listen before sending anything. */
  passiveMs?: number;
  /** How long to wait for each candidate's query to be answered. */
  activeMs?: number;
  /** A brand this port was identified as last time: its query goes first, not last. */
  preferred?: Brand | null;
}

export const PASSIVE_MS = 1200;
export const ACTIVE_MS = 1000;

const concat = (chunks: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
};

/**
 * An open transport whose first listener arrives late. Collects what the
 * device sends until a driver takes over via `start` (the contract
 * `DeviceSession.adoptTransport` already uses for BLE), then replays it and
 * forwards live — including a close that happened in between.
 */
export class HandoffTransport implements Transport {
  #inner: Transport | null = null;
  #heard: Uint8Array[] = [];
  #sink: TransportHandlers | null = null;
  /** True from `start` until the replay has run: live data queues behind it rather than overtaking it. */
  #replaying = false;
  #closed: { reason?: Error } | null = null;
  readonly #watchers = new Set<() => void>();

  /** What to hand the real transport's opener, before there is a transport to hand over. */
  readonly handlers: TransportHandlers = {
    onData: (chunk) => {
      if (this.#sink && !this.#replaying) this.#sink.onData(chunk);
      else this.#heard.push(chunk);
      for (const watcher of this.#watchers) watcher();
    },
    onClose: (reason) => {
      this.#closed = { reason };
      if (this.#sink && !this.#replaying) this.#sink.onClose(reason);
      for (const watcher of this.#watchers) watcher();
    },
  };

  bind(inner: Transport): void {
    this.#inner = inner;
  }

  get isOpen(): boolean {
    return this.#closed === null && (this.#inner?.isOpen ?? false);
  }

  /** Everything heard since the port opened and not yet handed over. */
  get heard(): Uint8Array {
    return concat(this.#heard);
  }

  get closed(): { reason?: Error } | null {
    return this.#closed;
  }

  /** Calls `watcher` on every arrival and on close; returns the way to stop. */
  watch(watcher: () => void): () => void {
    this.#watchers.add(watcher);
    return () => this.#watchers.delete(watcher);
  }

  write(bytes: Uint8Array): Promise<void> {
    if (!this.#inner) return Promise.reject(new Error('transport is closed'));
    return this.#inner.write(bytes);
  }

  async close(): Promise<void> {
    await this.#inner?.close();
  }

  /**
   * The adopting driver's listeners. Replays after the current turn, not now:
   * `adoptTransport` calls this before it has built its client, and a chunk
   * delivered before that has nowhere to go.
   */
  start(handlers: TransportHandlers): void {
    this.#sink = handlers;
    this.#replaying = true;
    queueMicrotask(() => {
      const replay = this.#heard;
      this.#heard = [];
      this.#replaying = false;
      for (const chunk of replay) handlers.onData(chunk);
      if (this.#closed) handlers.onClose(this.#closed.reason);
    });
  }
}

export interface Identified {
  /** The recognised brand, or null when nothing answered in time. */
  brand: Brand | null;
  /** Still open, still holding what it heard. */
  transport: HandoffTransport;
}

/** Resolves when `ready()` or when `ms` passes; throws if the link closes first. */
function waitFor(transport: HandoffTransport, ready: () => boolean, ms: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const check = (): void => {
      if (transport.closed) {
        finish();
        reject(transport.closed.reason ?? new Error('connection lost'));
      } else if (ready()) {
        finish();
        resolve();
      }
    };
    const stop = transport.watch(check);
    const timer = setTimeout(() => {
      finish();
      resolve();
    }, ms);
    function finish(): void {
      clearTimeout(timer);
      stop();
    }
    check();
  });
}

export async function identifyOnPort(
  open: TransportOpener,
  port: SerialPort,
  candidates: readonly ProbeCandidate[],
  options: IdentifyOptions = {},
): Promise<Identified> {
  const passiveMs = options.passiveMs ?? PASSIVE_MS;
  const activeMs = options.activeMs ?? ACTIVE_MS;
  const transport = new HandoffTransport();
  transport.bind(await open(port, transport.handlers));

  const recognised = (): Brand | null => {
    const heard = transport.heard;
    return candidates.find((candidate) => candidate.probe.recognises(heard))?.brand ?? null;
  };

  // The brand identified last time asks first; everyone else follows in the order given.
  const preferred = candidates.find((candidate) => candidate.brand === options.preferred);
  const askers = [...(preferred ? [preferred] : []), ...candidates.filter((candidate) => candidate !== preferred)].filter(
    (candidate) => candidate.probe.query,
  );

  const steps: Array<{ send?: Uint8Array; wait: number }> = [];
  if (preferred?.probe.query) steps.push({ send: preferred.probe.query, wait: activeMs });
  steps.push({ wait: passiveMs });
  for (const asker of askers) if (asker !== preferred) steps.push({ send: asker.probe.query, wait: activeMs });

  try {
    for (const step of steps) {
      if (recognised()) break;
      if (step.send) await transport.write(step.send);
      await waitFor(transport, () => recognised() !== null, step.wait);
    }
  } catch (error) {
    await transport.close().catch(() => undefined);
    throw error;
  }
  return { brand: recognised(), transport };
}
