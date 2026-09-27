/** In-ear status: `0x0109` reply, `0x0204` event 2 push (realme `CommandUtil.f():236-253`, `StatusInfo`). */

import type { BatteryDevice } from './battery';
import { deviceForType } from './battery';
import { statusBody } from './status';

export interface WearCell {
  device: BatteryDevice;
  inEar: boolean;
  inBox: boolean;
}

/** `[count][deviceType, flags]…` — the list after a reply's status byte or a push's event id. */
export function decodeWearList(list: Uint8Array): WearCell[] {
  const count = list[0] ?? 0;
  if (count <= 0 || list.length < 1 + count * 2) {
    throw new Error(`wear list invalid: count ${count}, ${list.length} bytes`);
  }
  const cells: WearCell[] = [];
  for (let i = 0; i < count; i += 1) {
    const device = deviceForType(list[1 + i * 2]);
    const flags = list[2 + i * 2];
    // bit 0 is active low: set means NOT in the box
    if (device) cells.push({ device, inEar: (flags & 0x02) !== 0, inBox: (flags & 0x01) === 0 });
  }
  return cells;
}

export function decodeWear(payload: Uint8Array): WearCell[] {
  return decodeWearList(statusBody(payload, 'wear query'));
}
