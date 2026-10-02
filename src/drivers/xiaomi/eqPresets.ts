import { EQ_PRESET_LABEL } from './commands';

export interface EqPresetOption {
  id: number;
  name: string;
}

/**
 * The presets a model offers, in the vendor catalog's order (`effects`), plus the
 * one it is *playing* if the list lacks it — a preset the earbuds already hold is
 * always shown. Ids no source names are labelled by their number rather than
 * guessed at.
 */
export function eqPresetOptions(effects: readonly number[], current: number | null): EqPresetOption[] {
  const ids = current !== null && !effects.includes(current) ? [...effects, current] : [...effects];
  return ids.map((id) => ({ id, name: EQ_PRESET_LABEL[id] ?? `Preset ${id}` }));
}
