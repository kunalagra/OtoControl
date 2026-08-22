import { describe, expect, it, onTestFinished } from 'vitest';

import { DeviceManager, knowsDevice, resolveBrand } from './manager';
import { DRIVERS } from '@/core/driver';
import { KNOWN_SERVICES, M4_SERVICE_UUID, SONY_MDR_V2_UUID, serviceForPort } from '@/core/transport';
import type { GrantedPort } from '@/core/transport';

/** A granted port carries only what brand resolution reads: its service. */
const granted = (...uuids: string[]): GrantedPort[] =>
  uuids.map((uuid) => {
    const port = { getInfo: () => ({ bluetoothServiceClassId: uuid }) } as unknown as SerialPort;
    const service = serviceForPort(port);
    if (!service) throw new Error(`not a known service: ${uuid}`);
    return { port, service };
  });

describe('knowsDevice', () => {
  it('is false with nothing selected and nothing granted', () => {
    expect(knowsDevice(null, [])).toBe(false);
  });

  it('is true once a port is granted, even with nothing selected', () => {
    // Permission survives a reload, so this is the state after coming back to
    // the app with the headphones switched off.
    expect(knowsDevice(null, granted(SONY_MDR_V2_UUID))).toBe(true);
  });

  it('stays true after a disconnect drops the granted list', () => {
    // A brand sticks once chosen; losing the port does not un-own the device.
    expect(knowsDevice('sony', [])).toBe(true);
  });
});

describe('resolveBrand', () => {
  it('prefers the explicit selection over anything granted', () => {
    expect(resolveBrand('sony', granted(M4_SERVICE_UUID))).toBe('sony');
  });

  it('reads the brand off the granted port when nothing is selected', () => {
    expect(resolveBrand(null, granted(SONY_MDR_V2_UUID))).toBe('sony');
    expect(resolveBrand(null, granted(M4_SERVICE_UUID))).toBe('sennheiser');
  });

  it('takes the first grant when several are present', () => {
    expect(resolveBrand(null, granted(SONY_MDR_V2_UUID, M4_SERVICE_UUID))).toBe('sony');
  });

  it('falls back to a brand rather than null when nothing is known', () => {
    // The fallback keeps the ActiveDevice union total. It is a guess, which is
    // why the UI branches on knowsDevice instead of on this.
    expect(resolveBrand(null, [])).toBe('sennheiser');
    expect(knowsDevice(null, [])).toBe(false);
  });
});

describe('DeviceManager — every entry in DRIVERS is fully wired', () => {
  /**
   * This is the test the phase's headline claim needed and did not have.
   * `manager.ts`'s `active` getter used to claim that adding a third driver
   * only extends its own two-way branch, and that `#devices` and the
   * constructor's subscribe wiring — both hand-written per device at the
   * time — "need no change". A reviewer added a real third driver, same
   * shape as `SENNHEISER_DRIVER`/`SONY_DRIVER`, changed nothing in this
   * file, and `select()` threw at runtime reading `undefined.adoptPort` even
   * though `tsc` and every other test stayed green — `#devices` was a
   * hand-written literal that type-checks as `Record<string, Adoptable>`
   * whether or not it lists every driver.
   *
   * Iterating `DRIVERS` here, rather than naming `SENNHEISER_DRIVER`/
   * `SONY_DRIVER` by hand, is what makes that failure mode fail *this test*
   * the next time a driver is added, instead of only failing at runtime in
   * production. It also catches the quieter half of the same bug: with
   * `active`'s branch left unextended, `#resolvedDriverId()` (which drives
   * `active`) and `resolveBrand()` (which drives `manager.brand`) are
   * independent fallback chains that silently disagree on an id neither of
   * them was told about — `active.driver.brand` said one brand while
   * `manager.brand` said another, for the same manager, at the same time.
   */
  it("selecting each driver's own service lands `active` on that driver, and `brand` agrees with `active.driver.brand`", async () => {
    // A single stub for the whole test, restored once at the end — reassigned
    // per iteration below rather than re-stubbed-and-restored per driver, so
    // multiple loop iterations cannot leave `navigator` pointing at a stale
    // stub instead of the real thing once the test finishes.
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    onTestFinished(() => {
      if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    });
    const stubGrantedPort = (uuid: string): void => {
      const port = { getInfo: () => ({ bluetoothServiceClassId: uuid }) } as unknown as SerialPort;
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { serial: { getPorts: async () => [port] } },
      });
    };

    for (const driver of DRIVERS) {
      // A BLE-only driver has no serial service to stub a granted port for;
      // its GATT registration is what driver.test.ts checks instead.
      if (driver.services.length === 0) continue;
      const uuid = driver.services[0];
      stubGrantedPort(uuid);

      const manager = new DeviceManager();
      await manager.refreshAvailable();
      await manager.select(uuid);

      expect(manager.active.id).toBe(driver.id);
      // Expected brand comes from the granted service, not from the descriptor
      // under test. `active.driver` and `#selectedBrand()` both resolve through
      // the same `DRIVERS` entry, so comparing them to each other is `X === X`
      // for any driver that exists — it catches a third driver falling through
      // `active`'s two-way branch, but not a wrong `brand` on an existing one.
      expect(manager.brand).toBe(KNOWN_SERVICES.find((s) => s.uuid === uuid)?.brand);
      expect(manager.active.driver.brand).toBe(manager.brand);

      // The gap the above two assertions leave open: neither reads `#emit()`,
      // `version`, or anything else that observes a re-render. A driver whose
      // `device.subscribe(...)` call was dropped from the constructor's loop
      // still lands `active` and `brand` correctly — its state is set fine,
      // it just never tells the UI — so both assertions above pass either
      // way. Provoking a real state change on the exact instance the manager
      // is holding (`manager.active.device`, the same object the
      // constructor's loop subscribed to — not a fresh `driver.create({})`)
      // and checking that `version` moved is what actually exercises that
      // wiring. `disconnect()` is cheap and honest for this: every driver's
      // device implements it, it needs no live transport, and both
      // implementations patch state unconditionally (see `StateStore.patch`,
      // which always notifies, unlike `replace`), so it reliably changes
      // state without depending on whatever this driver's status happened to
      // be already.
      const versionBeforeDisconnect = manager.version;
      await manager.active.device.disconnect();
      expect(manager.version).toBeGreaterThan(versionBeforeDisconnect);
    }
  });
});
