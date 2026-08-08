/**
 * Remembers which granted device was last used, and what it called itself.
 *
 * `port.getInfo()` exposes only the service class ID — no name, no address — so
 * a granted port cannot be labelled until it has been connected to at least
 * once. Caching the model string per service makes the picker readable on the
 * second run, and makes auto-reconnect deterministic when several devices are
 * granted.
 *
 * Keyed by service UUID, which distinguishes brands but not two devices of the
 * same brand. That is a real limitation, noted rather than hidden.
 */

const STORAGE_KEY = 'otocontrol:known-devices';
const PREFERRED_KEY = 'otocontrol:preferred-service';

export type KnownNames = Record<string, string>;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    // Blocked storage or corrupt JSON — remembering is a convenience, not a
    // requirement.
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not being able to remember is not worth failing over.
  }
}

export const knownDeviceNames = (): KnownNames => {
  const value = read<KnownNames>(STORAGE_KEY, {});
  return typeof value === 'object' && value !== null ? value : {};
};

export function rememberDeviceName(serviceUuid: string, model: string | null): void {
  if (!model) return;
  const names = knownDeviceNames();
  if (names[serviceUuid] === model) return;
  write(STORAGE_KEY, { ...names, [serviceUuid]: model });
}

export const preferredService = (): string | null => read<string | null>(PREFERRED_KEY, null);

export const rememberPreferredService = (serviceUuid: string): void =>
  write(PREFERRED_KEY, serviceUuid);

/** What to show in the picker before a device has ever been connected to. */
export function deviceLabel(serviceUuid: string, brand: string): string {
  return knownDeviceNames()[serviceUuid] ?? (brand === 'sony' ? 'Sony device' : 'Sennheiser device');
}
