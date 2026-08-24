# Provider gaps

What this app could drive but does not yet, per provider, with the reference
each item is checked against. Distinct from `PROTOCOL-UNKNOWNS.md`, which is
about values we have not verified; this is about features we have not written.

Cross-checked, in descending order of authority and all read as reference
with nothing copied (the standing rule `core/profiles.ts` already states):

1. **The vendors' own apps**, decompiled — Sony Sound Connect and Nothing X.
   Authoritative where they reach. Nothing X is a Flutter app, so its model
   and capability tables are the JSON in `flutter_assets/assets/config/`
   rather than code.
2. **BudsLink** (`maniacx/BudsLink`, GPL) — the strongest third-party Sony
   reference, and it covers Nothing and Sennheiser too.
3. **Gadgetbridge** (`Freeyourgadget/Gadgetbridge`, AGPL) — good for Sony enum
   values and payload lengths. Its V2 protocol class inherits from V1 and
   carries known leftovers, so it corroborates rather than decides.
4. **SoundcoreManager** (`gmallios/SoundcoreManager`, Rust) — the only wire
   reference for Soundcore, which BudsLink does not cover.

Where 2 and 3 disagree, 1 settles it — or, where the vendor app is silent, the
two third-party references are weighed against each other. Two such conflicts
have been settled, and both are recorded on the code that depends on them
rather than here: the voice-guidance on/off selector, where Gadgetbridge's V2
is wrong (`mdr/voiceGuidance.ts`), and the multipoint device-list layout, where
BudsLink implements only one of Sony's two strides (`mdr/pairing.ts`).

## Sony

Model coverage is complete (the generated catalog covers every model Sony
lists). The gaps are features:

| Feature | Models | Status |
|---|---|---|
| Speak-to-chat (enable, sensitivity, timeout) | 7 flagships | ✅ done |
| Per-side touch assignment (`buttonModesLeftRight`) | most | ✅ done |
| Voice notifications + volume | 18 | ✅ done |
| Multipoint device list, routing + routing lock | 8 | ✅ done |
| Wind-noise reduction mode | 5 | ❌ open |
| ANC optimizer | XM6 class | ❌ open |
| 10-band EQ | 2 newest | ❌ open |
| Volume sync, listening mode, surround | few | ❌ open |
| Focus-on-voice | few | ❌ open — see below |
| Assignable presets beyond noise/volume/playback | most | ❌ open — see below |
| Assignable-settings capability read (per-key preset list) | most | ❌ open |

Two corrections to this ledger's earlier reading, both from the Sound Connect
decompile:

- **Focus-on-voice is not part of speak-to-chat** on protocol V2. Gadgetbridge
  models it on `SpeakToChatConfig`, but only its V1 path carries it there; its
  V2 hardcodes `false`, and BudsLink puts focus-on-voice in the
  *ambient-sound-control* payload. So it belongs with the ASC work, not with
  speak-to-chat, and it is listed separately above.
- **Touch assignment has far more presets than we offer.** Sony's V2 `Preset`
  enum runs to ~28 values — `TRACK_CONTROL 0x21`, `QUICK_ACCESS 0x36`,
  `CHAT_MIX 0x70`, per-assistant entries, and more. We offer four. The
  per-model list *is* obtainable: the device's capability table set 1 carries a
  `[key, keyType, preset, ...actions]` record per assignable key (`te0/b.java`,
  `DeviceCapabilityTableset1Builder`). Reading it would both widen the preset
  list and settle the `0x00`-vs-`0x35` question, which is why it is now its own
  row above.

## Nothing / CMF

We cover **22** models to BudsLink's 17 (the 2025–26 lineup came from the
official app's `ear_white_list.json`, which lists 23). Feature gaps:

| Feature | Models | Status |
|---|---|---|
| Spatial audio + head-tracking toggle | 5 | ✅ done |
| Ear-tip fit test | 7 | ✅ done — already was when this ledger was written |
| Personalized ANC level | 3 | ✅ done — likewise |
| Find-my ringing | 16 | ✅ done — likewise |
| Advanced EQ per-band values (`0xc04d`/`0xf050`) | 4 | ❌ open |
| Model coverage: B201, plus B182 and B220 | 3 | ❌ open |
| Capability query instead of timeout probing | all | ⛔ not useful — see below |

Three of these rows were wrong when first written: `NothingSystem.tsx` and
`NothingNoise.tsx` already drove the fit test, the ringer and personalized ANC.
Spatial audio is now done too, head tracking included — the payload is the
app's `BasicBoolean`, whose reply *width* is what says whether a model tracks
the head.

`GET_SUPPORTED_FEATURE 0xc00d` turned out not to be the probe replacement it
looked like: its bitmask covers pairing, assistants, codecs and wear detection,
overlapping only two of our dozen probes. The one genuine remaining gap is the
advanced EQ's per-band values.

On the model-coverage row: `ear_white_list.json` lists a **B201** we do not
carry — it shares B173's `privateCode` and has no SKU-catalogue entry to name
it — and the app's per-model classes reveal two more the white list itself
omits, **B182** (beside B184 in `gligar`) and **B220** (in `espeon`). None can
be named without a catalogue entry, so none is guessed at.

Two protocol facts worth carrying forward. Both are recorded on the code that
depends on them, not here:

- **Nothing is Web Serial only.** The control channel is RFCOMM SPP; the GATT
  service in the app is firmware update alone, so the old BLE GATT branch could
  never have connected. See `core/gattTransport.ts`.
- **The model is readable over the wire** (`GET_DEVICE_MODEL 0xc01c`) — the
  only way to identify a Nothing device on a carrier that exposes no Bluetooth
  name, and the reply is little-endian bytes hex-encoded, not text. See
  `decodeDeviceModel` in `drivers/nothing/commands.ts`.
- **Per-model feature flags come from the app's `IOTProductDevice` subclasses**,
  not `ear_white_list.json`, whose `ultraBass` and `diracOpteoSupport` fields
  mean something else. The swept table is in `drivers/nothing/models.ts`.

## Soundcore

Implemented, over BLE GATT — these earbuds expose no serial service at all, so
they are the one brand here that Web Serial cannot reach. (An earlier RFCOMM
spike on macOS opened a channel that then carried nothing in either direction;
the finding, and why not to retry it, is recorded on `soundcore/driver.ts`.)

BudsLink does not cover Soundcore. The wire protocol reference is
SoundcoreManager. What the official app's remote layer holds is **not**
recoverable statically: the APK is Ijiami-packed and the product-catalog /
firmware endpoints live behind `libscsecurity.so` signing — device images,
however, were fully extractable and are bundled. Gaps:

| Feature | Status |
|---|---|
| Custom 8-band EQ | ❌ open |
| HearID | ❌ open |
| Fine-grained battery (BLE advertisement only) | ❌ open — see `PROTOCOL-UNKNOWNS.md` |

## Apple — decided: out of scope

Full control (ANC switching, exact battery, ear detection) is Apple's AAP
protocol over an L2CAP socket (PSM 0x1001) — no browser exposes L2CAP, so no
web app can reach it. Read-only via BLE advertisements is possible in
principle but coarse (10% battery steps) and `watchAdvertisements()` remains
flag-gated on desktop Chrome and absent in Firefox/Safari. Decision: skip.

Use a native tool for Apple devices:

- [librepods](https://github.com/librepods-org/librepods) — Android/Linux,
  the open AAP implementation everything else references.
- [CAPod](https://github.com/d4rken-org/capod) — Android, advertisement-first
  with L2CAP control.
- BudsLink itself (GNOME) also drives AirPods.

## Sennheiser — no gap worth closing

BudsLink's Sennheiser module speaks the same GAIA framing this app does, with
most per-model features commented out; we poll and drive strictly more. Two
useful confirmations came out of the comparison, both already folded into
`core/profiles.ts` evidence comments: `M5AEBT` (MOMENTUM 5) and `MTW4` are
real model strings, not just app-binary guesses.
