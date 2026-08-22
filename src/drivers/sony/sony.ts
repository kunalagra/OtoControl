/**
 * Sony device orchestration.
 *
 * The shape mirrors `MomentumDevice` — subscribe, refresh, connect — but
 * polling is gated on the capability table the device reports, rather than
 * attempting everything and tolerating failures.
 *
 * That matters more here than on GAIA: an unsupported Sony query is
 * acknowledged and then ignored, so asking blindly costs a full timeout each.
 * (GAIA has its own capability query, `Core_GetSupportedFeatures`, which the
 * Sennheiser side does not yet use — it errors promptly instead.)
 */

import {
  BatteryType,
  Command,
  DeviceInfoType,
  EqInquiryType,
  Reply,
  SonyFunction,
  StatusType,
  decodeDeviceInfoText,
  decodeDualBattery,
  decodeEq,
  decodeSeriesAndColour,
  decodeSingleBattery,
  decodeSupportedFunctions,
  decodeCodec,
  decodeUpscaling,
  AudioInquiredType,
  encodeConnectionMode,
  encodeEqBands,
  encodeEqPreset,
  encodePowerOff,
  encodeUpscaling,
  decodeConnectionMode,
  decodeUpscalingSetting,
} from './mdr/commands';
import type { BatteryLevel, DualBattery, EqSettings, SeriesAndColour } from './mdr/commands';
import { MdrClient } from './mdr/client';
import {
  decodeNoise,
  encodeNoise,
  inquiryTypeFor,
  isNoiseReply,
  supportsNoiseVariant,
} from './mdr/noise';
import type { NoiseSettings } from './mdr/noise';
import {
  SystemInquiryType,
  decodeAutoPowerOff,
  decodeSystemToggle,
  encodeAutoPowerOff,
  encodeGetAutoPowerOff,
  encodeGetSystemToggle,
  encodeSystemToggle,
} from './mdr/settings';
import type { Persistable, SnapshotPayload } from '@/core/persistence';
import type { FrameListener } from './mdr/client';
import { isUnreachable, isWebSerialSupported, openSerialTransport, requestPort } from '@/core/transport';
import type { ConnectionTarget } from '@/core/transport';
import { isBluetoothTarget } from '@/core/transport';
import type { TransportOpener } from '@/core/transport';
import { DeviceSession } from '@/core/session';
import type { SessionHooks } from '@/core/session';
import { StateStore } from '@/core/stateStore';
import type { StateStoreHooks } from '@/core/stateStore';
import { describeError } from '@/core/errors';
import type { ConnectionStatus } from '@/core/connection';

export interface SonyInfo {
  model: string | null;
  firmware: string | null;
  colour: SeriesAndColour | null;
}

export interface SonyState {
  status: ConnectionStatus;
  error: string | null;
  info: SonyInfo;
  /** Present when the device reports per-earbud levels. */
  battery: DualBattery | null;
  /** Present when the device reports a single level instead. */
  singleBattery: BatteryLevel | null;
  caseBattery: BatteryLevel | null;
  codec: number | null;
  /** The DSEE setting. Not the same as whether upscaling is active now. */
  upscaling: boolean | null;
  /** Sound-quality vs connection-stability priority. */
  connectionMode: number | null;
  eq: EqSettings | null;
  /** Noise cancelling and ambient sound, when the device has them. */
  noise: NoiseSettings | null;
  /**
   * Which NC/ASM message variant this device speaks, or null if it has none.
   * Non-null with `noise` still null means the device has noise control that
   * this app cannot drive yet.
   */
  noiseVariant: number | null;
  /** Idle timeout before the device powers itself off. */
  autoPowerOff: number | null;
  /** Pause playback when the headphones come off, resume when put back on. */
  pauseOnRemoval: boolean | null;
  /** Function IDs the device reported. Empty until connected. */
  capabilities: Set<number>;
}

export const initialSonyState: SonyState = {
  status: 'disconnected',
  error: null,
  info: { model: null, firmware: null, colour: null },
  battery: null,
  singleBattery: null,
  caseBattery: null,
  codec: null,
  upscaling: null,
  connectionMode: null,
  eq: null,
  noise: null,
  noiseVariant: null,
  autoPowerOff: null,
  pauseOnRemoval: null,
  capabilities: new Set(),
};

/** Bumped when `captureDurable` changes shape; older caches are then dropped. */
export const SONY_SNAPSHOT_VERSION = 2;

/**
 * The settings worth remembering between sessions.
 *
 * Same split as the Sennheiser side, reached independently: identity and
 * settings persist, live readings do not. Battery and codec change while the
 * app is closed, so caching them would state something about the present that
 * a cache cannot support.
 */
export interface SonyDurableState {
  info: SonyInfo;
  upscaling: boolean | null;
  connectionMode: number | null;
  eq: EqSettings | null;
  autoPowerOff: number | null;
  pauseOnRemoval: boolean | null;
  /** A Set on the state; an array here, because JSON has no Set. */
  capabilities: number[];
}

export const captureDurable = (state: SonyState): SonyDurableState => ({
  info: state.info,
  upscaling: state.upscaling,
  connectionMode: state.connectionMode,
  eq: state.eq,
  autoPowerOff: state.autoPowerOff,
  pauseOnRemoval: state.pauseOnRemoval,
  capabilities: [...state.capabilities],
});

/**
 * Cast rather than validated field by field: the payload is version-gated and
 * written by this same module, so a mismatch means a bug here, not bad input.
 */
export const applyDurable = (payload: object): Partial<SonyState> => {
  const snapshot = payload as SonyDurableState;
  return {
    info: snapshot.info,
    upscaling: snapshot.upscaling,
    connectionMode: snapshot.connectionMode,
    eq: snapshot.eq,
    autoPowerOff: snapshot.autoPowerOff ?? null,
    pauseOnRemoval: snapshot.pauseOnRemoval ?? null,
    capabilities: new Set(snapshot.capabilities),
  };
};

type Listener = (state: SonyState) => void;

/** The store's driver-specific half: how this brand decides "unread"/"connected" and captures/applies its durable slice. */
const stateStoreHooks: StateStoreHooks<SonyState> = {
  isUnread: (state) => state.info.model === null,
  isConnected: (state) => state.status === 'connected',
  capture: captureDurable,
  apply: (_state, payload) => applyDurable(payload),
};

export class SonyDevice implements Persistable {
  readonly #store: StateStore<SonyState>;
  readonly #session: DeviceSession<MdrClient>;
  #refreshing = false;

  constructor(openTransport: TransportOpener = openSerialTransport) {
    this.#store = new StateStore(
      { ...initialSonyState, status: isWebSerialSupported() ? 'disconnected' : 'unsupported' },
      stateStoreHooks,
    );

    const hooks: SessionHooks<MdrClient> = {
      createClient: (transport) => new MdrClient(transport),
      handleData: (client, chunk) => client.handleData(chunk),
      wire: (client) => {
        client.onNotification((frame) => this.#onNotification(frame));
      },
      onStatus: (status, error) => this.#patch({ status, error }),
      onDrop: (reason) =>
        this.#patch({
          ...initialSonyState,
          status: 'disconnected',
          error: reason ? describeError(reason) : null,
        }),
      abort: (client, reason) => client.abort(reason),
    };
    this.#session = new DeviceSession(openTransport, hooks);
  }

  get state(): SonyState {
    return this.#store.state;
  }

  // --- Persistable --------------------------------------------------------

  readonly snapshotVersion = SONY_SNAPSHOT_VERSION;

  /** Durable settings as plain JSON, or null when there is nothing to save yet. */
  snapshot(): SnapshotPayload | null {
    return this.#store.snapshot();
  }

  /**
   * Seeds last-known settings so the UI has something real to show before the
   * earbuds are reachable. See `StateStore.restore` for why this is ignored
   * once connected — the device wins.
   */
  restore(payload: SnapshotPayload): void {
    this.#store.restore(payload);
  }

  subscribe(listener: Listener): () => void {
    return this.#store.subscribe(listener);
  }

  /** Frame-level tap for the debug console. Survives reconnects. */
  onFrame(listener: FrameListener): () => void {
    return this.#session.attach((client) => client.onFrame(listener));
  }

  supports(fn: number): boolean {
    return this.#store.state.capabilities.has(fn);
  }

  #patch(partial: Partial<SonyState>): void {
    this.#store.patch(partial);
  }

  async autoConnect(): Promise<boolean> {
    if (!isWebSerialSupported()) return false;
    // Only reconnect silently to a device this class can actually drive.
    const port = await DeviceSession.grantedPortFor('sony');
    if (!port) return false;
    try {
      await this.#connectTo(port);
      return true;
    } catch {
      this.#patch({ status: 'disconnected' });
      return false;
    }
  }

  /**
   * Takes over a port the caller already obtained. Used when something else
   * showed the picker and resolved which brand the device is.
   */
  async adoptPort(port: ConnectionTarget): Promise<void> {
    // Serial-only driver: a Bluetooth LE device has no RFCOMM port to adopt.
    if (isBluetoothTarget(port)) {
      this.#patch({ status: 'disconnected', error: 'This device speaks serial, not Bluetooth LE.' });
      return;
    }
    try {
      await this.#connectTo(port);
    } catch (error) {
      this.#patch({ status: 'disconnected', error: isUnreachable(error) ? null : describeError(error) });
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

  async #connectTo(port: SerialPort): Promise<void> {
    // Unlike Sennheiser, there is no subscribe step — Sony's post-connect
    // sequence is just the poll. That difference is exactly what the session
    // does not need to know about.
    await this.#session.connectTo(port, async () => {
      await this.refresh();
    });
  }

  /**
   * Applies an unsolicited state change.
   *
   * Sony pushes these after a SET and when something changes on the device, so
   * this is how a write is confirmed and how physical changes reach the UI.
   */
  #onNotification(frame: { payload: Uint8Array }): void {
    const payload = frame.payload;
    if (payload.length === 0) return;

    try {
      switch (payload[0]) {
        case Reply.EqNotify:
          this.#patch({ eq: decodeEq(payload) });
          break;
        case Reply.SystemParamNotify:
          this.#patch({ pauseOnRemoval: decodeSystemToggle(payload).on });
          break;
        case Reply.PowerParamNotify:
          this.#patch({ autoPowerOff: decodeAutoPowerOff(payload) });
          break;
        case Reply.NcAsmNotify:
          // Pressing the button on the headphones must move the control here.
          if (isNoiseReply(payload)) this.#patch({ noise: decodeNoise(payload) });
          break;
        case Reply.PowerStatusNotify:
          if (payload[1] === BatteryType.Dual) {
            this.#patch({ battery: decodeDualBattery(payload) });
          } else if (payload[1] === BatteryType.Case) {
            this.#patch({ caseBattery: decodeSingleBattery(payload) });
          } else {
            this.#patch({ singleBattery: decodeSingleBattery(payload) });
          }
          break;
        case Reply.StatusNotify:
          if (payload[1] === StatusType.Codec) this.#patch({ codec: decodeCodec(payload) });
          else if (payload[1] === StatusType.Upscaling) {
            this.#patch({ upscaling: decodeUpscaling(payload) });
          }
          break;
        default:
          break;
      }
    } catch (error) {
      // A malformed notification should never take the UI down.
      console.warn('[sony] could not decode a notification', error);
    }
  }

  /**
   * Handshake then capability-gated polling.
   *
   * Protocol info first — the device will not service feature queries until it
   * has been asked — then the capability table, then only what that table says
   * exists.
   */
  async refresh(): Promise<void> {
    const client = this.#session.client;
    if (!client || this.#refreshing) return;
    this.#refreshing = true;
    try {
      await this.#handshake(client);
      await this.#readFeatures(client);
    } finally {
      this.#refreshing = false;
    }
  }

  async #handshake(client: MdrClient): Promise<void> {
    const read = async (label: string, run: () => Promise<void>) => {
      try {
        await run();
      } catch (error) {
        console.warn(`[sony] ${label} failed`, error);
      }
    };

    await read('protocol info', async () => {
      await client.request(Command.GetProtocolInfo, 0x00);
    });

    await read('model name', async () => {
      const payload = await client.request(Command.GetDeviceInfo, DeviceInfoType.ModelName);
      this.#patch({ info: { ...this.#store.state.info, model: decodeDeviceInfoText(payload) } });
    });

    await read('firmware', async () => {
      const payload = await client.request(Command.GetDeviceInfo, DeviceInfoType.FirmwareVersion);
      this.#patch({ info: { ...this.#store.state.info, firmware: decodeDeviceInfoText(payload) } });
    });

    await read('series and colour', async () => {
      const payload = await client.request(Command.GetDeviceInfo, DeviceInfoType.SeriesAndColour);
      this.#patch({ info: { ...this.#store.state.info, colour: decodeSeriesAndColour(payload) } });
    });

    await read('supported functions', async () => {
      const payload = await client.request(Command.GetSupportFunction, 0x00);
      this.#patch({ capabilities: decodeSupportedFunctions(payload) });
    });
  }

  async #readFeatures(client: MdrClient): Promise<void> {
    const has = (fn: number) => this.#store.state.capabilities.has(fn);

    const read = async (label: string, run: () => Promise<void>) => {
      try {
        await run();
      } catch (error) {
        console.warn(`[sony] ${label} failed`, error);
      }
    };

    if (has(SonyFunction.LeftRightBatteryLevel)) {
      await read('dual battery', async () => {
        const payload = await client.request(Command.GetPowerStatus, BatteryType.Dual);
        this.#patch({ battery: decodeDualBattery(payload) });
      });
    } else if (has(SonyFunction.BatteryLevel)) {
      await read('battery', async () => {
        const payload = await client.request(Command.GetPowerStatus, BatteryType.Single);
        this.#patch({ singleBattery: decodeSingleBattery(payload) });
      });
    }

    if (has(SonyFunction.CaseBatteryLevel)) {
      await read('case battery', async () => {
        const payload = await client.request(Command.GetPowerStatus, BatteryType.Case);
        this.#patch({ caseBattery: decodeSingleBattery(payload) });
      });
    }

    if (has(SonyFunction.CodecIndicator)) {
      await read('codec', async () => {
        const payload = await client.request(Command.GetStatus, StatusType.Codec);
        this.#patch({ codec: decodeCodec(payload) });
      });
    }

    // The toggle is gated on UPSCALING_AUTO_OFF; UPSCALING_INDICATOR is only a
    // read-only "upscaling right now" badge and is a different capability.
    if (has(SonyFunction.UpscalingAutoOff)) {
      await read('DSEE setting', async () => {
        const payload = await client.request(
          Command.GetAudioParam,
          AudioInquiredType.Upscaling,
        );
        this.#patch({ upscaling: decodeUpscalingSetting(payload) });
      });
    } else if (has(SonyFunction.UpscalingIndicator)) {
      await read('upscaling indicator', async () => {
        const payload = await client.request(Command.GetStatus, StatusType.Upscaling);
        this.#patch({ upscaling: decodeUpscaling(payload) });
      });
    }

    if (has(SonyFunction.ConnectionQualityMode)) {
      await read('connection mode', async () => {
        const payload = await client.request(
          Command.GetAudioParam,
          AudioInquiredType.ConnectionMode,
        );
        this.#patch({ connectionMode: decodeConnectionMode(payload) });
      });
    }

    if (has(SonyFunction.PresetEq)) {
      await read('equaliser', async () => {
        const payload = await client.request(Command.GetEq, EqInquiryType.PresetEq);
        this.#patch({ eq: decodeEq(payload) });
      });
    }

    if (has(SonyFunction.AutoPowerOff)) {
      await read('auto power off', async () => {
        const payload = await client.request(...(encodeGetAutoPowerOff() as [number, number]));
        this.#patch({ autoPowerOff: decodeAutoPowerOff(payload) });
      });
    }

    if (has(SonyFunction.PauseOnRemoval)) {
      await read('pause on removal', async () => {
        const payload = await client.request(
          ...(encodeGetSystemToggle(SystemInquiryType.PlaybackControlByWearing) as [number, number]),
        );
        this.#patch({ pauseOnRemoval: decodeSystemToggle(payload).on });
      });
    }

    // Which NC/ASM variant this model speaks comes from its own capability
    // table, never from the model name — see `src/drivers/sony/mdr/noise.ts`.
    const variant = inquiryTypeFor(this.#store.state.capabilities);
    this.#patch({ noiseVariant: variant });
    if (supportsNoiseVariant(variant)) {
      await read('noise control', async () => {
        const payload = await client.request(Command.GetNcAsm, variant!);
        this.#patch({ noise: decodeNoise(payload) });
      });
    }
  }

  // --- writes -------------------------------------------------------------

  /**
   * Applies band gains, keeping whatever preset the device last reported.
   *
   * The app sends the active preset id alongside the curve rather than forcing
   * a "custom" id, so a device that has no custom slot still accepts the edit.
   */
  async setEqGains(gains: number[]): Promise<void> {
    const client = this.#session.client;
    const previous = this.#store.state.eq;
    if (!client || !previous) return;

    this.#patch({ eq: { ...previous, gains } });
    try {
      // The device acknowledges a SET and then reports the result as a
      // notification; it never sends a RET, so waiting for one times out.
      await client.write(encodeEqBands(previous.preset, gains));
      await this.#readEq(client);
    } catch (error) {
      this.#patch({ eq: previous, error: describeError(error) });
    }
  }

  async setEqPreset(preset: number): Promise<void> {
    const client = this.#session.client;
    const previous = this.#store.state.eq;
    if (!client || !previous) return;

    this.#patch({ eq: { ...previous, preset } });
    try {
      // Preset changes carry no band steps — see `encodeEqPreset`. The device
      // answers with the curve the preset selected, which `#readEq` picks up.
      await client.write(encodeEqPreset(preset));
      await this.#readEq(client);
    } catch (error) {
      this.#patch({ eq: previous, error: describeError(error) });
    }
  }

  /**
   * Applies a noise-control change.
   *
   * `patch` is merged onto the last reading rather than replacing it, because
   * every variant needs its whole body written back — changing the ambient
   * level still has to restate the mode, and vice versa.
   */
  async setNoise(patch: Partial<NoiseSettings>): Promise<void> {
    const client = this.#session.client;
    const previous = this.#store.state.noise;
    if (!client || !previous) return;

    const next = { ...previous, ...patch };
    this.#patch({ noise: next });
    try {
      // Like every Sony SET, this is acknowledged and then confirmed by a
      // notification; there is no RET to wait for.
      await client.write(encodeNoise(next));
    } catch (error) {
      this.#patch({ noise: previous, error: describeError(error) });
    }
  }

  /** Sets the idle timeout before the device switches itself off. */
  async setAutoPowerOff(value: number): Promise<void> {
    const client = this.#session.client;
    const previous = this.#store.state.autoPowerOff;
    if (!client) return;

    this.#patch({ autoPowerOff: value });
    try {
      await client.write(encodeAutoPowerOff(value));
    } catch (error) {
      this.#patch({ autoPowerOff: previous, error: describeError(error) });
    }
  }

  /** Pause when the headphones come off; resume when they go back on. */
  async setPauseOnRemoval(on: boolean): Promise<void> {
    const client = this.#session.client;
    const previous = this.#store.state.pauseOnRemoval;
    if (!client) return;

    this.#patch({ pauseOnRemoval: on });
    try {
      await client.write(encodeSystemToggle(SystemInquiryType.PlaybackControlByWearing, on));
    } catch (error) {
      this.#patch({ pauseOnRemoval: previous, error: describeError(error) });
    }
  }

  /**
   * Turns DSEE upscaling on or off.
   *
   * Set through the audio-param family and read back through the status
   * indicator, which is how the official app does it — the two are asymmetric.
   */
  async setUpscaling(enabled: boolean): Promise<void> {
    const client = this.#session.client;
    if (!client) return;

    const previous = this.#store.state.upscaling;
    this.#patch({ upscaling: enabled });
    try {
      await client.write(encodeUpscaling(enabled));
      const payload = await client.request(
        Command.GetAudioParam,
        AudioInquiredType.Upscaling,
      );
      this.#patch({ upscaling: decodeUpscalingSetting(payload) });
    } catch (error) {
      this.#patch({ upscaling: previous, error: describeError(error) });
    }
  }

  async setConnectionMode(mode: number): Promise<void> {
    const client = this.#session.client;
    if (!client) return;

    const previous = this.#store.state.connectionMode;
    this.#patch({ connectionMode: mode });
    try {
      await client.write(encodeConnectionMode(mode));
      const payload = await client.request(
        Command.GetAudioParam,
        AudioInquiredType.ConnectionMode,
      );
      this.#patch({ connectionMode: decodeConnectionMode(payload) });
    } catch (error) {
      this.#patch({ connectionMode: previous, error: describeError(error) });
    }
  }

  /**
   * Powers the earbuds off.
   *
   * Fire-and-forget by design — the protocol offers no readback, and the link
   * dropping is the only confirmation. The caller should expect a disconnect.
   */
  async powerOff(): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    try {
      await client.write(encodePowerOff());
    } catch (error) {
      // A dropped link mid-write is the expected outcome, not a failure.
      console.warn('[sony] power off did not acknowledge', error);
    }
  }

  /** Re-reads the equaliser, so the UI reflects what the device settled on. */
  async #readEq(client: MdrClient): Promise<void> {
    try {
      const payload = await client.request(Command.GetEq, EqInquiryType.PresetEq);
      this.#patch({ eq: decodeEq(payload) });
    } catch (error) {
      console.warn('[sony] could not re-read the equaliser', error);
    }
  }

  async sendRaw(frame: Uint8Array): Promise<void> {
    await this.#session.client?.sendRaw(frame);
  }

  // --- teardown -----------------------------------------------------------
  //
  // An unexpected drop is reported through the session's `onDrop` hook (see
  // the constructor) rather than a method here — the session owns the
  // transport and client, so it is the one that knows a drop happened.
  // `disconnect()` is the one teardown path that starts on this side, since
  // it is the device that decides to end the session.

  async disconnect(): Promise<void> {
    const closed = this.#session.disconnect();
    this.#patch({ ...initialSonyState, status: 'disconnected' });
    await closed;
  }
}
