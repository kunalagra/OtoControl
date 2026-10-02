# Google Pixel Buds driver — design

Status: implemented, **no hardware test of this app**; protocol claims re-verified against third-party hardware logs in §9. Pixel Buds Pro / Pro 2 only.

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

**Discovery** (§9, 1): the buds push an unsolicited `GetSoftwareInfo` response (call id `0xffffffff`) on the channel they serve, 22-102 ms after the link opens, so the client just listens: *any* inbound packet on a candidate channel names the channel. If nothing arrives within 800 ms it asks, as MagicPodsCore and pb2pcd do on a Pro 2: `GetSoftwareInfo` with call id `0xffffffff` on channel 18, and takes the channel of whatever answers (the reply carries the buds' own channel, not the one asked on); then the bud channels 19, 21, 24, 26, then 23.

Calls use call id 0 (pbpctrl), one unary call in flight at a time.

## 5. Services and messages (`maestro_pw.proto`)

| Service / method | Use |
|---|---|
| `maestro_pw.Maestro/GetSoftwareInfo` | `SoftwareInfo{firmware(4){case(1), left(2), right(3)}, fixed64(5), varint(6)}`, each `FirmwareVersion{build(1), version_string(2)}` (pbpctrl lists right before left; the app disagrees, §9, 1) |
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
6. **Model identity.** No source gives an on-wire model id (§9, 2); the driver labels a pair "Pixel Buds Pro 2" only on proof of Adaptive, else "Pixel Buds Pro".

## 7. Scope

Implemented: per-model artwork bundled from the companion app's drawables (§9, 5); firmware and serials; battery (case, left, right) with charging; bud-in-case placement; ANC read, write and live updates; multipoint; on-head detection; five-band EQ with an on/off switch for volume EQ; a protocol log with a read-only query box (`GetSoftwareInfo`, `GetHardwareInfo`, `ReadSetting <id>`).

Deferred: find-my-buds (Fast Pair GFPS, a separate RFCOMM service), gestures (setting 7), OTA, head-gesture/dosimeter/eartip services, the legacy UUID and A-Series / 2a (no evidence they speak Maestro), 

## 8. Risks

* **Untested on hardware here.** pbpctrl was tested on the Pro, MagicPodsCore, pb2pcd and tedsluis on the Pro 2; §9 lists what is still unverifiable.
* **Pro vs Pro 2** is inferred only from Adaptive; a Pro 2 with no Adaptive evidence reads as "Pixel Buds Pro" and gets the Pro render.
* **The link is not exclusive and moves.** The buds close Maestro and re-announce on the other bud's channel when the hosting bud changes; a half-dead link follows a multipoint handoff. Both surface as a dropped session.
* The case battery is only known while a bud sits in the case (pbpctrl issue #19).

## 9. Verification evidence

Labels: **[HW]** a log or capture from real earbuds, **[static]** reading code or the APK, **[doc]** a vendor statement.

### 1. Channel discovery and the companion app's behaviour: verified, probe corrected

* **[HW] The buds announce unsolicited.** pbpctrl issue #8 (Pixel Buds Pro, firmware 5.9; <https://github.com/qzed/pbpctrl/issues/8>): pbpctrl only *opens* six pending calls (no transmit), and 24 ms later receives `type=0x01 channel_id=0x15 service=0x7ede71ea method=0x7199fa44 call_id=0xffffffff`; its first transmitted packet is the next call. Issue #7 shows the same line on channel 0x15 and a hang on firmware 5.9 until pbpctrl accepted call id `0xffffffff` (commit 7e75204, "firmware 5.9 returns a packet with call_id 0xffffffff"; before that the announcement carried call id 0, and pbpctrl never transmitted in either case).
* **[HW] Pro 2, 43 of 43 captures.** tedsluis/opencontrolpixelbudspro2 `PROTOCOL.md` §2.2a: the announcement (`call_id 0xFFFFFFFF`) arrives 22, 102, 30 and 58 ms after the RFCOMM open (btsnoop of the official app), and the phone's first request is a `ReadSetting` on the announced channel, so a fresh client needs no opening message. Channels seen: 19, 21, 24, 26, never 18 or 23. With only the left bud out of the case the buds announce 19, only the right 21 (7 of 7, CAP-065); on a change of the hosting bud they `DISC` Maestro and announce the other (CAP-066).
* **[HW] An active probe works on a Pro 2.** MagicPodsCore PR #24 (<https://github.com/steam3d/MagicPodsCore/pull/24>, tested on a Steam Deck with Pro 2): sends `GetSoftwareInfo`, call id `0xffffffff`, on channel 18 only, repeated every 300 ms ("the answer was measured taking up to 332 ms"), and takes the channel from the reply, "the buds answer with their own channel whichever one they are asked on" (`src/sdk/pbp/MaestroAddress.cpp`, `PixelBudsDevice.cpp`). Its test pins the byte-exact probe: `7e 00 2b 03 10 12 1d ea 71 de 7d 5e 25 44 fa 99 71 38 ff ff ff ff 0f c8 5e 0d 12 7e` (`src/tests/TestsPbp.cpp`, `TestChannelProbe1`). pb2pcd (Pro 2, macOS) probes all candidates with the same call id and keeps the first reply; PixelBudsMacOS probes sequentially (19, 24, 21, 26, 18, 23, 0.5 s each). BudsLink (googleBudsSocket.js) only listens for the `0xffffffff` response.
* **[static] The companion app** never probes: its channel is whatever the buds announce (tedsluis: 43 of 43 phone sessions use the announced channel). This driver does the same, listening first.
* **Corrected:** the old fallback tried 18, 19, 21, 23, 24, 26 with call id 0, waited per channel for a reply *on that channel*, and reported itself unverified. Now: call id `0xffffffff`, channel 18 first, any candidate-channel reply ends the wait.
* **[HW] Announcement payload**: `4:{1:{1:<build> 2:"release_5.203"} 2:{..} 3:{..}} 5:<fixed64> 6:<varint>` in 140 of 140 announcements (tedsluis §2.2a); the parser skips wire type 1 and a test pins the real layout.

### 2. Pro vs Pro 2: nothing reliable on the wire; inference by Adaptive only

* **[HW]** Pro 2 `GetHardwareInfo` carries only the three serials (`57071WRBEC0251`, `57081WRBDR2309`, `57071WRBDL3147`, tedsluis `PROTOCOL.md` §6, CAP-036 frame 1423); none of pbpctrl's `unknown*` ints appear. No public serial-prefix spec exists. All 573 announced firmware entries on the Pro 2 are `(1779298694, release_5.203)`; the entries do not differ per component.
* **[doc]** Firmware numbering overlaps in kind, not in value: Pro 2 4.467 / 5.203, Pro 2.12 / 3.14 / 5.9 / 5.11 (9to5Google, Android Authority release coverage). Too weak to gate on.
* **[HW]** Bluetooth class and name are the only separators other projects use (MagicPodsCore: class `0x244404` vs `0x240404`; PixelBudsMacOS: the name starts "Pixel Buds Pro 2", and says both report `0x240404`, so the two disagree). Web Serial exposes neither.
* **[HW] Fast Pair Model ID** on the *other* RFCOMM service (`df21fe2c-...`, GFPS Message Stream) is `da 2d b1` on the Pro 2 in every capture (tedsluis §0.1). Reliable, but needs a second port grant; not done.
* **[static]** The app's SKU table keys colours by device type (`jmx`, `hqh`), but the SKU is not in `GetHardwareInfo` or the announcement.
* **Implemented:** `info.model` is "Pixel Buds Pro" and becomes "Pixel Buds Pro 2" once Adaptive is the current mode or ticked in the long-press loop (Adaptive is Pro 2 only, §9, 4).

### 3. Request encoding, single client, stream cancel, case battery

* **Omitted zero `type` and `call_id`: verified [HW].** pbpctrl's frames (prost, `type` and `call_id` zero) work on the Pro and the Pro 2 (issue #19 reporter, Pro 2); tedsluis: "`type` is omitted for a REQUEST" in the official app's own frames; MagicPodsCore's captured probe omits `type`. Call ids 1, 2, 3... (BudsLink, MagicPods) also work, so ids are not checked for value, and replies are matched on channel + method.
* **One runtime stream per channel [HW]** (PixelBudsMacOS `ARCHITECTURE.md`: a second `SubscribeRuntimeInfo` ended the first about 260 ms later and forced a reconnect every 30 s). **Corrected:** `refresh()` re-subscribed; it now subscribes once per link.
* **Cancel on teardown [HW]:** pbpctrl's trace sends `CLIENT_ERROR status=1` per open stream when it terminates; `disconnect()` does the same. A dropped link cannot carry one; the streams die with the RFCOMM session.
* **Single Maestro client: partly unverified.** The phone and a desktop client coexisted in pbpctrl and MagicPods use, but the buds move/close Maestro when the hosting bud changes (tedsluis CAP-065/066), and after a multipoint handoff the link goes half-dead for writes (PixelBudsMacOS, ~75 s hang); MagicPods reconnects and re-resolves after a role handover. This app treats both as a dropped session.
* **FAILED_PRECONDITION (9) on a write [HW]** is what the buds answer when not in the ears (PixelBudsMacOS). **Corrected:** that no longer withdraws Adaptive for the session; it reports "put them in your ears".
* **Case battery [HW]:** runtime info omits the case cell when no bud is in the case (pbpctrl issue #19: "the standard maestro response still returns `null` when the buds are out of the case"; the phone reads it elsewhere). The decoder already reports only present cells.
* **Firmware entry order [static], corrected:** pbpctrl's proto says case, right, left ("order might not be correct"); the companion app's `OtaFragment` shows entry 1 as the Case, 2 the Left, 3 the Right (local APK `iea`/`idv`/`gqh.d`, tedsluis' smali trace of a second APK build). The decoder now reads 2 as left, 3 as right. Serials keep case, right, left (the `EC`/`DR`/`DL` letters in the Pro 2 serials agree; not proven).

### 4. Adaptive ANC

* **[doc]** Adaptive Audio arrived on the Pixel Buds Pro 2 with firmware 4.467 (Sept 2025); the original Pro's updates (5.9, 5.11) list conversation detection and hearing wellness, not Adaptive. pbpctrl issue #19 (a Pro 2 user) shows `get anc` returning `unknown (4)` on 4.467. MagicPodsCore and PixelBudsMacOS both show Adaptive on the Pro 2 only.
* **[HW]** tedsluis reads loop `4:{12:{1:1 2:1 3:0 4:1}}`: the long-press loop is user-togglable and can leave Adaptive out while Adaptive stays selectable in the app.
* **Corrected:** Adaptive was hidden whenever the loop read without it. It is now offered unless a write was refused as unsupported (status other than 9); the loop only feeds Pro 2 evidence.

### 5. Artwork

* Google no longer lists the Pixel Buds Pro in the Store (its URL redirects to the Pro 2), the Pro 2's Store gallery is JPEGs with a baked-in background behind content-hash `lh3.googleusercontent.com` URLs, and the APK references no image CDN (`PrestoOta__download_url` is an OTA bundle base). The app's drawables `budtype_4_*` (Pro: carbon, fog, limoncello, real_red) and `budtype_6_*` (Pro 2: dark_haze, mojito, porcelain_white, raspberry, sterling) are transparent earbud renders, so they are bundled by `scripts/gen-pixelbuds-artwork.py` into `public/devices/pixelbuds/` with `pixelbudsCatalog.generated.ts`. Colour and SKU are not on the wire, so each model shows a default colour. The colour names in the script are my mapping from the APK's drawable names.

### Still unverifiable without hardware

* That an active probe wakes a *Pro (1)* the same way (only Pro 2 probes are documented).
* Whether any Pro firmware announces with call id 0 rather than `0xffffffff` (pre-5.9; the client accepts both).
* Whether a Pro (1) rejects Adaptive writes, and with which status.
* Firmware entry order on a pair whose parts differ (all captured values are identical).
* The serial order case/right/left.
* Behaviour with the phone's Pixel Buds app holding Maestro at the same time.
* That Web Serial's RFCOMM bridge delivers the announcement within the 800 ms wait.
