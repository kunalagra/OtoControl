# Transport Seam & Device Orchestration Tests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make device orchestration testable by injecting the transport, then cover the behaviour that currently has none.

**Architecture:** `MomentumDevice` and `SonyDevice` each construct a `SerialTransport` inside `#connectTo`, so neither can be tested. Both gain a constructor parameter — a `TransportOpener` function defaulting to the real one — and a fake implementation plus a scripted GAIA responder let tests drive a full connect and exercise the orchestration.

**Tech Stack:** TypeScript, Vitest 3, Web Serial.

**Spec:** `docs/superpowers/specs/2026-08-11-driver-architecture-design.md` — this plan implements **phase 1 only** (§5 step 1). Phases 2–5 get their own plans once the seam exists, because their shape depends on what it reveals.

## Global Constraints

- Work on branch `worktree-driver-architecture` in this worktree. **Never push, never merge, never switch to or touch `main`.** Never run `git config --global`.
- Commit each task. Messages explain *why*, not *what*, and end with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Full suite `npm test`; lint `npm run lint`; typecheck `npm run build`. Baseline is **430 tests across 23 files**.
- **No behaviour change.** This phase adds a seam and tests. If a test appears to reveal a bug, report it — do not fix it in the same task.
- Comments explain *why*, matching the density and voice of the surrounding file. This codebase's comments are unusually good; read the neighbours before writing one.

---

### Task 1: Inject the transport opener

**Files:**
- Modify: `src/device/transport.ts` (add `TransportOpener` and `openSerialTransport`)
- Modify: `src/device/device.ts` (`#transport` type, constructor, `#connectTo`)
- Modify: `src/device/sony.ts` (same three)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type TransportOpener = (port: SerialPort, handlers: TransportHandlers) => Promise<Transport>`
  - `const openSerialTransport: TransportOpener`
  - `new MomentumDevice(openTransport?: TransportOpener)` and `new SonyDevice(openTransport?: TransportOpener)` — both default to `openSerialTransport`, so `manager.ts`'s `new MomentumDevice()` keeps working unchanged.

- [ ] **Step 1: Add the opener type**

In `src/device/transport.ts`, after the `TransportHandlers` interface:

```ts
/**
 * How a device class obtains a transport.
 *
 * Injected rather than called directly so tests can supply a fake. Both device
 * classes used to construct `SerialTransport` themselves, which is exactly why
 * neither had a single test — and why two real bugs shipped in their
 * orchestration before a reviewer caught them by reading.
 */
export type TransportOpener = (
  port: SerialPort,
  handlers: TransportHandlers,
) => Promise<Transport>;

/** The real one. Wrapped rather than passed as a bare static for clarity. */
export const openSerialTransport: TransportOpener = (port, handlers) =>
  SerialTransport.open(port, handlers);
```

Note `openSerialTransport` must be declared *after* the `SerialTransport` class, since it references it at module scope. Put it at the end of the file if the class is defined below `TransportHandlers`.

- [ ] **Step 2: Inject into `MomentumDevice`**

In `src/device/device.ts`, widen the field type and add a constructor. Change:

```ts
  #transport: SerialTransport | null = null;
```

to:

```ts
  #transport: Transport | null = null;
  readonly #openTransport: TransportOpener;

  constructor(openTransport: TransportOpener = openSerialTransport) {
    this.#openTransport = openTransport;
  }
```

Update the import from `./transport` to add `openSerialTransport` and the types `Transport`, `TransportOpener` (types via `import type`). `SerialTransport` may become unused there — remove it if so; lint will say.

In `#connectTo`, change:

```ts
    const transport = await SerialTransport.open(port, {
```

to:

```ts
    const transport = await this.#openTransport(port, {
```

Leave everything else alone. `#transport` is only assigned, nulled, and `.close()`d, so widening to `Transport` is safe.

- [ ] **Step 3: Inject into `SonyDevice`**

Make the identical three changes in `src/device/sony.ts`: `#transport: Transport | null`, the constructor with the same default, and `await this.#openTransport(port, {` in its `#connectTo`.

- [ ] **Step 4: Verify no behaviour changed**

Run: `npm test && npm run lint && npm run build`
Expected: **430 passing**, lint clean, build clean. The count must not change — this task adds no tests and removes none.

- [ ] **Step 5: Commit**

---

### Task 2: Fake transport and GAIA responder

**Files:**
- Create: `src/device/fakeTransport.ts`
- Create: `src/device/device.test.ts` (one connect test to prove the harness)

**Interfaces:**
- Consumes: `TransportOpener` from Task 1.
- Produces:
  - `class FakeTransport implements Transport` with `written: Uint8Array[]`, `receive(bytes)`, `drop(reason?)`
  - `function gaiaHarness(replies?: GaiaReplies): { open: TransportOpener; transport(): FakeTransport; sent(): {vendor:number;command:number;payload:Uint8Array}[] }`
  - `type GaiaReplies = Map<number, number[] | ((payload: Uint8Array, call: number) => number[] | undefined)>`

- [ ] **Step 1: Write the fake**

Create `src/device/fakeTransport.ts`:

```ts
/**
 * Test doubles for the transport seam. Not imported by the app.
 *
 * `gaiaHarness` answers every request the device sends, because the connect
 * sequence issues dozens of reads and would otherwise stall on the first one.
 * Individual failures are already tolerated by `#refreshAll`, so a responder
 * that errors everything still reaches `connected` — which lets each test
 * script only the commands it actually cares about.
 */

import { encodeFrame } from '../gaia/frame';
import type { Transport, TransportHandlers, TransportOpener } from './transport';

export class FakeTransport implements Transport {
  readonly written: Uint8Array[] = [];
  isOpen = true;
  onWrite?: (bytes: Uint8Array) => void;
  readonly #handlers: TransportHandlers;

  constructor(handlers: TransportHandlers) {
    this.#handlers = handlers;
  }

  async write(bytes: Uint8Array): Promise<void> {
    this.written.push(bytes);
    this.onWrite?.(bytes);
  }

  async close(): Promise<void> {
    this.isOpen = false;
  }

  /** Deliver bytes as though the device sent them. */
  receive(bytes: Uint8Array): void {
    this.#handlers.onData(bytes);
  }

  /** Simulate the link going away. */
  drop(reason?: Error): void {
    this.isOpen = false;
    this.#handlers.onClose(reason);
  }
}

export interface SentFrame {
  vendor: number;
  command: number;
  payload: Uint8Array;
}

export type GaiaReplies = Map<
  number,
  number[] | ((payload: Uint8Array, call: number) => number[] | undefined)
>;

const parse = (frame: Uint8Array): SentFrame => {
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  return {
    vendor: view.getUint16(4, false),
    command: view.getUint16(6, false),
    payload: frame.slice(8),
  };
};

export function gaiaHarness(replies: GaiaReplies = new Map()) {
  let transport: FakeTransport | null = null;
  const sent: SentFrame[] = [];
  const calls = new Map<number, number>();

  const open: TransportOpener = async (_port, handlers) => {
    transport = new FakeTransport(handlers);
    transport.onWrite = (bytes) => {
      const frame = parse(bytes);
      sent.push(frame);
      const call = (calls.get(frame.command) ?? 0) + 1;
      calls.set(frame.command, call);

      const scripted = replies.get(frame.command);
      const payload =
        typeof scripted === 'function' ? scripted(frame.payload, call) : scripted;

      // Reply on a later microtask: the client registers its pending request
      // around the write, and answering inline would be a tighter race than
      // any real transport produces.
      queueMicrotask(() => {
        transport?.receive(
          payload === undefined
            ? encodeFrame(frame.vendor, frame.command | 0x0180, [0x01])
            : encodeFrame(frame.vendor, frame.command | 0x0100, payload),
        );
      });
    };
    return transport;
  };

  return {
    open,
    transport: () => transport!,
    sent: () => sent,
    /** Every command ID written, for "did it poll X?" assertions. */
    commands: () => sent.map((frame) => frame.command),
  };
}

export const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));
```

- [ ] **Step 2: Write the harness proof test**

Create `src/device/device.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { MomentumDevice } from './device';
import { ascii, gaiaHarness } from './fakeTransport';
import type { GaiaReplies } from './fakeTransport';

/** `adoptPort` is the test entry point — `connect()` would need the picker. */
const port = {} as SerialPort;

describe('MomentumDevice connect', () => {
  it('reaches connected and reads the model, tolerating every other failure', async () => {
    const harness = gaiaHarness(new Map([[0x1206, ascii('M4AEBT Black')]]));
    const device = new MomentumDevice(harness.open);

    await device.adoptPort(port);

    expect(device.state.status).toBe('connected');
    expect(device.state.info.model).toBe('M4AEBT Black');
  });
});
```

- [ ] **Step 3: Run it**

Run: `npm test -- src/device/device.test.ts`
Expected: PASS. If it hangs or times out, the responder is not answering — check that `encodeFrame`'s response ID (`command | 0x0100`) matches what `GaiaClient` waits for, and that `queueMicrotask` fires before the request's timeout.

- [ ] **Step 4: Verify the whole suite**

Run: `npm test && npm run lint && npm run build`
Expected: **431 passing** (430 + 1), lint clean, build clean.

- [ ] **Step 5: Commit**

---

### Task 3: Cover the orchestration that had no tests

Every behaviour below is named in the spec's §4 and none of it is currently covered. Two of them are the bugs found by review in the previous piece of work.

**Files:**
- Modify: `src/device/device.test.ts`

**Interfaces:**
- Consumes: `gaiaHarness`, `ascii`, `FakeTransport` from Task 2.
- Produces: nothing.

- [ ] **Step 1: Test that a connected entry is never deleted**

Add to `src/device/device.test.ts`. The paired-device list is read during connect, so the harness must answer the enumeration:

```ts
/** Answers enough of the connect sequence to populate the paired-device list. */
const withPairedDevices = (): GaiaReplies =>
  new Map([
    [0x1206, ascii('M4AEBT Black')],
    [0x1400, [0x00, 0x02]],            // list size 2 (u16 BE)
    [0x1407, [0x00]],                  // own device is index 0
    [0x1409, [0x02]],                  // two connections at once
    [
      0x1401,
      (payload) =>
        payload[0] === 0
          ? [0x00, 0x00, 0x01, ...ascii('This Mac')]   // index 0, connected
          : [0x01, 0x01, 0x01, ...ascii('iPhone')],    // index 1, connected
    ],
  ]);

describe('MomentumDevice.removePairedDevice', () => {
  it('refuses a connected entry and sends nothing', async () => {
    const harness = gaiaHarness(withPairedDevices());
    const device = new MomentumDevice(harness.open);
    await device.adoptPort(port);

    await device.removePairedDevice(1);

    expect(harness.commands()).not.toContain(0x1405);
    expect(device.state.error).toBe('Disconnect the device before removing it.');
  });
});
```

- [ ] **Step 2: Test that a failed re-read preserves the list**

This is the bug the final review caught: `refreshConnections` reported success on a partial re-read and patched an empty list over a good one.

```ts
  it('keeps the last known list when the re-read fails after a delete', async () => {
    // This model has a firmware bug where the list is unavailable right after a
    // removal — the vendor app names it. A delete that actually succeeded must
    // not surface as an error, and must not wipe the list it just changed.
    let listAvailable = true;
    const replies = withPairedDevices();
    // Entry 1 must be disconnected, or removal is refused before it starts.
    replies.set(0x1401, (payload) =>
      payload[0] === 0
        ? [0x00, 0x00, 0x01, ...ascii('This Mac')]
        : [0x01, 0x01, 0x00, ...ascii('iPhone')],
    );
    replies.set(0x1400, () => (listAvailable ? [0x00, 0x02] : undefined));
    replies.set(0x1405, () => {
      listAvailable = false;   // the delete lands, and the list goes away
      return [];
    });

    const harness = gaiaHarness(replies);
    const device = new MomentumDevice(harness.open);
    await device.adoptPort(port);
    expect(device.state.connections.devices).toHaveLength(2);

    await device.removePairedDevice(1);

    expect(harness.commands()).toContain(0x1405);
    expect(device.state.connections.devices).toHaveLength(2);
    expect(device.state.error).toBeNull();
  });
```

This exercises the retry too: both the immediate re-read and the retry after
`DELETE_REREAD_DELAY_MS` fail, so the test takes roughly half a second. That is
the real path and worth the wall-clock.

- [ ] **Step 3: Test that an M4 is not polled for low latency**

```ts
describe('MomentumDevice polling', () => {
  it('does not ask an M4 for a setting it never enables', async () => {
    // m4.json gates low latency behind firmware 99.99.99 — the never sentinel.
    const harness = gaiaHarness(new Map([[0x1206, ascii('M4AEBT Black')]]));
    const device = new MomentumDevice(harness.open);
    await device.adoptPort(port);

    expect(harness.commands()).not.toContain(0x0818);
    expect(harness.commands()).toContain(0x1607);   // touch controls, which it has
  });

  it('asks an unrecognised model for everything', async () => {
    const harness = gaiaHarness(new Map([[0x1206, ascii('SOME-NEW-MODEL')]]));
    const device = new MomentumDevice(harness.open);
    await device.adoptPort(port);

    expect(harness.commands()).toContain(0x0818);
  });
});
```

- [ ] **Step 4: Test the intentional-drop window**

```ts
describe('MomentumDevice self-disconnect', () => {
  it('reports a deliberate self-disconnect as a clean end of session', async () => {
    const replies = withPairedDevices();
    replies.set(0x1403, []);                     // disconnect accepted
    const harness = gaiaHarness(replies);
    const device = new MomentumDevice(harness.open);
    await device.adoptPort(port);

    await device.setDeviceConnected(0, false);   // index 0 is us
    harness.transport().drop(new Error('connection lost'));

    expect(device.state.status).toBe('disconnected');
    expect(device.state.error).toBeNull();
  });

  it('reports an unrelated drop as an error', async () => {
    const harness = gaiaHarness(withPairedDevices());
    const device = new MomentumDevice(harness.open);
    await device.adoptPort(port);

    harness.transport().drop(new Error('headphones powered off'));

    expect(device.state.status).toBe('disconnected');
    expect(device.state.error).toBe('headphones powered off');
  });
});
```

- [ ] **Step 5: Test that the grace window expires**

This is the other bug review caught — the flag used to latch forever, so a later genuine loss was reported as clean. Fake only `Date`, leaving `setTimeout` real so the client's own timeouts still behave:

```ts
import { afterEach, vi } from 'vitest';

afterEach(() => {
  vi.useRealTimers();
});

  it('stops treating drops as intentional once the window passes', async () => {
    const replies = withPairedDevices();
    replies.set(0x1403, []);
    const harness = gaiaHarness(replies);
    const device = new MomentumDevice(harness.open);
    await device.adoptPort(port);

    await device.setDeviceConnected(0, false);

    // Well past INTENTIONAL_DROP_GRACE_MS. A close this late is someone
    // walking out of range, not the echo of the click.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 60_000);

    harness.transport().drop(new Error('out of range'));

    expect(device.state.error).toBe('out of range');
  });
```

- [ ] **Step 6: Verify**

Run: `npm test && npm run lint && npm run build`
Expected: all PASS, count risen by the number of tests added. If any test fails because the *code* is wrong rather than the test, **stop and report it** — this phase changes no behaviour.

- [ ] **Step 7: Commit**

---

### Task 4: Prove the Sony seam

`SonyDevice` gained the same constructor in Task 1 but has no test exercising it. A full MDR responder is a larger job than this phase needs; this task proves the injection works and the drop path reports correctly.

**Files:**
- Create: `src/device/sonyDevice.test.ts`

- [ ] **Step 1: Write the test**

MDR framing differs from GAIA, so do not reuse `gaiaHarness`. Use `FakeTransport` directly with an opener that answers nothing:

```ts
import { describe, expect, it } from 'vitest';

import { SonyDevice } from './sony';
import { FakeTransport } from './fakeTransport';
import type { TransportOpener } from './transport';

const port = {} as SerialPort;

describe('SonyDevice transport seam', () => {
  it('opens through the injected opener and reports an unexpected drop', async () => {
    let transport: FakeTransport | null = null;
    let openedWith: SerialPort | null = null;
    const open: TransportOpener = async (p, handlers) => {
      openedWith = p;
      transport = new FakeTransport(handlers);
      return transport;
    };

    const device = new SonyDevice(open);
    // The handshake gets no reply, so this settles once the link drops rather
    // than on a response — which is the path being tested.
    const connecting = device.adoptPort(port);
    transport!.drop(new Error('link lost'));
    await connecting;

    expect(openedWith).toBe(port);
    expect(device.state.status).toBe('disconnected');
  });
});
```

**Note for the implementer:** `adoptPort` may resolve before `transport` is assigned, or the handshake may reject rather than hang. Adjust the ordering to whatever the code actually does — the requirement is that **the injected opener receives the port** and **a drop leaves the device disconnected**. If the handshake's timeout makes this test slow, script the minimum MDR reply needed instead and say so in the report.

- [ ] **Step 2: Verify**

Run: `npm test && npm run lint && npm run build`
Expected: all PASS.

- [ ] **Step 3: Commit**

---

## Verification

```bash
npm test && npm run lint && npm run build
```

Expected at the end: 430 original tests still passing, plus roughly eight new ones. No behaviour change anywhere — if the app behaves differently, something in this phase overstepped.

## Known gaps left open deliberately

- No MDR responder harness, so Sony's orchestration stays largely uncovered. Worth building when phase 2 extracts the session.
- `src/device/fakeTransport.ts` ships in `src/`. Nothing in the app imports it so it is tree-shaken out, but if a future build step disagrees, move it under a test-only path.
