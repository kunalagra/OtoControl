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
