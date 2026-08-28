/**
 * Holds one device per driver and tracks which is active.
 *
 * The picker is shown here rather than inside a device class, because the
 * granted port's service ID is what decides the driver — the user picks a
 * device, not a protocol.
 */

import type { Brand } from './brand';
import { MomentumDevice } from '@/drivers/sennheiser/device';
import {
  DRIVERS,
  SENNHEISER_DRIVER,
  SONY_DRIVER,
  NOTHING_DRIVER,
  SOUNDCORE_DRIVER,
  HEYMELODY_DRIVER,
  driverForService,
} from '@/core/driver';
import type { DriverId } from '@/core/driver';
import { SonyDevice } from '@/drivers/sony/sony';
import { NothingDevice } from '@/drivers/nothing/device';
import { SoundcoreDevice } from '@/drivers/soundcore/device';
import { HeyMelodyDevice } from '@/drivers/heymelody/device';
import type { HeyMelodyState } from '@/drivers/heymelody/device';
import type { DeviceState } from '@/drivers/sennheiser/state';
import type { SonyState } from '@/drivers/sony/sony';
import type { NothingState } from '@/drivers/nothing/device';
import type { SoundcoreState } from '@/drivers/soundcore/device';
import {
  findGrantedPort,
  isWebSerialSupported,
  listGrantedPorts,
  requestPort,
} from '@/core/transport';
import type { ConnectionTarget, GrantedPort, Transport } from '@/core/transport';
import {
  GattTransport,
  gattServiceBrand,
  grantedGattDevices,
  isWebBluetoothSupported,
  requestGattDevice,
} from '@/core/gattTransport';
import {
  deviceLabel,
  preferredService,
  rememberDeviceName,
  rememberPreferredService,
} from '@/core/knownDevices';
import { restoreSnapshot, saveSnapshot } from '@/core/persistence';
import type { Persistable } from '@/core/persistence';

/**
 * What `select`/`connect`/`autoConnect` need from a device, whichever driver
 * it belongs to: hand it a port, or tear it down. Declared locally rather
 * than added to `Persistable` or to the device classes — both
 * `MomentumDevice` and `SonyDevice` already have every one of these methods
 * with this exact signature, so nothing about them needs to change for the
 * manager to dispatch across drivers without a brand switch.
 */
interface Adoptable extends Persistable {
  adoptPort(target: ConnectionTarget): Promise<void>;
  /**
   * Takes over an already-open transport — the single-connection BLE path.
   * Optional because only BLE-capable drivers have one; the manager closes
   * the transport itself when a driver cannot adopt it.
   */
  adoptTransport?(transport: Transport): Promise<void>;
  disconnect(): Promise<void>;
  refresh(): Promise<void>;
  /**
   * So the constructor can wire every driver's bookkeeping (remembering the
   * device's name, caching its snapshot, emitting for the UI) from one loop
   * over `DRIVERS` instead of one hand-written block per device — see the
   * constructor below. Typed to only the two fields that bookkeeping reads,
   * `status` and `info.model`, since that is all any driver's state is
   * required to share; `DeviceState` and `SonyState` both do, and the
   * listener parameter is declared with method syntax specifically so TS
   * checks it bivariantly and lets `MomentumDevice.subscribe`/
   * `SonyDevice.subscribe` — whose listeners take the real, wider state —
   * satisfy this narrower signature.
   */
  subscribe(listener: (state: { status: string; info: { model: string | null } }) => void): () => void;
}

/**
 * Which device is live, its driver, and its state — all three from the same
 * driver, never mixed.
 *
 * `id` carries the literal type of `SENNHEISER_DRIVER.id` / `SONY_DRIVER.id`
 * (see the `as const satisfies` on those constants in each driver's own
 * `driver.ts`, not `core/driver.ts` which merely re-exports them) rather
 * than the plain `string` a `DeviceDriver<...>`-typed field would give it.
 * That literal is what lets a check like `active.id === SONY_DRIVER.id`
 * narrow `driver`, `device` and `state` together — TypeScript discriminates
 * a union on a property's *literal* type, not on object identity or a nested
 * field, so without it callers would be back to an unsound cast at every
 * site instead of the one this module owns (see `sectionsForDevice` in
 * `ui/sections/registry.ts`, which needs exactly one such cast because it
 * cannot discriminate this way).
 */
export type ActiveDevice =
  | { id: Extract<DriverId, 'sennheiser-gaia'>; driver: typeof SENNHEISER_DRIVER; device: MomentumDevice; state: DeviceState }
  | { id: Extract<DriverId, 'sony-mdr'>; driver: typeof SONY_DRIVER; device: SonyDevice; state: SonyState }
  | { id: Extract<DriverId, 'nothing-spp'>; driver: typeof NOTHING_DRIVER; device: NothingDevice; state: NothingState }
  | { id: Extract<DriverId, 'soundcore-gatt'>; driver: typeof SOUNDCORE_DRIVER; device: SoundcoreDevice; state: SoundcoreState }
  | { id: Extract<DriverId, 'heymelody'>; driver: typeof HEYMELODY_DRIVER; device: HeyMelodyDevice; state: HeyMelodyState };

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
  /**
   * Every device this manager can drive, keyed by driver id. Built from
   * `DRIVERS` itself, not a hand-written literal — a hand-written literal
   * type-checks as `Record<string, Adoptable>` whether or not it lists every
   * driver, so a driver added to `DRIVERS` without a matching entry here used
   * to compile clean and pass every test, then throw at runtime the moment
   * anything looked it up (`select`/`connect`/`autoConnect`/`#restoreCached`
   * all read `#devices[driver.id]` and none of them guard against `undefined`
   * with `noUncheckedIndexedAccess` off). Deriving the object from the table
   * makes that omission structurally impossible instead of merely unlikely.
   */
  readonly #devices: Record<string, Adoptable> = Object.fromEntries(
    DRIVERS.map((driver) => [driver.id, driver.create({})]),
  );

  /**
   * Concrete, fully-typed handles onto two of `#devices`' own entries — same
   * instances, same identity, not a second `create()` — so `active` (below)
   * can hand out a real `MomentumDevice`/`SonyDevice` rather than the
   * `Adoptable` that `#devices`' declared value type would otherwise force on
   * every reader. The cast is no more unsound than any other
   * `#devices[driver.id]` lookup in this class; it just needs a concrete type
   * on the way out instead of `Adoptable`.
   */
  readonly #sennheiser = this.#devices[SENNHEISER_DRIVER.id] as MomentumDevice;
  readonly #sony = this.#devices[SONY_DRIVER.id] as SonyDevice;
  readonly #nothing = this.#devices[NOTHING_DRIVER.id] as NothingDevice;
  readonly #soundcore = this.#devices[SOUNDCORE_DRIVER.id] as SoundcoreDevice;
  readonly #heymelody = this.#devices[HEYMELODY_DRIVER.id] as HeyMelodyDevice;

  /**
   * Which driver's device the UI should render, keyed by driver id, or null
   * when no device has ever been picked. Sticks after a disconnect — a
   * device you own is still your device when it is switched off.
   *
   * Driver id, not `Brand`: `select`/`connect`/`autoConnect` already resolve
   * a specific driver via `driverForService` and act on `#devices[driver.id]`
   * — storing only its brand here would have made `active` (below) unable to
   * tell apart two drivers that happened to share one, always rendering
   * whichever of them has the lower-numbered concrete field regardless of
   * which was actually adopted. `resolveBrand`/`knowsDevice` still take
   * `Brand`, because their own tests pin that; `#selectedBrand` is the one
   * place this turns back into the `Brand` those two need.
   */
  #driverId: string | null = null;
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
    // One subscribe block per entry in `DRIVERS`, not one written by hand per
    // device: a driver missing its own hand-written block would still
    // type-check and pass every test, and would simply never call `#emit()`
    // — its state would update, but nothing would ever tell the UI to
    // re-render for it. Looping over the table removes that ability to
    // forget one.
    for (const driver of DRIVERS) {
      const device = this.#devices[driver.id];
      device.subscribe((state) => {
        // Remember what a device calls itself, so the picker can label it
        // next time. Keyed off whichever of the driver's own service UUIDs is
        // actually granted, not one hardcoded per driver — Sony already
        // needed this to disambiguate its two protocol generations, and a
        // future driver may too.
        const uuid = this.#uuidFor(driver.services);
        if (uuid) {
          rememberDeviceName(uuid, state.info.model);
          // Only while connected: every value in a snapshot came from the
          // device, and caching a restored cache would let one bad reading
          // calcify.
          if (state.status === 'connected') saveSnapshot(uuid, device);
        }
        this.#emit();
      });
    }
  }

  /** The granted uuid speaking one of `services`, whichever generation it turned out to be. */
  #uuidFor(services: readonly string[]): string | undefined {
    return this.#granted.find((entry) => services.includes(entry.service.uuid))?.service.uuid;
  }

  /**
   * Hands each granted device its cached settings.
   *
   * Runs before any connection attempt, so the app opens showing your
   * headphones rather than an empty shell. `restore` is a no-op on a connected
   * device, so this cannot clobber live readings. Driver-blind: the service's
   * uuid decides which driver — and so which device — to ask, and the device
   * decides what to do with it.
   */
  #restoreCached(): void {
    for (const { service } of this.#granted) {
      const driver = driverForService(service.uuid);
      if (driver) restoreSnapshot(service.uuid, this.#devices[driver.id]);
    }
  }

  /**
   * Granted serial devices the user can switch between, labelled where known.
   * BLE-granted devices are reachable through autoConnect rather than listed:
   * Chrome offers no way to open their picker-free chooser entries here.
   */
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
    await Promise.all(
      Object.values(this.#devices).map((device) => device.disconnect().catch(() => undefined)),
    );

    const driver = driverForService(entry.service.uuid);
    if (!driver) return;

    rememberPreferredService(serviceUuid);
    this.#select(driver.id);
    await this.#devices[driver.id].adoptPort(entry.port);
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
    return knowsDevice(this.#selectedBrand(), this.#granted);
  }

  /** The brand to render. Falls back to a granted port before guessing. */
  get brand(): Brand {
    return resolveBrand(this.#selectedBrand(), this.#granted);
  }

  /** `#driverId`, as the `Brand` that `resolveBrand`/`knowsDevice` need. */
  #selectedBrand(): Brand | null {
    if (this.#driverId === null) return null;
    return DRIVERS.find((driver) => driver.id === this.#driverId)?.brand ?? null;
  }

  /**
   * The driver id to render, mirroring `resolveBrand`'s own fallback chain
   * — explicit selection, else the first granted port's driver, else
   * Sennheiser's — but at driver-id granularity rather than brand
   * granularity. That distinction only matters once two drivers share a
   * brand, which nothing does today, but resolving it here rather than via
   * `this.brand` is what keeps `active` correct if that ever changes.
   */
  #resolvedDriverId(): string {
    if (this.#driverId !== null) return this.#driverId;
    const first = this.#granted[0];
    const driver = first ? driverForService(first.service.uuid) : null;
    return driver?.id ?? SENNHEISER_DRIVER.id;
  }

  /**
   * The one place a driver id turns into a concrete, fully-typed driver/
   * device/state triple. Stays a two-way branch rather than a generic lookup
   * over `DRIVERS` because `DRIVERS`' elements are erased to
   * `DeviceDriver<never, never>` (see the erasure comment on `DRIVERS` in
   * `driver.ts`) and cannot supply a real, correctly-typed device or state.
   *
   * Adding a third driver DOES extend this branch (and the `ActiveDevice`
   * union above it) — that part was always true. It is not, however, the
   * *only* thing a third driver requires, and claiming otherwise here once
   * cost a working third driver: `#devices` and this class's constructor
   * used to be hand-written per device rather than built from `DRIVERS`, so
   * a driver added to the table without a matching hand-written entry in
   * each still type-checked and passed every test, then failed at runtime —
   * `#devices[driver.id]` was `undefined` in `select`/`connect`/
   * `autoConnect`/`#restoreCached`, and the new device's state changes never
   * called `#emit()` because no subscribe block existed for it. Both are now
   * built from `DRIVERS` itself (see `#devices` and the constructor above),
   * so those two can no longer be forgotten. Only this branch, and the
   * `ActiveDevice` union it returns, must still be extended by hand — and an
   * id this branch doesn't recognise is not rejected, it silently renders as
   * Sennheiser, which is why `manager.test.ts`'s "every entry in DRIVERS is
   * fully wired" test asserts `active.driver.brand` against `this.brand` for
   * every entry in `DRIVERS`: the two are computed by independent fallback
   * chains (`#resolvedDriverId()` here, `resolveBrand()` for `brand`) and
   * only agree if this branch was actually kept in step.
   */
  get active(): ActiveDevice {
    const driverId = this.#resolvedDriverId();
    if (driverId === SONY_DRIVER.id) {
      return { id: SONY_DRIVER.id, driver: SONY_DRIVER, device: this.#sony, state: this.#sony.state };
    }
    if (driverId === NOTHING_DRIVER.id) {
      return {
        id: NOTHING_DRIVER.id,
        driver: NOTHING_DRIVER,
        device: this.#nothing,
        state: this.#nothing.state,
      };
    }
    if (driverId === SOUNDCORE_DRIVER.id) {
      return {
        id: SOUNDCORE_DRIVER.id,
        driver: SOUNDCORE_DRIVER,
        device: this.#soundcore,
        state: this.#soundcore.state,
      };
    }
    if (driverId === HEYMELODY_DRIVER.id) {
      return {
        id: HEYMELODY_DRIVER.id,
        driver: HEYMELODY_DRIVER,
        device: this.#heymelody,
        state: this.#heymelody.state,
      };
    }
    return {
      id: SENNHEISER_DRIVER.id,
      driver: SENNHEISER_DRIVER,
      device: this.#sennheiser,
      state: this.#sennheiser.state,
    };
  }

  get supported(): boolean {
    return isWebSerialSupported() || isWebBluetoothSupported();
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(): void {
    this.#version += 1;
    for (const listener of this.#listeners) listener();
  }

  #select(driverId: string): void {
    if (this.#driverId === driverId) return;
    this.#driverId = driverId;
    this.#emit();
  }

  /** Shows the picker, then hands the port to whichever driver it belongs to. */
  async connect(): Promise<void> {
    if (!isWebSerialSupported()) return;
    const granted = await requestPort().catch(() => null);
    if (!granted) return;

    const driver = driverForService(granted.service.uuid);
    if (!driver) return;

    rememberPreferredService(granted.service.uuid);
    this.#select(driver.id);
    await this.#devices[driver.id].adoptPort(granted.port);
    await this.refreshAvailable();
  }

  /**
   * Shows the Bluetooth (LE) picker, then hands the *one* connection it opens
   * to whichever driver the device's GATT services name.
   *
   * BLE has no equivalent of the serial port's service class id, so the driver
   * is only knowable after connecting. This used to probe with a throwaway
   * connection and reconnect for real — but rapid GATT
   * connect→disconnect→connect cycles segfault Chrome's browser process on
   * macOS (SIGSEGV in the Bluetooth run-loop, verified against a crash
   * report), so the connection opened here is the one the driver keeps:
   * `GattTransport.open` resolves it without wiring listeners, the service
   * UUID picks the driver, and `adoptTransport` starts it in place.
   */
  async connectBluetooth(): Promise<void> {
    if (!isWebBluetoothSupported()) return;
    let device: BluetoothDevice;
    try {
      device = await requestGattDevice();
    } catch (error) {
      // A cancelled picker is the user's business, not an error. Anything
      // else — a malformed filter, no adapter — must not vanish silently:
      // it is exactly the failure that looks like "the button does nothing".
      if (!(error instanceof DOMException) || error.name !== 'NotFoundError') {
        console.warn('[manager] Bluetooth picker failed', error);
      }
      return;
    }

    await this.#adoptGattDevice(device);
    await this.refreshAvailable();
  }

  /**
   * The single-connection BLE adopt: open once, resolve the driver from the
   * service the transport landed on, hand the transport over. Returns false
   * when nothing about the device is recognised, so callers can try the next.
   */
  async #adoptGattDevice(device: BluetoothDevice): Promise<boolean> {
    let transport: GattTransport;
    try {
      transport = await GattTransport.open(device);
    } catch (error) {
      console.warn('[manager] could not open the Bluetooth connection', error);
      return false;
    }

    const brand = transport.serviceUuid ? gattServiceBrand(transport.serviceUuid) : null;
    const driver = DRIVERS.find((entry) => entry.brand === brand);
    if (!driver) {
      console.warn('[manager] granted Bluetooth device speaks no known service', device.name ?? device.id);
      await transport.close().catch(() => undefined);
      return false;
    }

    this.#select(driver.id);
    const adopter = this.#devices[driver.id] as Adoptable & {
      adoptTransport?(transport: Transport): Promise<void>;
    };
    if (!adopter.adoptTransport) {
      await transport.close().catch(() => undefined);
      return false;
    }
    await adopter.adoptTransport(transport);
    return true;
  }

  /** Reconnects silently to a previously granted port, whichever driver it is. */
  async autoConnect(): Promise<boolean> {
    if (!isWebSerialSupported()) return false;
    await this.refreshAvailable();

    // Prefer the device last connected to; with several granted, first-match
    // would otherwise pick whichever Chrome happened to list first.
    const granted = await findGrantedPort(preferredService());
    if (!granted) return false;

    const driver = driverForService(granted.service.uuid);
    if (!driver) return false;

    this.#select(driver.id);
    await this.#devices[driver.id].adoptPort(granted.port);
    if (this.#isConnected()) return true;

    // No serial port answered — a previously granted BLE device still can.
    // One connection per attempt, same as the picker path.
    for (const device of await grantedGattDevices()) {
      if (await this.#adoptGattDevice(device)) return true;
    }
    return false;
  }

  /**
   * A method, not an inline `this.active.state.status === 'connected'`: the
   * inline form narrows that property chain for the rest of the enclosing
   * function, so a second check later (the BLE fallback in `autoConnect`)
   * would compile as unreachable.
   */
  #isConnected(): boolean {
    return this.active.state.status === 'connected';
  }

  async disconnect(): Promise<void> {
    await this.active.device.disconnect();
  }

  async refresh(): Promise<void> {
    await this.active.device.refresh();
  }
}
