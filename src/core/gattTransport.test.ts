import { describe, expect, it } from 'vitest';

import { NOTHING_SPP_UUID } from './transport';
import { SOUNDCORE_COMPANY_IDS, isSoundcoreService, soundcoreServiceUuids } from './gattTransport';

/**
 * Pins the picker-filter contract. The failure these guard against is not
 * hypothetical: company ids packed wider than 16 bits make Chrome reject the
 * whole `requestDevice()` call, and the chooser never opens — the bug looked
 * exactly like "the button does nothing".
 */
describe('Bluetooth picker filters', () => {
  it('keeps every Soundcore company id inside the u16 Chrome accepts', () => {
    for (const id of SOUNDCORE_COMPANY_IDS) {
      expect(id).toBeLessThanOrEqual(0xffff);
      expect(id).toBeGreaterThan(0);
    }
  });

  it('recognises the Soundcore service family', () => {
    const uuids = soundcoreServiceUuids();
    expect(uuids).toHaveLength(256);
    for (const uuid of uuids) expect(isSoundcoreService(uuid)).toBe(true);
    expect(isSoundcoreService('aeac4a03-dff5-498f-843a-34487cf133eb')).toBe(false);
    expect(isSoundcoreService('00001101-0000-1000-8000-00805f9b34fb')).toBe(false);
  });

  it('generates only well-formed UUIDs Chrome will accept', () => {
    // 8-4-4-4-12 lowercase hex — the shape whose violation made Chrome throw
    // "Invalid Service name" before the chooser could open.
    const uuidShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    for (const uuid of soundcoreServiceUuids()) expect(uuid).toMatch(uuidShape);
    expect(NOTHING_SPP_UUID).toMatch(uuidShape);
  });
});
