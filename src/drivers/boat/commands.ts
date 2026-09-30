/**
 * Bluetrum command ids and payload codecs.
 *
 * Every id is verbatim from `com/bluetrum/devicemanager/cmd/Command.java`
 * in the boAt Hearables decompile (verified live during implementation);
 * every layout from the matching `cmd/request/`, `cmd/payloadhandler/`
 * and `models/` class cited below. Layouts the decompile registers but
 * whose bodies were not read stay absent here rather than guessed.
 */

/** Setter / query command bytes (`Command.java`). */
export const Cmd = {
  Eq: 32,
  MusicControl: 33,
  Key: 34,
  AutoShutdown: 35,
  FactoryReset: 36,
  WorkMode: 37,
  InEarDetect: 38,
  DeviceInfo: 39,
  Notify: 40,
  Language: 41,
  FindDevice: 42,
  AutoAnswer: 43,
  /** @deprecated — prefer Anc (53). */
  AncMode: 44,
  BluetoothName: 45,
  LedMode: 46,
  ClearPairRecord: 47,
  /** @deprecated — prefer Anc (53). */
  AncGain: 48,
  /** @deprecated — prefer Anc (53). */
  TransparencyGain: 49,
  /** One wire id, two names (`Command.java`). */
  SpatialAudio: 50,
  SoundEffect3d: 50,
  Multipoint: 51,
  VoiceRecognition: 52,
  Anc: 53,
  BassEngine: 54,
  AntiWindNoise: 55,
  /** Fire-and-forget OTA (`OtaRequest.java`, `withResponse() == false`). */
  OtaGetInfo: -96,
  OtaStart: -95,
  OtaSendData: -94,
  OtaState: -93,
} as const;

/** Device-info / notification ids (`Command.java` `INFO_*`). */
export const Info = {
  Power: 1,
  FirmwareVersion: 2,
  BluetoothName: 3,
  EqSetting: 4,
  KeySettings: 5,
  Volume: 6,
  PlayState: 7,
  WorkMode: 8,
  InEarStatus: 9,
  Language: 10,
  AutoAnswer: 11,
  AncMode: 12,
  IsTws: 13,
  TwsConnected: 14,
  LedSwitch: 15,
  FirmwareChecksum: 16,
  AncGain: 17,
  TransparencyGain: 18,
  AncGainCount: 19,
  TransparencyGainCount: 20,
  AllEqSettings: 21,
  MainSide: 22,
  ProductColour: 23,
  SpatialAudioMode: 24,
  MultipointStatus: 25,
  MultipointInfo: 26,
  /** No INFO_27 exists — the default poll skips from 26 to 28. */
  VoiceRecognition: 28,
  AncFadeStatus: 29,
  BassEngineStatus: 30,
  BassEngineValue: 31,
  BassEngineRange: 32,
  AntiWindNoise: 33,
  LdacStatus: 42,
  MaxPacketSize: -1,
  Capabilities: -2,
} as const;

/** `DeviceCapacities.java` bitmask (2-byte LE, info `-2`). */
export const CAP = {
  Tws: 1,
  Spatial: 2,
  Multipoint: 4,
  Anc: 8,
  Voice: 16,
  Bass: 32,
  AntiWind: 64,
} as const;

/**
 * The app's default poll (`DeviceInfoRequest.d`) — 34 ids, skipping the
 * non-existent 27. `NOTIFICATION_MULTIPOINT_EVENT = 27` lives in the
 * notification space, not this one.
 */
export const DEVICE_INFO_DEFAULT_IDS: readonly number[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
  23, 24, 25, 26, 28, 29, 30, 31, 32, 33, 42, -2,
];

/** `DeviceInfoRequest.requireInfo`: flat `[infoId, 0x00]` pairs, no lengths. */
export function encodeDeviceInfoQuery(ids: readonly number[]): Uint8Array {
  const out = new Uint8Array(ids.length * 2);
  ids.forEach((id, i) => {
    out[i * 2] = id & 0xff;
    out[i * 2 + 1] = 0x00;
  });
  return out;
}

/** `TlvRequest.generateTlvData`: `[tag, len, value…]` per entry. */
export function encodeTlv(entries: ReadonlyArray<readonly [tag: number, value: readonly number[]]>): Uint8Array {
  const size = entries.reduce((n, [, v]) => n + 2 + v.length, 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const [tag, value] of entries) {
    out[at] = tag & 0xff;
    out[at + 1] = value.length;
    out.set(value, at + 2);
    at += 2 + value.length;
  }
  return out;
}

// --- scalars -----------------------------------------------------------------

const u8 = (payload: Uint8Array, i: number): number => payload[i] & 0xff;

/** `BooleanPayloadHandler`: exactly 1 byte, `0→false, 1→true`, else null. */
export function decodeBoolean(payload: Uint8Array): boolean | null {
  if (payload.length !== 1) return null;
  if (payload[0] === 0) return false;
  if (payload[0] === 1) return true;
  return null;
}

/** `BytePayloadHandler`: exactly 1 byte. */
export function decodeByte(payload: Uint8Array): number | null {
  return payload.length === 1 ? u8(payload, 0) : null;
}

/** `DeviceCapacitiesPayloadHandler`: exactly 2 bytes LE. */
export interface DeviceCapabilities {
  tws: boolean;
  spatial: boolean;
  multipoint: boolean;
  anc: boolean;
  voice: boolean;
  bass: boolean;
  antiWind: boolean;
}

export function decodeCapabilities(payload: Uint8Array): DeviceCapabilities | null {
  if (payload.length !== 2) return null;
  const bits = u8(payload, 0) | (u8(payload, 1) << 8);
  return {
    tws: (bits & CAP.Tws) !== 0,
    spatial: (bits & CAP.Spatial) !== 0,
    multipoint: (bits & CAP.Multipoint) !== 0,
    anc: (bits & CAP.Anc) !== 0,
    voice: (bits & CAP.Voice) !== 0,
    bass: (bits & CAP.Bass) !== 0,
    antiWind: (bits & CAP.AntiWind) !== 0,
  };
}

// --- battery -------------------------------------------------------------------

export interface BatteryCell {
  level: number;
  charging: boolean;
}

export interface DeviceBattery {
  left: BatteryCell | null;
  right: BatteryCell | null;
  /** The charging case. */
  case: BatteryCell | null;
}

/**
 * `PowerPayloadHandler` → `DevicePower` → `DeviceComponentPower`:
 * `[left][right][case]`, bit7 = charging, bits0-6 = level (0–127, raw —
 * not percent-guaranteed). Short payloads set only the present sides.
 */
export function decodeBattery(payload: Uint8Array): DeviceBattery | null {
  if (payload.length === 0) return null;
  const cell = (b: number): BatteryCell => ({ level: b & 127, charging: (b & 128) !== 0 });
  return {
    left: payload.length > 0 ? cell(u8(payload, 0)) : null,
    right: payload.length > 1 ? cell(u8(payload, 1)) : null,
    case: payload.length > 2 ? cell(u8(payload, 2)) : null,
  };
}

// --- EQ ------------------------------------------------------------------------

export const EQ_BAND_COUNT = 10;
/** `RemoteEqSetting.CUSTOM_START_INDEX`: preset `mode < 32`, custom `mode = index + 32`. */
export const EQ_CUSTOM_START = 32;

export interface EqSetting {
  mode: number;
  gains: number[];
  custom: boolean;
}

/**
 * `EqRequest`: `[count=10][mode][10 gain bytes]`. `custom` selects the
 * `CustomEqRequest` (`mode = index + 32`) over `PresetEqRequest`.
 */
export function encodeEqPreset(mode: number, gains: readonly number[], custom = false): Uint8Array {
  const out = new Uint8Array(2 + EQ_BAND_COUNT);
  out[0] = EQ_BAND_COUNT;
  out[1] = custom ? (mode + EQ_CUSTOM_START) & 0xff : mode & 0xff;
  for (let i = 0; i < EQ_BAND_COUNT; i += 1) out[2 + i] = (gains[i] ?? 0) & 0xff;
  return out;
}

/**
 * `RemoteEqSettingPayloadHandler`: `[N][mode][N gains]` with the
 * `remaining == 1 + N` consistency check; a 1-byte payload is mode-only;
 * anything else → null.
 */
export function decodeEqCurrent(payload: Uint8Array): EqSetting | null {
  if (payload.length === 1) {
    const mode = u8(payload, 0);
    return { mode, gains: [], custom: mode >= EQ_CUSTOM_START };
  }
  if (payload.length <= 2) return null;
  const count = u8(payload, 0);
  if (payload.length - 1 !== 1 + count) return null;
  const mode = u8(payload, 1);
  return { mode, gains: Array.from(payload.slice(2, 2 + count), (b) => b & 0xff), custom: mode >= EQ_CUSTOM_START };
}

// --- keys ------------------------------------------------------------------------

/** `KeyRequest` key types (`KEY_*`). */
export const KeyType = {
  LeftSingle: 1,
  RightSingle: 2,
  LeftDouble: 3,
  RightDouble: 4,
  LeftTriple: 5,
  RightTriple: 6,
  LeftLong: 7,
  RightLong: 8,
} as const;

/** `KeyRequest` functions (`KEY_FUNCTION_*`). */
export const KeyFunction = {
  None: 0,
  Recall: 1,
  Assistant: 2,
  Previous: 3,
  Next: 4,
  VolumeUp: 5,
  VolumeDown: 6,
  PlayPause: 7,
  GameMode: 8,
  AncMode: 9,
} as const;

/** `KeyRequest(keyType, keyFunction)` → TLV `[keyType][len=1][fn]`. */
export function encodeKey(keyType: number, keyFunction: number): Uint8Array {
  return encodeTlv([[keyType, [keyFunction & 0xff]]]);
}

/**
 * `KeyPayloadHandler`: stream of `[keyType][len][value…]`; only `len == 1`
 * entries are kept, longer ones are skipped positionally.
 */
export function decodeKeys(payload: Uint8Array): Map<number, number> {
  const map = new Map<number, number>();
  let at = 0;
  while (at + 2 < payload.length + 1 && payload.length - at >= 3) {
    const keyType = u8(payload, at);
    const len = u8(payload, at + 1);
    if (len === 1 && at + 2 < payload.length) map.set(keyType, u8(payload, at + 2));
    at += 2 + len;
    if (len === 0) break;
  }
  return map;
}

// --- ANC ---------------------------------------------------------------------------

/** `AncRequest` TLV tags. */
export const AncTag = {
  /** 0=off, 1=on, 2=transparency (+ 3=commute, 4=indoor, 5=adaptive). */
  Mode: 1,
  NcLevel: 2,
  TransparencyLevel: 3,
  Fade: 4,
} as const;

/** `AncRequest.modeRequest`: TLV `[1][1][mode]`. */
export function encodeAncMode(mode: number): Uint8Array {
  return encodeTlv([[AncTag.Mode, [mode & 0xff]]]);
}

/** `AncRequest.fadeRequest`: TLV `[4][1][0/1]`. */
export function encodeAncFade(on: boolean): Uint8Array {
  return encodeTlv([[AncTag.Fade, [on ? 1 : 0]]]);
}

/** `AncRequest.ncLevelRequest` / `transparencyLevel`. */
export function encodeAncLevel(tag: 2 | 3, level: number): Uint8Array {
  return encodeTlv([[tag, [level & 0xff]]]);
}

// --- multipoint --------------------------------------------------------------------

/** `MultipointRequest` TLV tags. */
export const MultipointTag = {
  Status: 1,
  Connect: 2,
  Disconnect: 3,
  Unpair: 4,
} as const;

/** `MultipointRequest.a()`: MAC bytes XOR `173 (0xAD)`, both directions. */
export function encodeMultipointMac(mac: ReadonlyArray<number>): number[] {
  return mac.map((b) => (b & 0xff) ^ 0xad);
}

export interface MultipointPeer {
  mac: string;
  name: string;
  status: number;
}

/**
 * `MultipointPayloadHandler`: skip 1 byte, then per record
 * `[len][MAC×6 ^AD][name…][status]`, name length = `len - 7`.
 */
export function decodeMultipoint(payload: Uint8Array): MultipointPeer[] | null {
  if (payload.length === 0) return null;
  const peers: MultipointPeer[] = [];
  let at = 1;
  while (at < payload.length) {
    const len = u8(payload, at);
    if (len < 7 || at + 1 + len > payload.length) break;
    const mac = Array.from(payload.slice(at + 1, at + 7), (b) => ((b & 0xff) ^ 0xad).toString(16).padStart(2, '0')).join(':');
    const name = Array.from(payload.slice(at + 7, at + len), (b) => String.fromCharCode(b & 0xff)).join('');
    const status = u8(payload, at + len);
    peers.push({ mac, name, status });
    at += 1 + len;
  }
  return peers;
}

// --- batch info / notification payloads ------------------------------------------

/**
 * `processDeviceInfoData` / `processNotificationData` (cmd 39/40): stream of
 * `[infoId][len][value…]`; trailing bytes that cannot hold a record stop the
 * walk. Signed ids (`-1`, `-2`) arrive as their u8 form.
 */
export function decodeInfoBatch(payload: Uint8Array): Array<{ id: number; value: Uint8Array }> {
  const out: Array<{ id: number; value: Uint8Array }> = [];
  let at = 0;
  while (at + 2 <= payload.length) {
    const id = payload[at] < 128 ? payload[at] : payload[at] - 256;
    const len = payload[at + 1] & 0xff;
    if (at + 2 + len > payload.length) break;
    out.push({ id, value: payload.slice(at + 2, at + 2 + len) });
    at += 2 + len;
  }
  return out;
}

// --- find device -------------------------------------------------------------------

/** `FindDeviceRequest(boolean)` → 1 byte `0/1` (`BooleanRequest`). */
export function encodeFindDevice(on: boolean): Uint8Array {
  return Uint8Array.from([on ? 1 : 0]);
}
