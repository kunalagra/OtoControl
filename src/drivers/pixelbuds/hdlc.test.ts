import { crc32 as zlibCrc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { CONTROL_UI, createHdlcDecoder, crc32, decodeAddress, encodeAddress, encodeFrame } from './hdlc';

const bytes = (...values: number[]) => Uint8Array.from(values);

describe('crc32', () => {
  it('matches pbpctrl’s test vectors', () => {
    expect(crc32(new TextEncoder().encode('1234321'))).toBe(0xd981751c);
    expect(crc32(new TextEncoder().encode('test test test'))).toBe(0x235b6a02);
  });

  it('agrees with zlib on arbitrary data', () => {
    const data = Uint8Array.from({ length: 300 }, (_, i) => (i * 37 + 11) & 0xff);
    expect(crc32(data)).toBe(zlibCrc32(data));
    expect(crc32([])).toBe(0);
  });
});

describe('address varint', () => {
  it('encodes MaestroA -> LeftBtCore (10 -> 3) as 00 3b', () => {
    // ((10 & 15) << 6) | ((3 & 15) << 10) = 3712 = 29 * 128 + 0
    expect(encodeAddress(3712)).toEqual([0x00, 0x3b]);
  });

  it('terminates a single byte with bit 0', () => {
    expect(encodeAddress(0)).toEqual([0x01]);
    expect(encodeAddress(0x7f)).toEqual([0xff]);
  });

  it('round trips and reports its length', () => {
    for (const value of [0, 1, 127, 128, 3712, 5000, 0x1fffff]) {
      const encoded = encodeAddress(value);
      expect(decodeAddress([...encoded, 0x03])).toEqual({ address: value, length: encoded.length });
    }
  });

  it('refuses a run that never terminates', () => {
    expect(decodeAddress([0x00, 0x00, 0x00])).toBeNull();
    expect(decodeAddress([0, 0, 0, 0, 0, 0, 0, 0])).toBeNull();
  });
});

describe('encodeFrame', () => {
  // GetSoftwareInfo on channel 19: the RpcPacket contains service id ...de 7e, so the flag byte
  // must be escaped. CRC computed independently (python zlib) over 00 3b 03 <packet>.
  const PACKET = [0x10, 0x13, 0x1d, 0xea, 0x71, 0xde, 0x7e, 0x25, 0x44, 0xfa, 0x99, 0x71];

  it('builds flag, address, control, escaped data, little-endian CRC, flag', () => {
    expect(Array.from(encodeFrame(3712, PACKET))).toEqual([
      0x7e, 0x00, 0x3b, 0x03,
      0x10, 0x13, 0x1d, 0xea, 0x71, 0xde, 0x7d, 0x5e, 0x25, 0x44, 0xfa, 0x99, 0x71,
      0x2d, 0x32, 0x18, 0x40,
      0x7e,
    ]);
  });

  it('escapes 7d and 7e wherever they fall, including the CRC', () => {
    const frame = encodeFrame(1, [0x7d, 0x7e]);
    const inner = Array.from(frame.slice(1, -1));
    expect(inner).not.toContain(0x7e);
    expect(inner.slice(0, 7)).toEqual([0x03, CONTROL_UI, 0x7d, 0x5d, 0x7d, 0x5e, expect.any(Number)]);
    const decoder = createHdlcDecoder();
    expect(decoder.push(frame)).toEqual([{ address: 1, control: CONTROL_UI, data: bytes(0x7d, 0x7e) }]);
  });
});

describe('createHdlcDecoder', () => {
  const frame = (data: number[], address = 3712) => encodeFrame(address, data);

  it('decodes a frame and exposes address, control and data', () => {
    const decoder = createHdlcDecoder();
    expect(decoder.push(frame([1, 2, 3]))).toEqual([{ address: 3712, control: 0x03, data: bytes(1, 2, 3) }]);
  });

  it('reassembles a frame split across chunks, even mid-escape', () => {
    const whole = frame([0x7e, 0x7d, 9]);
    for (let cut = 1; cut < whole.length; cut += 1) {
      const decoder = createHdlcDecoder();
      expect([...decoder.push(whole.slice(0, cut)), ...decoder.push(whole.slice(cut))]).toHaveLength(1);
    }
  });

  it('decodes two frames in one chunk, and frames that share a flag', () => {
    const a = frame([1]);
    const b = frame([2]);
    const decoder = createHdlcDecoder();
    expect(decoder.push(Uint8Array.from([...a, ...b])).map((f) => f.data[0])).toEqual([1, 2]);
    const shared = Uint8Array.from([...a, ...b.slice(1)]);
    expect(createHdlcDecoder().push(shared).map((f) => f.data[0])).toEqual([1, 2]);
  });

  it('ignores bytes before the first flag', () => {
    const decoder = createHdlcDecoder();
    expect(decoder.push(Uint8Array.from([0x00, 0x55, ...frame([7])])).map((f) => f.data[0])).toEqual([7]);
  });

  it('drops a frame with a bad CRC and recovers on the next', () => {
    const bad = Uint8Array.from(frame([1, 2, 3]));
    bad[5] ^= 0xff;
    const decoder = createHdlcDecoder();
    expect(decoder.push(Uint8Array.from([...bad, ...frame([4])])).map((f) => f.data[0])).toEqual([4]);
    expect(decoder.dropped).toBe(1);
  });

  it('drops a runt frame and a frame cut short by a flag after an escape', () => {
    const decoder = createHdlcDecoder();
    const out = decoder.push(Uint8Array.from([0x7e, 0x01, 0x03, 0x7e, 0x7e, 0x01, 0x7d, 0x7e, ...frame([5])]));
    expect(out.map((f) => f.data[0])).toEqual([5]);
    expect(decoder.dropped).toBe(2);
  });

  it('drops a runaway frame that never ends and resynchronises', () => {
    const decoder = createHdlcDecoder();
    decoder.push(Uint8Array.from([0x7e, ...new Array(5000).fill(0x11)]));
    expect(decoder.dropped).toBe(1);
    expect(decoder.push(frame([8])).map((f) => f.data[0])).toEqual([8]);
  });

  it('forgets partial input on reset', () => {
    const decoder = createHdlcDecoder();
    decoder.push(frame([1, 2, 3]).slice(0, 6));
    decoder.reset();
    expect(decoder.push(frame([9])).map((f) => f.data[0])).toEqual([9]);
  });
});
