# Xiaomi / Redmi Buds driver: RCSP over RFCOMM, v1

**Date:** 2026-10-02
**Status:** implemented (v1, revised 2026-10-02 after a verification pass: see §10); awaiting a run on real hardware

A sixth `DeviceDriver`, for Redmi / Xiaomi earbuds. Built from reverse
engineering only; no hardware has been available. v1 is the classic Bluetooth
RFCOMM transport on Xiaomi's own service class, over Web Serial. BLE GATT, the
standard SPP UUID and the XiaoAi UUID are out of scope.

## 1. Sources and precedence

| Tag | Source | Used for |
|---|---|---|
| APK | `com.mi.earphone` 1.37.1i, jadx sources under `android-testing/xiaomi/jadx_out/sources` | opcodes, config ids, TLV layouts, battery encoding |
| GB | Gadgetbridge `service/devices/redmibuds/` (`RedmiBudsProtocol.java`, `protocol/*.java`) and `devices/redmibuds/` | wire details proven on hardware: auth, set/get payloads, enums, per-model features |
| WinMi | `ios7jbpro/WinMi-Buds` (Redmi Buds 5 Pro, a GB port) | test vectors: framing, auth golden values, info/run-info/status replies |
| MiBudsController | `FallenLeeee/MiBudsController` (Redmi Buds 8 Pro) | auth tolerance, `fd2d` confirmation |
| MiBudsClient | `CesurPolat/MiBudsClient` (Redmi Buds 6 Play) | a model that works with the handshake mostly skipped |
| buds-control | `0swift135/buds-control` (Redmi Buds 6 Lite, RFCOMM scripts) | what a 6 Lite does with and without the handshake; the custom-EQ write sequence |
| capture | `T0F1Q2007/redmi-buds-6-active-linux-software` `chan28.txt`: the official app against a REDMI Buds 8 Pro (PID 0x50E3), RFCOMM payloads | a real conversation: handshake, info, run info, configs, notifications |
| Gadgetbridge issues | codeberg PRs and issues for the Redmi Buds (listed in §10) | per-model behaviour, SDP records, PIDs, find |
| vendor catalog | `product/get_product_list` on the live host, fetched by `scripts/fetch-xiaomi-catalog.py` | per-model capabilities, option lists and product renders |

Where sources disagree: a capture of the official app on hardware wins; then
Gadgetbridge and the community tools (real hardware, several models); then the
vendor APK's static reading; then the notes in `XIAOMI_PROTOCOL_NOTES.md`.
§10 labels each fact as captured, reported on hardware, or read statically.

## 2. Scope

Implemented: auth handshake, target info (firmware, VID/PID, colour, battery),
run info (ANC mode, in-ear setting), battery push, ACKs for earbud-initiated
frames, ANC / transparency / off, ANC and transparency strength (named gears or
a depth slider), EQ preset, a 10-band custom EQ with read-back, gestures per tap
and side with the long-press noise-control cycle, in-ear detection toggle, find
earbuds, per-model gating and product renders from the vendor catalog,
protocol log and a read-only query console.

Deferred: adaptive ANC / adaptive sound / dual connection / auto-answer toggles
(configs 0x25, 0x29, 0x04, 0x03; the vendor app also drives 0x66, see §10),
spatial audio, ear-fit test, firmware update, GATT.

## 3. Transport

- RFCOMM service class `0000fd2d-0000-1000-8000-00805f9b34fb`.
  APK `BluetoothConstant.java:77-78`, first in the retry order `e7/i.java:308-319`;
  GB `RedmiBudsProtocol.java` (`UUID_DEVICE_CTRL`); MiBudsController
  `BluetoothService.cs:27`; WinMi `docs/protocol.md`.
- A distinct UUID, so it does not share `0x1101` with the HeyMelody generic
  fallback. One `KNOWN_SERVICES` row: brand `xiaomi`, protocol `xiaomi-rcsp`.

## 4. Frame

```
FE DC BA | type | opcode | len (u16 BE) | [status] | seq | payload | EF
```

- No checksum. Integrity is the header, `len` and the trailer.
- `len` counts `status` (responses only), `seq` and `payload`.
- Types: `C4` phone request, `04` response, `C0` earbud request, `C7` earbud
  notify. Bit 6 set means a request (no status byte); `04` is a response with
  a status byte (0 = ok).
- APK `f7/f.java:756-824` (encode), `:2376-2404` (stream scan), `:850-917`
  (header parse); GB `Message.java`; WinMi `Packet.cs`.
- Vector: `FEDCBA C4 08 0004 2A 02 04 01 EF` (ANC on, seq 0x2A), WinMi test.
- Deframing is length-driven, never a scan for the next header: payloads may
  contain `FE DC BA`. A bad trailer, an impossible length (under the
  seq/status prefix, or over 4096) or an unknown type byte drops one byte and
  resynchronises (WinMi `PacketReader`).

## 5. Authentication

Mutual, keyless. APK gate `BluetoothAuth.java:261` (opcodes 80/81 = `0x50`/`0x51`);
GB `RedmiBudsProtocol.handleAuthentication`.

1. Phone `C4 50 [01 + 16 random]`. The reply is not validated (GB, WinMi).
2. Phone `C4 51 [01 00]`.
3. Earbuds send `C0 50 [01 + 16-byte challenge]`; phone answers `04 50 [01 + E21(challenge)]`.
4. Earbuds send `C0 51`; phone answers `04 51 [01]`.
5. Phone requests info.

E21 is the Bluetooth SAFER+ variant: key = the challenge with `key[15] ^= 6`,
8 rounds, fixed plaintext `11 22 33 33 22 11 11 22 33 33 22 11 11 22 33 33`,
exp/log tables from base 45 mod 257, bias matrix and 16x16 coefficient matrix
as in GB `Authentication.java` / `AuthData.java`. The key is the challenge
itself, so nothing secret is needed. The APK notes call this a "custom stream
cipher"; its S-box at 0xa70 starts `01 2d e2 93`, which is `45^i mod 257`: it
is SAFER+.

Tolerance: some models do not complete the handshake (MiBudsController
`EarbudsClient.cs:106`; MiBudsClient sends only the step-4 answer). Steps 1-2 are
best-effort and the earbud-initiated answers are given whenever they arrive,
so a device that skips the handshake is still read.

Verification: the TypeScript port reproduces both directions of a real
handshake from a capture of the official app (the earbuds' answer to the app's
challenge and the app's answer to theirs), and golden responses from WinMi's
`tests/auth_reference.py` and from buds-control's independent implementation,
which uses literal tables. See §10 (a). The Java itself was never run (no JRE).

## 6. Commands

All multi-byte values are big-endian. Config opcodes carry units
`[len = value.length + 2][id u16 BE][value]`; a get request is a list of u16 ids
(GB sends one id per request).

| Purpose | Frame | Source |
|---|---|---|
| Target info | `C4 02`, payload `FF FF FF FF` (u32 mask) | APK `GetTargetInfoParam`; GB `authConfirm` |
| Run info | `C4 09`, payload `FF FF FF FF` | GB |
| ANC mode set | `C4 08`, `02 04 mode` (0 off, 1 ANC, 2 transparency) | GB `encodeSetAmbientSoundControl`; WinMi test vector; APK `FunctionConfigImpl.java:304-309` (vendor type 4) |
| In-ear detection set | `C4 08`, `02 06 v`, inverted: 0 = on | GB `encodeSetEarDetection`; WinMi |
| Strength set | `C4 F2`, `04 00 0B target level` (target 1 ANC, 2 transparency) | GB; WinMi; APK cfg 11 `[state, level]` |
| EQ preset set | `C4 F2`, `03 00 07 preset` | GB; APK cfg 7 |
| Find set | `C4 F2`, `04 00 09 enable which` (which 1 left, 2 right, 3 both) | GB `encodeFindDevice`; APK cfg 9 |
| Config get | `C4 F3`, `00 id` | GB `encodeGetConfig` |
| Gesture set | `C4 F2`, `05 00 02 tap left right` (tap 4 single, 1 double, 2 triple, 3 long, 5 slide) | GB `encodeSetGesture`; APK `DeviceConfigClickSet.java:74` |
| Long-press cycle set | `C4 F2`, `04 00 0A left right` (masks 3, 5, 6, 7) | GB `encodeSetAmbientSoundCycle` |
| Custom EQ set | `C4 F2`, `24 00 37 05 01 01 0A` + 10 x `[freq u16][gain]` | GB `encodeSetCustomEqualizer`; §10 (d) |

Replies. Info (`02`) and run info (`09`) payloads are TLVs `[len][type][value]`,
`len` counting the type byte.

| Reply | Type | Meaning |
|---|---|---|
| info | 0 | Bluetooth name (APK `f7/f.java:489+`) |
| info | 1 | firmware, 2 or 4 bytes, nibbles `a.b.c.d` (+ second four) |
| info | 3 | VID u16 + PID u16 |
| info | 7 | battery: left, right, case |
| run info | 9 | ANC mode (0/1/2) |
| run info | 10 | in-ear detection, 0 = on (GB `decodeDeviceRunInfo`) |
| status push `0E` | 0 | battery: left, right, case |
| status push `0E` | 4 | ANC mode |
| config get `F3` / notify `F4` | 0x0B | `[mode, level]` in both: the active mode and its strength id (§10 b) |
| config get / notify | 0x02 | gesture table: `[tap, left, right]` triplets |
| config get / notify | 0x0A | long-press cycle `[left, right]` |
| config get | 0x37 | custom EQ: `[01][mode][max][min][id][nameLen][name][count]` + `[freq u16][gain]` per band |
| info | 13 | colour id (picks the product render) |
| config get / notify | 0x07 | EQ preset |

Battery byte: bits 0-6 level, bit 7 charging, `FF` absent, a level over 100
unknown. Slot order left, right, case: APK `BatteryInfoContainer.java:104-118`
and GB `decodeDeviceInfo`.

Earbud-initiated frames (`C0` / `C7`: `0E`, `F4`, `50`, `51`) must be answered
with a type-`04` frame carrying the same opcode and seq, empty payload unless
the step above says otherwise (WinMi test: `FEDCBA 04 0E 0002 00 FF EF`).

## 7. Model identification and gating

Info type 3 gives VID `0x2717` and a PID. The vendor's own catalog
(`docs/reference/xiaomi-catalog.json`, 41 products, regenerated by
`scripts/fetch-xiaomi-catalog.py` into `catalog.generated.ts`) lists per PID the
app's capability functions (`com.mi.earphone.device.manager.export.Function`):
noise-control gears (`tws_gear`: 1002/1003/1006/1007 for noise cancelling,
1004/1005 for transparency), EQ presets (`sound_effect.effects`, 2016), the
actions each gesture takes (`click_action`, 4001-4011), find (5001) and
in-ear detection (3002). That is the authoritative gate; what the earbuds then
answer to a read is what is switched on.

A model newer than the bundled catalog falls back to the name the earbuds
report (info type 0), the option lists Gadgetbridge's coordinators share, and
probing: noise control unless the name says `Active`, find offered, gestures
and the custom curve probed.

Product renders: one per colour id from the same catalog, chosen by the colour
the earbuds report (info type 13), else the catalog's default. Only URLs ship.

## 8. Disagreements resolved

1. APK notes: feature channel is ZiMi vendor ops 81-86. Wrong for these
   earbuds: ZiMi is vendor `0x5A4D`; these are `0x2717` and use `F2/F3/F4` and `08`.
2. APK notes: gestures on config 83. Config 83 is a dongle; earbuds use
   config 2 (GB, APK `DeviceConfigClickSet.java:74`). Deferred, not wrong.
3. APK notes: ANC bit-packing for config 10. GB's observed values win.
4. Notes: "custom stream cipher". It is SAFER+, keyed by the challenge.
5. Run-info type 10 is "autoplay" in the notes and in-ear detection in GB;
   GB's reading is used. Hardware check wanted.
6. (revised) A config-get reply of `0x0B` is `[mode, level]`, the same as the
   notify, not `[target, level]`: the capture shows `04 00 0B 02 02` in a reply
   while transparency was active and `00 00` while off.
7. GB writes the 2 kHz band as 2016 Hz; the earbuds report 2000 Hz. The driver
   writes back the frequencies it read.
8. The notes' gesture config 83 is a dongle; config 2 is the earbuds' (also in
   the capture: five triplets).
9. The first v1 gated find per Gadgetbridge's tested-model list. The vendor
   catalog lists find on 38 of 41 products, so find is gated on that instead.

## 9. Risks

What stays unverifiable without hardware is listed in §10. In short: the
persistence of the custom-curve write form, find on a model the catalog lacks,
a device that ignores or refuses `0x50`, and strength writes to the inactive mode.
The earbuds must be paired with the OS for Chrome to list them.

## 10. Verification evidence

Labels: **capture** = bytes of the official app talking to real earbuds;
**hardware** = reported or scripted against real earbuds by a third party;
**static** = read from the decompiled vendor app or its catalog.

### Sources used as evidence

- Capture: [`chan28.txt`](https://github.com/T0F1Q2007/redmi-buds-6-active-linux-software/blob/main/chan28.txt),
  RFCOMM payloads of the official app on a device with VID/PID 0x2717/0x50E3
  (REDMI Buds 8 Pro in the vendor catalog; the repo calls it a Buds 6 Active and
  the earbuds report the name "vela os earbuds", so the model label is uncertain).
  Decoded with the same deframer as the driver.
- Gadgetbridge (hardware): PR [#4343](https://codeberg.org/Freeyourgadget/Gadgetbridge/pulls/4343)
  (Buds 5 Pro: connection and authentication, battery, ANC modes and strengths,
  all touch options, ear detection, EQ presets and custom curve; a comment notes the
  Buds 6 Active "returns empty payload for some config commands"),
  [#4645](https://codeberg.org/Freeyourgadget/Gadgetbridge/pulls/4645) (Buds 3 Pro),
  [#4449](https://codeberg.org/Freeyourgadget/Gadgetbridge/pulls/4449) and
  [#5833](https://codeberg.org/Freeyourgadget/Gadgetbridge/pulls/5833) (Buds 6 Active),
  [#5932](https://codeberg.org/Freeyourgadget/Gadgetbridge/pulls/5932) (Buds 8 Active, firmware 3.0.6.0),
  [#6818](https://codeberg.org/Freeyourgadget/Gadgetbridge/pulls/6818) (Buds 6 Lite, PID 0x508B, firmware 1.0.5.1 / 0.5.0.3),
  [#6834](https://codeberg.org/Freeyourgadget/Gadgetbridge/pulls/6834) and
  [#6841](https://codeberg.org/Freeyourgadget/Gadgetbridge/pulls/6841) (find, tested on Buds 6 Active and 8 Active),
  [commit c03ef5ca](https://codeberg.org/Freeyourgadget/Gadgetbridge/commit/c03ef5ca8481a49bee7221e50ea1208b4e97482a)
  (find frame, "reverse-engineered from HCI captures of the Xiaomi Earbuds app"),
  issues [#4934](https://codeberg.org/Freeyourgadget/Gadgetbridge/issues/4934) and
  [#6061](https://codeberg.org/Freeyourgadget/Gadgetbridge/issues/6061) (Buds 6 Pro / Buds 6 driven as a Pro),
  [#5439](https://codeberg.org/Freeyourgadget/Gadgetbridge/issues/5439) (Buds 6 Pro: official app has find, adaptive sound, auto-answer),
  [#5116](https://codeberg.org/Freeyourgadget/Gadgetbridge/issues/5116) and
  [#5141](https://codeberg.org/Freeyourgadget/Gadgetbridge/issues/5141) (SDP records of the Buds 6 Play and 6 Lite).
- Community tools (hardware): [MiBudsController](https://github.com/FallenLeeee/MiBudsController) (Buds 8 Pro),
  [WinMi-Buds](https://github.com/ios7jbpro/WinMi-Buds) (Buds 5 Pro),
  [MiBudsClient](https://github.com/CesurPolat/MiBudsClient) (Buds 6 Play),
  [buds-control](https://github.com/0swift135/buds-control) (Buds 6 Lite; scripts `buds_battery.py`, `buds_mode.py`, `buds_eq.py`).
- Vendor catalog (static): live `product/get_product_list` with the app's real request body
  (`app_version`, `app_platform`, `last_modify_time`; `DeviceRequestBean`). The v1 fetch used
  a body the host answered with only nine products; with the real body it returns 38 (Android)
  and 41 (iOS) distinct PIDs.

### (a) Handshake: who needs it, and what a model that skips it does

| Finding | Evidence |
|---|---|
| Models that complete all four steps, in our order | **capture**: app challenge at +0, earbuds answer at +98 ms, app confirm, earbuds' own challenge at +69 ms later, their confirm +68 ms after that. **hardware**: GB on Buds 3 Pro / 5 Pro / 6 Pro / Active / 8 Active, buds-control `do_handshake` on a 6 Lite (waits for each reply), MiBudsController on an 8 Pro |
| E21 is exactly what both sides compute | **capture**: the earbuds' answer equals E21 of the app's challenge, and the app's answer equals E21 of the earbuds' challenge (both pinned in `auth.test.ts`). A third implementation with literal tables (buds-control) matches this port on every vector and its tables equal the generated ones |
| Works with no handshake at all | **hardware**: Buds 6 Lite info and battery reads, ANC mode set (`08 02 04 mode`) and EQ preset set with verifying get, from scripts that never authenticate (buds-control, "proven on wire for Buds 6 Lite"); Buds 6 Play battery after sending only the ACK of the earbuds' confirm (MiBudsClient) |
| Needs the handshake | **hardware**: custom-EQ curve writes on a 6 Lite, per the buds-control author ("otherwise the chip ignores curves"); anecdotal, one source |
| What a skipping model does with `0x50` | **not observed**: every device seen answers `04 50` within ~100 ms. No log shows a model that ignores, refuses or drops on it |

Code: all steps are best-effort and cannot fail the connect. An unanswered or
refused challenge (timeout or status != 0) skips our confirm and shortens the
wait for the earbuds' own confirm to 300 ms, so a silent model costs about
0.8 s; an answering model waits up to 1.5 s for the confirm. The outcome is
shown (`complete` / `partial` / `skipped`). `GetInfo` is retried once and a
port that never answers it is released.

### (b) Layouts

| Fact | Verdict | Evidence |
|---|---|---|
| Config `0x0B`, get reply vs notify | **corrected**: both are `[mode, level]` (active mode, its strength id), not `[target, level]` in a reply | **capture**: `04 00 0B 02 02` (reply, transparency), `04 00 0B 00 00` (reply, off), `04 00 0B 01 00` and `04 00 0B 02 01` as notifications; the set `04 00 0B 02 01` is echoed as the notification `[2, 1]`, so a set's target is a mode |
| Strength beyond the named gears | **new**: a level can run 0-19 | **capture**: notify `[1, 0x13]` right after ANC turned on; **static**: the catalog lists a 0-19 gear for the 8 Pro, 6 Pro, 5 Pro Wi-Fi/5 Pro (Xiaomi) and Air 5. The earlier idea of masking the low nibble was wrong and was dropped |
| Run info `0x0A` is in-ear detection, 0 = on | **verified link, polarity from hardware** | **capture**: the app writes `08 02 06 01` then `08 02 06 00`; the next run info reads `0A = 00`. Polarity (0 = on) is Gadgetbridge's and WinMi's, tested on a 5 Pro. The APK's name "autoplay" is the same setting (auto play/pause on removal) |
| Battery order left, right, case | **verified** | **hardware**: three independent consumers (GB across models, MiBudsClient on a 6 Play, buds-control on a 6 Lite); **static** `BatteryInfoContainer.java`; the capture's pushes (`5F 64 FF`, `5F 5F FF`) agree |
| Info TLV 1 firmware | **verified**: four bytes, two versions | **capture** `12 36 12 36` -> 1.2.3.6 / 1.2.3.6; **hardware** #6818 (1.0.5.1 / 0.5.0.3); two-byte form seen only in the APK, still tolerated |
| Info TLV 0 is the Bluetooth name, 13 the colour | **verified** | **capture**: `00 'vela os earbuds'`, `0D 02` (2 = black in the catalog's colour ids) |
| An unsupported config read | **verified**: a successful reply with an empty value, not an error | **hardware**: #4343 comment; **capture**: set replies carry no payload. A config the model lacks therefore counts as "not answered" by what the reply carries |

### (c) Find and per-model gating

| Fact | Verdict | Evidence |
|---|---|---|
| Find frame `04 00 09 enable which` (1 left, 2 right, 3 both) | **verified** | **hardware**: HCI captures of the official app (commit c03ef5ca); tested ringing on Buds 6 Active and 8 Active (#6841) |
| Which models have it | **corrected**: the vendor catalog lists find (func 5001) on 38 of 41 products, not just GB's three tested models | **static** catalog; **hardware** #5439 and #4449: users say the official app has find on the Buds 6 Pro / 6 Active while GB did not implement it. Absent: Buds 3 Pro, Buds 3, Buds 3 Star Wars, Disney 100th, Buds 4 Active |
| Refusal on a model without it | **unverified** | no log of a find write to a model lacking it. Mitigation: gated by the catalog; an unlisted model is offered find and a refusal rolls back with the reason |
| Model gating and PIDs | **extended** | 41 PIDs with English names from the catalog, plus 0x508B (Buds 6 Lite) from #6818; the catalog's "6 青春版" is 0x508A. Gadgetbridge matches by name only; the only PID it records is the Lite's |

### (d) Custom EQ write form

| Fact | Evidence |
|---|---|
| Read-back layout `01 mode max min id nameLen count` + bands | **capture**: `01 0A 06 06 00 00 0A` then ten bands at 62, 125, 250, 500, 1000, **2000** (not GB's 2016), 4000, 8000, 12000, 16000 Hz; **static** `DeviceConfigCustomEq.valueToParams` agrees |
| GB's write `[05 01 01 N]` + bands is accepted | **hardware**: buds-control on a 6 Lite sends exactly this (after selecting preset `0A` and after the handshake) and receives the `04 F2` ack; GB reports "equalizer presets and custom curve" working on a 5 Pro (#4343) and 8 Active (#5932) |
| Which of GB's form (the APK's "preview", op 8) and the APK's "save" form (op 4, `[01 0A 01 01 01 00 N]`) persists | **unverified**: no log shows either surviving a reconnect; no report of the GB form not persisting was found either. The driver uses GB's form, selects the Custom preset first, then reads the curve back and compares, and tells the user when the earbuds did not keep it |

### Unverifiable without hardware

- Persistence of the custom curve across a power cycle.
- A device that ignores or refuses `0x50`, and find on a model without it.
- Writing a strength to the inactive mode (the UI only writes the active one).
- That `0xFF` means "leave this side": the driver avoids it by writing both sides from the table it read.
- Whether the in-ear polarity holds on every model, and per-model colour ids beyond white, black and blue.
- Config `0x66` (adaptive-ANC switch in the capture, mirrored to `0x25`), config `0x29`, spatial audio: not implemented.
