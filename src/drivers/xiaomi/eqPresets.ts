import { EQ_PRESET_LABEL } from './commands';

/**
 * The presets every model lists in Gadgetbridge's coordinators: Standard,
 * Treble, Bass, Voice. Models add others (Balanced, Volume, Custom); those
 * are not offered up front, because a preset a model does not have would be
 * refused, but the one a model is *playing* is always shown.
 */
const COMMON_PRESETS = [0x00, 0x06, 0x05, 0x01] as const;

export interface EqPresetOption {
  id: number;
  name: string;
}

export function eqPresetOptions(current: number | null): EqPresetOption[] {
  const ids: number[] = [...COMMON_PRESETS];
  if (current !== null && !ids.includes(current)) ids.push(current);
  return ids.map((id) => ({ id, name: EQ_PRESET_LABEL[id] ?? `Preset ${id}` }));
}
