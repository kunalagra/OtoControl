import { describe, expect, it } from 'vitest';

import { FrameType, createDeframer, encodeFrame, encodeRequest, encodeResponseTo } from './frame';
import type { XiaomiFrame } from './frame';

const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

describe('encodeFrame', () => {
  it('matches the ANC-on vector from WinMi-Buds', () => {
    expect(hex(encodeRequest(0x08, 0x2a, [0x02, 0x04, 0x01]))).toBe('fedcbac40800042a020401ef');
  });

  it('puts a status byte in a response and counts it in the length', () => {
    const frame = encodeFrame({ type: FrameType.Response, opcode: 0x51, seq: 9, status: 0, payload: Uint8Array.of(1) });
    expect(hex(frame)).toBe('fedcba04510003000901ef');
  });

  it('answers a notification with the notification ACK from WinMi-Buds', () => {
    const notification: XiaomiFrame = { type: FrameType.EarbudsRequest, opcode: 0x0e, seq: 0xff, status: 0, payload: new Uint8Array() };
    expect(hex(encodeResponseTo(notification))).toBe('fedcba040e000200ffef');
  });

  it('encodes an empty request as header, seq and trailer', () => {
    expect(hex(encodeRequest(0x02, 0, []))).toBe('fedcbac4020001' + '00ef');
  });
});

describe('createDeframer', () => {
  const anc = encodeRequest(0x08, 0x2a, [2, 4, 1]);
  const config = encodeFrame({ type: FrameType.Response, opcode: 0xf3, seq: 7, status: 0, payload: Uint8Array.of(3, 0, 0x25, 1) });
  const stream = Uint8Array.from([...anc, ...config]);

  it('decodes a request', () => {
    const [frame] = createDeframer().push(anc);
    expect(frame).toEqual({ type: 0xc4, opcode: 0x08, seq: 0x2a, status: 0, payload: Uint8Array.of(2, 4, 1) });
  });

  it('decodes a response with its status', () => {
    const [frame] = createDeframer().push(
      encodeFrame({ type: FrameType.Response, opcode: 0x09, seq: 3, status: 1, payload: Uint8Array.of(2, 9, 1) }),
    );
    expect(frame).toMatchObject({ type: 0x04, opcode: 0x09, seq: 3, status: 1 });
    expect(Array.from(frame.payload)).toEqual([2, 9, 1]);
  });

  it('decodes two frames coalesced into one read', () => {
    const frames = createDeframer().push(stream);
    expect(frames.map((frame) => frame.opcode)).toEqual([0x08, 0xf3]);
    expect(frames[1].seq).toBe(7);
  });

  it('survives a split at every byte boundary', () => {
    for (let split = 0; split <= stream.length; split += 1) {
      const deframer = createDeframer();
      const frames = [...deframer.push(stream.subarray(0, split)), ...deframer.push(stream.subarray(split))];
      expect(frames.map((frame) => frame.opcode)).toEqual([0x08, 0xf3]);
    }
  });

  it('survives one byte at a time', () => {
    const deframer = createDeframer();
    const frames = Array.from(stream).flatMap((byte) => deframer.push(Uint8Array.of(byte)));
    expect(frames).toHaveLength(2);
  });

  it('honours the length when the payload contains the header and trailer bytes', () => {
    const tricky = encodeFrame({
      type: FrameType.EarbudsRequest,
      opcode: 0x50,
      seq: 1,
      status: 0,
      payload: Uint8Array.of(1, 0xfe, 0xdc, 0xba, 0xef),
    });
    const frames = createDeframer().push(Uint8Array.from([...tricky, ...anc]));
    expect(frames).toHaveLength(2);
    expect(Array.from(frames[0].payload)).toEqual([1, 0xfe, 0xdc, 0xba, 0xef]);
    expect(frames[1].opcode).toBe(0x08);
  });

  it('resynchronises after garbage and a frame with a bad trailer', () => {
    const damaged = Uint8Array.from(anc);
    damaged[damaged.length - 1] = 0;
    const frames = createDeframer().push(Uint8Array.from([0, 1, 2, ...damaged, ...anc]));
    expect(frames).toHaveLength(1);
    expect(frames[0].opcode).toBe(0x08);
  });

  it('rejects an oversized or too-short length instead of waiting for it', () => {
    expect(createDeframer().push(Uint8Array.from([0xfe, 0xdc, 0xba, 0xc4, 8, 0xff, 0xff, ...anc]))).toHaveLength(1);
    expect(createDeframer().push(Uint8Array.from([0xfe, 0xdc, 0xba, 0x04, 8, 0, 0, ...anc]))).toHaveLength(1);
  });

  it('rejects an unknown type byte', () => {
    expect(createDeframer().push(Uint8Array.from([0xfe, 0xdc, 0xba, 0x99, 8, 0, 1, 0, 0xef, ...anc]))).toHaveLength(1);
  });

  it('forgets a half frame on reset', () => {
    const deframer = createDeframer();
    deframer.push(anc.subarray(0, 6));
    deframer.reset();
    expect(deframer.push(anc)).toHaveLength(1);
  });

  it('decodes what encodeFrame produced, for a long payload', () => {
    const payload = Uint8Array.from({ length: 300 }, (_, i) => i & 0xff);
    const [frame] = createDeframer().push(encodeRequest(0xf2, 5, payload));
    expect(frame.payload).toEqual(payload);
  });
});

describe('createDeframer on a real capture', () => {
  // Frames from the official app against a REDMI Buds 8 Pro (PID 0x50E3), as two reads that split and join them:
  // see the design spec's verification section.
  const CAPTURE =
    'fedcbac450001200017cbaf504e25f9d1a3433dc226e354689ef' + // app: challenge
    'fedcba0450001300000122e1c4476946e0eaafea84486d4ad0feef' + // earbuds: answer
    'fedcbac4510003010100ef' + // app: confirm
    'fedcbac05000120001ee3e69a0ee621d52d57929286b07151def' + // earbuds: their challenge
    'fedcba040e000200ffef' + // an ACK, as the app sends them
    'fedcbac7f4000608' + '04000b0202ef'; // earbuds: a strength notification

  const raw = Uint8Array.from(CAPTURE.match(/../g)!.map((pair) => parseInt(pair, 16)));

  it('reads every frame whole, in order, however the reads fall', () => {
    for (const split of [0, 7, 25, 60, raw.length]) {
      const deframer = createDeframer();
      const frames = [...deframer.push(raw.subarray(0, split)), ...deframer.push(raw.subarray(split))];
      expect(frames.map((frame) => [frame.type, frame.opcode, frame.seq])).toEqual([
        [0xc4, 0x50, 0x00],
        [0x04, 0x50, 0x00],
        [0xc4, 0x51, 0x01],
        [0xc0, 0x50, 0x00],
        [0x04, 0x0e, 0xff],
        [0xc7, 0xf4, 0x08],
      ]);
    }
  });
});
