import { describe, expect, it } from 'vitest';

import { decodePeerList, decodePeerReply } from './multiDevice';

const text = (value: string) => Array.from(new TextEncoder().encode(value));

const entry = (mac: number[], entryLen: number, state: number, flags: number, name: string) => [
  ...mac,
  entryLen,
  state,
  flags,
  name.length,
  ...text(name),
];

const DESK = (entryLen = 0x07) => entry([0x66, 0x55, 0x44, 0x33, 0x22, 0x11], entryLen, 0x02, 0x00, 'Desk');
const PHONE = () => entry([0x01, 0x02, 0x03, 0x04, 0x05, 0x06], 0x08, 0x02, 0x01, 'Phone');

describe('decodePeerList', () => {
  it('reads MACs reversed, names, and the this-device flag', () => {
    const peers = decodePeerList(Uint8Array.from([2, ...DESK(), ...PHONE()]));
    expect(peers).toEqual([
      { mac: '11:22:33:44:55:66', name: 'Desk', connected: true, isThisDevice: false, audioActive: false },
      { mac: '06:05:04:03:02:01', name: 'Phone', connected: true, isThisDevice: true, audioActive: false },
    ]);
  });

  it('reads the audio-active flag from bit 2 and a non-connected state', () => {
    const [peer] = decodePeerList(Uint8Array.from([1, ...entry([1, 2, 3, 4, 5, 6], 0x08, 0x01, 0x04, 'Pad!!')]));
    expect(peer.audioActive).toBe(true);
    expect(peer.isThisDevice).toBe(false);
    expect(peer.connected).toBe(false);
  });

  it('still decodes the next entry when entryLen overruns the buffer', () => {
    const peers = decodePeerList(Uint8Array.from([2, ...DESK(0x40), ...PHONE()]));
    expect(peers.map((p) => p.name)).toEqual(['Desk', 'Phone']);
  });

  it('skips an entry whose MAC is all zeros', () => {
    const zero = entry([0, 0, 0, 0, 0, 0], 0x07, 0x02, 0x00, 'Nope');
    const peers = decodePeerList(Uint8Array.from([2, ...zero, ...PHONE()]));
    expect(peers.map((p) => p.name)).toEqual(['Phone']);
  });

  it('falls back to the end of the name when entryLen points backwards', () => {
    const peers = decodePeerList(Uint8Array.from([2, ...DESK(0x01), ...PHONE()]));
    expect(peers.map((p) => p.name)).toEqual(['Desk', 'Phone']);
  });

  it('stops at the data when the count claims more entries than exist', () => {
    const peers = decodePeerList(Uint8Array.from([5, ...DESK(), ...PHONE()]));
    expect(peers.map((p) => p.name)).toEqual(['Desk', 'Phone']);
  });

  it('drops an entry whose name is cut short, keeping the ones before it', () => {
    const cut = PHONE().slice(0, -2);
    const peers = decodePeerList(Uint8Array.from([2, ...DESK(), ...cut]));
    expect(peers.map((p) => p.name)).toEqual(['Desk']);
  });

  it('reads a zero-length name as an empty string', () => {
    const [peer] = decodePeerList(Uint8Array.from([1, ...entry([1, 2, 3, 4, 5, 6], 0x03, 0x02, 0x00, '')]));
    expect(peer.name).toBe('');
    expect(peer.connected).toBe(true);
  });

  it('replaces invalid UTF-8 in a name instead of throwing', () => {
    const bytes = [1, 1, 2, 3, 4, 5, 6, 0x05, 0x02, 0x00, 2, 0xff, 0xfe];
    const [peer] = decodePeerList(Uint8Array.from(bytes));
    expect(peer.name).toBe('\uFFFD\uFFFD');
  });

  it('returns an empty list for a zero count', () => {
    expect(decodePeerList(Uint8Array.from([0]))).toEqual([]);
  });
});

describe('decodePeerReply', () => {
  it('strips the status byte', () => {
    expect(decodePeerReply(Uint8Array.from([0, 1, ...DESK()]))[0].name).toBe('Desk');
  });

  it('throws on a payload that starts with a non-zero status', () => {
    expect(() => decodePeerReply(Uint8Array.from([1, 1, ...DESK()]))).toThrow();
  });
});
