/**
 * What the app sends. Each builder returns an id and a payload — framing is
 * `frame.ts`'s job — and each takes the model, because the same setting is a
 * different message on different generations (see `models.ts`).
 */

import { MsgId } from './ids';
import type { TouchGestures } from './decode';
import type { SamsungModel, TouchAction } from './models';
import { TOUCH_MAPS, atLeast } from './models';

export interface Command {
  id: number;
  payload: number[];
}

/** Off, ANC, ambient, adaptive — `NoiseControls`' own numbering. */
export const NoiseMode = { Off: 0, Anc: 1, Ambient: 2, Adaptive: 3 } as const;

/** The mode a model's single switch (`0x80` / `0x98`) can reach, or null if it cannot reach it. */
export function noiseCommand(model: SamsungModel, mode: number): Command | null {
  switch (model.noise) {
    case 'modes':
      return model.noiseModes.includes(mode) ? { id: MsgId.NoiseControls, payload: [mode] } : null;
    case 'anc':
      return mode === NoiseMode.Off || mode === NoiseMode.Anc
        ? { id: MsgId.NoiseReduction, payload: [mode === NoiseMode.Anc ? 1 : 0] }
        : null;
    case 'ambient':
      return mode === NoiseMode.Off || mode === NoiseMode.Ambient
        ? { id: MsgId.AmbientMode, payload: [mode === NoiseMode.Ambient ? 1 : 0] }
        : null;
    default:
      return null;
  }
}

/**
 * `preset`: 0 for off, 1-5 for the built-ins. The 2019 Buds take an enabled
 * flag and a preset that sits five higher on the wire (0-4 regular, 5-9 the
 * Dolby variant of the same five — GalaxyBudsClient `SetEqualizerEncoder.cs`).
 */
export function equalizerCommand(model: SamsungModel, preset: number): Command {
  if (model.layout === 'legacy') {
    return { id: MsgId.Equalizer, payload: [preset === 0 ? 0 : 1, (preset === 0 ? 2 : preset - 1) + 5] };
  }
  return { id: MsgId.Equalizer, payload: [preset] };
}

const ALL_GESTURES: TouchGestures = {
  single: true,
  double: true,
  triple: true,
  hold: true,
  doubleForCalls: true,
  holdForCalls: true,
};

/**
 * Locks or unlocks the touchpads. Older earbuds take one byte; Buds2-era ones
 * a block that restates every gesture, so a bare "lock" would re-enable or
 * disable gestures the user had set — `gestures` is what the earbuds last
 * reported, and goes back unchanged. `[0]` is inverted from the single-byte
 * form: it is "touch enabled" (`LockTouchpadEncoder.cs`).
 */
export function touchLockCommand(
  model: SamsungModel,
  locked: boolean,
  gestures: TouchGestures | null,
  revision: number | null,
): Command {
  if (!atLeast(model.advancedLockFrom, revision)) {
    return { id: MsgId.LockTouchpad, payload: [locked ? 1 : 0] };
  }
  const g = gestures ?? ALL_GESTURES;
  const bytes = [!locked, g.single, g.double, g.triple, g.hold];
  if (atLeast(model.lockCallsFrom, revision)) bytes.push(g.doubleForCalls, g.holdForCalls);
  return { id: MsgId.LockTouchpad, payload: bytes.map((flag) => (flag ? 1 : 0)) };
}

export function findCommand(model: SamsungModel, revision: number | null, start: boolean): Command {
  if (!start) return { id: MsgId.FindStop, payload: [] };
  return { id: atLeast(model.ringWhileWearingFrom, revision) ? MsgId.FindOnWearing : MsgId.FindStart, payload: [] };
}

/**
 * Tells the earbuds a companion app is here: `[client type 1, phone maker, Android
 * SDK]`, byte for byte what GalaxyBudsClient sends (`ManagerInfoEncoder.cs`:
 * maker 1 is "Samsung", 2 "other"; SDK 34 is Android 14). Only a nudge here —
 * MagicPodsCore, GalaxyBuds-BatteryLevel and LiveBudsCli never send it and the
 * earbuds still push and accept every setting.
 */
export const managerInfoCommand = (): Command => ({ id: MsgId.ManagerInfo, payload: [1, 1, 34] });

/**
 * Sets the ambient-sound step on 0x84, zero-based (a Buds4 Pro's "Level 1-5" is
 * 0-4: GalaxyBudsClient PR #722, tested on hardware). `reported` is the step
 * the earbuds last said they were on, which may sit above the table's top — an
 * extra-loud Buds2 Pro reads 3 where the table says 2 — and is allowed.
 */
export function ambientLevelCommand(model: SamsungModel, level: number, reported: number | null): Command | null {
  if (model.ambientMax === null || !Number.isInteger(level) || level < 0) return null;
  if (level > Math.max(model.ambientMax, reported ?? 0)) return null;
  return { id: MsgId.AmbientVolume, payload: [level] };
}

/** The wire byte for an action in a model's map, or null if the model offers no such action. */
function holdByte(model: SamsungModel, action: TouchAction): number | null {
  if (model.touchMap === null || !model.holdActions.includes(action)) return null;
  const entry = Object.entries(TOUCH_MAPS[model.touchMap]).find(([, value]) => value === action);
  return entry ? Number(entry[0]) : null;
}

/**
 * Sets what a touch-and-hold does on each earbud: `[left, right]` on 0x92
 * (GalaxyBudsClient `SetTouchOptionsEncoder.cs`), padded with the two
 * digital-assistant bytes where the Buds4 plugin sends four (`kk/f.java:66-71`).
 */
export function touchOptionCommand(model: SamsungModel, left: TouchAction, right: TouchAction): Command | null {
  const l = holdByte(model, left);
  const r = holdByte(model, right);
  if (l === null || r === null) return null;
  return { id: MsgId.TouchOption, payload: [l, r, ...new Array<number>(model.holdWritePad).fill(0)] };
}

/** Which two noise modes a long press toggles between: ANC and off, ambient and off, or ANC and ambient. */
export type NoiseCycle = 'ancOff' | 'ambOff' | 'ancAmb';

/** `[anc, ambient, off]` flags per earbud (`TouchAndHoldNoiseControlsEncoder.cs`, the layout before the Buds3 generation). */
const CYCLE_FLAGS: Record<NoiseCycle, number[]> = { ancOff: [1, 0, 1], ambOff: [0, 1, 1], ancAmb: [1, 1, 0] };

/**
 * Chooses the pair of noise modes a long press cycles through, on 0x79: the
 * left earbud's flags then the right's, or just one set on a model and revision
 * that share one setting. Not offered for the Buds3 generation, whose layout
 * the open-source client leaves half done.
 */
export function noiseCycleCommand(model: SamsungModel, revision: number | null, left: NoiseCycle, right: NoiseCycle): Command | null {
  if (!model.noiseCycle) return null;
  const dual = atLeast(model.noiseCycle.dualSideFrom, revision);
  return { id: MsgId.TouchNoiseCycle, payload: dual ? [...CYCLE_FLAGS[left], ...CYCLE_FLAGS[right]] : [...CYCLE_FLAGS[right]] };
}
