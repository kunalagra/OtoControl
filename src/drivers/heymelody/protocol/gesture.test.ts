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

describe('unknown brand (catalog miss)', () => {
  it('does not guess a scheme from a lone 4', () => {
    expect(prevNextScheme([rec(1, 1, 2, 4)], null)).toBeNull();
  });

  it('still reads 6 as current without a brand', () => {
    expect(prevNextScheme([rec(1, 1, 2, 6)], null)).toBe('current');
  });

  it('labels 4 as ambiguous when neither scheme nor brand is known', () => {
    expect(functionLabel(4, null, null)).toBe('Voice assistant / Previous');
  });

  it('keeps the unmasked legacy and realme labels for 4', () => {
    expect(functionLabel(4, 'legacy', 'oneplus')).toBe('Previous');
    expect(functionLabel(4, 'legacy', null)).toBe('Previous');
    expect(functionLabel(4, 'current', null)).toBe('Voice assistant');
    expect(functionLabel(4, null, 'oppo')).toBe('Voice assistant');
  });
});

describe('truncated and empty tables', () => {
  it('throws on a record cut short', () => {
    expect(() => decodeGestures(Uint8Array.from([0, 3, 1, 1]))).toThrow(/truncated/);
  });

  it('reads status 0 with count 0 as an empty table', () => {
    expect(decodeGestures(Uint8Array.from([0x00, 0]))).toEqual([]);
  });
});

describe('assistant code in the choices', () => {
  const labels = (choices: { label: string }[]) => choices.filter((c) => c.label === 'Voice assistant').length;

  it('offers one assistant when the table uses 3 on another record and this one holds 4', () => {
    const table = [rec(1, 1, 1, 4), rec(1, 1, 2, 3), rec(1, 1, 3, 6)];
    const choices = functionChoices(table[0], table, 'oppo');
    expect(labels(choices)).toBe(1);
    expect(choices.map((c) => c.fn)).toContain(4);
    expect(choices.map((c) => c.fn)).not.toContain(3);
  });

  it('offers only 3 for a record on 3 even when a realme table also holds 4', () => {
    const table = [rec(1, 1, 1, 3), rec(1, 1, 2, 4), rec(1, 1, 3, 6)];
    const choices = functionChoices(table[0], table, 'realme');
    expect(labels(choices)).toBe(1);
    expect(choices.map((c) => c.fn)).toContain(3);
    expect(choices.map((c) => c.fn)).not.toContain(4);
  });

  it('offers one assistant on the masked path too', () => {
    const catalog = { ...catalogEntryFor('06A850')!, touchSupport: [{ action: 1, support: 1 | 4 }] };
    const choices = functionChoices(rec(1, 1, 1, 4), [rec(1, 1, 1, 4)], 'oppo', catalog);
    expect(labels(choices)).toBe(1);
    expect(choices.map((c) => c.fn)).toContain(4);
  });

  it('uses 4 for realme and 3 otherwise when the table says nothing', () => {
    const table = [rec(1, 1, 1, 1)];
    expect(functionChoices(table[0], table, 'realme').map((c) => c.fn)).toContain(4);
    expect(functionChoices(table[0], table, 'oppo').map((c) => c.fn)).toContain(3);
  });

  it('offers a lone 4 on an unknown brand as the ambiguous label, plus the standard assistant', () => {
    const table = [rec(1, 1, 2, 4)];
    const choices = functionChoices(table[0], table, null);
    expect(choices).toContainEqual({ fn: 4, label: 'Voice assistant / Previous' });
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
