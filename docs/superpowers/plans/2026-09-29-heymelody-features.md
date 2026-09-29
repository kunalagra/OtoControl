# HeyMelody features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give OPPO / OnePlus / realme earbuds on the HeyMelody driver per-model built-in EQ presets and full custom-preset management, the feature toggles (auto play/pause, game mode, BassWave, alert volume), touch-control mapping, and a read-only list of connected devices.

**Architecture:** Every feature is a protocol module (pure encode/decode, unit-tested against fixed bytes) plus a device method (optimistic write, rollback on failure, re-read after writes) plus UI in the driver's own sections and Home readouts. Per-model facts (built-in preset ids, custom slot cap) come from the generated catalog, so device state and its saved snapshot barely change.

**Tech Stack:** TypeScript (strict), React 19, Vitest, Tailwind v4, shadcn/Base UI components; Python 3 for the catalog generator.

**Spec:** the "Aligned protocol" section below is the spec. It was settled from the HeyMelody and realme Link APK decompiles (equal weight), the QuickBuds hardware captures on OnePlus Buds 4 (fw B4.1-260810-1153), and the OppoPods / OppoPodsManager / Oneplus-buds-Win-Companion code. Precedence: hardware capture > either APK > community code; where sources tie, the driver tolerates both.

## Aligned protocol (the spec)

All ids hex. Replies are `cmd | 0x8000`. `st` = leading status byte (`00` = ok).

| Feature | Request | Reply / push | Notes |
|---|---|---|---|
| Custom EQ list | `0122` empty; if that fails or `st != 0`, retry once with `01 05` | `8122 st count` then per entry `[selected][min s8][max s8][id][nameLen][name UTF-8][bandCount][freq u16 LE, gain s8]×bandCount` | push `0506` = same entries, **no** status byte |
| Current preset | `010F` empty | `810F st id` | push `0504 [id]` has no status byte; tolerate `[00][id]` |
| Select built-in | `0406 [id]` | `8406 st` | id must be in the model's built-in set |
| Select custom | `0418 02` + the whole preset | `8418 st id` | **never** `0406` for a custom id |
| Create custom | `0418 01 min max 00 nameLen name bandCount [freq, 0]×bandCount` | `8418 st newId` | buds assign the id |
| Modify custom | `0418 02 …whole preset with new gains` | `8418 st id` | |
| Delete custom | `0418 03 …whole preset` | `8418 st id` | |
| After any `8418` | re-read `010F` then `0122` | | ids may renumber; selection may fall back to built-in 0 |
| Built-in set | per model (catalog); default ids `{0,1,2}` | | seen sets `{0,1,2}`, `{0,1,2,3}`, `{3,4,5}`, `{0,1,2,3,7}` |
| Custom slot cap | per model; **default 3** | | two models cap at 2 |
| Feature switches | query `010D [count][ids…]`, set `0403 [id][00/01]` | `810D st count ([id][value])…`, ack `8403 st` | ids: 4 auto play/pause, 6 game mode (legacy) / low latency, 29 BassWave, 40 game mode (main) |
| Game mode | main id = `0x28` (40) if the `810D` reply contains 40, else `0x06` | | when both 40 and 6 are present, 6 is "low latency" |
| BassWave level | read `0124` empty, set `041B [min][max][level]` | `8124 st min max level`, ack `841B st` | min/max signed, from the device (e.g. `FB 05` = −5/+5) |
| Alert volume | read `0130` empty, set `0427 [level]` | `8130 st level`, ack `8427 st level` | levels 1–10 |
| Touch controls | read `0108` empty; if that fails or `st != 0`, retry once with `02 03 01` | `8108 st count [deviceType][button][action][function]×count` | write `0401 [count][4B records…]`, ack `8401 st`; **never** `0402`; re-read `0108` after a write |
| Connected devices | `0112` empty | `8112 st count` then per entry `[MAC 6B little-endian][entryLen][state][flags][nameLen][name]` | next entry = end of name + (entryLen − nameLen − 3); `state 02` = connected; flags bit0 = this device, bit2 = audio active; push `0204` event `06` carries `[count][entries]` with no status byte |

Touch-control codes:
- deviceType: `1` left, `2` right, `4` both.
- button: `1` touch surface, `6` call controls.
- action: `1` single tap, `2` double tap, `3` triple tap, `4` touch and hold, `6` extended hold.
- function: `0` none, `1` play/pause, `3` voice assistant (OPPO/OnePlus) or `4` (realme), `5`/`6` previous/next on current firmware, `4`/`5` previous/next on legacy firmware, `7` volume (composite), `8` noise control, `10` switch track, `11` volume up, `12` volume down, `17` game mode, `28` reject call, `29` answer / hang up.

Not in scope (still open, need hardware): multi-device connect/disconnect (`0429`, byte order of the MAC unconfirmed), the hold-cycle mask write (`0404`), spatial audio, Hi-Res.

## Global Constraints

- Never commit to `main` and never push. Work happens on branch `feat/heymelody-features` in the worktree `.worktrees/heymelody-features`; commit per task on that branch only.
- Commit messages carry no `Co-Authored-By` or other AI attribution line.
- Committed files must not reference paths outside this repository (no sibling-project or absolute paths). Cite sources by name ("HeyMelody APK", "QuickBuds capture").
- Do not copy code from the community projects (GPL-3.0); byte layouts only.
- Ship no vendor UI strings or whitelist JSON; the catalog carries ids and mode types, and display names are this repo's own labels.
- Continuous device writes use commit-on-release (existing `CurveEditor` / `useCommittedValue` pattern), never per-tick writes.
- Every task ends green: `npx vitest run`, `npx tsc -b`, `npx oxlint` (the one existing `AppShell.tsx` static-components warning is known and allowed).
- Match the surrounding code style: TypeScript files in `src/drivers/heymelody/**` use semicolons; `.tsx` section files do not.

## Review Focus

- A device whose `0122` list is empty but which reports `eq`: built-in pills must still render and select (Task 4 test "empty customs + capable").
- A custom select the buds never acknowledge: the optimistic current id and the `isSelected` flags must both roll back (Task 3 test "rolls a failed custom select back").
- Two-byte `0504` push `[00][id]` from firmware that adds a status byte (Task 2 test "tolerates a status byte").
- A multi-device entry whose `entryLen` would overrun the payload (Task 8 test "falls back to nameLen stepping").
- A touch-control table that uses fn `4` on a realme device: must read as voice assistant, not "previous" (Task 7 test "reads 4 as assistant on realme").

---

### Task 1: Per-model built-in EQ presets in the catalog

**Files:**
- Create: `docs/reference/heymelody-eq-modes.json` (already generated in the worktree — commit it with this task)
- Modify: `scripts/gen-heymelody-catalog.py` (read the new source, emit `equalizerMode` / `customEqMax`)
- Modify: `src/drivers/heymelody/catalog.generated.ts` (regenerated, never hand-edited)
- Create: `src/drivers/heymelody/eqModes.ts`
- Test: `src/drivers/heymelody/eqModes.test.ts`, `src/drivers/heymelody/catalog.test.ts`

**Interfaces:**
- Produces:
  - `HeyMelodyCatalogEntry.equalizerMode?: { protocolIndex: number; modeType: number }[]` and `HeyMelodyCatalogEntry.customEqMax?: number`
  - `export interface BuiltinPreset { id: number; name: string }`
  - `export function builtinPresets(entry: HeyMelodyCatalogEntry | null): BuiltinPreset[]`
  - `export function customEqCap(entry: HeyMelodyCatalogEntry | null): number`
  - `export const DEFAULT_CUSTOM_EQ_CAP = 3`

- [ ] **Step 1: Extend the generator.** In `scripts/gen-heymelody-catalog.py`:
  - add `EQ_MODES_SOURCE = Path("docs/reference/heymelody-eq-modes.json")`;
  - add `docs/reference/heymelody-eq-modes.json` to the module docstring's source list and to `HEADER`'s "Generated … from" comment;
  - in `HEADER`'s interface, after `noiseReductionMode?`, add:

```ts
  /** Built-in EQ presets for this model: `protocolIndex` is the wire id sent
   * with `0x0406`, `modeType` picks the display name (see `eqModes.ts`).
   * Absent when the source whitelist does not cover the model. */
  equalizerMode?: { protocolIndex: number; modeType: number }[]
  /** Custom EQ slot cap; absent means the vendor default (3). */
  customEqMax?: number
```

  - in `main()`, load `eq_by_product_id = {d["productId"]: d for d in json.loads(EQ_MODES_SOURCE.read_text(encoding="utf-8"))["devices"]}` and, per device, after the `noiseReductionMode` block:

```python
        eq = eq_by_product_id.get(entry["productId"])
        if eq is not None:
            matched_eq += 1
            if eq.get("equalizerMode"):
                entry["equalizerMode"] = eq["equalizerMode"]
            if eq.get("customEqMax") is not None:
                entry["customEqMax"] = eq["customEqMax"]
```

  - initialise `matched_eq = 0` beside the other counters and add `{matched_eq} with EQ modes` to the final print.

- [ ] **Step 2: Regenerate.** Run: `python3 scripts/gen-heymelody-catalog.py`. Expected: prints `Wrote 137 entries … with EQ modes` (a non-zero EQ count). `git diff --stat` shows only `catalog.generated.ts` changed among `src/`.

- [ ] **Step 3: Write the failing tests.** Append to `src/drivers/heymelody/catalog.test.ts`:

```ts
describe('catalog EQ modes', () => {
  it('carries the built-in preset ids for OnePlus Buds 4', () => {
    expect(catalogEntryFor('065414')?.equalizerMode).toEqual([
      { protocolIndex: 0, modeType: 11 },
      { protocolIndex: 1, modeType: 14 },
      { protocolIndex: 2, modeType: 12 },
    ]);
  });
});
```

  Create `src/drivers/heymelody/eqModes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { catalogEntryFor } from './catalog';
import { DEFAULT_CUSTOM_EQ_CAP, builtinPresets, customEqCap } from './eqModes';

describe('builtinPresets', () => {
  it('names each wire id from the model mode types', () => {
    expect(builtinPresets(catalogEntryFor('065414'))).toEqual([
      { id: 0, name: 'Balanced' },
      { id: 1, name: 'Clear vocals' },
      { id: 2, name: 'Bass' },
    ]);
  });

  it('falls back to three numbered presets for a model the catalog does not describe', () => {
    expect(builtinPresets(null)).toEqual([
      { id: 0, name: 'Preset 1' },
      { id: 1, name: 'Preset 2' },
      { id: 2, name: 'Preset 3' },
    ]);
  });

  it('names an unknown mode type by its position rather than dropping it', () => {
    const entry = { productId: 'X', name: 'X', brand: 'oppo' as const, type: 'T1', equalizerMode: [{ protocolIndex: 3, modeType: 99 }] };
    expect(builtinPresets(entry)).toEqual([{ id: 3, name: 'Preset 4' }]);
  });
});

describe('customEqCap', () => {
  it('defaults to three and honours a model cap', () => {
    expect(customEqCap(null)).toBe(DEFAULT_CUSTOM_EQ_CAP);
    const entry = { productId: 'X', name: 'X', brand: 'oppo' as const, type: 'T1', customEqMax: 2 };
    expect(customEqCap(entry)).toBe(2);
  });
});
```

- [ ] **Step 4: Run to see them fail.** Run: `npx vitest run src/drivers/heymelody/eqModes.test.ts src/drivers/heymelody/catalog.test.ts`. Expected: `eqModes.test.ts` fails to import `./eqModes`; the catalog test passes only if Step 2 ran.

- [ ] **Step 5: Implement `src/drivers/heymelody/eqModes.ts`:**

```ts
/**
 * Built-in EQ presets per model. The wire id is the whitelist's
 * `protocolIndex`; `modeType` only chooses the label. Labels are this repo's
 * own short names for the vendor's mode types, not the vendor's strings.
 */

import type { HeyMelodyCatalogEntry } from './catalog.generated';

export interface BuiltinPreset {
  id: number;
  name: string;
}

/** Vendor default when the whitelist sets no `customEqMax`. */
export const DEFAULT_CUSTOM_EQ_CAP = 3;

/** The built-in ids a model gets when the catalog does not describe it. */
const DEFAULT_BUILTIN_IDS = [0, 1, 2];

const MODE_NAMES: Record<number, string> = {
  1: 'Classic',
  2: 'Dynamic bass',
  3: 'Clear vocals',
  4: 'Clear',
  5: 'Default',
  6: 'Dynaudio Clear',
  7: 'Dynaudio Warm',
  8: 'Dynaudio Punchy',
  9: 'Dynaudio Real',
  11: 'Balanced',
  12: 'Bass',
  13: 'Bold',
  14: 'Clear vocals',
  15: 'Gentle',
  17: 'Balanced',
  18: 'Reno Dawn',
  20: 'Natural',
  21: 'Reno Sunrise',
  22: 'Natural balance',
  25: 'Reno Galaxy',
  26: 'Ultimate sound',
  27: 'HD clarity',
  28: 'Pure vocals',
  29: 'Thundering bass',
  30: 'Dynaudio featured',
  31: 'Bass boost',
  32: 'Clear vocals',
  33: 'Galactic',
  34: 'Vibrant',
  35: 'Default',
};

const numbered = (id: number): string => `Preset ${id + 1}`;

export function builtinPresets(entry: HeyMelodyCatalogEntry | null): BuiltinPreset[] {
  const modes = entry?.equalizerMode;
  if (!modes || modes.length === 0) return DEFAULT_BUILTIN_IDS.map((id) => ({ id, name: numbered(id) }));
  return modes.map(({ protocolIndex, modeType }) => ({ id: protocolIndex, name: MODE_NAMES[modeType] ?? numbered(protocolIndex) }));
}

export function customEqCap(entry: HeyMelodyCatalogEntry | null): number {
  return entry?.customEqMax ?? DEFAULT_CUSTOM_EQ_CAP;
}
```

- [ ] **Step 6: Run to see them pass.** Run: `npx vitest run src/drivers/heymelody`. Expected: all pass.

- [ ] **Step 7: Commit.**

```bash
git add docs/reference/heymelody-eq-modes.json scripts/gen-heymelody-catalog.py src/drivers/heymelody/catalog.generated.ts src/drivers/heymelody/eqModes.ts src/drivers/heymelody/eqModes.test.ts src/drivers/heymelody/catalog.test.ts
git commit -m "feat(heymelody): per-model built-in EQ presets in the catalog"
```

---

### Task 2: EQ protocol — create / select / delete writes, tolerant pushes

**Files:**
- Modify: `src/drivers/heymelody/protocol/eq.ts`
- Test: `src/drivers/heymelody/protocol/eq.test.ts`

**Interfaces:**
- Produces:
  - `export type EqAction = (typeof EQ_ACTION)[keyof typeof EQ_ACTION]`
  - `export function encodeEqWrite(action: EqAction, preset: EqPreset, gains?: readonly number[]): number[]` (gains default to the preset's own)
  - `export function newCustomPreset(name: string, template: EqPreset | null): EqPreset` (eqId 0, zero gains, template's range and bands, else −6/+6 and the default six bands)
  - `export const DEFAULT_CUSTOM_BANDS: readonly number[]` = `[62, 250, 1000, 4000, 8000, 16000]`
  - `export function decodeEqCurrentPush(payload: Uint8Array): number`
  - `encodeSetEqCurve` is **removed**; its one caller moves to `encodeEqWrite(EQ_ACTION.Modify, …)` in Task 3.

- [ ] **Step 1: Write the failing tests.** Append to `src/drivers/heymelody/protocol/eq.test.ts` (add the new names to its import from `./eq`):

```ts
describe('encodeEqWrite', () => {
  const preset = {
    isSelected: false,
    minValue: -6,
    maxValue: 6,
    eqId: 5,
    name: 'Ab',
    bands: [
      { frequency: 62, dbValue: 1 },
      { frequency: 1000, dbValue: -2 },
    ],
  };

  it('writes the action, the preset range and layout, and the given gains', () => {
    expect(encodeEqWrite(EQ_ACTION.Modify, preset, [3, -4])).toEqual([
      0x02, 0xfa, 0x06, 0x05, 0x02, 0x41, 0x62, 0x02, 0x3e, 0x00, 0x03, 0xe8, 0x03, 0xfc,
    ]);
  });

  it('defaults to the preset own gains, as select and delete send the whole preset', () => {
    expect(encodeEqWrite(EQ_ACTION.Delete, preset).slice(0, 1)).toEqual([0x03]);
    expect(encodeEqWrite(EQ_ACTION.Delete, preset).slice(-1)).toEqual([0xfe]);
  });

  it('echoes a non-default range and band count', () => {
    const wide = { ...preset, minValue: -10, maxValue: 10, bands: [{ frequency: 31, dbValue: 0 }] };
    expect(encodeEqWrite(EQ_ACTION.Modify, wide).slice(1, 3)).toEqual([0xf6, 0x0a]);
    expect(encodeEqWrite(EQ_ACTION.Modify, wide)[7]).toBe(1);
  });

  it('refuses gains that do not match the band count', () => {
    expect(() => encodeEqWrite(EQ_ACTION.Modify, preset, [1])).toThrow();
  });
});

describe('newCustomPreset', () => {
  it('copies a template range and bands with id 0 and zero gains', () => {
    const template = {
      isSelected: true,
      minValue: -10,
      maxValue: 10,
      eqId: 4,
      name: 'Mine',
      bands: [{ frequency: 31, dbValue: 5 }],
    };
    expect(newCustomPreset('Custom 2', template)).toEqual({
      isSelected: false,
      minValue: -10,
      maxValue: 10,
      eqId: 0,
      name: 'Custom 2',
      bands: [{ frequency: 31, dbValue: 0 }],
    });
  });

  it('uses the vendor default six bands at ±6 without a template', () => {
    const created = newCustomPreset('Custom 1', null);
    expect(created.bands.map((band) => band.frequency)).toEqual([62, 250, 1000, 4000, 8000, 16000]);
    expect([created.minValue, created.maxValue, created.eqId]).toEqual([-6, 6, 0]);
    expect(encodeEqWrite(EQ_ACTION.Add, created).slice(0, 5)).toEqual([0x01, 0xfa, 0x06, 0x00, 8]);
  });
});

describe('decodeEqCurrentPush', () => {
  it('reads the bare id the vendor app and captures show', () => {
    expect(decodeEqCurrentPush(Uint8Array.from([4]))).toBe(4);
  });

  it('tolerates a status byte that some community apps expect', () => {
    expect(decodeEqCurrentPush(Uint8Array.from([0x00, 4]))).toBe(4);
  });

  it('refuses an empty push', () => {
    expect(() => decodeEqCurrentPush(new Uint8Array())).toThrow();
  });
});
```

- [ ] **Step 2: Run to see them fail.** Run: `npx vitest run src/drivers/heymelody/protocol/eq.test.ts`. Expected: FAIL, `encodeEqWrite` / `newCustomPreset` / `decodeEqCurrentPush` not exported.

- [ ] **Step 3: Implement.** In `src/drivers/heymelody/protocol/eq.ts`, replace `encodeSetEqCurve` with:

```ts
export type EqAction = (typeof EQ_ACTION)[keyof typeof EQ_ACTION];

/** The vendor's default custom-EQ band centres, used when no custom preset exists to copy. */
export const DEFAULT_CUSTOM_BANDS: readonly number[] = [62, 250, 1000, 4000, 8000, 16000];

/**
 * `0x0418` write: `[action][min][max][eqId][nameLen][name UTF-8][bandCount][freq(2 LE), gain]…`
 * (realme `SetCommandManager.p():440-497`, HeyMelody `HeadsetCoreService` `G0`). Create, modify
 * (which also selects a custom preset) and delete all send the whole preset; only the action
 * byte and, for modify, the gains differ. The preset's own range and band layout are echoed —
 * models differ (±6 with 6 bands by default, ±10 with 10 bands on some).
 */
export function encodeEqWrite(action: EqAction, preset: EqPreset, gains: readonly number[] = preset.bands.map((band) => band.dbValue)): number[] {
  if (gains.length !== preset.bands.length) {
    throw new Error(`EQ curve has ${gains.length} gains for ${preset.bands.length} bands`);
  }
  const name = Array.from(textEncoder.encode(preset.name));
  return [
    action,
    preset.minValue & 0xff,
    preset.maxValue & 0xff,
    preset.eqId,
    name.length,
    ...name,
    preset.bands.length,
    ...preset.bands.flatMap((band, i) => [band.frequency & 0xff, (band.frequency >> 8) & 0xff, gains[i] & 0xff]),
  ];
}

/** What a create sends: id 0 (the buds assign one), zero gains, a template's range and bands. */
export function newCustomPreset(name: string, template: EqPreset | null): EqPreset {
  return {
    isSelected: false,
    minValue: template?.minValue ?? -6,
    maxValue: template?.maxValue ?? 6,
    eqId: 0,
    name,
    bands: (template?.bands.map((band) => band.frequency) ?? DEFAULT_CUSTOM_BANDS).map((frequency) => ({ frequency, dbValue: 0 })),
  };
}

/**
 * `0x0504` push: the bare current preset id (HeyMelody `HeadsetCoreService`, realme
 * `RequestCommandManager`, QuickBuds capture). Some community apps expect a leading status
 * byte, so a two-byte `[00][id]` is accepted too.
 */
export function decodeEqCurrentPush(payload: Uint8Array): number {
  if (payload.length === 0) throw new Error('EQ current push is empty');
  if (payload.length >= 2 && payload[0] === 0) return payload[1];
  return payload[0];
}
```

  Update the `EQ_ACTION` doc comment to: `` /** `0x0418` actions (realme `CustomEqViewModel.java:72,92,160`; HeyMelody `p085g9/j.java:496,615`). */ ``. Remove any test in `eq.test.ts` that imports `encodeSetEqCurve` and replace it with the `encodeEqWrite` cases above (same bytes, action `0x02`).

- [ ] **Step 4: Keep the one caller compiling.** In `device.ts`, import `EQ_ACTION, encodeEqWrite` instead of `encodeSetEqCurve`, and in `setEqCurve` replace `encodeSetEqCurve(preset, clamped)` with `encodeEqWrite(EQ_ACTION.Modify, preset, clamped)`.

- [ ] **Step 5: Run to see them pass.** Run: `npx vitest run src/drivers/heymelody && npx tsc -b`. Expected: PASS and a clean typecheck.

- [ ] **Step 6: Commit.**

```bash
git add src/drivers/heymelody/protocol/eq.ts src/drivers/heymelody/protocol/eq.test.ts src/drivers/heymelody/device.ts
git commit -m "feat(heymelody): EQ write encoder for create, select and delete; tolerant 0x0504 push"
```

---

### Task 3: Device — custom-preset management and correct selection

**Files:**
- Modify: `src/drivers/heymelody/device.ts`
- Test: `src/drivers/heymelody/device.test.ts`

**Interfaces:**
- Consumes: `encodeEqWrite`, `EQ_ACTION`, `newCustomPreset`, `decodeEqCurrentPush` (Task 2); `customEqCap` (Task 1).
- Produces (public on `HeyMelodyDevice`):
  - `setEqPreset(eqId: number): Promise<void>` — custom ids go through `0x0418` action 2, built-ins through `0x0406`.
  - `createCustomPreset(name?: string): Promise<void>` — no-op at the cap; default name `Custom N` (lowest unused N ≥ 1).
  - `deleteCustomPreset(eqId: number): Promise<void>`
  - (unchanged) `setEqCurve(eqId, gains)`.

- [ ] **Step 1: Write the failing tests.** In `device.test.ts`, inside `describe('HeyMelodyDevice custom EQ', …)` (it already has `replies` with bits 10 and 34 and `CUSTOM_EQ` holding one custom preset with eqId 9), add:

```ts
  const decodeWrites = (transport: FakeTransport, cmd: number) => {
    const decoder = new SppFrameCodec().createDecoder();
    return transport.written.flatMap((bytes) => decoder.push(bytes)).filter((frame) => frame.cmd === cmd).map((frame) => Array.from(frame.payload));
  };

  it('selects a custom preset with 0x0418 action 2, never 0x0406', async () => {
    let transport!: FakeTransport;
    const device = new HeyMelodyDevice(scriptedOpener(replies, new Map([[Cmd.SetEqCurve, [[0x00, 9]]]]), (t) => (transport = t)), { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    await device.setEqPreset(9);
    expect(decodeWrites(transport, Cmd.SetEqPreset)).toEqual([]);
    expect(decodeWrites(transport, Cmd.SetEqCurve)[0][0]).toBe(0x02);
    expect(device.state.eqCurrentPreset).toBe(9);
  });

  it('selects a built-in preset with 0x0406', async () => {
    let transport!: FakeTransport;
    const device = new HeyMelodyDevice(scriptedOpener(replies, new Map([[Cmd.SetEqPreset, [[0x00]]]]), (t) => (transport = t)), { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    await device.setEqPreset(1);
    expect(decodeWrites(transport, Cmd.SetEqPreset)).toEqual([[1]]);
    expect(device.state.eqPresets.every((preset) => !preset.isSelected)).toBe(true);
  });

  it('creates a custom preset copying an existing one, then re-reads the current id and the list', async () => {
    let transport!: FakeTransport;
    const created = [...CUSTOM_EQ.slice(0, 1), 2, ...CUSTOM_EQ.slice(2), ...CUSTOM_EQ.slice(2).map((b, i) => (i === 3 ? 10 : b))];
    const device = new HeyMelodyDevice(
      scriptedOpener(replies, new Map([[Cmd.SetEqCurve, [[0x00, 10]]], [Cmd.QueryEqAll, [CUSTOM_EQ, created]]]), (t) => (transport = t)),
      { timeoutMs: 50, probeTimeoutMs: 50 },
    );
    await device.adoptPort(port);
    await device.createCustomPreset();
    const [add] = decodeWrites(transport, Cmd.SetEqCurve);
    expect(add[0]).toBe(0x01);
    expect(add[3]).toBe(0x00);
    expect(decodeWrites(transport, Cmd.QueryEqAll)).toHaveLength(2);
    expect(decodeWrites(transport, Cmd.QueryEqCurrent)).toHaveLength(2);
    expect(device.state.eqPresets.map((preset) => preset.eqId)).toEqual([9, 10]);
  });

  it('names a created preset after the lowest free slot number', async () => {
    let transport!: FakeTransport;
    const device = new HeyMelodyDevice(scriptedOpener(replies, new Map([[Cmd.SetEqCurve, [[0x00, 10]]]]), (t) => (transport = t)), { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    await device.createCustomPreset();
    const [add] = decodeWrites(transport, Cmd.SetEqCurve);
    const name = new TextDecoder().decode(Uint8Array.from(add.slice(5, 5 + add[4])));
    expect(name).toBe('Custom 1');
  });

  it('does not create beyond the model cap', async () => {
    let transport!: FakeTransport;
    const three = [0x00, 3, ...[9, 10, 11].flatMap((id) => [...CUSTOM_EQ.slice(2).map((b, i) => (i === 3 ? id : b))])];
    const full = new Map(replies);
    full.set(Cmd.QueryEqAll, three);
    const device = new HeyMelodyDevice(scriptedOpener(full, new Map(), (t) => (transport = t)), { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    expect(device.state.eqPresets).toHaveLength(3);
    await device.createCustomPreset();
    expect(decodeWrites(transport, Cmd.SetEqCurve)).toEqual([]);
  });

  it('deletes with the whole preset, then re-reads', async () => {
    let transport!: FakeTransport;
    const device = new HeyMelodyDevice(
      scriptedOpener(replies, new Map([[Cmd.SetEqCurve, [[0x00, 9]]], [Cmd.QueryEqAll, [CUSTOM_EQ, [0x00, 0]]]]), (t) => (transport = t)),
      { timeoutMs: 50, probeTimeoutMs: 50 },
    );
    await device.adoptPort(port);
    await device.deleteCustomPreset(9);
    const [del] = decodeWrites(transport, Cmd.SetEqCurve);
    expect(del[0]).toBe(0x03);
    expect(del[3]).toBe(9);
    expect(device.state.eqPresets).toEqual([]);
  });

  it('rolls a failed custom select back to the previous selection', async () => {
    // Select ack never arrives: the optimistic current id and isSelected flags return.
    const device = new HeyMelodyDevice(scriptedOpener(replies, new Map([[Cmd.SetEqCurve, [undefined]]])), { timeoutMs: 20, probeTimeoutMs: 20 });
    await device.adoptPort(port);
    const before = { current: device.state.eqCurrentPreset, flags: device.state.eqPresets.map((preset) => preset.isSelected) };
    await device.setEqPreset(9);
    expect(device.state.eqCurrentPreset).toBe(before.current);
    expect(device.state.eqPresets.map((preset) => preset.isSelected)).toEqual(before.flags);
    expect(device.state.error).not.toBeNull();
  });

  it('retries the preset list with 01 05 when the empty request is refused', async () => {
    let transport!: FakeTransport;
    const device = new HeyMelodyDevice(scriptedOpener(replies, new Map([[Cmd.QueryEqAll, [[0x01], CUSTOM_EQ]]]), (t) => (transport = t)), { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    expect(decodeWrites(transport, Cmd.QueryEqAll)).toEqual([[], [0x01, 0x05]]);
    expect(device.state.eqPresets).toHaveLength(1);
  });
```

  `CUSTOM_EQ` is `[status 0, count 1, selected 1, FA, 06, id 9, nameLen 2, 'C', '1', bandCount 2, 100 LE (2 bytes), gain, 4300 LE (2 bytes), gain]`; within one entry (`CUSTOM_EQ.slice(2)`), index 3 is the eqId — which is what the fixtures above rewrite.

- [ ] **Step 2: Run to see them fail.** Run: `npx vitest run src/drivers/heymelody/device.test.ts`. Expected: FAIL — `createCustomPreset` / `deleteCustomPreset` not functions; custom select sends `0x0406`; no `01 05` retry.

- [ ] **Step 3: Implement in `device.ts`.**
  - Imports: add `EQ_ACTION, encodeEqWrite, newCustomPreset, decodeEqCurrentPush` from `./protocol/eq` (drop `encodeSetEqCurve`); add `import { customEqCap } from './eqModes';`.
  - `0x0504` push: replace `frame.payload[0]` with `decodeEqCurrentPush(frame.payload)` inside a try/catch that logs `'[heymelody] unreadable EQ current push'`.
  - Extract the list read into `#readEqList(client)`:

```ts
  /** `0x0122` empty, as both vendor apps send it; `01 05` once if refused (OppoPods / OppoPodsManager send that form). */
  async #readEqList(client: HeyMelodyClient): Promise<void> {
    try {
      this.#setConfirmedEq(decodeEqAll(await client.request(Cmd.QueryEqAll, [], { timeoutMs: this.#probeTimeoutMs })));
    } catch (error) {
      console.debug('[heymelody] QueryEqAll refused, retrying with 01 05', error);
      this.#setConfirmedEq(decodeEqAll(await client.request(Cmd.QueryEqAll, [0x01, 0x05], { timeoutMs: this.#probeTimeoutMs })));
    }
  }
```

    and call it from `#readEq` in place of the inline `QueryEqAll` request.
  - Add `#rereadEq(client)` that re-reads the current id (same decode as `#readEq`'s `QueryEqCurrent` block, errors logged not thrown) then `#readEqList(client)` (errors logged).
  - Replace `setEqPreset`:

```ts
  /** Built-ins select with `0x0406`; a custom preset is selected by writing it with `0x0418` action 2, as the vendor app does. */
  async setEqPreset(eqId: number): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    const custom = this.#store.state.eqPresets.find((preset) => preset.eqId === eqId);
    const previous = { current: this.#store.state.eqCurrentPreset, presets: this.#store.state.eqPresets };
    this.#patch({
      eqCurrentPreset: eqId,
      eqPresets: previous.presets.map((preset) => ({ ...preset, isSelected: preset.eqId === eqId })),
    });
    try {
      if (custom) {
        decodeSetEqCurveAck(await client.request(Cmd.SetEqCurve, encodeEqWrite(EQ_ACTION.Modify, { ...custom, isSelected: true })));
        await this.#rereadEq(client);
      } else {
        statusBody(await client.request(Cmd.SetEqPreset, encodeSetEqPreset(eqId)), 'EQ preset select');
      }
    } catch (error) {
      this.#patch({ eqCurrentPreset: previous.current, eqPresets: previous.presets, error: describeError(error) });
    }
  }
```

  - Add:

```ts
  /** `0x0418` action 1 with id 0 — the buds assign the id — then re-read, since ids can renumber. */
  async createCustomPreset(name?: string): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    const customs = this.#store.state.eqPresets;
    if (customs.length >= customEqCap(this.#store.state.info.catalog)) return;
    const taken = new Set(customs.map((preset) => preset.name));
    let n = 1;
    while (taken.has(`Custom ${n}`)) n += 1;
    try {
      decodeSetEqCurveAck(await client.request(Cmd.SetEqCurve, encodeEqWrite(EQ_ACTION.Add, newCustomPreset(name ?? `Custom ${n}`, customs[0] ?? null))));
    } catch (error) {
      this.#patch({ error: describeError(error) });
    }
    await this.#rereadEq(client);
  }

  /** `0x0418` action 3 with the whole preset, then re-read; the buds pick what becomes selected. */
  async deleteCustomPreset(eqId: number): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    const preset = this.#store.state.eqPresets.find((candidate) => candidate.eqId === eqId);
    if (!preset) return;
    try {
      decodeSetEqCurveAck(await client.request(Cmd.SetEqCurve, encodeEqWrite(EQ_ACTION.Delete, preset)));
    } catch (error) {
      this.#patch({ error: describeError(error) });
    }
    await this.#rereadEq(client);
  }
```

  - `setEqCurve` uses `encodeEqWrite(EQ_ACTION.Modify, preset, clamped)`.
  - Update the existing test `'setEqPreset applies optimistically and keeps the value once acknowledged'` only if it breaks because the built-in path now checks the ack status (`statusBody`); give that test's `SetEqPreset` reply `[0x00]`.

- [ ] **Step 4: Run to see them pass.** Run: `npx vitest run src/drivers/heymelody`. Expected: all pass. Then `npx tsc -b`. Expected: clean.

- [ ] **Step 5: Commit.**

```bash
git add src/drivers/heymelody/device.ts src/drivers/heymelody/device.test.ts
git commit -m "feat(heymelody): create, select and delete custom EQ presets; re-read after writes"
```

---

### Task 4: Sound section — built-in pills and a Custom card

**Files:**
- Modify: `src/drivers/heymelody/sections/Sound.tsx`
- Test: `src/drivers/heymelody/sections/sections.render.test.tsx`, `src/drivers/heymelody/sections/Sound.test.tsx`

**Interfaces:**
- Consumes: `builtinPresets`, `customEqCap` (Task 1); `device.setEqPreset`, `createCustomPreset`, `deleteCustomPreset`, `setEqCurve` (Task 3).

UI shape:
- "Equalizer" card: one `SegmentButton` per built-in preset (`builtinPresets(state.info.catalog)`), pressed when it is the current id, shown whenever the device reports `eq` (or before capabilities are known). Independent of the custom list.
- "Custom" card, only with `eqCustom`: one `SegmentButton` pill per custom preset; the `CurveEditor` sliders only for the **selected** custom; a "New preset" button (disabled at the cap, with the caption "Up to N custom presets"); a "Delete" button for the selected custom that asks `window.confirm('Delete <name>?')` first.
- Empty custom list: the card shows "No custom presets yet." and the New button.
- Selected id: `state.eqCurrentPreset ?? state.eqPresets.find((p) => p.isSelected)?.eqId ?? null`.
- Keep the existing "This device reports no equalizer." early return.

- [ ] **Step 1: Write the failing tests.** Replace the `describe('HeyMelody Sound section', …)` block in `sections.render.test.tsx` with:

```tsx
describe('HeyMelody Sound section', () => {
  const custom = (eqId: number, name: string, isSelected = false) => ({
    isSelected,
    minValue: -6,
    maxValue: 6,
    eqId,
    name,
    bands: [
      { frequency: 100, dbValue: 0 },
      { frequency: 4300, dbValue: 2 },
    ],
  });
  const buds4 = { ...initialHeyMelodyState.info, productId: '065414', catalog: catalogEntryFor('065414') };

  it('shows the model built-ins even when the device lists no custom presets', () => {
    const html = renderSection(HeyMelodySound, { info: buds4, capabilities: new Set(['eq', 'eqCustom']) });
    for (const name of ['Balanced', 'Clear vocals', 'Bass']) expect(html).toContain(name);
    expect(html).toContain('No custom presets yet');
    expect(html).toContain('New preset');
  });

  it('shows sliders for the selected custom preset only', () => {
    const html = renderSection(HeyMelodySound, {
      info: buds4,
      eqCurrentPreset: 9,
      eqPresets: [custom(9, 'Mine', true), custom(10, 'Other')],
      capabilities: new Set(['eq', 'eqCustom']),
    });
    expect(html.match(/100 Hz/g)).toHaveLength(1);
    expect(html).toContain('Mine');
    expect(html).toContain('Other');
  });

  it('shows no Custom card without curve writes', () => {
    const html = renderSection(HeyMelodySound, { info: buds4, eqPresets: [custom(9, 'Mine', true)], capabilities: new Set(['eq']) });
    expect(html).not.toContain('New preset');
    expect(html).not.toContain('100 Hz');
  });

  it('disables New preset at the model cap and says why', () => {
    const html = renderSection(HeyMelodySound, {
      info: buds4,
      eqPresets: [custom(9, 'A'), custom(10, 'B'), custom(11, 'C')],
      capabilities: new Set(['eq', 'eqCustom']),
    });
    expect(html).toContain('Up to 3 custom presets');
  });
});
```

  Add `import { catalogEntryFor } from '../catalog';` at the top of that file. In `Sound.test.tsx`, give the rendered state `eqCurrentPreset: 9` so the one preset is the selected custom (its sliders stay the first captured).

- [ ] **Step 2: Run to see them fail.** Run: `npx vitest run src/drivers/heymelody/sections`. Expected: FAIL (no built-in names, no "New preset").

- [ ] **Step 3: Implement `Sound.tsx`.** Keep `CurveEditor` and `bandLabel` as they are. Replace `HeyMelodySound` with:

```tsx
export function HeyMelodySound({ device, state }: Props) {
  const disabled = state.status !== 'connected'
  const known = state.capabilities.size > 0
  if (known && !state.capabilities.has('eq') && !state.capabilities.has('eqCustom')) {
    return (
      <Card data-size="sm">
        <CardContent>
          <p className="text-muted-foreground text-sm">This device reports no equalizer.</p>
        </CardContent>
      </Card>
    )
  }

  const builtins = builtinPresets(state.info.catalog)
  const customs = state.eqPresets
  const cap = customEqCap(state.info.catalog)
  const selectedId = state.eqCurrentPreset ?? customs.find((preset) => preset.isSelected)?.eqId ?? null
  const selectedCustom = customs.find((preset) => preset.eqId === selectedId) ?? null
  const showBuiltins = !known || state.capabilities.has('eq')

  return (
    <div className="flex flex-col gap-4">
      {showBuiltins && (
        <Card data-size="sm">
          <CardHeader>
            <CardTitle>Equalizer</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {builtins.map((preset) => (
              <SegmentButton
                key={preset.id}
                pressed={selectedId === preset.id && !selectedCustom}
                disabled={disabled}
                onSelect={() => void device.setEqPreset(preset.id)}
                label={preset.name}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {state.capabilities.has('eqCustom') && (
        <Card data-size="sm">
          <CardHeader>
            <CardTitle>Custom</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {customs.length === 0 ? (
              <p className="text-muted-foreground text-sm">No custom presets yet.</p>
            ) : (
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {customs.map((preset) => (
                  <SegmentButton
                    key={preset.eqId}
                    pressed={selectedCustom?.eqId === preset.eqId}
                    disabled={disabled}
                    onSelect={() => void device.setEqPreset(preset.eqId)}
                    label={preset.name}
                  />
                ))}
              </div>
            )}
            {selectedCustom && selectedCustom.bands.length > 0 && (
              <CurveEditor
                key={selectedCustom.eqId}
                preset={selectedCustom}
                disabled={disabled}
                onCommit={(gains) => void device.setEqCurve(selectedCustom.eqId, gains)}
              />
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={disabled || customs.length >= cap}
                onClick={() => void device.createCustomPreset()}
              >
                New preset
              </Button>
              {selectedCustom && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() => {
                    if (window.confirm(`Delete ${selectedCustom.name}?`)) void device.deleteCustomPreset(selectedCustom.eqId)
                  }}
                >
                  Delete
                </Button>
              )}
              {customs.length >= cap && (
                <span className="text-muted-foreground text-xs">Up to {cap} custom presets</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
```

  Imports: add `import { Button } from '@/components/ui/button'` and `import { builtinPresets, customEqCap } from '../eqModes'`. Keep the `CurveEditor` key so switching presets resets its draft.

- [ ] **Step 4: Run to see them pass.** Run: `npx vitest run src/drivers/heymelody src/sections.render.test.tsx`. Expected: PASS. If `src/sections.render.test.tsx` snapshots change, inspect the diff: only the HeyMelody Sound markup may differ; then update with `-u`.

- [ ] **Step 5: Commit.**

```bash
git add src/drivers/heymelody/sections src/__snapshots__
git commit -m "feat(heymelody): built-in preset pills and a Custom card with create, select, delete"
```

---

### Task 5: Home EQ readouts for built-ins and customs

**Files:**
- Modify: `src/drivers/heymelody/driver.ts`
- Test: `src/drivers/heymelody/driver.test.ts`, `src/homeControls.test.ts`

**Interfaces:**
- Consumes: `builtinPresets` (Task 1), `device.setEqPreset` (Task 3).
- Produces: `eqPresets` lists built-ins then customs (ids as strings; built-in and custom ids never collide because customs are only what `0x0122` lists and a built-in id that also appears in the custom list is treated as custom); `eqPreview` returns a curve for a selected custom and `null` for a built-in (the Home tile then shows the active chip's name).

- [ ] **Step 1: Write the failing tests.** In `src/homeControls.test.ts`, replace the HeyMelody `it('offers the presets the device itself listed', …)` with:

```ts
  it('offers the model built-ins and the device custom presets together', () => {
    const { device, call } = spyDevice()
    const custom = { eqId: 9, name: 'Mine', isSelected: true, minValue: -6, maxValue: 6, bands: [] }
    const state = {
      ...initialHeyMelodyState,
      info: { ...initialHeyMelodyState.info, productId: '065414', catalog: catalogEntryFor('065414') },
      capabilities: new Set(['eq', 'eqCustom'] as const),
      eqPresets: [custom],
      eqCurrentPreset: 9,
    }
    const presets = HEYMELODY_DRIVER.eqPresets!(device, state)!
    expect(presets.presets).toEqual([
      { id: '0', name: 'Balanced', active: false },
      { id: '1', name: 'Clear vocals', active: false },
      { id: '2', name: 'Bass', active: false },
      { id: '9', name: 'Mine', active: true },
    ])
    presets.select('1')
    expect(call('setEqPreset')).toHaveBeenCalledWith(1)
  })

  it('keeps the built-in chips for a device with no custom presets', () => {
    const { device } = spyDevice()
    const state = { ...initialHeyMelodyState, capabilities: new Set(['eq'] as const), eqCurrentPreset: 0 }
    expect(HEYMELODY_DRIVER.eqPresets!(device, state)!.presets.map((preset) => preset.active)).toEqual([true, false, false])
  })
```

  and keep the existing `expect(HEYMELODY_DRIVER.eqPresets!(device, initialHeyMelodyState)).toBeNull()` only if it still holds: an unknown-capability initial state now returns the three numbered built-ins, so change that assertion to `expect(HEYMELODY_DRIVER.eqPresets!(device, { ...initialHeyMelodyState, capabilities: new Set(['battery'] as const) })).toBeNull()`. Add `import { catalogEntryFor } from '@/drivers/heymelody/catalog'`.

  In `driver.test.ts` add:

```ts
describe('HEYMELODY_DRIVER.eqPreview', () => {
  it('has no curve for a built-in preset', () => {
    expect(HEYMELODY_DRIVER.eqPreview({ ...initialHeyMelodyState, eqCurrentPreset: 1 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to see them fail.** Run: `npx vitest run src/homeControls.test.ts src/drivers/heymelody/driver.test.ts`. Expected: FAIL (no built-ins in the list).

- [ ] **Step 3: Implement.** In `driver.ts`, import `builtinPresets` from `./eqModes`, and replace `eqPresets` with:

```ts
  // The model's built-ins, then the custom presets the device listed — the same two groups the Sound tab shows.
  eqPresets: (device: HeyMelodyDevice, state: HeyMelodyState): EqPresets | null => {
    const { capabilities } = state;
    const known = capabilities.size > 0;
    const hasBuiltins = !known || capabilities.has('eq');
    if (!hasBuiltins && !capabilities.has('eqCustom')) return null;
    const selected = state.eqCurrentPreset ?? state.eqPresets.find((preset) => preset.isSelected)?.eqId ?? null;
    const customIds = new Set(state.eqPresets.map((preset) => preset.eqId));
    const builtins = hasBuiltins ? builtinPresets(state.info.catalog).filter((preset) => !customIds.has(preset.id)) : [];
    const presets = [
      ...builtins.map((preset) => ({ id: String(preset.id), name: preset.name, active: selected === preset.id })),
      ...state.eqPresets.map((preset) => ({ id: String(preset.eqId), name: preset.name, active: selected === preset.eqId })),
    ];
    if (presets.length === 0) return null;
    return { presets, select: (id: string) => void device.setEqPreset(Number(id)) };
  },
```

  `eqPreview` already returns null when the selected id is not a listed custom; update its comment to say a built-in has no curve on the wire.

- [ ] **Step 4: Run to see them pass.** Run: `npx vitest run`. Expected: all pass.

- [ ] **Step 5: Commit.**

```bash
git add src/drivers/heymelody/driver.ts src/drivers/heymelody/driver.test.ts src/homeControls.test.ts
git commit -m "feat(heymelody): Home EQ chips list the model built-ins with the custom presets"
```

---

### Task 6: Feature switches — auto play/pause, game mode, BassWave, alert volume

**Files:**
- Create: `src/drivers/heymelody/protocol/feature.ts`, `src/drivers/heymelody/protocol/feature.test.ts`
- Modify: `src/drivers/heymelody/protocol/cmd.ts`, `src/drivers/heymelody/protocol/capability.ts`, `src/drivers/heymelody/state.ts`, `src/drivers/heymelody/device.ts`, `src/drivers/heymelody/sections/System.tsx`, `src/drivers/heymelody/driver.ts`
- Test: `src/drivers/heymelody/device.test.ts`, `src/drivers/heymelody/sections/sections.render.test.tsx`, `src/homeControls.test.ts`

**Interfaces:**
- Produces:
  - `Cmd.QueryFeatures = 0x010d`, `Cmd.SetFeature = 0x0403`, `Cmd.QueryBassLevel = 0x0124`, `Cmd.SetBassLevel = 0x041b`, `Cmd.QueryAlertVolume = 0x0130`, `Cmd.SetAlertVolume = 0x0427`
  - `export const FeatureId = { AutoPlay: 4, GameLegacy: 6, BassWave: 29, GameMain: 40 } as const`
  - `export function encodeQueryFeatures(ids: readonly number[]): number[]` → `[count, ...ids]`
  - `export function decodeFeatures(payload: Uint8Array): Map<number, boolean>` (status, count, `[id][value]` pairs; value non-zero = on)
  - `export function encodeSetFeature(id: number, on: boolean): number[]` → `[id, on ? 1 : 0]`
  - `export interface BassLevel { min: number; max: number; level: number }`; `decodeBassLevel(payload): BassLevel`; `encodeBassLevel(level: BassLevel): number[]`
  - `decodeAlertVolume(payload): number`; `ALERT_VOLUME_RANGE = { min: 1, max: 10 }`
  - `export function gameModeIds(features: ReadonlyMap<number, boolean>): { main: number | null; lowLatency: number | null }`
  - State additions (live-only, not persisted): `features: Map<number, boolean>` (initial empty map), `bassLevel: BassLevel | null`, `alertVolume: number | null`.
  - `HeyMelodyFeature` gains `'bassLevel' | 'alertVolume'`; `FEATURE_COMMANDS.bassLevel = [Cmd.QueryBassLevel]`.
  - Device: `setFeature(id: number, on: boolean)`, `setBassLevel(level: number)`, `setAlertVolume(level: number)`.

- [ ] **Step 1: Write the failing protocol tests** in `protocol/feature.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { FeatureId, decodeAlertVolume, decodeBassLevel, decodeFeatures, encodeBassLevel, encodeQueryFeatures, encodeSetFeature, gameModeIds } from './feature';

describe('feature switches', () => {
  it('asks for a list of ids', () => {
    expect(encodeQueryFeatures([4, 6, 29, 40])).toEqual([4, 4, 6, 29, 40]);
  });

  it('reads id/value pairs after the status and count', () => {
    expect(decodeFeatures(Uint8Array.from([0x00, 2, 0x04, 0x01, 0x06, 0x00]))).toEqual(new Map([[4, true], [6, false]]));
  });

  it('refuses a non-zero status', () => {
    expect(() => decodeFeatures(Uint8Array.from([0x01, 0]))).toThrow();
  });

  it('writes one id and its state', () => {
    expect(encodeSetFeature(FeatureId.GameMain, true)).toEqual([40, 1]);
  });

  it('uses 40 as the main game-mode switch when the device reports it, and 6 then means low latency', () => {
    expect(gameModeIds(new Map([[40, false], [6, true]]))).toEqual({ main: 40, lowLatency: 6 });
    expect(gameModeIds(new Map([[6, true]]))).toEqual({ main: 6, lowLatency: null });
    expect(gameModeIds(new Map())).toEqual({ main: null, lowLatency: null });
  });
});

describe('BassWave level', () => {
  it('reads a signed range and the level from the device', () => {
    expect(decodeBassLevel(Uint8Array.from([0x00, 0xfb, 0x05, 0x02]))).toEqual({ min: -5, max: 5, level: 2 });
  });

  it('writes the range back with the new level', () => {
    expect(encodeBassLevel({ min: -5, max: 5, level: -1 })).toEqual([0xfb, 0x05, 0xff]);
  });
});

describe('alert volume', () => {
  it('reads the level after the status', () => {
    expect(decodeAlertVolume(Uint8Array.from([0x00, 0x08]))).toBe(8);
  });
});
```

- [ ] **Step 2: Run to see them fail.** Run: `npx vitest run src/drivers/heymelody/protocol/feature.test.ts`. Expected: FAIL, module missing.

- [ ] **Step 3: Implement `protocol/feature.ts`:**

```ts
/**
 * Feature switches (`0x010D` query, `0x0403` set), BassWave level (`0x0124` / `0x041B`) and
 * alert-sound volume (`0x0130` / `0x0427`). Layouts: HeyMelody `HeadsetCoreService`, realme
 * notes, QuickBuds capture on OnePlus Buds 4.
 */

import { statusBody } from './status';

export const FeatureId = { AutoPlay: 4, GameLegacy: 6, BassWave: 29, GameMain: 40 } as const;

/** Every switch this driver surfaces, asked for in one `0x010D`. */
export const QUERIED_FEATURES: readonly number[] = [FeatureId.AutoPlay, FeatureId.GameLegacy, FeatureId.BassWave, FeatureId.GameMain];

export const ALERT_VOLUME_RANGE = { min: 1, max: 10 } as const;

const signed = (byte: number): number => (byte > 127 ? byte - 256 : byte);

export function encodeQueryFeatures(ids: readonly number[]): number[] {
  return [ids.length, ...ids];
}

/** `0x810D`: `[status][count]([id][value])…`; only the ids the model has come back. */
export function decodeFeatures(payload: Uint8Array): Map<number, boolean> {
  const body = statusBody(payload, 'feature query');
  const count = body[0] ?? 0;
  const features = new Map<number, boolean>();
  for (let i = 0; i < count && 2 + i * 2 < body.length; i += 1) {
    features.set(body[1 + i * 2], body[2 + i * 2] !== 0);
  }
  return features;
}

export function encodeSetFeature(id: number, on: boolean): number[] {
  return [id, on ? 1 : 0];
}

/**
 * Game mode is feature 40 on models with game sound (HeyMelody `GameModeItem`), 6 otherwise;
 * when a model has both, 6 is the low-latency switch.
 */
export function gameModeIds(features: ReadonlyMap<number, boolean>): { main: number | null; lowLatency: number | null } {
  if (features.has(FeatureId.GameMain)) {
    return { main: FeatureId.GameMain, lowLatency: features.has(FeatureId.GameLegacy) ? FeatureId.GameLegacy : null };
  }
  return { main: features.has(FeatureId.GameLegacy) ? FeatureId.GameLegacy : null, lowLatency: null };
}

export interface BassLevel {
  min: number;
  max: number;
  level: number;
}

/** `0x8124`: `[status][min s8][max s8][level s8]`. */
export function decodeBassLevel(payload: Uint8Array): BassLevel {
  const body = statusBody(payload, 'BassWave level');
  if (body.length < 3) throw new Error('BassWave level reply too short');
  return { min: signed(body[0]), max: signed(body[1]), level: signed(body[2]) };
}

export function encodeBassLevel({ min, max, level }: BassLevel): number[] {
  return [min & 0xff, max & 0xff, level & 0xff];
}

/** `0x8130`: `[status][level]`. */
export function decodeAlertVolume(payload: Uint8Array): number {
  const body = statusBody(payload, 'alert volume');
  if (body.length < 1) throw new Error('alert volume reply has no level');
  return body[0];
}
```

  Add the six ids to `cmd.ts`.

- [ ] **Step 4: Run the protocol tests.** Run: `npx vitest run src/drivers/heymelody/protocol/feature.test.ts`. Expected: PASS.

- [ ] **Step 5: Write the failing device tests** in `device.test.ts` (new `describe('HeyMelodyDevice feature switches', …)`), using `scriptedOpener` and `FULL_REPLIES` plus:
  - `Cmd.QueryFeatures` → `[0x00, 2, 0x04, 0x01, 0x28, 0x00]` and `Cmd.QueryAlertVolume` → `[0x00, 0x08]`, bitmap with bit 38 set for `0x0124` → `Cmd.QueryBassLevel` → `[0x00, 0xfb, 0x05, 0x02]`.
  - Tests: (a) after connect `state.features` equals `new Map([[4, true], [40, false]])`, `state.alertVolume === 8`, `state.bassLevel` is `{min:-5,max:5,level:2}`; (b) `setFeature(40, true)` sends `0x0403` payload `[40, 1]` and keeps `features.get(40) === true` on ack `[0x00]`; (c) an unanswered `setFeature` rolls the map back and sets `error`; (d) `setAlertVolume(3)` sends `0x0427 [3]` and keeps 3 on ack `[0x00, 3]`; (e) `setBassLevel(-1)` sends `0x041B [0xfb, 0x05, 0xff]`; (f) a device that does not answer `0x010D` still connects with an empty `features` map and no error.

- [ ] **Step 6: Implement in `state.ts` and `device.ts`.**
  - `state.ts`: add the three fields to `HeyMelodyState` with doc comments ("live-only: re-read on connect"), initial values `features: new Map()`, `bassLevel: null`, `alertVolume: null`. Do not add them to the durable snapshot.
  - `capability.ts`: extend `HeyMelodyFeature` with `'bassLevel' | 'alertVolume'`; `FEATURE_COMMANDS.bassLevel = [0x0124]` (bitmap row 38). `alertVolume` gets `FEATURE_COMMANDS.alertVolume = []` — no bitmap row carries `0x0130`, so it is only ever found by the probe below.
  - `device.ts`: add `#readFeatures(client)` (request `Cmd.QueryFeatures` with `encodeQueryFeatures(QUERIED_FEATURES)`, patch `features`), `#readBassLevel`, `#readAlertVolume`. In `#pollReported` call `#readFeatures` unconditionally (`0x010D` is a bootstrap command) inside a try/catch, `read('bassLevel', …)`, and probe the alert volume (try/catch, add `'alertVolume'` to `found` on success). In `#probeAll` also try `#readFeatures` and the alert volume.
  - Writes, each optimistic with rollback and `describeError` on failure, following `setFinding`:

```ts
  async setFeature(id: number, on: boolean): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    const previous = this.#store.state.features;
    this.#patch({ features: new Map(previous).set(id, on) });
    try {
      statusBody(await client.request(Cmd.SetFeature, encodeSetFeature(id, on)), `feature ${id}`);
    } catch (error) {
      this.#patch({ features: previous, error: describeError(error) });
    }
  }
```

    `setBassLevel(level)` clamps to `[min, max]` of the current `bassLevel` (no-op when null) and sends `encodeBassLevel`; `setAlertVolume(level)` clamps to `ALERT_VOLUME_RANGE` and sends `[level]`.

- [ ] **Step 7: Run to see them pass.** Run: `npx vitest run src/drivers/heymelody`. Expected: PASS.

- [ ] **Step 8: System UI and Home quick settings.**
  - In `System.tsx`, add a "Controls" card after the Device card, shown when any of these exist: auto play/pause (feature 4 present), game mode (`gameModeIds(state.features).main !== null`), low latency, BassWave (feature 29 present), alert volume (`state.alertVolume !== null`). Use `ToggleRow` from `@/ui/controls/SettingRow` for the switches (labels "Auto play/pause", "Game mode", "Low latency", "BassWave") with hints ("Pauses when you take an earbud out.", "Lower audio delay for games.", "A second low-latency setting on this model.", "Extra low end."). Under BassWave, when `state.bassLevel` is set, a `Slider` from `min` to `max` (step 1) with local draft and `onValueCommitted` → `device.setBassLevel`. An "Alert volume" `Slider` 1–10 with the same commit-on-release. All disabled when not connected.
  - Add to `CAPABILITY_NAMES` in `System.tsx`: `['bassLevel', 'BassWave level']`, `['alertVolume', 'Alert volume']`.
  - In `driver.ts` add `quickSettings(device, state)` returning toggles in this order, each only when present: game mode (main id), auto play/pause, BassWave, low latency — `{ kind: 'toggle', id: 'feature-<id>', label, value: state.features.get(id) ?? null, set: (v) => void device.setFeature(id, v) }`. Import `QuickSetting` from `@/core/driver` and `gameModeIds`, `FeatureId` from `./protocol/feature`.
  - Tests: `sections.render.test.tsx` — with `features: new Map([[4, true], [40, false]])` the System markup contains "Auto play/pause" and "Game mode" and not "Low latency"; `homeControls.test.ts` — replace the HeyMelody "has no quick settings" test with one asserting labels `['Game mode', 'Auto play/pause']` for that state, and that `set(true)` on the game-mode toggle calls `setFeature(40, true)`.

- [ ] **Step 9: Run everything.** Run: `npx vitest run && npx tsc -b && npx oxlint`. Expected: all green.

- [ ] **Step 10: Commit.**

```bash
git add src/drivers/heymelody src/homeControls.test.ts src/__snapshots__
git commit -m "feat(heymelody): auto play/pause, game mode, BassWave and alert volume"
```

---

### Task 7: Touch controls — read and remap

**Files:**
- Create: `src/drivers/heymelody/protocol/gesture.ts`, `src/drivers/heymelody/protocol/gesture.test.ts`, `src/drivers/heymelody/sections/TouchControls.tsx`
- Modify: `cmd.ts` (`QueryGestures = 0x0108`, `SetGestures = 0x0401`), `capability.ts` (`gestures: [0x0108]`), `state.ts` (`gestures: GestureRecord[]`, live-only, initial `[]`), `device.ts`, `sections/System.tsx`
- Test: `device.test.ts`, `sections.render.test.tsx`

**Interfaces:**
- Produces:
  - `export interface GestureRecord { deviceType: number; button: number; action: number; fn: number }`
  - `decodeGestures(payload: Uint8Array): GestureRecord[]`; `encodeGestures(records: readonly GestureRecord[]): number[]`
  - `export type PrevNextScheme = 'current' | 'legacy' | null`; `prevNextScheme(records: readonly GestureRecord[], brand: HeyMelodyCatalogEntry['brand'] | null): PrevNextScheme`
  - `functionLabel(fn: number, scheme: PrevNextScheme, brand): string`; `functionChoices(record: GestureRecord, records: readonly GestureRecord[], brand): { fn: number; label: string }[]`
  - `SIDE_LABEL: Record<number, string>` (1 Left, 2 Right, 4 Both), `ACTION_LABEL: Record<number, string>` (1 Single tap, 2 Double tap, 3 Triple tap, 4 Touch and hold, 6 Extended hold)
  - Device: `setGesture(record: GestureRecord, fn: number): Promise<void>` — writes `0x0401 [1][dt][btn][act][fn]`, then re-reads `0x0108`; optimistic with rollback.

Rules for `functionChoices` (conservative — writes only codes the table or the brand settles):
- Button `6` (calls): `0` none, `28` reject call, `29` answer / hang up.
- Otherwise: `0` none, `1` play/pause, voice assistant (`4` on realme, `3` otherwise — but if the table already uses `3` or `4` for an assistant, reuse that code), `11` volume up, `12` volume down, `8` noise control, `17` game mode; previous/next only when `prevNextScheme` is not null (`current` → 5/6, `legacy` → 4/5).
- `prevNextScheme`: `current` when any record has fn `6`; `legacy` when a record has fn `4` on a non-realme brand and none has `6`; otherwise `null`.
- `functionLabel(fn, scheme, brand)`:
  - `4`: "Voice assistant" on realme or when the scheme is not `legacy`; "Previous" under `legacy`.
  - `5`: "Previous" under `current`, "Next" under `legacy`, "Track control" when the scheme is `null`.
  - `6`: "Next".
  - fixed labels for the other codes (listed in Step 3); "Function N" for an unknown code.
- The record's current code is always in its choices, so the display never lies.

- [ ] **Step 1: Write the failing protocol tests** (`protocol/gesture.test.ts`):

```ts
import { describe, expect, it } from 'vitest';

import { decodeGestures, encodeGestures, functionChoices, functionLabel, prevNextScheme } from './gesture';

const rec = (deviceType: number, button: number, action: number, fn: number) => ({ deviceType, button, action, fn });

describe('touch-control table', () => {
  it('reads 4-byte records after the status and count', () => {
    expect(decodeGestures(Uint8Array.from([0x00, 2, 1, 1, 2, 1, 2, 1, 2, 6]))).toEqual([rec(1, 1, 2, 1), rec(2, 1, 2, 6)]);
  });

  it('writes a count and the records', () => {
    expect(encodeGestures([rec(1, 1, 2, 5)])).toEqual([1, 1, 1, 2, 5]);
  });

  it('refuses a non-zero status', () => {
    expect(() => decodeGestures(Uint8Array.from([0x01, 0]))).toThrow();
  });
});

describe('previous/next scheme', () => {
  it('is current when the table already uses 6', () => {
    expect(prevNextScheme([rec(1, 1, 2, 6)], 'oneplus')).toBe('current');
  });

  it('is legacy when an OPPO/OnePlus table uses 4 without 6', () => {
    expect(prevNextScheme([rec(1, 1, 2, 4)], 'oneplus')).toBe('legacy');
  });

  it('is unknown on realme with only 4, because 4 is the realme assistant', () => {
    expect(prevNextScheme([rec(1, 1, 2, 4)], 'realme')).toBeNull();
  });
});

describe('function labels and choices', () => {
  it('reads 4 as assistant on realme', () => {
    expect(functionLabel(4, null, 'realme')).toBe('Voice assistant');
  });

  it('offers call functions on the call button only', () => {
    expect(functionChoices(rec(4, 6, 2, 29), [rec(4, 6, 2, 29)], 'oneplus').map((c) => c.fn)).toEqual([0, 28, 29]);
  });

  it('offers previous/next only once the scheme is known', () => {
    const table = [rec(1, 1, 2, 1)];
    expect(functionChoices(table[0], table, 'oneplus').map((c) => c.fn)).not.toContain(5);
    const current = [rec(1, 1, 2, 6)];
    expect(functionChoices(current[0], current, 'oneplus').map((c) => c.fn)).toEqual(expect.arrayContaining([5, 6]));
  });

  it('always includes the code already set, even an unknown one', () => {
    const table = [rec(1, 1, 3, 25)];
    expect(functionChoices(table[0], table, 'oppo')).toContainEqual({ fn: 25, label: 'Function 25' });
  });
});
```

- [ ] **Step 2: Run to see them fail.** Expected: module missing.

- [ ] **Step 3: Implement `protocol/gesture.ts`** following the rules above (pure functions, `statusBody` for the reply, labels: 0 "None", 1 "Play/pause", 3 "Voice assistant", 7 "Volume", 8 "Noise control", 10 "Switch track", 11 "Volume up", 12 "Volume down", 17 "Game mode", 28 "Reject call", 29 "Answer / hang up"; 4/5/6 per scheme and brand as specified). Run the tests. Expected: PASS.

- [ ] **Step 4: Device.** Failing tests first in `device.test.ts` (bitmap bit 3 set; `Cmd.QueryGestures` → `[0x00, 2, 1,1,2,1, 2,1,2,6]`): (a) after connect `state.gestures` has 2 records and capabilities include `'gestures'`; (b) `setGesture(record0, 5)` sends `0x0401 [1, 1,1,2,5]` and re-queries `0x0108`; never sends `0x0402`; (c) the gesture read retries with `[0x02, 0x03, 0x01]` when the empty request is refused (`[[0x01], table]` scripted). Implement `#readGestures` (empty then retry), `read('gestures', …)` in `#pollReported`, and `setGesture` (optimistic replace of the one record; `statusBody` on `0x8401`; re-read; rollback on failure). Run: `npx vitest run src/drivers/heymelody`. Expected: PASS.

- [ ] **Step 5: UI.** Create `sections/TouchControls.tsx`: a "Touch controls" `Card`; rows grouped by side (Left, Right, Both), each row `SettingRow` with label `${ACTION_LABEL[action]}` (and "(calls)" for button 6) and a `Select` (from `@/components/ui/select`, as `sections/Noise.tsx` in the Sennheiser driver uses it) whose items are `functionChoices(...)`; `onValueChange` → `device.setGesture(record, Number(value))`; disabled when not connected. Render it in `System.tsx` after Controls when `state.gestures.length > 0`. Add `['gestures', 'Touch controls']` to `CAPABILITY_NAMES`. Test in `sections.render.test.tsx`: with two records the System markup contains "Touch controls", "Left", "Double tap" and "Play/pause".

- [ ] **Step 6: Run everything and commit.** Run: `npx vitest run && npx tsc -b && npx oxlint`. Expected: green.

```bash
git add src/drivers/heymelody src/__snapshots__
git commit -m "feat(heymelody): read and remap touch controls"
```

---

### Task 8: Connected devices — read-only list

**Files:**
- Create: `src/drivers/heymelody/protocol/multiDevice.ts`, `src/drivers/heymelody/protocol/multiDevice.test.ts`, `src/drivers/heymelody/sections/Devices.tsx`
- Modify: `cmd.ts` (`QueryDevices = 0x0112`), `capability.ts` (`multiDevice: [0x0112]`), `notify.ts` (`PushEvent.Devices = 0x06`), `state.ts` (`peers: PeerDevice[]`, live-only, initial `[]`), `device.ts`, `driver.ts`
- Test: `device.test.ts`, `driver.test.ts`, `src/homeControls.test.ts` or `src/summary.test.ts` (connections readout)

**Interfaces:**
- Produces:
  - `export interface PeerDevice { mac: string; name: string; connected: boolean; isThisDevice: boolean; audioActive: boolean }`
  - `decodePeerList(list: Uint8Array): PeerDevice[]` (`[count][entries]`, no status); `decodePeerReply(payload: Uint8Array): PeerDevice[]` (`statusBody` then `decodePeerList`)
  - Driver section `{ id: 'devices', label: 'Connections' }` when `capabilities.has('multiDevice')`; `connections(state)` readout: `null` while `peers` is empty, else `peers.map(({ name, connected, isThisDevice }) => ({ name, connected, isThisDevice }))`.

Entry rules: MAC is 6 bytes little-endian → display as `AA:BB:CC:DD:EE:FF` (reverse the bytes); then `entryLen`, `state`, `flags`, `nameLen`, name (UTF-8); the next entry starts at `endOfName + (entryLen − nameLen − 3)`; if that would move backwards or past the end, fall back to `endOfName`. `connected = state === 0x02`; flags bit0 = this device, bit2 = audio active. Skip entries whose MAC is all zeros. Show only connected peers in the UI; the readout lists all.

- [ ] **Step 1: Write the failing protocol tests** (`protocol/multiDevice.test.ts`). Build the fixture bytes in the test from these entries (own names, not captured ones):
  - entry A: MAC bytes `66 55 44 33 22 11`, entryLen `0x07` (nameLen 4 + 3), state `02`, flags `00`, nameLen `04`, "Desk";
  - entry B: MAC bytes `01 02 03 04 05 06`, entryLen `0x08` (5 + 3), state `02`, flags `01`, nameLen `05`, "Phone";
  - an overrun case: entry A with entryLen `0x40`, followed by entry B — B must still decode;
  - a skip case: an entry whose MAC is all zeros, followed by entry B — only B comes back.
  Assertions: MACs read `11:22:33:44:55:66` and `06:05:04:03:02:01`; names "Desk" and "Phone"; `isThisDevice` false then true; `connected` true for state `02`; `decodePeerReply` of a payload starting `01` throws.

- [ ] **Step 2: Run to see them fail; implement `multiDevice.ts`; run to pass.**

- [ ] **Step 3: Device.** Failing tests first: bitmap bit 29 set, `Cmd.QueryDevices` → `[0x00, …list]`; after connect `state.peers` has the entries and capabilities include `'multiDevice'`; a `0x0204` push with event `0x06` followed by a list replaces `peers`. Implement `#readPeers`, `read('multiDevice', …)` in `#pollReported`, and the push branch in `#onNotification` (`else if (event === PushEvent.Devices) this.#patch({ peers: decodePeerList(list) })` placed before the ANC fallthrough). Run. Expected: PASS.

- [ ] **Step 4: Driver + UI.** `driver.ts`: add `devices` to `HEYMELODY_SECTIONS` between sound and system, filtered by `capabilities.has('multiDevice')` once known (hidden before capabilities are known — unlike the others, there is nothing to show without the list); add `devices: HeyMelodyDevices` to `COMPONENTS`; add `connections`. `sections/Devices.tsx`: a "Connected devices" card listing connected peers (name, "This device" / "Playing audio" badges from flags), a muted "No other devices connected." when empty, and a caption "Switching devices from here isn't supported yet." Tests: `driver.test.ts` — sections include `devices` only with `multiDevice`; `connections` returns null for no peers and the mapped list otherwise.

- [ ] **Step 5: Run everything and commit.** Run: `npx vitest run && npx tsc -b && npx oxlint`. Expected: green.

```bash
git add src/drivers/heymelody src/homeControls.test.ts src/summary.test.ts src/__snapshots__
git commit -m "feat(heymelody): read-only list of connected devices"
```

---

### Task 9: End-to-end check in the browser (not committed)

Done by the controller, not a subagent, and nothing from it is committed.

- [ ] **Step 1:** Build a scratch Playwright script (outside the repo) that stubs `navigator.serial` with a port whose `readable`/`writable` streams speak the SPP frame format: decode each written frame with the same layout as `sppFrame.ts`, and answer from a table modelled on OnePlus Buds 4 (productId `00 14 54 06`, bitmap with bits 3, 10, 29, 34, 38 set, one custom preset, features 4/6/29, gestures table, two peers, alert volume 8, BassWave `FB 05 02`).
- [ ] **Step 2:** Drive it at 1280×800 and 390×844: Home shows built-in chips plus the custom chip; Sound shows Equalizer + Custom cards; New preset sends `0418 01…` and the list re-reads; selecting a custom sends `0418 02…` not `0406`; System shows Controls and Touch controls; changing a gesture sends `0401 01 …`; Connections lists the peers. Assert on the frames the stub received, and look at the screenshots.
- [ ] **Step 3:** Record the result (pass/fail per step, screenshots) in the final report.
