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
import type { PairedDevice } from './mdr/pairing';
import {
  PAIRING_GET,
  decodePairedDevices,
  decodePlaybackDeviceNotify,
  decodePlaybackFixed,
  encodeConnectPairedDevice,
  encodeDisconnectPairedDevice,
  encodeSetPlaybackDevice,
  encodeSetPlaybackFixed,
  encodeUnpairDevice,
  isPairedDevicesReply,
  isPlaybackDeviceNotify,
  isPlaybackFixedReply,
  pairingTypeFor,
} from './mdr/pairing';
import {
  decodeAssignable,
  encodeGetAssignable,
  encodeSetAssignable,
  isAssignableReply,
} from './mdr/assignable';
import {
  decodeVoiceGuidance,
  decodeVoiceGuidanceVolume,
  encodeSetVoiceGuidance,
  encodeSetVoiceGuidanceVolume,
  isVoiceGuidanceReply,
  isVoiceGuidanceVolumeReply,
} from './mdr/voiceGuidance';
import {
  decodeSpeakToChatConfig,
  decodeSpeakToChatEnabled,
  encodeGetSpeakToChatConfig,
  encodeGetSpeakToChatEnabled,
  encodeSetSpeakToChatConfig,
  encodeSetSpeakToChatEnabled,
  isSpeakToChatConfigReply,
  isSpeakToChatEnabledReply,
  speakToChatInquiryFor,
} from './mdr/speakToChat';
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
  /**
   * Speak-to-chat (Type 2), when the device reports the capability: whether
   * it is on, and the sensitivity/timeout it runs with. Null as a whole when
   * the device has no speak-to-chat; individual nulls when the device has the
   * toggle but not the config pair.
   */
  speakToChat: { enabled: boolean | null; sensitivity: number | null; timeout: number | null } | null;
  /** Per-side touch assignment, on earbuds that report it. */
  touchAssignment: { left: number; right: number } | null;
  /**
   * Voice guidance (voice notifications), on devices that report it — the
   * one setting that lives on the second command table. `volume` is null on
   * devices without the adjustment capability.
   */
  voiceGuidance: { enabled: boolean | null; volume: number | null } | null;
  /**
   * The headphones' own paired-device list and audio routing, when they
   * report pairing-device management. Distinct from OS pairing: this is what
   * the headphones themselves remember.
   */
  connections: {
    devices: PairedDevice[];
    playbackMac: string | null;
    playbackFixed: boolean | null;
  } | null;
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
  speakToChat: null,
  touchAssignment: null,
  voiceGuidance: null,
  connections: null,
  capabilities: new Set(),
};

/** Bumped when `captureDurable` changes shape; older caches are then dropped. */
export const SONY_SNAPSHOT_VERSION = 4;

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
  speakToChat: { enabled: boolean | null; sensitivity: number | null; timeout: number | null } | null;
  touchAssignment: { left: number; right: number } | null;
  voiceGuidance: { enabled: boolean | null; volume: number | null } | null;
  connections: { devices: PairedDevice[]; playbackMac: string | null; playbackFixed: boolean | null } | null;
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
  speakToChat: state.speakToChat,
  touchAssignment: state.touchAssignment,
  voiceGuidance: state.voiceGuidance,
  connections: state.connections,
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
    speakToChat: snapshot.speakToChat ?? null,
    touchAssignment: snapshot.touchAssignment ?? null,
    voiceGuidance: snapshot.voiceGuidance ?? null,
    connections: snapshot.connections ?? null,
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
  /** Connection-type byte the device's capabilities imply; null until read. */
  #pairingType: number | null = null;

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
          // A system notification is only pause-on-removal when its inquiry
          // byte says so; reading every one as such used to misfile a
          // speak-to-chat push into the pause toggle.
          if (payload[1] === SystemInquiryType.PlaybackControlByWearing) {
            this.#patch({ pauseOnRemoval: decodeSystemToggle(payload).on });
          } else if (isAssignableReply(payload)) {
            this.#patch({ touchAssignment: decodeAssignable(payload) });
          } else if (isSpeakToChatEnabledReply(payload)) {
            this.#patch({
              speakToChat: {
                ...(this.#store.state.speakToChat ?? { sensitivity: null, timeout: null }),
                enabled: decodeSpeakToChatEnabled(payload),
              },
            });
          }
          break;
        case 0x39:
          // Pairing/device-management notifications (table 2): the device
          // list after any connection change, the fix after its own writes.
          if (isPlaybackFixedReply(payload)) {
            this.#patch({
              connections: {
                ...(this.#store.state.connections ?? { devices: [], playbackMac: null }),
                playbackFixed: decodePlaybackFixed(payload),
              },
            });
          } else if (
            this.#pairingType !== null &&
            isPairedDevicesReply(payload, this.#pairingType)
          ) {
            const { devices, playbackMac } = decodePairedDevices(payload, this.#pairingType);
            this.#patch({
              connections: {
                ...(this.#store.state.connections ?? { playbackFixed: null }),
                devices,
                playbackMac,
              },
            });
          }
          break;
        case 0x3d:
          // The extended-param push that names the playback device outright.
          // Without it, routing moved by the phone or the headphones is only
          // noticed at the next full list read.
          if (isPlaybackDeviceNotify(payload) && this.#store.state.connections) {
            this.#patch({
              connections: {
                ...this.#store.state.connections,
                playbackMac: decodePlaybackDeviceNotify(payload),
              },
            });
          }
          break;
        case 0x49:
          // Voice guidance lives on the second command table; its notify
          // opcode is its own, not the SYSTEM family's.
          if (isVoiceGuidanceReply(payload)) {
            this.#patch({
              voiceGuidance: {
                ...(this.#store.state.voiceGuidance ?? { volume: null }),
                enabled: decodeVoiceGuidance(payload),
              },
            });
          } else if (isVoiceGuidanceVolumeReply(payload)) {
            this.#patch({
              voiceGuidance: {
                ...(this.#store.state.voiceGuidance ?? { enabled: null }),
                volume: decodeVoiceGuidanceVolume(payload),
              },
            });
          }
          break;
        case Reply.SystemExtParamNotify:
          if (isSpeakToChatConfigReply(payload)) {
            const { sensitivity, timeout } = decodeSpeakToChatConfig(payload);
            this.#patch({
              speakToChat: {
                ...(this.#store.state.speakToChat ?? { enabled: null }),
                sensitivity,
                timeout,
              },
            });
          }
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

    // Speak-to-chat: the toggle and the sensitivity/timeout pair are two
    // separate reads on two opcode pairs, gated by one capability. A device
    // that answers the toggle but not the config keeps a null config — the
    // reads are independent and each is tolerated alone.
    if (speakToChatInquiryFor(this.#store.state.capabilities) !== null) {
      this.#patch({ speakToChat: { enabled: null, sensitivity: null, timeout: null } });
      await read('speak-to-chat', async () => {
        const payload = await client.request(...(encodeGetSpeakToChatEnabled() as [number, number]));
        this.#patch({
          speakToChat: {
            ...this.#store.state.speakToChat!,
            enabled: decodeSpeakToChatEnabled(payload),
          },
        });
      });
      await read('speak-to-chat config', async () => {
        const payload = await client.request(...(encodeGetSpeakToChatConfig() as [number, number]));
        const { sensitivity, timeout } = decodeSpeakToChatConfig(payload);
        this.#patch({ speakToChat: { ...this.#store.state.speakToChat!, sensitivity, timeout } });
      });
    }

    // Per-side touch assignment, on its own reported capability (with the
    // limited variant folded in — same inquiry, same shape).
    if (has(SonyFunction.AssignableSetting) || has(SonyFunction.AssignableSettingWithLimitation)) {
      await read('touch assignment', async () => {
        const payload = await client.request(...(encodeGetAssignable() as [number, number]));
        this.#patch({ touchAssignment: decodeAssignable(payload) });
      });
    }

    // Voice guidance — table 2, so every request and write below carries
    // `table: 2`. Any of the guidance capabilities opens the on/off read;
    // only the volume-capable one opens the volume read.
    const guidanceCapable =
      has(SonyFunction.VoiceGuidanceWithLanguageSwitch) ||
      has(SonyFunction.VoiceGuidanceOnOffOnly) ||
      has(SonyFunction.VoiceGuidanceWithVolume);
    if (guidanceCapable) {
      this.#patch({ voiceGuidance: { enabled: null, volume: null } });
      await read('voice guidance', async () => {
        const payload = await client.request(0x46, 0x03, { table: 2 });
        this.#patch({
          voiceGuidance: {
            ...this.#store.state.voiceGuidance!,
            enabled: decodeVoiceGuidance(payload),
          },
        });
      });
      if (has(SonyFunction.VoiceGuidanceWithVolume)) {
        await read('voice guidance volume', async () => {
          const payload = await client.request(0x46, 0x20, { table: 2 });
          this.#patch({
            voiceGuidance: {
              ...this.#store.state.voiceGuidance!,
              volume: decodeVoiceGuidanceVolume(payload),
            },
          });
        });
      }
    }

    // The headphones' own paired-device list and routing (table 2). The list
    // read needs the device's connection type; the routing fix rides the
    // source-switch capability.
    this.#pairingType = pairingTypeFor(this.#store.state.capabilities);
    if (this.#pairingType !== null) {
      this.#patch({ connections: { devices: [], playbackMac: null, playbackFixed: null } });
      await read('paired devices', async () => {
        const payload = await client.request(PAIRING_GET, this.#pairingType!, { table: 2 });
        const { devices, playbackMac } = decodePairedDevices(payload, this.#pairingType!);
        this.#patch({
          connections: { ...this.#store.state.connections!, devices, playbackMac },
        });
      });
      if (has(0x31)) {
        await read('playback fix', async () => {
          const payload = await client.request(PAIRING_GET, 0x01, { table: 2 });
          this.#patch({
            connections: {
              ...this.#store.state.connections!,
              playbackFixed: decodePlaybackFixed(payload),
            },
          });
        });
      }
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

  async setSpeakToChatEnabled(on: boolean): Promise<void> {
    const client = this.#session.client;
    const current = this.#store.state.speakToChat;
    if (!client) return;

    this.#patch({
      speakToChat: { ...(current ?? { sensitivity: null, timeout: null }), enabled: on },
    });
    try {
      await client.write(encodeSetSpeakToChatEnabled(on));
    } catch (error) {
      this.#patch({ speakToChat: current, error: describeError(error) });
    }
  }

  async setPairedDeviceConnected(mac: string, connected: boolean): Promise<void> {
    const client = this.#session.client;
    const type = this.#pairingType;
    if (!client || type === null) return;
    try {
      await client.write(
        connected ? encodeConnectPairedDevice(type, mac) : encodeDisconnectPairedDevice(type, mac),
        { table: 2 },
      );
    } catch (error) {
      this.#patch({ error: describeError(error) });
    }
    // The list arrives as a notification after the device acts; no echo to
    // optimistically patch against.
  }

  async unpairDevice(mac: string): Promise<void> {
    const client = this.#session.client;
    const type = this.#pairingType;
    if (!client || type === null) return;
    try {
      await client.write(encodeUnpairDevice(type, mac), { table: 2 });
    } catch (error) {
      this.#patch({ error: describeError(error) });
    }
  }

  async setPlaybackDevice(mac: string): Promise<void> {
    const client = this.#session.client;
    const current = this.#store.state.connections;
    if (!client) return;

    this.#patch({ connections: { ...current!, playbackMac: mac } });
    try {
      await client.write(encodeSetPlaybackDevice(mac), { table: 2 });
    } catch (error) {
      this.#patch({ connections: current, error: describeError(error) });
    }
  }

  async setPlaybackFixed(enabled: boolean): Promise<void> {
    const client = this.#session.client;
    const current = this.#store.state.connections;
    if (!client) return;

    this.#patch({ connections: { ...current!, playbackFixed: enabled } });
    try {
      await client.write(encodeSetPlaybackFixed(enabled), { table: 2 });
    } catch (error) {
      this.#patch({ connections: current, error: describeError(error) });
    }
  }

  async setVoiceGuidance(enabled: boolean): Promise<void> {
    const client = this.#session.client;
    const current = this.#store.state.voiceGuidance;
    if (!client) return;

    this.#patch({ voiceGuidance: { ...(current ?? { volume: null }), enabled } });
    try {
      await client.write(encodeSetVoiceGuidance(enabled), { table: 2 });
    } catch (error) {
      this.#patch({ voiceGuidance: current, error: describeError(error) });
    }
  }

  async setVoiceGuidanceVolume(level: number): Promise<void> {
    const client = this.#session.client;
    const current = this.#store.state.voiceGuidance;
    if (!client) return;

    this.#patch({ voiceGuidance: { ...(current ?? { enabled: null }), volume: level } });
    try {
      await client.write(encodeSetVoiceGuidanceVolume(level), { table: 2 });
    } catch (error) {
      this.#patch({ voiceGuidance: current, error: describeError(error) });
    }
  }

  async setTouchAssignment(left: number, right: number): Promise<void> {
    const client = this.#session.client;
    const previous = this.#store.state.touchAssignment;
    if (!client) return;

    this.#patch({ touchAssignment: { left, right } });
    try {
      await client.write(encodeSetAssignable(left, right));
    } catch (error) {
      this.#patch({ touchAssignment: previous, error: describeError(error) });
    }
  }

  async setSpeakToChatConfig(sensitivity: number, timeout: number): Promise<void> {
    const client = this.#session.client;
    const current = this.#store.state.speakToChat;
    if (!client) return;

    this.#patch({
      speakToChat: { ...(current ?? { enabled: null }), sensitivity, timeout },
    });
    try {
      await client.write(encodeSetSpeakToChatConfig(sensitivity, timeout));
    } catch (error) {
      this.#patch({ speakToChat: current, error: describeError(error) });
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
