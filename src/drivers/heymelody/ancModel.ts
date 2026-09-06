/**
 * Per-model ANC mode capability model.
 *
 * The fact this module exists for: `0x0404`'s SET_ANC payload is
 * `[0x01, 0x01, <bitmap with exactly one bit set>]`, but *which bit* means
 * "Noise Cancellation" vs "Transparency" vs "Off" is not fixed across
 * models — it comes from each model's own `noiseReductionMode` whitelist
 * data (`HeyMelodyCatalogEntry.noiseReductionMode` in `catalog.generated.ts`,
 * sourced from HeyTap's own bundled whitelist resource — see
 * `scripts/gen-heymelody-catalog.py`). This driver previously shipped a
 * single hardcoded mode-index byte with no basis at all; that was wrong for
 * every model, not just an edge case.
 *
 * `buildAncCapabilities` is ported from Leaf-lsgtky/OppoPods's
 * `DeviceModelRegistry.buildAncOptions()` (the original upstream 1812z's
 * fork descends from — GPL-3.0, read-only reference per this project's
 * standing rule; every function below is written from the algorithm
 * description, not translated line-for-line). Its own code comment notes
 * this exact design was tested against real Enco X3/Free4 hardware.
 *
 * "Legacy" devices (NC's bit at index 0, no sub-modes) have NC/Transparency
 * swapped relative to modern ones on the wire — but because every lookup
 * here goes by canonical *name*, not by a hardcoded index, that swap is
 * already reflected in each model's own data and never needs a special-case
 * branch (see `CapabilityProfileFactory.kt`'s own comment on this point).
 */

/** Canonical ANC mode names — matches `AncKeys` in Leaf-lsgtky/OppoPods's `DeviceCapabilities.kt`. */
export type AncKey = 'off' | 'nc' | 'transparency' | 'adaptive' | 'smart' | 'light' | 'medium' | 'deep';

/** Display label per canonical mode name, for `Noise.tsx`. */
export const ANC_LABEL: Record<AncKey, string> = {
  off: 'Off',
  nc: 'Noise Cancellation',
  transparency: 'Transparency',
  adaptive: 'Adaptive',
  smart: 'Smart',
  light: 'Light',
  medium: 'Medium',
  deep: 'Deep',
};

const MODE_TYPE_KEY: Record<number, AncKey> = {
  1: 'off',
  2: 'transparency',
  3: 'light',
  4: 'deep',
  5: 'nc',
  6: 'adaptive',
  7: 'smart',
  8: 'medium',
  10: 'adaptive',
};

/** An unrecognised `modeType` gets its own label rather than being dropped. */
const modeKey = (modeType: number): string => MODE_TYPE_KEY[modeType] ?? `mode${modeType}`;

const NOISE_LEVEL_KEYS = new Set<string>(['smart', 'light', 'medium', 'deep']);

const MAIN_RANK: Record<string, number> = { nc: 0, smart: 0, transparency: 1, adaptive: 2, off: 99 };
const mainRank = (key: string): number => MAIN_RANK[key] ?? 50;

/**
 * Raw shape of one `function.noiseReductionMode[]` entry from HeyTap's
 * bundled whitelist resource (`docs/reference/heymelody-anc-modes.json`,
 * embedded per-model into `catalog.generated.ts`).
 */
export interface RawAncModeEntry {
  protocolIndex: number;
  modeType: number;
  childrenMode?: RawAncModeEntry[];
}

export interface AncModeOption {
  key: string;
  protocolIndex: number;
  /** Intensity sub-levels (e.g. Smart/Light/Medium/Deep under NC) — empty for a plain toggle. */
  children: AncModeOption[];
}

export interface AncCapabilities {
  /** Top-level modes in display order (NC before Transparency before Off), each with intensity sub-options when this model has them. */
  options: AncModeOption[];
  /** `protocolIndex` (a bitmap bit position) -> canonical mode name, for resolving a device's reported `ancModeIndex` into something human. */
  indexToKey: Readonly<Record<number, string>>;
  /** Canonical mode name -> `protocolIndex`, for building a `SetAncMode` write. */
  keyToIndex: Readonly<Record<string, number>>;
  hasAdaptive: boolean;
  /** Informational only — see this file's own top comment on why writes never branch on it. */
  isLegacy: boolean;
}

export const EMPTY_ANC_CAPABILITIES: AncCapabilities = {
  options: [],
  indexToKey: {},
  keyToIndex: {},
  hasAdaptive: false,
  isLegacy: false,
};

/** Builds this model's ANC capability model from its raw whitelist `noiseReductionMode` entries. */
export function buildAncCapabilities(entries: RawAncModeEntry[] | undefined): AncCapabilities {
  if (!entries || entries.length === 0) return EMPTY_ANC_CAPABILITIES;

  const indexToKey: Record<number, string> = {};
  const keyToIndex: Record<string, number> = {};
  const options: AncModeOption[] = [];
  let hasAdaptive = false;
  let hasAnyChildren = false;

  /** First registration of a name wins the index (`putIfAbsent` semantics) — a later, explicit `keyToIndex[key] = index` overrides this deliberately for a top-level entry's own name. */
  const register = (index: number, key: string) => {
    indexToKey[index] = key;
    if (!(key in keyToIndex)) keyToIndex[key] = index;
  };

  for (const entry of entries) {
    const key = modeKey(entry.modeType);
    const ownIndex = entry.protocolIndex;

    const children = entry.childrenMode;
    if (children && children.length > 0) hasAnyChildren = true;

    const childOptions: AncModeOption[] = [];
    if (children) {
      for (const child of children) {
        const childKey = modeKey(child.modeType ?? entry.modeType);
        if (NOISE_LEVEL_KEYS.has(childKey)) {
          // An intensity level (Smart/Light/Medium/Deep): independently sendable.
          register(child.protocolIndex, childKey);
        } else {
          // A variant of the parent (e.g. "Adaptive Transparency" under
          // Transparency) — its bit reports as the *parent's* name, and it
          // is never independently selectable in its own right.
          indexToKey[child.protocolIndex] = key;
        }
        childOptions.push({ key: childKey, protocolIndex: child.protocolIndex, children: [] });
      }
    }

    // Main categories (Off/NC/Transparency) always send via the parent's own
    // protocolIndex — a child's index is only for bitmap reverse-lookup and
    // intensity sub-selection, never for sending the parent mode itself.
    register(ownIndex, key);
    keyToIndex[key] = ownIndex;
    // Only a top-level Adaptive entry counts — one nested under Transparency
    // as a variant (see above) must not make this model look like it has a
    // standalone Adaptive toggle.
    if (key === 'adaptive') hasAdaptive = true;

    if (childOptions.length === 0) {
      options.push({ key, protocolIndex: ownIndex, children: [] });
    } else if (childOptions.length === 1 && childOptions[0].key === key) {
      // The only child shares the parent's name (e.g. Transparency -> [Transparency]) — collapse to one flat option.
      options.push({ key, protocolIndex: ownIndex, children: [] });
    } else {
      options.push({ key, protocolIndex: ownIndex, children: childOptions });
    }
  }

  // No sub-modes anywhere, and NC sits at bit 0: an older device family whose
  // NC/Transparency bits are swapped relative to modern ones.
  const isLegacy =
    !hasAnyChildren && entries.some((entry) => entry.modeType === 5 && entry.protocolIndex === 0);

  const sorted = options
    .slice()
    .sort((a, b) => mainRank(a.key) - mainRank(b.key))
    .map((option) =>
      option.children.length === 0
        ? option
        : { ...option, children: [...option.children].sort((a, b) => mainRank(a.key) - mainRank(b.key)) },
    );

  return { options: sorted, indexToKey, keyToIndex, hasAdaptive, isLegacy };
}
