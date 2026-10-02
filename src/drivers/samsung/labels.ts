import type { Placement } from './decode';
import { NoiseMode } from './commands';
import type { NoiseCycle } from './commands';
import type { SamsungModel } from './models';

export const PLACEMENT_LABEL: Record<Placement, string> = {
  disconnected: 'Not connected',
  wearing: 'In ear',
  idle: 'Out of ear',
  case: 'In case',
  closedCase: 'In closed case',
};

export const NOISE_LABEL: Record<number, string> = {
  [NoiseMode.Off]: 'Off',
  [NoiseMode.Anc]: 'Noise cancelling',
  [NoiseMode.Ambient]: 'Ambient sound',
  [NoiseMode.Adaptive]: 'Adaptive',
};

/** The modes a model can be put in, in the order its tab lists them. */
export function noiseOptions(model: SamsungModel): number[] {
  switch (model.noise) {
    case 'modes':
      return [NoiseMode.Off, NoiseMode.Anc, NoiseMode.Ambient];
    case 'anc':
      return [NoiseMode.Off, NoiseMode.Anc];
    case 'ambient':
      return [NoiseMode.Off, NoiseMode.Ambient];
    default:
      return [];
  }
}

export const NOISE_CYCLE_LABEL: Record<NoiseCycle, string> = {
  ancOff: 'Noise cancelling and off',
  ambOff: 'Ambient sound and off',
  ancAmb: 'Noise cancelling and ambient',
};

/**
 * The names of an ambient model's steps. The 2019 Buds have five named steps,
 * the Buds3 Pro and Buds4 Pro a five-step "Level n" scale (GalaxyBudsClient
 * `AmbientStrengthConverter.cs`, PR #722), and everything else Low to Extra
 * loud — the top of which only some units reach, so the list is as long as the
 * model's top or the step the earbuds last reported, whichever is higher.
 */
export function ambientSteps(model: SamsungModel, reported: number | null): string[] {
  if (model.ambientMax === null) return [];
  const count = Math.max(model.ambientMax, reported ?? 0) + 1;
  const names =
    model.id === 'buds'
      ? ['Very low', 'Low', 'Moderate', 'High', 'Extra loud']
      : model.ambientMax === 4
        ? ['Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5']
        : ['Low', 'Moderate', 'High', 'Extra loud'];
  return Array.from({ length: count }, (_, index) => names[index] ?? `Level ${index + 1}`);
}
