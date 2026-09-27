import { describe, expect, it } from 'vitest';
import { decodeEqAll, decodeEqCurrent, decodeEqList, decodeSetEqCurveAck, encodeSetEqCurve, encodeSetEqPreset } from './eq';

describe('decodeEqCurrent', () => {
  it('reads status and preset index as two separate bytes, not a combined u16', () => {
    // HeyTap `0x810F` carries `[status, presetId]` — two 1-byte
    // fields. [0x00, 0x02] must decode to presetId 2, not the LE-u16 value
    // 0x0200 (512) an earlier reading of "2-byte response" produced.
    expect(decodeEqCurrent(Uint8Array.from([0x00, 0x02]))).toEqual({ status: 0, presetId: 2 });
  });

  it('throws on truncated payload (< 2 bytes)', () => {
    expect(() => decodeEqCurrent(Uint8Array.from([0x02]))).toThrow();
    expect(() => decodeEqCurrent(Uint8Array.from([]))).toThrow();
  });
});

describe('decodeEqAll', () => {
  it('decodes one preset with a two-band curve', () => {
    // status=0, count=1, then one preset:
    //   isSelected=1, minValue=-6 (0xFA signed), maxValue=6, eqId=1,
    //   nameLength=3, name="Pop" (0x50,0x6F,0x70), frequencyNum=2,
    //   band1: frequency=100 (LE 0x64,0x00), dbValue=3
    //   band2: frequency=1000 (LE 0xE8,0x03), dbValue=-2 (0xFE signed)
    const payload = Uint8Array.from([
      0,
      1,
      1, 0xfa, 0x06, 1,
      3, 0x50, 0x6f, 0x70,
      2,
      0x64, 0x00, 0x03,
      0xe8, 0x03, 0xfe,
    ]);
    expect(decodeEqAll(payload)).toEqual([
      {
        isSelected: true,
        minValue: -6,
        maxValue: 6,
        eqId: 1,
        name: 'Pop',
        bands: [
          { frequency: 100, dbValue: 3 },
          { frequency: 1000, dbValue: -2 },
        ],
      },
    ]);
  });

  it('decodes zero presets', () => {
    expect(decodeEqAll(Uint8Array.from([0, 0]))).toEqual([]);
  });

  it('throws on a non-zero status', () => {
    // Cross-checked directly against 1812z/OppoPods's EqDetailsParser.parseAll()
    // current source: `data[9] != 0 -> return null`, `data[9]` being this
    // driver's own `payload[0]` — a leading status byte precedes count,
    // matching every other status-gated reply in this protocol.
    expect(() => decodeEqAll(Uint8Array.from([1, 0]))).toThrow();
  });

  it('throws on empty payload (status+count bytes missing)', () => {
    expect(() => decodeEqAll(Uint8Array.from([]))).toThrow();
  });

  it('throws on a payload with only a status byte (count byte missing)', () => {
    expect(() => decodeEqAll(Uint8Array.from([0]))).toThrow();
  });

  it('throws when frequencyNum byte is missing (name bytes consume to end)', () => {
    // status=0, count=1, fixed header present (5 bytes), nameLength=2 with
    // 2 name bytes. That uses all 9 bytes (status+count+5-byte header+2-byte
    // name), leaving no room for frequencyNum.
    expect(() => decodeEqAll(Uint8Array.from([
      0,                      // status
      1,                      // count
      1, 0xfa, 0x06, 1,      // fixed header (5 bytes)
      2, 0x50, 0x6f,          // nameLength=2, name="Po" (2 bytes) — fills the rest
    ]))).toThrow();
  });

  it('throws when the fixed 5-byte preset header is truncated', () => {
    // status=0, count=1, but only 2 bytes follow (need 5)
    expect(() => decodeEqAll(Uint8Array.from([0, 1, 1, 0xfa]))).toThrow();
  });

  it('throws when the preset name is truncated', () => {
    // status=0, count=1, fixed header present, nameLength=3 but only 2 bytes follow
    expect(() => decodeEqAll(Uint8Array.from([
      0,
      1,
      1, 0xfa, 0x06, 1,
      3, 0x50, 0x6f,  // only 2 bytes of the 3-byte name
    ]))).toThrow();
  });

  it('throws when a band entry is truncated', () => {
    // status=0, count=1, preset with 1 band, but band data only has 2 bytes instead of 3
    expect(() => decodeEqAll(Uint8Array.from([
      0,
      1,
      1, 0xfa, 0x06, 1,
      3, 0x50, 0x6f, 0x70,
      1,                    // frequencyNum=1
      0x64, 0x00,           // only 2 bytes of the 3-byte band entry
    ]))).toThrow();
  });
});

describe('encodeSetEqPreset', () => {
  it('encodes the eqId as a single byte, matching its confirmed size on the read side', () => {
    expect(encodeSetEqPreset(1)).toEqual([1]);
  });
});

describe('decodeEqList', () => {
  it('decodes a 0x0506 push, which is 0x0122 without the status byte', () => {
    const presets = decodeEqList(Uint8Array.from([1, 1, 0xfa, 0x06, 9, 1, 0x43, 1, 0x64, 0x00, 0x03]));
    expect(presets).toEqual([
      { isSelected: true, minValue: -6, maxValue: 6, eqId: 9, name: 'C', bands: [{ frequency: 100, dbValue: 3 }] },
    ]);
  });

  it('returns no presets for an empty list', () => {
    expect(decodeEqList(Uint8Array.from([]))).toEqual([]);
  });
});

describe('encodeSetEqCurve (realme SetCommandManager.p():440-497)', () => {
  const preset = {
    isSelected: true,
    minValue: -6,
    maxValue: 6,
    eqId: 9,
    name: 'C1',
    bands: [
      { frequency: 100, dbValue: 0 },
      { frequency: 4300, dbValue: 0 },
    ],
  };

  it("builds a modify write with the new gains, frequencies LE, gains two's-complement", () => {
    expect(encodeSetEqCurve(preset, [3, -2])).toEqual([2, 0xfa, 0x06, 9, 2, 0x43, 0x31, 2, 100, 0, 3, 0xcc, 0x10, 0xfe]);
  });

  it('refuses a gain count that does not match the bands', () => {
    expect(() => encodeSetEqCurve(preset, [1])).toThrow();
  });
});

describe('decodeSetEqCurveAck', () => {
  it('returns the eqId after a zero status and throws otherwise', () => {
    expect(decodeSetEqCurveAck(Uint8Array.from([0x00, 9]))).toBe(9);
    expect(() => decodeSetEqCurveAck(Uint8Array.from([0x01, 9]))).toThrow();
  });
});
