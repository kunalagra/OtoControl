/** Noise control: `0x010C` reply, `0x0204` event 3 push, `0x0404` write. */

/** Outer `0x0204` subtype for a noise-reduction event, from `commands/g.java`. */
const NOISE_REDUCTION_SUBTYPE = 3;

/**
 * `modeIndex` is the index of the single lowest set bit — **which one mode is
 * currently active, not a list of every mode this device supports.**
 * Corrected from an earlier `supportedModes: number[]` reading: the APK's own
 * `CurrentNoiseModeInfo` DTO exposes exactly one consumer-facing accessor,
 * `getCurrentNoiseReductionModeIndex()`, which loops the decoded bits and
 * returns the *first* true one — there is no accessor anywhere that exposes
 * the bits as a set of independently-true options. The real "which modes does
 * this model support" answer lives in the cloud/bundled whitelist config
 * (`WhitelistConfigDTO.NoiseReductionMode`), a completely separate mechanism
 * from this DTO — the two concepts never overlap in the APK's own design.
 * `null` when no bit is set.
 */
export interface CurrentNoiseModeInfo {
  kind: 'currentMode';
  modeIndex: number | null;
  level: number | null;
}

export interface NoiseReductionInfo {
  kind: 'reduction';
  action: number;
  type: number;
  value: number;
}

/** Same one-hot correction as `CurrentNoiseModeInfo.modeIndex` above, and for
 * the same reason: 1812z/OppoPods's `SmartAncLevelParser` (independently,
 * for this exact DTO — "smart mode" is this project's `commands/g.java`
 * inner-type 4) decodes this identical bitmask down to a single "currently
 * smart-applied level", never a list. */
export interface IntelligentNoiseModeInfo {
  kind: 'intelligentMode';
  modeIndex: number | null;
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

/** The lowest set bit's index, or null if none is set — "which one", not "which ones". */
function firstSetBit(bytes: Uint8Array): number | null {
  const bits = decodeBitmask(bytes);
  return bits.length > 0 ? bits[0] : null;
}

/** Little-endian decode of 1-4 bytes into a number. */
function decodeLEValue(bytes: Uint8Array): number {
  let value = 0;
  for (let i = 0; i < bytes.length; i += 1) value |= bytes[i] << (i * 8);
  return value >>> 0;
}

/**
 * `CurrentNoiseModeInfo`'s own body, shared by both places it appears:
 * the `0x0204` notification (behind an outer envelope, see below) and
 * `0x010C`'s direct-query reply (bare — see `decodeAncDirectQuery`).
 * `[mType(1), ...]`: mType=1 -> LSB-first bitmask of supported modes;
 * mType=2 -> a single level byte; anything else -> nothing decodable.
 * Returns null for a truncated payload that doesn't contain the required bytes.
 */
function decodeCurrentNoiseModeDto(dto: Uint8Array): CurrentNoiseModeInfo | null {
  if (dto.length < 1) return null;
  const mType = dto[0];
  if (mType === 1) {
    // mType=1: bitmask follows, requires at least 1 byte of mask
    if (dto.length < 2) return null;
    return { kind: 'currentMode', modeIndex: firstSetBit(dto.slice(1)), level: null };
  }
  if (mType === 2) {
    // mType=2: single level byte follows
    if (dto.length < 2) return null;
    return { kind: 'currentMode', modeIndex: null, level: dto[1] };
  }
  return { kind: 'currentMode', modeIndex: null, level: null };
}

/**
 * `0x0204` unsolicited notification, noise-reduction subtype: `[outerSubtype,
 * innerType, ...dtoBytes]`. `innerType` (`commands/g.java`'s dispatch byte)
 * selects one of three DTOs — see spec §3.6.
 * Returns null for any subtype/type this driver does not model, or for
 * truncated payloads that don't contain the required bytes.
 */
export function decodeAncNotification(payload: Uint8Array): AncEvent | null {
  if (payload.length < 2 || payload[0] !== NOISE_REDUCTION_SUBTYPE) return null;
  const body = payload.slice(1);
  // realme Link's `NotificationCommandManager` (event 3): a 2-byte body is
  // `[type, value]` with the action fixed at 1, not `[innerType, mType]`.
  if (body.length === 2) return decodeCurrentNoiseModeDto(body);
  return decodeAncBody(body);
}

/**
 * The noise-reduction body shared by the `0x0204` push (after its subtype
 * byte) and the `0x010C` reply (after its status byte): `[innerType, ...dto]`.
 * realme Link names the same bytes `[action, type, value]` — `action` is this
 * `innerType` (1/2/4), `type` is the DTO's `mType`.
 */
function decodeAncBody(body: Uint8Array): AncEvent | null {
  if (body.length < 1) return null;
  const innerType = body[0];
  const dto = body.slice(1);

  if (innerType === 1) return decodeCurrentNoiseModeDto(dto);

  if (innerType === 2 || innerType === 3) {
    // NoiseReductionInfo starts at the inner-type byte, so action == innerType
    // (HeyTap's `0x810C` handler: `NoiseReductionInfo(1, data)`; realme `NoiseReductionInfo(i2, bArr)`).
    if (body.length < 3) return null;
    return { kind: 'reduction', action: body[0], type: body[1], value: decodeLEValue(body.slice(2, 6)) };
  }

  if (innerType === 4) {
    // IntelligentNoiseModeInfo: requires mType byte
    if (dto.length < 1) return null;
    const mType = dto[0];
    if (mType === 1) {
      // mType=1: bitmask follows, requires at least 1 byte of mask
      if (dto.length < 2) return null;
      return { kind: 'intelligentMode', modeIndex: firstSetBit(dto.slice(1)) };
    }
    return { kind: 'intelligentMode', modeIndex: null };
  }

  return null;
}

/**
 * `0x010C` direct-query reply: `[status(1)][action][type][value]` — confirmed
 * by realme Link's `PollCommandManager.a0()`, which gates on byte 0 and builds
 * `NoiseReductionInfo(1, …)` from the rest. After the status byte it is the
 * same body the `0x0204` push carries after its subtype. Reading it without
 * the status byte took status 0 as an unrecognised type and decoded
 * `{modeIndex: null, level: null}` — ANC "supported" with nothing to show.
 */
export function decodeAncDirectQuery(payload: Uint8Array): AncEvent | null {
  if (payload.length < 1 || payload[0] !== 0) return null;
  return decodeAncBody(payload.slice(1));
}

/**
 * Set-ANC-mode (`0x0404`) request payload: `[0x01, 0x01, <bitmap>]`, with
 * exactly one bit set at `protocolIndex` (extending the bitmap to more bytes
 * once the index needs them) — **not** a raw mode index passed straight
 * through, which is what this driver originally shipped with no basis at
 * all. Which bit means which named mode differs per model; resolving a name
 * to its `protocolIndex` is `ancModel.ts`'s job (`buildAncCapabilities`),
 * this function only builds the bytes for an already-resolved index.
 *
 * Byte-exact against Leaf-lsgtky/OppoPods's own
 * `CapabilityProfileFactory.ancPayload()` worked examples — protocolIndex 1
 * -> `01 01 02`, 2 -> `01 01 04`, 11 -> `01 01 00 08` — explicitly noted
 * there as tested against real Enco X3/Free4 hardware, not a guess.
 */
export function encodeSetAncMode(protocolIndex: number): number[] {
  const byteCount = Math.floor(protocolIndex / 8) + 1;
  const bitmap = new Array<number>(byteCount).fill(0);
  bitmap[Math.floor(protocolIndex / 8)] = 1 << (protocolIndex % 8);
  return [0x01, 0x01, ...bitmap];
}
