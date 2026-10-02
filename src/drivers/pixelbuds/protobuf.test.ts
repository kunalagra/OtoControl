import { describe, expect, it } from 'vitest';

import { boolOf, floatOf, hasField, messageOf, parseFields, pb, ProtobufError, stringOf, varintOf } from './protobuf';

const bytes = (...values: number[]) => Uint8Array.from(values);

describe('protobuf writers', () => {
  // Expected bytes below are the canonical encodings from the protobuf encoding guide
  // (field 1 varint 150 = 08 96 01), not the output of the reader under test.
  it('writes varints', () => {
    expect(pb.varint(1, 150)).toEqual([0x08, 0x96, 0x01]);
    expect(pb.varint(4, 0)).toEqual([0x20, 0x00]);
    expect(pb.varint(2, 19)).toEqual([0x10, 0x13]);
  });

  it('writes a multi-byte field key', () => {
    // field 16, length-delimited: (16 << 3) | 2 = 130 = 82 01
    expect(pb.bytes(16, [])).toEqual([0x82, 0x01, 0x00]);
    expect(pb.bool(13, true)).toEqual([0x68, 0x01]);
  });

  it('writes bool, fixed32 and length-delimited fields', () => {
    expect(pb.bool(11, false)).toEqual([0x58, 0x00]);
    expect(pb.fixed32(3, 0x7ede71ea)).toEqual([0x1d, 0xea, 0x71, 0xde, 0x7e]);
    expect(pb.bytes(2, [0x74, 0x65, 0x73, 0x74])).toEqual([0x12, 0x04, 0x74, 0x65, 0x73, 0x74]);
  });

  it('writes floats little-endian IEEE 754', () => {
    // 1.5f = 0x3fc00000, -6.0f = 0xc0c00000
    expect(pb.float(1, 1.5)).toEqual([0x0d, 0x00, 0x00, 0xc0, 0x3f]);
    expect(pb.float(5, -6)).toEqual([0x2d, 0x00, 0x00, 0xc0, 0xc0]);
  });
});

describe('parseFields and accessors', () => {
  it('reads the encoding guide example', () => {
    const fields = parseFields(bytes(0x08, 0x96, 0x01));
    expect(varintOf(fields, 1)).toBe(150);
  });

  it('reads a nested message and tells absent from empty', () => {
    const fields = parseFields(bytes(0x1a, 0x03, 0x08, 0x96, 0x01, 0x22, 0x00));
    expect(varintOf(messageOf(fields, 3)!, 1)).toBe(150);
    expect(messageOf(fields, 4)).toEqual([]);
    expect(messageOf(fields, 5)).toBeNull();
  });

  it('defaults an absent scalar and keeps the last of a repeated one', () => {
    const fields = parseFields(bytes(0x08, 0x01, 0x08, 0x07));
    expect(varintOf(fields, 1)).toBe(7);
    expect(varintOf(fields, 9)).toBe(0);
    expect(boolOf(fields, 9)).toBe(false);
    expect(stringOf(fields, 9)).toBe('');
    expect(floatOf(fields, 9)).toBe(0);
    expect(hasField(fields, 1)).toBe(true);
    expect(hasField(fields, 9)).toBe(false);
  });

  it('reads strings, floats and fixed32 values', () => {
    const fields = parseFields(bytes(0x12, 0x04, 0x74, 0x65, 0x73, 0x74, 0x0d, 0x00, 0x00, 0xc0, 0x3f));
    expect(stringOf(fields, 2)).toBe('test');
    expect(floatOf(fields, 1)).toBe(1.5);
  });

  it('reads a millisecond timestamp past 32 bits', () => {
    const encoded = Uint8Array.from(pb.varint(2, 1_759_400_000_123));
    expect(varintOf(parseFields(encoded), 2)).toBe(1_759_400_000_123);
  });

  it('skips fixed64 fields', () => {
    const fields = parseFields(bytes(0x29, 1, 2, 3, 4, 5, 6, 7, 8, 0x08, 0x05));
    expect(varintOf(fields, 1)).toBe(5);
  });

  it('rejects truncated and malformed input', () => {
    expect(() => parseFields(bytes(0x08))).toThrow(ProtobufError);
    expect(() => parseFields(bytes(0x08, 0x96))).toThrow('truncated varint');
    expect(() => parseFields(bytes(0x12, 0x05, 0x01))).toThrow('truncated length-delimited');
    expect(() => parseFields(bytes(0x0d, 0x00))).toThrow('truncated fixed32');
    expect(() => parseFields(bytes(0x00, 0x00))).toThrow('field number 0');
    expect(() => parseFields(bytes(0x0b))).toThrow('unsupported wire type');
    expect(() => parseFields(bytes(...new Array(11).fill(0x88)))).toThrow('varint too long');
  });
});
