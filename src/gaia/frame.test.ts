import { describe, expect, it, vi } from 'vitest';

import {
  FrameDecoder,
  Vendor,
  encodeFrame,
  frameKind,
  requestIdFor,
  toHex,
} from './frame';

/** Captured from the milestone-0 hardware spike. */
const BATTERY_REQUEST = Uint8Array.from([0xff, 0x03, 0x00, 0x00, 0x04, 0x95, 0x06, 0x03]);
const BATTERY_RESPONSE = Uint8Array.from([
  0xff, 0x03, 0x00, 0x01, 0x04, 0x95, 0x07, 0x03, 0x46,
]);
const ANC_MODES_RESPONSE = Uint8Array.from([
  0xff, 0x03, 0x00, 0x06, 0x04, 0x95, 0x1b, 0x01, 0x01, 0x01, 0x02, 0x00, 0x03, 0x00,
]);

describe('encodeFrame', () => {
  it('produces the exact bytes the headphones accepted for a battery poll', () => {
    expect(encodeFrame(Vendor.Sennheiser, 0x0603)).toEqual(BATTERY_REQUEST);
  });

  it('writes the payload length as a big-endian u16', () => {
    const frame = encodeFrame(Vendor.Sennheiser, 0x1a02, [80]);
    expect(toHex(frame)).toBe('FF 03 00 01 04 95 1A 02 50');
  });

  it('handles payloads longer than 255 bytes', () => {
    const frame = encodeFrame(Vendor.Sennheiser, 0x0001, new Array(300).fill(0xab));
    expect(frame.length).toBe(308);
    expect([frame[2], frame[3]]).toEqual([0x01, 0x2c]);
  });
});

describe('frameKind / requestIdFor', () => {
  it('classifies each of the four command-ID forms', () => {
    expect(frameKind(0x0603)).toBe('request');
    expect(frameKind(0x0703)).toBe('response');
    expect(frameKind(0x0683)).toBe('notification');
    expect(frameKind(0x0783)).toBe('error');
  });

  it('maps every form back to the same request ID', () => {
    for (const command of [0x0603, 0x0703, 0x0683, 0x0783]) {
      expect(requestIdFor(command)).toBe(0x0603);
    }
  });

  it('round-trips the ANC and transparency IDs seen on hardware', () => {
    expect(requestIdFor(0x1b05)).toBe(0x1a05);
    expect(requestIdFor(0x1b03)).toBe(0x1a03);
    expect(requestIdFor(0x1a83)).toBe(0x1a03);
  });
});

describe('FrameDecoder', () => {
  it('decodes a whole frame', () => {
    const [frame] = new FrameDecoder().push(BATTERY_RESPONSE);
    expect(frame.vendor).toBe(Vendor.Sennheiser);
    expect(frame.command).toBe(0x0703);
    expect(Array.from(frame.payload)).toEqual([0x46]);
  });

  it('waits for a frame split across two reads', () => {
    const decoder = new FrameDecoder();
    expect(decoder.push(BATTERY_RESPONSE.slice(0, 5))).toEqual([]);
    expect(decoder.push(BATTERY_RESPONSE.slice(5))).toHaveLength(1);
    expect(decoder.buffered).toBe(0);
  });

  it('waits when the split lands mid-header', () => {
    const decoder = new FrameDecoder();
    expect(decoder.push(ANC_MODES_RESPONSE.slice(0, 3))).toEqual([]);
    const [frame] = decoder.push(ANC_MODES_RESPONSE.slice(3));
    expect(Array.from(frame.payload)).toEqual([0x01, 0x01, 0x02, 0x00, 0x03, 0x00]);
  });

  it('emits several frames arriving in one read', () => {
    const merged = new Uint8Array(BATTERY_RESPONSE.length + ANC_MODES_RESPONSE.length);
    merged.set(BATTERY_RESPONSE, 0);
    merged.set(ANC_MODES_RESPONSE, BATTERY_RESPONSE.length);

    const frames = new FrameDecoder().push(merged);
    expect(frames.map((f) => f.command)).toEqual([0x0703, 0x1b01]);
  });

  it('resynchronises on the next marker after leading garbage', () => {
    const onDesync = vi.fn();
    const noisy = new Uint8Array([0x00, 0x11, 0x22, ...BATTERY_RESPONSE]);

    const frames = new FrameDecoder({ onDesync }).push(noisy);
    expect(onDesync).toHaveBeenCalledWith(3);
    expect(frames).toHaveLength(1);
    expect(frames[0].command).toBe(0x0703);
  });

  it('drops a buffer containing no marker at all', () => {
    const onDesync = vi.fn();
    const decoder = new FrameDecoder({ onDesync });
    expect(decoder.push(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]))).toEqual([]);
    expect(onDesync).toHaveBeenCalledWith(8);
    expect(decoder.buffered).toBe(0);
  });

  it('decodes a good frame arriving after discarded garbage', () => {
    const decoder = new FrameDecoder({ onDesync: () => {} });
    expect(decoder.push(Uint8Array.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]))).toEqual(
      [],
    );

    const frames = decoder.push(BATTERY_RESPONSE);
    expect(frames).toHaveLength(1);
    expect(frames[0].command).toBe(0x0703);
  });

  it('consumes a following marker as payload when a frame is truncated', () => {
    // Documents a real limitation: the protocol has no checksum, so a frame
    // whose declared length overruns silently eats the next frame's header.
    // Recovery depends on the desync path, not on detecting the bad frame.
    const truncated = Uint8Array.from([0xff, 0x03, 0x00, 0x01, 0x04, 0x95, 0x07, 0x03]);
    const merged = new Uint8Array(truncated.length + BATTERY_RESPONSE.length);
    merged.set(truncated, 0);
    merged.set(BATTERY_RESPONSE, truncated.length);

    const onDesync = vi.fn();
    const frames = new FrameDecoder({ onDesync }).push(merged);
    expect(frames).toHaveLength(1);
    expect(Array.from(frames[0].payload)).toEqual([0xff]);
    expect(onDesync).toHaveBeenCalled();
  });

  it('reset() discards buffered bytes', () => {
    const decoder = new FrameDecoder();
    decoder.push(BATTERY_RESPONSE.slice(0, 4));
    expect(decoder.buffered).toBe(4);
    decoder.reset();
    expect(decoder.buffered).toBe(0);
  });
});
