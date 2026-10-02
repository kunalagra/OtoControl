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

/** The services a model is reached through — which also tells which family it can be told apart within. */
export type ModelFamily = 'legacy' | 'shared' | 'modern';

/** What a touch-and-hold on an earbud can be set to, by what it does rather than by the byte it is on the wire. */
export type TouchAction = 'assistant' | 'volume' | 'noise' | 'ambient' | 'quickAmbient' | 'anc' | 'spotify' | 'other';

export type TouchMapId = 'legacy' | 'plus' | 'live' | 'standard';

/**
 * Touch-and-hold action bytes, per map (GalaxyBudsClient `Model/Specifications/Touch/*`).
 * Read back from `ExtendedStatus` on seven real captures, one per model —
 * Volume as 2 (Buds), Ambient as 2 (Buds+), ANC as 2 (Live), "switch noise
 * control" as 2 (Pro, Buds2, Buds2 Pro), Volume as 3 (FE); see `fixtures.test.ts`.
 */
export const TOUCH_MAPS: Record<TouchMapId, Readonly<Record<number, TouchAction>>> = {
  legacy: { 0: 'assistant', 1: 'quickAmbient', 2: 'volume', 3: 'ambient', 4: 'spotify', 5: 'other', 6: 'other' },
  plus: { 1: 'assistant', 2: 'ambient', 3: 'volume', 4: 'spotify', 5: 'other', 6: 'other' },
  live: { 1: 'assistant', 2: 'anc', 3: 'volume', 4: 'spotify', 5: 'other', 6: 'other' },
  standard: { 1: 'assistant', 2: 'noise', 3: 'volume', 4: 'spotify', 5: 'other', 6: 'other' },
};

export const TOUCH_ACTION_LABEL: Record<TouchAction, string> = {
  assistant: 'Voice assistant',
  volume: 'Volume',
  noise: 'Switch noise control',
  ambient: 'Ambient sound',
  quickAmbient: 'Quick ambient sound',
  anc: 'Noise cancelling',
  spotify: 'Spotify',
  other: 'Another app',
};

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
  family: ModelFamily;
  /**
   * `ExtendedStatus[1]`, which GalaxyBudsClient calls `EarType` and treats as unused.
   * Seven captures show it differs per model within a service — Buds+ 0, Live 1,
   * Pro 2 on standard SPP; Buds2 3, Buds2 Pro 4, FE 6, Buds3 Pro 8 on the custom
   * one — so it identifies a model when the SKU read does not. `null`: not seen.
   */
  earType: number | null;
  noise: NoiseStyle;
  /** The modes `NoiseControls` accepts, for the `modes` style (MagicPodsCore `GalaxyBudsAncWatcher.cpp`). */
  noiseModes: readonly number[];
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
  /** The ambient-sound step count's top value (steps are 0..max), or null when there is no ambient level. */
  ambientMax: number | null;
  /** Which touch-and-hold byte map this model uses, or null if none is offered. */
  touchMap: TouchMapId | null;
  /** The hold actions offered, in order — a subset of what the map can express. */
  holdActions: readonly TouchAction[];
  /** Zero bytes after `[left, right]` in the hold-action write (the Buds4 plugin sends `[L, R, L_DA, R_DA]`). */
  holdWritePad: number;
  /**
   * Which two noise modes a long press cycles through can be chosen, as in the
   * classic bit layout of `ExtendedStatus[21]` (verified on four captures), and
   * from which revision the left earbud has a choice of its own. `null`: not offered.
   */
  noiseCycle: { dualSideFrom: number | null } | null;
}

/** What every model starts from; each entry overrides what it differs in. */
const model = (fields: Pick<SamsungModel, 'id' | 'name' | 'sku' | 'layout' | 'family'> & Partial<SamsungModel>): SamsungModel => ({
  earType: null,
  noise: 'modes',
  noiseModes: [0, 1, 2],
  eq: true,
  lock: true,
  advancedLockFrom: null,
  lockCallsFrom: null,
  ringWhileWearingFrom: null,
  chargingFrom: null,
  ambientMax: 2,
  touchMap: 'standard',
  holdActions: ['assistant', 'noise', 'volume'],
  holdWritePad: 0,
  noiseCycle: null,
  ...fields,
});

/** Buds2 and later: the custom service, the `modern` layout, and the per-gesture lock block throughout. */
const modern = (id: SamsungModelId, name: string, sku: string, overrides: Partial<SamsungModel> = {}): SamsungModel =>
  model({
    id,
    name,
    sku,
    layout: 'modern',
    family: 'modern',
    advancedLockFrom: 0,
    lockCallsFrom: 0,
    ringWhileWearingFrom: 0,
    chargingFrom: 0,
    noiseCycle: { dualSideFrom: 0 },
    ...overrides,
  });

/** What the Buds3 generation and later add beyond ANC: an adaptive mode (MagicPodsCore `GetAncModesFor`). */
const WITH_ADAPTIVE = [0, 1, 2, 3] as const;

export const MODELS: readonly SamsungModel[] = [
  model({
    id: 'buds',
    name: 'Galaxy Buds',
    sku: 'R170',
    layout: 'legacy',
    family: 'legacy',
    earType: 0,
    noise: 'ambient',
    ambientMax: 4,
    touchMap: 'legacy',
    holdActions: ['assistant', 'quickAmbient', 'volume', 'ambient'],
  }),
  model({
    id: 'budsPlus',
    name: 'Galaxy Buds+',
    sku: 'SM-R175',
    layout: 'plus',
    family: 'shared',
    earType: 0,
    noise: 'ambient',
    touchMap: 'plus',
    holdActions: ['assistant', 'ambient', 'volume'],
  }),
  model({
    id: 'budsLive',
    name: 'Galaxy Buds Live',
    sku: 'SM-R180',
    layout: 'live',
    family: 'shared',
    earType: 1,
    noise: 'anc',
    ambientMax: null,
    touchMap: 'live',
    holdActions: ['assistant', 'anc', 'volume'],
  }),
  model({
    id: 'budsPro',
    name: 'Galaxy Buds Pro',
    sku: 'SM-R190',
    layout: 'pro',
    family: 'shared',
    earType: 2,
    ambientMax: 3,
    noiseCycle: { dualSideFrom: 8 },
  }),
  modern('buds2', 'Galaxy Buds2', 'SM-R177', {
    earType: 3,
    advancedLockFrom: 4,
    lockCallsFrom: 7,
    ringWhileWearingFrom: 9,
    chargingFrom: 10,
    noiseCycle: { dualSideFrom: 5 },
  }),
  modern('buds2Pro', 'Galaxy Buds2 Pro', 'SM-R510', { earType: 4, lockCallsFrom: 1, ringWhileWearingFrom: 4, chargingFrom: 11 }),
  modern('budsFe', 'Galaxy Buds FE', 'SM-R400N', { earType: 6 }),
  modern('budsCore', 'Galaxy Buds Core', 'SM-R410'),
  // Buds3 and later: no classic noise-cycle layout (`[21]` is read differently, unverified), so none is offered.
  modern('buds3', 'Galaxy Buds3', 'SM-R530', { noiseModes: [0, 1], ambientMax: null, noiseCycle: null }),
  modern('buds3Pro', 'Galaxy Buds3 Pro', 'SM-R630', { earType: 8, noiseModes: WITH_ADAPTIVE, ambientMax: 4, noiseCycle: null }),
  modern('buds3Fe', 'Galaxy Buds3 FE', 'SM-R420', { noiseCycle: null }),
  // The Buds4 plugin numbers hold actions differently (volume is 6, digital assistant 3), so only the two that agree are offered.
  modern('buds4', 'Galaxy Buds4', 'SM-R540', {
    noiseModes: WITH_ADAPTIVE,
    noiseCycle: null,
    holdActions: ['assistant', 'noise'],
    holdWritePad: 2,
  }),
  modern('buds4Pro', 'Galaxy Buds4 Pro', 'SM-R640', {
    noiseModes: WITH_ADAPTIVE,
    ambientMax: 4,
    noiseCycle: null,
    holdActions: ['assistant', 'noise'],
    holdWritePad: 2,
  }),
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
  family: 'modern',
  earType: null,
  noise: 'none',
  noiseModes: [],
  eq: false,
  lock: false,
  advancedLockFrom: null,
  lockCallsFrom: null,
  ringWhileWearingFrom: null,
  chargingFrom: null,
  ambientMax: null,
  touchMap: null,
  holdActions: [],
  holdWritePad: 0,
  noiseCycle: null,
};

export const modelById = (id: SamsungModelId | null): SamsungModel | null =>
  MODELS.find((model) => model.id === id) ?? (id === 'unknown' ? UNKNOWN_MODERN : null);

/**
 * The model `ExtendedStatus[1]` names within a family, or null. Only the pairs
 * seen in captures are in the table — see `SamsungModel.earType`.
 */
export const modelForEarType = (family: ModelFamily, earType: number): SamsungModel | null =>
  MODELS.find((entry) => entry.family === family && entry.earType === earType) ?? null;

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
