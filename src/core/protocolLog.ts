/**
 * A bounded recording of the raw bytes that crossed a link, for drivers that
 * have no hardware to be tested against: a tester copies it from the System
 * tab and attaches it to a report. Kept outside device state so recording
 * never re-renders anything.
 */

/** How much of the conversation is kept. */
const MAX_ENTRIES = 400;

export interface ProtocolLogEntry {
  /** `Date.now()` when the bytes crossed the link. */
  at: number;
  /** `connect` marks a new link, with no bytes. */
  direction: 'tx' | 'rx' | 'connect';
  bytes: Uint8Array;
}

export class ProtocolLog {
  #entries: ProtocolLogEntry[] = [];
  readonly #listeners = new Set<() => void>();

  /** Oldest first. A new array on every append, so it works as a `useSyncExternalStore` snapshot. */
  get entries(): readonly ProtocolLogEntry[] {
    return this.#entries;
  }

  append(direction: ProtocolLogEntry['direction'], bytes: Uint8Array = new Uint8Array(0)): void {
    this.#entries = [...this.#entries, { at: Date.now(), direction, bytes: Uint8Array.from(bytes) }].slice(-MAX_ENTRIES);
    for (const listener of this.#listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

export const hex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');

/** One line per entry, timed from the first: what "Copy log" puts on the clipboard. */
export function formatLog(entries: readonly ProtocolLogEntry[]): string {
  const start = entries[0]?.at ?? 0;
  return entries
    .map((entry) => `+${entry.at - start}ms ${entry.direction === 'connect' ? '-- connect --' : `${entry.direction.toUpperCase()} ${hex(entry.bytes)}`}`)
    .join('\n');
}
