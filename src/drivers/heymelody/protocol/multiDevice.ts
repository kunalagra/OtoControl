/**
 * The connected-device list: `0x0112` read, and the same list after the `0x0204` push event 6.
 * Reply `[status][count]` then entries `[mac(6, little-endian)][entryLen][state][flags][nameLen][name]`.
 */

import { statusBody } from './status';

export interface PeerDevice {
  mac: string;
  name: string;
  connected: boolean;
  isThisDevice: boolean;
  audioActive: boolean;
}

const STATE_CONNECTED = 0x02;
const FLAG_THIS_DEVICE = 0x01;
const FLAG_AUDIO_ACTIVE = 0x04;
/** The fixed bytes an entry's `entryLen` counts besides the name: state, flags, nameLen. */
const ENTRY_FIXED = 3;
const MAC_LENGTH = 6;
const HEADER = MAC_LENGTH + 1 + ENTRY_FIXED;

const formatMac = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .reverse()
    .map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())
    .join(':');

/** `[count][entries]`, no status byte (the push carries the list this way). */
export function decodePeerList(list: Uint8Array): PeerDevice[] {
  const count = list[0] ?? 0;
  const decoder = new TextDecoder();
  const peers: PeerDevice[] = [];
  let at = 1;
  for (let i = 0; i < count && at + HEADER <= list.length; i += 1) {
    const macBytes = list.subarray(at, at + MAC_LENGTH);
    const entryLen = list[at + MAC_LENGTH];
    const state = list[at + MAC_LENGTH + 1];
    const flags = list[at + MAC_LENGTH + 2];
    const nameLen = list[at + MAC_LENGTH + 3];
    const nameStart = at + HEADER;
    const nameEnd = nameStart + nameLen;
    if (nameEnd > list.length) break;
    if (macBytes.some((byte) => byte !== 0)) {
      peers.push({
        mac: formatMac(macBytes),
        name: decoder.decode(list.subarray(nameStart, nameEnd)),
        connected: state === STATE_CONNECTED,
        isThisDevice: (flags & FLAG_THIS_DEVICE) !== 0,
        audioActive: (flags & FLAG_AUDIO_ACTIVE) !== 0,
      });
    }
    // Firmware may pad an entry past its name; trust that only while it stays inside the buffer.
    const next = nameEnd + (entryLen - nameLen - ENTRY_FIXED);
    at = next >= nameEnd && next <= list.length ? next : nameEnd;
  }
  return peers;
}

export function decodePeerReply(payload: Uint8Array): PeerDevice[] {
  return decodePeerList(statusBody(payload, 'connected devices'));
}
