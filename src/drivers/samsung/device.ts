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
import type { NoiseSet } from './decode';
import { MsgId, QUERY_IDS } from './ids';
import {
  ambientLevelCommand,
  equalizerCommand,
  findCommand,
  managerInfoCommand,
  noiseCommand,
  noiseCycleCommand,
  touchLockCommand,
  touchOptionCommand,
} from './commands';
import type { Command, NoiseCycle } from './commands';
import { SamsungClient, SamsungUnansweredError } from './client';
import type { FrameVariant, SamsungFrame } from './frame';
import { TOUCH_MAPS, UNKNOWN_MODERN, modelById, modelForEarType, modelForSku } from './models';
import type { ModelFamily, SamsungModel, TouchAction } from './models';
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

/** How a model was learned, weakest first: guessed from the service, named by the ear type, or by the SKU. */
type ModelSource = 'assumed' | 'earType' | 'sku';

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

const FAMILY: Record<ServiceKind, ModelFamily> = { legacy: 'legacy', shared: 'shared', modern: 'modern' };

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
  #firstStatus: (() => void) | null = null;
  /** Where the current model came from; a stronger source replaces a weaker one, never the reverse. */
  #modelSource: ModelSource | null = null;

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
        client.onNotification((frame) => this.#onFrame(frame));
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
        if (this.#kind === 'legacy' || this.#store.state.info.modelId === null) this.#setModel(assumed, 'assumed');
        const heard = await this.#awaitFirstStatus();
        if (this.#session.client !== client) return;
        // Earbuds that push their state unprompted — every open-source client relies on it — need nothing sent.
        // Ones that stay quiet are nudged once, with the announcement GalaxyBudsClient opens with.
        if (!heard) await this.#nudge(client);
        await this.refresh();
      });
    } catch (error) {
      this.#patch({ status: 'disconnected', error: isUnreachable(error) ? null : describeError(error) });
    }
  }

  #resetLink(): void {
    this.#lastStatus = null;
    this.#lastExtended = null;
    this.#firstStatus = null;
    this.#modelSource = null;
  }

  /** Resolves true on the first extended-status push, or false after `statusWaitMs` without one. */
  #awaitFirstStatus(): Promise<boolean> {
    if (this.#lastExtended) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const finish = (heard: boolean): void => {
        clearTimeout(timer);
        this.#firstStatus = null;
        resolve(heard);
      };
      const timer = setTimeout(() => finish(false), this.#statusWaitMs);
      this.#firstStatus = () => finish(true);
    });
  }

  /** Announces a companion app to earbuds that have said nothing — a last resort, not part of the normal handshake. */
  async #nudge(client: SamsungClient): Promise<void> {
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
    if (!matched) {
      // A Buds+ has no SKU to give (its read comes back all zeroes); anything else unrecognised is a model this
      // table lacks. Either way the ear type may already have named it, so this only records why.
      this.#patch({ diagnostics: { ...this.#store.state.diagnostics, sku: sku ? `unrecognised SKU ${sku}` : `empty · ${hex(payload)}` } });
    }
    this.#patch({ info: { ...this.#store.state.info, sku: sku || null } });
    if (matched) this.#setModel(matched, 'sku');
    // Only a pair nothing has named yet falls back to unknown: a reconnect that reads an empty SKU must not
    // forget the model an earlier connect (or the snapshot) already established.
    else if (this.#store.state.info.modelId === null) this.#setModel(UNKNOWN_MODERN, 'assumed');
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

  #setModel(model: SamsungModel, source: ModelSource): void {
    const info = this.#store.state.info;
    if (this.#modelSource === 'sku' && source !== 'sku') return;
    if (this.#modelSource === 'earType' && source === 'assumed') return;
    this.#modelSource = source;
    if (info.modelId === model.id && info.model === model.name) return;
    this.#patch({ info: { ...info, modelId: model.id, model: model.name } });
    // What arrived before the model was known was read with the wrong layout.
    if (this.#lastStatus) this.#applyStatus(this.#lastStatus);
    if (this.#lastExtended) this.#applyExtended(this.#lastExtended);
  }

  #onFrame(frame: SamsungFrame): void {
    try {
      switch (frame.id) {
        case MsgId.Status:
          this.#lastStatus = frame.payload;
          this.#applyStatus(frame.payload);
          break;
        case MsgId.ExtendedStatus:
          this.#lastExtended = frame.payload;
          this.#applyExtended(frame.payload);
          // Nothing is sent back for the push: none of the open-source clients answer it, and the earbuds keep pushing.
          this.#firstStatus?.();
          break;
        case MsgId.NoiseControlsUpdate: {
          const mode = decodeNoiseUpdate(frame.payload);
          if (mode !== null) this.#patch({ noiseMode: mode });
          break;
        }
        case MsgId.AmbientModeUpdated:
          if (this.#model().noise === 'ambient' && frame.payload.length > 0) this.#patch({ noiseMode: frame.payload[0] ? 2 : 0 });
          break;
        case MsgId.NoiseReductionUpdated:
          if (this.#model().noise === 'anc' && frame.payload.length > 0) this.#patch({ noiseMode: frame.payload[0] ? 1 : 0 });
          break;
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
    // The model decides how the payload is read, and the ear type may name it: if it does, read again with the right layout.
    const named = modelForEarType(FAMILY[this.#kind], update.earType);
    if (named && this.#modelSource !== 'sku' && named.id !== this.#store.state.info.modelId) {
      this.#setModel(named, 'earType'); // re-applies this very payload, now it is the last one
      return;
    }
    const model = this.#model();
    const state = this.#store.state;
    const map = model.touchMap === null ? null : TOUCH_MAPS[model.touchMap];
    const action = (byte: number | undefined): TouchAction | null => (map && byte !== undefined ? (map[byte] ?? null) : null);
    // A field the buffer was too short to reach stays what it was.
    this.#patch({
      battery: update.battery,
      placement: update.placement,
      info: { ...state.info, revision: update.revision, colour: update.colour ?? state.info.colour },
      eq: update.eq ?? state.eq,
      touchLocked: update.touchLocked ?? state.touchLocked,
      gestures: update.gestures ?? state.gestures,
      noiseMode: update.noiseMode ?? state.noiseMode,
      ambientLevel: update.ambientLevel ?? state.ambientLevel,
      hold: update.touchOptions
        ? { left: action(update.touchOptions.left), right: action(update.touchOptions.right) }
        : state.hold,
      noiseCycle: update.noiseTouch
        ? { left: cycleOf(update.noiseTouch.left), right: cycleOf(update.noiseTouch.right) }
        : state.noiseCycle,
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

  /** `level`: the ambient step, zero-based. */
  async setAmbientLevel(level: number): Promise<void> {
    const { ambientLevel } = this.#store.state;
    await this.#change({ ambientLevel: level }, { ambientLevel }, ambientLevelCommand(this.#model(), level, ambientLevel));
  }

  /** What a touch-and-hold does on one earbud; the other earbud's is restated as the earbuds last reported it. */
  async setHoldAction(side: 'left' | 'right', action: TouchAction): Promise<void> {
    const { hold } = this.#store.state;
    const other = hold[side === 'left' ? 'right' : 'left'];
    if (other === null) return this.#needSettings();
    const next = { ...hold, [side]: action };
    await this.#change({ hold: next }, { hold }, touchOptionCommand(this.#model(), next.left ?? other, next.right ?? other));
  }

  /** Which two noise modes a long press cycles through on one earbud; the other earbud's is restated. */
  async setNoiseCycle(side: 'left' | 'right', cycle: NoiseCycle): Promise<void> {
    const { noiseCycle, info } = this.#store.state;
    const other = noiseCycle[side === 'left' ? 'right' : 'left'];
    if (other === null) return this.#needSettings();
    const next = { ...noiseCycle, [side]: cycle };
    await this.#change(
      { noiseCycle: next },
      { noiseCycle },
      noiseCycleCommand(this.#model(), info.revision, next.left ?? other, next.right ?? other),
    );
  }

  /** A setting that restates its neighbour cannot go out until the earbuds have said what the neighbour is. */
  #needSettings(): void {
    this.#patch({ error: 'The earbuds have not reported their current settings yet, so this one cannot be changed safely.' });
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

/** The pair of modes a long press cycles through, from which of the three the earbud has switched on. */
function cycleOf(set: NoiseSet): NoiseCycle | null {
  if (set.anc && set.off) return 'ancOff';
  if (set.ambient && set.off) return 'ambOff';
  if (set.ambient && set.anc) return 'ancAmb';
  return null;
}
