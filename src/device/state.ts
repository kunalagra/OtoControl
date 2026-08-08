/**
 * Device state and the pure reduction of incoming frames onto it.
 *
 * The headphones are the source of truth: every value here arrives from a poll
 * response or an async notification. The UI may show an optimistic value while
 * a set command is in flight, but a notification always overrides it — pressing
 * a button on the headphone must move the control on screen.
 */

import {
  EQ_NOTIFICATION,
  decodeEqGains,
  getAncEnabled,
  getAncModes,
  getAudioMode,
  getAudioPromptMode,
  getAutoAnswer,
  getBassBoost,
  getBattery,
  getBluetoothCompatibility,
  getChargingStatus,
  getCodec,
  getConnectionStatus,
  getComfortCall,
  getEqBand,
  getEqConfig,
  getLowLatency,
  getOnHeadDetection,
  getPhysicalDeviceState,
  getSidetone,
  getSmartPause,
  getTouchControls,
  getTransparencyLevel,
  getTransparentHearing,
  setAutoAnswer,
  setBassBoost,
  setBluetoothCompatibility,
  setComfortCall,
  setLowLatency,
  setOnHeadDetection,
  setSmartPause,
  setTouchControls,
} from '../gaia/commands';
import type { AncModes, Command, EqConfig, PairedDevice } from '../gaia/commands';
import type { GaiaFrame } from '../gaia/frame';
import { requestIdFor } from '../gaia/frame';

export type ConnectionStatus =
  | 'unsupported'
  | 'disconnected'
  | 'connecting'
  | 'connected';

export interface DeviceInfo {
  model: string | null;
  firmware: string | null;
  serial: string | null;
  codec: number | null;
}

export interface NoiseState {
  ancEnabled: boolean | null;
  transparentHearing: boolean | null;
  transparencyLevel: number | null;
  modes: AncModes | null;
}

export type ToggleKey =
  | 'bassBoost'
  | 'smartPause'
  | 'onHeadDetection'
  | 'autoAnswer'
  | 'comfortCall'
  | 'lowLatency'
  | 'bluetoothCompatibility'
  | 'touchControls';

/** Which card a toggle is rendered in. */
export type ToggleGroup = 'sound' | 'behaviour';

export interface DeviceState {
  status: ConnectionStatus;
  error: string | null;
  info: DeviceInfo;
  battery: number | null;
  charging: boolean | null;
  noise: NoiseState;
  toggles: Record<ToggleKey, boolean | null>;
  sidetone: number | null;
  audioPrompts: number | null;
  /** Which sound processing is active; the manual EQ only applies in Equalizer. */
  audioMode: number | null;
  /** Auto power off, in seconds. 0 is assumed to mean never. */
  powerOffSeconds: number | null;
  /** In case / off head / on head, from PhysicalDevice_State. */
  wearState: number | null;
  /**
   * Feature IDs to versions, from Core_GetSupportedFeatures.
   *
   * Reported by the device, but polling is still driven by the hardcoded
   * command table — the ID namespace here is GAIA core's, and whether it lines
   * up with Sennheiser's vendor feature IDs is not established.
   */
  supportedFeatures: Map<number, number> | null;
  /** GAIA protocol version, `[major, minor]`. */
  apiVersion: number[] | null;
  eq: EqState;
  connections: ConnectionsState;
}

export interface ConnectionsState {
  /** Sorted by index. Empty until the list has been read. */
  devices: PairedDevice[];
  /** How many devices may be connected at once (multipoint). */
  maxConnections: number | null;
  /** Which entry is this machine, so the UI can label and protect it. */
  ownIndex: number | null;
}

export interface EqState {
  /** Band count and gain range, read from the device rather than assumed. */
  config: EqConfig | null;
  /** Gain per band, in dB. Sparse until every band has been read. */
  gains: Array<number | undefined>;
}

export const initialState: DeviceState = {
  status: 'disconnected',
  error: null,
  info: { model: null, firmware: null, serial: null, codec: null },
  battery: null,
  charging: null,
  noise: {
    ancEnabled: null,
    transparentHearing: null,
    transparencyLevel: null,
    modes: null,
  },
  toggles: {
    bassBoost: null,
    smartPause: null,
    onHeadDetection: null,
    autoAnswer: null,
    comfortCall: null,
    lowLatency: null,
    bluetoothCompatibility: null,
    touchControls: null,
  },
  sidetone: null,
  audioPrompts: null,
  audioMode: null,
  powerOffSeconds: null,
  wearState: null,
  supportedFeatures: null,
  apiVersion: null,
  eq: { config: null, gains: [] },
  connections: { devices: [], maxConnections: null, ownIndex: null },
};

// --- persistence ----------------------------------------------------------

/** Bumped when `captureDurable` changes shape; older caches are then dropped. */
export const SNAPSHOT_VERSION = 1;

/**
 * The settings worth remembering between sessions.
 *
 * The split is the point: **identity and settings are durable, live readings
 * are not.** `battery`, `charging`, `wearState` and the negotiated `codec` all
 * change while the app is closed, so a remembered value would be a claim about
 * the present that a cache cannot support. A stale EQ curve is merely out of
 * date; a stale "87%" is wrong. `status` and `error` describe the connection,
 * which by definition does not survive one.
 */
export interface DurableState {
  info: Omit<DeviceInfo, 'codec'>;
  noise: NoiseState;
  toggles: Record<ToggleKey, boolean | null>;
  sidetone: number | null;
  audioPrompts: number | null;
  audioMode: number | null;
  powerOffSeconds: number | null;
  /** A Map on the state; pairs here, because JSON has no Map. */
  supportedFeatures: Array<[number, number]> | null;
  apiVersion: number[] | null;
  eq: EqState;
}

export const captureDurable = (state: DeviceState): DurableState => ({
  info: { model: state.info.model, firmware: state.info.firmware, serial: state.info.serial },
  noise: state.noise,
  toggles: state.toggles,
  sidetone: state.sidetone,
  audioPrompts: state.audioPrompts,
  audioMode: state.audioMode,
  powerOffSeconds: state.powerOffSeconds,
  supportedFeatures: state.supportedFeatures === null ? null : [...state.supportedFeatures],
  apiVersion: state.apiVersion,
  eq: state.eq,
});

/**
 * Turns a durable snapshot back into a state patch.
 *
 * Cast rather than validated field by field: the payload is version-gated and
 * written by this same module, so a mismatch means a bug here, not bad input.
 * `codec` is read from the current state because it is negotiated per
 * connection and so belongs to the live state, not the cache.
 */
export function applyDurable(current: DeviceState, payload: object): Partial<DeviceState> {
  const snapshot = payload as DurableState;
  return {
    info: { ...snapshot.info, codec: current.info.codec },
    noise: snapshot.noise,
    toggles: snapshot.toggles,
    sidetone: snapshot.sidetone,
    audioPrompts: snapshot.audioPrompts,
    audioMode: snapshot.audioMode,
    powerOffSeconds: snapshot.powerOffSeconds,
    supportedFeatures:
      snapshot.supportedFeatures === null ? null : new Map(snapshot.supportedFeatures),
    apiVersion: snapshot.apiVersion,
    eq: snapshot.eq,
  };
}

/**
 * The boolean settings, described once so the UI can render them generically
 * and the connect sequence can poll them in a loop.
 */
export interface ToggleSpec {
  key: ToggleKey;
  group: ToggleGroup;
  label: string;
  description: string;
  get: Command<void, boolean>;
  set: Command<boolean, void>;
}

export const TOGGLES: ToggleSpec[] = [
  {
    key: 'bassBoost',
    group: 'sound',
    label: 'Bass boost',
    description: 'Lifts the low end.',
    get: getBassBoost,
    set: setBassBoost,
  },
  {
    key: 'smartPause',
    group: 'behaviour',
    label: 'Smart pause',
    description: 'Pause playback when you take the headphones off.',
    get: getSmartPause,
    set: setSmartPause,
  },
  {
    key: 'onHeadDetection',
    group: 'behaviour',
    label: 'On-head detection',
    description: 'Required for smart pause to work.',
    get: getOnHeadDetection,
    set: setOnHeadDetection,
  },
  {
    key: 'autoAnswer',
    group: 'behaviour',
    label: 'Auto-answer calls',
    description: 'Answer an incoming call by putting the headphones on.',
    get: getAutoAnswer,
    set: setAutoAnswer,
  },
  {
    key: 'comfortCall',
    group: 'behaviour',
    label: 'Comfort call',
    description: 'Adjusts call audio for a more natural sound.',
    get: getComfortCall,
    set: setComfortCall,
  },
  {
    key: 'lowLatency',
    group: 'behaviour',
    label: 'Low-latency mode',
    description: 'Reduces audio delay for video and games.',
    get: getLowLatency,
    set: setLowLatency,
  },
  {
    key: 'touchControls',
    group: 'behaviour',
    label: 'Touch controls',
    description: 'Tap and swipe on the right earcup.',
    get: getTouchControls,
    set: setTouchControls,
  },
  {
    key: 'bluetoothCompatibility',
    group: 'behaviour',
    label: 'Bluetooth compatibility mode',
    description: 'More stable link on crowded connections; may disable some features.',
    get: getBluetoothCompatibility,
    set: setBluetoothCompatibility,
  },
];

// --- frame reduction ------------------------------------------------------

type Reducer = (state: DeviceState, payload: Uint8Array) => DeviceState;

const entry = <T>(
  command: Command<void, T>,
  apply: (state: DeviceState, value: T) => DeviceState,
): [number, Reducer] => [
  command.id,
  (state, payload) => apply(state, command.decode(payload)),
];

/**
 * Frames whose payload depends on the exact command, not just the feature.
 *
 * EQ is the one case where a response and its notification disagree: 0x1102
 * echoes `[band, gain]` for a single band, while 0x1082 pushes every band's
 * gain at once. Keying those on the shared request ID would mis-decode both.
 */
const EXACT_REDUCERS = new Map<number, Reducer>([
  [
    EQ_NOTIFICATION,
    (state, payload) => ({ ...state, eq: { ...state.eq, gains: decodeEqGains(payload) } }),
  ],
]);

/**
 * Keyed by request ID, so a response (`id | 0x0100`) and its notification
 * (`id | 0x0080`) land on the same reducer — they carry identical payloads.
 */
const REDUCERS = new Map<number, Reducer>([
  entry(getBattery, (s, v) => ({ ...s, battery: v[0] ?? null })),
  entry(getChargingStatus, (s, v) => ({ ...s, charging: v[0] === undefined ? null : v[0] !== 0 })),
  entry(getCodec, (s, v) => ({ ...s, info: { ...s.info, codec: v } })),
  entry(getAncEnabled, (s, v) => ({ ...s, noise: { ...s.noise, ancEnabled: v } })),
  entry(getAncModes, (s, v) => ({ ...s, noise: { ...s.noise, modes: v } })),
  entry(getTransparencyLevel, (s, v) => ({
    ...s,
    noise: { ...s.noise, transparencyLevel: v },
  })),
  entry(getTransparentHearing, (s, v) => ({
    ...s,
    noise: { ...s.noise, transparentHearing: v },
  })),
  entry(getSidetone, (s, v) => ({ ...s, sidetone: v })),
  entry(getPhysicalDeviceState, (s, v) => ({ ...s, wearState: v })),
  entry(getAudioPromptMode, (s, v) => ({ ...s, audioPrompts: v })),
  entry(getAudioMode, (s, v) => ({ ...s, audioMode: v })),
  // Not via entry(): this command takes an argument, but only its decode is
  // needed here — the 0x1484 notification shares the response shape.
  [
    getConnectionStatus.id,
    (state, payload) => {
      const { index, connected } = getConnectionStatus.decode(payload);
      return {
        ...state,
        connections: {
          ...state.connections,
          devices: state.connections.devices.map((device) =>
            device.index === index ? { ...device, connected } : device,
          ),
        },
      };
    },
  ],
  [
    getEqBand.id,
    (state, payload) => {
      const { band, gain } = getEqBand.decode(payload);
      // An unsolicited bare gain carries no band index, so there is no way to
      // know which slider it belongs to. Wait for the 0x1082 push instead.
      if (band === null) return state;
      const gains = [...state.eq.gains];
      gains[band] = gain;
      return { ...state, eq: { ...state.eq, gains } };
    },
  ],
  entry(getEqConfig, (s, v) => ({ ...s, eq: { ...s.eq, config: v } })),
  ...TOGGLES.map(({ key, get }) =>
    entry(get, (s, v) => ({ ...s, toggles: { ...s.toggles, [key]: v } })),
  ),
]);

/**
 * Folds a notification frame into the state. Unknown notifications are ignored
 * rather than treated as errors — the headphones emit more than we model.
 */
export function applyNotification(state: DeviceState, frame: GaiaFrame): DeviceState {
  const reducer =
    EXACT_REDUCERS.get(frame.command) ?? REDUCERS.get(requestIdFor(frame.command));
  if (!reducer) return state;
  try {
    return reducer(state, frame.payload);
  } catch {
    // A malformed payload should never take the UI down.
    return state;
  }
}
