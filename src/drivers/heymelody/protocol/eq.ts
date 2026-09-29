/** EQ: current preset, custom EQ list with curves, preset select, curve write. */

import { statusBody } from './status';

export interface EqBand {
  frequency: number;
  dbValue: number;
}

export interface EqPreset {
  isSelected: boolean;
  minValue: number;
  maxValue: number;
  eqId: number;
  name: string;
  bands: EqBand[];
}

/** Two's-complement signed byte. */
const signedByte = (byte: number): number => (byte > 127 ? byte - 256 : byte);

const textDecoder = new TextDecoder('utf-8');

export interface EqCurrentReply {
  status: number;
  presetId: number;
}

/**
 * `0x010F` response: `[status(1)][presetId(1)]` — two separate one-byte
 * fields, not a combined u16 (corrected from an earlier misreading of a
 * "2-byte response" as a little-endian pair), matching every other
 * directly-queried command in this protocol carrying its own status byte —
 * see `decodeProductId`.
 */
export function decodeEqCurrent(payload: Uint8Array): EqCurrentReply {
  if (payload.length < 2) {
    throw new Error(`EQ current-preset payload too short: expected at least 2 bytes, got ${payload.length}`);
  }
  return { status: payload[0], presetId: payload[1] };
}

/**
 * `0x0122` response — `CommandUtil.b()` / "parseAllEqData":
 * `[status(1)][count(1)][entries...]`. **Corrected from an earlier reading
 * that took `payload[0]` directly as `count`** — cross-checked directly
 * against 1812z/OppoPods's `EqDetailsParser.parseAll()` current source
 * (`data[9] != 0 -> return null; count = data[10]`, where `data` is the
 * *whole* wire frame and offset 9 is where this driver's `payload` begins —
 * i.e. its own `payload[0]` is a status gate, `payload[1]` is count).
 * Every preset carries a full per-band curve, not just an index. See spec
 * §3.4 for why `0x0122` rather than `0x010F` serves this richer format.
 */
export function decodeEqAll(payload: Uint8Array): EqPreset[] {
  const list = statusBody(payload, 'QueryEqAll');
  if (list.length < 1) throw new Error('QueryEqAll reply has no preset count');
  return decodeEqList(list);
}

/** `[count][preset…]` — `0x0122` after its status byte, or a `0x0506` push as-is (realme `RequestCommandManager.d()`). */
export function decodeEqList(list: Uint8Array): EqPreset[] {
  if (list.length === 0) return [];
  const count = list[0];
  const presets: EqPreset[] = [];
  let offset = 1;

  for (let i = 0; i < count; i += 1) {
    // Check that the fixed 5-byte preset header can be read
    if (offset + 5 > list.length) {
      throw new Error(`EQ preset #${i} header truncated: expected 5 bytes at offset ${offset}, but only ${list.length - offset} bytes available`);
    }

    const isSelected = list[offset] !== 0;
    const minValue = signedByte(list[offset + 1]);
    const maxValue = signedByte(list[offset + 2]);
    const eqId = list[offset + 3];
    const nameLength = list[offset + 4];
    const nameStart = offset + 5;

    // Check that the name bytes can be read
    if (nameStart + nameLength > list.length) {
      throw new Error(`EQ preset #${i} name truncated: expected ${nameLength} bytes at offset ${nameStart}, but only ${list.length - nameStart} bytes available`);
    }

    const name = textDecoder.decode(list.slice(nameStart, nameStart + nameLength));

    const frequencyNumOffset = nameStart + nameLength;

    // Check that frequencyNum byte can be read
    if (frequencyNumOffset >= list.length) {
      throw new Error(`EQ preset #${i} frequencyNum byte missing: expected 1 byte at offset ${frequencyNumOffset}, but list ends at ${list.length}`);
    }

    const frequencyNum = list[frequencyNumOffset];
    const bands: EqBand[] = [];
    let bandOffset = frequencyNumOffset + 1;

    for (let b = 0; b < frequencyNum; b += 1) {
      // Check that the 3-byte band entry can be read
      if (bandOffset + 3 > list.length) {
        throw new Error(`EQ preset #${i} band #${b} truncated: expected 3 bytes at offset ${bandOffset}, but only ${list.length - bandOffset} bytes available`);
      }

      const frequency = list[bandOffset] | (list[bandOffset + 1] << 8);
      const dbValue = signedByte(list[bandOffset + 2]);
      bands.push({ frequency, dbValue });
      bandOffset += 3;
    }

    presets.push({ isSelected, minValue, maxValue, eqId, name, bands });
    offset = bandOffset;
  }

  return presets;
}

/**
 * Set-EQ-preset (`0x0406`) request payload: the single-byte `eqId`. Not
 * independently derived, but a stronger assumption than `encodeSetAncMode`'s
 * — `eqId` is confirmed 1 byte on the read side (§3.6), so selecting a preset
 * by that same byte is the natural symmetric shape.
 */
export function encodeSetEqPreset(eqId: number): number[] {
  return [eqId];
}

/** `0x0418` actions (realme `CustomEqViewModel.java:72,92,160`; HeyMelody `p085g9/j.java:496,615`). */
export const EQ_ACTION = { Add: 1, Modify: 2, Delete: 3 } as const;

export type EqAction = (typeof EQ_ACTION)[keyof typeof EQ_ACTION];

const textEncoder = new TextEncoder();

/** The vendor's default custom-EQ band centres, used when no custom preset exists to copy. */
export const DEFAULT_CUSTOM_BANDS: readonly number[] = [62, 250, 1000, 4000, 8000, 16000];

/**
 * `0x0418` write: `[action][min][max][eqId][nameLen][name UTF-8][bandCount][freq(2 LE), gain]…`
 * (realme `SetCommandManager.p():440-497`, HeyMelody `HeadsetCoreService` `G0`). Create, modify
 * (which also selects a custom preset) and delete all send the whole preset; only the action
 * byte and, for modify, the gains differ. The preset's own range and band layout are echoed —
 * models differ (±6 with 6 bands by default, ±10 with 10 bands on some).
 */
export function encodeEqWrite(
  action: EqAction,
  preset: EqPreset,
  gains: readonly number[] = preset.bands.map((band) => band.dbValue),
): number[] {
  if (gains.length !== preset.bands.length) {
    throw new Error(`EQ curve has ${gains.length} gains for ${preset.bands.length} bands`);
  }
  const name = Array.from(textEncoder.encode(preset.name));
  return [
    action,
    preset.minValue & 0xff,
    preset.maxValue & 0xff,
    preset.eqId,
    name.length,
    ...name,
    preset.bands.length,
    ...preset.bands.flatMap((band, i) => [band.frequency & 0xff, (band.frequency >> 8) & 0xff, gains[i] & 0xff]),
  ];
}

/** What a create sends: id 0 (the buds assign one), zero gains, a template's range and bands. */
export function newCustomPreset(name: string, template: EqPreset | null): EqPreset {
  return {
    isSelected: false,
    minValue: template?.minValue ?? -6,
    maxValue: template?.maxValue ?? 6,
    eqId: 0,
    name,
    bands: (template?.bands.map((band) => band.frequency) ?? DEFAULT_CUSTOM_BANDS).map((frequency) => ({ frequency, dbValue: 0 })),
  };
}

/**
 * `0x0504` push: the bare current preset id (HeyMelody `HeadsetCoreService`, realme
 * `RequestCommandManager`, QuickBuds capture). Some community apps expect a leading status
 * byte, so a two-byte `[00][id]` is accepted too.
 */
export function decodeEqCurrentPush(payload: Uint8Array): number {
  if (payload.length === 0) throw new Error('EQ current push is empty');
  if (payload.length >= 2 && payload[0] === 0) return payload[1];
  return payload[0];
}

/** `0x8418` ack: `[status][eqId]` (realme `SetCommandManager:234-250`). */
export function decodeSetEqCurveAck(payload: Uint8Array): number {
  const body = statusBody(payload, 'EQ curve write');
  if (body.length < 1) throw new Error('EQ curve ack has no eqId');
  return body[0];
}
