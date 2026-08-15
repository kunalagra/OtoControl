import { describe, expect, it } from 'vitest';

import { NEUTRAL_LEVEL, describeLevel, noiseReadout } from './noiseLevel';

describe('noiseReadout', () => {
  it('reports neutral with no percentage', () => {
    expect(noiseReadout(NEUTRAL_LEVEL)).toEqual({
      kind: 'neutral',
      label: 'Neutral',
      percent: 0,
    });
  });

  it('reports the low end as cancelling', () => {
    expect(noiseReadout(0)).toEqual({ kind: 'cancelling', label: 'Cancelling', percent: 100 });
    expect(noiseReadout(25)).toMatchObject({ kind: 'cancelling', percent: 50 });
  });

  it('reports the high end as transparency', () => {
    expect(noiseReadout(100)).toEqual({
      kind: 'transparency',
      label: 'Transparency',
      percent: 100,
    });
    expect(noiseReadout(75)).toMatchObject({ kind: 'transparency', percent: 50 });
  });

  it('never produces a negative percentage', () => {
    for (let value = 0; value <= 100; value += 1) {
      expect(noiseReadout(value).percent).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('describeLevel', () => {
  it('labels the centre detent', () => {
    expect(describeLevel(NEUTRAL_LEVEL)).toBe('Neutral');
  });

  it('labels the low end as cancelling, matching the left of the slider', () => {
    expect(describeLevel(0)).toBe('Cancelling 100%');
    expect(describeLevel(25)).toBe('Cancelling 50%');
  });

  it('labels the high end as transparency', () => {
    expect(describeLevel(100)).toBe('Transparency 100%');
    expect(describeLevel(75)).toBe('Transparency 50%');
  });
});
