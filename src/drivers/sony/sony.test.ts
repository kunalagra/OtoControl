import { describe, expect, it } from 'vitest';

import { SonyDevice, applyDurable, captureDurable, initialSonyState } from './sony';
import type { SonyState } from './sony';

const connected: SonyState = {
  ...initialSonyState,
  status: 'connected',
  info: { model: 'WF-C500', firmware: '1.2.3', colour: { series: 0, colour: 1 } },
  battery: {
    left: { level: 100, status: 0, charging: false, onPower: false, present: true },
    right: { level: 0, status: 2, charging: false, onPower: false, present: false },
  },
  codec: 2,
  upscaling: true,
  connectionMode: 1,
  eq: { inquiryType: 0, preset: 0x16, gains: [2, 1, 0, -1, 3, 0] },
  capabilities: new Set([0x21, 0x50, 0x23]),
};

describe('Sony durable state', () => {
  it('keeps identity and settings', () => {
    const snapshot = captureDurable(connected);
    expect(snapshot.info.model).toBe('WF-C500');
    expect(snapshot.upscaling).toBe(true);
    expect(snapshot.connectionMode).toBe(1);
    expect(snapshot.eq?.preset).toBe(0x16);
  });

  it('drops readings that change while the app is closed', () => {
    // Battery in particular: an earbud in the case reports 0, so a cached
    // value would show a flat bud that is actually charging.
    const snapshot = captureDurable(connected) as unknown as Record<string, unknown>;
    for (const live of ['battery', 'caseBattery', 'codec', 'status', 'error']) {
      expect(snapshot[live]).toBeUndefined();
    }
  });

  it('flattens the capability Set, which JSON cannot hold', () => {
    expect(captureDurable(connected).capabilities).toEqual([0x21, 0x50, 0x23]);
  });

  it('round-trips back into live shapes', () => {
    const patch = applyDurable(captureDurable(connected));
    expect(patch.capabilities).toBeInstanceOf(Set);
    expect(patch.capabilities?.has(0x50)).toBe(true);
    expect(patch.eq?.gains).toEqual([2, 1, 0, -1, 3, 0]);
  });

  it('carries every captured field back into live state', () => {
    // The guard that matters: adding a field to `captureDurable` and
    // forgetting it in `applyDurable` is silent otherwise — the field simply
    // stops surviving a restart, which no per-field test would notice. Sony
    // gained four such fields at once (speak-to-chat, touch assignment, voice
    // guidance, connections).
    const populated: SonyState = {
      ...connected,
      autoPowerOff: 3,
      pauseOnRemoval: true,
      speakToChat: { enabled: true, sensitivity: 1, timeout: 2 },
      touchAssignment: { left: 0x00, right: 0x20 },
      voiceGuidance: { enabled: true, volume: -1 },
      connections: {
        devices: [
          { mac: 'AA:BB:CC:DD:EE:FF', name: 'Pixel', status: 1, connected: true, classOfDevice: null },
        ],
        playbackMac: 'AA:BB:CC:DD:EE:FF',
        playbackFixed: true,
      },
    };
    const snapshot = captureDurable(populated);
    const patch = applyDurable(snapshot) as Record<string, unknown>;

    for (const key of Object.keys(snapshot)) {
      expect(patch, `durable field "${key}" is captured but never applied`).toHaveProperty(key);
    }
    for (const key of Object.keys(snapshot).filter((k) => k !== 'capabilities')) {
      expect(patch[key], `durable field "${key}" changed across the round trip`)
        .toEqual((snapshot as unknown as Record<string, unknown>)[key]);
    }
  });

  it('tolerates a snapshot written before a field existed', () => {
    // Older caches are normally dropped by the version check, but
    // `applyDurable` must not throw if one ever reaches it.
    const patch = applyDurable({ info: connected.info, capabilities: [] } as object);
    expect(patch.connections).toBeNull();
    expect(patch.speakToChat).toBeNull();
    expect(patch.capabilities).toBeInstanceOf(Set);
  });

  it('never carries a status or an error back in', () => {
    const patch = applyDurable(captureDurable(connected));
    expect('status' in patch).toBe(false);
    expect('error' in patch).toBe(false);
  });
});

describe('SonyDevice as a Persistable', () => {
  it('saves nothing before the device has identified itself', () => {
    // A snapshot of an empty state would overwrite a good cache with blanks.
    expect(new SonyDevice().snapshot()).toBeNull();
  });

  it('seeds settings while disconnected', () => {
    const device = new SonyDevice();
    device.restore(captureDurable(connected));

    expect(device.state.info.model).toBe('WF-C500');
    expect(device.state.upscaling).toBe(true);
    expect(device.supports(0x50)).toBe(true);
  });

  it('leaves the connection state alone when restoring', () => {
    const device = new SonyDevice();
    const before = device.state.status;
    device.restore(captureDurable(connected));
    // Cached settings must never make a device look connected.
    expect(device.state.status).toBe(before);
    expect(device.state.status).not.toBe('connected');
  });

  it('does not cache live readings back in', () => {
    const device = new SonyDevice();
    device.restore(captureDurable(connected));
    expect(device.state.battery).toBeNull();
    expect(device.state.codec).toBeNull();
  });

  it('notifies subscribers, so the UI redraws with the cached values', () => {
    const device = new SonyDevice();
    const seen: Array<string | null> = [];
    device.subscribe((state) => seen.push(state.info.model));

    device.restore(captureDurable(connected));
    expect(seen).toEqual(['WF-C500']);
  });
});

describe('SonyDevice noise state', () => {
  it('has no noise control until a capability table says otherwise', () => {
    const device = new SonyDevice();
    expect(device.state.noise).toBeNull();
    expect(device.state.noiseVariant).toBeNull();
  });

  it('ignores a noise write when nothing has been read', async () => {
    // Writing a whole NC/ASM body requires a previous reading to merge onto;
    // without one there is no variant to encode for.
    const device = new SonyDevice();
    await expect(device.setNoise({ enabled: true })).resolves.toBeUndefined();
    expect(device.state.noise).toBeNull();
  });
});
