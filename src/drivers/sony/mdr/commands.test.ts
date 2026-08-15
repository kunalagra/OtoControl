import { describe, expect, it } from 'vitest';

import {
  AudioInquiredType,
  BatteryType,
  Command,
  PowerInquiredType,
  PriorMode,
  USER_POWER_OFF,
  decodeConnectionMode,
  decodeUpscalingSetting,
  encodeConnectionMode,
  encodePowerOff,
  encodeUpscaling,
  DeviceInfoType,
  EQ_MIDPOINT,
  EqPreset,
  Reply,
  SonyFunction,
  codecName,
  decodeCodec,
  decodeDeviceInfoText,
  decodeDualBattery,
  decodeEq,
  decodeSeriesAndColour,
  decodeSingleBattery,
  decodeSupportedFunctions,
  decodeUpscaling,
  encodeEqBands,
  encodeEqPreset,
  eqPresetName,
} from './commands';

const payload = (...bytes: number[]) => Uint8Array.from(bytes);

/** Payloads captured verbatim from a Sony WF-C500, firmware 1.0.7. */
const CAPTURED = {
  model: payload(0x05, 0x01, 0x07, 0x57, 0x46, 0x2d, 0x43, 0x35, 0x30, 0x30),
  firmware: payload(0x05, 0x02, 0x05, 0x31, 0x2e, 0x30, 0x2e, 0x37),
  seriesColour: payload(0x05, 0x03, 0x00, 0x01),
  battery: payload(0x23, 0x01, 0x64, 0x00, 0x64, 0x00),
  codec: payload(0x13, 0x02, 0x02),
  upscaling: payload(0x13, 0x03, 0x01, 0x00),
  eq: payload(0x57, 0x00, 0x00, 0x06, 0x0a, 0x0a, 0x0a, 0x0a, 0x0a, 0x0a),
  supportedFunctions: payload(
    0x07, 0x00, 0x10, 0x10, 0x00, 0x11, 0x01, 0x12, 0x02, 0x13, 0x03, 0x14, 0x04,
    0x21, 0x07, 0x23, 0x05, 0x27, 0x06, 0x32, 0x08, 0x50, 0x09, 0x90, 0x0a,
    0x92, 0x0b, 0xa1, 0x0c, 0xc1, 0x0d, 0xe1, 0x0e, 0xe2, 0x0f,
  ),
};

describe('opcode conventions', () => {
  it('pairs each GET with the reply it produces', () => {
    expect(Reply.ProtocolInfo).toBe(Command.GetProtocolInfo + 1);
    expect(Reply.DeviceInfo).toBe(Command.GetDeviceInfo + 1);
    expect(Reply.SupportFunction).toBe(Command.GetSupportFunction + 1);
    expect(Reply.Status).toBe(Command.GetStatus + 1);
    expect(Reply.PowerStatus).toBe(Command.GetPowerStatus + 1);
    expect(Reply.Eq).toBe(Command.GetEq + 1);
  });

  it('places SET two above GET', () => {
    expect(Command.SetEq).toBe(Command.GetEq + 2);
    expect(Command.SetNcAsm).toBe(Command.GetNcAsm + 2);
  });
});

describe('device info', () => {
  it('decodes the model name', () => {
    expect(decodeDeviceInfoText(CAPTURED.model)).toBe('WF-C500');
  });

  it('decodes the firmware version', () => {
    expect(decodeDeviceInfoText(CAPTURED.firmware)).toBe('1.0.7');
  });

  it('honours the declared length rather than reading to the end', () => {
    const padded = payload(0x05, 0x01, 0x03, 0x41, 0x42, 0x43, 0x44, 0x45);
    expect(decodeDeviceInfoText(padded)).toBe('ABC');
  });

  it('decodes series and colour, which carry no length prefix', () => {
    // Reading byte 2 as a length would give an empty value here.
    expect(decodeSeriesAndColour(CAPTURED.seriesColour)).toEqual({ series: 0, colour: 1 });
  });

  it('rejects a truncated series/colour reply', () => {
    expect(() => decodeSeriesAndColour(payload(0x05, 0x03, 0x00))).toThrow();
  });

  it('keeps the value types distinct', () => {
    expect(DeviceInfoType.ModelName).toBe(0x01);
    expect(DeviceInfoType.SeriesAndColour).toBe(0x03);
  });
});

describe('battery', () => {
  it('decodes both earbuds at 100%, neither charging', () => {
    const battery = decodeDualBattery(CAPTURED.battery);
    expect(battery.left).toMatchObject({ level: 100, charging: false, onPower: false });
    expect(battery.right).toMatchObject({ level: 100, charging: false, onPower: false });
  });

  it('reads the charging flag per side', () => {
    const battery = decodeDualBattery(payload(0x23, 0x01, 0x50, 0x01, 0x30, 0x00));
    expect(battery.left).toMatchObject({ level: 80, charging: true });
    expect(battery.right).toMatchObject({ level: 48, charging: false });
  });

  it('decodes a single battery', () => {
    expect(decodeSingleBattery(payload(0x23, 0x00, 0x2a, 0x01))).toMatchObject({
      level: 42,
      charging: true,
    });
  });

  it('rejects a short payload rather than reporting 0%', () => {
    expect(() => decodeDualBattery(payload(0x23, 0x01, 0x64))).toThrow();
  });

  it('distinguishes the inquiry types that matter', () => {
    // Asking for Single on a dual-battery device is what returned silence.
    expect(BatteryType.Single).not.toBe(BatteryType.Dual);
  });
});

describe('status', () => {
  it('decodes the codec as AAC', () => {
    expect(decodeCodec(CAPTURED.codec)).toBe(0x02);
    expect(codecName(decodeCodec(CAPTURED.codec))).toBe('AAC');
  });

  it('names the codecs it knows and labels the rest', () => {
    expect(codecName(0x01)).toBe('SBC');
    expect(codecName(0x10)).toBe('LDAC');
    expect(codecName(0x77)).toBe('Codec 0x77');
  });

  it('decodes upscaling as enabled', () => {
    expect(decodeUpscaling(CAPTURED.upscaling)).toBe(true);
    expect(decodeUpscaling(payload(0x13, 0x03, 0x00, 0x00))).toBe(false);
  });
});

describe('equaliser', () => {
  it('decodes the captured six-band flat reply', () => {
    expect(decodeEq(CAPTURED.eq)).toEqual({
      inquiryType: 0x00,
      preset: EqPreset.Off,
      gains: [0, 0, 0, 0, 0, 0],
    });
  });

  it('treats the midpoint as flat and reads either side of it', () => {
    const raw = payload(0x57, 0x00, 0xa0, 0x06, 0x00, 0x05, 0x0a, 0x0f, 0x14, 0x0a);
    expect(decodeEq(raw).gains).toEqual([-10, -5, 0, 5, 10, 0]);
  });

  it('uses the declared band count, not the remaining length', () => {
    const raw = payload(0x57, 0x00, 0x00, 0x02, 0x0a, 0x0a, 0xff, 0xff);
    expect(decodeEq(raw).gains).toHaveLength(2);
  });

  it('rejects a band count longer than the payload', () => {
    expect(() => decodeEq(payload(0x57, 0x00, 0x00, 0x06, 0x0a))).toThrow();
  });

  it('round-trips band steps through encodeEqBands', () => {
    const gains = [-10, -3, 0, 4, 10, 0];
    const encoded = encodeEqBands(EqPreset.Custom, gains);
    expect(encoded[0]).toBe(Command.SetEq);
    expect(encoded[2]).toBe(EqPreset.Custom);
    expect(encoded[3]).toBe(gains.length);
    expect(decodeEq(Uint8Array.from([0x57, 0x00, ...encoded.slice(2)])).gains).toEqual(gains);
  });

  it('offsets encoded bands by the midpoint', () => {
    expect(encodeEqBands(EqPreset.Off, [0, 0])).toEqual([
      Command.SetEq, 0x00, EqPreset.Off, 2, EQ_MIDPOINT, EQ_MIDPOINT,
    ]);
  });

  /**
   * The bug this guards: sending the current curve alongside a preset id makes
   * a frame the earbuds ACK and discard, so the preset silently never applies.
   * Sony's app sends a zero-length band list here in both protocol generations.
   */
  it('sends no band steps when selecting a preset', () => {
    expect(encodeEqPreset(EqPreset.BassBoost)).toEqual([
      Command.SetEq, 0x00, EqPreset.BassBoost, 0,
    ]);
  });

  it('encodes every offered preset as exactly four bytes', () => {
    for (const preset of Object.values(EqPreset)) {
      expect(encodeEqPreset(preset)).toHaveLength(4);
    }
  });

  it('names presets', () => {
    expect(eqPresetName(EqPreset.Off)).toBe('Off');
    expect(eqPresetName(EqPreset.BassBoost)).toBe('Bass boost');
    expect(eqPresetName(0x7f)).toBe('Preset 0x7f');
  });
});

describe('supported functions', () => {
  const supported = decodeSupportedFunctions(CAPTURED.supportedFunctions);

  it('reads all sixteen the WF-C500 reports', () => {
    expect(supported.size).toBe(16);
  });

  it('includes what the device actually does', () => {
    expect(supported.has(SonyFunction.CodecIndicator)).toBe(true);
    expect(supported.has(SonyFunction.UpscalingIndicator)).toBe(true);
    expect(supported.has(SonyFunction.LeftRightBatteryLevel)).toBe(true);
    expect(supported.has(SonyFunction.PresetEq)).toBe(true);
    expect(supported.has(SonyFunction.PowerOff)).toBe(true);
  });

  it('excludes what it does not — the WF-C500 has no ANC', () => {
    expect(supported.has(SonyFunction.NoiseCancellingOnOff)).toBe(false);
    expect(supported.has(SonyFunction.AmbientSoundMode)).toBe(false);
    expect(supported.has(SonyFunction.AutoPowerOff)).toBe(false);
    expect(supported.has(SonyFunction.CaseBatteryLevel)).toBe(false);
    expect(supported.has(SonyFunction.CustomEq)).toBe(false);
  });

  it('matches the queries that fell silent during bring-up', () => {
    // Single battery, case battery and auto power off were all ignored, and
    // all three are absent from the table. Silence means unsupported.
    expect(supported.has(SonyFunction.BatteryLevel)).toBe(false);
    expect(supported.has(SonyFunction.CaseBatteryLevel)).toBe(false);
    expect(supported.has(SonyFunction.AutoPowerOff)).toBe(false);
  });

  it('survives a truncated table instead of throwing', () => {
    const truncated = payload(0x07, 0x00, 0x05, 0x12, 0x00, 0x13, 0x01);
    expect(decodeSupportedFunctions(truncated).size).toBe(2);
  });
});

describe('battery status is four states, not a boolean', () => {
  it('distinguishes charged from not charging', () => {
    // A bud resting in a full case reports CHARGED. Reading that as "not
    // charging" makes it indistinguishable from a bud in your ear.
    const charged = decodeSingleBattery(payload(0x23, 0x00, 0x64, 0x03));
    expect(charged.charging).toBe(false);
    expect(charged.onPower).toBe(true);

    const idle = decodeSingleBattery(payload(0x23, 0x00, 0x64, 0x00));
    expect(idle.onPower).toBe(false);
  });

  it('treats actively charging as both charging and on power', () => {
    const cell = decodeSingleBattery(payload(0x23, 0x00, 0x50, 0x01));
    expect(cell).toMatchObject({ charging: true, onPower: true });
  });

  it('does not claim power for an unknown status', () => {
    const cell = decodeSingleBattery(payload(0x23, 0x00, 0x50, 0x02));
    expect(cell).toMatchObject({ charging: false, onPower: false });
  });

  it('keeps the raw status for anything we have not modelled', () => {
    expect(decodeSingleBattery(payload(0x23, 0x00, 0x50, 0x03)).status).toBe(0x03);
  });

  it('applies per earbud, so one can be in the case and the other not', () => {
    const both = decodeDualBattery(payload(0x23, 0x01, 0x64, 0x03, 0x50, 0x00));
    expect(both.left.onPower).toBe(true);
    expect(both.right.onPower).toBe(false);
  });
});

describe('an earbud in the case', () => {
  /** Captured with the left bud in the case and the right one worn. */
  const asymmetric = payload(0x23, 0x01, 0x00, 0x02, 0x64, 0x00);

  it('reports UNKNOWN with level 0, not a charge state', () => {
    const { left, right } = decodeDualBattery(asymmetric);
    expect(left).toMatchObject({ level: 0, status: 0x02, present: false });
    expect(right).toMatchObject({ level: 100, status: 0x00, present: true });
  });

  it('is not on power, despite sitting in the case', () => {
    // The obvious guess — that the case charges it, so it reports charging —
    // is wrong: it leaves the tandem link and stops reporting entirely.
    expect(decodeDualBattery(asymmetric).left.onPower).toBe(false);
    expect(decodeDualBattery(asymmetric).left.charging).toBe(false);
  });

  it('marks a genuinely flat but reporting earbud as present', () => {
    const flat = decodeDualBattery(payload(0x23, 0x01, 0x00, 0x00, 0x64, 0x00));
    expect(flat.left).toMatchObject({ level: 0, present: true });
  });
});

describe('commands resolved from the Sound Connect decompile', () => {
  it('powers off through POWER_SET_STATUS, which fills the gap at 0x24', () => {
    // BudsLink's table jumps 0x23 -> 0x25; the family is GET/RET/SET/NTFY.
    expect(Command.SetPowerStatus).toBe(0x24);
    expect(Command.SetPowerStatus).toBe(Command.GetPowerStatus + 2);
    expect(encodePowerOff()).toEqual([0x24, PowerInquiredType.PowerOff, USER_POWER_OFF]);
  });

  it('sends connection mode as three bytes, without the LE-audio enable flag', () => {
    expect(encodeConnectionMode(PriorMode.SoundQuality)).toEqual([0xe8, 0x00, 0x00]);
    expect(encodeConnectionMode(PriorMode.ConnectionQuality)).toEqual([0xe8, 0x00, 0x01]);
  });

  it('decodes the connection mode reply', () => {
    expect(decodeConnectionMode(payload(0xe7, 0x00, 0x01))).toBe(PriorMode.ConnectionQuality);
  });

  it('keeps DSEE at three bytes, matching the v2 payload class', () => {
    // v1 inserts a setting-type byte; v2 writes the value straight after.
    expect(encodeUpscaling(true)).toEqual([0xe8, AudioInquiredType.Upscaling, 0x01]);
    expect(encodeUpscaling(false)).toEqual([0xe8, AudioInquiredType.Upscaling, 0x00]);
  });

  it('separates the DSEE setting from the DSEE indicator', () => {
    // The indicator can read false while the setting is on — different things.
    expect(decodeUpscalingSetting(payload(0xe7, 0x01, 0x01))).toBe(true);
    expect(decodeUpscaling(payload(0x13, 0x03, 0x00, 0x00))).toBe(false);
  });

  it('shares one opcode family across features, told apart by the inquiry byte', () => {
    expect(encodeConnectionMode(0)[0]).toBe(encodeUpscaling(true)[0]);
    expect(AudioInquiredType.ConnectionMode).not.toBe(AudioInquiredType.Upscaling);
  });
});
