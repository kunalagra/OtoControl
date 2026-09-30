# Boat (Bluetrum) Driver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Bluetrum-only Boat driver (`boat-bluetrum`) to OtoControl, in-line with existing drivers.

**Architecture:** HeyMelody-shaped SPP driver: `bluetrumFrame.ts` (5-byte header + frag reassembly) → `commands.ts` (cmd/info ids + codecs) → `client.ts` (serialised queue, cmd-byte correlation) → `device.ts` (StateStore + DeviceSession, capabilities from info `-2`) → `driver.ts` + manager wiring. Catalog generated from `boat_hearables_catalog.json` (all 158 indexed, runtime `sdk_type` gate).

**Tech Stack:** TypeScript, vitest, Web Serial (`SerialTransport`), existing `core/` seams.

**Spec:** Decompile facts in `android-testing/boat/BOAT_PROTOCOL_NOTES.md` §§2–4, 6–7; `Command.java` ids verified live from `jadx_out` during planning.

## Global Constraints

- No token or secret is committed; catalog images are public CloudFront URLs.
- Bluetrum has no SOF/checksum — do not add one.
- Response correlation is command-byte only; OTA `0xA0–0xA3` expects no ack.
- Info id 27 does not exist — never probe it.
- `Boolean` parsing is strict (`0x00`/`0x01` else null).
- Battery level is 7-bit + charging bit; mask, don't cast.
- Non-`BLUETRUM_SDK` models are rejected at handshake, never driven.

## Review Focus

- A V1-beacon device on standard SPP answered by HeyMelody's generic claim — expect the handshake to release the port with `NOT_BOAT_ERROR`, not hold it.
- A `BLUETRUM_SDK` model whose `-2` capabilities never arrive — expect opportunistic probing to mark only what answered.
- A `len != 1` key record — expect it silently skipped, matching `KeyPayloadHandler`.
- A multipoint MAC — expect XOR `0xAD` applied in both directions.
- A non-Bluetrum Boat model (BES/JL/Airoha/NON_SDK) — expect clean reject, no bytes beyond the identity poll.

---

### Task 1: Bluetrum frame codec

**Files:**
- Create: `src/drivers/boat/bluetrumFrame.ts`
- Test: `src/drivers/boat/bluetrumFrame.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `encodeFrames(cmd: number, type: 1|2|3, payload: Uint8Array, seq: { n: number }, maxPayload: number) -> Uint8Array[]`; `class BluetrumDecoder { push(chunk: Uint8Array): BluetrumFrame[] }`; `BluetrumFrame { seq, cmd, type, payload, raw }`.

- [ ] **Step 1: Write the failing test** — empty payload single frame, multi-chunk split with frag hi/lo nibbles, seq rollover `15→0`, decoder reassembly across `push` calls, wrong-seq / short-payload / first-index-nonzero error paths.
- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run src/drivers/boat/bluetrumFrame.test.ts` Expected: FAIL (file missing).
- [ ] **Step 3: Implement codec in `src/drivers/boat/bluetrumFrame.ts`** — TX per `DeviceCommManager.a()`: `[seq&15][cmd][type][((total-1)<<4)|index][len][chunk]`; empty payload → single `[seq,cmd,type,0,0]`; seq advances per frame. RX per `c.java:b()` + `d.java`: walk 5-byte headers, check seq nibble, length fit, reassemble keyed on `(cmd,type,total)`, emit on frags `0..total-1`, type 2 → response / 3 → notification.
- [ ] **Step 4: Run test to verify it passes** — Run: `npx vitest run src/drivers/boat/bluetrumFrame.test.ts` Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/drivers/boat/bluetrumFrame.ts src/drivers/boat/bluetrumFrame.test.ts && git commit -m "feat(boat): bluetrum frame codec"`

### Task 2: Command ids + payload codecs

**Files:**
- Create: `src/drivers/boat/commands.ts`
- Test: `src/drivers/boat/commands.test.ts`

**Interfaces:**
- Consumes: nothing (pure codecs).
- Produces: `Cmd` (32–55, 39, 40, 0xA0–0xA3), `Info` (ids incl. -1, -2), `Notif`, `encodeDeviceInfoQuery(ids)`, `decodeBattery`, `encodeAnc*`, `decodeEqCurrent/All`, `encodeEq`, `decodeKeys`, `encodeKey`, `decodeMultipoint/encodeMultipoint` (XOR 0xAD), `decodeCapabilities`, `DEVICE_INFO_DEFAULT_IDS` (34 ids), `CAP_*` bitmask.

- [ ] **Step 1: Write the failing test** — vectors from protocol notes: battery `[L][R][case]` bit7 charging; EQ set `[10][mode][gains]` + custom `mode+32`; current `[N][mode][gains]` + 1-byte mode-only; keys TLV keep-only-`len==1`; ANC tags 1–4 incl. modes 0–5; multipoint MAC round-trip through XOR; capabilities LE bitmask; default poll skips 27.
- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run src/drivers/boat/commands.test.ts` Expected: FAIL.
- [ ] **Step 3: Implement `src/drivers/boat/commands.ts`** — ids verbatim from `Command.java` (verified); strict boolean/byte handlers; `ByteToInteger` widths as documented OPEN → return null on unexpected length rather than guessing.
- [ ] **Step 4: Run test to verify it passes** — Run: `npx vitest run src/drivers/boat/commands.test.ts` Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/drivers/boat/commands.ts src/drivers/boat/commands.test.ts && git commit -m "feat(boat): command ids and codecs"`

### Task 3: Client (request/response + notifications)

**Files:**
- Create: `src/drivers/boat/client.ts`
- Test: `src/drivers/boat/client.test.ts`

**Interfaces:**
- Consumes: `bluetrumFrame.ts` (`encodeFrames`, `BluetrumDecoder`), `commands.ts` (`Cmd`).
- Produces: `class BoatClient { handleData(chunk), request(cmd, payload?, opts?): Promise<Uint8Array>, onNotification(l): () => void, abort(reason), setMaxPayload(n) }`; OTA cmds resolve without waiting.

- [ ] **Step 1: Write the failing test** — fake `Transport`: request resolves on matching cmd-byte response; serial queue order; unsolicited type-3 → notification listeners; OTA cmd resolves immediately; timeout → `BoatUnsupportedError`; `abort` rejects pending.
- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run src/drivers/boat/client.test.ts` Expected: FAIL.
- [ ] **Step 3: Implement `src/drivers/boat/client.ts`** — one in-flight request per command (cmd-byte match, HeyMelody/Soundcore client shape); batch `39` responses routed to pending `39` waiter; `40`/other type-3 → listeners; `0xA0–0xA3` fire-and-forget.
- [ ] **Step 4: Run test to verify it passes** — Run: `npx vitest run src/drivers/boat/client.test.ts` Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/drivers/boat/client.ts src/drivers/boat/client.test.ts && git commit -m "feat(boat): request client"`

### Task 4: Catalog + assets

**Files:**
- Create: `scripts/generate-boat-catalog.mjs`, `src/drivers/boat/products.generated.ts`, `src/drivers/boat/assets.ts`, `src/drivers/boat/catalog.ts`
- Test: `src/drivers/boat/catalog.test.ts`, `src/drivers/boat/assets.test.ts`

**Interfaces:**
- Consumes: `android-testing/boat/boat_hearables_catalog.json` (read at generation time only).
- Produces: `BOAT_PRODUCTS` (id, hearable_name, hearable_ble_name, hearable_sdk_type, category, images), `lookupBoatProduct({name})`, `boatArtwork(model, bleName) -> DeviceArtwork`.

- [ ] **Step 1: Write the failing test** — BLE-name exact match wins (`393ANC_BLE` → Airdopes 393ANC, BLUETRUM_SDK); fallback to `hearable_name`; unknown → null; artwork prefers `product_image_1`, placeholder when absent.
- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run src/drivers/boat/catalog.test.ts src/drivers/boat/assets.test.ts` Expected: FAIL.
- [ ] **Step 3: Implement generator + run it + `catalog.ts`/`assets.ts`** — generator reads the JSON, emits the table (all 158, no token); lookup tries `hearable_ble_name` then `hearable_name` (case-insensitive); artwork returns remote CloudFront hero (same URL for inactive, HeyMelody pattern).
- [ ] **Step 4: Run test to verify it passes** — Run: `npx vitest run src/drivers/boat/catalog.test.ts src/drivers/boat/assets.test.ts` Expected: PASS.
- [ ] **Step 5: Commit** — `git add scripts/generate-boat-catalog.mjs src/drivers/boat/ && git commit -m "feat(boat): product catalog and artwork"`

### Task 5: Device orchestration

**Files:**
- Create: `src/drivers/boat/device.ts`
- Test: `src/drivers/boat/device.test.ts`

**Interfaces:**
- Consumes: `client.ts` (`BoatClient`), `commands.ts`, `catalog.ts`, `core/session.ts`, `core/stateStore.ts`, `core/transport.ts`.
- Produces: `class BoatDevice implements Persistable` (`adoptPort`, `refresh`, `disconnect`, setters: `setAnc`, `setEqPreset/Custom`, `setKey`, `setMultipoint`, `setFindDevice`, `setInEarDetect`, ...), `BoatState`, `initialBoatState`, `BOAT_SNAPSHOT_VERSION`.

- [ ] **Step 1: Write the failing test** — fake opener + scripted client: connect runs default 34-id poll → capabilities from `-2` → gated reads; non-Bluetrum sdk_type → disconnect + `NOT_BOAT_ERROR`; drop preserves durable slice; optimistic setter rolls back on failure.
- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run src/drivers/boat/device.test.ts` Expected: FAIL.
- [ ] **Step 3: Implement `src/drivers/boat/device.ts`** — HeyMelody `device.ts` shape: `#refreshAll` (identity via BT name + catalog → poll `39` → capabilities → gated reads with `PROBE_TIMEOUT_MS`-style per-read timeouts); notification handler updates battery/ANC/EQ/keys/multipoint slices.
- [ ] **Step 4: Run test to verify it passes** — Run: `npx vitest run src/drivers/boat/device.test.ts` Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/drivers/boat/device.ts src/drivers/boat/device.test.ts && git commit -m "feat(boat): device orchestration"`

### Task 6: Driver descriptor + core/manager wiring + sections

**Files:**
- Create: `src/drivers/boat/driver.ts`, `src/drivers/boat/sections/*.tsx`
- Modify: `src/core/brand.ts`, `src/core/transport.ts`, `src/core/driver.ts`, `src/core/manager.ts`
- Test: `src/drivers/boat/driver.test.ts`, update `src/core/driver.test.ts` if it pins the driver list.

**Interfaces:**
- Consumes: `device.ts` (`BoatDevice`, `BoatState`), `assets.ts`, `core/transport.ts` (`servicesFor`).
- Produces: `BOAT_DRIVER` (`id 'boat-bluetrum'`), sections noise/sound/system/devices gated by capabilities; manager `ActiveDevice` arm.

- [ ] **Step 1: Write the failing test** — `driverForService(BOAT_CUSTOM_SPP_UUID)` → boat; sections hidden until capabilities known (HeyMelody pattern); `statusLine` shows L/R/case battery; `artwork` resolves via catalog.
- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run src/drivers/boat/driver.test.ts src/core/driver.test.ts` Expected: FAIL.
- [ ] **Step 3: Implement descriptor + wiring** — `BOAT_CUSTOM_SPP_UUID = 'b6632277-0642-458b-a7a0-23fb1dc92c93'` (lowercase form) in `KNOWN_SERVICES` as `{ brand: 'boat', protocol: 'boat-bluetrum' }`; `Brand` + `DRIVERS` + manager arm + `#boat` handle (manager `#devices` + subscribe loop derive from `DRIVERS` already); minimal sections reusing shared UI patterns.
- [ ] **Step 4: Run full suite** — Run: `npx vitest run` Expected: PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(boat): driver descriptor and wiring"`

### Task 7: Other-stack fishing report (spike, no ship code)

**Files:** none (report in chat).

- [ ] **Step 1: Inspect `bes/` (stub only — confirmed), `wuqi/model/` + call sites, `airoha` message DTO fields, Jieli `RCSPController` entry in `b.java:2763`.**
- [ ] **Step 2: Record per-stack verdict (implementable vs OPEN + what would close it) in chat.** No driver code for non-Bluetrum stacks in this plan.
