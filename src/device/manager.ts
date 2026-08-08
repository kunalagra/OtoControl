/**
 * Holds one device per brand and tracks which is active.
 *
 * The picker is shown here rather than inside a device class, because the
 * granted port's service ID is what decides the brand — the user picks a
 * device, not a protocol.
 */

import type { Brand } from './brand';
import { MomentumDevice } from './device';
import { M4_SERVICE_UUID } from './transport';
import { SonyDevice } from './sony';
import type { DeviceState } from './state';
import type { SonyState } from './sony';
import {
  findGrantedPort,
  isWebSerialSupported,
  listGrantedPorts,
  requestPort,
} from './transport';
import type { GrantedPort } from './transport';
import {
  deviceLabel,
  preferredService,
  rememberDeviceName,
  rememberPreferredService,
} from './knownDevices';
import { restoreSnapshot, saveSnapshot } from './persistence';
import type { Persistable } from './persistence';

export type ActiveDevice =
  | { brand: 'sennheiser'; device: MomentumDevice; state: DeviceState }
  | { brand: 'sony'; device: SonyDevice; state: SonyState };

/**
 * Whether the app knows of any device.
 *
 * A granted port counts even with nothing selected: permission survives
 * reloads, so the headphones are still yours when they are merely switched off.
 */
export const knowsDevice = (selected: Brand | null, granted: GrantedPort[]): boolean =>
  selected !== null || granted.length > 0;

/**
 * The brand to render, given what has been selected and what is granted.
 *
 * Always returns a brand so callers never juggle null. That makes it a *guess*
 * when nothing is known, which is why `knowsDevice` exists — branch on that,
 * never on this.
 */
export const resolveBrand = (selected: Brand | null, granted: GrantedPort[]): Brand =>
  selected ?? granted[0]?.service.brand ?? 'sennheiser';

type Listener = () => void;

export class DeviceManager {
  readonly sennheiser = new MomentumDevice();
  readonly sony = new SonyDevice();

  /**
   * Which brand the UI should render, or null when no device has ever been
   * picked. Sticks after a disconnect — a device you own is still your device
   * when it is switched off.
   */
  #brand: Brand | null = null;
  #listeners = new Set<Listener>();
  #granted: GrantedPort[] = [];
  #version = 0;

  /**
   * Bumped on every change worth re-rendering for.
   *
   * The device state object cannot serve as the snapshot on its own: granting
   * or revoking a port changes `hasDevice` and the section list while leaving
   * that object untouched, and a subscriber comparing identities would miss it.
   */
  get version(): number {
    return this.#version;
  }

  constructor() {
    // Remember what a device calls itself, so the picker can label it next time.
    this.sennheiser.subscribe((state) => {
      rememberDeviceName(M4_SERVICE_UUID, state.info.model);
      // Only while connected: every value in a snapshot came from the device,
      // and caching a restored cache would let one bad reading calcify.
      if (state.status === 'connected') saveSnapshot(M4_SERVICE_UUID, this.sennheiser);
      this.#emit();
    });
    this.sony.subscribe((state) => {
      const uuid = this.#sonyService();
      if (uuid) {
        rememberDeviceName(uuid, state.info.model);
        if (state.status === 'connected') saveSnapshot(uuid, this.sony);
      }
      this.#emit();
    });
  }

  /** The granted Sony service, whichever generation it turned out to be. */
  #sonyService(): string | undefined {
    return this.#granted.find((entry) => entry.service.brand === 'sony')?.service.uuid;
  }

  /** The device that speaks a given brand's protocol. */
  #deviceFor(brand: Brand): Persistable {
    return brand === 'sony' ? this.sony : this.sennheiser;
  }

  /**
   * Hands each granted device its cached settings.
   *
   * Runs before any connection attempt, so the app opens showing your
   * headphones rather than an empty shell. `restore` is a no-op on a connected
   * device, so this cannot clobber live readings. Brand-blind: the service
   * decides which device to ask, and the device decides what to do with it.
   */
  #restoreCached(): void {
    for (const { service } of this.#granted) {
      restoreSnapshot(service.uuid, this.#deviceFor(service.brand));
    }
  }

  /** Granted devices the user can switch between, labelled where known. */
  get available(): Array<{ uuid: string; brand: Brand; label: string }> {
    return this.#granted.map(({ service }) => ({
      uuid: service.uuid,
      brand: service.brand,
      label: deviceLabel(service.uuid, service.brand),
    }));
  }

  async refreshAvailable(): Promise<void> {
    this.#granted = await listGrantedPorts();
    this.#restoreCached();
    this.#emit();
  }

  /** Switches to another granted device, releasing whatever is currently held. */
  async select(serviceUuid: string): Promise<void> {
    const entry = this.#granted.find((candidate) => candidate.service.uuid === serviceUuid);
    if (!entry) return;

    // Both, not just the active one: a device caught mid-connect still holds an
    // open port, and Chrome refuses to open a port that is already open.
    await Promise.all([
      this.sennheiser.disconnect().catch(() => undefined),
      this.sony.disconnect().catch(() => undefined),
    ]);

    rememberPreferredService(serviceUuid);
    this.#select(entry.service.brand);
    if (entry.service.brand === 'sony') await this.sony.adoptPort(entry.port);
    else await this.sennheiser.adoptPort(entry.port);
  }

  /**
   * Whether we know of any device at all.
   *
   * False means the app has nothing to show: no port has been granted and none
   * has been picked this session. The UI must not fall back to one brand's
   * controls here — a greyed-out Momentum noise dial in front of someone who
   * owns neither pair of headphones is a guess presented as a fact.
   */
  get hasDevice(): boolean {
    return knowsDevice(this.#brand, this.#granted);
  }

  /** The brand to render. Falls back to a granted port before guessing. */
  get brand(): Brand {
    return resolveBrand(this.#brand, this.#granted);
  }

  get active(): ActiveDevice {
    return this.brand === 'sony'
      ? { brand: 'sony', device: this.sony, state: this.sony.state }
      : { brand: 'sennheiser', device: this.sennheiser, state: this.sennheiser.state };
  }

  get supported(): boolean {
    return isWebSerialSupported();
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(): void {
    this.#version += 1;
    for (const listener of this.#listeners) listener();
  }

  #select(brand: Brand): void {
    if (this.#brand === brand) return;
    this.#brand = brand;
    this.#emit();
  }

  /** Shows the picker, then hands the port to whichever brand it belongs to. */
  async connect(): Promise<void> {
    if (!isWebSerialSupported()) return;
    const granted = await requestPort().catch(() => null);
    if (!granted) return;

    rememberPreferredService(granted.service.uuid);
    this.#select(granted.service.brand);
    if (granted.service.brand === 'sony') await this.sony.adoptPort(granted.port);
    else await this.sennheiser.adoptPort(granted.port);
    await this.refreshAvailable();
  }

  /** Reconnects silently to a previously granted port, whichever brand it is. */
  async autoConnect(): Promise<boolean> {
    if (!isWebSerialSupported()) return false;
    await this.refreshAvailable();

    // Prefer the device last connected to; with several granted, first-match
    // would otherwise pick whichever Chrome happened to list first.
    const granted = await findGrantedPort(preferredService());
    if (!granted) return false;

    this.#select(granted.service.brand);
    if (granted.service.brand === 'sony') await this.sony.adoptPort(granted.port);
    else await this.sennheiser.adoptPort(granted.port);
    return this.active.state.status === 'connected';
  }

  async disconnect(): Promise<void> {
    await this.active.device.disconnect();
  }

  async refresh(): Promise<void> {
    await this.active.device.refresh();
  }
}
