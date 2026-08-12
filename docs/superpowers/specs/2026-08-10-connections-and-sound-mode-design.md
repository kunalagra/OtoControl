# Paired-device removal, and retiring the invented sound mode

**Date:** 2026-08-10
**Status:** approved, ready for planning

Two pieces of Momentum 4 work that turned out to share a root cause: a control
built on a guessed command ID, and a command deliberately blocked so a control
could never be built at all.

---

## 1. Background

### 1.1 What the evidence says

Two decompilation passes over Sennheiser Smart Control Plus (1.4.2 armeabi-v7a,
which is un-obfuscated and retains `package:chili/...` Dart source paths, plus
its plaintext per-product configs) settled both questions. Both passes had to
correct their own premise first: the app is **Flutter**, so there is no smali,
and no JSON in it carries `GAIA_command_ID`. Command IDs live as
`featureId`/`index` pairs in Dart AOT code, never as 16-bit literals — verified
by scanning both binaries for every encoding a constant could take and getting
zero hits on known-good IDs from `docs/reference/m4.json`.

Exact numeric IDs for the unbuilt sound features are therefore **not obtainable
from these APKs** without decompiling the Dart AOT snapshot. Everything below
distinguishes what was read from what is inferred.

### 1.2 Sound mode does not exist on the M4

`AUDIO_MODE_OPTIONS` in `src/gaia/commands.ts` offers
`Off / Equalizer / Podcast / Personalized` via Sennheiser `0x0803`/`0x0804`.
Every part of that is wrong:

- **The concept.** The app models five *independent* features —
  `Equalizer`, `PodcastMode`, `SoundPersonalization`, `SoundZones`,
  `AudioModes` — each with its own `feature_variant_configs` entry and its own
  `product_features/` tree. There is no mutually-exclusive selector.
- **`AudioModes` means codec/resolution, not sound profile.** The M4's shipped
  config gives it `support: ["aptX96kHz"]` and
  `productSupportedResolutions: ["highResolution"]`. The UI key
  `audioModesPage_applyAndRestartButton` shows changing it **reboots the
  device**.
- **`SoundZones` never touches GAIA.** It is phone-side geofencing that
  re-applies Equalizer and NoiseControl configs on zone entry.
- **The IDs are unsourced.** `docs/reference/m4.json` runs `0x0801`/`0x0802`
  AudioPrompt_Mode, then jumps to `0x0805`/`0x0806` Sidetone.
  `src/gaia/knownCommands.ts` has the identical hole. Nothing sourced
  `0x0803`/`0x0804`; `src/gaia/commands.test.ts` only asserts the literals back
  at themselves.

On hardware, `setAudioMode` fails with error frame `0x0983`, status `0x05`.
That decodes as feature 4, PDU type 3 (error), index 3 — i.e. our own `0x0803`
— and `0x05` is GAIA v3 `INVALID_PARAMETER`, not `0x01`
`COMMAND_NOT_SUPPORTED`. **The command exists; the argument was rejected.**

*Inference, not read:* the app ships `generic_audio/audio_prompts_volume.dart`
and `set_audio_prompts_volume.dart` with no ID otherwise accounted for, and
indices 3/4 sit between AudioPrompt_Mode (1/2) and Sidetone (5/6). The leading
hypothesis is **AudioPrompt_Volume_Set/Get**, which would explain
`INVALID_PARAMETER` exactly: a mode enum sent to a volume setter.

This is the sharper problem. The control does not merely fail — it writes
guessed values to a live command whose identity we do not know.

### 1.3 Removal was blocked, not missing

`src/gaia/unsafe.ts:26` blocks `0x1405`–`0x1406`, and `GaiaClient` enforces it
on all three send paths: typed `request` (`client.ts:154`), `sendRaw`
(`client.ts:202`) and `probe`. So removal is impossible today even by hand in
the debug console.

Disconnect (`0x1403`) was never blocked and is already wired up
(`src/ui/sections/Devices.tsx:60`). **Removal is the only genuinely missing
capability.**

What the real app does, read from `libapp.so` strings and l10n keys:

- **Per-entry `0x1405 DeleteEntry` only.** `delete_entry.dart` exists; there is
  no `delete_pdl.dart` or any `pdl|delete_all|clear|forget|unpair` path under
  `package:chili/protocol/`. There is **no "forget all"** action anywhere.
- **No confirmation dialog.** Its sibling features have them
  (`delete_preset_dialog.dart`, `delete_sound_zone_dialog.dart`,
  `forget_product_confirmation_dialog.dart`); connection management
  deliberately has none. The flow is an edit mode
  (`connectionManagementPage_deleteDeviceIconButton` →
  `_deleteDoneButton`) and the only modal is the **failure** sheet.
- **The guard is a precondition.** `unable_to_delete_sheet.dart`, with the
  strings `Cannot delete the connected device.` and `Disconnect the device
  before removing it from the app`.
- **Indices do not compact.** `Encountered gap in paired devices list at index`
  and `Could not fetch all paired devices, hit max index` prove holes are
  expected and that `0x1400` is an upper bound, not a live count. The app keeps
  `Paired devices list size = ` and `Paired devices count = ` as separate log
  lines.
- **A named firmware bug.** `Device list is not available after device removal
  because of FW bug`, with its own `ConnectionManagementFwBugFailureEvent`
  analytics event. A failed re-read straight after a delete is expected.
- **The own-device row is labelled**
  `connectionManagementDevicesPage_thisDevice` → "This device".

### 1.4 Two adjacent falsehoods

Both confirmed from `docs/reference/m4.json`'s `parameters` block:

- `"LowLatencyMode_MinFwVersion": "99.99.99"` — the never-enable sentinel. The
  M4 has **no low-latency mode**, yet we ship the toggle
  (`src/device/state.ts:283`) and claim the feature (`profiles.ts:135`).
- `"pairedDevicesDisconnectOwnDevice": true` — the device **permits**
  disconnecting our own entry, which we currently withhold outright.

---

## 2. Goals

1. Stop sending guessed values to `0x0495:0x0803`.
2. Establish, from hardware, what the M4's real sound features are — without
   guessing again.
3. Let the user remove a paired device, matching the real product's safety
   model.
4. Show and poll only the controls a device actually has, via a mechanism that
   generalises to every model the project adds — not a one-off correction.
5. Credit every reverse-engineering project we read.

**Non-goal:** implementing Podcast mode or high-resolution audio. Those are
gated on confirmed readbacks and get their own spec.

---

## 3. Design

### 3.1 Delete the invented sound mode

Remove from `src/gaia/commands.ts`: `AudioMode`, `AudioModeId`,
`AUDIO_MODE_OPTIONS`, `getAudioMode`, `setAudioMode`.

Remove from `src/device/state.ts`: the `audioMode` field on `DeviceState`,
`initialState` and `DurableState`; its lines in `captureDurable` and
`applyDurable`; and its `REDUCERS` entry.

Remove from `src/device/device.ts`: the `setAudioMode` method and the
`getAudioMode` read in `#refreshAll`.

Remove from `src/ui/sections/Sound.tsx`: the entire Sound mode card, the
`eqInactive` computation, and the "These bands only apply while the sound mode
is Equalizer" note — that caveat was a consequence of the invented model, and
on the M4 the equaliser is a standalone feature.

Remove from `src/gaia/commands.test.ts`: the `sound mode (audio mode)` block
and the now-unused imports.

**`SNAPSHOT_VERSION` stays at 1.** `applyDurable` reads an explicit field list,
so an old snapshot carrying `audioMode` is ignored harmlessly. Bumping would
wipe every user's remembered settings to evict a field that costs nothing to
leave in the cache.

**`knownCommands.ts` keeps its hole.** We do not name a command we have not
confirmed.

### 3.2 Record what we learned

Add a `PROTOCOL-UNKNOWNS.md` section covering: the five independent features
and what `AudioModes`/`SoundZones` actually are; the `0x0983`/`0x05` hardware
reading and how it decodes; the AudioPrompt-volume hypothesis marked as
inference; and that exact IDs need Dart AOT decompilation (blutter/Ghidra),
which no installed tooling can do today.

Also correct `src/gaia/unsafe.test.ts:30`, whose comment asserts Sennheiser
`0x0804` "is a normal audio setting". That is the belief this spec retires.

### 3.3 Probe for the real features

`GaiaClient.probe` already sends a zero-payload request and classifies the
reply without throwing. The hardware error proves this discriminates:

| Reply | Meaning |
|---|---|
| response with payload | a **getter** — and its current value is visible |
| error, status `0x05` | exists, needs arguments — a **setter** |
| error, status `0x01` | not implemented on this firmware |
| silence | not implemented |

Sweep Sennheiser `0x0800`–`0x081F` (generic audio, feature 4) and
`0x1000`–`0x101F` (user EQ, feature 8 — where the app's `sub_mode.dart` /
`Gaia3SetSubModeMessage` suggests Podcast mode lives). **`0x0804` is the first
test:** if it returns a small integer, the AudioPrompt-volume hypothesis is
effectively confirmed.

Findings are recorded in `PROTOCOL-UNKNOWNS.md` in the raw-hex format that file
already requires. **No control is built for an ID without a confirmed
readback.** High-resolution audio additionally reboots the headphones and needs
its own treatment when reached.

*Residual risk, accepted:* a zero-payload probe reaches real setters. A setter
missing its argument should answer `INVALID_PARAMETER`, and §3.4 keeps the
destructive IDs out of every sweep.

### 3.4 Two-tier command safety

One list currently blocks all three send paths, which is exactly why a typed
delete is impossible. Split it in `src/gaia/unsafe.ts`:

- **`BLOCKED` — never sendable by any path.** Sennheiser firmware upgrade
  (`0x0200`–`0x02FF`), factory reset (`0x0040`), Qualcomm upgrade transport
  (`0x0C00`–`0x0CFF`), Qualcomm panic-log erase (`0x0804`), and **`0x1406`
  DeletePDL**. The real app has no "forget all" and no shipping client
  exercises `0x1406`; wiping the list is unrecoverable from here.
- **`SWEEP_BLOCKED` — typed commands only, never sweep or raw frame.**
  **`0x1405` DeleteEntry.** This is not theoretical: a zero-payload probe
  across `0x14xx` could be read by firmware as "delete index 0".

`isBlocked` keeps guarding `#send`. `probe()` and `sendRaw()` use the union.

### 3.5 Removing a paired device

**Command.** `deletePairedDevice = setter<number>('deletePairedDevice', 0x1405,
(index) => [index])`. Feature `0x1405 >>> 9 = 10` (DeviceManagement) is already
in `SUBSCRIBED_FEATURES`, so the coverage assertion in `commands.test.ts`
passes unchanged.

**Device method.** `removePairedDevice(index)`:

1. Refuse if the entry is currently connected, surfacing *"Disconnect the
   device before removing it."* — never send in that state.
2. Send `deletePairedDevice`.
3. Re-read the list via `refreshConnections()`.
4. **Tolerate the known firmware bug.** On a failed re-read, retry once after a
   short delay; if it still fails, keep the last known list rather than
   surfacing an error. A removal that succeeded must not look like a failure.

**Enumeration.** Already tolerates per-index failures
(`device.ts:329`), which the evidence says is correct. Make it deliberate:
document that `0x1400` is an upper bound rather than a count and that holes are
expected, so nobody later "fixes" the loop into assuming contiguity.

**UI (`Devices.tsx`).** Rows that are neither connected nor our own entry gain
a Remove action. Connected rows show no Remove and carry the hint *"Disconnect
the device before removing it."* No confirmation dialog — the precondition is
the guard, matching the real product.

### 3.6 Gate toggles by profile

The M4's phantom low-latency toggle is one instance of a general gap: `TOGGLES`
renders and polls unconditionally, so every Sennheiser device gets every
toggle whether or not the hardware has it. With the project aimed at being a
one-stop shop across many devices, the fix is the mechanism, not the instance.
**Gate, do not delete.** `getLowLatency`/`setLowLatency` stay in `commands.ts`
— the IDs are real, and a Sennheiser model that *does* have low latency should
get the control for free.

**Declare the feature on each toggle.** `ToggleSpec` gains
`feature: FeatureId`, mapping:

| Toggle | Feature |
|---|---|
| `bassBoost` | `BassBoost` |
| `smartPause` | `SmartPause` |
| `onHeadDetection` | `WearDetection` |
| `autoAnswer` | `AutoAnswer` |
| `comfortCall` | `ComfortCall` *(new)* |
| `lowLatency` | `LowLatency` |
| `bluetoothCompatibility` | `BluetoothCompatibility` *(new)* |
| `touchControls` | `TouchControls` |

Two new `Feature` members and their `FEATURE_NAMES` entries: `ComfortCall`
("Comfort call") and `BluetoothCompatibility` ("Bluetooth compatibility mode").
Both are real M4 capabilities (`Setting_ComfortCall`,
`bluetoothCompatibilityModeMinFwVersion: 2.12.0`) that the vocabulary simply
never named.

**Correct the M4 profile.** Drop `F.LowLatency`; add `F.ComfortCall` and
`F.BluetoothCompatibility`. `IMPLEMENTED.sennheiser` keeps `F.LowLatency` — it
describes what the app can *drive*, which is still true, and `unsupportedFeatures`
subtracts from `profile.features`, so the M4 correctly stops listing it as
either present or missing.

**Filter, in both directions.** A helper resolves the visible toggles from the
reported model:

- **Unknown model → show everything.** Matches the existing precedent in
  `sectionsForDevice` ("keep the tab rather than hiding a section that is about
  to appear") — an unmatched model means no knowledge, not absence.
- **Known profile → show only its declared features.** Hide, do not disable.
  This is the codebase's settled position: a tab onto "this device reports no
  noise control" is worse than no tab (`registry.ts:60`), and a greyed-out
  control is a guess presented as a fact (`manager.ts:162`).

The same filter gates **polling** in `#refreshAll`. `getModelId` is read before
the toggle loop, so the profile is known by then; a device that lacks a feature
should not be asked about it every connect. This is the honesty win as much as
the efficiency one — today the M4 is polled for a low-latency setting it does
not have.

**Firmware-level gating is out of scope.** `m4.json` carries per-setting
minimum versions (`autoAnswerCallsMinFwVersion: 2.13.28`,
`bluetoothCompatibilityModeMinFwVersion: 2.12.0`, …) and doing that properly
needs version comparison and a policy for unreadable versions. It is a
refinement of this same mechanism, not a prerequisite: `99.99.99` means *never*,
which is a static product fact and fully expressible by omitting the feature
from the profile.

As with `audioMode`, `SNAPSHOT_VERSION` stays at 1. A cached `lowLatency` value
survives into `state.toggles` as a field nothing renders, since the UI now
draws from the filtered list.

### 3.7 Self-row disconnect

The device reports `pairedDevicesDisconnectOwnDevice: true`, so offer
Disconnect on our own row rather than withholding it.

It drops the control link this page runs on, so it must read as an intentional
end of session, not a fault: set an intentional-disconnect flag before sending,
and have `#handleDrop` report a clean disconnection with no error when it is
set. The action is labelled so the consequence is obvious before it is taken.

Remove is never offered on our own row, whatever its reported connection
state. Removing the entry we are talking through is not a coherent action, and
§3.5's precondition already excludes it in the normal case.

### 3.8 Credit SoundcoreManager

`docs/spike/soundcore.html` credits Oppzippy/OpenSCQ30 for the packet framing
(line 73) but nothing for the per-model knowledge in line 31 — that Soundcore's
vendor RFCOMM UUID varies per model in its last five hex digits. That is
gmallios/SoundcoreManager territory and is currently uncredited.

Add it to the spike header, to the Soundcore section of
`PROTOCOL-UNKNOWNS.md`, and to `About.tsx`, which today names only the
Sennheiser and Sony sources and does not mention the Soundcore work at all.

Independent of §§3.1–3.7 and safe to land in any order. Reference projects are
read under their own licences (OpenSCQ30 is GPL-3), so crediting them is an
obligation rather than a courtesy.

---

## 4. Testing

Unit, alongside the existing suites:

- `deletePairedDevice` encodes index → `[index]` at `0x1405`.
- `unsafe`: `0x1405` passes `isBlocked` but fails the sweep guard; `0x1406`
  fails both; `0x1400`–`0x1404` and `0x1407`–`0x1409` pass both.
- `removePairedDevice` refuses a connected entry and sends nothing.
- A failed re-read after a successful delete preserves the previous list and
  raises no error.
- `applyDurable` ignores a legacy snapshot containing `audioMode`.
- `profiles`: the `momentum-4` profile no longer claims `low-latency`, and does
  claim `comfort-call` and `bluetooth-compatibility`.
- Toggle filtering: an M4 model string yields the seven M4 toggles and omits
  `lowLatency`; an unrecognised model yields all eight; every `ToggleSpec`
  declares a `feature` present in `FEATURE_NAMES`.
- `#refreshAll` does not poll `getLowLatency` when the model is an M4, and does
  poll it when the model is unrecognised.

Manual, on hardware, in one session: remove a disconnected entry and confirm
the row disappears and indices do not shift; run the `0x08xx` and `0x10xx`
sweeps and record the raw frames.

---

## 5. Risks

| Risk | Handling |
|---|---|
| Unblocking `0x1405` makes a real deletion reachable | Typed command only; sweep and raw paths still refuse it; UI cannot target a connected entry |
| Re-read after delete fails (known FW bug) | Retry once, then keep the last known list; never surface as an error |
| Zero-payload probe reaches a real setter | Setters should answer `INVALID_PARAMETER`; destructive IDs excluded from sweeps by §3.4 |
| Sweep finds nothing conclusive | Acceptable. Findings are recorded and the features stay unbuilt — that is the point of gating on readbacks |
| Self-disconnect ends the session confusingly | Labelled with its consequence; drop handled as a clean disconnect |

---

## 6. Out of scope

Podcast mode, sound personalization, high-resolution audio (needs confirmed
IDs, and reboots the device); sound zones (no GAIA involvement); the multipoint
switch (firmware ≥ 3.29.0 on M4AEBT, and no read command established);
firmware-version gating of individual settings (§3.6 — a refinement of the same
mechanism, not a prerequisite); `0x1406` DeletePDL, permanently.
