# HeyMelody driver: full TL-protocol support for OPPO, OnePlus and realme

**Date:** 2026-09-27
**Status:** approved in conversation (three design sections), awaiting spec review
**Supersedes, where they conflict:** `2026-08-27-heymelody-driver-design.md`

Brings the HeyMelody driver from "battery, ANC readout, EQ preset" to every
feature whose wire format the vendor apps document byte-for-byte, and aligns
the transport with the vendors' own code. One driver serves OPPO, OnePlus and
realme: realme Link ships a fork of the same BBK btsdk (the "TL" protocol), so
the wire format is shared.

---

## 1. Scope

The work was decomposed into five sub-projects; this spec covers the first two.

| # | Sub-project | In this spec |
|---|---|---|
| 1 | Foundations & alignment | yes |
| 2 | Documented features | yes |
| 3 | Features without documented byte layouts (key functions, feature toggles, spatial audio values, auto power-off, volume limit, multi-connect, hearing enhancement, bass engine, …) | no — needs further reverse-engineering first |
| 4 | realme `VENDOR_WM` protocol (Buds Q/Qs/Q2/Q2 Neo, DIZO GoPods D, Buds Wireless Pro) | no — own spec |
| 5 | realme `VENDOR_LD` protocol (Buds Air, Air Neo) | no — own spec |

### Success criteria

1. Every feature in §4 works against a fake transport built from the vendor
   byte layouts, with tests citing the source file and line.
2. The driver only offers what the device's own capability bitmap reports; a
   device that does not answer the bitmap still gets today's battery/ANC/EQ.
3. A beta tester with a realme Buds Air6 Pro can confirm: battery, in-ear
   status and firmware version appear; noise modes are named and switchable;
   EQ presets switch and the custom curve writes; find-my-earbuds rings and
   stops. (No hardware is available to the implementer.)

### Sources of truth

The vendor apps' own code is ground truth, in this order where they differ:

1. realme Link 5.5.514 (`com.realme.link`, its `realmeHeadset` feature)
2. HeyMelody 116.9.0 (`com.heytap.headset`)

Citations name the vendor class and method (e.g. `PollCommandManager.W()`).

Third-party reimplementations (OppoPodsManager, OppoPods) are GPL and remain
read-only cross-references, never ported.

---

## 2. Transport alignment

### 2.1 Link frame

```
AA | LEN (1–2 byte varint) | CTRL | 00 | [frame counter, only when FSN != 0] | chunk
```

- `CTRL` bits 0–1 are the frame sequence number (FSN): `0` single, `1` first,
  `2` middle, `3` last (`OPPOv1Wrapper.java:269-326`). Bits 2–3 are never set by
  the app and are ignored on receive.
- The decoder reassembles an FSN 1→2…→3 run into one buffer, then parses the
  inner packet `cmd(2, LE) | seq(1) | payLen(2, LE) | payload`. A run broken by
  a new FSN 1 or FSN 0 frame is discarded.
- Maximum frame length rises from 512 to 2000 (`OPPOv1Wrapper.java:29-31`).
- Outgoing requests remain single-frame (`CTRL = 0`): every request this spec
  sends is far below one frame.
- `seq` becomes a per-client counter over the full `0x00–0xFF`, wrapping
  `255 → 0` (HeyTap `PacketFactory`, `p072f7/b.java:26-45`), replacing the
  refuted `0x01–0xFE`.

To confirm from source during planning: whether the frame counter precedes the
chunk on every non-single frame, and whether the inner packet header appears
only in the first chunk (`TLVDataProcesser.h()`, `OPPOv1Wrapper.f()/i()`).

### 2.2 Service routing

`KNOWN_SERVICES` gains the standard SPP UUID `00001101-0000-1000-8000-00805f9b34fb`
for the `heymelody` brand, alongside `0000079a-d102-11e1-9b23-00025b00a5a5`.
realme's catalog marks most TL models `TYPE_DEFAULT` (standard SPP), so
without it those models cannot connect: `driverForService` returns null and
`connect()` silently does nothing.

Web Serial exposes no device name, so a standard-SPP port cannot be identified
up front. The identity handshake decides instead: if neither `0x0100` nor
`0x0103` answers, the device ends connected-but-unidentified with the error
"This does not look like a HeyMelody or realme device." No other driver uses
the standard SPP UUID, so no routing conflict exists.

---

## 3. Capability model and connect sequence

### 3.1 Connect sequence (`device.ts`)

1. Notification handshake — `0x0200` query then `0x0205` subscribe, as today.
2. Bootstrap, always allowed (`Protocol.c2`): `0x0100` capability bitmap,
   `0x0103` productId, `0x010B` colour.
3. Poll only what the bitmap reports (table in §3.2).
4. Fallback: if `0x0100` is unanswered or its status is non-zero, probe
   battery, ANC and EQ exactly as today. Features that cannot be probed
   without side effects — find-my-earbuds, custom EQ writes — stay hidden.

No failure in steps 2–4 fails the connect; each is logged and the feature is
treated as absent.

### 3.2 Capability bitmap

`0x0100` → `[status][bitmap…]`, LSB-first, bit *n* = row *n* of `Protocol.b2`
(`Protocol.java:179`, 61 rows, resolved 2026-09-27). Rows this spec uses:

| Bit | Commands | Feature key |
|---|---|---|
| 0 | `0x0105` | `version` |
| 1 | `0x0106` | `battery` |
| 4 | `0x0109` | `wear` |
| 5 | `0x0400` | `find` |
| 8 | `0x010C`, `0x0404` | `anc` |
| 10 | `0x0406`, `0x010F` | `eq` |
| 34 | `0x0122`, `0x0418` | `eqCustom` |

The full 61-row table is kept in the protocol module so later sub-projects
can use it without re-deriving it. `HeyMelodyCapability` becomes the union of
the feature keys above; `capabilities` stays a `Set` in state and an array in
the durable snapshot.

### 3.3 Pushes

| Command | Event | Handling |
|---|---|---|
| `0x0204` | `0x01` battery | replace `battery` |
| `0x0204` | `0x02` wear | replace `wear` |
| `0x0204` | `0x03` ANC | existing `applyAncEvent` (2- and 3-byte forms) |
| `0x0504` | current EQ id | set `eqCurrentPreset` |
| `0x0506` | full custom EQ | replace the matching preset in `eqPresets` (layout of `0x0122` without the status byte) |

`0x05xx` frames arrive unsolicited (`TLHeadsetConnectionImp.java:1642-1668`
routes `0x0500` → request) and are dispatched through the client's
notification listeners like `0x0204`.

---

## 4. Features

### 4.1 Identity

- **Firmware version** — `0x0105` → `[status][count][csv…]` → `VersionInfo`.
  Exact csv split to confirm from `PollCommandManager:971-988`. Shown in System.
- **Colour** — already implemented (`0x010B` → `[status][colorId]`), now
  polled as part of the bootstrap.

### 4.2 Battery

Unchanged decoder (`[status][count][type, packed]…`), now also refreshed by
the `0x0204` event `0x01` push.

### 4.3 In-ear status

`0x0109` → `[status][count][type, flags]…` (`CommandUtil.f()`, `StatusInfo`).
`flags` bit 0 = in-box **active low** (set = not in box), bit 1 = in-ear
(active high), bit 2 = unnamed, active low, not surfaced. State gains
`wear: { device, inEar, inBox }[]` — live-only like `battery`, never
persisted, reset on disconnect. System shows "In ear" / "In case" on each
battery row. `driver.worn` returns true when any bud is in-ear, or when wear
is unknown (the interface's own contract), so the artwork dims only on a
known "not worn".

### 4.4 Find my earbuds

`0x0400` request `[0x01]` start / `[0x00]` stop, ack `0x8400 [status]`
(`SetCommandManager:499-511`). Only offered when bit 5 is set. System gets a
card with a Start/Stop ringing button and the line "Remove the earbuds before
ringing them." State `finding: boolean` is live-only (never persisted) and
resets on disconnect.

### 4.5 Noise control

- **Read** — as implemented (`0x010C` `{1,1}` → `[status][action][type][value]`).
- **realme mode names** — realme Link's own mapping (`ItemFactory.java:747-765`):
  `ITEM_NOISE_REDUCTION` → value `1` (bit 0), `ITEM_NOISE_NORMAL`/`CLOSE` →
  `2` (bit 1), `ITEM_NOISE_TRANSPARENT` → `4` (bit 2). The strength
  sub-levels (values `8/16/32`; `ITEM_{SMART,DEEP,MEDIUM,LIGHT}_REDUCTION`,
  `ITEM_NOISE_LEVEL_{STRONG,WEAK}`) are traced during planning. Which items a
  model offers comes from its bundled `headsetRusConfig` feature tree,
  mirrored into `docs/reference/realme-models.json` and generated into the
  catalog like `heymelody-anc-modes.json`.
- **OPPO/OnePlus** — keep `ancModel.ts` over the HeyTap whitelist data.
- **Neither source** — raw index, read-only, as today.
- **Write** — `0x0404 [0x01, 0x01, bitmask]`, already byte-identical to
  realme's `{deviceType, mode, level}` for bits 0–7 (`SetCommandManager:62-79`).

### 4.6 EQ

- Preset list, current preset and preset selection — as today.
- **Custom curve editor** (only when `eqCustom`): for the custom preset, one
  slider per band, labelled by frequency, bounded by that preset's
  `minValue`/`maxValue`. Writes `0x0418`
  `[action][min][max][eqId][nameLen][name UTF-8][bandCount][freq(2, LE), gain]…`,
  debounced ~300 ms after the last change. Ack `0x8418 [status][eqId]`.
- To confirm from source during planning: how the app identifies the editable
  preset, and the values and meaning of the `action` byte.
- Follows `0x0504` / `0x0506` pushes (§3.3).

### 4.7 Writes, uniformly

Noise mode, EQ preset, EQ curve and find: optimistic patch, rolled back with
`state.error` set on failure or timeout — the pattern `setAncMode` and
`setEqPreset` already use.

---

## 5. Code structure

`commands.ts` splits into `src/drivers/heymelody/protocol/`:

| File | Contents |
|---|---|
| `cmd.ts` | command ids, `replyFor` |
| `status.ts` | shared status gate (missing or non-zero status fails, like `CommandUtil.n()`) |
| `capability.ts` | the 61-row table, bitmap decode, feature-key mapping |
| `identity.ts` | productId, colour, firmware version |
| `battery.ts` | battery decode |
| `wear.ts` | in-ear decode |
| `anc.ts` | ANC decode/encode, realme value names |
| `eq.ts` | `0x010F`, `0x0122`, `0x0418`, `0x0506` |
| `notify.ts` | notification-support handshake, `0x0204` event dispatch |

Each is pure encode/decode with its own test file. `device.ts` orchestrates
only; `state.ts` keeps state shape, durable split and push reducers.
`sppFrame.ts` and `client.ts` stay where they are.

---

## 6. Error handling

- One shared status gate for every status-prefixed reply.
- A reported feature whose query fails is logged and treated as absent — never
  rendered empty (the failure mode behind the 2026-09-27 battery bug).
- Unknown colour, noise value or preset: fall back (default render, raw mode
  number, preset name as sent), never guess.
- Connect never fails because of a feature query.

---

## 7. Testing

- **Protocol modules** — unit tests built from vendor byte layouts, each
  citing file and line.
- **Frame codec** — single, 2-part and 3-part frames; broken runs; junk
  resync; 2-byte lengths; `seq` wrap `255 → 0`.
- **Capability** — bitmap decode, table lookups, bootstrap set, fallback path.
- **Device** — fake-transport connects for a full-featured realme device, an
  OPPO device, and a device that ignores `0x0100`; pushes mid-session; each
  write's success and rollback.
- **UI** — run the app against a fake device and exercise every section;
  report plainly that real-hardware verification is pending the beta tester.
- `tsc -b`, `oxlint` and the full suite pass before each commit; commits only
  on the user's explicit go-ahead.

---

## 8. Open items resolved during planning (from vendor source)

1. Multi-frame layout: frame-counter position; inner header only in the first
   chunk or not.
2. `0x0105` version csv format.
3. Custom EQ preset identification; `0x0418` action byte values.
4. realme noise strength sub-level mapping (values `8/16/32`).
5. `0x0504` payload layout.
