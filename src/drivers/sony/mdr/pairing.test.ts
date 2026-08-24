import { describe, expect, it } from 'vitest';

import {
  PAIRING_GET,
  PAIRING_RET,
  PAIRING_SET,
  PAIRING_NOTIFY,
  PAIRING_SET_EXTENDED,
  PAIRING_NOTIFY_EXTENDED,
  decodePairedDevices,
  decodePlaybackDeviceNotify,
  decodePlaybackFixed,
  encodeConnectPairedDevice,
  encodeDisconnectPairedDevice,
  encodeGetPairedDevices,
  encodeGetPlaybackFixed,
  encodeSetPlaybackDevice,
  encodeSetPlaybackFixed,
  encodeUnpairDevice,
  isPairedDevicesReply,
  isPlaybackDeviceNotify,
  isPlaybackFixedReply,
  pairingTypeFor,
} from './pairing';

const payload = (...bytes: number[]) => Uint8Array.from(bytes);
const MAC = 'AA:BB:CC:DD:EE:FF'; // 17 chars, as the wire carries it
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

/** A type-0x00 entry: 17-byte mac, status, name length, name. */
const classicEntry = (mac: string, status: number, name: string) => [
  ...ascii(mac.padEnd(17)),
  status,
  name.length,
  ...ascii(name),
];

/** A type-0x02 entry: the same, with a 3-byte class of device before the length. */
const codEntry = (mac: string, status: number, cod: number, name: string) => [
  ...ascii(mac.padEnd(17)),
  status,
  (cod >> 16) & 0xff,
  (cod >> 8) & 0xff,
  cod & 0xff,
  name.length,
  ...ascii(name),
];

const MACBOOK = '11:22:33:44:55:66';

describe('pairingTypeFor', () => {
  it('maps the classic capability to type 0x00 and the CoD ones to 0x02', () => {
    expect(pairingTypeFor(new Set([0x30]))).toBe(0x00);
    expect(pairingTypeFor(new Set([0x32]))).toBe(0x02);
    expect(pairingTypeFor(new Set([0x33]))).toBe(0x02);
    expect(pairingTypeFor(new Set([0x31]))).toBeNull();
  });
});

describe('device list (PERI param, table 2)', () => {
  it('reads with the connection type byte', () => {
    expect(encodeGetPairedDevices(0x00)).toEqual([0x36, 0x00]);
    expect(encodeGetPlaybackFixed()).toEqual([0x36, 0x01]);
  });

  it('decodes type-0x00 entries, which carry no class of device', () => {
    const body = [
      PAIRING_RET, 0x00, 2,
      ...classicEntry(MAC, 1, 'Pixel'),
      ...classicEntry(MACBOOK, 0, 'MacBook'),
      1,
    ];
    expect(decodePairedDevices(payload(...body), 0x00)).toEqual({
      devices: [
        { mac: MAC, name: 'Pixel', status: 1, connected: true, classOfDevice: null },
        { mac: MACBOOK, name: 'MacBook', status: 0, connected: false, classOfDevice: null },
      ],
      playbackMac: MAC,
    });
  });

  it('decodes type-0x02 entries, whose stride is three bytes longer', () => {
    // 0x000100 is the major "Computer" class Sony itself tests for.
    const body = [
      PAIRING_RET, 0x02, 2,
      ...codEntry(MAC, 1, 0x5a020c, 'Pixel'),
      ...codEntry(MACBOOK, 0, 0x000100, 'MacBook'),
      1,
    ];
    expect(decodePairedDevices(payload(...body), 0x02)).toEqual({
      devices: [
        { mac: MAC, name: 'Pixel', status: 1, connected: true, classOfDevice: 0x5a020c },
        { mac: MACBOOK, name: 'MacBook', status: 0, connected: false, classOfDevice: 0x000100 },
      ],
      playbackMac: MAC,
    });
  });

  it('treats the two strides as genuinely different, not interchangeable', () => {
    // Classic-layout entries under a type-0x02 header: the 22-byte stride
    // reads the name length out of the name itself, so the entry overruns.
    // This is the shape of the bug that used to break every type-0x00 device
    // — the wrong stride lands the length read three bytes late.
    const body = [PAIRING_RET, 0x02, 1, ...classicEntry(MAC, 1, 'Pixel'), 1];
    expect(() => decodePairedDevices(payload(...body), 0x02)).toThrow(
      /name runs past the body/,
    );
  });

  it('matches the trailing byte against each status, not against list order', () => {
    // The routed device sits *second* in the list and holds slot 1. Reading
    // the trailing byte as a one-based index would name Pixel; matching it
    // against the status bytes names MacBook, which is what Sony does.
    const body = [
      PAIRING_RET, 0x00, 2,
      ...classicEntry(MAC, 2, 'Pixel'),
      ...classicEntry(MACBOOK, 1, 'MacBook'),
      1,
    ];
    expect(decodePairedDevices(payload(...body), 0x00).playbackMac).toBe(MACBOOK);
  });

  it('leaves playback unnamed when no entry holds the trailing status', () => {
    const body = [PAIRING_RET, 0x00, 1, ...classicEntry(MAC, 1, 'Pixel'), 0x07];
    expect(decodePairedDevices(payload(...body), 0x00).playbackMac).toBeNull();
  });

  it('rejects a body of another connection type', () => {
    const body = [PAIRING_RET, 0x02, 0, 0];
    expect(() => decodePairedDevices(payload(...body), 0x00)).toThrow();
  });

  it('refuses a truncated entry rather than reading past the end', () => {
    const body = [PAIRING_RET, 0x00, 1, ...classicEntry(MAC, 1, 'Pi')];
    expect(() => decodePairedDevices(payload(...body), 0x00)).toThrow();
  });

  it('refuses a name length the device could never have sent', () => {
    // Sony bounds it to 1…128 before reading the name; a zero or a 200 means
    // the offsets have drifted, not that a device has an odd name.
    const zero = [PAIRING_RET, 0x00, 1, ...ascii(MAC), 1, 0, 1];
    expect(() => decodePairedDevices(payload(...zero), 0x00)).toThrow();
    const tooLong = [PAIRING_RET, 0x00, 1, ...ascii(MAC), 1, 200, ...new Array(200).fill(0x41), 1];
    expect(() => decodePairedDevices(payload(...tooLong), 0x00)).toThrow();
  });
});

describe('device actions (PERI extended param)', () => {
  it('carries the 17-byte mac after the action byte', () => {
    expect(encodeConnectPairedDevice(0x00, MAC)).toEqual([0x3c, 0x00, 0x01, ...ascii(MAC.padEnd(17))]);
    expect(encodeDisconnectPairedDevice(0x00, MAC)).toEqual([0x3c, 0x00, 0x00, ...ascii(MAC.padEnd(17))]);
    expect(encodeUnpairDevice(0x00, MAC)).toEqual([0x3c, 0x00, 0x02, ...ascii(MAC.padEnd(17))]);
  });

  it('switches playback under selector 0x01, whatever the connection type', () => {
    // The source switch has its own selector; BudsLink sends 0x01 here
    // regardless of the device's connection type.
    expect(encodeSetPlaybackDevice(MAC)).toEqual([0x3c, 0x01, ...ascii(MAC.padEnd(17))]);
  });
});

describe('playback fix', () => {
  it('writes the inverted on/off and reads it back', () => {
    expect(encodeSetPlaybackFixed(true)).toEqual([0x38, 0x01, 0x00]);
    expect(encodeSetPlaybackFixed(false)).toEqual([0x38, 0x01, 0x01]);
    expect(decodePlaybackFixed(payload(0x37, 0x01, 0x00))).toBe(true);
    expect(decodePlaybackFixed(payload(0x39, 0x01, 0x01))).toBe(false);
  });

  it('recognises its own replies apart from the device list', () => {
    expect(isPlaybackFixedReply(payload(0x37, 0x01, 0x00))).toBe(true);
    expect(isPlaybackFixedReply(payload(0x37, 0x00, 0x00))).toBe(false);
    expect(isPairedDevicesReply(payload(0x39, 0x00, 0x00), 0x00)).toBe(true);
    expect(isPairedDevicesReply(payload(0x39, 0x01, 0x00), 0x00)).toBe(false);
  });
});

describe('opcodes', () => {
  it('keeps the PERI grouping', () => {
    expect(PAIRING_GET).toBe(0x36);
    expect(PAIRING_RET).toBe(0x37);
    expect(PAIRING_SET).toBe(0x38);
    expect(PAIRING_NOTIFY).toBe(0x39);
    expect(PAIRING_SET_EXTENDED).toBe(0x3c);
  });
});

describe('playback-device notification (PERI extended param)', () => {
  it('recognises the 0x3d push and reads the mac out of it', () => {
    const body = payload(PAIRING_NOTIFY_EXTENDED, 0x01, ...ascii(MAC));
    expect(isPlaybackDeviceNotify(body)).toBe(true);
    expect(decodePlaybackDeviceNotify(body)).toBe(MAC);
  });

  it('is not confused with the device-list or playback-fix pushes', () => {
    expect(isPlaybackDeviceNotify(payload(PAIRING_NOTIFY, 0x01, 0x00))).toBe(false);
    expect(isPlaybackDeviceNotify(payload(PAIRING_NOTIFY_EXTENDED, 0x00, 0x00))).toBe(false);
  });

  it('refuses a body too short to hold a mac', () => {
    expect(() =>
      decodePlaybackDeviceNotify(payload(PAIRING_NOTIFY_EXTENDED, 0x01, 0x41, 0x41)),
    ).toThrow();
  });
});

