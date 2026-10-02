import { describe, expect, it } from 'vitest';

import {
  AncState,
  decodeHardwareInfo,
  decodeRuntimeInfo,
  decodeSettingsRsp,
  decodeSoftwareInfo,
  encodeReadSetting,
  encodeWriteSetting,
  methodId,
  Method,
  serviceId,
  SettingId,
} from './maestro';

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
const bytes = (text: string): Uint8Array => Uint8Array.from(text.split(' ').map((byte) => parseInt(byte, 16)));

// Every vector below is written out by hand from maestro_pw.proto's field numbers and the protobuf
// wire rules, not produced by the encoder under test.

describe('ids', () => {
  it('hashes the service and methods by name', () => {
    expect(serviceId).toBe(0x7ede71ea);
    expect(methodId(Method.GetSoftwareInfo)).toBe(0x7199fa44);
    expect(methodId(Method.SubscribeToSettingsChanges)).toBe(0x2821adf5);
  });
});

describe('requests', () => {
  it('reads a setting by id (ReadSettingMsg.settings_id = 4)', () => {
    expect(hex(encodeReadSetting(SettingId.AncState))).toBe('20 0d');
    expect(hex(encodeReadSetting(SettingId.UserEq))).toBe('20 10');
  });

  it('writes the ANC state (SettingValue field 13)', () => {
    expect(hex(encodeWriteSetting({ setting: SettingId.AncState, value: AncState.Active }))).toBe('22 02 68 02');
    expect(hex(encodeWriteSetting({ setting: SettingId.AncState, value: AncState.Adaptive }))).toBe('22 02 68 04');
    expect(() => encodeWriteSetting({ setting: SettingId.AncState, value: null })).toThrow();
  });

  it('writes a bool oneof member even when false', () => {
    expect(hex(encodeWriteSetting({ setting: SettingId.Multipoint, value: false }))).toBe('22 02 58 00');
    expect(hex(encodeWriteSetting({ setting: SettingId.Multipoint, value: true }))).toBe('22 02 58 01');
    expect(hex(encodeWriteSetting({ setting: SettingId.OnHeadDetection, value: true }))).toBe('22 02 10 01');
    expect(hex(encodeWriteSetting({ setting: SettingId.VolumeEq, value: true }))).toBe('22 02 78 01');
  });

  it('writes the EQ as five fixed32 floats, leaving zero bands out', () => {
    expect(hex(encodeWriteSetting({ setting: SettingId.UserEq, value: [0, 0, 0, 0, 0] }))).toBe('22 03 82 01 00');
    // 1.5 = 3fc00000, -6.0 = c0c00000, 6.0 = 40c00000 (little-endian on the wire)
    expect(hex(encodeWriteSetting({ setting: SettingId.UserEq, value: [1.5, 0, -6, 0, 6] }))).toBe(
      '22 12 82 01 0f 0d 00 00 c0 3f 1d 00 00 c0 c0 2d 00 00 c0 40',
    );
  });

  it('writes the gesture loop with only the true bools', () => {
    expect(
      hex(encodeWriteSetting({ setting: SettingId.AncLoop, value: { active: true, off: false, aware: true, adaptive: true } })),
    ).toBe('22 08 62 06 08 01 18 01 20 01');
  });
});

describe('decodeSoftwareInfo', () => {
  it('reads the version string of each part and ignores the unknown field', () => {
    // case: { unknown "x", version "1.2.3" }, right: { version "9" }, left absent
    const reply = bytes('22 11 0a 0a 0a 01 78 12 05 31 2e 32 2e 33 12 03 12 01 39');
    expect(decodeSoftwareInfo(reply)).toEqual({ case: '1.2.3', right: '9', left: null });
  });

  it('treats an empty reply as unknown', () => {
    expect(decodeSoftwareInfo(new Uint8Array(0))).toEqual({ case: null, right: null, left: null });
  });
});

describe('decodeHardwareInfo', () => {
  it('reads the three serial numbers', () => {
    expect(decodeHardwareInfo(bytes('3a 0b 0a 02 43 31 12 01 52 1a 02 4c 31'))).toEqual({ case: 'C1', right: 'R', left: 'L1' });
  });
});

describe('decodeRuntimeInfo', () => {
  // timestamp 10 <varint>, battery_info { case 90% not charging, left 80% charging, right present but empty },
  // placement { right_bud_in_case }
  const reply = bytes('10 80 01 32 0e 0a 04 08 5a 10 01 12 04 08 50 10 02 1a 00 3a 02 08 01');

  it('reads each reported cell, charging from state 2', () => {
    expect(decodeRuntimeInfo(reply).battery).toEqual([
      { device: 'case', level: 90, charging: false },
      { device: 'left', level: 80, charging: true },
      { device: 'right', level: 0, charging: false },
    ]);
  });

  it('reads bud placement', () => {
    expect(decodeRuntimeInfo(reply).placement).toEqual({ rightInCase: true, leftInCase: false });
  });

  it('omits a cell the buds did not report, and a missing placement is null', () => {
    const noCase = bytes('32 06 12 04 08 50 10 01');
    expect(decodeRuntimeInfo(noCase)).toEqual({ battery: [{ device: 'left', level: 80, charging: false }], placement: null });
  });
});

describe('decodeSettingsRsp', () => {
  it('reads the ANC state', () => {
    expect(decodeSettingsRsp(bytes('22 02 68 03'))).toEqual({ setting: SettingId.AncState, value: AncState.Aware });
  });

  it('reads an ANC value outside the enum as null rather than inventing a mode', () => {
    expect(decodeSettingsRsp(bytes('22 02 68 09'))).toEqual({ setting: SettingId.AncState, value: null });
    expect(decodeSettingsRsp(bytes('22 02 68 00'))).toEqual({ setting: SettingId.AncState, value: null });
  });

  it('reads the bool settings', () => {
    expect(decodeSettingsRsp(bytes('22 02 58 01'))).toEqual({ setting: SettingId.Multipoint, value: true });
    expect(decodeSettingsRsp(bytes('22 02 58 00'))).toEqual({ setting: SettingId.Multipoint, value: false });
    expect(decodeSettingsRsp(bytes('22 02 10 01'))).toEqual({ setting: SettingId.OnHeadDetection, value: true });
    expect(decodeSettingsRsp(bytes('22 02 78 00'))).toEqual({ setting: SettingId.VolumeEq, value: false });
  });

  it('reads the gesture loop, defaulting an absent bool to false', () => {
    expect(decodeSettingsRsp(bytes('22 08 62 06 08 01 18 01 20 01'))).toEqual({
      setting: SettingId.AncLoop,
      value: { active: true, off: false, aware: true, adaptive: true },
    });
  });

  it('reads the EQ, with absent bands as flat', () => {
    expect(decodeSettingsRsp(bytes('22 03 82 01 00'))).toEqual({ setting: SettingId.UserEq, value: [0, 0, 0, 0, 0] });
    expect(decodeSettingsRsp(bytes('22 12 82 01 0f 0d 00 00 c0 3f 1d 00 00 c0 c0 2d 00 00 c0 40'))).toEqual({
      setting: SettingId.UserEq,
      value: [1.5, 0, -6, 0, 6],
    });
  });

  it('returns null for a setting it does not model, and for an empty reply', () => {
    expect(decodeSettingsRsp(bytes('22 03 88 01 05'))).toBeNull();
    expect(decodeSettingsRsp(new Uint8Array(0))).toBeNull();
  });
});
