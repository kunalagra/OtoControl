# Mono UI redesign — design

**Status:** approved direction, ready for planning
**Date:** 2026-09-27
**Visual reference:** `docs/design/mono/DESIGN-GUIDE.md`, `docs/design/mono/mockups/{mobile,desktop}.html`

## 1. Goal

Replace OtoControl's current shell (a wide sidebar, a narrow centred column, a
plain top header and a basic bottom tab bar) with the **Mono** design:

- black and white, with one red signal colour;
- big rounded blocks, bold numerals, a dotted texture on hero tiles;
- mobile-first: a floating pill tab bar on phones and a slim left rail on
  desktop;
- a **Home** bento grid as the landing tab.

Also fix the **jittery EQ**. Faders visibly snap back while you drag, and a
preset change looks like bands moving one after another.

Success means all of the following:

- Every driver (Sennheiser, Sony, Nothing, Soundcore, HeyMelody) renders in
  the new shell at 360 px phone width and at ≥ 1024 px desktop width. There is
  no horizontal scroll and no overlap with the pill bar or the iOS home
  indicator.
- Home shows the device, battery, noise controls and an EQ preview on one
  screen at 1280 × 800 without scrolling.
- Dragging an EQ fader never moves the thumb away from the pointer, and
  releasing sends one write per band.
- The existing test suite (945 tests at time of writing) stays green, and the
  new behaviour has tests.

## 2. Non-goals

- New device features, or protocol or driver-state changes beyond the small
  read-only additions in §5.
- Rewriting what each driver's sections contain. Sections change only through
  the shared primitives restyle (§6), plus mechanical class tweaks where a
  hard-coded style fights the new look.
- The mockup's quick-action buttons on Home (Smart pause / Auto-answer). They
  are driver-specific toggles already present in their sections. Deferred.
- A battery time-remaining estimate. No device reports one, and it must not
  be invented.

## 3. Information architecture

### 3.1 Tabs

The shell builds the nav from the driver's sections, with one rule change:

| Tab | Source | Shown when |
|---|---|---|
| **Home** | New shared section, id `home`, owned by the UI layer | always, with a device |
| **Sound** | driver section `sound` | driver declares it |
| **Devices** | driver section `devices` (label "Connections" in drivers) | driver declares it (Sennheiser, Sony) |
| **System** | driver section `system` | always (every driver declares it) |

- The driver section `noise` **leaves the nav**. Its component renders inside
  Home (§4.3).
  - Drivers keep declaring `noise` exactly as today. Sony's capability gate
    still decides whether it exists.
  - The shell, not the driver, hides it from the nav. Implement this in
    `ui/sections/registry.ts` (for example a `navSections(active)` that
    prepends `home` and drops `noise`), so the sidebar, rail and tab bar all
    read one list.
- Hidden sections (`debug`, HeyMelody `heymelody`) stay out of the nav and are
  reached as today, with the back button returning to System.
- **Tab labels:**
  - Rail: "Home", "Sound", "Devices", "System".
  - Pill bar: "Home", "Sound", "Devices", "More". "More" is System's short
    label; the pill bar has no room for longer words.
  - The current `label.split(' ')[0]` hack goes away: each nav entry carries an
    explicit `shortLabel`.
- **Default tab:** `home`. Stale-id handling on a driver switch stays as in
  `AppShell` today.

### 3.2 No device

- With no device granted, there is no nav at all, as today.
- The body shows the NoDevice empty state, restyled as a Mono hero block:
  - the dotted texture;
  - a large "Connect your headphones" heading;
  - the primary button "Connect over serial" and a secondary "Connect over
    Bluetooth", reusing `ConnectionControls` logic.

## 4. Layout

Breakpoint: Tailwind `md` (768 px).

- **Below `md`:** phone layout.
- **At `md` and above:** desktop layout.

The content column max width is 1280 px, replacing today's `max-w-3xl`.

### 4.1 Phone (< 768 px)

Order from top to bottom:

1. **Top bar**, sticky.
   - Left: model name in uppercase caption style, with a chevron that opens
     the device switcher. The switcher is the existing `DeviceSelect` inside
     a popover or sheet.
   - Right: the status token (§4.4), and a menu button that holds Refresh,
     Disconnect, the Add-device pickers and the theme toggle.
   - No device image here. Home carries it.
2. **Section body.**
   - Scrolls. Bottom padding = pill height + 16 px + `env(safe-area-inset-bottom)`.
3. **Floating pill tab bar.**
   - Fixed; 16 px from the sides and 16 px + safe-area from the bottom;
     56 px tall; fully rounded; surface colour with a 1 px border.
   - The active tab is an inverted pill (foreground background, background
     text) with an uppercase 10 px label.
   - Inactive tabs are 55 % opacity text.
   - Icon plus label, or label only if there are more than four tabs.
     There are never more than four today.

Phone Home is a single column: hero → battery + status tiles (2-up grid) →
noise → EQ preview → devices tile.

### 4.2 Desktop (≥ 768 px)

1. **Left rail.**
   - 88 px wide, full height, 1 px right border.
   - From top to bottom:
     - app mark: a 38 px rounded square, inverted, with the letter "O";
     - nav items, each a 64 px wide vertical stack of icon (20 px) over an
       uppercase 9 px label; the active item is an inverted rounded block;
     - spacer;
     - theme toggle (icon only).
2. **Main.**
   - Padding 20 px × 24 px.
   - **Top bar** (not sticky on desktop):
     - left: model name at 22 px / 800 weight, and a "Switch" pill that opens
       `DeviceSelect`;
     - right: the status token, a Refresh pill, a Disconnect pill, and an
       "Add device" pill that opens the two pickers.
   - Then the section body.

**Desktop Home** is a 3-column grid (`1.35fr 1fr 1fr`, 12 px gap) that fills
the remaining height:

- **Column 1:** hero tile, full height.
- **Column 2:** compact battery strip (auto height), then the EQ preview tile
  (fills the rest).
- **Column 3:** the noise section (auto height), then the devices tile (fills
  the rest).
  - When there is no devices tile, the noise section fills the column.

Between 768 and 1100 px the grid drops to 2 columns: hero spans both columns
on top, then battery + EQ on the left and noise + devices on the right.

**Desktop Sound** (the driver's own `sound` component): no layout imposed by
the shell. The restyled `EqualizerPanel` (§7) provides the look:

- at ≥ 1024 px, the preset list sits on the left (260 px) and the fader desk
  on the right;
- toggles render below in a 2-up grid.

### 4.3 Home composition

Home is a new shared component, `ui/sections/Home.tsx`. It renders, in order:

1. **Hero tile.**
   - Dotted texture.
   - Top row: brand caption left; wear caption right ("On head" / "In ear" /
     nothing), from `summary.worn` and `summary.detail`.
   - Centre: `DeviceImage`, up to 320 × 260, `object-fit: contain`, **in
     colour** (see the design guide on the greyscale mockup).
   - Bottom row: up to three fact chips (caption over value). Each chip shows
     only when its value is non-null:
     - **Codec** from `summary.codec`;
     - **Firmware** from `summary.firmware` (new, §5.1);
     - **Links** from `connections` (§5.3) as `connected/total`.
2. **Battery tile.**
   - Phone: large white block with a big percentage.
   - Desktop: compact strip showing the percentage at 40 px, the "Battery"
     caption, and a 10-segment bar.
   - When `summary.cells` (§5.1) has more than one cell, show one row per cell
     (L / R / Case) with a small segment bar each, instead of a single number.
   - Charging shows a bolt glyph and the caption "Charging".
   - When not connected, show "—" and the caption "Live only". Battery is
     never cached; this matches the current sidebar rule.
3. **Noise.**
   - Render the driver's own `noise` section component (via `componentFor`)
     unchanged, in this slot.
   - If the driver has no `noise` section (Sony without the capability), omit
     the slot.
4. **EQ preview tile.**
   - Dotted texture.
   - Caption "Equalizer", "Open ↗" link, preset name at 30 px / 800, then one
     rounded bar per band. Bar height maps gain onto range. The largest
     positive band is drawn in signal red.
   - The whole tile is a button that navigates to `sound`.
   - Uses `eqPreview` (§5.2). If a driver doesn't implement it, or it returns
     null, the tile shows the caption, "Sound settings" and the arrow only.
5. **Devices tile**, only if the driver has a `devices` section.
   - Uses `connections` (§5.3): one row per known source (name, "· this"
     marker, and a filled or hollow dot).
   - The tile is a button that navigates to `devices`.
   - If the driver doesn't implement `connections`, the tile shows
     "Connections ↗" only.

The idle rule is unchanged: when not connected, the section body is dimmed and
non-interactive. The hero and top bar stay at full strength.

### 4.4 Status token

| State | Look |
|---|---|
| connected | "● LIVE", uppercase 11 px, letter-spacing .1em, signal red |
| connecting | spinner + "CONNECTING", muted |
| disconnected (device known) | inverted pill "DISCONNECTED", foreground background |
| no device | "NO DEVICE", muted |

Errors keep the existing bordered destructive message under the top bar.

## 5. Data additions (read-only, UI tier)

All additions are optional and additive. A driver that doesn't implement one
gets the fallback described in §4.3. No protocol changes.

### 5.1 `DeviceSummary` (in `ui/device/summary.ts`)

Add two fields:

```ts
firmware: string | null
/** Every battery cell the device reports, in display order. Empty when unknown. */
cells: { label: 'Battery' | 'L' | 'R' | 'Case'; level: number; charging: boolean }[]
```

Fill both in each driver's branch of `summarise`, from state the drivers
already hold:

- **Sony:** `battery.left/right` or `singleBattery`; firmware from
  `info.firmware`, if present.
- **Nothing:** left, right, case and single cells.
- **Soundcore:** left and right cells.
- **HeyMelody:** the `battery[]` cells, with their existing side labels.
- **Sennheiser:** a single cell.

Each driver's firmware field is whatever its state already calls it. If a
driver has none, return `null`.

Keep `battery` (the minimum across cells) for the existing callers.

### 5.2 `eqPreview` (optional driver method)

```ts
interface EqPreview {
  preset: string | null     // display name, e.g. "Rock"; null when custom/unknown
  gains: number[]           // one per band, dB
  range: { min: number; max: number }
}
eqPreview?(state: S): EqPreview | null
```

Add it to the driver descriptor type in `core/driver.ts`. Implement it for
every driver that already exposes EQ gains and preset names in state. Each is
a few lines built from data its Sound section already reads.

### 5.3 `connections` (optional driver method)

```ts
interface ConnectionSummary { name: string; connected: boolean; isThisDevice: boolean }
connections?(state: S): ConnectionSummary[] | null
```

Implement it for Sennheiser and Sony from the state their Devices sections
already render.

## 6. Visual system

Full values are in the design guide. The spec-level requirements:

### 6.1 Tokens

- Rewrite `src/index.css` `:root` (light) and `.dark` (dark) to the Mono
  palette.
  - Dark: background `#000`, surface `#111`, raised `#1d1d1d`, foreground
    `#fff`, muted foreground `#888`, border `#1f1f1f`.
  - Signal red `#ff4d3d` becomes both `--primary` and a new `--signal` token.
  - Light inverts: background `#fff`, surface `#f2f2f2`, foreground `#000`,
    with the same red.
- `--radius` becomes 1rem, for shadcn's derived radii. Mono surfaces use the
  explicit sizes in the design guide §3 (blocks 26 px, chips and segments
  14 px, pills fully rounded) rather than the derived scale.
- Add a `.mono-dots` utility for the dotted texture.
- Keep the existing token names so shadcn components keep working.

### 6.2 Primitives restyle (`src/components/ui/*`)

- **Card:** 26 px radius, surface background, no border, no shadow, 18 px
  padding; `CardTitle` becomes the uppercase caption style.
  - This single change restyles every driver section: 17 Card imports across
    drivers.
- **Button:**
  - default = inverted (foreground background);
  - `outline` = raised surface, no border;
  - `ghost` = text only;
  - pill radius for `size="sm"`, 14 px radius otherwise.
- **Switch:** 40 × 24 track. Off: `#2a2a2a` track, grey knob. On: foreground
  track, background knob.
- **Slider** (Base UI, used by Nothing, Sony, Sennheiser): 8 px track with a
  foreground fill and a 20 px round thumb. Use signal red while dragging.
- **ToggleGroup** (segmented choices, e.g. Soundcore modes, Sennheiser ANC
  modes): equal-width 14 px-radius blocks on raised surface; the selected one
  is signal red with black 700-weight text (see §8).
- **Select, Badge, Tabs, Separator:** adjust colours and radius to the tokens.
  No structural change.

### 6.3 Typography

Keep Geist Variable, with three roles:

- **Caption:** 10 px, uppercase, letter-spacing .14em, muted.
- **Body:** 13 px.
- **Display numerals:** 800–850 weight, negative tracking, tabular-nums.

Readouts (dB, %) use tabular-nums.

### 6.4 Motion

- No transitions on anything that follows the pointer: fader fills, slider
  thumbs, knob arcs. The existing Fader comment explains why.
- 150 ms ease-out on tab and segment selection colour only.
- Honour `prefers-reduced-motion`.

## 7. EQ: new fader and jitter fix

### 7.1 Root cause (to confirm with a failing test before fixing)

`Fader` fires `onChange` on every input tick. Sennheiser wires that straight
to `device.setEqBand`, which does an optimistic write, then a device write,
then a rollback to `previous`. `previous` was captured when *that tick's*
call began.

Overlapping writes mean two things:

- a late reply or a rollback from an earlier tick overwrites the newer
  optimistic value, so the thumb snaps back;
- the device gets a burst of writes per drag.

Nothing (`onValueChange` → `setCustomEq`/`setAdvancedEqBands`) and the
Sennheiser/Sony noise, ambient and sidetone sliders follow the same per-tick
pattern. HeyMelody's `CurveEditor` already avoids it with a local draft.

### 7.2 Fix

1. **Draft while dragging, commit on release.**
   - `Fader` keeps a local draft value while the pointer or keyboard
     interaction is active and renders from the draft.
   - It calls a new `onCommit(value)` once, on release (pointerup, change end
     or keyboard commit).
   - While a draft is active, incoming `value` prop changes are ignored for
     rendering. After commit, the prop wins again.
   - Rename or keep `onChange` as the per-tick hook only for callers that want
     live preview. No current caller should write to the device from it.
2. **`EqualizerPanel`** exposes `onBandCommit(index, value)` and drops per-tick
   writes. Sennheiser, Sony and Soundcore callers switch to it.
3. **Base UI `Slider` callers that write to a device** switch from
   `onValueChange` to local draft + `onValueCommitted`, following the pattern
   in `drivers/heymelody/sections/Sound.tsx`:
   - Nothing EQ and bass;
   - Sony ambient level;
   - Sennheiser sidetone;
   - any other slider that writes to a device.

   Extract a small shared hook, `useCommittedValue(value)`, returning
   `[draft, setDraft, commit]`, so the pattern isn't repeated six times.
4. **Driver rollback safety (Sennheiser `setEqBand`).**
   - Roll back to the last *confirmed* gains, not the gains captured at call
     start.
   - Drop a stale rollback when a newer write to the same band is in flight.
   - Mirror HeyMelody's `#confirmedEq`.
5. **Presets:** selecting a preset updates every fader in the same render; no
   per-band staggering in the UI. Sennheiser applies a preset "one band at a
   time — there is no bulk set" on the wire. The optimistic state for all
   bands must be set once, before the sequential writes, and never re-applied
   band by band.

### 7.3 New fader look

The chunky Mono fader:

- 44 px wide rounded track on raised surface;
- the fill grows from the 0 dB line (up for boost, down for cut), in
  foreground;
- a 1 px zero line at 30 % foreground;
- the readout above (18 px / 800, tabular, signed, one decimal);
- the band caption below in the caption style;
- the active or dragged band draws its fill and readout in signal red, with a
  2 px signal ring on the track;
- the native range input stays as the interaction layer, keeping keyboard
  support and accessibility, exactly as today.

Height: 220 px on the phone Sound tab, filling the desk on desktop (minimum
240 px).

The **preset list** on desktop is rows of name + a 5-bar mini preview. On
phones it is a 4-column chip grid. The active preset is inverted, with its
peak mini-bar in red. Preview bars come from the same gains the panel already
receives, or are omitted if the caller doesn't supply per-preset gains.
`EqPresetOption` gains an optional `gains?: number[]`.

## 8. Accessibility

- Nav: `<nav aria-label="Sections">`, `aria-current="page"` on the active
  item.
  - Rail and pill bar are the same component with two layouts, not two
    copies.
- Touch targets ≥ 44 × 44 px on phones (pill tabs, chips, switches, fader
  hit area).
- Contrast (WCAG relative luminance):
  - muted `#888` is 5.9 : 1 on `#000` and 5.3 : 1 on `#111`, so it passes AA;
  - signal red `#ff4d3d` is 6.4 : 1 on black, so it is fine as text;
  - white on red is only 3.3 : 1, which fails AA for normal text. Labels on a
    red fill (the selected segment, the active preset's red elements) are
    therefore **black** (6.4 : 1), not white as in the mockup;
  - in light mode, red on white is 3.3 : 1, so red there is for fills and
    marks only. Red text in light mode uses `--signal-strong` `#d92b1c`
    (4.9 : 1).
- The focus ring is visible on every control: a 2 px foreground outline with a
  2 px offset.

## 9. Testing

Vitest with Testing Library, following the existing `panels.test.tsx` and
`tree.test-helper` style.

- **Nav:**
  - each driver fixture yields the expected tabs (Sennheiser: Home, Sound,
    Devices, System; Nothing: Home, Sound, System; Sony without the noise
    capability: Home still first);
  - hidden sections are never in the nav;
  - `noise` is never a tab.
- **Home:**
  - renders the driver's noise component;
  - the EQ tile falls back when `eqPreview` is absent;
  - the devices tile appears only with a `devices` section;
  - the battery shows per-cell rows when there are more than one cell;
  - battery shows "—" when disconnected.
- **Fader:**
  - a drag emits zero device writes until release, then exactly one
    `onCommit`;
  - a prop change mid-drag doesn't move the rendered value;
  - keyboard arrows commit once per key press.
- **Sennheiser `setEqBand`:** two overlapping writes where the first fails
  leave the second's value in state (RED first, per §7.1).
- **Slider callers:** one committed write per interaction (Nothing EQ is the
  representative case).
- **Manual check:** run the dev server with no device (empty state) and with a
  device if available. Check at 390 px and 1280 px widths, in light and dark.

## 10. Implementation order (suggested)

1. Tokens + primitives restyle. Every section changes look; there are no
   behaviour changes.
2. `useCommittedValue` + Fader rewrite + `EqualizerPanel` commit API + caller
   migrations + the Sennheiser rollback fix. This is the jitter fix, with tests.
3. Nav model (`navSections`, `shortLabel`) + the shared nav component (rail or
   pill) + top bar; remove the old `Sidebar` / `MobileHeader` / `MobileNav`.
4. Summary additions + `eqPreview` / `connections` + the Home section.
5. NoDevice restyle, the responsive pass, and the accessibility pass.
