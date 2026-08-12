# Protocol unknowns

Values this project has **not** verified against hardware. Everything here is
either unmapped or inferred, and is deliberately not guessed in code — unknown
values fall back to a safe default rather than to something invented.

If you own one of these devices, a reading takes about two minutes and closes a
gap for everyone. See [How to contribute a reading](#how-to-contribute-a-reading).

---

## Sony — colourway enum ✅ resolved

Sony reports colour as one byte, via `CONNECT_GET_DEVICE_INFO` value type `0x03`.
Unlike the other value types it carries **no length prefix**: the reply is
`[0x05, 0x03, series, colour]`. Observed on a black WF-C500: `05 03 00 01`.

**Resolved from `com.sony.songpal.util.modelinfo.ModelColor`** in the Sound
Connect app — not inferred:

| Byte | Colour | | Byte | Colour |
|---|---|---|---|---|
| `0x00` | Default | | `0x08` | Green |
| `0x01` | Black | | `0x09` | Gray |
| `0x02` | White | | `0x0A` | Gold |
| `0x03` | Silver | | `0x0B` | Cream |
| `0x04` | Red | | `0x0C` | Orange |
| `0x05` | Blue | | `0x0D` | Brown |
| `0x06` | Pink | | `0x0E` | Violet |
| `0x07` | Yellow | | | |

The enum also defines "-I" variants at **`base + 16`** (Black `0x01` / Black-I
`0x11`) — the same colour rendered inactive. Normalise before looking up.

`0x01` = Black is confirmed against hardware, which matches the enum.

The same byte is broadcast in Sony's BLE advertisement at **offset 5**, so the
app knows the colour before connecting; over RFCOMM we read it after connecting
instead. It is a manufacturing constant per SKU: it identifies the colour the
unit was built as, and cannot know about a case or skin fitted later.

Naming a colour is not the same as having artwork for it — renders exist only
for the four the WF-C500 ships in (black, white, green, orange). Any other
colour resolves to the black render.

## Sony — undocumented device-info value type `0x04`

BudsLink's `ValueType` enum stops at `0x03`. The WF-C500 answers `04 04` with a
length-prefixed 5-byte payload:

```
TX  04 04
RX  05 04 05 10 00 41 42 90
```

Meaning unknown. Value types `0x00`, `0x05`, `0x06` and `0x07` are not
implemented on this device (ACK, then silence).

## Sony — second transparency level on Sennheiser

Not Sony, but the same class of unknown. The MOMENTUM 4 exposes a transparency
level at `0x1802`/`0x1803` (BudsLink's `TRANSP_LEVEL`) that is distinct from
`ANC_Transparency` at `0x1A02`/`0x1A03`, which the noise knob uses. What differs
between them is not established, so only the ANC one is wired up.

## Sennheiser — EQ per-band constants

`reference/m4-app-config.json` carries per-band `max_headroom`
(`[5, 5, 4, 3, 2]`), `loudness_weights` and `q_factor`. These are **not**
per-band gain limits: the official Dance preset puts +3 dB on a band whose
`max_headroom` is 2. Their actual meaning is unknown, so they are not modelled.
The gain range reported by `getEqConfig` is treated as authoritative.

## Sennheiser — GAIA core feature IDs `0x07`, `0x0C`, `0x0D`

`Core_GetSupportedFeatures` (vendor `0x001D`, cmd `0x0001`) returns Qualcomm
GAIA **core** feature IDs, not Sennheiser vendor ones. A MOMENTUM 4 on firmware
3.38.3 (GAIA 3.1) reports:

```
0x00 v4   Core
0x04 v2   Debug
0x06 v2   Upgrade (DFU)
0x07 v1   ❓ unknown
0x0C v1   ❓ unknown
0x0D v1   ❓ unknown
```

This is settled as a *different namespace* from Sennheiser's: the list omits
battery (Sennheiser feature 3) and user EQ (8), both of which demonstrably work
on the same device. So it cannot be used to gate the Sennheiser command table —
doing so would disable working features.

What `0x07`, `0x0C` and `0x0D` are in Qualcomm's core namespace is still open.

## Sony — capabilities reported but not implemented ✅ mostly resolved

The WF-C500 reports 16 functions. Resolved from `WF-C500_FEATURE_SPEC.md` and
the Sound Connect decompile:

| Function | Command | Status |
|---|---|---|
| `0x23` `POWER_OFF` | `[0x24 POWER_SET_STATUS, 0x03 POWER_OFF, 0x01 USER_POWER_OFF]` | ✅ implemented |
| `0xE1` `CONNECTION_MODE…` | `[0xE8 AUDIO_SET_PARAM, 0x00 CONNECTION_MODE, mode]` | ✅ implemented |
| `0xE2` `UPSCALING_AUTO_OFF` | `[0xE8, 0x01 UPSCALING, 0\|1]` | ✅ implemented |
| `0xA1` `PLAYBACK_CONTROLLER…` | fixed playback controls | ✅ nothing to build |

**Touch-control assignment is not available on the WF-C500 — settled.**
`WF-C500_FEATURE_SPEC.md` §6 describes the mechanism in full (the `SYSTEM_*`
opcode family with an `AssignableSettingsKey` per earbud) and concludes it is
"near-certainly active" for this model. It is not. The app only exposes it when
the device negotiates `ASSIGNABLE_SETTING` (`0xF3`) or
`ASSIGNABLE_SETTING_WITH_LIMITATION` (`0xFE`), and a live capability read on
hardware returns all 16 functions with **none of them present** — nor
`QUICK_ACCESS` (`0xFD`). The taps are fixed in firmware.

`PLAYBACK_CONTROLLER` (`0xA1`) is not the gate and never was: it is the
*function* a key can be assigned to, which is why the device reports it while
offering no way to reassign anything. All four ids are now named in the Reported
capabilities card, so a different Sony model will show the difference directly.
This is the second time the spec's static analysis has over-predicted a feature
(see the DSEE payload note above) — treat its §8 caveat seriously and confirm
against a capability read.

Three things worth recording:

- **`POWER_SET_STATUS` is `0x24`**, which BudsLink's table omits — it jumps
  `0x23` to `0x25`. The family follows the usual GET/RET/SET/NTFY grouping at
  `0x22`–`0x25`.
- **`AUDIO_SET_PARAM` (`0xE8`) is a shared dispatcher**, not a feature. Connection
  mode, DSEE and BGM mode all use it, told apart by a second `AudioInquiredType`
  byte. The opcode alone does not identify the feature.
- **Connection mode has two variants.** The basic one (`AudioInquiredType 0x00`)
  is three bytes; the LE-audio one (`0x05`) adds an enable/disable byte. The
  WF-C500 reports the basic capability, so it takes the three-byte form.
- **Power off is fire-and-forget.** There is no readback and no confirmation; the
  link dropping is the only signal.
- **DSEE is three bytes on v2**, `[0xE8, 0x01, value]`. The v1 payload class
  (`se0/a1.java`) writes a setting-type byte between the inquiry type and the
  value, and the feature spec assumes v2 mirrors it — but `cf0/i1.java` rejects
  anything that is not exactly three bytes. Read the generation's own class.

## Sony — EQ preset list and band count are per-device ❓ open

Selecting a preset and editing the curve are two different messages
(`encodeEqPreset` / `encodeEqBands`) — a preset carries a **zero-length** band
list, and a curve carries the preset the device last reported. Sending a preset
together with a curve is well-formed, acknowledged, and ignored.

What is still guessed is *which* presets a given model accepts. We offer the
nine the WF-C500's app shows and decode the full `EqPresetId` namespace, but the
authoritative list comes from `EQEBB_GET_CAPABILITY` (`0x50` → `0x51`), which
also reports the band count and the number of level steps — the latter being
where our hardcoded `EQ_MIDPOINT = 10` really comes from (`(levelSteps - 1) / 2`
in `l20/c.java`). Reading it would make the preset buttons and the fader range
correct on models we have never seen, instead of correct only on this one.

## Sennheiser — 0x0803/0x0804 is Audio/Podcast mode ✅ resolved

**Resolved after this section was written.** ZenControl
(`Oein/sennheiser-desktop-client`, `PROTOCOL.md`) names the pair outright:

> Audio/Podcast mode `0803/0804` (`[00, mode]`, podcast = 2)

The payload is **two bytes with a fixed `00` prefix**, which matches the
hardware reading below exactly (`0x0804` → `00 01`, i.e. mode 1) and explains
the `INVALID_PARAMETER`: this app sent **one** byte where the device wants two.
`podcast = 2` also matches the enum the deleted code carried
(`Off 0, Equalizer 1, Podcast 2, Personalized 3`).

So the feature is **real and the enum was probably right** — what was wrong was
the frame shape and the absence of any evidence for either. The deletion was
still correct: it removed a control that wrote guessed values to a command
nobody had identified. Rebuilding it now would rest on a named source plus a
hardware reading that agrees with it.

**The two-byte arity is confirmed on a MOMENTUM 4; the writes are still
refused.** Two writes were attempted, both rejected, but with *different*
vendor-space statuses:

```
TX  FF 03 00 02 04 95 08 03 00 01     mode 1
RX  FF 03 00 01 04 95 09 83 80        error, status 0x80
TX  FF 03 00 02 04 95 08 03 00 02     mode 2 (podcast)
RX  FF 03 00 01 04 95 09 83 83        error, status 0x83
```

Three things follow. The one-byte payload failed with `0x05`
`INVALID_PARAMETER` while both two-byte payloads got past that, so **two bytes
is the right length**. The statuses are `≥ 0x80`, outside GAIA v3's standard
range, so they are **Sennheiser vendor codes**. And they *differ per mode*, so
the device is parsing the mode byte and refusing each for its own reason rather
than rejecting the frame shape.

The app enumerates these codes as `SetAudioModeErrorCode.fromByte`, but the
member names are not recoverable from a `strings` dump — decoding `0x80` and
`0x83` needs Dart AOT decompilation.

**Leading hypothesis: a mutual-exclusion precondition.** The M4's own app
config sets `AudioModes.config.usageWithSoundProfileSupported: false` and
`SoundPersonalization.config.usageWithHighResolutionSupported: false`, and the
app carries `_conditionallyShowDisableHighResolutionAudioModeGuard` and
`storeAudioModeBeforeSoundPersonalization`. These features are designed to be
mutually exclusive, so a refusal while an EQ curve or Sound Check profile is
active is the expected behaviour, not a protocol error.

**To test that:** in the vendor app, turn off Sound Check / sound
personalization and set the equaliser flat, then retry `00 02`. A different
status — or a success — separates "precondition unmet" from "the M4 does not
accept this command".

**Until then this stays unimplemented.** The arity is known, the enum is
probably right, and the device still refuses every value we can construct.
Shipping a control on that would repeat the original mistake in a more
sophisticated way.

The rest of this section is the investigation that preceded the answer, kept
because the reasoning and the hardware readings remain useful.

### Original entry — "sound mode" as shipped was wrong

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
setter. The two-byte reading below is weak evidence *against* a plain 0–5
volume level, but does not settle it.

**Settled by a hardware sweep — `0x0803`/`0x0804` is a real Set/Get pair, and
the getter returns TWO bytes:**

```
0x0803  rejected     status 0x5      ← setter, missing its argument
0x0804  implemented  00 01           ← getter, two bytes
```

That explains the original failure by measurement rather than inference. We
sent `setAudioMode` a **one-byte** payload to a command that wants two, and
`getAudioMode` decoded with `u8`, so it read only the first byte of `00 01` and
reported "Off". Both halves were wrong in a way that looked plausible.

The pairing is confirmed by the block's own structure — in feature 4 every
known pair runs (odd = Set, even = Get): `0x0801/2` AudioPrompt_Mode, `0x0805/6`
Sidetone, `0x080A/B` AutoCall, `0x080C/D` AutoPause, `0x0814/5` Call
externalization, `0x0817/8` Low latency. Index 3/4 sits in that rhythm.

**What the payload means is still unknown.** Do not build a control on it.

Exact IDs for Podcast mode and sound personalization are **not obtainable from
the APK** — GAIA v3 packs `pdu = (feature << 9) | (type << 7) | index`, so Dart
holds the parts, never the 16-bit literal. Scanning both binaries for every
encoding a constant could take produced zero hits on known-good IDs. Getting
them needs Dart AOT decompilation (blutter/Ghidra).

## Sennheiser — two undocumented features exist: 16 and 20 ✅ confirmed

**`m4.json` does not list every feature this firmware implements.** A MOMENTUM 4
was asked to register notifications for feature IDs 0–31 in turn
(`Config_RegisterNotification`, `0x0007`, one ID per request). Registration is
non-destructive — it only asks for pushes — so this enumerates features without
sending a single command into an unmapped block. Twelve registered:

| Feature | Block | Known as |
|---|---|---|
| 0, 2, 3, 4, 8, 9, 10, 11, 12, 13 | — | the set `m4.json` documents |
| **16** | `0x2000`–`0x21FF` | **undocumented** |
| **20** | `0x2800`–`0x29FF` | **undocumented** |

Every other ID in 0–31 answered `0x0187` with status `0x05`, i.e. the device
rejected the feature ID as an invalid argument.

Feature 16 pushed its state the moment it registered:

```
TX  FF 03 00 01 04 95 00 07 10
RX  FF 03 00 01 04 95 20 81 00      feature 16 · notification · index 1 · 00
```

so `0x2001` is a real reporting command. Feature 20 registered but pushed
nothing.

**Registration triggers a state dump — use it instead of probing.** Every
feature pushed its current values on registering: feature 3 sent battery and
charge, feature 8 sent all five EQ band gains, feature 13 sent the ANC mode
triple. That makes re-registration a *safe differential read*: change a setting
in the vendor app, re-register the feature, and compare. No writes, and no
zero-payload probes into blocks that might contain argument-free actions.

## Sennheiser — IDs identified from live notifications ✅

Captured by watching pushes while audio started and stopped, rather than by
probing:

- **`0x081A` is the sample rate.** `00 00 AC 44` = 44100 while playing,
  `00 00 00 00` when idle. It was one of the undocumented four-byte values in
  the generic-audio sweep.
- **`0x0800` codec** flips `FF` (none) ↔ `01` (AAC) as audio starts and stops,
  confirming the decode already shipped.
- **`0x1082` pushes all five EQ gains at once**, and the vendor app writes a
  curve **one band at a time** — a preset arrives as five successive
  notifications, not one. Observed ramping to `00 14 19 0F EC`
  (`[0, +2.0, +2.5, +1.5, −2.0] dB`) and unwinding back to flat.

## Sennheiser — Speech Clarity ❓ open

The vendor app shows a **Speech Clarity** control for the MOMENTUM 4, and it is
a *slider*, not a toggle (`SpeechClaritySlider`,
`hearingEnhancementScreenSpeechClarity`). It belongs to the app's
`hearing_enhancement` family, whose GAIA commands are `get`/`set` pairs for
`hearing_enh_level`, `agc_level`, `noise_suppression`, `hearing_profile`,
`hearing_profile_on_off`, `latency` and `sound_mode`, plus `get_3d_se_levels`.

**Where it is not.** Four full zero-payload sweeps — generic audio
(`0x0800`–`0x082F`), user EQ (`0x1000`–`0x101F`), MMI/device settings
(`0x1600`–`0x161F`) and system (`0x0400`–`0x041F`) — were taken before and
after enabling it. Every ID was byte-identical apart from `0x080E`, the uptime
counter. Toggling it also produced **no notification at all** on a link
registered for all twelve features.

Silence is not evidence of absence on this device: `m4.json` marks most
settings `notification_ID: 0x0000`, so they never announce a change. Speech
Clarity is most likely **poll-only**, and on one of the two undocumented
features above.

**The bundled app configs are a seed, not the truth — this matters far beyond
Speech Clarity.**

Both app 1.4.2's plaintext configs and app 1.6.0's *decrypted* configs give the
MOMENTUM 4 (`products/0005/0`) an identical feature list, and neither grants it
`HearingEnhancement`. That feature appears only under `products/hdr275/0`. So
the absence is not decryption or staleness in the usual sense.

`root.json` explains why. It is an **Azure App Configuration** manifest:

```json
{"etag": "etag", "key": "root", "last_modified": "2024-10-22T13:31:55",
 "value": {"configs": {"products/0005": ["etag0"], …}}}
```

Product keys mapped to etags, with a snapshot date. **The app fetches current
configs from a server at runtime and ships these only as a fallback.** Any
feature granted to a product after October 2024 exists in no APK at all,
decrypted or otherwise.

That reconciles every observation: the config is correct as of its snapshot,
the vendor app shows Speech Clarity because it fetched a newer one, and the
two undocumented GAIA features (16 and 20, above) appear in no artifact anyone
holds — not `m4.json`, not either APK, not ZenControl's analysis — because they
are simply newer than all of them.

**Treat any bundled vendor config as a dated snapshot.** It is good evidence
about the past and weak evidence about the present. A feature missing from it
is not absent from the device — as the M4's own firmware demonstrates by
answering for features nothing documents.

Note also that fetching the live config would confirm the grant but **not**
yield command IDs: these configs carry feature variants and gates, never GAIA
IDs. Naming the commands still needs AOT decompilation or hardware probing.

**The registration differential was tried, and came back negative.** With
Speech Clarity enabled and again with it disabled, both undocumented features
were re-registered:

```
TX  FF 03 00 01 04 95 00 07 10     register feature 16
RX  FF 03 00 01 04 95 20 81 00     index 1 · 00      ← identical in both states
TX  FF 03 00 01 04 95 00 07 14     register feature 20
RX  (registers, pushes nothing)    ← in both states
```

So feature 16 pushes exactly one value and it does not track Speech Clarity,
and feature 20 has no push-on-register at all. Registration dumps only what a
feature volunteers, so this rules out neither block — it rules out *this
technique* for them.

**What remains, and why it is not being done here.** Naming it now requires
either probing `0x2000`–`0x21FF` and `0x2800`–`0x29FF` blind, or extracting the
IDs from the Dart AOT snapshot with blutter/Ghidra. Blind probing is exactly
what executed `MMI_SetDefaultConfig` and reset a user's touch controls, and
these two blocks are wholly unmapped — there is no `m4.json` entry to audit
them against beforehand. That risk is not worth a feature name. **Do not sweep
`0x20xx` or `0x28xx` without first establishing what they contain.**

Current state: bounded, not solved. Speech Clarity exists, is a slider, is not
in any of the four mapped blocks swept, does not notify, and is most likely in
feature 16 or 20.

## Sennheiser — generic-audio and user-EQ sweeps ✅ captured, partly unmapped

Full zero-payload sweeps on a MOMENTUM 4 (`M4AEBT Black`), 700 ms wait. Status
`0x1` is `COMMAND_NOT_SUPPORTED`, `0x5` is `INVALID_PARAMETER` — the latter
means the command exists and wants arguments, which is how a setter (or a
getter taking an index) is told apart from an unimplemented ID.

**Generic audio (feature 4) — implemented range is `0x0800`–`0x081A`.**
Everything from `0x081B` to `0x082F` answers status `0x1`.

| ID | Reading | Note |
|---|---|---|
| `0x0804` | `00 01` | see above — two bytes, identity unknown |
| `0x080E` | `00 00 18 1C` → `00 00 19 7C` | **a live 1 Hz counter** — see below |
| `0x080F` | *(empty payload)* | answers with no data — may be an **action**, not a getter |
| `0x0813` | `00` | undocumented |
| `0x0816` | `00 59` | undocumented |
| `0x0819` | `05 00 01 02 03 04` | **count-then-values: 5 items, values 0–4** |
| `0x081A` | `00 00 00 00` | undocumented; last implemented ID in the block |

`0x0819` is the most promising unmapped ID in the range: a leading count
followed by exactly that many ascending values is the shape of a "supported
values" query. What it enumerates is not established.

**`0x080E` is a counter, not a setting — established by re-running the sweep.**
Two sweeps of the same range, roughly six to seven minutes apart on the same
session, differed in exactly one byte-string:

```
sweep 1   0x080E   00 00 18 1C   = 6172
sweep 2   0x080E   00 00 19 7C   = 6524   (+352)
```

Every other ID in the range, including `0x0819`'s list and `0x081A`, was
byte-identical. A rise of 352 over ~6–7 minutes of wall clock is **≈1 unit per
second**, so this is a u32 ticking at 1 Hz — consistent with an uptime or
cumulative-usage timer (6524 ≈ 1 h 49 m). The epoch is unverified: whether it
counts from power-on, from first pairing, or lifetime is not established, and
one more reading after a power cycle would settle it.

The general lesson is worth keeping: **a single sweep cannot tell a setting
from a clock.** Re-running the same range and diffing is cheap and separates
live values from static ones.

**Low latency is confirmed absent on this model, from the device itself.**
`0x0818` `LowLatencyMode_Get` answers `00`, but `0x0817` `LowLatencyMode_Set`
is **silent** — no response at all, where every other setter in the block
answers `INVALID_PARAMETER` to a zero payload. So the M4 will *report* a
low-latency setting and refuse to accept one, independently confirming
`m4.json`'s `"LowLatencyMode_MinFwVersion": "99.99.99"` sentinel and the
decision to gate the toggle out by profile.

**User EQ (feature 8) — implemented range is `0x1000`–`0x1014`.** Everything
from `0x1015` to `0x101F` answers status `0x1`.

| ID | Reading | Note |
|---|---|---|
| `0x1000` | `05 C4 3C 00 00` | `getEqConfig`: 5 bands, −6.0 to +6.0 dB (`0xC4` = −60, `0x3C` = +60 tenths). **Two trailing bytes we do not decode.** |
| `0x1009` | `00` | `getBassBoost`, off |
| `0x100F` | *(empty payload)* | answers with no data — may be an **action**, not a getter |
| `0x1013` | `00 00` | undocumented |
| `0x1014` | `00 00` | undocumented; last implemented ID in the block |

`0x1001` (`setEqBand`) and `0x1002` (`getEqBand`) both answer `0x5` to a zero
payload, as expected — one is a setter, the other a getter that takes a band
index.

`0x1013` and `0x1014` are the two undocumented zero-argument getters in this
feature. They were the obvious candidates for the app's `user_eq/sub_mode.dart`
(`Gaia3SetSubModeMessage`, `UserEQSubMode`) — the presumed home of Podcast
mode. **That guess is now dead twice over.**

ZenControl's `PROTOCOL.md` states that `0x100A`–`0x1013` is a **parametric EQ
path**, "not used in the ACCENTUM implementation". That accounts for the whole
run of `0x5` rejections from `0x100A` to `0x1012` and for `0x1013` answering —
these are parametric-EQ commands, not a sub-mode. And Podcast mode is at
`0x0803`/`0x0804` regardless (see above).

A differential reading independently ruled them out:

**Speech Clarity is not in this feature block — measured, not assumed.** The
whole range was swept, the Speech Clarity option was then enabled from the
vendor app, and the range was swept again. The two sweeps are **byte-identical
across all 32 IDs**, `0x1013` and `0x1014` included (`00 00` both times).

Whatever backs Speech Clarity lives outside `0x1000`–`0x1014`. If Speech
Clarity is what current firmware calls Podcast Mode, this also kills the
sub-mode hypothesis for these two IDs rather than merely leaving it
unconfirmed. Search the generic-audio block (feature 4) next: several IDs there
read `00` and would flip for a boolean toggle — `0x0813`, and less likely
`0x0815`/`0x0818`, which are already claimed by call externalization and low
latency.

A negative result of this shape is worth as much as a positive one: it removes
32 IDs from the search space for one toggle at the cost of a single sweep.

**Note on parity:** the (odd = Set, even = Get) rhythm that holds in feature 4
does **not** hold here — bass boost is Set `0x1008`, Get `0x1009`. Do not infer
pairs from parity across features.

**To identify `0x1013`/`0x1014`:** change Podcast mode in the official Smart
Control phone app and re-read both. Whichever value moves is the sub-mode. A
differential reading like that is the only way to name these without
decompiling the Dart AOT snapshot.

**Caveat on this sweep.** Zero-payload probes reach real setters. `0x080F` and
`0x100F` each answered with an empty payload rather than data, which is what an
executed action looks like as much as an empty getter. Nothing observable
changed on the headphones, but neither ID should be assumed read-only.

## Soundcore — reachable but silent on macOS ❓ open, possibly blocked

The Soundcore Liberty Air 2 Pro (model **A3951**) is *not* supported by this
app, and a spike suggests it may not be reachable at all from a browser on
macOS. Recorded so the next person does not repeat it.

What is established:

- **Chrome enumerates it and opens it.** `spike/soundcore.html` granted two
  RFCOMM services on the device, both reporting `connected=true`, and both
  opened without error: standard SPP `00001101-0000-1000-8000-00805f9b34fb`
  and `66666666-6666-6666-6666-666666666666`. With only that device connected,
  both ports must belong to it.
- **Our packet is right.** Soundcore framing is
  `08 EE 00 00 00 | command(2) | length u16 LE | body | checksum`, checksum
  being a wrapping byte sum. Our request-state encodes to
  `08 EE 00 00 00 01 01 0A 00 02`, byte-identical to Oppzippy/OpenSCQ30's own
  test vector (GPL-3, read as reference).
- **Per-model service UUIDs come from gmallios/SoundcoreManager**, whose device
  definitions record that Soundcore's vendor RFCOMM UUID varies per model in its
  last five hex digits. Web Serial matches exact UUIDs only, so the spike offers
  both the standard SPP service and an unfiltered picker rather than a mask.
- **That is genuinely the first thing to send.** OpenSCQ30's A3951 definition
  opens with `RequestState` — no handshake, no auth, no capability exchange.
- **Both services answered nothing**, to that command, on either channel, with
  no unsolicited traffic on connect either.
- **The channel is dead inbound too.** With a port open and the read loop
  running, operating the earbuds' own touch controls produced no bytes at all.
  This is the decisive test: it rules out "we sent the wrong command", because
  a live channel would carry the device's own state changes regardless of what
  we asked for.

So the channel opens and then carries nothing in either direction. The
explanation is the platform rather than the protocol: **OpenSCQ30 lists
Windows, Linux and Android as supported — not macOS** — and ships no macOS
connection backend. No known implementation has demonstrated this protocol over
macOS RFCOMM, and how CoreBluetooth assigns an RFCOMM channel to a device
already streaming A2DP/HFP is untested ground.

**Treated as blocked below the browser.** More protocol work will not get past
it; what would is evidence that any macOS program can talk to an A3951 over
RFCOMM at all. Until that exists, this is not worth further time.

## Sony — which slot is the left earbud ❓ open

`POWER_RET_STATUS` for the dual-battery type is read as
`[0x23, 0x01, leftLevel, leftStatus, rightLevel, rightStatus]`. That matches the
one capture we have — `23 01 00 02 64 00`, taken with the **left** bud in the
case and the right worn, giving slot 1 as absent.

A later session showed the opposite: the left bud away and the UI naming the
right one. Two explanations fit and the capture cannot separate them:

1. The slots are simply left/right and something else is wrong.
2. **The slots are primary/secondary, not left/right.** TWS earbuds elect one
   bud as primary, and which one it is changes between sessions. If Sony
   reports the primary first, slot 1 would have been the left bud in the first
   capture only by coincidence.

If (2) holds, no fixed mapping can be right and the labels have to come from
somewhere else — the app would have to stop claiming a side it cannot know.

**To settle it:** connect with a known arrangement (say the left bud in the
case, right in your hand), capture the raw `0x23 0x01` frame from
`spike/sony.html`, then swap the buds and capture again. If the absent slot
follows the physical side, it is left/right; if it stays in the same slot, it
is primary/secondary.

Until then the Device card reports each slot's own reading rather than a
sentence naming a side, so a mismatch is visible instead of silently wrong.

## Sony — wearing detection

`WEARING_STATUS_DETECTOR` (`0xF6`) and
`PLAYBACK_CONTROL_BY_WEARING_REMOVING_HEADPHONE_ON_OFF` (`0xF1`) exist in the
protocol, but the **WF-C500 reports neither** — it has no wear sensors, which is
also why it has no auto-pause. On a model that does report them, the decoding is
unknown. Contrast Sennheiser, where `PhysicalDevice_State` (`0x0402`) gives
in-case / off-head / on-head and is wired up.

**In-case is detectable anyway, but not by charge status.** An earbud in the
case leaves the tandem link, so the device reports `UNKNOWN` (`0x02`) with level
`0` rather than a charge state. Captured with the left bud in the case and the
right worn:

```
TX  22 01
RX  23 01 00 02 64 00
          │  │  │  └─ right status 0x00 NOT_CHARGING
          │  │  └──── right level  100%
          │  └─────── left  status 0x02 UNKNOWN
          └────────── left  level  0  (meaningless — it is not reporting)
```

The obvious guess — that a bud in the case reports `CHARGING`/`CHARGED` — is
wrong, and acting on it makes an in-case bud indistinguishable from a worn one.
A level of `0` with `UNKNOWN` means "not reporting", not "flat"; a genuinely
empty earbud reports `0` with `NOT_CHARGING`.

---

## How to contribute a reading

You need the device, Chrome (or any Chromium browser), and about two minutes.

1. Power on the headphones and make sure the OS has them connected as an audio
   device.
2. Run the project (`npm run dev`) and open the debug console:
   **System → Advanced → Debug console**.
   For Sony devices, the standalone spike at `spike/sony.html` is easier —
   serve the `spike/` folder over `localhost` and open `sony.html`.
3. Connect, then send the query for the gap you are filling:

   | Gap | Send | Look for |
   |---|---|---|
   | Sony colourway | `04 03` | `05 03 <series> <colour>` |
   | Sony value type `0x04` | `04 04` | `05 04 <len> <bytes>` |
   | Sennheiser transparency | `18 03` | any `19 03` reply |

4. Open an issue with: the **model**, the **firmware version**, the **physical
   colour** of the unit, and the **raw hex line** — not a summary of it. The raw
   bytes matter: an earlier reading here was mis-transcribed as `05 03 01 01`
   when the device actually sent `05 03 00 01`, which changed how the reply
   parses.

Readings that come back **empty** are useful too. On Sony, an unsupported query
is acknowledged at the transport layer and then ignored — silence means "this
device does not implement it", not "it failed".
