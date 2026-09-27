import { describe, expect, it } from 'vitest';
import { BOOTSTRAP_COMMANDS, CAPABILITY_TABLE, decodeCapabilities, featuresFromCommands } from './capability';

describe('CAPABILITY_TABLE (realme Protocol.java:179, resolved 2026-09-27)', () => {
  it('has 61 rows with the documented commands at their bits', () => {
    expect(CAPABILITY_TABLE).toHaveLength(61);
    expect(CAPABILITY_TABLE[1]).toEqual([0x0106]);
    expect(CAPABILITY_TABLE[8]).toEqual([0x010c, 0x0404]);
    expect(CAPABILITY_TABLE[34]).toEqual([0x0122, 0x0418]);
    expect(CAPABILITY_TABLE[60]).toEqual([0x042c]);
    expect(CAPABILITY_TABLE[12]).toEqual([]);
  });
});

describe('decodeCapabilities', () => {
  it('maps LSB-first bits to commands and always includes the bootstrap set', () => {
    // bit1 battery, bit8 anc, bit10 eq, bit34 eqAll/custom
    const commands = decodeCapabilities(Uint8Array.from([0x00, 0x02, 0x05, 0x00, 0x00, 0x04]));
    expect([...commands]).toEqual(expect.arrayContaining([0x0106, 0x010c, 0x0404, 0x0406, 0x010f, 0x0122, 0x0418]));
    expect(commands.has(0x0109)).toBe(false);
    for (const cmd of BOOTSTRAP_COMMANDS) expect(commands.has(cmd)).toBe(true);
  });

  it('treats a short bitmap as unsupported and ignores bits past the table', () => {
    expect(decodeCapabilities(Uint8Array.from([0x00, 0x02])).has(0x0418)).toBe(false);
    const long = decodeCapabilities(Uint8Array.from([0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff]));
    expect([...long].every((cmd) => BOOTSTRAP_COMMANDS.has(cmd))).toBe(true);
  });

  it('always allows battery and the feature-switch query, as HeyTap does (R6/a.java bootstrap set)', () => {
    // OPPO firmware may leave bit 1 unset because the HeyTap app never needs it for battery.
    const commands = decodeCapabilities(Uint8Array.from([0x00]));
    expect(commands.has(0x0106)).toBe(true);
    expect(commands.has(0x010d)).toBe(true);
  });

  it('throws on a non-zero status', () => {
    expect(() => decodeCapabilities(Uint8Array.from([0x01, 0xff]))).toThrow();
  });
});

describe('featuresFromCommands', () => {
  it('names the features a command set supports', () => {
    const features = featuresFromCommands(new Set([0x0105, 0x0106, 0x0109, 0x0400, 0x010c, 0x0406, 0x0418]));
    expect(features).toEqual(new Set(['version', 'battery', 'wear', 'find', 'anc', 'eq', 'eqCustom']));
  });

  it('counts eq when only the preset list (0x0122) is supported', () => {
    expect(featuresFromCommands(new Set([0x0122]))).toEqual(new Set(['eq']));
  });
});
