# Provider gaps

What this app could drive but does not yet, per provider, with the reference
each item is checked against. Distinct from `PROTOCOL-UNKNOWNS.md`, which is
about values we have not verified; this is about features we have not written.

Cross-checked, in descending order of authority and all read as reference
with nothing copied (the standing rule `core/profiles.ts` already states).
For Nothing specifically, **BudsLink's `nothingBuds` module is a third
independent source** and has corrected eight rows of `models.ts` that were
derived from vendor data alone — a working implementation beats a reading of a
config file.

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

We cover **23** models to BudsLink's 17 (the 2025–26 lineup came from the
official app's `ear_white_list.json`, which lists 24 as of app 3.8.0).

The app's protocol surface is **146 addressable commands**: 66 queries
(`0xc001`–`0xc071`), 50 writes (`0xf001`–`0xf075`), 17 notifications
(`0xe001`–`0xe018`) and 13 test/debug (`0xfc01`–`0xfc30`). `0xc000`/`0xe000`/
`0xf000`/`0xfc00` are family masks rather than commands — `TWSDevice` classifies
with `requestCmd & 0xC000`. Of the 146, only **46 have a request builder** in
`TWSDeviceExtKt`, which is the app's real user-facing surface. This driver
implements 16 reads, 14 writes and 3 notifications. Feature gaps:

| Feature | Models | Status |
|---|---|---|
| Spatial audio + head-tracking toggle | 5 | ✅ done |
| Ear-tip fit test | 7 | ✅ done — already was when this ledger was written |
| Personalized ANC level | 3 | ✅ done — likewise |
| Find-my ringing | 16 | ✅ done — likewise |
| Single-body battery (the over-ears) | 4 | ✅ fixed |
| Colourway-accurate artwork | all | ✅ fixed — but see below |
| Render for colourways newer than the app build | some | ❌ open |
| Wear detection (`0xc00a`, notify `0xe002`) | all | ✅ done |
| Serial number + hardware revision (`0xc006`) | all | ✅ done |
| Multipoint on/off (`0xc027`/`0xf01a`) | many | ✅ done |
| Multipoint device list (`0xc028`/`0xf01b`) | many | ❌ open — no parser in the app's Java |
| Clarity boost (`0xc069`/`0xf069`) | few | ✅ done |
| Smart ANC / smart free (`0xc055`, `0xc054`) | few | ✅ done |
| LHDC codec (`0xc029`/`0xf01c`) | few | ✅ done |
| Advanced 8-band EQ (`0xc04d`/`0xf050`) | 4 | ✅ done |
| Connect handshake (`0xc001` → `0xf001`) | all | ✅ done |
| Clock (`0xf00a`) | all | ✅ done |
| Reply-shaped state pushes (`0x4xxx`) | all | ✅ done |
| Calibration trigger (`0xf012`) | few | ✅ done |
| Factory reset (`0xf03d`) | all | ✅ done |
| Mimi hearing personalisation (`0xc022`–`0xc025`) | few | ❌ open — no cross-reference |
| 3D mode (`0xc026`/`0xf019`) | few | ❌ open — value semantics unknown |
| Scenario mode (`0xc071`/`0xf075`) | few | ❌ open — mode ids unknown |
| Auto power off (`0xc011`/`0xf00b`) | many | ❌ open — payload unread |
| ANC configuration (`0xc01d`) | many | ❌ open — BudsLink sends it, parses nothing |
| Gesture discovery (`0xc009`) | all | ❌ open — no Java reference at all |
| Probe gating (skip probes the model table answers) | all | ⛔ rejected — hides real features, see below |
| Model coverage: B201, plus B182 and B220 | 3 | ❌ open — none has a catalogue entry to name it |
| Capability query instead of timeout probing | all | ⛔ not useful — see below |

The six ❌ rows that are protocol unknowns rather than unbuilt features —
gesture discovery, auto power off, ANC configuration, the multipoint device
list, 3D mode and scenario mode — each have an entry in
`PROTOCOL-UNKNOWNS.md` saying exactly what is missing and what would close it.
Four of the six have no reference anywhere in the app's Java beyond the id
itself, so they need a capture rather than more reading.

**App 3.8.0 changes none of this** (checked 2026-08-26). It declares the same
304 `GET_`/`SET_`/`NOTIFY_` constants as 3.7.3, ships the same 18
`IOTProductDevice` subclasses, and alters not one flag on any existing model.
Its only delta is the new B193 above. A newer vendor build is not a route to
closing anything here.

Three of these rows were wrong when first written: `NothingSystem.tsx` and
`NothingNoise.tsx` already drove the fit test, the ringer and personalized ANC.
Spatial audio is now done too, head tracking included — the payload is the
app's `BasicBoolean`, whose reply *width* is what says whether a model tracks
the head.

Two bugs the CMF Headphone Pro turned up, both now fixed. **Battery** was
decoded only for device ids `2`/`3`/`4` (left/right/case), so every single-body
over-ear — B170, B175, B186, B198 — returned an all-null battery while the read
itself succeeded: the capability probe passed and the UI simply showed nothing.
The official app's `DeviceBattery` maps `5` "tws" and `6`-or-`7` "stereo" as
well, which is where a one-cell device reports. **Colourway** was never read at
all: `nothingCdn.generated.ts` asserted the colourId was "only readable over
BLE, never over serial", so the artwork always defaulted to black. It is an
ordinary control-channel query, `GET_REMOTE_COLOR_ID 0xc00c`, and the driver
now reads it and picks the matching render.

On probe gating: `refresh` asks 22 questions and silence is the expected answer
to most, so the connect cost is real — 33 s at the default timeout. Twenty of
the reads now use a 400 ms probe timeout (worst case ~11 s), and the probes are
ordered by measured per-model prevalence so a device's real features resolve
first.

A returning device skips the probes entirely: the capability set is cached in
the snapshot and reused when the base code *and* firmware both match what was
just read, so only identity plus the device's real features are asked. A manual
Refresh always re-asks.

Gating them on `models.ts` — which is what the official app does, never
probing at all — was tried and **rejected on evidence**: the table records B175
as `personalizedAnc: false` while a real CMF Headphone Pro answers that command,
so gating would have hidden a working control. Probing a missing feature costs
400 ms; hiding a present one costs a bug nobody reports. The precedence rule
this follows from is under **Source precedence** below.

`GET_SUPPORTED_FEATURE 0xc00d` turned out not to be the probe replacement it
looked like: its bitmask covers pairing, assistants, codecs and wear detection,
overlapping only two of our dozen probes. The one genuine remaining gap is the
advanced EQ's per-band values.

On the model-coverage row: `ear_white_list.json` lists a **B201** we do not
carry — it is B173's `supportId` as well as an entry of its own, and has no
SKU-catalogue entry to name it — and the app's per-model classes reveal two
more the white list itself omits, **B182** (`GligarManager.productId`, beside
B184) and **B220** (in `IOTProductDeviceEspeon`). None can be named without a
catalogue entry, so none is guessed at. All three are still unnamed in 3.8.0.

App 3.8.0 added exactly one model, **B193 CMF Buds Neo**, and it is now
carried. It is the only row in the table with no `IOTProductDevice` class
behind it, so its flags had to come from `ear_white_list.json` — which that
table's comment rightly warns is unreliable. Measuring each field against the
22 rows already verified from those classes gives the honest answer about
which ones can be trusted: `earTipFitTest` matches 22/22, `eq: 0` picks out
exactly the four `diracEq` models (22/22), `ultraBass: 1` never once claims
bass boost a model lacks (15/15, it only under-reports), and `earDetection`
holds 7/8 where it is stated at all but is absent on most models.
`diracOpteoSupport` manages only 19/22 and was not used.

On colourways: the id is read off the wire (`0xc00c`) and named from the app's
`DeviceColor` enum, so any colour can be *named*. The **renders** come from the
app's SKU catalogue, which only lists the finishes that had shipped by that app
build — the blue CMF Headphone Pro is real, reports `03`, and has no entry
(neither the global nor the CN catalogue has one; five other models do have a
blue render, so the id is supported and B175's is simply absent). Such a device
shows the model's default finish and the System page says so, rather than
quietly presenting the wrong colour. Closing it needs a newer app build, or the
CDN URL for that SKU — and **3.8.0 is not that build**: B175 still lists only
colourIds 01, 02 and 06, and no existing model gained a colourway.

Two protocol facts worth carrying forward. Both are recorded on the code that
depends on them, not here:

- **Nothing is reachable over either carrier.** Web Serial through the RFCOMM
  service class `AEAC4A03-…`, or BLE GATT — devices expose that same UUID as a
  service, and the app declares a second BLE data service (`CA235943-…` /
  `68745353-…`) besides its OTA pair. An earlier revision recorded this as
  "Web Serial only" and removed the GATT branch; that was wrong, and hardware
  showed it. See `core/gattTransport.ts`.
- **The model is readable over the wire** (`GET_DEVICE_MODEL 0xc01c`) — the
  only way to identify a Nothing device on a carrier that exposes no Bluetooth
  name, and the reply is little-endian bytes hex-encoded, not text. See
  `decodeDeviceModel` in `drivers/nothing/commands.ts`.
- **Per-model feature flags come from the app's `IOTProductDevice` subclasses**,
  not `ear_white_list.json`, whose `ultraBass` and `diracOpteoSupport` fields
  mean something else. The swept table is in `drivers/nothing/models.ts`.

### Commands with a builder that this driver does not send

Readable from the app, not yet wired up, and none of them blocked on a
capture — each has a `TWSDeviceExtKt` builder, so the request shape is known:

| Feature | Get / Set |
|---|---|
| Adaptive EQ | `0xc043` / `0xf042` |
| Third-driver advanced EQ | `0xc06c`, `0xc06d` / `0xf06c`, `0xf06d` |
| Bass **enhancer** mode (not bass boost) | `0xc053` / `0xf057`, gated by `hasBassEnhancerFunction` |
| High volume gain | `0xc010` / `0xf008` |
| Volume | `0xc014`, read-only |
| Head-tracking start | `0xc058`, notify `0xe015` |
| LE audio | `0xc056` / `0xf05a`, `0xc059`, notify `0xe016` |
| Find-ear state | `0xc002` — pairs with our `RingBuds 0xf002` |

**Notifications never handled:** `0xe002` device status, `0xe005` game mode,
`0xe006`/`0xe00e` multipoint, `0xe009` working status, `0xe00b` LED colour sync,
`0xe00c` personalize sync, `0xe014` magic button, `0xe015` head track, `0xe016`
LE audio, `0xe018` recording — ten features across eleven ids. Whether a device
pushes any of them unprompted is itself unknown; see the registration entry in
`PROTOCOL-UNKNOWNS.md`.

### Source precedence — which authority wins

Written down because three separate "not supported" conclusions in this project
were incomplete searches rather than real absences. Nothing's protocol facts
live in five places, and reading one is not reading the protocol:

| Where | What it holds |
|---|---|
| `base/protocol/constant/ProtocolConstant.java` | most command ids |
| `core/ext/TWSDeviceExtKt.java` | 46 request builders and their payloads, **plus three ids declared nowhere else** |
| `base/protocol/entity/`, `core/entity/`, `earbase/*/entity/` | 21 reply parsers (`ITWSParse`) |
| `base/util/ext/DataExtKt.java` | the byte primitives every parser uses |
| `<codename>/core/device/IOTProductDevice*.java` | per-model capability predicates |

Plus the Flutter config (`ear_white_list.json`, `devices_info_list.json`), and
**BudsLink's `nothingBuds` module** outside the APK entirely. The per-codename
*protocol* classes were all checked (`crobat`, `gligar`, `girafarig`, `espeon`,
`elekid`, `corsola`, `donphan`) and declare **zero command ids of their own** —
the id tables really are just `ProtocolConstant` and `TWSDeviceExtKt`.

The order: **app code, then app config, then BudsLink, then anything else.** The
app's code is executable and so outranks its own config, whose field names do
not map onto feature names as neatly as they look — `ultraBass` and
`diracOpteoSupport` have both been misread here. BudsLink is a *working
implementation*, which makes it the better authority than a reading of vendor
data wherever the vendor is silent, but it does not overrule the vendor.

One exception, about direction rather than authority: **no source may be used to
hide a feature the device itself reports.** A flag saying "absent" is
documentation; a device answering a read is evidence. The device wins, and the
flag stays as a record of what the vendor claimed. `models.ts` has a proven
false negative of exactly this kind — it records B175 as `personalizedAnc:
false`, no vendor source says otherwise, and a real CMF Headphone Pro answers
`GET_PERSONALIZED_ANC 0xc020` anyway. That single fact is why probe gating is
rejected above.

Comparing all three per-model sources across every model and every shared flag
leaves exactly **two** genuine contradictions, both on B175:

| Model | Flag | White list | Class | BudsLink | Taken |
|---|---|---|---|---|---|
| B175 | in-ear detection | **no** | — | yes | **no** — app is its only statement |
| B175 | bass boost | no | **yes** | yes | **yes** — app *code* outranks app config |

Recording in-ear as absent is safe because nothing gates on it:
`decodeInEarDetection` addresses feature id 1 inside `0xc00e`'s list and returns
null when the device does not mention it. A `model.inEarDetection` check used to
sit on top and was removed — with the decoder fixed it could only ever hide
something the device had just confirmed.

One apparent disagreement that probably is not one: BudsLink marks `ring: true`
on 16 of 17 models where the white list sets `findDevice: 1` on five. Most
likely two different features — a local "play a tone" (`SET_WHERE_AM_I 0xf002`)
versus registration with a find-my service. Nothing gates on it either way.

### The open-source Nothing apps — ⛔ nothing to take (surveyed 2026-08-26)

Five community projects were read for anything that would close a gap above.
None does. Every opcode any of them knows, this driver already implements, and
between them they cover 13 commands against our 40-odd:

| Project | Language | Commands it knows |
|---|---|---|
| [`SoaOaoS/something-x`](https://github.com/SoaOaoS/something-x) | Python, GTK4 | `0xc001`, `0xc006`, `0xc007`, `0xc00a`, `0xc01e`, `0xc01f`, `0xc042`, `0xf001`, `0xf00f`, `0xf010`, `0xe001`–`0xe003` |
| [`noebachofner/EarPhonesX`](https://github.com/noebachofner/EarPhonesX) | Python | the same, plus `0xc044`/`0xf041` custom EQ and `0xc04c`/`0xf04f` advanced EQ |
| [`sn99/nothing-linux`](https://github.com/sn99/nothing-linux) | Rust | ANC and latency mode only |
| [`LuanAdemi/nothing-ear-controller`](https://github.com/LuanAdemi/nothing-ear-controller) | GNOME extension | ANC only |
| [`arunavo4/nothing-x-macos`](https://github.com/arunavo4/nothing-x-macos) | Swift, 2023 | Ear (1); its own README says reads do not work |

None of them references `0xc009`, `0xc011`, `0xc01d`, `0xc026`, `0xc028` or
`0xc071` — the six unknowns above — so the capture is still the only way to
close them.

The survey was not wasted, though: where EarPhonesX overlaps us it **agrees**
on every byte (`0xf04f` advanced-EQ enable against our `SetAdvancedEq`,
`0xc04f` spatial audio, `0xf041`/`0xc044` custom EQ), which is an independent
confirmation of decodes we had only from the decompiler. The one difference
worth noting is that something-x sends `[0x03]` as the payload of the ANC read
`0xc01e` — "give me three entries" — where this driver sends none. Ours parses
whatever length comes back, so it is not a bug; whether the payload changes
what a device returns is untested and needs hardware.

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
