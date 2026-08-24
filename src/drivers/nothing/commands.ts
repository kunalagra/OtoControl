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
} as const;

/** Unsolicited notifications (0xE0xx). */
export const Notify = {
  Battery: 0xe001,
  AncMode: 0xe003,
  EarFitTestResult: 0xe00d,
} as const;

// --- ANC --------------------------------------------------------------------

/**
 * The six listening modes a Nothing device reports, in ear-web's level
 * numbering. The wire byte each maps to is not derivable — see ANC_WIRE.
 */
export const AncLevel = {
  Off: 1,
  Transparency: 2,
  NcLow: 3,
  NcHigh: 4,
  NcMid: 5,
  Adaptive: 6,
} as const;

export type AncLevelId = (typeof AncLevel)[keyof typeof AncLevel];

/** ear-web's level → wire-byte table, which follows no visible pattern. */
const ANC_WIRE: Record<number, number> = {
  [AncLevel.Off]: 0x05,
  [AncLevel.Transparency]: 0x07,
  [AncLevel.NcLow]: 0x03,
  [AncLevel.NcHigh]: 0x01,
  [AncLevel.NcMid]: 0x02,
  [AncLevel.Adaptive]: 0x04,
};

const ANC_FROM_WIRE: Record<number, number> = Object.fromEntries(
  Object.entries(ANC_WIRE).map(([level, wire]) => [wire, Number(level)]),
);

/** `[0x01, wireByte, 0x00]` — the fixed shape every model uses. */
export const encodeAncMode = (level: number): number[] => [0x01, ANC_WIRE[level] ?? 0x05, 0x00];

/** The reply carries the wire byte as its second payload byte. */
export const decodeAncMode = (payload: Uint8Array): number | null =>
  payload.length > 1 ? (ANC_FROM_WIRE[payload[1]] ?? null) : null;

// --- battery ----------------------------------------------------------------

export interface BatteryCell {
  level: number;
  charging: boolean;
}

export interface TripleBattery {
  left: BatteryCell | null;
  right: BatteryCell | null;
  case: BatteryCell | null;
}

/** Payload: count, then (deviceId, level) pairs. Bit 7 of level = charging. */
export function decodeBattery(payload: Uint8Array): TripleBattery {
  const result: TripleBattery = { left: null, right: null, case: null };
  if (payload.length === 0) return result;
  const count = Math.min(payload[0], Math.floor((payload.length - 1) / 2));
  const slots: Record<number, keyof TripleBattery> = { 0x02: 'left', 0x03: 'right', 0x04: 'case' };
  for (let i = 0; i < count; i += 1) {
    const slot = slots[payload[1 + i * 2]];
    if (!slot) continue;
    const raw = payload[2 + i * 2];
    result[slot] = { level: raw & 0x7f, charging: (raw & 0x80) !== 0 };
  }
  return result;
}

// --- EQ ---------------------------------------------------------------------

/** Preset ids as the device reports them. 4 is unused; 5 means custom. */
export const EqPreset = {
  Balanced: 0,
  Voice: 1,
  Treble: 2,
  Bass: 3,
  Custom: 5,
  /** Not a real preset id: read from the advanced-EQ status instead. */
  Advanced: 6,
} as const;

export const EQ_PRESET_NAMES: Record<number, string> = {
  [EqPreset.Balanced]: 'Balanced',
  [EqPreset.Voice]: 'Voice',
  [EqPreset.Treble]: 'Treble',
  [EqPreset.Bass]: 'Bass',
  [EqPreset.Custom]: 'Custom',
};

export const encodeEqPreset = (preset: number): number[] => [preset, 0x00];
export const decodeEqPreset = (payload: Uint8Array): number | null =>
  payload.length > 0 ? payload[0] : null;

/**
 * The custom EQ's float encoding, ported exactly from ear-web's
 * `formatFloatForEQ` / `fromFormatFloatForEQ`: a big-endian float32 with the
 * four bytes reversed, plus a sign hack where a denormal-zero byte pattern
 * carries the sign in the last byte's bit 7. Reproducing the *rationale* is
 * hopeless; reproducing the *bytes* is mandatory.
 */
export function encodeEqFloat(value: number, total = false): number[] {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setFloat32(0, value, false);
  const bytes = Array.from(new Uint8Array(buffer));
  if (value !== 0 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0) {
    bytes[3] = (bytes[3] | 0x80) & 0xff;
  }
  bytes.reverse();
  if (total) return [0x00, 0x00, 0x00, value >= 0 ? 0x80 : 0x00];
  return bytes;
}

export function decodeEqFloat(bytes: number[]): number {
  const array = [...bytes].reverse();
  let sign = 1;
  if (array[0] === 0 && array[1] === 0 && array[2] === 0 && array[3] & 0x80) {
    array[3] = array[3] & 0x7f;
    sign = -1;
  }
  const buffer = new ArrayBuffer(4);
  new Uint8Array(buffer).set(array);
  return sign * new DataView(buffer).getFloat32(0, false);
}

/**
 * The fixed 53-byte custom-EQ payload, same for every post-Ear-(1) model.
 * `bands` is the three slot values in wire-slot order (band 0 at bytes 6–9,
 * band 1 at 19–22, band 2 at 32–35).
 */
export function encodeCustomEq(bands: [number, number, number]): number[] {
  const payload = [
    0x03, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x75, 0x44, 0xc3,
    0xf5, 0x28, 0x3f, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0xc0, 0x5a, 0x45, 0x00, 0x00, 0x80,
    0x3f, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0c, 0x43, 0xcd, 0xcc, 0x4c, 0x3f, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ];

  const highest = Math.max(...bands) * -1;
  const head = encodeEqFloat(highest, true);
  for (let j = 0; j < 4; j += 1) payload[1 + j] = head[j];

  for (let i = 0; i < 3; i += 1) {
    const bytes = encodeEqFloat(bands[i], false);
    for (let j = 0; j < 4; j += 1) payload[6 + i * 13 + j] = bytes[j];
  }
  return payload;
}

/**
 * Reads the three band floats back out, in the same slot order the writer
 * used, so a value round-trips.
 *
 * ear-web's read path permutes the bands (`[slot2, slot0, slot1]`) while its
 * write path does not — an asymmetry in their code, kept out of ours on
 * purpose: with it, a value read from the device would not write back to the
 * slots it came from. The wire bytes are unaffected either way; only which
 * band we *call* bass is, and that is adjustable against hardware.
 */
export function decodeCustomEq(payload: Uint8Array): [number, number, number] | null {
  if (payload.length < 6 + 3 * 13) return null;
  const slots: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    slots.push(decodeEqFloat(Array.from(payload.slice(6 + i * 13, 10 + i * 13))));
  }
  return [slots[0], slots[1], slots[2]];
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
export function decodeDeviceModel(payload: Uint8Array): string | null {
  if (payload.length === 0) return null;
  return Array.from(payload)
    .reverse()
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');
}

/** In-ear detection: third payload byte, 1 = on. */
export const decodeInEarDetection = (payload: Uint8Array): boolean | null =>
  payload.length > 2 ? payload[2] === 1 : null;

/** `[0x01, 0x01, on]`. */
export const encodeInEarDetection = (on: boolean): number[] => [0x01, 0x01, on ? 0x01 : 0x00];

/** Low latency: 1 = on, 2 = off. */
export const decodeLatency = (payload: Uint8Array): boolean | null =>
  payload.length > 0 ? payload[0] === 1 : null;

/** `[0x01, 0x00]` to enable, `[0x02, 0x00]` to disable. */
export const encodeLatency = (on: boolean): number[] => [on ? 0x01 : 0x02, 0x00];

/** Personalized ANC (Ear (2)): first payload byte. */
export const decodePersonalizedAnc = (payload: Uint8Array): boolean | null =>
  payload.length > 0 ? payload[0] === 1 : null;

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
 * `[side, playing]` — the side byte is 0x02 left, 0x03 right on every
 * earbud model (0x06 marks the single-battery over-ears, which have no
 * ringer). Stopping a ring reuses the side with a silent second byte.
 */
export const encodeRing = (side: 'left' | 'right', playing: boolean): number[] => [
  side === 'left' ? 0x02 : 0x03,
  playing ? 0x01 : 0x00,
];

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

export interface Gesture {
  /** 2 = left bud, 3 = right bud. */
  device: number;
  /** ear-web's `gestureCommon` byte — type context, passed through unchanged. */
  common: number;
  /** 2 double pinch, 3 triple pinch, 7 pinch and hold, 9 double pinch and hold. */
  type: number;
  /** 8 play/pause, 9 next, 10 ANC cycle, 18/19 volume, 11 previous, 1 assistant. */
  action: number;
}

/** Payload: count, then 4-byte records with one filler byte each. */
export function decodeGestures(payload: Uint8Array): Gesture[] {
  if (payload.length === 0) return [];
  const count = Math.min(payload[0], Math.floor((payload.length - 1) / 4));
  const gestures: Gesture[] = [];
  for (let i = 0; i < count; i += 1) {
    gestures.push({
      device: payload[1 + i * 4],
      common: payload[2 + i * 4],
      type: payload[3 + i * 4],
      action: payload[4 + i * 4],
    });
  }
  return gestures;
}

/** `[0x01, device, 0x01, type, action]`. */
export const encodeGesture = (gesture: Gesture): number[] => [
  0x01,
  gesture.device,
  0x01,
  gesture.type,
  gesture.action,
];

// --- find my earbuds / ear tip fit test ---------------------------------------

export const encodeEarFitTest = (): number[] => [0x01];

export interface EarFitResult {
  left: number;
  right: number;
}

export const decodeEarFitResult = (payload: Uint8Array): EarFitResult | null =>
  payload.length >= 2 ? { left: payload[0], right: payload[1] } : null;
