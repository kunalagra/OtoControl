import { describe, expect, it } from 'vitest';

import { Command } from './commands';
import {
  AUTO_POWER_OFF_OPTIONS,
  AutoPowerOff,
  OnOffSettingValue,
  PowerInquiryType,
  SystemInquiryType,
  autoPowerOffLabel,
  decodeAutoPowerOff,
  decodeSystemToggle,
  encodeAutoPowerOff,
  encodeGetAutoPowerOff,
  encodeGetSystemToggle,
  encodeSystemToggle,
  isSimpleToggle,
} from './settings';

const payload = (...bytes: number[]) => Uint8Array.from(bytes);

describe('OnOffSettingValue', () => {
  it('is inverted, which is the whole reason it has a name', () => {
    // Sony uses OFF=0/ON=1 elsewhere in this same protocol. Assuming the
    // obvious mapping here silently inverts every toggle in the module.
    expect(OnOffSettingValue.On).toBe(0x00);
    expect(OnOffSettingValue.Off).toBe(0x01);
  });
});

describe('system toggles', () => {
  it('encodes pause-on-removal with the inverted on/off byte', () => {
    expect(encodeSystemToggle(SystemInquiryType.PlaybackControlByWearing, true)).toEqual([
      Command.SetSystemParam, 0x01, 0x00,
    ]);
    expect(encodeSystemToggle(SystemInquiryType.PlaybackControlByWearing, false)).toEqual([
      Command.SetSystemParam, 0x01, 0x01,
    ]);
  });

  it('round-trips through the decoder', () => {
    for (const on of [true, false]) {
      const encoded = encodeSystemToggle(SystemInquiryType.AutoVolume, on);
      const decoded = decodeSystemToggle(Uint8Array.from([0xf7, ...encoded.slice(1)]));
      expect(decoded).toEqual({ inquiryType: SystemInquiryType.AutoVolume, on });
    }
  });

  it('refuses settings that are not a plain on/off', () => {
    // Speak-to-chat and assignable settings carry structured parameters; the
    // device would read a 3-byte body as something else entirely.
    expect(() => encodeSystemToggle(SystemInquiryType.SmartTalkingModeType1, true)).toThrow(
      /not a plain on\/off/,
    );
    expect(() => encodeSystemToggle(SystemInquiryType.AssignableSettings, true)).toThrow();
    expect(isSimpleToggle(SystemInquiryType.SmartTalkingModeType1)).toBe(false);
    expect(isSimpleToggle(SystemInquiryType.PlaybackControlByWearing)).toBe(true);
  });

  it('asks about one setting at a time', () => {
    expect(encodeGetSystemToggle(SystemInquiryType.PlaybackControlByWearing)).toEqual([
      Command.GetSystemParam, 0x01,
    ]);
  });

  it('rejects a body of the wrong length', () => {
    expect(() => decodeSystemToggle(payload(0xf7, 0x01))).toThrow(/expected 3 bytes/);
  });
});

describe('auto power off', () => {
  it('encodes a timeout under the power-param opcode', () => {
    expect(encodeAutoPowerOff(AutoPowerOff.After30Min)).toEqual([
      Command.SetPowerParam, PowerInquiryType.AutoPowerOff, 0x01,
    ]);
  });

  it('round-trips every offered option', () => {
    for (const { value } of AUTO_POWER_OFF_OPTIONS) {
      const encoded = encodeAutoPowerOff(value);
      expect(decodeAutoPowerOff(Uint8Array.from([0x27, ...encoded.slice(1)]))).toBe(value);
    }
  });

  it('keeps the byte codes out of time order, as the device defines them', () => {
    // 15 minutes was added later and took the next free code, so sorting by
    // duration and sorting by byte give different orders.
    expect(AutoPowerOff.After15Min).toBeGreaterThan(AutoPowerOff.After180Min);
    expect(AutoPowerOff.Disabled).toBe(0x11);
  });

  it('refuses a value the device never defined', () => {
    expect(() => encodeAutoPowerOff(0x42)).toThrow(/not a known auto-power-off value/);
  });

  it('names a value it does not recognise rather than pretending', () => {
    expect(autoPowerOffLabel(AutoPowerOff.Disabled)).toBe('Never');
    expect(autoPowerOffLabel(0x42)).toBe('Unknown (0x42)');
  });

  it('asks with the right inquiry type', () => {
    expect(encodeGetAutoPowerOff()).toEqual([Command.GetPowerParam, 0x04]);
  });
});
