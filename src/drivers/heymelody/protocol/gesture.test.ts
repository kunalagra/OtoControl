import { describe, expect, it } from 'vitest';

import { decodeGestures, encodeGestures, functionChoices, functionLabel, prevNextScheme } from './gesture';

const rec = (deviceType: number, button: number, action: number, fn: number) => ({ deviceType, button, action, fn });

describe('touch-control table', () => {
  it('reads 4-byte records after the status and count', () => {
    expect(decodeGestures(Uint8Array.from([0x00, 2, 1, 1, 2, 1, 2, 1, 2, 6]))).toEqual([rec(1, 1, 2, 1), rec(2, 1, 2, 6)]);
  });

  it('writes a count and the records', () => {
    expect(encodeGestures([rec(1, 1, 2, 5)])).toEqual([1, 1, 1, 2, 5]);
  });

  it('refuses a non-zero status', () => {
    expect(() => decodeGestures(Uint8Array.from([0x01, 0]))).toThrow();
  });
});

describe('previous/next scheme', () => {
  it('is current when the table already uses 6', () => {
    expect(prevNextScheme([rec(1, 1, 2, 6)], 'oneplus')).toBe('current');
  });

  it('is legacy when an OPPO/OnePlus table uses 4 without 6', () => {
    expect(prevNextScheme([rec(1, 1, 2, 4)], 'oneplus')).toBe('legacy');
  });

  it('is unknown on realme with only 4, because 4 is the realme assistant', () => {
    expect(prevNextScheme([rec(1, 1, 2, 4)], 'realme')).toBeNull();
  });
});

describe('function labels and choices', () => {
  it('reads 4 as assistant on realme', () => {
    expect(functionLabel(4, null, 'realme')).toBe('Voice assistant');
  });

  it('offers call functions on the call button only', () => {
    expect(functionChoices(rec(4, 6, 2, 29), [rec(4, 6, 2, 29)], 'oneplus').map((c) => c.fn)).toEqual([0, 28, 29]);
  });

  it('offers previous/next only once the scheme is known', () => {
    const table = [rec(1, 1, 2, 1)];
    expect(functionChoices(table[0], table, 'oneplus').map((c) => c.fn)).not.toContain(5);
    const current = [rec(1, 1, 2, 6)];
    expect(functionChoices(current[0], current, 'oneplus').map((c) => c.fn)).toEqual(expect.arrayContaining([5, 6]));
  });

  it('always includes the code already set, even an unknown one', () => {
    const table = [rec(1, 1, 3, 25)];
    expect(functionChoices(table[0], table, 'oppo')).toContainEqual({ fn: 25, label: 'Function 25' });
  });
});
