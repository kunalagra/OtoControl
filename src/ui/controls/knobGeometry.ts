/**
 * Pure geometry for the radial knob. Kept apart from the component so the
 * fiddly angle maths can be tested without a DOM.
 *
 * The knob sweeps an arc with a gap at the bottom, like a hardware control:
 * the minimum sits at the lower left, the maximum at the lower right, and
 * straight up is the midpoint.
 */

/** Total sweep, centred on 12 o'clock. 270° leaves a 90° gap at the bottom. */
export const SWEEP_DEGREES = 270;
const START_ANGLE = -SWEEP_DEGREES / 2;

export interface Range {
  min: number;
  max: number;
}

const clamp = (value: number, { min, max }: Range): number =>
  Math.max(min, Math.min(max, value));

/** 0 at the minimum, 1 at the maximum. */
export function valueToFraction(value: number, range: Range): number {
  const span = range.max - range.min;
  if (span === 0) return 0;
  return (clamp(value, range) - range.min) / span;
}

export function fractionToValue(fraction: number, range: Range): number {
  const bounded = Math.max(0, Math.min(1, fraction));
  return range.min + bounded * (range.max - range.min);
}

/** Degrees clockwise from 12 o'clock; negative is anticlockwise. */
export function valueToAngle(value: number, range: Range): number {
  return START_ANGLE + valueToFraction(value, range) * SWEEP_DEGREES;
}

/**
 * Where a pointer lands, as a value.
 *
 * Angles inside the dead zone at the bottom snap to whichever end is nearer,
 * so dragging past an extreme does not wrap around to the other one.
 */
export function pointerToValue(
  dx: number,
  dy: number,
  range: Range,
): number {
  // atan2 measured from 12 o'clock, clockwise positive, always in [-180, 180].
  // That range never wraps, so the dead zone is simply "past either end".
  const degrees = (Math.atan2(dx, -dy) * 180) / Math.PI;

  if (degrees < START_ANGLE) return range.min;
  if (degrees > -START_ANGLE) return range.max;

  return fractionToValue((degrees - START_ANGLE) / SWEEP_DEGREES, range);
}

export interface Point {
  x: number;
  y: number;
}

/** A point on the arc, for drawing. Origin is the knob centre. */
export function polar(angleDegrees: number, radius: number): Point {
  const radians = ((angleDegrees - 90) * Math.PI) / 180;
  return {
    x: radius * Math.cos(radians),
    y: radius * Math.sin(radians),
  };
}

/**
 * SVG path for the arc between two values. Used for both the track and the
 * filled portion, so they can never drift out of alignment.
 */
export function arcPath(from: number, to: number, radius: number, range: Range): string {
  const startAngle = valueToAngle(from, range);
  const endAngle = valueToAngle(to, range);
  const start = polar(startAngle, radius);
  const end = polar(endAngle, radius);
  const largeArc = Math.abs(endAngle - startAngle) > 180 ? 1 : 0;
  const sweep = endAngle >= startAngle ? 1 : 0;
  return `M ${start.x.toFixed(3)} ${start.y.toFixed(3)} A ${radius} ${radius} 0 ${largeArc} ${sweep} ${end.x.toFixed(3)} ${end.y.toFixed(3)}`;
}

/**
 * Keyboard step. Shift gives fine control, Page keys and Home/End move in
 * larger jumps — the conventions a slider is expected to follow.
 */
export function keyboardValue(
  key: string,
  value: number,
  range: Range,
  options: { shift?: boolean; step?: number } = {},
): number | null {
  const step = options.step ?? 1;
  const fine = options.shift ? step : step * 5;

  switch (key) {
    case 'ArrowUp':
    case 'ArrowRight':
      return clamp(value + step, range);
    case 'ArrowDown':
    case 'ArrowLeft':
      return clamp(value - step, range);
    case 'PageUp':
      return clamp(value + fine, range);
    case 'PageDown':
      return clamp(value - fine, range);
    case 'Home':
      return range.min;
    case 'End':
      return range.max;
    default:
      return null;
  }
}
