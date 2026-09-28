/// <reference types="node" />

import { readFileSync } from 'node:fs';
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

/**
 * The stylesheet is the theme, so its tokens are worth asserting the same way
 * the JS is: nothing renders correctly if these drift. `theme.ts` toggles the
 * `.dark` class on the root element, so `.dark` is the dark theme and `:root`
 * is the light one.
 */
describe('mono design tokens', () => {
  // Comments go before the source is read, and that is not tidiness. A
  // declaration is found by splitting a rule on `;` and taking the text before
  // the first `:`, so a comment ending in `--signal-strong: #c72414` followed by
  // `*/` and the real declaration glues the two together: the key comes out as
  // `*/\n    --signal-strong` and the token reads as absent. CSS does not have
  // that ambiguity, so the parser should not either.
  const stylesheet = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const parsed = new Map<string, Record<string, string>>();

  /** The declarations of one top-level rule in index.css, keyed by property. */
  function declarationsOf(selector: string): Record<string, string> {
    const cached = parsed.get(selector);
    if (cached) return cached;

    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rule = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(stylesheet);
    expect(rule, `index.css has no top-level "${selector}" rule`).not.toBeNull();

    const declarations: Record<string, string> = {};
    for (const declaration of rule![1].split(';')) {
      const colon = declaration.indexOf(':');
      if (colon === -1) continue;
      declarations[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim();
    }
    parsed.set(selector, declarations);
    return declarations;
  }

  /** Every name shadcn's components and the `bg-*` utilities expect. */
  const SHADCN_TOKENS = [
    '--background', '--foreground',
    '--card', '--card-foreground',
    '--popover', '--popover-foreground',
    '--primary', '--primary-foreground',
    '--secondary', '--secondary-foreground',
    '--muted', '--muted-foreground',
    '--accent', '--accent-foreground',
    '--destructive', '--border', '--input', '--ring',
    '--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5',
    '--sidebar', '--sidebar-foreground',
    '--sidebar-primary', '--sidebar-primary-foreground',
    '--sidebar-accent', '--sidebar-accent-foreground',
    '--sidebar-border', '--sidebar-ring',
  ];

  it('paints the dark theme black on black with one red', () => {
    const dark = declarationsOf('.dark');
    const expected: Record<string, string> = {
      '--background': '#000000',
      '--card': '#111111',
      '--popover': '#111111',
      '--surface-raised': '#1d1d1d',
      '--muted': '#1f1f1f',
      '--segment-off': '#2a2a2a',
      '--foreground': '#ffffff',
      '--card-foreground': '#ffffff',
      '--popover-foreground': '#ffffff',
      '--muted-foreground': '#888888',
      '--border': '#1f1f1f',
      '--input': '#1f1f1f',
      '--primary': '#ff4d3d',
      '--signal': '#ff4d3d',
      '--signal-strong': '#ff4d3d',
      '--primary-foreground': '#000000',
      '--secondary': '#1d1d1d',
      '--secondary-foreground': '#ffffff',
      '--accent': '#1d1d1d',
      '--accent-foreground': '#ffffff',
      '--destructive': '#ff4d3d',
      '--ring': '#ffffff',
    };
    for (const [token, value] of Object.entries(expected)) {
      expect(dark[token], `dark ${token}`).toBe(value);
    }
  });

  it('inverts the light theme but keeps the same red', () => {
    const light = declarationsOf(':root');
    const expected: Record<string, string> = {
      '--background': '#ffffff',
      '--card': '#f2f2f2',
      '--popover': '#f2f2f2',
      '--surface-raised': '#e6e6e6',
      '--muted': '#e6e6e6',
      '--segment-off': '#d4d4d4',
      '--foreground': '#000000',
      '--card-foreground': '#000000',
      '--popover-foreground': '#000000',
      '--muted-foreground': '#6b6b6b',
      '--border': '#e0e0e0',
      '--input': '#e0e0e0',
      '--primary': '#ff4d3d',
      '--signal': '#ff4d3d',
      // Red text needs more contrast than red fills do, so light mode darkens it.
      // The value is `#c72414` and the reason is the contrast test below: it has
      // to clear AA on the *blocks* red text is painted on, not only on white.
      '--signal-strong': '#c72414',
      '--primary-foreground': '#000000',
      '--secondary': '#e6e6e6',
      '--secondary-foreground': '#000000',
      '--accent': '#e6e6e6',
      '--accent-foreground': '#000000',
      '--destructive': '#ff4d3d',
      '--ring': '#000000',
    };
    for (const [token, value] of Object.entries(expected)) {
      expect(light[token], `light ${token}`).toBe(value);
    }
  });

  /**
   * WCAG relative luminance, from the specification's own formula. A test that
   * asserts a hex string can only say "this is the value that was chosen"; this
   * says whether the choice passes.
   */
  const channel = (value: number): number => {
    const srgb = value / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };

  const luminance = (hex: string): number => {
    const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
    if (!match) throw new Error(`not a six-digit hex colour: ${hex}`);
    const n = Number.parseInt(match[1], 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(channel);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  const contrast = (a: string, b: string): number => {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
  };

  /**
   * Spec §8: red *text* goes through `--signal-strong`, because `--signal` is
   * 3.3 : 1 on white and is therefore a fill and a mark. The token is only
   * correct on the surfaces red text actually lands on, and that list is the
   * point. The value this file asserted until the last review
   * (`#d92b1c`, the one the design guide quotes) measures 4.87 : 1 on **white**
   * and is quoted as "4.9 : 1" in three places in this repo — true on white and
   * nowhere else: 4.35 : 1 on `--card` and 3.90 : 1 on `--surface-raised`, both
   * *below* AA for body text, on the two grounds `alert`'s description and the
   * fader's active readout are painted. An assertion of the hex string alone
   * passed the whole time the token was failing, which is the reason this test
   * computes the ratio instead.
   *
   * The list of surfaces is itself a decision to be made rather than a
   * formality: a new block colour has to be added here, which is the moment to
   * ask whether red text belongs on it at all.
   */
  const RED_TEXT_SURFACES = ['--background', '--card', '--popover', '--surface-raised', '--muted'];

  it('paints red text at AA on every surface it is used on, in both themes', () => {
    for (const theme of [':root', '.dark'] as const) {
      const declarations = declarationsOf(theme);
      const red = declarations['--signal-strong'];
      for (const surface of RED_TEXT_SURFACES) {
        const ratio = contrast(red, declarations[surface]);
        // 4.5 : 1 is AA for normal text. The message carries both numbers, so a
        // failure names the pair and the shortfall.
        expect(
          ratio,
          `${theme} --signal-strong ${red} on ${surface} ${declarations[surface]} is ${ratio.toFixed(2)} : 1`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps a black label legible on the signal fill it is paired with', () => {
    // DESIGN-GUIDE §5.2 and §5.3: the selected segment is a red fill with *black*
    // text, and the guide's own reason is that white on `#ff4d3d` is 3.3 : 1.
    // `--primary-foreground` is that black, and it is the token every primitive
    // writes on `--signal`.
    for (const theme of [':root', '.dark'] as const) {
      const declarations = declarationsOf(theme);
      expect(
        contrast(declarations['--primary-foreground'], declarations['--signal']),
        `${theme} label on the signal fill`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('derives the shadcn radii from a 1rem base', () => {
    expect(declarationsOf(':root')['--radius']).toBe('1rem');
  });

  it('keeps every shadcn token name, so components/ui/* keep working', () => {
    const light = declarationsOf(':root');
    const dark = declarationsOf('.dark');
    for (const token of SHADCN_TOKENS) {
      expect(light[token], `light ${token}`).toBeTypeOf('string');
      expect(dark[token], `dark ${token}`).toBeTypeOf('string');
    }
  });

  it('draws the dotted texture 12px apart at 12% of the foreground', () => {
    const dots = declarationsOf('.mono-dots');
    expect(dots['background-color']).toBe('var(--card)');
    expect(dots['background-size']).toBe('12px 12px');
    expect(dots['background-image']).toContain('radial-gradient(');
    expect(dots['background-image']).toContain('var(--foreground) 12%');
  });

  it('offers a fainter 10px texture for the fader desk', () => {
    const fader = declarationsOf('.mono-dots-fader');
    expect(fader['background-size']).toBe('10px 10px');
    expect(fader['background-image']).toContain('var(--foreground) 8%');
  });
});
