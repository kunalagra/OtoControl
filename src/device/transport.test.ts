import { describe, expect, it } from 'vitest';

import {
  AIROHA_SERVICE_UUID,
  KNOWN_SERVICES,
  M4_SERVICE_UUID,
  PortOpenError,
  PortUnreachableError,
  SerialTransport,
  SONY_MDR_V1_UUID,
  SONY_MDR_V2_UUID,
  isUnreachable,
  serviceForPort,
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
    expect(serviceForPort(portWith('00001101-0000-1000-8000-00805f9b34fb'))).toBeNull();
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
      expect(['sennheiser', 'sony']).toContain(brand);
    }
  });

  it('does not offer the Airoha service in the picker', () => {
    expect(KNOWN_SERVICES.map((s) => s.uuid)).not.toContain(AIROHA_SERVICE_UUID);
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
