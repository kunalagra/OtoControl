import { describe, expect, it } from 'vitest';

import {
  addressForChannel,
  CANDIDATE_CHANNELS,
  decodeRpcPacket,
  encodeRpcPacket,
  hdlcAddress,
  PacketType,
  Peer,
  RpcError,
  rpcHash,
  statusName,
} from './rpc';

describe('rpcHash', () => {
  // Vectors from pbpctrl libmaestro/src/pwrpc/id.rs `test_known_id_hashes`.
  it.each([
    ['maestro_pw.Maestro', 0x7ede71ea],
    ['GetSoftwareInfo', 0x7199fa44],
    ['SubscribeToSettingsChanges', 0x2821adf5],
  ])('hashes %s', (name, expected) => {
    expect(rpcHash(name)).toBe(expected);
  });

  it('is case-sensitive, which is why the APK’s SetWallclock is not pbpctrl’s SetWallClock', () => {
    expect(rpcHash('SetWallclock')).not.toBe(rpcHash('SetWallClock'));
  });

  it('hashes the empty string to its length', () => {
    expect(rpcHash('')).toBe(0);
  });
});

describe('RpcPacket', () => {
  const MAESTRO = 0x7ede71ea;
  const GET_SOFTWARE_INFO = 0x7199fa44;

  it('encodes a plain request without type or call id (proto3 omits zeros)', () => {
    expect(Array.from(encodeRpcPacket({ channelId: 19, serviceId: MAESTRO, methodId: GET_SOFTWARE_INFO }))).toEqual([
      0x10, 0x13, 0x1d, 0xea, 0x71, 0xde, 0x7e, 0x25, 0x44, 0xfa, 0x99, 0x71,
    ]);
  });

  it('encodes a request payload as field 5', () => {
    const bytes = encodeRpcPacket({ channelId: 19, serviceId: MAESTRO, methodId: 1, payload: Uint8Array.of(0x20, 0x0d) });
    expect(Array.from(bytes.slice(-4))).toEqual([0x2a, 0x02, 0x20, 0x0d]);
  });

  it('round trips every field, including the announce call id', () => {
    const packet = {
      type: PacketType.Response,
      channelId: 21,
      serviceId: MAESTRO,
      methodId: GET_SOFTWARE_INFO,
      payload: Uint8Array.of(1, 2, 3),
      status: 2,
      callId: 0xffffffff,
    };
    expect(decodeRpcPacket(encodeRpcPacket(packet))).toEqual(packet);
  });

  it('defaults absent fields to zero', () => {
    expect(decodeRpcPacket(new Uint8Array(0))).toEqual({
      type: 0,
      channelId: 0,
      serviceId: 0,
      methodId: 0,
      payload: new Uint8Array(0),
      status: 0,
      callId: 0,
    });
  });
});

describe('addressing', () => {
  it('builds the HDLC address from source and target peers', () => {
    expect(hdlcAddress(Peer.MaestroA, Peer.LeftBtCore)).toBe(3712);
    expect(hdlcAddress(Peer.MaestroB, Peer.RightBtCore)).toBe((13 << 6) | (4 << 10));
  });

  it('knows exactly the six candidate channels, in pbpctrl’s order', () => {
    expect(CANDIDATE_CHANNELS.map((entry) => entry.channel)).toEqual([18, 19, 21, 23, 24, 26]);
    expect(addressForChannel(19)).toBe(3712);
    expect(addressForChannel(20)).toBeNull();
  });
});

describe('RpcError', () => {
  it('names the status', () => {
    expect(statusName(2)).toBe('UNKNOWN');
    expect(statusName(99)).toBe('status 99');
    expect(new RpcError('ReadSetting', 2).message).toBe('ReadSetting failed: UNKNOWN');
  });
});
