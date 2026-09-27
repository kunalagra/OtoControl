import { describe, expect, it } from 'vitest';
import { decodeColourId, decodeProductId, decodeVersion } from './identity';

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

describe('decodeColourId', () => {
  it('reads the colour id after the status byte', () => {
    // realme Link PollCommandManager.Y(): [status][colorId], 2 = BLACK.
    expect(decodeColourId(Uint8Array.from([0x00, 0x02]))).toBe(2);
  });

  it('throws on a non-zero status or a truncated payload', () => {
    expect(() => decodeColourId(Uint8Array.from([0x01, 0x02]))).toThrow();
    expect(() => decodeColourId(Uint8Array.from([0x00]))).toThrow();
  });
});

describe('decodeVersion (realme PollCommandManager.p0():971-988, CommandUtil.j():374-396)', () => {
  const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

  it('reads device,type,version triples after status and count', () => {
    const payload = Uint8Array.from([0x00, 0x02, ...ascii('1,0,1.2.3,2,0,1.2.4')]);
    expect(decodeVersion(payload)).toEqual([
      { device: 'left', type: 0, version: '1.2.3' },
      { device: 'right', type: 0, version: '1.2.4' },
    ]);
  });

  it('maps an unknown device id to other', () => {
    expect(decodeVersion(Uint8Array.from([0x00, 0x01, ...ascii('9,1,7')]))[0].device).toBe('other');
  });

  it('throws when the field count disagrees with count * 3', () => {
    expect(() => decodeVersion(Uint8Array.from([0x00, 0x02, ...ascii('1,0,1.2.3')]))).toThrow();
  });
});
