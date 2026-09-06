/**
 * Orchestration: owns the transport, the client and the observable state.
 *
 * Capability detection is opportunistic (spec §3.5) — `refresh()` tries
 * battery, ANC and EQ independently and tolerates each failing, building
 * `capabilities` from whichever actually answered. Mirrors
 * `drivers/nothing/device.ts`'s probing, not Sony's live bitmap negotiation,
 * since neither `0x0100`'s bit mapping nor `0x010D`'s reply shape was ever
 * captured for this protocol.
 */

import {
  Cmd,
  decodeAncDirectQuery,
  decodeBattery,
  decodeEqAll,
  decodeEqCurrent,
  decodeNotificationSupport,
  decodeProductId,
  encodeRegisterNotify,
  encodeSetAncMode,
  encodeSetEqPreset,
} from './commands';
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
 * reads (spec §3.5) run serially in `#refreshAll`, so at the client's default
 * `DEFAULT_TIMEOUT_MS` a silent device makes connect take ~7.5s. Matches
 * `drivers/nothing/device.ts`'s `PROBE_TIMEOUT_MS` — same rationale, same
 * value. `QueryProductId` is the one exception: every real device answers
 * it, so it keeps the client's default timeout.
 */
const PROBE_TIMEOUT_MS = 400;

export interface HeyMelodyDeviceOptions {
  /** Injected so tests do not pay `DEFAULT_TIMEOUT_MS` per unanswered command. */
  timeoutMs?: number;
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
  #refreshing = false;

  constructor(openTransport: TransportOpener = openSerialTransport, options: HeyMelodyDeviceOptions = {}) {
    this.#timeoutMs = options.timeoutMs;
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
        await client.request(Cmd.QueryNotificationSupport, [], { timeoutMs: PROBE_TIMEOUT_MS }),
      );
      if (status !== 0) throw new Error(`QueryNotificationSupport returned non-zero status ${status}`);
      await client.request(Cmd.RegisterNotify, encodeRegisterNotify(ids), { timeoutMs: PROBE_TIMEOUT_MS });
      return;
    } catch (error) {
      console.debug('[heymelody] QueryNotificationSupport handshake failed, falling back to a bare RegisterNotify', error);
    }
    try {
      await client.request(Cmd.RegisterNotify, [], { timeoutMs: PROBE_TIMEOUT_MS });
    } catch (error) {
      console.warn('[heymelody] RegisterNotify failed', error);
    }
  }

  #onNotification(frame: HeyMelodyFrame): void {
    if (frame.cmd === Cmd.ActiveReport) {
      this.#replace(applyAncEvent(this.#store.state, frame.payload));
    }
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
    try {
      const { status, productId } = decodeProductId(await client.request(Cmd.QueryProductId));
      // A non-zero status means the productId bytes alongside it are not
      // trustworthy. This was briefly relaxed to a log-only check on the
      // grounds that the APK notes never define what `status` means — but
      // 1812z/OppoPods's `ProductIdParser.parse()` independently gates on
      // this exact byte for this exact command (`data[9] != 0 -> return
      // null`, its `data[9]` being this driver's `payload[0]`), and the APK
      // itself has a generic "status: 0=success" helper used the same way
      // elsewhere (`commands/c.java`'s `j()`) — two independent sources now
      // agree, so this reverts to discarding on non-zero status.
      if (status !== 0) throw new Error(`QueryProductId returned non-zero status ${status}`);
      const catalog = catalogEntryFor(productId);
      // `info.model` is the catalog-resolved display name, not the raw
      // productId — `core/manager.ts`'s constructor loop reads
      // `state.info.model` generically off every driver (`rememberDeviceName`,
      // `Adoptable.subscribe`'s own type), so it must exist and be
      // human-readable here exactly like it does for every other driver.
      this.#patch({ info: { model: catalog?.name ?? null, productId, catalog } });
    } catch (error) {
      console.warn('[heymelody] QueryProductId failed', error);
    }

    const capabilities = new Set<HeyMelodyCapability>();

    const probe = async (capability: HeyMelodyCapability, run: () => Promise<void>) => {
      try {
        await run();
        capabilities.add(capability);
      } catch (error) {
        // Expected, not exceptional: a probe not answering means this device
        // simply lacks the feature, the same reasoning
        // `drivers/nothing/device.ts`'s probe loop uses `console.debug` for.
        console.debug(`[heymelody] ${capability} unavailable`, error);
      }
    };

    await probe('battery', async () => {
      this.#patch({
        battery: decodeBattery(await client.request(Cmd.Battery, [], { timeoutMs: PROBE_TIMEOUT_MS })),
      });
    });

    await probe('anc', async () => {
      // Note: 0x010C's reply is un-enveloped — it is not the 0x0204
      // notification's `[outerSubtype, innerType, ...]` shape, so this uses
      // the dedicated `decodeAncDirectQuery`, not `decodeAncNotification`.
      // Request payload `[0x01, 0x01]`, not empty — confirmed directly from
      // 1812z/OppoPods's current source (`buildPacket(cmd =
      // Cmd.QUERY_ANC_MODE, payload = byteArrayOf(0x01, 0x01))`); an empty
      // request here may simply go unanswered on real hardware.
      const event = decodeAncDirectQuery(
        await client.request(Cmd.QueryAncDirect, [0x01, 0x01], { timeoutMs: PROBE_TIMEOUT_MS }),
      );
      // A response that fails to decode at all is treated as "ANC
      // unsupported/unrecognised" rather than guessed at — 0x010C's exact
      // reply shape was never independently confirmed (spec §6).
      if (!event) throw new Error('unrecognised ANC response shape');
      this.#patch({
        ancModeIndex: event.modeIndex ?? this.#store.state.ancModeIndex,
        ancLevel: event.level ?? this.#store.state.ancLevel,
      });
    });

    await probe('eq', async () => {
      // The two EQ reads are independent per spec §3.5 — `0x0122` (QueryEqAll)
      // is what actually supplies everything the Sound section renders, so it
      // must still be attempted (and still able to mark `'eq'` capable) even
      // when `0x010F` (QueryEqCurrent) throws first.
      let answered = false;
      try {
        const { status, presetId } = decodeEqCurrent(
          await client.request(Cmd.QueryEqCurrent, [], { timeoutMs: PROBE_TIMEOUT_MS }),
        );
        // Same reasoning as QueryProductId (see its comment): reverted to
        // discarding on non-zero status now that two independent sources
        // agree that convention holds in this protocol.
        if (status !== 0) throw new Error(`QueryEqCurrent returned non-zero status ${status}`);
        this.#patch({ eqCurrentPreset: presetId });
        answered = true;
      } catch (error) {
        console.debug('[heymelody] QueryEqCurrent failed', error);
      }
      try {
        // Request payload `[0x01, 0x05]`, not empty — confirmed directly
        // from 1812z/OppoPods's current source
        // (`buildPacket(Cmd.QUERY_EQ_ALL, payload = byteArrayOf(0x01,
        // 0x05))`).
        this.#patch({
          eqPresets: decodeEqAll(
            await client.request(Cmd.QueryEqAll, [0x01, 0x05], { timeoutMs: PROBE_TIMEOUT_MS }),
          ),
        });
        answered = true;
      } catch (error) {
        console.debug('[heymelody] QueryEqAll failed', error);
      }
      if (!answered) throw new Error('neither EQ read answered');
    });

    this.#patch({ capabilities });
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
