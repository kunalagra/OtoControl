/**
 * Durable device settings, cached in local storage.
 *
 * This module is deliberately **brand-agnostic**: it knows about keys, version
 * numbers and JSON, and nothing about headphones. What is worth remembering is
 * a question only a device can answer, so each device implements `Persistable`
 * and this stores whatever it hands over.
 *
 * Why cache at all: Web Serial gives nothing until the headphones are on,
 * connected as an audio device and the port is open, so a cold page load has no
 * idea what the device is. Caching the last reading lets the app open showing
 * your headphones and their settings, then reconcile against the hardware once
 * the link is up.
 */

const STORAGE_KEY = 'otocontrol:device-state';

/**
 * Whatever a device chose to write. Opaque here on purpose — this module never
 * looks inside. Devices serialise their own Maps and Sets, since JSON has
 * neither.
 */
export type SnapshotPayload = object;

/**
 * A device that can save and reload its own settings.
 *
 * The contract that matters is in `restore`: it must treat the payload as
 * untrusted, and it must never let a cache overwrite a live reading.
 */
export interface Persistable {
  /**
   * Bumped by the device whenever its payload shape changes. Entries written
   * by an older version are dropped rather than fed to a reader that would
   * misread them — per device, so one brand's change cannot invalidate
   * another's cache.
   */
  readonly snapshotVersion: number;

  /** Durable settings as plain JSON, or null when there is nothing to save. */
  snapshot(): SnapshotPayload | null;

  /** Seeds durable settings from a payload this device previously wrote. */
  restore(payload: SnapshotPayload): void;
}

interface StoredEntry {
  version: number;
  payload: SnapshotPayload;
}

type Store = Record<string, StoredEntry>;

function readStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Store) : {};
  } catch {
    // Blocked storage or corrupt JSON. Remembering is a convenience.
    return {};
  }
}

function writeStore(store: Store): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Quota or private mode; not worth failing over.
  }
}

/**
 * Saves a device's snapshot under a key.
 *
 * Callers key by service UUID, which distinguishes brands but not two devices
 * of the same brand — the same limitation `knownDevices` carries.
 */
export function saveSnapshot(key: string, device: Persistable): void {
  const payload = device.snapshot();
  if (payload === null) return;

  const store = readStore();
  const entry: StoredEntry = { version: device.snapshotVersion, payload };

  // Devices emit on every notification; most carry nothing durable, so this
  // keeps a battery tick from rewriting storage several times a second.
  if (JSON.stringify(store[key]) === JSON.stringify(entry)) return;

  writeStore({ ...store, [key]: entry });
}

/** Hands a device its cached settings, if any survive the version check. */
export function restoreSnapshot(key: string, device: Persistable): boolean {
  const entry = readStore()[key];
  if (!entry || entry.version !== device.snapshotVersion) return false;
  if (typeof entry.payload !== 'object' || entry.payload === null) return false;

  device.restore(entry.payload);
  return true;
}

export function forgetSnapshot(key: string): void {
  const store = readStore();
  if (!(key in store)) return;
  const { [key]: _dropped, ...rest } = store;
  writeStore(rest);
}
