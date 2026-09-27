import { describe, expect, it } from 'vitest';
import { statusBody } from './status';

describe('statusBody', () => {
  it('returns the bytes after a zero status', () => {
    expect(Array.from(statusBody(Uint8Array.from([0x00, 0x05, 0x06]), 'x'))).toEqual([0x05, 0x06]);
  });

  it('throws on a non-zero or missing status', () => {
    expect(() => statusBody(Uint8Array.from([0x01, 0x05]), 'battery')).toThrow('battery returned status 1');
    expect(() => statusBody(Uint8Array.from([]), 'battery')).toThrow('battery returned status none');
  });
});
