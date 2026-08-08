import { describe, expect, it } from 'vitest';

import {
  SWEEP_DEGREES,
  arcPath,
  fractionToValue,
  keyboardValue,
  polar,
  pointerToValue,
  valueToAngle,
  valueToFraction,
} from './knobGeometry';

const range = { min: 0, max: 100 };

describe('value and fraction', () => {
  it('maps the ends and the midpoint', () => {
    expect(valueToFraction(0, range)).toBe(0);
    expect(valueToFraction(50, range)).toBe(0.5);
    expect(valueToFraction(100, range)).toBe(1);
  });

  it('clamps out-of-range values instead of extrapolating', () => {
    expect(valueToFraction(-20, range)).toBe(0);
    expect(valueToFraction(180, range)).toBe(1);
  });

  it('handles a zero-width range without dividing by zero', () => {
    expect(valueToFraction(5, { min: 5, max: 5 })).toBe(0);
  });

  it('round-trips through fractionToValue', () => {
    for (const value of [0, 12, 50, 87, 100]) {
      expect(fractionToValue(valueToFraction(value, range), range)).toBeCloseTo(value, 6);
    }
  });

  it('works for a signed range like EQ gain', () => {
    const gain = { min: -6, max: 6 };
    expect(valueToFraction(0, gain)).toBe(0.5);
    expect(fractionToValue(0, gain)).toBe(-6);
    expect(fractionToValue(1, gain)).toBe(6);
  });
});

describe('valueToAngle', () => {
  it('puts the midpoint straight up', () => {
    expect(valueToAngle(50, range)).toBe(0);
  });

  it('spreads the ends symmetrically around vertical', () => {
    expect(valueToAngle(0, range)).toBe(-SWEEP_DEGREES / 2);
    expect(valueToAngle(100, range)).toBe(SWEEP_DEGREES / 2);
  });
});

describe('polar', () => {
  it('places 0° at the top', () => {
    const point = polar(0, 10);
    expect(point.x).toBeCloseTo(0, 6);
    expect(point.y).toBeCloseTo(-10, 6);
  });

  it('places 90° to the right', () => {
    const point = polar(90, 10);
    expect(point.x).toBeCloseTo(10, 6);
    expect(point.y).toBeCloseTo(0, 6);
  });
});

describe('pointerToValue', () => {
  it('reads straight up as the midpoint', () => {
    expect(pointerToValue(0, -10, range)).toBeCloseTo(50, 6);
  });

  it('reads right as three quarters and left as one quarter', () => {
    expect(pointerToValue(10, 0, range)).toBeCloseTo(83.333, 3);
    expect(pointerToValue(-10, 0, range)).toBeCloseTo(16.667, 3);
  });

  it('snaps the dead zone to the nearer end rather than wrapping', () => {
    // Just past the lower-left end of the arc.
    expect(pointerToValue(-1, 10, range)).toBe(range.min);
    // Just past the lower-right end.
    expect(pointerToValue(1, 10, range)).toBe(range.max);
  });

  it('never returns a value outside the range', () => {
    for (let degrees = 0; degrees < 360; degrees += 7) {
      const radians = (degrees * Math.PI) / 180;
      const value = pointerToValue(Math.sin(radians), -Math.cos(radians), range);
      expect(value).toBeGreaterThanOrEqual(range.min);
      expect(value).toBeLessThanOrEqual(range.max);
    }
  });

  it('agrees with valueToAngle, so the thumb lands under the pointer', () => {
    for (const value of [5, 25, 50, 75, 95]) {
      const angle = valueToAngle(value, range);
      const { x, y } = polar(angle, 40);
      expect(pointerToValue(x, y, range)).toBeCloseTo(value, 4);
    }
  });
});

/** `M x y A rx ry rot largeArc sweep x y` — parsed by name, not by position. */
function parseArc(path: string) {
  const match = path.match(
    /^M (-?[\d.]+) (-?[\d.]+) A ([\d.]+) ([\d.]+) 0 ([01]) ([01]) (-?[\d.]+) (-?[\d.]+)$/,
  );
  if (!match) throw new Error(`unparseable arc path: ${path}`);
  return {
    start: { x: Number(match[1]), y: Number(match[2]) },
    radius: Number(match[3]),
    largeArc: match[5],
    sweep: match[6],
    end: { x: Number(match[7]), y: Number(match[8]) },
  };
}

describe('arcPath', () => {
  it('starts at the from-value and ends at the to-value', () => {
    const arc = parseArc(arcPath(0, 100, 40, range));
    expect(arc.radius).toBe(40);
    expect(arc.start).toEqual({
      x: Number(polar(valueToAngle(0, range), 40).x.toFixed(3)),
      y: Number(polar(valueToAngle(0, range), 40).y.toFixed(3)),
    });
    expect(arc.end).toEqual({
      x: Number(polar(valueToAngle(100, range), 40).x.toFixed(3)),
      y: Number(polar(valueToAngle(100, range), 40).y.toFixed(3)),
    });
  });

  it('sets the large-arc flag only past a half turn', () => {
    expect(parseArc(arcPath(50, 60, 40, range)).largeArc).toBe('0');
    expect(parseArc(arcPath(0, 100, 40, range)).largeArc).toBe('1');
  });

  it('reverses the sweep flag when drawing backwards', () => {
    expect(parseArc(arcPath(20, 80, 40, range)).sweep).toBe('1');
    expect(parseArc(arcPath(80, 20, 40, range)).sweep).toBe('0');
  });
});

describe('keyboardValue', () => {
  it('steps up and down with the arrow keys', () => {
    expect(keyboardValue('ArrowUp', 50, range)).toBe(51);
    expect(keyboardValue('ArrowRight', 50, range)).toBe(51);
    expect(keyboardValue('ArrowDown', 50, range)).toBe(49);
    expect(keyboardValue('ArrowLeft', 50, range)).toBe(49);
  });

  it('jumps with Page keys and saturates with Home and End', () => {
    expect(keyboardValue('PageUp', 50, range)).toBe(55);
    expect(keyboardValue('PageDown', 50, range)).toBe(45);
    expect(keyboardValue('Home', 50, range)).toBe(0);
    expect(keyboardValue('End', 50, range)).toBe(100);
  });

  it('holds at the ends instead of overshooting', () => {
    expect(keyboardValue('ArrowUp', 100, range)).toBe(100);
    expect(keyboardValue('ArrowDown', 0, range)).toBe(0);
    expect(keyboardValue('PageUp', 98, range)).toBe(100);
  });

  it('returns null for keys it does not handle, so they still bubble', () => {
    expect(keyboardValue('Tab', 50, range)).toBeNull();
    expect(keyboardValue('a', 50, range)).toBeNull();
  });

  it('uses the given step size', () => {
    expect(keyboardValue('ArrowUp', 0, { min: -6, max: 6 }, { step: 0.5 })).toBe(0.5);
  });
});
