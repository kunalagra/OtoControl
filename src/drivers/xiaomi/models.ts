/**
 * Which model this is, and what it can do before anything has been probed.
 *
 * The earbuds identify themselves by VID/PID (`GetInfo` TLV 3), the pair the
 * vendor app keys its cloud catalog on. `catalog.generated.ts` is that
 * catalog's own capability data (see `scripts/fetch-xiaomi-catalog.py`): the
 * authoritative list of what each model has — noise-control gears, EQ presets,
 * which actions each gesture accepts, whether it can be found. A model newer
 * than the bundled catalog is the normal case for fresh hardware; it falls back
 * to the name the earbuds report, the common option sets Gadgetbridge's
 * coordinators share, and whatever the probes find.
 *
 * What a model *does* answer is still probed (`device.ts`): the catalog says
 * what is on offer, the earbuds say what is on.
 */

import { XIAOMI_CATALOG } from './catalog.generated';
import type { XiaomiCatalogEntry } from './catalog.generated';
import { NC_STRENGTH_LABEL, Tap, TRANSPARENCY_STRENGTH_LABEL } from './commands';

/** Xiaomi's Bluetooth vendor id, on every product in the catalog. */
export const XIAOMI_VID = 0x2717;

const pidKey = (pid: number): string => pid.toString(16).padStart(4, '0');

/** The catalog entry for a VID/PID, or null for a model it does not list. */
export function catalogEntry(vid: number | null, pid: number | null): XiaomiCatalogEntry | null {
  if (vid !== XIAOMI_VID || pid === null) return null;
  return XIAOMI_CATALOG[pidKey(pid)] ?? null;
}

/** The catalog's name for a VID/PID, or null for a model it does not list. */
export const catalogName = (vid: number | null, pid: number | null): string | null => catalogEntry(vid, pid)?.name ?? null;

/** The vendor app's `Function` ids this driver gates on (`device/manager/export/Function.java`). */
const FUNC = { find: 5001, wear: 3002 } as const;
const NOISE_FUNCS = [1001, 1002, 1003, 1004, 1005, 1006, 1007] as const;

/** What the common models list: Gadgetbridge's coordinators share these (Standard, Treble, Bass, Voice). */
const COMMON_EFFECTS = [0x00, 0x06, 0x05, 0x01];
const COMMON_GEAR = [0, 1, 2];
/** Action ids a gesture takes when the catalog names none: Gadgetbridge's `RedmiBudsGestureAction`. */
const COMMON_ACTIONS = [1, 2, 3, 4, 5];

/** The custom-EQ preset id: selecting it is what makes the chip apply a written curve. */
export const CUSTOM_EQ_PRESET = 0x0a;

export interface ModelGates {
  /** False for models with no noise control at all, such as the `Active` line. */
  noiseControl: boolean;
  /** Noise-cancelling strength ids offered, in display order; fewer than two means no choice. */
  ncGear: number[];
  tpGear: number[];
  /** EQ preset ids offered, in display order. */
  effects: number[];
  customEq: boolean;
  find: boolean;
  /** Per tap code, the action ids it accepts; null when the model is unknown and the table decides. */
  taps: Map<number, number[]> | null;
  /** Whether long press can cycle noise-control modes. */
  longPressCycle: boolean;
}

export interface ModelIdentity {
  vid: number | null;
  pid: number | null;
  btName: string | null;
}

/** The `Active` models list no ambient sound modes (Gadgetbridge); used only for a model the catalog lacks. */
const NO_NOISE_CONTROL = /Buds \d+ Active/i;

export function modelGates({ vid, pid, btName }: ModelIdentity): ModelGates {
  const entry = catalogEntry(vid, pid);
  if (!entry) {
    return {
      noiseControl: !(btName && NO_NOISE_CONTROL.test(btName)),
      ncGear: COMMON_GEAR,
      tpGear: COMMON_GEAR,
      effects: COMMON_EFFECTS,
      customEq: false,
      find: true,
      taps: null,
      longPressCycle: true,
    };
  }
  const funcs = new Set(entry.funcs);
  const taps = new Map<number, number[]>();
  for (const [tap, choices] of Object.entries(entry.taps ?? {})) {
    taps.set(Number(tap), choices.actions.length > 0 ? choices.actions : COMMON_ACTIONS);
  }
  const effects = entry.effects ?? [];
  return {
    noiseControl: NOISE_FUNCS.some((id) => funcs.has(id)),
    ncGear: entry.ncGear ?? [],
    tpGear: entry.tpGear ?? [],
    effects,
    customEq: effects.includes(CUSTOM_EQ_PRESET),
    find: funcs.has(FUNC.find),
    taps,
    longPressCycle: entry.taps?.[String(Tap.Long)]?.cycle ?? false,
  };
}

/** The product render for this model and the unit's own colour (`GetInfo` TLV 13), else its default colour. */
export function catalogImage(vid: number | null, pid: number | null, colour: number | null): string | null {
  const entry = catalogEntry(vid, pid);
  if (!entry) return null;
  return (colour !== null ? entry.images[String(colour)] : undefined) ?? entry.images[String(entry.defaultColour)] ?? Object.values(entry.images)[0] ?? null;
}

export interface StrengthOption {
  id: number;
  label: string;
}

/**
 * A gear with more than four steps is a depth scale (the models that list 0-19
 * are the ones whose official app shows a slider), not a set of named strengths.
 */
export const isDepthScale = (gear: readonly number[]): boolean => gear.length > 4;

export const ncStrengthOptions = (ids: readonly number[]): StrengthOption[] =>
  ids.map((id) => ({ id, label: NC_STRENGTH_LABEL[id] ?? `Level ${id}` }));

export const transparencyStrengthOptions = (ids: readonly number[]): StrengthOption[] =>
  ids.map((id) => ({ id, label: TRANSPARENCY_STRENGTH_LABEL[id] ?? `Level ${id}` }));
