/**
 * What the app sends. Each builder returns an id and a payload — framing is
 * `frame.ts`'s job — and each takes the model, because the same setting is a
 * different message on different generations (see `models.ts`).
 */

import { MsgId } from './ids';
import type { TouchGestures } from './decode';
import type { SamsungModel } from './models';
import { atLeast } from './models';

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
      return { id: MsgId.NoiseControls, payload: [mode] };
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
 * Tells the earbuds a companion app is here: `[client type 1, is-Samsung-phone
 * 1 or 2, Android SDK]`. A browser is not a Samsung phone, and has no SDK;
 * 34 (Android 14) is what the open-source client sends.
 */
export const managerInfoCommand = (): Command => ({ id: MsgId.ManagerInfo, payload: [1, 2, 34] });
