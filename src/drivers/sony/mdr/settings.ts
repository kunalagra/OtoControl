/**
 * Sony behaviour settings: the `SYSTEM_*` toggles and auto power off.
 *
 * Two command families that happen to answer the same kind of question — "how
 * should the headphones behave when I'm not touching them" — so they share a
 * module rather than being spread across the protocol layer by opcode.
 *
 * Transcribed from the Sound Connect decompile (`ag0/*`,
 * `v2/table1/system/param/SystemInquiredType`, `v2/OnOffSettingValue`,
 * `v2/table1/power/param/*`).
 */

import { Command } from './commands';

/**
 * **ON is 0 and OFF is 1.**
 *
 * Backwards from every instinct, and from the on/off values used elsewhere in
 * this same protocol — `NcAsmOnOffValue` has OFF=0, ON=1. Getting it the
 * obvious way round would silently invert every toggle in this module, which is
 * exactly how the Sennheiser touch-control setting was wrong for a while.
 */
export const OnOffSettingValue = { On: 0x00, Off: 0x01 } as const;

const onOffByte = (on: boolean): number => (on ? OnOffSettingValue.On : OnOffSettingValue.Off);
const onOffValue = (byte: number): boolean => byte === OnOffSettingValue.On;

/** Second byte of the `SYSTEM_*` commands. */
export const SystemInquiryType = {
  Vibrator: 0x00,
  /** Pause when you take the headphones off, resume when you put them back. */
  PlaybackControlByWearing: 0x01,
  /** Speak-to-chat. */
  SmartTalkingModeType1: 0x02,
  AssignableSettings: 0x03,
  VoiceAssistantSettings: 0x04,
  VoiceAssistantWakeWord: 0x05,
  WearingStatusDetector: 0x06,
  EarpieceSelection: 0x07,
  CallSettings: 0x08,
  ResetSettings: 0x09,
  AutoVolume: 0x0a,
  FaceTapTestMode: 0x0b,
  SmartTalkingModeType2: 0x0c,
  QuickAccess: 0x0d,
  AssignableSettingsWithLimitation: 0x0e,
  HeadGestureOnOff: 0x0f,
  HeadGestureTraining: 0x10,
} as const;

/**
 * Inquiry types that are a plain on/off over `SYSTEM_SET_PARAM`.
 *
 * The dispatcher routes exactly these to one 3-byte payload class; everything
 * else in the family carries structured parameters and needs its own codec.
 * Encoding is refused for anything outside this set rather than assumed.
 */
const SIMPLE_TOGGLES: ReadonlySet<number> = new Set([
  SystemInquiryType.Vibrator,
  SystemInquiryType.PlaybackControlByWearing,
  SystemInquiryType.VoiceAssistantWakeWord,
  SystemInquiryType.AutoVolume,
  SystemInquiryType.HeadGestureOnOff,
]);

export const isSimpleToggle = (inquiryType: number): boolean => SIMPLE_TOGGLES.has(inquiryType);

/** `[0xF6 SYSTEM_GET_PARAM, inquiryType]`. */
export const encodeGetSystemToggle = (inquiryType: number): number[] => [
  Command.GetSystemParam,
  inquiryType,
];

/** `[0xF8 SYSTEM_SET_PARAM, inquiryType, onOff]`. */
export function encodeSystemToggle(inquiryType: number, on: boolean): number[] {
  if (!isSimpleToggle(inquiryType)) {
    throw new Error(`0x${inquiryType.toString(16)} is not a plain on/off setting`);
  }
  return [Command.SetSystemParam, inquiryType, onOffByte(on)];
}

/** Reads `[0xF7 SYSTEM_RET_PARAM, inquiryType, onOff]`. */
export function decodeSystemToggle(payload: Uint8Array): { inquiryType: number; on: boolean } {
  if (payload.length !== 3) throw new Error('expected 3 bytes');
  return { inquiryType: payload[1], on: onOffValue(payload[2]) };
}

// --- auto power off --------------------------------------------------------

/** Second byte of the power commands. */
export const PowerInquiryType = {
  Battery: 0x00,
  LeftRightBattery: 0x01,
  CradleBattery: 0x02,
  PowerOff: 0x03,
  AutoPowerOff: 0x04,
  AutoPowerOffWearingDetection: 0x05,
} as const;

/**
 * Idle timeouts, from `AutoPowerOffElements`.
 *
 * The byte codes are not in time order — 15 minutes was added later and took
 * the next free value — so they cannot be derived from the durations.
 */
export const AutoPowerOff = {
  After5Min: 0x00,
  After30Min: 0x01,
  After60Min: 0x02,
  After180Min: 0x03,
  After15Min: 0x04,
  Disabled: 0x11,
} as const;

export const AUTO_POWER_OFF_OPTIONS: Array<{ value: number; label: string }> = [
  { value: AutoPowerOff.Disabled, label: 'Never' },
  { value: AutoPowerOff.After5Min, label: 'After 5 minutes' },
  { value: AutoPowerOff.After15Min, label: 'After 15 minutes' },
  { value: AutoPowerOff.After30Min, label: 'After 30 minutes' },
  { value: AutoPowerOff.After60Min, label: 'After 1 hour' },
  { value: AutoPowerOff.After180Min, label: 'After 3 hours' },
];

const KNOWN_TIMEOUTS: ReadonlySet<number> = new Set(
  AUTO_POWER_OFF_OPTIONS.map((option) => option.value),
);

export const autoPowerOffLabel = (value: number): string =>
  AUTO_POWER_OFF_OPTIONS.find((option) => option.value === value)?.label ??
  `Unknown (0x${value.toString(16)})`;

/** `[0x26 POWER_GET_PARAM, 0x04]`. */
export const encodeGetAutoPowerOff = (): number[] => [
  Command.GetPowerParam,
  PowerInquiryType.AutoPowerOff,
];

/** `[0x28 POWER_SET_PARAM, 0x04, element]`. */
export function encodeAutoPowerOff(value: number): number[] {
  if (!KNOWN_TIMEOUTS.has(value)) {
    throw new Error(`0x${value.toString(16)} is not a known auto-power-off value`);
  }
  return [Command.SetPowerParam, PowerInquiryType.AutoPowerOff, value];
}

/** Reads `[0x27 POWER_RET_PARAM, 0x04, element]`. */
export function decodeAutoPowerOff(payload: Uint8Array): number {
  if (payload.length < 3) throw new Error('expected at least 3 bytes');
  return payload[2];
}
