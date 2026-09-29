import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { initialHeyMelodyState } from '../state';
import { HeyMelodySound } from './Sound';

interface CapturedSlider {
  onValueChange?: (value: number | number[]) => void;
  onValueCommitted?: (value: number | number[]) => void;
}

const sliders: CapturedSlider[] = [];

// Base UI's keyboard path fires onValueChange then onValueCommitted in the same
// event, before React re-renders — so the commit handler must not rely on state
// set by the change handler. Capturing the props lets the test do exactly that.
vi.mock('@/components/ui/slider', () => ({
  Slider: (props: CapturedSlider) => {
    sliders.push(props);
    return null;
  },
}));

describe('HeyMelody curve editor', () => {
  it('writes the committed value even when no re-render happened since the change (keyboard)', () => {
    const writes: [number, number[]][] = [];
    const device = { setEqCurve: (eqId: number, gains: number[]) => writes.push([eqId, gains]) } as never;
    const preset = {
      isSelected: true,
      minValue: -6,
      maxValue: 6,
      eqId: 9,
      name: 'C1',
      bands: [
        { frequency: 100, dbValue: 0 },
        { frequency: 4300, dbValue: 2 },
      ],
    };
    renderToStaticMarkup(
      <HeyMelodySound
        device={device}
        state={{ ...initialHeyMelodyState, status: 'connected', eqCurrentPreset: 9, eqPresets: [preset], capabilities: new Set(['eq', 'eqCustom']) }}
      />,
    );

    sliders[0].onValueChange?.([1]);
    sliders[0].onValueCommitted?.([1]);

    expect(writes).toEqual([[9, [1, 2]]]);
  });
});
