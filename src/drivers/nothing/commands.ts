/**
 * Nothing/CMF SPP command ids and payload codecs.
 *
 * Every constant and byte offset below is ported from radiance-project/ear-web
 * (`res/js/bluetooth_socket.js` and the per-model files), not derived — the
 * protocol has never been published, so ear-web's byte choices are the spec.
 *
 * Payload offsets are given relative to the start of the payload (ear-web
 * indexes the whole packet, which always puts the payload at byte 8).
 */

/** Read commands (0xC0xx); answered with `command & 0x7fff`. */
export const Read = {
  Battery: 0xc007,
  CaseLedColor: 0xc017, // Ear (1) only
  Gestures: 0xc018,
  PersonalizedAnc: 0xc020, // Ear (2) only
  InEarDetection: 0xc00e,
  AncMode: 0xc01e,
  EqPreset: 0xc01f,
  CustomEq: 0xc044,
  EnhancedBass: 0xc04e,
  /**
   * The onboard "advanced" EQ profile — `GET_ADVANCE_CUSTOM_EQ_MODE`, likewise
   * declared in `TWSDeviceExtKt`. Its band values are a separate pair,
   * `0xc04d`/`0xf050`, which this driver does not read.
   *
   * `supportAdvanceEq()` is true on B155, B170, B171 and B173 — *not* on the
   * Buds Pro 2 (B172), which this comment used to claim.
   */
  AdvancedEq: 0xc04c,
  Firmware: 0xc042,
  LatencyMode: 0xc041,
  /**
   * The `B1xx` product id. `GET_DEVICE_MODEL` in the official app's
   * `ProtocolConstant`, which is also the only model identification available
   * over SPP — see `decodeDeviceModel`.
   */
  DeviceModel: 0xc01c,
  /**
   * The colourway byte — `GET_REMOTE_COLOR_ID`, read by the official app's
   * `TWSDeviceExtKt.remoteColor`. An ordinary control-channel query, despite
   * an earlier comment in `nothingCdn.generated.ts` claiming the colour was
   * BLE-only.
   */
  ColourId: 0xc00c,
  /** Wear/in-case state per device — `GET_EARPHONE_STATUS`. */
  EarphoneStatus: 0xc00a,
  /** Serial number, hardware and software versions — `GET_REMOTE_CONFIGURATION`. */
  Configuration: 0xc006,
  /** Multipoint — `GET_DUAL_ENABLE`. */
  Multipoint: 0xc027,
  /** Detail enhancement — `GET_DETAIL_ENHANCEMENT`. */
  ClarityBoost: 0xc069,
  /** `GET_SMART_ANC_MODE`. */
  SmartAnc: 0xc055,
  /** `GET_SMART_FREE_MODE`. */
  SmartFree: 0xc054,
  /** `GET_LHDC_COMMANDS`. */
  Lhdc: 0xc029,
  /**
   * `GET_PROTOCOL_VERSION`. The app treats a null answer to this as a
   * *connection* failure (`HEADSET_SPP_GET_PROTOCOL_VERSION_NULL`), and
   * BudsLink asks it first thing on connect too.
   */
  ProtocolVersion: 0xc001,
  /** The advanced EQ's band values — `GET_ADVANCE_CUSTOM_EQ_VALUE`. */
  AdvancedEqBands: 0xc04d,
  /**
   * The Dirac Opteo EQ selector (Buds Pro 2 / CMF Buds). `GET_DIRAC_OPTEO_EQ`
   * in the official app — declared in `TWSDeviceExtKt` rather than
   * `ProtocolConstant`, which is where the EQ family lives.
   */
  DiracPreset: 0xc050,
  SpatialAudio: 0xc04f,
} as const;

/** Write commands (0xF0xx); applied silently, never answered. */
export const Write = {
  RingBuds: 0xf002,
  SetGesture: 0xf003,
  SetInEarDetection: 0xf004,
  SetCaseLedColor: 0xf00d, // Ear (1) only
  SetAncMode: 0xf00f,
  SetEqPreset: 0xf010,
  SetPersonalizedAnc: 0xf011, // Ear (2) only
  StartEarFitTest: 0xf014,
  SetLatencyMode: 0xf040,
  SetCustomEq: 0xf041,
  /** `SET_DIRAC_OPTEO_EQ`. */
  SetDiracPreset: 0xf01d,
  /** `SET_ADVANCE_CUSTOM_EQ_MODE`; its values pair is `0xf050`. */
  SetAdvancedEq: 0xf04f,
  SetEnhancedBass: 0xf051,
  SetSpatialAudio: 0xf052,
  /** `SET_DUAL_ENABLE`. */
  SetMultipoint: 0xf01a,
  /** `SET_DETAIL_ENHANCEMENT`. */
  SetClarityBoost: 0xf069,
  /** `SET_SMART_ANC_MODE`. */
  SetSmartAnc: 0xf059,
  /** `SET_SMART_FREE_MODE`. */
  SetSmartFree: 0xf058,
  /** `SET_LHDC_COMMANDS`. */
  SetLhdc: 0xf01c,
  /** `SET_PROTOCOL_ACTIVATED` — the second half of the connect handshake. */
  ActivateProtocol: 0xf001,
  /** `SET_UTC_TIME`. BudsLink sends this on every connect. */
  SetUtcTime: 0xf00a,
  /** `SET_ADVANCE_CUSTOM_EQ_VALUE`. */
  SetAdvancedEqBands: 0xf050,
  /** `SET_CALIBRATION` — starts the personalized-ANC fitting. */
  StartCalibration: 0xf012,
  /** `RESTORE_FACTORY_SETTING`. */
  FactoryReset: 0xf03d,
} as const;

/** Unsolicited notifications (0xE0xx). */
export const Notify = {
  Battery: 0xe001,
  AncMode: 0xe003,
  EarFitTestResult: 0xe00d,
  /** `EVENT_DEVICE_STATUS_CHANGED` — wear state moved. */
  DeviceStatus: 0xe002,
} as const;

// --- ANC --------------------------------------------------------------------

/**
 * The eight listening modes a Nothing device reports, in ear-web's level
 * numbering. This is *not* the wire numbering — see ANC_WIRE for the mapping,
 * which is the app's own enum rather than the arbitrary table it looks like.
 */
export const AncLevel = {
  Off: 1,
  Transparency: 2,
  NcLow: 3,
  NcHigh: 4,
  NcMid: 5,
  Adaptive: 6,
  /** `MODE_NOISE_COMFORTABLE`. */
  Comfortable: 7,
  /** `MODE_NOISE_REDUCTION_SMART_2`. */
  Adaptive2: 8,
} as const;

export type AncLevelId = (typeof AncLevel)[keyof typeof AncLevel];

/**
 * Level → wire byte. Not patternless, as a previous comment had it: the wire
 * side is the app's own `MODE_NOISE_REDUCTION_*` enum — 1 strong, 2 medium,
 * 3 weak, 4 smart, 5 off, 6 comfortable, 7 pass-through, 8 smart-2.
 */
const ANC_WIRE: Record<number, number> = {
  [AncLevel.Off]: 0x05,
  [AncLevel.Transparency]: 0x07,
  [AncLevel.NcLow]: 0x03,
  [AncLevel.NcHigh]: 0x01,
  [AncLevel.NcMid]: 0x02,
  [AncLevel.Adaptive]: 0x04,
  [AncLevel.Comfortable]: 0x06,
  [AncLevel.Adaptive2]: 0x08,
};

const ANC_FROM_WIRE: Record<number, number> = Object.fromEntries(
  Object.entries(ANC_WIRE).map(([level, wire]) => [wire, Number(level)]),
);

/** `[0x01, wireByte, 0x00]` — the fixed shape every model uses. */
export const encodeAncMode = (level: number): number[] => [0x01, ANC_WIRE[level] ?? 0x05, 0x00];

/**
 * The reply is a sequence of 3-byte `(key, mode, level)` items — the app's
 * `DeviceNoiseReduction`, which reads `payload.length / 3` of them and keys
 * them by the first byte. Key `1` is the current noise reduction, and is what
 * the matching write addresses.
 *
 * Reading `payload[1]` unconditionally, as this did, happens to be right when
 * key 1 comes first, and silently reads another item's mode when it does not.
 *
 * The third byte of each item is a *level*, which this decoder does not yet
 * use: 1–127 is a manual noise-reduction strength, and the top of the range is
 * sentinels naming the automatic modes — 0 off, 252 smart-2, 253 smart-1,
 * 254 transparency, 255 comfortable. Read out of the app alongside the mode
 * enum; untested against hardware, which is why nothing is built on it.
 */
export const decodeAncMode = (payload: Uint8Array): number | null => {
  for (let at = 0; at + 2 < payload.length; at += 3) {
    if (payload[at] === 0x01) return ANC_FROM_WIRE[payload[at + 1]] ?? null;
  }
  return null;
};

// --- battery ----------------------------------------------------------------

export interface BatteryCell {
  level: number;
  charging: boolean;
}

export interface NothingBattery {
  left: BatteryCell | null;
  right: BatteryCell | null;
  case: BatteryCell | null;
  /**
   * The one cell a single-body device reports — the over-ears (CMF Headphone
   * Pro, Nothing Headphone (1)/(a)), which have no left/right pair and no
   * case. Null on earbuds.
   */
  single: BatteryCell | null;
}

/**
 * Device ids in a battery reply, from the official app's `DeviceBattery`
 * entity, which exposes one accessor per id: `1` watch, `2` left, `3` right,
 * `4` case, `5` tws, and `6`-or-`7` "stereo" — `getStereo()` reads id 6 and
 * falls back to id 7.
 *
 * `5`, `6` and `7` all carry a single value for a device with one battery, so
 * all three land in `single`. Only the watch id is dropped, this app driving
 * no watches.
 *
 * Mapping only `2`/`3`/`4` — as this did — silently returned an all-null
 * battery for every over-ear: the read answers, the capability probe passes,
 * and the UI shows nothing.
 */
const BATTERY_SLOTS: Record<number, keyof NothingBattery> = {
  0x02: 'left',
  0x03: 'right',
  0x04: 'case',
  0x05: 'single',
  0x06: 'single',
  0x07: 'single',
};

/** Payload: count, then (deviceId, level) pairs. Bit 7 of level = charging. */
export function decodeBattery(payload: Uint8Array): NothingBattery {
  const result: NothingBattery = { left: null, right: null, case: null, single: null };
  if (payload.length === 0) return result;
  const count = Math.min(payload[0], Math.floor((payload.length - 1) / 2));
  for (let i = 0; i < count; i += 1) {
    const slot = BATTERY_SLOTS[payload[1 + i * 2]];
    if (!slot) continue;
    const raw = payload[2 + i * 2];
    result[slot] = { level: raw & 0x7f, charging: (raw & 0x80) !== 0 };
  }
  return result;
}

// --- EQ ---------------------------------------------------------------------

/** Preset ids as the device reports them. 4 is unused; 5 means custom. */
/**
 * Preset ids, from the app's `EQModeEntity.Mode`. All eight are real; an
 * earlier table invented an `Advanced: 6`, which collides with the genuine
 * `NewVoice`, and called `4` unused when it selects the Dirac curve.
 */
export const EqPreset = {
  Balanced: 0,
  Voice: 1,
  Treble: 2,
  Bass: 3,
  Dirac: 4,
  Custom: 5,
  NewVoice: 6,
  NewInstrument: 7,
} as const;

export const EQ_PRESET_NAMES: Record<number, string> = {
  [EqPreset.Balanced]: 'Balanced',
  [EqPreset.Voice]: 'Voice',
  [EqPreset.Treble]: 'Treble',
  [EqPreset.Bass]: 'Bass',
  [EqPreset.Dirac]: 'Dirac',
  [EqPreset.Custom]: 'Custom',
  [EqPreset.NewVoice]: 'Voice (new)',
  [EqPreset.NewInstrument]: 'Instrument',
};

export const encodeEqPreset = (preset: number): number[] => [preset, 0x00];
export const decodeEqPreset = (payload: Uint8Array): number | null =>
  payload.length > 0 ? payload[0] : null;

/**
 * The EQ float encoding: **IEEE-754 float32, little-endian**.
 *
 * That is exactly what the app does — `DataExtKt.toByteArray(float)` writes a
 * big-endian float then reverses the bytes, and `toFloat` reverses before
 * reading. Nothing more.
 *
 * The previous implementation was ported from ear-web's `formatFloatForEQ`
 * with a sign hack: a denormal-zero byte pattern carried the sign in the last
 * byte's bit 7, and the "total gain" form returned a hand-built
 * `[0, 0, 0, 0x80]` rather than a float. The app has no such case, and both
 * paths only ever produced ±0 for the total gain anyway.
 */
export function encodeEqFloat(value: number): number[] {
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setFloat32(0, value, true);
  return Array.from(new Uint8Array(buffer));
}

export function decodeEqFloat(bytes: number[] | Uint8Array): number {
  const buffer = new ArrayBuffer(4);
  new Uint8Array(buffer).set(Array.from(bytes).slice(0, 4));
  return new DataView(buffer).getFloat32(0, true);
}

/** Filter shapes, from `CustomEQ`'s constants. */
export const EqFilter = {
  LowShelf: 0,
  Peak: 1,
  HighShelf: 2,
  LowPass: 3,
  HighPass: 4,
} as const;

/** One parametric band. Frequency and Q are the model's own; gain is ours. */
export interface EqBand {
  filterType: number;
  gain: number;
  frequency: number;
  q: number;
}

export interface CustomEq {
  /** A per-model constant; every `IOTProductDevice` returns 0. */
  totalGain: number;
  bands: EqBand[];
}

/** Bytes per band: type(1) + gain(4) + frequency(4) + Q(4). */
const EQ_BAND_LENGTH = 13;
/** Bytes before the first band: count(1) + total gain(4). */
const EQ_HEADER_LENGTH = 5;

/**
 * Reads a simple-custom-EQ body, as the app's `SimpleEQEntity` does:
 *
 *     [count][totalGain f32] then count × (type, gain f32, freq f32, Q f32)
 *
 * The whole band record is returned, not just the gains, for two reasons. The
 * band *order* is the device's, so a fixed Bass/Mid/Treble naming mislabels it
 * — the filter type is what says which is which. And a write built from the
 * device's own frequencies and Qs cannot overwrite them, which a fixed
 * template can and did.
 */
export function decodeCustomEq(payload: Uint8Array): CustomEq | null {
  if (payload.length < EQ_HEADER_LENGTH) return null;
  const count = payload[0];
  if (count === 0 || payload.length < EQ_HEADER_LENGTH + count * EQ_BAND_LENGTH) return null;

  const bands: EqBand[] = [];
  for (let i = 0; i < count; i += 1) {
    const at = EQ_HEADER_LENGTH + i * EQ_BAND_LENGTH;
    bands.push({
      filterType: payload[at],
      gain: decodeEqFloat(payload.subarray(at + 1, at + 5)),
      frequency: decodeEqFloat(payload.subarray(at + 5, at + 9)),
      q: decodeEqFloat(payload.subarray(at + 9, at + 13)),
    });
  }
  return { totalGain: decodeEqFloat(payload.subarray(1, 5)), bands };
}

/**
 * Serialises what `decodeCustomEq` read — `count * 13 + 5` bytes, the same
 * length the app's `obtainDataPacket` allocates.
 *
 * This replaced a hardcoded 53-byte template that carried one model's
 * frequencies and Qs (140 Hz / 980 Hz / 3500 Hz) plus nine trailing zero bytes,
 * and so imposed them on every model it was sent to.
 */
export function encodeCustomEq(eq: CustomEq): number[] {
  const out: number[] = [eq.bands.length, ...encodeEqFloat(eq.totalGain)];
  for (const band of eq.bands) {
    out.push(
      band.filterType,
      ...encodeEqFloat(band.gain),
      ...encodeEqFloat(band.frequency),
      ...encodeEqFloat(band.q),
    );
  }
  return out;
}

/** A human label for a band, from its filter shape rather than its position. */
export function eqBandLabel(band: EqBand): string {
  switch (band.filterType) {
    case EqFilter.LowShelf:
      return 'Bass';
    case EqFilter.HighShelf:
      return 'Treble';
    case EqFilter.Peak:
      return 'Mid';
    case EqFilter.LowPass:
      return 'Low pass';
    case EqFilter.HighPass:
      return 'High pass';
    default:
      return `${Math.round(band.frequency)} Hz`;
  }
}

// --- simple toggles and reads ------------------------------------------------

/** ASCII firmware string. The header's length byte says how long. */
export function decodeFirmware(payload: Uint8Array): string {
  return Array.from(payload, (b) => String.fromCharCode(b)).join('');
}

/**
 * The `B1xx` base code from a `DeviceModel` reply, or null for an empty body.
 *
 * **The body is not text.** It is the product id as raw bytes, little-endian:
 * the official app's `DeviceModelEntity` reverses the payload and hex-encodes
 * it uppercase —
 * `byteArray.reversed().joinToString("") { "%02X".format(it) }` — and uses the
 * result as the `productId` half of its `productId + colorHex` model lookup
 * (`EarOneUnknownDevice.getModelIdByTws`).
 *
 * Which means every `B1xx` code *is* four hex digits, and a CMF Headphone Pro
 * answers `[0x75, 0xB1]`, not the ASCII `"B175"`. The app's SKU catalogue
 * agrees: earphone `deviceSpu.modelId`s are 4-character codes and its watches'
 * are 8 (`34F72851`), exactly two and four bytes.
 *
 * An unrecognised id is returned as-is rather than rejected — the caller shows
 * the raw code, which beats an unnamed device.
 */
/**
 * The colourway id as the two-hex-digit string the CDN table is keyed by, or
 * null for an empty body.
 *
 * The official app's `DeviceColorEntity` takes `byteArray[0]` and formats it
 * `"%02X"` — the same `colorHex` it pairs with the product id to pick a
 * render. So `0x08` is `"08"`, which is exactly a `NOTHING_CDN_IMAGES` key.
 */
/**
 * Colourway names, from the app's `DeviceColor` enum — its ordinal is the byte
 * and its third field is the id string this driver uses as a key.
 *
 * Naming a colour and having a picture of it are different things: the render
 * table is generated from the app's SKU catalogue, which only lists the
 * colours that shipped by that app build. A device can legitimately report an
 * id the table has no image for.
 */
export const NOTHING_COLOUR_NAMES: Record<string, string> = {
  '00': 'None',
  '01': 'Black',
  '02': 'White',
  '03': 'Blue',
  '04': 'Black and white',
  '05': 'Red',
  '06': 'Green',
  '07': 'Orange',
  '08': 'Yellow',
  '09': 'Grey',
};

export const nothingColourName = (colourId: string | null): string | null =>
  colourId === null ? null : (NOTHING_COLOUR_NAMES[colourId] ?? null);

export function decodeColourId(payload: Uint8Array): string | null {
  if (payload.length === 0) return null;
  return payload[0].toString(16).padStart(2, '0').toUpperCase();
}

export function decodeDeviceModel(payload: Uint8Array): string | null {
  if (payload.length === 0) return null;
  return Array.from(payload)
    .reverse()
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');
}

/**
 * `GET_EXTRA_FEATURE_STATUS 0xc00e` is a *list*, not one flag: a count byte
 * then `(featureId, enabled)` pairs, per the app's `DeviceExtraFeatureStatus`.
 *
 * Returns null when the device answered but never mentioned this feature —
 * which is the difference between "off" and "absent". Reading `payload[2]`
 * unconditionally, as this did, returned the first pair's value whatever its
 * id, so a device that reports some *other* extra feature looked as though it
 * had this one.
 */
export function decodeExtraFeature(payload: Uint8Array, featureId: number): boolean | null {
  if (payload.length === 0) return null;
  const count = Math.min(payload[0], Math.floor((payload.length - 1) / 2));
  for (let i = 0; i < count; i += 1) {
    if (payload[1 + i * 2] === featureId) return payload[2 + i * 2] === 1;
  }
  return null;
}

/** Feature ids inside the extra-feature list. */
export const ExtraFeature = { InEarDetection: 1 } as const;

export const decodeInEarDetection = (payload: Uint8Array): boolean | null =>
  decodeExtraFeature(payload, ExtraFeature.InEarDetection);

/** `[count, featureId, enabled]` — the shape the app's `setEarDetect` writes. */
export const encodeInEarDetection = (on: boolean): number[] => [
  0x01,
  ExtraFeature.InEarDetection,
  on ? 0x01 : 0x00,
];

/** Low latency: 1 = on, 2 = off. */
export const decodeLatency = (payload: Uint8Array): boolean | null =>
  payload.length > 0 ? payload[0] === 1 : null;

/** `[0x01, 0x00]` to enable, `[0x02, 0x00]` to disable. */
export const encodeLatency = (on: boolean): number[] => [on ? 0x01 : 0x02, 0x00];

/** Personalized ANC (Ear (2)): first payload byte. */
export interface PersonalizedAnc {
  enabled: boolean;
  /**
   * Calibration state, as the device reports it. The app pairs this with a
   * `SET_CALIBRATION 0xf012` action to (re)run the fitting; we only read it.
   */
  calibration: number;
}

/**
 * `[switch, calibration]` — the app's `DeviceANCSwitch`, which
 * `PersonalizedANCComponents` maps this command's reply onto. The second byte
 * used to be dropped.
 */
export const decodePersonalizedAnc = (payload: Uint8Array): PersonalizedAnc | null =>
  payload.length === 0 ? null : { enabled: payload[0] === 1, calibration: payload[1] ?? 0 };

export const encodePersonalizedAnc = (on: boolean): number[] => [on ? 0x01 : 0x00];

export interface SpatialAudio {
  enabled: boolean;
  /**
   * Head tracking, on models that carry the second byte; null where the reply
   * was one byte, meaning this model has spatial audio without it.
   */
  headTracking: boolean | null;
}

/**
 * Spatial audio: `[enabled]`, or `[enabled, headTracking]` on models that
 * track the head as well.
 *
 * Both bytes are the official app's `BasicBoolean` entity, which parses
 * exactly this — `open = payload[0] == 1`, then `head = payload[1] == 1` only
 * `if (payload.length > 1)` — and re-encodes it the same way. `GET_SPATIAL_
 * AUDIO 0xc04f` / `SET_SPATIAL_AUDIO 0xf052` are its commands, built by
 * `TWSDeviceExtKt.spatialAudio(device, enabled, head)`.
 *
 * Null for an empty body, rather than guessing at a state.
 */
export const decodeSpatialAudio = (payload: Uint8Array): SpatialAudio | null =>
  payload.length < 1
    ? null
    : {
        enabled: payload[0] === 0x01,
        headTracking: payload.length > 1 ? payload[1] === 0x01 : null,
      };

/**
 * Writes one byte, or two when the model has head tracking — the app omits
 * the second byte entirely rather than sending a zero, so this does too.
 */
export const encodeSpatialAudio = (enabled: boolean, headTracking?: boolean | null): number[] =>
  headTracking === undefined || headTracking === null
    ? [enabled ? 0x01 : 0x00]
    : [enabled ? 0x01 : 0x00, headTracking ? 0x01 : 0x00];

/**
 * `[side, playing]`, or just `[playing]` on the one legacy model.
 *
 * The side byte is the same device id the battery, wear state and gesture
 * records use: `0x02` left, `0x03` right, and **`0x06` for a single-body
 * device** — which does have a ringer, contrary to what this comment used to
 * claim. From BudsLink's `setRingMyBuds`, which branches on `batterySingle`
 * exactly this way, corroborated by the white list's `findDevice: 1` on the
 * over-ears.
 *
 * The Ear (1) omits the side byte altogether (BudsLink's `ringLegacy`); it is
 * the only model that does.
 */
export const encodeRing = (
  side: 'left' | 'right' | 'single',
  playing: boolean,
  options: { legacy?: boolean } = {},
): number[] => {
  const state = playing ? 0x01 : 0x00;
  if (options.legacy) return [state];
  const device =
    side === 'single'
      ? GestureDevice.Single
      : side === 'left'
        ? GestureDevice.Left
        : GestureDevice.Right;
  return [device, state];
};

/** Advanced EQ: first payload byte. */
export const decodeAdvancedEq = (payload: Uint8Array): boolean | null =>
  payload.length > 0 ? payload[0] === 1 : null;

export const encodeAdvancedEq = (on: boolean): number[] => [on ? 0x01 : 0x00, 0x00];

/** Enhanced bass: enabled + level; the wire level is doubled. */
export function decodeEnhancedBass(payload: Uint8Array): { enabled: boolean; level: number } | null {
  if (payload.length < 2) return null;
  return { enabled: payload[0] === 1, level: payload[1] / 2 };
}

export const encodeEnhancedBass = (enabled: boolean, level: number): number[] => [
  enabled ? 0x01 : 0x00,
  level * 2,
];

/**
 * The Dirac Opteo EQ preset, as Buds Pro 2 / CMF Buds report it — those models
 * have no classic EQ presets (`eq: 0` in the official app's config) and use
 * this selector instead. Same wire command ear-web calls "listening mode";
 * the preset names come from its per-model pages, which match the official
 * app's own labels (`DiracEQMode`, "DIRAC Opteo").
 */
export const DiracPreset = {
  Opteo: 0,
  Rock: 1,
  Electronic: 2,
  Pop: 3,
  EnhanceVocals: 4,
  Classical: 5,
  Custom: 6,
} as const;

export const DIRAC_PRESET_NAMES: Record<number, string> = {
  [DiracPreset.Opteo]: 'Dirac Opteo',
  [DiracPreset.Rock]: 'Rock',
  [DiracPreset.Electronic]: 'Electronic',
  [DiracPreset.Pop]: 'Pop',
  [DiracPreset.EnhanceVocals]: 'Enhance vocals',
  [DiracPreset.Classical]: 'Classical',
  [DiracPreset.Custom]: 'Custom',
};

export const decodeDiracPreset = (payload: Uint8Array): number | null =>
  payload.length > 0 ? payload[0] : null;

export const encodeDiracPreset = (preset: number): number[] => [preset, 0x00];

// --- gestures ----------------------------------------------------------------

/**
 * One key assignment, exactly as `ControlConfigurationEntity` lays it out —
 * `(device, button, gesture, operation)`, one byte each, from that class's own
 * `INDEX_DEVICE`/`INDEX_BUTTON`/`INDEX_GESTURE`/`INDEX_OPERATION`.
 *
 * The middle byte was previously called `common` and treated as filler; it is
 * the **button**, and writing it back as a constant reassigns whichever
 * control happens to be button 1.
 */
export interface Gesture {
  /** 2 = left bud, 3 = right bud — the same device ids the battery uses. */
  device: number;
  /** Which control the assignment is on. See `GestureButton`. */
  button: number;
  /** What is done to that control. See `GestureInput`. */
  gesture: number;
  /** What it triggers. See `GestureOperation`. */
  operation: number;
}

/** `BUTTON_*` in `ControlConfigurationEntity`. */
/**
 * Device ids a gesture record can carry. Not just the pair: a single-body
 * device uses **6**, the same id its battery and wear state use — confirmed by
 * BudsLink's B175 gesture slots, every one of which is `device: 0x06`.
 */
export const GestureDevice = { Left: 2, Right: 3, Single: 6 } as const;

export const GestureButton = {
  Function: 1,
  VolumeUp: 2,
  VolumeDown: 3,
  Anc: 4,
  SwipeUp: 5,
  SwipeDown: 6,
} as const;

/**
 * `GESTURE_*`. The app defines two naming schemes over the same numbers — tap
 * and press — so each id appears once here under the tap name.
 */
export const GestureInput = {
  SlideOnSystem: 0,
  Tap: 1,
  DoubleTap: 2,
  TripleTap: 3,
  SixTap: 4,
  Swipe: 5,
  FlashSwipe: 6,
  LongPress: 7,
  OverlongPress: 8,
  /** Also `GESTURE_SHOW_SWIPE`. */
  TripleTapAndLongPress: 9,
  Rotate: 10,
  PressFive: 12,
  DoublePressInner: 13,
  LongPressInner: 14,
  CaseLock: 15,
  Roll: 17,
  PaddleClick: 18,
  PaddleHold: 19,
} as const;

/** `OPERATION_*`. */
export const GestureOperation = {
  None: 1,
  PlayPause: 2,
  AnswerOrHangUp: 3,
  Reject: 4,
  HoldThirdPartyCall: 5,
  VolumeUp: 6,
  VolumeDown: 7,
  Previous: 8,
  Next: 9,
  AncCycle: 10,
  VoiceAssistant: 11,
  GoogleAssistant: 12,
  Bisto: 13,
  Alexa: 14,
  FavouriteMusic: 15,
  ComfortableMode: 16,
  GameMode: 17,
  HoldVolumeUp: 18,
  HoldVolumeDown: 19,
  AncOff: 20,
  TransparencyOff: 21,
  AncTransparency: 22,
  RotateControl: 23,
  PairMode: 24,
  MicMute: 25,
  AnswerDeclineCall: 26,
  SpatialAudio: 27,
  BassEnhancement: 28,
  Mic: 29,
  NewsWidget: 31,
  NothingRadio: 32,
  EssentialSpace: 33,
  EqPreset: 34,
  /**
   * 35 and 36 are absent from `ControlConfigurationEntity`'s constants but
   * present in the white list (`control_operation_ultra_bass` /
   * `control_operation_treble_enhance`) and in BudsLink's B175 action map
   * (`ultra-bass: 0x23`, `treble-enhance: 0x24`).
   */
  UltraBass: 35,
  TrebleEnhance: 36,
  SwitchBluetooth: 39,
  CaseLock: 40,
  VolumeUpOrDown: 255,
} as const;

/**
 * Payload: count byte, then 4-byte records — `toMultiValues(bytes, 1, 1,1,1,1)`
 * in the app.
 */
export function decodeGestures(payload: Uint8Array): Gesture[] {
  if (payload.length === 0) return [];
  const count = Math.min(payload[0], Math.floor((payload.length - 1) / 4));
  const gestures: Gesture[] = [];
  for (let i = 0; i < count; i += 1) {
    gestures.push({
      device: payload[1 + i * 4],
      button: payload[2 + i * 4],
      gesture: payload[3 + i * 4],
      operation: payload[4 + i * 4],
    });
  }
  return gestures;
}

/**
 * `[0x01, device, button, gesture, operation]` — one record, count-prefixed.
 *
 * The button is carried through from the record being edited. Sending a
 * constant `0x01` here, as this used to, silently retargets the assignment at
 * the function button.
 */
export const encodeGesture = (gesture: Gesture): number[] => [
  0x01,
  gesture.device,
  gesture.button,
  gesture.gesture,
  gesture.operation,
];

// --- find my earbuds / ear tip fit test ---------------------------------------

export const encodeEarFitTest = (): number[] => [0x01];

export interface EarFitResult {
  left: number;
  right: number;
}

export const decodeEarFitResult = (payload: Uint8Array): EarFitResult | null =>
  payload.length >= 2 ? { left: payload[0], right: payload[1] } : null;

// --- wear state --------------------------------------------------------------

export interface EarphoneFlags {
  /** In the case; on the *case*'s own entry this bit means "lid open". */
  inCase: boolean;
  inEar: boolean;
  connected: boolean;
  onCall: boolean;
  /** Mid firmware update. */
  ota: boolean;
}

export interface EarphoneStatus {
  left: EarphoneFlags | null;
  right: EarphoneFlags | null;
  case: EarphoneFlags | null;
  /** The one entry a single-body device reports. */
  single: EarphoneFlags | null;
}

/**
 * `GET_EARPHONE_STATUS 0xc00a`, and the `0xe002` push: a count byte then
 * `(deviceId, flags)` pairs, device ids as the battery's. Flag bits are the
 * app's `EarphoneStatus` masks.
 */
export function decodeEarphoneStatus(payload: Uint8Array): EarphoneStatus {
  const result: EarphoneStatus = { left: null, right: null, case: null, single: null };
  if (payload.length === 0) return result;
  const count = Math.min(payload[0], Math.floor((payload.length - 1) / 2));
  for (let i = 0; i < count; i += 1) {
    const slot = BATTERY_SLOTS[payload[1 + i * 2]];
    if (!slot) continue;
    const bits = payload[2 + i * 2];
    result[slot] = {
      inCase: (bits & 0x01) !== 0,
      inEar: (bits & 0x04) !== 0,
      onCall: (bits & 0x10) !== 0,
      ota: (bits & 0x20) !== 0,
      connected: (bits & 0x80) !== 0,
    };
  }
  return result;
}

/** True when any reporting part of the device says it is being worn. */
export const isWorn = (status: EarphoneStatus | null): boolean =>
  status !== null &&
  [status.left, status.right, status.single].some((cell) => cell?.inEar === true);

// --- device configuration ----------------------------------------------------

export interface DeviceConfigValue {
  device: number;
  type: number;
  value: string;
}

/** `TYPE_*` in the app's `DeviceConfiguration`. */
export const ConfigType = {
  HardwareVersion: 1,
  SoftwareVersion: 2,
  CopySoftwareVersion: 3,
  SerialNumber: 4,
  ManufactureDate: 5,
} as const;

/**
 * `GET_REMOTE_CONFIGURATION 0xc006`. Not a binary structure: a count byte,
 * then ASCII — newline-separated lines of `device,type,value`. Lines that are
 * not three comma-separated fields are skipped, as the app skips them.
 */
export function decodeConfiguration(payload: Uint8Array): DeviceConfigValue[] {
  if (payload.length < 2) return [];
  const text = Array.from(payload.subarray(1), (b) => String.fromCharCode(b)).join('');
  const out: DeviceConfigValue[] = [];
  for (const line of text.trim().split('\n')) {
    const parts = line.split(',');
    if (parts.length !== 3) continue;
    const device = Number(parts[0]);
    const type = Number(parts[1]);
    if (!Number.isFinite(device) || !Number.isFinite(type)) continue;
    out.push({ device, type, value: parts[2] });
  }
  return out;
}

/** The first value of a given type, whichever device reported it. */
export const configValue = (values: DeviceConfigValue[], type: number): string | null =>
  values.find((entry) => entry.type === type)?.value ?? null;

// --- clarity boost -----------------------------------------------------------

export const ClarityLevel = { Low: 0, Mid: 1, High: 2 } as const;

export interface ClarityBoost {
  enabled: boolean;
  level: number;
}

/** `[enabled, level]` — the app's `ClarityBoostEntity`, both directions. */
export const decodeClarityBoost = (payload: Uint8Array): ClarityBoost | null =>
  payload.length === 0 ? null : { enabled: payload[0] === 1, level: payload[1] ?? 0 };

export const encodeClarityBoost = (enabled: boolean, level: number): number[] => [
  enabled ? 0x01 : 0x00,
  level,
];

// --- single-byte switches ----------------------------------------------------

/**
 * Multipoint, smart ANC, smart free and LHDC all read and write one byte.
 * Their builders in the app (`dual`, `smartAnc`, `smartFree`, `lhdc`) differ
 * only in which command they carry.
 */
export const decodeSwitch = (payload: Uint8Array): boolean | null =>
  payload.length === 0 ? null : payload[0] === 1;

export const encodeSwitch = (on: boolean): number[] => [on ? 0x01 : 0x00];

// --- advanced 8-band EQ ------------------------------------------------------

export interface AdvancedEq {
  /** Which stored profile the bands belong to. */
  profileIndex: number;
  totalGain: number;
  bands: EqBand[];
}

/** profileIndex(1) + band count(1) + total gain(4). */
const ADVANCED_EQ_HEADER_LENGTH = 6;

/** How many bands an uninitialised reply implies — `EQEntity`'s own default. */
const ADVANCED_EQ_BANDS = 8;

/**
 * Default centre frequency and its allowed range per band, from `EQEntity`'s
 * `DEFAULT_FREQUENCY`. Used to label a band and bound an edit; the device sends
 * its own frequencies, and `EQEntity` falls back to these when one is outside
 * the range.
 */
export const ADVANCED_EQ_FREQUENCIES: ReadonlyArray<{ hz: number; min: number; max: number }> = [
  { hz: 55, min: 20, max: 99 },
  { hz: 110, min: 100, max: 199 },
  { hz: 220, min: 200, max: 399 },
  { hz: 440, min: 400, max: 999 },
  { hz: 1320, min: 1000, max: 2999 },
  { hz: 3300, min: 3000, max: 5999 },
  { hz: 6600, min: 6000, max: 11999 },
  { hz: 13200, min: 12000, max: 20000 },
];

/**
 * The advanced EQ's band values, per `EQEntity`:
 *
 *     [profileIndex][count][totalGain f32] then count × 13-byte bands
 *
 * Same band record as the simple custom EQ, one byte further in — the header
 * carries a profile index the simple form does not. A count of zero means the
 * profile has never been written, which `EQEntity` reads as eight bands.
 */
export function decodeAdvancedEqBands(payload: Uint8Array): AdvancedEq | null {
  if (payload.length < ADVANCED_EQ_HEADER_LENGTH) return null;
  const declared = payload[1];
  const count = declared === 0 ? ADVANCED_EQ_BANDS : declared;
  if (payload.length < ADVANCED_EQ_HEADER_LENGTH + count * EQ_BAND_LENGTH) return null;

  const bands: EqBand[] = [];
  for (let i = 0; i < count; i += 1) {
    const at = ADVANCED_EQ_HEADER_LENGTH + i * EQ_BAND_LENGTH;
    bands.push({
      filterType: payload[at],
      gain: decodeEqFloat(payload.subarray(at + 1, at + 5)),
      frequency: decodeEqFloat(payload.subarray(at + 5, at + 9)),
      q: decodeEqFloat(payload.subarray(at + 9, at + 13)),
    });
  }
  return {
    profileIndex: payload[0],
    totalGain: decodeEqFloat(payload.subarray(2, 6)),
    bands,
  };
}

export function encodeAdvancedEqBands(eq: AdvancedEq): number[] {
  const out: number[] = [eq.profileIndex, eq.bands.length, ...encodeEqFloat(eq.totalGain)];
  for (const band of eq.bands) {
    out.push(
      band.filterType,
      ...encodeEqFloat(band.gain),
      ...encodeEqFloat(band.frequency),
      ...encodeEqFloat(band.q),
    );
  }
  return out;
}

// --- clock and one-shot actions ----------------------------------------------

/**
 * `SET_UTC_TIME`: epoch seconds as four **big-endian** bytes. Big-endian here
 * and little-endian for EQ floats, which is the protocol's own inconsistency,
 * not a mistake — BudsLink's `_setUTCtime` writes it the same way.
 */
export function encodeUtcTime(when: Date = new Date()): number[] {
  const seconds = Math.floor(when.getTime() / 1000);
  return [(seconds >>> 24) & 0xff, (seconds >>> 16) & 0xff, (seconds >>> 8) & 0xff, seconds & 0xff];
}

/** `SET_CALIBRATION` — the app's `calibration()` builder sends a bare `[1]`. */
export const encodeStartCalibration = (): number[] => [0x01];

// --- gesture labels ----------------------------------------------------------

const GESTURE_DEVICE_NAMES: Record<number, string> = {
  [GestureDevice.Left]: 'Left bud',
  [GestureDevice.Right]: 'Right bud',
  [GestureDevice.Single]: 'Headphone',
};

const GESTURE_BUTTON_NAMES: Record<number, string> = {
  [GestureButton.Function]: 'Button',
  [GestureButton.VolumeUp]: 'Volume up',
  [GestureButton.VolumeDown]: 'Volume down',
  [GestureButton.Anc]: 'Noise control',
  [GestureButton.SwipeUp]: 'Swipe up',
  [GestureButton.SwipeDown]: 'Swipe down',
  // BudsLink's B175 slots use ids the entity class does not name: 0x0A the
  // magic button and 0x08 the scroll wheel. Its roller is 0x01 and its slider
  // 0x05, which collide with `Function` and `SwipeUp` above — the same byte
  // means a different control on a different body, so the generic name stays
  // and the specific ones are added only where there is no clash.
  0x0a: 'Magic button',
  0x08: 'Scroll wheel',
};

const GESTURE_INPUT_NAMES: Record<number, string> = {
  [GestureInput.Tap]: 'Single press',
  [GestureInput.DoubleTap]: 'Double press',
  [GestureInput.TripleTap]: 'Triple press',
  [GestureInput.SixTap]: 'Six presses',
  [GestureInput.Swipe]: 'Swipe',
  [GestureInput.FlashSwipe]: 'Quick swipe',
  [GestureInput.LongPress]: 'Press and hold',
  [GestureInput.OverlongPress]: 'Long hold',
  [GestureInput.TripleTapAndLongPress]: 'Triple press and hold',
  [GestureInput.Rotate]: 'Rotate',
  [GestureInput.PressFive]: 'Five presses',
  [GestureInput.DoublePressInner]: 'Double press (inner)',
  [GestureInput.LongPressInner]: 'Hold (inner)',
  [GestureInput.CaseLock]: 'Case lock',
  [GestureInput.Roll]: 'Roll',
  [GestureInput.PaddleClick]: 'Paddle click',
  [GestureInput.PaddleHold]: 'Paddle hold',
};

export const gestureDeviceLabel = (device: number): string =>
  GESTURE_DEVICE_NAMES[device] ?? `Device ${device}`;

/** `"Magic button · Press and hold"`, or the raw bytes when unnamed. */
export function gestureLabel(gesture: Gesture): string {
  const button = GESTURE_BUTTON_NAMES[gesture.button] ?? `Button ${gesture.button}`;
  const input = GESTURE_INPUT_NAMES[gesture.gesture] ?? `Gesture ${gesture.gesture}`;
  return `${button} · ${input}`;
}

export const GESTURE_OPERATION_NAMES: Record<number, string> = {
  [GestureOperation.None]: 'Nothing',
  [GestureOperation.PlayPause]: 'Play / pause',
  [GestureOperation.AnswerOrHangUp]: 'Answer / hang up',
  [GestureOperation.VolumeUp]: 'Volume up',
  [GestureOperation.VolumeDown]: 'Volume down',
  [GestureOperation.Previous]: 'Previous track',
  [GestureOperation.Next]: 'Next track',
  [GestureOperation.AncCycle]: 'Noise control',
  [GestureOperation.VoiceAssistant]: 'Voice assistant',
  [GestureOperation.HoldVolumeUp]: 'Hold for volume up',
  [GestureOperation.HoldVolumeDown]: 'Hold for volume down',
  [GestureOperation.AncOff]: 'Noise cancelling off',
  [GestureOperation.TransparencyOff]: 'Transparency off',
  [GestureOperation.AncTransparency]: 'Noise control ↔ transparency',
  [GestureOperation.MicMute]: 'Mute microphone',
  [GestureOperation.SpatialAudio]: 'Spatial audio',
  [GestureOperation.BassEnhancement]: 'Bass enhancement',
  [GestureOperation.Mic]: 'Microphone',
  [GestureOperation.NewsWidget]: 'News',
  [GestureOperation.NothingRadio]: 'Nothing radio',
  [GestureOperation.EssentialSpace]: 'Essential Space',
  [GestureOperation.EqPreset]: 'Equalizer preset',
  [GestureOperation.UltraBass]: 'Ultra bass',
  [GestureOperation.TrebleEnhance]: 'Treble enhance',
  [GestureOperation.GameMode]: 'Game mode',
  [GestureOperation.PairMode]: 'Pairing mode',
  [GestureOperation.SwitchBluetooth]: 'Switch device',
};
