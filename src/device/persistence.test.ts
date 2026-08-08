import { beforeEach, describe, expect, it } from 'vitest';

import { forgetSnapshot, restoreSnapshot, saveSnapshot } from './persistence';
import type { Persistable, SnapshotPayload } from './persistence';

/** Node has no localStorage; a Map-backed stand-in is enough for these. */
const installStorage = (): void => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    },
  });
};

beforeEach(installStorage);

/**
 * A stand-in device. The point of these tests is that persistence works
 * without knowing anything about headphones — so the fixture is not one.
 */
class FakeDevice implements Persistable {
  snapshotVersion: number;
  payload: SnapshotPayload | null;
  restored: SnapshotPayload[] = [];

  constructor(payload: SnapshotPayload | null, version = 1) {
    this.payload = payload;
    this.snapshotVersion = version;
  }

  snapshot(): SnapshotPayload | null {
    return this.payload;
  }

  restore(payload: SnapshotPayload): void {
    this.restored.push(payload);
  }
}

const KEY = 'service-uuid';

describe('saveSnapshot', () => {
  it('round-trips whatever the device handed over', () => {
    saveSnapshot(KEY, new FakeDevice({ anything: [1, 2, 3], nested: { ok: true } }));

    const reader = new FakeDevice(null);
    expect(restoreSnapshot(KEY, reader)).toBe(true);
    expect(reader.restored[0]).toEqual({ anything: [1, 2, 3], nested: { ok: true } });
  });

  it('writes nothing when the device has nothing worth saving', () => {
    saveSnapshot(KEY, new FakeDevice(null));
    expect(restoreSnapshot(KEY, new FakeDevice(null))).toBe(false);
  });

  it('keys separately, so two devices do not overwrite each other', () => {
    saveSnapshot('a', new FakeDevice({ which: 'a' }));
    saveSnapshot('b', new FakeDevice({ which: 'b' }));

    const first = new FakeDevice(null);
    const second = new FakeDevice(null);
    restoreSnapshot('a', first);
    restoreSnapshot('b', second);
    expect(first.restored[0]).toEqual({ which: 'a' });
    expect(second.restored[0]).toEqual({ which: 'b' });
  });
});

describe('restoreSnapshot', () => {
  it('returns false before anything is saved', () => {
    expect(restoreSnapshot(KEY, new FakeDevice(null))).toBe(false);
  });

  it('refuses a payload written by a different version of the device', () => {
    saveSnapshot(KEY, new FakeDevice({ old: true }, 1));

    // Versions are per device, so one brand changing shape cannot invalidate
    // another's cache — and a stale payload never reaches a newer reader.
    const newer = new FakeDevice(null, 2);
    expect(restoreSnapshot(KEY, newer)).toBe(false);
    expect(newer.restored).toHaveLength(0);
  });

  it('survives corrupt JSON rather than throwing', () => {
    localStorage.setItem('otocontrol:device-state', '{ not json');
    expect(restoreSnapshot(KEY, new FakeDevice(null))).toBe(false);
  });

  it('survives a non-object payload', () => {
    localStorage.setItem(
      'otocontrol:device-state',
      JSON.stringify({ [KEY]: { version: 1, payload: 'not an object' } }),
    );
    expect(restoreSnapshot(KEY, new FakeDevice(null))).toBe(false);
  });
});

describe('forgetSnapshot', () => {
  it('removes one entry and leaves the rest', () => {
    saveSnapshot('a', new FakeDevice({ which: 'a' }));
    saveSnapshot('b', new FakeDevice({ which: 'b' }));
    forgetSnapshot('a');

    expect(restoreSnapshot('a', new FakeDevice(null))).toBe(false);
    expect(restoreSnapshot('b', new FakeDevice(null))).toBe(true);
  });

  it('is a no-op for a key that was never saved', () => {
    expect(() => forgetSnapshot('never-seen')).not.toThrow();
  });
});
