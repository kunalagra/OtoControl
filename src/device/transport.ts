/**
 * Web Serial transport for Bluetooth Classic RFCOMM control services.
 *
 * Vendor-neutral: the service ID a port was granted for tells us which protocol
 * the device speaks, so brand detection is a property of the port rather than
 * something the user picks.
 *
 * The client layers only see the `Transport` interface, so they can be tested
 * in Node against a fake without any browser APIs.
 */

import type { Brand } from './brand';

/** The Momentum 4's control service, confirmed on hardware. */
export const M4_SERVICE_UUID = 'a2129ff3-081b-4c45-8afe-469d9c4842ec';

/**
 * Sony's MDR service, in two generations. The WF-C500 reports v2 despite being
 * a 2021 budget model, so generation cannot be inferred from the model — it is
 * read from the granted port.
 */
export const SONY_MDR_V1_UUID = '96cc203e-5068-46ad-b32d-e316f5e069ba';
export const SONY_MDR_V2_UUID = '956c7b26-d49a-4ba8-b03f-b17d393cb6e2';

/**
 * The Momentum 4 also advertises an Airoha/RACE service. It shows up in
 * `getPorts()` alongside the control service, so auto-reconnect must match on
 * the service ID rather than taking the first granted port.
 */
export const AIROHA_SERVICE_UUID = '00000000-deca-fade-deca-deafdecacaff';

export type ProtocolGeneration = 'gaia' | 'mdr-v1' | 'mdr-v2';

export interface KnownService {
  uuid: string;
  brand: Brand;
  protocol: ProtocolGeneration;
}

/**
 * Every control service this app can drive.
 *
 * The one hand-maintained list this fact lives in. `driver.ts`'s
 * `services` per driver are filtered out of this array rather than
 * restated, so the two cannot drift apart — see `driver.test.ts` for the
 * two-way check. It is not the other way around (`KNOWN_SERVICES` deriving
 * from `driver.ts`'s `DRIVERS`) because that direction is circular:
 * `driver.ts` imports the device classes below, and both of those import
 * this module for `TransportOpener` and `openSerialTransport`.
 */
export const KNOWN_SERVICES: KnownService[] = [
  { uuid: M4_SERVICE_UUID, brand: 'sennheiser', protocol: 'gaia' },
  { uuid: SONY_MDR_V2_UUID, brand: 'sony', protocol: 'mdr-v2' },
  { uuid: SONY_MDR_V1_UUID, brand: 'sony', protocol: 'mdr-v1' },
];

const BAUD_RATE = 115200;

/**
 * The device is powered off, out of range, or not connected as audio.
 *
 * Not surfaced as an error banner: this is the ordinary state of headphones
 * that are simply switched off, and the Disconnected badge already says so.
 * Device classes catch it and set the status without a message.
 */
export class PortUnreachableError extends Error {
  constructor() {
    super('The device is not reachable — it is off, out of range, or not connected as audio.');
    this.name = 'PortUnreachableError';
  }
}

/**
 * Whether a failure is just "the headphones are off".
 *
 * Worth its own predicate because it is the one connection failure that is not
 * a problem — it needs no banner, only the status badge.
 */
export const isUnreachable = (error: unknown): boolean => error instanceof PortUnreachableError;

/** Wraps Chrome's opaque open failure with the causes worth checking. */
export class PortOpenError extends Error {
  /** Chrome's original error, kept for debugging. */
  readonly reason: unknown;

  constructor(reason: unknown) {
    super(
      'Could not open the device. It is usually held by something else — ' +
        'another tab with this app or the debug spike open, or another app ' +
        'talking to the headphones. Close those and try again.',
    );
    this.name = 'PortOpenError';
    this.reason = reason;
  }
}

const isAlreadyOpen = (error: unknown): boolean =>
  error instanceof DOMException &&
  error.name === 'InvalidStateError' &&
  /already open/i.test(error.message);

export interface Transport {
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
  readonly isOpen: boolean;
}

export interface TransportHandlers {
  onData(chunk: Uint8Array): void;
  /** Fired when the read loop ends — device out of range, powered off, closed. */
  onClose(reason?: Error): void;
}

/**
 * How a device class obtains a transport.
 *
 * Injected rather than called directly so tests can supply a fake. Both device
 * classes used to construct `SerialTransport` themselves, which is exactly why
 * neither had a single test — and why two real bugs shipped in their
 * orchestration before a reviewer caught them by reading.
 */
export type TransportOpener = (
  port: SerialPort,
  handlers: TransportHandlers,
) => Promise<Transport>;

export const isWebSerialSupported = (): boolean =>
  typeof navigator !== 'undefined' && 'serial' in navigator;

const serviceIdOf = (port: SerialPort): string =>
  String(port.getInfo().bluetoothServiceClassId ?? '').toLowerCase();

/**
 * Which protocol a granted port speaks, or null if it is not one we drive.
 *
 * Ports for services we do not support show up in `getPorts()` too — the M4
 * exposes an Airoha service alongside its control one — so this must be
 * consulted rather than taking the first port.
 */
export function serviceForPort(port: SerialPort): KnownService | null {
  const id = serviceIdOf(port);
  return KNOWN_SERVICES.find((service) => service.uuid === id) ?? null;
}

export interface GrantedPort {
  port: SerialPort;
  service: KnownService;
}

/**
 * Every previously granted port we can drive.
 *
 * Chrome returns ports for services we do not support too — the M4 exposes an
 * Airoha service alongside its control one — so the list is filtered.
 */
export async function listGrantedPorts(): Promise<GrantedPort[]> {
  if (!isWebSerialSupported()) return [];
  const granted: GrantedPort[] = [];
  for (const port of await navigator.serial.getPorts()) {
    const service = serviceForPort(port);
    if (service) granted.push({ port, service });
  }
  return granted;
}

/**
 * A port the user has already granted, if any.
 *
 * `preferred` is the service UUID last connected to, so a machine with several
 * granted devices reconnects to the same one rather than whichever Chrome
 * happens to list first.
 */
export async function findGrantedPort(preferred?: string | null): Promise<GrantedPort | null> {
  const granted = await listGrantedPorts();
  if (granted.length === 0) return null;
  if (preferred) {
    const match = granted.find((entry) => entry.service.uuid === preferred);
    if (match) return match;
  }
  return granted[0];
}

/**
 * Shows the browser picker, offering every supported service so the user can
 * choose any device we can drive. Must be called from a user gesture.
 */
export async function requestPort(): Promise<GrantedPort> {
  const uuids = KNOWN_SERVICES.map((service) => service.uuid);
  const port = await navigator.serial.requestPort({
    allowedBluetoothServiceClassIds: uuids,
    filters: uuids.map((uuid) => ({ bluetoothServiceClassId: uuid })),
  });
  const service = serviceForPort(port);
  if (!service) {
    throw new Error('That port is not a control service this app can drive.');
  }
  return { port, service };
}

export class SerialTransport implements Transport {
  #port: SerialPort;
  #reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  #writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  #handlers: TransportHandlers;
  #readLoop: Promise<void> | null = null;
  #closing = false;

  private constructor(port: SerialPort, handlers: TransportHandlers) {
    this.#port = port;
    this.#handlers = handlers;
  }

  static async open(port: SerialPort, handlers: TransportHandlers): Promise<SerialTransport> {
    // Chrome 130+ reports whether the Bluetooth device is actually reachable.
    // Opening an unreachable port throws a generic "Failed to open serial
    // port", which says nothing about the cause — so check first and say so.
    if (port.connected === false) {
      throw new PortUnreachableError();
    }

    try {
      await port.open({ baudRate: BAUD_RATE });
    } catch (error) {
      // A port this page left open can be recovered by closing and retrying.
      if (isAlreadyOpen(error)) {
        await port.close().catch(() => undefined);
        await port.open({ baudRate: BAUD_RATE });
      } else {
        // Anything else is usually the RFCOMM channel being held elsewhere.
        // It is exclusive per device across the whole system, so another tab —
        // even on a different origin — will block this one, and we cannot
        // close a port we did not open.
        throw new PortOpenError(error);
      }
    }

    const transport = new SerialTransport(port, handlers);
    transport.#start();
    return transport;
  }

  get isOpen(): boolean {
    return this.#writer !== null;
  }

  get port(): SerialPort {
    return this.#port;
  }

  #start(): void {
    this.#reader = this.#port.readable!.getReader();
    this.#writer = this.#port.writable!.getWriter();
    this.#readLoop = this.#read();
  }

  async #read(): Promise<void> {
    let reason: Error | undefined;
    try {
      for (;;) {
        const { value, done } = await this.#reader!.read();
        if (done) break;
        if (value?.length) this.#handlers.onData(value);
      }
    } catch (error) {
      // A cancel during close surfaces here too; only report unexpected ends.
      if (!this.#closing) reason = error as Error;
    } finally {
      if (!this.#closing) this.#handlers.onClose(reason);
    }
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (!this.#writer) throw new Error('transport is closed');
    await this.#writer.write(bytes);
  }

  async close(): Promise<void> {
    if (this.#closing) return;
    this.#closing = true;
    try {
      await this.#reader?.cancel();
      await this.#readLoop;
      this.#reader?.releaseLock();
      this.#writer?.releaseLock();
      await this.#port.close();
    } finally {
      this.#reader = null;
      this.#writer = null;
      this.#readLoop = null;
    }
  }
}

/** The real one. Wrapped rather than passed as a bare static for clarity. */
export const openSerialTransport: TransportOpener = (port, handlers) =>
  SerialTransport.open(port, handlers);
