# Mono design guide

The visual language for OtoControl. It pairs with the behaviour spec
`docs/superpowers/specs/2026-09-27-mono-ui-redesign-design.md`. Where the two
disagree, the spec wins on behaviour and this guide wins on look.

Reference mockups: open these files directly in a browser. They load the
checked-in M4 render from `public/`.

- `mockups/mobile.html`: phone Home and Sound, with the floating pill bar.
- `mockups/desktop.html`: desktop Home (bento) and Sound (fader desk), with
  the left rail.

The mockups are static HTML with hard-coded M4 values. Treat them as the
target *look*, not as data. Three details in them are superseded:

- The device render is **greyscale** in the mockup. Ship it **in colour**:
  `DeviceImage` already tints by the device's real colour, and that is the
  one place colour belongs besides the signal red.
- Labels on red fills are **black**, not white. White on red fails contrast;
  see the spec §8.
- Values such as firmware "2.12.4" and devices "Pixel 8" are placeholders.

---

## 1. Principles

1. **Two colours and a signal.** Black, white and greys do all the work. Red
   `#ff4d3d` means exactly one of these: *selected*, *live*, or *the value
   you are changing*. Never use it for decoration. If two things on screen
   are red, one of them is probably wrong.
2. **Blocks, not borders.** Group with filled rounded blocks on a darker
   ground. Don't use outlines or drop shadows. A 1 px border appears only on
   floating chrome (the pill bar) and dividers inside lists.
3. **Numbers are the heroes.** Battery, dB and noise level are set big and
   heavy. Labels are small uppercase captions that step back.
4. **Texture marks the showpiece.** The dotted grid appears only on hero
   tiles (device hero, EQ preview, fader desk, empty state), at most three
   per screen.
5. **Direct manipulation, zero lag.** Anything under the finger moves with no
   transition. Only selection state animates (150 ms).

---

## 2. Colour tokens

Keep the existing shadcn token names in `src/index.css` so all
`components/ui/*` keep working. Replace their values, and add the three Mono
tokens (`--surface-raised`, `--signal`, `--signal-strong`).

### Dark (`.dark`), the primary theme

| Token | Value | Use |
|---|---|---|
| `--background` | `#000000` | page |
| `--card` / `--popover` | `#111111` | blocks, menus |
| `--surface-raised` (new) | `#1d1d1d` | buttons, unselected segments, fader track, chips inside blocks |
| `--muted` | `#1f1f1f` | tracks, unlit segments, dividers |
| `--foreground` / `--card-foreground` | `#ffffff` | text, fills, active nav |
| `--muted-foreground` | `#888888` | captions, secondary text |
| `--border` / `--input` | `#1f1f1f` | list dividers, pill-bar border |
| `--primary` | `#ff4d3d` | selected / live / active (= signal) |
| `--primary-foreground` | `#000000` | text on red |
| `--signal` (new) | `#ff4d3d` | same as primary, named for intent |
| `--signal-strong` (new) | `#ff4d3d` | red *text* (in dark mode, same as signal) |
| `--secondary` | `#1d1d1d` | |
| `--secondary-foreground` | `#ffffff` | |
| `--accent` | `#1d1d1d` | hover surface |
| `--accent-foreground` | `#ffffff` | |
| `--destructive` | `#ff4d3d` | errors. Always paired with text or an icon, never colour alone |
| `--ring` | `#ffffff` | focus ring |
| `--sidebar*` | map to background / card / foreground equivalents | the rail |

**Unlit segment:** `#2a2a2a`. It is slightly lighter than `--muted`, so a
10-segment bar stays readable on a `#111` block. Define it as
`--segment-off`.

### Light (`:root`)

| Token | Value |
|---|---|
| `--background` | `#ffffff` |
| `--card` | `#f2f2f2` |
| `--surface-raised` | `#e6e6e6` |
| `--muted` | `#e6e6e6` |
| `--segment-off` | `#d4d4d4` |
| `--foreground` | `#000000` |
| `--muted-foreground` | `#6b6b6b` (5.3 : 1 on white, 4.8 : 1 on `#f2f2f2`) |
| `--border` | `#e0e0e0` |
| `--primary` / `--signal` | `#ff4d3d` (fills and marks only) |
| `--primary-foreground` | `#000000` |
| `--signal-strong` | `#c72414` (red **text** in light mode: 5.69 : 1 on white, 5.08 on `#f2f2f2`, 4.56 on `#e6e6e6` — *not* `#d92b1c`, whose 4.9 : 1 is true on white and nowhere else) |
| `--ring` | `#000000` |

The battery hero block is inverted in both themes: foreground background with
background text. It is white in dark mode and black in light mode.

---

## 3. Radius, spacing, texture

| Thing | Value |
|---|---|
| `--radius` | `1rem` (for shadcn's derived radii only). Mono surfaces use the explicit sizes below |
| Block / tile | 26 px (`rounded-[26px]`) |
| Inner chip, segment, button | 14 px |
| Small chip inside a block | 16 px |
| Pills (tabs, sm buttons, status) | `rounded-full` |
| Fader track | full (width / 2) |
| Block padding | 18 px (phone 14 px) |
| Grid gap | 12 px (phone 8 px) |
| Page padding | desktop 20 × 24 px; phone 16 px sides |

**Dotted texture:**

```css
.mono-dots {
  background-color: var(--card);
  background-image: radial-gradient(color-mix(in oklab, var(--foreground) 12%, transparent) 1px, transparent 1.4px);
  background-size: 12px 12px;
}
```

On the fader desk, use 10 px spacing and 8 % strength.

---

## 4. Typography

Geist Variable, already installed. Use `tabular-nums` on every number that
changes.

| Role | Size / weight / tracking | Example |
|---|---|---|
| Caption | 10 px · 500 · uppercase · `tracking-[.14em]` · muted | BATTERY, EQUALIZER, 1 KHZ |
| Nav label | 9 px rail / 10 px pill · uppercase · `tracking-[.1em]` | HOME |
| Body | 13 px · 400 | list rows, descriptions |
| Body strong | 13 px · 700 | toggle titles, device names |
| Title | 22 px · 800 · `tracking-[-.02em]` | Momentum 4 (desktop top bar) |
| Section display | 30–38 px · 800–850 · `tracking-[-.03em]` | Rock (preset name) |
| Hero numeral | phone 44 px, desktop strip 40 px · 850 · `tracking-[-.04em]` · unit at 45 % size | 78% |
| Readout | 18 px · 800 · signed, 1 decimal | +2.5 |

---

## 5. Components

Each recipe names the file it replaces or restyles.

### 5.1 Block (`components/ui/card.tsx`)

- `bg-card rounded-[26px] p-[18px]`, no ring, no shadow.
- `CardHeader` → a flex row: title left, optional action right.
- `CardTitle` → the Caption style.
- `CardDescription` → 11 px muted.
- `CardContent` → no extra padding. The block pads.

Variants, via a `variant` prop or utility classes:

- `hero`: `.mono-dots`;
- `inverted`: `bg-foreground text-background` (battery).

### 5.2 Buttons (`components/ui/button.tsx`)

| Variant | Look |
|---|---|
| `default` | `bg-foreground text-background font-bold` |
| `outline` | `bg-[--surface-raised] text-foreground`, no border |
| `ghost` | text only, `hover:bg-accent` |
| `destructive` | `bg-signal text-black font-bold` |
| `signal` (new) | `bg-signal text-black font-bold`; the "selected" state for segment-like buttons |

Sizes: `sm` is a pill (`rounded-full px-3 py-1.5 text-[11px]`); `default` is
`rounded-[14px] py-2.5 text-xs`. Minimum hit area is 44 px on phones: pad
with an invisible hit slop rather than growing the visual.

### 5.3 Segmented control (`components/ui/toggle-group.tsx`)

- Equal-width blocks in a row with a 6 px gap.
- Each block: `rounded-[14px] bg-[--surface-raised] py-2.5 text-xs text-center`.
- Selected: `bg-signal text-black font-bold`.
- No container background; the blocks sit directly on the tile.

### 5.4 Switch (`components/ui/switch.tsx`)

- Track 40 × 24, knob 18 px, 3 px inset.
- Off: track `--segment-off`, knob `#777`.
- On: track foreground, knob background.
- The knob slides with a 150 ms transition. It is a selection state, not a
  drag.

### 5.5 Slider (`components/ui/slider.tsx`)

- Track 8 px tall, fully rounded, in `--segment-off`; fill in foreground.
- Thumb 20 px round in foreground, with a 3 px background ring for
  separation.
- While dragging (`data-dragging`), the fill and thumb switch to signal.
- No transition on position.

### 5.6 Segment meter (new: `ui/controls/SegmentMeter.tsx`)

The Mono replacement for continuous progress bars. It is read-only and used
for battery and the noise level.

- N segments (battery 10, noise 20), `flex gap-[2–3px]`, each 8–16 px tall
  with a 3 px radius.
- Lit segments are foreground, or black on the inverted battery block;
  unlit segments are `--segment-off`.
- Props: `value`, `max`, `segments`, `tone?: 'foreground' | 'signal'`.

For the interactive noise level, render the SegmentMeter as the visual and
keep an invisible range input over it for interaction. This is the same
technique as the Fader, and it goes through `useCommittedValue`.

### 5.7 EQ fader (`ui/controls/Fader.tsx`)

See spec §7.3 for behaviour. Anatomy, from top to bottom:

```
 +2.5          ← readout 18/800, signal when active
┌────┐
│    │         ← track 44 px wide, rounded-full, --surface-raised
│────│ ← zero line, 1 px, foreground @ 30 %
│████│         ← fill from zero line to value (foreground, or signal when active)
│████│
└────┘
 1 KHZ         ← caption, white when active
```

- The active band's track gets `ring-2 ring-signal`.
- The hit area is the whole track column. The native `<input type=range>`
  stays on top, invisible.

### 5.8 Preset list (`ui/panels/EqualizerPanel.tsx`)

- **Desktop (≥ 1024 px):**
  - a vertical list in a block, 260 px wide;
  - rows `rounded-[14px] px-2.5 py-2`: name left, mini preview right (5 bars,
    4 × up to 14 px);
  - the active row is inverted, with its peak bar in signal.
- **Phone:** a 4-column chip grid; chips `rounded-[12px] py-2 text-[11px]`,
  the active chip inverted.
- Above the list, show the current preset name in Section display style, with
  a "Reset to Flat" sm pill on the right. Show the pill only if a Flat preset
  exists in the driver's list.

### 5.9 Navigation (`ui/layout/Nav.tsx`, one component, two layouts)

- **Rail (≥ md):**
  - 88 px wide, `border-r`;
  - items 64 px wide, `rounded-2xl py-2.5`, icon 20 px over a 9 px label;
  - active: `bg-foreground text-background font-bold`;
  - inactive: `text-[#777] hover:text-foreground`.
- **Pill (< md):**
  - `fixed inset-x-4 bottom-[calc(16px+env(safe-area-inset-bottom))] h-14 rounded-full bg-card border`;
  - items evenly spaced;
  - active: `bg-foreground text-background rounded-full px-3.5 py-2 font-bold`;
  - labels in the 10 px nav style.
- Icons: keep Remix icons from `SECTION_ICONS`, plus a new `home` →
  `RiHeadphoneLine`. Use the line style throughout; the active state is shown
  by the inverted pill, not a filled icon.

### 5.10 Top bar (`ui/layout/TopBar.tsx`)

- **Phone:**
  - sticky, `bg-background/85 backdrop-blur`, 52 px;
  - left: model name as a Caption-styled button ("MOMENTUM 4 ▾") that opens
    the switcher;
  - right: status token and a `⋯` menu (Refresh, Disconnect, Add over serial,
    Add over Bluetooth, theme).
- **Desktop:**
  - static;
  - left: Title plus a "Switch" sm pill;
  - right: status token, "Refresh", "Disconnect" and "Add device" sm pills.
    "Add device" is a popover with the two pickers.

> **Amendment (final review, shipped behaviour).** The switcher (phone
> chevron and desktop "Switch" pill) renders only when there is something
> to switch to (`available.length >= MIN_DEVICES_TO_SWITCH`): one device
> is a dropdown with one entry. The phone `⋯` menu drops the device
> actions when no device is granted — with no device the empty state
> already carries both connect buttons, so the menu would say it twice;
> only the theme toggle remains, because a phone has no rail to put it
> on. The title row reads the app name with no device (the status token
> carries the state); the model-as-switcher-button from the phone list
> above is split into a heading plus a separate chevron so the name stays
> a heading for assistive tech.

### 5.11 Status token

See spec §4.4. LIVE uses an 8 px dot. It does not pulse; a pulsing dot reads
as "loading".

### 5.12 Home tiles

Exact contents are in spec §4.3. Look:

- **Hero:**
  - `.mono-dots`, column flex;
  - captions top left and right;
  - render centred;
  - fact chips (`bg-background rounded-2xl p-2.5`: caption over an 18/800
    value).
- **Battery, phone:**
  - inverted block, Caption "BATTERY", Hero numeral;
  - per-cell rows (L / R / Case) as 11 px label + SegmentMeter(10) +
    tabular %.
- **Battery, desktop:** an inverted strip,
  `flex items-center gap-3.5 px-[18px] py-3.5`: numeral left, then Caption
  over SegmentMeter over the charging line.
- **EQ preview:**
  - `.mono-dots`;
  - Caption plus "Open ↗" (11 px muted);
  - preset name in Section display;
  - bars `rounded-[10px]` in foreground, the peak band in signal, heights
    mapped to range.
- **Devices:**
  - Caption "CONNECTED TO";
  - rows with dividers: bold name, a muted "· this" marker, and an 8 px dot
    (filled foreground when connected, hollow `--segment-off` otherwise);
  - disconnected rows are muted.

### 5.13 Empty state (`ui/sections/NoDevice.tsx`)

One `.mono-dots` hero block that fills the body:

- a generic headphone glyph (`RiHeadphoneLine`, 96 px) at 30 % foreground;
- the heading "Connect your headphones" (30/850);
- a one-line muted explainer;
- the `default` button "Connect over serial" and the `outline` button
  "Connect over Bluetooth".

---

## 6. Motion

| What | Motion |
|---|---|
| Fader, slider, knob, segment meter under the pointer | none |
| Tab / segment / chip selection colour | `transition-colors duration-150 ease-out` |
| Switch knob | `transition-transform duration-150` |
| Tab change content | none (instant swap). A fade adds latency to every tap |
| `prefers-reduced-motion` | disable all of the above |

---

## 7. Do / don't

| Do | Don't |
|---|---|
| One red thing per control group | Red for headings, icons or decoration |
| Big numeral + small caption | Two sizes of body text fighting |
| Fill a block edge to edge with its content | Nested bordered cards inside blocks |
| Show "—" with a caption when a value is unknown | Show 0 or an empty bar for unknown |
| Hide a tile whose data the driver lacks | Invent data (battery hours, fake codec) |
| Keep the render in the device's real colour | Greyscale or recolour the render |
