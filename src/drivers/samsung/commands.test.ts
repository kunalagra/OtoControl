import { describe, expect, it } from 'vitest';

import { NoiseMode, equalizerCommand, findCommand, managerInfoCommand, noiseCommand, touchLockCommand } from './commands';
import type { TouchGestures } from './decode';
import { MsgId } from './ids';
import { modelById } from './models';

const model = (id: Parameters<typeof modelById>[0]) => modelById(id)!;

describe('noiseCommand', () => {
  it('sends the mode byte on NoiseControls for Buds Pro and later', () => {
    expect(noiseCommand(model('buds2Pro'), NoiseMode.Anc)).toEqual({ id: 0x78, payload: [1] });
    expect(noiseCommand(model('budsPro'), NoiseMode.Ambient)).toEqual({ id: 0x78, payload: [2] });
    expect(noiseCommand(model('buds3'), NoiseMode.Off)).toEqual({ id: 0x78, payload: [0] });
  });

  it("uses Buds Live's ANC switch and refuses ambient, which it has none of", () => {
    expect(noiseCommand(model('budsLive'), NoiseMode.Anc)).toEqual({ id: 0x98, payload: [1] });
    expect(noiseCommand(model('budsLive'), NoiseMode.Off)).toEqual({ id: 0x98, payload: [0] });
    expect(noiseCommand(model('budsLive'), NoiseMode.Ambient)).toBeNull();
  });

  it("uses the ambient switch on Buds+ and the 2019 Buds and refuses ANC", () => {
    expect(noiseCommand(model('budsPlus'), NoiseMode.Ambient)).toEqual({ id: 0x80, payload: [1] });
    expect(noiseCommand(model('buds'), NoiseMode.Off)).toEqual({ id: 0x80, payload: [0] });
    expect(noiseCommand(model('budsPlus'), NoiseMode.Anc)).toBeNull();
  });

  it('sends nothing for a model it does not know', () => {
    expect(noiseCommand(model('unknown'), NoiseMode.Anc)).toBeNull();
  });
});

describe('equalizerCommand', () => {
  it('is the preset number itself, 0 being off', () => {
    expect(equalizerCommand(model('buds2'), 0)).toEqual({ id: 0x86, payload: [0] });
    expect(equalizerCommand(model('budsPro'), 3)).toEqual({ id: 0x86, payload: [3] });
  });

  it('is an enabled flag and a preset five higher on the 2019 Buds', () => {
    expect(equalizerCommand(model('buds'), 1)).toEqual({ id: 0x86, payload: [1, 5] });
    expect(equalizerCommand(model('buds'), 5)).toEqual({ id: 0x86, payload: [1, 9] });
    expect(equalizerCommand(model('buds'), 0).payload[0]).toBe(0);
  });
});

describe('touchLockCommand', () => {
  const gestures: TouchGestures = { single: true, double: false, triple: true, hold: false, doubleForCalls: true, holdForCalls: false };

  it('is one byte on the older models: 1 locks', () => {
    expect(touchLockCommand(model('budsPlus'), true, null, null)).toEqual({ id: 0x90, payload: [1] });
    expect(touchLockCommand(model('budsPro'), false, null, 5)).toEqual({ id: 0x90, payload: [0] });
  });

  it('restates every gesture on Buds2-era models, with byte 0 meaning touch enabled', () => {
    expect(touchLockCommand(model('buds3Pro'), true, gestures, 3).payload).toEqual([0, 1, 0, 1, 0, 1, 0]);
    expect(touchLockCommand(model('buds3Pro'), false, gestures, 3).payload[0]).toBe(1);
  });

  it('keeps every gesture on when none have been reported yet', () => {
    expect(touchLockCommand(model('buds4'), true, null, 1).payload).toEqual([0, 1, 1, 1, 1, 1, 1]);
  });

  it('falls back to one byte on a Buds2 older than revision 4, and drops the call bytes before revision 7', () => {
    expect(touchLockCommand(model('buds2'), true, gestures, 3).payload).toEqual([1]);
    expect(touchLockCommand(model('buds2'), true, gestures, 5).payload).toHaveLength(5);
    expect(touchLockCommand(model('buds2'), true, gestures, 7).payload).toHaveLength(7);
  });
});

describe('findCommand', () => {
  it('stops with 0xA1 whatever the model', () => {
    expect(findCommand(model('buds3'), 1, false)).toEqual({ id: MsgId.FindStop, payload: [] });
  });

  it('starts with 0xA6 where an earbud can ring while worn, 0xA0 where not', () => {
    expect(findCommand(model('buds3'), 1, true).id).toBe(0xa6);
    expect(findCommand(model('buds2'), 8, true).id).toBe(0xa0);
    expect(findCommand(model('buds2'), 9, true).id).toBe(0xa6);
    expect(findCommand(model('budsPlus'), null, true).id).toBe(0xa0);
  });
});

describe('managerInfoCommand', () => {
  it('is [client type, not-a-Samsung-phone, SDK]', () => {
    expect(managerInfoCommand()).toEqual({ id: 0x88, payload: [1, 2, 34] });
  });
});
