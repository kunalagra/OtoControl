import { describe, expect, it } from 'vitest';

import { catalogEntryFor } from '../catalog';

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

describe('per-model touch masks', () => {
  const buds3Pro = catalogEntryFor('06A850');
  const table = [rec(1, 1, 1, 1), rec(1, 1, 2, 6), rec(1, 1, 3, 3), rec(1, 1, 6, 11), rec(4, 6, 2, 29)];
  const fns = (record: ReturnType<typeof rec>, catalog = buds3Pro) =>
    functionChoices(record, table, 'oppo', catalog).map((c) => c.fn);

  it('offers only what the model accepts on each action (Enco Buds3 Pro)', () => {
    expect(fns(table[0])).toEqual([0, 1]); // single tap: no volume
    expect(fns(table[1])).toEqual([0, 1, 5, 6, 3, 17]);
    expect(fns(table[2])).toEqual([0, 5, 6, 3, 17]);
    expect(fns(table[3])).toEqual([0, 11, 12]);
  });

  it('labels previous/next with the current codes', () => {
    expect(functionChoices(table[1], table, 'oppo', buds3Pro)).toEqual(
      expect.arrayContaining([{ fn: 5, label: 'Previous' }, { fn: 6, label: 'Next' }]),
    );
  });

  it('uses the legacy previous/next codes on OnePlus Buds', () => {
    const buds = { ...catalogEntryFor('060414')!, touchSupport: [{ action: 2, support: 32 | 64 }] };
    expect(functionChoices(rec(1, 1, 2, 0), [rec(1, 1, 2, 0)], 'oneplus', buds)).toEqual([
      { fn: 4, label: 'Previous' },
      { fn: 5, label: 'Next' },
      { fn: 0, label: 'None' }, // the current value, kept though the mask leaves it out
    ]);
  });

  it('keeps the code already set even when the mask excludes it', () => {
    expect(fns(rec(1, 1, 1, 11))).toEqual([0, 1, 11]);
  });

  it('leaves the call button and unmasked actions to the generic lists', () => {
    expect(fns(table[4])).toEqual([0, 28, 29]);
    expect(fns(rec(1, 1, 4, 1))).toEqual(functionChoices(rec(1, 1, 4, 1), table, 'oppo').map((c) => c.fn));
  });
});
