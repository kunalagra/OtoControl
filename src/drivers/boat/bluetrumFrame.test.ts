import { describe, expect, it, vi } from 'vitest';
import { BluetrumDecoder, encodeFrames } from './bluetrumFrame';
import type { SeqState } from './bluetrumFrame';

const seq = (n = 0): SeqState => ({ n });

describe('encodeFrames', () => {
  it('encodes an empty payload as a single 5-byte frame', () => {
    // Hand-derived from DeviceCommManager.a(): empty payload → one frame
    // [seq][cmd][type][frag=0][len=0], seq advances.
    const state = seq(3);
    const [frame] = encodeFrames(0x27, 1, new Uint8Array(0), state);
    expect(Array.from(frame)).toEqual([0x03, 0x27, 0x01, 0x00, 0x00]);
    expect(state.n).toBe(4);
  });

  it('splits a payload into frag-indexed chunks with total-1 in the high nibble', () => {
    // 5 payload bytes, maxPayload 2 → 3 frags: total-1 = 2 in the high nibble,
    // index 0/1/2 in the low nibble; seq advances per frame.
    const state = seq(0);
    const frames = encodeFrames(0x27, 1, Uint8Array.from([0x0a, 0x0b, 0x0c, 0x0d, 0x0e]), state, 2);
    expect(frames.map((f) => Array.from(f))).toEqual([
      [0x00, 0x27, 0x01, 0x20, 0x02, 0x0a, 0x0b],
      [0x01, 0x27, 0x01, 0x21, 0x02, 0x0c, 0x0d],
      [0x02, 0x27, 0x01, 0x22, 0x01, 0x0e],
    ]);
    expect(state.n).toBe(3);
  });

  it('rolls the 4-bit seq over from 15 to 0', () => {
    const state = seq(15);
    const [a, b] = encodeFrames(0x20, 1, Uint8Array.from([0x01, 0x02]), state, 1);
    expect(a[0]).toBe(15);
    expect(b[0]).toBe(0);
    expect(state.n).toBe(1);
  });
});

describe('BluetrumDecoder', () => {
  it('decodes a single frame it did not encode', () => {
    // Hand-built: seq 7, cmd 39 (device info), type 1, single frag, 2 payload bytes.
    const decoder = new BluetrumDecoder();
    const [frame] = decoder.push(Uint8Array.from([0x07, 0x27, 0x01, 0x00, 0x02, 0x01, 0x00]));
    expect(frame.cmd).toBe(0x27);
    expect(frame.type).toBe(1);
    expect(frame.seq).toBe(7);
    expect(Array.from(frame.payload)).toEqual([0x01, 0x00]);
  });

  it('reassembles frags split across pushes into one message', () => {
    const state = seq(0);
    const frames = encodeFrames(0x27, 1, Uint8Array.from([0x01, 0x00, 0x02, 0x00]), state, 2);
    const decoder = new BluetrumDecoder();
    expect(decoder.push(frames[0])).toEqual([]);
    const [message] = decoder.push(new Uint8Array([...frames[1]]));
    expect(Array.from(message.payload)).toEqual([0x01, 0x00, 0x02, 0x00]);
  });

  it('emits two messages queued back to back in one push', () => {
    const state = seq(0);
    const [a] = encodeFrames(0x27, 1, Uint8Array.from([0x01]), state, 8);
    const [b] = encodeFrames(0x2a, 1, Uint8Array.from([0x02]), state, 8);
    const decoder = new BluetrumDecoder();
    // Prime the expected seq by consuming `a` first is not needed: decoder
    // starts expecting 0 and both frames follow the encoder's seq.
    const out = decoder.push(new Uint8Array([...a, ...b]));
    expect(out.map((f) => f.cmd)).toEqual([0x27, 0x2a]);
  });

  it('reports a seq mismatch but keeps decoding', () => {
    const onSeqMismatch = vi.fn();
    const decoder = new BluetrumDecoder({ onSeqMismatch });
    const out = decoder.push(Uint8Array.from([0x05, 0x27, 0x01, 0x00, 0x00]));
    expect(onSeqMismatch).toHaveBeenCalledWith(0, 5);
    expect(out).toHaveLength(1);
  });

  it('waits for the rest of a frame whose payload arrives later', () => {
    const decoder = new BluetrumDecoder();
    expect(decoder.push(Uint8Array.from([0x00, 0x27, 0x01, 0x00, 0x02, 0x09]))).toEqual([]);
    const [frame] = decoder.push(Uint8Array.from([0x0a]));
    expect(Array.from(frame.payload)).toEqual([0x09, 0x0a]);
  });

  it('drops a continuation whose first frag index is not 0', () => {
    const onFragMismatch = vi.fn();
    const decoder = new BluetrumDecoder({ onFragMismatch });
    // total = 2 (hi nibble 1), index = 1 — no message in progress accepts it.
    const out = decoder.push(Uint8Array.from([0x00, 0x27, 0x01, 0x11, 0x01, 0xff]));
    expect(onFragMismatch).toHaveBeenCalled();
    expect(out).toEqual([]);
  });
});
