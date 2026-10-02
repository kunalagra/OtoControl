/**
 * Gesture options: what each tap is called, which actions a model offers on it,
 * and the long-press noise-control cycle. Action ids and names are Gadgetbridge's
 * `RedmiBudsGestureAction` / `RedmiBudsLongGestureAction` / `RedmiBudsAmbientSoundCycle`
 * plus the slide-to-adjust-volume id (11) both the vendor catalog and a capture show.
 * The catalog lists a few ids no source names (9, 10, 13); those are not offered, but one
 * a model already holds is shown rather than hidden.
 */

import { Tap } from './commands';
import type { GestureRecord } from './commands';
import type { ModelGates } from './models';

export const TAP_LABEL: Record<number, string> = {
  [Tap.Single]: 'Single tap',
  [Tap.Double]: 'Double tap',
  [Tap.Triple]: 'Triple tap',
  [Tap.Long]: 'Press and hold',
  [Tap.Slide]: 'Slide',
};

/** The order the card lists taps in. */
export const TAP_ORDER: readonly number[] = [Tap.Single, Tap.Double, Tap.Triple, Tap.Long, Tap.Slide];

export const ACTION_LABEL: Record<number, string> = {
  0: 'Voice assistant',
  1: 'Play / pause',
  2: 'Previous track',
  3: 'Next track',
  4: 'Volume up',
  5: 'Volume down',
  6: 'Noise control',
  8: 'None',
  11: 'Adjust volume',
};

/** Long-press cycle masks: bit 0 off, bit 1 noise cancelling, bit 2 transparency (Gadgetbridge `RedmiBudsAmbientSoundCycle`). */
export const CYCLE_LABEL: Record<number, string> = {
  3: 'Noise cancelling and off',
  5: 'Transparency and off',
  6: 'Noise cancelling and transparency',
  7: 'All three',
};

export const CYCLE_MASKS: readonly number[] = [3, 5, 6, 7];

/** What a model of unknown catalog entry is offered on each tap: Gadgetbridge's lists. */
const FALLBACK: Record<number, number[]> = {
  [Tap.Single]: [8, 1, 2, 3, 4, 5],
  [Tap.Double]: [1, 2, 3, 4, 5],
  [Tap.Triple]: [1, 2, 3, 4, 5],
  [Tap.Long]: [0, 6, 8],
  [Tap.Slide]: [11, 8],
};

export interface ActionChoice {
  action: number;
  label: string;
}

/** The actions to offer on `tap` for a side currently set to `current`. */
export function actionChoices(tap: number, current: number, gates: ModelGates): ActionChoice[] {
  const offered = (gates.taps?.get(tap) ?? FALLBACK[tap] ?? []).filter((action) => action in ACTION_LABEL);
  const ids = offered.includes(current) ? offered : [...offered, current];
  return ids.map((action) => ({ action, label: ACTION_LABEL[action] ?? `Action ${action}` }));
}

/** Which taps to list: those the earbuds reported, narrowed to those the model offers when the catalog knows it. */
export function listedTaps(gestures: readonly GestureRecord[], gates: ModelGates): GestureRecord[] {
  return TAP_ORDER.flatMap((tap) => {
    const record = gestures.find((entry) => entry.tap === tap);
    if (!record) return [];
    if (gates.taps !== null && !gates.taps.has(tap)) return [];
    return [record];
  });
}

/** Whether a gesture row should carry the cycle picker: noise control is its action on either side. */
export const usesCycle = (record: GestureRecord, gates: ModelGates): boolean =>
  record.tap === Tap.Long && gates.longPressCycle && (record.left === 6 || record.right === 6);
