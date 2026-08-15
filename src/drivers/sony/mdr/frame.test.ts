import { describe, expect, it, vi } from 'vitest';

import {
  DataType,
  MdrDecoder,
  checksum,
  encodeAck,
  encodeFrame,
  escape,
  nextSequence,
  toHex,
  unescape,
} from './frame';

const bytes = (hex: string) =>
  Uint8Array.from(hex.split(/\s+/).filter(Boolean).map((h) => parseInt(h, 16)));

/**
 * Frames captured verbatim from a Sony WF-C500 session. These are the strongest
 * tests available — real bytes the hardware accepted, not constructed examples.
 */
const CAPTURED = [
  { name: 'protocol info', seq: 0, payload: [0x00, 0x00], hex: '3E 0C 00 00 00 00 02 00 00 0E 3C' },
  { name: 'firmware', seq: 1, payload: [0x04, 0x02], hex: '3E 0C 01 00 00 00 02 04 02 15 3C' },
  { name: 'model name', seq: 0, payload: [0x04, 0x01], hex: '3E 0C 00 00 00 00 02 04 01 13 3C' },
  { name: 'series+colour', seq: 1, payload: [0x04, 0x03], hex: '3E 0C 01 00 00 00 02 04 03 16 3C' },
  { name: 'support fn', seq: 0, payload: [0x06, 0x00], hex: '3E 0C 00 00 00 00 02 06 00 14 3C' },
  { name: 'battery dual', seq: 1, payload: [0x22, 0x01], hex: '3E 0C 01 00 00 00 02 22 01 32 3C' },
  { name: 'codec', seq: 0, payload: [0x12, 0x02], hex: '3E 0C 00 00 00 00 02 12 02 22 3C' },
  { name: 'EQ preset', seq: 0, payload: [0x56, 0x00], hex: '3E 0C 00 00 00 00 02 56 00 64 3C' },
  { name: 'NCASM get', seq: 1, payload: [0x66, 0x17], hex: '3E 0C 01 00 00 00 02 66 17 8C 3C' },
];

describe('encodeFrame', () => {
  it.each(CAPTURED)('reproduces the $name frame the device accepted', ({ seq, payload, hex }) => {
    expect(toHex(encodeFrame(DataType.Command1, seq, payload))).toBe(hex);
  });

  it('encodes an empty payload with a zero length', () => {
    expect(toHex(encodeFrame(DataType.Ack, 0))).toBe('3E 01 00 00 00 00 00 01 3C');
  });

  it('writes the length as a big-endian u32', () => {
    const frame = encodeFrame(DataType.Command1, 0, new Array(300).fill(0x41));
    expect(Array.from(frame.slice(3, 7))).toEqual([0x00, 0x00, 0x01, 0x2c]);
  });
});

describe('encodeAck', () => {
  it('inverts the sequence, matching what the device expects', () => {
    // Captured: after receiving seq=1 we sent this, and the device continued.
    expect(toHex(encodeAck(1))).toBe('3E 01 00 00 00 00 00 01 3C');
    expect(toHex(encodeAck(0))).toBe('3E 01 01 00 00 00 00 02 3C');
  });
});

describe('checksum', () => {
  it('is a wrapping byte sum', () => {
    expect(checksum([0x0c, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00])).toBe(0x0e);
    expect(checksum([0xff, 0xff])).toBe(0xfe);
    expect(checksum([])).toBe(0);
  });
});

describe('escaping', () => {
  it('escapes exactly the three framing bytes', () => {
    expect(escape([0x3e, 0x3c, 0x3d])).toEqual([0x3d, 0x2e, 0x3d, 0x2c, 0x3d, 0x2d]);
  });

  it('leaves every other byte alone', () => {
    expect(escape([0x00, 0x3b, 0x3f, 0xff])).toEqual([0x00, 0x3b, 0x3f, 0xff]);
  });

  it('round-trips every byte value', () => {
    const all = Array.from({ length: 256 }, (_, i) => i);
    expect(Array.from(unescape(Uint8Array.from(escape(all))))).toEqual(all);
  });

  it('produces a frame whose body contains no bare framing bytes', () => {
    const frame = encodeFrame(DataType.Command1, 0, [0x3e, 0x3c, 0x3d]);
    const body = frame.slice(1, -1);
    expect(Array.from(body).filter((b) => b === 0x3e || b === 0x3c)).toEqual([]);
  });
});

describe('nextSequence', () => {
  it('alternates', () => {
    expect(nextSequence(0)).toBe(1);
    expect(nextSequence(1)).toBe(0);
  });
});

describe('MdrDecoder', () => {
  const reply = (seq: number, payload: number[]) =>
    encodeFrame(DataType.Command1, seq, payload);

  it('decodes a real device reply', () => {
    // RET_DEVICE_INFO carrying "WF-C500".
    const [frame] = new MdrDecoder().push(
      reply(0, [0x05, 0x01, 0x07, 0x57, 0x46, 0x2d, 0x43, 0x35, 0x30, 0x30]),
    );
    expect(frame.dataType).toBe(DataType.Command1);
    expect(new TextDecoder().decode(frame.payload.slice(3))).toBe('WF-C500');
    expect(frame.checksumOk).toBe(true);
  });

  it('decodes the series+colour reply that has no length prefix', () => {
    const [frame] = new MdrDecoder().push(reply(0, [0x05, 0x03, 0x00, 0x01]));
    expect(Array.from(frame.payload)).toEqual([0x05, 0x03, 0x00, 0x01]);
  });

  it('decodes an ACK as an empty payload', () => {
    const [frame] = new MdrDecoder().push(encodeAck(0));
    expect(frame.dataType).toBe(DataType.Ack);
    expect(frame.payload).toHaveLength(0);
  });

  it('waits for a frame split across reads', () => {
    const frame = reply(1, [0x23, 0x01, 0x64, 0x00, 0x64, 0x00]);
    const decoder = new MdrDecoder();
    expect(decoder.push(frame.slice(0, 5))).toEqual([]);
    expect(decoder.push(frame.slice(5, 9))).toEqual([]);
    const [decoded] = decoder.push(frame.slice(9));
    expect(Array.from(decoded.payload)).toEqual([0x23, 0x01, 0x64, 0x00, 0x64, 0x00]);
  });

  it('emits several frames arriving together', () => {
    const a = encodeAck(1);
    const b = reply(1, [0x01, 0x00]);
    const merged = new Uint8Array([...a, ...b]);
    expect(new MdrDecoder().push(merged).map((f) => f.dataType)).toEqual([
      DataType.Ack,
      DataType.Command1,
    ]);
  });

  it('decodes a payload containing escaped framing bytes', () => {
    const [frame] = new MdrDecoder().push(reply(0, [0x3e, 0x3c, 0x3d, 0x41]));
    expect(Array.from(frame.payload)).toEqual([0x3e, 0x3c, 0x3d, 0x41]);
  });

  it('flags a corrupted checksum rather than accepting the frame', () => {
    const frame = reply(0, [0x22, 0x01]);
    frame[frame.length - 2] ^= 0xff;
    const [decoded] = new MdrDecoder().push(frame);
    expect(decoded.checksumOk).toBe(false);
  });

  it('skips leading rubbish and reports it', () => {
    const onDesync = vi.fn();
    const noisy = new Uint8Array([0x00, 0x11, ...reply(0, [0x01, 0x00])]);
    const frames = new MdrDecoder({ onDesync }).push(noisy);
    expect(onDesync).toHaveBeenCalledWith(2);
    expect(frames).toHaveLength(1);
  });

  it('recovers the next frame after a truncated one, unlike GAIA', () => {
    // The delimiter makes this recoverable: the runt ends at its own 0x3C.
    const runt = bytes('3E 0C 00 00 00 00 09 01 3C');
    const good = reply(1, [0x23, 0x01, 0x64, 0x00, 0x64, 0x00]);
    const frames = new MdrDecoder().push(new Uint8Array([...runt, ...good]));
    expect(frames).toHaveLength(1);
    expect(Array.from(frames[0].payload)).toEqual([0x23, 0x01, 0x64, 0x00, 0x64, 0x00]);
  });

  it('reset() drops buffered bytes', () => {
    const decoder = new MdrDecoder();
    decoder.push(reply(0, [0x01, 0x00]).slice(0, 4));
    expect(decoder.buffered).toBeGreaterThan(0);
    decoder.reset();
    expect(decoder.buffered).toBe(0);
  });
});
