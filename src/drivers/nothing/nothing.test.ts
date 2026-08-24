import { describe, expect, it } from 'vitest';

import { NothingDecoder, crc16, encodePacket } from './frame';
import * as C from './commands';
import { NOTHING_MODELS } from './models';
import { replyFor } from './client';

const hex = (bytes: Uint8Array | number[]): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

describe('Nothing framing', () => {
  // Vectors computed independently against ear-web's crc16/packet code
  // (res/js/bluetooth_socket.js) — same algorithm, so the bytes must match.
  it('encodes a battery read exactly as ear-web would', () => {
    expect(hex(encodePacket(0xc007, 1))).toBe('55600107c0000001acdf');
  });

  it('encodes an ANC write with its payload', () => {
    expect(hex(encodePacket(0xf00f, 2, [0x01, 0x05, 0x00]))).toBe('5560010ff0030002010500fb53');
  });

  it('decodes a frame it encoded, across a chunk split', () => {
    const packet = encodePacket(0xc01f, 7, [0x05]);
    const decoder = new NothingDecoder();
    const first = decoder.push(packet.slice(0, 5));
    expect(first).toEqual([]);
    const frames = decoder.push(packet.slice(5));
    expect(frames).toHaveLength(1);
    expect(frames[0].command).toBe(0xc01f);
    expect(frames[0].sequence).toBe(7);
    expect(Array.from(frames[0].payload)).toEqual([0x05]);
    expect(frames[0].crcOk).toBe(true);
  });

  it('drops leading garbage before the sync byte', () => {
    const decoder = new NothingDecoder();
    const packet = encodePacket(0xc007, 1);
    const frames = decoder.push(new Uint8Array([0x00, 0xff, ...packet]));
    expect(frames).toHaveLength(1);
    expect(frames[0].crcOk).toBe(true);
  });

  it('flags a corrupted CRC', () => {
    const packet = encodePacket(0xc007, 1);
    packet[packet.length - 1] ^= 0xff;
    const [frame] = new NothingDecoder().push(packet);
    expect(frame.crcOk).toBe(false);
  });

  it('matches the Modbus CRC of ear-web’s algorithm on a known input', () => {
    // crc16([0x01]) with init 0xFFFF / poly 0xA001.
    expect(crc16([0x01])).toBe(0x807e & 0xffff);
  });
});

describe('Nothing reply ids', () => {
  it('clears bit 15 of a read command', () => {
    expect(replyFor(C.Read.Battery)).toBe(0x4007);
    expect(replyFor(C.Read.Firmware)).toBe(0x4042);
    expect(replyFor(C.Read.AncMode)).toBe(0x401e);
  });
});

describe('Nothing payload codecs', () => {
  it('decodes a battery payload with charging bits', () => {
    const payload = Uint8Array.from([0x03, 0x02, 0x64, 0x03, 0x2a, 0x04, 0x87]);
    expect(C.decodeBattery(payload)).toEqual({
      left: { level: 100, charging: false },
      right: { level: 42, charging: false },
      case: { level: 7, charging: true },
    });
  });

  it('round-trips ANC levels through the wire-byte table', () => {
    for (const level of [1, 2, 3, 4, 5, 6]) {
      const encoded = C.encodeAncMode(level);
      expect(encoded).toHaveLength(3);
      const decoded = C.decodeAncMode(Uint8Array.from([0x01, encoded[1], 0x00]));
      expect(decoded).toBe(level);
    }
  });

  it('decodes firmware ASCII', () => {
    const text = 'US.B.1.0.2';
    expect(C.decodeFirmware(Uint8Array.from([...text].map((c) => c.charCodeAt(0))))).toBe(text);
  });

  it('round-trips a custom EQ through ear-web’s float quirk', () => {
    const bands: [number, number, number] = [6, 3, 0];
    const payload = Uint8Array.from(C.encodeCustomEq(bands));
    expect(payload).toHaveLength(53); // ear-web's fixed 51-byte body + count + 0
    expect(C.decodeCustomEq(payload)).toEqual(bands);
  });

  it('decodes gestures as count-terminated records', () => {
    const payload = Uint8Array.from([0x02, 0x02, 0x01, 0x02, 0x08, 0x03, 0x01, 0x07, 0x19]);
    expect(C.decodeGestures(payload)).toEqual([
      { device: 2, common: 1, type: 2, action: 8 },
      { device: 3, common: 1, type: 7, action: 0x19 },
    ]);
  });

  it('decodes enhanced bass with the halved level', () => {
    expect(C.decodeEnhancedBass(Uint8Array.from([0x01, 0x06]))).toEqual({
      enabled: true,
      level: 3,
    });
  });
});

describe('spatial audio', () => {
  it('decodes the one-byte form as spatial audio without head tracking', () => {
    expect(C.decodeSpatialAudio(Uint8Array.from([0x01]))).toEqual({
      enabled: true,
      headTracking: null,
    });
    expect(C.decodeSpatialAudio(Uint8Array.from([0x00]))).toEqual({
      enabled: false,
      headTracking: null,
    });
  });

  it('decodes the second byte as head tracking where the model sends it', () => {
    expect(C.decodeSpatialAudio(Uint8Array.from([0x01, 0x01]))).toEqual({
      enabled: true,
      headTracking: true,
    });
    expect(C.decodeSpatialAudio(Uint8Array.from([0x01, 0x00]))).toEqual({
      enabled: true,
      headTracking: false,
    });
  });

  it('returns null for an empty body rather than guessing a state', () => {
    expect(C.decodeSpatialAudio(Uint8Array.from([]))).toBeNull();
  });

  it('omits the second byte unless head tracking is being set', () => {
    // The official app sends one byte when there is no head tracking, not a
    // zero — `BasicBoolean.obtainDataPacket` branches on `hasHead`.
    expect(C.encodeSpatialAudio(true)).toEqual([0x01]);
    expect(C.encodeSpatialAudio(false)).toEqual([0x00]);
    expect(C.encodeSpatialAudio(true, null)).toEqual([0x01]);
    expect(C.encodeSpatialAudio(true, true)).toEqual([0x01, 0x01]);
    expect(C.encodeSpatialAudio(true, false)).toEqual([0x01, 0x00]);
    expect(C.encodeSpatialAudio(false, true)).toEqual([0x00, 0x01]);
  });

  it('round-trips every shape the wire can carry', () => {
    for (const bytes of [[0x00], [0x01], [0x00, 0x00], [0x01, 0x00], [0x01, 0x01]]) {
      const decoded = C.decodeSpatialAudio(Uint8Array.from(bytes))!;
      expect(C.encodeSpatialAudio(decoded.enabled, decoded.headTracking)).toEqual(bytes);
    }
  });
});

describe('ring my buds', () => {
  it('encodes the side byte then the play state', () => {
    expect(C.encodeRing('left', true)).toEqual([0x02, 0x01]);
    expect(C.encodeRing('right', true)).toEqual([0x03, 0x01]);
    // Stopping uses the same side byte with a silent second byte.
    expect(C.encodeRing('left', false)).toEqual([0x02, 0x00]);
  });
});

describe('device model', () => {
  it('reverses the payload and hex-encodes it, as the app does', () => {
    // A CMF Headphone Pro answers two bytes, little-endian: 0x75 0xB1.
    expect(C.decodeDeviceModel(Uint8Array.from([0x75, 0xb1]))).toBe('B175');
    expect(C.decodeDeviceModel(Uint8Array.from([0x62, 0xb1]))).toBe('B162');
    expect(C.decodeDeviceModel(Uint8Array.from([0x90, 0xb1]))).toBe('B190');
  });

  it('is not reading ASCII — the codes are hex digits, not text', () => {
    // The ASCII for "B175" decodes to something else entirely, which is what
    // the old scanning decoder wrongly expected to see.
    expect(C.decodeDeviceModel(Uint8Array.from([0x42, 0x31, 0x37, 0x35]))).toBe('35373142');
  });

  it('pads each byte to two digits', () => {
    expect(C.decodeDeviceModel(Uint8Array.from([0x05, 0x0a]))).toBe('0A05');
  });

  it('handles the four-byte ids the app uses for non-earphones', () => {
    // Watch Pro 2 is 34F72851 in the SKU catalogue.
    expect(C.decodeDeviceModel(Uint8Array.from([0x51, 0x28, 0xf7, 0x34]))).toBe('34F72851');
  });

  it('returns null only for an empty body', () => {
    expect(C.decodeDeviceModel(Uint8Array.from([]))).toBeNull();
    expect(C.decodeDeviceModel(Uint8Array.from([0x00]))).toBe('00');
  });

  it('every base code in the model table is four hex digits', () => {
    // Load-bearing: the decoder emits hex, so a non-hex base code could never
    // be matched by `modelForBase`.
    for (const model of NOTHING_MODELS) {
      expect(model.base).toMatch(/^[0-9A-FB]{4}$/);
    }
  });
});
