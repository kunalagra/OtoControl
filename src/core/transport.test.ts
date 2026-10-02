import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AIROHA_SERVICE_UUID,
  HEYMELODY_LEGACY_SPP_UUID,
  HEYMELODY_SPP_UUID,
  KNOWN_SERVICES,
  M4_SERVICE_UUID,
  PIXELBUDS_MAESTRO_UUID,
  PortOpenError,
  PortUnreachableError,
  SerialTransport,
  SONY_MDR_V1_UUID,
  SONY_MDR_V2_UUID,
  STANDARD_SPP_UUID,
  XIAOMI_SPP_UUID,
  isUnreachable,
  listGrantedPorts,
  serviceForPort,
  servicesFor,
} from './transport';

/** Enough of a SerialPort for service resolution, which only reads getInfo(). */
const portWith = (serviceId: string | undefined) =>
  ({ getInfo: () => ({ bluetoothServiceClassId: serviceId }) }) as unknown as SerialPort;

describe('serviceForPort', () => {
  it('identifies the Sennheiser control service', () => {
    const service = serviceForPort(portWith(M4_SERVICE_UUID));
    expect(service).toMatchObject({ brand: 'sennheiser', protocol: 'gaia' });
  });

  it('identifies both Sony generations', () => {
    expect(serviceForPort(portWith(SONY_MDR_V2_UUID))).toMatchObject({
      brand: 'sony',
      protocol: 'mdr-v2',
    });
    expect(serviceForPort(portWith(SONY_MDR_V1_UUID))).toMatchObject({
      brand: 'sony',
      protocol: 'mdr-v1',
    });
  });

  it('matches case-insensitively, since Chrome reports lowercase', () => {
    expect(serviceForPort(portWith(M4_SERVICE_UUID.toUpperCase()))).not.toBeNull();
  });

  it('rejects the Airoha service the M4 also advertises', () => {
    // This is why auto-reconnect cannot just take getPorts()[0].
    expect(serviceForPort(portWith(AIROHA_SERVICE_UUID))).toBeNull();
  });

  it('rejects a port with no service ID', () => {
    expect(serviceForPort(portWith(undefined))).toBeNull();
  });

  it('rejects an unrelated service', () => {
    // A2DP source: a real Bluetooth service no driver speaks.
    expect(serviceForPort(portWith('0000110a-0000-1000-8000-00805f9b34fb'))).toBeNull();
  });

  it('routes the legacy HeyMelody service to the HeyMelody driver', () => {
    const service = serviceForPort(portWith(HEYMELODY_LEGACY_SPP_UUID));
    expect(service).toMatchObject({ brand: 'heymelody', protocol: 'heymelody' });
    expect(service?.generic).toBeFalsy();
  });

  it('routes the Maestro service to the Pixel Buds driver', () => {
    const service = serviceForPort(portWith(PIXELBUDS_MAESTRO_UUID));
    expect(service).toMatchObject({ brand: 'pixelbuds', protocol: 'maestro' });
    expect(service?.generic).toBeFalsy();
  });

  it('does not offer the app’s legacy or byte-reversed Pixel Buds services', () => {
    for (const uuid of ['3a046f6d-24d2-7655-6534-0d7ecb759709', 'b5f708a7-64f7-5189-4c4c-ce24f77fe925', '099775cb-7e0d-3465-5576-d2246d6f043a']) {
      expect(serviceForPort(portWith(uuid))).toBeNull();
    }
  });

  it('routes the standard SPP service to the HeyMelody driver as a generic service', () => {
    expect(serviceForPort(portWith(STANDARD_SPP_UUID))).toMatchObject({ brand: 'heymelody', generic: true });
  });
});

describe('Xiaomi service', () => {
  it('routes the 0xFD2D service to the Xiaomi driver, not as a generic service', () => {
    const service = serviceForPort(portWith(XIAOMI_SPP_UUID));
    expect(service).toMatchObject({ brand: 'xiaomi', protocol: 'xiaomi-rcsp' });
    expect(service?.generic).toBeFalsy();
  });

  it('keeps the standard SPP service on HeyMelody', () => {
    expect(serviceForPort(portWith(STANDARD_SPP_UUID))).toMatchObject({ brand: 'heymelody' });
  });
});

describe('listGrantedPorts', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists generic services after brand-specific ones', async () => {
    vi.stubGlobal('navigator', {
      serial: { getPorts: async () => [portWith(STANDARD_SPP_UUID), portWith(HEYMELODY_SPP_UUID)] },
    });
    const granted = await listGrantedPorts();
    expect(granted.map((entry) => entry.service.uuid)).toEqual([HEYMELODY_SPP_UUID, STANDARD_SPP_UUID]);
  });

  it('lists the Xiaomi service before the generic one', async () => {
    vi.stubGlobal('navigator', {
      serial: { getPorts: async () => [portWith(STANDARD_SPP_UUID), portWith(XIAOMI_SPP_UUID)] },
    });
    const granted = await listGrantedPorts();
    expect(granted.map((entry) => entry.service.uuid)).toEqual([XIAOMI_SPP_UUID, STANDARD_SPP_UUID]);
  });
});

describe('KNOWN_SERVICES', () => {
  it('lists each service once', () => {
    const uuids = KNOWN_SERVICES.map((s) => s.uuid);
    expect(new Set(uuids).size).toBe(uuids.length);
  });

  it('uses lowercase UUIDs, matching what getInfo() returns', () => {
    for (const { uuid } of KNOWN_SERVICES) {
      expect(uuid, uuid).toBe(uuid.toLowerCase());
    }
  });

  it('maps every service to a brand that has artwork', () => {
    for (const { brand } of KNOWN_SERVICES) {
      expect(['sennheiser', 'sony', 'nothing', 'heymelody', 'pixelbuds', 'xiaomi']).toContain(brand);
    }
  });

  it('does not offer the Airoha service in the picker', () => {
    expect(KNOWN_SERVICES.map((s) => s.uuid)).not.toContain(AIROHA_SERVICE_UUID);
  });
});

describe('servicesFor', () => {
  it('resolves pixelbuds services', () => {
    expect(servicesFor('pixelbuds')).toEqual([PIXELBUDS_MAESTRO_UUID]);
    expect(PIXELBUDS_MAESTRO_UUID).toBe('25e97ff7-24ce-4c4c-8951-f764a708f7b5');
  });

  it('resolves the xiaomi service, and only that one', () => {
    expect(servicesFor('xiaomi')).toEqual([XIAOMI_SPP_UUID]);
  });

  it('resolves heymelody services', () => {
    expect(servicesFor('heymelody')).toEqual([HEYMELODY_SPP_UUID, HEYMELODY_LEGACY_SPP_UUID, STANDARD_SPP_UUID]);
  });
});

/** Minimal fake port; SerialTransport only needs open/close and the streams. */
function fakePort(overrides: {
  connected?: boolean
  openBehaviour?: 'ok' | 'already-open' | 'fail'
} = {}) {
  const { connected = true, openBehaviour = 'ok' } = overrides
  let openCalls = 0
  let closeCalls = 0
  return {
    port: {
      connected,
      getInfo: () => ({ bluetoothServiceClassId: M4_SERVICE_UUID }),
      async open() {
        openCalls += 1
        if (openBehaviour === 'fail') {
          throw new DOMException('Failed to open serial port.', 'InvalidStateError')
        }
        if (openBehaviour === 'already-open' && openCalls === 1) {
          throw new DOMException('The port is already open.', 'InvalidStateError')
        }
      },
      async close() {
        closeCalls += 1
      },
      readable: { getReader: () => ({ read: () => new Promise(() => {}), cancel: async () => {} }) },
      writable: { getWriter: () => ({ write: async () => {}, releaseLock: () => {} }) },
    } as unknown as SerialPort,
    stats: () => ({ openCalls, closeCalls }),
  }
}

const handlers = { onData: () => {}, onClose: () => {} }

describe('SerialTransport.open', () => {
  it('refuses an unreachable port with a message that says why', async () => {
    const { port, stats } = fakePort({ connected: false })
    await expect(SerialTransport.open(port, handlers)).rejects.toBeInstanceOf(
      PortUnreachableError,
    )
    await expect(SerialTransport.open(port, handlers)).rejects.toThrow(/not reachable/)
    // Never even attempted, so Chrome's opaque error cannot surface.
    expect(stats().openCalls).toBe(0)
  })

  it('flags an unreachable port as the one failure not worth a banner', () => {
    // Headphones being switched off is ordinary; the status badge covers it.
    expect(isUnreachable(new PortUnreachableError())).toBe(true)
    expect(isUnreachable(new PortOpenError(new Error('busy')))).toBe(false)
    expect(isUnreachable(new Error('anything else'))).toBe(false)
  })

  it('recovers a port left open by an earlier session', async () => {
    const { port, stats } = fakePort({ openBehaviour: 'already-open' })
    await SerialTransport.open(port, handlers)
    expect(stats()).toEqual({ openCalls: 2, closeCalls: 1 })
  })

  it('does not retry an unrelated open failure, and explains the likely cause', async () => {
    const { port, stats } = fakePort({ openBehaviour: 'fail' })
    await expect(SerialTransport.open(port, handlers)).rejects.toBeInstanceOf(PortOpenError)
    expect(stats().openCalls).toBe(1)
  })

  it('names the exclusive-channel cause rather than repeating Chrome wording', async () => {
    const { port } = fakePort({ openBehaviour: 'fail' })
    await expect(SerialTransport.open(port, handlers)).rejects.toThrow(/held by something else/)
  })

  it('keeps the original error for debugging', async () => {
    const { port } = fakePort({ openBehaviour: 'fail' })
    const error = await SerialTransport.open(port, handlers).catch((e) => e)
    expect((error as PortOpenError).reason).toBeInstanceOf(DOMException)
  })

  it('opens a reachable port without retrying', async () => {
    const { port, stats } = fakePort()
    await SerialTransport.open(port, handlers)
    expect(stats()).toEqual({ openCalls: 1, closeCalls: 0 })
  })

  it('still opens when connected is undefined, for older Chrome', async () => {
    const { port } = fakePort()
    // Chrome below 130 has no `connected`; the check must not reject on that.
    Object.defineProperty(port, 'connected', { value: undefined })
    await expect(SerialTransport.open(port, handlers)).resolves.toBeDefined()
  })
})
