/**
 * pw_rpc over HDLC over a Pixel Buds transport: unary calls, server streams,
 * and the channel discovery that comes first.
 *
 * Unary calls queue one at a time, as pbpctrl issues them (every call carries
 * call id 0). A reply is matched on channel, service and method — not call
 * id, which the buds' unsolicited announcement does not echo.
 *
 * The channel is not negotiated. The buds announce the one they serve with an
 * unsolicited `GetSoftwareInfo` reply 20-100 ms after connect (call id 0xffffffff; hardware
 * logs from a Pro and a Pro 2), so the client is listening from construction. If none comes
 * it asks the way MagicPodsCore and pb2pcd do on a Pro 2 — `GetSoftwareInfo`, call id
 * 0xffffffff, channel 18 — and takes the channel of whatever answers. See
 * docs/superpowers/specs/2026-10-02-pixelbuds-driver-design.md §4 and §9.
 */

import type { Transport } from '@/core/transport';
import { CONTROL_UI, createHdlcDecoder, encodeFrame } from './hdlc';
import { MAESTRO_SERVICE, Method } from './maestro';
import {
  addressForChannel,
  ANNOUNCE_CALL_ID,
  CANDIDATE_CHANNELS,
  decodeRpcPacket,
  encodeRpcPacket,
  PacketType,
  PROBE_ORDER,
  RpcError,
  RpcStatus,
  rpcHash,
} from './rpc';
import type { RpcPacket } from './rpc';

export const DEFAULT_TIMEOUT_MS = 1500;
/** How long the buds get to announce their channel before the client starts asking (seen: 22-102 ms, one measured 332 ms). */
export const DEFAULT_DISCOVERY_WAIT_MS = 800;
/** How long each probe gets to be answered, on any candidate channel. */
export const DEFAULT_CHANNEL_PROBE_MS = 500;

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
  serviceId: number;
  methodId: number;
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
  #channelListeners = new Set<(channel: number) => void>();
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
      // Maestro only ever uses unnumbered-information frames; pbpctrl drops anything else (`codec.rs:46-48`).
      if (frame.control !== CONTROL_UI) continue;
      try {
        this.#dispatch(decodeRpcPacket(frame.data));
      } catch (error) {
        console.debug('[pixelbuds] unreadable packet', error);
      }
    }
  }

  #dispatch(packet: RpcPacket): void {
    const candidate = CANDIDATE_CHANNELS.some((entry) => entry.channel === packet.channelId);
    if (this.#channel === null && candidate) {
      this.#channel = packet.channelId;
      for (const waiter of this.#channelWaiters) waiter(packet.channelId);
      this.#channelWaiters.clear();
    } else if (candidate && packet.callId === ANNOUNCE_CALL_ID && packet.channelId !== this.#channel) {
      this.#handOver(packet.channelId);
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

  /**
   * The hosting bud changed: the buds close Maestro on the old bud and announce the
   * other's channel (tedsluis CAP-065/066, design spec §9). Calls still waiting on the
   * old channel cannot be answered there, so they fail now rather than time out; open
   * streams are requested again on the new channel and keep their listeners.
   */
  #handOver(channel: number): void {
    const previous = this.#channel;
    this.#channel = channel;
    for (const [key, pending] of this.#pending) {
      if (!key.startsWith(`${previous}:`)) continue;
      clearTimeout(pending.timer);
      this.#pending.delete(key);
      pending.reject(new Error(`${pending.what} was cut off when the buds moved to channel ${channel}`));
    }
    for (const [key, stream] of [...this.#streams]) {
      if (!key.startsWith(`${previous}:`)) continue;
      this.#streams.delete(key);
      this.#streams.set(callKey(channel, stream.serviceId, stream.methodId), stream);
      this.#send({ type: PacketType.Request, channelId: channel, serviceId: stream.serviceId, methodId: stream.methodId });
    }
    for (const listener of this.#channelListeners) listener(channel);
  }

  /** Called with the new channel after a hand-over; not on the first discovery. */
  onChannelChange(listener: (channel: number) => void): () => void {
    this.#channelListeners.add(listener);
    return () => this.#channelListeners.delete(listener);
  }

  // --- channel discovery -----------------------------------------------------------

  /** Resolves with the channel the buds serve, or throws `PixelBudsChannelError`. */
  async discoverChannel(): Promise<number> {
    if (this.#channel !== null) return this.#channel;
    const announced = await this.#waitForAnnouncement(this.#discoveryWaitMs);
    if (announced !== null) return announced;
    if (this.#aborted) throw this.#aborted;

    // Ask, as MagicPodsCore (Pro 2, probe byte-captured) and pb2pcd (Pro 2) do. The reply names the
    // channel the buds serve, not the one asked on, so any candidate-channel packet ends the wait.
    this.#probed = true;
    for (const channel of PROBE_ORDER) {
      if (this.#aborted) throw this.#aborted;
      this.#send({ type: PacketType.Request, channelId: channel, serviceId: rpcHash(MAESTRO_SERVICE), methodId: rpcHash(Method.GetSoftwareInfo), callId: ANNOUNCE_CALL_ID });
      const answered = await this.#waitForAnnouncement(this.#channelProbeMs);
      if (answered !== null) return answered;
    }
    if (this.#aborted) throw this.#aborted;
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
    const stream: Stream = { serviceId, methodId, onMessage, onEnd };
    this.#streams.set(callKey(channel, serviceId, methodId), stream);
    this.#send({ type: PacketType.Request, channelId: channel, serviceId, methodId });
    return () => {
      // Looked up by identity: a hand-over may have moved the stream to another channel since.
      const entry = [...this.#streams].find(([, value]) => value === stream);
      if (!entry) return;
      this.#streams.delete(entry[0]);
      const current = Number(entry[0].split(':')[0]);
      this.#send({ type: PacketType.ClientError, channelId: current, serviceId, methodId, status: RpcStatus.Cancelled });
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
