import { describe, expect, it } from 'vitest';
import { decodeAncDirectQuery, decodeAncNotification, encodeSetAncMode } from './anc';

describe('decodeAncNotification', () => {
  it('decodes CurrentNoiseModeInfo from a bitmask (mType 1), taking the lowest set bit', () => {
    // outer subtype=3 (noise-reduction event), inner type=1 (CurrentNoiseModeInfo),
    // DTO bytes: mType=1, mask=0b00000101 -> bits 0 and 2 set; the lowest
    // set bit (0) is the one currently-active mode, not a list of both.
    const event = decodeAncNotification(Uint8Array.from([3, 1, 1, 0b0000_0101]));
    expect(event).toEqual({ kind: 'currentMode', modeIndex: 0, level: null });
  });

  it('decodes CurrentNoiseModeInfo with a single level (mType 2)', () => {
    const event = decodeAncNotification(Uint8Array.from([3, 1, 2, 50]));
    expect(event).toEqual({ kind: 'currentMode', modeIndex: null, level: 50 });
  });

  it('decodes NoiseReductionInfo from the inner-type byte itself (HeyTap 0x810C handler, realme NoiseReductionInfo)', () => {
    // body: innerType=2 (is also the action), type=1, value=0x000a LE
    expect(decodeAncNotification(Uint8Array.from([3, 2, 1, 0x0a, 0x00]))).toEqual({ kind: 'reduction', action: 2, type: 1, value: 10 });
    expect(decodeAncNotification(Uint8Array.from([3, 3, 1, 0x04]))).toEqual({ kind: 'reduction', action: 3, type: 1, value: 4 });
  });

  it('decodes a 0x010C reduction reply the same way, after its status byte', () => {
    expect(decodeAncDirectQuery(Uint8Array.from([0x00, 2, 1, 0x08]))).toEqual({ kind: 'reduction', action: 2, type: 1, value: 8 });
  });

  it('decodes IntelligentNoiseModeInfo from a bitmask (mType 1)', () => {
    const event = decodeAncNotification(Uint8Array.from([3, 4, 1, 0b0000_0010]));
    expect(event).toEqual({ kind: 'intelligentMode', modeIndex: 1 });
  });

  it('decodes IntelligentNoiseModeInfo with an unrecognised mType as no mode', () => {
    const event = decodeAncNotification(Uint8Array.from([3, 4, 2, 0]));
    expect(event).toEqual({ kind: 'intelligentMode', modeIndex: null });
  });

  it('returns null for a non-noise-reduction outer subtype', () => {
    expect(decodeAncNotification(Uint8Array.from([7, 1, 1, 0]))).toBeNull();
  });

  it('returns null for an unrecognised inner type', () => {
    expect(decodeAncNotification(Uint8Array.from([3, 9, 0, 0]))).toBeNull();
  });

  it('returns null for a truncated payload (< 2 bytes)', () => {
    expect(decodeAncNotification(Uint8Array.from([3]))).toBeNull();
    expect(decodeAncNotification(Uint8Array.from([]))).toBeNull();
  });

  it('returns null for innerType=1 with truncated DTO (missing mType)', () => {
    expect(decodeAncNotification(Uint8Array.from([3, 1]))).toBeNull();
  });

  it('returns null for a reduction body without action, type and a value byte', () => {
    // (A 2-byte body is the separate [type, value] push form, tested below.)
    expect(decodeAncNotification(Uint8Array.from([3, 2]))).toBeNull();
    expect(decodeAncDirectQuery(Uint8Array.from([0x00, 2, 1]))).toBeNull();
  });

  it('returns null for innerType=4 with missing mType', () => {
    expect(decodeAncNotification(Uint8Array.from([3, 4]))).toBeNull();
  });

  it('decodes the 2-byte push form [type, value] as an implied currentMode action', () => {
    // realme Link NotificationCommandManager: a 2-byte ANC push carries
    // type+value only, with action fixed at 1.
    expect(decodeAncNotification(Uint8Array.from([3, 1, 0b0000_1000]))).toEqual({
      kind: 'currentMode',
      modeIndex: 3,
      level: null,
    });
    expect(decodeAncNotification(Uint8Array.from([3, 2, 40]))).toEqual({
      kind: 'currentMode',
      modeIndex: null,
      level: 40,
    });
  });
});

describe('encodeSetAncMode', () => {
  it('matches Leaf-lsgtky/OppoPods\'s own worked examples byte-for-byte', () => {
    // CapabilityProfileFactory.ancPayload()'s own doc comment: protocolIndex
    // 1 -> "01 01 02", 2 -> "01 01 04", 11 -> "01 01 00 08" — noted there as
    // tested against real Enco X3/Free4 hardware.
    expect(encodeSetAncMode(1)).toEqual([0x01, 0x01, 0x02]);
    expect(encodeSetAncMode(2)).toEqual([0x01, 0x01, 0x04]);
    expect(encodeSetAncMode(11)).toEqual([0x01, 0x01, 0x00, 0x08]);
  });

  it('sets bit 0 for protocolIndex 0', () => {
    expect(encodeSetAncMode(0)).toEqual([0x01, 0x01, 0x01]);
  });

  it('extends the bitmap by a byte for every 8 indices', () => {
    expect(encodeSetAncMode(7)).toEqual([0x01, 0x01, 0x80]);
    expect(encodeSetAncMode(8)).toEqual([0x01, 0x01, 0x00, 0x01]);
    expect(encodeSetAncMode(16)).toEqual([0x01, 0x01, 0x00, 0x00, 0x01]);
  });
});

describe('decodeAncDirectQuery', () => {
  it('decodes [status][action][type][value] — the notification body behind a status byte', () => {
    // status=0, action=1 (currentMode), type=1 (bitmask), value=0b1000 -> mode 3.
    const event = decodeAncDirectQuery(Uint8Array.from([0x00, 1, 1, 0b0000_1000]));
    expect(event).toEqual({ kind: 'currentMode', modeIndex: 3, level: null });
  });

  it('decodes a single level (type 2)', () => {
    const event = decodeAncDirectQuery(Uint8Array.from([0x00, 1, 2, 50]));
    expect(event).toEqual({ kind: 'currentMode', modeIndex: null, level: 50 });
  });

  it('does not read the status byte as the DTO type', () => {
    // Read without the status byte, 0x00 fell to "unrecognised type" and
    // decoded as {modeIndex: null, level: null} — accepted as ANC support
    // with nothing to show: "did not answer the noise control query".
    const event = decodeAncDirectQuery(Uint8Array.from([0x00, 1, 1, 0b0000_1000]));
    expect(event).not.toEqual({ kind: 'currentMode', modeIndex: null, level: null });
  });

  it('returns null for a non-zero status or an empty payload', () => {
    expect(decodeAncDirectQuery(Uint8Array.from([0x01, 1, 1, 0b1000]))).toBeNull();
    expect(decodeAncDirectQuery(Uint8Array.from([]))).toBeNull();
  });

  it('returns null for a truncated body', () => {
    expect(decodeAncDirectQuery(Uint8Array.from([0x00]))).toBeNull();
    expect(decodeAncDirectQuery(Uint8Array.from([0x00, 1, 1]))).toBeNull();
    expect(decodeAncDirectQuery(Uint8Array.from([0x00, 1, 2]))).toBeNull();
  });
});
