import { describe, expect, it } from 'vitest';
import {
  CAP,
  Cmd,
  DEVICE_INFO_DEFAULT_IDS,
  Info,
  decodeBattery,
  decodeBoolean,
  decodeCapabilities,
  decodeEqCurrent,
  decodeInfoBatch,
  decodeKeys,
  decodeMultipoint,
  encodeAncFade,
  encodeAncMode,
  encodeDeviceInfoQuery,
  encodeEqPreset,
  encodeKey,
  encodeMultipointMac,
} from './commands';

describe('command and info ids', () => {
  it('matches Command.java verbatim', () => {
    expect(Cmd.Eq).toBe(32);
    expect(Cmd.Key).toBe(34);
    expect(Cmd.DeviceInfo).toBe(39);
    expect(Cmd.Notify).toBe(40);
    expect(Cmd.FindDevice).toBe(42);
    expect(Cmd.Multipoint).toBe(51);
    expect(Cmd.Anc).toBe(53);
    expect(Cmd.SpatialAudio).toBe(50);
    expect(Cmd.OtaGetInfo).toBe(-96);
    expect(Cmd.OtaStart).toBe(-95);
    expect(Cmd.OtaSendData).toBe(-94);
  });

  it('default poll is the 34-id DeviceInfoRequest.d set with no 27', () => {
    expect(DEVICE_INFO_DEFAULT_IDS).toHaveLength(34);
    expect(DEVICE_INFO_DEFAULT_IDS).not.toContain(27);
    expect(DEVICE_INFO_DEFAULT_IDS.slice(0, 3)).toEqual([1, 2, 3]);
    expect(DEVICE_INFO_DEFAULT_IDS.slice(-3)).toEqual([33, 42, -2]);
  });
});

describe('encodeDeviceInfoQuery', () => {
  it('emits flat [infoId, 0x00] pairs', () => {
    expect(Array.from(encodeDeviceInfoQuery([1, 2, -2]))).toEqual([1, 0, 2, 0, 254, 0]);
  });
});

describe('decodeBattery', () => {
  it('unpacks bit7 charging + 7-bit level per side', () => {
    // DevicePower: [left][right][case]; DeviceComponentPower: charging = b&128, level = b&127.
    const power = decodeBattery(Uint8Array.from([0x85, 0x40, 0x00]));
    expect(power?.left).toEqual({ level: 5, charging: true });
    expect(power?.right).toEqual({ level: 64, charging: false });
    expect(power?.case).toEqual({ level: 0, charging: false });
  });

  it('degrades gracefully on short payloads', () => {
    const power = decodeBattery(Uint8Array.from([0x81]));
    expect(power?.left).toEqual({ level: 1, charging: true });
    expect(power?.right).toBeNull();
    expect(power?.case).toBeNull();
  });

  it('rejects an empty payload', () => {
    expect(decodeBattery(new Uint8Array(0))).toBeNull();
  });
});

describe('decodeBoolean', () => {
  it('is strict: only 0x00/0x01 decode', () => {
    expect(decodeBoolean(Uint8Array.from([0x01]))).toBe(true);
    expect(decodeBoolean(Uint8Array.from([0x00]))).toBe(false);
    expect(decodeBoolean(Uint8Array.from([0x02]))).toBeNull();
    expect(decodeBoolean(new Uint8Array(0))).toBeNull();
  });
});

describe('EQ', () => {
  it('encodes preset and custom setters as [10][mode][10 gains]', () => {
    // EqRequest: count=10, mode, then gains; custom mode = index + 32.
    const gains = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(Array.from(encodeEqPreset(3, gains))).toEqual([10, 3, ...gains]);
    expect(Array.from(encodeEqPreset(2, gains, true))).toEqual([10, 34, ...gains]);
  });

  it('decodes the current-setting readout with its consistency check', () => {
    // RemoteEqSettingPayloadHandler: [N][mode][N gains], remaining == 1 + N.
    const setting = decodeEqCurrent(Uint8Array.from([10, 5, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
    expect(setting).toEqual({ mode: 5, gains: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], custom: false });
  });

  it('decodes a 1-byte payload as mode-only', () => {
    expect(decodeEqCurrent(Uint8Array.from([0x22]))).toEqual({ mode: 0x22, gains: [], custom: true });
  });

  it('rejects inconsistent lengths', () => {
    expect(decodeEqCurrent(Uint8Array.from([10, 5, 1, 2]))).toBeNull();
  });
});

describe('keys', () => {
  it('encodes a key write as TLV [keyType][len=1][fn]', () => {
    expect(Array.from(encodeKey(3, 7))).toEqual([3, 1, 7]);
  });

  it('keeps only len==1 records on readout, skipping the rest', () => {
    // KeyPayloadHandler: stream of [type][len][value…], position skipped when len != 1.
    const map = decodeKeys(Uint8Array.from([0x03, 0x01, 0x07, 0x04, 0x02, 0xaa, 0xbb, 0x05, 0x01, 0x00]));
    expect(map).toEqual(new Map([[3, 7], [5, 0]]));
  });
});

describe('ANC', () => {
  it('encodes mode and fade setters as single-tag TLVs', () => {
    // AncRequest tags: 1=mode, 4=fade; TlvRequest writes [tag][len][bytes].
    expect(Array.from(encodeAncMode(1))).toEqual([1, 1, 1]);
    expect(Array.from(encodeAncFade(true))).toEqual([4, 1, 1]);
  });
});

describe('multipoint', () => {
  it('XORs MACs with 0xAD in both directions', () => {
    const mac = [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff];
    const xored = encodeMultipointMac(mac);
    expect(xored.map((b) => b ^ 0xad)).toEqual(mac);
  });

  it('decodes records after the leading skip byte', () => {
    // MultipointPayloadHandler: skip 1, then [len][MAC×6 ^AD][name…][status], name len = len-7.
    const mac = [0x11, 0x22, 0x33, 0x44, 0x55, 0x66].map((b) => b ^ 0xad);
    const payload = Uint8Array.from([0x00, 10, ...mac, 0x41, 0x42, 0x43, 0x01]);
    expect(decodeMultipoint(payload)).toEqual([{ mac: '11:22:33:44:55:66', name: 'ABC', status: 1 }]);
  });
});

describe('decodeInfoBatch', () => {
  it('walks [id][len][value] records, including signed ids', () => {
    const batch = decodeInfoBatch(Uint8Array.from([0x01, 0x02, 0x85, 0x40, 0xfe, 0x02, 0x0d, 0x00]));
    expect(batch.map(({ id }) => id)).toEqual([1, -2]);
    expect(Array.from(batch[0].value)).toEqual([0x85, 0x40]);
    expect(Array.from(batch[1].value)).toEqual([0x0d, 0x00]);
  });

  it('stops at a truncated tail', () => {
    expect(decodeInfoBatch(Uint8Array.from([0x01, 0x05, 0xaa]))).toEqual([]);
  });
});

describe('decodeCapabilities', () => {
  it('reads the 2-byte LE bitmask with the DeviceCapacities bits', () => {
    const caps = decodeCapabilities(Uint8Array.from([0x0d, 0x00]));
    expect(caps).toEqual({ tws: true, spatial: false, multipoint: true, anc: true, voice: false, bass: false, antiWind: false });
    expect(CAP.Tws).toBe(1);
    expect(CAP.Anc).toBe(8);
    expect(Info.Capabilities).toBe(-2);
  });
});
