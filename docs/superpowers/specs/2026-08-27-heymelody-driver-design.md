# HeyMelody driver: OPPO/realme/OnePlus earbuds, phase A (SPP transport)

**Date:** 2026-08-27
**Status:** proposed, awaiting spec review

A fifth `DeviceDriver` for the shared "HeyMelody" protocol (`com.heytap.headset`,
rebadged per brand across OPPO, realme and OnePlus), built entirely from
reverse-engineering — no hardware available yet. Phase A covers the classic
Bluetooth SPP/RFCOMM transport only; the BLE GATT fallback the vendor app also
supports is designed for, but not implemented, in this phase.

---

## 1. Background

OtoControl currently drives four single-transport manufacturers (Sennheiser,
Sony, Nothing over serial; Soundcore over GATT). HeyMelody is the first vendor
whose own app supports **two transports for one protocol** — classic SPP/RFCOMM
primary, BLE GATT fallback — which the existing `Adoptable` interface already
anticipates (`adoptPort` required, `adoptTransport` optional) but no driver has
yet exercised both sides of.

All protocol facts below come from a dedicated reverse-engineering pass in the
sibling `android-testing` repo (`heytap/HEYMELODY_PROTOCOL_NOTES.md`), which:

- Decompiled the official app (`com.heytap.headset` 116.9.0) with `jadx`/`apktool`
  — native Kotlin/Java, not packed, fully readable.
- Cross-referenced three independent open-source reimplementations of the OPPO
  protocol: `Zhaoyi-ya/OppoPodsManager` (C#), and its two credited ancestors,
  `Leaf-lsgtky/OppoPods` and `1812z/OppoPods` (Kotlin/Android). All three are
  GPL-3.0 (two by README assertion only, no LICENSE file; OppoPodsManager has a
  real one).
- Recovered a 137-device `productId → {brand, name, type}` catalog, cross-validated
  against an independently-decrypted 82-device subset of HeyTap's own bundled
  whitelist (81/82 overlap).

**Precedence rule** (already standing policy in this repo — `src/core/profiles.ts`
for BudsLink/Gadgetbridge/SoundcoreManager on Sony/Nothing/Soundcore): the
vendor's own app outranks every third-party reimplementation. All three
reference repos above are **read for cross-checking only — never ported or
copied**. Concretely, in this pass the APK directly overturned two of
OppoPodsManager's claims and left two gaps only the reference repos could
fill (all four in §3) — kept and labeled by exactly how each was established.

---

## 2. Goals / non-goals

**Goals (phase A):**
1. Identify a connected device (productId → catalog → brand/model/type) well
   enough to drive `hasDevice`/artwork/section-list, matching every other driver.
2. Determine capabilities **opportunistically**: try each read during refresh,
   tolerate failures, build `capabilities: Set<...>` from what actually
   answers — Nothing's driver already does exactly this in this codebase.
   *(Revised from the original plan of parsing `0x0100`'s coarse bitmap plus a
   `0x010D` batch probe: neither byte layout was ever transcribed — only that
   `0x0100` is `[status(1)][67-bit bitmap]` mapped through a bit-index→command
   table that was never captured, and `0x010D`'s reply shape wasn't captured
   at all. Rather than block on deriving those, phase A drops them and uses
   the same per-command probing this repo has already proven on Nothing.)*
3. Battery, ANC (read + live notifications + set mode), and EQ (read current
   preset, read the full preset/curve list, set preset) — landed together, not
   split into a narrower first slice.
4. Shape the frame/command layer so the BLE GATT codec is a drop-in addition
   later, not a redesign.

**Non-goals (phase A):** BLE GATT transport implementation (interface only);
find-my-earbuds, gesture/key mapping, multi-device connection list, spatial
audio, hearing enhancement (all real, all deferred — same incremental pattern
as Sony's pairing/speak-to-chat/voice-guidance landing as separate follow-ons);
per-model product artwork (137 devices across 3 brands have no bundled art in
this app — phase A ships one generic placeholder, real art is a separate,
later effort); the cloud whitelist/asset API (confirmed cosmetic-only, no
driver functionality depends on it).

---

## 3. Protocol facts for phase A

Every item below is labeled by how it was established, per this repo's own
convention for treating vendor-app evidence above third-party claims.

### 3.1 Transport (SPP only, this phase)

SPP service UUID `0000079A-D102-11E1-9B23-00025B00A5A5` — **confirmed**,
present on every catalog entry (`"supportSpp": true`). Adding it to
`KNOWN_SERVICES`/`requestPort()`'s allowlist is the entire transport-acquisition
change; Chrome's native Bluetooth-Classic-RFCOMM-over-Web-Serial support
(shipped Chrome 117, works without an OS-created serial device node) is exactly
what every existing serial driver already runs on.

A second UUID, `00001107-D102-11E1-9B23-00025B00A5A5`, appears in the app's own
code alongside the SPP one but is unidentified — not needed for phase A, noted
for completeness.

### 3.2 SPP frame format

```
0xAA | length-bytes(1-2, varint, continuation bit 0x80) | body...
  body = reserved(2, unidentified) | cmd(2, LE) | seq(1) | payLen(2, LE) | commandPayload(payLen)
```

- **Outer shell — confirmed directly from the APK** (`p206q7/a.java`, read loop
  `c()`): sync byte `0xAA`, then a variable-length field (not
  OppoPodsManager's fixed single byte — see disagreement below), then that many
  more bytes as the body. No checksum/CRC anywhere in the frame — confirmed,
  not an oversight.
- **Body layout (`cmd`/`seq`/`payLen` offsets, and the 2 reserved bytes ahead
  of them) — corroborated by three independent sources agreeing byte-for-byte**
  (OppoPodsManager, Leaf-lsgtky/OppoPods, 1812z/OppoPods each describe
  `0xAA|totalLen(1)|0x00 0x00|cmd(2,LE)|seq(1)|payLen(2,LE)|payload` — i.e. 2
  reserved/unidentified bytes immediately after the length field, then cmd),
  but **not independently re-traced inside the APK's own callback chain** (the
  APK hands the post-length body through several fan-out layers —
  `p194p7.c` → `p194p7.b` — before any per-field parsing was reached in the
  time available). Treated as a strong working assumption, not APK-verified
  fact; flagged as the first thing to re-check if request/response parsing
  misbehaves against real hardware. The reference sources only ever encountered
  a 1-byte length field, so their description implicitly assumes that case —
  applying it after *any* number of varint length bytes (rather than pinning
  `cmd` to one fixed absolute frame offset) is this driver's own
  generalisation, not something any reference source states explicitly.
- Response `cmd` = request `cmd | 0x8000`, on both transports.
- Max frame size 512 bytes (SPP); read buffer 990 bytes practical cap.

**Confirmed disagreement with OppoPodsManager:** the length field is a
1-2 byte varint (7 data bits per byte, MSB continuation flag), not
OppoPodsManager's fixed single byte. Reworking the notes' read-ahead-then-adjust
description into a direct length-prefix decode (verified equivalent): if the
first length byte has its continuation bit clear, the body length is that
byte's low 7 bits and the header is 2 bytes (`0xAA` + 1 length byte); if set, a
second length byte follows, the body length is the 14-bit little-endian value
across both bytes' low 7 bits, and the header is 3 bytes. Either way, **total
frame length = header length + body length**, body = everything after the
header. OppoPodsManager's fixed single byte happens to work for short packets
and silently breaks on anything needing the second length byte — it was
carried unchanged from `Leaf-lsgtky/OppoPods`'s original implementation and
never independently re-derived by any project in that lineage until this pass.
**Implement the varint form.**

**Sequence byte — our own choice, not inherited.** The APK's write path is an
abstract method in the decompiled code (not traced); the reference lineage is
split (`Leaf-lsgtky` auto-increments and wraps 0x01-0xFE; `1812z` and
OppoPodsManager both hardcode `0xF0`). Since this only needs to be internally
consistent for our own request/response matching, phase A uses an
**incrementing counter wrapping 0x01-0xFE** — it disambiguates overlapping
requests without depending on a fixed-value simplification no one has verified
against the device's actual write path.

### 3.3 GATT frame format — out of scope for phase A, interface reserved

OppoPodsManager claims `cmd(2,LE) | transId(1) | payLen(2,LE) | payload`, no
`0xAA` shell — **unverified against the APK** (the write plumbing was found,
`p182o7/i.java`, but not the packet builder feeding it — likely
`p182o7/d.java`'s command queue). Not implemented this phase; §4.1 defines the
interface seam it will implement into.

### 3.4 Commands (phase A subset)

| Command | Code | Confirmed by |
|---|---|---|
| Query product ID | `0x0103`→`0x8103` | APK (§3.5) |
| Battery | `0x0106`→`0x8106` | APK, byte-exact (§3.6) |
| Query current ANC (direct) | `0x010C`→`0x810C` | Command ID only — **response shape unconfirmed**, see risk in §6 |
| Query current EQ preset index | `0x010F`→response | APK, byte-exact — 2-byte response, just the active preset index (§3.6) |
| Query full EQ preset/curve list | `0x0122`→response | Cross-confirmed: structurally identical, independently, in both the APK's `CommandUtil.b()` and `1812z/OppoPods`'s `EqDetailsParser.parseAll()` (§3.6) |
| Set ANC mode | `0x0404` | Command ID only — **request payload shape not derived**, assumed symmetric to the read/notify DTOs in §3.6 pending verification, see §6 |
| Set EQ preset | `0x0406` | Command ID only — same caveat as above |
| Register for notifications | `0x0205` | APK |
| Unsolicited event notification | `0x0204` | APK, ANC sub-DTOs byte-exact (§3.6) |

`0x0100` (coarse capability bitmap) and `0x010D` (batch feature probe) are
**dropped from phase A** — see the capability model below. ~90 more commands
exist beyond that (spatial audio, hearing enhancement, gestures, multi-device,
etc.) — out of scope, see §2.

### 3.5 Identification & capability model

`productId`: 3-byte LE value, `0x0103`→`0x8103` response
`[status(1)][productId(3,LE)]`, formatted as 6-hex-digit uppercase (e.g.
`06F010`). Primary key into the 137-device catalog for brand/name/type —
**do not** infer brand from the productId's low byte: checked, it correlates
for some suffixes but is shared between OPPO and realme for others.

**Capability model: opportunistic probing, not bitmap parsing.** The notes
describe a three-step, fully-local, device-authoritative negotiation (coarse
bitmap → whitelist candidates → batch probe overrides), but neither the
bitmap's bit-index→command mapping nor the batch probe's reply shape was ever
captured — only that they exist and what role they play. Rather than block
implementation on deriving those, phase A uses the same opportunistic pattern
Nothing's driver already runs in this codebase: `refresh()` tries battery,
ANC-direct-query, and both EQ reads, tolerates each one failing/timing out
independently, and builds `state.capabilities: Set<'battery'|'anc'|'eq'>` from
whichever actually answered. `sections()` gates on that set the same way
Nothing's does. This is a deliberate, documented departure from the original
three-step model — not a silent gap.

### 3.6 Reply parsing — battery, ANC, EQ (all byte-exact from the APK)

**Battery** (`CommandUtil.d()`): `[count(1)][deviceType(1), packed(1)] × count`,
where `deviceType` 1/2/3 = Left/Right/Case, and `packed`'s low 7 bits are level
(0-100) with bit 7 the charging flag. **One canonical format** — confirmed
disagreement with OppoPodsManager, which claims a second, transport-dependent
fixed-offset format; the APK's parser does not branch on transport at all.
**Implement the APK's single format**; treat OppoPodsManager's alternate as an
unconfirmed hypothesis to test if real hardware ever disagrees.

**ANC** (`commands/g.java`, dispatched via the `0x0204` notification, outer
subtype 3, inner type byte selects one of three DTOs):
- Type 1, `CurrentNoiseModeInfo`: `mType(1)`; if 1, remaining bytes are a
  LSB-first bitmask of supported modes; if 2, a single `mLevel` byte follows.
- Type 2, `NoiseReductionInfo`: `mAction(1), mType(1), mValue(1-4, LE)`.
- Type 4, `IntelligentNoiseModeInfo`: `mType(1)`, same bitmask scheme as type 1
  when `mType==1`. **Cross-validated** — OppoPodsManager's own comment states
  this exact subtype mapping, confirmed verbatim by the APK.

`0x010C`'s direct-query response presumably carries one of these same DTOs but
this was not independently confirmed (only the notification dispatcher was
fully traced) — see risk in §6.

**EQ**: `0x010F` is a simple 2-byte "current preset index" response — separate
from and much simpler than the rich format below. `0x0122`
(`CommandUtil.b()`/"parseAllEqData"): `[count(1)]` then per preset:
`isSelected(1), minValue(1, signed), maxValue(1, signed), eqId(1),
nameLength(1), name(nameLength), frequencyNum(1)`, then per band:
`frequency(2, LE), dbValue(1, signed)`. Every preset carries a full per-band
curve, not just an index.

All multi-byte fields across all three are little-endian, confirmed via the
app's own generic byte reader used throughout this code path.

---

## 4. Architecture

### 4.1 Strategy, not runtime detection

Unlike the vendor app (which auto-detects RFCOMM-then-BLE), OtoControl's UI
already makes the transport choice explicit — "Connect over serial" and
"Connect over Bluetooth" land on different `Adoptable` methods. So what phase B
needs is a swappable **implementation choice at construction time**, not
runtime transport probing:

```ts
interface FrameCodec {
  encode(cmd: number, payload: number[]): Uint8Array
  createDecoder(): { push(chunk: Uint8Array): HeyMelodyFrame[] }
}
// HeyMelodyFrame = { cmd: number, payload: Uint8Array } — the shape both
// wire formats reduce to, regardless of shell.
```

`HeyMelodyClient` (request/response matching + notification dispatch, same job
every driver's `client.ts` already does) takes a `FrameCodec` in its
constructor instead of hardcoding a byte shell. `adoptPort` builds it with
`SppFrameCodec` (this phase's only implementation); `adoptTransport` in phase B
builds the identical client with a new `GattFrameCodec` — zero changes to
`client.ts` or `commands.ts`.

### 4.2 Module layout (mirrors Nothing's structure — single control transport,
SPP-primary)

```
src/drivers/heymelody/
  driver.ts          — descriptor: id 'heymelody', brand 'heymelody', services,
                        profiles, sections, components
  device.ts           — HeyMelodyDevice: composes DeviceSession + StateStore,
                        implements Persistable + Adoptable
  client.ts            — request/response + notification dispatch, takes a FrameCodec
  sppFrame.ts           — SppFrameCodec: 0xAA + varint-length shell (§3.2)
  commands.ts           — cmd IDs + encode/decode, transport-agnostic (§3.4)
  state.ts              — DeviceState, durable/live split, capability derivation
  catalog.generated.ts   — productId → {brand, name, type}, generated from the
                          137-device catalog already extracted in android-testing
                          (mirrors the existing `fetch-sony-catalog.py` →
                          `*.generated.ts` pattern)
  assets.ts              — artwork resolver: one generic placeholder for phase A
  sections/               — Noise.tsx, Sound.tsx, System.tsx
```

`gattFrame.ts` is phase B's one new file.

### 4.3 Naming

`brand: 'heymelody'`, `id: 'heymelody'` — no transport suffix (unlike
`'nothing-spp'`, which bakes in a transport restriction that's already gone
slightly stale for Nothing itself). OPPO/realme/OnePlus stay a **display-only**
distinction resolved per-device from the catalog, exactly like `state.info.model`
already carries the human-facing name for every other driver while `brand`/`id`
stay internal and singular.

### 4.4 State shape

Split follows the same durable/live convention every driver already uses
(`captureDurable`/`applyDurable`, gated by `StateStore.isUnread`):

- **Durable** (survives a disconnect, cached to local storage): `info`
  (productId, resolved brand/name/type, firmware if read), EQ preset list +
  selected preset, ANC mode/level, capability set.
- **Live-only** (resets on disconnect): battery, connection status/error.

The opportunistically-probed capability set (§3.5) determines `sections()` the
same way Nothing's does — an unrecognised/not-yet-probed device shows everything
rather than guessing what to hide, matching this repo's existing
"unrecognised model" convention (`togglesFor`, `sectionsForDevice`).

---

## 5. Testing strategy

No hardware available for this phase. Tests are synthetic — a `FakeTransport`-driven
harness pinned to the byte layouts in §3, same style as every other driver's
suite (`gaiaHarness`, `sonyHandshakeOpener`). This proves the implementation
matches our *current understanding* of the protocol, not real hardware —
worth stating plainly rather than implying otherwise. The specific items in §6
are exactly the ones a first real-hardware session should check first.

---

## 6. Risks / open assumptions

Every item here is a stated, reasoned assumption, not a silent gap — flagged so
a future implementer or hardware session knows exactly what to verify first
rather than trusting it blindly.

| Assumption | Confidence | What would resolve it |
|---|---|---|
| Inner SPP payload layout (`cmd@0/seq@2/payLen@3`) | High — 3 independent sources agree | Trace the APK's own post-length payload parser past the `p194p7` fan-out |
| Incrementing sequence byte (vs. fixed `0xF0`) | Our own design choice, not protocol-derived | Only matters if a real device rejects/misorders responses; trivial to switch |
| `0x010C` direct-query response shares the `0x0204` notification's DTOs | Medium — same command family, not independently traced | Poll `0x010C` against real hardware and compare |
| Set-ANC (`0x0404`) / set-EQ (`0x0406`) request payload shapes | Low — command IDs confirmed, payload shapes not derived from either APK or references in this pass | A follow-up APK trace of the encode side, or hardware trial |
| GATT frame format (§3.3) | Reference-only, unverified against APK | Trace `p182o7/d.java`'s command queue before implementing phase B |
| Battery/EQ/ANC formats generally | High — byte-exact from the APK's own parser | Confirm against real hardware once available |

---

## 7. Out of scope

BLE GATT implementation (interface reserved, see §4.1/§3.3); find-my-earbuds,
gesture/key mapping, multi-device connection list, spatial audio, hearing
enhancement; per-model product artwork; the cloud whitelist/asset API; the
second, unidentified SPP-adjacent UUID (§3.1); command `0x011C` (relationship
to `0x0100` not distinguished, not needed for phase A).
