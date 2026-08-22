/**
 * Nothing/CMF device orchestration.
 *
 * The shape mirrors `SonyDevice`, with one inversion: Sony gates polling on a
 * capability table the device reports in one query, while Nothing has no such
 * query — the model is not readable over SPP at all. So capabilities are
 * *probed*: every read the model table says might exist is attempted once on
 * connect, and one that times out marks the feature absent and hides its
 * section. A timeout here means "this model does not implement it", not a
 * failure (see `NothingUnsupportedError`).
 *
 * Protocol bytes and semantics ported from radiance-project/ear-web.
 */

import * as C from './commands';
import type { Gesture, TripleBattery } from './commands';
import { NothingClient } from './client';
import type { NotificationListener } from './client';
import { NOTHING_SPP_UUID } from '@/core/transport';
import { modelForBase, modelForBluetoothName, modelForFirmware } from './models';
import type { Persistable, SnapshotPayload } from '@/core/persistence';
import {
  isBluetoothTarget,
  isUnreachable,
  isWebSerialSupported,
  openSerialTransportAt,
  requestPort,
} from '@/core/transport';
import type { ConnectionTarget, Transport, TransportOpener } from '@/core/transport';
import { GattTransport, openGattTransport } from '@/core/gattTransport';
import { DeviceSession } from '@/core/session';
import type { SessionHooks } from '@/core/session';
import { StateStore } from '@/core/stateStore';
import type { StateStoreHooks } from '@/core/stateStore';
import { describeError } from '@/core/errors';
import type { ConnectionStatus } from '@/core/connection';

/**
 * Either carrier: BLE GATT (how the official app reaches the older models and
 * the only path Chrome's Bluetooth chooser grants) or the 9600-baud serial
 * service — unlike the 115200 the Sony/Sennheiser RFCOMM services use.
 */
const openNothingTransport: TransportOpener = (target, handlers) =>
  isBluetoothTarget(target)
    ? openGattTransport(target, handlers, { serviceUuid: NOTHING_SPP_UUID })
    : openSerialTransportAt(9600)(target, handlers);

export interface NothingInfo {
  model: string | null;
  /** The `B1xx` base code, when known — from a snapshot, never the wire. */
  modelBase: string | null;
  firmware: string | null;
}

/** Features negotiated by probing; an unreadable one is simply absent. */
export type NothingCapability =
  | 'battery'
  | 'anc'
  | 'eq'
  | 'customEq'
  | 'diracEq'
  | 'advancedEq'
  | 'enhancedBass'
  | 'inEarDetection'
  | 'latency'
  | 'personalizedAnc'
  | 'gestures'
  | 'earFitTest'
  | 'caseLed';

export interface NothingState {
  status: ConnectionStatus;
  error: string | null;
  info: NothingInfo;
  battery: TripleBattery;
  /** The ear-web ANC level (1 off … 6 adaptive), or null before a reading. */
  anc: number | null;
  /** Ear (2)'s personalized ANC. */
  personalizedAnc: boolean | null;
  /** Preset id, or the Advanced pseudo-id when advanced EQ is on. */
  eqPreset: number | null;
  /** The custom band values, in ear-web's slot order. */
  customEq: [number, number, number] | null;
  diracEq: number | null;
  /** Buds Pro 2's onboard "advanced" EQ profile toggle. */
  advancedEq: boolean | null;
  bassEnhance: { enabled: boolean; level: number } | null;
  inEarDetection: boolean | null;
  lowLatency: boolean | null;
  gestures: Gesture[] | null;
  /** Transient result of the last ear tip fit test; never persisted. */
  earFitResult: C.EarFitResult | null;
  capabilities: Set<NothingCapability>;
}

export const initialNothingState: NothingState = {
  status: 'disconnected',
  error: null,
  info: { model: null, modelBase: null, firmware: null },
  battery: { left: null, right: null, case: null },
  anc: null,
  personalizedAnc: null,
  eqPreset: null,
  customEq: null,
  diracEq: null,
  advancedEq: null,
  bassEnhance: null,
  inEarDetection: null,
  lowLatency: null,
  gestures: null,
  earFitResult: null,
  capabilities: new Set(),
};

/** Bumped when the durable payload changes shape; older caches are dropped. */
export const NOTHING_SNAPSHOT_VERSION = 1;

export interface NothingDurableState {
  info: NothingInfo;
  anc: number | null;
  personalizedAnc: boolean | null;
  eqPreset: number | null;
  customEq: [number, number, number] | null;
  diracEq: number | null;
  advancedEq: boolean | null;
  bassEnhance: { enabled: boolean; level: number } | null;
  inEarDetection: boolean | null;
  lowLatency: boolean | null;
  gestures: Gesture[] | null;
  capabilities: NothingCapability[];
}

export const captureDurable = (state: NothingState): NothingDurableState => ({
  info: state.info,
  anc: state.anc,
  personalizedAnc: state.personalizedAnc,
  eqPreset: state.eqPreset,
  customEq: state.customEq,
  diracEq: state.diracEq,
  advancedEq: state.advancedEq,
  bassEnhance: state.bassEnhance,
  inEarDetection: state.inEarDetection,
  lowLatency: state.lowLatency,
  gestures: state.gestures,
  capabilities: [...state.capabilities],
});

export const applyDurable = (payload: object): Partial<NothingState> => {
  const snapshot = payload as NothingDurableState;
  return {
    info: snapshot.info,
    anc: snapshot.anc ?? null,
    personalizedAnc: snapshot.personalizedAnc ?? null,
    eqPreset: snapshot.eqPreset ?? null,
    customEq: snapshot.customEq ?? null,
    diracEq: snapshot.diracEq ?? null,
    advancedEq: snapshot.advancedEq ?? null,
    bassEnhance: snapshot.bassEnhance ?? null,
    inEarDetection: snapshot.inEarDetection ?? null,
    lowLatency: snapshot.lowLatency ?? null,
    gestures: snapshot.gestures ?? null,
    capabilities: new Set(snapshot.capabilities),
  };
};

type Listener = (state: NothingState) => void;

const stateStoreHooks: StateStoreHooks<NothingState> = {
  isUnread: (state) => state.info.model === null && state.info.firmware === null,
  isConnected: (state) => state.status === 'connected',
  capture: captureDurable,
  apply: (_state, payload) => applyDurable(payload),
};

export class NothingDevice implements Persistable {
  readonly #store: StateStore<NothingState>;
  readonly #session: DeviceSession<NothingClient>;
  #refreshing = false;

  constructor(openTransport: TransportOpener = openNothingTransport) {
    this.#store = new StateStore(
      { ...initialNothingState, status: isWebSerialSupported() ? 'disconnected' : 'unsupported' },
      stateStoreHooks,
    );

    const onNotification: NotificationListener = (frame) => this.#onNotification(frame);
    const hooks: SessionHooks<NothingClient> = {
      createClient: (transport) => new NothingClient(transport),
      handleData: (client, chunk) => client.handleData(chunk),
      wire: (client) => client.onNotification(onNotification),
      onStatus: (status, error) => this.#patch({ status, error }),
      onDrop: (reason) =>
        this.#patch({
          ...initialNothingState,
          status: 'disconnected',
          error: reason ? describeError(reason) : null,
        }),
      abort: (client, reason) => client.abort(reason),
    };
    this.#session = new DeviceSession(openTransport, hooks);
  }

  get state(): NothingState {
    return this.#store.state;
  }

  // --- Persistable ----------------------------------------------------------

  readonly snapshotVersion = NOTHING_SNAPSHOT_VERSION;

  snapshot(): SnapshotPayload | null {
    return this.#store.snapshot();
  }

  restore(payload: SnapshotPayload): void {
    this.#store.restore(payload);
  }

  subscribe(listener: Listener): () => void {
    return this.#store.subscribe(listener);
  }

  #patch(partial: Partial<NothingState>): void {
    this.#store.patch(partial);
  }

  async autoConnect(): Promise<boolean> {
    if (!isWebSerialSupported()) return false;
    const port = await DeviceSession.grantedPortFor('nothing');
    if (!port) return false;
    try {
      await this.#connectTo(port);
      return true;
    } catch {
      this.#patch({ status: 'disconnected' });
      return false;
    }
  }

  async adoptPort(target: ConnectionTarget): Promise<void> {
    // A BLE device's advertised name is the one model identification the
    // serial link never gives us — record it before anything else can fail.
    if (isBluetoothTarget(target)) this.#rememberBluetoothName(target);
    try {
      await this.#connectTo(target);
    } catch (error) {
      this.#patch({ status: 'disconnected', error: isUnreachable(error) ? null : describeError(error) });
    }
  }

  /**
   * The single-connection BLE adopt: the manager resolved this driver from
   * the transport's service, so the transport is already open — adopt it
   * without ever closing and reopening the GATT link.
   */
  async adoptTransport(transport: Transport): Promise<void> {
    if (transport instanceof GattTransport) this.#rememberBluetoothName(transport.device);
    try {
      await this.#session.adoptTransport(transport, async () => {
        await this.refresh();
      });
    } catch (error) {
      this.#patch({ status: 'disconnected', error: describeError(error) });
    }
  }

  #rememberBluetoothName(device: BluetoothDevice): void {
    if (!device.name) return;
    const model = modelForBluetoothName(device.name);
    if (model) {
      this.#patch({ info: { ...this.#store.state.info, model: model.name, modelBase: model.base } });
    } else {
      // Unknown name still beats "unknown device" as a label.
      this.#patch({ info: { ...this.#store.state.info, model: device.name } });
    }
  }

  async connect(): Promise<void> {
    if (!isWebSerialSupported()) {
      this.#patch({ status: 'unsupported' });
      return;
    }
    try {
      const { port } = await requestPort();
      await this.#connectTo(port);
    } catch (error) {
      this.#patch({ status: 'disconnected', error: isUnreachable(error) ? null : describeError(error) });
    }
  }

  async #connectTo(target: ConnectionTarget): Promise<void> {
    await this.#session.connectTo(target, async () => {
      await this.refresh();
    });
  }

  /**
   * Applies an unsolicited state change.
   *
   * Nothing pushes battery and ANC changes after writes and when the buds'
   * own controls are used, so this is how a write is confirmed and how
   * physical changes reach the UI.
   */
  #onNotification(frame: { command: number; payload: Uint8Array }): void {
    try {
      switch (frame.command) {
        case C.Notify.Battery:
          this.#patch({ battery: C.decodeBattery(frame.payload) });
          break;
        case C.Notify.AncMode:
          this.#patch({ anc: C.decodeAncMode(frame.payload) });
          break;
        case C.Notify.EarFitTestResult: {
          const result = C.decodeEarFitResult(frame.payload);
          if (result) this.#patch({ earFitResult: result });
          break;
        }
        default:
          break;
      }
    } catch (error) {
      console.warn('[nothing] could not decode a notification', error);
    }
  }

  /**
   * Probes every feature once, then reads everything the probe says exists.
   *
   * ear-web spaces its init polls ~100 ms apart; the client's request queue
   * serialises ours, and a feature the model lacks costs one timeout.
   */
  async refresh(): Promise<void> {
    const client = this.#session.client;
    if (!client || this.#refreshing) return;
    this.#refreshing = true;
    try {
      const capabilities = new Set<NothingCapability>();
      const probe = async (capability: NothingCapability, run: () => Promise<void>) => {
        try {
          await run();
          capabilities.add(capability);
        } catch (error) {
          console.debug(`[nothing] ${capability} unavailable`, error);
        }
      };

      await probe('battery', async () => {
        const payload = await client.request(C.Read.Battery);
        this.#patch({ battery: C.decodeBattery(payload) });
      });

      // Firmware is not a capability — every model answers it, and the
      // model-name fallback hangs off it.
      try {
        const payload = await client.request(C.Read.Firmware);
        const firmware = C.decodeFirmware(payload);
        this.#patch({
          info: { ...this.#store.state.info, firmware, model: this.#modelName(firmware) },
        });
      } catch (error) {
        console.warn('[nothing] firmware read failed', error);
      }

      await probe('eq', async () => {
        const payload = await client.request(C.Read.EqPreset);
        this.#patch({ eqPreset: C.decodeEqPreset(payload) });
      });

      await probe('diracEq', async () => {
        const payload = await client.request(C.Read.DiracPreset);
        this.#patch({ diracEq: C.decodeDiracPreset(payload) });
      });

      await probe('anc', async () => {
        const payload = await client.request(C.Read.AncMode);
        this.#patch({ anc: C.decodeAncMode(payload) });
      });

      await probe('inEarDetection', async () => {
        const payload = await client.request(C.Read.InEarDetection);
        this.#patch({ inEarDetection: C.decodeInEarDetection(payload) });
      });

      await probe('latency', async () => {
        const payload = await client.request(C.Read.LatencyMode);
        this.#patch({ lowLatency: C.decodeLatency(payload) });
      });

      await probe('personalizedAnc', async () => {
        const payload = await client.request(C.Read.PersonalizedAnc);
        this.#patch({ personalizedAnc: C.decodePersonalizedAnc(payload) });
      });

      await probe('gestures', async () => {
        const payload = await client.request(C.Read.Gestures);
        this.#patch({ gestures: C.decodeGestures(payload) });
      });

      await probe('advancedEq', async () => {
        const payload = await client.request(C.Read.AdvancedEq);
        this.#patch({ advancedEq: C.decodeAdvancedEq(payload) });
      });

      await probe('enhancedBass', async () => {
        const payload = await client.request(C.Read.EnhancedBass);
        this.#patch({ bassEnhance: C.decodeEnhancedBass(payload) });
      });

      await probe('customEq', async () => {
        const payload = await client.request(C.Read.CustomEq);
        this.#patch({ customEq: C.decodeCustomEq(payload) });
      });

      this.#patch({ capabilities });
    } finally {
      this.#refreshing = false;
    }
  }

  /** The display name, from the base code in a snapshot when the wire cannot say. */
  #modelName(firmware: string | null): string | null {
    const fromBase = modelForBase(this.#store.state.info.modelBase);
    if (fromBase) return fromBase.name;
    const fromFirmware = modelForFirmware(firmware);
    return fromFirmware?.name ?? null;
  }

  // --- writes ---------------------------------------------------------------

  async setAncLevel(level: number): Promise<void> {
    const client = this.#session.client;
    const previous = this.#store.state.anc;
    if (!client) return;

    this.#patch({ anc: level });
    try {
      await client.write(C.Write.SetAncMode, C.encodeAncMode(level));
      // Writes are not answered; the notification (or this re-read) confirms.
      const payload = await client.request(C.Read.AncMode).catch(() => null);
      if (payload) this.#patch({ anc: C.decodeAncMode(payload) });
    } catch (error) {
      this.#patch({ anc: previous, error: describeError(error) });
    }
  }

  async setEqPreset(preset: number): Promise<void> {
    const client = this.#session.client;
    const previous = this.#store.state.eqPreset;
    if (!client) return;

    this.#patch({ eqPreset: preset });
    try {
      await client.write(C.Write.SetEqPreset, C.encodeEqPreset(preset));
      if (preset === C.EqPreset.Custom) {
        await this.#readCustomEq(client);
      }
    } catch (error) {
      this.#patch({ eqPreset: previous, error: describeError(error) });
    }
  }

  /** Applies the custom band values; the device must be on the Custom preset. */
  async setCustomEq(bands: [number, number, number]): Promise<void> {
    const client = this.#session.client;
    if (!client) return;

    const previous = this.#store.state.customEq;
    this.#patch({ customEq: bands });
    try {
      await client.write(C.Write.SetEqPreset, C.encodeEqPreset(C.EqPreset.Custom));
      await client.write(C.Write.SetCustomEq, C.encodeCustomEq(bands));
    } catch (error) {
      this.#patch({ customEq: previous, error: describeError(error) });
    }
  }

  /** Applies a Dirac Opteo preset — the EQ selector on Buds Pro 2 / CMF Buds. */
  async setDiracPreset(preset: number): Promise<void> {
    const client = this.#session.client;
    const previous = this.#store.state.diracEq;
    if (!client) return;

    this.#patch({ diracEq: preset });
    try {
      await client.write(C.Write.SetDiracPreset, C.encodeDiracPreset(preset));
      const payload = await client.request(C.Read.DiracPreset).catch(() => null);
      if (payload) this.#patch({ diracEq: C.decodeDiracPreset(payload) });
    } catch (error) {
      this.#patch({ diracEq: previous, error: describeError(error) });
    }
  }

  async setAdvancedEq(on: boolean): Promise<void> {
    const client = this.#session.client;
    const previous = this.#store.state.advancedEq;
    if (!client) return;

    this.#patch({ advancedEq: on });
    try {
      await client.write(C.Write.SetAdvancedEq, C.encodeAdvancedEq(on));
    } catch (error) {
      this.#patch({ advancedEq: previous, error: describeError(error) });
    }
  }

  async setBassEnhance(enabled: boolean, level: number): Promise<void> {
    const client = this.#session.client;
    const previous = this.#store.state.bassEnhance;
    if (!client) return;

    this.#patch({ bassEnhance: { enabled, level } });
    try {
      await client.write(C.Write.SetEnhancedBass, C.encodeEnhancedBass(enabled, level));
    } catch (error) {
      this.#patch({ bassEnhance: previous, error: describeError(error) });
    }
  }

  async setInEarDetection(on: boolean): Promise<void> {
    const client = this.#session.client;
    const previous = this.#store.state.inEarDetection;
    if (!client) return;

    this.#patch({ inEarDetection: on });
    try {
      await client.write(C.Write.SetInEarDetection, C.encodeInEarDetection(on));
    } catch (error) {
      this.#patch({ inEarDetection: previous, error: describeError(error) });
    }
  }

  async setLowLatency(on: boolean): Promise<void> {
    const client = this.#session.client;
    const previous = this.#store.state.lowLatency;
    if (!client) return;

    this.#patch({ lowLatency: on });
    try {
      await client.write(C.Write.SetLatencyMode, C.encodeLatency(on));
      const payload = await client.request(C.Read.LatencyMode).catch(() => null);
      if (payload) this.#patch({ lowLatency: C.decodeLatency(payload) });
    } catch (error) {
      this.#patch({ lowLatency: previous, error: describeError(error) });
    }
  }

  async setPersonalizedAnc(on: boolean): Promise<void> {
    const client = this.#session.client;
    const previous = this.#store.state.personalizedAnc;
    if (!client) return;

    this.#patch({ personalizedAnc: on });
    try {
      await client.write(C.Write.SetPersonalizedAnc, C.encodePersonalizedAnc(on));
    } catch (error) {
      this.#patch({ personalizedAnc: previous, error: describeError(error) });
    }
  }

  /** Writes one gesture binding; the payload names bud, gesture and action. */
  async setGesture(gesture: Gesture): Promise<void> {
    const client = this.#session.client;
    if (!client) return;

    const previous = this.#store.state.gestures;
    const next = (previous ?? []).map((g) =>
      g.device === gesture.device && g.type === gesture.type ? gesture : g,
    );
    this.#patch({ gestures: next });
    try {
      await client.write(C.Write.SetGesture, C.encodeGesture(gesture));
    } catch (error) {
      this.#patch({ gestures: previous, error: describeError(error) });
    }
  }

  /** Rings the buds so they can be found. Pass `false` to stop early. */
  async ringBuds(ring: boolean, left = false): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    try {
      await client.write(C.Write.RingBuds, C.encodeRing(left ? 0x02 : 0x03, ring));
    } catch (error) {
      this.#patch({ error: describeError(error) });
    }
  }

  /** Starts the ear tip fit test; the result arrives as a notification. */
  async startEarFitTest(): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    try {
      this.#patch({ earFitResult: null });
      await client.write(C.Write.StartEarFitTest, C.encodeEarFitTest());
    } catch (error) {
      this.#patch({ error: describeError(error) });
    }
  }

  async #readCustomEq(client: NothingClient): Promise<void> {
    try {
      const payload = await client.request(C.Read.CustomEq);
      this.#patch({ customEq: C.decodeCustomEq(payload) });
    } catch (error) {
      console.warn('[nothing] could not re-read the custom EQ', error);
    }
  }

  // --- teardown --------------------------------------------------------------

  async disconnect(): Promise<void> {
    const closed = this.#session.disconnect();
    this.#patch({ ...initialNothingState, status: 'disconnected' });
    await closed;
  }
}
