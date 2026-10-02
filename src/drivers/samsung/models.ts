/**
 * The Galaxy Buds this driver knows, and what each can do.
 *
 * Gating is a static table, not negotiation: the protocol has no capability
 * bitmap (the vendor plugin gates per model and by the `revision` byte the
 * earbuds report), so this mirrors GalaxyBudsClient's `Model/Specifications/*`
 * — the same rule lists, minus the features this driver does not touch. A
 * `minRevision` is the extended-status revision a feature first appears at.
 */

/** Which `ExtendedStatus` (0x61) layout a model sends — see `decode.ts`. */
export type StatusLayout = 'legacy' | 'plus' | 'live' | 'pro' | 'modern';

export type NoiseStyle =
  /** No noise control (the 2019 Buds have only ambient sound; handled as a toggle). */
  | 'none'
  /** Ambient sound on/off (`0x80`): Buds, Buds+. */
  | 'ambient'
  /** ANC on/off (`0x98`): Buds Live. */
  | 'anc'
  /** Off / ANC / ambient (`0x78`): Buds Pro and everything after. */
  | 'modes';

export type SamsungModelId =
  | 'buds'
  | 'budsPlus'
  | 'budsLive'
  | 'budsPro'
  | 'buds2'
  | 'buds2Pro'
  | 'budsFe'
  | 'budsCore'
  | 'buds3'
  | 'buds3Pro'
  | 'buds3Fe'
  | 'buds4'
  | 'buds4Pro'
  | 'unknown';

export interface SamsungModel {
  id: SamsungModelId;
  name: string;
  /** The part of the SKU string `DEBUG_SKU` returns that names this model (GalaxyBudsClient `FwPattern`). */
  sku: string | null;
  layout: StatusLayout;
  noise: NoiseStyle;
  /** The equaliser, as the five presets plus off. */
  eq: boolean;
  /** A touch-lock the earbuds report and accept. Every model but an unrecognised one. */
  lock: boolean;
  /**
   * `LOCK_TOUCHPAD` takes one byte before this revision and a per-gesture
   * block from it on. `null`: always one byte (Buds, Buds+, Live, Pro).
   */
  advancedLockFrom: number | null;
  /** The per-gesture block grows by the two "for calls" bytes from this revision. */
  lockCallsFrom: number | null;
  /** Revision from which find-my-earbuds can ring an earbud being worn; `null`: it cannot. */
  ringWhileWearingFrom: number | null;
  /** Revision from which `Status` carries charging flags; `null`: never. */
  chargingFrom: number | null;
}

const modern = (id: SamsungModelId, name: string, sku: string, overrides: Partial<SamsungModel> = {}): SamsungModel => ({
  id,
  name,
  sku,
  layout: 'modern',
  noise: 'modes',
  eq: true,
  lock: true,
  advancedLockFrom: 0,
  lockCallsFrom: 0,
  ringWhileWearingFrom: 0,
  chargingFrom: 0,
  ...overrides,
});

export const MODELS: readonly SamsungModel[] = [
  {
    id: 'buds',
    name: 'Galaxy Buds',
    sku: 'R170',
    layout: 'legacy',
    noise: 'ambient',
    eq: true,
    lock: true,
    advancedLockFrom: null,
    lockCallsFrom: null,
    ringWhileWearingFrom: null,
    chargingFrom: null,
  },
  {
    id: 'budsPlus',
    name: 'Galaxy Buds+',
    sku: 'SM-R175',
    layout: 'plus',
    noise: 'ambient',
    eq: true,
    lock: true,
    advancedLockFrom: null,
    lockCallsFrom: null,
    ringWhileWearingFrom: null,
    chargingFrom: null,
  },
  {
    id: 'budsLive',
    name: 'Galaxy Buds Live',
    sku: 'SM-R180',
    layout: 'live',
    noise: 'anc',
    eq: true,
    lock: true,
    advancedLockFrom: null,
    lockCallsFrom: null,
    ringWhileWearingFrom: null,
    chargingFrom: null,
  },
  {
    id: 'budsPro',
    name: 'Galaxy Buds Pro',
    sku: 'SM-R190',
    layout: 'pro',
    noise: 'modes',
    eq: true,
    lock: true,
    advancedLockFrom: null,
    lockCallsFrom: null,
    ringWhileWearingFrom: null,
    chargingFrom: null,
  },
  modern('buds2', 'Galaxy Buds2', 'SM-R177', { advancedLockFrom: 4, lockCallsFrom: 7, ringWhileWearingFrom: 9, chargingFrom: 10 }),
  modern('buds2Pro', 'Galaxy Buds2 Pro', 'SM-R510', { lockCallsFrom: 1, ringWhileWearingFrom: 4, chargingFrom: 11 }),
  modern('budsFe', 'Galaxy Buds FE', 'SM-R400N'),
  modern('budsCore', 'Galaxy Buds Core', 'SM-R410'),
  modern('buds3', 'Galaxy Buds3', 'SM-R530'),
  modern('buds3Pro', 'Galaxy Buds3 Pro', 'SM-R630'),
  modern('buds3Fe', 'Galaxy Buds3 FE', 'SM-R420'),
  modern('buds4', 'Galaxy Buds4', 'SM-R540'),
  modern('buds4Pro', 'Galaxy Buds4 Pro', 'SM-R640'),
];

/**
 * A modern (Buds2-era) pair the SKU table does not name: enough is known about
 * its framing to show battery, wear and find, but not which controls it has,
 * so none are offered.
 */
export const UNKNOWN_MODERN: SamsungModel = {
  id: 'unknown',
  name: 'Galaxy Buds',
  sku: null,
  layout: 'modern',
  noise: 'none',
  eq: false,
  lock: false,
  advancedLockFrom: null,
  lockCallsFrom: null,
  ringWhileWearingFrom: null,
  chargingFrom: null,
};

export const modelById = (id: SamsungModelId | null): SamsungModel | null =>
  MODELS.find((model) => model.id === id) ?? (id === 'unknown' ? UNKNOWN_MODERN : null);

/** The model a SKU string names, or null. */
export function modelForSku(sku: string): SamsungModel | null {
  return MODELS.find((model) => model.sku !== null && sku.includes(model.sku)) ?? null;
}

/** Whether a feature that appeared at `from` is present on a pair reporting `revision`. */
export const atLeast = (from: number | null, revision: number | null): boolean =>
  from !== null && (revision === null || revision >= from);

/** The five built-in equaliser presets, in the order they sit on the wire (wire value is index + 1). */
export const EQ_PRESETS = ['Bass boost', 'Soft', 'Dynamic', 'Clear', 'Treble boost'] as const;
/** `Equalizer`'s value for a custom curve, which can be reported but not selected here. */
export const EQ_CUSTOM = 6;
