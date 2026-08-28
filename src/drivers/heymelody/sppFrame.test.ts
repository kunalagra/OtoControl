import { describe, expect, it } from 'vitest';
import { SppFrameCodec, encodeSppFrame, nextSeq } from './sppFrame';

describe('encodeSppFrame', () => {
  it('encodes a single-byte-length frame byte for byte', () => {
    // Hand-derived: body = reserved(0x00,0x00) + cmd(0x0103 LE -> 0x03,0x01)
    // + seq(0x01) + payLen(0 -> 0x00,0x00) + payload() = 7 bytes.
    // 7 < 0x80, so length is 1 byte with continuation bit clear: 0x07.
    // Frame = 0xAA, 0x07, then the 7 body bytes = 9 bytes total.
    const frame = encodeSppFrame(0x0103, 0x01, []);
    expect(Array.from(frame)).toEqual([0xaa, 0x07, 0x00, 0x00, 0x03, 0x01, 0x01, 0x00, 0x00]);
  });

  it('encodes a payload, little-endian cmd and payLen', () => {
    // body = reserved(2) + cmd(0x0404 LE -> 0x04,0x04) + seq(0x02) + payLen(3 -> 0x03,0x00) + [0x01,0x02,0x03]
    // body length = 2+2+1+2+3 = 10, fits in 1 byte (0x0A).
    const frame = encodeSppFrame(0x0404, 0x02, [0x01, 0x02, 0x03]);
    expect(Array.from(frame)).toEqual([
      0xaa, 0x0a, 0x00, 0x00, 0x04, 0x04, 0x02, 0x03, 0x00, 0x01, 0x02, 0x03,
    ]);
  });

  it('switches to a 2-byte length once the body needs it', () => {
    // A 200-byte command payload: body length = 7 + 200 = 207.
    // 207 >= 0x80, so 2-byte varint: byte0 = (207 & 0x7F) | 0x80, byte1 = 207 >> 7.
    // 207 = 0b11001111. low 7 bits = 0b1001111 = 0x4F, with continuation -> 0xCF.
    // high bits = 207 >> 7 = 1 -> 0x01.
    const payload = new Uint8Array(200).fill(0x11);
    const frame = encodeSppFrame(0x0122, 0x01, payload);
    expect(frame[0]).toBe(0xaa);
    expect(frame[1]).toBe(0xcf);
    expect(frame[2]).toBe(0x01);
    expect(frame.length).toBe(3 + 207); // header(3) + body(207)
  });
});

describe('SppFrameCodec decoder', () => {
  it('decodes a frame it just encoded', () => {
    const decoder = new SppFrameCodec().createDecoder();
    const encoded = encodeSppFrame(0x8103, 0x01, [0x00, 0x10, 0xf0, 0x06]);
    const [frame] = decoder.push(encoded);
    expect(frame.cmd).toBe(0x8103);
    expect(frame.seq).toBe(0x01);
    expect(Array.from(frame.payload)).toEqual([0x00, 0x10, 0xf0, 0x06]);
    expect(frame.lengthOk).toBe(true);
  });

  it('decodes a hand-built single-byte-length frame without going through the encoder', () => {
    // Same bytes as the first encodeSppFrame test, verified independently.
    const bytes = Uint8Array.from([0xaa, 0x07, 0x00, 0x00, 0x03, 0x01, 0x01, 0x00, 0x00]);
    const decoder = new SppFrameCodec().createDecoder();
    const [frame] = decoder.push(bytes);
    expect(frame.cmd).toBe(0x0103);
    expect(frame.seq).toBe(0x01);
    expect(frame.payload.length).toBe(0);
  });

  it('reassembles a frame split across two chunks', () => {
    const encoded = encodeSppFrame(0x0106, 0x05, [0x01, 0x02]);
    const decoder = new SppFrameCodec().createDecoder();
    expect(decoder.push(encoded.slice(0, 4))).toEqual([]);
    const frames = decoder.push(encoded.slice(4));
    expect(frames).toHaveLength(1);
    expect(frames[0].cmd).toBe(0x0106);
  });

  it('flags a payLen that disagrees with the actual body length', () => {
    // Body claims payLen=99 but only carries 2 bytes — corrupt on purpose.
    const bytes = Uint8Array.from([0xaa, 0x09, 0x00, 0x00, 0x06, 0x01, 0x01, 0x63, 0x00, 0xaa, 0xbb]);
    const decoder = new SppFrameCodec().createDecoder();
    const [frame] = decoder.push(bytes);
    expect(frame.lengthOk).toBe(false);
  });

  it('resyncs on the next 0xAA after garbage bytes', () => {
    const encoded = encodeSppFrame(0x0106, 0x01, []);
    const decoder = new SppFrameCodec().createDecoder();
    const withGarbage = new Uint8Array([0x00, 0x11, 0x22, ...encoded]);
    const frames = decoder.push(withGarbage);
    expect(frames).toHaveLength(1);
    expect(frames[0].cmd).toBe(0x0106);
  });

  it('skips a stray 0xAA with an implausible length and recovers at the next real frame', () => {
    // A 0xAA byte that was actually payload data, followed by garbage that
    // decodes as a length > 512 (spec §3.2's documented SPP max frame size).
    // Without a cap the decoder would wait forever for bytes that never
    // arrive, silently absorbing every real frame that follows.
    const real = encodeSppFrame(0x0106, 0x02, [0x01, 0x02]);
    const bytes = new Uint8Array([0xaa, 0xff, 0x7f, 0x11, 0x22, 0x33, ...real]);
    const decoder = new SppFrameCodec().createDecoder();
    const frames = decoder.push(bytes);
    expect(frames).toHaveLength(1);
    expect(frames[0].cmd).toBe(0x0106);
    expect(Array.from(frames[0].payload)).toEqual([0x01, 0x02]);
  });

  it('returns multiple frames when two arrive concatenated in one push()', () => {
    const frameA = encodeSppFrame(0x0103, 0x01, []);
    const frameB = encodeSppFrame(0x8106, 0x02, [0x01, 0x02]);
    const decoder = new SppFrameCodec().createDecoder();
    const frames = decoder.push(new Uint8Array([...frameA, ...frameB]));
    expect(frames).toHaveLength(2);
    expect(frames[0].cmd).toBe(0x0103);
    expect(frames[1].cmd).toBe(0x8106);
  });

  it('decodes a two-byte-length frame (body >= 128 bytes)', () => {
    // Encode a 200-byte payload: body = 7 + 200 = 207 bytes.
    // 207 >= 0x80, so uses 2-byte varint length in the frame header.
    // This exercises the decoder's twoByteLength=true branch.
    const payload = new Uint8Array(200).fill(0x11);
    const encoded = encodeSppFrame(0x0122, 0x01, payload);
    // Verify the frame header is indeed 2-byte length: 0xCF, 0x01
    expect(encoded[1]).toBe(0xcf);
    expect(encoded[2]).toBe(0x01);
    // Now decode it through the decoder and verify all fields recover correctly
    const decoder = new SppFrameCodec().createDecoder();
    const [frame] = decoder.push(encoded);
    expect(frame.cmd).toBe(0x0122);
    expect(frame.seq).toBe(0x01);
    expect(frame.payload.length).toBe(200);
    expect(Array.from(frame.payload)).toEqual(new Array(200).fill(0x11));
    expect(frame.lengthOk).toBe(true);
  });
});

describe('nextSeq', () => {
  it('increments and wraps from 0xFE back to 0x01', () => {
    expect(nextSeq(0x01)).toBe(0x02);
    expect(nextSeq(0xfd)).toBe(0xfe);
    expect(nextSeq(0xfe)).toBe(0x01);
  });
});

describe('SppFrameCodec as a FrameCodec', () => {
  it('encodes through the codec instance, not just the free function', () => {
    // Task 6's client depends on this method existing on the codec itself —
    // see FrameCodec in the spec's §4.1 strategy design.
    const codec = new SppFrameCodec();
    expect(Array.from(codec.encode(0x0103, 0x01, []))).toEqual(
      Array.from(encodeSppFrame(0x0103, 0x01, [])),
    );
  });
});
