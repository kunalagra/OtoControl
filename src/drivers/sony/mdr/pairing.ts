/**
 * Sony multipoint: the paired-device list, connection routing and the
 * playback-device lock (`PERI_*`, second command table).
 *
 * This is Sony's answer to the Sennheiser "connections" feature: which
 * devices the headphones remember, which of them hold a link right now, and
 * which one audio routes to — plus the switch that pins routing to one
 * device. Byte shapes verified against Sony's own Sound Connect app
 * (decompiled — read as reference, nothing copied), with BudsLink's
 * `sonySocketV2` as the secondary reference. Gadgetbridge does not implement
 * this feature at all, so it cannot corroborate any of it.
 *
 * Every payload here rides `table: 2`. The connection-type byte after the
 * opcode is `0x00` for classic-BT device management and `0x02` where the
 * device also reports each peer's Bluetooth class of device; the source
 * switch ignores it and always uses its own `0x01` selector.
 *
 * **The two connection types carry different device-list layouts**, which is
 * the one thing every third-party implementation of this gets wrong — see
 * `decodePairedDevices`.
 */

/** `PERI_*`, table 2. */
export const PAIRING_GET = 0x36;
export const PAIRING_RET = 0x37;
export const PAIRING_SET = 0x38;
export const PAIRING_NOTIFY = 0x39;
export const PAIRING_SET_EXTENDED = 0x3c;
export const PAIRING_NOTIFY_EXTENDED = 0x3d;

/** Connection types, from `ConnectionType`. */
const CLASSIC = 0x00;
const WITH_CLASS_OF_DEVICE = 0x02;

/** The source switch's own selector, independent of connection type. */
const SELECTOR_SOURCE_SWITCH = 0x01;

/**
 * Which connection-type byte a device's capabilities imply, or null when it
 * reports no pairing-device management at all.
 */
export function pairingTypeFor(capabilities: Set<number>): number | null {
  if (capabilities.has(0x30)) return CLASSIC;
  if (capabilities.has(0x32) || capabilities.has(0x33)) return WITH_CLASS_OF_DEVICE;
  return null;
}

export interface PairedDevice {
  /** 17-character ASCII mac, as the wire carries it. */
  mac: string
  name: string
  /**
   * The raw status byte. Zero means the headphones remember the device but
   * hold no link to it; non-zero is the multipoint slot the live link
   * occupies, which is why Sony sorts its "connected" list by this value and
   * why the body's trailing byte is matched against it rather than used as an
   * index (see `decodePairedDevices`).
   */
  status: number
  connected: boolean
  /**
   * The peer's 24-bit Bluetooth class of device, on connection type `0x02`
   * only; null on type `0x00`, whose entries do not carry it. Sony reads the
   * major-class bits off this to label a peer — `(cod & 0x1f00) === 0x0100`
   * is a computer.
   */
  classOfDevice: number | null
}

/** `[0x36, connectionType]`. */
export const encodeGetPairedDevices = (connectionType: number): number[] => [
  PAIRING_GET,
  connectionType,
];

/** `[0x36, 0x01]` — the playback fix has its own selector. */
export const encodeGetPlaybackFixed = (): number[] => [PAIRING_GET, SELECTOR_SOURCE_SWITCH];

/** Sony rejects a name length outside this range before reading the name. */
const MIN_NAME_LENGTH = 1;
const MAX_NAME_LENGTH = 128;

/**
 * Reads a device-list body: `[opcode, connectionType, count, …entries, playback]`.
 *
 * **Two layouts, chosen by connection type.** Per entry:
 *
 * - type `0x00` (classic BT): 17-byte mac, status, name length, name —
 *   stride `19 + nameLength`.
 * - type `0x02` (with class of device): 17-byte mac, status, **3-byte class
 *   of device**, name length, name — stride `22 + nameLength`.
 *
 * Sony implements these as two separate parsers and dispatches on the type
 * byte: `lg0/j.java` and `lg0/s.java` for `0x00`, `mg0/b.java` for `0x02`
 * (whose validator names the extra field, logging
 * `bytes.length < indexBluetoothClassOfDevice`). This parser used to apply
 * the `0x02` stride to both — inherited from BudsLink, which only implements
 * that one — so on a `0x00` device it read the name length three bytes late
 * and threw on every list.
 *
 * **The trailing byte is a status value, not an index.** It names which
 * device holds playback by matching an entry's status byte, which is how
 * Sony's own UI decides where to draw the "playing" indicator
 * (`MultipointDeviceSettingsFragment`: `kVar.d() == i11`). Reading it as a
 * one-based index happens to agree whenever the routed device is both first
 * in the list and in slot 1 — the common case, and the reason a test can pass
 * under either reading.
 */
export function decodePairedDevices(
  payload: Uint8Array,
  connectionType: number,
): { devices: PairedDevice[]; playbackMac: string | null } {
  if (payload[1] !== connectionType) throw new Error('wrong connection type for this body');
  if (payload.length < 4) throw new Error('expected at least 4 bytes');
  const carriesClassOfDevice = connectionType === WITH_CLASS_OF_DEVICE;
  const count = payload[2];

  const devices: PairedDevice[] = [];
  let offset = 3;
  for (let i = 0; i < count; i += 1) {
    // mac(17) + status(1) + [class of device(3)] + nameLength(1)
    const headerLength = carriesClassOfDevice ? 22 : 19;
    if (payload.length < offset + headerLength) {
      throw new Error('device entry runs past the body');
    }
    const mac = String.fromCharCode(...payload.slice(offset, offset + 17)).trimEnd();
    const status = payload[offset + 17];
    const classOfDevice = carriesClassOfDevice
      ? (payload[offset + 18] << 16) | (payload[offset + 19] << 8) | payload[offset + 20]
      : null;
    const nameLength = payload[offset + headerLength - 1];
    if (nameLength < MIN_NAME_LENGTH || nameLength > MAX_NAME_LENGTH) {
      throw new Error('name length outside the range the device can send');
    }
    offset += headerLength;
    if (payload.length < offset + nameLength) throw new Error('device name runs past the body');
    const name = String.fromCharCode(...payload.slice(offset, offset + nameLength));
    offset += nameLength;
    devices.push({ mac, name, status, connected: status > 0, classOfDevice });
  }
  if (payload.length !== offset + 1) throw new Error('trailing bytes after the last entry');

  const playbackStatus = payload[offset];
  const playback = devices.find((device) => device.status === playbackStatus) ?? null;
  return { devices, playbackMac: playback ? playback.mac : null };
}

const macBytes = (mac: string): number[] => {
  if (mac.length !== 17) throw new Error('mac must be the 17-character wire form');
  return [...mac].map((c) => c.charCodeAt(0));
};

/** `[0x3C, connectionType, 0x01, mac]` — take up the link to a remembered device. */
export const encodeConnectPairedDevice = (connectionType: number, mac: string): number[] => [
  PAIRING_SET_EXTENDED,
  connectionType,
  0x01,
  ...macBytes(mac),
];

/** `[0x3C, connectionType, 0x00, mac]` — drop the link to one. */
export const encodeDisconnectPairedDevice = (connectionType: number, mac: string): number[] => [
  PAIRING_SET_EXTENDED,
  connectionType,
  0x00,
  ...macBytes(mac),
];

/** `[0x3C, connectionType, 0x02, mac]` — forget one entirely. */
export const encodeUnpairDevice = (connectionType: number, mac: string): number[] => [
  PAIRING_SET_EXTENDED,
  connectionType,
  0x02,
  ...macBytes(mac),
];

/** `[0x3C, 0x01, mac]` — route audio to a remembered device. */
export const encodeSetPlaybackDevice = (mac: string): number[] => [
  PAIRING_SET_EXTENDED,
  SELECTOR_SOURCE_SWITCH,
  ...macBytes(mac),
];

/** `[0x38, 0x01, onOff]` — pin routing to the current playback device. */
export const encodeSetPlaybackFixed = (enabled: boolean): number[] => [
  PAIRING_SET,
  SELECTOR_SOURCE_SWITCH,
  enabled ? 0x00 : 0x01,
];

/** Reads `[0x37|0x39, 0x01, onOff]`. */
export function decodePlaybackFixed(payload: Uint8Array): boolean {
  if (payload[1] !== SELECTOR_SOURCE_SWITCH) throw new Error('not a playback-fix body');
  if (payload.length < 3) throw new Error('expected at least 3 bytes');
  return payload[2] === 0x00;
}

/** Whether a table-2 reply body is a device-list one for this connection type. */
export const isPairedDevicesReply = (payload: Uint8Array, connectionType: number): boolean =>
  (payload[0] === PAIRING_RET || payload[0] === PAIRING_NOTIFY) &&
  payload[1] === connectionType;

/** Whether a table-2 reply body is the playback-fix one. */
export const isPlaybackFixedReply = (payload: Uint8Array): boolean =>
  (payload[0] === PAIRING_RET || payload[0] === PAIRING_NOTIFY) &&
  payload[1] === SELECTOR_SOURCE_SWITCH;

/**
 * Whether a body is the extended-param push that names the playback device.
 *
 * The device sends this whenever routing moves, and it is authoritative —
 * without it `playbackMac` only ever changes on our own optimistic write or
 * the next full list read.
 */
export const isPlaybackDeviceNotify = (payload: Uint8Array): boolean =>
  payload[0] === PAIRING_NOTIFY_EXTENDED && payload[1] === SELECTOR_SOURCE_SWITCH;

/** Reads `[0x3d, 0x01, …17-byte mac]`. */
export function decodePlaybackDeviceNotify(payload: Uint8Array): string {
  if (payload[1] !== SELECTOR_SOURCE_SWITCH) throw new Error('not a source-switch body');
  if (payload.length < 19) throw new Error('expected at least 19 bytes');
  return String.fromCharCode(...payload.slice(2, 19)).trimEnd();
}
