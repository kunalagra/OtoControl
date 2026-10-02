/**
 * pw_rpc over HDLC over a Pixel Buds transport: unary calls, server streams,
 * and the channel discovery that comes first.
 *
 * Unary calls queue one at a time, as pbpctrl issues them (every call carries
 * call id 0). A reply is matched on channel, service and method — not call
 * id, which the buds' unsolicited announcement does not echo.
 *
 * The channel is not negotiated. The buds announce the one they serve with an
 * unsolicited `GetSoftwareInfo` reply at connect, so the client is listening
 * from construction and `discoverChannel` usually just reads what already
 * arrived. If nothing does, it asks on each candidate in turn — **a fallback
 * that no source verifies**; see docs/superpowers/specs/2026-10-02-pixelbuds-driver-design.md §4.
 */

import type { Transport } from '@/core/transport';
import { createHdlcDecoder, encodeFrame } from './hdlc';
import { MAESTRO_SERVICE, Method } from './maestro';
import {
  addressForChannel,
  CANDIDATE_CHANNELS,
  decodeRpcPacket,
  encodeRpcPacket,
  PacketType,
  RpcError,
  RpcStatus,
  rpcHash,
} from './rpc';
import type { RpcPacket } from './rpc';

export const DEFAULT_TIMEOUT_MS = 1500;
/** How long the buds get to announce their channel before the client starts asking. */
export const DEFAULT_DISCOVERY_WAIT_MS = 1500;
/** How long each candidate channel gets to answer an active `GetSoftwareInfo`. */
export const DEFAULT_CHANNEL_PROBE_MS = 700;

export class PixelBudsTimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`${what} was not answered within ${ms}ms`);
    this.name = 'PixelBudsTimeoutError';
  }
}

export class PixelBudsChannelError extends Error {
  constructor() {
    super('These earbuds did not answer on any Maestro channel.');
    this.name = 'PixelBudsChannelError';
  }
}

/** Bytes as they crossed the link: whole frames out, chunks in — before any decoding can drop them. */
export type RawListener = (bytes: Uint8Array, direction: 'tx' | 'rx') => void;

interface Pending {
  what: string;
  resolve(payload: Uint8Array): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

interface Stream {
  onMessage(payload: Uint8Array): void;
  /** The server closed the stream with this status (or it errored). */
  onEnd(status: number): void;
}

interface QueuedRequest {
  cancelled: boolean;
  reject(reason: Error): void;
}

export interface PixelBudsClientOptions {
  timeoutMs?: number;
  discoveryWaitMs?: number;
  channelProbeMs?: number;
}

const callKey = (channel: number, serviceId: number, methodId: number): string => `${channel}:${serviceId}:${methodId}`;

export class PixelBudsClient {
  #transport: Transport;
  #decoder = createHdlcDecoder();
  #channel: number | null = null;
  #channelWaiters = new Set<(channel: number | null) => void>();
  #aborted: Error | null = null;
  #pending = new Map<string, Pending>();
  #streams = new Map<string, Stream>();
  #queue: Promise<unknown> = Promise.resolve();
  #queued = new Set<QueuedRequest>();
  #rawListeners = new Set<RawListener>();
  #timeoutMs: number;
  #discoveryWaitMs: number;
  #channelProbeMs: number;
  /** Set once discovery had to ask; the System tab reports it, since no source verifies that path. */
  #probed = false;

  constructor(transport: Transport, options: PixelBudsClientOptions = {}) {
    this.#transport = transport;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#discoveryWaitMs = options.discoveryWaitMs ?? DEFAULT_DISCOVERY_WAIT_MS;
    this.#channelProbeMs = options.channelProbeMs ?? DEFAULT_CHANNEL_PROBE_MS;
  }

  /** The channel the buds answer on, once known. */
  get channel(): number | null {
    return this.#channel;
  }

  /** True when the channel was found by asking rather than by the buds' own announcement. */
  get channelWasProbed(): boolean {
    return this.#probed;
  }

  handleData(chunk: Uint8Array): void {
    for (const listener of this.#rawListeners) listener(chunk, 'rx');
    for (const frame of this.#decoder.push(chunk)) {
      try {
        this.#dispatch(decodeRpcPacket(frame.data));
      } catch (error) {
        console.debug('[pixelbuds] unreadable packet', error);
      }
    }
  }

  #dispatch(packet: RpcPacket): void {
    if (this.#channel === null && CANDIDATE_CHANNELS.some((candidate) => candidate.channel === packet.channelId)) {
      this.#channel = packet.channelId;
      for (const waiter of this.#channelWaiters) waiter(packet.channelId);
      this.#channelWaiters.clear();
    }

    const key = callKey(packet.channelId, packet.serviceId, packet.methodId);
    if (packet.type === PacketType.ServerStream) {
      this.#streams.get(key)?.onMessage(packet.payload);
      return;
    }
    if (packet.type !== PacketType.Response && packet.type !== PacketType.ServerError) return;

    const stream = this.#streams.get(key);
    if (stream) {
      this.#streams.delete(key);
      stream.onEnd(packet.type === PacketType.ServerError && packet.status === 0 ? RpcStatus.Unknown : packet.status);
      return;
    }
    const pending = this.#pending.get(key);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pending.delete(key);
    if (packet.status === RpcStatus.Ok && packet.type === PacketType.Response) pending.resolve(packet.payload);
    else pending.reject(new RpcError(pending.what, packet.status || RpcStatus.Unknown));
  }

  // --- channel discovery -----------------------------------------------------------

  /** Resolves with the channel the buds serve, or throws `PixelBudsChannelError`. */
  async discoverChannel(): Promise<number> {
    if (this.#channel !== null) return this.#channel;
    const announced = await this.#waitForAnnouncement(this.#discoveryWaitMs);
    if (announced !== null) return announced;
    if (this.#aborted) throw this.#aborted;

    // UNVERIFIED FALLBACK: no source shows a request being answered on a channel the buds did not
    // announce. pbpctrl only ever listens. Costs `candidates × channelProbeMs` when nothing answers.
    this.#probed = true;
    for (const { channel } of CANDIDATE_CHANNELS) {
      if (this.#channel !== null) return this.#channel;
      if (this.#aborted) throw this.#aborted;
      try {
        await this.#call(channel, MAESTRO_SERVICE, Method.GetSoftwareInfo, new Uint8Array(0), this.#channelProbeMs);
        this.#channel = channel;
        return channel;
      } catch (error) {
        console.debug(`[pixelbuds] channel ${channel} did not answer`, error);
      }
    }
    if (this.#channel !== null) return this.#channel;
    throw new PixelBudsChannelError();
  }

  #waitForAnnouncement(ms: number): Promise<number | null> {
    if (this.#channel !== null) return Promise.resolve(this.#channel);
    return new Promise((resolve) => {
      const done = (channel: number | null) => {
        clearTimeout(timer);
        this.#channelWaiters.delete(onChannel);
        resolve(channel);
      };
      const onChannel = (channel: number | null) => done(channel);
      const timer = setTimeout(() => done(null), ms);
      this.#channelWaiters.add(onChannel);
    });
  }

  // --- calls -----------------------------------------------------------------------

  /** A unary call on the discovered channel. One in flight at a time. */
  call(method: string, payload: Uint8Array = new Uint8Array(0), options: { timeoutMs?: number; service?: string } = {}): Promise<Uint8Array> {
    const entry: QueuedRequest = { cancelled: false, reject: () => {} };
    this.#queued.add(entry);

    const run = (): Promise<Uint8Array> => {
      this.#queued.delete(entry);
      if (entry.cancelled) return Promise.reject(new Error('aborted before this request could be sent'));
      if (this.#channel === null) return Promise.reject(new PixelBudsChannelError());
      return this.#call(this.#channel, options.service ?? MAESTRO_SERVICE, method, payload, options.timeoutMs ?? this.#timeoutMs);
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

  #call(channel: number, service: string, method: string, payload: Uint8Array, timeoutMs: number): Promise<Uint8Array> {
    const serviceId = rpcHash(service);
    const methodId = rpcHash(method);
    const key = callKey(channel, serviceId, methodId);
    const what = `${service.split('.').pop()}.${method}`;

    return new Promise<Uint8Array>((resolve, reject) => {
      this.#pending.set(key, {
        what,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.#pending.delete(key);
          reject(new PixelBudsTimeoutError(what, timeoutMs));
        }, timeoutMs),
      });
      this.#send({ type: PacketType.Request, channelId: channel, serviceId, methodId, payload }, key);
    });
  }

  /**
   * Starts a server-streaming call; `onMessage` gets each pushed payload. Returns a
   * function that cancels it. Resubscribing to the same method replaces the old listener.
   */
  subscribe(method: string, onMessage: (payload: Uint8Array) => void, onEnd: (status: number) => void = () => {}, service: string = MAESTRO_SERVICE): () => void {
    const channel = this.#channel;
    if (channel === null) throw new PixelBudsChannelError();
    const serviceId = rpcHash(service);
    const methodId = rpcHash(method);
    const key = callKey(channel, serviceId, methodId);
    this.#streams.set(key, { onMessage, onEnd });
    this.#send({ type: PacketType.Request, channelId: channel, serviceId, methodId });
    return () => {
      if (!this.#streams.delete(key)) return;
      this.#send({ type: PacketType.ClientError, channelId: channel, serviceId, methodId, status: RpcStatus.Cancelled });
    };
  }

  #send(packet: Parameters<typeof encodeRpcPacket>[0], pendingKey?: string): void {
    const address = addressForChannel(packet.channelId);
    if (address === null) {
      this.#failPending(pendingKey, new Error(`channel ${packet.channelId} has no Maestro address`));
      return;
    }
    const frame = encodeFrame(address, encodeRpcPacket(packet));
    for (const listener of this.#rawListeners) listener(frame, 'tx');
    this.#transport.write(frame).catch((error: Error) => this.#failPending(pendingKey, error));
  }

  #failPending(key: string | undefined, error: Error): void {
    if (key === undefined) return;
    const pending = this.#pending.get(key);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pending.delete(key);
    pending.reject(error);
  }

  onRaw(listener: RawListener): () => void {
    this.#rawListeners.add(listener);
    return () => this.#rawListeners.delete(listener);
  }

  abort(reason: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.#pending.clear();
    for (const stream of this.#streams.values()) stream.onEnd(RpcStatus.Cancelled);
    this.#streams.clear();
    for (const entry of this.#queued) {
      entry.cancelled = true;
      entry.reject(reason);
    }
    this.#queued.clear();
    this.#aborted = reason;
    for (const waiter of this.#channelWaiters) waiter(null);
    this.#channelWaiters.clear();
    this.#decoder.reset();
  }
}
