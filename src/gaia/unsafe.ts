/**
 * Command IDs that must never be sent, by sweep or by hand.
 *
 * Firmware upgrade over a reverse-engineered channel can brick the headphones,
 * and the factory-reset and paired-device-delete commands destroy state that
 * cannot be recovered from this app. IDs taken from `reference/m4.json`.
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

const BLOCKED: Range[] = [
  // Firmware upgrade: enter DFU, set file size, progress.
  { vendor: Vendor.Sennheiser, from: 0x0200, to: 0x02ff, reason: 'firmware upgrade' },
  // Factory reset.
  { vendor: Vendor.Sennheiser, from: 0x0040, to: 0x0040, reason: 'factory reset' },
  // Paired-device list: 0x1405 deletes an entry, 0x1406 wipes the whole list.
  { vendor: Vendor.Sennheiser, from: 0x1405, to: 0x1406, reason: 'deletes paired devices' },
  // Qualcomm GAIA upgrade transport.
  { vendor: Vendor.Qualcomm, from: 0x0c00, to: 0x0cff, reason: 'firmware upgrade' },
  // Erase panic log.
  { vendor: Vendor.Qualcomm, from: 0x0804, to: 0x0804, reason: 'erases device logs' },
];

/** Why a command is blocked, or undefined if it is safe to send. */
export function blockedReason(vendor: number, command: number): string | undefined {
  return BLOCKED.find(
    (range) => range.vendor === vendor && command >= range.from && command <= range.to,
  )?.reason;
}

export const isBlocked = (vendor: number, command: number): boolean =>
  blockedReason(vendor, command) !== undefined;
