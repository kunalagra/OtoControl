import { describe, expect, it } from 'vitest';
import { decodeNotificationSupport, encodeRegisterNotify } from './notify';

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
