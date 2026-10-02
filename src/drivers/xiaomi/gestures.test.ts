import { describe, expect, it } from 'vitest';

import { Tap } from './commands';
import type { GestureRecord } from './commands';
import { ACTION_LABEL, CYCLE_LABEL, CYCLE_MASKS, actionChoices, listedTaps, usesCycle } from './gestures';
import { XIAOMI_VID, modelGates } from './models';

const gatesFor = (pid: number) => modelGates({ vid: XIAOMI_VID, pid, btName: null });
const UNKNOWN = modelGates({ vid: XIAOMI_VID, pid: 0x9999, btName: null });

describe('actionChoices', () => {
  it('offers what the catalog lists for the tap, in its order, leaving out ids nothing names', () => {
    // Redmi Buds 6 Active single tap: [8, 2, 3, 4, 5, 1, 9]; 9 is unnamed.
    expect(actionChoices(Tap.Single, 1, gatesFor(0x5088)).map((choice) => choice.label)).toEqual([
      'None',
      'Previous track',
      'Next track',
      'Volume up',
      'Volume down',
      'Play / pause',
    ]);
  });

  it('keeps an unnamed action the earbuds already hold, so it can be seen', () => {
    const choices = actionChoices(Tap.Single, 9, gatesFor(0x5088));
    expect(choices.at(-1)).toEqual({ action: 9, label: 'Action 9' });
  });

  it('offers voice assistant and noise control on a long press', () => {
    expect(actionChoices(Tap.Long, 0, gatesFor(0x506c)).map((choice) => choice.action)).toEqual([0, 6]);
  });

  it('falls back to Gadgetbridge’s lists for a model the catalog lacks', () => {
    expect(actionChoices(Tap.Double, 1, UNKNOWN).map((choice) => choice.action)).toEqual([1, 2, 3, 4, 5]);
    expect(actionChoices(Tap.Long, 0, UNKNOWN).map((choice) => choice.action)).toEqual([0, 6, 8]);
    expect(actionChoices(Tap.Slide, 11, UNKNOWN).map((choice) => choice.label)).toEqual(['Adjust volume', 'None']);
  });

  it('labels every offered cycle mask', () => {
    for (const mask of CYCLE_MASKS) expect(CYCLE_LABEL[mask]).toBeTruthy();
    expect(ACTION_LABEL[6]).toBe('Noise control');
  });
});

describe('listedTaps', () => {
  const table: GestureRecord[] = [
    { tap: Tap.Slide, left: 11, right: 11 },
    { tap: Tap.Double, left: 1, right: 1 },
    { tap: Tap.Single, left: 8, right: 8 },
    { tap: Tap.Long, left: 6, right: 6 },
  ];

  it('lists the taps in the card’s order whatever order the earbuds sent', () => {
    expect(listedTaps(table, UNKNOWN).map((record) => record.tap)).toEqual([Tap.Single, Tap.Double, Tap.Long, Tap.Slide]);
  });

  it('drops a tap the model’s catalog entry does not offer', () => {
    // The Redmi Buds 5 Pro has no slide; the 8 Pro does.
    expect(listedTaps(table, gatesFor(0x506c)).map((record) => record.tap)).not.toContain(Tap.Slide);
    expect(listedTaps(table, gatesFor(0x50e3)).map((record) => record.tap)).toContain(Tap.Slide);
  });
});

describe('usesCycle', () => {
  it('is true for a long press set to noise control, on a model that cycles', () => {
    expect(usesCycle({ tap: Tap.Long, left: 6, right: 0 }, gatesFor(0x506c))).toBe(true);
    expect(usesCycle({ tap: Tap.Long, left: 0, right: 0 }, gatesFor(0x506c))).toBe(false);
    expect(usesCycle({ tap: Tap.Double, left: 6, right: 6 }, gatesFor(0x506c))).toBe(false);
  });
});
