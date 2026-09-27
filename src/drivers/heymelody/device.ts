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
import { decodeBattery, decodeBatteryList } from './protocol/battery';
import { decodeWear, decodeWearList } from './protocol/wear';
import { decodeAncDirectQuery, encodeSetAncMode } from './protocol/anc';
import { decodeEqAll, decodeEqCurrent, decodeEqList, decodeSetEqCurveAck, encodeSetEqCurve, encodeSetEqPreset } from './protocol/eq';
import type { EqPreset } from './protocol/eq';
import { PushEvent, decodeNotificationSupport, encodeRegisterNotify } from './protocol/notify';
import { decodeCapabilities, featuresFromCommands } from './protocol/capability';
import { statusBody } from './protocol/status';
import type { HeyMelodyFrame } from './sppFrame';
import { HeyMelodyClient } from './client';
import { catalogEntryFor } from './catalog';
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

const NOT_HEYMELODY_ERROR = 'This does not look like a HeyMelody or realme device.';

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
        else this.#replace(applyAncEvent(this.#store.state, frame.payload));
      } catch (error) {
        console.debug('[heymelody] unreadable push', event, error);
      }
    } else if (frame.cmd === Cmd.PushEqCurrent && frame.payload.length > 0) {
      this.#patch({ eqCurrentPreset: frame.payload[0] });
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
    const identified = await this.#readProductId(client);
    const commands = await this.#readCommands(client);
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

  async #readProductId(client: HeyMelodyClient): Promise<boolean> {
    try {
      const { status, productId } = decodeProductId(await client.request(Cmd.QueryProductId));
      if (status !== 0) throw new Error(`QueryProductId returned non-zero status ${status}`);
      const catalog = catalogEntryFor(productId);
      this.#patch({ info: { ...this.#store.state.info, model: catalog?.name ?? null, productId, catalog } });
      return true;
    } catch (error) {
      console.warn('[heymelody] QueryProductId failed', error);
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
    return found;
  }

  async #readVersion(client: HeyMelodyClient): Promise<void> {
    const version = decodeVersion(await client.request(Cmd.QueryVersion, [], { timeoutMs: this.#probeTimeoutMs }));
    this.#patch({ info: { ...this.#store.state.info, version } });
  }

  async #readBattery(client: HeyMelodyClient): Promise<void> {
    this.#patch({ battery: decodeBattery(await client.request(Cmd.Battery, [], { timeoutMs: this.#probeTimeoutMs })) });
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
        // Empty payload, as both vendor apps send it (realme `PollCommandManager.d()`, HeyTap `i.java:182`).
        this.#setConfirmedEq(decodeEqAll(await client.request(Cmd.QueryEqAll, [], { timeoutMs: this.#probeTimeoutMs })));
        answered = true;
      } catch (error) {
        console.debug('[heymelody] QueryEqAll failed', error);
      }
    }
    if (!answered) throw new Error('neither EQ read answered');
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
      decodeSetEqCurveAck(await client.request(Cmd.SetEqCurve, encodeSetEqCurve(preset, clamped)));
      this.#confirmedEq.set(eqId, next);
    } catch (error) {
      this.#patch({ eqPresets: swap(this.#confirmedEq.get(eqId) ?? preset), error: describeError(error) });
    }
  }

  async setEqPreset(eqId: number): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    const previous = this.#store.state.eqCurrentPreset;
    this.#patch({ eqCurrentPreset: eqId });
    try {
      await client.request(Cmd.SetEqPreset, encodeSetEqPreset(eqId));
    } catch (error) {
      this.#patch({ eqCurrentPreset: previous, error: describeError(error) });
    }
  }

  // --- teardown ----------------------------------------------------------

  async disconnect(): Promise<void> {
    const durable = this.#lastKnownDurable();
    const closed = this.#session.disconnect();
    this.#patch({ ...initialHeyMelodyState, ...durable, status: 'disconnected' });
    await closed;
  }
}
