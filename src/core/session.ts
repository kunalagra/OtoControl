/**
 * The connection plumbing both device classes used to duplicate.
 *
 * `MomentumDevice` and `SonyDevice` differ in what they poll and how they
 * shape their state, but not in how a serial port becomes a live protocol
 * client — open the transport, build the client, wire notifications and the
 * debug console's frame tap, then hand control back to the caller. That part
 * moved here.
 *
 * Composed, not inherited: a device owns a session as a field. The lifecycle
 * is shared; `DeviceState` and `SonyState` are not, and this class has no
 * business knowing either shape. It reports what happened through `hooks` and
 * leaves state entirely to the device — it never patches one itself.
 *
 * `TClient` is deliberately unconstrained (it is `GaiaClient` or `MdrClient`,
 * neither of which this module imports), so the only thing this class can do
 * with a client is what `hooks` lets it do — including aborting it on
 * teardown, via the required `abort` hook rather than reaching into the
 * client itself.
 */

import type { Brand } from './brand';
import { findGrantedPort } from './transport';
import type { Transport, TransportOpener } from './transport';
import type { ConnectionStatus } from './connection';

export interface SessionHooks<TClient> {
  /** Builds the protocol client once the transport is open. */
  createClient(transport: Transport): TClient;
  /** Feeds inbound bytes to the client. */
  handleData(client: TClient, chunk: Uint8Array): void;
  /**
   * Wires notification listeners onto a freshly built client. Frame taps
   * (the debug console) are not this hook's concern — they go through
   * `attach`, which the session itself calls against whichever client is
   * live, reconnect after reconnect.
   */
  wire(client: TClient): void;
  /**
   * Status transitions, so each device patches its own state shape.
   *
   * `error` is always `null` at both call sites in `connectTo` today — kept
   * in the signature rather than dropped because a future status this
   * session doesn't yet have (an auth challenge, say) would need to carry a
   * reason without going through `onDrop`. Wiring that up is deferred until
   * a driver actually needs it.
   */
  onStatus(status: ConnectionStatus, error: string | null): void;
  /** An unexpected close. The device resets its own state. */
  onDrop(reason?: Error): void;
  /**
   * Fails any work the client has in flight when the link goes, on both the
   * drop path and an explicit `disconnect()`. Required — `GaiaClient` and
   * `MdrClient` both support it, and `setDeviceConnected`'s NACK-vs-drop
   * discrimination depends on abort rejecting the pending request, so a
   * device that silently forgot to wire this hook would degrade at runtime
   * in a way no caller would notice. A device supplies
   * `(client, reason) => client.abort(reason)` here, which keeps the call
   * type-checked against the real client at the call site, instead of
   * reaching into an unconstrained `TClient` and hoping a method is there at
   * runtime.
   */
  abort(client: TClient, reason: Error): void;
}

/** An attach function: given the live client, wires itself on and returns its own unwire. */
type Attachment<TClient> = (client: TClient) => () => void;

export class DeviceSession<TClient> {
  #transport: Transport | null = null;
  #client: TClient | null = null;
  /**
   * Attach functions registered via `attach`, in registration order. Survive
   * reconnects — both device classes rely on this for the debug console —
   * and are re-invoked against every new client `connectTo` builds.
   */
  #attachments = new Set<Attachment<TClient>>();
  /**
   * Each attachment's unwire thunk for the *current* client, so `attach`'s
   * returned disposer can genuinely detach from a live client instead of
   * only stopping future reconnects from re-wiring it. Also unwired — not
   * just forgotten — whenever the client it points at is discarded wholesale
   * (a drop, an explicit disconnect, or a newer connect superseding this
   * one), via `#detachLive`. The discarded client would never legitimately
   * fire again regardless (nothing left can reach its `handleData`, thanks
   * to the generation guard in `connectTo`'s `onData`), but detaching for
   * real keeps that a fact this class enforces rather than one it merely
   * assumes holds.
   */
  #liveUnwire = new Map<Attachment<TClient>, () => void>();
  /**
   * Bumped on every `connectTo` and `disconnect`. Captured before the
   * transport-open `await`; if it has moved by the time that await resumes,
   * this connect was superseded (raced by a drop, or overtaken by a newer
   * connect or an explicit disconnect) and must not touch state as though it
   * won.
   *
   * The drop this guards against is not a rare interleaving: `SerialTransport`
   * queues its read loop before `open()`'s promise resolves, so an
   * already-unreachable port makes `onClose` fire before `connectTo` ever
   * gets to check anything.
   */
  #generation = 0;
  readonly #openTransport: TransportOpener;
  readonly #hooks: SessionHooks<TClient>;

  constructor(openTransport: TransportOpener, hooks: SessionHooks<TClient>) {
    this.#openTransport = openTransport;
    this.#hooks = hooks;
  }

  get client(): TClient | null {
    return this.#client;
  }

  /**
   * Frame-level tap for the debug console: `fn` wires itself onto a client
   * and hands back its own unwire. Called against a client already live —
   * opening the debug console mid-session must not miss frames until the
   * next reconnect — and again on every future reconnect, since the
   * attachment itself, not a one-time wiring, is what survives. The returned
   * disposer detaches from whichever client is currently wired, if any, and
   * stops future connects from wiring it again.
   */
  attach(fn: Attachment<TClient>): () => void {
    this.#attachments.add(fn);
    if (this.#client) this.#liveUnwire.set(fn, fn(this.#client));

    return () => {
      this.#attachments.delete(fn);
      const unwire = this.#liveUnwire.get(fn);
      if (unwire) {
        this.#liveUnwire.delete(fn);
        unwire();
      }
    };
  }

  /** Detaches every attachment from whichever client it is currently wired to, then forgets it. */
  #detachLive(): void {
    for (const unwire of this.#liveUnwire.values()) unwire();
    this.#liveUnwire.clear();
  }

  /** Finds an adoptable granted port for this brand, or null. */
  static async grantedPortFor(brand: Brand): Promise<SerialPort | null> {
    const granted = await findGrantedPort();
    if (!granted || granted.service.brand !== brand) return null;
    return granted.port;
  }

  /**
   * Opens, builds, wires, then runs `after` — the driver's own subscribe/poll
   * sequence. `after` receives the live client, but a device may just as well
   * ignore it and keep reading its own `client` getter — see `#handleDrop`,
   * which can null that getter out from under `after` mid-flight, and every
   * existing driver's read helpers already tolerate that by re-checking it.
   */
  async connectTo(target: import('./transport').ConnectionTarget, after: (client: TClient) => Promise<void>): Promise<void> {
    const generation = (this.#generation += 1);
    this.#hooks.onStatus('connecting', null);
    this.#teardownSuperseded();

    const transport = await this.#openTransport(target, this.#handlersFor(generation));

    // A drop landing in the open window above already ran #handleDrop — with
    // #client still null, since it is not assigned until below — and bumped
    // #generation past what we captured. Patching `connected` on top of that
    // would claim a live link over a transport that is already dead. Close
    // what we just opened and stop; #handleDrop already reported the drop.
    if (generation !== this.#generation) {
      await transport.close().catch(() => undefined);
      return;
    }

    await this.#activate(transport, generation, after);
  }

  /**
   * Takes over a transport the caller already opened — the single-connection
   * BLE path. The manager resolves which driver owns a Bluetooth device only
   * by connecting and listing its services; opening a second connection for
   * the winning driver was the old shape, and rapid GATT
   * connect→disconnect→connect cycles crash Chrome's browser process on
   * macOS. Here the one connection is brand-resolved first and handed over
   * without ever being closed in between.
   *
   * The transport must not have listeners wired yet: `GattTransport.start`
   * attaches this session's generation-guarded handlers, exactly as the
   * opener would have.
   */
  async adoptTransport(
    transport: Transport & { start?(handlers: import('./transport').TransportHandlers): void },
    after: (client: TClient) => Promise<void>,
  ): Promise<void> {
    const generation = (this.#generation += 1);
    this.#hooks.onStatus('connecting', null);
    this.#teardownSuperseded();

    transport.start?.(this.#handlersFor(generation));
    await this.#activate(transport, generation, after);
  }

  /** The guarded handler pair every transport this session owns receives. */
  #handlersFor(generation: number): import('./transport').TransportHandlers {
    return {
      onData: (chunk) => {
        // Gated on the generation captured at connect, not on the live
        // `#client` field — the latter would happily hand a superseded
        // transport's bytes to whatever client is current by the time they
        // arrive. `onClose` uses this same guard via #handleDrop.
        if (generation !== this.#generation) return;
        if (this.#client) this.#hooks.handleData(this.#client, chunk);
      },
      onClose: (reason) => this.#handleDrop(generation, reason),
    };
  }

  /**
   * A live session from a previous connect — manager.connect() reaches
   * connectTo with no prior disconnect() — must be torn down before the new
   * transport is even requested. Left in place, it keeps reading, and its
   * bytes would feed whichever client ends up current. Mirrors `disconnect()`:
   * abort in-flight work, then close.
   *
   * Deliberately no onDrop here — which means the superseded session's device
   * state is *not* reset by this. `onStatus('connecting', ...)` only patches
   * `status` and `error`; it does not touch `info`, `battery`, `eq`, or
   * anything else `onDrop` would normally blank out. So the previous device's
   * readings keep rendering, stale, under a "connecting" status until
   * `refresh()` overwrites them once this connect lands. That gap pre-dates
   * this split and is not addressed here.
   */
  #teardownSuperseded(): void {
    const previousTransport = this.#transport;
    const previousClient = this.#client;
    this.#transport = null;
    this.#client = null;
    this.#detachLive();
    if (previousClient) {
      this.#hooks.abort(previousClient, new Error('superseded by a new connection'));
    }
    void previousTransport?.close().catch(() => undefined);
  }

  /** Wires a freshly-secured transport into a live session and runs `after`. */
  async #activate(
    transport: Transport,
    generation: number,
    after: (client: TClient) => Promise<void>,
  ): Promise<void> {
    void generation;
    const client = this.#hooks.createClient(transport);
    this.#hooks.wire(client);
    for (const fn of this.#attachments) this.#liveUnwire.set(fn, fn(client));

    this.#transport = transport;
    this.#client = client;
    this.#hooks.onStatus('connected', null);

    await after(client);
  }

  #handleDrop(generation: number, reason?: Error): void {
    // A stale close from a transport this session has already moved past —
    // superseded by a newer connect, or torn down by disconnect() — has
    // nothing left to react to.
    //
    // A second connectTo used to leave that case ambiguous with a more
    // dangerous one: #generation is bumped at the top of connectTo, before
    // its await, so while a newer connect was still mid-open a genuine drop
    // of the *previous*, still-live transport looked identical to a truly
    // stale close and was silently discarded here — no abort, no onDrop, the
    // client's in-flight requests left to hang until their own timeout
    // instead of rejecting immediately. That is no longer reachable:
    // connectTo now disposes of the previous transport and client itself,
    // synchronously, before it ever awaits the new transport's open — so by
    // the time a newer connect is "mid-open", nothing it superseded is still
    // alive to drop out from under it. Every close reaching here really is
    // stale.
    if (generation !== this.#generation) return;
    this.#generation += 1;
    if (this.#client) this.#hooks.abort(this.#client, reason ?? new Error('connection lost'));
    this.#transport = null;
    this.#client = null;
    this.#detachLive();
    this.#hooks.onDrop(reason);
  }

  /**
   * Aborts the client, closes the transport, and clears both fields. Bumps
   * the generation first, so a close this causes (a real one is never
   * reported by `SerialTransport` while it is intentionally closing, but a
   * fake in a test might) cannot be mistaken for a fresh drop.
   */
  async disconnect(): Promise<void> {
    this.#generation += 1;
    const transport = this.#transport;
    if (this.#client) this.#hooks.abort(this.#client, new Error('disconnected'));
    this.#transport = null;
    this.#client = null;
    this.#detachLive();
    await transport?.close().catch(() => undefined);
  }
}
