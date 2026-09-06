import { describe, expect, it } from 'vitest';
import { buildAncCapabilities } from './ancModel';
import type { RawAncModeEntry } from './ancModel';

describe('buildAncCapabilities', () => {
  it('returns the empty model for undefined or empty input', () => {
    expect(buildAncCapabilities(undefined)).toEqual({
      options: [],
      indexToKey: {},
      keyToIndex: {},
      hasAdaptive: false,
      isLegacy: false,
    });
    expect(buildAncCapabilities([])).toEqual(buildAncCapabilities(undefined));
  });

  it('builds a real model\'s full tree — OPPO Enco X3, from the HeyTap whitelist', () => {
    // Real `function.noiseReductionMode` for productId 067410 (OPPO Enco X3),
    // extracted from the app's own bundled whitelist resource — not a
    // synthetic example.
    const entries: RawAncModeEntry[] = [
      {
        protocolIndex: 1,
        modeType: 5,
        childrenMode: [
          { protocolIndex: 7, modeType: 7 },
          { protocolIndex: 4, modeType: 4 },
          { protocolIndex: 5, modeType: 8 },
          { protocolIndex: 6, modeType: 3 },
        ],
      },
      { protocolIndex: 0, modeType: 1, childrenMode: [{ protocolIndex: 3, modeType: 1 }] },
      {
        protocolIndex: 2,
        modeType: 2,
        childrenMode: [
          { protocolIndex: 8, modeType: 2 },
          { protocolIndex: 9, modeType: 6 },
        ],
      },
    ];

    const caps = buildAncCapabilities(entries);

    // Writing: which bit to set for each named mode.
    expect(caps.keyToIndex).toEqual({ nc: 1, off: 0, transparency: 2, smart: 7, deep: 4, medium: 5, light: 6 });

    // Reading: which bit reported means which name. Both of Transparency's
    // children (a plain-Transparency variant and an Adaptive-under-Transparency
    // variant) fold back to the parent's own name here — neither is an
    // independently-selectable mode.
    expect(caps.indexToKey).toEqual({
      0: 'off',
      1: 'nc',
      2: 'transparency',
      3: 'off',
      4: 'deep',
      5: 'medium',
      6: 'light',
      7: 'smart',
      8: 'transparency',
      9: 'transparency',
    });

    // UI tree: NC before Transparency before Off; NC carries its 4 intensity
    // sub-levels; Off's single same-named child collapses to a flat entry;
    // Transparency's two children (a same-named one and an Adaptive variant)
    // both surface, since they don't collapse to a single flat entry.
    expect(caps.options).toEqual([
      {
        key: 'nc',
        protocolIndex: 1,
        children: [
          { key: 'smart', protocolIndex: 7, children: [] },
          { key: 'deep', protocolIndex: 4, children: [] },
          { key: 'medium', protocolIndex: 5, children: [] },
          { key: 'light', protocolIndex: 6, children: [] },
        ],
      },
      {
        key: 'transparency',
        protocolIndex: 2,
        children: [
          { key: 'transparency', protocolIndex: 8, children: [] },
          { key: 'adaptive', protocolIndex: 9, children: [] },
        ],
      },
      { key: 'off', protocolIndex: 0, children: [] },
    ]);

    expect(caps.hasAdaptive).toBe(false); // Adaptive only appears nested under Transparency here, not standalone.
    expect(caps.isLegacy).toBe(false); // has sub-modes, so the legacy check never applies.
  });

  it('detects a legacy device: no sub-modes anywhere, NC at bit 0', () => {
    const entries: RawAncModeEntry[] = [
      { protocolIndex: 0, modeType: 5 }, // NC
      { protocolIndex: 1, modeType: 1 }, // Off
      { protocolIndex: 2, modeType: 2 }, // Transparency
    ];

    const caps = buildAncCapabilities(entries);

    expect(caps.isLegacy).toBe(true);
    expect(caps.keyToIndex).toEqual({ nc: 0, off: 1, transparency: 2 });
    // Writing still goes by name, so callers never need their own legacy
    // branch — "nc" already resolves to this device's actual bit (0).
    expect(caps.options.map((o) => o.key)).toEqual(['nc', 'transparency', 'off']);
  });

  it('recognises a standalone top-level Adaptive entry', () => {
    const entries: RawAncModeEntry[] = [
      { protocolIndex: 0, modeType: 1 },
      { protocolIndex: 1, modeType: 5 },
      { protocolIndex: 2, modeType: 2 },
      { protocolIndex: 3, modeType: 6 }, // top-level Adaptive
    ];

    const caps = buildAncCapabilities(entries);

    expect(caps.hasAdaptive).toBe(true);
    expect(caps.keyToIndex.adaptive).toBe(3);
    expect(caps.options.map((o) => o.key)).toEqual(['nc', 'transparency', 'adaptive', 'off']);
  });

  it('falls back to a synthetic label for an unrecognised modeType', () => {
    const caps = buildAncCapabilities([{ protocolIndex: 0, modeType: 99 }]);
    expect(caps.keyToIndex).toEqual({ mode99: 0 });
    expect(caps.options).toEqual([{ key: 'mode99', protocolIndex: 0, children: [] }]);
  });
});
