import { describe, expect, it } from 'vitest';

import { THEME_ORDER, isThemePreference, nextTheme, resolveTheme } from './theme';

describe('resolveTheme', () => {
  it('honours an explicit choice regardless of the system setting', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('follows the system when set to system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('always resolves to a concrete theme', () => {
    for (const preference of THEME_ORDER) {
      for (const systemDark of [true, false]) {
        expect(['light', 'dark']).toContain(resolveTheme(preference, systemDark));
      }
    }
  });
});

describe('nextTheme', () => {
  it('cycles through every preference and returns to the start', () => {
    let current = THEME_ORDER[0];
    const seen = [current];
    for (let step = 0; step < THEME_ORDER.length - 1; step += 1) {
      current = nextTheme(current);
      seen.push(current);
    }
    expect(new Set(seen).size).toBe(THEME_ORDER.length);
    expect(nextTheme(current)).toBe(THEME_ORDER[0]);
  });
});

describe('isThemePreference', () => {
  it('accepts the three valid values', () => {
    for (const preference of THEME_ORDER) {
      expect(isThemePreference(preference)).toBe(true);
    }
  });

  it('rejects anything else, so stored junk falls back safely', () => {
    for (const value of [null, undefined, '', 'DARK', 'auto', 0, {}]) {
      expect(isThemePreference(value)).toBe(false);
    }
  });
});
