# Driver architecture: supporting many manufacturers without side effects

**Date:** 2026-08-11
**Status:** approved, ready for planning

A restructure so a new manufacturer is *one new folder and one registry entry*,
with no edits to existing drivers and no shared file that knows which driver it
is serving.

---

## 1. Background

### 1.1 What adding a manufacturer costs today

Four files must be edited, and they are spread across three trees:

| File | What must change |
|---|---|
| `src/device/brand.ts` | `Brand` is a union of string literals |
| `src/device/manager.ts` | `ActiveDevice` is a discriminated union; `DeviceManager` holds `readonly sennheiser` and `readonly sony` as concrete fields |
| `src/ui/sections/registry.ts` | Parallel `*_SECTIONS` and `*_COMPONENTS` constants, plus a `sectionsForDevice` that special-cases Sony inline |
| `src/device/transport.ts` | `KNOWN_SERVICES` maps service UUID → brand — **already data-driven, and the model to follow** |

A Sennheiser change touches `src/gaia/` (protocol), `src/device/` (orchestration)
and `src/ui/sections/` (UI). There is no boundary that contains one
manufacturer, so nothing stops one from affecting another.

`src/device/` compounds this by mixing generic machinery with driver-specific
code: `persistence.ts`, `transport.ts` and `manager.ts` are shared, while
`device.ts` and `state.ts` are *Sennheiser's* — and `state.ts` does not say so
in its name.

### 1.2 Two leaks worth naming

**The capability model leaks into shared code.** Sony negotiates capabilities
live on connect; Sennheiser reads static profiles. `registry.ts` resolves this
with `if (active.brand !== 'sony') return sections` — a shared file encoding one
driver's mechanism.

**Safety is protocol-specific but lives as though it were universal.**
`src/gaia/unsafe.ts` is GAIA-only, yet "never send destructive commands" applies
to every protocol. Sony has **no guard at all**. This session demonstrated the
cost: sweeping `0x16xx` invoked `MMI_SetDefaultConfig` and reset a user's
touch-control assignments, because a command taking no arguments is
indistinguishable from a getter to a prober.

### 1.3 The test gap that shaped this design

`MomentumDevice` and `SonyDevice` each construct their own `SerialTransport`
inside `#connectTo`. There is no seam to inject a fake, so **no `device.test.ts`
exists for either**. Both real bugs found in this session's final review lived in
exactly that untested orchestration:

- `refreshConnections` returned success on a partial re-read and patched an
  empty list over a good one — skipping the retry *and* destroying the data the
  retry existed to protect.
- `#intentionalDrop` latched forever on the success path, so a later genuine
  connection loss would have been reported as a clean session end.

Both were caught by a careful reader. That is not a strategy.

---

## 2. Goals

1. Adding a manufacturer means creating one folder and registering one
   descriptor. No edits to existing drivers.
2. No shared file branches on which driver it is serving.
3. Every driver is forced to answer the safety question.
4. Device orchestration becomes testable.
5. Genuine UI overlap is shared, without coupling drivers to each other.

**Non-goals.** Adding any new manufacturer as part of this work; changing any
wire protocol; changing what the app can control today. This is a restructure —
behaviour is expected to be identical when it lands.

---

## 3. Design

### 3.1 Three tiers

```
src/
  core/                 transport · session · persistence · driver registry
                        · feature vocabulary · profile shape
  drivers/
    sennheiser/         frame · commands · guard · device · state · profiles
                        · sections/
    sony/               codec · commands · guard · device · state · profiles
                        · sections/
  ui/
    components/         primitives — button, slider, card, switch
    panels/             composite, data-driven — Equalizer, DeviceInfo, …
    layout/             shell, sidebar, theme
```

Files that change together live together. A driver folder is the unit of
change; `core/` and `ui/` are the parts that must never grow driver knowledge.

### 3.2 The driver contract

A driver is a **data table entry**, not a class hierarchy — matching how this
codebase already expresses variation (`PROFILES`, `TOGGLES`, `KNOWN_SERVICES`,
`EQ_PRESETS` are all declarative tables). This is Abstract Factory in effect,
without inheritance.

```ts
interface DeviceDriver<TAddress, TDevice, TState> {
  id: string                       // 'sennheiser-gaia', 'sony-mdr'
  label: string
  /** RFCOMM service UUIDs that identify this driver's devices. */
  services: readonly string[]
  profiles: readonly DeviceProfile[]
  guard: DriverGuard<TAddress>
  create(deps: DriverDeps): TDevice
  /** The driver decides how capability works — statically or negotiated. */
  sections(state: TState): readonly Section[]
  components: Record<string, SectionComponent<TDevice, TState>>
}

interface DriverDeps {
  /** Injected so tests can supply a fake. */
  openTransport(port: SerialPort, events: TransportEvents): Promise<Transport>
}

interface DriverGuard<TAddress> {
  blockedReason(address: TAddress): string | undefined
  sweepBlockedReason(address: TAddress): string | undefined
}

export const DRIVERS = [sennheiserGaia, sonyMdr] as const
```

**Inheritance is deliberately excluded.** The lifecycle is shared; capabilities
are not. `registry.ts` already argues this: *"Deliberately not normalised: the
Momentum 4's noise control and the WF-C500's capability set have little in
common."* A base class would assert a commonality that does not exist.

**`guard` is mandatory and generic over the driver's own address type** —
`{ vendor, command }` for GAIA, `{ opcode }` for MDR. Making it part of the
contract forces every new driver to answer the question rather than inherit an
empty default. Its two-tier shape (never-sendable versus deliberate-only) is
carried over unchanged, because it is already proven and tested.

**`sections(state)` lets each driver decide how capability works**, removing the
Sony special-case from shared code.

### 3.3 The session is thin

A driver's device **composes** a `DeviceSession` and a `StateStore`, rather
than extending either. `create()` returns the driver's device; both are
fields inside it.

`DeviceSession` owns only what is genuinely identical across protocols:

- transport lifecycle (open, close, drop detection)
- the protocol client, and the connect-generation token that guards it against
  a superseded or dropped connect
- the frame-tap listener set, for the debug console
- connect scaffolding — open, build the client, wire it, then hand back to the
  driver's own post-connect sequence
- resolving which granted port to use, and whether one can be adopted silently

State — the subscriber set, the notify loop, and the snapshot/restore
policy — lives in a sibling class, `StateStore<TState>`, not in the session.
That split is deliberate, not an oversight this section failed to update:
`DeviceSession` is generic over the protocol *client*, which varies by wire
format (`GaiaClient` vs. `MdrClient`) and never touches `DeviceState` or
`SonyState`. Giving it the state subscriber set and the notify loop as well
would hand one class two unrelated jobs — transport lifecycle and state
observation — which is exactly the two-jobs problem a thin session is meant to
avoid. `snapshot`/`restore` depend on the state shape and on `Persistable`,
not on the transport, so they belong next to the state object they operate on,
which is `StateStore`, not `DeviceSession`. Each device composes one of each,
as sibling fields — see `src/device/stateStore.ts` for the store's own
reasoning.

It does **not** own the connect sequence. Note the split inside `autoConnect`:
*finding* a granted port this driver can drive is shared and belongs to the
session; *what to say once it is open* is the driver's, and the session calls
back into the device for it. The device keeps its own `connect`, `refresh` and
subscribe steps. Sony already needs a `#handshake`
before anything else and Sennheiser does not, so with two data points a shared
sequence would be a guess. A device requiring authentication, or one that pushes
everything with nothing to poll, would have to fight it.

Extracting the sequence stays available once a third driver shows what is
actually common. Extracting it now would build a framework before we know its
shape.

### 3.4 Shared panels, driver-local pages

Real overlap exists: both manufacturers have an equaliser with bands and
presets, a device-info card, toggle rows, auto power off, and battery. Those
become **panels** in `ui/panels/` — composite components taking values and
callbacks.

What stays driver-local is the **page**: which panels appear, in what order,
with what wording.

**The rule that keeps this honest: a shared panel never knows which driver it is
in.** It takes data and callbacks — never a driver, a brand, or a driver's state
object. The moment a panel needs `if (driver === 'sony')` it is not shared; it is
two panels wearing a trenchcoat, and it has just made every driver able to break
every other. That is precisely the property this restructure exists to prevent,
so it is a hard rule, not a preference.

### 3.5 Registry and lookup

`transport.ts` already maps service UUID → brand. It becomes UUID → driver,
which is the same mechanism with a richer target. Port selection, brand
stickiness and the picker filter all derive from `DRIVERS` rather than from
hardcoded constants.

### 3.6 What is deleted

`Brand`; the `ActiveDevice` discriminated union; `SENNHEISER_SECTIONS` /
`SONY_SECTIONS` / `SENNHEISER_COMPONENTS` / `SONY_COMPONENTS`; `DeviceManager`'s
named `readonly sennheiser` and `readonly sony` fields; the `sectionsForDevice`
Sony special-case.

`ActiveDevice` becomes `{ driver, device, state }`, generic rather than a union
that every consumer switches on.

---

## 4. Testing strategy

**The seam comes first, and it comes with tests.** The 430 existing tests cover
protocol codecs and pure state reduction well, and cover `manager.ts` and device
orchestration barely at all — which is exactly the code this restructure
reshapes most. Moving forty files over untested orchestration would be
rearranging the least-covered code in the app with no net.

So phase one is `openTransport` injection plus a `FakeTransport` and the first
`device.test.ts`, covering behaviour that currently has none:

- `removePairedDevice` sends nothing for a connected entry
- a failed re-read after a successful delete preserves the previous list
- `#refreshAll` does not poll `getLowLatency` for an M4
- the intentional-drop window reports a deliberate self-disconnect as clean and
  a later unrelated drop as an error

Only then does anything move. Each subsequent phase ends green.

---

## 5. Sequencing

1. **Transport seam** — inject `openTransport`; add `FakeTransport` and
   `device.test.ts`. No structural change.
2. **Thin session** — extract transport lifecycle and frame taps into
   `DeviceSession`; extract state subscribers and snapshot/restore into a
   sibling `StateStore`. Both replace duplicated plumbing in the two device
   classes.
3. **Driver contract and registry** — descriptors, `DRIVERS`, UUID lookup;
   delete `Brand` and the `ActiveDevice` union.
4. **Shared panels** — extract Equalizer, DeviceInfo, Toggles, AutoPowerOff,
   Battery into `ui/panels/`.
5. **File moves** — relocate into `core/`, `drivers/*`, `ui/*`.

Each phase is independently green and independently reviewable. Nothing is
big-bang.

---

## 6. Risks

| Risk | Handling |
|---|---|
| Large diff over lightly-tested orchestration | Phase 1 adds the tests before anything moves |
| Speculative generality — only two drivers exist | Multi-manufacturer support is a stated product goal, not an inferred one. The transport seam pays for itself regardless |
| A shared panel accumulates driver branches | Hard rule in §3.4: panels take data and callbacks only. A panel needing to know its driver is a design error, not a special case |
| Thin session leaves duplication behind | Accepted deliberately. The duplicated part is the connect *sequence*, which already differs between the two drivers |
| Import churn breaks the build silently | `tsc -b` is the gate; every phase must pass `npm test && npm run lint && npm run build` |

---

## 7. Out of scope

Adding any new manufacturer; changing any wire protocol; changing what the app
can control; the Soundcore investigation; naming GAIA features 16 and 20.
