import { describe, expect, it } from 'vitest';
import { BOAT_DRIVER } from './driver';
import { initialBoatState } from './device';
import type { BoatState } from './device';
import { driverForService } from '@/core/driver';
import { BOAT_CUSTOM_SPP_UUID } from '@/core/transport';

const known = (caps: BoatState['capabilities']): BoatState => ({ ...initialBoatState, capabilities: caps });

describe('BOAT_DRIVER', () => {
  it('resolves the Bluetrum custom SPP service to the boat driver', () => {
    expect(driverForService(BOAT_CUSTOM_SPP_UUID)?.id).toBe('boat-bluetrum');
  });

  it('keeps every tab before capabilities are known, except the peer list', () => {
    const ids = BOAT_DRIVER.sections(initialBoatState).map((s) => s.id);
    expect(ids).toEqual(['noise', 'sound', 'system']);
  });

  it('gates noise on the ANC capability and sound on EQ', () => {
    const ids = BOAT_DRIVER.sections(known(new Set(['battery']))).map((s) => s.id);
    expect(ids).not.toContain('noise');
    expect(ids).not.toContain('sound');
    expect(ids).toContain('system');
    const withAncEq = BOAT_DRIVER.sections(known(new Set(['anc', 'eq']))).map((s) => s.id);
    expect(withAncEq).toContain('noise');
    expect(withAncEq).toContain('sound');
  });

  it('keeps the devices tab only once multipoint is known', () => {
    expect(BOAT_DRIVER.sections(known(new Set(['battery']))).map((s) => s.id)).not.toContain('devices');
    expect(BOAT_DRIVER.sections(known(new Set(['multipoint']))).map((s) => s.id)).toContain('devices');
  });

  it('gives every declared section a component to render it', () => {
    const components: Record<string, unknown> = BOAT_DRIVER.components;
    for (const section of BOAT_DRIVER.sections(initialBoatState)) {
      expect(components[section.id]).toBeDefined();
    }
  });

  it('summarises L/R/Case battery in the status line', () => {
    const state: BoatState = {
      ...initialBoatState,
      battery: {
        left: { level: 5, charging: true },
        right: { level: 64, charging: false },
        case: null,
      },
    };
    expect(BOAT_DRIVER.statusLine(state)).toBe('L 5% ⚡ · R 64%');
  });

  it('maps an empty peer list to no connections readout', () => {
    expect(BOAT_DRIVER.connections?.({ ...initialBoatState, peers: [] })).toBeNull();
  });
});
