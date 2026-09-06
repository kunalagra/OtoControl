import { describe, expect, it } from 'vitest';
import { Cmd, decodeBattery, decodeNotificationSupport, decodeProductId, encodeRegisterNotify, replyFor, decodeAncDirectQuery, decodeAncNotification, encodeSetAncMode, decodeEqAll, decodeEqCurrent, encodeSetEqPreset } from './commands';

describe('replyFor', () => {
  it('sets the reply bit', () => {
    expect(replyFor(Cmd.QueryProductId)).toBe(0x8103);
    expect(replyFor(Cmd.Battery)).toBe(0x8106);
  });
});

describe('decodeProductId', () => {
  it('reads a 3-byte little-endian productId into a 6-hex-digit string', () => {
    // status=0, productId bytes (LE) = 0x10, 0xF0, 0x06 -> value 0x06F010.
    // Matches the OPPO Enco Air4s catalog entry ("06F010").
    const reply = decodeProductId(Uint8Array.from([0x00, 0x10, 0xf0, 0x06]));
    expect(reply).toEqual({ status: 0, productId: '06F010' });
  });

  it('pads a short productId to 6 digits', () => {
    const reply = decodeProductId(Uint8Array.from([0x00, 0x01, 0x00, 0x00]));
    expect(reply.productId).toBe('000001');
  });

  it('throws on truncated payload (< 4 bytes)', () => {
    expect(() => decodeProductId(Uint8Array.from([0x00, 0x10, 0xf0]))).toThrow();
    expect(() => decodeProductId(Uint8Array.from([0x00]))).toThrow();
    expect(() => decodeProductId(Uint8Array.from([]))).toThrow();
  });
});

describe('decodeNotificationSupport', () => {
  it('reads status and the id list', () => {
    // status=0, count=3, ids 0x01, 0x02, 0x03
    const reply = decodeNotificationSupport(Uint8Array.from([0x00, 0x03, 0x01, 0x02, 0x03]));
    expect(reply).toEqual({ status: 0, ids: [0x01, 0x02, 0x03] });
  });

  it('handles a zero-id reply', () => {
    expect(decodeNotificationSupport(Uint8Array.from([0x00, 0x00]))).toEqual({ status: 0, ids: [] });
  });

  it('throws on truncated payload (< 2 bytes)', () => {
    expect(() => decodeNotificationSupport(Uint8Array.from([0x00]))).toThrow();
    expect(() => decodeNotificationSupport(Uint8Array.from([]))).toThrow();
  });
});

describe('encodeRegisterNotify', () => {
  it('encodes a count-prefixed id list', () => {
    expect(encodeRegisterNotify([0x01, 0x02, 0x03])).toEqual([3, 0x01, 0x02, 0x03]);
  });

  it('filters out debug/internal channels (id >= 0xF0)', () => {
    // Matches 1812z/OppoPods's own connect-sequence filtering.
    expect(encodeRegisterNotify([0x01, 0xf0, 0x03, 0xff])).toEqual([2, 0x01, 0x03]);
  });

  it('encodes an empty list as a zero count', () => {
    expect(encodeRegisterNotify([])).toEqual([0]);
  });
});

describe('decodeBattery', () => {
  it('decodes left/right/case cells, packed level+charging', () => {
    // count=2: [deviceType=1 (left), packed=0xD4] [deviceType=2 (right), packed=0x32]
    // 0xD4 & 0x7F = 0x54 = 84, charging = (0xD4 & 0x80) != 0 = true
    // 0x32 & 0x7F = 0x32 = 50, charging = false
    const cells = decodeBattery(Uint8Array.from([0x02, 0x01, 0xd4, 0x02, 0x32]));
    expect(cells).toEqual([
      { device: 'left', level: 84, charging: true },
      { device: 'right', level: 50, charging: false },
    ]);
  });

  it('decodes a case cell and tolerates an unknown deviceType by skipping it', () => {
    const cells = decodeBattery(Uint8Array.from([0x02, 0x03, 0x64, 0x09, 0x00]));
    expect(cells).toEqual([{ device: 'case', level: 100, charging: false }]);
  });

  it('returns an empty array for count=0', () => {
    expect(decodeBattery(Uint8Array.from([0x00]))).toEqual([]);
  });

  it('clamps count to actual payload and skips truncated cells', () => {
    // count=2 claims two cells, but only 3 bytes follow (incomplete second cell).
    // Should decode only the first complete cell [deviceType=1, packed=0xD4]
    // and skip the incomplete second cell data.
    const cells = decodeBattery(Uint8Array.from([0x02, 0x01, 0xd4, 0x02]));
    expect(cells).toEqual([{ device: 'left', level: 84, charging: true }]);
  });
});

describe('decodeAncNotification', () => {
  it('decodes CurrentNoiseModeInfo from a bitmask (mType 1), taking the lowest set bit', () => {
    // outer subtype=3 (noise-reduction event), inner type=1 (CurrentNoiseModeInfo),
    // DTO bytes: mType=1, mask=0b00000101 -> bits 0 and 2 set; the lowest
    // set bit (0) is the one currently-active mode, not a list of both.
    const event = decodeAncNotification(Uint8Array.from([3, 1, 1, 0b0000_0101]));
    expect(event).toEqual({ kind: 'currentMode', modeIndex: 0, level: null });
  });

  it('decodes CurrentNoiseModeInfo with a single level (mType 2)', () => {
    const event = decodeAncNotification(Uint8Array.from([3, 1, 2, 50]));
    expect(event).toEqual({ kind: 'currentMode', modeIndex: null, level: 50 });
  });

  it('decodes NoiseReductionInfo (inner type 2), value little-endian', () => {
    // action=1, type=2, value=10 as 2 LE bytes.
    const event = decodeAncNotification(Uint8Array.from([3, 2, 1, 2, 0x0a, 0x00]));
    expect(event).toEqual({ kind: 'reduction', action: 1, type: 2, value: 10 });
  });

  it('decodes IntelligentNoiseModeInfo from a bitmask (mType 1)', () => {
    const event = decodeAncNotification(Uint8Array.from([3, 4, 1, 0b0000_0010]));
    expect(event).toEqual({ kind: 'intelligentMode', modeIndex: 1 });
  });

  it('decodes IntelligentNoiseModeInfo with an unrecognised mType as no mode', () => {
    const event = decodeAncNotification(Uint8Array.from([3, 4, 2]));
    expect(event).toEqual({ kind: 'intelligentMode', modeIndex: null });
  });

  it('returns null for a non-noise-reduction outer subtype', () => {
    expect(decodeAncNotification(Uint8Array.from([7, 1, 1, 0]))).toBeNull();
  });

  it('returns null for an unrecognised inner type', () => {
    expect(decodeAncNotification(Uint8Array.from([3, 9, 0]))).toBeNull();
  });

  it('returns null for a truncated payload (< 2 bytes)', () => {
    expect(decodeAncNotification(Uint8Array.from([3]))).toBeNull();
    expect(decodeAncNotification(Uint8Array.from([]))).toBeNull();
  });

  it('returns null for innerType=1 with truncated DTO (missing mType)', () => {
    expect(decodeAncNotification(Uint8Array.from([3, 1]))).toBeNull();
  });

  it('returns null for innerType=1 mType=1 with truncated bitmask bytes', () => {
    // innerType=1, mType=1 requires at least 1 byte of bitmask after mType
    expect(decodeAncNotification(Uint8Array.from([3, 1, 1]))).toBeNull();
  });

  it('returns null for innerType=1 mType=2 with missing level byte', () => {
    expect(decodeAncNotification(Uint8Array.from([3, 1, 2]))).toBeNull();
  });

  it('returns null for innerType=2 with truncated DTO (missing action/type/value)', () => {
    // innerType=2 requires at least 4 bytes: action, type, and 2 bytes of value
    expect(decodeAncNotification(Uint8Array.from([3, 2]))).toBeNull();
    expect(decodeAncNotification(Uint8Array.from([3, 2, 1]))).toBeNull();
    expect(decodeAncNotification(Uint8Array.from([3, 2, 1, 2]))).toBeNull();
    expect(decodeAncNotification(Uint8Array.from([3, 2, 1, 2, 0x0a]))).toBeNull();
  });

  it('returns null for innerType=4 with missing mType', () => {
    expect(decodeAncNotification(Uint8Array.from([3, 4]))).toBeNull();
  });

  it('returns null for innerType=4 mType=1 with truncated bitmask bytes', () => {
    expect(decodeAncNotification(Uint8Array.from([3, 4, 1]))).toBeNull();
  });
});

describe('encodeSetAncMode', () => {
  it('matches Leaf-lsgtky/OppoPods\'s own worked examples byte-for-byte', () => {
    // CapabilityProfileFactory.ancPayload()'s own doc comment: protocolIndex
    // 1 -> "01 01 02", 2 -> "01 01 04", 11 -> "01 01 00 08" — noted there as
    // tested against real Enco X3/Free4 hardware.
    expect(encodeSetAncMode(1)).toEqual([0x01, 0x01, 0x02]);
    expect(encodeSetAncMode(2)).toEqual([0x01, 0x01, 0x04]);
    expect(encodeSetAncMode(11)).toEqual([0x01, 0x01, 0x00, 0x08]);
  });

  it('sets bit 0 for protocolIndex 0', () => {
    expect(encodeSetAncMode(0)).toEqual([0x01, 0x01, 0x01]);
  });

  it('extends the bitmap by a byte for every 8 indices', () => {
    expect(encodeSetAncMode(7)).toEqual([0x01, 0x01, 0x80]);
    expect(encodeSetAncMode(8)).toEqual([0x01, 0x01, 0x00, 0x01]);
    expect(encodeSetAncMode(16)).toEqual([0x01, 0x01, 0x00, 0x00, 0x01]);
  });
});

describe('decodeAncDirectQuery', () => {
  it('decodes a bare currentMode DTO from a bitmask (mType 1), no envelope, lowest set bit', () => {
    // Unlike decodeAncNotification, there is no [outerSubtype, innerType]
    // prefix here — 0x010C's reply is the DTO itself.
    const event = decodeAncDirectQuery(Uint8Array.from([1, 0b0000_0101]));
    expect(event).toEqual({ kind: 'currentMode', modeIndex: 0, level: null });
  });

  it('decodes a bare currentMode DTO with a single level (mType 2)', () => {
    const event = decodeAncDirectQuery(Uint8Array.from([2, 50]));
    expect(event).toEqual({ kind: 'currentMode', modeIndex: null, level: 50 });
  });

  it('returns null for an empty payload', () => {
    expect(decodeAncDirectQuery(Uint8Array.from([]))).toBeNull();
  });

  it('returns null for mType=1 with a truncated bitmask', () => {
    expect(decodeAncDirectQuery(Uint8Array.from([1]))).toBeNull();
  });

  it('returns null for mType=2 with a missing level byte', () => {
    expect(decodeAncDirectQuery(Uint8Array.from([2]))).toBeNull();
  });
});

// --- EQ ------------------------------------------------------------------

describe('decodeEqCurrent', () => {
  it('reads status and preset index as two separate bytes, not a combined u16', () => {
    // Protocol notes §6: 0x810F carries `[status, presetId]` — two 1-byte
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
