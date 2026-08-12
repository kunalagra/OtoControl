# Paired-Device Removal & Retiring the Invented Sound Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove a control built on a guessed command ID, add paired-device removal behind a two-tier safety guard, and gate every toggle on what the connected model actually has.

**Architecture:** Four independent slices over an existing GAIA v3 client. Protocol facts live in `src/gaia/`, orchestration and observable state in `src/device/`, presentation in `src/ui/`. Pure decisions (what may be removed, which toggles a model has) are plain functions in `src/device/state.ts` so they are testable without a transport; `MomentumDevice` calls them.

**Tech Stack:** TypeScript, React 19, Vite 8, Vitest 3, Tailwind 4, Web Serial.

**Spec:** `docs/superpowers/specs/2026-08-10-connections-and-sound-mode-design.md`

## Global Constraints

- **Commit each task on this branch, and nothing else.** Work happens in an isolated worktree on `worktree-connections-and-sound-mode`. **Never push, never merge, never switch to or touch `main`** — the user pushes to their own GitHub themselves. Commit messages explain *why*, not *what*, and end with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Git identity is set repo-locally to the user's personal account. **Never run `git config --global`** — the global identity belongs to their work account and must stay untouched.
- Run the full suite with `npm test` (Vitest, `run` mode). Lint with `npm run lint` (oxlint). Typecheck happens via `npm run build` (`tsc -b`).
- Never name a command in `src/gaia/knownCommands.ts` that has not been confirmed against hardware or a vendor dump.
- `SNAPSHOT_VERSION` stays at **1**. `applyDurable` reads an explicit field list, so stale keys in a cached snapshot are inert; bumping would wipe every user's remembered settings.
- Unverified protocol values go in `docs/PROTOCOL-UNKNOWNS.md`, never into code as a guess.
- Comments explain *why*, matching the density and voice of the surrounding file. Do not add narration comments to obvious code.
- User-facing copy for removal is taken verbatim from the vendor app: **"Disconnect the device before removing it."**

---

### Task 1: Retire the invented sound mode

The `Off / Equalizer / Podcast / Personalized` selector does not exist on the M4, and `0x0495:0x0803` is an unsourced guess that hardware rejects with `INVALID_PARAMETER`. Delete it rather than leave it writing guessed values to an unidentified command.

**Files:**
- Modify: `src/gaia/commands.ts:565-597` (remove the AudioMode block)
- Modify: `src/device/state.ts` (`DeviceState`, `initialState`, `DurableState`, `captureDurable`, `applyDurable`, `REDUCERS`)
- Modify: `src/device/device.ts` (import list, `#refreshAll`, `setAudioMode`)
- Modify: `src/ui/sections/Sound.tsx`
- Modify: `src/gaia/commands.test.ts:177-206` (delete the `sound mode (audio mode)` block)
- Modify: `src/gaia/unsafe.test.ts:28-32` (its comment states the belief being retired)
- Modify: `docs/PROTOCOL-UNKNOWNS.md`

**Interfaces:**
- Consumes: nothing.
- Produces: `DeviceState` no longer has `audioMode`. Later tasks must not reference it.

- [ ] **Step 1: Delete the tests that assert the invented model**

In `src/gaia/commands.test.ts`, delete the entire `describe('sound mode (audio mode)', ...)` block (lines 177–206). Then remove the now-unused imports from the `./commands` import list at the top: `AUDIO_MODE_OPTIONS`, `AudioMode`, `getAudioMode`, `setAudioMode`.

Keep `getAudioPromptMode` if it is still referenced elsewhere in the file; check with `grep -n getAudioPromptMode src/gaia/commands.test.ts` and remove it from the imports only if the sole use was inside the deleted block.

- [ ] **Step 2: Run the suite to see it still passes**

Run: `npm test`
Expected: PASS. Deleting tests for a feature we are about to delete cannot fail; this confirms you removed exactly the right imports and nothing else depended on them.

- [ ] **Step 3: Remove the commands**

In `src/gaia/commands.ts`, delete this entire block (the comment through `setAudioMode`):

```ts
/**
 * Sound mode — which processing the headphones apply.
 * ... (through) ...
export const getAudioMode = getter('getAudioMode', 0x0804, u8);
export const setAudioMode = setter<number>('setAudioMode', 0x0803, (mode) => [mode]);
```

Leave `getSidetone`/`setSidetone` below it untouched.

- [ ] **Step 4: Remove the state field**

In `src/device/state.ts`:

Delete from the `./commands` import list: `getAudioMode`.

Delete the `audioMode` field and its doc comment from `DeviceState`:

```ts
  /** Which sound processing is active; the manual EQ only applies in Equalizer. */
  audioMode: number | null;
```

Delete `audioMode: null,` from `initialState`, `audioMode: number | null;` from `DurableState`, `audioMode: state.audioMode,` from `captureDurable`, and `audioMode: snapshot.audioMode,` from `applyDurable`.

Delete this line from `REDUCERS`:

```ts
  entry(getAudioMode, (s, v) => ({ ...s, audioMode: v })),
```

- [ ] **Step 5: Remove the orchestration**

In `src/device/device.ts`, delete `getAudioMode,` and `setAudioMode,` from the `../gaia/commands` import list, delete this line from `#refreshAll`:

```ts
    await read(getAudioMode, (audioMode) => this.#patch({ audioMode }));
```

and delete the whole `setAudioMode` method:

```ts
  async setAudioMode(mode: number): Promise<void> {
    const previous = this.#state.audioMode;
    await this.#write(
      setAudioMode,
      mode,
      (s) => ({ ...s, audioMode: mode }),
      (s) => ({ ...s, audioMode: previous }),
    );
  }
```

- [ ] **Step 6: Remove the UI**

In `src/ui/sections/Sound.tsx`, change the import to drop the two dead names:

```tsx
import { EQ_PRESETS, eqBandLabel } from '@/gaia/commands'
```

Delete the `eqInactive` line:

```tsx
  // The bands are still readable and settable in other modes, but inaudible.
  const eqInactive = state.audioMode !== null && state.audioMode !== AudioMode.Equalizer
```

Delete the entire first `<Card>` (the `Sound mode` card, from `<Card data-size="sm">` through its closing `</Card>` just before the Equalizer card).

In the Equalizer `<CardHeader>`, delete the caveat that only made sense under the invented model:

```tsx
          {eqInactive && (
            <p className="text-muted-foreground text-xs">
              These bands only apply while the sound mode is Equalizer.
            </p>
          )}
```

- [ ] **Step 7: Correct the stale comment in the safety test**

In `src/gaia/unsafe.test.ts`, the test `does not block a command that merely shares an ID across vendors` carries the belief this task retires. Replace its comment and keep both assertions:

```ts
  it('does not block a command that merely shares an ID across vendors', () => {
    // 0x0804 erases the panic log on Qualcomm. The Sennheiser command at the
    // same ID is unidentified (see PROTOCOL-UNKNOWNS.md) but not destructive,
    // so the guard must key on vendor as well as command.
    expect(isBlocked(Vendor.Qualcomm, 0x0804)).toBe(true);
    expect(isBlocked(Vendor.Sennheiser, 0x0804)).toBe(false);
  });
```

- [ ] **Step 8: Record what was learned**

In `docs/PROTOCOL-UNKNOWNS.md`, insert this section immediately before the `## Soundcore — reachable but silent on macOS` section:

````markdown
## Sennheiser — "sound mode" was invented; 0x0803/0x0804 unidentified ❓ open

This app shipped a Sound mode selector offering `Off / Equalizer / Podcast /
Personalized` over Sennheiser `0x0803`/`0x0804`. **No part of it was real** and
it has been removed.

**The concept does not exist.** Decompiling Smart Control Plus 1.4.2 (the
armeabi-v7a build is un-obfuscated and retains `package:chili/...` Dart source
paths) shows five *independent* features — `Equalizer`, `PodcastMode`,
`SoundPersonalization`, `SoundZones`, `AudioModes` — each with its own
`feature_variant_configs` entry and its own `product_features/` tree. There is
no mutually-exclusive selector.

- **`AudioModes` means codec/resolution, not sound profile.** The M4's shipped
  config gives it `support: ["aptX96kHz"]` and
  `productSupportedResolutions: ["highResolution"]`. The UI key
  `audioModesPage_applyAndRestartButton` shows that changing it **reboots the
  device**.
- **`SoundZones` never touches GAIA.** It is phone-side geofencing that
  re-applies Equalizer and NoiseControl configs on zone entry.

**The IDs were unsourced.** `reference/m4.json` runs `0x0801`/`0x0802`
AudioPrompt_Mode, then jumps to `0x0805`/`0x0806` Sidetone. Nothing claims
`0x0803`/`0x0804` in the Sennheiser (`0x0495`) space. The `0x001D` entries at
those IDs are Qualcomm `Debug_GetPanicLogInfo`/`ErasePanicLog` — a different
vendor.

**What the hardware said.** A MOMENTUM 4 rejects `setAudioMode`. Reported from
the app's own error surface, not captured at frame level:

```
setAudioMode failed (command 0x983, status 0x5)
```

`0x0983` decodes as feature 4, PDU type 3 (error), index 3 — our own `0x0803`.
Status `0x05` is GAIA v3 `INVALID_PARAMETER`, **not** `0x01`
`COMMAND_NOT_SUPPORTED`. The command exists; the argument was rejected.

**Leading hypothesis, not confirmed:** the app ships
`generic_audio/audio_prompts_volume.dart` and `set_audio_prompts_volume.dart`
with no ID otherwise accounted for, and indices 3/4 sit between
AudioPrompt_Mode (1/2) and Sidetone (5/6). `AudioPrompt_Volume_Set`/`_Get`
would explain `INVALID_PARAMETER` exactly — a mode enum sent to a volume
setter.

**To settle it:** probe `0x0804` with a zero payload (below). A getter answers
with its current value; a setter answers `INVALID_PARAMETER`.

Exact IDs for Podcast mode and sound personalization are **not obtainable from
the APK** — GAIA v3 packs `pdu = (feature << 9) | (type << 7) | index`, so Dart
holds the parts, never the 16-bit literal. Scanning both binaries for every
encoding a constant could take produced zero hits on known-good IDs. Getting
them needs Dart AOT decompilation (blutter/Ghidra).
````

- [ ] **Step 9: Verify**

Run: `npm test && npm run lint && npm run build`
Expected: all PASS. `tsc -b` is the real check here — it fails on any surviving reference to `state.audioMode` or the deleted commands.

- [ ] **Step 10: Commit and report**

Commit the change with a message explaining why the sound mode was invented and how the hardware proved it. State which files changed.

---

### Task 2: Two-tier command safety

`unsafe.ts` blocks `0x1405`–`0x1406` on all three send paths, which is why removal cannot be built. Split the guard so a deliberate typed delete is possible while sweeps and raw frames still cannot reach it.

**Files:**
- Modify: `src/gaia/unsafe.ts`
- Modify: `src/device/client.ts:196-215` (`sendRaw`, `probe`)
- Modify: `src/gaia/unsafe.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `sweepBlockedReason(vendor: number, command: number): string | undefined` and `isSweepBlocked(vendor: number, command: number): boolean`, both exported from `src/gaia/unsafe.ts`. `blockedReason`/`isBlocked` keep their existing signatures and now exclude `0x1405`.

- [ ] **Step 1: Write the failing tests**

In `src/gaia/unsafe.test.ts`, add `isSweepBlocked` to the import from `./unsafe`, then replace the existing test `blocks paired-device deletion but not the rest of the device list` with:

```ts
  it('blocks wiping the whole paired-device list on every path', () => {
    expect(isBlocked(Vendor.Sennheiser, 0x1406)).toBe(true);
    expect(isSweepBlocked(Vendor.Sennheiser, 0x1406)).toBe(true);
  });

  it('allows a deliberate single-entry delete but never a swept one', () => {
    // A zero-payload sweep across 0x14xx could be read by firmware as
    // "delete index 0", so 0x1405 is reachable only as a typed command.
    expect(isBlocked(Vendor.Sennheiser, 0x1405)).toBe(false);
    expect(isSweepBlocked(Vendor.Sennheiser, 0x1405)).toBe(true);
  });

  it('leaves the rest of the device list alone on both paths', () => {
    for (const command of [0x1400, 0x1401, 0x1402, 0x1403, 0x1404, 0x1407, 0x1409]) {
      expect(isBlocked(Vendor.Sennheiser, command), command.toString(16)).toBe(false);
      expect(isSweepBlocked(Vendor.Sennheiser, command), command.toString(16)).toBe(false);
    }
  });

  it('keeps the never-sendable ranges out of sweeps too', () => {
    expect(isSweepBlocked(Vendor.Sennheiser, 0x0040)).toBe(true);
    expect(isSweepBlocked(Vendor.Sennheiser, 0x0200)).toBe(true);
    expect(isSweepBlocked(Vendor.Qualcomm, 0x0c00)).toBe(true);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- src/gaia/unsafe.test.ts`
Expected: FAIL — `isSweepBlocked` is not exported.

- [ ] **Step 3: Implement the split**

Rewrite `src/gaia/unsafe.ts` from the doc comment down:

```ts
/**
 * Command IDs that must never be sent, and those that must never be swept.
 *
 * Firmware upgrade over a reverse-engineered channel can brick the headphones,
 * and wiping the paired-device list destroys state that cannot be recovered
 * from this app. IDs taken from `reference/m4.json`.
 *
 * The two tiers exist because "destructive" and "unsafe to guess at" are
 * different questions. Deleting one pairing is a real thing a user may ask for,
 * so it is reachable as a deliberate typed command — but a zero-payload sweep
 * across 0x14xx could be read by firmware as "delete index 0", so it stays out
 * of the sweep and raw-frame paths.
 *
 * This is enforced in code, not only in the UI.
 */

import { Vendor } from './frame';

interface Range {
  vendor: number;
  from: number;
  to: number;
  reason: string;
}

/** Never sendable, by any path. */
const BLOCKED: Range[] = [
  // Firmware upgrade: enter DFU, set file size, progress.
  { vendor: Vendor.Sennheiser, from: 0x0200, to: 0x02ff, reason: 'firmware upgrade' },
  // Factory reset.
  { vendor: Vendor.Sennheiser, from: 0x0040, to: 0x0040, reason: 'factory reset' },
  // 0x1406 wipes the entire paired-device list. No vendor app implements it.
  { vendor: Vendor.Sennheiser, from: 0x1406, to: 0x1406, reason: 'wipes the paired-device list' },
  // Qualcomm GAIA upgrade transport.
  { vendor: Vendor.Qualcomm, from: 0x0c00, to: 0x0cff, reason: 'firmware upgrade' },
  // Erase panic log.
  { vendor: Vendor.Qualcomm, from: 0x0804, to: 0x0804, reason: 'erases device logs' },
];

/** Safe as a deliberate call, never as a sweep or a hand-written frame. */
const SWEEP_BLOCKED: Range[] = [
  { vendor: Vendor.Sennheiser, from: 0x1405, to: 0x1405, reason: 'deletes a paired device' },
];

const find = (ranges: Range[], vendor: number, command: number): string | undefined =>
  ranges.find(
    (range) => range.vendor === vendor && command >= range.from && command <= range.to,
  )?.reason;

/** Why a command is blocked outright, or undefined if it may be sent. */
export function blockedReason(vendor: number, command: number): string | undefined {
  return find(BLOCKED, vendor, command);
}

export const isBlocked = (vendor: number, command: number): boolean =>
  blockedReason(vendor, command) !== undefined;

/**
 * Why a command may not be swept or sent as a raw frame.
 *
 * A superset of `blockedReason`: everything unsendable is also unsweepable.
 */
export function sweepBlockedReason(vendor: number, command: number): string | undefined {
  return blockedReason(vendor, command) ?? find(SWEEP_BLOCKED, vendor, command);
}

export const isSweepBlocked = (vendor: number, command: number): boolean =>
  sweepBlockedReason(vendor, command) !== undefined;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- src/gaia/unsafe.test.ts`
Expected: PASS.

- [ ] **Step 5: Route the sweep paths through the new guard**

In `src/device/client.ts`, change the import:

```ts
import { blockedReason, isBlocked, sweepBlockedReason } from '../gaia/unsafe';
```

In `sendRaw`, swap the guard:

```ts
      const reason = sweepBlockedReason(vendor, command);
      if (reason) throw new Error(`refusing to send this frame: ${reason}`);
```

In `probe`, swap the guard:

```ts
    const reason = sweepBlockedReason(vendor, command);
    if (reason) return { command, outcome: 'blocked', detail: reason };
```

Leave `#send`'s `isBlocked` check alone — that is the tier that must still admit a typed `0x1405`.

- [ ] **Step 6: Verify**

Run: `npm test && npm run lint && npm run build`
Expected: all PASS. `client.test.ts` has existing blocked-command tests; confirm they still pass, since `blockedReason` is still imported there for the `#send` path.

- [ ] **Step 7: Commit and report**

---

### Task 3: Remove a paired device

**Files:**
- Modify: `src/gaia/commands.ts` (after `disconnectPairedDevice`, ~line 521)
- Modify: `src/device/state.ts` (add `removalBlockedReason`)
- Modify: `src/device/device.ts` (`refreshConnections`, new `removePairedDevice`)
- Modify: `src/gaia/commands.test.ts` (`paired devices` describe block, ~line 120)
- Modify: `src/device/state.test.ts`

**Interfaces:**
- Consumes: `isSweepBlocked` from Task 2 (only indirectly — Task 2 must land first or `#send` will refuse `0x1405`).
- Produces:
  - `deletePairedDevice: Command<number, void>` from `src/gaia/commands.ts`
  - `removalBlockedReason(state: DeviceState, index: number): string | null` from `src/device/state.ts`
  - `MomentumDevice.removePairedDevice(index: number): Promise<void>`
  - `MomentumDevice.refreshConnections(): Promise<boolean>` — **signature change**, was `Promise<void>`

- [ ] **Step 1: Write the failing command test**

In `src/gaia/commands.test.ts`, add `deletePairedDevice` to the `./commands` import list, then add this test inside the existing `describe('paired devices', ...)` block:

```ts
  it('encodes a delete for one entry', () => {
    expect(deletePairedDevice.id).toBe(0x1405);
    expect(deletePairedDevice.encode(3)).toEqual([3]);
  });

  it('belongs to device management, which is subscribed', () => {
    expect(featureOf(deletePairedDevice.id)).toBe(SennheiserFeature.DeviceManagement);
    expect(SUBSCRIBED_FEATURES).toContain(SennheiserFeature.DeviceManagement);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- src/gaia/commands.test.ts`
Expected: FAIL — `deletePairedDevice` is not exported.

- [ ] **Step 3: Add the command**

In `src/gaia/commands.ts`, directly after `disconnectPairedDevice`:

```ts
/**
 * Forgets one entry. The vendor app sends this per index and has no
 * "forget all" — `DeviceList_DeletePDL` (0x1406) is implemented by no shipping
 * client and stays blocked in `unsafe.ts`.
 *
 * Deleting does not compact the list: the remaining entries keep their
 * indices, so a re-read must tolerate holes.
 */
export const deletePairedDevice = setter<number>(
  'deletePairedDevice',
  0x1405,
  (index) => [index],
);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- src/gaia/commands.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing precondition test**

In `src/device/state.test.ts`, add `removalBlockedReason` to the `./state` import, then add:

```ts
describe('removalBlockedReason', () => {
  // Index 0 is us; 1 is another connected device; 3 is remembered but away.
  // The gap at 2 is deliberate — deleting does not compact the list.
  const withDevices = (): DeviceState => ({
    ...initialState,
    connections: {
      devices: [
        { index: 0, priority: 0, connected: true, name: 'This Mac' },
        { index: 1, priority: 1, connected: true, name: 'iPhone' },
        { index: 3, priority: 2, connected: false, name: 'Pixel' },
      ],
      maxConnections: 2,
      ownIndex: 0,
    },
  });

  it('allows removing a remembered device that is not connected', () => {
    expect(removalBlockedReason(withDevices(), 3)).toBeNull();
  });

  it('refuses a connected entry, matching the vendor app', () => {
    expect(removalBlockedReason(withDevices(), 1)).toBe(
      'Disconnect the device before removing it.',
    );
  });

  it('refuses our own entry even when it reports disconnected', () => {
    // Removing the entry we are talking through is not a coherent action, and
    // the self-check must win over the connected-check rather than fall
    // through to it.
    const state = withDevices();
    state.connections.devices[0] = { ...state.connections.devices[0], connected: false };
    expect(removalBlockedReason(state, 0)).toBe('This device cannot remove itself.');
  });

  it('refuses an index that is not in the list', () => {
    expect(removalBlockedReason(withDevices(), 7)).toBe(
      'That device is no longer in the list.',
    );
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npm test -- src/device/state.test.ts`
Expected: FAIL — `removalBlockedReason` is not exported.

- [ ] **Step 7: Implement the precondition**

In `src/device/state.ts`, add after `applyDurable`:

```ts
/**
 * Why a paired entry cannot be forgotten, or null when it can be.
 *
 * The vendor app guards removal with a precondition rather than a confirmation
 * dialog — its sibling features have confirm dialogs and this one deliberately
 * does not — so the same rule is enforced here: a connected device must be
 * disconnected first. Our own entry is never removable, whatever it reports.
 */
export function removalBlockedReason(state: DeviceState, index: number): string | null {
  const entry = state.connections.devices.find((device) => device.index === index);
  if (!entry) return 'That device is no longer in the list.';
  if (index === state.connections.ownIndex) return 'This device cannot remove itself.';
  if (entry.connected) return 'Disconnect the device before removing it.';
  return null;
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `npm test -- src/device/state.test.ts`
Expected: PASS.

- [ ] **Step 9: Make the connection re-read report success**

In `src/device/device.ts`, change `refreshConnections` to return whether it got a list. Change the signature and the two early returns:

```ts
  async refreshConnections(): Promise<boolean> {
    const client = this.#client;
    if (!client) return false;

    let count = 0;
    try {
      count = await client.request(getPairedDeviceCount, undefined);
    } catch (error) {
      console.warn('[device] getPairedDeviceCount failed', error);
      return false;
    }
```

and add `return true;` as the last statement of the method, after the `this.#patch({ connections: ... })` call.

Also extend the doc comment on the per-index loop so the hole-tolerance is deliberate rather than accidental:

```ts
    // 0x1400 is an upper bound, not a live count: deleting an entry does not
    // compact the list, so indices have holes. The vendor app logs
    // "Encountered gap in paired devices list at index" for exactly this.
    const devices = [];
```

- [ ] **Step 10: Implement removal**

In `src/device/device.ts`, add `deletePairedDevice,` to the `../gaia/commands` import list and `removalBlockedReason,` to the `./state` import list. Add a module-level constant near the top, after the imports:

```ts
/**
 * How long to wait before re-reading the list after a delete.
 *
 * The vendor app names this condition — "Device list is not available after
 * device removal because of FW bug" — and ships an analytics event for it, so
 * one failed read is expected rather than exceptional.
 */
const DELETE_REREAD_DELAY_MS = 500;
```

Add the method directly after `setDeviceConnected`:

```ts
  /**
   * Forgets one of the headphones' remembered devices.
   *
   * A failed re-read afterwards is not treated as a failure: the delete has
   * already happened, and reporting an error over a successful removal is worse
   * than showing a list that is one refresh out of date.
   */
  async removePairedDevice(index: number): Promise<void> {
    const client = this.#client;
    if (!client) return;

    const blocked = removalBlockedReason(this.#state, index);
    if (blocked) {
      this.#patch({ error: blocked });
      return;
    }

    try {
      await client.request(deletePairedDevice, index);
    } catch (error) {
      this.#patch({ error: describeError(error) });
      return;
    }

    if (await this.refreshConnections()) return;
    await new Promise((resolve) => setTimeout(resolve, DELETE_REREAD_DELAY_MS));
    await this.refreshConnections();
  }
```

- [ ] **Step 11: Verify**

Run: `npm test && npm run lint && npm run build`
Expected: all PASS.

- [ ] **Step 12: Commit and report**

Note in the report that `removePairedDevice`'s orchestration (the retry, the tolerated failure) is **not** unit-tested: `MomentumDevice` builds its own `SerialTransport` in `#connectTo` and has no injectable seam, so there is no `device.test.ts`. The decision logic is covered via `removalBlockedReason`. Adding a transport seam is out of scope for this plan; flag it as a known gap.

---

### Task 4: Removal UI, and self-row disconnect

**Files:**
- Modify: `src/ui/sections/Devices.tsx`
- Modify: `src/device/device.ts` (`setDeviceConnected`, `#handleDrop`, `disconnect`)

**Interfaces:**
- Consumes: `removalBlockedReason` and `MomentumDevice.removePairedDevice` from Task 3.
- Produces: no new exports.

- [ ] **Step 1: Let the self-row disconnect end the session cleanly**

The M4's own `parameters` block sets `"pairedDevicesDisconnectOwnDevice": true`, so the device permits this. It drops the control link this page runs on, so it must read as an intentional end of session, not a fault.

In `src/device/device.ts`, add a field beside `#refreshing`:

```ts
  /** Set while we are deliberately dropping our own link, so the resulting
   *  transport close is reported as a clean disconnect rather than an error. */
  #intentionalDrop = false;
```

Replace `setDeviceConnected` with:

```ts
  /**
   * Connects or disconnects one of the headphones' remembered devices.
   *
   * Disconnecting the entry that is this machine drops our own control link, so
   * there is no reply to wait for — the link going away is the confirmation.
   */
  async setDeviceConnected(index: number, connected: boolean): Promise<void> {
    const client = this.#client;
    if (!client) return;

    if (!connected && index === this.#state.connections.ownIndex) {
      this.#intentionalDrop = true;
      try {
        await client.request(disconnectPairedDevice, index);
      } catch (error) {
        // A dropped link can surface as a rejected request; that is the
        // expected outcome here, not a failure worth showing.
        console.warn('[device] self-disconnect did not answer', error);
      }
      return;
    }

    try {
      await client.request(connected ? connectPairedDevice : disconnectPairedDevice, index);
      // The headphones report the real outcome via 0x1484; ask in case they don't.
      const status = await client.request(getConnectionStatus, index);
      this.#replace(
        applyNotification(this.#state, {
          flags: 0,
          vendor: Vendor.Sennheiser,
          command: 0x1504,
          payload: Uint8Array.from([status.index, status.connected ? 1 : 0]),
          raw: new Uint8Array(0),
        }),
      );
    } catch (error) {
      this.#patch({ error: describeError(error) });
    }
  }
```

In `#handleDrop`, honour the flag:

```ts
  #handleDrop(reason?: Error): void {
    const intentional = this.#intentionalDrop;
    this.#intentionalDrop = false;
    this.#client?.abort(reason ?? new Error('connection lost'));
    this.#transport = null;
    this.#client = null;
    this.#patch({
      ...initialState,
      status: 'disconnected',
      error: intentional || !reason ? null : describeError(reason),
    });
  }
```

In `disconnect()`, clear the flag as the first statement so an aborted attempt cannot leak into a later drop:

```ts
  async disconnect(): Promise<void> {
    this.#intentionalDrop = false;
    const transport = this.#transport;
```

- [ ] **Step 2: Rewrite the row actions**

Replace the row body in `src/ui/sections/Devices.tsx` — everything from `{isSelf && (` through the closing `)}` of the connect/disconnect button — with:

```tsx
                    {isSelf && (
                      <Badge variant="secondary" className="shrink-0">
                        This Mac
                      </Badge>
                    )}

                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={disabled}
                        onClick={() =>
                          void device.setDeviceConnected(entry.index, !entry.connected)
                        }
                      >
                        {entry.connected ? 'Disconnect' : 'Connect'}
                      </Button>

                      {/* The vendor app guards removal with a precondition
                          rather than a confirmation: a connected device must be
                          disconnected first. Our own row is never removable. */}
                      {!isSelf && !entry.connected && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={disabled}
                          className="text-muted-foreground"
                          onClick={() => void device.removePairedDevice(entry.index)}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
```

- [ ] **Step 3: Explain the two withheld actions in the hint line**

Still in `Devices.tsx`, replace the summary paragraph with one that says why a Remove button is missing when it is:

```tsx
            <p className="text-muted-foreground text-xs">
              {connectedCount} connected
              {maxConnections !== null && ` of ${maxConnections} at once`}
              {maxConnections !== null && maxConnections > 1 && ' · multipoint'}
              {devices.some((entry) => entry.connected && entry.index !== ownIndex) &&
                ' · disconnect a device before removing it'}
            </p>
```

- [ ] **Step 4: Verify**

Run: `npm test && npm run lint && npm run build`
Expected: all PASS.

- [ ] **Step 5: Check it renders**

Run: `npm run dev`, open the app, and confirm the Connections section compiles and lays out with no device connected (it shows the "Connect to load the paired-device list." empty state). Full behaviour needs hardware — see Task 7.

- [ ] **Step 6: Commit and report**

---

### Task 5: Gate toggles by profile

`TOGGLES` renders and polls unconditionally, so every Sennheiser device gets every toggle whether the hardware has it or not. The M4's low-latency toggle is the visible instance — `m4.json` sets `"LowLatencyMode_MinFwVersion": "99.99.99"`, the never-enable sentinel.

**Files:**
- Modify: `src/device/profiles.ts`
- Modify: `src/device/state.ts`
- Modify: `src/device/device.ts:297` (`#refreshAll` toggle loop)
- Modify: `src/ui/sections/System.tsx:27`
- Modify: `src/ui/sections/Sound.tsx`
- Modify: `src/device/state.test.ts`
- Modify: `src/device/profiles.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `Feature.ComfortCall` (`'comfort-call'`) and `Feature.BluetoothCompatibility` (`'bluetooth-compatibility'`)
  - `ToggleSpec.feature: FeatureId`
  - `togglesFor(model: string | null): ToggleSpec[]` from `src/device/state.ts`

- [ ] **Step 1: Write the failing tests**

In `src/device/state.test.ts`, add `togglesFor` and `TOGGLES` to the `./state` import (TOGGLES may already be there) and add:

```ts
describe('togglesFor', () => {
  it('drops the toggles a known model does not have', () => {
    // m4.json sets LowLatencyMode_MinFwVersion to 99.99.99 — never enabled.
    const keys = togglesFor('M4AEBT Black').map((toggle) => toggle.key);
    expect(keys).not.toContain('lowLatency');
    expect(keys).toContain('touchControls');
  });

  it('shows everything for a model we do not recognise', () => {
    // An unmatched model means no knowledge, not absence — the same choice
    // sectionsForDevice makes before a capability table has been read.
    expect(togglesFor('SOME-NEW-MODEL')).toHaveLength(TOGGLES.length);
    expect(togglesFor(null)).toHaveLength(TOGGLES.length);
  });

  it('gives every toggle a feature the vocabulary names', () => {
    for (const toggle of TOGGLES) {
      expect(FEATURE_NAMES[toggle.feature], toggle.key).toBeTruthy();
    }
  });
});
```

Add to the imports at the top of the file:

```ts
import { FEATURE_NAMES } from './profiles';
```

In `src/device/profiles.test.ts`, add to the `unsupportedFeatures` describe block:

```ts
  it('does not claim low latency, which this model never enables', () => {
    // m4.json: "LowLatencyMode_MinFwVersion": "99.99.99".
    const m4 = PROFILES.find((profile) => profile.id === 'momentum-4')!;
    expect(m4.features).not.toContain(Feature.LowLatency);
    expect(m4.features).toContain(Feature.ComfortCall);
    expect(m4.features).toContain(Feature.BluetoothCompatibility);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- src/device/state.test.ts src/device/profiles.test.ts`
Expected: FAIL — `togglesFor` is not exported and `Feature.ComfortCall` does not exist.

- [ ] **Step 3: Extend the feature vocabulary**

In `src/device/profiles.ts`, add to the `behaviour` group of `Feature`, after `AutoAnswer`:

```ts
  /** Call audio processed for a more natural sound. */
  ComfortCall: 'comfort-call',
```

and after `LowLatency`:

```ts
  /** A more stable link, at the cost of some features. */
  BluetoothCompatibility: 'bluetooth-compatibility',
```

Add to `FEATURE_NAMES`:

```ts
  [F.ComfortCall]: 'Comfort call',
  [F.BluetoothCompatibility]: 'Bluetooth compatibility mode',
```

- [ ] **Step 4: Correct the M4 profile**

In the `momentum-4` profile's `features`, delete `F.LowLatency,` and add `F.ComfortCall,` and `F.BluetoothCompatibility,`. The list becomes:

```ts
    features: [
      F.Anc,
      F.Transparency,
      F.Equalizer,
      F.BassBoost,
      F.Sidetone,
      F.WearDetection,
      F.SmartPause,
      F.AutoAnswer,
      F.ComfortCall,
      F.TouchControls,
      F.VoicePrompts,
      F.AutoPowerOff,
      F.BluetoothCompatibility,
      F.Multipoint,
    ],
```

In `IMPLEMENTED.sennheiser`, add `F.ComfortCall,` and `F.BluetoothCompatibility,` — we drive both, and `unsupportedFeatures(m4)` must stay empty. **Keep `F.LowLatency`**: it describes what the app can drive, which is still true, and a Sennheiser model that has the feature should get the control for free.

- [ ] **Step 5: Declare the feature on each toggle and add the filter**

In `src/device/state.ts`, add to the imports:

```ts
import { Feature, profileFor } from './profiles';
import type { FeatureId } from './profiles';
```

Add the field to `ToggleSpec`:

```ts
export interface ToggleSpec {
  key: ToggleKey;
  group: ToggleGroup;
  /** What the hardware must have for this toggle to mean anything. */
  feature: FeatureId;
  label: string;
  description: string;
  get: Command<void, boolean>;
  set: Command<boolean, void>;
}
```

Add a `feature:` line to each entry in `TOGGLES`, directly after its `group:` line:

| `key` | line to add |
|---|---|
| `bassBoost` | `feature: Feature.BassBoost,` |
| `smartPause` | `feature: Feature.SmartPause,` |
| `onHeadDetection` | `feature: Feature.WearDetection,` |
| `autoAnswer` | `feature: Feature.AutoAnswer,` |
| `comfortCall` | `feature: Feature.ComfortCall,` |
| `lowLatency` | `feature: Feature.LowLatency,` |
| `touchControls` | `feature: Feature.TouchControls,` |
| `bluetoothCompatibility` | `feature: Feature.BluetoothCompatibility,` |

Then add the filter after `TOGGLES`:

```ts
/**
 * The toggles a particular model actually has.
 *
 * `TOGGLES` is the whole Sennheiser vocabulary; this narrows it to one product.
 * An unrecognised model returns everything: no match means we know nothing
 * about it, which is not the same as it having nothing — the same choice
 * `sectionsForDevice` makes before a capability table has been read.
 *
 * Hiding rather than disabling is deliberate. A greyed-out control the hardware
 * does not have is a guess presented as a fact.
 */
export function togglesFor(model: string | null): ToggleSpec[] {
  const profile = profileFor('sennheiser', model);
  if (!profile) return TOGGLES;
  const features = new Set<FeatureId>(profile.features);
  return TOGGLES.filter((toggle) => features.has(toggle.feature));
}
```

- [ ] **Step 6: Run to verify it passes**

Run: `npm test -- src/device/state.test.ts src/device/profiles.test.ts`
Expected: PASS.

- [ ] **Step 7: Gate the poll loop**

In `src/device/device.ts`, add `togglesFor,` to the `./state` import list, then change the toggle loop in `#refreshAll`:

```ts
    // Model is read at the top of this method, so the profile is known by now.
    // A device that does not have a setting should not be asked about it.
    for (const { key, get } of togglesFor(this.#state.info.model)) {
      await read(get, (value) =>
        this.#patch({ toggles: { ...this.#state.toggles, [key]: value } }),
      );
    }
```

- [ ] **Step 8: Gate the two rendering sites**

In `src/ui/sections/System.tsx`, change the import `import { TOGGLES } from '@/device/state'` to `import { togglesFor } from '@/device/state'` and line 27 to:

```tsx
  const behaviourToggles = togglesFor(state.info.model).filter(
    (toggle) => toggle.group === 'behaviour',
  )
```

In `src/ui/sections/Sound.tsx`, change the import `import { TOGGLES } from '@/device/state'` to `import { togglesFor } from '@/device/state'` and the `soundToggles` line to:

```tsx
  const soundToggles = togglesFor(state.info.model).filter((toggle) => toggle.group === 'sound')
```

- [ ] **Step 9: Verify**

Run: `npm test && npm run lint && npm run build`
Expected: all PASS. In particular `profiles.test.ts`'s `unsupportedFeatures(m4)` must still be `[]` — if it is not, `IMPLEMENTED.sennheiser` is missing one of the two new features from Step 4.

- [ ] **Step 10: Commit and report**

---

### Task 6: Credit SoundcoreManager

The Soundcore spike credits Oppzippy/OpenSCQ30 for the packet framing but nothing for the per-model vendor-UUID knowledge. These projects are read under their own licences (OpenSCQ30 is GPL-3), so this is an obligation rather than a courtesy. Independent of every other task.

**Files:**
- Modify: `docs/spike/soundcore.html:31`
- Modify: `docs/PROTOCOL-UNKNOWNS.md` (Soundcore section)
- Modify: `src/ui/sections/About.tsx:20-24`

- [ ] **Step 1: Credit it in the spike**

In `docs/spike/soundcore.html`, replace the sentence in the intro paragraph:

```html
  The A3951 uses the <em>standard</em> SPP service (<code>00001101-…</code>) rather than a
  vendor-specific one, so it may appear in the picker with no allowlist. Both are offered
  below because Soundcore's vendor UUID varies per model in its last five hex digits
  (per gmallios/SoundcoreManager's per-model definitions), and Web Serial only matches
  exact UUIDs — so a masked match is not possible.
```

- [ ] **Step 2: Credit it in the unknowns doc**

In `docs/PROTOCOL-UNKNOWNS.md`, in the `## Soundcore — reachable but silent on macOS` section, append this bullet to the "What is established" list, after the OpenSCQ30 framing bullet:

```markdown
- **Per-model service UUIDs come from gmallios/SoundcoreManager**, whose device
  definitions record that Soundcore's vendor RFCOMM UUID varies per model in its
  last five hex digits. Web Serial matches exact UUIDs only, so the spike offers
  both the standard SPP service and an unfiltered picker rather than a mask.
```

- [ ] **Step 3: Credit it in the app**

In `src/ui/sections/About.tsx`, replace the protocol-sources paragraph:

```tsx
        <p>
          Sennheiser devices use the Qualcomm GAIA v3 protocol; Sony devices use MDR. Protocol
          knowledge comes from the BudsLink, SmartControl-Desktop, momentumctl and
          sennheiser-desktop-client projects. The Soundcore transport spike drew on
          OpenSCQ30 and SoundcoreManager.
        </p>
```

- [ ] **Step 4: Verify**

Run: `npm test && npm run lint && npm run build`
Expected: all PASS.

- [ ] **Step 5: Commit and report**

---

### Task 7: Probe for the real sound features (manual, needs hardware)

**This task writes no product code.** It produces readings. Nothing may be built from it without a confirmed readback — that is the whole point of the gate.

**Requires:** a MOMENTUM 4, powered on and connected as an audio device, and Chrome.

**Files:**
- Modify: `docs/PROTOCOL-UNKNOWNS.md` (fill in the section added by Task 1)

- [ ] **Step 1: Open the sweep**

Run `npm run dev`, connect, then open **System → Advanced → Debug console**.

- [ ] **Step 2: Settle 0x0803/0x0804 first**

Probe Sennheiser `0x0804` with a zero payload. Read the outcome against this table — the classification is what the hardware error in Task 1 already demonstrated:

| Reply | Meaning |
|---|---|
| response with payload | a **getter** — its current value is visible |
| error, status `0x05` | exists, needs arguments — a **setter** |
| error, status `0x01` | not implemented on this firmware |
| silence | not implemented |

A small integer here (0–5-ish) makes `AudioPrompt_Volume_Get` the near-certain identity. Record the **raw hex line**, not a summary.

While here, capture the frame-level `TX`/`RX` for a `setAudioMode`-shaped write to `0x0803` so the section added in Task 1 can carry a real capture instead of the app's error string. Send it by hand from the debug console rather than reintroducing the deleted command.

- [ ] **Step 3: Sweep the two candidate ranges**

Sweep Sennheiser `0x0800`–`0x081F` (generic audio, feature 4) and `0x1000`–`0x101F` (user EQ, feature 8 — where the app's `sub_mode.dart` / `Gaia3SetSubModeMessage` suggests Podcast mode lives).

`0x1405` and every never-sendable range are refused by the sweep guard from Task 2, so the sweep cannot delete a pairing or start a DFU. Note that a zero-payload probe still *reaches* unknown setters; a setter missing its argument should answer `INVALID_PARAMETER`.

- [ ] **Step 4: Record the readings**

Fill in the section Task 1 added to `docs/PROTOCOL-UNKNOWNS.md` with the raw hex for every ID that answered, using the existing `TX` / `RX` format used elsewhere in that file. Readings that come back **empty are also results** — record them.

- [ ] **Step 5: Stop**

Do not implement Podcast mode, sound personalization or high-resolution audio from these readings in this plan. Each needs a confirmed get/set pair, and high-resolution audio reboots the headphones, so it needs its own design. Write up what was found and hand back.

- [ ] **Step 6: Commit and report**

---

## Verification

Whole-suite check after all tasks:

```bash
npm test && npm run lint && npm run build
```

Manual, on hardware, in one session:

1. Connections lists the paired devices with correct connected states.
2. A disconnected, non-self entry offers **Remove**; pressing it makes the row disappear.
3. Remaining entries keep their original indices — they do **not** renumber.
4. A connected entry offers no Remove, and the summary line explains why.
5. Sound shows the equaliser and bass boost, with no Sound mode card.
6. System shows no Low-latency toggle, and the debug console's frame log shows no `0x0818` poll on connect.
7. Disconnecting our own row ends the session cleanly, with no error banner.

## Known gaps

- `MomentumDevice` builds its own `SerialTransport` in `#connectTo`, so there is no seam to unit-test `removePairedDevice`'s retry behaviour or the self-disconnect flag. Decision logic is covered by `removalBlockedReason`; the orchestration is verified manually. Adding a transport seam is a reasonable follow-up.
- Firmware-version gating of individual settings is not implemented. `m4.json` carries per-setting minimums (`autoAnswerCallsMinFwVersion: 2.13.28`, …); `99.99.99` cases are fully handled by omitting the feature from the profile.
