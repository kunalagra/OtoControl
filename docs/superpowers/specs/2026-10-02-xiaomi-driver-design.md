# Xiaomi / Redmi Buds driver: RCSP over RFCOMM, v1

**Date:** 2026-10-02
**Status:** implemented, awaiting hardware verification

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

Where sources disagree, GB (real hardware, several models) wins over the APK's
static reading, and the APK wins over notes in `XIAOMI_PROTOCOL_NOTES.md`.

## 2. Scope

Implemented: auth handshake, target info (firmware, VID/PID, battery), run info
(ANC mode, in-ear setting), battery push, ACKs for earbud-initiated frames,
ANC / transparency / off, ANC and transparency strength, EQ preset, in-ear
detection toggle, find earbuds, protocol log and a read-only query console.

Deferred: gestures (config 2: three-byte `[tap, left, right]` records, action
sets differ per model), custom EQ curves (config 0x37), adaptive ANC / adaptive
sound / dual connection / auto-answer toggles, firmware update, GATT, artwork.

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

Verification: the TypeScript port is checked against golden responses
produced by WinMi's `tests/auth_reference.py`, an independent Python
transcription of the Java (challenges `00..0F`, all zero, all `FF`), plus
further challenges run through the same script.

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
| config get `F3` / notify `F4` | 0x0B | `[target, level]` on a get; `[mode, level]` on a notify |
| config get / notify | 0x07 | EQ preset |

Battery byte: bits 0-6 level, bit 7 charging, `FF` absent, a level over 100
unknown. Slot order left, right, case: APK `BatteryInfoContainer.java:104-118`
and GB `decodeDeviceInfo`.

Earbud-initiated frames (`C0` / `C7`: `0E`, `F4`, `50`, `51`) must be answered
with a type-`04` frame carrying the same opcode and seq, empty payload unless
the step above says otherwise (WinMi test: `FEDCBA 04 0E 0002 00 FF EF`).

## 7. Model identification and gating

Info type 3 gives VID `0x2717` and a PID, matched against the live catalog
sample (`android-testing/xiaomi/samples/xiaomi_product_list.sample.json`, nine
products). An unknown PID still works: the Bluetooth name (info type 0) names
it. Gadgetbridge only knows models by name, so a small hint table keyed on the
name carries what its coordinators record: Redmi Buds 3 Pro offers only
Regular and Voice transparency and an Adaptive ANC strength; the `Active`
models have no noise control.

Everything else is probed rather than assumed: noise control exists when run
info reports type 9; strength when config `0x0B` answers; EQ when config
`0x07` answers; in-ear when run info reports type 10. Find is not probed
(it rings the earbuds), and is offered on every model.

## 8. Disagreements resolved

1. APK notes: feature channel is ZiMi vendor ops 81-86. Wrong for these
   earbuds: ZiMi is vendor `0x5A4D`; these are `0x2717` and use `F2/F3/F4` and `08`.
2. APK notes: gestures on config 83. Config 83 is a dongle; earbuds use
   config 2 (GB, APK `DeviceConfigClickSet.java:74`). Deferred, not wrong.
3. APK notes: ANC bit-packing for config 10. GB's observed values win.
4. Notes: "custom stream cipher". It is SAFER+, keyed by the challenge.
5. Run-info type 10 is "autoplay" in the notes and in-ear detection in GB;
   GB's reading is used. Hardware check wanted.
6. A config-get reply of `0x0B` carries a target, the notify carries the mode
   (WinMi `EarbudState.Apply`); they are folded differently.

## 9. Risks

- No hardware. Every layout rests on GB and WinMi, themselves ports of a
  single GB implementation for most models.
- Models differ in features; probing failures degrade to hidden controls.
- The earbuds must be paired with the OS for Chrome to list them; confirm the
  `fd2d` record is visible to Chrome on each platform.
- Find is not gated per model.
- A device that offers only `0x1101` (older Xiaomi-branded lines) is not
  claimed by this driver.
