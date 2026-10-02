/**
 * Orchestration: owns the transport, the client and the observable state.
 *
 * Connect waits for the buds to name their Maestro channel, subscribes to
 * runtime info (battery, placement) and to setting changes, then reads
 * firmware, serials and each setting this driver models. A setting the buds
 * refuse to read is simply absent from `capabilities`, which is how a model
 * without a feature loses its control — the buds are the only authority, since
 * nothing on the wire names the model (spec §6).
 */

import {
  AncState,
  decodeHardwareInfo,
  decodeRuntimeInfo,
  decodeSettingsRsp,
  decodeSoftwareInfo,
  EQ_RANGE,
  encodeReadSetting,
  encodeWriteSetting,
  Method,
  SettingId,
} from './maestro';
import type { AncMode, EqGains, SettingChange } from './maestro';
import { PixelBudsChannelError, PixelBudsClient } from './client';
import { parseQuery } from './query';
import { RpcError } from './rpc';
import {
  applyDurable,
  applySetting,
  captureDurable,
  CAPABILITY_FOR_SETTING,
  initialPixelBudsState,
  PIXELBUDS_SNAPSHOT_VERSION,
} from './state';
import type { PixelBudsCapability, PixelBudsState } from './state';
// Re-exported so `core/manager.ts` can import it from this module, the same
// way it imports every other driver's state type from that driver's main
// device file rather than reaching past it into an internal module.
export type { PixelBudsState } from './state';
import { isBluetoothTarget, isUnreachable, isWebSerialSupported, openSerialTransport } from '@/core/transport';
import type { ConnectionTarget, TransportOpener } from '@/core/transport';
import { DeviceSession } from '@/core/session';
import type { SessionHooks } from '@/core/session';
import { StateStore } from '@/core/stateStore';
import type { StateStoreHooks } from '@/core/stateStore';
import { describeError } from '@/core/errors';
import type { Persistable, SnapshotPayload } from '@/core/persistence';

type Listener = (state: PixelBudsState) => void;

/**
 * How long a settings read waits. These are all "might not exist" reads run
 * serially, so this bounds how long a model lacking a setting stalls connect.
 * Injectable the same way as the other drivers' probe timeouts.
 */
const PROBE_TIMEOUT_MS = 800;

/** How much of the conversation `protocolLog` keeps. */
const PROTOCOL_LOG_MAX = 400;

/** The name shown for every pair: Pro and Pro 2 cannot be told apart on the wire. */
export const PIXELBUDS_MODEL_NAME = 'Pixel Buds Pro';

export interface ProtocolLogEntry {
  /** `Date.now()` when the bytes crossed the link. */
  at: number;
  /** `connect` marks a new link, with no bytes. */
  direction: 'tx' | 'rx' | 'connect';
  bytes: Uint8Array;
}

const NOT_PIXEL_BUDS_ERROR = 'This does not look like a Google Pixel Buds Pro.';

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');

export interface PixelBudsDeviceOptions {
  /** Injected so tests do not pay `DEFAULT_TIMEOUT_MS` per unanswered call. */
  timeoutMs?: number;
  /** Injected so tests do not pay `PROBE_TIMEOUT_MS` per unanswered read. */
  probeTimeoutMs?: number;
  /** Injected so tests do not wait for an announcement that is not coming. */
  discoveryWaitMs?: number;
  /** Injected so tests do not pay a full probe per candidate channel. */
  channelProbeMs?: number;
}

const stateStoreHooks: StateStoreHooks<PixelBudsState> = {
  isUnread: (state) => state.info.model === null,
  isConnected: (state) => state.status === 'connected',
  capture: captureDurable,
  apply: (_state, payload) => applyDurable(payload),
};

export class PixelBudsDevice implements Persistable {
  readonly #store: StateStore<PixelBudsState>;
  readonly #session: DeviceSession<PixelBudsClient>;
  readonly #probeTimeoutMs: number;
  #refreshing = false;
  #unsubscribers: Array<() => void> = [];
  #protocolLog: ProtocolLogEntry[] = [];
  readonly #protocolLogListeners = new Set<() => void>();

  constructor(openTransport: TransportOpener = openSerialTransport, options: PixelBudsDeviceOptions = {}) {
    this.#probeTimeoutMs = options.probeTimeoutMs ?? PROBE_TIMEOUT_MS;
    this.#store = new StateStore(
      { ...initialPixelBudsState, status: isWebSerialSupported() ? 'disconnected' : 'unsupported' },
      stateStoreHooks,
    );

    const hooks: SessionHooks<PixelBudsClient> = {
      createClient: (transport) =>
        new PixelBudsClient(transport, {
          timeoutMs: options.timeoutMs,
          discoveryWaitMs: options.discoveryWaitMs,
          channelProbeMs: options.channelProbeMs,
        }),
      handleData: (client, chunk) => client.handleData(chunk),
      wire: (client) => {
        this.#appendLog('connect', new Uint8Array());
        client.onRaw((bytes, direction) => this.#appendLog(direction, bytes));
      },
      onStatus: (status, error) => this.#patch({ status, error }),
      onDrop: (reason) => {
        this.#unsubscribers = [];
        this.#patch({
          ...initialPixelBudsState,
          ...this.#lastKnownDurable(),
          status: 'disconnected',
          error: reason ? describeError(reason) : null,
        });
      },
      abort: (client, reason) => client.abort(reason),
    };
    this.#session = new DeviceSession(openTransport, hooks);
  }

  get state(): PixelBudsState {
    return this.#store.state;
  }

  /**
   * Raw bytes both ways since the first connect, newest last — for working out what a
   * pair that misbehaves actually sends. Kept outside state so logging never re-renders.
   */
  get protocolLog(): readonly ProtocolLogEntry[] {
    return this.#protocolLog;
  }

  onProtocolLog(listener: () => void): () => void {
    this.#protocolLogListeners.add(listener);
    return () => this.#protocolLogListeners.delete(listener);
  }

  #appendLog(direction: ProtocolLogEntry['direction'], bytes: Uint8Array): void {
    this.#protocolLog = [...this.#protocolLog, { at: Date.now(), direction, bytes: Uint8Array.from(bytes) }].slice(-PROTOCOL_LOG_MAX);
    for (const listener of this.#protocolLogListeners) listener();
  }

  /**
   * Sends one hand-entered read and resolves with its reply payload as hex.
   * Limited to `software`, `hardware` and `read <id>` (see `query.ts`), so
   * nothing typed here changes a setting.
   */
  async sendQuery(text: string): Promise<string> {
    const query = parseQuery(text);
    if (typeof query === 'string') throw new Error(query);
    const client = this.#session.client;
    if (!client) throw new Error('Not connected.');
    return hex(await client.call(query.method, query.payload)) || '(empty)';
  }

  // --- Persistable ---------------------------------------------------------

  readonly snapshotVersion = PIXELBUDS_SNAPSHOT_VERSION;

  snapshot(): SnapshotPayload | null {
    return this.#store.snapshot();
  }

  restore(payload: SnapshotPayload): void {
    this.#store.restore(payload);
  }

  subscribe(listener: Listener): () => void {
    return this.#store.subscribe(listener);
  }

  #patch(partial: Partial<PixelBudsState>): void {
    this.#store.patch(partial);
  }

  #replace(next: PixelBudsState): void {
    this.#store.replace(next);
  }

  /**
   * Identity and settings worth carrying across a disconnect, so the sidebar
   * keeps naming the device instead of collapsing to the generic "no device"
   * placeholder the instant the link drops.
   */
  #lastKnownDurable(): Partial<PixelBudsState> {
    const durable = this.#store.snapshot();
    return durable ? applyDurable(durable) : {};
  }

  // --- connect ---------------------------------------------------------------

  /** Takes over a port the caller already obtained (serial only). */
  async adoptPort(target: ConnectionTarget): Promise<void> {
    if (isBluetoothTarget(target)) {
      this.#patch({ status: 'disconnected', error: 'Pixel Buds are only reachable over Bluetooth Classic serial.' });
      return;
    }
    try {
      await this.#session.connectTo(target, async () => {
        // A connect that supersedes a live session skips onDrop, so clear the live-only fields.
        this.#unsubscribers = [];
        this.#patch({ battery: [], placement: null, adaptiveRefused: false, channel: null, channelProbed: false });
        await this.refresh();
      });
    } catch (error) {
      this.#patch({ status: 'disconnected', error: isUnreachable(error) ? null : describeError(error) });
    }
  }

  async refresh(): Promise<void> {
    const client = this.#session.client;
    if (!client || this.#refreshing) return;
    this.#refreshing = true;
    try {
      await this.#refreshAll(client);
    } finally {
      this.#refreshing = false;
    }
  }

  async #refreshAll(client: PixelBudsClient): Promise<void> {
    try {
      await client.discoverChannel();
    } catch (error) {
      // The link dropped mid-connect: onDrop already reset state and set the real reason.
      if (this.#session.client !== client) return;
      if (!(error instanceof PixelBudsChannelError)) throw error;
      // Anything that never speaks Maestro — a phone, another brand's serial service — is released rather than held.
      await this.disconnect();
      this.#patch({ error: NOT_PIXEL_BUDS_ERROR });
      return;
    }
    if (this.#session.client !== client) return;
    this.#patch({
      channel: client.channel,
      channelProbed: client.channelWasProbed,
      info: { ...this.#store.state.info, model: PIXELBUDS_MODEL_NAME },
    });

    this.#subscribeRuntime(client);
    this.#subscribeSettings(client);

    const found = new Set<PixelBudsCapability>();
    const read = async (capability: PixelBudsCapability, run: () => Promise<void>) => {
      try {
        await run();
        found.add(capability);
      } catch (error) {
        console.debug(`[pixelbuds] ${capability} did not read`, error);
      }
    };
    await read('firmware', () => this.#readFirmware(client));
    await this.#readSerials(client);
    for (const setting of [SettingId.AncState, SettingId.Multipoint, SettingId.OnHeadDetection, SettingId.UserEq, SettingId.VolumeEq]) {
      await read(CAPABILITY_FOR_SETTING[setting]!, () => this.#readSetting(client, setting));
    }
    // The loop tells the Noise tab whether Adaptive exists; it is a hint, not a capability.
    try {
      await this.#readSetting(client, SettingId.AncLoop);
    } catch (error) {
      console.debug('[pixelbuds] gesture loop did not read', error);
    }
    if (this.#session.client !== client) return;
    // Keep `battery` if a runtime push landed while the reads ran: it is not read, it is pushed.
    if (this.#store.state.capabilities.has('battery')) found.add('battery');
    this.#patch({ capabilities: found });
  }

  #subscribeRuntime(client: PixelBudsClient): void {
    this.#unsubscribers.push(
      client.subscribe(
        Method.SubscribeRuntimeInfo,
        (payload) => {
          try {
            const { battery, placement } = decodeRuntimeInfo(payload);
            const capabilities = new Set(this.#store.state.capabilities);
            if (battery.length > 0) capabilities.add('battery');
            this.#patch({ battery, placement, capabilities });
          } catch (error) {
            console.debug('[pixelbuds] unreadable runtime info', error);
          }
        },
        (status) => console.debug('[pixelbuds] runtime info stream ended', status),
      ),
    );
  }

  #subscribeSettings(client: PixelBudsClient): void {
    this.#unsubscribers.push(
      client.subscribe(
        Method.SubscribeToSettingsChanges,
        (payload) => {
          try {
            const change = decodeSettingsRsp(payload);
            if (change) this.#replace(applySetting(this.#store.state, change));
          } catch (error) {
            console.debug('[pixelbuds] unreadable settings change', error);
          }
        },
        (status) => console.debug('[pixelbuds] settings stream ended', status),
      ),
    );
  }

  async #readFirmware(client: PixelBudsClient): Promise<void> {
    const firmware = decodeSoftwareInfo(await client.call(Method.GetSoftwareInfo, undefined, { timeoutMs: this.#probeTimeoutMs }));
    this.#patch({ info: { ...this.#store.state.info, firmware } });
  }

  /** Best-effort: the serials are for the System tab only, and not worth losing the connect over. */
  async #readSerials(client: PixelBudsClient): Promise<void> {
    try {
      const serials = decodeHardwareInfo(await client.call(Method.GetHardwareInfo, undefined, { timeoutMs: this.#probeTimeoutMs }));
      this.#patch({ info: { ...this.#store.state.info, serials } });
    } catch (error) {
      console.debug('[pixelbuds] hardware info did not read', error);
    }
  }

  /** Throws when the buds refuse the read or answer with no value for that setting. */
  async #readSetting(client: PixelBudsClient, setting: number): Promise<void> {
    const reply = await client.call(Method.ReadSetting, encodeReadSetting(setting), { timeoutMs: this.#probeTimeoutMs });
    const change = decodeSettingsRsp(reply);
    if (!change || change.setting !== setting) throw new Error(`setting ${setting} came back empty`);
    this.#replace(applySetting(this.#store.state, change));
  }

  // --- writes ----------------------------------------------------------------

  /**
   * Optimistic, rolled back on any refusal. A refused Adaptive withdraws that option for the
   * session: it is how a model without it tells us.
   */
  async setAncMode(mode: AncMode): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    const previous = this.#store.state.ancMode;
    this.#patch({ ancMode: mode });
    try {
      await client.call(Method.WriteSetting, encodeWriteSetting({ setting: SettingId.AncState, value: mode }));
    } catch (error) {
      const refused = mode === AncState.Adaptive && error instanceof RpcError;
      this.#patch({
        ancMode: previous,
        adaptiveRefused: refused || this.#store.state.adaptiveRefused,
        error: refused ? 'These earbuds do not support Adaptive.' : describeError(error),
      });
    }
  }

  setMultipoint(on: boolean): Promise<void> {
    return this.#writeBool(SettingId.Multipoint, on, 'multipoint');
  }

  setOnHeadDetection(on: boolean): Promise<void> {
    return this.#writeBool(SettingId.OnHeadDetection, on, 'onHeadDetection');
  }

  setVolumeEq(on: boolean): Promise<void> {
    return this.#writeBool(SettingId.VolumeEq, on, 'volumeEq');
  }

  async #writeBool(
    setting: typeof SettingId.Multipoint | typeof SettingId.OnHeadDetection | typeof SettingId.VolumeEq,
    on: boolean,
    field: 'multipoint' | 'onHeadDetection' | 'volumeEq',
  ): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    const previous = this.#store.state[field];
    this.#patch({ [field]: on });
    try {
      await client.call(Method.WriteSetting, encodeWriteSetting({ setting, value: on } as SettingChange));
    } catch (error) {
      this.#patch({ [field]: previous, error: describeError(error) });
    }
  }

  /** Gains are clamped to ±6 dB and rounded to 0.1 dB. Call on release, not per tick. */
  async setEq(gains: readonly number[]): Promise<void> {
    const client = this.#session.client;
    if (!client || gains.length !== 5) return;
    const next = gains.map((gain) => Math.round(Math.min(EQ_RANGE.max, Math.max(EQ_RANGE.min, gain)) * 10) / 10) as EqGains;
    const previous = this.#store.state.eq;
    this.#patch({ eq: next });
    try {
      await client.call(Method.WriteSetting, encodeWriteSetting({ setting: SettingId.UserEq, value: next }));
    } catch (error) {
      this.#patch({ eq: previous, error: describeError(error) });
    }
  }

  // --- teardown ----------------------------------------------------------

  async disconnect(): Promise<void> {
    const durable = this.#lastKnownDurable();
    for (const unsubscribe of this.#unsubscribers) unsubscribe();
    this.#unsubscribers = [];
    const closed = this.#session.disconnect();
    this.#patch({ ...initialPixelBudsState, ...durable, status: 'disconnected' });
    await closed;
  }
}
