/** The `0x0100` capability bitmap: which commands the firmware implements. */

import { Cmd } from './cmd';
import { statusBody } from './status';

export type HeyMelodyFeature = 'version' | 'battery' | 'wear' | 'find' | 'anc' | 'eq' | 'eqCustom';

/** Bit n of the `0x0100` bitmap enables row n (realme `Protocol.b2`, `Protocol.java:179`). */
export const CAPABILITY_TABLE: readonly (readonly number[])[] = [
  [0x0105], [0x0106], [0x0107], [0x0108, 0x0401], [0x0109], [0x0400], [0x0402], [0x010d, 0x0403],
  [0x010c, 0x0404], [0x0405], [0x0406, 0x010f], [0x0110, 0x0407], [], [0x0408], [0x0409], [0x040a, 0x0111],
  [], [], [], [0x040e, 0x040d, 0x0115, 0x0116], [], [], [0x0205], [0x0f00],
  [], [0x0118, 0x0411], [0x011a, 0x0412], [], [], [0x0112, 0x040b], [0x011e, 0x011f, 0x0415], [],
  [0x0120], [], [0x0122, 0x0418], [], [], [], [0x0124, 0x041b], [],
  [], [], [], [0x041e], [], [], [0x0128, 0x050e], [],
  [], [], [], [], [], [], [0x012c], [],
  [], [], [0x0131, 0x0428], [], [0x042c],
];

/**
 * Always allowed without a bitmap bit: the union of realme `Protocol.c2` (`:181-191`) and
 * HeyTap `R6/a.java`'s set, which also exempts battery `0x0106` and the feature-switch
 * query `0x010D` — so OPPO firmware may not set their bits.
 */
export const BOOTSTRAP_COMMANDS: ReadonlySet<number> = new Set([
  0x0100, 0x0101, 0x0102, 0x0103, 0x0104, 0x0106, 0x010b, 0x010d, 0x0f00, 0x0f03, 0x0f04,
]);

export function decodeCapabilities(payload: Uint8Array): Set<number> {
  const bitmap = statusBody(payload, 'capability query');
  const commands = new Set(BOOTSTRAP_COMMANDS);
  CAPABILITY_TABLE.forEach((row, bit) => {
    if ((bitmap[bit >> 3] ?? 0) & (1 << (bit & 7))) row.forEach((cmd) => commands.add(cmd));
  });
  return commands;
}

const FEATURE_COMMANDS: Record<HeyMelodyFeature, readonly number[]> = {
  version: [Cmd.QueryVersion],
  battery: [Cmd.Battery],
  wear: [Cmd.QueryWear],
  find: [Cmd.FindEarbuds],
  anc: [Cmd.QueryAncDirect],
  eq: [Cmd.SetEqPreset, Cmd.QueryEqAll],
  eqCustom: [Cmd.SetEqCurve],
};

export function featuresFromCommands(commands: ReadonlySet<number>): Set<HeyMelodyFeature> {
  const features = new Set<HeyMelodyFeature>();
  for (const [feature, needs] of Object.entries(FEATURE_COMMANDS) as [HeyMelodyFeature, readonly number[]][]) {
    if (needs.some((cmd) => commands.has(cmd))) features.add(feature);
  }
  return features;
}
