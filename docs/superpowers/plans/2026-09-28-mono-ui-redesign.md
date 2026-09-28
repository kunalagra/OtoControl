# Mono UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace OtoControl shell with Mono design (bento Home, rail/pill nav, chunky EQ faders) and fix EQ jitter.

**Architecture:** Tokens-first restyle of shadcn primitives, then commit-on-release interaction fix (useCommittedValue + Fader + EqualizerPanel), then new shell (nav model + Nav + TopBar + Home), reusing existing drivers/sections unchanged.

**Tech Stack:** React 19 + Vite + Tailwind v4 + shadcn/base-luma + Base UI + Remix icons + Vitest/Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-27-mono-ui-redesign-design.md`
**Design guide:** `docs/design/mono/DESIGN-GUIDE.md` (wins on look; spec wins on behaviour)
**Mockups:** `docs/design/mono/mockups/mobile.html`, `docs/design/mono/mockups/desktop.html` (static, greyscale render superseded — ship colour; labels on red are black)

## Global Constraints

- Dark (`.dark`) is primary: `--background:#000000`, `--card:#111111`, `--surface-raised:#1d1d1d`, `--muted:#1f1f1f`, `--segment-off:#2a2a2a`, `--foreground:#ffffff`, `--muted-foreground:#888888`, `--border:#1f1f1f`, `--primary/--signal:#ff4d3d`, `--primary-foreground:#000000`, `--ring:#ffffff`.
- Light (`:root`): `--background:#ffffff`, `--card:#f2f2f2`, `--surface-raised:#e6e6e6`, `--muted:#e6e6e6`, `--segment-off:#d4d4d4`, `--foreground:#000000`, `--muted-foreground:#6b6b6b`, `--border:#e0e0e0`, `--signal:#ff4d3d`, `--signal-strong:#d92b1c`, `--ring:#000000`. Red text in light uses `--signal-strong`.
- Labels on red fills are black (`#000`), never white. White-on-red (3.3:1) fails AA.
- Block 26px radius, inner chip/segment/button 14px, pills full, block padding 18px (phone 14px), grid gap 12px (phone 8px). No borders/shadows except pill bar + list dividers.
- Numbers use `tabular-nums`. Caption 10px/500/uppercase/tracking .14em/muted. Hero numeral phone 44px desktop 40px/850/tracking -.04em.
- Motion: zero transition under pointer; 150ms ease-out on selection colour/switch knob only; honour `prefers-reduced-motion`. Tab change is instant swap.
- Touch targets ≥44px on phones (hit slop, not visual growth). Focus: 2px foreground outline + 2px offset.
- Nav `aria-label="Sections"`, `aria-current="page"` on active. Rail+pill are one component, two layouts.
- No invented data: unknown shows "—"; hide tile if driver lacks data; never fake battery/codec.
- Existing suite (945 tests) stays green. TDD: failing test first, minimal code, full `npm test` per task.
- Keep shadcn token names in `src/index.css` so `components/ui/*` keep working.

## Review Focus

- 390px phone width with pill bar: content never hidden behind pill or iOS home indicator (bottom padding = pill + 16px + safe-area).
- Sony without noise capability: Home omits noise slot, nav still Home-first, no crash.
- Disconnected device: battery shows "—" + "Live only", hero/topbar full strength, body dimmed non-interactive.
- Rapid preset tap + mid-drag prop change: exactly one write per band on release, no thumb snap-back, no per-band stagger.
- Light mode red text uses `--signal-strong` (#d92b1c), not `#ff4d3d`.

---

### Task 1: Mono tokens + dots utility

**Files:**
- Modify: `src/index.css`
- Test: `src/index.css` (manual computed-style check via existing theme test harness) + `src/ui/theme.test.ts` if present

**Interfaces:**
- Consumes: DESIGN-GUIDE §2 table, spec §6.1
- Produces: CSS vars `--surface-raised`, `--signal`, `--signal-strong`, `--segment-off`, `.mono-dots` consumed by Tasks 2–6

- [ ] **Step 1: Write failing check** — add test asserting `.dark` sets `--background:#000000`, `--card:#111111`, `--primary:#ff4d3d`, and `.mono-dots` class exists with 12px radial texture. Run `npm test` → FAIL (values differ, class missing).
- [ ] **Step 2: Rewrite `:root` + `.dark`** to DESIGN-GUIDE §2 values verbatim (dark table + light table), set `--radius:1rem`, add `--surface-raised/--signal/--signal-strong/--segment-off` in both themes, add `.mono-dots` (12px, 12% foreground) + `.mono-dots-fader` variant (10px, 8%).
- [ ] **Step 3: Run** `npm test` → PASS; run `npx tsc -b` → exit 0.
- [ ] **Step 4: Commit** `feat(mono): mono design tokens and dots texture`.

### Task 2: Primitives restyle (Card/Button/Switch/Slider/ToggleGroup/Select/Badge/Tabs/Separator)

**Files:**
- Modify: `src/components/ui/card.tsx`, `button.tsx`, `switch.tsx`, `slider.tsx`, `toggle-group.tsx`, `select.tsx`, `badge.tsx`, `tabs.tsx`, `separator.tsx`
- Test: extend `src/ui/panels/panels.test.tsx`-style render checks (new `src/components/ui/mono.test.tsx`)

**Interfaces:**
- Consumes: Task 1 vars; DESIGN-GUIDE §5.1–5.5
- Produces: restyled primitives used by all drivers + Tasks 4–6

- [ ] **Step 1: Write failing tests** — Card has `rounded-[26px] bg-card p-[18px]` no ring/shadow, CardTitle is caption style; Button `default`=inverted, `outline`=raised no border, `sm`=pill, new `signal` variant (`bg-signal text-black font-bold`); Switch 40×24 off `#2a2a2a`/`#777` on foreground/background; Slider 8px track `--segment-off`, fill foreground, 20px thumb, `data-dragging` → signal; ToggleGroup equal blocks 14px raised, selected signal/black bold. Run → FAIL.
- [ ] **Step 2: Implement** per DESIGN-GUIDE §5.1–5.5 + spec §6.2. Keep component APIs; add `signal` variant to Button; Card `variant`/`hero`/`inverted` via classes (no breaking props).
- [ ] **Step 3: Run** `npm test` + `npx tsc -b` → PASS.
- [ ] **Step 4: Commit** `feat(mono): restyle primitives to mono`.

### Task 3: Jitter fix — useCommittedValue + Fader + EqualizerPanel + Sennheiser rollback

**Files:**
- Create: `src/ui/controls/useCommittedValue.ts`
- Modify: `src/ui/controls/Fader.tsx`, `src/ui/panels/EqualizerPanel.tsx`, `src/drivers/sennheiser/device.ts`, callers: `src/drivers/sennheiser/sections/Sound.tsx`, `src/drivers/sony/sections/*Sound*`, `src/drivers/soundcore/sections/SoundcoreSound.tsx`, `src/drivers/nothing/sections/NothingSound.tsx` (EQ+bass), `src/drivers/sony/sections/SonyNoise.tsx`, `src/drivers/sennheiser/sections/Noise.tsx`, `src/drivers/sennheiser/sections/System.tsx` (sidetone), `src/drivers/soundcore/sections/*Noise*` `*System*`
- Test: `src/ui/controls/Fader.test.tsx` (new), `src/ui/panels/EqualizerPanel.test.tsx` (extend), `src/drivers/sennheiser/device.test.ts` (overlap test)

**Interfaces:**
- Consumes: spec §7; HeyMelody `CurveEditor` pattern
- Produces: `useCommittedValue(value): [draft,setDraft,commit]`; `Fader({value,onCommit,onChange?,...})` with draft-while-drag + ignore-props-mid-drag; `EqualizerPanel({onBandCommit, presets gains?})`; fixed `setEqBand`

```ts
export function useCommittedValue<T>(value: T): [T, (v: T) => void, (v: T) => void]
export interface EqPresetOption { id: string; name: string; active: boolean; gains?: number[] }
```

- [ ] **Step 1: RED — Fader drag test**: drag emits 0 device writes until release then exactly one `onCommit`; prop change mid-drag doesn't move render; keyboard arrow commits once. Sennheiser test: two overlapping `setEqBand` where first fails leaves second's value. Run → FAIL.
- [ ] **Step 2: Implement `useCommittedValue`** (draft + commit, null-reset pattern from HeyMelody).
- [ ] **Step 3: Rewrite `Fader`** to Mono look (44px track, raised, zero line 1px 30% foreground, fill from zero, readout 18/800 signed 1-decimal tabular, caption below, active ring-2 signal + signal fill/readout when active/dragging, native range invisible on top, 150ms only on selection colour, none on position).
- [ ] **Step 4: Update `EqualizerPanel`** — `onBandCommit(index,value)` replaces per-tick writes; preset list: desktop rows (name + 5-bar mini preview, active inverted + peak signal) ≥1024px 260px left + fader desk right; phone 4-col chip grid; "Reset to Flat" sm pill only if Flat exists; preset select sets all bands in one render.
- [ ] **Step 5: Migrate callers** — Sennheiser/Sony/Soundcore Sound → `onBandCommit`; Nothing EQ+bass, Sony ambient, Sennheiser sidetone + noise sliders, Soundcore sliders → draft + `onValueCommitted`.
- [ ] **Step 6: Fix Sennheiser `setEqBand`** — rollback to last confirmed gains (mirror HeyMelody `#confirmedEq`), drop stale rollback when newer write in flight.
- [ ] **Step 7: Run** `npm test` (full) + `npx tsc -b` → PASS.
- [ ] **Step 8: Commit** `fix(eq): draft-while-drag commit-on-release, mono faders`.

### Task 4: Nav model + Nav + TopBar shell

**Files:**
- Modify: `src/ui/sections/registry.ts`, `src/ui/layout/AppShell.tsx`
- Create: `src/ui/layout/Nav.tsx`, `src/ui/layout/TopBar.tsx`, `src/ui/layout/StatusToken.tsx`
- Delete/refactor: `src/ui/layout/Sidebar.tsx`, `src/ui/layout/MobileChrome.tsx` (remove old Sidebar/MobileHeader/MobileNav)
- Test: `src/ui/layout/nav.test.tsx` (new)

**Interfaces:**
- Consumes: spec §3–4, DESIGN-GUIDE §5.9–5.11
- Produces: `navSections(active): Section[]` (prepend home, drop noise, explicit `shortLabel`); `<Nav>` rail+pill; `<TopBar>`; `<StatusToken>`; `AppShell` with default tab `home`, max-w 1280px

```ts
export interface Section extends DriverSection { icon: RemixiconComponentType; shortLabel: string }
export function navSections(active: ActiveDevice): Section[]
```

- [ ] **Step 1: RED nav tests** — Sennheiser → Home,Sound,Devices,System; Nothing → Home,Sound,System; Sony w/o noise capability → Home first, no noise tab; `noise` never in nav; hidden never in nav; shortLabels Home/Sound/Devices/More(System pill). Run → FAIL.
- [ ] **Step 2: Implement `navSections` + `shortLabel`** (drop `label.split(' ')[0]` hack; add `home` icon `RiHeadphoneLine`).
- [ ] **Step 3: Build `Nav`** — one component two layouts: rail ≥md 88px border-r, items 64px rounded-2xl icon20+9px label, active inverted bold, inactive #777; pill <md fixed inset-x-4 bottom 16px+safe-area h-14 rounded-full bg-card border, active inverted pill 10px uppercase. `<nav aria-label="Sections">`.
- [ ] **Step 4: Build `StatusToken` + `TopBar`** — LIVE red 8px dot (no pulse) / CONNECTING spinner muted / DISCONNECTED inverted pill / NO DEVICE muted; phone sticky 52px bg-background/85 blur, model caption button + switcher + ⋯ menu; desktop static Title 22/800 + Switch pill + Refresh/Disconnect/Add pills (Add = popover with 2 pickers). Reuse `DeviceSelect`, `ConnectionControls` logic.
- [ ] **Step 5: Rewrite `AppShell`** — max-w 1280px, phone order topbar→body→pill (body padding pill+16+safe-area), desktop rail 88px + main 20×24px, default `home`, stale-id handling preserved, idle dim (hero+topbar full strength), error banner unchanged. Delete old components.
- [ ] **Step 6: Run** `npm test` + `npx tsc -b` → PASS.
- [ ] **Step 7: Commit** `feat(mono): rail/pill nav and topbar shell`.

### Task 5: Summary additions + eqPreview/connections + Home section

**Files:**
- Modify: `src/ui/device/summary.ts`, `src/core/driver.ts`
- Create: `src/ui/sections/Home.tsx`, `src/ui/controls/SegmentMeter.tsx`
- Modify per driver: `src/drivers/{sennheiser,sony,nothing,soundcore,heymelody}/driver.ts` (+ state readers)
- Test: `src/ui/sections/Home.test.tsx` (new), extend `src/ui/device/*` summary tests

**Interfaces:**
- Consumes: spec §4.3 + §5, DESIGN-GUIDE §5.6/5.12
- Produces: `DeviceSummary{firmware,cells[]}`; `eqPreview(state)`, `connections(state)`; `<Home>` + `<SegmentMeter>`

```ts
cells: { label: 'Battery'|'L'|'R'|'Case'; level: number; charging: boolean }[]
interface EqPreview { preset: string|null; gains: number[]; range: {min:number;max:number} }
interface ConnectionSummary { name: string; connected: boolean; isThisDevice: boolean }
eqPreview?(state: S): EqPreview | null
connections?(state: S): ConnectionSummary[] | null
```

- [ ] **Step 1: RED Home tests** — renders driver noise component; EQ tile fallback when `eqPreview` absent; devices tile only with devices section; multi-cell → per-cell rows; disconnected → "—". Run → FAIL.
- [ ] **Step 2: Extend `DeviceSummary`** (firmware + cells per spec §5.1 table; keep `battery`=min).
- [ ] **Step 3: Add `eqPreview`/`connections`** to `DeviceDriver` type + implement per driver (Sennheiser single, Sony left/right|single + firmware, Nothing L/R/case/single, Soundcore L/R, HeyMelody battery[]; connections for Sennheiser+Sony).
- [ ] **Step 4: Build `SegmentMeter`** — N segments (battery 10, noise 20), 8–16px tall 3px radius gap 2–3px, lit foreground (black on inverted), unlit `--segment-off`, `tone` prop; interactive use = meter visual + invisible range via `useCommittedValue`.
- [ ] **Step 5: Build `Home`** — hero (dots, brand/wear caps, DeviceImage ≤320×260 colour contain, ≤3 fact chips Codec/Firmware/Links `connected/total`); battery (phone inverted big % / desktop strip 40px + 10-seg + charging bolt; per-cell rows when >1 cell; "—"+"Live only" when disconnected); noise via `componentFor` (omit if absent); EQ preview (dots, caption + Open↗, preset 30/800, bars rounded-10px peak signal, whole tile → sound, fallback caption+arrow); devices tile (rows name + ·this + dot, →devices, fallback "Connections ↗"). Phone single col; desktop 3-col `1.35fr 1fr 1fr` (768–1100px 2-col hero spans).
- [ ] **Step 6: Run** `npm test` + `npx tsc -b` → PASS.
- [ ] **Step 7: Commit** `feat(mono): home bento with battery, eq preview, devices`.

### Task 6: NoDevice + responsive + a11y + visual sign-off

**Files:**
- Modify: `src/ui/sections/NoDevice.tsx`, responsive gaps/padding in `AppShell`/`Home`/`EqualizerPanel`, focus styles
- Test: manual + `npm test`, `npx tsc -b`, `npm run build`, dev-server screenshots

**Interfaces:**
- Consumes: spec §3.2/§8/§9, DESIGN-GUIDE §5.13
- Produces: shippable Mono UI at 390px + 1280px, dark + light

- [ ] **Step 1: Restyle `NoDevice`** — one `.mono-dots` hero filling body: `RiHeadphoneLine` 96px 30% foreground, heading 30/850 "Connect your headphones", one-line muted explainer, `default` "Connect over serial" + `outline` "Connect over Bluetooth" (reuse `ConnectionControls` logic).
- [ ] **Step 2: Responsive pass** — 360px phone + ≥1024px desktop no h-scroll/overlap; content col 1280px; phone 16px sides, desktop 20×24px; block pad 14px phone; gap 8px phone; fader height 220px phone, ≥240px desktop fill.
- [ ] **Step 3: A11y pass** — nav semantics, 44px targets (hit slop), contrast (muted #888 AA, red fills black text, light red text `--signal-strong`), 2px foreground focus ring +2px offset, `prefers-reduced-motion` disables selection transitions.
- [ ] **Step 4: Verify** — `npm test` (945+new green), `npx tsc -b`, `npm run build`, `npm run lint`; dev server screenshots 390px + 1280px × dark/light vs mockups.
- [ ] **Step 5: Commit** `feat(mono): empty state, responsive and a11y pass`.
