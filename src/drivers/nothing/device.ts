/**
 * Nothing/CMF device orchestration.
 *
 * The shape mirrors `SonyDevice`, with one inversion: Sony gates polling on a
 * capability table the device reports in one query, while Nothing answers no
 * equivalent. So capabilities are *probed*: every read the model table says
 * might exist is attempted once on connect, and one that times out marks the
 * feature absent and hides its section. A timeout here means "this model does
 * not implement it", not a failure (see `NothingUnsupportedError`).
 *
 * The official app's `GET_SUPPORTED_FEATURE 0xc00d` is *not* a replacement for
 * that probe: its bitmask (`DeviceSupportFeature`) covers pairing, assistants,
 * codecs and wear detection, not which EQ or spatial features a model has. It
 * would settle two of our probes — ANC and in-ear detection — and nothing
 * else. See `docs/PROTOCOL-UNKNOWNS.md`.
 *
 * Protocol bytes and semantics ported from radiance-project/ear-web, with the
 * command ids cross-checked against the official app's `ProtocolConstant`.
 */

import * as C from './commands';
import type { Gesture, NothingBattery } from './commands';
import { NothingClient, PROBE_TIMEOUT_MS, replyFor } from './client';
import type { NotificationListener } from './client';
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
import { GattTransport, NOTHING_GATT_SERVICES, openGattTransport } from '@/core/gattTransport';
import { DeviceSession } from '@/core/session';
import type { SessionHooks } from '@/core/session';
import { StateStore } from '@/core/stateStore';
import type { StateStoreHooks } from '@/core/stateStore';
import { describeError } from '@/core/errors';
import type { ConnectionStatus } from '@/core/connection';

/**
 * Either carrier. Web Serial at 9600 baud — unlike the 115200 the
 * Sony/Sennheiser RFCOMM services use — or BLE GATT on whichever of Nothing's
 * two services the device answers.
 *
 * Both are real. A revision of this file briefly made it serial-only, on the
 * reading that `aeac4a03…` is an RFCOMM service class and so could never
 * resolve as a GATT service. The premise was right; the conclusion was not.
 * Devices do expose it over GATT, and the official app declares a second BLE
 * data service besides — see `core/gattTransport.ts`. Removing the branch
 * broke a path that worked on hardware.
 */
const openNothingTransport: TransportOpener = (target, handlers) =>
  isBluetoothTarget(target)
    ? openGattTransport(target, handlers, { serviceUuids: NOTHING_GATT_SERVICES })
    : openSerialTransportAt(9600)(target, handlers);

export interface NothingInfo {
  model: string | null;
  /** The `B1xx` base code, when known — read off the wire, or from a snapshot. */
  modelBase: string | null;
  /**
   * The colourway id as two hex digits, matching the CDN artwork table's keys.
   * Read off the wire like the model; null until the device answers.
   */
  colourId: string | null;
  firmware: string | null;
  /** From `GET_REMOTE_CONFIGURATION`, when the device answers it. */
  serial: string | null;
  hardware: string | null;
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
  | 'caseLed'
  | 'spatialAudio'
  | 'wearState'
  | 'multipoint'
  | 'clarityBoost'
  | 'smartAnc'
  | 'smartFree'
  | 'lhdc'
  | 'advancedEqBands';

export interface NothingState {
  status: ConnectionStatus;
  error: string | null;
  info: NothingInfo;
  battery: NothingBattery;
  /** The ear-web ANC level (1 off … 6 adaptive), or null before a reading. */
  anc: number | null;
  /** Personalized ANC: the switch, plus the calibration state it reports. */
  personalizedAnc: C.PersonalizedAnc | null;
  /** Preset id, or the Advanced pseudo-id when advanced EQ is on. */
  eqPreset: number | null;
  /** The custom band values, in ear-web's slot order. */
  customEq: C.CustomEq | null;
  diracEq: number | null;
  /** The onboard "advanced" EQ profile toggle. */
  advancedEq: boolean | null;
  /** Its 8-band parametric curve, on the models that have it. */
  advancedEqBands: C.AdvancedEq | null;
  bassEnhance: { enabled: boolean; level: number } | null;
  /** Spatial audio, and head tracking on the models that carry it. */
  spatialAudio: C.SpatialAudio | null;
  /** Wear/in-case state, and the source of `worn`. Never persisted. */
  earphoneStatus: C.EarphoneStatus | null;
  multipoint: boolean | null;
  clarityBoost: C.ClarityBoost | null;
  smartAnc: boolean | null;
  smartFree: boolean | null;
  lhdc: boolean | null;
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
  info: { model: null, modelBase: null, colourId: null, firmware: null, serial: null, hardware: null },
  battery: { left: null, right: null, case: null, single: null },
  anc: null,
  personalizedAnc: null,
  eqPreset: null,
  customEq: null,
  diracEq: null,
  advancedEq: null,
  advancedEqBands: null,
  bassEnhance: null,
  spatialAudio: null,
  earphoneStatus: null,
  multipoint: null,
  clarityBoost: null,
  smartAnc: null,
  smartFree: null,
  lhdc: null,
  inEarDetection: null,
  lowLatency: null,
  gestures: null,
  earFitResult: null,
  capabilities: new Set(),
};

/** Bumped when the durable payload changes shape; older caches are dropped. */
export const NOTHING_SNAPSHOT_VERSION = 5;

export interface NothingDurableState {
  info: NothingInfo;
  anc: number | null;
  personalizedAnc: C.PersonalizedAnc | null;
  eqPreset: number | null;
  customEq: C.CustomEq | null;
  diracEq: number | null;
  advancedEq: boolean | null;
  advancedEqBands: C.AdvancedEq | null;
  bassEnhance: { enabled: boolean; level: number } | null;
  spatialAudio: C.SpatialAudio | null;
  multipoint: boolean | null;
  clarityBoost: C.ClarityBoost | null;
  smartAnc: boolean | null;
  smartFree: boolean | null;
  lhdc: boolean | null;
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
  advancedEqBands: state.advancedEqBands,
  bassEnhance: state.bassEnhance,
  spatialAudio: state.spatialAudio,
  multipoint: state.multipoint,
  clarityBoost: state.clarityBoost,
  smartAnc: state.smartAnc,
  smartFree: state.smartFree,
  lhdc: state.lhdc,
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
    advancedEqBands: snapshot.advancedEqBands ?? null,
    bassEnhance: snapshot.bassEnhance ?? null,
    spatialAudio: snapshot.spatialAudio ?? null,
    multipoint: snapshot.multipoint ?? null,
    clarityBoost: snapshot.clarityBoost ?? null,
    smartAnc: snapshot.smartAnc ?? null,
    smartFree: snapshot.smartFree ?? null,
    lhdc: snapshot.lhdc ?? null,
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

  /**
   * How long a capability probe waits. Injected for the same reason
   * `openTransport` is: a test that walks the whole probe sequence otherwise
   * spends `PROBE_TIMEOUT_MS` per unimplemented feature, which is the cost this
   * constant exists to bound in production and to skip in tests.
   */
  readonly #probeTimeoutMs: number;

  constructor(
    openTransport: TransportOpener = openNothingTransport,
    options: { probeTimeoutMs?: number } = {},
  ) {
    this.#probeTimeoutMs = options.probeTimeoutMs ?? PROBE_TIMEOUT_MS;
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
    // A BLE device's advertised name identifies the model before a single byte
    // is exchanged — worth recording before anything can fail. Over serial
    // there is no name, and `Read.DeviceModel` covers it instead.
    if (isBluetoothTarget(target)) this.#rememberBluetoothName(target);
    try {
      await this.#connectTo(target);
    } catch (error) {
      this.#patch({ status: 'disconnected', error: isUnreachable(error) ? null : describeError(error) });
    }
  }

  /**
   * The single-connection BLE adopt: the manager resolved this driver from the
   * transport's service, so the transport is already open — adopt it without
   * closing and reopening the GATT link.
   */
  async adoptTransport(transport: Transport): Promise<void> {
    if (transport instanceof GattTransport) this.#rememberBluetoothName(transport.device);
    try {
      await this.#session.adoptTransport(transport, async () => {
        await this.refresh({ trustCache: true });
      });
    } catch (error) {
      this.#patch({ status: 'disconnected', error: describeError(error) });
    }
  }

  #rememberBluetoothName(device: BluetoothDevice): void {
    if (!device.name) return;
    const model = modelForBluetoothName(device.name);
    if (model) {
      this.#patch({
        info: { ...this.#store.state.info, model: model.name, modelBase: model.base },
      });
    } else {
      // An unknown name still beats "unknown device" as a label.
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
      await this.refresh({ trustCache: true });
    });
  }

  /**
   * Applies an unsolicited state change.
   *
   * Nothing pushes battery and ANC changes after writes and when the buds'
   * own controls are used, so this is how a write is confirmed and how
   * physical changes reach the UI.
   */
  /**
   * What each read's payload means, keyed by the read command. Shared by the
   * probes and by the notification path, so a pushed value is decoded exactly
   * as a polled one is.
   */
  static readonly #READS: ReadonlyArray<
    [command: number, apply: (payload: Uint8Array) => Partial<NothingState>]
  > = [
    [C.Read.Battery, (p) => ({ battery: C.decodeBattery(p) })],
    [C.Read.AncMode, (p) => ({ anc: C.decodeAncMode(p) })],
    [C.Read.EqPreset, (p) => ({ eqPreset: C.decodeEqPreset(p) })],
    [C.Read.CustomEq, (p) => ({ customEq: C.decodeCustomEq(p) })],
    [C.Read.DiracPreset, (p) => ({ diracEq: C.decodeDiracPreset(p) })],
    [C.Read.AdvancedEq, (p) => ({ advancedEq: C.decodeAdvancedEq(p) })],
    [C.Read.AdvancedEqBands, (p) => ({ advancedEqBands: C.decodeAdvancedEqBands(p) })],
    [C.Read.EnhancedBass, (p) => ({ bassEnhance: C.decodeEnhancedBass(p) })],
    [C.Read.SpatialAudio, (p) => ({ spatialAudio: C.decodeSpatialAudio(p) })],
    [C.Read.InEarDetection, (p) => ({ inEarDetection: C.decodeInEarDetection(p) })],
    [C.Read.LatencyMode, (p) => ({ lowLatency: C.decodeLatency(p) })],
    [C.Read.PersonalizedAnc, (p) => ({ personalizedAnc: C.decodePersonalizedAnc(p) })],
    [C.Read.Gestures, (p) => ({ gestures: C.decodeGestures(p) })],
    [C.Read.EarphoneStatus, (p) => ({ earphoneStatus: C.decodeEarphoneStatus(p) })],
    [C.Read.Multipoint, (p) => ({ multipoint: C.decodeSwitch(p) })],
    [C.Read.ClarityBoost, (p) => ({ clarityBoost: C.decodeClarityBoost(p) })],
    [C.Read.SmartAnc, (p) => ({ smartAnc: C.decodeSwitch(p) })],
    [C.Read.SmartFree, (p) => ({ smartFree: C.decodeSwitch(p) })],
    [C.Read.Lhdc, (p) => ({ lhdc: C.decodeSwitch(p) })],
  ];

  /**
   * Unsolicited state pushes, on two channels.
   *
   * The `0xE0xx` events are the obvious one. The other — which this used to
   * drop on the floor — is the **read's own reply id**, `command & 0x7fff`,
   * which the device sends unprompted whenever a setting it holds moves;
   * BudsLink names these `*_SECONDARY_NTFY`. `NothingClient` already forwards
   * every unmatched frame here, so they were arriving and being ignored, and
   * only battery, ANC and the fit-test result ever updated live.
   */
  #onNotification(frame: { command: number; payload: Uint8Array }): void {
    try {
      switch (frame.command) {
        case C.Notify.Battery:
          this.#patch({ battery: C.decodeBattery(frame.payload) });
          return;
        case C.Notify.DeviceStatus:
          // Wear state moved — a bud in or out of an ear or the case.
          this.#patch({ earphoneStatus: C.decodeEarphoneStatus(frame.payload) });
          return;
        case C.Notify.AncMode:
          this.#patch({ anc: C.decodeAncMode(frame.payload) });
          return;
        case C.Notify.EarFitTestResult: {
          const result = C.decodeEarFitResult(frame.payload);
          if (result) this.#patch({ earFitResult: result });
          return;
        }
        default:
          break;
      }

      const pushed = NothingDevice.#READS.find(([command]) => replyFor(command) === frame.command);
      if (pushed) this.#patch(pushed[1](frame.payload));
    } catch (error) {
      console.warn('[nothing] could not decode a notification', error);
    }
  }

  /**
   * Probes every feature once, then reads everything the probe says exists.
   *
   * ear-web spaces its init polls ~100 ms apart; the client's request queue
   * serialises ours, and a feature the model lacks costs one timeout.
   *
   * `refresh` asks 22 questions, and at the client's default 1500 ms a model
   * that implements none of the optional features would spend 33 s connecting.
   * Everything except the model and firmware reads therefore uses
   * `PROBE_TIMEOUT_MS`, which brings the worst case to about 11 s — see the
   * rationale on that constant. The two exceptions keep the full timeout
   * because every model answers them and the model read runs first, where a
   * link still waking up would be misread as a device with no name.
   *
   * **Why not gate the probes on the model table, as the official app does?**
   * The app never probes: it reads the model from the BLE advertisement before
   * connecting, then a per-model table decides both what is visible and what to
   * read — `ConnectViewModel.initDeviceFeatureMsg` asks exactly two things,
   * each behind a `has*Function()` guard.
   *
   * We cannot copy that safely, because our table is reverse-engineered and has
   * a proven false negative: `models.ts` records B175 as
   * `personalizedAnc: false`, yet a real CMF Headphone Pro answers
   * `GET_PERSONALIZED_ANC 0xc020` — the control appears on hardware. The app's
   * own two sources also disagree with each other (B173 has no
   * `hasSpatialAudioFunction` override but does have a `spatialAudio` entry in
   * the white list).
   *
   * The failure modes are asymmetric. Probing a feature the device lacks costs
   * 400 ms. Skipping a feature the table wrongly denies hides it, and it is
   * found only when a user notices something missing. With one device to test
   * against and 23 models in the table, that is not a bet worth taking, so the
   * table is used to *order* the probes rather than to skip them.
   *
   * **A cached capability set is a different matter.** It is not a vendor's
   * claim about a model but a record of what *this* device answered last time,
   * so reusing it skips only questions already asked and answered. Guarded on
   * the base code (the cache slot is per brand, not per device) and on the
   * firmware string (an update can add features, and a stale cache would deny
   * them forever), and only on the automatic post-connect refresh — a manual
   * Refresh re-asks everything.
   */
  async refresh(options: { trustCache?: boolean } = {}): Promise<void> {
    const client = this.#session.client;
    if (!client || this.#refreshing) return;
    this.#refreshing = true;
    try {
      // What a restored snapshot claimed, captured before the reads below
      // overwrite it. `restoreSnapshot` runs at connect, so this is last
      // session's answers for whichever device last used this brand's cache
      // slot — which is why it is validated rather than trusted.
      const cached = {
        modelBase: this.#store.state.info.modelBase,
        firmware: this.#store.state.info.firmware,
        capabilities: new Set(this.#store.state.capabilities),
      };
      /** Set once the model and firmware confirm the cache is this device's. */
      let cacheApplies = false;

      const capabilities = new Set<NothingCapability>();
      const probe = async (capability: NothingCapability, run: () => Promise<void>) => {
        // A validated cache is *empirical* — last time, this device with this
        // firmware was asked and stayed silent. Skipping that question is not
        // the same bet as skipping it because a vendor table said so.
        if (cacheApplies && !cached.capabilities.has(capability)) return;
        try {
          await run();
          capabilities.add(capability);
        } catch (error) {
          console.debug(`[nothing] ${capability} unavailable`, error);
        }
      };

      // The handshake the app treats as a connection prerequisite: it defines
      // `HEADSET_SPP_GET_PROTOCOL_VERSION_NULL` and
      // `HEADSET_SPP_SET_PROTOCOL_ACTIVATED_NULL` as *connection* errors, and
      // BudsLink opens with the same pair. Everything below works without it on
      // the hardware tested, so a failure here is logged and not fatal — but it
      // is the likeliest reason a device would push nothing.
      try {
        await client.request(C.Read.ProtocolVersion, { timeoutMs: this.#probeTimeoutMs });
        await client.write(C.Write.ActivateProtocol, []);
      } catch (error) {
        console.debug('[nothing] protocol handshake not answered', error);
      }

      // Identity first, and off the wire: a Web Serial `SerialPort` carries no
      // device name, so this read is the *only* thing that can tell a CMF
      // Headphone Pro from an Ear (3). The official app asks the same command
      // for the same reason, and decodes it the same way — the body is the
      // product id as little-endian bytes, hex-encoded (see
      // `decodeDeviceModel`). Not a capability: a model that stays silent is
      // simply unnamed, which the UI already renders.
      try {
        const payload = await client.request(C.Read.DeviceModel);
        const base = C.decodeDeviceModel(payload);
        if (base) {
          this.#patch({
            info: {
              ...this.#store.state.info,
              modelBase: base,
              // An unrecognised base code is still better than nothing.
              model: modelForBase(base)?.name ?? base,
            },
          });
        }
      } catch (error) {
        console.debug('[nothing] device model unavailable', error);
      }

      // Firmware, next: every model answers it, the model-name fallback hangs
      // off it, and together with the base code it is what decides whether a
      // cached capability set belongs to *this* device. `?? model` so a device
      // that named itself above is not un-named by a string we cannot map.
      try {
        const payload = await client.request(C.Read.Firmware);
        const firmware = C.decodeFirmware(payload);
        this.#patch({
          info: {
            ...this.#store.state.info,
            firmware,
            model: this.#modelName(firmware) ?? this.#store.state.info.model,
          },
        });
      } catch (error) {
        console.warn('[nothing] firmware read failed', error);
      }

      // Is the restored snapshot this device's? The cache slot is keyed by
      // service UUID, so it holds whichever device of this brand connected
      // last — the base code has to match. Firmware has to match too, because
      // an update can add features and a cache from before it would deny them
      // forever.
      //
      // Only the automatic post-connect refresh trusts it. A manual Refresh
      // passes nothing and re-asks everything, which is the escape hatch if a
      // feature ever goes missing.
      const info = this.#store.state.info;
      cacheApplies =
        options.trustCache === true &&
        cached.capabilities.size > 0 &&
        cached.modelBase !== null &&
        cached.modelBase === info.modelBase &&
        cached.firmware !== null &&
        cached.firmware === info.firmware;
      if (cacheApplies) {
        console.debug(
          `[nothing] reusing ${cached.capabilities.size} cached capabilities for ` +
            `${info.modelBase} ${info.firmware}`,
        );
      }

      // The colourway, which decides which product render the UI shows. Like
      // the model it is identity rather than a capability, and a device that
      // stays silent simply keeps the table's default render.
      try {
        const payload = await client.request(C.Read.ColourId, { timeoutMs: this.#probeTimeoutMs });
        const colourId = C.decodeColourId(payload);
        if (colourId) this.#patch({ info: { ...this.#store.state.info, colourId } });
      } catch (error) {
        console.debug('[nothing] colour id unavailable', error);
      }

      // Probe order is by how many models actually have each feature, counted
      // from the app's own `ear_white_list.json`: custom EQ 22/23, multipoint
      // 20/23, ANC level 21/23, ultra bass 16/23, high-quality audio 15/23,
      // spatial audio 13/23, ear detection and Dirac 8/23, find-my 5/23,
      // Audiodo 4/23. A device's real features therefore resolve first and its
      // absent ones are what trail, instead of a rare feature's timeout
      // delaying a universal one.
      //
      // Not *gated* on that data, only ordered by it. See the note above
      // `refresh`.
      // The clock, which BudsLink sets on every connect. Fire-and-forget: the
      // device never answers a write, and nothing here depends on it.
      try {
        await client.write(C.Write.SetUtcTime, C.encodeUtcTime());
      } catch (error) {
        console.debug('[nothing] could not set the clock', error);
      }

      await probe('battery', async () => {
        const payload = await client.request(C.Read.Battery, { timeoutMs: this.#probeTimeoutMs });
        this.#patch({ battery: C.decodeBattery(payload) });
      });
      await probe('anc', async () => {
        const payload = await client.request(C.Read.AncMode, { timeoutMs: this.#probeTimeoutMs });
        this.#patch({ anc: C.decodeAncMode(payload) });
      });
      await probe('eq', async () => {
        const payload = await client.request(C.Read.EqPreset, { timeoutMs: this.#probeTimeoutMs });
        this.#patch({ eqPreset: C.decodeEqPreset(payload) });
      });
      await probe('latency', async () => {
        const payload = await client.request(C.Read.LatencyMode, { timeoutMs: this.#probeTimeoutMs });
        this.#patch({ lowLatency: C.decodeLatency(payload) });
      });
      await probe('customEq', async () => {
        const payload = await client.request(C.Read.CustomEq, { timeoutMs: this.#probeTimeoutMs });
        this.#patch({ customEq: C.decodeCustomEq(payload) });
      });
      await probe('multipoint', async () => {
        const payload = await client.request(C.Read.Multipoint, { timeoutMs: this.#probeTimeoutMs });
        this.#patch({ multipoint: C.decodeSwitch(payload) });
      });
      await probe('enhancedBass', async () => {
        const payload = await client.request(C.Read.EnhancedBass, { timeoutMs: this.#probeTimeoutMs });
        this.#patch({ bassEnhance: C.decodeEnhancedBass(payload) });
      });
      await probe('lhdc', async () => {
        const payload = await client.request(C.Read.Lhdc, { timeoutMs: this.#probeTimeoutMs });
        this.#patch({ lhdc: C.decodeSwitch(payload) });
      });
      await probe('spatialAudio', async () => {
        const payload = await client.request(C.Read.SpatialAudio, { timeoutMs: this.#probeTimeoutMs });
        this.#patch({ spatialAudio: C.decodeSpatialAudio(payload) });
      });
      await probe('inEarDetection', async () => {
        const payload = await client.request(C.Read.InEarDetection, { timeoutMs: this.#probeTimeoutMs });
        this.#patch({ inEarDetection: C.decodeInEarDetection(payload) });
      });
      await probe('diracEq', async () => {
        const payload = await client.request(C.Read.DiracPreset, { timeoutMs: this.#probeTimeoutMs });
        this.#patch({ diracEq: C.decodeDiracPreset(payload) });
      });
      await probe('wearState', async () => {
        const payload = await client.request(C.Read.EarphoneStatus, { timeoutMs: this.#probeTimeoutMs });
        this.#patch({ earphoneStatus: C.decodeEarphoneStatus(payload) });
      });
      await probe('personalizedAnc', async () => {
        const payload = await client.request(C.Read.PersonalizedAnc, { timeoutMs: this.#probeTimeoutMs });
        this.#patch({ personalizedAnc: C.decodePersonalizedAnc(payload) });
      });
      await probe('gestures', async () => {
        const payload = await client.request(C.Read.Gestures, { timeoutMs: this.#probeTimeoutMs });
        this.#patch({ gestures: C.decodeGestures(payload) });
      });
      await probe('advancedEqBands', async () => {
        const payload = await client.request(C.Read.AdvancedEqBands, {
          timeoutMs: this.#probeTimeoutMs,
        });
        this.#patch({ advancedEqBands: C.decodeAdvancedEqBands(payload) });
      });

      await probe('advancedEq', async () => {
        const payload = await client.request(C.Read.AdvancedEq, { timeoutMs: this.#probeTimeoutMs });
        this.#patch({ advancedEq: C.decodeAdvancedEq(payload) });
      });
      await probe('clarityBoost', async () => {
        const payload = await client.request(C.Read.ClarityBoost, { timeoutMs: this.#probeTimeoutMs });
        this.#patch({ clarityBoost: C.decodeClarityBoost(payload) });
      });
      await probe('smartAnc', async () => {
        const payload = await client.request(C.Read.SmartAnc, { timeoutMs: this.#probeTimeoutMs });
        this.#patch({ smartAnc: C.decodeSwitch(payload) });
      });
      await probe('smartFree', async () => {
        const payload = await client.request(C.Read.SmartFree, { timeoutMs: this.#probeTimeoutMs });
        this.#patch({ smartFree: C.decodeSwitch(payload) });
      });


















      // Serial number and hardware revision. Identity rather than capability,
      // like the model and colour, so a silent device simply has neither.
      try {
        const payload = await client.request(C.Read.Configuration, { timeoutMs: this.#probeTimeoutMs });
        const values = C.decodeConfiguration(payload);
        if (values.length > 0) {
          this.#patch({
            info: {
              ...this.#store.state.info,
              serial: C.configValue(values, C.ConfigType.SerialNumber),
              hardware: C.configValue(values, C.ConfigType.HardwareVersion),
            },
          });
        }
      } catch (error) {
        console.debug('[nothing] configuration unavailable', error);
      }

      this.#patch({ capabilities });
    } finally {
      this.#refreshing = false;
    }
  }

  /** The display name, from the base code the wire (or a snapshot) supplied. */
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
  /**
   * Writes the custom EQ back.
   *
   * Takes the whole decoded structure, not three loose numbers: the payload
   * carries each band's frequency and Q as well as its gain, and those are the
   * device's own. Building the write from what was read is what keeps them.
   */
  async setCustomEq(eq: C.CustomEq): Promise<void> {
    const client = this.#session.client;
    if (!client) return;

    const previous = this.#store.state.customEq;
    this.#patch({ customEq: eq });
    try {
      await client.write(C.Write.SetEqPreset, C.encodeEqPreset(C.EqPreset.Custom));
      await client.write(C.Write.SetCustomEq, C.encodeCustomEq(eq));
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

  /**
   * Spatial audio, and head tracking with it where the model has it.
   *
   * `headTracking` is only sent when this model reported it — the official app
   * omits the byte rather than sending a zero, and a model without head
   * tracking has no state for a second byte to mean anything against.
   */
  async setSpatialAudio(enabled: boolean, headTracking?: boolean): Promise<void> {
    const client = this.#session.client;
    const previous = this.#store.state.spatialAudio;
    if (!client) return;

    const head = previous?.headTracking === null ? null : headTracking ?? previous?.headTracking ?? null;
    this.#patch({ spatialAudio: { enabled, headTracking: head } });
    try {
      await client.write(C.Write.SetSpatialAudio, C.encodeSpatialAudio(enabled, head));
    } catch (error) {
      this.#patch({ spatialAudio: previous, error: describeError(error) });
    }
  }

  /** A one-byte switch write, shared by the four features that use that shape. */
  async #setSwitch(
    key: 'multipoint' | 'smartAnc' | 'smartFree' | 'lhdc',
    command: number,
    on: boolean,
  ): Promise<void> {
    const client = this.#session.client;
    const previous = this.#store.state[key];
    if (!client) return;

    this.#patch({ [key]: on } as Partial<NothingState>);
    try {
      await client.write(command, C.encodeSwitch(on));
    } catch (error) {
      this.#patch({ [key]: previous, error: describeError(error) } as Partial<NothingState>);
    }
  }

  setMultipoint(on: boolean): Promise<void> {
    return this.#setSwitch('multipoint', C.Write.SetMultipoint, on);
  }

  setSmartAnc(on: boolean): Promise<void> {
    return this.#setSwitch('smartAnc', C.Write.SetSmartAnc, on);
  }

  setSmartFree(on: boolean): Promise<void> {
    return this.#setSwitch('smartFree', C.Write.SetSmartFree, on);
  }

  setLhdc(on: boolean): Promise<void> {
    return this.#setSwitch('lhdc', C.Write.SetLhdc, on);
  }

  async setClarityBoost(enabled: boolean, level?: number): Promise<void> {
    const client = this.#session.client;
    const previous = this.#store.state.clarityBoost;
    if (!client) return;

    const next = { enabled, level: level ?? previous?.level ?? C.ClarityLevel.Mid };
    this.#patch({ clarityBoost: next });
    try {
      await client.write(C.Write.SetClarityBoost, C.encodeClarityBoost(next.enabled, next.level));
    } catch (error) {
      this.#patch({ clarityBoost: previous, error: describeError(error) });
    }
  }

  /**
   * Writes the advanced EQ's curve back. Like the simple custom EQ this takes
   * the whole decoded structure, because the payload carries each band's
   * frequency and Q as well as its gain, and the profile index it belongs to.
   */
  async setAdvancedEqBands(eq: C.AdvancedEq): Promise<void> {
    const client = this.#session.client;
    const previous = this.#store.state.advancedEqBands;
    if (!client) return;

    this.#patch({ advancedEqBands: eq });
    try {
      await client.write(C.Write.SetAdvancedEqBands, C.encodeAdvancedEqBands(eq));
    } catch (error) {
      this.#patch({ advancedEqBands: previous, error: describeError(error) });
    }
  }

  /**
   * Starts the personalized-ANC fitting. The device runs it itself and reports
   * progress through the calibration byte of `Read.PersonalizedAnc`, so there
   * is nothing to await beyond the write landing.
   */
  async startCalibration(): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    try {
      await client.write(C.Write.StartCalibration, C.encodeStartCalibration());
    } catch (error) {
      this.#patch({ error: describeError(error) });
    }
  }

  /**
   * Restores factory settings. Destructive and irreversible on the device, so
   * the caller is responsible for confirming first — this only sends it.
   */
  async factoryReset(): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    try {
      await client.write(C.Write.FactoryReset, []);
    } catch (error) {
      this.#patch({ error: describeError(error) });
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

    // The calibration byte is the device's to report; carry it through rather
    // than inventing one for the optimistic patch.
    this.#patch({ personalizedAnc: { enabled: on, calibration: previous?.calibration ?? 0 } });
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
    // A record is keyed by all three of device, button and gesture — two
    // controls on the same bud can share a gesture id.
    const next = (previous ?? []).map((g) =>
      g.device === gesture.device && g.button === gesture.button && g.gesture === gesture.gesture
        ? gesture
        : g,
    );
    this.#patch({ gestures: next });
    try {
      await client.write(C.Write.SetGesture, C.encodeGesture(gesture));
    } catch (error) {
      this.#patch({ gestures: previous, error: describeError(error) });
    }
  }

  /** Rings the buds so they can be found. Pass `false` to stop early. */
  /**
   * Rings a bud, or the whole device on a single-body model.
   *
   * `side` is ignored on a single-body device, which has one ringer addressed
   * as `0x06`; the Ear (1) takes no side byte at all. Both come from the model
   * table, since nothing on the wire says which shape a device wants.
   */
  async ringBuds(ring: boolean, left = false): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    const model = modelForBase(this.#store.state.info.modelBase);
    const side = model?.singleBody ? 'single' : left ? 'left' : 'right';
    try {
      await client.write(
        C.Write.RingBuds,
        C.encodeRing(side, ring, { legacy: model?.ringLegacy === true }),
      );
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
