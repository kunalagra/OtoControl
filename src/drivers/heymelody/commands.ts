/**
 * HeyMelody command ids and payload codecs.
 *
 * Every byte layout is derived from the app's own decompiled parsing code
 * (`CommandUtil.java`, `com.oplus.melody.btsdk.protocol.commands.c`) — see
 * docs/superpowers/specs/2026-08-27-heymelody-driver-design.md §3.4/§3.6 for
 * exactly what is APK-confirmed versus corroborated versus this driver's own
 * documented assumption. Never ported from OppoPodsManager or its ancestors
 * (all GPL, read-only reference per `core/profiles.ts`'s standing rule).
 */

export const Cmd = {
  QueryProductId: 0x0103,
  Battery: 0x0106,
  QueryAncDirect: 0x010c,
  QueryEqCurrent: 0x010f,
  QueryEqAll: 0x0122,
  SetAncMode: 0x0404,
  SetEqPreset: 0x0406,
  RegisterNotify: 0x0205,
  ActiveReport: 0x0204,
} as const;

/** Response cmd = request cmd | 0x8000, on both transports. */
export const replyFor = (cmd: number): number => cmd | 0x8000;

// --- identification ---------------------------------------------------------

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

// --- battery -----------------------------------------------------------------

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
 * `[count(1)][deviceType(1), packed(1)] x count` — `CommandUtil.d()`.
 * `packed`'s low 7 bits are level (0-100), bit 7 is the charging flag.
 * A `deviceType` outside 1-3 is skipped rather than thrown on: firmware
 * variance here is expected, not corruption. `count` is clamped to the actual
 * payload length to prevent reading undefined bytes from truncated payloads.
 */
export function decodeBattery(payload: Uint8Array): BatteryCell[] {
  if (payload.length === 0) return [];
  const count = Math.min(payload[0], Math.floor((payload.length - 1) / 2));
  const cells: BatteryCell[] = [];
  for (let i = 0; i < count; i += 1) {
    const deviceType = payload[1 + i * 2];
    const packed = payload[2 + i * 2];
    const device = BATTERY_DEVICE_TYPE[deviceType];
    if (!device) continue;
    cells.push({ device, level: packed & 0x7f, charging: (packed & 0x80) !== 0 });
  }
  return cells;
}

// --- ANC ---------------------------------------------------------------------

/** Outer `0x0204` subtype for a noise-reduction event, from `commands/g.java`. */
const NOISE_REDUCTION_SUBTYPE = 3;

export interface CurrentNoiseModeInfo {
  kind: 'currentMode';
  supportedModes: number[] | null;
  level: number | null;
}

export interface NoiseReductionInfo {
  kind: 'reduction';
  action: number;
  type: number;
  value: number;
}

export interface IntelligentNoiseModeInfo {
  kind: 'intelligentMode';
  supportedModes: number[] | null;
}

export type AncEvent = CurrentNoiseModeInfo | NoiseReductionInfo | IntelligentNoiseModeInfo;

/** LSB-first bit indices set across every byte, e.g. `[0b101]` -> `[0, 2]`. */
function decodeBitmask(bytes: Uint8Array): number[] {
  const bits: number[] = [];
  for (let byteIndex = 0; byteIndex < bytes.length; byteIndex += 1) {
    for (let bit = 0; bit < 8; bit += 1) {
      if (bytes[byteIndex] & (1 << bit)) bits.push(byteIndex * 8 + bit);
    }
  }
  return bits;
}

/** Little-endian decode of 1-4 bytes into a number. */
function decodeLEValue(bytes: Uint8Array): number {
  let value = 0;
  for (let i = 0; i < bytes.length; i += 1) value |= bytes[i] << (i * 8);
  return value >>> 0;
}

/**
 * `0x0204` unsolicited notification, noise-reduction subtype: `[outerSubtype,
 * innerType, ...dtoBytes]`. `innerType` (`commands/g.java`'s dispatch byte,
 * called `b12` in the notes) selects one of three DTOs — see spec §3.6.
 * Returns null for any subtype/type this driver does not model, or for
 * truncated payloads that don't contain the required bytes.
 */
export function decodeAncNotification(payload: Uint8Array): AncEvent | null {
  // Check minimum length for outer structure (outerSubtype + innerType)
  if (payload.length < 2) return null;

  if (payload[0] !== NOISE_REDUCTION_SUBTYPE) return null;
  const innerType = payload[1];
  const dto = payload.slice(2);

  if (innerType === 1) {
    // CurrentNoiseModeInfo: requires at least mType byte
    if (dto.length < 1) return null;
    const mType = dto[0];
    if (mType === 1) {
      // mType=1: bitmask follows, requires at least 1 byte of mask
      if (dto.length < 2) return null;
      return { kind: 'currentMode', supportedModes: decodeBitmask(dto.slice(1)), level: null };
    }
    if (mType === 2) {
      // mType=2: single level byte follows
      if (dto.length < 2) return null;
      return { kind: 'currentMode', supportedModes: null, level: dto[1] };
    }
    return { kind: 'currentMode', supportedModes: null, level: null };
  }

  if (innerType === 2) {
    // NoiseReductionInfo: requires action(1) + type(1) + value(2+ LE bytes)
    if (dto.length < 4) return null;
    const action = dto[0];
    const type = dto[1];
    const value = decodeLEValue(dto.slice(2, 6));
    return { kind: 'reduction', action, type, value };
  }

  if (innerType === 4) {
    // IntelligentNoiseModeInfo: requires mType byte
    if (dto.length < 1) return null;
    const mType = dto[0];
    if (mType === 1) {
      // mType=1: bitmask follows, requires at least 1 byte of mask
      if (dto.length < 2) return null;
      return { kind: 'intelligentMode', supportedModes: decodeBitmask(dto.slice(1)) };
    }
    return { kind: 'intelligentMode', supportedModes: null };
  }

  return null;
}

/**
 * Set-ANC-mode (`0x0404`) request payload. Not derived from the app or any
 * reference — the simplest shape consistent with the read-side DTOs above.
 * See spec §3.4/§6: first thing to verify against real hardware.
 */
export function encodeSetAncMode(mode: number): number[] {
  return [mode];
}

// --- EQ ------------------------------------------------------------------

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

/** `0x010F` response: just the active preset index, u16 LE, no status byte. */
export function decodeEqCurrent(payload: Uint8Array): number {
  if (payload.length < 2) {
    throw new Error(`EQ current-preset payload too short: expected at least 2 bytes, got ${payload.length}`);
  }
  return payload[0] | (payload[1] << 8);
}

/**
 * `0x0122` response — `CommandUtil.b()` / "parseAllEqData". Every preset
 * carries a full per-band curve, not just an index. See spec §3.4 for why
 * `0x0122` rather than `0x010F` serves this richer format.
 */
export function decodeEqAll(payload: Uint8Array): EqPreset[] {
  if (payload.length < 1) {
    throw new Error(`EQ all-presets payload too short: expected at least 1 byte for count, got ${payload.length}`);
  }

  const count = payload[0];
  const presets: EqPreset[] = [];
  let offset = 1;

  for (let i = 0; i < count; i += 1) {
    // Check that the fixed 5-byte preset header can be read
    if (offset + 5 > payload.length) {
      throw new Error(`EQ preset #${i} header truncated: expected 5 bytes at offset ${offset}, but only ${payload.length - offset} bytes available`);
    }

    const isSelected = payload[offset] !== 0;
    const minValue = signedByte(payload[offset + 1]);
    const maxValue = signedByte(payload[offset + 2]);
    const eqId = payload[offset + 3];
    const nameLength = payload[offset + 4];
    const nameStart = offset + 5;

    // Check that the name bytes can be read
    if (nameStart + nameLength > payload.length) {
      throw new Error(`EQ preset #${i} name truncated: expected ${nameLength} bytes at offset ${nameStart}, but only ${payload.length - nameStart} bytes available`);
    }

    const name = textDecoder.decode(payload.slice(nameStart, nameStart + nameLength));

    const frequencyNumOffset = nameStart + nameLength;

    // Check that frequencyNum byte can be read
    if (frequencyNumOffset >= payload.length) {
      throw new Error(`EQ preset #${i} frequencyNum byte missing: expected 1 byte at offset ${frequencyNumOffset}, but payload ends at ${payload.length}`);
    }

    const frequencyNum = payload[frequencyNumOffset];
    const bands: EqBand[] = [];
    let bandOffset = frequencyNumOffset + 1;

    for (let b = 0; b < frequencyNum; b += 1) {
      // Check that the 3-byte band entry can be read
      if (bandOffset + 3 > payload.length) {
        throw new Error(`EQ preset #${i} band #${b} truncated: expected 3 bytes at offset ${bandOffset}, but only ${payload.length - bandOffset} bytes available`);
      }

      const frequency = payload[bandOffset] | (payload[bandOffset + 1] << 8);
      const dbValue = signedByte(payload[bandOffset + 2]);
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
