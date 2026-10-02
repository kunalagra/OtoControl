/**
 * Orchestration: owns the transport, the client and the observable state.
 *
 * Galaxy Buds push their own state — `Status` and `ExtendedStatus` arrive
 * unprompted right after connect — so there is no polling here. Connect waits
 * for that first push (echoing it, and telling the earbuds a companion app is
 * running, as both vendor apps do), then reads the SKU and the version, which
 * are the only two things that have to be asked for.
 *
 * What the model is decides how every later frame is read, and the earbuds
 * never say: `getInfo()` gives a browser nothing but the service class. So
 * the model comes from the SKU string, with the service as the fallback — see
 * `resolveModel` and docs/superpowers/specs/2026-10-02-samsung-driver-design.md §4.
 */

import { decodeAck, decodeExtended, decodeNoiseUpdate, decodeSku, decodeStatus, decodeVersion } from './decode';
import { MsgId, QUERY_IDS } from './ids';
import { equalizerCommand, findCommand, managerInfoCommand, noiseCommand, touchLockCommand } from './commands';
import type { Command } from './commands';
import { SamsungClient, SamsungUnansweredError } from './client';
import type { FrameVariant, SamsungFrame } from './frame';
import { UNKNOWN_MODERN, modelById, modelForSku } from './models';
import type { SamsungModel } from './models';
import {
  SAMSUNG_SNAPSHOT_VERSION,
  applyDurable,
  captureDurable,
  initialSamsungState,
} from './state';
import type { SamsungState } from './state';
export type { SamsungState } from './state';
import {
  SAMSUNG_LEGACY_SPP_UUID,
  isBluetoothTarget,
  isUnreachable,
  isWebSerialSupported,
  openSerialTransport,
  serviceForPort,
} from '@/core/transport';
import type { ConnectionTarget, Transport, TransportOpener } from '@/core/transport';
import { DeviceSession } from '@/core/session';
import type { SessionHooks } from '@/core/session';
import { StateStore } from '@/core/stateStore';
import type { StateStoreHooks } from '@/core/stateStore';
import { describeError } from '@/core/errors';
import type { Persistable, SnapshotPayload } from '@/core/persistence';
import { ProtocolLog } from '@/core/protocolLog';
import { hex } from '@/core/protocolLog';

type Listener = (state: SamsungState) => void;

/**
 * How long connect waits for the earbuds' first status push before telling
 * them a companion app is here anyway — some firmware may only start talking
 * after that. The push is not lost by waiting: it is handled whenever it lands.
 */
const STATUS_WAIT_MS = 1500;

/** How long the SKU and version reads wait. Both are "might not exist" reads (a Buds+ sends no SKU). */
const PROBE_TIMEOUT_MS = 1200;

/**
 * Which service the link came in on, which is all that is known about the
 * model until the SKU answers: the 2019 Buds have a service of their own, the
 * Buds+/Live/Pro share standard SPP (reached through `core/identify.ts`), and
 * everything newer has the custom one.
 */
export type ServiceKind = 'legacy' | 'shared' | 'modern';

export interface SamsungDeviceOptions {
  /** Injected so tests do not pay `DEFAULT_TIMEOUT_MS` per unanswered request. */
  timeoutMs?: number;
  /** Injected so tests do not pay `PROBE_TIMEOUT_MS`. */
  probeTimeoutMs?: number;
  /** Injected so tests do not pay `STATUS_WAIT_MS`. */
  statusWaitMs?: number;
}

const stateStoreHooks: StateStoreHooks<SamsungState> = {
  isUnread: (state) => state.info.model === null,
  isConnected: (state) => state.status === 'connected',
  capture: captureDurable,
  apply: (_state, payload) => applyDurable(payload),
};

/** The model to assume until the SKU says otherwise. */
const assumedModel = (kind: ServiceKind): SamsungModel =>
  kind === 'legacy' ? (modelById('buds') as SamsungModel) : UNKNOWN_MODERN;

export class SamsungDevice implements Persistable {
  readonly #store: StateStore<SamsungState>;
  readonly #session: DeviceSession<SamsungClient>;
  readonly #timeoutMs?: number;
  readonly #probeTimeoutMs: number;
  readonly #statusWaitMs: number;
  readonly #log = new ProtocolLog();
  #kind: ServiceKind = 'modern';
  #variant: FrameVariant = 'standard';
  /** The last payloads, so a model learned late can re-read what arrived before it was known. */
  #lastStatus: Uint8Array | null = null;
  #lastExtended: Uint8Array | null = null;
  #managerInfoSent = false;
  #firstStatus: (() => void) | null = null;

  constructor(openTransport: TransportOpener = openSerialTransport, options: SamsungDeviceOptions = {}) {
    this.#timeoutMs = options.timeoutMs;
    this.#probeTimeoutMs = options.probeTimeoutMs ?? PROBE_TIMEOUT_MS;
    this.#statusWaitMs = options.statusWaitMs ?? STATUS_WAIT_MS;
    this.#store = new StateStore(
      { ...initialSamsungState, status: isWebSerialSupported() ? 'disconnected' : 'unsupported' },
      stateStoreHooks,
    );

    const hooks: SessionHooks<SamsungClient> = {
      createClient: (transport) => new SamsungClient(transport, { timeoutMs: this.#timeoutMs, variant: this.#variant }),
      handleData: (client, chunk) => client.handleData(chunk),
      wire: (client) => {
        client.onNotification((frame) => this.#onFrame(frame, client));
        this.#log.append('connect');
        client.onRaw((bytes, direction) => this.#log.append(direction, bytes));
      },
      onStatus: (status, error) => this.#patch({ status, error }),
      onDrop: (reason) => {
        this.#resetLink();
        this.#patch({
          ...initialSamsungState,
          ...this.#lastKnownDurable(),
          status: 'disconnected',
          error: reason ? describeError(reason) : null,
        });
      },
      abort: (client, reason) => client.abort(reason),
    };
    this.#session = new DeviceSession(openTransport, hooks);
  }

  get state(): SamsungState {
    return this.#store.state;
  }

  /** Raw bytes both ways since the first connect, for reporting a model that misbehaves. */
  get protocolLog(): ProtocolLog {
    return this.#log;
  }

  /**
   * Sends one hand-entered read and resolves with its reply payload. Limited to
   * `QUERY_IDS`, so nothing typed here changes a setting.
   */
  async sendQuery(id: number, payload: number[]): Promise<Uint8Array> {
    if (!QUERY_IDS.includes(id)) {
      throw new Error(`Only reads can be sent from here: ${QUERY_IDS.map((q) => `0x${q.toString(16).padStart(2, '0')}`).join(', ')}.`);
    }
    const client = this.#session.client;
    if (!client) throw new Error('Not connected.');
    return client.request(id, payload);
  }

  // --- Persistable ---------------------------------------------------------

  readonly snapshotVersion = SAMSUNG_SNAPSHOT_VERSION;

  snapshot(): SnapshotPayload | null {
    return this.#store.snapshot();
  }

  restore(payload: SnapshotPayload): void {
    this.#store.restore(payload);
  }

  subscribe(listener: Listener): () => void {
    return this.#store.subscribe(listener);
  }

  #patch(partial: Partial<SamsungState>): void {
    this.#store.patch(partial);
  }

  /** Identity and settings worth carrying across a disconnect, so the sidebar keeps naming the device. */
  #lastKnownDurable(): Partial<SamsungState> {
    const durable = this.#store.snapshot();
    return durable ? applyDurable(durable) : {};
  }

  // --- connect ---------------------------------------------------------------

  /** Takes over a port the caller already obtained. */
  async adoptPort(target: ConnectionTarget): Promise<void> {
    if (isBluetoothTarget(target)) {
      this.#patch({ status: 'disconnected', error: 'BLE GATT is not implemented for Galaxy Buds.' });
      return;
    }
    this.#kind = serviceKindOf(target);
    this.#variant = this.#kind === 'legacy' ? 'legacy' : 'standard';
    await this.#connect((after) => this.#session.connectTo(target, after));
  }

  /**
   * Takes over a transport that is already open — the one `core/identify.ts`
   * recognised as Samsung on a shared standard-SPP port. Never the 2019 Buds,
   * which have a service of their own.
   */
  async adoptTransport(transport: Transport): Promise<void> {
    this.#kind = 'shared';
    this.#variant = 'standard';
    await this.#connect((after) => this.#session.adoptTransport(transport, after));
  }

  async #connect(run: (after: (client: SamsungClient) => Promise<void>) => Promise<void>): Promise<void> {
    try {
      await run(async (client) => {
        this.#resetLink();
        this.#patch({ finding: false, diagnostics: {} });
        const assumed = assumedModel(this.#kind);
        // A cached model from a previous link is kept until the SKU answers, unless the service itself names one.
        if (this.#kind === 'legacy' || this.#store.state.info.modelId === null) this.#setModel(assumed);
        await this.#awaitFirstStatus();
        if (this.#session.client !== client) return;
        await this.#sendManagerInfo(client);
        await this.refresh();
      });
    } catch (error) {
      this.#patch({ status: 'disconnected', error: isUnreachable(error) ? null : describeError(error) });
    }
  }

  #resetLink(): void {
    this.#lastStatus = null;
    this.#lastExtended = null;
    this.#managerInfoSent = false;
    this.#firstStatus = null;
  }

  /** Resolves on the first extended-status push, or after `statusWaitMs`, whichever is first. */
  #awaitFirstStatus(): Promise<void> {
    if (this.#lastExtended) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        this.#firstStatus = null;
        resolve();
      };
      const timer = setTimeout(done, this.#statusWaitMs);
      this.#firstStatus = done;
    });
  }

  /** Once per link: tell the earbuds a companion app is running. */
  async #sendManagerInfo(client: SamsungClient): Promise<void> {
    if (this.#managerInfoSent) return;
    this.#managerInfoSent = true;
    const { id, payload } = managerInfoCommand();
    await client.send(id, payload).catch((error) => console.debug('[samsung] manager info not sent', error));
  }

  async refresh(): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    await this.#readSku(client);
    if (this.#session.client !== client) return;
    await this.#readVersion(client);
  }

  async #readSku(client: SamsungClient): Promise<void> {
    if (this.#kind === 'legacy') return; // the 2019 Buds have no SKU message and no ambiguity
    let payload: Uint8Array | null = null;
    try {
      payload = await client.request(MsgId.DebugSku, [], { timeoutMs: this.#probeTimeoutMs });
    } catch (error) {
      console.debug('[samsung] DebugSku failed', error);
      this.#patch({ diagnostics: { ...this.#store.state.diagnostics, sku: 'no reply' } });
      return;
    }
    const { left, right } = decodeSku(payload);
    const sku = left || right;
    const matched = sku ? modelForSku(sku) : null;
    // A Buds+ answers with nothing but zeroes; a Live or Pro with a SKU. So on the shared service an empty
    // answer is a Buds+, and an unrecognised one is a model this table lacks — shown, but with no controls.
    const model = matched ?? (this.#kind === 'shared' && !sku ? modelById('budsPlus') : null) ?? UNKNOWN_MODERN;
    if (!matched) {
      this.#patch({ diagnostics: { ...this.#store.state.diagnostics, sku: sku ? `unrecognised SKU ${sku}` : `empty · ${hex(payload)}` } });
    }
    this.#patch({ info: { ...this.#store.state.info, sku: sku || null } });
    this.#setModel(model);
  }

  async #readVersion(client: SamsungClient): Promise<void> {
    try {
      const payload = await client.request(MsgId.VersionInfo, [], { timeoutMs: this.#probeTimeoutMs });
      const version = decodeVersion(payload, this.#model());
      if (!version) throw new Error(`short reply · ${hex(payload)}`);
      const { left, right } = version;
      // One build id when both earbuds agree, both when they do not.
      const firmware = left && right && left !== right ? `L ${left} · R ${right}` : (left ?? right);
      this.#patch({ info: { ...this.#store.state.info, hardware: version.hardware, firmware } });
    } catch (error) {
      console.debug('[samsung] VersionInfo failed', error);
      const reason = error instanceof SamsungUnansweredError ? 'no reply' : describeError(error);
      this.#patch({ diagnostics: { ...this.#store.state.diagnostics, version: reason } });
    }
  }

  // --- reading what the earbuds send -----------------------------------------

  #model(): SamsungModel {
    return modelById(this.#store.state.info.modelId) ?? assumedModel(this.#kind);
  }

  #setModel(model: SamsungModel): void {
    const info = this.#store.state.info;
    if (info.modelId === model.id && info.model === model.name) return;
    this.#patch({ info: { ...info, modelId: model.id, model: model.name } });
    // What arrived before the model was known was read with the wrong layout.
    if (this.#lastStatus) this.#applyStatus(this.#lastStatus);
    if (this.#lastExtended) this.#applyExtended(this.#lastExtended);
  }

  #onFrame(frame: SamsungFrame, client: SamsungClient): void {
    try {
      switch (frame.id) {
        case MsgId.Status:
          this.#lastStatus = frame.payload;
          this.#applyStatus(frame.payload);
          break;
        case MsgId.ExtendedStatus:
          this.#lastExtended = frame.payload;
          this.#applyExtended(frame.payload);
          // The earbuds expect their push acknowledged, then a companion app to announce itself.
          void client.send(MsgId.ExtendedStatus, [0], { response: true }).catch(() => undefined);
          void this.#sendManagerInfo(client);
          this.#firstStatus?.();
          break;
        case MsgId.NoiseControlsUpdate: {
          const mode = decodeNoiseUpdate(frame.payload);
          if (mode !== null) this.#patch({ noiseMode: mode });
          break;
        }
        case MsgId.FindStop:
          this.#patch({ finding: false });
          break;
        case MsgId.Ack: {
          const ack = decodeAck(frame.payload);
          // An ack nobody waited for still says what the earbuds now have.
          if (ack?.id === MsgId.NoiseControls && ack.rest.length > 0) this.#patch({ noiseMode: ack.rest[0] });
          break;
        }
        default:
          break;
      }
    } catch (error) {
      console.debug('[samsung] unreadable frame', frame.id, error);
    }
  }

  #applyStatus(payload: Uint8Array): void {
    const update = decodeStatus(payload, this.#model(), this.#store.state.info.revision);
    if (!update) return;
    const info = this.#store.state.info;
    this.#patch({
      battery: update.battery,
      placement: update.placement,
      charging: update.charging ?? { left: false, right: false, case: false },
      info: update.revision === null ? info : { ...info, revision: update.revision },
    });
  }

  #applyExtended(payload: Uint8Array): void {
    const update = decodeExtended(payload, this.#model());
    if (!update) return;
    const state = this.#store.state;
    // A field the buffer was too short to reach stays what it was.
    this.#patch({
      battery: update.battery,
      placement: update.placement,
      info: { ...state.info, revision: update.revision },
      eq: update.eq ?? state.eq,
      touchLocked: update.touchLocked ?? state.touchLocked,
      gestures: update.gestures ?? state.gestures,
      noiseMode: update.noiseMode ?? state.noiseMode,
    });
  }

  // --- settings ----------------------------------------------------------------

  /**
   * Sends a write and waits for its ack. Not every firmware acks every write,
   * so silence is not failure — the next push says what the earbuds ended up
   * with. A transport error is: the caller restores what it changed.
   */
  async #write(command: Command): Promise<void> {
    const client = this.#session.client;
    if (!client) throw new Error('Not connected.');
    try {
      await client.request(command.id, command.payload);
    } catch (error) {
      if (!(error instanceof SamsungUnansweredError)) throw error;
    }
  }

  async #change(apply: Partial<SamsungState>, revert: Partial<SamsungState>, command: Command | null): Promise<void> {
    if (!command) return;
    this.#patch(apply);
    try {
      await this.#write(command);
    } catch (error) {
      this.#patch({ ...revert, error: describeError(error) });
    }
  }

  async setNoiseMode(mode: number): Promise<void> {
    const state = this.#store.state;
    await this.#change({ noiseMode: mode }, { noiseMode: state.noiseMode }, noiseCommand(this.#model(), mode));
  }

  /** `preset`: 0 off, 1-5 the built-ins. */
  async setEqPreset(preset: number): Promise<void> {
    const state = this.#store.state;
    await this.#change({ eq: preset }, { eq: state.eq }, equalizerCommand(this.#model(), preset));
  }

  async setTouchLocked(locked: boolean): Promise<void> {
    const { touchLocked, gestures, info } = this.#store.state;
    await this.#change(
      { touchLocked: locked },
      { touchLocked },
      touchLockCommand(this.#model(), locked, gestures, info.revision),
    );
  }

  async setFinding(on: boolean): Promise<void> {
    const { info } = this.#store.state;
    await this.#change({ finding: on }, { finding: !on }, findCommand(this.#model(), info.revision, on));
  }

  // --- teardown ----------------------------------------------------------

  async disconnect(): Promise<void> {
    const durable = this.#lastKnownDurable();
    const closed = this.#session.disconnect();
    this.#resetLink();
    this.#patch({ ...initialSamsungState, ...durable, status: 'disconnected' });
    await closed;
  }
}

/** The service a port was granted for, as far as a driver can tell (a fake port without `getInfo` is modern). */
function serviceKindOf(port: SerialPort): ServiceKind {
  try {
    return serviceForPort(port)?.uuid === SAMSUNG_LEGACY_SPP_UUID ? 'legacy' : 'modern';
  } catch {
    return 'modern';
  }
}

