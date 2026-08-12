# Thin Session Extraction — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the connection plumbing both device classes duplicate into one `DeviceSession`, and fix the connect-window race that lives in that duplicated code.

**Architecture:** `MomentumDevice` and `SonyDevice` duplicate `autoConnect`, `adoptPort`, `connect`, `#connectTo`'s scaffolding, `#patch`'s notify loop, `subscribe`, `onFrame`, `#handleDrop` and `disconnect` almost line for line. A `DeviceSession` **composed as a field** takes over the transport, the client, the frame-listener set and the connect scaffolding. Each device keeps its own state object, its own protocol client type, and its own post-connect sequence.

**Tech Stack:** TypeScript, Vitest 3, Web Serial.

**Spec:** `docs/superpowers/specs/2026-08-11-driver-architecture-design.md` — this is **phase 2** (§5 step 2), plus the bug §3.3's structure exposes.

## Global Constraints

- Work on branch `worktree-thin-session` in this worktree. **Never push, never merge, never switch to or touch `main`.** Never run `git config --global`.
- Commit each task. Messages explain *why*, not *what*, and end with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Full suite `npm test`; lint `npm run lint`; typecheck `npm run build`. Baseline **440 tests across 25 files**.
- **The 440 existing tests are the contract.** They were written in phase 1 precisely so this refactor has a net. If one fails, the refactor changed behaviour — fix the refactor, not the test. The only permitted behaviour change is the race fix in Task 1, which adds tests.
- The session is **composed, not inherited**. No base class, no `extends`. The spec is explicit: the lifecycle is shared, capabilities are not.
- Comments explain *why*, matching the density and voice of the surrounding file.

## A note on this plan's code samples

Four tests in phase 1's plan were wrong because I wrote code I had not run — each caught by an implementer or reviewer reading the real source. So this plan **specifies behaviour and signatures, and deliberately does not hand you finished test bodies.** Read the real code, then write the test that fits. Where I do give code, treat it as a sketch to verify, not to transcribe.

---

### Task 1: `DeviceSession`, `MomentumDevice` migrated, race fixed

**Files:**
- Create: `src/device/session.ts`
- Create: `src/device/session.test.ts`
- Modify: `src/device/device.ts`
- Modify: `src/device/device.test.ts` (add race coverage)

**Interfaces produced (Task 2 consumes these):**

```ts
export interface SessionHooks<TClient> {
  /** Builds the protocol client once the transport is open. */
  createClient(transport: Transport): TClient;
  /** Feeds inbound bytes to the client. */
  handleData(client: TClient, chunk: Uint8Array): void;
  /** Wires notification and frame listeners onto a freshly built client. */
  wire(client: TClient, frameListeners: Iterable<FrameListener>): void;
  /** Status transitions, so each device patches its own state shape. */
  onStatus(status: ConnectionStatus, error: string | null): void;
  /** An unexpected close. The device resets its own state. */
  onDrop(reason?: Error): void;
}

export class DeviceSession<TClient> {
  constructor(openTransport: TransportOpener, hooks: SessionHooks<TClient>);
  get client(): TClient | null;
  onFrame(listener: FrameListener): () => void;
  /** Opens, builds, wires, then runs `after` — the driver's own sequence. */
  connectTo(port: SerialPort, after: (client: TClient) => Promise<void>): Promise<void>;
  /** Finds an adoptable granted port for this brand, or null. */
  static grantedPortFor(brand: Brand): Promise<SerialPort | null>;
  disconnect(): Promise<void>;
}
```

- [ ] **Step 1: Pin the race before changing anything**

The bug: in `#connectTo`, `await this.#openTransport(...)` yields before `#client` is assigned and before the status is patched to `connected`. A drop landing in that window runs `#handleDrop` while `#client` is null, and then `#connectTo` resumes and patches `connected` — the app claims a live link over a dead transport.

It is **deterministic, not merely racy**: `SerialTransport.#start()` queues the read continuation before `open`'s promise resolves, so an already-errored `readable` means `#handleDrop` always wins.

Write a test in `src/device/device.test.ts` using an opener that calls `handlers.onClose(new Error(...))` **before** resolving the transport. Assert the device ends `disconnected` with the error surfaced — not `connected`.

Run it. **It must fail**, showing `connected`. Record the output; that failure is the evidence the bug is real.

- [ ] **Step 2: Build the session**

Create `src/device/session.ts` implementing the interface above.

Requirements, in order of importance:

1. **A connect generation token.** Increment on every `connectTo` and on `disconnect`. Capture it before the `await`, and after the await, if the token has moved, the connect was superseded — close the transport you just opened and return without patching `connected`. `onDrop` fired during the window must be what the caller observes.
2. Own `#transport`, `#client`, and the frame-listener set. Frame listeners **survive reconnects** — both classes rely on this today for the debug console.
3. `connectTo` runs: `onStatus('connecting', null)` → open → `createClient` → `wire` → store → `onStatus('connected', null)` → `await after(client)`.
4. `disconnect()` aborts the client if the hook exposes one, nulls both fields, and closes the transport.
5. `grantedPortFor(brand)` wraps `findGrantedPort()` and the brand check both classes do.

**What the session must NOT do:** decide what to poll, subscribe to anything, or know about `DeviceState` or `SonyState`. It never touches a device's state object — only calls `onStatus` / `onDrop`.

- [ ] **Step 3: Unit-test the session directly**

`src/device/session.test.ts`. It is generic over `TClient`, so a trivial fake client is enough. Cover at least: a normal connect calls the hooks in order; a drop during the open window does not reach `connected`; frame listeners registered before a connect are wired to the new client; `disconnect` closes the transport and nulls the client; a second `connectTo` supersedes an in-flight first.

For each, ask whether it would fail if the behaviour were removed. The generation-token test especially — that is the one pinning the bug.

- [ ] **Step 4: Migrate `MomentumDevice`**

Replace `#transport`, `#client`, `#frameListeners`, `#openTransport` with a single `#session`. `autoConnect`, `adoptPort`, `connect`, `#connectTo`, `onFrame`, `#handleDrop` and `disconnect` become thin wrappers. The device keeps `#state`, `#patch`, `#replace`, `subscribe`, snapshot/restore, `#subscribe()`, `refresh()` and every capability method.

`#intentionalDropAt` stays on the device — it is Sennheiser-specific (self-disconnect of the paired-device entry), and the session has no business knowing about it.

**Constructor compatibility matters:** `manager.ts` does `new MomentumDevice()`, and `device.test.ts` does `new MomentumDevice(harness.open)`. Both must keep working.

- [ ] **Step 5: Verify**

Run: `npm test && npm run lint && npm run build`

Expected: the Step 1 race test now **passes**, every one of the 440 pre-existing tests still passes, plus the new session tests. If any phase-1 test fails, the refactor changed behaviour — fix the refactor.

- [ ] **Step 6: Commit**

---

### Task 2: Migrate `SonyDevice`

**Files:**
- Modify: `src/device/sony.ts`
- Modify: `src/device/sonyDevice.test.ts`

- [ ] **Step 1: Pin the race on the Sony side first**

Same shape as Task 1 Step 1, in `sonyDevice.test.ts`. Confirm it fails before migrating — `sony.ts` has the identical defect and no fix yet.

- [ ] **Step 2: Migrate**

Same treatment as `MomentumDevice`: one `#session` field, thin wrappers, everything protocol-specific left alone. Sony's post-connect sequence is `await this.refresh()` with no subscribe step — that is exactly the difference the session is designed not to care about.

Sony has no `#intentionalDropAt`; do not add one.

- [ ] **Step 3: Verify**

Run: `npm test && npm run lint && npm run build`

Expected: the Sony race test passes, all pre-existing tests pass.

- [ ] **Step 4: Check the duplication is actually gone**

Report the before/after line counts of `device.ts` and `sony.ts`, and confirm no method body remains duplicated between them. If something still is, say what and why — a shared shape the session cannot absorb is a finding worth recording for phase 3, not something to force.

- [ ] **Step 5: Commit**

---

---

### Task 3: Extract the state listeners and snapshot glue

Spec §5 step 2 scopes this phase as "extract transport lifecycle, **listeners,
snapshot/restore** from both device classes", and §3.3 lists "the listener sets
(state subscribers, frame taps)" and "snapshot capture and restore" among what
the session owns. Tasks 1 and 2 moved only the frame taps. This closes the gap.

**A deliberate deviation from §3.3's literal wording, recorded here rather than
inferred.** §3.3 says *the session* owns these. This task instead adds a
separate `StateStore<TState>` that each device composes alongside its session,
because:

- `DeviceSession` is generic over the protocol *client*. Making it generic over
  state as well would give one class two unrelated jobs — transport lifecycle
  and state notification — which is the opposite of thin.
- `snapshot`/`restore` depend on the state shape and on `Persistable`, not on
  the transport. Filing them with the transport would be filing them by
  accident of history.

The spec's *goal* (this duplication stops living in both device classes) is met;
its wording about which class holds it is not. **Amend §3.3 to match once this
lands.**

**Files:**
- Create: `src/device/stateStore.ts`, `src/device/stateStore.test.ts`
- Modify: `src/device/device.ts`, `src/device/sony.ts`

**What is duplicated today** — read both before designing:

- `#listeners: Set<Listener>`, `subscribe(listener)` returning an unsubscribe,
  and the notify loop inside `#patch` / `#replace`
- `snapshot()`: return null when nothing has been read yet, else capture
- `restore(payload)`: refuse once connected, so a late cache never overwrites
  what the hardware just said

The *policies* in the last two are shared and worth keeping in one place; the
capture/apply functions differ per driver and stay with the driver.

- [ ] **Step 1: Write `stateStore.test.ts` first**

Pin the behaviour before extracting: subscribers are notified on patch and on
replace; `replace` with an identical reference does not notify (`#replace`
returns early today — check it); unsubscribe stops delivery; `restore` is
refused once connected; `snapshot` returns null before anything has been read.

Each must fail if the behaviour were removed. Say how you checked.

- [ ] **Step 2: Build `StateStore<TState>`**

It owns `#state` and `#listeners`, and exposes `state`, `subscribe`, `patch`,
`replace`, plus the snapshot/restore policy parameterised by driver-supplied
capture and apply functions. It knows nothing about transports or clients.

- [ ] **Step 3: Migrate both devices**

`MomentumDevice` and `SonyDevice` each hold one. `#patch`/`#replace` become
one-line delegates — keep those private methods, since every capability method
calls them and churning ~40 call sites is not this task's job.

**`restore` refuses once connected.** That check reads the device's status. Be
careful the store can still see it after the move, and do not weaken the rule.

- [ ] **Step 4: Verify**

`npm test && npm run lint && npm run build`. All 456 pre-existing tests green
**without edits**, plus the new store tests. Report the before/after line counts
for both device classes and whether any of the four duplicated pieces remain.

- [ ] **Step 5: Commit**

---

## Verification

```bash
npm test && npm run lint && npm run build
```

All 440 pre-existing tests still green, plus the session tests and two race tests. Behaviour identical apart from the race fix.

## Known gaps left open deliberately

- No MDR responder harness beyond the minimal handshake from phase 1. Phase 1 recorded what it needs: `DEFAULT_TIMEOUT_MS = 1200` in `src/mdr/client.ts`, and an unanswered handshake burns five sequential timeouts.
- `setDeviceConnected`'s NACK-vs-drop branch (`device.ts`, the `if (this.#client)` check) is still untested.
- The driver registry, shared panels and file moves are phases 3–5.
