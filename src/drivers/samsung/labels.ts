import type { Placement } from './decode';
import { NoiseMode } from './commands';
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
