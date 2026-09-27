/** Battery (`0x0106` reply, `0x0204` event 1 push). */

import { statusBody } from './status';

export type BatteryDevice = 'left' | 'right' | 'case';

export interface BatteryCell {
  device: BatteryDevice;
  level: number;
  charging: boolean;
}

/** Display label per battery device — shared by `driver.ts`'s status line and `sections/System.tsx`. */
export const BATTERY_LABEL: Record<BatteryDevice, string> = { left: 'Left', right: 'Right', case: 'Case' };

const BATTERY_DEVICE_TYPE: Record<number, BatteryDevice> = { 1: 'left', 2: 'right', 3: 'case' };

/**
 * `[status(1)][count(1)][deviceType(1), packed(1)] x count`. The leading
 * status byte is confirmed by realme Link's `PollCommandManager.W()`, which
 * gates on byte 0 and then calls `CommandUtil.d(1, …)` — the same parser as
 * HeyTap's `CommandUtil.d(offset, …)`. Reading without it takes status 0 as count 0 and drops
 * every cell. A non-zero or missing status throws, failing closed like the
 * vendor's `CommandUtil.n()`.
 *
 * `packed`'s low 7 bits are level (0-100), bit 7 is the charging flag. A
 * `deviceType` outside 1-3 is skipped rather than thrown on: firmware variance
 * here is expected, not corruption. `count` is clamped to the actual payload.
 */
export function decodeBattery(payload: Uint8Array): BatteryCell[] {
  return decodeBatteryList(statusBody(payload, 'battery query'));
}

export const deviceForType = (type: number): BatteryDevice | null => BATTERY_DEVICE_TYPE[type] ?? null;

/** `[count][deviceType, packed]…` — the list after a reply's status byte or a push's event id. */
export function decodeBatteryList(list: Uint8Array): BatteryCell[] {
  if (list.length === 0) return [];
  const count = Math.min(list[0], Math.floor((list.length - 1) / 2));
  const cells: BatteryCell[] = [];
  for (let i = 0; i < count; i += 1) {
    const device = deviceForType(list[1 + i * 2]);
    const packed = list[2 + i * 2];
    if (device) cells.push({ device, level: packed & 0x7f, charging: (packed & 0x80) !== 0 });
  }
  return cells;
}
