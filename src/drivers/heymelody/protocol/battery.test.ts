import { describe, expect, it } from 'vitest';
import { decodeBattery, decodeBatteryList } from './battery';

describe('decodeBattery', () => {
  it('decodes left/right/case cells after the leading status byte', () => {
    // status=0, count=2: [deviceType=1 (left), packed=0xD4] [deviceType=2 (right), packed=0x32]
    // 0xD4 & 0x7F = 0x54 = 84, charging = (0xD4 & 0x80) != 0 = true
    // 0x32 & 0x7F = 0x32 = 50, charging = false
    const cells = decodeBattery(Uint8Array.from([0x00, 0x02, 0x01, 0xd4, 0x02, 0x32]));
    expect(cells).toEqual([
      { device: 'left', level: 84, charging: true },
      { device: 'right', level: 50, charging: false },
    ]);
  });

  it('does not read the status byte as the cell count', () => {
    // A real reply for three cells. Read without the status byte, count
    // would be 0 and every cell would be dropped — the realme Buds Air6
    // Pro report (2026-09-27): no Battery card at all.
    const cells = decodeBattery(Uint8Array.from([0x00, 0x03, 0x01, 0x54, 0x02, 0x55, 0x03, 0x60]));
    expect(cells).toHaveLength(3);
  });

  it('decodes a case cell and tolerates an unknown deviceType by skipping it', () => {
    const cells = decodeBattery(Uint8Array.from([0x00, 0x02, 0x03, 0x64, 0x09, 0x00]));
    expect(cells).toEqual([{ device: 'case', level: 100, charging: false }]);
  });

  it('returns an empty array for count=0', () => {
    expect(decodeBattery(Uint8Array.from([0x00, 0x00]))).toEqual([]);
  });

  it('throws on a non-zero or missing status, failing closed like the vendor', () => {
    expect(() => decodeBattery(Uint8Array.from([0x01, 0x01, 0x01, 0xd4]))).toThrow();
    expect(() => decodeBattery(Uint8Array.from([]))).toThrow();
  });

  it('clamps count to actual payload and skips truncated cells', () => {
    // count=2 claims two cells, but only 3 bytes follow (incomplete second cell).
    const cells = decodeBattery(Uint8Array.from([0x00, 0x02, 0x01, 0xd4, 0x02]));
    expect(cells).toEqual([{ device: 'left', level: 84, charging: true }]);
  });
});

describe('decodeBatteryList', () => {
  it('decodes a count-first list, as a 0x0204 battery push carries after its event id', () => {
    expect(decodeBatteryList(Uint8Array.from([0x01, 0x02, 0x55]))).toEqual([{ device: 'right', level: 85, charging: false }]);
  });
});
