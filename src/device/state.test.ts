import { describe, expect, it } from 'vitest';

import { Vendor, encodeFrame, FrameDecoder } from '../gaia/frame';
import type { GaiaFrame } from '../gaia/frame';
import { TOGGLES, applyDurable, applyNotification, captureDurable, initialState } from './state';
import type { DeviceState } from './state';

const frame = (command: number, payload: number[]): GaiaFrame => {
  const [decoded] = new FrameDecoder().push(encodeFrame(Vendor.Sennheiser, command, payload));
  return decoded;
};

describe('applyNotification', () => {
  it('applies the battery notification (0x0683 shares 0x0603s payload)', () => {
    const next = applyNotification(initialState, frame(0x0683, [0x40]));
    expect(next.battery).toBe(64);
  });

  it('applies the ANC notification', () => {
    const next = applyNotification(initialState, frame(0x1a85, [0x01]));
    expect(next.noise.ancEnabled).toBe(true);
  });

  it('applies the transparency-level notification', () => {
    const next = applyNotification(initialState, frame(0x1a83, [0x32]));
    expect(next.noise.transparencyLevel).toBe(50);
  });

  it('applies the transparent-hearing notification', () => {
    const next = applyNotification(initialState, frame(0x1885, [0x01]));
    expect(next.noise.transparentHearing).toBe(true);
  });

  it('applies the ANC modes notification', () => {
    const next = applyNotification(initialState, frame(0x1a81, [0x01, 0x00, 0x02, 0x01, 0x03, 0x01]));
    expect(next.noise.modes).toEqual({ antiWind: 0, comfort: 1, adaptive: 1 });
  });

  it('routes the low-latency notification to its toggle', () => {
    const next = applyNotification(initialState, frame(0x0898, [0x01]));
    expect(next.toggles.lowLatency).toBe(true);
  });

  it('inverts the auto-lock notification into a touch-controls state', () => {
    // Wire value 0 = not locked = touch controls working.
    expect(applyNotification(initialState, frame(0x1687, [0x00])).toggles.touchControls).toBe(
      true,
    );
    expect(applyNotification(initialState, frame(0x1687, [0x01])).toggles.touchControls).toBe(
      false,
    );
  });

  it('leaves untouched fields alone', () => {
    const withBattery = applyNotification(initialState, frame(0x0683, [0x40]));
    const withAnc = applyNotification(withBattery, frame(0x1a85, [0x01]));
    expect(withAnc.battery).toBe(64);
    expect(withAnc.noise.ancEnabled).toBe(true);
  });

  it('returns the same object for an unmodelled notification', () => {
    const next = applyNotification(initialState, frame(0x0c80, [0x01]));
    expect(next).toBe(initialState);
  });

  it('survives a malformed payload rather than throwing', () => {
    const next = applyNotification(initialState, frame(0x1a83, []));
    expect(next).toBe(initialState);
  });
});

describe('EQ reduction', () => {
  it('applies the all-bands notification', () => {
    const next = applyNotification(initialState, frame(0x1082, [0x1e, 0xce, 0, 0x0a, 0xf6]));
    expect(next.eq.gains).toEqual([3, -5, 0, 1, -1]);
  });

  it('applies a single-band response to just that band', () => {
    const withAll = applyNotification(initialState, frame(0x1082, [0, 0, 0, 0, 0]));
    const next = applyNotification(withAll, frame(0x1102, [2, 0x1e]));
    expect(next.eq.gains).toEqual([0, 0, 3, 0, 0]);
  });

  it('does not decode the all-bands payload as a single band', () => {
    // Both frames reduce to request ID 0x1002; only the exact command
    // distinguishes them.
    const next = applyNotification(initialState, frame(0x1082, [0x1e, 0xce, 0, 0x0a, 0xf6]));
    expect(next.eq.gains).toHaveLength(5);
  });

  it('applies the EQ config response', () => {
    const next = applyNotification(initialState, frame(0x1100, [5, 0xc4, 0x3c]));
    expect(next.eq.config).toEqual({ bands: 5, minGain: -6, maxGain: 6 });
  });
});

describe('connection management', () => {
  const withDevices = {
    ...initialState,
    connections: {
      ...initialState.connections,
      devices: [
        { index: 0, priority: 0, connected: true, name: "Kunal's Mac" },
        { index: 1, priority: 1, connected: false, name: 'Pixel' },
      ],
    },
  };

  it('applies the connection-changed notification to the right entry', () => {
    const next = applyNotification(withDevices, frame(0x1484, [0x01, 0x01]));
    expect(next.connections.devices.map((d) => d.connected)).toEqual([true, true]);
  });

  it('applies a disconnect', () => {
    const next = applyNotification(withDevices, frame(0x1484, [0x00, 0x00]));
    expect(next.connections.devices[0].connected).toBe(false);
  });

  it('ignores a status for an index it does not know', () => {
    const next = applyNotification(withDevices, frame(0x1484, [0x09, 0x01]));
    expect(next.connections.devices.map((d) => d.connected)).toEqual([true, false]);
  });
});

describe('TOGGLES registry', () => {
  it('pairs every get with a set on the same feature family', () => {
    for (const { key, get, set } of TOGGLES) {
      expect(get.vendor, key).toBe(set.vendor);
      expect(get.id, key).not.toBe(set.id);
    }
  });

  it('has a state slot for every toggle', () => {
    for (const { key } of TOGGLES) {
      expect(initialState.toggles).toHaveProperty(key);
    }
  });

  it('uses unique keys and command IDs', () => {
    expect(new Set(TOGGLES.map((t) => t.key)).size).toBe(TOGGLES.length);
    expect(new Set(TOGGLES.map((t) => t.get.id)).size).toBe(TOGGLES.length);
  });
});

describe('durable state', () => {
  const connected: DeviceState = {
    ...initialState,
    status: 'connected',
    info: { model: 'M4AEBT Black', firmware: '3.38.3', serial: '660066697418', codec: 2 },
    battery: 87,
    charging: true,
    wearState: 2,
    sidetone: 3,
    powerOffSeconds: 900,
    supportedFeatures: new Map([
      [0x00, 4],
      [0x06, 2],
    ]),
    toggles: { ...initialState.toggles, smartPause: true, touchControls: false },
  };

  it('keeps identity and settings', () => {
    const snapshot = captureDurable(connected);
    expect(snapshot.info.model).toBe('M4AEBT Black');
    expect(snapshot.toggles.smartPause).toBe(true);
    expect(snapshot.powerOffSeconds).toBe(900);
    expect(snapshot.sidetone).toBe(3);
  });

  it('drops readings that change while the app is closed', () => {
    // Remembering "87%" or "on head" would state something about right now
    // that a cache cannot support.
    const snapshot = captureDurable(connected) as unknown as Record<string, unknown>;
    for (const live of ['battery', 'charging', 'wearState', 'status', 'error']) {
      expect(snapshot[live]).toBeUndefined();
    }
    expect('codec' in captureDurable(connected).info).toBe(false);
  });

  it('flattens the feature Map, which JSON cannot hold', () => {
    expect(captureDurable(connected).supportedFeatures).toEqual([
      [0x00, 4],
      [0x06, 2],
    ]);
  });

  it('round-trips back into live shapes', () => {
    const patch = applyDurable(initialState, captureDurable(connected));
    expect(patch.supportedFeatures).toBeInstanceOf(Map);
    expect(patch.supportedFeatures?.get(0x06)).toBe(2);
    expect(patch.toggles?.smartPause).toBe(true);
    expect(patch.info?.model).toBe('M4AEBT Black');
  });

  it('never carries a status or an error back in', () => {
    // A restored cache must not make a disconnected device look connected.
    const patch = applyDurable(initialState, captureDurable(connected));
    expect('status' in patch).toBe(false);
    expect('error' in patch).toBe(false);
  });

  it('leaves the live codec alone', () => {
    // Negotiated per connection, so the current value wins over the cache.
    const live = { ...initialState, info: { ...initialState.info, codec: 5 } };
    expect(applyDurable(live, captureDurable(connected)).info?.codec).toBe(5);
  });
});
