/**
 * Built-in EQ presets per model. The wire id is the whitelist's
 * `protocolIndex`; `modeType` only chooses the label. Labels are this repo's
 * own short names for the vendor's mode types, not the vendor's strings.
 */

import type { HeyMelodyCatalogEntry } from './catalog.generated';

export interface BuiltinPreset {
  id: number;
  name: string;
}

/** Vendor default when the whitelist sets no `customEqMax`. */
export const DEFAULT_CUSTOM_EQ_CAP = 3;

/** The built-in ids a model gets when the catalog does not describe it. */
const DEFAULT_BUILTIN_IDS = [0, 1, 2];

const MODE_NAMES: Record<number, string> = {
  1: 'Classic',
  2: 'Dynamic bass',
  3: 'Clear vocals',
  4: 'Clear',
  5: 'Default',
  6: 'Dynaudio Clear',
  7: 'Dynaudio Warm',
  8: 'Dynaudio Punchy',
  9: 'Dynaudio Real',
  11: 'Balanced',
  12: 'Bass',
  13: 'Bold',
  14: 'Clear vocals',
  15: 'Gentle',
  // 16 and 19 come from HeyTap's modeType -> string switch, heytap/jadx_out/sources/p085g9/o.java:122-129
  // (R.string.melody_ui_enco_x_classic "Enco X Classic"; melody_ui_equalizer_hans "Hans Zimmer Soundscape
  // Tuning", strings.xml:1296 and :1327). Absent from the realme app, which has neither string.
  16: 'Enco X Classic',
  17: 'Balanced',
  18: 'Reno Dawn',
  19: 'Hans Zimmer Soundscape',
  20: 'Natural',
  21: 'Reno Sunrise',
  22: 'Natural balance',
  25: 'Reno Galaxy',
  26: 'Ultimate sound',
  27: 'HD clarity',
  28: 'Pure vocals',
  29: 'Thundering bass',
  30: 'Dynaudio featured',
  31: 'Bass boost',
  32: 'Clear vocals',
  33: 'Galactic',
  34: 'Vibrant',
  35: 'Default',
};

const numbered = (id: number): string => `Preset ${id + 1}`;

export function builtinPresets(entry: HeyMelodyCatalogEntry | null): BuiltinPreset[] {
  const modes = entry?.equalizerMode;
  if (!modes || modes.length === 0) return DEFAULT_BUILTIN_IDS.map((id) => ({ id, name: numbered(id) }));
  return modes.map(({ protocolIndex, modeType }) => ({ id: protocolIndex, name: MODE_NAMES[modeType] ?? numbered(protocolIndex) }));
}

export function customEqCap(entry: HeyMelodyCatalogEntry | null): number {
  return entry?.customEqMax ?? DEFAULT_CUSTOM_EQ_CAP;
}
