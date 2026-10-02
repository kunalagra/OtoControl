/**
 * The touch-control table: `0x0108` read, `0x0401` write (realme Link `SetCommandManager`,
 * HeyTap `OppoProtocol`). Reply `[status][count]` then 4-byte records
 * `[deviceType][button][action][function]`.
 *
 * Function codes are not uniform across firmware: previous/next moved from 4/5 to 5/6 and 4
 * became the realme voice assistant, so the choices offered are limited to what the table or
 * the brand settles — or, when the catalog has it, by the model's own per-action mask.
 */

import type { HeyMelodyCatalogEntry } from '../catalog.generated';
import { statusBody } from './status';

type Brand = HeyMelodyCatalogEntry['brand'] | null;

export interface GestureRecord {
  deviceType: number;
  button: number;
  action: number;
  fn: number;
}

export type PrevNextScheme = 'current' | 'legacy' | null;

export const SIDE_LABEL: Record<number, string> = { 1: 'Left', 2: 'Right', 4: 'Both' };

export const ACTION_LABEL: Record<number, string> = {
  1: 'Single tap',
  2: 'Double tap',
  3: 'Triple tap',
  4: 'Touch and hold',
  6: 'Extended hold',
};

/** Button 6 is the call controls; 1 is the touch surface. */
const CALL_BUTTON = 6;

const FIXED_LABEL: Record<number, string> = {
  0: 'None',
  1: 'Play/pause',
  3: 'Voice assistant',
  7: 'Volume',
  8: 'Noise control',
  10: 'Switch track',
  11: 'Volume up',
  12: 'Volume down',
  13: 'Switch device',
  17: 'Game mode',
  28: 'Reject call',
  29: 'Answer / hang up',
};

export function decodeGestures(payload: Uint8Array): GestureRecord[] {
  const body = statusBody(payload, 'touch controls');
  const count = body[0] ?? 0;
  const records: GestureRecord[] = [];
  for (let i = 0; i < count; i += 1) {
    const at = 1 + i * 4;
    if (at + 4 > body.length) throw new Error('touch controls reply is truncated');
    records.push({ deviceType: body[at], button: body[at + 1], action: body[at + 2], fn: body[at + 3] });
  }
  return records;
}

export function encodeGestures(records: readonly GestureRecord[]): number[] {
  return [records.length, ...records.flatMap((r) => [r.deviceType, r.button, r.action, r.fn])];
}

export function prevNextScheme(records: readonly GestureRecord[], brand: Brand): PrevNextScheme {
  if (records.some((r) => r.fn === 6)) return 'current';
  if (brand !== 'realme' && records.some((r) => r.fn === 4)) return 'legacy';
  return null;
}

export function functionLabel(fn: number, scheme: PrevNextScheme, brand: Brand): string {
  if (fn === 4) return brand === 'realme' || scheme !== 'legacy' ? 'Voice assistant' : 'Previous';
  if (fn === 5) return scheme === 'current' ? 'Previous' : scheme === 'legacy' ? 'Next' : 'Track control';
  if (fn === 6) return 'Next';
  return FIXED_LABEL[fn] ?? `Function ${fn}`;
}

/**
 * HeyTap's function flags (`K8/a.java` `f2769a`, labels in `b()`), in its display order,
 * with the wire code each one writes (`a()`). Previous/next and the assistant depend on
 * the model, so they are resolved in `maskedCodes`; flags with no wire code here are skipped.
 */
const FLAG_ORDER = [512, 128, 4, 32, 64, 1, 8, 16, 1024, 2048, 4096, 8192];
const FLAG_CODE: Record<number, number> = { 512: 0, 128: 8, 4: 1, 8: 11, 16: 12, 1024: 7, 2048: 10, 4096: 13, 8192: 17 };

/** HeyTap's `c.I()`: only these two keep the legacy previous 4 / next 5. */
const LEGACY_TRACK_MODELS = new Set(['OnePlus Buds', 'OnePlus Buds Z']);

function maskedCodes(support: number, brand: Brand, legacy: boolean): number[] {
  return FLAG_ORDER.filter((flag) => (support & flag) !== 0).map((flag) => {
    if (flag === 32) return legacy ? 4 : 5;
    if (flag === 64) return legacy ? 5 : 6;
    if (flag === 1) return brand === 'realme' ? 4 : 3;
    return FLAG_CODE[flag];
  });
}

export function functionChoices(
  record: GestureRecord,
  records: readonly GestureRecord[],
  brand: Brand,
  catalog: HeyMelodyCatalogEntry | null = null,
): { fn: number; label: string }[] {
  const support = catalog?.touchSupport?.find((entry) => entry.action === record.action)?.support;
  if (support !== undefined && record.button !== CALL_BUTTON) {
    const legacy = LEGACY_TRACK_MODELS.has(catalog!.name);
    const codes = maskedCodes(support, brand, legacy);
    if (!codes.includes(record.fn)) codes.push(record.fn);
    const scheme = legacy ? 'legacy' : 'current';
    return [...new Set(codes)].map((fn) => ({ fn, label: functionLabel(fn, scheme, brand) }));
  }
  const scheme = prevNextScheme(records, brand);
  let codes: number[];
  if (record.button === CALL_BUTTON) {
    codes = [0, 28, 29];
  } else {
    const assistant = records.some((r) => r.fn === 3)
      ? 3
      : brand === 'realme' || (scheme === 'current' && records.some((r) => r.fn === 4))
        ? 4
        : 3;
    codes = [0, 1, assistant, 11, 12, 8, 17];
    if (scheme === 'current') codes.push(5, 6);
    else if (scheme === 'legacy') codes.push(4, 5);
  }
  if (!codes.includes(record.fn)) codes.push(record.fn);
  return [...new Set(codes)].map((fn) => ({ fn, label: functionLabel(fn, scheme, brand) }));
}
