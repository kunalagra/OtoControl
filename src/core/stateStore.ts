/**
 * The listener set and the snapshot/restore glue both device classes used to
 * duplicate.
 *
 * `MomentumDevice` and `SonyDevice` differ in their state's shape and in how
 * each captures/applies the durable slice of it, but not in the mechanics
 * around that: a Set of subscribers notified on every patch or replace, and
 * the two policies guarding snapshot and restore. That part moved here.
 *
 * Deliberately a sibling of `DeviceSession`, not a merger with it:
 * `DeviceSession` is generic over the protocol *client* and owns transport
 * lifecycle; this is generic over *state* and owns notification. Folding the
 * two together would give one class two unrelated jobs — the opposite of the
 * thin session this phase is building. `snapshot`/`restore` depend on the
 * state shape and on `Persistable`, not on the transport, so they belong
 * here rather than with the session.
 *
 * This module knows nothing about transports, clients or protocols — only
 * about `TState` and the driver-supplied hooks below.
 */

import type { SnapshotPayload } from './persistence';

type Listener<TState> = (state: TState) => void;

export interface StateStoreHooks<TState> {
  /**
   * True once nothing has been read yet, so there is nothing worth
   * remembering. Driver-specific — both current drivers key this off
   * `info.model === null`, but the store does not assume that shape.
   */
  isUnread(state: TState): boolean;
  /** Captures the durable slice of state. Only called once `isUnread` says otherwise. */
  capture(state: TState): SnapshotPayload;
  /**
   * True while connected. `restore` refuses in that case: the device is the
   * source of truth, and a cache arriving late must never overwrite what the
   * hardware just said.
   */
  isConnected(state: TState): boolean;
  /** Turns a restored payload into a patch to merge onto the current state. */
  apply(state: TState, payload: SnapshotPayload): Partial<TState>;
}

export class StateStore<TState> {
  #state: TState;
  #listeners = new Set<Listener<TState>>();
  readonly #hooks: StateStoreHooks<TState>;

  constructor(initial: TState, hooks: StateStoreHooks<TState>) {
    this.#state = initial;
    this.#hooks = hooks;
  }

  get state(): TState {
    return this.#state;
  }

  subscribe(listener: Listener<TState>): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  patch(partial: Partial<TState>): void {
    this.#state = { ...this.#state, ...partial };
    this.#notify();
  }

  /**
   * Replaces state wholesale — used when a notification's own reduction
   * already produced the full next state. Skips notifying when handed back
   * the same reference: a reducer that found nothing new in a frame returns
   * its input unchanged, and firing listeners for that would be a spurious
   * re-render on every one of those frames.
   */
  replace(next: TState): void {
    if (next === this.#state) return;
    this.#state = next;
    this.#notify();
  }

  #notify(): void {
    for (const listener of this.#listeners) listener(this.#state);
  }

  // --- snapshot / restore policy -------------------------------------------

  /** Durable settings as plain JSON, or null when there is nothing to save. */
  snapshot(): SnapshotPayload | null {
    if (this.#hooks.isUnread(this.#state)) return null;
    return this.#hooks.capture(this.#state);
  }

  /**
   * Seeds durable settings from a payload the device previously wrote.
   *
   * Refuses once connected — see `StateStoreHooks.isConnected` — so a cache
   * arriving late can never overwrite a live reading with stale data.
   */
  restore(payload: SnapshotPayload): void {
    if (this.#hooks.isConnected(this.#state)) return;
    this.patch(this.#hooks.apply(this.#state, payload));
  }
}
