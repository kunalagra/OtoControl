/**
 * Sony voice guidance (voice notifications) — the second command table.
 *
 * Everything in this feature rides `COMMAND_2` frames (data type `0x0e`, not
 * the `0x0c` every other setting here uses), under two selectors: `0x03` is
 * the on/off toggle and `0x20` the prompt volume. Byte shapes cross-checked
 * against BudsLink's `sonySocketV2` (GPL — read as reference, nothing
 * copied).
 *
 * **Do not "fix" the `0x03` to match Gadgetbridge.** Its
 * `SonyProtocolImplV2` uses `0x01` here, which is V1's selector carried onto
 * V2's shape. The generations differ:
 *
 * - V1: selector `0x01`, payload `[0x46, 0x01, 0x01]`, value at `payload[3]`,
 *   *not* inverted. BudsLink's `sonySocketV1` and Gadgetbridge's V1 agree.
 * - V2: selector `0x03`, payload `[0x46, 0x03]`, value at `payload[2]`,
 *   inverted (`0x00` = on). BudsLink's `sonySocketV2`, and what this module
 *   implements.
 *
 * Gadgetbridge's V2 has V2's 2-byte inverted form with V1's selector, which is
 * self-inconsistent; the two references agreeing on V1 is what settles it. Its
 * volume write also appends a trailing `0x00` that BudsLink omits — we follow
 * BudsLink.
 *
 * Callers must pass `table: 2` on the client for these payloads — sending
 * them on table 1 is a valid frame for a setting the device does not have.
 */

/** The on/off selector. */
const SELECTOR_ENABLE = 0x03;
/** The prompt-volume selector, only on devices that report it. */
const SELECTOR_VOLUME = 0x20;

/** `VOICE_GUIDANCE_*`, table 2's GET/RET/SET/NTFY grouping. */
export const VOICE_GUIDANCE_GET = 0x46;
export const VOICE_GUIDANCE_RET = 0x47;
export const VOICE_GUIDANCE_SET = 0x48;
export const VOICE_GUIDANCE_NOTIFY = 0x49;

/** `[0x46, 0x03]`. */
export const encodeGetVoiceGuidance = (): number[] => [VOICE_GUIDANCE_GET, SELECTOR_ENABLE];

/** `[0x48, 0x03, onOff]` — off is 1, like every Sony system toggle. */
export const encodeSetVoiceGuidance = (enabled: boolean): number[] => [
  VOICE_GUIDANCE_SET,
  SELECTOR_ENABLE,
  enabled ? 0x00 : 0x01,
];

/** Reads `[0x47|0x49, 0x03, onOff, …]`. */
export function decodeVoiceGuidance(payload: Uint8Array): boolean {
  if (payload[1] !== SELECTOR_ENABLE) throw new Error('not a voice-guidance on/off body');
  if (payload.length !== 3 && payload.length !== 4) {
    throw new Error('expected 3 or 4 bytes');
  }
  if (payload[2] !== 0x00 && payload[2] !== 0x01) {
    throw new Error('on/off byte is neither 0 nor 1');
  }
  return payload[2] === 0x00;
}

/** `[0x46, 0x20]`. */
export const encodeGetVoiceGuidanceVolume = (): number[] => [
  VOICE_GUIDANCE_GET,
  SELECTOR_VOLUME,
];

/** `[0x48, 0x20, byte]` — negatives in two's complement. */
export function encodeSetVoiceGuidanceVolume(level: number): number[] {
  if (level < -2 || level > 2 || !Number.isInteger(level)) {
    throw new Error('voice guidance volume must be an integer in -2…2');
  }
  return [VOICE_GUIDANCE_SET, SELECTOR_VOLUME, level < 0 ? 256 + level : level];
}

/** Reads `[0x47|0x49, 0x20, signedByte]`. */
export function decodeVoiceGuidanceVolume(payload: Uint8Array): number {
  if (payload[1] !== SELECTOR_VOLUME) throw new Error('not a voice-guidance volume body');
  if (payload.length < 3) throw new Error('expected at least 3 bytes');
  const signed = payload[2] > 127 ? payload[2] - 256 : payload[2];
  if (signed < -2 || signed > 2) throw new Error('volume byte outside -2…2');
  return signed;
}

/** Whether a table-2 reply body is the on/off one. */
export const isVoiceGuidanceReply = (payload: Uint8Array): boolean =>
  (payload[0] === VOICE_GUIDANCE_RET || payload[0] === VOICE_GUIDANCE_NOTIFY) &&
  payload[1] === SELECTOR_ENABLE;

/** Whether a table-2 reply body is the volume one. */
export const isVoiceGuidanceVolumeReply = (payload: Uint8Array): boolean =>
  (payload[0] === VOICE_GUIDANCE_RET || payload[0] === VOICE_GUIDANCE_NOTIFY) &&
  payload[1] === SELECTOR_VOLUME;
