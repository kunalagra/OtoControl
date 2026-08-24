/**
 * Sony per-side touch assignment (`AssignableSettings`, SYSTEM param `0x03`).
 *
 * What each earbud's touch surface does. Byte shapes confirmed identical by
 * Gadgetbridge (`SonyProtocolImplV2.getButtonModes`/`setButtonModes`) and
 * BudsLink's `sonySocketV2` (both GPL — read as reference, nothing copied);
 * the enum names are Sony's own, from the Sound Connect decompile.
 *
 * The reply only carries the *current* assignment — which modes a particular
 * model offers is not on the wire, so the UI offers every mode and the device
 * rejects one it does not support (the write surfaces the error). BudsLink
 * constrains the list per model from app data; without a clean source for
 * that table, honesty beats a stale copy of it.
 */

import { Command, Reply } from './commands';

/**
 * What a touch surface can be assigned to.
 *
 * Names are Sony's own, from the `Preset` enum in its V2 system params.
 * `0x10` is not in that enum — it comes from Gadgetbridge, which reads it as
 * volume control on this older left/right parameter; the two features share
 * most values but not all.
 */
export const ButtonMode = {
  AmbientSoundControl: 0x00,
  VolumeControl: 0x10,
  PlaybackControl: 0x20,
  /** `PLAYBACK_CONTROL_VOICE_ASSISTANT_LIMITATION` — playback, minus the
   *  gestures the device reserves for its voice assistant. */
  PlaybackControlVoiceAssistantLimitation: 0x22,
  /** `AMBIENT_SOUND_CONTROL_QUICK_ACCESS` — noise control plus Quick Access. */
  AmbientSoundControlQuickAccess: 0x35,
  NoFunction: 0xff,
} as const;

/**
 * The modes offered in the UI.
 *
 * `0x35` is deliberately absent, though not for the reason Gadgetbridge
 * suggests. Gadgetbridge treats `0x00` and `0x35` as one logical mode and
 * picks the byte from capabilities; Sony does not — its `PresetType` gives
 * them separate titles, so they are genuinely two different presets.
 *
 * What Sony actually does is read the available presets **from the device**:
 * its capability table set 1 carries, per key, a
 * `[key, keyType, preset, ...actions]` record (`te0/b.java`, built by
 * `DeviceCapabilityTableset1Builder`), so the app never has to guess which
 * bytes a model accepts. This driver does not read that structure yet — see
 * `docs/PROVIDER-GAPS.md` — so it offers the plain `0x00` and decodes `0x35`
 * without offering it. A model that wants `0x35` therefore has one
 * un-settable mode rather than a control that fails, which is the honest
 * behaviour until the capability read lands.
 */
export const BUTTON_MODE_OPTIONS: Array<{ value: number; label: string }> = [
  { value: ButtonMode.AmbientSoundControl, label: 'Noise control' },
  { value: ButtonMode.VolumeControl, label: 'Volume' },
  { value: ButtonMode.PlaybackControl, label: 'Playback' },
  { value: ButtonMode.NoFunction, label: 'None' },
];

const MODES: ReadonlySet<number> = new Set(Object.values(ButtonMode));

/** `[0xF6 SYSTEM_GET_PARAM, 0x03]`. */
export const encodeGetAssignable = (): number[] => [Command.GetSystemParam, 0x03];

/** `[0xF8 SYSTEM_SET_PARAM, 0x03, 0x02, left, right]`. */
export function encodeSetAssignable(left: number, right: number): number[] {
  if (!MODES.has(left) || !MODES.has(right)) {
    throw new Error('button modes must be known enum values');
  }
  return [Command.SetSystemParam, 0x03, 0x02, left, right];
}

/** Reads `[0xF7|0xF9, 0x03, 0x02, left, right]`. */
export function decodeAssignable(payload: Uint8Array): { left: number; right: number } {
  if (payload[1] !== 0x03) throw new Error('not an assignable-settings body');
  if (payload.length < 5) throw new Error('expected at least 5 bytes');
  // 0x02 announces the two-value shape; anything else is a payload this
  // module does not know how to read.
  if (payload[2] !== 0x02) throw new Error('unsupported assignable payload shape');
  if (!MODES.has(payload[3]) || !MODES.has(payload[4])) {
    throw new Error('button mode byte outside the known enum');
  }
  return { left: payload[3], right: payload[4] };
}

/** Whether a system reply body is an assignable-settings one. */
export const isAssignableReply = (payload: Uint8Array): boolean =>
  (payload[0] === Reply.SystemParam || payload[0] === Reply.SystemParamNotify) &&
  payload[1] === 0x03;
