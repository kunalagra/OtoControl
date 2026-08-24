/**
 * Web Bluetooth GATT transport, beside the WebSerial one in `transport.ts`.
 *
 * Soundcore only. Its earbuds expose no serial service at all, so BLE GATT is
 * the only way to reach them; every other brand this app drives speaks RFCOMM
 * and belongs to `transport.ts`.
 *
 * Nothing used to be listed here too, on the assumption that its protocol ran
 * over either carrier. It does not. `AEAC4A03-DFF5-498F-843A-34487CF133EB` is
 * an RFCOMM *service class* UUID, not a GATT service: in the official app
 * (com.nothing.smartcenter 3.7.3) every earphone connects through
 * `EarphonesPluginImpl` → `getSppConnector(...)` with that UUID, and the only
 * GATT it ever speaks is firmware update — service
 * `66666666-6666-6666-6666-666666666666`, notify
 * `77777777-7777-7777-7777-777777777777`, BLE scan filter `FD90`, used solely
 * by `XBleOTAConnector`. Asking Chrome for `aeac4a03…` as a GATT service can
 * therefore never resolve, so Nothing is Web Serial only.
 *
 * The client layers only see the `Transport` interface, so a client runs
 * unchanged over either carrier; the only per-vendor choice is how the write
 * and notify characteristics are picked within the service
 * (`pickCharacteristics` below).
 */

import type { Brand } from './brand';
import type { Transport, TransportHandlers } from './transport';

/**
 * Soundcore's GATT services live in a 256-UUID family,
 * `01xxf5da-0000-1000-8000-00805f9b34fb`, one per model — from
 * SoundcoreManager's `generate_soundcore_service_uuids`, which passes the
 * whole family as `optionalServices` and filters the chooser by Anker's
 * manufacturer-data company ids instead. The first UUID group is 8 hex
 * characters (`01` + model byte + `f5da`); anything wider is not a UUID and
 * Chrome rejects the whole `requestDevice()` call.
 */
export const SOUNDCORE_SERVICE_PATTERN = /^01[0-9a-f]{2}f5da-0000-1000-8000-00805f9b34fb$/;

/** Every UUID in Soundcore's service family, for `optionalServices`. */
export const soundcoreServiceUuids = (): string[] =>
  Array.from({ length: 256 }, (_, i) =>
    `01${i.toString(16).padStart(2, '0')}f5da-0000-1000-8000-00805f9b34fb`,
  );

export const isSoundcoreService = (uuid: string): boolean =>
  SOUNDCORE_SERVICE_PATTERN.test(uuid);

/**
 * Anker's Bluetooth address prefixes, as manufacturer-data company ids.
 *
 * Chrome takes a 16-bit companyIdentifier; SoundcoreManager packs it from the
 * first two address bytes as `(prefix[1] << 8) | prefix[0]`, giving 0x12AC for
 * AC:12:2F… and 0xEEE8 for E8:EE:CC…. Anything wider is rejected by
 * `requestDevice` before the chooser ever opens.
 */
export const SOUNDCORE_COMPANY_IDS = [0x12ac, 0xeee8] as const;

/**
 * Every GATT service this app can drive, mirroring `KNOWN_SERVICES` — but for
 * BLE, where the picker filters on manufacturer data and the driver is only
 * known after connecting and listing services.
 */
export interface KnownGattService {
  /** A literal UUID, or a recogniser for a family like Soundcore's. */
  matches(uuid: string): boolean;
  brand: Brand;
}

export const KNOWN_GATT_SERVICES: readonly KnownGattService[] = [
  { matches: isSoundcoreService, brand: 'soundcore' },
];

export function gattServiceBrand(uuid: string): Brand | null {
  return KNOWN_GATT_SERVICES.find((service) => service.matches(uuid))?.brand ?? null;
}

export const isWebBluetoothSupported = (): boolean =>
  typeof navigator !== 'undefined' && 'bluetooth' in navigator;

/**
 * Shows the Bluetooth chooser. Devices are offered by Anker's manufacturer
 * data, because that is what is visible *before* connecting; the driver is
 * resolved from the services the device actually exposes once connected. Must
 * be called from a user gesture.
 */
export async function requestGattDevice(): Promise<BluetoothDevice> {
  return navigator.bluetooth.requestDevice({
    filters: SOUNDCORE_COMPANY_IDS.map((companyIdentifier) => ({
      manufacturerData: [{ companyIdentifier }],
    })),
    optionalServices: soundcoreServiceUuids(),
  });
}

/** Previously granted BLE devices, for silent reconnect. Chrome 122+. */
export async function grantedGattDevices(): Promise<BluetoothDevice[]> {
  if (!isWebBluetoothSupported() || !('getDevices' in navigator.bluetooth)) return [];
  try {
    return await navigator.bluetooth.getDevices();
  } catch {
    return [];
  }
}

/** Wraps Chrome's GATT failures with the causes worth checking. */
export class GattOpenError extends Error {
  readonly reason: unknown;

  constructor(reason: unknown) {
    super(
      'Could not open the Bluetooth connection. The device may be out of range, ' +
        'already connected to another app, or not in a connectable state.',
    );
    this.name = 'GattOpenError';
    this.reason = reason;
  }
}

/**
 * Which characteristics to write and listen on, within the resolved service.
 *
 * Neither vendor documents fixed characteristic UUIDs: SoundcoreManager picks
 * them positionally and Gadgetbridge only pins the service. Picking by
 * property flags — the first that can write, the first that can notify —
 * covers both without vendor-specific knowledge, and positional order as the
 * tiebreaker matches what both reference implementations see in practice.
 */
export function pickCharacteristics(
  characteristics: BluetoothRemoteGATTCharacteristic[],
): { write: BluetoothRemoteGATTCharacteristic; notify: BluetoothRemoteGATTCharacteristic } {
  const write = characteristics.find((c) => c.properties.write || c.properties.writeWithoutResponse);
  const notify = characteristics.find((c) => c.properties.notify || c.properties.indicate);
  if (!write || !notify) {
    throw new GattOpenError(new Error('service has no writable/notifying characteristic'));
  }
  return { write, notify };
}

export class GattTransport implements Transport {
  readonly #device: BluetoothDevice;
  readonly #write: BluetoothRemoteGATTCharacteristic;
  readonly #notify: BluetoothRemoteGATTCharacteristic;
  #handlers: TransportHandlers | null = null;
  #onValueChanged: (() => void) | null = null;
  #onDisconnected: (() => void) | null = null;
  #closing = false;

  private constructor(
    device: BluetoothDevice,
    write: BluetoothRemoteGATTCharacteristic,
    notify: BluetoothRemoteGATTCharacteristic,
  ) {
    this.#device = device;
    this.#write = write;
    this.#notify = notify;
  }

  /**
   * Connects and resolves the service and characteristics — **without**
   * wiring listeners — so the caller can decide which driver should own the
   * connection *before* anything flows. `start` attaches the handlers.
   *
   * One connection per pick is deliberate: Chrome's macOS Bluetooth stack
   * segfaults the browser process on rapid connect→disconnect→connect cycles
   * (verified the hard way), so this app never opens a second GATT connection
   * to resolve a brand it could read off the first one.
   */
  static async open(
    device: BluetoothDevice,
    options: { serviceUuid?: string } = {},
  ): Promise<GattTransport> {
    let server: BluetoothRemoteGATTServer;
    let services: BluetoothRemoteGATTService[];
    try {
      server = await device.gatt!.connect();
      services = await (options.serviceUuid
        ? server.getPrimaryServices(options.serviceUuid)
        : server.getPrimaryServices());
    } catch (error) {
      throw new GattOpenError(error);
    }
    if (services.length === 0) throw new GattOpenError(new Error('device exposed no services'));

    const characteristics = await services[0].getCharacteristics();
    const { write, notify } = pickCharacteristics(characteristics);

    return new GattTransport(device, write, notify);
  }

  /**
   * Attaches the data/close handlers and begins notifications. Idempotent.
   * Split from `open` so a transport can be brand-resolved and handed to a
   * driver while its connection is still the only one ever made.
   */
  start(handlers: TransportHandlers): void {
    if (this.#handlers) return;
    this.#handlers = handlers;

    this.#onValueChanged = () => {
      const value = this.#notify.value;
      if (!value) return;
      this.#handlers!.onData(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    };
    this.#notify.addEventListener('characteristicvaluechanged', this.#onValueChanged);
    void this.#notify.startNotifications().catch((error: Error) => {
      console.warn('[gatt] could not start notifications', error);
    });

    this.#onDisconnected = () => {
      if (!this.#closing) this.#handlers?.onClose(new Error('Bluetooth connection lost'));
    };
    this.#device.addEventListener('gattserverdisconnected', this.#onDisconnected);
  }

  /** The device this transport rides — its advertised name identifies the model. */
  get device(): BluetoothDevice {
    return this.#device;
  }

  get isOpen(): boolean {
    return this.#device.gatt?.connected === true;
  }

  /** The brand-resolving service UUID this transport is speaking. */
  get serviceUuid(): string | null {
    // The characteristic's parent service is the one we resolved in open().
    return this.#notify.service?.uuid ?? null;
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (!this.isOpen) throw new Error('transport is closed');
    try {
      await this.#write.writeValueWithoutResponse(new Uint8Array(bytes));
    } catch {
      // A characteristic that only supports acknowledged writes rejects the
      // above; fall back rather than knowing per-vendor.
      await this.#write.writeValue(new Uint8Array(bytes));
    }
  }

  async close(): Promise<void> {
    if (this.#closing) return;
    this.#closing = true;
    if (this.#onValueChanged) {
      this.#notify.removeEventListener('characteristicvaluechanged', this.#onValueChanged);
      this.#onValueChanged = null;
    }
    if (this.#onDisconnected) {
      this.#device.removeEventListener('gattserverdisconnected', this.#onDisconnected);
      this.#onDisconnected = null;
    }
    await this.#notify.stopNotifications().catch(() => undefined);
    if (this.#device.gatt?.connected) this.#device.gatt.disconnect();
  }
}

/** Opens, starts, and returns — the one-shot form the opener seam wants. */
export const openGattTransport = (
  device: BluetoothDevice,
  handlers: TransportHandlers,
  options?: { serviceUuid?: string },
): Promise<Transport> =>
  GattTransport.open(device, options).then((transport) => {
    transport.start(handlers);
    return transport;
  });
