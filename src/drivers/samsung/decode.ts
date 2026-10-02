/**
 * Decoders for what the earbuds send. Every one reads defensively: the layouts
 * grow with the model and the `revision` byte, so a reader takes the fields it
 * knows, stops at the end of the buffer, and leaves anything it cannot read as
 * `null` rather than guessing. Offsets follow GalaxyBudsClient's
 * `ExtendedStatusUpdateDecoder` / `StatusUpdateDecoder` and were checked
 * against the vendor plugin's status parser (`ar/a.java`, `yn/b.java`).
 */

import type { SamsungModel, StatusLayout } from './models';
import { atLeast } from './models';

export type Placement = 'disconnected' | 'wearing' | 'idle' | 'case' | 'closedCase';

export interface Cells<T> {
  left: T;
  right: T;
  case: T;
}

export interface TouchGestures {
  single: boolean;
  double: boolean;
  triple: boolean;
  hold: boolean;
  doubleForCalls: boolean;
  holdForCalls: boolean;
}

export interface StatusUpdate {
  revision: number | null;
  /** Percent, or null for "unknown" (the earbuds send 101 and up for that). */
  battery: Cells<number | null>;
  placement: { left: Placement; right: Placement };
  /** Null when this model/revision sends no charging flags. */
  charging: Cells<boolean> | null;
}

/** Which of off / ambient / ANC / adaptive an earbud's noise-control long press cycles through. */
export interface NoiseSet {
  off: boolean;
  ambient: boolean;
  anc: boolean;
  adaptive: boolean;
}

export interface ExtendedUpdate {
  revision: number;
  /** `[1]`: told apart per model within a family — see `SamsungModel.earType`. */
  earType: number;
  /** The unit's colour id (a `DeviceIds` value, read from the left earbud), or null when absent. */
  colour: number | null;
  battery: Cells<number | null>;
  placement: { left: Placement; right: Placement };
  /** 0 off/normal, 1-5 the built-in presets, 6 a custom curve. */
  eq: number | null;
  touchLocked: boolean | null;
  gestures: TouchGestures | null;
  /** 0 off, 1 ANC, 2 ambient, 3 adaptive. */
  noiseMode: number | null;
  /** The ambient-sound step (0 is the quietest), where the model has one. */
  ambientLevel: number | null;
  /** The raw touch-and-hold action byte per earbud; `TOUCH_MAPS` says what it means for a model. */
  touchOptions: { left: number; right: number } | null;
  /** The modes the noise-control long press cycles through, per earbud, where the model lets that be chosen. */
  noiseTouch: { left: NoiseSet; right: NoiseSet } | null;
}

const PLACEMENTS: Placement[] = ['disconnected', 'wearing', 'idle', 'case', 'closedCase'];
const placementOf = (nibble: number): Placement => PLACEMENTS[nibble] ?? 'disconnected';

/**
 * 101 and up mean "unknown" (a case reads 101 or 255 when it has not been heard
 * from); so does 0, which the captured Buds FE sends for a case it cannot see
 * and MagicPodsCore treats as "disconnected" for any cell.
 */
const percent = (value: number | undefined): number | null =>
  value === undefined || value === 0 || value > 100 ? null : value;

/** The 2019 Buds' wear byte: 0x10 is the left bud, 0x01 the right. */
function legacyPlacement(wear: number | undefined): StatusUpdate['placement'] {
  return {
    left: wear !== undefined && wear & 0x10 ? 'wearing' : 'idle',
    right: wear !== undefined && wear & 0x01 ? 'wearing' : 'idle',
  };
}

const nibbles = (byte: number | undefined): StatusUpdate['placement'] =>
  byte === undefined
    ? { left: 'disconnected', right: 'disconnected' }
    : { left: placementOf(byte >> 4), right: placementOf(byte & 0x0f) };

/** `Status` (0x60). Needs the model only for its charging flags and the 2019 Buds' older layout. */
export function decodeStatus(payload: Uint8Array, model: SamsungModel, knownRevision: number | null): StatusUpdate | null {
  if (model.layout === 'legacy') {
    // [earType, battL, battR, coupled, main, wear]
    if (payload.length < 6) return null;
    return {
      revision: null,
      battery: { left: percent(payload[1]), right: percent(payload[2]), case: null },
      placement: legacyPlacement(payload[5]),
      charging: null,
    };
  }
  // [revision, battL, battR, coupled, main, placement, battCase, chargeFlags]
  if (payload.length < 6) return null;
  const revision = payload[0];
  const flags = payload[7];
  const charging =
    flags !== undefined && atLeast(model.chargingFrom, knownRevision ?? revision)
      ? { left: (flags & 0x10) !== 0, right: (flags & 0x04) !== 0, case: (flags & 0x01) !== 0 }
      : null;
  return {
    revision,
    battery: { left: percent(payload[1]), right: percent(payload[2]), case: percent(payload[6]) },
    placement: nibbles(payload[5]),
    charging,
  };
}

/** Where, in an `ExtendedStatus` payload, each field this driver reads sits — per layout. */
interface Offsets {
  eq: number;
  lock: number;
  noise: number | null;
  /** The two nibbles holding the left and right hold actions. */
  touch: number;
  /** The ambient step, where there is one (none on the Live). */
  ambient: number | null;
  /** The int16 colour id, little-endian; none on the 2019 Buds. */
  colour: number | null;
}

/**
 * Every offset below is read back by `fixtures.test.ts` from a real capture of
 * that layout (Buds, Buds+, Live, Pro, Buds2, Buds2 Pro, FE) except `modern`'s
 * Buds3-and-later column, which one Buds3 Pro capture covers.
 */
const OFFSETS: Record<StatusLayout, Offsets> = {
  legacy: { eq: 11, lock: 12, noise: 7, touch: 13, ambient: 9, colour: null },
  plus: { eq: 11, lock: 12, noise: 8, touch: 13, ambient: 9, colour: 15 },
  live: { eq: 9, lock: 10, noise: 12, touch: 11, ambient: null, colour: 14 },
  pro: { eq: 9, lock: 10, noise: 12, touch: 11, ambient: 23, colour: 14 },
  modern: { eq: 9, lock: 10, noise: 12, touch: 11, ambient: 23, colour: 14 },
};

/** The noise-control long-press byte: bit 0 off, 1 ambient, 2 ANC for the right earbud, the same bits shifted by 4 for the left. */
const noiseSet = (byte: number, shift: number): NoiseSet => ({
  off: (byte >> shift & 0x01) !== 0,
  ambient: (byte >> shift & 0x02) !== 0,
  anc: (byte >> shift & 0x04) !== 0,
  adaptive: false,
});

/** `ExtendedStatus` (0x61): the battery prefix, then the layout's settings. Null when too short to be one. */
export function decodeExtended(payload: Uint8Array, model: SamsungModel): ExtendedUpdate | null {
  if (payload.length < 8) return null;
  const { layout } = model;
  const at = (index: number): number | undefined => payload[index];
  const offsets = OFFSETS[layout];

  const base = { revision: payload[0] };
  const battery: Cells<number | null> = {
    left: percent(at(2)),
    right: percent(at(3)),
    case: layout === 'legacy' ? null : percent(at(7)),
  };
  const placement = layout === 'legacy' ? legacyPlacement(at(6)) : nibbles(at(6));

  const eqByte = at(offsets.eq);
  let eq: number | null;
  if (eqByte === undefined) eq = null;
  else if (layout === 'legacy') {
    // [10] enabled, [11] mode: 0-4 regular presets, 5-9 the same presets "with Dolby Atmos" — no audible difference.
    eq = at(10) ? (eqByte % 5) + 1 : 0;
  } else eq = eqByte;

  const lockByte = at(offsets.lock);
  let touchLocked: boolean | null = null;
  let gestures: TouchGestures | null = null;
  if (lockByte !== undefined) {
    if (layout === 'modern') {
      // One bit per gesture, plus bit 7 = touch enabled. Locked is the absence of bit 7.
      touchLocked = (lockByte & 0x80) === 0;
      gestures = {
        hold: (lockByte & 0x01) !== 0,
        triple: (lockByte & 0x02) !== 0,
        double: (lockByte & 0x04) !== 0,
        single: (lockByte & 0x08) !== 0,
        doubleForCalls: (lockByte & 0x10) !== 0,
        holdForCalls: (lockByte & 0x20) !== 0,
      };
    } else touchLocked = lockByte === 1;
  }

  let noiseMode: number | null = null;
  const noiseByte = offsets.noise === null ? undefined : at(offsets.noise);
  if (noiseByte !== undefined) {
    if (model.noise === 'ambient') noiseMode = noiseByte ? 2 : 0;
    else if (model.noise === 'anc') noiseMode = noiseByte === 1 ? 1 : 0;
    else if (model.noise === 'modes') noiseMode = noiseByte;
  }

  const ambientByte = offsets.ambient === null || model.ambientMax === null ? undefined : at(offsets.ambient);

  const touchByte = model.touchMap === null ? undefined : at(offsets.touch);
  const touchOptions = touchByte === undefined ? null : { left: touchByte >> 4, right: touchByte & 0x0f };

  let colour: number | null = null;
  if (offsets.colour !== null && payload.length >= offsets.colour + 2) {
    colour = payload[offsets.colour] | (payload[offsets.colour + 1] << 8);
    if (colour === 0) colour = null;
  }

  let noiseTouch: ExtendedUpdate['noiseTouch'] = null;
  const cycleByte = model.noiseCycle ? at(21) : undefined;
  if (model.noiseCycle && cycleByte !== undefined) {
    const right = noiseSet(cycleByte, 0);
    // Before the revision that gave the left earbud a setting of its own, one setting covers both.
    const sharedSide = model.noiseCycle.dualSideFrom !== null && payload[0] < model.noiseCycle.dualSideFrom;
    noiseTouch = { right, left: sharedSide ? right : noiseSet(cycleByte, 4) };
  }

  return {
    ...base,
    earType: payload[1],
    colour,
    battery,
    placement,
    eq,
    touchLocked,
    gestures,
    noiseMode,
    ambientLevel: ambientByte ?? null,
    touchOptions,
    noiseTouch,
  };
}

/** `NoiseControlsUpdate` (0x77): `[mode, wear?]`. */
export function decodeNoiseUpdate(payload: Uint8Array): number | null {
  return payload.length >= 1 ? payload[0] : null;
}

/** An ack (0x42): the request id it answers, then whatever result the request defines. */
export function decodeAck(payload: Uint8Array): { id: number; rest: Uint8Array } | null {
  return payload.length >= 1 ? { id: payload[0], rest: payload.subarray(1) } : null;
}

const ascii = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .filter((byte) => byte >= 0x20 && byte < 0x7f)
    .map((byte) => String.fromCharCode(byte))
    .join('')
    .trim();

/** `DebugSku` (0x22): two 14-byte strings, left then right. Empty strings mean the earbuds sent none. */
export function decodeSku(payload: Uint8Array): { left: string; right: string } {
  return { left: ascii(payload.subarray(0, 14)), right: ascii(payload.subarray(14, 28)) };
}

const SW_MONTH = 'ABCDEFGHIJKL';
const SW_YEAR = 'OPQRSTUVWXYZ';
const SW_RELEASE = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The vendor's build-id format, rebuilt from three bytes (`DebugModeVersionDecoder.cs:38-52`). */
function buildId(payload: Uint8Array, at: number, prefix: string, legacy: boolean): string | null {
  const [variant, date, release] = [payload[at], payload[at + 1], payload[at + 2]];
  if (variant === undefined || date === undefined || release === undefined) return null;
  const year = SW_YEAR[date >> 4];
  const month = SW_MONTH[date & 0x0f];
  const rel = legacy && release <= 15 ? release.toString(16).toUpperCase() : SW_RELEASE[legacy ? release - 16 : release];
  if (!year || !month || !rel) return null;
  return `R${prefix}XX${variant === 0 ? 'E' : 'U'}0A${year}${month}${rel}`;
}

/** The part of a SKU that follows `R` — `SM-R510` and `R170` both give their number. */
const buildPrefix = (model: SamsungModel): string => (model.sku ?? '').replace(/^SM-/, '').replace(/^R/, '');

/**
 * `VersionInfo` (0x63): `[hwL, hwR, swL(3), swR(3), touchL, touchR]`. The
 * software version is a date-coded build id the vendor tool assembles
 * client-side, so this is a reconstruction, not a string the device sends.
 */
export function decodeVersion(
  payload: Uint8Array,
  model: SamsungModel,
): { hardware: string; left: string | null; right: string | null } | null {
  if (payload.length < 8) return null;
  const rev = (byte: number): string => `rev${(byte >> 4).toString(16).toUpperCase()}.${(byte & 0x0f).toString(16).toUpperCase()}`;
  const prefix = buildPrefix(model);
  const legacy = model.layout === 'legacy';
  return {
    hardware: rev(payload[0]),
    left: prefix ? buildId(payload, 2, prefix, legacy) : null,
    right: prefix ? buildId(payload, 5, prefix, legacy) : null,
  };
}
