# Driver Registry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a driver a data-table entry, so adding a manufacturer is one descriptor and no edits to existing drivers — and close the session defects phase 2 recorded.

**Architecture:** `DRIVERS` is a declarative table, matching how this codebase already expresses variation (`PROFILES`, `TOGGLES`, `KNOWN_SERVICES`, `EQ_PRESETS`). Abstract Factory in effect, without inheritance. `Brand` and the `ActiveDevice` discriminated union die; lookup goes by service UUID to a driver.

**Tech Stack:** TypeScript, React 19, Vitest 3, Web Serial.

**Spec:** `docs/superpowers/specs/2026-08-11-driver-architecture-design.md` — §3.2 and §5 step 3, plus the session defects phase 2 deferred here.

## Global Constraints

- Work on branch `worktree-driver-registry` in this worktree. **Never push, never merge, never switch to or touch `main`.** Never run `git config --global`.
- Commit each task. Messages explain *why*, ending with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- `npm test`, `npm run lint`, `npm run build`. Baseline **470 tests / 28 files**.
- **The 470 existing tests are the contract.** A failure means behaviour changed — fix the change, not the test. Task 1 is the only intended behaviour change and it adds tests.
- **Composed, never inherited.** No base classes.
- Comments explain *why*, in the surrounding file's voice.

## On this plan's code samples

Across phases 1 and 2, several plan-supplied tests were wrong because they were written without being run — each caught by an implementer or reviewer reading the real source. **This plan specifies behaviour and signatures, not finished test bodies.** Read the real code; where this plan contradicts it, the source wins and the contradiction goes in your report.

---

### Task 1: Close the three interlocking session defects

Phase 2 recorded these as one item because fixing any alone leaves the others reachable. All three predate phase 2 except where noted.

**Files:** `src/device/session.ts`, `src/device/session.test.ts`, `src/device/device.ts`, `src/device/sony.ts`, `src/ui/sections/Debug.tsx` (only if its `onFrame` usage needs it)

**The three:**

1. **`connectTo` never disposes a live session.** Called over an established connection it overwrites `#transport`, leaking the old one — which keeps reading and feeding bytes into the new client's decoder. `manager.connect()` reaches this: it calls `adoptPort` with no prior `disconnect()`.
2. **`onData` is gated on `this.#client` truthiness, not the captured generation** (`session.ts:123-125`) — a live field read, so a leaked transport's bytes reach whichever client is current.
3. **`onFrame` neither wires to an already-live client nor returns a real unwire** (`session.ts:99-102`). It only mutates a set consulted at wire time. Consequences today: **the debug console is frame-blind if opened after connecting** (`Debug.tsx` registers in a `useEffect`), and its cleanup removes the listener from the set while the live client keeps calling it.

**Required end state:**

- Fixing (1) makes phase 2's swallowed-drop case unreachable — the case named in `#handleDrop`'s comment, where a genuine drop of a still-live transport is suppressed because a newer connect is mid-open and the dead client never gets aborted. **Update or remove that comment to match reality**; leaving it describing an impossible case is its own defect.
- `onData` gated on the captured generation, mirroring `onClose`.
- `onFrame` wires to a live client immediately when one exists, and its returned disposer genuinely detaches.

**Design note for (3), from phase 2's review:** replace the frame-listener set with **attach functions** — `attach(fn: (client: TClient) => () => void)` — stored, called at wire time *and* immediately if a client is live, keeping the returned unwire thunks. This also removes the need for `SessionHooks`' `TFrame` parameter, which exists only to type a set the session never reads. `SessionHooks<TClient>` again.

- [ ] **Step 1: Write the failing tests first**

One per defect, each red before its fix:
- a second `connectTo` over a live session closes the first transport, and bytes arriving on it afterwards reach nothing;
- a frame listener registered *while connected* receives frames from the live client;
- its disposer stops delivery from that live client.

Each must fail for the stated reason, not merely fail. Record the output.

- [ ] **Step 2: Implement**

Then make them pass without breaking the 470.

- [ ] **Step 3: Verify and commit**

`npm test && npm run lint && npm run build`. Report whether `Debug.tsx` needed changes, and what happened to `#handleDrop`'s comment.

---

### Task 2: The driver descriptor and registry

**Files:** create `src/device/driver.ts`, `src/device/driver.test.ts`; modify `src/device/transport.ts`

**Produces:**

```ts
interface DeviceDriver<TDevice, TState> {
  id: string                        // 'sennheiser-gaia' | 'sony-mdr'
  label: string
  services: readonly string[]       // RFCOMM UUIDs identifying this driver
  profiles: readonly DeviceProfile[]
  create(deps: DriverDeps): TDevice
  sections(state: TState): readonly Section[]
  components: Record<string, SectionComponent<TDevice, TState>>
}
export const DRIVERS: readonly DeviceDriver<never, never>[]
export function driverForService(uuid: string): DeviceDriver<never, never> | null
```

The exact generic parameters are yours to settle — the constraint is that `DRIVERS` be a heterogeneous list that consumers can iterate without knowing each entry's state type, while a consumer holding one driver keeps its types. If that forces an unpleasant cast, prefer an explicit, commented one in `driver.ts` over spreading `any` through consumers, and say so in your report.

**`guard` is deliberately NOT in this task.** The spec makes it part of the contract, but `unsafe.ts` is GAIA-shaped and Sony has none; introducing it properly needs its own task. Leave a `TODO` naming the spec section, so the omission is visible rather than forgotten.

- [ ] **Step 1: Write `driver.test.ts` first** — a UUID resolves to the right driver; an unknown UUID yields null; every driver's `services` appear in `KNOWN_SERVICES`; ids are unique.
- [ ] **Step 2: Build `driver.ts`** with both descriptors, importing existing sections and profiles rather than moving files (moves are phase 5).
- [ ] **Step 3:** Make `transport.ts`'s `KNOWN_SERVICES` derive from `DRIVERS`, or assert they agree — do not leave two hand-maintained lists.
- [ ] **Step 4: Verify and commit.**

---

### Task 3: Retire `Brand` and the `ActiveDevice` union

**Files:** `src/device/manager.ts`, `src/device/brand.ts`, `src/ui/sections/registry.ts`, `src/ui/useDevice.ts`, and their consumers

`DeviceManager` currently holds `readonly sennheiser` / `readonly sony` and exposes an `ActiveDevice` discriminated union every consumer switches on. `registry.ts` keeps parallel `*_SECTIONS`/`*_COMPONENTS` constants and special-cases Sony inline in `sectionsForDevice`.

**Required end state:** the manager holds devices keyed by driver id, created via `driver.create(...)`; `ActiveDevice` becomes `{ driver, device, state }`; section and component lookup goes through the driver; `Brand` is deleted or reduced to a driver id alias.

**Do not lose these behaviours** — each has a comment explaining why, and each is load-bearing:

- brand stickiness after a disconnect ("a device you own is still your device when it is switched off");
- `knowsDevice` versus `resolveBrand` — one answers "do we know of any device", the other always returns something and is therefore a *guess*; consumers must keep branching on the former;
- `select()` disconnecting **both** devices, because a device caught mid-connect still holds an open port and Chrome refuses to reopen it;
- preferring a remembered service when several are granted.

`manager.test.ts` covers some of this. **Read it before you start** — it is the specification for the parts that must not move.

> **Correction, added during the final whole-branch review (2026-08-11):** that claim is false. `manager.test.ts`, as it stood when this task was executed, covers none of `DeviceManager` — only the free functions `knowsDevice`/`resolveBrand`, which this migration never touched and which would have kept passing unedited regardless of what happened to the class. All 12 mutants against `DeviceManager` survived. The review added exactly one `DeviceManager`-level test (an invariant over `DRIVERS`, in `manager.test.ts`) to close the specific gap it found — a driver missing from `#devices`/the constructor's subscribe wiring throws or silently drops re-renders at runtime while `tsc` and every test still pass. A full `DeviceManager` suite remains deferred. **Before trusting a similar sentence in a future plan, open the test file and confirm it actually exercises the class named, not just its free-function neighbours.**

- [ ] **Step 1:** Read `manager.ts`, `manager.test.ts` and `registry.ts` in full; list every behaviour the tests pin.
- [ ] **Step 2:** Migrate the manager, keeping `manager.test.ts` green **unedited**.
- [ ] **Step 3:** Migrate `registry.ts` so `sectionsFor`/`components` resolve through the driver, deleting the Sony special-case.
- [ ] **Step 4:** Delete `Brand` (or alias it), updating consumers.
- [ ] **Step 5: Verify and commit.** Report what a third driver would now require, file by file — that claim is this phase's whole point and should be checkable.

---

## Verification

```bash
npm test && npm run lint && npm run build
```

All 470 pre-existing tests green, plus new ones. Behaviour identical except Task 1's fixes.

## Known gaps left open deliberately

- `guard` is not yet in the driver contract (Task 2 note).
- Shared UI panels are phase 4; file moves are phase 5.
- `adoptPort`/`connect`/`autoConnect` remain duplicated — they need a shared state type, which only arrives once the manager is driver-keyed. Reassess at the end of Task 3.
