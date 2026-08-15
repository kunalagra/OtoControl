import { describe, expect, it } from 'vitest';

import { StateStore } from './stateStore';
import type { StateStoreHooks } from './stateStore';

/**
 * A state shape as trivial as `FakeClient` in `session.test.ts` — the store
 * never looks inside `TState` beyond what `hooks` describe.
 */
interface FakeState {
  status: 'disconnected' | 'connected';
  model: string | null;
  value: number;
}

const initial: FakeState = { status: 'disconnected', model: null, value: 0 };

/** Mirrors the real drivers: unread until something has a model, capture/apply round-trip `value`. */
function fakeHooks(): StateStoreHooks<FakeState> {
  return {
    isUnread: (state) => state.model === null,
    capture: (state) => ({ value: state.value }),
    isConnected: (state) => state.status === 'connected',
    apply: (_state, payload) => ({ value: (payload as { value: number }).value }),
  };
}

describe('StateStore subscribe/patch/replace', () => {
  it('notifies subscribers on patch', () => {
    const store = new StateStore(initial, fakeHooks());
    const seen: number[] = [];
    store.subscribe((state) => seen.push(state.value));

    store.patch({ value: 1 });

    expect(seen).toEqual([1]);
  });

  it('notifies subscribers on replace', () => {
    const store = new StateStore(initial, fakeHooks());
    const seen: number[] = [];
    store.subscribe((state) => seen.push(state.value));

    store.replace({ ...initial, value: 5 });

    expect(seen).toEqual([5]);
  });

  it('does not notify when replace is handed the current state by reference', () => {
    // Pins a performance-shaped guard, not a correctness one: several
    // reducers return their input unchanged when a frame carries nothing
    // new, and firing listeners for that would be a spurious re-render on
    // every one of those frames. Mutation check: deleting the `next ===
    // this.#state` guard in stateStore.ts makes this fail, since `seen`
    // would then contain the (identical) state once.
    const store = new StateStore(initial, fakeHooks());
    const seen: FakeState[] = [];
    store.subscribe((state) => seen.push(state));

    store.replace(store.state);

    expect(seen).toEqual([]);
  });

  it('stops delivering after unsubscribe', () => {
    const store = new StateStore(initial, fakeHooks());
    const seen: number[] = [];
    const unsubscribe = store.subscribe((state) => seen.push(state.value));

    unsubscribe();
    store.patch({ value: 1 });

    expect(seen).toEqual([]);
  });
});

describe('StateStore snapshot', () => {
  it('returns null before anything has been read', () => {
    const store = new StateStore(initial, fakeHooks());
    expect(store.snapshot()).toBeNull();
  });

  it('captures once something has been read', () => {
    const store = new StateStore(initial, fakeHooks());
    store.patch({ model: 'X', value: 7 });

    expect(store.snapshot()).toEqual({ value: 7 });
  });
});

describe('StateStore restore', () => {
  it('applies the payload and notifies while not connected', () => {
    const store = new StateStore(initial, fakeHooks());
    const seen: number[] = [];
    store.subscribe((state) => seen.push(state.value));

    store.restore({ value: 9 });

    expect(store.state.value).toBe(9);
    expect(seen).toEqual([9]);
  });

  it('refuses once connected, so a late cache never overwrites what the hardware just said', () => {
    const store = new StateStore({ ...initial, status: 'connected' }, fakeHooks());

    store.restore({ value: 9 });

    expect(store.state.value).toBe(0);
  });
});
