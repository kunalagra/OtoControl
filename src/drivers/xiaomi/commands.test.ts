import { describe, expect, it } from 'vitest';

import {
  AncMode,
  StrengthTarget,
  configUnit,
  decodeBattery,
  decodeConfig,
  decodeInfo,
  decodeRunInfo,
  decodeStatusPush,
  encodeFind,
  encodeGetConfig,
  encodeGetInfo,
  encodeSetAncMode,
  encodeSetEqPreset,
  encodeSetStrength,
  encodeSetWearDetection,
  parseConfigUnits,
  parseTlvs,
} from './commands';

const u8 = (...values: number[]): Uint8Array => Uint8Array.from(values);

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
});

describe('decodeConfig', () => {
  it('reads a strength reply by target and does not move the mode', () => {
    expect(decodeConfig(u8(4, 0, 0x0b, 1, 2), false)).toEqual({ ncStrength: 2 });
    expect(decodeConfig(u8(4, 0, 0x0b, 2, 1), false)).toEqual({ transparencyStrength: 1 });
  });

  it('reads a strength notification as the active mode and its level', () => {
    expect(decodeConfig(u8(4, 0, 0x0b, 2, 1), true)).toEqual({ transparencyStrength: 1, ancMode: 2 });
    expect(decodeConfig(u8(4, 0, 0x0b, 0, 0), true)).toEqual({ ancMode: 0 });
  });

  it('reads the EQ preset', () => {
    expect(decodeConfig(u8(3, 0, 7, 5), false)).toEqual({ eqPreset: 5 });
  });

  it('reads several units from one reply and ignores unknown ids', () => {
    expect(decodeConfig(u8(4, 0, 0x0b, 1, 2, 3, 0, 0x25, 1, 3, 0, 7, 6), false)).toEqual({ ncStrength: 2, eqPreset: 6 });
  });
});
