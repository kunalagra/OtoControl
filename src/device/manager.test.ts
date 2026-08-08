import { describe, expect, it } from 'vitest';

import { knowsDevice, resolveBrand } from './manager';
import { M4_SERVICE_UUID, SONY_MDR_V2_UUID, serviceForPort } from './transport';
import type { GrantedPort } from './transport';

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
