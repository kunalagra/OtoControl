/**
 * Command IDs that must never be sent, and those that must never be swept.
 *
 * Firmware upgrade over a reverse-engineered channel can brick the headphones,
 * and wiping the paired-device list destroys state that cannot be recovered
 * from this app. IDs taken from `reference/m4.json`.
 *
 * The two tiers exist because "destructive" and "unsafe to guess at" are
 * different questions. Deleting one pairing is a real thing a user may ask for,
 * so it is reachable as a deliberate typed command — but a zero-payload sweep
 * across 0x14xx could be read by firmware as "delete index 0", so it stays out
 * of the sweep and raw-frame paths.
 *
 * This is enforced in code, not only in the UI.
 */

import { Vendor } from './frame';

interface Range {
  vendor: number;
  from: number;
  to: number;
  reason: string;
}

/** Never sendable, by any path. */
const BLOCKED: Range[] = [
  // Firmware upgrade: enter DFU, set file size, progress.
  { vendor: Vendor.Sennheiser, from: 0x0200, to: 0x02ff, reason: 'firmware upgrade' },
  // Factory reset.
  { vendor: Vendor.Sennheiser, from: 0x0040, to: 0x0040, reason: 'factory reset' },
  // 0x1406 wipes the entire paired-device list. No vendor app implements it.
  { vendor: Vendor.Sennheiser, from: 0x1406, to: 0x1406, reason: 'wipes the paired-device list' },
  // Qualcomm GAIA upgrade transport.
  { vendor: Vendor.Qualcomm, from: 0x0c00, to: 0x0cff, reason: 'firmware upgrade' },
  // Erase panic log.
  { vendor: Vendor.Qualcomm, from: 0x0804, to: 0x0804, reason: 'erases device logs' },
];

/** Safe as a deliberate call, never as a sweep or a hand-written frame. */
const SWEEP_BLOCKED: Range[] = [
  { vendor: Vendor.Sennheiser, from: 0x1405, to: 0x1405, reason: 'deletes a paired device' },
  // `MMI_SetDefaultConfig` takes no arguments, so a zero-payload probe is a
  // *valid invocation* of it rather than a rejected read — sweeping 0x16xx on
  // hardware reset the touch-control assignments to factory defaults. Any
  // command that needs no arguments is indistinguishable from a getter to a
  // sweep, so it has to be named here.
  { vendor: Vendor.Sennheiser, from: 0x1604, to: 0x1604, reason: 'resets the touch controls' },
];

const find = (ranges: Range[], vendor: number, command: number): string | undefined =>
  ranges.find(
    (range) => range.vendor === vendor && command >= range.from && command <= range.to,
  )?.reason;

/** Why a command is blocked outright, or undefined if it may be sent. */
export function blockedReason(vendor: number, command: number): string | undefined {
  return find(BLOCKED, vendor, command);
}

export const isBlocked = (vendor: number, command: number): boolean =>
  blockedReason(vendor, command) !== undefined;

/**
 * Why a command may not be swept or sent as a raw frame.
 *
 * A superset of `blockedReason`: everything unsendable is also unsweepable.
 */
export function sweepBlockedReason(vendor: number, command: number): string | undefined {
  return blockedReason(vendor, command) ?? find(SWEEP_BLOCKED, vendor, command);
}

export const isSweepBlocked = (vendor: number, command: number): boolean =>
  sweepBlockedReason(vendor, command) !== undefined;
