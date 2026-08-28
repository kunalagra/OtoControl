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
  decodeAncNotification,
  decodeBattery,
  decodeEqAll,
  decodeEqCurrent,
  decodeProductId,
  encodeSetAncMode,
  encodeSetEqPreset,
} from './commands';
import type { HeyMelodyFrame } from './sppFrame';
import { HeyMelodyClient } from './client';
import { catalogEntryFor } from './catalog';
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

  async #subscribe(): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    try {
      await client.request(Cmd.RegisterNotify, [], { timeoutMs: PROBE_TIMEOUT_MS });
    } catch (error) {
      // Payload shape for this command was never captured; a no-payload
      // request is this driver's own assumption. Losing the subscription
      // only means ANC/EQ changes made on the earbuds themselves are
      // invisible until the next refresh — it must not fail the connect.
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
      // trustworthy — resolving them against the catalog anyway would risk a
      // confident, wrong model. Throwing here routes it through the existing
      // catch below, leaving `info` unset for this refresh cycle instead.
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
      const event = decodeAncNotification(
        await client.request(Cmd.QueryAncDirect, [], { timeoutMs: PROBE_TIMEOUT_MS }),
      );
      // A response that does not decode as `currentMode` is treated as "ANC
      // unsupported/unrecognised" rather than guessed at — 0x010C's exact
      // reply shape was never independently confirmed (spec §6).
      if (!event || event.kind !== 'currentMode') throw new Error('unrecognised ANC response shape');
      this.#patch({
        ancSupportedModes: event.supportedModes ?? this.#store.state.ancSupportedModes,
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
        this.#patch({
          eqCurrentPreset: decodeEqCurrent(
            await client.request(Cmd.QueryEqCurrent, [], { timeoutMs: PROBE_TIMEOUT_MS }),
          ),
        });
        answered = true;
      } catch (error) {
        console.debug('[heymelody] QueryEqCurrent failed', error);
      }
      try {
        this.#patch({
          eqPresets: decodeEqAll(await client.request(Cmd.QueryEqAll, [], { timeoutMs: PROBE_TIMEOUT_MS })),
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

  async setAncMode(mode: number): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    const previous = this.#store.state.ancLevel;
    this.#patch({ ancLevel: mode });
    try {
      await client.request(Cmd.SetAncMode, encodeSetAncMode(mode));
    } catch (error) {
      this.#patch({ ancLevel: previous, error: describeError(error) });
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
