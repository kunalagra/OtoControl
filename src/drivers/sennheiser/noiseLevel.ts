/**
 * The unified noise-control scale (`ANC_Transparency`, 0x1A02/0x1A03).
 *
 * 0 is full noise cancelling, 100 is full transparency — established by ear on
 * hardware, and the opposite of what the property name suggests. The knob runs
 * the same way, cancelling on the left.
 */

export const NEUTRAL_LEVEL = 50

export interface NoiseReadout {
  kind: 'neutral' | 'cancelling' | 'transparency'
  /** "Cancelling", "Transparency", or "Neutral". */
  label: string
  /** 0–100 within that direction. Zero when neutral. */
  percent: number
}

export function noiseReadout(value: number): NoiseReadout {
  if (value === NEUTRAL_LEVEL) return { kind: 'neutral', label: 'Neutral', percent: 0 }
  if (value > NEUTRAL_LEVEL) {
    return {
      kind: 'transparency',
      label: 'Transparency',
      percent: (value - NEUTRAL_LEVEL) * 2,
    }
  }
  return { kind: 'cancelling', label: 'Cancelling', percent: (NEUTRAL_LEVEL - value) * 2 }
}

/** One-line form, used for `aria-valuetext`. */
export function describeLevel(value: number): string {
  const readout = noiseReadout(value)
  return readout.kind === 'neutral' ? readout.label : `${readout.label} ${readout.percent}%`
}
