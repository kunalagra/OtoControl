# Samsung Galaxy Buds driver — design

Status: implemented, **not yet run against earbuds by us**. §11 separates what is backed by real-hardware captures and logs from what is read from code; the protocol log on the System tab exists so a tester can send back what the earbuds really say.

## 1. Scope

Galaxy Buds2 and later (Buds2, 2 Pro, FE, Core, Buds3, 3 Pro, 3 FE, Buds4, 4 Pro), plus Buds+, Live, Pro and the original 2019 Buds. One driver (`drivers/samsung/`, brand `samsung`, id `samsung`), Web Serial only (Bluetooth Classic RFCOMM). No GATT path: the vendor plugin has an LE one (`rn/j.java:24-30`) but nothing here needs it.

Features: battery L/R/case and charging, placement (in ear / out / in case), noise control (off / ANC / ambient, and adaptive where the model has it), ambient-sound level, EQ presets, touch lock, touch-and-hold actions (and, on the models whose layout is verified, which two noise modes a long press cycles through), find my earbuds, model, colour and firmware, product renders. Deferred: ambient extras (voice focus, ambient during calls), custom EQ curves, the Buds3-generation noise-cycle layout, firmware update, spatial audio.

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
- **Ear type.** `ExtendedStatus[1]` (GBC calls it `EarType`, "unused") differs per model within a service in every capture: Buds+ 0, Live 1, Pro 2 on standard SPP; Buds2 3, Buds2 Pro 4, FE 6, Buds3 Pro 8 on the custom one (§11.2). It names the model with no extra round trip, from the very first push; only these pairs are in the table.
- **SKU.** `DEBUG_SKU` (0x22): two 14-byte ASCII SKUs, matched by substring: `R170` Buds, `SM-R175` Buds+, `R180` Live, `R190` Pro, `R177` Buds2, `R510` Buds2 Pro, `R400N` FE, `R410` Core, `R530` Buds3, `R630` Buds3 Pro, `R420` Buds3 FE, `R540` Buds4, `R640` Buds4 Pro (GBC `Constants.cs:209-231`). Not supported by the 2019 Buds or Buds+ (GBC's own `scripts/DumpSKU.cs` refuses both). A SKU that matches wins over the ear type; an unrecognised one changes nothing.
- A model neither names is *unknown*: battery, wear and find only, no controls.
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
| 0x84 | tx | `[step]`, zero-based | ambient level; a Buds4 Pro's "Level 1-5" is 0-4 (GBC PR #722, hardware). Read from `ExtendedStatus[23]` (Pro and later) or `[9]` (Buds, Buds+) |
| 0x92 | tx | `[left, right]` hold actions (+2 zero bytes on Buds4/4 Pro, per the plugin `kk/f.java:66-71`) | read from the nibbles of `[11]` (`[13]` on Buds, Buds+); byte maps per model in `TOUCH_MAPS` |
| 0x79 | tx | `[anc, ambient, off]` flags for the left earbud then the right (one set before the model's dual-side revision) | read from `[21]`: bit 0 off, 1 ambient, 2 ANC; left = the same bits << 4. Offered for Pro, Buds2, Buds2 Pro, FE, Core only |
| 0x81 / 0x9B | rx | `[on]` | ambient (Buds, Buds+) / ANC (Live) changed on the earbuds |
| 0x88 | tx | `[1, 1, 34]` | manager info, GalaxyBudsClient's bytes. Sent **only** to earbuds that stay silent (§8) |
| 0x42 Ack | rx | `[request id, …]` | answers most writes |

Console on the System tab may send only reads: 0x22, 0x24, 0x26, 0x28, 0x29, 0x63.

## 6. Extended status layouts (0x61)

All share the prefix `[0]rev [1]earType [2]L [3]R [6]placement [7]case` (no case on the 2019 Buds). The fields this driver reads:

| Layout | Models | EQ | Touch lock | Noise |
|---|---|---|---|---|
| legacy | Buds | `[10]` enabled, `[11]` mode (0-4, 5-9 = same presets) | `[12]` | `[7]` ambient on/off |
| plus | Buds+ | `[11]` | `[12]` | `[8]` ambient on/off |
| live | Buds Live | `[9]` | `[10]` = 1 | `[12]` ANC on/off |
| pro | Buds Pro | `[9]` | `[10]` = 1 | `[12]` mode |
| modern | Buds2 and later | `[9]` | `[10]`: bits 0 hold, 1 triple, 2 double, 3 single, 4/5 call gestures, **7 = touch enabled** | `[12]` mode |

(GBC `ExtendedStatusUpdateDecoder.cs:203-545`.) Also read, per layout (all asserted in `fixtures.test.ts`):

| Field | Offset |
|---|---|
| hold actions, left nibble / right nibble | `[11]` (`[13]` on Buds, Buds+) |
| ambient step | `[9]` Buds, Buds+; `[23]` Pro and later; none on Live and Buds3 |
| colour id, int16 LE | `[14]` (`[15]` on Buds+); none on the 2019 Buds |
| noise-cycle bits (Pro, Buds2, Buds2 Pro, FE, Core) | `[21]` |

Everything is read with bounds checks: a field the buffer is too short to reach stays what it was. Fields past these vary by model and revision and are not read.

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

No authentication, and nothing needs sending: the earbuds push `0x60` and `0x61` on connect and again whenever something changes, and accept settings without any prior message (§11.1). The driver therefore:

1. Waits up to 1.5 s for the first `0x61`.
2. Sends nothing in reply to any push. (An earlier version echoed `0x61` and announced itself; no open-source client does either.)
3. Only if nothing was heard, sends `0x88` manager info once, as a nudge.
4. Reads SKU (not on the 2019 Buds), then version.

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

See §11.7 for the full list of what only hardware can settle. The ones most likely to bite:

- **Which RFCOMM record Chrome opens on 0x1101.** The Linux battery script finds the control channel among standard-SPP records *by service name* (`GEARMANAGER`), so Buds+/Live/Pro may expose more than one record with that class, and Web Serial picks by class id.
- Buds+/Live/Pro frames were captured at one revision each; other revisions may add or move fields past the ones read.
- Revision gates are GalaxyBudsClient's feature-rule minimum revisions.
- Buds3 and later: only one capture (Buds3 Pro); Buds4, Core, Buds3, Buds3 FE are the layout and nothing else.
- Product renders exist only for models Samsung still sells (§12).

## 11. Verification evidence

Labelled **[hw]** real-hardware capture or log, **[prod]** shipping software whose users exercise it on hardware, **[code]** read from source only.

### 11.1 Do the earbuds push 0x60/0x61 unprompted, and is a reply or manager-info needed? — **verified**
- [hw] GalaxyBuds-BatteryLevel (`buds_battery.py`) connects the RFCOMM channel and only reads; it prints battery and wear and, with `--monitor`, every later change. Its README lists Buds, Buds+, Live and Pro; GBC issue #8 shows its monitor output from real Buds+ and thread comments by the maintainer: "the Buds send status updates regularly to the client… Actively sending update requests is not necessary". https://github.com/ThePBone/GalaxyBuds-BatteryLevel/blob/master/buds_battery.py · https://github.com/timschneeb/GalaxyBudsClient/issues/8#issuecomment-653755066
- [hw] GalaxyBuds-rs `examples/receive.rs` (Buds+/Live/Pro/Buds2 Pro/Buds3 Pro model list) and its CLI LiveBudsCli (211 stars) connect and read with no handshake. https://github.com/JojiiOfficial/GalaxyBuds-rs · https://github.com/JojiiOfficial/LiveBudsCli
- [prod] MagicPodsCore opens the channel for every model and decodes the pushes for battery and ANC; it never sends manager info and never echoes (no `MANAGER_INFO` anywhere in `src/sdk/sgb`, `src/device`). https://github.com/steam3d/MagicPodsCore
- [hw] omarchy-buds' notes record a live SPP session against a Buds3 Pro that round-tripped `anc:anc / anc:off / anc:adaptive` through the same push-only channel. https://github.com/jzuijlek/omarchy-buds/blob/main/knowledge/spp-protocol.md
- [hw] gnome-shell-extension-anc (Buds FE tested): "on connect the buds push EXTENDED_STATUS_UPDATED"; a SET that changes something is answered by an ack, a no-op SET by a fresh `0x61` + `0x77` instead — so the client must not treat a missing ack as failure (it does not). https://github.com/snizovtsev/gnome-shell-extension-anc
- [code] The vendor plugin does echo `0x61` and send an init burst (`yn/b.java:392-441`); GBC replies manager info. Neither is needed for the pushes to continue, so the driver sends neither in the normal path.

**Result: corrected.** The first version echoed `0x61` and sent manager info on every connect; now nothing goes out unless the earbuds are silent.

### 11.2 Extended-status layouts per model and revision — **verified for seven models at one revision each**
- [hw] GBC keeps one real capture per model as test fixtures, with the decoded values its tests expect: Buds rev 3, Buds+ rev 13, Live rev 9, Pro rev 10, Buds2 rev 10, Buds2 Pro rev 13, FE rev 2. https://github.com/timschneeb/GalaxyBudsClient/tree/master/GalaxyBudsClient.Tests/TestData/ExtendedStatusUpdate · tests under `GalaxyBudsClient.Tests/<Model>/ExtendedStatusUpdateTests.cs`
- [hw] A Buds3 Pro rev 2 frame, in MagicPodsCore's `TestsSgb.cpp` (`TestExtract1`, `TestAnc1`–`TestAnc3`, `TestChecksum1`, `TestChecksum2`, `TestEncode1`) and read by omarchy-buds' live session.
- `drivers/samsung/fixtures.test.ts` embeds all eight and asserts, through the real deframer, every field the driver reads: battery L/R/case, placement, EQ, lock (including per-gesture bits), noise mode, ambient level, both hold actions, colour, both noise cycles. **Every offset in §6 matched on first run.** Notable confirmations: lock is `!bit 7` on Buds2-era (`0x3f` → locked, `0xbf` → unlocked); ANC mode at `[12]` (Buds3 Pro `[12]=2` → ambient in `TestAnc1`); colour ids 260/279/298/316/326/330/340 match the units; case byte 101 (Buds+) and 0 (FE) are "no reading".
- [prod] Charging offsets in `0x61` (`[36]` Buds2 ≥ rev 10, `[43]` Buds2 Pro ≥ rev 11 / FE / Core, `[42]` Buds3 and later) and `0x60[7]` for Buds2 and later are MagicPodsCore's `GalaxyBudsBatteryWatcher.cpp`. The driver reads `0x60[7]`.
- **Corrected:** a battery byte of 0 is now "unknown" (FE capture's case, MagicPodsCore's `Disconnected`), as is ≥101.
- **Correction to GBC's own spec table:** the Buds3 Pro capture has ambient level 4 where GBC's `MaximumAmbientVolume` says 2; Buds4 Pro is 0-4 (GBC PR #722). The driver allows the step the earbuds report above the table's top.
- **Still unverified:** other revisions of each model; Buds4, Core, Buds3, Buds3 FE (no capture, layout assumed identical to the Buds3 Pro's); anything past the fields read.

### 11.3 DEBUG_SKU and identifying a model on the shared port — **partly verified; mitigated**
- [code] 2 × 14 ASCII bytes: GBC `DebugSkuDecoder.cs` and, independently, GalaxyBuds-rs `src/message/debug.rs` (`Sku::new`: 0..14, 14..28). No capture of a reply was found.
- [code] GBC's `scripts/DumpSKU.cs` refuses Buds and Buds+ ("Unsupported device"); its protocol notes say a Buds+ returns zero-data "most of the time". PR #537 notes the hidden-command interface was "only tested on the Buds Pro".
- [hw] The ear-type byte (§4) is in every capture and differs per model, so identification no longer depends on the SKU read. The empty-SKU-means-Buds+ rule from the first version is gone.
- **Corrected:** model comes from SKU if it matches, else ear type (shared: 0/1/2, custom: 3/4/6/8), else unknown.
- **Still unverified:** the SKU reply bytes on any model; ear types of Buds2 FE-era siblings (Core, Buds3, Buds3 FE, Buds4, Buds4 Pro).

### 11.4 CRC on receive — **verified valid on all real frames; strict check kept**
- Every capture above (eight real frames, flag bytes `0x10`, `0x0c`, `0x00`, one legacy) passes CRC-16/XMODEM, low byte first, in this driver's deframer; so does MagicPodsCore's `TestChecksum1` (`CRC(frame minus SOM/header/EOM) == 0`). MagicPodsCore, GBC and gnome-shell-extension-anc all drop frames with a bad CRC in production without trouble. The plugin merely does not check.
- The header's flag bits are inconsistent between captures (`0x10`, `0x0c`, `0x00`, and `0xC0` in `TestAnc1`), so nothing depends on them; only the low 10 bits of the length are read.
- **Result: verified; no leniency added.** A bad-CRC frame is dropped, and the raw log still shows its bytes.

### 11.5 Find: 0xA6 vs 0xA0 per model — **unverifiable without hardware**
- [prod] 0xA0 (`FIND_MY_EARBUDS_START`) is what GalaxyBuds-rs/LiveBudsCli (Buds+, Live, Pro, Buds2 Pro) and Gadgetbridge send. https://github.com/JojiiOfficial/GalaxyBuds-rs/blob/main/examples/find_my_buds.rs
- [code] 0xA6 is `FIND_MY_EARBUDS_ON_WEARING_START`; GBC picks it when the model has `FmgRingWhileWearing` (Buds2 ≥ rev 9, Buds2 Pro ≥ rev 4, FE and later always), the Buds4 plugin always sends it (`zo/i.java:116`, `(byte)-90`). The notes' "0xA2" was an arithmetic slip (§7).
- Kept as is. If a modern model ignores 0xA6, 0xA0 is the fallback to try.

### 11.6 Other cross-checks
- Noise modes per model: MagicPodsCore `GetAncModesFor` (Buds3: off/ANC only; Buds Pro, 2, 2 Pro, FE, Core, 3 FE: off/ambient/ANC; Buds3 Pro, 4, 4 Pro: plus adaptive) — [prod], and adaptive on a Buds3 Pro by omarchy-buds [hw]. MelodyLink's catalog lists Buds3 as off/ANC too. Buds Live's ANC switch is `0x98` (GBC, Gadgetbridge, orbitBluetooth), not `0x78` — MagicPodsCore disabled Live because it used the wrong id.
- Touch-hold byte maps: read back from all seven captures (Volume 2 on Buds, Ambient 2 on Buds+, ANC 2 on Live, "switch noise control" 2 on Pro/Buds2/Buds2 Pro, Volume 3 on FE). The **Buds4 plugin numbers actions differently** (`fn/g.java:184-270`: volume 6, digital assistant 3), so Buds4 and 4 Pro offer only the two that agree and write four bytes.
- Noise-cycle bits `[21]`: verified on Pro, Buds2, Buds2 Pro, FE captures. GBC's Buds3-generation encoder (`AmbOff => [0 + 4]`) looks unfinished, and a Buds3 Pro capture reads `0xDD`, which the classic bits decode ambiguously — **not offered** there.

### 11.7 What only hardware can settle
- Whether Chrome's Web Serial reaches the control record on Buds+/Live/Pro (see §10).
- Hold-action and noise-cycle **writes** (`0x92`, `0x79`) and the ambient-level write (`0x84`): reads are verified, writes are GBC's bytes and the plugin's.
- 0xA6 vs 0xA0 per model.
- The SKU reply bytes, and the ear type of models never captured.
- Revisions other than the captured ones; Buds4, Core, Buds3, Buds3 FE.
- Which models stop pushing if a write arrives first (none reported).

## 12. Product renders

`scripts/gen-samsung-images.py` reads Samsung's storefront listing pages (US, UK, IN, DE, FR, AU, SG, AE) and keeps every gallery image whose path carries a Galaxy Buds SKU (`sm-r<model>nz<colour>a…`), keyed by model and the SKU's colour letter, with Samsung's own product slugs naming the finish where they can (`…-pink-gold-…-sm-r640nzd…`). Output: `images.generated.ts`, plain `images.samsung.com` URLs (650×519 transparent PNG), no credentials, no runtime vendor call. `colours.ts` maps the colour id the earbuds report (GBC `DeviceIds`) to a finish, with synonym groups (Apricot = "pink gold", Silver ≈ gray), and `samsungArtwork` falls back to the model's first render, then to the placeholder.

Coverage today: Buds3, Buds3 FE, Buds3 Pro, Buds4, Buds4 Pro, Buds Core. Samsung has delisted the product pages for Buds, Buds+, Live, Pro, Buds2, Buds2 Pro and FE (404), the archive copies load their images by script, and Samsung's product-search API refuses anonymous clients; those models show the placeholder. `docs/reference/samsung-images-extra.json` (optional, `{ "<modelId>": "<url>" | { "<colour>": "<url>" } }`) is merged over the scraped set the next time the script runs, for anyone who has a legitimate source.
