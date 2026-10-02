/**
 * Orchestration: owns the transport, the client and the observable state.
 *
 * Connect reads the always-allowed identity commands (capability bitmap
 * `0x0100`, productId, colour), then polls only what the bitmap reports —
 * as both vendor apps do. Firmware that sends no bitmap falls back to
 * probing battery, ANC and EQ.
 */

import { Cmd } from './protocol/cmd';
import { decodeColourId, decodeProductId, decodeVersion } from './protocol/identity';
import type { VersionEntry } from './protocol/identity';
import { decodeBattery, decodeBatteryList } from './protocol/battery';
import { decodeWear, decodeWearList } from './protocol/wear';
import { decodeAncDirectQuery, encodeSetAncMode } from './protocol/anc';
import {
  decodeEqAll,
  decodeEqCurrent,
  decodeEqCurrentPush,
  decodeEqList,
  decodeSetEqCurveAck,
  EQ_ACTION,
  encodeEqWrite,
  encodeSetEqPreset,
  newCustomPreset,
} from './protocol/eq';
import type { EqPreset } from './protocol/eq';
import { PushEvent, decodeNotificationSupport, encodeRegisterNotify } from './protocol/notify';
import { decodeCapabilities, featuresFromCommands } from './protocol/capability';
import {
  ALERT_VOLUME_RANGE,
  QUERIED_FEATURES,
  decodeAlertVolume,
  decodeBassLevel,
  decodeFeatures,
  encodeBassLevel,
  encodeQueryFeatures,
  encodeSetFeature,
} from './protocol/feature';
import { decodeGestures, encodeGestures } from './protocol/gesture';
import type { GestureRecord } from './protocol/gesture';
import { decodePeerList, decodePeerReply } from './protocol/multiDevice';
import { statusBody } from './protocol/status';
import type { HeyMelodyFrame } from './sppFrame';
import { HeyMelodyClient } from './client';
import { catalogEntryFor } from './catalog';
import { customEqCap } from './eqModes';
import { buildAncCapabilities } from './ancModel';
import {
  HEYMELODY_SNAPSHOT_VERSION,
  applyAncEvent,
  applyDurable,
  captureDurable,
  initialHeyMelodyState,
} from './state';
import type { HeyMelodyCapability, HeyMelodyState } from './state';
// Re-exported so `core/manager.ts` can import it from this module, the same
// way it imports every other driver's state type from that driver's main
// device file rather than reaching past it into an internal module.
export type { HeyMelodyState } from './state';
import {
  isBluetoothTarget,
  isUnreachable,
  isWebSerialSupported,
  openSerialTransport,
} from '@/core/transport';
import type { ConnectionTarget, TransportOpener } from '@/core/transport';
import { DeviceSession } from '@/core/session';
import type { SessionHooks } from '@/core/session';
import { StateStore } from '@/core/stateStore';
import type { StateStoreHooks } from '@/core/stateStore';
import { describeError } from '@/core/errors';
import type { Persistable, SnapshotPayload } from '@/core/persistence';

type Listener = (state: HeyMelodyState) => void;

/**
 * How long an opportunistic capability probe (battery/ANC/EQ, plus
 * `RegisterNotify`) waits before giving up. These are all "might not exist"
 * reads (spec §3.5) run serially in `#refreshAll`, so this bounds how long a
 * device lacking a feature stalls connect. Same value as
 * `drivers/nothing/device.ts`'s `PROBE_TIMEOUT_MS`, and injectable the same
 * way. `QueryProductId` keeps the client's default timeout.
 */
const PROBE_TIMEOUT_MS = 400;

/** How much of the conversation `protocolLog` keeps. */
const PROTOCOL_LOG_MAX = 400;

export interface ProtocolLogEntry {
  /** `Date.now()` when the bytes crossed the link. */
  at: number;
  /** `connect` marks a new link, with no bytes. */
  direction: 'tx' | 'rx' | 'connect';
  bytes: Uint8Array;
}

const NOT_HEYMELODY_ERROR = 'This does not look like a HeyMelody or realme device.';

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');

export interface HeyMelodyDeviceOptions {
  /** Injected so tests do not pay `DEFAULT_TIMEOUT_MS` per unanswered command. */
  timeoutMs?: number;
  /** Injected so tests do not pay `PROBE_TIMEOUT_MS` per unanswered probe. */
  probeTimeoutMs?: number;
}

const stateStoreHooks: StateStoreHooks<HeyMelodyState> = {
  isUnread: (state) => state.info.productId === null,
  isConnected: (state) => state.status === 'connected',
  capture: captureDurable,
  apply: (_state, payload) => applyDurable(payload),
};

export class HeyMelodyDevice implements Persistable {
  readonly #store: StateStore<HeyMelodyState>;
  readonly #session: DeviceSession<HeyMelodyClient>;
  readonly #timeoutMs?: number;
  readonly #probeTimeoutMs: number;
  #refreshing = false;
  /** Last curve the device confirmed per eqId — what a failed curve write rolls back to. */
  readonly #confirmedEq = new Map<number, EqPreset>();
  #protocolLog: ProtocolLogEntry[] = [];
  readonly #protocolLogListeners = new Set<() => void>();

  constructor(openTransport: TransportOpener = openSerialTransport, options: HeyMelodyDeviceOptions = {}) {
    this.#timeoutMs = options.timeoutMs;
    this.#probeTimeoutMs = options.probeTimeoutMs ?? PROBE_TIMEOUT_MS;
    this.#store = new StateStore(
      { ...initialHeyMelodyState, status: isWebSerialSupported() ? 'disconnected' : 'unsupported' },
      stateStoreHooks,
    );

    const hooks: SessionHooks<HeyMelodyClient> = {
      createClient: (transport) => new HeyMelodyClient(transport, { timeoutMs: this.#timeoutMs }),
      handleData: (client, chunk) => client.handleData(chunk),
      wire: (client) => {
        client.onNotification((frame) => this.#onNotification(frame));
        this.#appendLog('connect', new Uint8Array());
        client.onRaw((bytes, direction) => this.#appendLog(direction, bytes));
      },
      onStatus: (status, error) => this.#patch({ status, error }),
      onDrop: (reason) =>
        this.#patch({
          ...initialHeyMelodyState,
          ...this.#lastKnownDurable(),
          status: 'disconnected',
          error: reason ? describeError(reason) : null,
        }),
      abort: (client, reason) => client.abort(reason),
    };
    this.#session = new DeviceSession(openTransport, hooks);
  }

  get state(): HeyMelodyState {
    return this.#store.state;
  }

  /**
   * Raw bytes both ways since the first connect, newest last — for working out what a
   * model that misbehaves actually sends. Kept outside state so logging never re-renders.
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
   * Sends one hand-entered command and resolves with its reply payload. Limited to the
   * `0x01xx` queries and `0x02xx` notification setup, so nothing typed here changes a setting.
   */
  async sendQuery(cmd: number, payload: number[]): Promise<Uint8Array> {
    if (!Number.isInteger(cmd) || cmd < 0x0100 || cmd > 0x02ff) {
      throw new Error('Only query commands (0x0100–0x02FF) can be sent from here.');
    }
    const client = this.#session.client;
    if (!client) throw new Error('Not connected.');
    return client.request(cmd, payload);
  }

  // --- Persistable ---------------------------------------------------------

  readonly snapshotVersion = HEYMELODY_SNAPSHOT_VERSION;

  snapshot(): SnapshotPayload | null {
    return this.#store.snapshot();
  }

  restore(payload: SnapshotPayload): void {
    this.#store.restore(payload);
  }

  subscribe(listener: Listener): () => void {
    return this.#store.subscribe(listener);
  }

  #patch(partial: Partial<HeyMelodyState>): void {
    this.#store.patch(partial);
  }

  #replace(next: HeyMelodyState): void {
    this.#store.replace(next);
  }

  /**
   * Identity and settings worth carrying across a disconnect, so the sidebar
   * keeps naming the device instead of collapsing to the generic "no device"
   * placeholder the instant the link drops — see
   * docs/superpowers/specs/2026-08-27-heymelody-driver-design.md and the
   * equivalent method on every other driver's device class.
   */
  #lastKnownDurable(): Partial<HeyMelodyState> {
    const durable = this.#store.snapshot();
    return durable ? applyDurable(durable) : {};
  }

  // --- connect ---------------------------------------------------------------

  /** Takes over a port the caller already obtained (serial only, this phase). */
  async adoptPort(target: ConnectionTarget): Promise<void> {
    if (isBluetoothTarget(target)) {
      this.#patch({ status: 'disconnected', error: 'BLE GATT is not implemented for HeyMelody yet.' });
      return;
    }
    try {
      await this.#session.connectTo(target, async () => {
        // A connect that supersedes a live session skips onDrop, and these fields are only
        // overwritten when the new pair answers — clear them so another pair's controls can't linger.
        this.#confirmedEq.clear();
        this.#patch({ features: new Map(), bassLevel: null, alertVolume: null, gestures: [], peers: [] });
        await this.#subscribe();
        await this.refresh();
      });
    } catch (error) {
      this.#patch({ status: 'disconnected', error: isUnreachable(error) ? null : describeError(error) });
    }
  }

  /**
   * Two-step handshake, corrected from an earlier single empty-payload
   * `RegisterNotify` call that 1812z/OppoPods's actual connect sequence
   * suggests never subscribes to anything on real hardware: query which
   * notification ids this device can push (`0x0200`), then subscribe to
   * that exact list (`0x0205`). Falls back to the old bare call if the query
   * step is unanswered (some firmware may not implement it) — either way,
   * losing the subscription only means ANC/EQ changes made on the earbuds
   * themselves are invisible until the next refresh, so it must not fail
   * the connect.
   */
  async #subscribe(): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    try {
      const { status, ids } = decodeNotificationSupport(
        await client.request(Cmd.QueryNotificationSupport, [], { timeoutMs: this.#probeTimeoutMs }),
      );
      if (status !== 0) throw new Error(`QueryNotificationSupport returned non-zero status ${status}`);
      await client.request(Cmd.RegisterNotify, encodeRegisterNotify(ids), { timeoutMs: this.#probeTimeoutMs });
      return;
    } catch (error) {
      console.debug('[heymelody] QueryNotificationSupport handshake failed, falling back to a bare RegisterNotify', error);
    }
    try {
      await client.request(Cmd.RegisterNotify, [], { timeoutMs: this.#probeTimeoutMs });
    } catch (error) {
      console.warn('[heymelody] RegisterNotify failed', error);
    }
  }

  #onNotification(frame: HeyMelodyFrame): void {
    if (frame.cmd === Cmd.ActiveReport) {
      const event = frame.payload[0];
      const list = frame.payload.subarray(1);
      try {
        if (event === PushEvent.Battery) this.#patch({ battery: decodeBatteryList(list) });
        else if (event === PushEvent.Wear) this.#patch({ wear: decodeWearList(list) });
        else if (event === PushEvent.Devices) this.#patch({ peers: decodePeerList(list) });
        else this.#replace(applyAncEvent(this.#store.state, frame.payload));
      } catch (error) {
        console.debug('[heymelody] unreadable push', event, error);
      }
    } else if (frame.cmd === Cmd.PushEqCurrent && frame.payload.length > 0) {
      try {
        this.#patch({ eqCurrentPreset: decodeEqCurrentPush(frame.payload) });
      } catch (error) {
        console.debug('[heymelody] unreadable EQ current push', error);
      }
    } else if (frame.cmd === Cmd.PushEqCurves) {
      try {
        this.#setConfirmedEq(decodeEqList(frame.payload));
      } catch (error) {
        console.debug('[heymelody] unreadable EQ push', error);
      }
    }
  }

  #setConfirmedEq(presets: EqPreset[]): void {
    for (const preset of presets) this.#confirmedEq.set(preset.eqId, preset);
    this.#patch({ eqPresets: presets });
  }

  // --- refresh -----------------------------------------------------------

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

  async #refreshAll(client: HeyMelodyClient): Promise<void> {
    // HeyTap's order (`commands/i.smali`, the 0x8100 case): bitmap, then vendor id, then productId.
    // Some firmware (Enco Buds3 Pro) leaves a productId query sent before that unanswered.
    const commands = await this.#readCommands(client);
    await this.#sendVendorId(client);
    const identified = await this.#readProductId(client);
    // The link dropped mid-connect: onDrop already reset state and set the real reason.
    if (this.#session.client !== client) return;
    if (!identified && !commands) {
      // Every HeyMelody/realme TL device answers one of these. Anything else — often a
      // generic SPP port — is released rather than held, so auto-connect can move on.
      await this.disconnect();
      this.#patch({ error: NOT_HEYMELODY_ERROR });
      return;
    }
    await this.#readColour(client);
    const capabilities = commands ? await this.#pollReported(client, commands) : await this.#probeAll(client);
    if (this.#session.client !== client) return;
    this.#patch({ capabilities });
  }

  /** Best-effort: HeyTap sends this before asking for the productId, and nothing reads the reply. */
  async #sendVendorId(client: HeyMelodyClient): Promise<void> {
    try {
      await client.request(Cmd.SendVendorId, [0x9a, 0x07], { timeoutMs: this.#probeTimeoutMs });
    } catch (error) {
      console.debug('[heymelody] SendVendorId unanswered', error);
    }
  }

  async #readProductId(client: HeyMelodyClient): Promise<boolean> {
    let payload: Uint8Array | null = null;
    try {
      payload = await client.request(Cmd.QueryProductId);
      const { status, productId } = decodeProductId(payload);
      if (status !== 0) throw new Error(`QueryProductId returned non-zero status ${status}`);
      const catalog = catalogEntryFor(productId);
      this.#patch({ info: { ...this.#store.state.info, model: catalog?.name ?? null, productId, catalog } });
      return true;
    } catch (error) {
      console.warn('[heymelody] QueryProductId failed', error);
      const reason = payload === null ? 'no reply' : `${payload.length >= 4 ? `status ${payload[0]}` : 'short'} · ${hex(payload)}`;
      this.#patch({ diagnostics: { ...this.#store.state.diagnostics, productId: reason } });
      return false;
    }
  }

  /** The commands the firmware implements, or null when it sends no bitmap (then features are probed). */
  async #readCommands(client: HeyMelodyClient): Promise<Set<number> | null> {
    try {
      return decodeCapabilities(await client.request(Cmd.QueryCapability));
    } catch (error) {
      console.debug('[heymelody] no capability bitmap, falling back to probing', error);
      return null;
    }
  }

  async #readColour(client: HeyMelodyClient): Promise<void> {
    try {
      const colourId = decodeColourId(await client.request(Cmd.QueryColourId, [], { timeoutMs: this.#probeTimeoutMs }));
      this.#patch({ info: { ...this.#store.state.info, colourId } });
    } catch (error) {
      console.debug('[heymelody] QueryColourId failed', error);
    }
  }

  /** Polls each feature the bitmap reports; one whose query fails is treated as absent. */
  async #pollReported(client: HeyMelodyClient, commands: Set<number>): Promise<Set<HeyMelodyCapability>> {
    const reported = featuresFromCommands(commands);
    const found = new Set<HeyMelodyCapability>();
    const read = async (feature: HeyMelodyCapability, run: () => Promise<void>) => {
      if (!reported.has(feature)) return;
      try {
        await run();
        found.add(feature);
      } catch (error) {
        console.debug(`[heymelody] reported ${feature} did not read`, error);
      }
    };
    await read('version', () => this.#readVersion(client));
    await read('battery', () => this.#readBattery(client));
    await read('wear', () => this.#readWear(client));
    await read('anc', () => this.#readAnc(client));
    await read('eq', () => this.#readEq(client, commands));
    await read('bassLevel', () => this.#readBassLevel(client));
    await read('gestures', () => this.#readGestures(client));
    await read('multiDevice', () => this.#readPeers(client));
    // 0x010D is always allowed; a model that ignores it simply has no switches.
    try {
      await this.#readFeatures(client);
    } catch (error) {
      console.debug('[heymelody] feature switches did not read', error);
    }
    // No bitmap row carries 0x0130, so the alert volume is found by probing.
    try {
      await this.#readAlertVolume(client);
      found.add('alertVolume');
    } catch (error) {
      console.debug('[heymelody] alertVolume unavailable', error);
    }
    for (const passthrough of ['find', 'eqCustom'] as const) if (reported.has(passthrough)) found.add(passthrough);
    return found;
  }

  /** Firmware without a bitmap: try the features that are safe to probe. */
  async #probeAll(client: HeyMelodyClient): Promise<Set<HeyMelodyCapability>> {
    const found = new Set<HeyMelodyCapability>();
    const probe = async (feature: HeyMelodyCapability, run: () => Promise<void>) => {
      try {
        await run();
        found.add(feature);
      } catch (error) {
        console.debug(`[heymelody] ${feature} unavailable`, error);
      }
    };
    await probe('battery', () => this.#readBattery(client));
    await probe('anc', () => this.#readAnc(client));
    await probe('eq', () => this.#readEq(client, null));
    try {
      await this.#readFeatures(client);
    } catch (error) {
      console.debug('[heymelody] feature switches unavailable', error);
    }
    await probe('alertVolume', () => this.#readAlertVolume(client));
    return found;
  }

  async #readVersion(client: HeyMelodyClient): Promise<void> {
    const payload = await client.request(Cmd.QueryVersion, [], { timeoutMs: this.#probeTimeoutMs });
    let version: VersionEntry[];
    try {
      version = decodeVersion(payload);
    } catch (error) {
      this.#patch({ diagnostics: { ...this.#store.state.diagnostics, version: hex(payload) } });
      throw error;
    }
    // Blank or unprintable version strings: keep the bytes so the layout can be worked out.
    if (version.some((entry) => !/^[\x21-\x7e]+$/.test(entry.version))) {
      this.#patch({ diagnostics: { ...this.#store.state.diagnostics, version: hex(payload) } });
    }
    this.#patch({ info: { ...this.#store.state.info, version } });
  }

  async #readBattery(client: HeyMelodyClient): Promise<void> {
    this.#patch({ battery: decodeBattery(await client.request(Cmd.Battery, [], { timeoutMs: this.#probeTimeoutMs })) });
  }

  async #readFeatures(client: HeyMelodyClient): Promise<void> {
    const features = decodeFeatures(
      await client.request(Cmd.QueryFeatures, encodeQueryFeatures(QUERIED_FEATURES), { timeoutMs: this.#probeTimeoutMs }),
    );
    this.#patch({ features });
  }

  async #readBassLevel(client: HeyMelodyClient): Promise<void> {
    this.#patch({ bassLevel: decodeBassLevel(await client.request(Cmd.QueryBassLevel, [], { timeoutMs: this.#probeTimeoutMs })) });
  }

  async #readAlertVolume(client: HeyMelodyClient): Promise<void> {
    this.#patch({ alertVolume: decodeAlertVolume(await client.request(Cmd.QueryAlertVolume, [], { timeoutMs: this.#probeTimeoutMs })) });
  }

  async #readPeers(client: HeyMelodyClient): Promise<void> {
    this.#patch({ peers: decodePeerReply(await client.request(Cmd.QueryDevices, [], { timeoutMs: this.#probeTimeoutMs })) });
  }

  /** `0x0108` empty, as both vendor apps send it; `02 03 01` once if refused. */
  async #readGestures(client: HeyMelodyClient): Promise<void> {
    const ask = async (payload: number[]) =>
      decodeGestures(await client.request(Cmd.QueryGestures, payload, { timeoutMs: this.#probeTimeoutMs }));
    try {
      this.#patch({ gestures: await ask([]) });
    } catch (error) {
      console.debug('[heymelody] QueryGestures refused, retrying with 02 03 01', error);
      this.#patch({ gestures: await ask([0x02, 0x03, 0x01]) });
    }
  }

  async #readWear(client: HeyMelodyClient): Promise<void> {
    this.#patch({ wear: decodeWear(await client.request(Cmd.QueryWear, [], { timeoutMs: this.#probeTimeoutMs })) });
  }

  async #readAnc(client: HeyMelodyClient): Promise<void> {
    // `[0x01, 0x01]` is one of the three request forms realme Link's
    // `PollCommandManager.x()` sends (`{}`, `{1,1}`, `{2,1}`, chosen per model).
    const event = decodeAncDirectQuery(
      await client.request(Cmd.QueryAncDirect, [0x01, 0x01], { timeoutMs: this.#probeTimeoutMs }),
    );
    if (!event) throw new Error('unrecognised ANC response shape');
    if (event.kind === 'currentMode') {
      this.#patch({
        ancModeIndex: event.modeIndex ?? this.#store.state.ancModeIndex,
        ancLevel: event.level ?? this.#store.state.ancLevel,
      });
    }
  }

  /** The two EQ reads are independent: either answering marks EQ present. `commands` null = unknown, try both. */
  async #readEq(client: HeyMelodyClient, commands: Set<number> | null): Promise<void> {
    let answered = false;
    if (commands === null || commands.has(Cmd.QueryEqCurrent)) {
      try {
        const { status, presetId } = decodeEqCurrent(
          await client.request(Cmd.QueryEqCurrent, [], { timeoutMs: this.#probeTimeoutMs }),
        );
        if (status !== 0) throw new Error(`QueryEqCurrent returned non-zero status ${status}`);
        this.#patch({ eqCurrentPreset: presetId });
        answered = true;
      } catch (error) {
        console.debug('[heymelody] QueryEqCurrent failed', error);
      }
    }
    if (commands === null || commands.has(Cmd.QueryEqAll)) {
      try {
        await this.#readEqList(client);
        answered = true;
      } catch (error) {
        console.debug('[heymelody] QueryEqAll failed', error);
      }
    }
    if (!answered) throw new Error('neither EQ read answered');
  }

  /** `0x0122` empty, as both vendor apps send it; `01 05` once if refused (OppoPods / OppoPodsManager send that form). */
  async #readEqList(client: HeyMelodyClient): Promise<void> {
    try {
      this.#setConfirmedEq(decodeEqAll(await client.request(Cmd.QueryEqAll, [], { timeoutMs: this.#probeTimeoutMs })));
    } catch (error) {
      console.debug('[heymelody] QueryEqAll refused, retrying with 01 05', error);
      this.#setConfirmedEq(decodeEqAll(await client.request(Cmd.QueryEqAll, [0x01, 0x05], { timeoutMs: this.#probeTimeoutMs })));
    }
  }

  /** After a preset write ids can renumber and the buds choose the selection: re-read both. Failures are logged, not thrown. */
  async #rereadEq(client: HeyMelodyClient): Promise<void> {
    try {
      const { status, presetId } = decodeEqCurrent(
        await client.request(Cmd.QueryEqCurrent, [], { timeoutMs: this.#probeTimeoutMs }),
      );
      if (status !== 0) throw new Error(`QueryEqCurrent returned non-zero status ${status}`);
      this.#patch({ eqCurrentPreset: presetId });
    } catch (error) {
      console.debug('[heymelody] EQ current re-read failed', error);
    }
    try {
      await this.#readEqList(client);
    } catch (error) {
      console.debug('[heymelody] EQ list re-read failed', error);
    }
  }

  // --- writes ----------------------------------------------------------------

  /**
   * `key` is a canonical mode name (`AncKey`, e.g. `'nc'`/`'transparency'`),
   * not a raw protocol index — resolved to this specific model's own bit via
   * its catalog `noiseReductionMode` data (see `ancModel.ts`). A key this
   * model has no entry for (including every model the bundled whitelist
   * doesn't cover at all) is a no-op: there is nothing to resolve it to.
   */
  async setAncMode(key: string): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    const protocolIndex = buildAncCapabilities(this.#store.state.info.catalog?.noiseReductionMode).keyToIndex[key];
    if (protocolIndex === undefined) return;
    const previous = this.#store.state.ancModeIndex;
    this.#patch({ ancModeIndex: protocolIndex });
    try {
      await client.request(Cmd.SetAncMode, encodeSetAncMode(protocolIndex));
    } catch (error) {
      this.#patch({ ancModeIndex: previous, error: describeError(error) });
    }
  }

  /** `0x0400 [1]` starts ringing, `[0]` stops; ack `0x8400 [status]` (realme `SetCommandManager:499-511`). */
  async setFinding(on: boolean): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    const previous = this.#store.state.finding;
    this.#patch({ finding: on });
    try {
      statusBody(await client.request(Cmd.FindEarbuds, [on ? 0x01 : 0x00]), 'find earbuds');
    } catch (error) {
      this.#patch({ finding: previous, error: describeError(error) });
    }
  }

  /** `0x0403 [id][on]`; ack `0x8403 [status]`. Optimistic, rolled back on failure. */
  async setFeature(id: number, on: boolean): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    const previous = this.#store.state.features;
    this.#patch({ features: new Map(previous).set(id, on) });
    try {
      statusBody(await client.request(Cmd.SetFeature, encodeSetFeature(id, on)), `feature ${id}`);
    } catch (error) {
      this.#patch({ features: previous, error: describeError(error) });
    }
  }

  /** `0x041B [min][max][level]`, clamped to the range the device reported. Call on release, not per tick. */
  async setBassLevel(level: number): Promise<void> {
    const client = this.#session.client;
    const previous = this.#store.state.bassLevel;
    if (!client || !previous) return;
    const next = { ...previous, level: Math.min(previous.max, Math.max(previous.min, Math.round(level))) };
    this.#patch({ bassLevel: next });
    try {
      statusBody(await client.request(Cmd.SetBassLevel, encodeBassLevel(next)), 'BassWave level');
    } catch (error) {
      this.#patch({ bassLevel: previous, error: describeError(error) });
    }
  }

  /** `0x0427 [level]`, clamped to 1-10. Call on release, not per tick. */
  async setAlertVolume(level: number): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    const previous = this.#store.state.alertVolume;
    const next = Math.min(ALERT_VOLUME_RANGE.max, Math.max(ALERT_VOLUME_RANGE.min, Math.round(level)));
    this.#patch({ alertVolume: next });
    try {
      statusBody(await client.request(Cmd.SetAlertVolume, [next]), 'alert volume');
    } catch (error) {
      this.#patch({ alertVolume: previous, error: describeError(error) });
    }
  }

  /** `0x0401 [1][deviceType][button][action][fn]`; ack `0x8401 [status]`, then re-read the table. Optimistic, rolled back on failure. */
  async setGesture(record: GestureRecord, fn: number): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    const previous = this.#store.state.gestures;
    const same = (other: GestureRecord) =>
      other.deviceType === record.deviceType && other.button === record.button && other.action === record.action;
    this.#patch({ gestures: previous.map((other) => (same(other) ? { ...other, fn } : other)) });
    try {
      statusBody(await client.request(Cmd.SetGestures, encodeGestures([{ ...record, fn }])), 'touch control');
    } catch (error) {
      this.#patch({ gestures: previous, error: describeError(error) });
      return;
    }
    try {
      await this.#readGestures(client);
    } catch (error) {
      console.debug('[heymelody] touch controls re-read failed', error);
    }
  }

  /** Writes a custom EQ's band gains (`0x0418` modify), clamped to its range; rolls back to the last confirmed curve on failure. */
  async setEqCurve(eqId: number, gains: number[]): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    const preset = this.#store.state.eqPresets.find((candidate) => candidate.eqId === eqId);
    if (!preset) return;
    const clamped = gains.map((gain) => Math.max(preset.minValue, Math.min(preset.maxValue, Math.round(gain))));
    const next: EqPreset = { ...preset, bands: preset.bands.map((band, i) => ({ ...band, dbValue: clamped[i] })) };
    const swap = (replacement: EqPreset) =>
      this.#store.state.eqPresets.map((candidate) => (candidate.eqId === eqId ? replacement : candidate));
    this.#patch({ eqPresets: swap(next) });
    try {
      decodeSetEqCurveAck(await client.request(Cmd.SetEqCurve, encodeEqWrite(EQ_ACTION.Modify, preset, clamped)));
      this.#confirmedEq.set(eqId, next);
    } catch (error) {
      this.#patch({ eqPresets: swap(this.#confirmedEq.get(eqId) ?? preset), error: describeError(error) });
    }
  }

  /** Built-ins select with `0x0406`; a custom preset is selected by writing it with `0x0418` action 2, as the vendor app does. */
  async setEqPreset(eqId: number): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    const custom = this.#store.state.eqPresets.find((preset) => preset.eqId === eqId);
    const previous = { current: this.#store.state.eqCurrentPreset, presets: this.#store.state.eqPresets };
    this.#patch({
      eqCurrentPreset: eqId,
      eqPresets: previous.presets.map((preset) => ({ ...preset, isSelected: preset.eqId === eqId })),
    });
    try {
      if (custom) {
        decodeSetEqCurveAck(await client.request(Cmd.SetEqCurve, encodeEqWrite(EQ_ACTION.Modify, { ...custom, isSelected: true })));
        await this.#rereadEq(client);
      } else {
        statusBody(await client.request(Cmd.SetEqPreset, encodeSetEqPreset(eqId)), 'EQ preset select');
      }
    } catch (error) {
      this.#patch({ eqCurrentPreset: previous.current, eqPresets: previous.presets, error: describeError(error) });
    }
  }

  /** `0x0418` action 1 with id 0 — the buds assign the id — then re-read, since ids can renumber. */
  async createCustomPreset(name?: string): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    const customs = this.#store.state.eqPresets;
    if (customs.length >= customEqCap(this.#store.state.info.catalog)) return;
    const taken = new Set(customs.map((preset) => preset.name));
    let n = 1;
    while (taken.has(`Custom ${n}`)) n += 1;
    try {
      decodeSetEqCurveAck(await client.request(Cmd.SetEqCurve, encodeEqWrite(EQ_ACTION.Add, newCustomPreset(name ?? `Custom ${n}`, customs[0] ?? null))));
    } catch (error) {
      this.#patch({ error: describeError(error) });
    }
    await this.#rereadEq(client);
  }

  /** `0x0418` action 3 with the whole preset, then re-read; the buds pick what becomes selected. */
  async deleteCustomPreset(eqId: number): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    const preset = this.#store.state.eqPresets.find((candidate) => candidate.eqId === eqId);
    if (!preset) return;
    try {
      decodeSetEqCurveAck(await client.request(Cmd.SetEqCurve, encodeEqWrite(EQ_ACTION.Delete, preset)));
    } catch (error) {
      this.#patch({ error: describeError(error) });
    }
    await this.#rereadEq(client);
  }

  // --- teardown ----------------------------------------------------------

  async disconnect(): Promise<void> {
    const durable = this.#lastKnownDurable();
    const closed = this.#session.disconnect();
    this.#patch({ ...initialHeyMelodyState, ...durable, status: 'disconnected' });
    await closed;
  }
}
