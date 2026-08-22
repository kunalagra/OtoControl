import { describe, expect, it } from 'vitest';

import { DRIVERS, SENNHEISER_DRIVER, SONY_DRIVER, driverForService } from './driver';
import { initialState } from '@/drivers/sennheiser/state';
import { initialSonyState } from '@/drivers/sony/sony';
import {
  AIROHA_SERVICE_UUID,
  KNOWN_SERVICES,
  M4_SERVICE_UUID,
  SONY_MDR_V1_UUID,
  SONY_MDR_V2_UUID,
} from '@/core/transport';
import { KNOWN_GATT_SERVICES } from '@/core/gattTransport';

describe('driverForService', () => {
  it('resolves the Sennheiser control service to the GAIA driver', () => {
    expect(driverForService(M4_SERVICE_UUID)?.id).toBe('sennheiser-gaia');
  });

  it('resolves both Sony generations to the same MDR driver', () => {
    expect(driverForService(SONY_MDR_V1_UUID)?.id).toBe('sony-mdr');
    expect(driverForService(SONY_MDR_V2_UUID)?.id).toBe('sony-mdr');
  });

  it('returns null for a service no driver claims', () => {
    // The Airoha service the M4 also advertises is real hardware, but no
    // driver speaks it — this is exactly what `serviceForPort` guards
    // against on the transport side.
    expect(driverForService(AIROHA_SERVICE_UUID)).toBeNull();
    expect(driverForService('not-a-real-uuid')).toBeNull();
  });
});

describe('DRIVERS', () => {
  it('gives every driver a unique id', () => {
    const ids = DRIVERS.map((driver) => driver.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('lists every service exactly once, across all drivers', () => {
    const services = DRIVERS.flatMap((driver) => driver.services);
    expect(new Set(services).size).toBe(services.length);
  });

  it('resolves every KNOWN_SERVICES entry to some driver', () => {
    // A service the picker or auto-reconnect can hand out must land on a
    // driver, or it is dead weight nothing can ever use. Combined with "lists
    // every service exactly once" above — no duplicates across drivers — this
    // is the "do not let these two lists drift" guarantee the brief asks for,
    // without restating `servicesFor`'s own filter as a second assertion (a
    // driver's `services` being a subset of `KNOWN_SERVICES` is true by
    // construction — see `servicesFor` — so a test only checking that
    // direction could never fail).
    const covered = new Set(DRIVERS.flatMap((driver) => driver.services));
    for (const { uuid } of KNOWN_SERVICES) {
      expect(covered.has(uuid)).toBe(true);
    }
  });

  it("only lists profiles for the driver's own brand", () => {
    const brandOf: Record<string, string> = {
      'sennheiser-gaia': 'sennheiser',
      'sony-mdr': 'sony',
      'nothing-spp': 'nothing',
      'soundcore-gatt': 'soundcore',
    };
    for (const driver of DRIVERS) {
      for (const profile of driver.profiles) {
        expect(profile.brand).toBe(brandOf[driver.id]);
      }
    }
  });
});

describe('SENNHEISER_DRIVER.sections', () => {
  it('is static — it does not depend on the state it is handed', () => {
    // Checking a single state, however different from initialState, would
    // only show this driver's list *can* contain 'noise' and 'debug' for one
    // input — not that it is the same list for every input. Comparing two
    // deliberately different states against each other is what actually
    // exercises "does not depend on state".
    const withInitial = SENNHEISER_DRIVER.sections(initialState);
    const withOther = SENNHEISER_DRIVER.sections({ ...initialState, status: 'connected' });
    expect(withOther).toEqual(withInitial);

    const ids = withInitial.map((s) => s.id);
    expect(ids).toContain('noise');
    expect(ids).toContain('debug');
  });

  it('gives every declared section a component to render it', () => {
    // Cast rather than widen the constant itself: `SENNHEISER_DRIVER.components`
    // is deliberately typed with its own literal keys (see the `as const
    // satisfies` on the constant), and a section id is only a plain `string`
    // once it has come back out of `sections()`.
    const components: Record<string, unknown> = SENNHEISER_DRIVER.components;
    for (const section of SENNHEISER_DRIVER.sections(initialState)) {
      expect(components[section.id]).toBeDefined();
    }
  });
});

describe('SONY_DRIVER.sections', () => {
  it('keeps the noise tab before a capability table has been read', () => {
    // `capabilities` starts empty, which must read as "not known yet", not
    // "known to have nothing" — otherwise every Sony device would flash a
    // missing tab for the instant before it connects.
    const ids = SONY_DRIVER.sections(initialSonyState).map((s) => s.id);
    expect(ids).toContain('noise');
  });

  it('drops the noise tab once capabilities are known and none of them is noise control', () => {
    const state = { ...initialSonyState, capabilities: new Set([1]), noiseVariant: null };
    const ids = SONY_DRIVER.sections(state).map((s) => s.id);
    expect(ids).not.toContain('noise');
  });

  it('keeps the noise tab once capabilities are known and include a noise variant', () => {
    const state = { ...initialSonyState, capabilities: new Set([1]), noiseVariant: 1 };
    const ids = SONY_DRIVER.sections(state).map((s) => s.id);
    expect(ids).toContain('noise');
  });

  it('gives every declared section a component to render it', () => {
    const known = { ...initialSonyState, capabilities: new Set([1]), noiseVariant: 1 };
    const components: Record<string, unknown> = SONY_DRIVER.components;
    for (const section of SONY_DRIVER.sections(known)) {
      expect(components[section.id]).toBeDefined();
    }
  });
});

describe('create', () => {
  it('builds a real device for each driver', () => {
    // Not exercising a connection — just that the factory produces the
    // right kind of object, with no transport injected (both device classes
    // default that themselves).
    expect(SENNHEISER_DRIVER.create({}).state.status).not.toBeUndefined();
    expect(SONY_DRIVER.create({}).state.status).not.toBeUndefined();
  });
});

/**
 * `DeviceDriver.brand` is documented at length as "the map" between the two
 * string domains — driver ids (`'sennheiser-gaia'`) and brands
 * (`'sennheiser'`) — and until this test nothing pinned it.
 *
 * A whole-branch mutation review found that setting `SONY_DRIVER.brand` to
 * `'sennheiser'` left the whole suite green *and* `tsc -b` clean. Every
 * consumer read the field off the same descriptor the tests did, so no
 * assertion could disagree with it. In production it renders Sennheiser
 * product art for a Sony device and selects the wrong entry in the device
 * dropdown — silently.
 *
 * Cross-checking against `KNOWN_SERVICES` breaks that circularity: the brand
 * now has to agree with an independently-maintained table, which is also the
 * drift the two modules' own doc comments already claim is closed.
 */
describe('DeviceDriver.brand', () => {
  it('agrees with KNOWN_SERVICES about every service it claims', () => {
    for (const driver of DRIVERS) {
      // A BLE-only driver claims no serial service at all — but then its
      // brand must be registered in the GATT table instead, or nothing can
      // ever resolve a granted device to it.
      if (driver.services.length === 0) {
        expect(KNOWN_GATT_SERVICES.some((service) => service.brand === driver.brand)).toBe(true);
        continue;
      }
      for (const uuid of driver.services) {
        expect(KNOWN_SERVICES.find((service) => service.uuid === uuid)?.brand).toBe(driver.brand);
      }
    }
  });
});
