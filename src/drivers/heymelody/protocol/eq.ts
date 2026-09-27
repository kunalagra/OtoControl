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

/** `0x0418` actions (realme `CustomEqViewModel.java:72,92,160`). */
export const EQ_ACTION = { Add: 1, Modify: 2, Delete: 3 } as const;

const textEncoder = new TextEncoder();

/**
 * `0x0418` modify write: `[action][min][max][eqId][nameLen][name UTF-8][bandCount][freq(2 LE), gain]…`
 * (realme `SetCommandManager.p():440-497`). Every `0x0122` entry is a custom EQ, so any preset is editable.
 */
export function encodeSetEqCurve(preset: EqPreset, gains: readonly number[]): number[] {
  if (gains.length !== preset.bands.length) {
    throw new Error(`EQ curve has ${gains.length} gains for ${preset.bands.length} bands`);
  }
  const name = Array.from(textEncoder.encode(preset.name));
  return [
    EQ_ACTION.Modify,
    preset.minValue & 0xff,
    preset.maxValue & 0xff,
    preset.eqId,
    name.length,
    ...name,
    preset.bands.length,
    ...preset.bands.flatMap((band, i) => [band.frequency & 0xff, (band.frequency >> 8) & 0xff, gains[i] & 0xff]),
  ];
}

/** `0x8418` ack: `[status][eqId]` (realme `SetCommandManager:234-250`). */
export function decodeSetEqCurveAck(payload: Uint8Array): number {
  const body = statusBody(payload, 'EQ curve write');
  if (body.length < 1) throw new Error('EQ curve ack has no eqId');
  return body[0];
}
