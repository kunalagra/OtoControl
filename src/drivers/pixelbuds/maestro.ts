/**
 * The `maestro_pw` service: its names, and the messages this driver reads and
 * writes. Layouts follow qzed/pbpctrl's `maestro_pw.proto`, field numbers
 * included, with the ones the companion app corroborates noted at the
 * enums. Everything is decoded defensively — proto3 leaves a zero field out,
 * so "absent" and "zero" are told apart only where it matters (a battery
 * cell that is missing, against one at 0%).
 */

import { boolOf, floatOf, messageOf, parseFields, pb, stringOf, varintOf } from './protobuf';
import { rpcHash } from './rpc';

export const MAESTRO_SERVICE = 'maestro_pw.Maestro';
export const MULTIPOINT_SERVICE = 'maestro_pw.Multipoint';

export const Method = {
  GetSoftwareInfo: 'GetSoftwareInfo',
  GetHardwareInfo: 'GetHardwareInfo',
  SubscribeRuntimeInfo: 'SubscribeRuntimeInfo',
  ReadSetting: 'ReadSetting',
  WriteSetting: 'WriteSetting',
  SubscribeToSettingsChanges: 'SubscribeToSettingsChanges',
} as const;

export type MethodName = (typeof Method)[keyof typeof Method];

export const serviceId = rpcHash(MAESTRO_SERVICE);
export const methodId = (name: MethodName): number => rpcHash(name);

/** `AllegroSettingType` ids, the ones this driver touches. */
export const SettingId = {
  OnHeadDetection: 2,
  Multipoint: 11,
  AncLoop: 12,
  AncState: 13,
  VolumeEq: 15,
  UserEq: 16,
} as const;

export type SettingKey = (typeof SettingId)[keyof typeof SettingId];

/** `AncState`. The companion app's enum (`sbr.java:6-10`) agrees. */
export const AncState = { Off: 1, Active: 2, Aware: 3, Adaptive: 4 } as const;
export type AncMode = (typeof AncState)[keyof typeof AncState];
const ANC_MODES: readonly number[] = Object.values(AncState);

export const ANC_LABEL: Record<AncMode, string> = {
  [AncState.Off]: 'Off',
  [AncState.Active]: 'Noise cancelling',
  [AncState.Aware]: 'Transparency',
  [AncState.Adaptive]: 'Adaptive',
};

/** Which modes the buds cycle through on a long press: `AncrGestureLoop`. */
export interface AncLoop {
  active: boolean;
  off: boolean;
  aware: boolean;
  adaptive: boolean;
}

/** The five user-EQ bands, low to high; pbpctrl documents ±6.0 dB for each. */
export const EQ_BANDS = ['Low bass', 'Bass', 'Mid', 'Treble', 'Upper treble'] as const;
export const EQ_RANGE = { min: -6, max: 6 } as const;
export type EqGains = [number, number, number, number, number];

/** One decoded `SettingValue`: which setting it is and what it holds. */
export type SettingChange =
  | { setting: typeof SettingId.OnHeadDetection; value: boolean }
  | { setting: typeof SettingId.Multipoint; value: boolean }
  | { setting: typeof SettingId.AncLoop; value: AncLoop }
  | { setting: typeof SettingId.AncState; value: AncMode | null }
  | { setting: typeof SettingId.VolumeEq; value: boolean }
  | { setting: typeof SettingId.UserEq; value: EqGains };

// --- requests --------------------------------------------------------------------

/** `ReadSettingMsg{ settings_id (4) }`. */
export const encodeReadSetting = (setting: number): Uint8Array => Uint8Array.from(pb.varint(4, setting));

/** `WriteSettingMsg{ setting (4): SettingValue{ <id>: value } }`. A oneof member is always written, so `false` is `<tag> 00`. */
export function encodeWriteSetting(change: SettingChange): Uint8Array {
  let value: number[];
  switch (change.setting) {
    case SettingId.AncState:
      if (change.value === null) throw new Error('cannot write an unknown ANC state');
      value = pb.varint(SettingId.AncState, change.value);
      break;
    case SettingId.AncLoop:
      // Plain proto3 bools, not a oneof: `false` is left out, as pbpctrl's encoder does.
      value = pb.bytes(SettingId.AncLoop, [
        ...(change.value.active ? pb.bool(1, true) : []),
        ...(change.value.off ? pb.bool(2, true) : []),
        ...(change.value.aware ? pb.bool(3, true) : []),
        ...(change.value.adaptive ? pb.bool(4, true) : []),
      ]);
      break;
    case SettingId.UserEq:
      // proto3: a 0.0 band is absent from the nested message, as pbpctrl's prost encoder writes it.
      value = pb.bytes(
        SettingId.UserEq,
        change.value.flatMap((gain, i) => (gain === 0 ? [] : pb.float(i + 1, gain))),
      );
      break;
    default:
      value = pb.bool(change.setting, change.value);
  }
  return Uint8Array.from(pb.bytes(4, value));
}

// --- replies ---------------------------------------------------------------------

export interface FirmwareVersions {
  case: string | null;
  left: string | null;
  right: string | null;
}

const versionOf = (fields: ReturnType<typeof parseFields> | null, field: number): string | null => {
  const message = fields ? messageOf(fields, field) : null;
  const version = message ? stringOf(message, 2) : '';
  return version === '' ? null : version;
};

/** `SoftwareInfo{ firmware (4): { case (1), right (2), left (3) }, FirmwareVersion{ version_string (2) } }`. */
export function decodeSoftwareInfo(bytes: Uint8Array): FirmwareVersions {
  const firmware = messageOf(parseFields(bytes), 4);
  return { case: versionOf(firmware, 1), right: versionOf(firmware, 2), left: versionOf(firmware, 3) };
}

export interface SerialNumbers {
  case: string | null;
  left: string | null;
  right: string | null;
}

/** `HardwareInfo{ serial_number (7): { case (1), right (2), left (3) } }`. */
export function decodeHardwareInfo(bytes: Uint8Array): SerialNumbers {
  const serials = messageOf(parseFields(bytes), 7);
  const text = (field: number): string | null => {
    const value = serials ? stringOf(serials, field) : '';
    return value === '' ? null : value;
  };
  return { case: text(1), right: text(2), left: text(3) };
}

export interface BatteryCell {
  device: 'case' | 'left' | 'right';
  level: number;
  charging: boolean;
}

export interface Placement {
  leftInCase: boolean;
  rightInCase: boolean;
}

export interface RuntimeInfo {
  /** Only the cells the buds reported; the case is absent while neither bud sits in it. */
  battery: BatteryCell[];
  placement: Placement | null;
}

/** `RuntimeInfo{ battery_info (6): { case (1), left (2), right (3) }, placement (7) }`; `DeviceBatteryInfo{ level (1), state (2) }`. */
export function decodeRuntimeInfo(bytes: Uint8Array): RuntimeInfo {
  const fields = parseFields(bytes);
  const info = messageOf(fields, 6);
  const battery: BatteryCell[] = [];
  const cells = [
    ['case', 1],
    ['left', 2],
    ['right', 3],
  ] as const;
  for (const [device, field] of cells) {
    const cell = info ? messageOf(info, field) : null;
    if (cell) battery.push({ device, level: varintOf(cell, 1), charging: varintOf(cell, 2) === 2 });
  }
  const placement = messageOf(fields, 7);
  return {
    battery,
    placement: placement ? { rightInCase: boolOf(placement, 1), leftInCase: boolOf(placement, 2) } : null,
  };
}

/** `SettingsRsp{ value (4): SettingValue }`, as a read reply or a change push. Null for a setting this driver does not model. */
export function decodeSettingsRsp(bytes: Uint8Array): SettingChange | null {
  const value = messageOf(parseFields(bytes), 4);
  if (!value) return null;
  for (const field of value) {
    switch (field.field) {
      case SettingId.OnHeadDetection:
      case SettingId.Multipoint:
      case SettingId.VolumeEq:
        return { setting: field.field, value: field.value !== 0 };
      case SettingId.AncState:
        return { setting: SettingId.AncState, value: ANC_MODES.includes(field.value) ? (field.value as AncMode) : null };
      case SettingId.AncLoop: {
        const loop = parseFields(field.bytes);
        return {
          setting: SettingId.AncLoop,
          value: { active: boolOf(loop, 1), off: boolOf(loop, 2), aware: boolOf(loop, 3), adaptive: boolOf(loop, 4) },
        };
      }
      case SettingId.UserEq: {
        const bands = parseFields(field.bytes);
        return {
          setting: SettingId.UserEq,
          value: [floatOf(bands, 1), floatOf(bands, 2), floatOf(bands, 3), floatOf(bands, 4), floatOf(bands, 5)],
        };
      }
      default:
    }
  }
  return null;
}
