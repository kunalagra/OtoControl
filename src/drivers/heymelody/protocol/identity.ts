/** Device identity: productId, colour, firmware version. */

import type { BatteryDevice } from './battery';
import { deviceForType } from './battery';
import { statusBody } from './status';

export interface ProductIdReply {
  status: number;
  productId: string;
}

/** `[status(1)][productId(3, LE)]`, formatted as a 6-hex-digit uppercase string. */
export function decodeProductId(payload: Uint8Array): ProductIdReply {
  if (payload.length < 4) {
    throw new Error(`productId payload too short: expected at least 4 bytes, got ${payload.length}`);
  }
  const status = payload[0];
  const value = payload[1] | (payload[2] << 8) | (payload[3] << 16);
  return { status, productId: value.toString(16).toUpperCase().padStart(6, '0') };
}

/**
 * `0x010B` reply: `[status(1)][colorId(1)]` — realme Link's
 * `PollCommandManager.Y()`. The id is one of realme's generic colour buckets
 * (`HeadsetRusImg.Color`: 1 WHITE, 2 BLACK, … 11 GOLDEN; 0 UNKNOWN), and it is
 * what realme Link uses to pick the product render.
 */
export function decodeColourId(payload: Uint8Array): number {
  const body = statusBody(payload, 'colour id query');
  if (body.length < 1) throw new Error('colour id reply has no id byte');
  return body[0];
}

export interface VersionEntry {
  device: BatteryDevice | 'other';
  type: number;
  version: string;
}

const textDecoder = new TextDecoder('utf-8');

/**
 * `0x0105` reply: `[status][count][ASCII "device,type,version,…"]`, exactly
 * `count * 3` comma-separated fields; device `1` left, `2` right, `3` case
 * (realme `PollCommandManager.p0():971-988`, `CommandUtil.j():374-396`, `VersionInfo`).
 */
export function decodeVersion(payload: Uint8Array): VersionEntry[] {
  const body = statusBody(payload, 'version query');
  if (body.length < 2) throw new Error('version reply has no entries');
  const count = body[0];
  const fields = textDecoder.decode(body.subarray(1)).split(',');
  if (fields.length !== count * 3) throw new Error(`version reply has ${fields.length} fields for ${count} entries`);
  const entries: VersionEntry[] = [];
  for (let i = 0; i < fields.length; i += 3) {
    entries.push({ device: deviceForType(Number(fields[i])) ?? 'other', type: Number(fields[i + 1]), version: fields[i + 2] });
  }
  return entries;
}
