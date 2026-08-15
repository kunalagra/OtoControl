# Shared Panels — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the markup both drivers duplicate — the device-info table, the equalizer card, toggle lists, and the auto-power-off row — into `src/ui/panels/`, so a third driver composes a page from existing parts instead of copying two.

**Architecture:** Each panel is a presentational component taking data and callbacks. Sony and Sennheiser sections keep their own page composition — which panels appear, in what order, with what wording — and pass driver-specific values in. The pure "keep an unlisted reported value" helper moves to `src/ui/panels/autoPowerOff.ts` where it can be unit-tested once instead of read twice.

**Tech Stack:** React 19, TypeScript (`tsc -b`), Vitest, Tailwind, shadcn-style primitives in `src/components/ui/`.

**Spec:** `docs/superpowers/specs/2026-08-11-driver-architecture-design.md` — §3.4 (shared panels) and §5 step 4.

## Global Constraints

- Work on branch `phase-4-shared-panels`. **Never push, never merge, never switch to or touch `main`.** Never run `git config --global` — the global identity belongs to the user's work account and must stay untouched. Commit freely on the branch; end each task with a commit so its diff is reviewable.
- Run the full suite with `npm test` (Vitest, `run` mode). Lint with `npm run lint` (oxlint). Typecheck happens via `npm run build` (`tsc -b`).
- **A shared panel never knows which driver it is in.** It takes data and callbacks — never a driver, a brand, or a driver's state object. A panel needing `if (driver === 'sony')` is a design error, not a special case (spec §3.4). This is the hard rule the whole phase exists to establish.
- This phase is a **pure refactor**. No rendered output changes for either driver, **with one exception this plan itself mandates and must not pretend otherwise**: Task 3 Step 7 adopts `ToggleRow` for Sony's DSEE toggle, and `ToggleRow` hardcodes the hint "Not reported by this firmware." whenever `value === null`. Sony's toggle previously kept its own hint in that state. Since Step 7 also forbids touching `ToggleRow`, the change is unavoidable and was accepted — it makes Sony consistent with every Sennheiser toggle, which already showed that wording. **It is visible in the disconnected state, i.e. on first open, not only for firmware that fails to report DSEE.** Any *other* rendered-output change is a defect; existing tests are the contract.
- Every task ends green on `npm test && npm run lint && npm run build`.
- `SNAPSHOT_VERSION` stays at **1**.
- **Component tests call the component as a plain function and inspect the returned element tree.** There is no DOM: vitest runs in the default `node` environment, and neither `@testing-library/react` nor jsdom is a dependency. `src/ui/sections/SystemTail.test.tsx` is the reference — read it before writing a test. **Do not add a DOM testing stack**; adding `@testing-library/react`, jsdom, or happy-dom is out of scope for this phase and would change a deliberate project-wide choice. Task 1 builds the small traversal helper the later tasks reuse.

## Scope Note — Battery is already shared, and is not in this plan

Spec §5 step 4 lists Battery as a panel to extract. It is already extracted: `deviceSummary()` in `src/ui/device/summary.ts` normalizes both drivers into `{ battery, charging }`, and `BatteryBar` in `src/ui/device/DeviceImage.tsx` renders it from the Sidebar. There is no per-driver battery markup left to unify. **No task below touches battery.** If a reviewer expects a `BatteryPanel`, this paragraph is the answer.

## File Structure

| File | Responsibility |
|---|---|
| `src/ui/panels/DeviceInfoPanel.tsx` | The label/value `<dl>` card. Currently byte-identical in two places. |
| `src/ui/panels/EqualizerPanel.tsx` | Preset pills + fader row + footer caption. |
| `src/ui/panels/TogglesPanel.tsx` | A card of switch rows; renders nothing when empty. |
| `src/ui/panels/AutoPowerOffPanel.tsx` | The labelled `Select` row. |
| `src/ui/panels/autoPowerOff.ts` | `withReportedValue` — pure, the duplicated dropdown-widening rule. |
| `src/ui/panels/autoPowerOff.test.ts` | Unit tests for the above. |
| `src/ui/panels/tree.test-helper.ts` | Element-tree traversal used by the panel tests. Follows the existing `*.test-helper.ts` convention (`src/device/fakeTransport.test-helper.ts`). |
| `src/ui/panels/panels.test.tsx` | Element-tree tests for the four panels. |

Modified: `src/ui/sections/System.tsx`, `Sound.tsx`, `sony/SonySystem.tsx`, `sony/SonySound.tsx`.

---

### Task 1: `DeviceInfoPanel`

The highest-confidence extraction: `System.tsx:178-188` and `sony/SonySystem.tsx:210-220` contain the same `<dl>` with the identical class string `border-border flex items-baseline justify-between gap-4 border-b py-1.5 text-[13px] last:border-b-0`. Sony additionally renders a colour footnote below the list; Sennheiser renders none, so `footnote` is optional.

**Files:**
- Create: `src/ui/panels/tree.test-helper.ts`
- Create: `src/ui/panels/DeviceInfoPanel.tsx`
- Create: `src/ui/panels/panels.test.tsx`
- Modify: `src/ui/sections/System.tsx` (drop the `details` `<dl>` card)
- Modify: `src/ui/sections/sony/SonySystem.tsx` (drop the `details` `<dl>` card, pass the colour footnote)

**Interfaces:**
- Produces: `DeviceInfoPanel(props: DeviceInfoPanelProps)`, `interface DeviceInfoRow { label: string; value: string }`, `interface DeviceInfoPanelProps { title?: string; rows: readonly DeviceInfoRow[]; footnote?: ReactNode }`. Default `title` is `'Device'`.
- Produces (helper, reused by Tasks 3-4): `elements(node: ReactNode): ReactElement[]`, `ofType(node: ReactNode, type: unknown): ReactElement[]`, `text(node: ReactNode): string`.

- [ ] **Step 1: Write the traversal helper**

Components are called as functions here, so the returned tree contains *unrendered* child elements — a `<Card>` appears as an element whose `type` is the `Card` function, with our JSX as its children. That is exactly what these tests assert against.

Create `src/ui/panels/tree.test-helper.ts`:

```ts
import { isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'

const childrenOf = (element: ReactElement): ReactNode =>
  (element.props as { children?: ReactNode }).children

/** Depth-first list of every element in the tree, root first. */
export function elements(node: ReactNode): ReactElement[] {
  const found: ReactElement[] = []
  const visit = (current: ReactNode): void => {
    if (Array.isArray(current)) {
      current.forEach(visit)
      return
    }
    if (!isValidElement(current)) return
    found.push(current)
    visit(childrenOf(current))
  }
  visit(node)
  return found
}

/** Every element of a given component type, e.g. `ofType(tree, Fader)`. */
export function ofType(node: ReactNode, type: unknown): ReactElement[] {
  return elements(node).filter((element) => element.type === type)
}

/** All string and number leaves, space-joined — the tree's visible text. */
export function text(node: ReactNode): string {
  const parts: string[] = []
  const visit = (current: ReactNode): void => {
    if (Array.isArray(current)) {
      current.forEach(visit)
      return
    }
    if (typeof current === 'string' || typeof current === 'number') {
      parts.push(String(current))
      return
    }
    if (!isValidElement(current)) return
    visit(childrenOf(current))
  }
  visit(node)
  return parts.join(' ')
}
```

- [ ] **Step 2: Write the failing test**

Create `src/ui/panels/panels.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'

import { DeviceInfoPanel } from './DeviceInfoPanel'
import { text } from './tree.test-helper'

describe('DeviceInfoPanel', () => {
  it('renders each row as a label/value pair', () => {
    const tree = DeviceInfoPanel({
      rows: [
        { label: 'Model', value: 'MOMENTUM 4' },
        { label: 'Firmware', value: '1.2.3' },
      ],
    })
    const rendered = text(tree)
    expect(rendered).toContain('Model')
    expect(rendered).toContain('MOMENTUM 4')
    expect(rendered).toContain('Firmware')
    expect(rendered).toContain('1.2.3')
  })

  it('defaults the title to Device and overrides it when asked', () => {
    expect(text(DeviceInfoPanel({ rows: [] }))).toContain('Device')
    expect(text(DeviceInfoPanel({ title: 'Headphones', rows: [] }))).toContain('Headphones')
  })

  it('renders a footnote only when given one', () => {
    expect(text(DeviceInfoPanel({ rows: [] }))).not.toContain('unmapped colour')
    expect(
      text(DeviceInfoPanel({ rows: [], footnote: 'unmapped colour' })),
    ).toContain('unmapped colour')
  })
})
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run src/ui/panels/panels.test.tsx`
Expected: FAIL — cannot resolve `./DeviceInfoPanel`.

If it fails on anything mentioning a DOM, `document`, or a missing environment, stop: something has pulled in a DOM assumption. Re-read `src/ui/sections/SystemTail.test.tsx` and conform to it. Do not add a dependency.

- [ ] **Step 4: Write the panel**

Create `src/ui/panels/DeviceInfoPanel.tsx`:

```tsx
import type { ReactNode } from 'react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export interface DeviceInfoRow {
  label: string
  value: string
}

export interface DeviceInfoPanelProps {
  /** Card heading. Defaults to "Device"; drivers may rename it. */
  title?: string
  rows: readonly DeviceInfoRow[]
  /** Rendered under the list. Sony uses it for the unmapped-colour note. */
  footnote?: ReactNode
}

/**
 * A label/value table for whatever a driver knows about the connected device.
 *
 * Takes already-formatted strings: every value here is a display decision the
 * driver has already made (codec names, battery phrasing, em-dash for absent),
 * and re-deriving any of it inside a shared panel would be the panel knowing
 * which driver it is in.
 */
export function DeviceInfoPanel({ title = 'Device', rows, footnote }: DeviceInfoPanelProps) {
  return (
    <Card data-size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="flex flex-col">
          {rows.map(({ label, value }) => (
            <div
              key={label}
              className="border-border flex items-baseline justify-between gap-4 border-b py-1.5 text-[13px] last:border-b-0"
            >
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right font-mono text-xs break-all">{value}</dd>
            </div>
          ))}
        </dl>
        {footnote !== undefined && (
          <p data-testid="device-info-footnote" className="text-muted-foreground mt-3 text-xs">
            {footnote}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx vitest run src/ui/panels/panels.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 6: Adopt it in `System.tsx`**

`details` is already `Array<[string, string]>`. Convert it to rows at the call site rather than changing its shape, keeping this diff to the JSX.

Replace the whole `<Card data-size="sm">` block containing the `Device` title and `<dl>` (currently `src/ui/sections/System.tsx:173-190`) with:

```tsx
      <DeviceInfoPanel rows={details.map(([label, value]) => ({ label, value }))} />
```

Add to the imports:

```tsx
import { DeviceInfoPanel } from '../panels/DeviceInfoPanel'
```

Remove the now-unused `Card`, `CardContent`, `CardHeader`, `CardTitle` imports **only if** nothing else in the file still uses them — `System.tsx` still builds `advanced` and `capabilities` cards, so they stay.

- [ ] **Step 7: Adopt it in `sony/SonySystem.tsx`**

Sony's card carries the colour footnote conditionally. Replace `src/ui/sections/sony/SonySystem.tsx:205-228` with:

```tsx
      <DeviceInfoPanel
        rows={details.map(([label, value]) => ({ label, value }))}
        footnote={
          colour === null && state.info.colour !== null ? (
            <>
              This colour byte is outside Sony's <code>ModelColor</code> enum. See
              <code> docs/PROTOCOL-UNKNOWNS.md</code>.
            </>
          ) : undefined
        }
      />
```

Add to the imports:

```tsx
import { DeviceInfoPanel } from '../../panels/DeviceInfoPanel'
```

- [ ] **Step 8: Verify the refactor changed nothing**

Run: `npm test && npm run lint && npm run build`
Expected: all green. The pre-existing suite is the contract — a failure here means the markup changed.

Then confirm the duplication is actually gone:

Run: `grep -rn "items-baseline justify-between gap-4 border-b py-1.5" src/`
Expected: exactly one hit, in `src/ui/panels/DeviceInfoPanel.tsx`. Match the full class string, not the `last:border-b-0` fragment alone — that utility is used independently by `Devices.tsx`, `SettingRow.tsx` and `ProbePanel.tsx`, and would give three false positives.

- [ ] **Step 9: Report**

Commit the task on the branch, then report the before/after line counts of `System.tsx` and `sony/SonySystem.tsx`, and paste the `grep` output proving one copy remains.

---

### Task 2: `withReportedValue` and `AutoPowerOffPanel`

Both drivers implement the same rule: *the device may report a timeout that is not in our preset list; keep it rather than silently snapping the dropdown to a different value.* `System.tsx:33-39` and `sony/SonySystem.tsx:136-140` are two spellings of it. The rule is pure and worth testing once.

The two call sites differ in ways the panel must keep as props, not branches: trigger width (`w-40` vs `w-44`), hint copy, and the option label function.

**Files:**
- Create: `src/ui/panels/autoPowerOff.ts`
- Create: `src/ui/panels/autoPowerOff.test.ts`
- Create: `src/ui/panels/AutoPowerOffPanel.tsx`
- Modify: `src/ui/sections/System.tsx`
- Modify: `src/ui/sections/sony/SonySystem.tsx`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `interface TimeoutOption { value: number; label: string }`; `withReportedValue(options: readonly TimeoutOption[], reported: number | null, label: (value: number) => string): readonly TimeoutOption[]`; `AutoPowerOffPanel(props: AutoPowerOffPanelProps)`.

- [ ] **Step 1: Write the failing test**

Create `src/ui/panels/autoPowerOff.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { withReportedValue } from './autoPowerOff'

const OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 300, label: '5 minutes' },
  { value: 900, label: '15 minutes' },
]

describe('withReportedValue', () => {
  it('returns the options unchanged when nothing is reported', () => {
    expect(withReportedValue(OPTIONS, null, String)).toEqual(OPTIONS)
  })

  it('returns the options unchanged when the reported value is already listed', () => {
    expect(withReportedValue(OPTIONS, 300, String)).toEqual(OPTIONS)
  })

  it('appends an entry for a reported value that is not listed', () => {
    expect(withReportedValue(OPTIONS, 42, (v) => `${v} seconds`)).toEqual([
      ...OPTIONS,
      { value: 42, label: '42 seconds' },
    ])
  })

  it('does not mutate the options it was given', () => {
    const copy = [...OPTIONS]
    withReportedValue(OPTIONS, 42, String)
    expect(OPTIONS).toEqual(copy)
  })

  it('treats 0 as a real reported value, not as absent', () => {
    expect(withReportedValue([{ value: 300, label: '5 minutes' }], 0, () => 'Off')).toEqual([
      { value: 300, label: '5 minutes' },
      { value: 0, label: 'Off' },
    ])
  })
})
```

That last case is the one worth having: `0` is falsy, and a `!reported` guard would silently drop a genuine "Off" reading.

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/ui/panels/autoPowerOff.test.ts`
Expected: FAIL — cannot resolve `./autoPowerOff`.

- [ ] **Step 3: Write the helper**

Create `src/ui/panels/autoPowerOff.ts`:

```ts
export interface TimeoutOption {
  value: number
  label: string
}

/**
 * The option list to render, given what the device actually reported.
 *
 * A device may report a timeout outside our curated list. Showing the list
 * unchanged would leave the dropdown displaying a value the device is not set
 * to, so the reported value is appended instead. Both drivers had their own
 * copy of this rule; this is the only one.
 */
export function withReportedValue(
  options: readonly TimeoutOption[],
  reported: number | null,
  label: (value: number) => string,
): readonly TimeoutOption[] {
  if (reported === null) return options
  if (options.some((option) => option.value === reported)) return options
  return [...options, { value: reported, label: label(reported) }]
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/ui/panels/autoPowerOff.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the panel**

Create `src/ui/panels/AutoPowerOffPanel.tsx`:

```tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SettingRow } from '../controls/SettingRow'
import type { TimeoutOption } from './autoPowerOff'

export interface AutoPowerOffPanelProps {
  /** Already widened by `withReportedValue`. */
  options: readonly TimeoutOption[]
  value: number | null
  /** Driver's own wording — the two drivers mean different idle conditions. */
  hint: string
  disabled: boolean
  /** Trigger width, which differs between drivers' label lengths. */
  triggerClassName?: string
  onChange(value: number): void
}

/**
 * The "Auto power off" row: a labelled select over timeout options.
 *
 * Renders the row only; the caller decides which card it sits in and what it
 * sits next to, because that ordering is a page decision, not a panel one.
 */
export function AutoPowerOffPanel({
  options,
  value,
  hint,
  disabled,
  triggerClassName = 'w-40',
  onChange,
}: AutoPowerOffPanelProps) {
  return (
    <SettingRow label="Auto power off" hint={hint}>
      <Select
        items={options.map(({ value: seconds, label }) => ({ value: String(seconds), label }))}
        value={value === null ? undefined : String(value)}
        disabled={disabled || value === null}
        onValueChange={(next) => onChange(Number(next))}
      >
        <SelectTrigger className={triggerClassName}>
          <SelectValue placeholder="Not reported" />
        </SelectTrigger>
        <SelectContent>
          {options.map(({ value: seconds, label }) => (
            <SelectItem key={seconds} value={String(seconds)}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  )
}
```

- [ ] **Step 6: Adopt it in `System.tsx`**

Replace the `presets` computation (`src/ui/sections/System.tsx:31-39`) with:

```tsx
  const presets = withReportedValue(
    POWER_OFF_PRESETS.map(({ label, seconds }) => ({ value: seconds, label })),
    powerOffSeconds,
    formatDuration,
  )
```

Replace the `<SettingRow label="Auto power off" ...>` block (`src/ui/sections/System.tsx:129-150`) with:

```tsx
          <AutoPowerOffPanel
            options={presets}
            value={powerOffSeconds}
            hint="When idle and not worn."
            disabled={disabled}
            onChange={(seconds) => void device.setPowerOff(seconds)}
          />
```

Add imports:

```tsx
import { AutoPowerOffPanel } from '../panels/AutoPowerOffPanel'
import { withReportedValue } from '../panels/autoPowerOff'
```

`POWER_OFF_PRESETS` entries are `{ label, seconds }`; the `.map` above is what adapts them to `TimeoutOption`. Do not change `POWER_OFF_PRESETS` itself — it is protocol-facing and used elsewhere.

- [ ] **Step 7: Adopt it in `sony/SonySystem.tsx`**

Replace the `timeouts` computation (`src/ui/sections/sony/SonySystem.tsx:136-140`) with:

```tsx
  const timeouts = withReportedValue(
    AUTO_POWER_OFF_OPTIONS,
    state.autoPowerOff,
    autoPowerOffLabel,
  )
```

Replace the `hasAutoOff && (...)` `SettingRow` block (`src/ui/sections/sony/SonySystem.tsx:159-179`) with:

```tsx
          {hasAutoOff && (
            <AutoPowerOffPanel
              options={timeouts}
              value={state.autoPowerOff}
              hint="When idle and not connected to anything."
              disabled={state.status !== 'connected'}
              triggerClassName="w-44"
              onChange={(seconds) => void device.setAutoPowerOff(seconds)}
            />
          )}
```

Add imports:

```tsx
import { AutoPowerOffPanel } from '../../panels/AutoPowerOffPanel'
import { withReportedValue } from '../../panels/autoPowerOff'
```

`AUTO_POWER_OFF_OPTIONS` is already `{ value, label }`, so it needs no adapting.

- [ ] **Step 8: Verify**

Run: `npm test && npm run lint && npm run build`
Expected: all green.

Run: `grep -rn "silently snapping" src/`
Expected: one hit, in `src/ui/panels/autoPowerOff.ts` — proving both hand-rolled copies of the rule are gone.

- [ ] **Step 9: Report**

Commit the task on the branch, then report both call sites' diffs and the `grep` output.

---

### Task 3: `TogglesPanel`

`Sound.tsx:79-94` and `System.tsx:116-127` both render `Card > CardContent.flex.flex-col` wrapping `ToggleRow`s built from `togglesFor(...)`. Sony writes the same shape by hand with `SettingRow` + `Switch` (`sony/SonySound.tsx:108-120`, `sony/SonySystem.tsx:146-157`).

**Only two of those four sites are adopted here — `Sound.tsx` and `sony/SonySound.tsx`.** An earlier draft of this paragraph claimed "one panel covers all four" while the Files list below named three files and no step ever adopted `sony/SonySystem.tsx`; the site was silently dropped between the rationale and the checklist. Correcting it rather than leaving a contradiction: `System.tsx` and `sony/SonySystem.tsx` place toggle rows inside a card shared with other controls, so neither is adopted (see Step 6).

**Consequence worth knowing:** Sony ends the phase with two toggles that disagree about `null` — DSEE (adopted, so it shows "Not reported by this firmware.") and "Pause when removed" in `SonySystem.tsx` (hand-rolled, so it keeps its own hint). Resolving that means either adopting the fourth site or splitting the panel; both are deliberately out of scope here.

**Files:**
- Create: `src/ui/panels/TogglesPanel.tsx`
- Modify: `src/ui/panels/panels.test.tsx` (add a describe block)
- Modify: `src/ui/sections/Sound.tsx`, `src/ui/sections/System.tsx`, `src/ui/sections/sony/SonySound.tsx`

**Interfaces:**
- Consumes: nothing from Tasks 1-2.
- Produces: `interface ToggleItem { key: string; label: string; hint?: string; value: boolean | null | undefined; disabled?: boolean; onChange(value: boolean): void }`; `TogglesPanel(props: { toggles: readonly ToggleItem[]; disabled: boolean })`.

- [ ] **Step 1: Write the failing test**

Append to `src/ui/panels/panels.test.tsx`:

```tsx
import { ToggleRow } from '../controls/SettingRow'
import { TogglesPanel } from './TogglesPanel'
import { ofType, text } from './tree.test-helper'

describe('TogglesPanel', () => {
  it('renders nothing when there are no toggles', () => {
    expect(TogglesPanel({ toggles: [], disabled: false })).toBeNull()
  })

  it('renders a row per toggle and passes the change handler through', () => {
    const changed: Array<[string, boolean]> = []
    const tree = TogglesPanel({
      disabled: false,
      toggles: [
        {
          key: 'anc',
          label: 'Noise cancelling',
          value: false,
          onChange: (v) => changed.push(['anc', v]),
        },
        { key: 'dsee', label: 'DSEE', value: true, onChange: (v) => changed.push(['dsee', v]) },
      ],
    })

    const rows = ofType(tree, ToggleRow)
    expect(rows).toHaveLength(2)
    expect(text(tree)).toContain('Noise cancelling')
    ;(rows[0].props as { onChange(value: boolean): void }).onChange(true)
    expect(changed).toEqual([['anc', true]])
  })

  it('disables every row when the panel is disabled', () => {
    const tree = TogglesPanel({
      disabled: true,
      toggles: [{ key: 'a', label: 'A', value: true, onChange: () => {} }],
    })
    expect((ofType(tree, ToggleRow)[0].props as { disabled: boolean }).disabled).toBe(true)
  })

  it('disables only the row that asks for it', () => {
    const tree = TogglesPanel({
      disabled: false,
      toggles: [
        { key: 'a', label: 'A', value: true, onChange: () => {} },
        { key: 'b', label: 'B', value: null, disabled: true, onChange: () => {} },
      ],
    })
    const rows = ofType(tree, ToggleRow)
    expect((rows[0].props as { disabled: boolean }).disabled).toBe(false)
    expect((rows[1].props as { disabled: boolean }).disabled).toBe(true)
  })
})
```

Add the two new imports to the top of the file alongside Task 1's, rather than mid-file — oxlint will flag imports after statements.

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/ui/panels/panels.test.tsx`
Expected: FAIL — cannot resolve `./TogglesPanel`. The `DeviceInfoPanel` tests from Task 1 still pass.

- [ ] **Step 3: Write the panel**

Create `src/ui/panels/TogglesPanel.tsx`:

```tsx
import { Card, CardContent } from '@/components/ui/card'
import { ToggleRow } from '../controls/SettingRow'

export interface ToggleItem {
  /** React key and the caller's own identifier; never read by this panel. */
  key: string
  label: string
  hint?: string
  /** `null`/`undefined` means not reported — the row renders disabled. */
  value: boolean | null | undefined
  disabled?: boolean
  onChange(value: boolean): void
}

export interface TogglesPanelProps {
  toggles: readonly ToggleItem[]
  disabled: boolean
}

/**
 * A card of switch rows.
 *
 * Renders nothing at all for an empty list, so a caller can hand it a
 * capability-filtered array without also writing the `length > 0 &&` guard
 * every driver was writing.
 */
export function TogglesPanel({ toggles, disabled }: TogglesPanelProps) {
  if (toggles.length === 0) return null

  return (
    <Card data-size="sm">
      <CardContent className="flex flex-col">
        {toggles.map(({ key, label, hint, value, disabled: rowDisabled, onChange }) => (
          <ToggleRow
            key={key}
            label={label}
            hint={hint}
            value={value}
            disabled={disabled || rowDisabled === true}
            onChange={onChange}
          />
        ))}
      </CardContent>
    </Card>
  )
}
```

If `ToggleRow`'s existing props do not match this call exactly, **read `src/ui/controls/SettingRow.tsx` and conform to it** — do not change `ToggleRow`, and do not guess. Record any mismatch in the report.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/ui/panels/panels.test.tsx`
Expected: PASS — Task 1's 3 tests plus 3 new.

- [ ] **Step 5: Adopt in `Sound.tsx`**

Replace the `soundToggles.length > 0 && (...)` block (`src/ui/sections/Sound.tsx:79-94`) with:

```tsx
      <TogglesPanel
        disabled={disabled}
        toggles={soundToggles.map(({ key, label, description }) => ({
          key,
          label,
          hint: description,
          value: state.toggles[key],
          onChange: (value) => void device.setToggle(key, value),
        }))}
      />
```

The `length > 0` guard goes away — the panel handles it.

Add: `import { TogglesPanel } from '../panels/TogglesPanel'`

- [ ] **Step 6: Adopt in `System.tsx`**

`System.tsx`'s behaviour toggles share a card with the auto-power-off and sidetone rows, so this one is **not** a whole-card replacement. Leave the card structure alone and replace only the `behaviourToggles.map(...)` expression (`src/ui/sections/System.tsx:118-127`) with the rows rendered inline:

```tsx
          {behaviourToggles.map(({ key, label, description }) => (
            <ToggleRow
              key={key}
              label={label}
              hint={description}
              value={state.toggles[key]}
              disabled={disabled}
              onChange={(value) => void device.setToggle(key, value)}
            />
          ))}
```

That is, **`System.tsx` keeps its existing `ToggleRow` loop unchanged**, and so does `sony/SonySystem.tsx`. `TogglesPanel` owns a whole card; these sites are rows inside a card shared with other controls. Note this in the report as a deliberate non-adoption.

**A caveat on the reasoning, so it is not repeated as doctrine.** The original justification was that a card-less mode "would be the panel learning about its callers." That is a false dichotomy and worth naming, because it will come up again: the standard answer is layering, not a mode flag — export `ToggleList` (rows only) and define `TogglesPanel = Card(ToggleList)`. A component that renders rows without a card knows nothing about who wraps it. Non-adoption is still the right call *for now* — splitting is only worth doing when a caller actually needs the rows-only form — but the constraint is scheduling, not design purity, and a third driver whose System view mixes toggles with other rows would be equally unable to reuse this panel.

- [ ] **Step 7: Adopt in `sony/SonySound.tsx`**

Replace the `hasUpscaling && (...)` block (`src/ui/sections/sony/SonySound.tsx:108-120`) with:

```tsx
      <TogglesPanel
        disabled={disabled}
        toggles={
          hasUpscaling
            ? [
                {
                  key: 'dsee',
                  label: 'DSEE',
                  hint: 'Upscales compressed audio towards CD quality.',
                  value: state.upscaling,
                  disabled: state.upscaling === null,
                  onChange: (value) => void device.setUpscaling(value),
                },
              ]
            : []
        }
      />
```

Add: `import { TogglesPanel } from '../../panels/TogglesPanel'`

Leave `sony/SonySystem.tsx`'s `behaviour` card alone — like `System.tsx`, it mixes a toggle row with the auto-power-off row inside one card.

- [ ] **Step 8: Verify**

Run: `npm test && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 9: Report**

Commit the task on the branch, then state which of the four candidate sites adopted the panel (expected: `Sound.tsx` and `sony/SonySound.tsx`) and which deliberately did not, with the reason from Step 6.

---

### Task 4: `EqualizerPanel`

The largest extraction. `Sound.tsx:23-77` and `sony/SonySound.tsx:48-105` render the same card: heading, an unavailable-message branch, a row of preset pills, a fader row, and a footer caption. They differ in preset identity (Sennheiser matches a gains array; Sony compares an enum), band labelling, footer wording, and fader step.

Every one of those differences becomes a prop. None becomes a branch.

**Files:**
- Create: `src/ui/panels/EqualizerPanel.tsx`
- Modify: `src/ui/panels/panels.test.tsx`
- Modify: `src/ui/sections/Sound.tsx`, `src/ui/sections/sony/SonySound.tsx`

**Interfaces:**
- Consumes: nothing from Tasks 1-3.
- Produces:
  - `interface EqPresetOption { id: string; name: string; active: boolean }`
  - `interface EqBand { value: number | undefined; label: string; caption: string }`
  - `interface EqualizerPanelProps { presets: readonly EqPresetOption[]; bands: readonly EqBand[]; range: { min: number; max: number }; step?: number; disabled: boolean; unavailable: string | null; footer: string; onPresetSelect(id: string): void; onBandChange(index: number, value: number): void }`
  - `EqualizerPanel(props: EqualizerPanelProps)`

`unavailable` carries the message to show *instead of* the controls; `null` means render the controls. The caller computes the message because the two drivers word it differently ("This firmware did not answer…" vs "The device did not answer…").

- [ ] **Step 1: Write the failing test**

Append to `src/ui/panels/panels.test.tsx`:

```tsx
import { Button } from '@/components/ui/button'
import { Fader } from '../controls/Fader'
import { EqualizerPanel } from './EqualizerPanel'
import type { EqualizerPanelProps } from './EqualizerPanel'

const BASE: EqualizerPanelProps = {
  presets: [],
  bands: [],
  range: { min: -10, max: 10 },
  disabled: false,
  unavailable: null,
  footer: '',
  onPresetSelect: () => {},
  onBandChange: () => {},
}

describe('EqualizerPanel', () => {
  it('shows the unavailable message instead of controls', () => {
    const tree = EqualizerPanel({
      ...BASE,
      unavailable: 'Connect to load the equaliser.',
      presets: [{ id: 'flat', name: 'Flat', active: true }],
    })
    expect(text(tree)).toContain('Connect to load the equaliser.')
    expect(ofType(tree, Button)).toHaveLength(0)
  })

  it('reports the selected preset by id', () => {
    const picked: string[] = []
    const tree = EqualizerPanel({
      ...BASE,
      presets: [
        { id: 'flat', name: 'Flat', active: true },
        { id: 'bass', name: 'Bass', active: false },
      ],
      onPresetSelect: (id) => picked.push(id),
    })

    const buttons = ofType(tree, Button)
    expect(buttons).toHaveLength(2)
    ;(buttons[1].props as { onClick(): void }).onClick()
    expect(picked).toEqual(['bass'])
  })

  it('marks only the active preset as default variant', () => {
    const tree = EqualizerPanel({
      ...BASE,
      presets: [
        { id: 'flat', name: 'Flat', active: true },
        { id: 'bass', name: 'Bass', active: false },
      ],
    })
    const variants = ofType(tree, Button).map((b) => (b.props as { variant: string }).variant)
    expect(variants).toEqual(['default', 'outline'])
  })

  it('omits the preset row entirely when there are no presets', () => {
    const tree = EqualizerPanel({ ...BASE, footer: '6 bands' })
    expect(ofType(tree, Button)).toHaveLength(0)
    expect(text(tree)).toContain('6 bands')
  })

  it('renders one fader per band, captioned, and reports the band index', () => {
    const changes: Array<[number, number]> = []
    const tree = EqualizerPanel({
      ...BASE,
      bands: [
        { value: 3, label: '100 Hz gain', caption: '100' },
        { value: -2, label: '1 kHz gain', caption: '1k' },
      ],
      onBandChange: (index, value) => changes.push([index, value]),
    })

    const faders = ofType(tree, Fader)
    expect(faders.map((f) => (f.props as { caption: string }).caption)).toEqual(['100', '1k'])
    ;(faders[1].props as { onChange(value: number): void }).onChange(5)
    expect(changes).toEqual([[1, 5]])
  })
})
```

That last assertion is the one worth having: it pins the band **index** the panel reports, which is what both callers use to address the right band.

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run src/ui/panels/panels.test.tsx`
Expected: FAIL — cannot resolve `./EqualizerPanel`. All earlier panel tests still pass.

- [ ] **Step 3: Write the panel**

Create `src/ui/panels/EqualizerPanel.tsx`:

```tsx
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { Fader } from '../controls/Fader'

export interface EqPresetOption {
  /** Opaque to this panel; handed straight back to `onPresetSelect`. */
  id: string
  name: string
  active: boolean
}

export interface EqBand {
  value: number | undefined
  /** Accessible label, e.g. "100 Hz gain in decibels". */
  label: string
  /** Short text under the fader, e.g. "100". */
  caption: string
}

export interface EqualizerPanelProps {
  presets: readonly EqPresetOption[]
  bands: readonly EqBand[]
  range: { min: number; max: number }
  step?: number
  disabled: boolean
  /** A message to show *instead of* the controls, or null to show them. */
  unavailable: string | null
  /** Caption under the faders, e.g. "-10 to +10 dB, reported by the headphones". */
  footer: string
  onPresetSelect(id: string): void
  onBandChange(index: number, value: number): void
}

/**
 * Preset pills over a row of band faders.
 *
 * Which presets exist, whether one is active, how a band is labelled and what
 * the footer says are all decided by the caller. This panel decides only how
 * an equaliser looks — the property that lets a third driver reuse it without
 * either existing driver changing.
 */
export function EqualizerPanel({
  presets,
  bands,
  range,
  step,
  disabled,
  unavailable,
  footer,
  onPresetSelect,
  onBandChange,
}: EqualizerPanelProps) {
  return (
    <Card data-size="sm">
      <CardHeader>
        <CardTitle>Equalizer</CardTitle>
      </CardHeader>
      <CardContent>
        {unavailable !== null ? (
          <p className="text-muted-foreground text-sm">{unavailable}</p>
        ) : (
          <div className="flex flex-col gap-4">
            {presets.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {presets.map(({ id, name, active }) => (
                  <Button
                    key={id}
                    type="button"
                    size="sm"
                    variant={active ? 'default' : 'outline'}
                    disabled={disabled}
                    className={cn('rounded-full', !active && 'text-muted-foreground')}
                    onClick={() => onPresetSelect(id)}
                  >
                    {name}
                  </Button>
                ))}
              </div>
            )}

            <div className="flex justify-between gap-2">
              {bands.map(({ value, label, caption }, index) => (
                <Fader
                  key={index}
                  value={value}
                  onChange={(next) => onBandChange(index, next)}
                  range={range}
                  step={step}
                  disabled={disabled}
                  label={label}
                  caption={caption}
                />
              ))}
            </div>

            <p className="text-muted-foreground text-xs">{footer}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run src/ui/panels/panels.test.tsx`
Expected: PASS — all four describe blocks.

- [ ] **Step 5: Adopt in `Sound.tsx`**

Sennheiser's presets are identified by their gains array, so use the preset name as the id and look it back up on selection. Replace the equalizer `<Card>` (`src/ui/sections/Sound.tsx:23-77`) with:

```tsx
      <EqualizerPanel
        unavailable={
          config === null
            ? state.status === 'connected'
              ? 'This firmware did not answer the equaliser query.'
              : 'Connect to load the equaliser.'
            : null
        }
        presets={
          config !== null && config.bands === EQ_PRESETS[0].gains.length
            ? EQ_PRESETS.map((preset) => ({
                id: preset.name,
                name: preset.name,
                active: matchesPreset(gains, preset.gains),
              }))
            : []
        }
        bands={
          config === null
            ? []
            : Array.from({ length: config.bands }, (_, band) => ({
                value: gains[band],
                label: `${eqBandLabel(band, config.bands)} gain in decibels`,
                caption: eqBandLabel(band, config.bands),
              }))
        }
        range={{ min: config?.minGain ?? 0, max: config?.maxGain ?? 0 }}
        disabled={disabled}
        footer={
          config === null
            ? ''
            : `${config.minGain} to +${config.maxGain} dB, reported by the headphones`
        }
        onPresetSelect={(name) => {
          const preset = EQ_PRESETS.find((p) => p.name === name)
          if (preset) void device.setEqGains(preset.gains)
        }}
        onBandChange={(band, gain) => void device.setEqBand(band, gain)}
      />
```

`matchesPreset` stays in `Sound.tsx` — it encodes Sennheiser's gains-comparison rule, which is driver knowledge and must not move into the panel.

Add: `import { EqualizerPanel } from '../panels/EqualizerPanel'`

- [ ] **Step 6: Adopt in `sony/SonySound.tsx`**

Sony's presets are enum numbers; stringify for the id and parse on the way back. Replace the `hasEq && (...)` `<Card>` (`src/ui/sections/sony/SonySound.tsx:47-106`) with:

```tsx
      {hasEq && (
        <EqualizerPanel
          unavailable={
            eq === null
              ? state.status === 'connected'
                ? 'The device did not answer the equaliser query.'
                : 'Connect to load the equaliser.'
              : null
          }
          presets={OFFERED_PRESETS.map((preset) => ({
            id: String(preset),
            name: eqPresetName(preset),
            active: eq?.preset === preset,
          }))}
          bands={
            eq === null
              ? []
              : eq.gains.map((gain, band) => ({
                  value: gain,
                  label: `Band ${band + 1} gain`,
                  caption: `${band + 1}`,
                }))
          }
          range={EQ_RANGE}
          step={1}
          disabled={disabled}
          footer={
            eq === null
              ? ''
              : `${eq.gains.length} bands, ${EQ_RANGE.min} to +${EQ_RANGE.max} steps · preset ${eqPresetName(eq.preset)}`
          }
          onPresetSelect={(id) => void device.setEqPreset(Number(id) as EqPreset)}
          onBandChange={(band, next) => {
            if (eq === null) return
            const gains = [...eq.gains]
            gains[band] = next
            void device.setEqGains(gains)
          }}
        />
      )}
```

Add: `import { EqualizerPanel } from '../../panels/EqualizerPanel'`

- [ ] **Step 7: Verify the hard rule holds**

Run: `npm test && npm run lint && npm run build`
Expected: all green.

Then prove no panel knows its driver:

Run: `grep -rniE "sony|sennheiser|brand|driver" src/ui/panels/`
Expected: **no output.** Any hit is a violation of spec §3.4 and must be resolved before this task is done — the offending value becomes a prop.

- [ ] **Step 8: Report**

Commit the task on the branch, then report: the `grep` output from Step 7 (expected empty), before/after line counts for `Sound.tsx` and `sony/SonySound.tsx`, and — the point of the whole phase — what a third driver's Sound page would now need to write from scratch.

---

## Self-Review

**Spec coverage.** §5 step 4 names Equalizer (Task 4), DeviceInfo (Task 1), Toggles (Task 3), AutoPowerOff (Task 2), Battery (already shared — see the Scope Note, no task needed). §3.4's hard rule is enforced by an executable grep in Task 4 Step 7, not just stated.

**Type consistency.** `TimeoutOption` is defined in `autoPowerOff.ts` (Task 2) and consumed by `AutoPowerOffPanel` in the same task. `EqPresetOption.id` is `string` at both the produce site and both adopt sites, which is why Sony's numeric enum is stringified in Task 4 Step 6 and parsed back in `onPresetSelect`. `ToggleItem.value` is `boolean | null | undefined`, matching `state.toggles[key]` and Sony's `state.upscaling`.

**Deliberate non-adoptions**, both recorded in-plan rather than discovered mid-task: `System.tsx` and `sony/SonySystem.tsx` keep hand-rolled toggle rows because those rows share a card with other controls, and giving `TogglesPanel` a card-less mode would be the panel learning about its callers.

**Known loose end for phase 5, not this plan.** `SystemTail` still takes `brand: Brand`, and `profileFor(brand, model)` is keyed on it — so spec §3.6's claim that phase 3 deleted `Brand` is not yet true. Phase 4 does not touch it; the file-moves plan must decide whether the profile lookup moves onto the driver descriptor.
