import { describe, expect, it } from 'vitest';

import {
  NothingDevice,
  applyDurable,
  captureDurable,
  initialNothingState,
} from './device';
import type { NothingState } from './device';
import * as C from './commands';
import { NothingDecoder, encodePacket } from './frame';
import { FakeTransport, ascii } from '@/core/fakeTransport.test-helper';
import type { TransportOpener } from '@/core/transport';

/**
 * A state with **every** durable field populated, so the structural guard
 * below can tell "carried across" from "happens to be null on both sides".
 */
const connected: NothingState = {
  ...initialNothingState,
  status: 'connected',
  info: {
    model: 'CMF Headphone Pro',
    modelBase: 'B175',
    colourId: '06',
    firmware: 'US.B.1.2.3',
    serial: 'ABC123',
    hardware: 'HW1',
  },
  // A single-body over-ear: one cell, no pair and no case.
  battery: { left: null, right: null, case: null, single: { level: 80, charging: false } },
  anc: 3,
  personalizedAnc: { enabled: true, calibration: 1 },
  eqPreset: 1,
  customEq: { totalGain: 0, bands: [{ filterType: 1, gain: 4, frequency: 980, q: 0.7 }] },
  diracEq: 2,
  advancedEq: true,
  bassEnhance: { enabled: true, level: 3 },
  spatialAudio: { enabled: true, headTracking: false },
  earphoneStatus: null,
  multipoint: true,
  clarityBoost: { enabled: true, level: 2 },
  smartAnc: true,
  smartFree: false,
  lhdc: true,
  inEarDetection: true,
  lowLatency: false,
  gestures: [{ device: 2, button: 1, gesture: 7, operation: 10 }],
  earFitResult: null,
  capabilities: new Set(['battery', 'anc', 'spatialAudio']),
};

describe('Nothing durable state', () => {
  it('carries every captured field back into live state', () => {
    // The guard that matters: adding a field to `captureDurable` and
    // forgetting it in `applyDurable` is silent otherwise — the field simply
    // stops surviving a restart, which no per-field test would notice.
    const snapshot = captureDurable(connected);
    const patch = applyDurable(snapshot) as Record<string, unknown>;

    for (const key of Object.keys(snapshot)) {
      expect(patch, `durable field "${key}" is captured but never applied`).toHaveProperty(key);
    }
    // Values, not just presence — `capabilities` is the one that changes shape.
    for (const key of Object.keys(snapshot).filter((k) => k !== 'capabilities')) {
      expect(patch[key], `durable field "${key}" changed across the round trip`)
        .toEqual((snapshot as unknown as Record<string, unknown>)[key]);
    }
  });

  it('flattens and rebuilds the capability Set, which JSON cannot hold', () => {
    const snapshot = captureDurable(connected);
    expect(snapshot.capabilities).toEqual(['battery', 'anc', 'spatialAudio']);
    const patch = applyDurable(snapshot);
    expect(patch.capabilities).toBeInstanceOf(Set);
    expect(patch.capabilities?.has('spatialAudio')).toBe(true);
  });

  it('drops readings that change while the app is closed', () => {
    const snapshot = captureDurable(connected) as unknown as Record<string, unknown>;
    for (const live of ['battery', 'status', 'error', 'earFitResult']) {
      expect(snapshot[live]).toBeUndefined();
    }
  });

  it('tolerates a snapshot written before a field existed', () => {
    // Older caches are normally dropped by the version check, but `applyDurable`
    // must not throw if one ever reaches it.
    const patch = applyDurable({ info: connected.info } as object);
    expect(patch.spatialAudio).toBeNull();
    expect(patch.anc).toBeNull();
    expect(patch.capabilities).toBeInstanceOf(Set);
  });
});

describe('NothingDevice as a Persistable', () => {
  it('seeds settings while disconnected', () => {
    const device = new NothingDevice();
    device.restore(captureDurable(connected));

    expect(device.state.info.model).toBe('CMF Headphone Pro');
    expect(device.state.info.modelBase).toBe('B175');
    expect(device.state.spatialAudio).toEqual({ enabled: true, headTracking: false });
    expect(device.state.capabilities.has('spatialAudio')).toBe(true);
  });

  it('never makes a cached device look connected', () => {
    const device = new NothingDevice();
    const before = device.state.status;
    device.restore(captureDurable(connected));
    expect(device.state.status).toBe(before);
    expect(device.state.status).not.toBe('connected');
  });

  it('does not cache live readings back in', () => {
    const device = new NothingDevice();
    device.restore(captureDurable(connected));
    expect(device.state.battery.single).toBeNull();
  });

  it('notifies subscribers, so the UI redraws with the cached values', () => {
    const device = new NothingDevice();
    const seen: Array<string | null> = [];
    device.subscribe((state) => seen.push(state.info.model));

    device.restore(captureDurable(connected));
    expect(seen).toEqual(['CMF Headphone Pro']);
  });
});

describe('capability caching', () => {
  /** Counts the distinct commands a device is asked. */
  const countingOpener = (
    seen: Set<number>,
    answers: (command: number) => number[] | undefined,
  ): TransportOpener => async (_p, handlers) => {
    const transport = new FakeTransport(handlers)
    transport.onWrite = (bytes) => {
      const [frame] = new NothingDecoder().push(bytes)
      if (!frame) return
      seen.add(frame.command)
      const reply = answers(frame.command)
      if (reply === undefined) return
      queueMicrotask(() =>
        transport.receive(encodePacket(frame.command & 0x7fff, frame.sequence, reply)),
      )
    }
    return transport
  }

  /** Answers identity, battery and ANC; silent on everything else. */
  const sparse = (command: number): number[] | undefined => {
    if (command === C.Read.DeviceModel) return [0x62, 0xb1]
    if (command === C.Read.Firmware) return ascii('US.B.1.2.3')
    if (command === C.Read.Battery) return [0x01, 0x02, 0x50]
    if (command === C.Read.AncMode) return [0x01, 0x05, 0x00]
    return undefined
  }

  /**
   * A snapshot as a previous session would have left it — built by hand rather
   * than by connecting first, which keeps these tests off the slow path they
   * exist to remove.
   */
  const cachedSnapshot = (over: { modelBase?: string; firmware?: string } = {}) =>
    captureDurable({
      ...initialNothingState,
      info: {
        model: 'Nothing Ear (a)',
        modelBase: over.modelBase ?? 'B162',
        colourId: null,
        firmware: over.firmware ?? 'US.B.1.2.3',
        serial: null,
        hardware: null,
      },
      capabilities: new Set(['battery', 'anc'] as const),
    })

  const connect = async (snapshot?: object) => {
    const seen = new Set<number>()
    // 20 ms probes: this suite is about *which* questions are asked, not how
    // patiently. The production bound is covered by `nothingDevice.test.ts`.
    const device = new NothingDevice(countingOpener(seen, sparse), { probeTimeoutMs: 20 })
    if (snapshot) device.restore(snapshot)
    await device.adoptPort({} as SerialPort)
    return { device, seen }
  }

  it('re-asks everything when there is no cache', async () => {
    const { device, seen } = await connect()
    expect(seen.size).toBeGreaterThan(15)
    expect(device.state.capabilities.has('battery')).toBe(true)
    expect(device.state.capabilities.has('lhdc')).toBe(false)
  })

  it('skips the questions a matching cache already answered', async () => {
    const { device, seen } = await connect(cachedSnapshot())
    // Handshake (2), clock (1), identity (4) and the two live capabilities —
    // not the seventeen the cache says are absent. The bound is the count, so
    // adding an ungated read to `refresh` fails here.
    expect(seen.size).toBeLessThanOrEqual(9)
    expect(device.state.capabilities.has('battery')).toBe(true)
    expect(device.state.capabilities.has('anc')).toBe(true)
    expect(device.state.battery.left).toEqual({ level: 80, charging: false })
  })

  it('ignores a cache from another device of the same brand', async () => {
    // The slot is keyed by service UUID, so it can hold a different Nothing
    // device; a mismatched base code must force a full re-probe.
    const { seen } = await connect(cachedSnapshot({ modelBase: 'B999' }))
    expect(seen.size).toBeGreaterThan(15)
  })

  it('ignores a cache from before a firmware update', async () => {
    // An update can add features, and a stale cache would deny them forever.
    const { seen } = await connect(cachedSnapshot({ firmware: 'US.B.1.0.0' }))
    expect(seen.size).toBeGreaterThan(15)
  })

  it('a manual refresh re-asks even when the cache matches', async () => {
    const { device, seen } = await connect(cachedSnapshot())
    const afterConnect = seen.size
    seen.clear()
    await device.refresh()
    expect(seen.size).toBeGreaterThan(afterConnect)
  })
})
