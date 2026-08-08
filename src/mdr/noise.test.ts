import { describe, expect, it } from 'vitest';

import { Command, Reply, SonyFunction } from './commands';
import {
  AMBIENT_LEVEL_MAX,
  AmbientSoundMode,
  NcAsmInquiryType,
  NcAsmMode,
  NcValue,
  ValueChangeStatus,
  decodeNoise,
  encodeGetNoise,
  encodeNoise,
  inquiryTypeFor,
  isNoiseReply,
  supportsNoiseVariant,
} from './noise';

const payload = (...bytes: number[]) => Uint8Array.from(bytes);

describe('inquiryTypeFor', () => {
  it('maps a reported capability onto the variant it implies', () => {
    // 0x6A is MODE_NC_ASM_..._DUAL_SINGLE_..., which speaks type 0x16.
    expect(inquiryTypeFor(new Set([0x6a]))).toBe(NcAsmInquiryType.ModeNcAsmDualSingleSeamless);
    expect(inquiryTypeFor(new Set([0x64]))).toBe(NcAsmInquiryType.NcOnOffAndAsmSeamless);
  });

  it('picks the richest variant when a device reports several', () => {
    // Sony numbered the more capable variants higher, and its own app drives
    // the richest one. Choosing the simplest would throw away ambient level.
    expect(inquiryTypeFor(new Set([SonyFunction.NoiseCancellingOnOff, 0x6b]))).toBe(
      NcAsmInquiryType.ModeNcAsmDualSeamless,
    );
  });

  it('is null for a device with no noise control at all', () => {
    // The WF-C500 reports neither, which is why it has no noise section.
    expect(inquiryTypeFor(new Set([0x21, 0x50, 0x23]))).toBeNull();
  });
});

describe('supportsNoiseVariant', () => {
  it('accepts the variants that have a codec', () => {
    expect(supportsNoiseVariant(NcAsmInquiryType.ModeNcAsmDualSingleSeamless)).toBe(true);
    expect(supportsNoiseVariant(NcAsmInquiryType.NcOnOffAndAsmSeamless)).toBe(true);
  });

  it('rejects ones we have named but not implemented', () => {
    // Named so the capability can be reported honestly; not driven, because
    // guessing a payload shape writes wrong bytes to real hardware.
    expect(supportsNoiseVariant(NcAsmInquiryType.ModeNcAsmDualSeamlessNoiseAdaptation)).toBe(false);
    expect(supportsNoiseVariant(null)).toBe(false);
  });
});

describe('decodeNoise', () => {
  it('reads the 8-byte variant with an explicit NC value', () => {
    // [0x67, 0x16, changed, on, mode=ambient, ncValue=dual, voice, level=12]
    const settings = decodeNoise(payload(0x67, 0x16, 0x01, 0x01, 0x01, 0x02, 0x01, 0x0c));

    expect(settings).toEqual({
      inquiryType: NcAsmInquiryType.ModeNcAsmDualSingleSeamless,
      enabled: true,
      mode: NcAsmMode.Ambient,
      ncValue: NcValue.OnDual,
      voiceFocus: true,
      ambientLevel: 12,
    });
  });

  it('reads the 7-byte mode-switch variant', () => {
    const settings = decodeNoise(payload(0x67, 0x17, 0x01, 0x01, 0x00, 0x00, 0x05));

    expect(settings.mode).toBe(NcAsmMode.NoiseCancelling);
    expect(settings.ambientLevel).toBe(5);
    expect(settings.voiceFocus).toBe(false);
    // This variant has no NC value field at all — absent, not zero.
    expect(settings.ncValue).toBeNull();
  });

  it('treats the older variant’s NC toggle as a mode', () => {
    // 0x13 has no mode selector; noise cancelling on/off *is* the mode, so it
    // is normalised to one so the UI does not need to know the difference.
    const on = decodeNoise(payload(0x67, 0x13, 0x01, 0x01, 0x01, 0x00, 0x08));
    const off = decodeNoise(payload(0x67, 0x13, 0x01, 0x01, 0x00, 0x00, 0x08));

    expect(on.mode).toBe(NcAsmMode.NoiseCancelling);
    expect(off.mode).toBe(NcAsmMode.Ambient);
  });

  it('reads the enabled flag independently of the mode', () => {
    const off = decodeNoise(payload(0x67, 0x16, 0x01, 0x00, 0x00, 0x02, 0x00, 0x00));
    expect(off.enabled).toBe(false);
  });

  it('refuses a variant it has no codec for', () => {
    // Silently reading it as another shape would yield plausible nonsense,
    // because the variants differ in length as well as meaning.
    expect(() => decodeNoise(payload(0x67, 0x19, 0x01, 0x01, 0x00, 0x00, 0x05))).toThrow(
      /unsupported NC\/ASM variant/,
    );
  });

  it('refuses a payload of the wrong length for its variant', () => {
    expect(() => decodeNoise(payload(0x67, 0x16, 0x01, 0x01, 0x00, 0x02, 0x00))).toThrow(
      /expected 8 bytes/,
    );
  });
});

describe('encodeNoise', () => {
  const base = {
    inquiryType: NcAsmInquiryType.ModeNcAsmDualSingleSeamless,
    enabled: true,
    mode: NcAsmMode.Ambient,
    ncValue: NcValue.OnDual,
    voiceFocus: false,
    ambientLevel: 10,
  };

  it('round-trips through decodeNoise', () => {
    const encoded = encodeNoise(base);
    expect(encoded[0]).toBe(Command.SetNcAsm);
    // Swap the SET opcode for the RET one; the body is identical.
    expect(decodeNoise(Uint8Array.from([Reply.NcAsmParam, ...encoded.slice(1)]))).toEqual(base);
  });

  it('always reports the change as settled, never mid-sweep', () => {
    // UnderChanging is what a device sends while a physical dial moves. A
    // controller asking for a value has, by definition, finished choosing.
    expect(encodeNoise(base)[2]).toBe(ValueChangeStatus.Changed);
  });

  it('clamps the ambient level into range', () => {
    expect(encodeNoise({ ...base, ambientLevel: 99 }).at(-1)).toBe(AMBIENT_LEVEL_MAX);
    expect(encodeNoise({ ...base, ambientLevel: -4 }).at(-1)).toBe(0);
  });

  it('rounds a fractional level rather than writing a bad byte', () => {
    expect(encodeNoise({ ...base, ambientLevel: 7.6 }).at(-1)).toBe(8);
  });

  it('encodes voice focus into the ambient sound mode byte', () => {
    expect(encodeNoise({ ...base, voiceFocus: true })[6]).toBe(AmbientSoundMode.Voice);
    expect(encodeNoise({ ...base, voiceFocus: false })[6]).toBe(AmbientSoundMode.Normal);
  });

  it('omits the NC value on variants that have no room for it', () => {
    const encoded = encodeNoise({ ...base, inquiryType: NcAsmInquiryType.ModeNcAsmDualSeamless });
    expect(encoded).toHaveLength(7);
  });

  it('refuses a variant it has no codec for', () => {
    expect(() => encodeNoise({ ...base, inquiryType: 0x19 })).toThrow(/unsupported/);
  });
});

describe('encodeGetNoise', () => {
  it('asks about one variant', () => {
    expect(encodeGetNoise(0x16)).toEqual([Command.GetNcAsm, 0x16]);
  });
});

describe('isNoiseReply', () => {
  it('matches both the answer and the notification', () => {
    expect(isNoiseReply(payload(Reply.NcAsmParam, 0x16))).toBe(true);
    expect(isNoiseReply(payload(Reply.NcAsmNotify, 0x16))).toBe(true);
  });

  it('ignores everything else', () => {
    expect(isNoiseReply(payload(Reply.EqNotify, 0x00))).toBe(false);
    expect(isNoiseReply(payload())).toBe(false);
  });
});
