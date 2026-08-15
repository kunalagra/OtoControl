# File Moves — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relocate the tree into `core/`, `drivers/sennheiser/`, `drivers/sony/`, and a driver-agnostic `ui/`, so that everything one manufacturer owns sits in one directory and nothing outside it needs to know that manufacturer exists.

**Architecture:** Mostly mechanical `git mv` plus import rewrites, gated by `tsc -b`. Two genuine design changes ride along because the moves force them: `device/driver.ts` currently imports from `@/ui/sections/registry` — a `device/` → `ui/` inversion that disappears once each driver owns its own sections — and `Brand` still keys `profileFor`, which spec §3.6 said phase 3 would delete. **Task 5 established that §3.6 is wrong about `Brand`** — it is a live manufacturer key, distinct from the driver id, and it stays. See Task 5's correction block.

**Tech Stack:** TypeScript project references (`tsc -b`), Vite `@/*` → `./src/*` alias (`vite.config.ts:10`, `tsconfig.app.json:25`), Vitest, oxlint.

**Spec:** `docs/superpowers/specs/2026-08-11-driver-architecture-design.md` — §5 step 5, and §3.6 for what should no longer exist.

## Global Constraints

- Work on branch `phase-5-file-moves`. **Never push, never merge, never switch to or touch `main`.** Never run `git config --global` — the global identity belongs to the user's work account and must stay untouched. Commit freely on the branch; end each task with a commit so its diff is reviewable.
- Run the full suite with `npm test`. Lint with `npm run lint`. Typecheck via `npm run build` (`tsc -b`).
- **Use `git mv`, never delete-and-recreate.** Rename detection is what keeps this reviewable; a move that shows up as a delete plus an add buries the diff.
- **No behaviour changes.** Every task is imports and paths only, except Tasks 4 and 5 which are explicitly scoped design changes. The existing suite is the contract.
- Every task ends green on `npm test && npm run lint && npm run build`.
- `SNAPSHOT_VERSION` stays at **1**.
- **Depends on:** `docs/superpowers/plans/2026-08-12-shared-panels.md` (phase 4) being merged. `src/ui/panels/` must exist and be driver-agnostic before the `ui/` tree is declared shared.

## Target Structure

```
src/core/                     driver-agnostic machinery
  transport.ts  session.ts  stateStore.ts  manager.ts
  errors.ts  persistence.ts  knownDevices.ts  driver.ts
  fakeTransport.test-helper.ts
src/drivers/sennheiser/
  gaia/          ← all of src/gaia/
  client.ts  device.ts  state.ts  profiles.ts
  sections/      ← Noise Sound System Devices Debug DebugEntry
  driver.ts      ← SENNHEISER_DRIVER descriptor + its components map
src/drivers/sony/
  mdr/           ← all of src/mdr/
  sony.ts  profiles.ts
  sections/      ← SonyNoise SonySound SonySystem PowerOffButton
  driver.ts      ← SONY_DRIVER descriptor + its components map
src/ui/                       driver-agnostic only
  panels/  controls/  layout/  device/
  sections/      ← About NoDevice SystemTail types.ts registry.ts (icons only)
```

Tests move with the file they cover; `foo.test.ts` always sits beside `foo.ts`.

## Import Rewrite Method

After each `git mv`, do **not** hand-edit imports file by file. Let the compiler enumerate the breakage:

```bash
npm run build 2>&1 | grep -E "error TS2307|Cannot find module" | sed -E "s/.*Cannot find module '([^']+)'.*/\1/" | sort -u
```

That prints the exact unresolved specifiers. Fix them, re-run, repeat until the list is empty. Prefer the `@/` alias for cross-package imports and relative paths within a package — that is the convention already in the tree (`@/device/state` from `ui/`, `../device/transport` from `mdr/`).

**The compiler is the enumerator; the greps are not.** Task 2 proved this the hard way — a task whose own grep checks came back clean still had three files failing with `Cannot find module './device'`. Alias greps like `grep -rl "from '@/device/…'"` are blind to four whole classes of breakage:

1. **Sibling relative imports in the directory you moved *out of*.** `driver.ts`, `manager.ts` and `driver.test.ts` import `'./device'` and `'./state'`. They stay put; the target leaves. Task 3 has the identical trap — `manager.ts:12,14`, `driver.ts:26,27` and `driver.test.ts:5` all import `'./sony'`.
2. **Relative imports inside the files you moved**, which now resolve from a new depth. Task 2's brief listed two and there were six: `./types`, `./SystemTail`, `../debug/ProbePanel`, `../noiseLevel` were all missing.
3. **Importers of the moved files**, e.g. `registry.ts` and `sections.render.test.tsx` reaching for `'./Noise'`.
4. **Imports the moved files make into the tier you are moving away from** — the reason `core/fakeTransport.test-helper.ts` had an unnoticed edge into the GAIA codec.

So: **run `npm run build` after every `git mv` block, before writing any rewrite.** Treat its output as the work list, and treat any grep in a task's steps as a *post-hoc check that you finished*, never as the discovery mechanism.

Two further rules, both learned from real failures in this phase:

- **A no-op pipeline exits 0.** `grep -rl … | xargs sed …` finds nothing, rewrites nothing, and reports success. Confirm each rewrite with `git diff --stat`.
- **Never blanket-rewrite a relative prefix repo-wide.** A `s|../gaia/|./gaia/|g` applied across `src/` retargeted a file in `core/` at a path that does not exist. Scope every `sed` to the specific files you intend to change.

---

### Task 0: A net for the moves — section-level render tests

**Added after phase 4's whole-branch review, which established there are no
section-level tests anywhere in the repo.** Every className, wrapper-structure
and `data-size` mutant it tried survived. That was tolerable while each driver's
markup was its own; it is not tolerable across six tasks of relocation.

The specific danger this closes: **`tsc -b` catches a broken import, not a wrong
one.** A move that points `SonySound` at Sennheiser's section, or drops a
wrapper during a rewrite, compiles cleanly and passes all 533 tests. Nothing in
the suite renders an assembled section.

This is the same reasoning that made phase 1 correct — build the seam and its
tests before touching the least-covered code — and phase 4's reviewer named it
the natural phase-5 opener.

**Files:**
- Create: `src/ui/sections/sections.render.test.tsx` (or a name that fits; it
  moves with the sections in a later task, so pick one that survives the move)

**Approach.** Phase 4's reviewer built this harness and measured it: ~60 lines,
~550ms, **no new dependencies**. It uses `renderToStaticMarkup` from
`react-dom/server`, the exported `initialState` / `initialSonyState`, and a
Proxy device stub. Read that description, then build your own — do not assume
its exact shape.

- [ ] **Step 1: Build the harness**

Render each of `Sound`, `System`, `sony/SonySound`, `sony/SonySystem` to static
markup under a handful of fixtures per section. Cover at minimum: connected and
disconnected; EQ present and absent; a power-off value on-preset, off-preset and
null; and for Sony, a capability subset that hides sections.

The device argument only needs to satisfy the props — a Proxy returning no-op
functions is enough, since these tests assert markup, not behaviour.

- [ ] **Step 2: Snapshot them**

Commit the markup as the baseline. Vitest's built-in snapshots are fine; no new
dependency is needed.

**These snapshots are the contract for every task that follows.** A move that
changes rendered output will fail them, which is the entire point. If a later
task legitimately changes output, updating a snapshot is a decision to state in
that task's report — never a reflex.

- [ ] **Step 3: Prove the net catches what it is for**

Temporarily swap one section's import for the other driver's equivalent, confirm
the snapshot fails, and restore. Include the output. A snapshot suite that would
not catch that is decoration.

- [ ] **Step 4: Verify and commit**

`npm test && npm run lint && npm run build`. Report the added test count and the
suite's runtime delta.

---

### Task 1: Create `src/core/`

Moves the machinery that has no manufacturer in it. `manager.ts` and `driver.ts` are deliberately **not** in this task — both still reference driver specifics and are handled in Tasks 4 and 6.

**Files:**
- Move: `src/device/{transport,session,stateStore,errors,persistence}.ts` and their `.test.ts` siblings → `src/core/`
- Move: `src/device/knownDevices.ts` → `src/core/knownDevices.ts`
- Move: `src/device/fakeTransport.test-helper.ts` → `src/core/fakeTransport.test-helper.ts`

**Interfaces:**
- Produces: `@/core/transport`, `@/core/session`, `@/core/stateStore`, `@/core/errors`, `@/core/persistence`, `@/core/knownDevices`, `@/core/fakeTransport.test-helper`. Every exported name is unchanged — only specifiers move.

- [ ] **Step 1: Move the files**

```bash
mkdir -p src/core
git mv src/device/transport.ts src/device/transport.test.ts src/core/
git mv src/device/session.ts src/device/session.test.ts src/core/
git mv src/device/stateStore.ts src/device/stateStore.test.ts src/core/
git mv src/device/errors.ts src/device/errors.test.ts src/core/
git mv src/device/persistence.ts src/device/persistence.test.ts src/core/
git mv src/device/knownDevices.ts src/core/
git mv src/device/fakeTransport.test-helper.ts src/core/
```

- [ ] **Step 2: Confirm the compiler sees the breakage**

Run: `npm run build 2>&1 | grep -c "Cannot find module"`
Expected: a non-zero count. If it is zero, the moves did not happen — check `git status`.

- [ ] **Step 3: Rewrite the imports**

List the broken specifiers with the command from *Import Rewrite Method*, then rewrite each. The bulk are mechanical:

```bash
grep -rlE "from '(@/device|\.\./device|\./)(transport|session|stateStore|errors|persistence|knownDevices|fakeTransport\.test-helper)'" src/ \
  | xargs sed -i '' -E "s|from '@/device/(transport\|session\|stateStore\|errors\|persistence\|knownDevices\|fakeTransport\.test-helper)'|from '@/core/\1'|g"
```

Then fix the remaining relative-path cases by hand — `src/mdr/client.ts:13` and `src/mdr/client.test.ts:3` import `'../device/transport'` and become `'@/core/transport'`; files now inside `src/core/` that imported each other relatively (`'./transport'`) need no change at all.

On macOS `sed -i ''` takes an empty backup suffix; on Linux use `sed -i`. Verify with `git diff --stat` that only import lines changed.

- [ ] **Step 4: Verify**

Run: `npm test && npm run lint && npm run build`
Expected: all green, same test count as before the task.

- [ ] **Step 5: Confirm the moves are recorded as renames**

Run: `git status --short`
Expected: `R` entries, not `D`/`A` pairs. If you see delete+add, the file content changed too much or `git mv` was not used — investigate before continuing.

- [ ] **Step 6: Report**

Commit the task on the branch, then report the file list moved and the test count before/after.

---

### Task 2: Create `src/drivers/sennheiser/`

Everything GAIA. `client.ts` is the GAIA client, `device.ts` is `MomentumDevice`, `state.ts` holds `togglesFor` and the Sennheiser `DeviceState`.

**Files:**
- Create: `src/core/connection.ts` (extracted `ConnectionStatus` — see Step 0)
- Move: `src/gaia/*` → `src/drivers/sennheiser/gaia/`
- Move: `src/device/{client,device,state}.ts` + tests → `src/drivers/sennheiser/`
- Move: `src/ui/sections/{Noise,Sound,System,Devices,Debug,DebugEntry}.tsx` → `src/drivers/sennheiser/sections/`

**Interfaces:**
- Consumes: `@/core/*` from Task 1.
- Produces: `@/core/connection` (`ConnectionStatus`), `@/drivers/sennheiser/gaia/{commands,frame,features,unsafe,knownCommands}`, `@/drivers/sennheiser/{client,device,state}`, `@/drivers/sennheiser/sections/*`.

- [ ] **Step 0: Extract `ConnectionStatus` into `core/` BEFORE moving `state.ts`**

`src/device/state.ts` is Sennheiser-specific (`DeviceState`, `TOGGLES`, `togglesFor` are all GAIA-only) **except** for `ConnectionStatus`, which is generic and already has three non-Sennheiser consumers:

- `src/core/session.ts:25,48` — `onStatus(status: ConnectionStatus, …)`
- `src/device/sony.ts:67,76` — Sony's own state type (pre-existing)
- `src/ui/device/DeviceImage.tsx:5,10` — prop

Moving `state.ts` wholesale would therefore point `core/` **and Sony** at `drivers/sennheiser/` — turning Task 1's temporary `core → device` bridge into a permanent `core → drivers/sennheiser` one, and violating Task 6's own check that `grep -rn "sennheiser\|gaia" src/drivers/sony/` is empty.

So, first:

```bash
# move ONLY the ConnectionStatus declaration out of src/device/state.ts
# into a new src/core/connection.ts, then re-point all consumers.
grep -rn "ConnectionStatus" src/ | grep -vE "SonyFunction|getConnectionStatus|ConnectionStatusReading|knownCommands|mdr/commands"
```

Re-point `core/session.ts` to `./connection` (this removes one of Task 1's two bridges), and `device/sony.ts` + `ui/device/DeviceImage.tsx` to `@/core/connection`. Keep the name and the type identical — this is a relocation, not a redesign. Only then proceed to Step 1.

- [ ] **Step 1: Move the files**

```bash
mkdir -p src/drivers/sennheiser/sections
git mv src/gaia src/drivers/sennheiser/gaia
git mv src/device/client.ts src/device/client.test.ts src/drivers/sennheiser/
git mv src/device/device.ts src/device/device.test.ts src/drivers/sennheiser/
git mv src/device/state.ts src/device/state.test.ts src/drivers/sennheiser/
for f in Noise Sound System Devices Debug DebugEntry; do
  git mv "src/ui/sections/$f.tsx" src/drivers/sennheiser/sections/
done
```

`SystemTail.tsx` stays in `src/ui/sections/` — Task 5 decides its fate. `About.tsx`, `NoDevice.tsx`, `types.ts` and `registry.ts` also stay.

- [ ] **Step 2: Rewrite the imports**

Run the enumerate-and-fix loop from *Import Rewrite Method*. The main rewrites:

```bash
grep -rl "from '@/gaia/" src/ | xargs sed -i '' "s|from '@/gaia/|from '@/drivers/sennheiser/gaia/|g"
grep -rlE "from '@/device/(client|device|state)'" src/ \
  | xargs sed -i '' -E "s#from '@/device/(client|device|state)'#from '@/drivers/sennheiser/\1'#g"
```

**Do not write `\|` inside `grep -E`.** Task 1's rewrite silently did nothing because of exactly this. The two halves behave differently and only one is broken:

- `sed -E "s|…(a\|b)…|…|"` **works** — `|` is the delimiter, so sed unescapes `\|` to a literal `|` before the ERE engine sees it, and it becomes alternation.
- `grep -E "(a\|b)"` **matches nothing** — there is no delimiter, so `\|` reaches the engine as an *escaped* pipe, i.e. a literal `|` character.

Since the idiom is `grep -rl … | xargs sed …`, the grep returns no files and the rewrite never runs. Verify each rewrite actually changed something (`git diff --stat`) rather than trusting a clean exit — a no-op pipeline exits 0.

The moved sections import `../controls/SettingRow` and `../panels/*`; from their new home those become `@/ui/controls/SettingRow` and `@/ui/panels/*`. Fix each — there are six files.

- [ ] **Step 3: Verify**

Run: `npm test && npm run lint && npm run build`
Expected: all green.

Note that `src/ui/sections/registry.ts` still imports the moved sections; its specifiers change here but its structure is Task 4's problem. Leave the structure alone.

- [ ] **Step 4: Report**

Commit the task on the branch, then report moved files and confirm rename detection via `git status --short`.

---

### Task 3: Create `src/drivers/sony/`

Same shape, MDR side.

**Files:**
- Move: `src/mdr/*` → `src/drivers/sony/mdr/`
- Move: `src/device/sony.ts`, `src/device/sony.test.ts`, `src/device/sonyDevice.test.ts` → `src/drivers/sony/`
- Move: `src/ui/sections/sony/*` → `src/drivers/sony/sections/`

**Interfaces:**
- Consumes: `@/core/*`.
- Produces: `@/drivers/sony/mdr/{client,commands,frame,noise,settings}`, `@/drivers/sony/sony`, `@/drivers/sony/sections/*`.

- [ ] **Step 1: Move the files**

```bash
mkdir -p src/drivers/sony
git mv src/mdr src/drivers/sony/mdr
git mv src/device/sony.ts src/device/sony.test.ts src/device/sonyDevice.test.ts src/drivers/sony/
git mv src/ui/sections/sony src/drivers/sony/sections
```

- [ ] **Step 2: Rewrite the imports**

**Run `npm run build` first and work from its output** — see *Import Rewrite Method*. These two rewrites are the bulk, not the whole job:

```bash
grep -rl "from '@/mdr/" src/ | xargs sed -i '' "s|from '@/mdr/|from '@/drivers/sony/mdr/|g"
grep -rl "from '@/device/sony'" src/ | xargs sed -i '' "s|from '@/device/sony'|from '@/drivers/sony/sony'|g"
```

Neither grep sees the **relative sibling imports left behind in `src/device/`**, which is precisely how Task 2 broke its own suite mid-task. These stay put while their target moves, and must be re-pointed at `@/drivers/sony/sony`:

- `src/device/manager.ts:12,14` — `SonyDevice`, `SonyState`
- `src/device/driver.ts:26,27` — same two
- `src/device/driver.test.ts:5` — `initialSonyState`

(`sony.test.ts` and `sonyDevice.test.ts` also use `'./sony'`, but they move too, so theirs stay correct. `sonyDevice.test.ts` additionally imports `'../mdr/commands'` and `'../mdr/frame'`, which need re-pointing from the new depth.)

Verify with `git diff --stat` that each rewrite changed files, then re-run `npm run build` until clean.

The Sony sections import `'../../controls/SettingRow'`, `'../../device/artwork'`, `'../SystemTail'` and `'../../panels/*'`. From `src/drivers/sony/sections/` those become `@/ui/controls/SettingRow`, `@/ui/device/artwork`, `@/ui/sections/SystemTail`, `@/ui/panels/*`. Four files.

`src/drivers/sony/mdr/client.ts` imported `'../device/transport'` before Task 1 turned it into `'@/core/transport'` — confirm it is still correct from the new depth. An alias import is depth-independent, which is why the alias is preferred here.

- [ ] **Step 3: Verify**

Run: `npm test && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 4: Confirm `src/device/` is nearly empty**

Run: `find src/device -type f | sort`
Expected: only `driver.ts`, `driver.test.ts`, `manager.ts`, `manager.test.ts`, `brand.ts`, `profiles.ts`, `profiles.test.ts`. Anything else means a file was missed — list it in the report.

- [ ] **Step 5: Report**

Commit the task on the branch, then report the `find` output.

---

### Task 4: Break the `device/` → `ui/` inversion

`src/device/driver.ts:30` imports `SENNHEISER_COMPONENTS` and `SONY_COMPONENTS` from `@/ui/sections/registry`. The device layer reaching up into the UI layer is the one edge in the tree that points the wrong way, and it exists only because the descriptors were assembled centrally. Now that each driver owns its sections, each descriptor moves next to them and the edge disappears.

**Files:**
- Create: `src/drivers/sennheiser/driver.ts`, `src/drivers/sony/driver.ts`
- Modify: `src/device/driver.ts` → `src/core/driver.ts` (descriptor *type* + `DRIVERS` array only)
- Modify: `src/ui/sections/registry.ts` (delete both component maps; keep icons and lookups)

**Interfaces:**
- Consumes: `@/drivers/*/sections/*` from Tasks 2-3.
- Produces: `SENNHEISER_DRIVER` from `@/drivers/sennheiser/driver`, `SONY_DRIVER` from `@/drivers/sony/driver`, and `DriverSection` / `SectionComponent` / `DRIVERS` from `@/core/driver`.

- [ ] **Step 1: Read the current descriptor before splitting it**

Run: `sed -n '1,80p' src/device/driver.ts`

`driver.ts` carries type definitions, both concrete descriptors, and the `DRIVERS` registry with a documented cast. **Read all of it.** The cast and its comment exist for a variance reason explained in `ui/sections/registry.ts:72-81`; preserve both verbatim when splitting. Where this plan and the source disagree, the source wins and the contradiction goes in the report.

- [ ] **Step 2: Move the shared parts to core**

```bash
git mv src/device/driver.ts src/core/driver.ts
git mv src/device/driver.test.ts src/core/driver.test.ts
```

- [ ] **Step 3: Extract the Sennheiser descriptor**

Create `src/drivers/sennheiser/driver.ts` holding the `SENNHEISER_DRIVER` descriptor and, inline, the components map that `ui/sections/registry.ts` used to export:

```ts
import { Debug } from './sections/Debug'
import { Devices } from './sections/Devices'
import { Noise } from './sections/Noise'
import { Sound } from './sections/Sound'
import { System } from './sections/System'

const COMPONENTS = {
  noise: Noise,
  sound: Sound,
  devices: Devices,
  system: System,
  debug: Debug,
} as const
```

Move the existing `SENNHEISER_DRIVER` object from `src/core/driver.ts` into this file unchanged, with `components: COMPONENTS`. Import its descriptor type from `@/core/driver`.

- [ ] **Step 4: Extract the Sony descriptor**

Create `src/drivers/sony/driver.ts` the same way:

```ts
import { SonyNoise } from './sections/SonyNoise'
import { SonySound } from './sections/SonySound'
import { SonySystem } from './sections/SonySystem'

const COMPONENTS = {
  noise: SonyNoise,
  sound: SonySound,
  system: SonySystem,
} as const
```

Move `SONY_DRIVER` across unchanged, including the capability gate on noise control that `sectionsForDevice` used to restate.

- [ ] **Step 5: Reduce `core/driver.ts` to types plus the registry**

It should now hold the descriptor interfaces, `DriverSection`, `SectionComponent`, and:

```ts
import { SENNHEISER_DRIVER } from '@/drivers/sennheiser/driver'
import { SONY_DRIVER } from '@/drivers/sony/driver'

export const DRIVERS = [SENNHEISER_DRIVER, SONY_DRIVER] as const
```

Keep the existing cast and its explanatory comment exactly as they were.

- [ ] **Step 6: Strip the component maps from the UI registry**

Delete `SENNHEISER_COMPONENTS` and `SONY_COMPONENTS` and their five section imports from `src/ui/sections/registry.ts`. Keep `Section`, `SECTION_ICONS`, `withIcon`, `sectionsForDevice`, and `componentFor` — those are genuinely UI-layer and driver-agnostic.

- [ ] **Step 7: Verify the inversion is gone**

Run: `npm test && npm run lint && npm run build`
Expected: all green.

Run: `grep -rn "from '@/ui" src/core/ src/drivers/*/[a-z]*.ts`
Expected: **no output.** Core and driver logic must not import UI. Driver *sections* may, which is why the glob excludes `sections/`.

Run: `grep -rn "SENNHEISER_COMPONENTS\|SONY_COMPONENTS" src/ --include='*.ts' --include='*.tsx'`

Expected: no *code* hits. Prose hits are fine and were kept deliberately — the new driver files record where the maps came from, matching this codebase's historical comment style (`registry.ts` still narrates the "keep in sync" comment it deleted), and keeping the identifiers means `git log -S` can still find the move. Read the hits before calling this a failure; the same prose-blindness bit Task 6's cross-driver gate.

- [ ] **Step 8: Report**

Commit the task on the branch, then paste both `grep` results and state the new line count of `src/core/driver.ts` versus the original.

---

### Task 4b: Sever the remaining `ui/` → `drivers/` edges

**Added after Task 2's review, which ran Task 6's dependency gate early and found it unachievable as written.** Task 6 Step 4 requires `grep -rn "from '@/drivers" src/ui/` to be empty. It returns **28** hits, and Task 4 closes only the `registry.ts` ones.

**Re-run the grep before you start — do not trust this count.** It was 18 when this task was written, after Task 2. Task 3 took it to 28 by making Sony's previously-relative imports legible as driver edges, and Task 4 will change it again. Every added edge has landed in a file this task already owns, so the *fixes* below stay correct; only the arithmetic moves. Fix what the grep reports, not what this table says.

These edges are not new — they existed as `ui → gaia` and `ui → device` imports before this phase. Tasks 1-3 did not create them; they made them legible by giving the driver tier a name. That is the restructure doing its job, but it leaves 13 edges with no owner.

Task 4 breaks the `device → ui` inversion. This is the **same job in the mirror**: `ui/` is the shared tier and must not know a driver by name. It runs after Task 4 because two of the fixes need the descriptors Task 4 creates.

The 18 edges are four distinct problems, and conflating them is how this gets done badly:

Counts below are as of Task 3 (`54ab5ee`); the *file* list is what matters and is stable.

| File | Edges | What it is | Fix |
|---|---|---|---|
| `sections/registry.ts` | 8 | component maps, both drivers | already Task 4 |
| `sections/sections.render.test.tsx` | 9 | renders **both** drivers' sections | **relocate out of `ui/`** |
| `debug/ProbePanel.tsx` | 4 | GAIA frames, `knownCommands`, GAIA `ProbeResult`, `MomentumDevice` | **move** |
| `sections/types.ts` | 2 | `SectionProps` hard-typed to `MomentumDevice` + `DeviceState` | **move** |
| `device/summary.ts` + `summary.test.ts` | 4 | imports **both** `gaiaCodecName` and `sonyCodecName` | **descriptor** |
| `device/DeviceImage.tsx` | 1 | one comparison, `WearState.OnHead` | **prop** |

- [ ] **Step 1: Move `ProbePanel` into the Sennheiser driver**

It is a GAIA debug console — vendor enums, frame hex, GAIA command names, a `MomentumDevice` prop — and its only consumer is `src/drivers/sennheiser/sections/Debug.tsx:9`. Nothing shared about it.

```bash
git mv src/ui/debug/ProbePanel.tsx src/drivers/sennheiser/
```

Check whether `src/ui/debug/` still has other occupants before removing it.

- [ ] **Step 2: Move `sections/types.ts` into the Sennheiser driver**

`SectionProps` names `MomentumDevice` and `DeviceState` directly. Sony's sections never used it — they declare their own local `Props` — so despite its neutral location it has always been the Sennheiser section contract.

Before moving it, check `core/driver.ts`'s generic `SectionComponent<TDevice, TState>` (introduced in Task 4). If `SectionProps` is now redundant against it, say so in the report and delete rather than move. **The source decides**, not this plan.

- [ ] **Step 3: Relocate the render test**

`sections.render.test.tsx` imports from both drivers because it renders four sections across two drivers — that is the point of the net Task 0 built, and it must not be split or weakened. It belongs to neither driver, so it moves out of `ui/` rather than into one. `src/sections.render.test.tsx` is the obvious home; pick another if it fits the tree better.

**Do not touch the snapshot file's contents.** Move `src/ui/sections/__snapshots__/` with it, and confirm afterwards that the 12 snapshots still pass *unmodified* — a moved snapshot that silently regenerates would destroy the only cross-driver regression net this phase has. `git status` must show the `.snap` as a pure rename.

- [ ] **Step 4: Move per-driver formatting out of `summary.ts` onto the descriptor**

This is the only genuinely shared file of the six. `src/ui/device/summary.ts` builds one common summary shape from either driver's state, and it does so by importing both codec tables and branching (`summary.ts:65-70` Sony, `85-86` Sennheiser).

It cannot move into a driver, and it should not keep importing both. Follow the pattern Task 5 uses for `profileFor`: give the descriptor the per-driver knowledge and let `summary.ts` stay generic. At minimum the codec name lookup and `wearStateName` move behind the descriptor.

Read the file first and let its actual shape decide the seam. If the branching turns out to be irreducible without inventing a speculative abstraction, **say so and stop** — a documented exception in Task 6 is better than a wrong abstraction baked into the shared tier.

- [ ] **Step 5: Give `DeviceImage` a driver-free prop**

`DeviceImage.tsx:45` is a single comparison: `wearState === null || wearState === WearState.OnHead`. Importing a GAIA enum for one equality check is the whole edge. Have the caller pass what it already knows — a `worn` boolean, or a driver-neutral union — rather than the raw GAIA value.

Check both callers before changing the prop, and confirm Sony's path still renders identically. This is the one step in this task that can change rendered output if done carelessly; the render net from Step 3 is the guard.

- [ ] **Step 6: Verify**

```bash
npm run build && npm run lint && npm test
grep -rn "from '@/drivers" src/ui/
```

Expected: all green, same test count, and the grep **empty**. If anything survives, it is either a missed edge or a genuine exception — report which, with the reason, rather than forcing it.

- [ ] **Step 7: Report**

Commit on the branch. State whether `SectionProps` moved or was deleted as redundant, what seam `summary.ts` ended up with, and confirm the 12 snapshots passed unmodified after the move.

---

### Task 5: Retire `Brand`

Spec §3.6 lists `Brand` as deleted, but it survives: `profileFor(brand, model)` is keyed on it and `SystemTail` takes it as a prop. Profiles are per-manufacturer data, so the lookup belongs on the descriptor.

**Scope correction (defect found before Task 2).** An earlier draft of this task listed three files and expected `grep -rn "Brand\b" src/` to return nothing after `git rm src/device/brand.ts`. That is unachievable: `Brand` has **eight** consumer files, and `profiles.ts`/`SystemTail.tsx` are only two of them. Verified inventory:

| File | Use | Covered by |
|---|---|---|
| `core/transport.ts:36` | `KnownService.brand` | this task |
| `core/session.ts:146` | `grantedPortFor(brand)` | this task |
| `ui/device/artwork.ts:16,227` | **re-exports** `Brand`; artwork lookup key | this task |
| `ui/device/DeviceImage.tsx:15` | `brand?: Brand` prop | this task |
| `ui/sections/SystemTail.tsx:5,16,55` | prop | this task |
| `device/profiles.ts:84,287,318` | `IMPLEMENTED`, `profileFor` | this task |
| `device/driver.ts:106` | descriptor **field** `brand` | Task 4 (`core/driver.ts`) |
| `device/manager.ts` + `manager.test.ts` | `resolveBrand`, `knowsDevice`, `available`, `brand` getter | Task 6 |

**CORRECTION — this task's original premise was wrong, and so is spec §3.6.** An earlier draft asserted that `Brand` and the driver id are "already the same string domain (`'sennheiser' | 'sony'`), and `manager.ts:256` exists purely to convert one into the other". Both halves are false:

```
driver ids:  'sennheiser-gaia' | 'sony-mdr'     (drivers/*/driver.ts)
Brand:       'sennheiser'      | 'sony'         (device/brand.ts:38)
#selectedBrand():  DRIVERS.find(d => d.id === this.#driverId)?.brand
```

That is a genuine lookup, not an identity. And `core/driver.ts`'s own comment on the `brand` field already said so — it is named separately from `id` precisely so that one brand can own more than one driver, which is exactly what a second Sony protocol or a second Sennheiser generation would need.

So **`Brand` is not vestigial and must not be collapsed.** It is the key for `public/devices/<brand>/` artwork folders (`ui/device/artwork.ts:230`), the `PROFILES` discriminant, and `KnownService.brand`. Collapsing it into `DriverId` would be a *value* change requiring edited test expectations across `transport.test.ts`, `profiles.test.ts`, `artwork.test.ts` and `manager.test.ts` — precisely what this phase's contract forbids.

Spec §3.6 lists `Brand` as deleted. **The spec is wrong**, and phase 3 not deleting it was correct rather than an oversight.

What this task does instead: introduce `DriverId` for the places that genuinely want a driver-id discriminant, move `profiles.ts` to `core/`, give `SystemTail` a profile instead of a brand, and leave `Brand` in place as the manufacturer key it actually is. `brand.ts` gets **moved** to `core/`, not deleted.

**Files:**
- Move: `src/device/profiles.ts` + test → `src/core/profiles.ts` — **not** split per driver. `PROFILES` is one flat array with a `brand` discriminant that both descriptors already `.filter()`, `Feature`/`FeatureId`/`FEATURE_NAMES`/`DeviceProfile` are documented as one vocabulary across brands, and `IMPLEMENTED` is keyed by `Brand`. Splitting would duplicate the vocabulary and force `ui/device/artwork.ts` (six `profileFor` call sites) to import both drivers.
- Modify: `src/ui/sections/SystemTail.tsx` (take a profile, not a brand)
- ~~Modify `src/core/{transport,session}.ts`, `src/ui/device/{artwork.ts,DeviceImage.tsx}` (`Brand` → `DriverId`)~~ — **voided by the correction above.** These keep `Brand`; it is the manufacturer key, not a stale alias for the driver id.
- Modify: `src/ui/layout/Sidebar.tsx`, `src/ui/layout/MobileChrome.tsx`, `src/ui/device/summary.ts` — **added after Task 4's review.** These four import a whole driver descriptor from `@/core/driver` solely to read `…_DRIVER.id` as a discriminant (`Sidebar.tsx:38-40`, `MobileChrome.tsx:32-34`, `summary.ts:54`, fixtures in `src/summary.test.ts`, relocated out of `ui/` by Task 4b). Once `DriverId` exists they should compare against it directly and drop the descriptor import. Without this, Task 4's re-export facade makes the coupling permanent *and* invisible to Task 6's gate — see the allow-list note in Task 6 Step 4.
- **Not** deleted: `src/device/brand.ts` stays put; Task 6 moves it to `core/`. See the correction block above.

**Interfaces:**
- Consumes: descriptors from Task 4.
- Produces: `DriverId` in `core/driver.ts`, consumed by `ActiveDevice`'s two arms. `SystemTail` takes `{ profile, capabilities }` instead of `{ brand, model, capabilities }`.
- **Not** produced: a `driver.profileFor(model)` descriptor method. It was added, found to have no consumer, and removed — every call site uses the free `profileFor(brand, model)`, and the two `System` sections *cannot* use a descriptor method because their own descriptor names them in its components map, so importing it back closes a runtime cycle.

- [ ] **Step 1: Read what `profiles.ts` actually keys on**

Run: `sed -n '1,60p' src/device/profiles.ts && grep -rn "profileFor\|unsupportedFeatures\|FEATURE_NAMES" src/`

Confirm whether the profile table is one map keyed by brand or two tables already. **The source decides the split**, not this plan. If the profile data turns out to be genuinely shared and only *selected* by brand, keep one table in `src/core/profiles.ts` and have each descriptor pass its own key — record which you found and why.

Whatever you decide, these are every consumer — verified, and note that two of them are now **inside the Sennheiser driver**, which the earlier draft of this task did not account for:

| File | Imports |
|---|---|
| `ui/sections/SystemTail.tsx:4` | `FEATURE_NAMES`, `profileFor`, `unsupportedFeatures` |
| `ui/device/artwork.ts:14` | `profileFor` |
| `drivers/sennheiser/state.ts:46,47` | `Feature`, `profileFor`, `FeatureId` |
| `drivers/sennheiser/state.test.ts:5` | `FEATURE_NAMES` |
| `device/driver.ts:24,25` | `DeviceProfile`, `PROFILES` |
| `device/profiles.test.ts:10` | the table itself |

The two `drivers/sennheiser/` entries are the interesting ones: if profiles split per driver, those become intra-driver relative imports and the edge disappears. If the table stays unified in `core/`, they become `core/` imports, which is also fine. What is **not** fine is leaving them pointing at `@/device/profiles` — `src/device/` must not exist after Task 6.

- [ ] **Step 2: ~~Add `profileFor` to each descriptor~~ — do not do this**

Attempted and reverted. A `profileFor(model)` on each descriptor looks right but has no reachable consumer: `ui/device/artwork.ts` has no driver in hand at any of its six call sites, and the two `System` sections cannot import their own descriptor without closing a runtime cycle (it names them in its components map). Both end up calling the free `profileFor(brand, model)` from `@/core/profiles` anyway.

Add `DriverId` instead — `typeof SENNHEISER_DRIVER.id | typeof SONY_DRIVER.id` — and have `ActiveDevice`'s arms `Extract` from it, so it has a real consumer rather than being exported API nobody calls.

- [ ] **Step 3: Change `SystemTail` to take a profile**

Replace its `brand: Brand; model: string | null` props with `profile: DeviceProfile | null`, and move the `profileFor` call out to the two callers, which now have a driver in hand. `MissingFeatures` already only needs the profile — it calls `profileFor` purely to get one.

- [ ] **Step 4: Check what still needs `Brand`, and verify**

Run the grep **first**, and let it decide whether the delete is possible:

```bash
grep -rn "Brand\b" src/ | grep -v '^src/device/brand.ts'
```

Expected survivors: `device/driver.ts` (Task 4's descriptor field, if it still names the type) and `device/manager.ts` + `manager.test.ts`. Those are Task 6's, and their presence is **not** a failure of this task.

- If the only survivors are those: leave `brand.ts` in place, note it in the report, and let Task 6 delete it.
- If there are **no** survivors: `git rm src/device/brand.ts`.
- If something outside that expected set survives: report it, do not force the delete.

Then: `npm test && npm run lint && npm run build` — all green either way.

- [ ] **Step 5: Report**

Commit the task on the branch, then state whether the profile table split or stayed unified, with the reason from Step 1.

---

### Task 6: Move `manager.ts`, retire `src/device/`, final sweep

**Files:**
- Move: `src/device/manager.ts` + `manager.test.ts` → `src/core/`
- Move: `src/device/profiles.ts` + test → wherever Task 5 landed them
- Move: `src/device/brand.ts` → `src/core/brand.ts` (see Step 1b — it is moved, never deleted)
- Modify: `src/ui/useDevice.ts`, `src/App.tsx`, and every remaining `@/device/*` importer

- [ ] **Step 1: Move and rewrite**

```bash
git mv src/device/manager.ts src/device/manager.test.ts src/core/
grep -rl "from '@/device/manager'" src/ | xargs sed -i '' "s|from '@/device/manager'|from '@/core/manager'|g"
```

- [ ] **Step 1b: Finish retiring `Brand`, if Task 5 deferred it**

**CORRECTED after Task 5** — the earlier version of this step was built on the same false premise as Task 5's, and following it would break the build.

`Brand` is **not** collapsible into `DriverId`: driver ids are `'sennheiser-gaia'`/`'sony-mdr'` while brands are `'sennheiser'`/`'sony'`, and `#selectedBrand` (`manager.ts:256`) is a genuine `DRIVERS.find(...)` lookup, not an identity. It must **stay**. See Task 5's correction block for the full reasoning and for why spec §3.6 is wrong on this point.

So this step is a move, not a deletion:

```bash
git mv src/device/brand.ts src/core/brand.ts
```

`Brand` remains the manufacturer key — `public/devices/<brand>/` artwork folders, the `PROFILES` discriminant, `KnownService.brand`. Its consumers after Task 5 are `core/{transport,session,profiles,driver}.ts`, `ui/device/{artwork.ts,DeviceImage.tsx}` and `manager.ts` itself; re-point them all at `@/core/brand`. `src/device/brand.ts` records the current list in its own header — read it rather than re-deriving.

`manager.ts` and `manager.test.ts` keep `Brand` exactly as they use it today. Only the import path changes.

`manager.test.ts` pins `resolveBrand` on brand strings — the strings are unchanged, so the tests should need only the import and type name updated. If a test needs its *expectations* changed, stop: that means behaviour moved, which this phase forbids.

- [ ] **Step 2: Confirm `src/device/` is empty and remove it**

```bash
find src/device -type f
```

Expected: no output. Then `rmdir src/device`. If any file remains, it was missed by Tasks 1-5 — place it and say which task should have caught it.

- [ ] **Step 3: Full verification**

Run: `npm test && npm run lint && npm run build`
Expected: all green, with the same test count as before Task 1.

- [ ] **Step 4: Verify the dependency directions**

```bash
echo "core -> drivers (see the allow-list below):"
grep -rn "from '@/drivers" src/core/
echo "core -> ui (must be empty):"
grep -rn "from '@/ui" src/core/
echo "ui -> drivers (must be empty; owned by Task 4b):"
grep -rn "from '@/drivers" src/ui/
echo "ui -> descriptors via the core/driver re-export (must be empty; owned by Task 5):"
grep -rn "SENNHEISER_DRIVER\|SONY_DRIVER" src/ui/
echo "sennheiser -> sony (must be empty):"
grep -rn "from '@/drivers/sony\|from '@/mdr" src/drivers/sennheiser/
echo "sony -> sennheiser (must be empty):"
grep -rn "from '@/drivers/sennheiser\|from '@/gaia" src/drivers/sony/
```

The last two are the point of the whole restructure: **neither driver may reference the other.** A hit means the phase is not done.

**`core -> drivers` allow-list** — **ten** lines after Task 6, all intended:

| Line | Why |
|---|---|
| `core/driver.ts:38,39` | imports the two descriptors to build `DRIVERS` — the one edge the registry pattern requires |
| `core/driver.ts:58,59` | **re-exports** `SENNHEISER_DRIVER` / `SONY_DRIVER`. Its original purpose — sparing three `ui/` files a driver import — was voided by Task 5, which converted all three to `DriverId` literals. Kept as a convenience for `manager.ts` and the two composition-root tests, and its comment now says so rather than asserting a fact about `ui/` that stopped being true. **Not** a required edit when adding a driver. |
| `core/driver.test.ts:4,5` | test fixtures `initialState` / `initialSonyState`; a test of `DRIVERS` needs the concrete drivers |
| `core/manager.ts:10,13,14,15` | `MomentumDevice`, `SonyDevice`, `DeviceState`, `SonyState` — `active` builds concrete, fully-typed `ActiveDevice` arms and cannot use the `DeviceDriver<never, never>`-erased `DRIVERS` |

This list said "six lines" until Task 6, which staled it **by construction**: `manager.ts` was in `src/device/` when the list was written, and Task 6's own Step 1 moves it into `core/`. The Target Structure at the top of this plan always put it there, so the four new lines were designed in, not drift — but no task updated the count, and Task 6's implementer had to work that out rather than read it. Third stale count in this plan; the lesson stands from the first two.

The re-export is a deliberate Task 4 decision, not drift. Six files import the descriptors by name and **three** are in `ui/` — `layout/Sidebar.tsx`, `layout/MobileChrome.tsx`, `device/summary.ts`. (It was four until Task 4b moved `summary.test.ts` out of `ui/` entirely.) Pointing those at `@/drivers/*/driver` would add new `ui -> drivers` edges in four files no task owns. Re-exporting from `core/driver.ts` adds no coupling `core/` did not already have — it imports both descriptors regardless — and keeps `ui/` importing only from `core/`.

**But the facade suppresses the signal, so the underlying coupling needs an owner.** Task 4's review caught this: because those four files now read `@/core/driver`, Task 6's `ui -> drivers` gate passes green with the coupling intact, and nothing would ever ask the question. Every one of them uses the descriptor **only** as a discriminant — `active.id === SENNHEISER_DRIVER.id` (`Sidebar.tsx:38-40`, `MobileChrome.tsx:32-34`), `active.id === SONY_DRIVER.id` (`summary.ts:54`), plus fixtures in `src/summary.test.ts`. That is a whole descriptor imported to read one string literal, which is a `DriverId` problem wearing a descriptor costume. **Task 5 owns it** — see its file list.

Two corrections to these checks, both from Task 2's review:

- **The `ui -> drivers` check is Task 4b's, not Task 4's.** Task 4 closes only `registry.ts`; the other 13 edges belong to Task 4b. If Task 4b was skipped or deferred, this gate fails here with no task left to fix it — say so explicitly rather than relaxing the check.
- **Match on import specifiers, not bare words.** The original cross-driver checks were `grep -rn "sony\|mdr" … -il`, which is prose-blind: it flags `state.ts`'s comment about why `profileFor` is hardcoded, and `device.test.ts`'s "Mirrors the equivalent SonyDevice test". Those are not edges. The forms above match imports only. If you want the prose check too, run it separately and read the hits before calling any of them a failure.

- [ ] **Step 5: Report**

Commit the task on the branch, then paste the Step 4 output, the final `find src -type d` tree, and answer the question spec §5 exists to make checkable: *what files would adding a third manufacturer now touch?*

**Answer it honestly from the tree, not from this plan's aspiration.** The intended answer was "one new `src/drivers/<name>/` directory plus one line in `DRIVERS`". Task 4b's review established that is already wrong, and knowingly so — there are **five** known sites, three of them documented and two not:

| Site | Status |
|---|---|
| the new `src/drivers/<name>/` directory | intended |
| one line in `DRIVERS` (`core/driver.ts`) | intended |
| `manager.ts`'s `active` getter + the `ActiveDevice` union | known, documented in place at `manager.ts:285-304` |
| `ui/device/summary.ts`'s driver-id branch | **known, documented nowhere** |
| `ui/device/artwork.ts:234` — `brand === 'sony' ? sonyArtwork(…) : sennheiserArtwork(model)` | **known, documented nowhere.** A third brand falls silently through to Sennheiser artwork: `Brand` gains a member but the ternary has no exhaustiveness check, so nothing fails to compile. |

The `summary.ts` branch is the one to record. Task 4b moved `codec`, `detail` and `worn` onto the descriptor because each needed an import from the driver tier; `battery`, `model`, `hasDevice` and `colourCode` stayed behind a driver-id branch because they read only plain fields of the driver's own state. That rule is coherent and stopping there was correct for a phase whose contract is "sever edges, change no behaviour" — collapsing the rest would mean each driver constructing the UI's view model, a larger claim than this phase should make. But it leaves `summarise` using the descriptor for three of seven fields and a hardcoded branch for four, and **no task owns it**.

So: state the real number, name the `summary.ts` branch as a known exception with the reasoning above, and say what closing it would require. A §5 answer that claims two sites when the tree has four is worse than no answer, because it retires the question.

One prose edit to know about rather than mistake for drift: Task 5 reworded `ui/sections/registry.ts:50` from "see `SONY_DRIVER` in drivers/sony/driver.ts" to "see the descriptor in …" purely so this gate reads mechanically empty. No information was lost, but it does sit against this plan's own rule that prose hits are fine and should be *read*, not eliminated — and it leaves the identical pattern alive at `System.tsx:11` and `SonySystem.tsx:5` simply because those are outside `ui/`. If you would rather have the rule than the green grep, restoring the identifier and reading the hit is the defensible choice.

Also decide, deliberately rather than by inheritance, whether `src/sections.render.test.tsx` and `src/summary.test.ts` should stay at `src/` root. Task 4b put them there because both are inherently cross-driver, neither belongs to a driver, and `ui/` may not name one — sound reasoning, but `src/` root previously held no tests at all, so this establishes a convention with no directory to name it, and drags a top-level `src/__snapshots__/` along whose owner is not obvious. A named home (`src/integration/`, `src/composition/`) would put the concept in the tree. Either answer is defensible; record which and why.

---

## Self-Review

**Spec coverage.** §5 step 5 asks for `core/`, `drivers/*`, `ui/*` — Tasks 1, 2-3, and 6 respectively. §3.6's `Brand` deletion is Tasks 5 **and 6** — phase 3 left it undone despite the spec claiming otherwise, and the first draft of Task 5 under-scoped it to three files when there are eight consumers; the plan says so rather than pretending either the spec or the draft was right.

**Ordering rationale.** Core moves first because everything depends on it and its imports are the most-referenced. Drivers move before the descriptor split (Task 4) because the split needs the sections already in place to import them locally. `manager.ts` moves last because it touches both drivers and would churn twice otherwise.

**Type consistency.** `profileFor(model: string | null)` in Task 5 matches `SystemTail`'s existing `model: string | null`. `DRIVERS` keeps the variance cast from the original `driver.ts` verbatim (Task 4 Step 5) rather than a rewritten equivalent.

**Risk this plan accepts.** Task 4 is the only one that could hide a behaviour change, since it moves live descriptor objects between files. Its guard is that the descriptors move *unchanged* and the pre-existing `driver.test.ts` travels with them to `core/`. If that test needs editing to pass, the descriptor changed — stop and report rather than adapting the test.
