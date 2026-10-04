import { describe, expect, it } from 'vitest';

import {
  AncMode,
  DEFAULT_EQ_FREQUENCIES,
  StrengthTarget,
  Tap,
  byteToGain,
  configUnit,
  decodeBattery,
  decodeConfig,
  decodeInfo,
  decodeRunInfo,
  decodeStatusPush,
  gainToByte,
  encodeFind,
  encodeGetConfig,
  encodeGetInfo,
  encodeSetAncMode,
  encodeSetCustomEq,
  encodeSetEqPreset,
  encodeSetGesture,
  encodeSetLongPressCycle,
  encodeSetStrength,
  encodeSetWearDetection,
  parseConfigUnits,
  parseTlvs,
} from './commands';

const u8 = (...values: number[]): Uint8Array => Uint8Array.from(values);
const hexBytes = (text: string): Uint8Array => Uint8Array.from(text.match(/../g)!.map((pair) => parseInt(pair, 16)));

describe('encoders', () => {
  it('asks for every attribute with an all-ones mask', () => {
    expect(encodeGetInfo()).toEqual([0xff, 0xff, 0xff, 0xff]);
  });

  it.each([
    [AncMode.Off, [2, 4, 0]],
    [AncMode.NoiseCancelling, [2, 4, 1]],
    [AncMode.Transparency, [2, 4, 2]],
  ] as const)('sets ANC mode %i', (mode, expected) => {
    expect(encodeSetAncMode(mode)).toEqual(expected);
  });

  it('inverts in-ear detection on the wire', () => {
    expect(encodeSetWearDetection(true)).toEqual([2, 6, 0]);
    expect(encodeSetWearDetection(false)).toEqual([2, 6, 1]);
  });

  it('encodes strength as config 0x0B with a target', () => {
    expect(encodeSetStrength(StrengthTarget.NoiseCancelling, 0)).toEqual([4, 0, 0x0b, 1, 0]);
    expect(encodeSetStrength(StrengthTarget.Transparency, 2)).toEqual([4, 0, 0x0b, 2, 2]);
  });

  it('encodes an EQ preset as config 7', () => {
    expect(encodeSetEqPreset(0x06)).toEqual([3, 0, 7, 6]);
  });

  it('encodes find as config 9 with enable then earbud', () => {
    expect(encodeFind(true, 3)).toEqual([4, 0, 9, 1, 3]);
    expect(encodeFind(false, 3)).toEqual([4, 0, 9, 0, 3]);
    expect(encodeFind(true, 1)).toEqual([4, 0, 9, 1, 1]);
  });

  it('asks for one config as a u16 id', () => {
    expect(encodeGetConfig(0x0b)).toEqual([0, 0x0b]);
  });

  it('wraps a config value with its length and id', () => {
    expect(configUnit(0x37, [1, 2, 3])).toEqual([5, 0, 0x37, 1, 2, 3]);
  });
});

describe('parseTlvs', () => {
  it('reads [len][type][value] records', () => {
    expect(parseTlvs(u8(2, 9, 1, 2, 10, 0))).toEqual([
      { type: 9, value: u8(1) },
      { type: 10, value: u8(0) },
    ]);
  });

  it('stops at a truncated record and keeps the ones before it', () => {
    expect(parseTlvs(u8(2, 9, 1, 5, 7, 1))).toHaveLength(1);
    expect(parseTlvs(u8(0))).toEqual([]);
    expect(parseTlvs(u8())).toEqual([]);
  });
});

describe('parseConfigUnits', () => {
  it('reads several units in one payload (WinMi multi-record vector)', () => {
    expect(parseConfigUnits(u8(4, 0, 0x0b, 1, 2, 3, 0, 0x25, 1))).toEqual([
      { id: 0x0b, value: u8(1, 2) },
      { id: 0x25, value: u8(1) },
    ]);
  });

  it('ignores truncated and empty input', () => {
    for (const bad of [u8(), u8(0), u8(255), u8(2, 9), u8(1, 0), u8(4, 0, 0x0b, 1)]) {
      expect(parseConfigUnits(bad)).toEqual([]);
    }
  });
});

describe('decodeBattery', () => {
  it('reads level and the charging bit, in left, right, case order', () => {
    expect(decodeBattery(u8(0xe4, 85, 0xff))).toEqual([
      { device: 'left', level: 100, charging: true },
      { device: 'right', level: 85, charging: false },
    ]);
  });

  it('treats 0 as a real level and 127 or FF as unknown', () => {
    expect(decodeBattery(u8(0, 127, 0xff))).toEqual([{ device: 'left', level: 0, charging: false }]);
  });

  it('copes with a short value', () => {
    expect(decodeBattery(u8(50))).toHaveLength(1);
  });
});

describe('decodeInfo', () => {
  it('reads battery and firmware from the WinMi-Buds vector', () => {
    const info = decodeInfo(u8(4, 7, 0xe4, 85, 255, 5, 1, 0x12, 0x34, 0x12, 0x34));
    expect(info.battery.map((cell) => cell.device)).toEqual(['left', 'right']);
    expect(info.firmware).toEqual(['1.2.3.4', '1.2.3.4']);
  });

  it('reads VID and PID big-endian', () => {
    const info = decodeInfo(u8(5, 3, 0x27, 0x17, 0x50, 0x34));
    expect(info.vid).toBe(0x2717);
    expect(info.pid).toBe(0x5034);
  });

  it('reads a two-byte firmware version and the Bluetooth name', () => {
    const name = Array.from(new TextEncoder().encode('Redmi Buds'));
    const info = decodeInfo(u8(3, 1, 0x20, 0x41, name.length + 1, 0, ...name));
    expect(info.firmware).toEqual(['2.0.4.1']);
    expect(info.btName).toBe('Redmi Buds');
  });

  it('ignores a VID/PID of the wrong length and unknown types', () => {
    const info = decodeInfo(u8(4, 3, 1, 2, 3, 2, 99, 1));
    expect(info.vid).toBeNull();
    expect(info.pid).toBeNull();
  });
});

describe('decodeInfo against a real capture', () => {
  // The GetInfo reply the official app got from a REDMI Buds 8 Pro (PID 0x50E3); see the design spec.
  const CAPTURED_INFO = hexBytes(
    '100076656c61206f7320656172627564730501123612360202640503271750e30204010205000306123602080104076464ff020d02020e03020f0103100101',
  );

  it('reads name, a two-version firmware, VID/PID, battery and colour', () => {
    const info = decodeInfo(CAPTURED_INFO);
    expect(info.btName).toBe('vela os earbuds');
    expect(info.firmware).toEqual(['1.2.3.6', '1.2.3.6']);
    expect(info.vid).toBe(0x2717);
    expect(info.pid).toBe(0x50e3);
    expect(info.battery).toEqual([
      { device: 'left', level: 100, charging: false },
      { device: 'right', level: 100, charging: false },
    ]);
    expect(info.colour).toBe(2);
  });

  it('reads the four-byte firmware of a Redmi Buds 6 Lite as two versions (Gadgetbridge #6818)', () => {
    expect(decodeInfo(u8(5, 1, 0x10, 0x51, 0x05, 0x03))).toMatchObject({ firmware: ['1.0.5.1', '0.5.0.3'] });
  });
});

describe('decodeRunInfo against a real capture', () => {
  it('reads transparency and in-ear detection on from the captured reply', () => {
    // 07 00 [EDR addr] 07 01 [BLE addr] 03 02 0400 02 03 01 02 04 00 02 06 00 02 09 02 02 0a 00 02 0b 00
    const reply = hexBytes('0700b85384f3d7d00701b85384f3d7d003020400020301020400020600020902020a00020b00');
    expect(decodeRunInfo(reply)).toEqual({ ancMode: 2, wearDetection: true });
  });
});

describe('decodeRunInfo', () => {
  it('reads ANC mode and the inverted in-ear flag', () => {
    expect(decodeRunInfo(u8(2, 9, 1, 2, 10, 0))).toEqual({ ancMode: 1, wearDetection: true });
    expect(decodeRunInfo(u8(2, 9, 2, 2, 10, 1))).toEqual({ ancMode: 2, wearDetection: false });
  });

  it('leaves absent fields null and rejects an out-of-range mode', () => {
    expect(decodeRunInfo(u8(2, 9, 7))).toEqual({ ancMode: null, wearDetection: null });
    expect(decodeRunInfo(u8())).toEqual({ ancMode: null, wearDetection: null });
  });
});

describe('decodeStatusPush', () => {
  it('reads battery and mode (WinMi-Buds status notification vector)', () => {
    const push = decodeStatusPush(u8(4, 0, 30, 40, 50, 2, 4, 0));
    expect(push.battery?.map((cell) => cell.level)).toEqual([30, 40, 50]);
    expect(push.ancMode).toBe(0);
  });

  it('is empty for a payload with neither', () => {
    expect(decodeStatusPush(u8(2, 99, 1))).toEqual({ battery: null, ancMode: null });
  });

  it('keeps the buds when a battery push carries no case byte', () => {
    // The vendor app parses whatever length arrives (f7/f.java:162-167); the info TLV is already read this way.
    const push = decodeStatusPush(u8(3, 0, 0x80 | 55, 60));
    expect(push.battery).toEqual([
      { device: 'left', level: 55, charging: true },
      { device: 'right', level: 60, charging: false },
    ]);
  });
});

/** Bytes from a real capture of the official app talking to a REDMI Buds 8 Pro (PID 0x50E3); see the design spec. */
const CAPTURED_CUSTOM_EQ = hexBytes('270037010a060600000a003e00007d0000fa0001f40003e80007d0000fa0001f40002ee0003e8000');
const CAPTURED_GESTURES = hexBytes('110002040808010101020203030606050b0b');

describe('decodeConfig', () => {
  it('reads strength as the active mode and its level, in a reply and a push alike', () => {
    expect(decodeConfig(u8(4, 0, 0x0b, 2, 2))).toEqual({ ancMode: 2, transparencyStrength: 2 });
    expect(decodeConfig(u8(4, 0, 0x0b, 1, 0))).toEqual({ ancMode: 1, ncStrength: 0 });
  });

  it('keeps a depth step beyond the named strengths whole', () => {
    // Captured on ANC turning on: mode 1, level 0x13 (19) — the last of a 20-step gear.
    expect(decodeConfig(u8(4, 0, 0x0b, 1, 0x13))).toEqual({ ancMode: 1, ncStrength: 19 });
  });

  it('reads mode 0 as off with no strength', () => {
    expect(decodeConfig(u8(4, 0, 0x0b, 0, 0))).toEqual({ ancMode: 0 });
  });

  it('reads the EQ preset', () => {
    expect(decodeConfig(u8(3, 0, 7, 5))).toEqual({ eqPreset: 5 });
  });

  it('reads several units from one reply and ignores unknown ids', () => {
    expect(decodeConfig(u8(4, 0, 0x0b, 1, 2, 3, 0, 0x25, 1, 3, 0, 7, 6))).toEqual({ ancMode: 1, ncStrength: 2, eqPreset: 6 });
  });

  it('reads the gesture table as [tap, left, right] triplets (captured)', () => {
    expect(decodeConfig(CAPTURED_GESTURES).gestures).toEqual([
      { tap: 4, left: 8, right: 8 },
      { tap: 1, left: 1, right: 1 },
      { tap: 2, left: 2, right: 3 },
      { tap: 3, left: 6, right: 6 },
      { tap: 5, left: 0x0b, right: 0x0b },
    ]);
  });

  it('reads the long-press cycle as left and right bitmasks (captured)', () => {
    expect(decodeConfig(u8(4, 0, 0x0a, 6, 6))).toEqual({ longPressCycle: [6, 6] });
  });

  it('reads the custom EQ read-back, ten bands at the frequencies the earbuds report (captured)', () => {
    const curve = decodeConfig(CAPTURED_CUSTOM_EQ).customEq!;
    expect(curve.min).toBe(-6);
    expect(curve.max).toBe(6);
    expect(curve.bands.map((band) => band.frequency)).toEqual([62, 125, 250, 500, 1000, 2000, 4000, 8000, 12000, 16000]);
    expect(curve.bands.every((band) => band.gain === 0)).toBe(true);
  });

  it('reads signed gains and skips a name before the band count', () => {
    const name = [0x41, 0x42];
    const reply = u8(0, 0, 0x37, 1, 0x0a, 6, 6, 0, name.length, ...name, 2, 0, 62, 0x83, 0, 125, 0x04);
    const withLength = Uint8Array.from([reply.length - 1, ...reply.subarray(1)]);
    expect(decodeConfig(withLength).customEq?.bands).toEqual([
      { frequency: 62, gain: -3 },
      { frequency: 125, gain: 4 },
    ]);
  });

  it('rejects a custom EQ reply that is not ok, truncated, or empty', () => {
    expect(decodeConfig(u8(7, 0, 0x37, 0, 0x0a, 6, 6, 0, 0)).customEq).toBeUndefined();
    expect(decodeConfig(u8(3, 0, 0x37, 1)).customEq).toBeUndefined();
    // An empty value: what some models send for a config they do not have.
    expect(decodeConfig(u8(2, 0, 0x37))).toEqual({});
  });
});

describe('gesture and EQ encoders', () => {
  it('writes one gesture as config 2 with the tap, left and right', () => {
    expect(encodeSetGesture(Tap.Double, 1, 0xff)).toEqual([5, 0, 2, 1, 1, 0xff]);
    expect(encodeSetGesture(Tap.Long, 6, 6)).toEqual([5, 0, 2, 3, 6, 6]);
  });

  it('writes the long-press cycle as config 0x0A', () => {
    expect(encodeSetLongPressCycle(7, 0xff)).toEqual([4, 0, 0x0a, 7, 0xff]);
  });

  it('encodes gain sign-magnitude', () => {
    expect([-6, -1, 0, 1, 6].map(gainToByte)).toEqual([0x86, 0x81, 0, 1, 6]);
    expect([0x86, 0x81, 0, 1, 6].map(byteToGain)).toEqual([-6, -1, 0, 1, 6]);
  });

  it('writes a curve in the Gadgetbridge form: header 24 00 37 05 01 01 0A, then [frequency][gain] per band', () => {
    const bands = DEFAULT_EQ_FREQUENCIES.map((frequency, i) => ({ frequency, gain: i - 5 }));
    const frame = encodeSetCustomEq(bands);
    expect(frame.slice(0, 7)).toEqual([0x24, 0x00, 0x37, 0x05, 0x01, 0x01, 0x0a]);
    expect(frame).toHaveLength(7 + 30);
    expect(frame.slice(7, 13)).toEqual([0, 62, 0x85, 0, 125, 0x84]);
    // The last band: 16 kHz = 0x3E80, +4 dB.
    expect(frame.slice(-3)).toEqual([0x3e, 0x80, 0x04]);
  });
});
