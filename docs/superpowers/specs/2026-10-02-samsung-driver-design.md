# Samsung Galaxy Buds driver — design

Status: implemented on `feat/samsung-driver`, **not yet tested against hardware**. Everything below is read from source; the protocol log on the System tab exists so a tester can send back what the earbuds really say.

## 1. Scope

Galaxy Buds2 and later (Buds2, 2 Pro, FE, Core, Buds3, 3 Pro, 3 FE, Buds4, 4 Pro), plus Buds+, Live, Pro and the original 2019 Buds. One driver (`drivers/samsung/`, brand `samsung`, id `samsung`), Web Serial only (Bluetooth Classic RFCOMM). No GATT path: the vendor plugin has an LE one (`rn/j.java:24-30`) but nothing here needs it.

Features: battery L/R/case and charging, placement (in ear / out / in case), noise control, EQ presets, touch lock, find my earbuds, model and firmware. Deferred: touch-and-hold actions, ambient level, adaptive mode, custom EQ curves, firmware update, spatial audio, per-model artwork.

## 2. Sources, and who wins

| Source | Used for |
|---|---|
| GalaxyBudsClient (`ThePBone/GalaxyBudsClient`, C#) — the reference | framing, ids, decoders, model table |
| Vendor plugin `com.samsung.accessory.budsunitemgr` 9.0.10 (jadx) | cross-check of framing, ids, the handshake |
| Gadgetbridge `devices/galaxy_buds` | weakest; only for corroboration |
| `android-testing/samsung_plugin/SAMSUNG_PROTOCOL_NOTES.md` | starting point, partly wrong (§7) |

Where they disagree, GalaxyBudsClient wins, because it is the only one that was run against all of these models; the plugin wins on anything it states directly and GalaxyBudsClient does not.

## 3. Transport and frame

| Family | SDP service class | Framing | Source |
|---|---|---|---|
| Buds2 and later | `2e73a4ad-332d-41fc-90e2-16bef06523f2` | FD…DD | GBC `Model/Constants.cs:18`, `Buds2DeviceSpec.cs:47`; plugin `lk/e.java:530,552,581` |
| Buds+, Live, Pro | standard SPP `00001101-…` | FD…DD | GBC `BudsPlusDeviceSpec.cs:36`, `BudsLiveDeviceSpec.cs:38`, `BudsProDeviceSpec.cs:47` |
| Buds (2019) | `00001102-0000-1000-8000-00805f9b34fd` | FE…EE | GBC `Constants.cs:16`, `BudsDeviceSpec.cs:23,30,42` |

```
standard:  FD | len(2, LE; low 10 bits) | id | payload | crc(2, LE) | DD      len = 1 + payload + 2
legacy:    FE | type(1) | len(1)        | id | payload | crc(2, LE) | EE
```

- A frame is `len + 4` bytes. Header high byte: bit 0x10 response, bit 0x20 fragment (GBC `SppMessage.cs:86-98,140-143`; plugin `un/a.java:23-36`).
- CRC-16/XMODEM (poly 0x1021, init 0) over `id | payload`, low byte first (GBC `Utils/Crc16.cs`; plugin `un/a.java:42-48`). The vendor app never checks it on receive; this driver does, and drops a frame that fails. A fixture from GBC's own comment (`61 02 00 4B … 13` → `0F F3`) is in the tests.
- The phone sends requests with the response bit clear; it sets it only when echoing a push.

The plugin's `B4A9D6A0-…` (`on/i.java:93`) is a separate Bixby audio connection, not the control channel.

## 4. Identification

Chrome gives a port's service class and nothing else (`port.getInfo()`, `core/knownDevices.ts`) — no name, no address, no device-id UUID — so GBC's name and SDP-id lookups (`DeviceSpecHelper.cs`) are unavailable. The model comes in-band:

- Legacy service ⇒ Galaxy Buds. No SKU read.
- Otherwise read `DEBUG_SKU` (0x22): two 14-byte ASCII SKUs. Match by substring: `R170` Buds, `SM-R175` Buds+, `R180` Live, `R190` Pro, `R177` Buds2, `R510` Buds2 Pro, `R400N` FE, `R410` Core, `R530` Buds3, `R630` Buds3 Pro, `R420` Buds3 FE, `R540` Buds4, `R640` Buds4 Pro (GBC `Constants.cs:209-231`).
- Buds+ has no SKU and answers with zeroes (GBC protocol notes). On the **shared** service an empty answer means Buds+. An unanswered read, or an unrecognised SKU, means *unknown*: battery, wear and find only, no controls.
- Because the 0x61 layout depends on the model, the last status payloads are kept and re-read when the model becomes known.

## 5. Messages

Ids agree between GBC (`SppMessageEnums.cs`) and the plugin (`kk/f.java`, `mi/i.java`) except where noted.

| Id | Dir | Payload | Notes |
|---|---|---|---|
| 0x60 Status | rx | `[rev, battL, battR, coupled, main, placement(hi=L, lo=R), battCase, chargeFlags]` | ≥101 = unknown. Placement 1 wearing, 2 out, 3 case, 4 closed case. Charge 0x10 L, 0x04 R, 0x01 case, read only where the model's `chargingFrom` revision allows. 2019 Buds: `[earType, L, R, coupled, main, wear]`, wear 0x10 L / 0x01 R. GBC `StatusUpdateDecoder.cs`; plugin `ar/a.java`, `yn/b.java:1263` |
| 0x61 Extended | rx | `[rev, earType, L, R, coupled, main, placement, case, …]` + per-model settings | §6 |
| 0x77 | rx | `[mode, wear?]` | noise mode changed on the buds |
| 0x78 | tx | `[0 off, 1 ANC, 2 ambient, 3 adaptive]` | Buds Pro and later |
| 0x98 | tx | `[on]` | Buds Live's ANC (Gadgetbridge `:95`; GBC `NoiseControlPageViewModel.cs`) |
| 0x80 | tx | `[on]` | ambient, Buds and Buds+ |
| 0x86 | tx | `[0 off, preset+1]`; 2019 Buds `[enabled, preset+5]` | presets: Bass boost, Soft, Dynamic, Clear, Treble boost; 6 = custom (read only). GBC `SetEqualizerEncoder.cs`; plugin 0x86 `[preset]` agrees |
| 0x90 | tx | older: `[locked]`; Buds2-era: `[!locked, single, double, triple, hold, (doubleCalls, holdCalls)]` | the block restates every gesture, so they are sent back as last read. GBC `LockTouchpadEncoder.cs`, `TouchpadPageViewModel.cs:120-140` |
| 0xA6 / 0xA0 / 0xA1 | tx | none | find: 0xA6 where an earbud can ring while worn, else 0xA0; 0xA1 stops. 0xA1 also arrives unprompted |
| 0x22 | req | none → 28 bytes | SKU |
| 0x63 | req | none → `[hwL, hwR, swL(3), swR(3), touchL, touchR]` | firmware; the build id (`R510XXE0ARF4`) is reassembled client-side from date-coded bytes (GBC `DebugModeVersionDecoder.cs:38-52`) |
| 0x88 | tx | `[1, 2, 34]` | manager info: client 1, "not a Samsung phone" 2, SDK 34 (plugin `yn/b.java:428-432`) |
| 0x42 Ack | rx | `[request id, …]` | answers most writes |

Console on the System tab may send only reads: 0x22, 0x24, 0x26, 0x28, 0x29, 0x63.

## 6. Extended status layouts (0x61)

All share the prefix `[0]rev [2]L [3]R [6]placement [7]case` (not `[7]` on the 2019 Buds). The fields this driver reads:

| Layout | Models | EQ | Touch lock | Noise |
|---|---|---|---|---|
| legacy | Buds | `[10]` enabled, `[11]` mode (0-4, 5-9 = same presets) | `[12]` | `[7]` ambient on/off |
| plus | Buds+ | `[11]` | `[12]` | `[8]` ambient on/off |
| live | Buds Live | `[9]` | `[10]` = 1 | `[12]` ANC on/off |
| pro | Buds Pro | `[9]` | `[10]` = 1 | `[12]` mode |
| modern | Buds2 and later | `[9]` | `[10]`: bits 0 hold, 1 triple, 2 double, 3 single, 4/5 call gestures, **7 = touch enabled** | `[12]` mode |

(GBC `ExtendedStatusUpdateDecoder.cs:203-545`.) Everything is read with bounds checks: a field the buffer is too short to reach stays what it was. Fields past `[12]` vary by model and revision and are not read.

## 7. Disagreements resolved

| Claim | Verdict |
|---|---|
| Notes: "FE…EE is refuted" | Wrong. FD…DD is every model but the 2019 Buds; GBC supports both (`SppMessageEnums.cs:292-295`). The plugin has no 2019 Buds. |
| Notes: control UUID `B4A9D6A0-…` | Wrong socket (Bixby). Control is `2e73a4ad-…`. |
| Notes: find start `0xA2` | Wrong: `(byte)-90` is 0xA6 (`zo/i.java:116`); 0xA2 is mute-earbud. GBC agrees. |
| Notes: 0x61 is 2 bytes | Wrong. The plugin's `e()` is an empty jadx stub, but its own state log lists every setting; GBC decodes dozens of bytes. |
| Notes: 0x91 locks the touchpads | 0x90 does on every model but Buds4; 0x91 is `TOUCH_UPDATED` inbound (GBC). The plugin sends `[locked]` on 0x91 for Buds4 only. 0x90 is used. |
| Gadgetbridge: 0x1101 for Buds2+ | GBC and the plugin both use `2e73a4ad-…`. |
| Gadgetbridge: find start 0xA0 | Correct for models without ring-while-worn; GBC picks per model. |
| Gadgetbridge: length excludes id and CRC | Wrong (`GalaxyBudsProtocol.java:200-210`). |

## 8. Handshake

No authentication. The earbuds push `0x60` and `0x61` on connect. The driver waits for the first `0x61` (or 1.5 s), then:

1. Echoes each `0x61` as a response-type frame `[0]` (plugin `yn/b.java:392-420`; GBC's notes say the same for 0x60 too, the plugin does not — only 0x61 is echoed).
2. Sends `0x88` manager info once per link.
3. Reads SKU, then version.

If the earbuds stay silent, manager info is sent anyway after the wait.

## 9. Shared standard-SPP service (Buds+ / Live / Pro)

**Why this needs a core change.** Buds+/Live/Pro expose only `00001101`, which has been owned outright by HeyMelody (`generic: true`) because realme TL models connect there. A UUID cannot choose the driver. Options rejected: claiming 0x1101 for Samsung too (the first match wins and the other driver never runs); a manual "this is a Samsung" picker (the user cannot know which they have bought into).

**Design.** `KnownService.candidates` lists the brands that can be behind a generic service, most likely first (`['heymelody', 'samsung']`). A driver lists such services as `sharedServices` (not `services`, so a service still has exactly one owner), and supplies a `probe`. `driversForService(uuid)` returns the candidates in order. `core/identify.ts` does the rest:

1. Open the port once (`identifyOnPort`).
2. **Listen** for 1.2 s. Galaxy Buds push a status unprompted; a whole `FD…DD` frame with a valid CRC ⇒ Samsung.
3. **Ask** each candidate's own harmless read in turn, 1 s each: HeyMelody `0x0100` (AA-framed; a `0x8100` reply ⇒ HeyMelody), then Samsung `DEBUG_SKU`.
4. Hand the **same open transport** to the winner (`adoptTransport`). `HandoffTransport` replays what was heard — after the adopter has built its client, with live data queued behind the replay — and forwards a close that happened in between. No close and reopen.
5. Nothing recognised, or the listen failed: the port goes to the first candidate exactly as before (HeyMelody's own `adoptPort` / `adoptTransport`, which reports "not a HeyMelody device" itself). HeyMelody on its own UUIDs is untouched.

The identified driver is remembered per service (`knownDevices.identifiedDriver`) for labels and cache restore, and asked first next time; it is never trusted without listening. Snapshots on a generic service are keyed `uuid#driverId`, so one driver's cache is never offered to the other.

**Risks.** Every connect to a 0x1101 port now costs up to 1.2 s of listening before a HeyMelody query is sent (less for a remembered HeyMelody: its query goes first). A HeyMelody device whose firmware ignores `0x0100` is still handed to HeyMelody by the fallback. Galaxy Buds that push nothing and ignore `DEBUG_SKU` would be given to HeyMelody, which then releases the port with its error. A CRC match on foreign bytes is 1 in 65536 per candidate frame.

## 10. Risks and unknowns

- **Never run on hardware.** The riskiest assumptions: that the earbuds push `0x60`/`0x61` unprompted (GBC relies on it); that the CRC is checked correctly on receive (a mismatch would drop every frame — the raw log still shows them); the SKU patterns; and every per-model offset in §6.
- Buds+ identification is a default for "SKU read answered with nothing" on the shared service; a Live or Pro whose SKU read fails would be shown as unknown, not as a Buds+.
- `0x91` (touch-updated) is ignored; lock state comes from `0x61` and the optimistic write.
- Revision gates (`advancedLockFrom`, `lockCallsFrom`, `ringWhileWearingFrom`, `chargingFrom`) are GBC's feature-rule minimum revisions, unverified.
- No artwork is bundled and none is fetched; every model gets the placeholder frame.
