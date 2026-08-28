# HeyMelody Driver (Phase A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fifth `DeviceDriver` — HeyMelody (OPPO/realme/OnePlus earbuds) — driven over classic Bluetooth SPP/RFCOMM via Web Serial, covering identification, battery, ANC, and EQ.

**Architecture:** A `FrameCodec` strategy (`SppFrameCodec` this phase) feeds a `HeyMelodyClient` that mirrors `SoundcoreClient`'s single-pending-request queue. `HeyMelodyDevice` composes `DeviceSession` + `StateStore` exactly like every existing driver, with capabilities probed opportunistically (Nothing's pattern) rather than parsed from a bitmap. A generated `catalog.generated.ts` maps `productId` to `{brand, name, type}`.

**Tech Stack:** TypeScript, Vitest, existing `core/` transport/session/stateStore/persistence machinery, React (section components), Python 3 (catalog generation script, no dependencies).

**Spec:** `docs/superpowers/specs/2026-08-27-heymelody-driver-design.md`

## Global Constraints

- SPP service UUID: `0000079A-D102-11E1-9B23-00025B00A5A5`.
- No checksum/CRC anywhere in the frame — confirmed, not a gap to fill.
- Frame: `0xAA | length-varint(1-2 bytes) | body`, where `body = reserved(2) | cmd(2,LE) | seq(1) | payLen(2,LE) | commandPayload`. See spec §3.2 for the exact varint decode.
- Response `cmd` = request `cmd | 0x8000`.
- Sequence byte: our own incrementing counter, wraps 0x01–0xFE (spec §3.2) — not inherited from any reference.
- All multi-byte integer fields are little-endian (spec §3.6).
- Capabilities are probed opportunistically per command, not parsed from a bitmap (spec §3.5, revised from the original three-step model).
- `brand: 'heymelody'`, `id: 'heymelody'` (spec §4.3). Never infer OEM brand from `productId`'s low byte — always resolve via catalog lookup.
- Never port/copy code from OppoPodsManager or its ancestor repos (all GPL, read-only reference per `src/core/profiles.ts`'s standing rule) — every function below is written from the byte-layout description, not translated from another language.
- `git commit` after every task's tests pass, matching this repo's existing commit granularity. Never use `--no-verify`.

---

## File Structure

```
src/drivers/heymelody/
  driver.ts             — descriptor (Task 10)
  device.ts              — HeyMelodyDevice orchestration (Task 9)
  client.ts               — HeyMelodyClient request/response (Task 6)
  sppFrame.ts              — SppFrameCodec (Task 2)
  commands.ts               — cmd ids + encode/decode (Tasks 3, 4, 5)
  state.ts                  — DeviceState + durable split + notification reducer (Task 8)
  catalog.generated.ts       — productId → catalog entry table (Task 7, generated)
  catalog.ts                  — catalogEntryFor() lookup (Task 7)
  assets.ts                    — generic placeholder artwork (Task 10)
  sections/
    Noise.tsx                  — ANC (stub in Task 10, real content in Task 11)
    Sound.tsx                   — EQ (stub in Task 10, real content in Task 11)
    System.tsx                   — device info + battery (stub in Task 10, real content in Task 11)

docs/reference/heymelody-devices.json   — copy of the 137-device catalog (Task 7)
scripts/gen-heymelody-catalog.py         — generates catalog.generated.ts (Task 7)

Modified:
src/core/brand.ts            — add 'heymelody' (Task 1)
src/core/transport.ts         — add UUID + KNOWN_SERVICES entry (Task 1)
src/core/profiles.ts           — add IMPLEMENTED.heymelody entry (Task 10)
src/core/driver.ts              — DRIVERS entry, re-export, DriverId union (Task 10)
src/core/manager.ts              — ActiveDevice union, #devices field, active getter (Task 10)
src/ui/device/summary.ts          — heymelody branch, required for the union to type-check (Task 10)
```

---

## Task 1: Register the HeyMelody brand and SPP service

**Files:**
- Modify: `src/core/brand.ts`
- Modify: `src/core/transport.ts`
- Test: `src/core/transport.test.ts`

**Interfaces:**
- Produces: `Brand` includes `'heymelody'`; `HEYMELODY_SPP_UUID: string` exported from `transport.ts`; `KNOWN_SERVICES` includes an entry with `brand: 'heymelody'`.

- [ ] **Step 1: Write the failing test**

Open `src/core/transport.test.ts`, find the test that asserts `servicesFor` returns each known brand's UUIDs (there is already one per existing brand — follow its exact shape), and add:

```ts
it('resolves heymelody services', () => {
  expect(servicesFor('heymelody')).toEqual([HEYMELODY_SPP_UUID]);
});
```

Add `HEYMELODY_SPP_UUID` to the existing `import { ... } from './transport'` line at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/core/transport.test.ts -t "resolves heymelody services"`
Expected: FAIL — `HEYMELODY_SPP_UUID` is not exported / `servicesFor('heymelody')` does not type-check yet.

- [ ] **Step 3: Add the brand**

In `src/core/brand.ts`, change the final line:

```ts
export type Brand = 'sennheiser' | 'sony' | 'nothing' | 'soundcore' | 'heymelody';
```

- [ ] **Step 4: Add the service UUID and registry entry**

In `src/core/transport.ts`, beside the other UUID constants (near `NOTHING_SPP_UUID`):

```ts
/**
 * HeyMelody's SPP service — shared across OPPO/realme/OnePlus earbuds
 * (`com.heytap.headset`, one app rebadged per brand). Present on every
 * catalog entry as `supportSpp: true` / this exact UUID. See
 * `docs/superpowers/specs/2026-08-27-heymelody-driver-design.md` §3.1.
 */
export const HEYMELODY_SPP_UUID = '0000079a-d102-11e1-9b23-00025b00a5a5';
```

Extend `ProtocolGeneration`:

```ts
export type ProtocolGeneration = 'gaia' | 'mdr-v1' | 'mdr-v2' | 'nothing-v1' | 'heymelody';
```

Add to `KNOWN_SERVICES`:

```ts
{ uuid: HEYMELODY_SPP_UUID, brand: 'heymelody', protocol: 'heymelody' },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/core/transport.test.ts`
Expected: PASS, all tests in the file green (this file is shared — a broken edit here breaks every other brand's test too).

- [ ] **Step 6: Type-check**

Run: `npx tsc -b`
Expected: fails — `Brand` now has 5 members, and `core/profiles.ts`'s `IMPLEMENTED: Record<Brand, ...>` is missing a `heymelody` key. This is expected and intentional at this point in the plan (Task 10 adds it); confirm the *only* error is that missing key, then leave it — do not add a workaround here.

- [ ] **Step 7: Commit**

```bash
git add src/core/brand.ts src/core/transport.ts src/core/transport.test.ts
git commit -m "feat(heymelody): register brand and SPP service UUID"
```

---

## Task 2: SPP frame codec

**Files:**
- Create: `src/drivers/heymelody/sppFrame.ts`
- Test: `src/drivers/heymelody/sppFrame.test.ts`

**Interfaces:**
- Produces:
  - `interface HeyMelodyFrame { cmd: number; seq: number; payload: Uint8Array; lengthOk: boolean }`
  - `encodeSppFrame(cmd: number, seq: number, payload: number[] | Uint8Array): Uint8Array`
  - `interface FrameCodec { encode(cmd: number, seq: number, payload: ArrayLike<number>): Uint8Array; createDecoder(): FrameDecoder }` where `FrameDecoder` has `push(chunk: Uint8Array): HeyMelodyFrame[]` and `reset(): void` — the seam Task 6's client depends on, and phase B's `GattFrameCodec` will implement identically (spec §4.1).
  - `class SppFrameCodec implements FrameCodec`
  - `nextSeq(current: number): number` — increments and wraps 0x01–0xFE

- [ ] **Step 1: Write the failing tests**

Create `src/drivers/heymelody/sppFrame.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SppFrameCodec, encodeSppFrame, nextSeq } from './sppFrame';

describe('encodeSppFrame', () => {
  it('encodes a single-byte-length frame byte for byte', () => {
    // Hand-derived: body = reserved(0x00,0x00) + cmd(0x0103 LE -> 0x03,0x01)
    // + seq(0x01) + payLen(0 -> 0x00,0x00) + payload() = 7 bytes.
    // 7 < 0x80, so length is 1 byte with continuation bit clear: 0x07.
    // Frame = 0xAA, 0x07, then the 7 body bytes = 9 bytes total.
    const frame = encodeSppFrame(0x0103, 0x01, []);
    expect(Array.from(frame)).toEqual([0xaa, 0x07, 0x00, 0x00, 0x03, 0x01, 0x01, 0x00, 0x00]);
  });

  it('encodes a payload, little-endian cmd and payLen', () => {
    // body = reserved(2) + cmd(0x0404 LE -> 0x04,0x04) + seq(0x02) + payLen(3 -> 0x03,0x00) + [0x01,0x02,0x03]
    // body length = 2+2+1+2+3 = 10, fits in 1 byte (0x0A).
    const frame = encodeSppFrame(0x0404, 0x02, [0x01, 0x02, 0x03]);
    expect(Array.from(frame)).toEqual([
      0xaa, 0x0a, 0x00, 0x00, 0x04, 0x04, 0x02, 0x03, 0x00, 0x01, 0x02, 0x03,
    ]);
  });

  it('switches to a 2-byte length once the body needs it', () => {
    // A 200-byte command payload: body length = 7 + 200 = 207.
    // 207 >= 0x80, so 2-byte varint: byte0 = (207 & 0x7F) | 0x80, byte1 = 207 >> 7.
    // 207 = 0b11001111. low 7 bits = 0b1001111 = 0x4F, with continuation -> 0xCF.
    // high bits = 207 >> 7 = 1 -> 0x01.
    const payload = new Uint8Array(200).fill(0x11);
    const frame = encodeSppFrame(0x0122, 0x01, payload);
    expect(frame[0]).toBe(0xaa);
    expect(frame[1]).toBe(0xcf);
    expect(frame[2]).toBe(0x01);
    expect(frame.length).toBe(3 + 207); // header(3) + body(207)
  });
});

describe('SppFrameCodec decoder', () => {
  it('decodes a frame it just encoded', () => {
    const decoder = new SppFrameCodec().createDecoder();
    const encoded = encodeSppFrame(0x8103, 0x01, [0x00, 0x10, 0xf0, 0x06]);
    const [frame] = decoder.push(encoded);
    expect(frame.cmd).toBe(0x8103);
    expect(frame.seq).toBe(0x01);
    expect(Array.from(frame.payload)).toEqual([0x00, 0x10, 0xf0, 0x06]);
    expect(frame.lengthOk).toBe(true);
  });

  it('decodes a hand-built single-byte-length frame without going through the encoder', () => {
    // Same bytes as the first encodeSppFrame test, verified independently.
    const bytes = Uint8Array.from([0xaa, 0x07, 0x00, 0x00, 0x03, 0x01, 0x01, 0x00, 0x00]);
    const decoder = new SppFrameCodec().createDecoder();
    const [frame] = decoder.push(bytes);
    expect(frame.cmd).toBe(0x0103);
    expect(frame.seq).toBe(0x01);
    expect(frame.payload.length).toBe(0);
  });

  it('reassembles a frame split across two chunks', () => {
    const encoded = encodeSppFrame(0x0106, 0x05, [0x01, 0x02]);
    const decoder = new SppFrameCodec().createDecoder();
    expect(decoder.push(encoded.slice(0, 4))).toEqual([]);
    const frames = decoder.push(encoded.slice(4));
    expect(frames).toHaveLength(1);
    expect(frames[0].cmd).toBe(0x0106);
  });

  it('flags a payLen that disagrees with the actual body length', () => {
    // Body claims payLen=99 but only carries 2 bytes — corrupt on purpose.
    const bytes = Uint8Array.from([0xaa, 0x09, 0x00, 0x00, 0x06, 0x01, 0x01, 0x63, 0x00, 0xaa, 0xbb]);
    const decoder = new SppFrameCodec().createDecoder();
    const [frame] = decoder.push(bytes);
    expect(frame.lengthOk).toBe(false);
  });

  it('resyncs on the next 0xAA after garbage bytes', () => {
    const encoded = encodeSppFrame(0x0106, 0x01, []);
    const decoder = new SppFrameCodec().createDecoder();
    const withGarbage = new Uint8Array([0x00, 0x11, 0x22, ...encoded]);
    const frames = decoder.push(withGarbage);
    expect(frames).toHaveLength(1);
    expect(frames[0].cmd).toBe(0x0106);
  });
});

describe('nextSeq', () => {
  it('increments and wraps from 0xFE back to 0x01', () => {
    expect(nextSeq(0x01)).toBe(0x02);
    expect(nextSeq(0xfd)).toBe(0xfe);
    expect(nextSeq(0xfe)).toBe(0x01);
  });
});

describe('SppFrameCodec as a FrameCodec', () => {
  it('encodes through the codec instance, not just the free function', () => {
    // Task 6's client depends on this method existing on the codec itself —
    // see FrameCodec in the spec's §4.1 strategy design.
    const codec = new SppFrameCodec();
    expect(Array.from(codec.encode(0x0103, 0x01, []))).toEqual(
      Array.from(encodeSppFrame(0x0103, 0x01, [])),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/drivers/heymelody/sppFrame.test.ts`
Expected: FAIL — module `./sppFrame` does not exist.

- [ ] **Step 3: Implement the codec**

Create `src/drivers/heymelody/sppFrame.ts`:

```ts
/**
 * HeyMelody SPP/RFCOMM framing.
 *
 *   0xAA | length (1-2 byte varint, MSB continuation bit) | body
 *   body = reserved(2, unidentified) | cmd(2, LE) | seq(1) | payLen(2, LE) | commandPayload(payLen)
 *
 * The outer shell (0xAA + varint length) is derived directly from the app's
 * own decompiled read loop. The body layout is corroborated by three
 * independent open-source reimplementations of the OPPO protocol, generalised
 * from their fixed-single-length-byte assumption to work after either 1 or 2
 * varint length bytes — see
 * docs/superpowers/specs/2026-08-27-heymelody-driver-design.md §3.2 for the
 * full derivation and what remains unverified against the app itself.
 *
 * No checksum/CRC anywhere — confirmed, not a gap.
 */

const SYNC = 0xaa;
/** The 2 reserved/unidentified bytes that sit between the length field and `cmd`. */
const RESERVED = [0x00, 0x00];
const BODY_HEADER_LENGTH = 7; // reserved(2) + cmd(2) + seq(1) + payLen(2)

export interface HeyMelodyFrame {
  cmd: number;
  seq: number;
  payload: Uint8Array;
  /** False when the body's own `payLen` field disagrees with the bytes actually carried. */
  lengthOk: boolean;
}

/** Encodes a varint length: 1 byte if it fits in 7 bits, else 2. */
function encodeLength(bodyLength: number): number[] {
  if (bodyLength < 0x80) return [bodyLength];
  return [(bodyLength & 0x7f) | 0x80, (bodyLength >> 7) & 0x7f];
}

export function encodeSppFrame(cmd: number, seq: number, payload: ArrayLike<number> = []): Uint8Array {
  const payloadArray = Array.from(payload);
  const body = [
    ...RESERVED,
    cmd & 0xff,
    (cmd >> 8) & 0xff,
    seq & 0xff,
    payloadArray.length & 0xff,
    (payloadArray.length >> 8) & 0xff,
    ...payloadArray,
  ];
  const length = encodeLength(body.length);
  return Uint8Array.from([SYNC, ...length, ...body]);
}

/** Increments the sequence byte, wrapping 0x01-0xFE — see spec §3.2 for why this range and not 0x00-0xFF. */
export function nextSeq(current: number): number {
  const next = current + 1;
  return next > 0xfe ? 0x01 : next;
}

export class SppFrameDecoder {
  #buffer = new Uint8Array(0);

  push(chunk: Uint8Array): HeyMelodyFrame[] {
    const merged = new Uint8Array(this.#buffer.length + chunk.length);
    merged.set(this.#buffer, 0);
    merged.set(chunk, this.#buffer.length);
    this.#buffer = merged;

    const frames: HeyMelodyFrame[] = [];

    for (;;) {
      const start = this.#buffer.indexOf(SYNC);
      if (start === -1) {
        this.#buffer = new Uint8Array(0);
        break;
      }
      if (start > 0) this.#buffer = this.#buffer.slice(start);
      if (this.#buffer.length < 2) break; // need at least the sync byte + first length byte

      const firstLenByte = this.#buffer[1];
      const twoByteLength = (firstLenByte & 0x80) !== 0;
      const headerLength = twoByteLength ? 3 : 2;
      if (this.#buffer.length < headerLength) break; // second length byte not in yet

      const bodyLength = twoByteLength
        ? (firstLenByte & 0x7f) | ((this.#buffer[2] & 0x7f) << 7)
        : firstLenByte & 0x7f;

      const total = headerLength + bodyLength;
      if (this.#buffer.length < total) break; // wait for the rest of the frame

      const body = this.#buffer.slice(headerLength, total);
      this.#buffer = this.#buffer.slice(total);

      if (body.length < BODY_HEADER_LENGTH) continue; // too short to carry cmd/seq/payLen at all — drop

      const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
      const cmd = view.getUint16(2, true);
      const seq = body[4];
      const payLen = view.getUint16(5, true);
      const payload = body.slice(BODY_HEADER_LENGTH);

      frames.push({ cmd, seq, payload, lengthOk: payLen === payload.length });
    }

    return frames;
  }

  reset(): void {
    this.#buffer = new Uint8Array(0);
  }
}

/**
 * The seam `HeyMelodyClient` depends on instead of a hardcoded byte shell —
 * `SppFrameCodec` is the only implementation this phase; phase B adds
 * `GattFrameCodec` behind the same interface with no client changes.
 */
export interface FrameCodec {
  encode(cmd: number, seq: number, payload: ArrayLike<number>): Uint8Array;
  createDecoder(): { push(chunk: Uint8Array): HeyMelodyFrame[]; reset(): void };
}

export class SppFrameCodec implements FrameCodec {
  encode(cmd: number, seq: number, payload: ArrayLike<number> = []): Uint8Array {
    return encodeSppFrame(cmd, seq, payload);
  }

  createDecoder(): SppFrameDecoder {
    return new SppFrameDecoder();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/drivers/heymelody/sppFrame.test.ts`
Expected: PASS, all 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/drivers/heymelody/sppFrame.ts src/drivers/heymelody/sppFrame.test.ts
git commit -m "feat(heymelody): SPP frame codec (varint length, 0xAA shell)"
```

---

## Task 3: Identification and battery commands

**Files:**
- Create: `src/drivers/heymelody/commands.ts`
- Test: `src/drivers/heymelody/commands.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (pure functions, no transport dependency).
- Produces:
  - `export const Cmd = { QueryProductId: 0x0103, Battery: 0x0106, QueryAncDirect: 0x010c, QueryEqCurrent: 0x010f, QueryEqAll: 0x0122, SetAncMode: 0x0404, SetEqPreset: 0x0406, RegisterNotify: 0x0205, ActiveReport: 0x0204 } as const`
  - `replyFor(cmd: number): number` — `cmd | 0x8000`
  - `interface ProductIdReply { status: number; productId: string }`
  - `decodeProductId(payload: Uint8Array): ProductIdReply`
  - `type BatteryDevice = 'left' | 'right' | 'case'`
  - `interface BatteryCell { device: BatteryDevice; level: number; charging: boolean }`
  - `decodeBattery(payload: Uint8Array): BatteryCell[]`

- [ ] **Step 1: Write the failing tests**

Create `src/drivers/heymelody/commands.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { Cmd, decodeBattery, decodeProductId, replyFor } from './commands';

describe('replyFor', () => {
  it('sets the reply bit', () => {
    expect(replyFor(Cmd.QueryProductId)).toBe(0x8103);
    expect(replyFor(Cmd.Battery)).toBe(0x8106);
  });
});

describe('decodeProductId', () => {
  it('reads a 3-byte little-endian productId into a 6-hex-digit string', () => {
    // status=0, productId bytes (LE) = 0x10, 0xF0, 0x06 -> value 0x06F010.
    // Matches the OPPO Enco Air4s catalog entry ("06F010").
    const reply = decodeProductId(Uint8Array.from([0x00, 0x10, 0xf0, 0x06]));
    expect(reply).toEqual({ status: 0, productId: '06F010' });
  });

  it('pads a short productId to 6 digits', () => {
    const reply = decodeProductId(Uint8Array.from([0x00, 0x01, 0x00, 0x00]));
    expect(reply.productId).toBe('000001');
  });
});

describe('decodeBattery', () => {
  it('decodes left/right/case cells, packed level+charging', () => {
    // count=2: [deviceType=1 (left), packed=0xD4] [deviceType=2 (right), packed=0x32]
    // 0xD4 & 0x7F = 0x54 = 84, charging = (0xD4 & 0x80) != 0 = true
    // 0x32 & 0x7F = 0x32 = 50, charging = false
    const cells = decodeBattery(Uint8Array.from([0x02, 0x01, 0xd4, 0x02, 0x32]));
    expect(cells).toEqual([
      { device: 'left', level: 84, charging: true },
      { device: 'right', level: 50, charging: false },
    ]);
  });

  it('decodes a case cell and tolerates an unknown deviceType by skipping it', () => {
    const cells = decodeBattery(Uint8Array.from([0x02, 0x03, 0x64, 0x09, 0x00]));
    expect(cells).toEqual([{ device: 'case', level: 100, charging: false }]);
  });

  it('returns an empty array for count=0', () => {
    expect(decodeBattery(Uint8Array.from([0x00]))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/drivers/heymelody/commands.test.ts`
Expected: FAIL — module `./commands` does not exist.

- [ ] **Step 3: Implement**

Create `src/drivers/heymelody/commands.ts`:

```ts
/**
 * HeyMelody command ids and payload codecs.
 *
 * Every byte layout is derived from the app's own decompiled parsing code
 * (`CommandUtil.java`, `com.oplus.melody.btsdk.protocol.commands.c`) — see
 * docs/superpowers/specs/2026-08-27-heymelody-driver-design.md §3.4/§3.6 for
 * exactly what is APK-confirmed versus corroborated versus this driver's own
 * documented assumption. Never ported from OppoPodsManager or its ancestors
 * (all GPL, read-only reference per `core/profiles.ts`'s standing rule).
 */

export const Cmd = {
  QueryProductId: 0x0103,
  Battery: 0x0106,
  QueryAncDirect: 0x010c,
  QueryEqCurrent: 0x010f,
  QueryEqAll: 0x0122,
  SetAncMode: 0x0404,
  SetEqPreset: 0x0406,
  RegisterNotify: 0x0205,
  ActiveReport: 0x0204,
} as const;

/** Response cmd = request cmd | 0x8000, on both transports. */
export const replyFor = (cmd: number): number => cmd | 0x8000;

// --- identification ---------------------------------------------------------

export interface ProductIdReply {
  status: number;
  productId: string;
}

/** `[status(1)][productId(3, LE)]`, formatted as a 6-hex-digit uppercase string. */
export function decodeProductId(payload: Uint8Array): ProductIdReply {
  const status = payload[0];
  const value = payload[1] | (payload[2] << 8) | (payload[3] << 16);
  return { status, productId: value.toString(16).toUpperCase().padStart(6, '0') };
}

// --- battery -----------------------------------------------------------------

export type BatteryDevice = 'left' | 'right' | 'case';

export interface BatteryCell {
  device: BatteryDevice;
  level: number;
  charging: boolean;
}

const BATTERY_DEVICE_TYPE: Record<number, BatteryDevice> = { 1: 'left', 2: 'right', 3: 'case' };

/**
 * `[count(1)][deviceType(1), packed(1)] x count` — `CommandUtil.d()`.
 * `packed`'s low 7 bits are level (0-100), bit 7 is the charging flag.
 * A `deviceType` outside 1-3 is skipped rather than thrown on: firmware
 * variance here is expected, not corruption.
 */
export function decodeBattery(payload: Uint8Array): BatteryCell[] {
  const count = payload[0];
  const cells: BatteryCell[] = [];
  for (let i = 0; i < count; i += 1) {
    const deviceType = payload[1 + i * 2];
    const packed = payload[2 + i * 2];
    const device = BATTERY_DEVICE_TYPE[deviceType];
    if (!device) continue;
    cells.push({ device, level: packed & 0x7f, charging: (packed & 0x80) !== 0 });
  }
  return cells;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/drivers/heymelody/commands.test.ts`
Expected: PASS, all 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/drivers/heymelody/commands.ts src/drivers/heymelody/commands.test.ts
git commit -m "feat(heymelody): productId and battery codecs"
```

---

## Task 4: ANC commands

**Files:**
- Modify: `src/drivers/heymelody/commands.ts`
- Modify: `src/drivers/heymelody/commands.test.ts`

**Interfaces:**
- Consumes: `Cmd` from Task 3.
- Produces:
  - `interface CurrentNoiseModeInfo { kind: 'currentMode'; supportedModes: number[] | null; level: number | null }`
  - `interface NoiseReductionInfo { kind: 'reduction'; action: number; type: number; value: number }`
  - `interface IntelligentNoiseModeInfo { kind: 'intelligentMode'; supportedModes: number[] | null }`
  - `type AncEvent = CurrentNoiseModeInfo | NoiseReductionInfo | IntelligentNoiseModeInfo`
  - `decodeAncNotification(payload: Uint8Array): AncEvent | null`
  - `encodeSetAncMode(mode: number): number[]`

- [ ] **Step 1: Write the failing tests**

Append to `src/drivers/heymelody/commands.test.ts`:

```ts
import { decodeAncNotification, encodeSetAncMode } from './commands';

describe('decodeAncNotification', () => {
  it('decodes CurrentNoiseModeInfo with a supported-modes bitmask (mType 1)', () => {
    // outer subtype=3 (noise-reduction event), inner type=1 (CurrentNoiseModeInfo),
    // DTO bytes: mType=1, mask=0b00000101 -> bits 0 and 2 set.
    const event = decodeAncNotification(Uint8Array.from([3, 1, 1, 0b0000_0101]));
    expect(event).toEqual({ kind: 'currentMode', supportedModes: [0, 2], level: null });
  });

  it('decodes CurrentNoiseModeInfo with a single level (mType 2)', () => {
    const event = decodeAncNotification(Uint8Array.from([3, 1, 2, 50]));
    expect(event).toEqual({ kind: 'currentMode', supportedModes: null, level: 50 });
  });

  it('decodes NoiseReductionInfo (inner type 2), value little-endian', () => {
    // action=1, type=2, value=10 as 2 LE bytes.
    const event = decodeAncNotification(Uint8Array.from([3, 2, 1, 2, 0x0a, 0x00]));
    expect(event).toEqual({ kind: 'reduction', action: 1, type: 2, value: 10 });
  });

  it('decodes IntelligentNoiseModeInfo with a bitmask (mType 1)', () => {
    const event = decodeAncNotification(Uint8Array.from([3, 4, 1, 0b0000_0010]));
    expect(event).toEqual({ kind: 'intelligentMode', supportedModes: [1] });
  });

  it('decodes IntelligentNoiseModeInfo with an unrecognised mType as no modes', () => {
    const event = decodeAncNotification(Uint8Array.from([3, 4, 2]));
    expect(event).toEqual({ kind: 'intelligentMode', supportedModes: null });
  });

  it('returns null for a non-noise-reduction outer subtype', () => {
    expect(decodeAncNotification(Uint8Array.from([7, 1, 1, 0]))).toBeNull();
  });

  it('returns null for an unrecognised inner type', () => {
    expect(decodeAncNotification(Uint8Array.from([3, 9, 0]))).toBeNull();
  });
});

describe('encodeSetAncMode', () => {
  it('encodes the mode as a single byte', () => {
    // Payload shape is not derived from the app or any reference (§3.4/§6 of
    // the spec) — a single mode byte is this driver's own working assumption,
    // the simplest shape consistent with the read-side DTOs, pending
    // verification against real hardware.
    expect(encodeSetAncMode(2)).toEqual([2]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/drivers/heymelody/commands.test.ts -t "decodeAncNotification"`
Expected: FAIL — `decodeAncNotification` is not exported.

- [ ] **Step 3: Implement**

Append to `src/drivers/heymelody/commands.ts`:

```ts
// --- ANC ---------------------------------------------------------------------

/** Outer `0x0204` subtype for a noise-reduction event, from `commands/g.java`. */
const NOISE_REDUCTION_SUBTYPE = 3;

export interface CurrentNoiseModeInfo {
  kind: 'currentMode';
  supportedModes: number[] | null;
  level: number | null;
}

export interface NoiseReductionInfo {
  kind: 'reduction';
  action: number;
  type: number;
  value: number;
}

export interface IntelligentNoiseModeInfo {
  kind: 'intelligentMode';
  supportedModes: number[] | null;
}

export type AncEvent = CurrentNoiseModeInfo | NoiseReductionInfo | IntelligentNoiseModeInfo;

/** LSB-first bit indices set across every byte, e.g. `[0b101]` -> `[0, 2]`. */
function decodeBitmask(bytes: Uint8Array): number[] {
  const bits: number[] = [];
  for (let byteIndex = 0; byteIndex < bytes.length; byteIndex += 1) {
    for (let bit = 0; bit < 8; bit += 1) {
      if (bytes[byteIndex] & (1 << bit)) bits.push(byteIndex * 8 + bit);
    }
  }
  return bits;
}

/** Little-endian decode of 1-4 bytes into a number. */
function decodeLEValue(bytes: Uint8Array): number {
  let value = 0;
  for (let i = 0; i < bytes.length; i += 1) value |= bytes[i] << (i * 8);
  return value >>> 0;
}

/**
 * `0x0204` unsolicited notification, noise-reduction subtype: `[outerSubtype,
 * innerType, ...dtoBytes]`. `innerType` (`commands/g.java`'s dispatch byte,
 * called `b12` in the notes) selects one of three DTOs — see spec §3.6.
 * Returns null for any subtype/type this driver does not model.
 */
export function decodeAncNotification(payload: Uint8Array): AncEvent | null {
  if (payload[0] !== NOISE_REDUCTION_SUBTYPE) return null;
  const innerType = payload[1];
  const dto = payload.slice(2);

  if (innerType === 1) {
    const mType = dto[0];
    if (mType === 1) return { kind: 'currentMode', supportedModes: decodeBitmask(dto.slice(1)), level: null };
    if (mType === 2) return { kind: 'currentMode', supportedModes: null, level: dto[1] };
    return { kind: 'currentMode', supportedModes: null, level: null };
  }

  if (innerType === 2) {
    const action = dto[0];
    const type = dto[1];
    const value = decodeLEValue(dto.slice(2, 6));
    return { kind: 'reduction', action, type, value };
  }

  if (innerType === 4) {
    const mType = dto[0];
    return { kind: 'intelligentMode', supportedModes: mType === 1 ? decodeBitmask(dto.slice(1)) : null };
  }

  return null;
}

/**
 * Set-ANC-mode (`0x0404`) request payload. Not derived from the app or any
 * reference — the simplest shape consistent with the read-side DTOs above.
 * See spec §3.4/§6: first thing to verify against real hardware.
 */
export function encodeSetAncMode(mode: number): number[] {
  return [mode];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/drivers/heymelody/commands.test.ts`
Expected: PASS, all tests including Task 3's.

- [ ] **Step 5: Commit**

```bash
git add src/drivers/heymelody/commands.ts src/drivers/heymelody/commands.test.ts
git commit -m "feat(heymelody): ANC notification decode and set-mode encode"
```

---

## Task 5: EQ commands

**Files:**
- Modify: `src/drivers/heymelody/commands.ts`
- Modify: `src/drivers/heymelody/commands.test.ts`

**Interfaces:**
- Consumes: `Cmd` from Task 3.
- Produces:
  - `interface EqBand { frequency: number; dbValue: number }`
  - `interface EqPreset { isSelected: boolean; minValue: number; maxValue: number; eqId: number; name: string; bands: EqBand[] }`
  - `decodeEqCurrent(payload: Uint8Array): number`
  - `decodeEqAll(payload: Uint8Array): EqPreset[]`
  - `encodeSetEqPreset(eqId: number): number[]`

- [ ] **Step 1: Write the failing tests**

Append to `src/drivers/heymelody/commands.test.ts`:

```ts
import { decodeEqAll, decodeEqCurrent, encodeSetEqPreset } from './commands';

describe('decodeEqCurrent', () => {
  it('reads the active preset index as a little-endian u16', () => {
    expect(decodeEqCurrent(Uint8Array.from([0x02, 0x00]))).toBe(2);
  });
});

describe('decodeEqAll', () => {
  it('decodes one preset with a two-band curve', () => {
    // count=1, then one preset:
    //   isSelected=1, minValue=-6 (0xFA signed), maxValue=6, eqId=1,
    //   nameLength=3, name="Pop" (0x50,0x6F,0x70), frequencyNum=2,
    //   band1: frequency=100 (LE 0x64,0x00), dbValue=3
    //   band2: frequency=1000 (LE 0xE8,0x03), dbValue=-2 (0xFE signed)
    const payload = Uint8Array.from([
      1,
      1, 0xfa, 0x06, 1,
      3, 0x50, 0x6f, 0x70,
      2,
      0x64, 0x00, 0x03,
      0xe8, 0x03, 0xfe,
    ]);
    expect(decodeEqAll(payload)).toEqual([
      {
        isSelected: true,
        minValue: -6,
        maxValue: 6,
        eqId: 1,
        name: 'Pop',
        bands: [
          { frequency: 100, dbValue: 3 },
          { frequency: 1000, dbValue: -2 },
        ],
      },
    ]);
  });

  it('decodes zero presets', () => {
    expect(decodeEqAll(Uint8Array.from([0]))).toEqual([]);
  });
});

describe('encodeSetEqPreset', () => {
  it('encodes the eqId as a single byte, matching its confirmed size on the read side', () => {
    expect(encodeSetEqPreset(1)).toEqual([1]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/drivers/heymelody/commands.test.ts -t "decodeEqAll"`
Expected: FAIL — `decodeEqAll` is not exported.

- [ ] **Step 3: Implement**

Append to `src/drivers/heymelody/commands.ts`:

```ts
// --- EQ ------------------------------------------------------------------

export interface EqBand {
  frequency: number;
  dbValue: number;
}

export interface EqPreset {
  isSelected: boolean;
  minValue: number;
  maxValue: number;
  eqId: number;
  name: string;
  bands: EqBand[];
}

/** Two's-complement signed byte. */
const signedByte = (byte: number): number => (byte > 127 ? byte - 256 : byte);

const textDecoder = new TextDecoder('utf-8');

/** `0x010F` response: just the active preset index, u16 LE, no status byte. */
export function decodeEqCurrent(payload: Uint8Array): number {
  return payload[0] | (payload[1] << 8);
}

/**
 * `0x0122` response — `CommandUtil.b()` / "parseAllEqData". Every preset
 * carries a full per-band curve, not just an index. See spec §3.4 for why
 * `0x0122` rather than `0x010F` serves this richer format.
 */
export function decodeEqAll(payload: Uint8Array): EqPreset[] {
  const count = payload[0];
  const presets: EqPreset[] = [];
  let offset = 1;

  for (let i = 0; i < count; i += 1) {
    const isSelected = payload[offset] !== 0;
    const minValue = signedByte(payload[offset + 1]);
    const maxValue = signedByte(payload[offset + 2]);
    const eqId = payload[offset + 3];
    const nameLength = payload[offset + 4];
    const nameStart = offset + 5;
    const name = textDecoder.decode(payload.slice(nameStart, nameStart + nameLength));

    const frequencyNumOffset = nameStart + nameLength;
    const frequencyNum = payload[frequencyNumOffset];
    const bands: EqBand[] = [];
    let bandOffset = frequencyNumOffset + 1;
    for (let b = 0; b < frequencyNum; b += 1) {
      const frequency = payload[bandOffset] | (payload[bandOffset + 1] << 8);
      const dbValue = signedByte(payload[bandOffset + 2]);
      bands.push({ frequency, dbValue });
      bandOffset += 3;
    }

    presets.push({ isSelected, minValue, maxValue, eqId, name, bands });
    offset = bandOffset;
  }

  return presets;
}

/**
 * Set-EQ-preset (`0x0406`) request payload: the single-byte `eqId`. Not
 * independently derived, but a stronger assumption than `encodeSetAncMode`'s
 * — `eqId` is confirmed 1 byte on the read side (§3.6), so selecting a preset
 * by that same byte is the natural symmetric shape.
 */
export function encodeSetEqPreset(eqId: number): number[] {
  return [eqId];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/drivers/heymelody/commands.test.ts`
Expected: PASS, every test in the file (Tasks 3-5 combined).

- [ ] **Step 5: Commit**

```bash
git add src/drivers/heymelody/commands.ts src/drivers/heymelody/commands.test.ts
git commit -m "feat(heymelody): EQ current/all decode and set-preset encode"
```

---

## Task 6: Client (request/response plumbing)

**Files:**
- Create: `src/drivers/heymelody/client.ts`
- Test: `src/drivers/heymelody/client.test.ts`

**Interfaces:**
- Consumes: `FrameCodec`, `SppFrameCodec`, `HeyMelodyFrame`, `nextSeq`, `encodeSppFrame` (Task 2); `Cmd`, `replyFor` (Task 3); `Transport` from `@/core/transport`.
- Produces:
  - `class HeyMelodyUnsupportedError extends Error`
  - `type NotificationListener = (frame: HeyMelodyFrame) => void`
  - `type FrameListener = (frame: HeyMelodyFrame, direction: 'tx' | 'rx') => void`
  - `class HeyMelodyClient { constructor(transport: Transport, options?: { timeoutMs?: number; codec?: FrameCodec }); handleData(chunk: Uint8Array): void; request(cmd: number, payload?: number[], options?: { timeoutMs?: number }): Promise<Uint8Array>; onNotification(listener): () => void; onFrame(listener): () => void; abort(reason: Error): void }`

- [ ] **Step 1: Write the failing tests**

Create `src/drivers/heymelody/client.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HeyMelodyClient, HeyMelodyUnsupportedError } from './client';
import { Cmd, replyFor } from './commands';
import { encodeSppFrame } from './sppFrame';
import type { Transport } from '@/core/transport';

class FakeTransport implements Transport {
  written: Uint8Array[] = [];
  isOpen = true;

  async write(bytes: Uint8Array): Promise<void> {
    this.written.push(bytes);
  }

  async close(): Promise<void> {
    this.isOpen = false;
  }
}

function setup() {
  const transport = new FakeTransport();
  const client = new HeyMelodyClient(transport);
  return { transport, client };
}

/** Body offset 4 (seq) + header(2, since these test payloads all fit a 1-byte length). */
const sentSeq = (frame: Uint8Array): number => frame[6];

afterEach(() => {
  vi.useRealTimers();
});

describe('HeyMelodyClient.request', () => {
  it('writes an encoded frame and resolves with the reply payload', async () => {
    const { transport, client } = setup();
    const pending = client.request(Cmd.QueryProductId);
    await vi.waitFor(() => expect(transport.written).toHaveLength(1));

    client.handleData(
      encodeSppFrame(replyFor(Cmd.QueryProductId), sentSeq(transport.written[0]), [0x00, 0x10, 0xf0, 0x06]),
    );

    await expect(pending).resolves.toEqual(Uint8Array.from([0x00, 0x10, 0xf0, 0x06]));
  });

  it('rejects with HeyMelodyUnsupportedError after the timeout', async () => {
    vi.useFakeTimers();
    const { client } = setup();
    const pending = client.request(Cmd.QueryAncDirect, [], { timeoutMs: 100 });
    const assertion = expect(pending).rejects.toBeInstanceOf(HeyMelodyUnsupportedError);
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it('queues a second request until the first settles', async () => {
    const { transport, client } = setup();
    const first = client.request(Cmd.Battery);
    const second = client.request(Cmd.QueryEqCurrent);
    await vi.waitFor(() => expect(transport.written).toHaveLength(1));

    client.handleData(encodeSppFrame(replyFor(Cmd.Battery), sentSeq(transport.written[0]), [0x00]));
    await first;
    await vi.waitFor(() => expect(transport.written).toHaveLength(2));

    client.handleData(
      encodeSppFrame(replyFor(Cmd.QueryEqCurrent), sentSeq(transport.written[1]), [0x01, 0x00]),
    );
    await expect(second).resolves.toEqual(Uint8Array.from([0x01, 0x00]));
  });

  it('routes an unmatched frame to notification listeners', () => {
    const { client } = setup();
    const notified: number[] = [];
    client.onNotification((frame) => notified.push(frame.cmd));
    client.handleData(encodeSppFrame(Cmd.ActiveReport, 0x01, [3, 1, 1, 0]));
    expect(notified).toEqual([Cmd.ActiveReport]);
  });

  it('abort() rejects a pending request', async () => {
    const { client } = setup();
    const pending = client.request(Cmd.Battery);
    client.abort(new Error('disconnected'));
    await expect(pending).rejects.toThrow('disconnected');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/drivers/heymelody/client.test.ts`
Expected: FAIL — module `./client` does not exist.

- [ ] **Step 3: Implement**

Create `src/drivers/heymelody/client.ts`:

```ts
/**
 * Request/response over a HeyMelody transport, behind whichever `FrameCodec`
 * the caller is using (`SppFrameCodec` this phase — see `sppFrame.ts`).
 * Mirrors `SoundcoreClient`'s single-pending-request queue.
 */

import type { Transport } from '@/core/transport';
import { replyFor } from './commands';
import { SppFrameCodec, nextSeq } from './sppFrame';
import type { FrameCodec, HeyMelodyFrame } from './sppFrame';

export const DEFAULT_TIMEOUT_MS = 1500;

export class HeyMelodyUnsupportedError extends Error {
  constructor(cmd: number, ms: number) {
    super(
      `command 0x${cmd.toString(16).padStart(4, '0')} was not answered within ${ms}ms — ` +
        'this device does not implement it',
    );
    this.name = 'HeyMelodyUnsupportedError';
  }
}

export type NotificationListener = (frame: HeyMelodyFrame) => void;
export type FrameListener = (frame: HeyMelodyFrame, direction: 'tx' | 'rx') => void;

interface Pending {
  replyCmd: number;
  resolve(payload: Uint8Array): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export interface HeyMelodyClientOptions {
  timeoutMs?: number;
  codec?: FrameCodec;
}

export class HeyMelodyClient {
  #transport: Transport;
  #codec: FrameCodec;
  #decoder: ReturnType<FrameCodec['createDecoder']>;
  #pending: Pending | null = null;
  #queue: Promise<unknown> = Promise.resolve();
  #seq = 0x00;
  #timeoutMs: number;
  #notificationListeners = new Set<NotificationListener>();
  #frameListeners = new Set<FrameListener>();

  constructor(transport: Transport, options: HeyMelodyClientOptions = {}) {
    this.#transport = transport;
    this.#codec = options.codec ?? new SppFrameCodec();
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#decoder = this.#codec.createDecoder();
  }

  handleData(chunk: Uint8Array): void {
    for (const frame of this.#decoder.push(chunk)) this.#dispatch(frame);
  }

  #dispatch(frame: HeyMelodyFrame): void {
    for (const listener of this.#frameListeners) listener(frame, 'rx');

    if (!frame.lengthOk) {
      console.warn(`[heymelody] payLen mismatch on cmd 0x${frame.cmd.toString(16)}, dropping`);
      return;
    }

    const pending = this.#pending;
    if (pending && frame.cmd === pending.replyCmd) {
      clearTimeout(pending.timer);
      this.#pending = null;
      pending.resolve(frame.payload);
      return;
    }

    for (const listener of this.#notificationListeners) listener(frame);
  }

  /** Sends a command and waits for `cmd | 0x8000`. One in flight at a time. */
  request(cmd: number, payload: number[] = [], options: { timeoutMs?: number } = {}): Promise<Uint8Array> {
    const run = () => this.#request(cmd, payload, options.timeoutMs ?? this.#timeoutMs);
    const result = this.#queue.then(run, run);
    this.#queue = result.catch(() => undefined);
    return result;
  }

  #request(cmd: number, payload: number[], timeoutMs: number): Promise<Uint8Array> {
    this.#seq = nextSeq(this.#seq);
    const seq = this.#seq;
    const packet = this.#codec.encode(cmd, seq, payload);
    const replyCmd = replyFor(cmd);

    return new Promise<Uint8Array>((resolve, reject) => {
      this.#pending = {
        replyCmd,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.#pending = null;
          reject(new HeyMelodyUnsupportedError(cmd, timeoutMs));
        }, timeoutMs),
      };

      for (const listener of this.#frameListeners) {
        listener({ cmd, seq, payload: Uint8Array.from(payload), lengthOk: true }, 'tx');
      }

      this.#transport.write(packet).catch((error: Error) => {
        const pending = this.#pending;
        if (!pending) return;
        clearTimeout(pending.timer);
        this.#pending = null;
        pending.reject(error);
      });
    });
  }

  onNotification(listener: NotificationListener): () => void {
    this.#notificationListeners.add(listener);
    return () => this.#notificationListeners.delete(listener);
  }

  onFrame(listener: FrameListener): () => void {
    this.#frameListeners.add(listener);
    return () => this.#frameListeners.delete(listener);
  }

  abort(reason: Error): void {
    const pending = this.#pending;
    if (pending) {
      clearTimeout(pending.timer);
      this.#pending = null;
      pending.reject(reason);
    }
    this.#decoder.reset();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/drivers/heymelody/client.test.ts`
Expected: PASS, all 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/drivers/heymelody/client.ts src/drivers/heymelody/client.test.ts
git commit -m "feat(heymelody): request/response client over a FrameCodec"
```

---

## Task 7: Device catalog

**Files:**
- Create: `docs/reference/heymelody-devices.json` (copied from the sibling `android-testing` repo)
- Create: `scripts/gen-heymelody-catalog.py`
- Create: `src/drivers/heymelody/catalog.generated.ts` (generated, not hand-written)
- Create: `src/drivers/heymelody/catalog.ts`
- Test: `src/drivers/heymelody/catalog.test.ts`

**Interfaces:**
- Produces:
  - `interface HeyMelodyCatalogEntry { productId: string; name: string; brand: 'oppo' | 'realme' | 'oneplus'; type: string }` (`catalog.generated.ts`)
  - `HEYMELODY_CATALOG: readonly HeyMelodyCatalogEntry[]` (`catalog.generated.ts`)
  - `OEM_BRAND_NAME: Record<HeyMelodyCatalogEntry['brand'], string>` (`catalog.ts`) — `{ oppo: 'OPPO', realme: 'realme', oneplus: 'OnePlus' }`
  - `catalogEntryFor(productId: string): HeyMelodyCatalogEntry | null` (`catalog.ts`)

This task depends on the sibling `android-testing` repo being present on the machine running it, at `/Users/kunal/Desktop/projects/android-testing` — the 137-device catalog was extracted there and has not been duplicated anywhere else yet. If that repo is unavailable, stop and ask rather than fabricating catalog entries.

- [ ] **Step 1: Copy the source catalog**

```bash
cp /Users/kunal/Desktop/projects/android-testing/heytap/oppo_device_catalog.json \
   /Users/kunal/Desktop/projects/OtoControl/docs/reference/heymelody-devices.json
```

Verify: `python3 -c "import json; d=json.load(open('docs/reference/heymelody-devices.json')); print(d['count'], len(d['devices']))"` prints `137 137`.

- [ ] **Step 2: Write the failing test for the lookup function**

Create `src/drivers/heymelody/catalog.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { catalogEntryFor, OEM_BRAND_NAME } from './catalog';

describe('catalogEntryFor', () => {
  it('resolves a known productId', () => {
    // Real entry from the extracted catalog — OPPO Enco Air4s.
    expect(catalogEntryFor('06F010')).toEqual({
      productId: '06F010',
      name: 'OPPO Enco Air4s',
      brand: 'oppo',
      type: 'T1',
    });
  });

  it('normalises the OnePlus brand to lowercase', () => {
    // The source JSON has this entry's brand as "OnePlus"; the generated
    // table normalises every brand to lowercase so `HeyMelodyCatalogEntry['brand']`
    // is a clean 3-value union instead of carrying the source's inconsistent casing.
    expect(catalogEntryFor('067414')).toEqual({
      productId: '067414',
      name: 'OnePlus Flow Buds',
      brand: 'oneplus',
      type: 'T1',
    });
  });

  it('returns null for an unknown productId', () => {
    expect(catalogEntryFor('FFFFFF')).toBeNull();
  });
});

describe('OEM_BRAND_NAME', () => {
  it('has a display name for every catalog brand', () => {
    expect(OEM_BRAND_NAME.oppo).toBe('OPPO');
    expect(OEM_BRAND_NAME.realme).toBe('realme');
    expect(OEM_BRAND_NAME.oneplus).toBe('OnePlus');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/drivers/heymelody/catalog.test.ts`
Expected: FAIL — `./catalog` and `./catalog.generated` do not exist.

- [ ] **Step 4: Write the generation script**

Create `scripts/gen-heymelody-catalog.py`:

```python
#!/usr/bin/env python3
"""Regenerate src/drivers/heymelody/catalog.generated.ts from docs/reference/heymelody-devices.json.

Source: the 137-device productId/name/brand/type catalog extracted from
OppoPodsManager's bundled DeviceModels.json and cross-validated against
HeyTap's own whitelist resource (see the android-testing repo's
heytap/HEYMELODY_PROTOCOL_NOTES.md §4). Brand casing in the source is
inconsistent ("oppo"/"realme"/"OnePlus") — normalised to lowercase here so
the generated type is a clean 3-value union.

Usage:
    python3 scripts/gen-heymelody-catalog.py
"""

import json
from pathlib import Path

SOURCE = Path("docs/reference/heymelody-devices.json")
OUTPUT = Path("src/drivers/heymelody/catalog.generated.ts")

HEADER = """/**
 * Generated by scripts/gen-heymelody-catalog.py from
 * docs/reference/heymelody-devices.json. Do not hand-edit.
 */

export interface HeyMelodyCatalogEntry {
  productId: string
  name: string
  brand: 'oppo' | 'realme' | 'oneplus'
  type: string
}

export const HEYMELODY_CATALOG: readonly HeyMelodyCatalogEntry[] = [
"""

FOOTER = """]
"""


def main() -> None:
    data = json.loads(SOURCE.read_text())
    lines = [HEADER]
    for device in data["devices"]:
        brand = device["brand"].lower()
        entry = {
            "productId": device["productId"],
            "name": device["name"],
            "brand": brand,
            "type": device["type"],
        }
        lines.append(f"  {json.dumps(entry, ensure_ascii=False)},\n")
    lines.append(FOOTER)
    OUTPUT.write_text("".join(lines))
    print(f"Wrote {len(data['devices'])} entries to {OUTPUT}")


if __name__ == "__main__":
    main()
```

Run it:

```bash
python3 scripts/gen-heymelody-catalog.py
```

Expected output: `Wrote 137 entries to src/drivers/heymelody/catalog.generated.ts`.

Verify the two entries the test depends on are present:

```bash
grep -c '"productId"' src/drivers/heymelody/catalog.generated.ts   # 137
grep '"06F010"' src/drivers/heymelody/catalog.generated.ts          # OPPO Enco Air4s, brand "oppo"
grep '"067414"' src/drivers/heymelody/catalog.generated.ts          # OnePlus Flow Buds, brand "oneplus" (lowercased)
```

- [ ] **Step 5: Write the lookup module**

Create `src/drivers/heymelody/catalog.ts`:

```ts
import { HEYMELODY_CATALOG } from './catalog.generated';
import type { HeyMelodyCatalogEntry } from './catalog.generated';

export const OEM_BRAND_NAME: Record<HeyMelodyCatalogEntry['brand'], string> = {
  oppo: 'OPPO',
  realme: 'realme',
  oneplus: 'OnePlus',
};

const BY_PRODUCT_ID = new Map(HEYMELODY_CATALOG.map((entry) => [entry.productId, entry]));

/**
 * Looks up a device by its `0x0103`-reported productId. Never infer brand
 * from the id's own bytes — see
 * docs/superpowers/specs/2026-08-27-heymelody-driver-design.md §3.5 for why
 * that correlation is not a rule.
 */
export function catalogEntryFor(productId: string): HeyMelodyCatalogEntry | null {
  return BY_PRODUCT_ID.get(productId) ?? null;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/drivers/heymelody/catalog.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 7: Commit**

```bash
git add docs/reference/heymelody-devices.json scripts/gen-heymelody-catalog.py \
  src/drivers/heymelody/catalog.generated.ts src/drivers/heymelody/catalog.ts \
  src/drivers/heymelody/catalog.test.ts
git commit -m "feat(heymelody): generate the 137-device productId catalog"
```

---

## Task 8: State shape

**Files:**
- Create: `src/drivers/heymelody/state.ts`
- Test: `src/drivers/heymelody/state.test.ts`

**Interfaces:**
- Consumes: `AncEvent`, `BatteryCell`, `EqPreset`, `decodeAncNotification` (Tasks 3-5); `HeyMelodyCatalogEntry` (Task 7); `ConnectionStatus` from `@/core/connection`.
- Produces:
  - `type HeyMelodyCapability = 'battery' | 'anc' | 'eq'`
  - `interface HeyMelodyInfo { model: string | null; productId: string | null; catalog: HeyMelodyCatalogEntry | null }` — `model` (the catalog-resolved display name) is required by `core/manager.ts`'s `Adoptable.subscribe` contract, which every driver's state satisfies this same way (see Task 9's `#refreshAll`)
  - `interface HeyMelodyState { status: ConnectionStatus; error: string | null; info: HeyMelodyInfo; battery: BatteryCell[]; ancSupportedModes: number[] | null; ancLevel: number | null; eqCurrentPreset: number | null; eqPresets: EqPreset[]; capabilities: Set<HeyMelodyCapability> }`
  - `initialHeyMelodyState: HeyMelodyState`
  - `HEYMELODY_SNAPSHOT_VERSION: number`
  - `interface HeyMelodyDurableState { info: HeyMelodyInfo; ancSupportedModes: number[] | null; ancLevel: number | null; eqCurrentPreset: number | null; eqPresets: EqPreset[]; capabilities: HeyMelodyCapability[] }`
  - `captureDurable(state: HeyMelodyState): HeyMelodyDurableState`
  - `applyDurable(payload: object): Partial<HeyMelodyState>`
  - `applyAncEvent(state: HeyMelodyState, payload: Uint8Array): HeyMelodyState`

- [ ] **Step 1: Write the failing tests**

Create `src/drivers/heymelody/state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  applyAncEvent,
  applyDurable,
  captureDurable,
  initialHeyMelodyState,
} from './state';
import type { HeyMelodyState } from './state';

describe('captureDurable / applyDurable', () => {
  it('round-trips info, ANC and EQ state, dropping battery and status', () => {
    const state: HeyMelodyState = {
      ...initialHeyMelodyState,
      status: 'connected',
      info: {
        model: 'OPPO Enco Air4s',
        productId: '06F010',
        catalog: { productId: '06F010', name: 'OPPO Enco Air4s', brand: 'oppo', type: 'T1' },
      },
      battery: [{ device: 'left', level: 80, charging: false }],
      ancSupportedModes: [0, 1, 2],
      ancLevel: 50,
      eqCurrentPreset: 1,
      eqPresets: [{ isSelected: true, minValue: -6, maxValue: 6, eqId: 1, name: 'Pop', bands: [] }],
      capabilities: new Set(['battery', 'anc', 'eq']),
    };

    const durable = captureDurable(state);
    const patch = applyDurable(durable);

    expect(patch.info).toEqual(state.info);
    expect(patch.ancSupportedModes).toEqual([0, 1, 2]);
    expect(patch.ancLevel).toBe(50);
    expect(patch.eqCurrentPreset).toBe(1);
    expect(patch.eqPresets).toEqual(state.eqPresets);
    expect(patch.capabilities).toEqual(new Set(['battery', 'anc', 'eq']));
    // Live-only fields are not part of the durable slice at all.
    expect(patch).not.toHaveProperty('battery');
    expect(patch).not.toHaveProperty('status');
  });
});

describe('applyAncEvent', () => {
  it('updates supportedModes from a currentMode bitmask event', () => {
    // outer=3, inner=1 (CurrentNoiseModeInfo), mType=1, mask=0b101 -> bits [0,2]
    const next = applyAncEvent(initialHeyMelodyState, Uint8Array.from([3, 1, 1, 0b101]));
    expect(next.ancSupportedModes).toEqual([0, 2]);
    expect(next.ancLevel).toBeNull();
  });

  it('updates ancLevel from a currentMode level event without clearing supportedModes', () => {
    const withModes: HeyMelodyState = { ...initialHeyMelodyState, ancSupportedModes: [0, 1] };
    const next = applyAncEvent(withModes, Uint8Array.from([3, 1, 2, 75]));
    expect(next.ancLevel).toBe(75);
    expect(next.ancSupportedModes).toEqual([0, 1]);
  });

  it('leaves state unchanged for an unrecognised notification', () => {
    const next = applyAncEvent(initialHeyMelodyState, Uint8Array.from([9, 9, 9]));
    expect(next).toBe(initialHeyMelodyState);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/drivers/heymelody/state.test.ts`
Expected: FAIL — module `./state` does not exist.

- [ ] **Step 3: Implement**

Create `src/drivers/heymelody/state.ts`:

```ts
/**
 * HeyMelody device state and the pure reduction of the one push notification
 * this phase models (ANC, over `0x0204`).
 *
 * Durable/live split follows the convention every driver in this repo uses:
 * identity and settings survive a disconnect (`captureDurable`/`applyDurable`,
 * see `core/persistence.ts` and `core/stateStore.ts`); battery and connection
 * status do not.
 */

import type { ConnectionStatus } from '@/core/connection';
import { decodeAncNotification } from './commands';
import type { BatteryCell, EqPreset } from './commands';
import type { HeyMelodyCatalogEntry } from './catalog.generated';

export type HeyMelodyCapability = 'battery' | 'anc' | 'eq';

export interface HeyMelodyInfo {
  /**
   * The catalog-resolved display name — what every other driver's state
   * calls `model`. Required by `core/manager.ts`'s `Adoptable.subscribe`
   * contract (it reads `state.info.model` generically to remember a device's
   * name for the port picker), not just a naming preference — see how
   * `device.ts`'s `#refreshAll` derives it from the catalog lookup.
   */
  model: string | null;
  productId: string | null;
  catalog: HeyMelodyCatalogEntry | null;
}

export interface HeyMelodyState {
  status: ConnectionStatus;
  error: string | null;
  info: HeyMelodyInfo;
  battery: BatteryCell[];
  ancSupportedModes: number[] | null;
  ancLevel: number | null;
  eqCurrentPreset: number | null;
  eqPresets: EqPreset[];
  /** Opportunistically probed — see spec §3.5 for why this replaces a bitmap parse. */
  capabilities: Set<HeyMelodyCapability>;
}

export const initialHeyMelodyState: HeyMelodyState = {
  status: 'disconnected',
  error: null,
  info: { model: null, productId: null, catalog: null },
  battery: [],
  ancSupportedModes: null,
  ancLevel: null,
  eqCurrentPreset: null,
  eqPresets: [],
  capabilities: new Set(),
};

// --- persistence -----------------------------------------------------------

export const HEYMELODY_SNAPSHOT_VERSION = 1;

export interface HeyMelodyDurableState {
  info: HeyMelodyInfo;
  ancSupportedModes: number[] | null;
  ancLevel: number | null;
  eqCurrentPreset: number | null;
  eqPresets: EqPreset[];
  /** A Set on the state; an array here, because JSON has no Set. */
  capabilities: HeyMelodyCapability[];
}

export const captureDurable = (state: HeyMelodyState): HeyMelodyDurableState => ({
  info: state.info,
  ancSupportedModes: state.ancSupportedModes,
  ancLevel: state.ancLevel,
  eqCurrentPreset: state.eqCurrentPreset,
  eqPresets: state.eqPresets,
  capabilities: [...state.capabilities],
});

export const applyDurable = (payload: object): Partial<HeyMelodyState> => {
  const snapshot = payload as HeyMelodyDurableState;
  return {
    info: snapshot.info,
    ancSupportedModes: snapshot.ancSupportedModes ?? null,
    ancLevel: snapshot.ancLevel ?? null,
    eqCurrentPreset: snapshot.eqCurrentPreset ?? null,
    eqPresets: snapshot.eqPresets ?? [],
    capabilities: new Set(snapshot.capabilities ?? []),
  };
};

// --- notification reduction --------------------------------------------------

/**
 * Folds an ANC push (`0x0204`) into state. Only `currentMode` events update
 * anything today — `reduction` and `intelligentMode` events are received and
 * decoded but have no surfaced setting yet (spec §2 non-goals), so they pass
 * through as a no-op rather than being silently mis-mapped onto a field they
 * do not describe. An unparseable payload also leaves state untouched.
 */
export function applyAncEvent(state: HeyMelodyState, payload: Uint8Array): HeyMelodyState {
  const event = decodeAncNotification(payload);
  if (!event || event.kind !== 'currentMode') return state;
  return {
    ...state,
    ancSupportedModes: event.supportedModes ?? state.ancSupportedModes,
    ancLevel: event.level ?? state.ancLevel,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/drivers/heymelody/state.test.ts`
Expected: PASS, all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/drivers/heymelody/state.ts src/drivers/heymelody/state.test.ts
git commit -m "feat(heymelody): device state, durable split, ANC notification reducer"
```

---

## Task 9: Device orchestration

**Files:**
- Create: `src/drivers/heymelody/device.ts`
- Test: `src/drivers/heymelody/device.test.ts`

**Interfaces:**
- Consumes: `HeyMelodyClient`, `HeyMelodyClientOptions` (Task 6); `Cmd`, `decodeProductId`, `decodeBattery`, `decodeAncNotification`, `decodeEqCurrent`, `decodeEqAll`, `encodeSetAncMode`, `encodeSetEqPreset` (Tasks 3-5); `catalogEntryFor` (Task 7); `HeyMelodyState`, `initialHeyMelodyState`, `HEYMELODY_SNAPSHOT_VERSION`, `applyDurable`, `applyAncEvent`, `HeyMelodyCapability` (Task 8); `DeviceSession`, `SessionHooks` from `@/core/session`; `StateStore`, `StateStoreHooks` from `@/core/stateStore`; `Persistable`, `SnapshotPayload` from `@/core/persistence`; `describeError` from `@/core/errors`; `isWebSerialSupported`, `openSerialTransport`, `isUnreachable`, `isBluetoothTarget` from `@/core/transport`; `TransportOpener`, `ConnectionTarget` from `@/core/transport`.
- Produces: `class HeyMelodyDevice implements Persistable` with `state`, `snapshotVersion`, `snapshot()`, `restore()`, `subscribe()`, `adoptPort(target)`, `disconnect()`, `refresh()`, `setAncMode(mode)`, `setEqPreset(eqId)`.

- [ ] **Step 1: Write the failing tests**

Create `src/drivers/heymelody/device.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { HeyMelodyDevice } from './device';
import { Cmd, replyFor } from './commands';
import { SppFrameCodec, encodeSppFrame } from './sppFrame';
import { FakeTransport } from '@/core/fakeTransport.test-helper';
import type { TransportOpener } from '@/core/transport';

/** `adoptPort` is the test entry point — `connect()` would need the picker. */
const port = {} as SerialPort;

/** A responder keyed by command id, built on the real codec so fixtures can't drift from Task 2/6. */
function heyMelodyOpener(replies: Map<number, number[]>): TransportOpener {
  return async (_port, handlers) => {
    const transport = new FakeTransport(handlers);
    const decoder = new SppFrameCodec().createDecoder();
    transport.onWrite = (bytes) => {
      const [frame] = decoder.push(bytes);
      if (!frame) return;
      const reply = replies.get(frame.cmd);
      if (reply === undefined) return;
      queueMicrotask(() => transport.receive(encodeSppFrame(replyFor(frame.cmd), frame.seq, reply)));
    };
    return transport;
  };
}

const FULL_REPLIES = new Map<number, number[]>([
  [Cmd.QueryProductId, [0x00, 0x10, 0xf0, 0x06]], // -> productId "06F010", OPPO Enco Air4s
  [Cmd.Battery, [0x01, 0x01, 0xd4]], // count=1, left, packed 0xD4 -> level 84, charging
  [Cmd.QueryAncDirect, [3, 1, 2, 50]], // outer=3, inner=1 (currentMode), mType=2, level=50
  [Cmd.QueryEqCurrent, [0x01, 0x00]],
  [Cmd.QueryEqAll, [0]], // zero presets — simplest valid payload
  [Cmd.RegisterNotify, []],
]);

describe('HeyMelodyDevice connect', () => {
  it('identifies the device via the catalog and reads battery/ANC/EQ', async () => {
    const device = new HeyMelodyDevice(heyMelodyOpener(FULL_REPLIES), { timeoutMs: 50 });
    await device.adoptPort(port);

    expect(device.state.status).toBe('connected');
    expect(device.state.info.productId).toBe('06F010');
    expect(device.state.info.catalog?.name).toBe('OPPO Enco Air4s');
    expect(device.state.info.catalog?.brand).toBe('oppo');
    // `model` is the catalog-resolved display name the sidebar/manager read
    // generically off every driver — see the note on `HeyMelodyInfo`.
    expect(device.state.info.model).toBe('OPPO Enco Air4s');
    expect(device.state.battery).toEqual([{ device: 'left', level: 84, charging: true }]);
    expect(device.state.ancLevel).toBe(50);
    expect(device.state.eqCurrentPreset).toBe(1);
    expect(device.state.capabilities).toEqual(new Set(['battery', 'anc', 'eq']));
  });

  it('tolerates every command going unanswered', async () => {
    const device = new HeyMelodyDevice(heyMelodyOpener(new Map()), { timeoutMs: 20 });
    await device.adoptPort(port);

    expect(device.state.status).toBe('connected');
    expect(device.state.info.productId).toBeNull();
    expect(device.state.info.catalog).toBeNull();
    expect(device.state.capabilities.size).toBe(0);
  });

  it('does not mark ANC as a capability when the direct-query response is not a currentMode DTO', async () => {
    // Exercises the documented risk (spec §6): 0x010C's response shape is
    // unconfirmed. A `reduction`-shaped reply must not be silently accepted
    // as ANC support.
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.QueryAncDirect, [3, 2, 1, 2, 0x0a, 0x00]); // a 'reduction' event, not 'currentMode'
    const device = new HeyMelodyDevice(heyMelodyOpener(replies), { timeoutMs: 50 });
    await device.adoptPort(port);

    expect(device.state.capabilities.has('anc')).toBe(false);
    expect(device.state.ancLevel).toBeNull();
  });
});

describe('HeyMelodyDevice live ANC updates', () => {
  it('applies an unsolicited 0x0204 notification', async () => {
    let transport!: FakeTransport;
    const open: TransportOpener = async (_p, handlers) => {
      transport = new FakeTransport(handlers);
      const decoder = new SppFrameCodec().createDecoder();
      transport.onWrite = (bytes) => {
        const [frame] = decoder.push(bytes);
        if (!frame) return;
        const reply = FULL_REPLIES.get(frame.cmd);
        if (reply === undefined) return;
        queueMicrotask(() => transport.receive(encodeSppFrame(replyFor(frame.cmd), frame.seq, reply)));
      };
      return transport;
    };
    const device = new HeyMelodyDevice(open, { timeoutMs: 50 });
    await device.adoptPort(port);
    expect(device.state.ancLevel).toBe(50);

    transport.receive(encodeSppFrame(Cmd.ActiveReport, 0x01, [3, 1, 2, 75]));
    expect(device.state.ancLevel).toBe(75);
  });
});

describe('HeyMelodyDevice writes', () => {
  it('setAncMode applies optimistically and rolls back on failure', async () => {
    const replies = new Map(FULL_REPLIES);
    // SetAncMode is left unanswered, so the client's own timeout rejects it.
    const device = new HeyMelodyDevice(heyMelodyOpener(replies), { timeoutMs: 20 });
    await device.adoptPort(port);
    const before = device.state.ancLevel;

    await device.setAncMode(3);

    expect(device.state.ancLevel).toBe(before);
    expect(device.state.error).not.toBeNull();
  });

  it('setEqPreset applies optimistically and keeps the value once acknowledged', async () => {
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.SetEqPreset, []);
    const device = new HeyMelodyDevice(heyMelodyOpener(replies), { timeoutMs: 50 });
    await device.adoptPort(port);

    await device.setEqPreset(2);

    expect(device.state.eqCurrentPreset).toBe(2);
    expect(device.state.error).toBeNull();
  });
});

describe('HeyMelodyDevice disconnect caching', () => {
  it('keeps showing the identified device after an unexpected drop', async () => {
    let transport!: FakeTransport;
    const open: TransportOpener = async (_p, handlers) => {
      transport = new FakeTransport(handlers);
      const decoder = new SppFrameCodec().createDecoder();
      transport.onWrite = (bytes) => {
        const [frame] = decoder.push(bytes);
        if (!frame) return;
        const reply = FULL_REPLIES.get(frame.cmd);
        if (reply === undefined) return;
        queueMicrotask(() => transport.receive(encodeSppFrame(replyFor(frame.cmd), frame.seq, reply)));
      };
      return transport;
    };
    const device = new HeyMelodyDevice(open, { timeoutMs: 50 });
    await device.adoptPort(port);
    expect(device.state.info.productId).toBe('06F010');

    transport.drop(new Error('The device has been lost.'));

    // Same fix as every other driver's onDrop/disconnect (see
    // src/drivers/sony/sony.ts, src/drivers/nothing/device.ts, etc.) —
    // applied here from the start rather than as a later bugfix.
    expect(device.state.status).toBe('disconnected');
    expect(device.state.info.productId).toBe('06F010');
    expect(device.state.info.catalog?.name).toBe('OPPO Enco Air4s');
    expect(device.state.info.model).toBe('OPPO Enco Air4s');
    // Live-only fields still reset.
    expect(device.state.battery).toEqual([]);
  });

  it('keeps showing the identified device after a manual disconnect', async () => {
    const device = new HeyMelodyDevice(heyMelodyOpener(FULL_REPLIES), { timeoutMs: 50 });
    await device.adoptPort(port);
    expect(device.state.info.productId).toBe('06F010');

    await device.disconnect();

    expect(device.state.status).toBe('disconnected');
    expect(device.state.info.productId).toBe('06F010');
    expect(device.state.info.model).toBe('OPPO Enco Air4s');
  });

  it('makes no claim about a device that was never identified', async () => {
    const device = new HeyMelodyDevice();
    await device.disconnect();
    expect(device.state.info.productId).toBeNull();
    expect(device.state.info.model).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/drivers/heymelody/device.test.ts`
Expected: FAIL — module `./device` does not exist.

- [ ] **Step 3: Implement**

Create `src/drivers/heymelody/device.ts`:

```ts
/**
 * Orchestration: owns the transport, the client and the observable state.
 *
 * Capability detection is opportunistic (spec §3.5) — `refresh()` tries
 * battery, ANC and EQ independently and tolerates each failing, building
 * `capabilities` from whichever actually answered. Mirrors
 * `drivers/nothing/device.ts`'s probing, not Sony's live bitmap negotiation,
 * since neither `0x0100`'s bit mapping nor `0x010D`'s reply shape was ever
 * captured for this protocol.
 */

import {
  Cmd,
  decodeAncNotification,
  decodeBattery,
  decodeEqAll,
  decodeEqCurrent,
  decodeProductId,
  encodeSetAncMode,
  encodeSetEqPreset,
} from './commands';
import type { HeyMelodyFrame } from './sppFrame';
import { HeyMelodyClient } from './client';
import { catalogEntryFor } from './catalog';
import {
  HEYMELODY_SNAPSHOT_VERSION,
  applyAncEvent,
  applyDurable,
  captureDurable,
  initialHeyMelodyState,
} from './state';
import type { HeyMelodyCapability, HeyMelodyState } from './state';
// Re-exported so `core/manager.ts` can import it from this module, the same
// way it imports every other driver's state type from that driver's main
// device file rather than reaching past it into an internal module.
export type { HeyMelodyState } from './state';
import {
  isBluetoothTarget,
  isUnreachable,
  isWebSerialSupported,
  openSerialTransport,
} from '@/core/transport';
import type { ConnectionTarget, TransportOpener } from '@/core/transport';
import { DeviceSession } from '@/core/session';
import type { SessionHooks } from '@/core/session';
import { StateStore } from '@/core/stateStore';
import type { StateStoreHooks } from '@/core/stateStore';
import { describeError } from '@/core/errors';
import type { Persistable, SnapshotPayload } from '@/core/persistence';

type Listener = (state: HeyMelodyState) => void;

export interface HeyMelodyDeviceOptions {
  /** Injected so tests do not pay `DEFAULT_TIMEOUT_MS` per unanswered command. */
  timeoutMs?: number;
}

const stateStoreHooks: StateStoreHooks<HeyMelodyState> = {
  isUnread: (state) => state.info.productId === null,
  isConnected: (state) => state.status === 'connected',
  capture: captureDurable,
  apply: (_state, payload) => applyDurable(payload),
};

export class HeyMelodyDevice implements Persistable {
  readonly #store: StateStore<HeyMelodyState>;
  readonly #session: DeviceSession<HeyMelodyClient>;
  readonly #timeoutMs?: number;
  #refreshing = false;

  constructor(openTransport: TransportOpener = openSerialTransport, options: HeyMelodyDeviceOptions = {}) {
    this.#timeoutMs = options.timeoutMs;
    this.#store = new StateStore(
      { ...initialHeyMelodyState, status: isWebSerialSupported() ? 'disconnected' : 'unsupported' },
      stateStoreHooks,
    );

    const hooks: SessionHooks<HeyMelodyClient> = {
      createClient: (transport) => new HeyMelodyClient(transport, { timeoutMs: this.#timeoutMs }),
      handleData: (client, chunk) => client.handleData(chunk),
      wire: (client) => {
        client.onNotification((frame) => this.#onNotification(frame));
      },
      onStatus: (status, error) => this.#patch({ status, error }),
      onDrop: (reason) =>
        this.#patch({
          ...initialHeyMelodyState,
          ...this.#lastKnownDurable(),
          status: 'disconnected',
          error: reason ? describeError(reason) : null,
        }),
      abort: (client, reason) => client.abort(reason),
    };
    this.#session = new DeviceSession(openTransport, hooks);
  }

  get state(): HeyMelodyState {
    return this.#store.state;
  }

  // --- Persistable ---------------------------------------------------------

  readonly snapshotVersion = HEYMELODY_SNAPSHOT_VERSION;

  snapshot(): SnapshotPayload | null {
    return this.#store.snapshot();
  }

  restore(payload: SnapshotPayload): void {
    this.#store.restore(payload);
  }

  subscribe(listener: Listener): () => void {
    return this.#store.subscribe(listener);
  }

  #patch(partial: Partial<HeyMelodyState>): void {
    this.#store.patch(partial);
  }

  #replace(next: HeyMelodyState): void {
    this.#store.replace(next);
  }

  /**
   * Identity and settings worth carrying across a disconnect, so the sidebar
   * keeps naming the device instead of collapsing to the generic "no device"
   * placeholder the instant the link drops — see
   * docs/superpowers/specs/2026-08-27-heymelody-driver-design.md and the
   * equivalent method on every other driver's device class.
   */
  #lastKnownDurable(): Partial<HeyMelodyState> {
    const durable = this.#store.snapshot();
    return durable ? applyDurable(durable) : {};
  }

  // --- connect ---------------------------------------------------------------

  /** Takes over a port the caller already obtained (serial only, this phase). */
  async adoptPort(target: ConnectionTarget): Promise<void> {
    if (isBluetoothTarget(target)) {
      this.#patch({ status: 'disconnected', error: 'BLE GATT is not implemented for HeyMelody yet.' });
      return;
    }
    try {
      await this.#session.connectTo(target, async () => {
        await this.#subscribe();
        await this.refresh();
      });
    } catch (error) {
      this.#patch({ status: 'disconnected', error: isUnreachable(error) ? null : describeError(error) });
    }
  }

  async #subscribe(): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    try {
      await client.request(Cmd.RegisterNotify);
    } catch (error) {
      // Payload shape for this command was never captured; a no-payload
      // request is this driver's own assumption. Losing the subscription
      // only means ANC/EQ changes made on the earbuds themselves are
      // invisible until the next refresh — it must not fail the connect.
      console.warn('[heymelody] RegisterNotify failed', error);
    }
  }

  #onNotification(frame: HeyMelodyFrame): void {
    if (frame.cmd === Cmd.ActiveReport) {
      this.#replace(applyAncEvent(this.#store.state, frame.payload));
    }
  }

  // --- refresh -----------------------------------------------------------

  async refresh(): Promise<void> {
    const client = this.#session.client;
    if (!client || this.#refreshing) return;
    this.#refreshing = true;
    try {
      await this.#refreshAll(client);
    } finally {
      this.#refreshing = false;
    }
  }

  async #refreshAll(client: HeyMelodyClient): Promise<void> {
    try {
      const { productId } = decodeProductId(await client.request(Cmd.QueryProductId));
      const catalog = catalogEntryFor(productId);
      // `info.model` is the catalog-resolved display name, not the raw
      // productId — `core/manager.ts`'s constructor loop reads
      // `state.info.model` generically off every driver (`rememberDeviceName`,
      // `Adoptable.subscribe`'s own type), so it must exist and be
      // human-readable here exactly like it does for every other driver.
      this.#patch({ info: { model: catalog?.name ?? null, productId, catalog } });
    } catch (error) {
      console.warn('[heymelody] QueryProductId failed', error);
    }

    const capabilities = new Set<HeyMelodyCapability>();

    const probe = async (capability: HeyMelodyCapability, run: () => Promise<void>) => {
      try {
        await run();
        capabilities.add(capability);
      } catch (error) {
        console.warn(`[heymelody] ${capability} unavailable`, error);
      }
    };

    await probe('battery', async () => {
      this.#patch({ battery: decodeBattery(await client.request(Cmd.Battery)) });
    });

    await probe('anc', async () => {
      const event = decodeAncNotification(await client.request(Cmd.QueryAncDirect));
      // A response that does not decode as `currentMode` is treated as "ANC
      // unsupported/unrecognised" rather than guessed at — 0x010C's exact
      // reply shape was never independently confirmed (spec §6).
      if (!event || event.kind !== 'currentMode') throw new Error('unrecognised ANC response shape');
      this.#patch({
        ancSupportedModes: event.supportedModes ?? this.#store.state.ancSupportedModes,
        ancLevel: event.level ?? this.#store.state.ancLevel,
      });
    });

    await probe('eq', async () => {
      this.#patch({ eqCurrentPreset: decodeEqCurrent(await client.request(Cmd.QueryEqCurrent)) });
      this.#patch({ eqPresets: decodeEqAll(await client.request(Cmd.QueryEqAll)) });
    });

    this.#patch({ capabilities });
  }

  // --- writes ----------------------------------------------------------------

  async setAncMode(mode: number): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    const previous = this.#store.state.ancLevel;
    this.#patch({ ancLevel: mode });
    try {
      await client.request(Cmd.SetAncMode, encodeSetAncMode(mode));
    } catch (error) {
      this.#patch({ ancLevel: previous, error: describeError(error) });
    }
  }

  async setEqPreset(eqId: number): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    const previous = this.#store.state.eqCurrentPreset;
    this.#patch({ eqCurrentPreset: eqId });
    try {
      await client.request(Cmd.SetEqPreset, encodeSetEqPreset(eqId));
    } catch (error) {
      this.#patch({ eqCurrentPreset: previous, error: describeError(error) });
    }
  }

  // --- teardown ----------------------------------------------------------

  async disconnect(): Promise<void> {
    const durable = this.#lastKnownDurable();
    const closed = this.#session.disconnect();
    this.#patch({ ...initialHeyMelodyState, ...durable, status: 'disconnected' });
    await closed;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/drivers/heymelody/device.test.ts`
Expected: PASS, all 8 tests.

- [ ] **Step 5: Run the full suite and type-check**

Run: `npx vitest run && npx tsc -b`
Expected: every test file passes; `tsc -b` still fails with exactly the one pre-existing error from Task 1 Step 6 (`core/profiles.ts` missing `IMPLEMENTED.heymelody`) — Task 10 fixes that.

- [ ] **Step 6: Commit**

```bash
git add src/drivers/heymelody/device.ts src/drivers/heymelody/device.test.ts
git commit -m "feat(heymelody): device orchestration with disconnect-caching from the start"
```

---

## Task 10: Driver descriptor, artwork, and core registration

**Files:**
- Create: `src/drivers/heymelody/assets.ts`
- Create: `src/drivers/heymelody/driver.ts`
- Modify: `src/core/profiles.ts` (add `IMPLEMENTED.heymelody`)
- Modify: `src/core/driver.ts` (import/re-export/`DriverId`/`DRIVERS`)
- Modify: `src/core/manager.ts` (`ActiveDevice`, `#heymelody` field, `active` getter branch)
- Modify: `src/ui/device/summary.ts` (a `heymelody` branch — required for the union to type-check, not optional polish)

**Interfaces:**
- Consumes: `HeyMelodyDevice`, `HeyMelodyState` (Task 9); `HeyMelodyCapability` (Task 8); `DeviceArtwork` from `@/core/artwork`; `DeviceDriver`, `DriverSection` from `@/core/driver`; `servicesFor` from `@/core/transport`; `Feature` (`F`) from `@/core/profiles`.
- Produces: `heymelodyArtwork(): DeviceArtwork`; `HEYMELODY_DRIVER` satisfying `DeviceDriver<HeyMelodyDevice, HeyMelodyState>`; `Brand`/`DriverId` widened; `manager.active` covers `'heymelody'`.

This task has no new unit test of its own — it is wiring, and this repo's own `core/manager.test.ts` ("every entry in DRIVERS is fully wired") and `core/driver.test.ts` already generically exercise any new `DRIVERS` entry. Verification is running those, not writing new ones.

- [ ] **Step 1: Write the artwork placeholder**

Create `src/drivers/heymelody/assets.ts`:

```ts
import type { DeviceArtwork } from '@/core/artwork';

/**
 * No per-model artwork exists for this driver yet — 137 devices across 3
 * brands, and the app's own product images are cloud-served rather than
 * bundled (spec §2 non-goals). Empty `hero`/`heroInactive` deliberately route
 * `DeviceImage` into its existing "Product art unavailable" placeholder
 * (`ui/device/DeviceImage.tsx`'s `src === ''` branch) rather than pointing at
 * an asset that does not exist. Replace once real per-model renders are
 * sourced.
 */
export function heymelodyArtwork(): DeviceArtwork {
  return { hero: '', heroInactive: '', aspect: 1 };
}
```

- [ ] **Step 2: Write the driver descriptor**

First, write the three section components this descriptor references — done in Task 11, but `driver.ts` cannot compile without them existing. Create minimal stand-ins now (Task 11 fills them in for real, so this step's content is temporary by construction, not a "TODO" — every driver's own history shows sections landing after the descriptor that names them):

Create `src/drivers/heymelody/sections/Noise.tsx`:

```tsx
export function HeyMelodyNoise() {
  return null;
}
```

Create `src/drivers/heymelody/sections/Sound.tsx`:

```tsx
export function HeyMelodySound() {
  return null;
}
```

Create `src/drivers/heymelody/sections/System.tsx`:

```tsx
export function HeyMelodySystem() {
  return null;
}
```

Create `src/drivers/heymelody/driver.ts`:

```ts
/**
 * The HeyMelody driver descriptor — OPPO/realme/OnePlus earbuds sharing one
 * app and protocol. Capability gating runs off the opportunistically-probed
 * set (`device.ts`), the same shape as `drivers/nothing/driver.ts`, not
 * Sony's live bitmap negotiation — see spec §3.5 for why.
 */

import type { DeviceDriver, DriverSection } from '@/core/driver';
import { servicesFor } from '@/core/transport';
import { heymelodyArtwork } from './assets';
import { HeyMelodyDevice } from './device';
import type { HeyMelodyState } from './device';
import type { BatteryDevice } from './commands';
import { HeyMelodyNoise } from './sections/Noise';
import { HeyMelodySound } from './sections/Sound';
import { HeyMelodySystem } from './sections/System';

const HEYMELODY_SECTIONS: DriverSection[] = [
  { id: 'noise', label: 'Noise control' },
  { id: 'sound', label: 'Sound' },
  { id: 'system', label: 'System' },
];

const COMPONENTS = {
  noise: HeyMelodyNoise,
  sound: HeyMelodySound,
  system: HeyMelodySystem,
} as const;

const BATTERY_LABEL: Record<BatteryDevice, string> = { left: 'Left', right: 'Right', case: 'Case' };

export const HEYMELODY_DRIVER = {
  id: 'heymelody',
  label: 'HeyMelody (OPPO / realme / OnePlus)',
  brand: 'heymelody',
  services: servicesFor('heymelody'),
  profiles: [],
  create: (deps) => new HeyMelodyDevice(deps.openTransport),
  sections: (state) => {
    // Before a probe has run, keep every tab rather than hiding one about to appear.
    const known = state.capabilities.size > 0;
    return HEYMELODY_SECTIONS.filter((section) => {
      if (section.id === 'noise') return !known || state.capabilities.has('anc');
      if (section.id === 'sound') return !known || state.capabilities.has('eq');
      return true;
    });
  },
  components: COMPONENTS,
  codecName: (_state: HeyMelodyState) => null,
  statusLine: (state: HeyMelodyState) => {
    if (state.battery.length === 0) return null;
    return state.battery
      .map((cell) => `${BATTERY_LABEL[cell.device]} ${cell.level}%${cell.charging ? ' ⚡' : ''}`)
      .join(' · ');
  },
  // No wear-detection command modeled this phase — true-when-unknown per the interface's own contract.
  worn: (_state: HeyMelodyState) => true,
  artwork: (_state: HeyMelodyState) => heymelodyArtwork(),
} as const satisfies DeviceDriver<HeyMelodyDevice, HeyMelodyState>;
```

(use this instead of the `./device` import shown above).

- [ ] **Step 3: Register the brand's feature vocabulary**

In `src/core/profiles.ts`, add to `IMPLEMENTED` (any position — it is a `Record`, not an ordered list):

```ts
heymelody: [F.Anc, F.Equalizer],
```

Only these two: phase A's sections render ANC mode selection and EQ preset selection, nothing else — claiming a feature this driver does not actually drive would contradict this file's own stated purpose ("what can this app drive").

- [ ] **Step 4: Register the descriptor in the core registry**

In `src/core/driver.ts`:

Add to the import block near the top:

```ts
import { HEYMELODY_DRIVER } from '@/drivers/heymelody/driver';
```

Add to the re-export block:

```ts
export { HEYMELODY_DRIVER } from '@/drivers/heymelody/driver';
```

Extend `DriverId`:

```ts
export type DriverId =
  | typeof SENNHEISER_DRIVER.id
  | typeof SONY_DRIVER.id
  | typeof NOTHING_DRIVER.id
  | typeof SOUNDCORE_DRIVER.id
  | typeof HEYMELODY_DRIVER.id;
```

Extend `DRIVERS`:

```ts
export const DRIVERS: readonly DeviceDriver<never, never>[] = [
  SENNHEISER_DRIVER,
  SONY_DRIVER,
  NOTHING_DRIVER,
  SOUNDCORE_DRIVER,
  HEYMELODY_DRIVER,
] as unknown as readonly DeviceDriver<never, never>[];
```

- [ ] **Step 5: Wire the manager**

In `src/core/manager.ts`:

Add imports beside the existing driver/device/state imports:

```ts
import { HEYMELODY_DRIVER } from '@/drivers/heymelody/driver';
import { HeyMelodyDevice } from '@/drivers/heymelody/device';
import type { HeyMelodyState } from '@/drivers/heymelody/device';
```

(If Step 2's note above is followed, `HeyMelodyState` is exported from `device.ts` already — confirm it is, since `ActiveDevice` below needs it.)

Extend `ActiveDevice`:

```ts
export type ActiveDevice =
  | { id: Extract<DriverId, 'sennheiser-gaia'>; driver: typeof SENNHEISER_DRIVER; device: MomentumDevice; state: DeviceState }
  | { id: Extract<DriverId, 'sony-mdr'>; driver: typeof SONY_DRIVER; device: SonyDevice; state: SonyState }
  | { id: Extract<DriverId, 'nothing-spp'>; driver: typeof NOTHING_DRIVER; device: NothingDevice; state: NothingState }
  | { id: Extract<DriverId, 'soundcore-gatt'>; driver: typeof SOUNDCORE_DRIVER; device: SoundcoreDevice; state: SoundcoreState }
  | { id: Extract<DriverId, 'heymelody'>; driver: typeof HEYMELODY_DRIVER; device: HeyMelodyDevice; state: HeyMelodyState };
```

Add the concrete field beside `#sennheiser`/`#sony`/`#nothing`/`#soundcore`:

```ts
readonly #heymelody = this.#devices[HEYMELODY_DRIVER.id] as HeyMelodyDevice;
```

Add a branch to the `active` getter, before the final `return` (which stays Sennheiser's fallback):

```ts
if (driverId === HEYMELODY_DRIVER.id) {
  return {
    id: HEYMELODY_DRIVER.id,
    driver: HEYMELODY_DRIVER,
    device: this.#heymelody,
    state: this.#heymelody.state,
  };
}
```

- [ ] **Step 6: Add the `ui/device/summary.ts` branch**

`summary.ts`'s `summarise()` function branches explicitly on `active.id` for
`'soundcore-gatt'`, `'nothing-spp'` and `'sony-mdr'`, then falls through to a
final, unconditioned block that assumes **Sennheiser's** state shape
(`state.charging`, among other Sennheiser-only fields). Without an explicit
`'heymelody'` branch, `HeyMelodyState` would silently widen `active` in that
final block and fail to compile (`state.charging` does not exist on
`HeyMelodyState`) — this is not optional wiring, the build does not pass
without it.

In `src/ui/device/summary.ts`, add a branch before the final `return`
(matching the existing branches' structure — see `active.id === 'nothing-spp'`
just above it for the pattern):

```ts
if (active.id === 'heymelody') {
  const { driver, state } = active
  return {
    model: state.info.model ?? fallbackName(state.status, 'HeyMelody earbuds'),
    hasDevice: state.info.model !== null,
    battery: state.battery.length ? Math.min(...state.battery.map((cell) => cell.level)) : null,
    charging: state.battery.some((cell) => cell.charging),
    codec: driver.codecName(state),
    detail: driver.statusLine(state),
    artwork: driver.artwork(state),
    worn: driver.worn(state),
  }
}
```

This must be added as its own `if` block above the final unconditioned
Sennheiser block, in the same style as the `soundcore-gatt`/`nothing-spp`/
`sony-mdr` branches — not folded into that final block, which stays
Sennheiser's alone.

- [ ] **Step 7: Run the generic wiring tests**

Run: `npx vitest run src/core/manager.test.ts src/core/driver.test.ts src/core/profiles.test.ts src/core/transport.test.ts`
Expected: PASS — in particular, `manager.test.ts`'s "every entry in `DRIVERS` is fully wired" test now also covers HeyMelody, and would fail if the `active` getter branch in Step 5 were missing or wrong.

- [ ] **Step 8: Full verification**

Run: `npx vitest run && npx tsc -b && npm run lint`
Expected: everything green — this is the first point in the plan where `tsc -b` has no outstanding error (Task 1's expected failure is now resolved by Step 3 above).

- [ ] **Step 9: Commit**

```bash
git add src/drivers/heymelody/assets.ts src/drivers/heymelody/driver.ts \
  src/drivers/heymelody/sections/Noise.tsx src/drivers/heymelody/sections/Sound.tsx \
  src/drivers/heymelody/sections/System.tsx \
  src/core/profiles.ts src/core/driver.ts src/core/manager.ts src/ui/device/summary.ts
git commit -m "feat(heymelody): register the driver descriptor and wire it into core"
```

---

## Task 11: UI sections

**Files:**
- Modify: `src/drivers/heymelody/sections/Noise.tsx` (replaces Task 10's stand-in)
- Modify: `src/drivers/heymelody/sections/Sound.tsx` (replaces Task 10's stand-in)
- Modify: `src/drivers/heymelody/sections/System.tsx` (replaces Task 10's stand-in)

**Interfaces:**
- Consumes: `HeyMelodyDevice`, `HeyMelodyState` (Task 9); `BatteryDevice` (Task 3); `OEM_BRAND_NAME` (Task 7); `BatteryBar` from `@/ui/device/DeviceImage`; `Card`/`CardHeader`/`CardTitle`/`CardContent` from `@/components/ui/card`; `cn` from `@/lib/utils`.
- Produces: the three real section components `driver.ts`'s `COMPONENTS` map already points at — no signature change, so Task 10's wiring needs no edit.

No new test file — this repo's own convention already settles that: Nothing's three section components (`sections/NothingNoise.tsx`, `NothingSound.tsx`, `NothingSystem.tsx`) have no test files of their own, unlike its `commands.ts`/`device.ts`, which do. The logic worth testing (capability gating, decode/encode, optimistic writes) already has full coverage at the state/device layer from Tasks 3-9; these components only render it. Verification for this task is `tsc -b`, `npm run lint`, and a manual check in the running app (see Step 5).

- [ ] **Step 1: Noise control (ANC)**

Replace `src/drivers/heymelody/sections/Noise.tsx`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { HeyMelodyDevice, HeyMelodyState } from '../device'

interface Props {
  device: HeyMelodyDevice
  state: HeyMelodyState
}

export function HeyMelodyNoise({ device, state }: Props) {
  const disabled = state.status !== 'connected'

  if (!state.capabilities.has('anc')) {
    return (
      <Card data-size="sm">
        <CardContent>
          <p className="text-muted-foreground text-sm">This device reports no noise control.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card data-size="sm">
      <CardHeader>
        <CardTitle>Noise control</CardTitle>
      </CardHeader>
      <CardContent>
        {state.ancSupportedModes === null || state.ancSupportedModes.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {state.status === 'connected'
              ? 'The device did not answer the noise control query.'
              : 'Connect to load noise control.'}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {state.ancSupportedModes.map((mode) => (
              <button
                key={mode}
                type="button"
                disabled={disabled}
                aria-pressed={state.ancLevel === mode}
                onClick={() => void device.setAncMode(mode)}
                className={cn(
                  'flex flex-col gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-colors',
                  'focus-visible:ring-ring outline-none focus-visible:ring-2',
                  'disabled:cursor-default disabled:opacity-50',
                  state.ancLevel === mode
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-muted-foreground/40',
                )}
              >
                {/* The device reports which mode indices exist but never
                    names them, and the bit-index -> label mapping was never
                    captured (spec §7) — a numbered mode is the honest label
                    until that mapping is confirmed against hardware. */}
                <span className="text-sm font-medium">Mode {mode}</span>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 2: Sound (EQ)**

Replace `src/drivers/heymelody/sections/Sound.tsx`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { HeyMelodyDevice, HeyMelodyState } from '../device'

interface Props {
  device: HeyMelodyDevice
  state: HeyMelodyState
}

export function HeyMelodySound({ device, state }: Props) {
  const disabled = state.status !== 'connected'

  if (!state.capabilities.has('eq')) {
    return (
      <Card data-size="sm">
        <CardContent>
          <p className="text-muted-foreground text-sm">This device reports no equalizer.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card data-size="sm">
      <CardHeader>
        <CardTitle>Equalizer</CardTitle>
      </CardHeader>
      <CardContent>
        {state.eqPresets.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {state.status === 'connected'
              ? 'The device did not return an EQ preset list.'
              : 'Connect to load the equalizer.'}
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {state.eqPresets.map((preset) => (
              <button
                key={preset.eqId}
                type="button"
                disabled={disabled}
                aria-pressed={preset.isSelected}
                onClick={() => void device.setEqPreset(preset.eqId)}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                  'focus-visible:ring-ring outline-none focus-visible:ring-2',
                  'disabled:cursor-default disabled:opacity-50',
                  preset.isSelected
                    ? 'border-primary bg-primary/10 font-medium'
                    : 'border-border hover:border-muted-foreground/40',
                )}
              >
                {preset.name}
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 3: System (device info + battery)**

Replace `src/drivers/heymelody/sections/System.tsx`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BatteryBar } from '@/ui/device/DeviceImage'
import { OEM_BRAND_NAME } from '../catalog'
import type { HeyMelodyState } from '../device'
import type { BatteryDevice } from '../commands'

interface Props {
  state: HeyMelodyState
}

const BATTERY_LABEL: Record<BatteryDevice, string> = { left: 'Left', right: 'Right', case: 'Case' }

export function HeyMelodySystem({ state }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <Card data-size="sm">
        <CardHeader>
          <CardTitle>Device</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm">
          <p>
            <span className="text-muted-foreground">Model </span>
            {state.info.catalog?.name ?? 'Unknown'}
          </p>
          <p>
            <span className="text-muted-foreground">Brand </span>
            {state.info.catalog ? OEM_BRAND_NAME[state.info.catalog.brand] : 'Unknown'}
          </p>
          <p>
            <span className="text-muted-foreground">Product ID </span>
            {state.info.productId ?? '—'}
          </p>
        </CardContent>
      </Card>

      {state.battery.length > 0 && (
        <Card data-size="sm">
          <CardHeader>
            <CardTitle>Battery</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {state.battery.map((cell) => (
              <div key={cell.device} className="flex flex-col gap-1">
                <span className="text-muted-foreground text-xs">
                  {BATTERY_LABEL[cell.device]}
                  {cell.charging && ' · Charging'}
                </span>
                <BatteryBar battery={cell.level} charging={cell.charging} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc -b && npm run lint`
Expected: clean. `HeyMelodyDevice` must be exported from `device.ts` as a named export for this step's `import type { HeyMelodyDevice, HeyMelodyState } from '../device'` to resolve — it already is (Task 9's `export class HeyMelodyDevice`).

- [ ] **Step 5: Manual check in the running app**

Run: `npm run dev`, open the app, and confirm from the sidebar: with no device connected, HeyMelody does not appear anywhere by default (no granted port yet); the "Connect over serial" picker (Web Serial requires a user gesture, so this cannot be scripted) lists a HeyMelody device once one is paired at the OS level and physically present — this step cannot be completed without real hardware, so record it as a known gap rather than checking it off falsely if none is available yet.

- [ ] **Step 6: Full suite one more time**

Run: `npx vitest run && npx tsc -b && npm run lint`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/drivers/heymelody/sections/Noise.tsx src/drivers/heymelody/sections/Sound.tsx \
  src/drivers/heymelody/sections/System.tsx
git commit -m "feat(heymelody): noise, sound and system sections"
```

---

## Plan-level verification

After Task 11, run once more from the repo root:

```bash
npx vitest run
npx tsc -b
npm run lint
```

All three must be clean. This phase ships with **no real hardware validation** — every byte layout is either APK-confirmed, corroborated-but-unverified, or this driver's own documented assumption (spec §6). The first real device should be checked against, in order: the SPP inner body layout (§3.2), the `0x010C` direct-ANC-query response shape (currently assumed to match the `0x0204` DTOs), and the set-ANC/set-EQ payload shapes (currently single-byte assumptions).
