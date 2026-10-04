import { describe, expect, it } from 'vitest';

import { FeatureId, decodeAlertVolume, decodeBassLevel, decodeFeatures, encodeBassLevel, encodeQueryFeatures, encodeSetFeature, gameModeIds } from './feature';

describe('feature switches', () => {
  it('asks for a list of ids', () => {
    expect(encodeQueryFeatures([4, 6, 29, 40])).toEqual([4, 4, 6, 29, 40]);
  });

  it('reads id/value pairs after the status and count', () => {
    expect(decodeFeatures(Uint8Array.from([0x00, 2, 0x04, 0x01, 0x06, 0x00]))).toEqual(new Map([[4, true], [6, false]]));
  });

  it('refuses a non-zero status', () => {
    expect(() => decodeFeatures(Uint8Array.from([0x01, 0]))).toThrow();
  });

  it('drops a trailing pair cut short and a count that overruns the data', () => {
    expect(decodeFeatures(Uint8Array.from([0x00, 2, 0x04, 0x01, 0x06]))).toEqual(new Map([[4, true]]));
    expect(decodeFeatures(Uint8Array.from([0x00, 5, 0x04, 0x01]))).toEqual(new Map([[4, true]]));
    expect(decodeFeatures(Uint8Array.from([0x00]))).toEqual(new Map());
  });

  it('writes one id and its state', () => {
    expect(encodeSetFeature(FeatureId.GameMain, true)).toEqual([40, 1]);
  });

  it('uses 40 as the main game-mode switch when the device reports it, and 6 then means low latency', () => {
    expect(gameModeIds(new Map([[40, false], [6, true]]))).toEqual({ main: 40, lowLatency: 6 });
    expect(gameModeIds(new Map([[6, true]]))).toEqual({ main: 6, lowLatency: null });
    expect(gameModeIds(new Map())).toEqual({ main: null, lowLatency: null });
  });
});

describe('BassWave level', () => {
  it('reads a signed range and the level from the device', () => {
    expect(decodeBassLevel(Uint8Array.from([0x00, 0xfb, 0x05, 0x02]))).toEqual({ min: -5, max: 5, level: 2 });
  });

  it('writes the range back with the new level', () => {
    expect(encodeBassLevel({ min: -5, max: 5, level: -1 })).toEqual([0xfb, 0x05, 0xff]);
  });
});

describe('alert volume', () => {
  it('reads the level after the status', () => {
    expect(decodeAlertVolume(Uint8Array.from([0x00, 0x08]))).toBe(8);
  });
});
