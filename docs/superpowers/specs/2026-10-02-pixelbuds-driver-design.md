# Google Pixel Buds driver — design

Status: implemented v1, **no hardware test**. Pixel Buds Pro / Pro 2 only.

## 1. Sources and how they were cross-checked

| Short name | What it is |
|---|---|
| pbpctrl | `github.com/qzed/pbpctrl` (Rust; `libmaestro/`), the only complete community implementation; hardware-tested on Pixel Buds Pro |
| APK | the Pixel Buds companion app decompile, `android-testing/pixelbuds/jadx_out/sources/defpackage/` (obfuscated) |
| Notes | `android-testing/pixelbuds/PIXELBUDS_PROTOCOL_NOTES.md` (derived from the APK only) |
| MagicPodsCore | `steam3d/MagicPodsCore` PR #24, a second hand-rolled client, tested on a Pro 2 |

Precedence: a hardware-tested implementation (pbpctrl, MagicPodsCore) over the APK over the notes over other community write-ups.

## 2. Transport

The buds serve the "Maestro" protocol over Bluetooth Classic RFCOMM, discovered by SDP service class.

| Fact | Value | Source |
|---|---|---|
| Service UUID | `25e97ff7-24ce-4c4c-8951-f764a708f7b5` | pbpctrl `libmaestro/src/lib.rs:10`; APK `gpk.java:9,16`, `grz.java:11` |
| Byte-reversed alias | `b5f708a7-64f7-5189-4c4c-ce24f77fe925` (APK maps it to the above) | APK `gpk.java:17` |
| Legacy UUID | `3a046f6d-24d2-7655-6534-0d7ecb759709`, `[channel][subtype][len16 BE]` framing, battery only | APK only (`gpk.java:9`, `grp.java:119-160`). **Out of scope.** |
| Auth / handshake | none | pbpctrl `cli/src/bt.rs:37-90`, APK `gqp.java:63-73` |

This is the same shape as the Nothing and M4 drivers: one `KNOWN_SERVICES` entry, Web Serial, a non-standard service class.

## 3. Framing: HDLC unnumbered frames

```
7E | address (varint) | 03 | RpcPacket | CRC-32 (u32 LE) | 7E
```

* Escape: `7D` and `7E` in the body become `7D, byte ^ 0x20`. The CRC covers the **unescaped** address, control and data. APK `hcl.java:369-381`, `hmo.java:6-7`; pbpctrl `hdlc/encoder.rs:15-23,83-92`.
* CRC: plain CRC-32/IEEE (init `FFFFFFFF`, reflected, final NOT), little-endian on the wire. pbpctrl `hdlc/crc.rs` test `crc32("1234321") = d981751c`; decode check `hdlc/decoder.rs:147-149`.
* Address: `((src & 15) << 6) | ((dst & 15) << 10)`, written as a Pigweed HDLC varint: 7 data bits per byte, shifted left one, bit 0 set on the final byte. APK `gkn.java:144-169`; pbpctrl `protocol/addr.rs`, `hdlc/varint.rs:6-60`.
* Control is always `03` (U-frame). pbpctrl `protocol/codec.rs:46` drops anything else.
* Peers (`protocol/addr.rs`, APK `hmp.java:7-21`): Host 1, Case 2, LeftBtCore 3, RightBtCore 4, LeftSensorHub 5, RightSensorHub 6, MaestroA 10, MaestroB 13.
* We transmit with source MaestroA and the target chosen by the channel (pbpctrl `protocol/codec.rs:63-68`). On receive the address is ignored; the packet's `channel_id` is authoritative.

## 4. pw_rpc

`pw.rpc.packet.RpcPacket` (`libmaestro/proto/pw.rpc.packet.proto`):

| # | Field | Wire |
|---|---|---|
| 1 | type | varint: REQUEST 0, CLIENT_ERROR 4, RESPONSE 1, SERVER_ERROR 5, SERVER_STREAM 7 |
| 2 | channel_id | varint |
| 3 | service_id | fixed32 |
| 4 | method_id | fixed32 |
| 5 | payload | bytes |
| 6 | status | varint (pw_rpc `Status`: 0 OK, 2 UNKNOWN, 3 INVALID_ARGUMENT, 5 NOT_FOUND, 12 UNIMPLEMENTED, 14 UNAVAILABLE) |
| 7 | call_id | varint |

proto3 omits zero-valued fields, so a REQUEST with call id 0 carries neither `type` nor `call_id`.

**IDs** are `h = len; coef = 65599; for each byte b: h += coef * b; coef *= 65599` in wrapping u32 (APK `ono.java:124-133`; pbpctrl `pwrpc/id.rs`). Vectors from pbpctrl's tests: `maestro_pw.Maestro` = `0x7ede71ea`, `GetSoftwareInfo` = `0x7199fa44`, `SubscribeToSettingsChanges` = `0x2821adf5`. Computed by hash, never tabulated.

**Channels** are a fixed table, not negotiated (APK `gkr.java:134-148`, pbpctrl `protocol/addr.rs`):

| Local peer | Case | LeftBt | RightBt |
|---|---|---|---|
| MaestroA | 18 | 19 | 21 |
| MaestroB | 23 | 24 | 26 |

(Sensor-hub channels 20/22/25/27 exist but are never candidates.)

**Discovery** (pbpctrl `protocol/utils.rs:20-73`): the client opens, without transmitting, a pending `GetSoftwareInfo` call with call id `0xffffffff` on all six candidates; the buds push an unsolicited response on the channel they serve and the first to arrive wins. We do the same and treat *any* inbound packet on a candidate channel as the announcement. The fallback, which no source verifies, is to actively call `GetSoftwareInfo` on each candidate in turn if nothing is announced within a short wait.

Calls use call id 0 (pbpctrl), one unary call in flight at a time.

## 5. Services and messages (`maestro_pw.proto`)

| Service / method | Use |
|---|---|
| `maestro_pw.Maestro/GetSoftwareInfo` | `SoftwareInfo{firmware(4){case(1), right(2), left(3)}}`, each `FirmwareVersion{version_string(2)}` |
| `.../GetHardwareInfo` | `HardwareInfo{serial_number(7){case(1), right(2), left(3)}}` (strings) |
| `.../SubscribeRuntimeInfo` (server stream) | `RuntimeInfo{battery_info(6){case(1), left(2), right(3)}, placement(7){right_in_case(1), left_in_case(2)}}`; `DeviceBatteryInfo{level(1), state(2)}`; state 1 not charging, 2 charging |
| `.../ReadSetting` | `ReadSettingMsg{settings_id(4)}` returns `SettingsRsp{value(4)}` |
| `.../WriteSetting` | `WriteSettingMsg{setting(4)}`, a `SettingValue` |
| `.../SubscribeToSettingsChanges` (server stream) | `SettingsRsp` per change |

`SettingValue` is a oneof keyed by setting id, so a `false` bool is still written (`58 00`). Settings used:

| Id | Field | Type |
|---|---|---|
| 2 | `ohd_enable` (on-head detection) | bool |
| 11 | `multipoint_enable` | bool |
| 12 | `ancr_gesture_loop` | `{active(1), off(2), aware(3), adaptive(4)}` bools |
| 13 | `current_ancr_state` | enum: 1 Off, 2 Active, 3 Aware, 4 Adaptive (APK `sbr.java:6-10` agrees) |
| 15 | `volume_eq_enable` | bool |
| 16 | `current_user_eq` | `EqBands{low_bass(1), bass(2), mid(3), treble(4), upper_treble(5)}` fixed32 floats, ±6.0 dB; a zero band is omitted |

Several ids answer a read with status 2 (pbpctrl `maestro_pw.proto:125-135`); a failed read just means the control is not shown.

## 6. Disagreements between sources, and the ruling

1. **ANC transport.** `tedsluis/opencontrolpixelbudspro2` puts ANC on RFCOMM DLCI 0x04 / Fast Pair. pbpctrl (`cmd_anc_cycle`, `cli/src/main.rs:444`) and the APK (`sbr.java`, no Fast Pair wire code, Notes §5.2) make it Maestro setting 13. Maestro wins. Fast Pair only *notifies* ANC changes (pbpctrl `docs/Notes.md`).
2. **Channel ids.** Notes §2.4 says they "must be sniffed or negotiated". They are the static table above (APK `gkr.java:134-148`, pbpctrl `addr.rs`).
3. **DLCI claims.** The Notes rebut "DLCI 0x02/0x04/0x08"; current pbpctrl never claims them (that is tedsluis). Irrelevant to a browser, which sees one RFCOMM service.
4. **`SetWallclock` spelling.** APK `gsp.java:40` says `SetWallclock`; pbpctrl's proto says `SetWallClock`. The hash is case-sensitive; the APK is authoritative. Unused here.
5. **Battery.** The Notes' 5-byte battery parser (`gsf.c`) belongs to the *legacy* socket. Pigweed devices report battery in `RuntimeInfo`.
6. **Model identity.** No source gives an on-wire model id; the APK's `bud_type`/SKU are display-only and D2/D4/D5 are log prefixes. So the driver cannot tell Pro from Pro 2 and labels the device generically.

## 7. Scope

Implemented: firmware and serials; battery (case, left, right) with charging; bud-in-case placement; ANC read, write and live updates; multipoint; on-head detection; five-band EQ with an on/off switch for volume EQ; a protocol log with a read-only query box (`GetSoftwareInfo`, `GetHardwareInfo`, `ReadSetting <id>`).

Deferred: find-my-buds (Fast Pair GFPS, a separate RFCOMM service), gestures (setting 7), OTA, head-gesture/dosimeter/eartip services, the legacy UUID and A-Series / 2a (no evidence they speak Maestro), product artwork (placeholder only, no network).

## 8. Risks

* **Untested on hardware.** pbpctrl was tested on the Pro, MagicPodsCore on the Pro 2; nothing here has run on a buds.
* **Channel discovery** leans on the buds announcing themselves at connect. The active fallback is unverified.
* **One Maestro client at a time?** A phone running the Pixel Buds app may hold the link; MagicPods mentions case and role-handover behaviour.
* **Adaptive** is offered when the loop setting (12) reports it, when it is already the current state, or while the loop is unread; if a write is refused it is withdrawn for the session.
* The case battery is only known while a bud sits in the case (pbpctrl README).
