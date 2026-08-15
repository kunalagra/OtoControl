import { describe, expect, it } from 'vitest';

import {
  EQ_NOTIFICATION,
  EQ_PRESETS,
  decodeEqGains,
  eqBandLabel,
  getEqBand,
  getEqConfig,
  setEqBand,
} from './commands';
import { requestIdFor } from './frame';

const payload = (...bytes: number[]) => Uint8Array.from(bytes);

describe('EQ config', () => {
  it('decodes band count and a symmetric gain range', () => {
    // 5 bands, -6.0 dB to +6.0 dB => -60 and 60 as signed bytes.
    expect(getEqConfig.decode(payload(5, 0xc4, 0x3c))).toEqual({
      bands: 5,
      minGain: -6,
      maxGain: 6,
    });
  });

  it('ignores trailing bytes beyond the three it needs', () => {
    expect(getEqConfig.decode(payload(5, 0xc4, 0x3c, 0x00, 0x01)).bands).toBe(5);
  });

  it('throws rather than reporting a zero-band equaliser', () => {
    expect(() => getEqConfig.decode(payload(5, 0xc4))).toThrow();
  });
});

describe('EQ bands', () => {
  it('decodes a negative gain as a signed byte', () => {
    expect(getEqBand.decode(payload(1, 0xce))).toEqual({ band: 1, gain: -5 });
  });

  it('decodes a positive gain', () => {
    expect(getEqBand.decode(payload(3, 0x1e))).toEqual({ band: 3, gain: 3 });
  });

  it('accepts the M4 shape, a bare gain with no band echo', () => {
    expect(getEqBand.decode(payload(0x1e))).toEqual({ band: null, gain: 3 });
    expect(getEqBand.decode(payload(0xce))).toEqual({ band: null, gain: -5 });
  });

  it('throws only on an empty payload', () => {
    expect(() => getEqBand.decode(payload())).toThrow();
  });

  it('encodes gains in tenths of a dB', () => {
    expect(setEqBand.encode({ band: 0, gain: 3 })).toEqual([0, 30]);
    expect(setEqBand.encode({ band: 2, gain: -5 })).toEqual([2, 0xce]);
    expect(setEqBand.encode({ band: 4, gain: 0 })).toEqual([4, 0]);
  });

  it('round-trips every preset gain through encode and decode', () => {
    for (const { name, gains } of EQ_PRESETS) {
      gains.forEach((gain, band) => {
        const [encodedBand, encodedGain] = setEqBand.encode({ band, gain });
        expect(getEqBand.decode(payload(encodedBand, encodedGain)), name).toEqual({
          band,
          gain,
        });
        // …and through the M4's bare-gain shape.
        expect(getEqBand.decode(payload(encodedGain)).gain, name).toBe(gain);
      });
    }
  });
});

describe('EQ notification', () => {
  it('decodes every band gain from one payload', () => {
    expect(decodeEqGains(payload(0x1e, 0xce, 0x00, 0x0a, 0xf6))).toEqual([3, -5, 0, 1, -1]);
  });

  it('shares a request ID with the single-band response despite a different shape', () => {
    // This collision is why the reducer keys the notification on its exact
    // command rather than on the request ID.
    expect(requestIdFor(EQ_NOTIFICATION)).toBe(getEqBand.id);
    expect(requestIdFor(0x1102)).toBe(getEqBand.id);
  });
});

describe('eqBandLabel', () => {
  it("uses the M4's own band labels, not the ACCENTUM's", () => {
    // reference/m4-app-config.json band_configuration: 63/250/1000/4000/8000.
    expect(eqBandLabel(0, 5)).toBe('63 Hz');
    expect(eqBandLabel(1, 5)).toBe('250 Hz');
    expect(eqBandLabel(2, 5)).toBe('1k Hz');
    expect(eqBandLabel(3, 5)).toBe('4k Hz');
    expect(eqBandLabel(4, 5)).toBe('8k Hz');
  });

  it('falls back to numbered bands for an unexpected layout', () => {
    expect(eqBandLabel(0, 8)).toBe('Band 1');
  });
});

describe('EQ presets', () => {
  it('matches the official M4 curves from the app config', () => {
    const byName = new Map(EQ_PRESETS.map((preset) => [preset.name, preset.gains]));
    expect(byName.get('Rock')).toEqual([0, 2, 2.5, 1.5, -2]);
    expect(byName.get('Pop')).toEqual([0, -2.5, 0, 2.5, 0]);
    expect(byName.get('Jazz')).toEqual([-3.2, 0, 2.2, 2.2, 0]);
    expect(byName.get('Classical')).toEqual([-2, -1.5, 0, 3.5, 4]);
  });

  it('gives every preset one gain per band', () => {
    for (const { name, gains } of EQ_PRESETS) {
      expect(gains, name).toHaveLength(5);
    }
  });

  it('stays within the ±6 dB range the hardware reports', () => {
    for (const { name, gains } of EQ_PRESETS) {
      for (const gain of gains) {
        expect(Math.abs(gain), name).toBeLessThanOrEqual(6);
      }
    }
  });

  it('starts with a flat preset', () => {
    expect(EQ_PRESETS[0]).toEqual({ name: 'Flat', gains: [0, 0, 0, 0, 0] });
  });
});
