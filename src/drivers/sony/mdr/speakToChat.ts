/**
 * Sony speak-to-chat ("smart talking mode", Type 2).
 *
 * Sits in two places at once: the on/off toggle is a `SYSTEM_*` param under
 * selector `0x0c` (`SmartTalkingModeType2` in the decompile's table), and the
 * sensitivity/timeout pair rides the *extended* system params (`0xfa`/`0xfc`)
 * under the same selector — a second opcode pair the plain settings never
 * touch. Byte shapes cross-checked against BudsLink's `sonySocketV2` (GPL —
 * read as reference, nothing copied) and the Sound Connect decompile's
 * naming.
 *
 * The older Type 1 (capability `0xf2`, selector `0x02`) is deliberately not
 * implemented: nothing documents its payload, and guessing bytes for a
 * settings write is how devices get subtly misconfigured.
 */

import { Command, Reply, SonyFunction } from './commands';
import { OnOffSettingValue } from './settings';

/** Bytes for the sensitivity setting, from `Speak2ChatSensitivity`. */
export const SpeakToChatSensitivity = {
  Auto: 0x00,
  High: 0x01,
  Low: 0x02,
} as const;

/** Bytes for how long the mode lingers after speech stops. */
export const SpeakToChatTimeout = {
  Short: 0x00,
  Standard: 0x01,
  Long: 0x02,
  /** Stay in the mode until toggled out of it. */
  Off: 0x03,
} as const;

export const SPEAK_TO_CHAT_SENSITIVITY_OPTIONS: Array<{ value: number; label: string }> = [
  { value: SpeakToChatSensitivity.Auto, label: 'Auto' },
  { value: SpeakToChatSensitivity.High, label: 'High' },
  { value: SpeakToChatSensitivity.Low, label: 'Low' },
];

export const SPEAK_TO_CHAT_TIMEOUT_OPTIONS: Array<{ value: number; label: string }> = [
  { value: SpeakToChatTimeout.Short, label: 'Short (5 s)' },
  { value: SpeakToChatTimeout.Standard, label: 'Standard (15 s)' },
  { value: SpeakToChatTimeout.Long, label: 'Long' },
  { value: SpeakToChatTimeout.Off, label: 'Until turned off' },
];

const SENSITIVITIES: ReadonlySet<number> = new Set(
  SPEAK_TO_CHAT_SENSITIVITY_OPTIONS.map((option) => option.value),
);
const TIMEOUTS: ReadonlySet<number> = new Set(
  SPEAK_TO_CHAT_TIMEOUT_OPTIONS.map((option) => option.value),
);

/**
 * The system inquiry byte a device's capabilities imply, or null when it speaks
 * no variant we can honestly drive.
 */
export function speakToChatInquiryFor(capabilities: Set<number>): number | null {
  return capabilities.has(SonyFunction.SpeakToChatType2) ? 0x0c : null;
}

/** `[0xF6 SYSTEM_GET_PARAM, 0x0c]`. */
export const encodeGetSpeakToChatEnabled = (): number[] => [Command.GetSystemParam, 0x0c];

/**
 * `[0xF8 SYSTEM_SET_PARAM, 0x0c, onOff, changed]` — the on/off byte inverted
 * like every system toggle, plus the value-change status the Type-2 payload
 * carries where the simple toggles end.
 */
export function encodeSetSpeakToChatEnabled(enabled: boolean): number[] {
  return [
    Command.SetSystemParam,
    0x0c,
    enabled ? OnOffSettingValue.On : OnOffSettingValue.Off,
    0x01,
  ];
}

/** Reads `[0xF7|0xF9, 0x0c, onOff, …]`, tolerating a missing status byte. */
export function decodeSpeakToChatEnabled(payload: Uint8Array): boolean {
  if (payload[1] !== 0x0c) throw new Error('not a speak-to-chat body');
  if (payload.length !== 3 && payload.length !== 4) {
    throw new Error('expected 3 or 4 bytes');
  }
  return payload[2] === OnOffSettingValue.On;
}

/** `[0xFA SYSTEM_GET_EXTENDED_PARAM, 0x0c]`. */
export const encodeGetSpeakToChatConfig = (): number[] => [0xfa, 0x0c];

/** `[0xFC SYSTEM_SET_EXTENDED_PARAM, 0x0c, sensitivity, timeout]`. */
export function encodeSetSpeakToChatConfig(sensitivity: number, timeout: number): number[] {
  if (!SENSITIVITIES.has(sensitivity) || !TIMEOUTS.has(timeout)) {
    throw new Error('sensitivity and timeout must be known enum values');
  }
  return [0xfc, 0x0c, sensitivity, timeout];
}

/** Reads `[0xFB|0xFD, 0x0c, sensitivity, timeout]`. */
export function decodeSpeakToChatConfig(
  payload: Uint8Array,
): { sensitivity: number; timeout: number } {
  if (payload[1] !== 0x0c) throw new Error('not a speak-to-chat body');
  if (payload.length < 4) throw new Error('expected at least 4 bytes');
  if (!SENSITIVITIES.has(payload[2]) || !TIMEOUTS.has(payload[3])) {
    throw new Error('sensitivity or timeout byte outside the known enums');
  }
  return { sensitivity: payload[2], timeout: payload[3] };
}

/** Whether a reply body answers the on/off read — the plain system param. */
export const isSpeakToChatEnabledReply = (payload: Uint8Array): boolean =>
  (payload[0] === Reply.SystemParam || payload[0] === Reply.SystemParamNotify) &&
  payload[1] === 0x0c;

/** Whether a reply body answers the config read — the extended system param. */
export const isSpeakToChatConfigReply = (payload: Uint8Array): boolean =>
  (payload[0] === 0xfb || payload[0] === 0xfd) && payload[1] === 0x0c;
