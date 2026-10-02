import { describe, expect, it } from 'vitest';

import { decodeAck, decodeExtended, decodeSku, decodeStatus, decodeVersion } from './decode';
import { MODELS, UNKNOWN_MODERN, modelById } from './models';

const model = (id: Parameters<typeof modelById>[0]) => modelById(id)!;
const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

describe('decodeStatus', () => {
  it('reads battery, placement and the case from a Buds2 Pro status', () => {
    // [revision, L, R, coupled, main, placement, case, charging]
    const update = decodeStatus(bytes(11, 80, 75, 1, 1, 0x12, 60, 0x10), model('buds2Pro'), null)!;
    expect(update.revision).toBe(11);
    expect(update.battery).toEqual({ left: 80, right: 75, case: 60 });
    expect(update.placement).toEqual({ left: 'wearing', right: 'idle' });
    expect(update.charging).toEqual({ left: true, right: false, case: false });
  });

  it('maps every placement nibble', () => {
    const placements = [0x00, 0x34, 0x40].map((byte) => decodeStatus(bytes(1, 1, 1, 1, 1, byte, 1), model('buds3'), null)!.placement);
    expect(placements).toEqual([
      { left: 'disconnected', right: 'disconnected' },
      { left: 'case', right: 'closedCase' },
      { left: 'closedCase', right: 'disconnected' },
    ]);
  });

  it('treats a battery of 101 or more as unknown', () => {
    const update = decodeStatus(bytes(1, 101, 255, 1, 1, 0x11, 101), model('buds3'), null)!;
    expect(update.battery).toEqual({ left: null, right: null, case: null });
  });

  it('reads no charging flags when the model or revision has none', () => {
    expect(decodeStatus(bytes(1, 50, 50, 1, 1, 0x11, 50, 0x11), model('budsPlus'), null)!.charging).toBeNull();
    // Buds2 sends them from revision 10; this one reports 9.
    expect(decodeStatus(bytes(9, 50, 50, 1, 1, 0x11, 50, 0x11), model('buds2'), null)!.charging).toBeNull();
    expect(decodeStatus(bytes(10, 50, 50, 1, 1, 0x11, 50, 0x11), model('buds2'), null)!.charging).not.toBeNull();
  });

  it('stops at the end of a short buffer instead of reading past it', () => {
    const update = decodeStatus(bytes(1, 50, 50, 1, 1, 0x11), model('buds3'), null)!;
    expect(update.battery.case).toBeNull();
    expect(update.charging).toBeNull();
    expect(decodeStatus(bytes(1, 50), model('buds3'), null)).toBeNull();
  });

  it('reads the 2019 Buds layout: earType first, then a wear byte (0x10 left, 0x01 right)', () => {
    const update = decodeStatus(bytes(0, 90, 40, 1, 0, 0x11), model('buds'), null)!;
    expect(update.battery).toEqual({ left: 90, right: 40, case: null });
    expect(update.placement).toEqual({ left: 'wearing', right: 'wearing' });
    expect(decodeStatus(bytes(0, 90, 40, 1, 0, 0x01), model('buds'), null)!.placement).toEqual({ left: 'idle', right: 'wearing' });
  });
});

/** An extended-status payload of `length` bytes with the given indices set. */
const extended = (length: number, values: Record<number, number>): Uint8Array => {
  const payload = new Uint8Array(length);
  for (const [index, value] of Object.entries(values)) payload[Number(index)] = value;
  return payload;
};

describe('decodeExtended', () => {
  it('reads a Buds2-era block: battery, placement, EQ, touch lock bits, noise mode', () => {
    const payload = extended(40, { 0: 11, 2: 70, 3: 71, 6: 0x11, 7: 55, 9: 3, 10: 0x8f, 12: 1 });
    const update = decodeExtended(payload, model('buds2Pro'))!;
    expect(update).toMatchObject({
      revision: 11,
      battery: { left: 70, right: 71, case: 55 },
      placement: { left: 'wearing', right: 'wearing' },
      eq: 3,
      touchLocked: false,
      noiseMode: 1,
    });
    expect(update.gestures).toEqual({ hold: true, triple: true, double: true, single: true, doubleForCalls: false, holdForCalls: false });
  });

  it('reads touch-locked from bit 7 of the lock byte being clear', () => {
    expect(decodeExtended(extended(30, { 10: 0x0f }), model('buds3'))!.touchLocked).toBe(true);
    expect(decodeExtended(extended(30, { 10: 0x8f }), model('buds3'))!.touchLocked).toBe(false);
  });

  it('reads the lock call-gesture bits', () => {
    const update = decodeExtended(extended(30, { 10: 0xb0 }), model('buds3'))!;
    expect(update.gestures).toMatchObject({ doubleForCalls: true, holdForCalls: true, hold: false });
  });

  it('reads a Buds Pro block with a plain lock byte and the same mode offset', () => {
    const update = decodeExtended(extended(35, { 0: 5, 2: 40, 3: 41, 6: 0x22, 7: 9, 9: 2, 10: 1, 12: 2 }), model('budsPro'))!;
    expect(update).toMatchObject({ eq: 2, touchLocked: true, noiseMode: 2, placement: { left: 'idle', right: 'idle' } });
    expect(update.gestures).toBeNull();
  });

  it('reads Buds Live ANC as a flag, not a mode', () => {
    expect(decodeExtended(extended(30, { 12: 1 }), model('budsLive'))!.noiseMode).toBe(1);
    expect(decodeExtended(extended(30, { 12: 0 }), model('budsLive'))!.noiseMode).toBe(0);
  });

  it('reads the Buds+ block, whose EQ and lock sit later and whose "noise" is ambient on/off', () => {
    const update = decodeExtended(extended(24, { 0: 13, 2: 60, 3: 61, 6: 0x11, 7: 50, 8: 1, 11: 4, 12: 1 }), model('budsPlus'))!;
    expect(update).toMatchObject({ eq: 4, touchLocked: true, noiseMode: 2, battery: { left: 60, right: 61, case: 50 } });
  });

  it('reads the 2019 Buds block: enabled flag plus a mode that repeats every five', () => {
    const update = decodeExtended(extended(16, { 0: 3, 2: 80, 3: 81, 6: 0x11, 7: 1, 10: 1, 11: 8, 12: 0 }), model('buds'))!;
    expect(update).toMatchObject({ eq: 4, noiseMode: 2, touchLocked: false, placement: { left: 'wearing', right: 'wearing' } });
    expect(decodeExtended(extended(16, { 10: 0, 11: 3 }), model('buds'))!.eq).toBe(0);
  });

  it('leaves fields it cannot reach as null on a short buffer', () => {
    const update = decodeExtended(extended(10, { 0: 1, 2: 50, 3: 50, 6: 0x11, 9: 2 }), model('buds3'))!;
    expect(update.eq).toBe(2);
    expect(update.touchLocked).toBeNull();
    expect(update.noiseMode).toBeNull();
  });

  it('reports no noise mode for a model it does not know how to read', () => {
    expect(decodeExtended(extended(30, { 12: 2 }), UNKNOWN_MODERN)!.noiseMode).toBeNull();
  });

  it('rejects a payload too short to hold the battery prefix', () => {
    expect(decodeExtended(bytes(1, 2, 3), model('buds3'))).toBeNull();
  });
});

describe('decodeSku', () => {
  const pad = (text: string): number[] => [...text.padEnd(14, '\0')].map((c) => c.charCodeAt(0));

  it('reads two 14-byte strings', () => {
    expect(decodeSku(Uint8Array.from([...pad('SM-R510NZKAEUA'), ...pad('SM-R510NZKAEUA')]))).toEqual({
      left: 'SM-R510NZKAEUA',
      right: 'SM-R510NZKAEUA',
    });
  });

  it('strips padding, and yields empty strings for the zero-data Buds+ sends', () => {
    expect(decodeSku(Uint8Array.from([...pad('SM-R177'), ...pad('')]))).toEqual({ left: 'SM-R177', right: '' });
    expect(decodeSku(new Uint8Array(28))).toEqual({ left: '', right: '' });
    expect(decodeSku(new Uint8Array(0))).toEqual({ left: '', right: '' });
  });
});

describe('model table', () => {
  it('names every model by a distinct SKU pattern', () => {
    const patterns = MODELS.map((entry) => entry.sku);
    expect(new Set(patterns).size).toBe(patterns.length);
  });
});

describe('decodeVersion', () => {
  it('assembles the vendor build id from the date-coded bytes', () => {
    // hw 0x12, sw left: variant 0 (E), year index 3 (R), month index 5 (F), release 4.
    const payload = bytes(0x12, 0x12, 0, 0x35, 4, 1, 0x35, 4, 0xa, 0xb);
    expect(decodeVersion(payload, model('buds2Pro'))).toEqual({
      hardware: 'rev1.2',
      left: 'R510XXE0ARF4',
      right: 'R510XXU0ARF4',
    });
  });

  it('gives null rather than a made-up id when a byte is out of the date tables', () => {
    const payload = bytes(0, 0, 0, 0xff, 0, 0, 0x00, 0, 0, 0);
    expect(decodeVersion(payload, model('buds3'))!.left).toBeNull();
  });

  it('rejects a payload too short to hold a version', () => {
    expect(decodeVersion(bytes(1, 2, 3), model('buds3'))).toBeNull();
  });
});

describe('decodeAck', () => {
  it('splits the echoed request id from the rest', () => {
    expect(decodeAck(bytes(0x78, 1))).toEqual({ id: 0x78, rest: bytes(1) });
    expect(decodeAck(new Uint8Array(0))).toBeNull();
  });
});
