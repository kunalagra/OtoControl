import { describe, expect, it } from 'vitest';
import { decodeWear, decodeWearList } from './wear';

describe('decodeWear (realme CommandUtil.f():236-253, StatusInfo)', () => {
  it('reads in-ear (active high) and in-box (bit 0 active low)', () => {
    // left: 0b011 -> not in box, in ear; right: 0b000 -> in box, not in ear
    expect(decodeWear(Uint8Array.from([0x00, 0x02, 0x01, 0x03, 0x02, 0x00]))).toEqual([
      { device: 'left', inEar: true, inBox: false },
      { device: 'right', inEar: false, inBox: true },
    ]);
  });

  it('decodes the count-first list a 0x0204 wear push carries', () => {
    expect(decodeWearList(Uint8Array.from([0x01, 0x02, 0x03]))).toEqual([{ device: 'right', inEar: true, inBox: false }]);
  });

  it('throws on a zero count or truncated list, as the vendor returns null', () => {
    expect(() => decodeWearList(Uint8Array.from([0x00]))).toThrow();
    expect(() => decodeWearList(Uint8Array.from([0x02, 0x01, 0x03]))).toThrow();
  });

  it('throws on a non-zero reply status', () => {
    expect(() => decodeWear(Uint8Array.from([0x01, 0x01, 0x01, 0x03]))).toThrow();
  });
});
