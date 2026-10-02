/**
 * The slice of protobuf wire format the Maestro protocol needs, written out
 * rather than pulled in as a dependency: varints, fixed32 (floats and ids),
 * length-delimited bytes/strings/messages. proto3 rules apply — a zero scalar
 * is simply absent, which is why readers default every field.
 *
 * Values are JS numbers. A varint beyond 2^53 loses precision rather than
 * failing, which no field here reaches: the widest is a millisecond timestamp.
 */

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LENGTH = 2;
const WIRE_FIXED32 = 5;

export interface PbField {
  field: number;
  wire: number;
  /** Varint value, or the raw 32 bits of a fixed32. Zero for length-delimited. */
  value: number;
  /** The body of a length-delimited field. Empty otherwise. */
  bytes: Uint8Array;
}

const EMPTY = new Uint8Array(0);

export class ProtobufError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtobufError';
  }
}

// --- writing -----------------------------------------------------------------

function varintBytes(value: number): number[] {
  const out: number[] = [];
  let rest = Math.max(0, Math.floor(value));
  while (rest >= 0x80) {
    out.push((rest % 0x80) | 0x80);
    rest = Math.floor(rest / 0x80);
  }
  out.push(rest);
  return out;
}

const tag = (field: number, wire: number): number[] => varintBytes(field * 8 + wire);

/** Field writers return byte arrays so a message is just their concatenation. */
export const pb = {
  /** Always written, even when zero — what a oneof member needs. */
  varint: (field: number, value: number): number[] => [...tag(field, WIRE_VARINT), ...varintBytes(value)],
  bool: (field: number, value: boolean): number[] => pb.varint(field, value ? 1 : 0),
  fixed32: (field: number, value: number): number[] => {
    const word = value >>> 0;
    return [...tag(field, WIRE_FIXED32), word & 0xff, (word >>> 8) & 0xff, (word >>> 16) & 0xff, (word >>> 24) & 0xff];
  },
  float: (field: number, value: number): number[] => {
    const view = new DataView(new ArrayBuffer(4));
    view.setFloat32(0, value, true);
    return [...tag(field, WIRE_FIXED32), ...new Uint8Array(view.buffer)];
  },
  bytes: (field: number, value: ArrayLike<number>): number[] => [...tag(field, WIRE_LENGTH), ...varintBytes(value.length), ...Array.from(value)],
};

// --- reading -----------------------------------------------------------------

/** Every field in `bytes`, in order. Throws on a truncated or unsupported field. */
export function parseFields(bytes: Uint8Array): PbField[] {
  const fields: PbField[] = [];
  let at = 0;

  const readVarint = (): number => {
    let value = 0;
    for (let i = 0; i < 10; i += 1) {
      if (at >= bytes.length) throw new ProtobufError('truncated varint');
      const byte = bytes[at];
      at += 1;
      value += (byte & 0x7f) * 2 ** (7 * i);
      if (!(byte & 0x80)) return value;
    }
    throw new ProtobufError('varint too long');
  };

  while (at < bytes.length) {
    const key = readVarint();
    const field = Math.floor(key / 8);
    const wire = key % 8;
    if (field === 0) throw new ProtobufError('field number 0');
    if (wire === WIRE_VARINT) {
      fields.push({ field, wire, value: readVarint(), bytes: EMPTY });
    } else if (wire === WIRE_FIXED32) {
      if (at + 4 > bytes.length) throw new ProtobufError('truncated fixed32');
      const value = (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
      at += 4;
      fields.push({ field, wire, value, bytes: EMPTY });
    } else if (wire === WIRE_FIXED64) {
      if (at + 8 > bytes.length) throw new ProtobufError('truncated fixed64');
      at += 8;
      fields.push({ field, wire, value: 0, bytes: EMPTY });
    } else if (wire === WIRE_LENGTH) {
      const length = readVarint();
      if (at + length > bytes.length) throw new ProtobufError('truncated length-delimited field');
      fields.push({ field, wire, value: 0, bytes: bytes.subarray(at, at + length) });
      at += length;
    } else {
      throw new ProtobufError(`unsupported wire type ${wire}`);
    }
  }
  return fields;
}

/** The last occurrence of `field` (proto3 semantics: a repeated scalar keeps the final value). */
export function lastField(fields: PbField[], field: number, wire?: number): PbField | undefined {
  for (let i = fields.length - 1; i >= 0; i -= 1) {
    if (fields[i].field === field && (wire === undefined || fields[i].wire === wire)) return fields[i];
  }
  return undefined;
}

export const varintOf = (fields: PbField[], field: number): number => lastField(fields, field, WIRE_VARINT)?.value ?? 0;

export const boolOf = (fields: PbField[], field: number): boolean => varintOf(fields, field) !== 0;

export const stringOf = (fields: PbField[], field: number): string =>
  new TextDecoder().decode(lastField(fields, field, WIRE_LENGTH)?.bytes ?? EMPTY);

/** A nested message's fields, or null when it is absent (as opposed to present and empty). */
export const messageOf = (fields: PbField[], field: number): PbField[] | null => {
  const found = lastField(fields, field, WIRE_LENGTH);
  return found ? parseFields(found.bytes) : null;
};

export const floatOf = (fields: PbField[], field: number): number => {
  const found = lastField(fields, field, WIRE_FIXED32);
  if (!found) return 0;
  const view = new DataView(new ArrayBuffer(4));
  view.setUint32(0, found.value, true);
  return view.getFloat32(0, true);
};

export const hasField = (fields: PbField[], field: number): boolean => lastField(fields, field) !== undefined;
