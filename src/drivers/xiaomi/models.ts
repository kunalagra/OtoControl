/**
 * Which model this is, and what is known about it before it has been probed.
 *
 * The wire protocol identifies a model by VID/PID (the `GetInfo` reply's type-3
 * record), the same pair the vendor app keys its cloud catalog on. The names
 * below are that catalog's own (`android-testing/xiaomi/samples/
 * xiaomi_product_list.sample.json`, fetched unauthenticated from the vendor's
 * live host); it holds nine products, so an unknown PID is the normal case for
 * a newer model and falls back to the name the earbuds report themselves.
 *
 * What a model can do is mostly *probed* (`device.ts`). The hints here carry
 * only what Gadgetbridge's per-model coordinators record and a probe cannot
 * tell: which option lists a model offers.
 */

import { NC_STRENGTH_LABEL, TRANSPARENCY_STRENGTH_LABEL } from './commands';

/** Xiaomi's Bluetooth vendor id, on every product in the catalog sample. */
export const XIAOMI_VID = 0x2717;

const MODELS: Record<number, string> = {
  0x5025: 'Xiaomi Buds 3 Pro',
  0x5026: 'Xiaomi Buds 3',
  0x5034: 'Redmi Buds 4',
  0x5035: 'Xiaomi Buds 4 Pro',
  0x5095: 'Redmi Buds 6S',
  0x50db: 'Xiaomi Clip-on Earbuds',
  0x50f2: 'REDMI Buds 8',
  0x5113: 'Xiaomi Air 5',
  0x511c: 'REDMI Buds 8S',
};

/** The catalog's name for a VID/PID, or null for a model it does not list. */
export function catalogName(vid: number | null, pid: number | null): string | null {
  if (vid !== XIAOMI_VID || pid === null) return null;
  return MODELS[pid] ?? null;
}

export interface ModelHints {
  /** False for the `Active` line, which has no noise control at all. */
  noiseControl: boolean;
  /** Noise-cancelling strength ids this model offers, in display order. */
  ncStrengths: number[];
  /** Transparency strength ids this model offers, in display order. */
  transparencyStrengths: number[];
}

const DEFAULT_HINTS: ModelHints = {
  noiseControl: true,
  ncStrengths: [0, 1, 2],
  transparencyStrengths: [0, 1, 2],
};

/**
 * Per-name overrides, from Gadgetbridge's `devices/redmibuds/*Coordinator`:
 * the Redmi Buds 3 Pro lists only Regular and Voice transparency and adds an
 * Adaptive noise-cancelling strength; the `Active` models list no ambient
 * sound modes.
 */
const HINTS: ReadonlyArray<[RegExp, Partial<ModelHints>]> = [
  [/Redmi Buds 3 Pro/i, { ncStrengths: [0, 1, 2, 3], transparencyStrengths: [0, 1] }],
  [/Buds \d+ Active/i, { noiseControl: false }],
];

export function modelHints(...names: Array<string | null>): ModelHints {
  for (const name of names) {
    if (!name) continue;
    const match = HINTS.find(([pattern]) => pattern.test(name));
    if (match) return { ...DEFAULT_HINTS, ...match[1] };
  }
  return DEFAULT_HINTS;
}

export interface StrengthOption {
  id: number;
  label: string;
}

export const ncStrengthOptions = (ids: readonly number[]): StrengthOption[] =>
  ids.map((id) => ({ id, label: NC_STRENGTH_LABEL[id] ?? `Level ${id}` }));

export const transparencyStrengthOptions = (ids: readonly number[]): StrengthOption[] =>
  ids.map((id) => ({ id, label: TRANSPARENCY_STRENGTH_LABEL[id] ?? `Level ${id}` }));
