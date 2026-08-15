/**
 * Sony noise cancelling and ambient sound (the `NCASM_*` command family).
 *
 * The awkward part of this feature is that there is no single message shape.
 * Sony has shipped a dozen variants of the same idea, and a device speaks
 * exactly one of them — chosen by which `FunctionType` it reports at connect.
 * A WH-1000XM5 and a WH-1000XM3 both do "noise cancelling with an ambient
 * level", and they do not agree on the bytes.
 *
 * So none of this is guessed from the model. `inquiryTypeFor` maps the
 * capability the device *reports* onto the variant it speaks, and the codec for
 * that variant is looked up rather than assumed. A model we have never seen
 * works if it reports a variant we implement, and is cleanly unsupported if it
 * does not — instead of being sent bytes shaped for a different device.
 *
 * Layouts transcribed from the Sound Connect decompile (`pf0/*`, `rf0/*`,
 * `v2/table1/ncasm/param/*`). Every variant shares the prefix
 * `[command, inquiryType, valueChangeStatus, enabled]` and then diverges.
 */

import { Command, Reply, SonyFunction } from './commands';

/** Second byte of every NCASM message: which variant is being talked about. */
export const NcAsmInquiryType = {
  NcOnOff: 0x01,
  NcOnOffAndAsmOnOff: 0x11,
  NcModeSwitchAndAsmOnOff: 0x12,
  NcOnOffAndAsmSeamless: 0x13,
  NcModeSwitchAndAsmSeamless: 0x14,
  ModeNcAsmAutoSeamless: 0x15,
  ModeNcAsmDualSingleSeamless: 0x16,
  ModeNcAsmDualSeamless: 0x17,
  ModeNcNcssAsmDualSeamless: 0x18,
  ModeNcAsmDualSeamlessNoiseAdaptation: 0x19,
  AsmOnOff: 0x21,
  AsmSeamless: 0x22,
  NcAmbToggle: 0x30,
} as const;

/** Whether the device has settled on the value or is still moving to it. */
export const ValueChangeStatus = { UnderChanging: 0x00, Changed: 0x01 } as const;

const OnOff = { Off: 0x00, On: 0x01 } as const;

/** Which of the two processing modes is selected. */
export const NcAsmMode = { NoiseCancelling: 0x00, Ambient: 0x01 } as const;

/** How noise cancelling is running, on variants that expose the distinction. */
export const NcValue = {
  Off: 0x00,
  OnSingle: 0x01,
  OnDual: 0x02,
  Auto: 0x03,
  AutoSingle: 0x04,
  AutoDual: 0x05,
} as const;

/** Ambient sound can focus on voices rather than passing everything through. */
export const AmbientSoundMode = { Normal: 0x00, Voice: 0x01 } as const;

/** The highest ambient level Sony's own UI offers. */
export const AMBIENT_LEVEL_MAX = 20;

/**
 * One normalised shape for every variant.
 *
 * The UI works in these terms; the wire differences stay in this module. Fields
 * a variant does not carry are null, which is why they are nullable at all —
 * "this device cannot express that" rather than "not read yet".
 */
export interface NoiseSettings {
  /** The variant this came from, needed to encode a change back. */
  inquiryType: number;
  /** Whether noise processing is on at all. */
  enabled: boolean;
  /** Null on variants with only one mode, such as ambient-only devices. */
  mode: number | null;
  /** 0…20. Null when the variant has no level, only on/off. */
  ambientLevel: number | null;
  /** Null when the variant cannot focus ambient sound on voices. */
  voiceFocus: boolean | null;
  /** Dual/single/auto noise cancelling. Null when not exposed. */
  ncValue: number | null;
}

/**
 * Which variant a reported capability implies.
 *
 * Names line up one-to-one between `FunctionType` and `NcAsmInquiredType` in
 * the decompile, which is what makes this a lookup rather than a guess.
 */
const INQUIRY_FOR_FUNCTION: Record<number, number> = {
  [SonyFunction.NoiseCancellingOnOff]: NcAsmInquiryType.NcOnOff,
  0x62: NcAsmInquiryType.NcOnOffAndAsmOnOff,
  0x63: NcAsmInquiryType.NcModeSwitchAndAsmOnOff,
  0x64: NcAsmInquiryType.NcOnOffAndAsmSeamless,
  0x65: NcAsmInquiryType.NcModeSwitchAndAsmSeamless,
  [SonyFunction.AmbientSoundMode]: NcAsmInquiryType.AsmOnOff,
  0x67: NcAsmInquiryType.AsmSeamless,
  0x68: NcAsmInquiryType.ModeNcAsmAutoSeamless,
  0x6a: NcAsmInquiryType.ModeNcAsmDualSingleSeamless,
  0x6b: NcAsmInquiryType.ModeNcAsmDualSeamless,
  0x6c: NcAsmInquiryType.ModeNcNcssAsmDualSeamless,
  0x6d: NcAsmInquiryType.ModeNcAsmDualSeamlessNoiseAdaptation,
};

/**
 * The variant a device speaks, from its capability table, or null if it reports
 * none we handle.
 *
 * Order matters: a device can report several NC/ASM capabilities, and the
 * richest one is the one its own app drives. Sorting by function id descending
 * picks it, because Sony assigned the more capable variants higher ids.
 */
export function inquiryTypeFor(capabilities: Set<number>): number | null {
  const supported = [...capabilities]
    .filter((id) => id in INQUIRY_FOR_FUNCTION)
    .sort((a, b) => b - a);
  return supported.length === 0 ? null : INQUIRY_FOR_FUNCTION[supported[0]];
}

/** Reading and writing for one variant. Bodies exclude the 4-byte prefix. */
interface Codec {
  /** Total payload length, so a malformed frame is rejected rather than read. */
  length: number;
  decode(payload: Uint8Array): Omit<NoiseSettings, 'inquiryType' | 'enabled'>;
  encode(settings: NoiseSettings): number[];
}

const clampLevel = (level: number | null): number =>
  Math.max(0, Math.min(AMBIENT_LEVEL_MAX, Math.round(level ?? 0)));

const asmModeByte = (voiceFocus: boolean | null): number =>
  voiceFocus ? AmbientSoundMode.Voice : AmbientSoundMode.Normal;

/**
 * `[…, ncOnOff, ambientSoundMode, level]` — noise cancelling is a plain toggle
 * and ambient has its own level. Used by the XM3/XM4 generation.
 */
const ncOnOffAndAsmSeamless: Codec = {
  length: 7,
  decode: (p) => ({
    mode: p[4] === OnOff.On ? NcAsmMode.NoiseCancelling : NcAsmMode.Ambient,
    ambientLevel: p[6],
    voiceFocus: p[5] === AmbientSoundMode.Voice,
    ncValue: null,
  }),
  encode: (s) => [
    s.mode === NcAsmMode.NoiseCancelling ? OnOff.On : OnOff.Off,
    asmModeByte(s.voiceFocus),
    clampLevel(s.ambientLevel),
  ],
};

/** `[…, ncAsmMode, ambientSoundMode, level]` — an explicit NC/ambient selector. */
const modeNcAsmDualSeamless: Codec = {
  length: 7,
  decode: (p) => ({
    mode: p[4],
    ambientLevel: p[6],
    voiceFocus: p[5] === AmbientSoundMode.Voice,
    ncValue: null,
  }),
  encode: (s) => [
    s.mode ?? NcAsmMode.NoiseCancelling,
    asmModeByte(s.voiceFocus),
    clampLevel(s.ambientLevel),
  ],
};

/**
 * `[…, ncAsmMode, ncValue, ambientSoundMode, level]` — as above plus how noise
 * cancelling itself is running (dual, single or automatic).
 */
const modeNcAsmWithNcValue: Codec = {
  length: 8,
  decode: (p) => ({
    mode: p[4],
    ambientLevel: p[7],
    voiceFocus: p[6] === AmbientSoundMode.Voice,
    ncValue: p[5],
  }),
  encode: (s) => [
    s.mode ?? NcAsmMode.NoiseCancelling,
    s.ncValue ?? NcValue.OnDual,
    asmModeByte(s.voiceFocus),
    clampLevel(s.ambientLevel),
  ],
};

const CODECS: Record<number, Codec> = {
  [NcAsmInquiryType.NcOnOffAndAsmSeamless]: ncOnOffAndAsmSeamless,
  [NcAsmInquiryType.ModeNcAsmDualSeamless]: modeNcAsmDualSeamless,
  [NcAsmInquiryType.ModeNcAsmAutoSeamless]: modeNcAsmWithNcValue,
  [NcAsmInquiryType.ModeNcAsmDualSingleSeamless]: modeNcAsmWithNcValue,
};

/** Whether this app can drive a variant, as opposed to merely naming it. */
export const supportsNoiseVariant = (inquiryType: number | null): boolean =>
  inquiryType !== null && inquiryType in CODECS;

/** `[0x66, inquiryType]`. */
export const encodeGetNoise = (inquiryType: number): number[] => [
  Command.GetNcAsm,
  inquiryType,
];

/**
 * Reads a `NCASM_RET_PARAM` or `NCASM_NTFY_PARAM` body.
 *
 * Throws on a variant we have no codec for rather than reading it as some other
 * shape — the payloads are different lengths, so a wrong guess silently yields
 * plausible nonsense.
 */
export function decodeNoise(payload: Uint8Array): NoiseSettings {
  if (payload.length < 4) throw new Error('expected at least 4 bytes');
  const inquiryType = payload[1];
  const codec = CODECS[inquiryType];
  if (!codec) throw new Error(`unsupported NC/ASM variant 0x${inquiryType.toString(16)}`);
  if (payload.length !== codec.length) {
    throw new Error(`expected ${codec.length} bytes for variant 0x${inquiryType.toString(16)}`);
  }
  return { inquiryType, enabled: payload[3] === OnOff.On, ...codec.decode(payload) };
}

/**
 * Builds a `NCASM_SET_PARAM`.
 *
 * `ValueChangeStatus` is always `Changed`: `UnderChanging` is what a device
 * sends while a physical dial is mid-sweep, not something a controller asks for.
 */
export function encodeNoise(settings: NoiseSettings): number[] {
  const codec = CODECS[settings.inquiryType];
  if (!codec) {
    throw new Error(`unsupported NC/ASM variant 0x${settings.inquiryType.toString(16)}`);
  }
  return [
    Command.SetNcAsm,
    settings.inquiryType,
    ValueChangeStatus.Changed,
    settings.enabled ? OnOff.On : OnOff.Off,
    ...codec.encode(settings),
  ];
}

/** Whether a notification body is an NC/ASM one this module should read. */
export const isNoiseReply = (payload: Uint8Array): boolean =>
  payload.length > 0 && (payload[0] === Reply.NcAsmParam || payload[0] === Reply.NcAsmNotify);
