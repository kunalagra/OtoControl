/**
 * Opcodes, config ids and the byte layouts that ride inside a frame's payload.
 *
 * Features are not opcodes of their own. Four plain opcodes carry the
 * read-only state (`GetInfo`, `GetRunInfo`, the `ReportStatus` push) and the
 * ANC / in-ear writes; everything else is a *config* — a numbered setting
 * carried in `SetConfig` / `GetConfig` / `NotifyConfig`. Layouts come from
 * Gadgetbridge's `RedmiBudsProtocol.java`, cross-read against the vendor app
 * (`DeviceConfig*`, `f7/f.java`) and WinMi-Buds' tests; each is cited below.
 *
 * Pure bytes in, bytes out: nothing here knows about a transport or state.
 */

export const Opcode = {
  /** Phone asks for the identity and battery TLVs. */
  GetInfo: 0x02,
  /** Phone writes a status TLV: ANC mode, in-ear detection. */
  SetStatus: 0x08,
  GetRunInfo: 0x09,
  /** Earbuds push battery and ANC mode; must be acknowledged. */
  ReportStatus: 0x0e,
  AuthChallenge: 0x50,
  AuthConfirm: 0x51,
  SetConfig: 0xf2,
  GetConfig: 0xf3,
  NotifyConfig: 0xf4,
} as const;

/**
 * The opcodes the query console may send: reads only, so nothing typed there
 * can change a setting. `0xF3` is a read of one config.
 */
export const QUERY_OPCODES: ReadonlySet<number> = new Set([Opcode.GetInfo, Opcode.GetRunInfo, Opcode.GetConfig]);

/** Config ids (u16 BE on the wire; every one used here fits a byte). */
export const ConfigId = {
  /** Gesture table: `[tap, left, right]` triplets. */
  Gestures: 0x02,
  EqPreset: 0x07,
  Find: 0x09,
  /** Long-press noise-control cycle: `[left, right]` bitmasks. */
  LongPressCycle: 0x0a,
  Strength: 0x0b,
  /** The 10-band custom EQ curve. */
  CustomEq: 0x37,
} as const;

/** The mask asking for every attribute, as Gadgetbridge sends it for info and run info. */
const ALL_ATTRIBUTES = [0xff, 0xff, 0xff, 0xff];

export const AncMode = { Off: 0, NoiseCancelling: 1, Transparency: 2 } as const;
export type AncModeValue = (typeof AncMode)[keyof typeof AncMode];

export const isAncMode = (value: number): value is AncModeValue => value === 0 || value === 1 || value === 2;

/** Which side's strength a `Strength` config addresses. */
export const StrengthTarget = { NoiseCancelling: 1, Transparency: 2 } as const;
export type StrengthTargetValue = (typeof StrengthTarget)[keyof typeof StrengthTarget];

export const NC_STRENGTH_LABEL: Record<number, string> = { 0: 'Balanced', 1: 'Light', 2: 'Deep', 3: 'Adaptive' };
export const TRANSPARENCY_STRENGTH_LABEL: Record<number, string> = { 0: 'Regular', 1: 'Voice', 2: 'Ambient' };

/** EQ preset ids, with the names Gadgetbridge's `RedmiBudsEqualizerPreset` gives them. */
export const EQ_PRESET_LABEL: Record<number, string> = {
  0x00: 'Standard',
  0x15: 'Balanced',
  0x06: 'Treble',
  0x05: 'Bass',
  0x01: 'Voice',
  0x07: 'Volume',
  0x0a: 'Custom',
};

// --- encoders ---------------------------------------------------------------

export const encodeGetInfo = (): number[] => [...ALL_ATTRIBUTES];
export const encodeGetRunInfo = (): number[] => [...ALL_ATTRIBUTES];

/** A status TLV for `SetStatus`: `[len, type, value]`, `len` counting the type. */
const statusTlv = (type: number, value: number): number[] => [2, type, value];

/** `GetConfig` takes a list of u16 ids; Gadgetbridge sends one per request. */
export const encodeGetConfig = (id: number): number[] => [(id >> 8) & 0xff, id & 0xff];

/** One config unit: `[len = value.length + 2][id u16 BE][value]`. */
export const configUnit = (id: number, value: number[]): number[] => [value.length + 2, (id >> 8) & 0xff, id & 0xff, ...value];

export const encodeSetAncMode = (mode: AncModeValue): number[] => statusTlv(0x04, mode);

/** Inverted on the wire: 0 turns detection on (GB `encodeSetEarDetection`). */
export const encodeSetWearDetection = (enabled: boolean): number[] => statusTlv(0x06, enabled ? 0x00 : 0x01);

export const encodeSetStrength = (target: StrengthTargetValue, level: number): number[] =>
  configUnit(ConfigId.Strength, [target, level]);

export const encodeSetEqPreset = (preset: number): number[] => configUnit(ConfigId.EqPreset, [preset]);

/** `which`: 1 left, 2 right, 3 both (GB `FIND_EARBUDS_*`). */
export type FindTarget = 1 | 2 | 3;

export const encodeFind = (enable: boolean, which: FindTarget): number[] =>
  configUnit(ConfigId.Find, [enable ? 0x01 : 0x00, which]);

/** Leaves one side of a pair as it is: Gadgetbridge's value for "not this one". */
export const UNCHANGED = 0xff;

/** Tap codes, as config 2 carries them; Gadgetbridge's `RedmiBudsTapType`. */
export const Tap = { Single: 4, Double: 1, Triple: 2, Long: 3, Slide: 5 } as const;
export type TapCode = (typeof Tap)[keyof typeof Tap];

export const encodeSetGesture = (tap: number, left: number, right: number): number[] =>
  configUnit(ConfigId.Gestures, [tap, left, right]);

export const encodeSetLongPressCycle = (left: number, right: number): number[] =>
  configUnit(ConfigId.LongPressCycle, [left, right]);

/**
 * One EQ band, in dB. Sign-magnitude on the wire: `0x80 | |dB|` below zero
 * (vendor `DeviceConfigCustomEq.java:84-87`, Gadgetbridge `RedmiBudsEqualizerBandLevel`).
 */
export const gainToByte = (db: number): number => (db < 0 ? 0x80 | Math.min(-db, 0x7f) : Math.min(db, 0x7f));
export const byteToGain = (byte: number): number => (byte & 0x80 ? -(byte & 0x7f) : byte);

export interface EqBand {
  /** Centre frequency in Hz, as the earbuds report it. */
  frequency: number;
  gain: number;
}

/** What a model without a read-back falls back to; the rates the earbuds report on every capture seen. */
export const DEFAULT_EQ_FREQUENCIES = [62, 125, 250, 500, 1000, 2000, 4000, 8000, 12000, 16000] as const;

/**
 * The curve write Gadgetbridge sends (`RedmiBudsProtocol.encodeSetCustomEqualizer`):
 * sub-command 5, then `01 01`, the band count, and `[frequency u16][gain]` per band.
 * It is the vendor app's "preview" form (`DeviceConfigCustomEq` op 8), shorter than its
 * "save" form (op 4); see the design spec's verification section for why this one.
 */
export const encodeSetCustomEq = (bands: readonly EqBand[]): number[] =>
  configUnit(ConfigId.CustomEq, [
    0x05,
    0x01,
    0x01,
    bands.length,
    ...bands.flatMap(({ frequency, gain }) => [(frequency >> 8) & 0xff, frequency & 0xff, gainToByte(gain)]),
  ]);

// --- decoders -----------------------------------------------------------------

export interface Tlv {
  type: number;
  value: Uint8Array;
}

/**
 * `[len][type][value…]` records, `len` counting the type byte. Stops at the
 * first record that does not fit instead of throwing, so a truncated reply
 * still yields what came before it.
 */
export function parseTlvs(payload: Uint8Array): Tlv[] {
  const out: Tlv[] = [];
  for (let at = 0; at < payload.length; ) {
    const len = payload[at];
    if (len < 1 || at + len >= payload.length) break;
    out.push({ type: payload[at + 1], value: payload.subarray(at + 2, at + 1 + len) });
    at += len + 1;
  }
  return out;
}

export interface ConfigUnit {
  id: number;
  value: Uint8Array;
}

/** `[len][id u16 BE][value…]` records, `len` counting the two id bytes. */
export function parseConfigUnits(payload: Uint8Array): ConfigUnit[] {
  const out: ConfigUnit[] = [];
  for (let at = 0; at < payload.length; ) {
    const len = payload[at];
    if (len < 2 || at + len >= payload.length) break;
    out.push({ id: (payload[at + 1] << 8) | payload[at + 2], value: payload.subarray(at + 3, at + 1 + len) });
    at += len + 1;
  }
  return out;
}

export type BatteryDevice = 'left' | 'right' | 'case';

export interface BatteryCell {
  device: BatteryDevice;
  level: number;
  charging: boolean;
}

export const BATTERY_LABEL: Record<BatteryDevice, string> = { left: 'Left', right: 'Right', case: 'Case' };

const BATTERY_SLOTS: readonly BatteryDevice[] = ['left', 'right', 'case'];

/**
 * Left, right, case — one byte each: bits 0-6 the level, bit 7 charging,
 * `FF` no unit in that slot (vendor `DeviceElectricInfo.java:87-103`, slot
 * order `BatteryInfoContainer.java:104-118`). A level over 100 is unknown,
 * as WinMi-Buds treats it, and is skipped like an empty slot.
 */
export function decodeBattery(value: Uint8Array): BatteryCell[] {
  const cells: BatteryCell[] = [];
  BATTERY_SLOTS.forEach((device, slot) => {
    const byte = value[slot];
    if (byte === undefined || byte === 0xff || (byte & 0x7f) > 100) return;
    cells.push({ device, level: byte & 0x7f, charging: (byte & 0x80) !== 0 });
  });
  return cells;
}

const nibbles = (hi: number, lo: number): string => `${hi >> 4}.${hi & 0xf}.${lo >> 4}.${lo & 0xf}`;

export interface XiaomiIdentity {
  btName: string | null;
  /** One version per byte pair: two or four bytes were seen in the vendor app. */
  firmware: string[];
  vid: number | null;
  pid: number | null;
  battery: BatteryCell[];
  /** The unit's colour id (TLV 13), which picks its product render. */
  colour: number | null;
}

/** The `GetInfo` reply: name (0), firmware (1), VID/PID (3), battery (7), colour (13). */
export function decodeInfo(payload: Uint8Array): XiaomiIdentity {
  const identity: XiaomiIdentity = { btName: null, firmware: [], vid: null, pid: null, battery: [], colour: null };
  for (const { type, value } of parseTlvs(payload)) {
    if (type === 0 && value.length > 0) {
      identity.btName = new TextDecoder().decode(value).replace(/\0+$/, '') || null;
    } else if (type === 1 && value.length >= 2) {
      identity.firmware = [nibbles(value[0], value[1])];
      if (value.length >= 4) identity.firmware.push(nibbles(value[2], value[3]));
    } else if (type === 3 && value.length === 4) {
      identity.vid = (value[0] << 8) | value[1];
      identity.pid = (value[2] << 8) | value[3];
    } else if (type === 7) {
      identity.battery = decodeBattery(value);
    } else if (type === 13 && value.length === 1) {
      identity.colour = value[0];
    }
  }
  return identity;
}

export interface RunInfo {
  ancMode: AncModeValue | null;
  /** True when in-ear detection is on; null when the model did not report it. */
  wearDetection: boolean | null;
}

/** The `GetRunInfo` reply: ANC mode (9) and in-ear detection (10, 0 = on). */
export function decodeRunInfo(payload: Uint8Array): RunInfo {
  const info: RunInfo = { ancMode: null, wearDetection: null };
  for (const { type, value } of parseTlvs(payload)) {
    if (type === 9 && value.length >= 1 && isAncMode(value[0])) info.ancMode = value[0];
    else if (type === 10 && value.length >= 1) info.wearDetection = value[0] === 0;
  }
  return info;
}

export interface StatusPush {
  battery: BatteryCell[] | null;
  ancMode: AncModeValue | null;
}

/** The `ReportStatus` push: battery (0) and ANC mode (4). */
export function decodeStatusPush(payload: Uint8Array): StatusPush {
  const push: StatusPush = { battery: null, ancMode: null };
  for (const { type, value } of parseTlvs(payload)) {
    if (type === 0 && value.length >= 1) push.battery = decodeBattery(value);
    else if (type === 4 && value.length >= 1 && isAncMode(value[0])) push.ancMode = value[0];
  }
  return push;
}

export interface GestureRecord {
  tap: number;
  left: number;
  right: number;
}

export interface CustomEq {
  /** Gain limits in dB, as the earbuds report them (±6 on every capture seen). */
  min: number;
  max: number;
  bands: EqBand[];
}

export interface ConfigState {
  ncStrength?: number;
  transparencyStrength?: number;
  eqPreset?: number;
  ancMode?: AncModeValue;
  gestures?: GestureRecord[];
  /** `[left, right]` long-press cycle bitmasks. */
  longPressCycle?: [number, number];
  customEq?: CustomEq;
}

/**
 * The custom-EQ read-back: `[01][mode][max][min][eqId][nameLen][name…][count]` then
 * `[frequency u16][gain]` per band. Layout from the vendor app's
 * `DeviceConfigCustomEq.valueToParams` and a real capture (`01 0a 06 06 00 00 0a`,
 * ten bands from 62 Hz to 16 kHz). A limit of 0 means the app's default of 10.
 */
function decodeCustomEq(value: Uint8Array): CustomEq | null {
  if (value.length < 7 || value[0] !== 1) return null;
  const nameLength = value[5];
  const countAt = 6 + nameLength;
  if (countAt >= value.length) return null;
  const count = value[countAt];
  const bands: EqBand[] = [];
  for (let at = countAt + 1; bands.length < count && at + 2 < value.length; at += 3) {
    bands.push({ frequency: (value[at] << 8) | value[at + 1], gain: byteToGain(value[at + 2]) });
  }
  if (bands.length === 0) return null;
  return { max: value[2] || 10, min: -(value[3] || 10), bands };
}

/**
 * Folds config units from a `GetConfig` reply or a `NotifyConfig` push.
 *
 * Config `0x0B` is `[mode, level]` in both: the mode now active (0 off, 1
 * noise cancelling, 2 transparency) and that mode's strength id. A capture of
 * the official app shows the same pair in a get reply (`04 00 0B 02 02`) and in
 * a notification (`04 00 0B 02 01`), and `[0, 0]` while off, so a reply names
 * the mode too. Some models report a strength beyond the 0-3 names (a depth
 * step up to 19 on the models whose catalog lists a 20-step gear).
 */
export function decodeConfig(payload: Uint8Array): ConfigState {
  const state: ConfigState = {};
  for (const { id, value } of parseConfigUnits(payload)) {
    if (id === ConfigId.EqPreset && value.length >= 1) {
      state.eqPreset = value[0];
    } else if (id === ConfigId.Strength && value.length >= 2) {
      if (isAncMode(value[0])) state.ancMode = value[0];
      if (value[0] === StrengthTarget.NoiseCancelling) state.ncStrength = value[1];
      else if (value[0] === StrengthTarget.Transparency) state.transparencyStrength = value[1];
    } else if (id === ConfigId.Gestures && value.length >= 3) {
      state.gestures = [];
      for (let at = 0; at + 2 < value.length; at += 3) {
        state.gestures.push({ tap: value[at], left: value[at + 1], right: value[at + 2] });
      }
    } else if (id === ConfigId.LongPressCycle && value.length >= 2) {
      state.longPressCycle = [value[0], value[1]];
    } else if (id === ConfigId.CustomEq) {
      const curve = decodeCustomEq(value);
      if (curve) state.customEq = curve;
    }
  }
  return state;
}
