# HeyMelody Full TL-Protocol Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the HeyMelody driver's transport with the vendor code and add every feature whose wire format the vendor apps document (version, in-ear, live battery, find, custom EQ curves, realme noise names), gated on the device's own capability bitmap.

**Architecture:** One driver serves OPPO, OnePlus and realme (same BBK "TL" btsdk). Pure encode/decode modules move into `src/drivers/heymelody/protocol/`; `device.ts` orchestrates a bootstrap (`0x0100` bitmap, productId, colour), then polls only what the bitmap reports, falling back to today's probing when there is no bitmap. Pushes (`0x0204` events, `0x0504`, `0x0506`) update state live.

**Tech Stack:** TypeScript (strict), React 19, Vite, Vitest, oxlint, Base UI (`@/components/ui/*`), Python 3 for generator scripts.

**Spec:** `docs/superpowers/specs/2026-09-27-heymelody-full-support-design.md`

## Global Constraints

- Sources of truth, in order: realme Link 5.5.514's own code, then HeyMelody 116.9.0's; citations name the vendor class and method. GPL reimplementations are read-only references; never port their code.
- Every byte-layout test cites the vendor file and line it was derived from.
- `npx tsc -b`, `npx oxlint src/drivers/heymelody`, and `npx vitest run` must all pass at every checkpoint.
- **Never commit without the user's explicit go-ahead** (standing user rule; overrides this skill's "commit" steps). Each task ends with a checkpoint, not a commit.
- No backwards-compatibility shims or re-exports: when a module moves, update every importer.
- Code comments: none by default; one short line only where the why is non-obvious (a vendor quirk, an active-low bit).
- Live-only state (battery, wear, finding) is never persisted; identity and settings are (`captureDurable`).

## Review Focus

1. **A generic standard-SPP port from a non-HeyMelody device** is picked (e.g. a Sony's extra SPP service): connect must end with a clear "This does not look like a HeyMelody or realme device." error, not silence or a hang. → Task 5, test "flags a port that answers neither identity query".
2. **A multi-frame run broken mid-way** (a new first/single frame arrives before the last): the partial run is discarded and decoding continues with the next frames. → Task 1, test "discards a broken multi-frame run".
3. **A capability bitmap shorter or longer than the 61-row table**: missing bits read as unsupported, bits beyond the table are ignored, never thrown on. → Task 3, test "treats a short bitmap as unsupported and ignores bits past the table".
4. **Two quick EQ-curve writes where the second fails**: state rolls back to the last curve the device confirmed, not to the pre-first-write curve. → Task 10, test "rolls back a failed curve write to the last confirmed curve".
5. **Disconnect while find-my-earbuds is ringing**: `finding` resets to false, so the next connect doesn't show "Stop ringing". → Task 8, test "stops showing ringing after a drop".

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/drivers/heymelody/sppFrame.ts` (modify) | Link frame: FSN multi-frame reassembly, 2000-byte cap, full-range `seq` | 1 |
| `src/drivers/heymelody/protocol/cmd.ts` (create) | Command ids, `replyFor` | 2 |
| `src/drivers/heymelody/protocol/status.ts` (create) | Shared status gate `statusBody()` | 2 |
| `src/drivers/heymelody/protocol/identity.ts` (create) | productId, colour, firmware version | 2, 6 |
| `src/drivers/heymelody/protocol/battery.ts` (create) | Battery decode, device-type table | 2 |
| `src/drivers/heymelody/protocol/anc.ts` (create) | ANC decode/encode | 2, 9 |
| `src/drivers/heymelody/protocol/eq.ts` (create) | EQ decode/encode incl. curve write | 2, 10 |
| `src/drivers/heymelody/protocol/notify.ts` (create) | Notification handshake, push event ids | 2 |
| `src/drivers/heymelody/protocol/capability.ts` (create) | 61-row bitmap table, feature mapping | 3 |
| `src/drivers/heymelody/protocol/wear.ts` (create) | In-ear decode | 7 |
| `src/drivers/heymelody/commands.ts` + `.test.ts` (delete) | replaced by `protocol/` | 2 |
| `src/core/transport.ts` (modify) | Standard SPP UUID, generic services sort last | 4 |
| `src/drivers/heymelody/device.ts` (modify) | Bootstrap, capability-gated polling, pushes, new writes | 5–10 |
| `src/drivers/heymelody/state.ts` (modify) | New state fields | 5–8 |
| `src/drivers/heymelody/driver.ts` (modify) | Section gating, `worn` | 5, 7 |
| `src/drivers/heymelody/sections/System.tsx` (modify) | Version, wear labels, find card | 6–8 |
| `src/drivers/heymelody/sections/Sound.tsx` (modify) | Custom curve sliders | 10 |
| `src/drivers/heymelody/sections/sections.render.test.tsx` (create) | Render tests for the sections | 6–10 |
| `docs/reference/realme-models.json` (create) | realme per-model noise items, committed reference data | 9 |
| `scripts/gen-heymelody-catalog.py` (modify) | Synthesize `noiseReductionMode` for realme models | 9 |

---

### Task 1: Frame codec alignment

**Files:**
- Modify: `src/drivers/heymelody/sppFrame.ts`
- Test: `src/drivers/heymelody/sppFrame.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: unchanged exports (`encodeSppFrame`, `nextSeq`, `SppFrameDecoder`, `SppFrameCodec`, `FrameCodec`, `HeyMelodyFrame`); `nextSeq` now wraps `0xFF → 0x00`; the decoder reassembles FSN runs.

Vendor facts (realme `OPPOv1Wrapper.java:65-98`): control byte at `1 + lengthBytes`; `fsn = ctrl & 3`; single frame (`fsn 0`) data starts after `ctrl, 00`; every multi-frame part (`fsn 1/2/3`) data starts after `ctrl, 00, counter`; the run completes at `fsn 3`; parts concatenate and are parsed once as `cmd(2 LE) seq payLen(2 LE) payload`. Max frame 2000 (`:29-31`). `seq` is a full `0x00–0xFF` counter (HeyTap `p072f7/b.java:26-45`).

- [ ] **Step 1: Write the failing tests** — append to `sppFrame.test.ts`, and replace the `nextSeq` describe block:

```ts
/** A link frame around a raw body, for bodies under 128 bytes. */
const link = (body: number[]): Uint8Array => Uint8Array.from([0xaa, body.length, ...body]);
/** The inner packet: cmd(2 LE) seq payLen(2 LE) payload. */
const packet = (cmd: number, seq: number, payload: number[]): number[] => [
  cmd & 0xff, (cmd >> 8) & 0xff, seq, payload.length & 0xff, (payload.length >> 8) & 0xff, ...payload,
];

describe('SppFrameDecoder multi-frame runs (OPPOv1Wrapper.java:65-98)', () => {
  it('reassembles a first/middle/last run into one packet', () => {
    const whole = packet(0x8122, 0x07, [0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
    const decoder = new SppFrameCodec().createDecoder();
    expect(decoder.push(link([0x01, 0x00, 0x00, ...whole.slice(0, 4)]))).toEqual([]);
    expect(decoder.push(link([0x02, 0x00, 0x01, ...whole.slice(4, 8)]))).toEqual([]);
    const frames = decoder.push(link([0x03, 0x00, 0x02, ...whole.slice(8)]));
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ cmd: 0x8122, seq: 0x07, lengthOk: true });
    expect(Array.from(frames[0].payload)).toEqual([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
  });

  it('reassembles a two-part run (first then last)', () => {
    const whole = packet(0x8106, 0x01, [0x00, 0x01, 0x01, 0x54]);
    const decoder = new SppFrameCodec().createDecoder();
    decoder.push(link([0x01, 0x00, 0x00, ...whole.slice(0, 5)]));
    const frames = decoder.push(link([0x03, 0x00, 0x01, ...whole.slice(5)]));
    expect(frames).toHaveLength(1);
    expect(Array.from(frames[0].payload)).toEqual([0x00, 0x01, 0x01, 0x54]);
  });

  it('discards a broken multi-frame run and keeps decoding', () => {
    const decoder = new SppFrameCodec().createDecoder();
    decoder.push(link([0x01, 0x00, 0x00, 0x22, 0x81, 0x01]));
    // A single frame interrupts the run: the partial is dropped, the single decodes.
    const single = decoder.push(link([0x00, 0x00, ...packet(0x8106, 0x02, [0x00, 0x00])]));
    expect(single).toHaveLength(1);
    expect(single[0].cmd).toBe(0x8106);
    // A stray last-part with no run in progress is ignored.
    expect(decoder.push(link([0x03, 0x00, 0x05, 0x01, 0x02]))).toEqual([]);
  });

  it('accepts frames up to the vendor 2000-byte cap', () => {
    const payload = Array.from({ length: 1500 }, (_, i) => i & 0xff);
    const frame = encodeSppFrame(0x8122, 0x03, payload);
    const frames = new SppFrameCodec().createDecoder().push(frame);
    expect(frames).toHaveLength(1);
    expect(frames[0].payload).toHaveLength(1500);
  });
});

describe('nextSeq', () => {
  it('increments over the full byte range and wraps 0xFF to 0x00 (p072f7/b.java:26-45)', () => {
    expect(nextSeq(0x00)).toBe(0x01);
    expect(nextSeq(0xfe)).toBe(0xff);
    expect(nextSeq(0xff)).toBe(0x00);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/drivers/heymelody/sppFrame.test.ts`. Expected: the multi-frame tests, the 1500-byte test and `nextSeq` fail.

- [ ] **Step 3: Implement** — in `sppFrame.ts` replace the constants, `encodeSppFrame`'s `...RESERVED`, `nextSeq`, and the decoder:

```ts
const SYNC = 0xaa;
/** `ctrl` (single frame, FSN 0) and the reserved byte that follows it. */
const SINGLE_FRAME_PREFIX = [0x00, 0x00];
const PACKET_HEADER_LENGTH = 5; // cmd(2) + seq(1) + payLen(2)
const MAX_BODY_LENGTH = 2000;
```

In `encodeSppFrame`, replace `...RESERVED,` with `...SINGLE_FRAME_PREFIX,`.

```ts
export function nextSeq(current: number): number {
  return (current + 1) & 0xff;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function parsePacket(packet: Uint8Array): HeyMelodyFrame | null {
  if (packet.length < PACKET_HEADER_LENGTH) return null;
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  const payload = packet.slice(PACKET_HEADER_LENGTH);
  return { cmd: view.getUint16(0, true), seq: packet[2], payload, lengthOk: view.getUint16(3, true) === payload.length };
}

export class SppFrameDecoder {
  #buffer = new Uint8Array(0);
  #partial: Uint8Array | null = null;

  push(chunk: Uint8Array): HeyMelodyFrame[] {
    this.#buffer = concat(this.#buffer, chunk);
    const frames: HeyMelodyFrame[] = [];

    for (;;) {
      const start = this.#buffer.indexOf(SYNC);
      if (start === -1) {
        this.#buffer = new Uint8Array(0);
        break;
      }
      if (start > 0) this.#buffer = this.#buffer.slice(start);
      if (this.#buffer.length < 2) break;

      const firstLenByte = this.#buffer[1];
      const twoByteLength = (firstLenByte & 0x80) !== 0;
      const headerLength = twoByteLength ? 3 : 2;
      if (this.#buffer.length < headerLength) break;

      const bodyLength = twoByteLength
        ? (firstLenByte & 0x7f) | ((this.#buffer[2] & 0x7f) << 7)
        : firstLenByte & 0x7f;
      if (bodyLength > MAX_BODY_LENGTH) {
        // Implausible — this 0xAA was data, not a real sync byte.
        this.#buffer = this.#buffer.slice(1);
        continue;
      }

      const total = headerLength + bodyLength;
      if (this.#buffer.length < total) break;
      const body = this.#buffer.slice(headerLength, total);
      this.#buffer = this.#buffer.slice(total);

      const packet = this.#assemble(body);
      const frame = packet ? parsePacket(packet) : null;
      if (frame) frames.push(frame);
    }
    return frames;
  }

  /** The complete packet once a frame (or the last part of a run) completes it. */
  #assemble(body: Uint8Array): Uint8Array | null {
    if (body.length < 2) return null;
    const fsn = body[0] & 0x03;
    if (fsn === 0) {
      this.#partial = null;
      return body.slice(2);
    }
    if (body.length < 3) return null;
    const part = body.slice(3); // ctrl, reserved, frame counter
    if (fsn === 1) {
      this.#partial = part;
      return null;
    }
    if (!this.#partial) return null;
    this.#partial = concat(this.#partial, part);
    if (fsn === 2) return null;
    const packet = this.#partial;
    this.#partial = null;
    return packet;
  }

  reset(): void {
    this.#buffer = new Uint8Array(0);
    this.#partial = null;
  }
}
```

Update the file's top comment body line to `body = ctrl(1) | reserved(1) | [frame counter, multi-frame only] | packet`, and delete the old `RESERVED`/`BODY_HEADER_LENGTH` constants.

- [ ] **Step 4: Run** — `npx vitest run src/drivers/heymelody/`. Expected: all pass (the existing stray-`0xAA` test still passes: `0xff 0x7f` decodes to 16383 > 2000).

- [ ] **Step 5: Checkpoint** — `npx tsc -b && npx oxlint src/drivers/heymelody && npx vitest run`, all green. No commit.

---

### Task 2: Split `commands.ts` into `protocol/`

**Files:**
- Create: `src/drivers/heymelody/protocol/{cmd,status,identity,battery,anc,eq,notify}.ts` and matching `.test.ts` for `identity, battery, anc, eq, notify, status`
- Delete: `src/drivers/heymelody/commands.ts`, `src/drivers/heymelody/commands.test.ts`
- Modify importers: `client.ts`, `device.ts`, `state.ts`, `driver.ts`, `sections/System.tsx`, `device.test.ts`, `client.test.ts`

**Interfaces:**
- Produces (exact names, used by every later task):
  - `protocol/cmd.ts`: `Cmd`, `replyFor(cmd: number): number`
  - `protocol/status.ts`: `statusBody(payload: Uint8Array, what: string): Uint8Array`
  - `protocol/identity.ts`: `ProductIdReply`, `decodeProductId`, `decodeColourId`
  - `protocol/battery.ts`: `BatteryDevice`, `BatteryCell`, `BATTERY_LABEL`, `deviceForType(type: number): BatteryDevice | null`, `decodeBatteryList(list: Uint8Array): BatteryCell[]`, `decodeBattery(payload: Uint8Array): BatteryCell[]`
  - `protocol/anc.ts`: `CurrentNoiseModeInfo`, `NoiseReductionInfo`, `IntelligentNoiseModeInfo`, `AncEvent`, `decodeAncNotification`, `decodeAncDirectQuery`, `encodeSetAncMode`
  - `protocol/eq.ts`: `EqBand`, `EqPreset`, `EqCurrentReply`, `decodeEqCurrent`, `decodeEqList(list: Uint8Array): EqPreset[]`, `decodeEqAll(payload: Uint8Array): EqPreset[]`, `encodeSetEqPreset`
  - `protocol/notify.ts`: `NotificationSupportReply`, `decodeNotificationSupport`, `encodeRegisterNotify`, `PushEvent`

- [ ] **Step 1: Create `protocol/cmd.ts`** (the full id table, so later tasks add no churn):

```ts
/** Command ids (realme `Protocol.java`, HeyTap `OppoProtocol` index). Replies are `cmd | 0x8000`. */
export const Cmd = {
  QueryCapability: 0x0100,
  QueryProductId: 0x0103,
  QueryVersion: 0x0105,
  Battery: 0x0106,
  QueryWear: 0x0109,
  QueryColourId: 0x010b,
  QueryAncDirect: 0x010c,
  QueryEqCurrent: 0x010f,
  QueryEqAll: 0x0122,
  QueryNotificationSupport: 0x0200,
  ActiveReport: 0x0204,
  RegisterNotify: 0x0205,
  FindEarbuds: 0x0400,
  SetAncMode: 0x0404,
  SetEqPreset: 0x0406,
  SetEqCurve: 0x0418,
  PushEqCurrent: 0x0504,
  PushEqCurves: 0x0506,
} as const;

export const replyFor = (cmd: number): number => cmd | 0x8000;
```

- [ ] **Step 2: Create `protocol/status.ts` and its test.**

```ts
/** A missing or non-zero leading status byte fails, like the vendor's `CommandUtil.n()` (realme `:443-453`). */
export function statusBody(payload: Uint8Array, what: string): Uint8Array {
  if (payload.length === 0 || payload[0] !== 0) {
    throw new Error(`${what} returned status ${payload[0] ?? 'none'}`);
  }
  return payload.subarray(1);
}
```

`protocol/status.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { statusBody } from './status';

describe('statusBody', () => {
  it('returns the bytes after a zero status', () => {
    expect(Array.from(statusBody(Uint8Array.from([0x00, 0x05, 0x06]), 'x'))).toEqual([0x05, 0x06]);
  });

  it('throws on a non-zero or missing status', () => {
    expect(() => statusBody(Uint8Array.from([0x01, 0x05]), 'battery')).toThrow('battery returned status 1');
    expect(() => statusBody(Uint8Array.from([]), 'battery')).toThrow('battery returned status none');
  });
});
```

- [ ] **Step 3: Move symbols verbatim from `commands.ts`**, with these edits only:
  - `identity.ts`: `ProductIdReply`, `decodeProductId`, `decodeColourId` — `decodeColourId` body becomes:
    ```ts
    const body = statusBody(payload, 'colour id query');
    if (body.length < 1) throw new Error('colour id reply has no id byte');
    return body[0];
    ```
  - `battery.ts`: `BatteryDevice`, `BatteryCell`, `BATTERY_LABEL`, `BATTERY_DEVICE_TYPE`, then split `decodeBattery`:
    ```ts
    export const deviceForType = (type: number): BatteryDevice | null => BATTERY_DEVICE_TYPE[type] ?? null;

    /** `[count][deviceType, packed]…` — the list after a reply's status byte or a push's event id. */
    export function decodeBatteryList(list: Uint8Array): BatteryCell[] {
      if (list.length === 0) return [];
      const count = Math.min(list[0], Math.floor((list.length - 1) / 2));
      const cells: BatteryCell[] = [];
      for (let i = 0; i < count; i += 1) {
        const device = deviceForType(list[1 + i * 2]);
        const packed = list[2 + i * 2];
        if (device) cells.push({ device, level: packed & 0x7f, charging: (packed & 0x80) !== 0 });
      }
      return cells;
    }

    export function decodeBattery(payload: Uint8Array): BatteryCell[] {
      return decodeBatteryList(statusBody(payload, 'battery query'));
    }
    ```
    Keep the existing doc comment on `decodeBattery` (status-byte provenance).
  - `anc.ts`: everything from `NOISE_REDUCTION_SUBTYPE` through `encodeSetAncMode`, unchanged.
  - `eq.ts`: `EqBand`, `EqPreset`, `signedByte`, `textDecoder`, `EqCurrentReply`, `decodeEqCurrent`, `encodeSetEqPreset`, and split `decodeEqAll`:
    ```ts
    /** `[count][preset…]` — `0x0122` after its status byte, or a `0x0506` push as-is (realme `RequestCommandManager.d()`). */
    export function decodeEqList(list: Uint8Array): EqPreset[] {
      // body of the old decodeEqAll from `const count = payload[1]` onward,
      // with `payload` renamed `list`, count read from list[0], and the loop starting at offset 1
    }

    export function decodeEqAll(payload: Uint8Array): EqPreset[] {
      return decodeEqList(statusBody(payload, 'QueryEqAll'));
    }
    ```
    Concretely, in the moved loop: `const count = list[0]; let offset = 1;` and every `payload` reference inside becomes `list`. An empty `list` returns `[]`.
  - `notify.ts`: `NotificationSupportReply`, `decodeNotificationSupport`, `encodeRegisterNotify`, plus:
    ```ts
    /** `0x0204` event ids (realme `NotificationCommandManager.k():184-226`). */
    export const PushEvent = { Battery: 0x01, Wear: 0x02, Anc: 0x03 } as const;
    ```
  - `anc.ts` keeps `NOISE_REDUCTION_SUBTYPE = 3` private; it equals `PushEvent.Anc`.

- [ ] **Step 4: Move tests.** Split `commands.test.ts` by `describe` block into `protocol/identity.test.ts` (`decodeProductId`, `decodeColourId`), `protocol/battery.test.ts` (`decodeBattery`), `protocol/anc.test.ts` (`decodeAncNotification`, `encodeSetAncMode`, `decodeAncDirectQuery`), `protocol/eq.test.ts` (every EQ describe), `protocol/notify.test.ts` (`decodeNotificationSupport`, `encodeRegisterNotify`), and any `replyFor` test into `protocol/cmd.test.ts`. Imports point at the new module. Update expected error messages only where `statusBody`'s wording replaced the old one. Add to `battery.test.ts`:

```ts
describe('decodeBatteryList', () => {
  it('decodes a count-first list, as a 0x0204 battery push carries after its event id', () => {
    expect(decodeBatteryList(Uint8Array.from([0x01, 0x02, 0x55]))).toEqual([{ device: 'right', level: 85, charging: false }]);
  });
});
```

and to `eq.test.ts`:

```ts
describe('decodeEqList', () => {
  it('decodes a 0x0506 push, which is 0x0122 without the status byte', () => {
    const presets = decodeEqList(Uint8Array.from([1, 1, 0xfa, 0x06, 9, 1, 0x43, 1, 0x64, 0x00, 0x03]));
    expect(presets).toEqual([
      { isSelected: true, minValue: -6, maxValue: 6, eqId: 9, name: 'C', bands: [{ frequency: 100, dbValue: 3 }] },
    ]);
  });
});
```

- [ ] **Step 5: Update importers.** `client.ts` → `import { replyFor } from './protocol/cmd'`; `device.ts` → split its `./commands` import across `./protocol/*`; `state.ts` → `decodeAncNotification` from `./protocol/anc`, `BatteryCell` from `./protocol/battery`, `EqPreset` from `./protocol/eq`; `driver.ts` and `sections/System.tsx` → `BATTERY_LABEL` from `./protocol/battery` / `../protocol/battery`; `device.test.ts`, `client.test.ts` → `Cmd, replyFor` from `./protocol/cmd`. Delete `commands.ts` and `commands.test.ts`.

- [ ] **Step 6: Checkpoint** — `grep -rn "from '\.\./commands'\|from '\./commands'" src/drivers/heymelody` prints nothing; `npx tsc -b && npx oxlint src/drivers/heymelody && npx vitest run` all green; test count equals the pre-task count plus the 4 new tests. No commit.

---

### Task 3: Capability bitmap

**Files:**
- Create: `src/drivers/heymelody/protocol/capability.ts`, `protocol/capability.test.ts`

**Interfaces:**
- Consumes: `statusBody` (Task 2), `Cmd` (Task 2).
- Produces: `HeyMelodyFeature = 'version' | 'battery' | 'wear' | 'find' | 'anc' | 'eq' | 'eqCustom'`; `CAPABILITY_TABLE: readonly (readonly number[])[]`; `BOOTSTRAP_COMMANDS: ReadonlySet<number>`; `decodeCapabilities(payload: Uint8Array): Set<number>`; `featuresFromCommands(commands: ReadonlySet<number>): Set<HeyMelodyFeature>`.

- [ ] **Step 1: Write the failing test** `protocol/capability.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BOOTSTRAP_COMMANDS, CAPABILITY_TABLE, decodeCapabilities, featuresFromCommands } from './capability';

describe('CAPABILITY_TABLE (realme Protocol.java:179, resolved 2026-09-27)', () => {
  it('has 61 rows with the documented commands at their bits', () => {
    expect(CAPABILITY_TABLE).toHaveLength(61);
    expect(CAPABILITY_TABLE[1]).toEqual([0x0106]);
    expect(CAPABILITY_TABLE[8]).toEqual([0x010c, 0x0404]);
    expect(CAPABILITY_TABLE[34]).toEqual([0x0122, 0x0418]);
    expect(CAPABILITY_TABLE[60]).toEqual([0x042c]);
    expect(CAPABILITY_TABLE[12]).toEqual([]);
  });
});

describe('decodeCapabilities', () => {
  it('maps LSB-first bits to commands and always includes the bootstrap set', () => {
    // bit1 battery, bit8 anc, bit10 eq, bit34 eqAll/custom
    const commands = decodeCapabilities(Uint8Array.from([0x00, 0x02, 0x05, 0x00, 0x00, 0x04]));
    expect([...commands]).toEqual(expect.arrayContaining([0x0106, 0x010c, 0x0404, 0x0406, 0x010f, 0x0122, 0x0418]));
    expect(commands.has(0x0109)).toBe(false);
    for (const cmd of BOOTSTRAP_COMMANDS) expect(commands.has(cmd)).toBe(true);
  });

  it('treats a short bitmap as unsupported and ignores bits past the table', () => {
    expect(decodeCapabilities(Uint8Array.from([0x00, 0x02])).has(0x0418)).toBe(false);
    const long = decodeCapabilities(Uint8Array.from([0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff]));
    expect([...long].every((cmd) => BOOTSTRAP_COMMANDS.has(cmd))).toBe(true);
  });

  it('throws on a non-zero status', () => {
    expect(() => decodeCapabilities(Uint8Array.from([0x01, 0xff]))).toThrow();
  });
});

describe('featuresFromCommands', () => {
  it('names the features a command set supports', () => {
    const features = featuresFromCommands(new Set([0x0105, 0x0106, 0x0109, 0x0400, 0x010c, 0x0406, 0x0418]));
    expect(features).toEqual(new Set(['version', 'battery', 'wear', 'find', 'anc', 'eq', 'eqCustom']));
  });

  it('counts eq when only the preset list (0x0122) is supported', () => {
    expect(featuresFromCommands(new Set([0x0122]))).toEqual(new Set(['eq']));
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run src/drivers/heymelody/protocol/capability.test.ts`. Expected: FAIL, module missing.

- [ ] **Step 3: Implement** `protocol/capability.ts`:

```ts
import { Cmd } from './cmd';
import { statusBody } from './status';

export type HeyMelodyFeature = 'version' | 'battery' | 'wear' | 'find' | 'anc' | 'eq' | 'eqCustom';

/** Bit n of the `0x0100` bitmap enables row n (realme `Protocol.b2`, `Protocol.java:179`). */
export const CAPABILITY_TABLE: readonly (readonly number[])[] = [
  [0x0105], [0x0106], [0x0107], [0x0108, 0x0401], [0x0109], [0x0400], [0x0402], [0x010d, 0x0403],
  [0x010c, 0x0404], [0x0405], [0x0406, 0x010f], [0x0110, 0x0407], [], [0x0408], [0x0409], [0x040a, 0x0111],
  [], [], [], [0x040e, 0x040d, 0x0115, 0x0116], [], [], [0x0205], [0x0f00],
  [], [0x0118, 0x0411], [0x011a, 0x0412], [], [], [0x0112, 0x040b], [0x011e, 0x011f, 0x0415], [],
  [0x0120], [], [0x0122, 0x0418], [], [], [], [0x0124, 0x041b], [],
  [], [], [], [0x041e], [], [], [0x0128, 0x050e], [],
  [], [], [], [], [], [], [0x012c], [],
  [], [], [0x0131, 0x0428], [], [0x042c],
];

/** Always allowed, needed before any bitmap exists (realme `Protocol.c2`, `:181-191`). */
export const BOOTSTRAP_COMMANDS: ReadonlySet<number> = new Set([0x0100, 0x0101, 0x0102, 0x0103, 0x0104, 0x010b, 0x0f00]);

export function decodeCapabilities(payload: Uint8Array): Set<number> {
  const bitmap = statusBody(payload, 'capability query');
  const commands = new Set(BOOTSTRAP_COMMANDS);
  CAPABILITY_TABLE.forEach((row, bit) => {
    if ((bitmap[bit >> 3] ?? 0) & (1 << (bit & 7))) row.forEach((cmd) => commands.add(cmd));
  });
  return commands;
}

const FEATURE_COMMANDS: Record<HeyMelodyFeature, readonly number[]> = {
  version: [Cmd.QueryVersion],
  battery: [Cmd.Battery],
  wear: [Cmd.QueryWear],
  find: [Cmd.FindEarbuds],
  anc: [Cmd.QueryAncDirect],
  eq: [Cmd.SetEqPreset, Cmd.QueryEqAll],
  eqCustom: [Cmd.SetEqCurve],
};

export function featuresFromCommands(commands: ReadonlySet<number>): Set<HeyMelodyFeature> {
  const features = new Set<HeyMelodyFeature>();
  for (const [feature, needs] of Object.entries(FEATURE_COMMANDS) as [HeyMelodyFeature, readonly number[]][]) {
    if (needs.some((cmd) => commands.has(cmd))) features.add(feature);
  }
  return features;
}
```

- [ ] **Step 4: Run** — same command. Expected: PASS.

- [ ] **Step 5: Checkpoint** — full checks green. No commit.

---

### Task 4: Standard SPP routing

**Files:**
- Modify: `src/core/transport.ts` (`KnownService`, `KNOWN_SERVICES`, `listGrantedPorts`)
- Test: `src/core/transport.test.ts`

**Interfaces:**
- Produces: `STANDARD_SPP_UUID = '00001101-0000-1000-8000-00805f9b34fb'`; `KnownService.generic?: boolean`; `listGrantedPorts()` returns generic services after every brand-specific one.

- [ ] **Step 1: Write the failing tests** — in `transport.test.ts`, change the "rejects an unrelated service" test to use `'0000110a-0000-1000-8000-00805f9b34fb'` (A2DP source, genuinely unrelated), then add:

```ts
it('routes the standard SPP service to the HeyMelody driver as a generic service', () => {
  expect(serviceForPort(portWith(STANDARD_SPP_UUID))).toMatchObject({ brand: 'heymelody', generic: true });
});
```

and, in the `listGrantedPorts` area (use the file's existing `navigator.serial` stub pattern; if none exists, stub `navigator.serial.getPorts` with `vi.stubGlobal`):

```ts
it('lists generic services after brand-specific ones', async () => {
  vi.stubGlobal('navigator', { serial: { getPorts: async () => [portWith(STANDARD_SPP_UUID), portWith(HEYMELODY_SPP_UUID)] } });
  const granted = await listGrantedPorts();
  expect(granted.map((entry) => entry.service.uuid)).toEqual([HEYMELODY_SPP_UUID, STANDARD_SPP_UUID]);
  vi.unstubAllGlobals();
});
```

- [ ] **Step 2: Run** — `npx vitest run src/core/transport.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** in `transport.ts`:

```ts
/**
 * The standard Serial Port Profile service. realme's catalog marks most TL
 * models `TYPE_DEFAULT`, which connects here rather than on the HeyMelody UUID.
 * Generic: any SPP device offers it, so the driver's identity handshake decides.
 */
export const STANDARD_SPP_UUID = '00001101-0000-1000-8000-00805f9b34fb';
```

Add `generic?: boolean;` to `KnownService`, append
`{ uuid: STANDARD_SPP_UUID, brand: 'heymelody', protocol: 'heymelody', generic: true },` as the last `KNOWN_SERVICES` entry, and end `listGrantedPorts` with
`return granted.sort((a, b) => Number(a.service.generic ?? false) - Number(b.service.generic ?? false));`

- [ ] **Step 4: Run** — `npx vitest run src/core/`. Expected: PASS, including `driver.test.ts`'s two-way services check.

- [ ] **Step 5: Checkpoint** — full checks green. No commit.

---

### Task 5: Capability-driven connect sequence

**Files:**
- Modify: `src/drivers/heymelody/device.ts`, `state.ts`, `driver.ts`
- Test: `src/drivers/heymelody/device.test.ts`, `state.test.ts`

**Interfaces:**
- Consumes: `decodeCapabilities`, `featuresFromCommands`, `HeyMelodyFeature` (Task 3).
- Produces: `HeyMelodyState.capabilities: Set<HeyMelodyFeature>` (type `HeyMelodyCapability` in `state.ts` becomes an alias of `HeyMelodyFeature`); private readers `#readBattery`, `#readAnc`, `#readEq(client, commands | null)`; `NOT_HEYMELODY_ERROR` constant; the unidentified-device error.

- [ ] **Step 1: Write the failing tests** in `device.test.ts`:

```ts
/** status=0, then bits 1 (battery), 8 (anc), 10 (eq), 5 (find), 34 (eqCustom). */
const BITMAP_REPLY = [0x00, 0x22, 0x05, 0x00, 0x00, 0x04];

describe('HeyMelodyDevice capability-driven connect', () => {
  it('polls only what the bitmap reports and passes find/eqCustom through', async () => {
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.QueryCapability, BITMAP_REPLY);
    const device = new HeyMelodyDevice(heyMelodyOpener(replies), { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    expect(device.state.capabilities).toEqual(new Set(['battery', 'find', 'anc', 'eq', 'eqCustom']));
  });

  it('never sends a command the bitmap does not report', async () => {
    let transport!: FakeTransport;
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.QueryCapability, [0x00, 0x02]); // battery only
    const open: TransportOpener = async (p, handlers) => {
      transport = (await heyMelodyOpener(replies)(p, handlers)) as FakeTransport;
      return transport;
    };
    const device = new HeyMelodyDevice(open, { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    const sent = new SppFrameCodec().createDecoder();
    const cmds = transport.written.flatMap((bytes) => sent.push(bytes)).map((frame) => frame.cmd);
    expect(cmds).not.toContain(Cmd.QueryAncDirect);
    expect(cmds).not.toContain(Cmd.QueryEqAll);
    expect(device.state.capabilities).toEqual(new Set(['battery']));
  });

  it('drops a reported feature whose query fails', async () => {
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.QueryCapability, BITMAP_REPLY);
    replies.set(Cmd.Battery, [0x01]); // non-zero status
    const device = new HeyMelodyDevice(heyMelodyOpener(replies), { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    expect(device.state.capabilities.has('battery')).toBe(false);
  });

  it('falls back to probing when the device ignores 0x0100', async () => {
    const device = new HeyMelodyDevice(heyMelodyOpener(FULL_REPLIES), { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    expect(device.state.capabilities).toEqual(new Set(['battery', 'anc', 'eq']));
  });
});
```

Change the existing "tolerates every command going unanswered" test to also assert
`expect(device.state.error).toBe('This does not look like a HeyMelody or realme device.');`, and rename it "flags a port that answers neither identity query". The `heyMelodyOpener` helper must return the `FakeTransport` it builds (it already does). Add a `QueryCapability` import is unnecessary — `Cmd` already carries it.

- [ ] **Step 2: Run** — `npx vitest run src/drivers/heymelody/device.test.ts`. Expected: the four new tests and the renamed one fail.

- [ ] **Step 3: Implement.** In `state.ts`:

```ts
import type { HeyMelodyFeature } from './protocol/capability';
export type HeyMelodyCapability = HeyMelodyFeature;
```

(remove the old string-union declaration). In `device.ts`, add near the top:

```ts
const NOT_HEYMELODY_ERROR = 'This does not look like a HeyMelody or realme device.';
```

and replace `#refreshAll` with:

```ts
  async #refreshAll(client: HeyMelodyClient): Promise<void> {
    const identified = await this.#readProductId(client);
    const commands = await this.#readCommands(client);
    await this.#readColour(client);
    const capabilities = commands ? await this.#pollReported(client, commands) : await this.#probeAll(client);
    this.#patch({ capabilities });
    if (!identified && !commands) this.#patch({ error: NOT_HEYMELODY_ERROR });
  }

  async #readProductId(client: HeyMelodyClient): Promise<boolean> {
    try {
      const { status, productId } = decodeProductId(await client.request(Cmd.QueryProductId));
      if (status !== 0) throw new Error(`QueryProductId returned non-zero status ${status}`);
      const catalog = catalogEntryFor(productId);
      this.#patch({ info: { ...this.#store.state.info, model: catalog?.name ?? null, productId, catalog } });
      return true;
    } catch (error) {
      console.warn('[heymelody] QueryProductId failed', error);
      return false;
    }
  }

  async #readCommands(client: HeyMelodyClient): Promise<Set<number> | null> {
    try {
      return decodeCapabilities(await client.request(Cmd.QueryCapability));
    } catch (error) {
      console.debug('[heymelody] no capability bitmap, falling back to probing', error);
      return null;
    }
  }

  async #readColour(client: HeyMelodyClient): Promise<void> {
    try {
      const colourId = decodeColourId(await client.request(Cmd.QueryColourId, [], { timeoutMs: this.#probeTimeoutMs }));
      this.#patch({ info: { ...this.#store.state.info, colourId } });
    } catch (error) {
      console.debug('[heymelody] QueryColourId failed', error);
    }
  }

  /** Polls each feature the bitmap reports; one whose query fails is treated as absent. */
  async #pollReported(client: HeyMelodyClient, commands: Set<number>): Promise<Set<HeyMelodyCapability>> {
    const reported = featuresFromCommands(commands);
    const found = new Set<HeyMelodyCapability>();
    const read = async (feature: HeyMelodyCapability, run: () => Promise<void>) => {
      if (!reported.has(feature)) return;
      try {
        await run();
        found.add(feature);
      } catch (error) {
        console.debug(`[heymelody] reported ${feature} did not read`, error);
      }
    };
    await read('battery', () => this.#readBattery(client));
    await read('anc', () => this.#readAnc(client));
    await read('eq', () => this.#readEq(client, commands));
    for (const passthrough of ['find', 'eqCustom'] as const) if (reported.has(passthrough)) found.add(passthrough);
    return found;
  }

  /** Firmware without a bitmap: try the features that are safe to probe. */
  async #probeAll(client: HeyMelodyClient): Promise<Set<HeyMelodyCapability>> {
    const found = new Set<HeyMelodyCapability>();
    const probe = async (feature: HeyMelodyCapability, run: () => Promise<void>) => {
      try {
        await run();
        found.add(feature);
      } catch (error) {
        console.debug(`[heymelody] ${feature} unavailable`, error);
      }
    };
    await probe('battery', () => this.#readBattery(client));
    await probe('anc', () => this.#readAnc(client));
    await probe('eq', () => this.#readEq(client, null));
    return found;
  }
```

Move the existing battery / ANC / EQ probe bodies verbatim into `#readBattery(client)`, `#readAnc(client)` and `#readEq(client, commands: Set<number> | null)`, each throwing on failure exactly as the probe closures do today. In `#readEq`, send `QueryEqCurrent` only when `commands === null || commands.has(Cmd.QueryEqCurrent)`, and `QueryEqAll` only when `commands === null || commands.has(Cmd.QueryEqAll)`; keep the "neither answered" throw. Delete the old `#readColour` block that lived inside `#refreshAll`, and import `decodeCapabilities`, `featuresFromCommands` from `./protocol/capability`.

In `driver.ts` `sections`:

```ts
      if (section.id === 'noise') return !known || state.capabilities.has('anc');
      if (section.id === 'sound') return !known || state.capabilities.has('eq') || state.capabilities.has('eqCustom');
```

- [ ] **Step 4: Run** — `npx vitest run src/drivers/heymelody/`. Expected: PASS. `state.test.ts`'s durable round trip still passes (`capabilities` is still a Set ↔ array).

- [ ] **Step 5: Checkpoint** — full checks green. No commit.

---

### Task 6: Firmware version

**Files:**
- Modify: `protocol/identity.ts`, `protocol/identity.test.ts`, `state.ts`, `device.ts`, `sections/System.tsx`
- Create: `sections/sections.render.test.tsx`

**Interfaces:**
- Produces: `VersionEntry { device: BatteryDevice | 'other'; type: number; version: string }`; `decodeVersion(payload: Uint8Array): VersionEntry[]`; `HeyMelodyInfo.version: VersionEntry[]` (durable); `renderSection(component, state)` test helper.

Vendor facts: `PollCommandManager.p0():971-988` — status gate, then `CommandUtil.j(1, data, 3)` (`CommandUtil.java:374-396`): `[count][ASCII "device,type,version,…"]`, split on `,`, must yield exactly `count * 3` fields; `VersionInfo`: device `"1"` left, `"2"` right, `"3"` case, anything else 255.

- [ ] **Step 1: Write the failing tests.** `protocol/identity.test.ts`:

```ts
describe('decodeVersion (realme PollCommandManager.p0():971-988, CommandUtil.j():374-396)', () => {
  const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

  it('reads device,type,version triples after status and count', () => {
    const payload = Uint8Array.from([0x00, 0x02, ...ascii('1,0,1.2.3,2,0,1.2.4')]);
    expect(decodeVersion(payload)).toEqual([
      { device: 'left', type: 0, version: '1.2.3' },
      { device: 'right', type: 0, version: '1.2.4' },
    ]);
  });

  it('maps an unknown device id to other', () => {
    expect(decodeVersion(Uint8Array.from([0x00, 0x01, ...ascii('9,1,7')]))[0].device).toBe('other');
  });

  it('throws when the field count disagrees with count * 3', () => {
    expect(() => decodeVersion(Uint8Array.from([0x00, 0x02, ...ascii('1,0,1.2.3')]))).toThrow();
  });
});
```

`sections/sections.render.test.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentType } from 'react';
import { describe, expect, it } from 'vitest';

import { initialHeyMelodyState } from '../state';
import type { HeyMelodyState } from '../state';
import { HeyMelodySystem } from './System';

const device = new Proxy({}, { get: () => () => undefined }) as never;

export function renderSection(Component: ComponentType<{ device: never; state: HeyMelodyState }>, patch: Partial<HeyMelodyState>): string {
  return renderToStaticMarkup(<Component device={device} state={{ ...initialHeyMelodyState, status: 'connected', ...patch }} />);
}

describe('HeyMelody System section', () => {
  it('shows each firmware version by device', () => {
    const html = renderSection(HeyMelodySystem, {
      info: { ...initialHeyMelodyState.info, version: [{ device: 'left', type: 0, version: '1.2.3' }] },
    });
    expect(html).toContain('Firmware');
    expect(html).toContain('Left 1.2.3');
  });
});
```

(`HeyMelodySystem`'s props type is `{ state }` today; the helper passes `device` too, which React ignores — widen `Props` to accept an optional `device` if tsc objects.)

- [ ] **Step 2: Run** — `npx vitest run src/drivers/heymelody/`. Expected: FAIL.

- [ ] **Step 3: Implement.** `protocol/identity.ts`:

```ts
import type { BatteryDevice } from './battery';
import { deviceForType } from './battery';

export interface VersionEntry {
  device: BatteryDevice | 'other';
  type: number;
  version: string;
}

const textDecoder = new TextDecoder('utf-8');

export function decodeVersion(payload: Uint8Array): VersionEntry[] {
  const body = statusBody(payload, 'version query');
  if (body.length < 2) throw new Error('version reply has no entries');
  const count = body[0];
  const fields = textDecoder.decode(body.subarray(1)).split(',');
  if (fields.length !== count * 3) throw new Error(`version reply has ${fields.length} fields for ${count} entries`);
  const entries: VersionEntry[] = [];
  for (let i = 0; i < fields.length; i += 3) {
    entries.push({ device: deviceForType(Number(fields[i])) ?? 'other', type: Number(fields[i + 1]), version: fields[i + 2] });
  }
  return entries;
}
```

`state.ts`: add `version: VersionEntry[]` to `HeyMelodyInfo`, `version: []` to `initialHeyMelodyState.info`, and in `applyDurable` set `info: { ...snapshot.info, colourId: snapshot.info?.colourId ?? null, version: snapshot.info?.version ?? [] }`.

`device.ts`: add `#readVersion(client)` (`decodeVersion(await client.request(Cmd.QueryVersion, [], { timeoutMs: this.#probeTimeoutMs }))`, then patch `info.version`), and in `#pollReported` add `await read('version', () => this.#readVersion(client));` before battery.

`sections/System.tsx`, inside the Device card after Product ID:

```tsx
          {state.info.version.length > 0 && (
            <p>
              <span className="text-muted-foreground">Firmware </span>
              {state.info.version
                .map((entry) => `${entry.device === 'other' ? '' : `${BATTERY_LABEL[entry.device]} `}${entry.version}`)
                .join(' · ')}
            </p>
          )}
```

Update `state.test.ts`'s round-trip fixture `info` with `version: []`, and its legacy-snapshot test to also expect `info?.version` toEqual `[]`.

- [ ] **Step 4: Run** — `npx vitest run src/drivers/heymelody/`. Expected: PASS.

- [ ] **Step 5: Checkpoint** — full checks green. No commit.

---

### Task 7: In-ear status and live battery

**Files:**
- Create: `protocol/wear.ts`, `protocol/wear.test.ts`
- Modify: `state.ts`, `device.ts`, `driver.ts`, `sections/System.tsx`, `sections/sections.render.test.tsx`, `device.test.ts`

**Interfaces:**
- Consumes: `deviceForType`, `decodeBatteryList` (Task 2), `PushEvent` (Task 2).
- Produces: `WearCell { device: BatteryDevice; inEar: boolean; inBox: boolean }`; `decodeWearList(list)`, `decodeWear(payload)`; `HeyMelodyState.wear: WearCell[]` (live-only).

Vendor facts: reply `PollCommandManager:526-547` gates status then `CommandUtil.f(1, data)`; push `NotificationCommandManager` case 2 calls `f(i+1, data)` after the event id; `f()` `:236-253` reads `[count][type, flags]…`, `count <= 0` or short data → null. `StatusInfo`: bit0 in-box **active low**, bit1 in-ear, bit2 unnamed active low.

- [ ] **Step 1: Write the failing tests.** `protocol/wear.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decodeWear, decodeWearList } from './wear';

describe('decodeWear (realme CommandUtil.f():236-253, StatusInfo)', () => {
  it('reads in-ear (active high) and in-box (bit 0 active low)', () => {
    // left: 0b011 -> not in box, in ear; right: 0b000 -> in box, not in ear
    expect(decodeWear(Uint8Array.from([0x00, 0x02, 0x01, 0x03, 0x02, 0x00]))).toEqual([
      { device: 'left', inEar: true, inBox: false },
      { device: 'right', inEar: false, inBox: true },
    ]);
  });

  it('decodes the count-first list a 0x0204 wear push carries', () => {
    expect(decodeWearList(Uint8Array.from([0x01, 0x02, 0x03]))).toEqual([{ device: 'right', inEar: true, inBox: false }]);
  });

  it('throws on a zero count or truncated list, as the vendor returns null', () => {
    expect(() => decodeWearList(Uint8Array.from([0x00]))).toThrow();
    expect(() => decodeWearList(Uint8Array.from([0x02, 0x01, 0x03]))).toThrow();
  });
});
```

`device.test.ts`:

```ts
describe('HeyMelodyDevice live pushes', () => {
  it('replaces battery and wear from 0x0204 events 1 and 2', async () => {
    let transport!: FakeTransport;
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.QueryCapability, [0x00, 0x12]); // bits 1 battery, 4 wear
    replies.set(Cmd.QueryWear, [0x00, 0x01, 0x01, 0x03]);
    const open: TransportOpener = async (p, handlers) => {
      transport = (await heyMelodyOpener(replies)(p, handlers)) as FakeTransport;
      return transport;
    };
    const device = new HeyMelodyDevice(open, { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    expect(device.state.wear).toEqual([{ device: 'left', inEar: true, inBox: false }]);

    transport.receive(encodeSppFrame(Cmd.ActiveReport, 0x09, [0x01, 0x01, 0x01, 0x32]));
    expect(device.state.battery).toEqual([{ device: 'left', level: 50, charging: false }]);
    transport.receive(encodeSppFrame(Cmd.ActiveReport, 0x0a, [0x02, 0x01, 0x01, 0x00]));
    expect(device.state.wear).toEqual([{ device: 'left', inEar: false, inBox: true }]);
  });
});
```

`sections.render.test.tsx`:

```tsx
  it('labels each battery row with its in-ear status', () => {
    const html = renderSection(HeyMelodySystem, {
      battery: [{ device: 'left', level: 80, charging: false }],
      wear: [{ device: 'left', inEar: true, inBox: false }],
    });
    expect(html).toContain('In ear');
  });
```

- [ ] **Step 2: Run** — `npx vitest run src/drivers/heymelody/`. Expected: FAIL.

- [ ] **Step 3: Implement.** `protocol/wear.ts`:

```ts
import type { BatteryDevice } from './battery';
import { deviceForType } from './battery';
import { statusBody } from './status';

export interface WearCell {
  device: BatteryDevice;
  inEar: boolean;
  inBox: boolean;
}

export function decodeWearList(list: Uint8Array): WearCell[] {
  const count = list[0] ?? 0;
  if (count <= 0 || list.length < 1 + count * 2) throw new Error(`wear list invalid: count ${count}, ${list.length} bytes`);
  const cells: WearCell[] = [];
  for (let i = 0; i < count; i += 1) {
    const device = deviceForType(list[1 + i * 2]);
    const flags = list[2 + i * 2];
    // bit 0 is active low: set means NOT in the box
    if (device) cells.push({ device, inEar: (flags & 0x02) !== 0, inBox: (flags & 0x01) === 0 });
  }
  return cells;
}

export function decodeWear(payload: Uint8Array): WearCell[] {
  return decodeWearList(statusBody(payload, 'wear query'));
}
```

`state.ts`: `wear: WearCell[]` in `HeyMelodyState`, `wear: []` in the initial state (not in `HeyMelodyDurableState`). `device.ts`: `#readWear` (`decodeWear(await client.request(Cmd.QueryWear, [], { timeoutMs: this.#probeTimeoutMs }))` → patch `wear`); in `#pollReported` add `await read('wear', () => this.#readWear(client));` after battery; replace `#onNotification`'s `ActiveReport` branch with:

```ts
    if (frame.cmd === Cmd.ActiveReport) {
      const event = frame.payload[0];
      const list = frame.payload.subarray(1);
      try {
        if (event === PushEvent.Battery) this.#patch({ battery: decodeBatteryList(list) });
        else if (event === PushEvent.Wear) this.#patch({ wear: decodeWearList(list) });
        else this.#replace(applyAncEvent(this.#store.state, frame.payload));
      } catch (error) {
        console.debug('[heymelody] unreadable push', event, error);
      }
    }
```

`driver.ts`: `worn: (state) => state.wear.length === 0 || state.wear.some((cell) => cell.inEar),`.
`System.tsx` battery row label: after `{BATTERY_LABEL[cell.device]}` render
`{wearLabel(state.wear, cell.device)}` with

```tsx
function wearLabel(wear: HeyMelodyState['wear'], device: string): string {
  const cell = wear.find((entry) => entry.device === device);
  if (!cell) return '';
  return cell.inEar ? ' · In ear' : cell.inBox ? ' · In case' : '';
}
```

- [ ] **Step 4: Run** — `npx vitest run src/drivers/heymelody/`. Expected: PASS.

- [ ] **Step 5: Checkpoint** — full checks green. No commit.

---

### Task 8: Find my earbuds

**Files:**
- Modify: `state.ts`, `device.ts`, `sections/System.tsx`, `device.test.ts`, `sections/sections.render.test.tsx`

**Interfaces:**
- Produces: `HeyMelodyState.finding: boolean` (live-only); `HeyMelodyDevice.setFinding(on: boolean): Promise<void>`.

Vendor facts: `SetCommandManager:499-511` builds `0x0400 [z ? 1 : 0]`; ack `0x8400 [status]`.

- [ ] **Step 1: Write the failing tests.** `device.test.ts`:

```ts
describe('HeyMelodyDevice find my earbuds', () => {
  it('sends 0x0400 [1] then [0] and tracks finding', async () => {
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.FindEarbuds, [0x00]);
    const device = new HeyMelodyDevice(heyMelodyOpener(replies), { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    await device.setFinding(true);
    expect(device.state.finding).toBe(true);
    await device.setFinding(false);
    expect(device.state.finding).toBe(false);
  });

  it('rolls back when the device refuses', async () => {
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.FindEarbuds, [0x01]);
    const device = new HeyMelodyDevice(heyMelodyOpener(replies), { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    await device.setFinding(true);
    expect(device.state.finding).toBe(false);
    expect(device.state.error).not.toBeNull();
  });

  it('stops showing ringing after a drop', async () => {
    let transport!: FakeTransport;
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.FindEarbuds, [0x00]);
    const open: TransportOpener = async (p, handlers) => {
      transport = (await heyMelodyOpener(replies)(p, handlers)) as FakeTransport;
      return transport;
    };
    const device = new HeyMelodyDevice(open, { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    await device.setFinding(true);
    transport.drop(new Error('gone'));
    expect(device.state.finding).toBe(false);
  });
});
```

`sections.render.test.tsx`:

```tsx
  it('offers find-my-earbuds only when the device reports it', () => {
    expect(renderSection(HeyMelodySystem, { capabilities: new Set(['find']) })).toContain('Ring earbuds');
    expect(renderSection(HeyMelodySystem, { capabilities: new Set(['battery']) })).not.toContain('Ring earbuds');
    expect(renderSection(HeyMelodySystem, { capabilities: new Set(['find']), finding: true })).toContain('Stop ringing');
  });
```

- [ ] **Step 2: Run** — `npx vitest run src/drivers/heymelody/`. Expected: FAIL.

- [ ] **Step 3: Implement.** `state.ts`: `finding: boolean` in `HeyMelodyState`, `finding: false` initially (not durable — `onDrop`/`disconnect` already spread `initialHeyMelodyState`). `device.ts`:

```ts
  async setFinding(on: boolean): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    const previous = this.#store.state.finding;
    this.#patch({ finding: on });
    try {
      statusBody(await client.request(Cmd.FindEarbuds, [on ? 0x01 : 0x00]), 'find earbuds');
    } catch (error) {
      this.#patch({ finding: previous, error: describeError(error) });
    }
  }
```

(import `statusBody` from `./protocol/status`). `System.tsx` needs `device`: change `Props` to `{ device: HeyMelodyDevice; state: HeyMelodyState }` and append:

```tsx
      {state.capabilities.has('find') && (
        <Card data-size="sm">
          <CardHeader>
            <CardTitle>Find my earbuds</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <p className="text-muted-foreground">Remove the earbuds before ringing them.</p>
            <Button
              variant={state.finding ? 'destructive' : 'outline'}
              disabled={state.status !== 'connected'}
              onClick={() => void device.setFinding(!state.finding)}
            >
              {state.finding ? 'Stop ringing' : 'Ring earbuds'}
            </Button>
          </CardContent>
        </Card>
      )}
```

Import `Button` from `@/components/ui/button` (confirm the `destructive`/`outline` variants exist in that file; if `destructive` is absent use `default`).

- [ ] **Step 4: Run** — `npx vitest run src/drivers/heymelody/`. Expected: PASS.

- [ ] **Step 5: Checkpoint** — full checks green. No commit.

---

### Task 9: ANC alignment — reduction offset and realme mode names

**Files:**
- Modify: `protocol/anc.ts`, `protocol/anc.test.ts`, `scripts/gen-heymelody-catalog.py`, `src/drivers/heymelody/catalog.generated.ts` (regenerated), `src/drivers/heymelody/ancModel.test.ts`
- Create: `docs/reference/realme-models.json` (committed reference data)

**Interfaces:**
- Produces: `catalog.generated.ts` entries for realme TL models gain `noiseReductionMode` synthesized from realme items, so `buildAncCapabilities` needs no change.

Vendor facts:
- HeyTap's `0x810C` handler: inner type `2`/`3` → `NoiseReductionInfo(1, data)`, i.e. the DTO starts **at** the inner-type byte (`action = innerType`), not after it; realme `NoiseReductionInfo(i2, bArr)` agrees.
- realme `ItemFactory.java:747-765, 791-810`: value bits — `ITEM_NOISE_REDUCTION` 1, `ITEM_NOISE_NORMAL`/`ITEM_NOISE_CLOSE` 2, `ITEM_NOISE_TRANSPARENT` 4, `ITEM_DEEP_REDUCTION` 1, `ITEM_LIGHT_REDUCTION` 8, `ITEM_MEDIUM_REDUCTION` 16, `ITEM_SMART_REDUCTION` 32. Bit index = log2(value).

- [ ] **Step 1: Write the failing tests.** In `protocol/anc.test.ts`, replace the NoiseReductionInfo test with:

```ts
  it('decodes NoiseReductionInfo from the inner-type byte itself (HeyTap 0x810C handler, realme NoiseReductionInfo)', () => {
    // body: innerType=2 (is also the action), type=1, value=0x000a LE
    expect(decodeAncNotification(Uint8Array.from([3, 2, 1, 0x0a, 0x00]))).toEqual({ kind: 'reduction', action: 2, type: 1, value: 10 });
    expect(decodeAncNotification(Uint8Array.from([3, 3, 1, 0x04]))).toEqual({ kind: 'reduction', action: 3, type: 1, value: 4 });
  });
```

and change the innerType=2 truncation test to expect `null` for `[3, 2]` and `[3, 2, 1, 2, …]` inputs that no longer apply: truncated means fewer than 3 body bytes, i.e. `decodeAncNotification(Uint8Array.from([3, 2]))` → null (the 2-byte `[type,value]` form covers `[3, a, b]`). In `ancModel.test.ts` add:

```ts
import { catalogEntryFor } from './catalog';

it('names the realme Buds Air6 Pro modes from realme Link items, value 8 = Light', () => {
  const caps = buildAncCapabilities(catalogEntryFor('063012')?.noiseReductionMode);
  expect(caps.options.map((option) => option.key)).toEqual(['nc', 'transparency', 'off']);
  expect(caps.indexToKey[3]).toBe('light');
  expect(caps.keyToIndex.transparency).toBe(2);
  expect(caps.keyToIndex.off).toBe(1);
});
```

- [ ] **Step 2: Run** — `npx vitest run src/drivers/heymelody/`. Expected: FAIL (reduction offsets, and 063012 has no `noiseReductionMode`).

- [ ] **Step 3: Implement the decoder fix** in `protocol/anc.ts` `decodeAncBody`, replacing the `innerType === 2` branch:

```ts
  if (innerType === 2 || innerType === 3) {
    // NoiseReductionInfo starts at the inner-type byte: action == innerType.
    if (body.length < 3) return null;
    return { kind: 'reduction', action: body[0], type: body[1], value: decodeLEValue(body.slice(2, 6)) };
  }
```

- [ ] **Step 4: Add `docs/reference/realme-models.json`** — a committed mirror of realme Link's bundled `headsetRusConfig`: one entry per `VENDOR_TL` model with a `modelId`, as `{"modelId", "model", "noiseItems"}`, where `noiseItems` are the item names under `GROUP_NOISE_CONTROL/GROUP_NOISE_CONTROL_MODE/` and `…/GROUP_NOISE_CONTROL_MODE_LIST/`. Like `heymelody-devices.json`, it is reference data checked into the repo; nothing reads outside the repo to build it.

- [ ] **Step 5: Extend `scripts/gen-heymelody-catalog.py`.** Add:

```python
REALME_MODELS_SOURCE = Path("docs/reference/realme-models.json")

# realme ItemFactory.java:747-765, 791-810 — (protocolIndex = log2(value), modeType per ancModel.ts MODE_TYPE_KEY)
REALME_MODES = {
    "ITEM_NOISE_REDUCTION": (0, 5),
    "ITEM_NOISE_CLOSE": (1, 1),
    "ITEM_NOISE_NORMAL": (1, 1),
    "ITEM_NOISE_TRANSPARENT": (2, 2),
}
REALME_LEVELS = {
    "ITEM_DEEP_REDUCTION": (0, 4),
    "ITEM_LIGHT_REDUCTION": (3, 3),
    "ITEM_MEDIUM_REDUCTION": (4, 8),
    "ITEM_SMART_REDUCTION": (5, 7),
}


def squash(name: str) -> str:
    return "".join(name.lower().split())


def realme_noise_modes(items: list[str]) -> list[dict]:
    levels = [{"protocolIndex": REALME_LEVELS[i][0], "modeType": REALME_LEVELS[i][1]} for i in items if i in REALME_LEVELS]
    modes, seen = [], set()
    for item in items:
        if item not in REALME_MODES or REALME_MODES[item] in seen:
            continue
        seen.add(REALME_MODES[item])
        index, mode_type = REALME_MODES[item]
        entry = {"protocolIndex": index, "modeType": mode_type}
        if item == "ITEM_NOISE_REDUCTION" and levels:
            entry["childrenMode"] = levels
        modes.append(entry)
    return modes
```

In `main()`, after `anc_by_product_id` is built, add:

```python
    realme = json.loads(REALME_MODELS_SOURCE.read_text(encoding="utf-8"))["models"]
    names = {d["productId"]: d["name"] for d in data["devices"]}
    realme_by_product_id: dict[str, list[dict]] = {}
    # modelId is not unique (T300 Pro / T500 Pro share 066452): prefer the entry named like ours.
    for model in sorted(realme, key=lambda m: squash(m["model"]) != squash(names.get(m["modelId"], ""))):
        modes = realme_noise_modes(model["noiseItems"])
        if modes:
            realme_by_product_id.setdefault(model["modelId"], modes)
```

and change the per-device lookup to `nrm = anc_by_product_id.get(entry["productId"]) or realme_by_product_id.get(entry["productId"])`, counting realme hits separately in the final print. Update the docstring to name the third source. Run `python3 scripts/gen-heymelody-catalog.py` (local files only).

- [ ] **Step 6: Run** — `npx vitest run src/drivers/heymelody/`. Expected: PASS. Spot-check: `grep '"063012"' src/drivers/heymelody/catalog.generated.ts` shows a `noiseReductionMode` with NC children indices `5, 0, 4, 3`.

- [ ] **Step 7: Checkpoint** — full checks green. No commit.

---

### Task 10: Custom EQ curves

**Files:**
- Modify: `protocol/eq.ts`, `protocol/eq.test.ts`, `device.ts`, `device.test.ts`, `sections/Sound.tsx`, `sections/sections.render.test.tsx`

**Interfaces:**
- Consumes: `decodeEqList` (Task 2), `statusBody` (Task 2).
- Produces: `EQ_ACTION = { Add: 1, Modify: 2, Delete: 3 }`; `encodeSetEqCurve(preset: EqPreset, gains: readonly number[]): number[]`; `decodeSetEqCurveAck(payload: Uint8Array): number`; `HeyMelodyDevice.setEqCurve(eqId: number, gains: number[]): Promise<void>`.

Vendor facts: realme `0x0122` (`PollCommandManager.P():280-298`) and `0x0506` (`RequestCommandManager.d()`) both feed message 35 → the **custom** EQ list (`ParamsConverter.w`), so every `0x0122` entry is an editable custom EQ. Write `SetCommandManager.p():440-497`: `[action][min][max][eqId][nameLen][name UTF-8][bandCount][freq(2 LE), gain]…`; actions `1` add, `2` modify, `3` delete (`CustomEqViewModel.java:72,92,160`). Ack `0x8418 [status][eqId]` (`:234-250`). `0x0504` push = `[eqId]` (`RequestCommandManager.e()`). The spec's "~300 ms debounce" is implemented as write-on-release (`Slider` `onValueCommitted`), which meets its intent of one write per adjustment.

- [ ] **Step 1: Write the failing tests.** `protocol/eq.test.ts`:

```ts
describe('encodeSetEqCurve (realme SetCommandManager.p():440-497)', () => {
  const preset = {
    isSelected: true, minValue: -6, maxValue: 6, eqId: 9, name: 'C1',
    bands: [{ frequency: 100, dbValue: 0 }, { frequency: 4300, dbValue: 0 }],
  };

  it('builds a modify write with the new gains, frequencies LE, gains two\'s-complement', () => {
    expect(encodeSetEqCurve(preset, [3, -2])).toEqual([
      2, 0xfa, 0x06, 9, 2, 0x43, 0x31, 2, 100, 0, 3, 0xcc, 0x10, 0xfe,
    ]);
  });

  it('refuses a gain count that does not match the bands', () => {
    expect(() => encodeSetEqCurve(preset, [1])).toThrow();
  });
});

describe('decodeSetEqCurveAck', () => {
  it('returns the eqId after a zero status and throws otherwise', () => {
    expect(decodeSetEqCurveAck(Uint8Array.from([0x00, 9]))).toBe(9);
    expect(() => decodeSetEqCurveAck(Uint8Array.from([0x01, 9]))).toThrow();
  });
});
```

`device.test.ts`:

```ts
const CUSTOM_EQ = [0, 1, 1, 0xfa, 0x06, 9, 2, 0x43, 0x31, 2, 100, 0, 0, 0xcc, 0x10, 0]; // status, 1 preset "C1", 2 bands flat

describe('HeyMelodyDevice custom EQ', () => {
  const openWith = (ack: number[] | undefined) => {
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.QueryCapability, [0x00, 0x00, 0x04, 0x00, 0x00, 0x04]); // bits 10, 34
    replies.set(Cmd.QueryEqAll, CUSTOM_EQ);
    if (ack) replies.set(Cmd.SetEqCurve, ack);
    return heyMelodyOpener(replies);
  };

  it('writes a curve and keeps it once acknowledged', async () => {
    const device = new HeyMelodyDevice(openWith([0x00, 9]), { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    await device.setEqCurve(9, [3, -2]);
    expect(device.state.eqPresets[0].bands.map((band) => band.dbValue)).toEqual([3, -2]);
    expect(device.state.error).toBeNull();
  });

  it('clamps gains to the preset range', async () => {
    const device = new HeyMelodyDevice(openWith([0x00, 9]), { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    await device.setEqCurve(9, [20, -20]);
    expect(device.state.eqPresets[0].bands.map((band) => band.dbValue)).toEqual([6, -6]);
  });

  it('rolls back a failed curve write to the last confirmed curve', async () => {
    const device = new HeyMelodyDevice(openWith([0x00, 9]), { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    await device.setEqCurve(9, [3, -2]); // confirmed
    // Next write goes unanswered and times out.
    const failing = new HeyMelodyDevice(openWith(undefined), { timeoutMs: 20, probeTimeoutMs: 20 });
    await failing.adoptPort(port);
    await failing.setEqCurve(9, [5, 5]);
    expect(failing.state.eqPresets[0].bands.map((band) => band.dbValue)).toEqual([0, 0]);
    expect(failing.state.error).not.toBeNull();
  });

  it('follows 0x0504 and 0x0506 pushes', async () => {
    let transport!: FakeTransport;
    const open: TransportOpener = async (p, handlers) => {
      transport = (await openWith([0x00, 9])(p, handlers)) as FakeTransport;
      return transport;
    };
    const device = new HeyMelodyDevice(open, { timeoutMs: 50, probeTimeoutMs: 50 });
    await device.adoptPort(port);
    transport.receive(encodeSppFrame(Cmd.PushEqCurrent, 0x01, [9]));
    expect(device.state.eqCurrentPreset).toBe(9);
    transport.receive(encodeSppFrame(Cmd.PushEqCurves, 0x02, CUSTOM_EQ.slice(1).map((b, i) => (i === 11 ? 4 : b))));
    expect(device.state.eqPresets[0].bands[0].dbValue).toBe(4);
  });
});
```

(`CUSTOM_EQ.slice(1)` drops the status byte; in the sliced array index 9–10 are band 0's frequency and index 11 is its gain.) To make the rollback test exercise "last confirmed" on a single device instead of two, keep the two-device form above only if a per-call reply override is not available in the harness; preferred form: extend `heyMelodyOpener` to accept a function `(frame) => number[] | undefined` so the first `SetEqCurve` acks and the second is left unanswered on the **same** device, then assert the bands equal `[3, -2]` after the failed second write.

`sections.render.test.tsx`:

```tsx
import { HeyMelodySound } from './Sound';

  it('shows a slider per band for custom EQs only when the device supports curve writes', () => {
    const preset = { isSelected: true, minValue: -6, maxValue: 6, eqId: 9, name: 'C1',
      bands: [{ frequency: 100, dbValue: 0 }, { frequency: 4300, dbValue: 2 }] };
    const html = renderSection(HeyMelodySound, { eqPresets: [preset], capabilities: new Set(['eq', 'eqCustom']) });
    expect(html).toContain('100 Hz');
    expect(html).toContain('4.3 kHz');
    expect(renderSection(HeyMelodySound, { eqPresets: [preset], capabilities: new Set(['eq']) })).not.toContain('100 Hz');
  });
```

- [ ] **Step 2: Run** — `npx vitest run src/drivers/heymelody/`. Expected: FAIL.

- [ ] **Step 3: Implement.** `protocol/eq.ts`:

```ts
/** `0x0418` actions (realme `CustomEqViewModel.java:72,92,160`). */
export const EQ_ACTION = { Add: 1, Modify: 2, Delete: 3 } as const;

const textEncoder = new TextEncoder();

export function encodeSetEqCurve(preset: EqPreset, gains: readonly number[]): number[] {
  if (gains.length !== preset.bands.length) {
    throw new Error(`EQ curve has ${gains.length} gains for ${preset.bands.length} bands`);
  }
  const name = Array.from(textEncoder.encode(preset.name));
  return [
    EQ_ACTION.Modify, preset.minValue & 0xff, preset.maxValue & 0xff, preset.eqId, name.length, ...name,
    preset.bands.length,
    ...preset.bands.flatMap((band, i) => [band.frequency & 0xff, (band.frequency >> 8) & 0xff, gains[i] & 0xff]),
  ];
}

export function decodeSetEqCurveAck(payload: Uint8Array): number {
  const body = statusBody(payload, 'EQ curve write');
  if (body.length < 1) throw new Error('EQ curve ack has no eqId');
  return body[0];
}
```

`device.ts`: add `readonly #confirmedEq = new Map<number, EqPreset>();`; wherever `eqPresets` is set from a read (`#readEq`) or a `0x0506` push, also refresh the map (`for (const p of presets) this.#confirmedEq.set(p.eqId, p)`). Add:

```ts
  async setEqCurve(eqId: number, gains: number[]): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    const preset = this.#store.state.eqPresets.find((candidate) => candidate.eqId === eqId);
    if (!preset) return;
    const clamped = gains.map((gain) => Math.max(preset.minValue, Math.min(preset.maxValue, Math.round(gain))));
    const next: EqPreset = { ...preset, bands: preset.bands.map((band, i) => ({ ...band, dbValue: clamped[i] })) };
    const swap = (replacement: EqPreset) =>
      this.#store.state.eqPresets.map((candidate) => (candidate.eqId === eqId ? replacement : candidate));
    this.#patch({ eqPresets: swap(next) });
    try {
      decodeSetEqCurveAck(await client.request(Cmd.SetEqCurve, encodeSetEqCurve(preset, clamped)));
      this.#confirmedEq.set(eqId, next);
    } catch (error) {
      this.#patch({ eqPresets: swap(this.#confirmedEq.get(eqId) ?? preset), error: describeError(error) });
    }
  }
```

In `#onNotification` add:

```ts
    } else if (frame.cmd === Cmd.PushEqCurrent && frame.payload.length > 0) {
      this.#patch({ eqCurrentPreset: frame.payload[0] });
    } else if (frame.cmd === Cmd.PushEqCurves) {
      try {
        const presets = decodeEqList(frame.payload);
        for (const preset of presets) this.#confirmedEq.set(preset.eqId, preset);
        this.#patch({ eqPresets: presets });
      } catch (error) {
        console.debug('[heymelody] unreadable EQ push', error);
      }
    }
```

`sections/Sound.tsx`: under each preset button, when `state.capabilities.has('eqCustom') && preset.bands.length > 0`, render a band editor:

```tsx
function bandLabel(frequency: number): string {
  return frequency >= 1000 ? `${Number((frequency / 1000).toFixed(1))} kHz` : `${frequency} Hz`;
}

function CurveEditor({ preset, disabled, onCommit }: {
  preset: EqPreset;
  disabled: boolean;
  onCommit: (gains: number[]) => void;
}) {
  const [draft, setDraft] = useState<number[] | null>(null);
  const gains = draft ?? preset.bands.map((band) => band.dbValue);
  return (
    <div className="flex flex-col gap-2 pl-2">
      {preset.bands.map((band, i) => (
        <div key={band.frequency} className="flex items-center gap-3">
          <span className="text-muted-foreground w-14 shrink-0 text-xs tabular-nums">{bandLabel(band.frequency)}</span>
          <Slider
            value={[gains[i]]}
            min={preset.minValue}
            max={preset.maxValue}
            step={1}
            disabled={disabled}
            aria-label={`${bandLabel(band.frequency)} gain`}
            onValueChange={(next) => {
              const value = Array.isArray(next) ? next[0] : next;
              setDraft(gains.map((gain, j) => (j === i ? value : gain)));
            }}
            onValueCommitted={() => {
              if (draft) onCommit(draft);
              setDraft(null);
            }}
          />
          <span className="w-8 shrink-0 text-right text-xs tabular-nums">{gains[i] > 0 ? `+${gains[i]}` : gains[i]}</span>
        </div>
      ))}
    </div>
  );
}
```

wired as `<CurveEditor preset={preset} disabled={disabled} onCommit={(gains) => void device.setEqCurve(preset.eqId, gains)} />`. Import `useState` from `react`, `Slider` from `@/components/ui/slider`, `EqPreset` from `../protocol/eq`. Replace the "presets only" empty-state text with "The device did not return an EQ list." unchanged otherwise.

- [ ] **Step 4: Run** — `npx vitest run src/drivers/heymelody/`. Expected: PASS.

- [ ] **Step 5: Checkpoint** — full checks green. No commit.

---

### Task 11: Final verification

**Files:** none new.

- [ ] **Step 1: Full checks** — `npx tsc -b && npx oxlint src/drivers/heymelody src/core && npx vitest run`. Expected: all green.

- [ ] **Step 2: Build** — `npm run build`. Expected: success.

- [ ] **Step 3: App smoke test** — `npm run dev` (background), load the page in a browser (use the `run` skill), confirm the app renders with no console errors and the connect picker lists the HeyMelody services. Stop the server.

- [ ] **Step 4: Spec coverage re-check** — walk spec §2–§6 against the diff; every item maps to Tasks 1–10.

- [ ] **Step 5: Report** — summarize for the user, list what the beta tester should check (spec §1 success criterion 3), and ask for commit approval.
