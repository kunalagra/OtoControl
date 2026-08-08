/**
 * The curated Momentum 4 command table.
 *
 * Transcribed by hand from `reference/m4.json` (the SmartControl-Desktop
 * property dump for this exact model). Only the commands the app actually uses
 * appear here — in particular nothing from the `Upgrade_*` or
 * `Service_FactoryReset` families, because firmware DFU over a
 * reverse-engineered channel can brick the headphones.
 *
 * Every ID marked ✅ was confirmed against real hardware in the milestone-0
 * spike; the rest are transcribed but not yet exercised.
 */

import { Vendor } from './frame';

export interface Command<TArg, TResult> {
  readonly name: string;
  readonly vendor: number;
  /** Request ID. The response is `id | 0x0100`, notification `id | 0x0080`. */
  readonly id: number;
  encode(arg: TArg): number[];
  decode(payload: Uint8Array): TResult;
}

// --- payload codecs -------------------------------------------------------

const u8 = (payload: Uint8Array): number => {
  if (payload.length < 1) throw new Error('expected at least 1 byte');
  return payload[0];
};

const bool = (payload: Uint8Array): boolean => u8(payload) !== 0;

const bytes = (payload: Uint8Array): number[] => Array.from(payload);

/** Every multi-byte integer in this protocol is big-endian. */
const u16be = (payload: Uint8Array, offset: number): number =>
  (payload[offset] << 8) | payload[offset + 1];

/** Model and serial come back as NUL-padded ASCII. */
const text = (payload: Uint8Array): string =>
  new TextDecoder().decode(payload).replace(/\0+$/, '');

const nothing = (): void => undefined;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.round(value)));

// --- command constructors -------------------------------------------------

function getter<T>(
  name: string,
  id: number,
  decode: (payload: Uint8Array) => T,
  vendor: number = Vendor.Sennheiser,
): Command<void, T> {
  return { name, vendor, id, encode: () => [], decode };
}

function setter<T>(
  name: string,
  id: number,
  encode: (arg: T) => number[],
  vendor: number = Vendor.Sennheiser,
): Command<T, void> {
  return { name, vendor, id, encode, decode: nothing };
}

const boolSetter = (name: string, id: number) =>
  setter<boolean>(name, id, (on) => [on ? 1 : 0]);

// --- noise control --------------------------------------------------------

/** Which ANC sub-mode a `setAncMode` call targets. */
export const AncMode = {
  AntiWind: 1,
  Comfort: 2,
  Adaptive: 3,
} as const;

export type AncModeId = (typeof AncMode)[keyof typeof AncMode];

/**
 * Anti-wind is three-state, not a toggle — the app config lists
 * `supported_anti_wind_values: ["off", "max", "auto"]`. Comfort and adaptive
 * really are booleans.
 */
export const AntiWind = {
  Off: 0,
  Max: 1,
  Auto: 2,
} as const;

export type AntiWindValue = (typeof AntiWind)[keyof typeof AntiWind];

export const ANTI_WIND_OPTIONS: Array<{ value: AntiWindValue; label: string }> = [
  { value: AntiWind.Off, label: 'Off' },
  { value: AntiWind.Max, label: 'Max' },
  { value: AntiWind.Auto, label: 'Auto' },
];

export interface AncModes {
  antiWind: number;
  comfort: number;
  adaptive: number;
}

/**
 * Payload is three `[mode, state]` pairs. Observed on hardware:
 * `01 01 02 00 03 00` → anti-wind on, comfort off, adaptive off.
 * State is 0=off, 1=on, and 2=auto for anti-wind.
 */
const ancModes = (payload: Uint8Array): AncModes => {
  const modes: AncModes = { antiWind: 0, comfort: 0, adaptive: 0 };
  for (let i = 0; i + 1 < payload.length; i += 2) {
    const state = payload[i + 1];
    switch (payload[i]) {
      case AncMode.AntiWind:
        modes.antiWind = state;
        break;
      case AncMode.Comfort:
        modes.comfort = state;
        break;
      case AncMode.Adaptive:
        modes.adaptive = state;
        break;
    }
  }
  return modes;
};

export const getAncEnabled = getter('getAncEnabled', 0x1a05, bool); // ✅
export const setAncEnabled = boolSetter('setAncEnabled', 0x1a04);

export const getAncModes = getter('getAncModes', 0x1a01, ancModes); // ✅
export const setAncMode = setter<{ mode: AncModeId; state: number }>(
  'setAncMode',
  0x1a00,
  ({ mode, state }) => [mode, state],
);

/** 0–100. Only meaningful while transparent hearing is on. */
export const getTransparencyLevel = getter('getTransparencyLevel', 0x1a03, u8); // ✅
export const setTransparencyLevel = setter<number>(
  'setTransparencyLevel',
  0x1a02,
  (level) => [clamp(level, 0, 100)],
);

/**
 * Note: the device also exposes a second transparency level at 0x1802/0x1803
 * (BudsLink's TRANSP_LEVEL), distinct from ANC_Transparency at 0x1A02/0x1A03
 * which the noise slider uses. What the two do differently is not established,
 * so only the ANC one is wired up.
 */
export const getTransparentHearing = getter('getTransparentHearing', 0x1805, bool);
export const setTransparentHearing = boolSetter('setTransparentHearing', 0x1804);

/** 0 = keep music playing, 1 = stop music, when transparency engages. */
export const getTransparencyBehaviour = getter('getTransparencyBehaviour', 0x1801, u8);
export const setTransparencyBehaviour = setter<number>(
  'setTransparencyBehaviour',
  0x1800,
  (mode) => [mode],
);

// --- status (read-only) ---------------------------------------------------

/** Array-valued: one entry per cell. Over-ears report a single value. */
export const getBattery = getter('getBattery', 0x0603, bytes); // ✅
export const getChargingStatus = getter('getChargingStatus', 0x0602, bytes);

/**
 * `Service_SystemReleaseVersion` — the human-readable version, as three u16s.
 *
 * Not to be confused with `FirmwareVersions` (0x1202), which returns a 6-byte
 * internal build array; decoding that one as a version triple produces
 * nonsense like "806.768.0".
 */
export const getSystemVersion = getter('getSystemVersion', 0x1201, (payload) => {
  if (payload.length < 6) throw new Error('expected 6 bytes');
  return [u16be(payload, 0), u16be(payload, 2), u16be(payload, 4)] as const;
});

export const formatVersion = (parts: readonly number[]): string => parts.join('.');

/** The raw 6-byte build array. Shown only in the debug console. */
export const getFirmwareBuild = getter('getFirmwareBuild', 0x1202, bytes);

export const getModelId = getter('getModelId', 0x1206, text); // ✅ "M4AEBT Black"
export const getSerialNumber = getter('getSerialNumber', 0x0003, text, Vendor.Qualcomm);

export const getCodec = getter('getCodec', 0x0800, u8);

/** Transcribed from the `Sound_CodecUsed` map in m4.json. */
const CODEC_NAMES: Record<number, string> = {
  0: 'SBC',
  1: 'AAC',
  2: 'aptX',
  3: 'aptX-LL',
  4: 'MP3',
  5: 'aptX-HD',
  6: 'Faststream',
  7: 'LHDC',
  8: 'aptX Adaptive',
  9: 'aptX Lossless',
  10: 'LC3',
  255: 'None',
};

export const codecName = (id: number): string => CODEC_NAMES[id] ?? `Codec ${id}`;

/** Where the headphones are: in the case, off the head, or worn. */
export const WearState = {
  Unknown: 0,
  InCase: 1,
  NotOnHead: 2,
  OnHead: 3,
} as const;

const WEAR_NAMES: Record<number, string> = {
  [WearState.Unknown]: 'Unknown',
  [WearState.InCase]: 'In case',
  [WearState.NotOnHead]: 'Off head',
  [WearState.OnHead]: 'On head',
};

export const wearStateName = (value: number): string => WEAR_NAMES[value] ?? `State ${value}`;

/** `[headset/left, right]`. Over-ears report the first byte only. */
export const getPhysicalDeviceState = getter('getPhysicalDeviceState', 0x0402, u8);

// --- capabilities ---------------------------------------------------------

/**
 * `Core_GetSupportedFeatures` — the device listing what it implements.
 *
 * Response is `[moreData, (featureId, version)...]`. When `moreData` is set,
 * `Core_GetSupportedFeaturesNext` (0x0002) continues the list.
 *
 * **These are Qualcomm GAIA core feature IDs, not Sennheiser vendor ones**, so
 * this cannot gate the Sennheiser command table. Established on a MOMENTUM 4
 * (firmware 3.38.3, GAIA 3.1): it reports 0x00, 0x04, 0x06, 0x07, 0x0C, 0x0D
 * and omits Sennheiser battery (3) and user EQ (8) — both of which demonstrably
 * work. Gating on this list would have disabled features that function.
 */
export interface SupportedFeatures {
  /** True when another page follows. */
  moreData: boolean;
  /** Feature ID to its version byte. */
  features: Map<number, number>;
}

const supportedFeatures = (payload: Uint8Array): SupportedFeatures => {
  if (payload.length < 1) throw new Error('expected at least 1 byte');
  const features = new Map<number, number>();
  // Pairs after the moreData byte. A trailing odd byte is ignored rather than
  // read as a feature with an invented version.
  for (let i = 1; i + 1 < payload.length; i += 2) {
    features.set(payload[i], payload[i + 1]);
  }
  return { moreData: payload[0] !== 0, features };
};

export const getSupportedFeatures = getter(
  'getSupportedFeatures',
  0x0001,
  supportedFeatures,
  Vendor.Qualcomm,
);

export const getSupportedFeaturesNext = getter(
  'getSupportedFeaturesNext',
  0x0002,
  supportedFeatures,
  Vendor.Qualcomm,
);

/** `[major, minor]`. */
export const getApiVersion = getter('getApiVersion', 0x0000, bytes, Vendor.Qualcomm);

// --- sound ----------------------------------------------------------------

/**
 * Bass boost lives in the User-EQ feature range (base 0x1000) rather than with
 * the other audio settings. Not present in m4.json's property list — taken from
 * momentum4-control, where it is confirmed working against an M4.
 */
export const getBassBoost = getter('getBassBoost', 0x1009, bool);
export const setBassBoost = boolSetter('setBassBoost', 0x1008);

// --- equalizer (User-EQ feature 8, base 0x1000) ---------------------------

/**
 * Command IDs from ZenControl (sennheiser-desktop-client), verified there
 * against an ACCENTUM. The M4 is the same GAIA feature, but its band count and
 * gain range are read from the device rather than assumed — that is exactly
 * what `getEqConfig` is for.
 *
 * Gains travel as a signed byte in tenths of a dB.
 */
const i8 = (value: number): number => (value > 127 ? value - 256 : value);

const toGainDb = (raw: number): number => i8(raw) / 10;
const fromGainDb = (db: number): number => Math.round(db * 10) & 0xff;

export interface EqConfig {
  bands: number;
  minGain: number;
  maxGain: number;
}

/** Response is `[bandCount, minGain_i8, maxGain_i8, …]`. */
export const getEqConfig = getter('getEqConfig', 0x1000, (payload): EqConfig => {
  if (payload.length < 3) throw new Error('expected at least 3 bytes');
  return {
    bands: payload[0],
    minGain: toGainDb(payload[1]),
    maxGain: toGainDb(payload[2]),
  };
});

export interface EqBand {
  band: number;
  gain: number;
}

export interface EqBandReading {
  /** Null when the device replies with a bare gain and no band echo. */
  band: number | null;
  gain: number;
}

/**
 * ZenControl documents the response as `[band, gain_i8]` on the ACCENTUM, but
 * the M4 answers with the gain alone. Both shapes are accepted; when the band
 * is not echoed, the caller supplies the one it asked for.
 */
export const getEqBand: Command<number, EqBandReading> = {
  name: 'getEqBand',
  vendor: Vendor.Sennheiser,
  id: 0x1002,
  encode: (band) => [band],
  decode: (payload) => {
    if (payload.length >= 2) return { band: payload[0], gain: toGainDb(payload[1]) };
    if (payload.length === 1) return { band: null, gain: toGainDb(payload[0]) };
    throw new Error('expected at least 1 byte');
  },
};

export const setEqBand: Command<EqBand, void> = {
  name: 'setEqBand',
  vendor: Vendor.Sennheiser,
  id: 0x1001,
  encode: ({ band, gain }) => [band, fromGainDb(gain)],
  decode: nothing,
};

/** Notification 0x1082 pushes every band gain at once, unlike the response. */
export const EQ_NOTIFICATION = 0x1082;

export const decodeEqGains = (payload: Uint8Array): number[] =>
  Array.from(payload, toGainDb);

/**
 * Band labels and presets, taken from the Smart Control app's own M4 config
 * (`reference/m4-app-config.json`, `feature_variant_configs.Equalizer`).
 *
 * These replace the ACCENTUM values used earlier: the M4's bands are labelled
 * 63/250/1k/4k/8k, not 50/250/800/3k/8k, and every preset curve differs.
 */
export const EQ_BAND_LABELS = ['63', '250', '1k', '4k', '8k'];

export const eqBandLabel = (index: number, total: number): string =>
  total === EQ_BAND_LABELS.length ? `${EQ_BAND_LABELS[index]} Hz` : `Band ${index + 1}`;

export const EQ_PRESETS: Array<{ name: string; gains: number[] }> = [
  { name: 'Flat', gains: [0, 0, 0, 0, 0] },
  { name: 'Rock', gains: [0, 2, 2.5, 1.5, -2] },
  { name: 'Pop', gains: [0, -2.5, 0, 2.5, 0] },
  { name: 'Dance', gains: [3.5, 2, -1.5, 1.5, 3] },
  { name: 'Hip-Hop', gains: [3, 1.5, -1.5, 0, -1.5] },
  { name: 'Classical', gains: [-2, -1.5, 0, 3.5, 4] },
  { name: 'Movie', gains: [0, 0, 2, 2, -2] },
  { name: 'Jazz', gains: [-3.2, 0, 2.2, 2.2, 0] },
];

// The config also carries per-band `max_headroom`, `loudness_weights` and
// `q_factor`. Their meaning is not established — the Dance preset exceeds its
// own band's max_headroom — so they are deliberately not modelled here. The
// gain range reported by `getEqConfig` is the authoritative limit.

// --- timers ---------------------------------------------------------------

export const Timer = {
  /** Auto power off. */
  PowerOff: 0,
  LimboTimeout: 1,
} as const;

export type TimerId = (typeof Timer)[keyof typeof Timer];

export interface TimerValue {
  timer: number;
  seconds: number;
}

/**
 * `Config_GetTimer`. Response is `[timer number, value u16]`. Every other u16
 * in this protocol is big-endian, so that is assumed here — worth confirming
 * against the phone app the first time a real value comes back.
 */
export const getTimer: Command<TimerId, TimerValue> = {
  name: 'getTimer',
  vendor: Vendor.Sennheiser,
  id: 0x0601,
  encode: (timer) => [timer],
  decode: (payload) => {
    if (payload.length < 3) throw new Error('expected 3 bytes');
    return { timer: payload[0], seconds: u16be(payload, 1) };
  },
};

export const setTimer: Command<TimerValue, void> = {
  name: 'setTimer',
  vendor: Vendor.Sennheiser,
  id: 0x0600,
  encode: ({ timer, seconds }) => {
    const value = clamp(seconds, 0, 0xffff);
    return [timer, (value >> 8) & 0xff, value & 0xff];
  },
  decode: nothing,
};

/**
 * The durations this model actually supports, per BudsLink's
 * `MomentumWireless4.js` (`autoPowerOff: [0, 15, 30, 60]`, in minutes).
 * Longer values were offered earlier and are not accepted by the hardware.
 */
export const POWER_OFF_PRESETS: Array<{ label: string; seconds: number }> = [
  { label: 'Never', seconds: 0 },
  { label: '15 minutes', seconds: 15 * 60 },
  { label: '30 minutes', seconds: 30 * 60 },
  { label: '1 hour', seconds: 60 * 60 },
];

export function formatDuration(seconds: number): string {
  if (seconds === 0) return 'Never';
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  return `${Math.round(seconds / 60)} minutes`;
}

// --- paired devices (connection management) -------------------------------

export interface PairedDevice {
  index: number;
  /** Lower is preferred when the headphones choose what to reconnect to. */
  priority: number;
  connected: boolean;
  name: string;
}

export const getPairedDeviceCount = getter('getPairedDeviceCount', 0x1400, (payload) => {
  if (payload.length < 2) throw new Error('expected 2 bytes');
  return u16be(payload, 0);
});

/** How many devices can be connected at once — i.e. whether multipoint is on. */
export const getMaxConnections = getter('getMaxConnections', 0x1409, u8);

/** Which entry in the list is this machine. */
export const getOwnDeviceIndex = getter('getOwnDeviceIndex', 0x1407, u8);

/** `[index, priority, status, name…]` with a NUL-terminated name. */
export const getPairedDevice: Command<number, PairedDevice> = {
  name: 'getPairedDevice',
  vendor: Vendor.Sennheiser,
  id: 0x1401,
  encode: (index) => [index],
  decode: (payload) => {
    if (payload.length < 3) throw new Error('expected at least 3 bytes');
    return {
      index: payload[0],
      priority: payload[1],
      connected: payload[2] !== 0,
      name: text(payload.subarray(3)),
    };
  },
};

export interface ConnectionStatusReading {
  index: number;
  connected: boolean;
}

/** Also the shape of the 0x1484 notification. */
export const getConnectionStatus: Command<number, ConnectionStatusReading> = {
  name: 'getConnectionStatus',
  vendor: Vendor.Sennheiser,
  id: 0x1404,
  encode: (index) => [index],
  decode: (payload) => {
    if (payload.length < 2) throw new Error('expected 2 bytes');
    return { index: payload[0], connected: payload[1] !== 0 };
  },
};

export const connectPairedDevice = setter<number>(
  'connectPairedDevice',
  0x1402,
  (index) => [index],
);

export const disconnectPairedDevice = setter<number>(
  'disconnectPairedDevice',
  0x1403,
  (index) => [index],
);

// --- behaviour toggles ----------------------------------------------------

export const getSmartPause = getter('getSmartPause', 0x080d, bool);
export const setSmartPause = boolSetter('setSmartPause', 0x080c);

export const getOnHeadDetection = getter('getOnHeadDetection', 0x0401, bool);
export const setOnHeadDetection = boolSetter('setOnHeadDetection', 0x0400);

export const getAutoAnswer = getter('getAutoAnswer', 0x080b, bool);
export const setAutoAnswer = boolSetter('setAutoAnswer', 0x080a);

export const getComfortCall = getter('getComfortCall', 0x0815, bool);
export const setComfortCall = boolSetter('setComfortCall', 0x0814);

export const getLowLatency = getter('getLowLatency', 0x0818, bool);
export const setLowLatency = boolSetter('setLowLatency', 0x0817);

/**
 * m4.json warns this may disable features in exchange for a more stable link.
 */
export const getBluetoothCompatibility = getter('getBluetoothCompatibility', 0x0406, bool);
export const setBluetoothCompatibility = boolSetter('setBluetoothCompatibility', 0x0405);

/**
 * `Setting_AutoLockMode` — the earcup touch surface.
 *
 * The wire value is a *lock*: 1 means the surface is locked, so touch controls
 * are off. Exposed inverted, so `true` means "touch controls work", which is
 * what the label says and what the phone app shows.
 */
export const getTouchControls = getter('getTouchControls', 0x1607, (payload) => !bool(payload));
export const setTouchControls = setter<boolean>('setTouchControls', 0x1606, (enabled) => [
  enabled ? 0 : 1,
]);

export const getAudioPromptMode = getter('getAudioPromptMode', 0x0802, u8);
export const setAudioPromptMode = setter<number>(
  'setAudioPromptMode',
  0x0801,
  (mode) => [mode],
);

/**
 * Sound mode — which processing the headphones apply.
 *
 * Not in m4.json; taken from BudsLink's `senhBudsConfig.js` (AUDIO_MODE) and
 * its `MomentumWireless4.js` enum. This is the app's "audio mode": the manual
 * equaliser only applies while the mode is `Equalizer`.
 */
export const AudioMode = {
  Off: 0x00,
  Equalizer: 0x01,
  Podcast: 0x02,
  Personalized: 0x03,
} as const;

export type AudioModeId = (typeof AudioMode)[keyof typeof AudioMode];

export const AUDIO_MODE_OPTIONS: Array<{
  value: AudioModeId;
  label: string;
  hint: string;
}> = [
  { value: AudioMode.Off, label: 'Off', hint: 'No processing.' },
  { value: AudioMode.Equalizer, label: 'Equalizer', hint: 'Use the bands below.' },
  { value: AudioMode.Podcast, label: 'Podcast', hint: 'Tuned for speech.' },
  {
    value: AudioMode.Personalized,
    label: 'Personalized',
    hint: 'Your Sound Check profile, set in the phone app.',
  },
];

export const getAudioMode = getter('getAudioMode', 0x0804, u8);
export const setAudioMode = setter<number>('setAudioMode', 0x0803, (mode) => [mode]);

/** Level 0–5, not a boolean. */
export const SIDETONE_MAX = 5;
export const getSidetone = getter('getSidetone', 0x0806, u8);
export const setSidetone = setter<number>('setSidetone', 0x0805, (level) => [
  clamp(level, 0, SIDETONE_MAX),
]);
