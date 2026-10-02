import { describe, expect, it } from 'vitest';

import { EOM, FrameDecoder, SOM, crc16, encodeFrame } from './frame';

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

describe('crc16 (CRC-16/XMODEM)', () => {
  it('matches the catalogue check value for "123456789"', () => {
    expect(crc16([...'123456789'].map((c) => c.charCodeAt(0)))).toBe(0x31c3);
  });

  it('is 0 for nothing', () => {
    expect(crc16([])).toBe(0);
  });

  it("matches the real extended-status frame in GalaxyBudsClient's own notes", () => {
    // `Utils/Crc16.cs`: message id 0x61 and its payload, then CRC1 = 0x0F, CRC2 = 0xF3 — low byte first.
    const body = [0x61, 0x02, 0x00, 0x4b, 0x5f, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x00, 0x02, 0x00, 0x13];
    expect([crc16(body) & 0xff, crc16(body) >> 8]).toEqual([0x0f, 0xf3]);
  });
});

describe('frames MagicPodsCore carries from real Buds3 Pro sessions (`src/tests/TestsSgb.cpp`)', () => {
  const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

  it('encodes NoiseControls = adaptive to exactly the bytes a real session sent', () => {
    // `TestChecksum2`: "fd04007803 93 b1 dd".
    expect(hex(encodeFrame(0x78, [3]))).toBe('fd04007803' + '93b1dd');
  });

  it('encodes NoiseControls = off to the bytes `TestEncode1` expects', () => {
    // `TestEncode1` (the leading 0 there is its unset start byte): 04 00 78 00 f0 81, then the end byte.
    expect(hex(encodeFrame(0x78, [0])).slice(2, -2)).toBe('0400780' + '0f081');
  });

  it('decodes a real NoiseControlsUpdate push (0x77) with a valid CRC', () => {
    // `TestAnc3`: [mode 0, wear 0x11, ...].
    const wire = Uint8Array.from([253, 10, 0, 119, 0, 17, 1, 0, 13, 13, 1, 77, 166, 221]);
    const [frame] = new FrameDecoder().push(wire);
    expect(frame.id).toBe(0x77);
    expect(frame.payload[0]).toBe(0);
  });
});

describe('encodeFrame', () => {
  it('lays out a standard frame: FD, length LE, id, payload, CRC LE, DD', () => {
    const frame = encodeFrame(0x78, [0x01]);
    const crc = crc16([0x78, 0x01]);
    expect([...frame]).toEqual([SOM, 0x04, 0x00, 0x78, 0x01, crc & 0xff, crc >> 8, EOM]);
  });

  it('counts id, payload and CRC in the length, so a frame is length + 4 bytes', () => {
    const frame = encodeFrame(0x90, [1, 2, 3, 4, 5]);
    expect(frame[1]).toBe(8);
    expect(frame.length).toBe(8 + 4);
  });

  it('sets the response bit (0x10 of the high byte) only when asked', () => {
    expect(encodeFrame(0x61, [0])[2]).toBe(0x00);
    expect(encodeFrame(0x61, [0], { response: true })[2]).toBe(0x10);
  });

  it('carries a payload past 255 bytes in the 10-bit length', () => {
    const frame = encodeFrame(0x50, new Array(300).fill(7));
    expect(frame[1] | ((frame[2] & 0x03) << 8)).toBe(303);
    expect(frame.length).toBe(307);
  });

  it('writes the legacy variant as FE, type, length, id, payload, CRC, EE', () => {
    const frame = encodeFrame(0x80, [1], { variant: 'legacy' });
    const crc = crc16([0x80, 1]);
    expect([...frame]).toEqual([0xfe, 0x00, 0x04, 0x80, 0x01, crc & 0xff, crc >> 8, 0xee]);
    expect(encodeFrame(0x80, [1], { variant: 'legacy', response: true })[1]).toBe(1);
  });
});

describe('FrameDecoder', () => {
  it('round-trips a frame', () => {
    const [frame] = new FrameDecoder().push(encodeFrame(0x86, [3]));
    expect(frame.id).toBe(0x86);
    expect([...frame.payload]).toEqual([3]);
    expect(frame.response).toBe(false);
  });

  it('reads the response bit and the fragment bit', () => {
    const wire = encodeFrame(0x61, [0], { response: true });
    expect(new FrameDecoder().push(wire)[0].response).toBe(true);
    const fragment = Uint8Array.from(wire);
    fragment[2] |= 0x20;
    // The flag is outside the CRC, so setting it leaves the frame valid.
    expect(new FrameDecoder().push(fragment)[0].fragment).toBe(true);
  });

  it('reassembles a frame split across chunks, down to single bytes', () => {
    const decoder = new FrameDecoder();
    const wire = encodeFrame(0x60, [1, 2, 3, 4]);
    const frames = [...wire].flatMap((byte) => decoder.push(bytes(byte)));
    expect(frames).toHaveLength(1);
    expect([...frames[0].payload]).toEqual([1, 2, 3, 4]);
  });

  it('splits frames that arrive coalesced in one chunk', () => {
    const wire = Uint8Array.from([...encodeFrame(0x60, [1]), ...encodeFrame(0x61, [2, 3])]);
    const frames = new FrameDecoder().push(wire);
    expect(frames.map((frame) => frame.id)).toEqual([0x60, 0x61]);
  });

  it('keeps a trailing partial frame until the rest arrives', () => {
    const decoder = new FrameDecoder();
    const wire = Uint8Array.from([...encodeFrame(0x60, [1]), ...encodeFrame(0x61, [2, 3])]);
    expect(decoder.push(wire.slice(0, wire.length - 3))).toHaveLength(1);
    expect(decoder.push(wire.slice(wire.length - 3))).toHaveLength(1);
  });

  it('skips garbage before and between frames', () => {
    const wire = Uint8Array.from([0x00, 0xaa, 0x55, ...encodeFrame(0x60, [1]), 0x13, 0x37, ...encodeFrame(0x61, [2])]);
    expect(new FrameDecoder().push(wire).map((frame) => frame.id)).toEqual([0x60, 0x61]);
  });

  it('drops a frame with a bad CRC and still decodes the next one', () => {
    const bad = Uint8Array.from(encodeFrame(0x60, [1, 2]));
    bad[4] ^= 0xff;
    const wire = Uint8Array.from([...bad, ...encodeFrame(0x61, [9])]);
    const frames = new FrameDecoder().push(wire);
    expect(frames.map((frame) => frame.id)).toEqual([0x61]);
  });

  it('drops a frame whose last byte is not DD', () => {
    const bad = Uint8Array.from(encodeFrame(0x60, [1]));
    bad[bad.length - 1] = 0x00;
    expect(new FrameDecoder().push(bad)).toEqual([]);
  });

  it('treats an FD inside a payload as data, not a new frame', () => {
    const [frame] = new FrameDecoder().push(encodeFrame(0x61, [0xfd, 0xfd, 0x03, 0x00]));
    expect([...frame.payload]).toEqual([0xfd, 0xfd, 0x03, 0x00]);
  });

  it('rejects an implausible length rather than waiting for it', () => {
    const decoder = new FrameDecoder();
    // FD with length 1 (< id + CRC) is not a header; the real frame behind it must still decode.
    const wire = Uint8Array.from([SOM, 0x01, 0x00, ...encodeFrame(0x60, [1])]);
    expect(decoder.push(wire).map((frame) => frame.id)).toEqual([0x60]);
  });

  it('decodes the legacy variant and ignores FD frames in it', () => {
    const decoder = new FrameDecoder('legacy');
    const frames = decoder.push(
      Uint8Array.from([...encodeFrame(0x60, [1]), ...encodeFrame(0x61, [4, 5], { variant: 'legacy', response: true })]),
    );
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ id: 0x61, response: true });
    expect([...frames[0].payload]).toEqual([4, 5]);
  });

  it('forgets a partial frame on reset', () => {
    const decoder = new FrameDecoder();
    const wire = encodeFrame(0x60, [1, 2]);
    decoder.push(wire.slice(0, 4));
    decoder.reset();
    expect(decoder.push(wire.slice(4))).toEqual([]);
  });
});
