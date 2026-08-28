import { describe, expect, it } from 'vitest';

import { SoundcoreDecoder, checksum, encodePacket } from './frame';
import * as C from './commands';
import { SoundcoreDevice } from './device';
import { FakeTransport } from '@/core/fakeTransport.test-helper';

const hex = (bytes: Uint8Array | number[]): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * The A3951 captures from SoundcoreManager's `test_data` — real device bytes,
 * which pin both the framing and the payload offsets this driver reads.
 */
const A3951_STATE_BYTES = Uint8Array.from([
  0x09, 0xff, 0x00, 0x00, 0x01, 0x01, 0x01, 0x61, 0x00, 0x01, 0x01, 0x05, 0x05, 0x01, 0x01, 0xfe,
  0xfe, 0xa0, 0x92, 0x82, 0x78, 0x78, 0x78, 0x78, 0x78, 0xa0, 0x92, 0x82, 0x78, 0x78, 0x78, 0x78,
  0x78, 0xff, 0xff, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
  0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
  0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01, 0x63, 0x01, 0x54, 0x01, 0x66,
  0x01, 0x54, 0x00, 0x01, 0x00, 0x00, 0x02, 0x01, 0x01, 0x06, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
  0xed,
]);

const A3951_INFO_BYTES = Uint8Array.from([
  0x09, 0xff, 0x00, 0x00, 0x01, 0x01, 0x05, 0x24, 0x00, 0x30, 0x35, 0x2e, 0x36, 0x33, 0x30, 0x35,
  0x2e, 0x36, 0x33, 0x33, 0x39, 0x35, 0x31, 0x30, 0x37, 0x44, 0x32, 0x36, 0x41, 0x32, 0x46, 0x31,
  0x32, 0x41, 0x43, 0xb0,
]);

const A3951_MODE_BYTES = Uint8Array.from([
  0x09, 0xff, 0x00, 0x00, 0x01, 0x06, 0x01, 0x0e, 0x00, 0x00, 0x01, 0x01, 0x06, 0x26,
]);

describe('Soundcore framing', () => {
  it('encodes the reference state request byte-for-byte', () => {
    // SoundcoreManager's request.rs: 08 EE 00 00 00 01 01, no payload.
    expect(hex(encodePacket(C.Command.RequestState))).toBe('08ee0000000101 0a00 02'.replace(/ /g, ''));
  });

  it('encodes a sound-mode write with payload and checksum', () => {
    // The builder test in sound_mode.rs: Normal + Outdoor + fully transparent.
    expect(
      hex(
        encodePacket(C.Command.SetSoundMode, [
          C.CurrentMode.Normal,
          C.AncScene.Outdoor,
          C.TransparencyMode.FullyTransparent,
          0,
        ]),
      ),
    ).toBe('08ee0000000681' + '0e00' + '020100' + '00' + '8e');
  });

  it('decodes the real state capture, checksum and all', () => {
    const [frame] = new SoundcoreDecoder().push(A3951_STATE_BYTES);
    expect(frame.checksumOk).toBe(true);
    expect(frame.kind).toBe(C.Kind.StateUpdate);
    expect(frame.payload.length).toBe(87);
  });

  it('reassembles a frame split across chunks, ignoring leading noise', () => {
    const decoder = new SoundcoreDecoder();
    expect(decoder.push(Uint8Array.from([0x00, 0x71, 0x09, 0xff]))).toEqual([]);
    const frames = decoder.push(A3951_MODE_BYTES.slice(2));
    expect(frames).toHaveLength(1);
    expect(frames[0].kind).toBe(C.Kind.SoundModeUpdate);
    expect(frames[0].checksumOk).toBe(true);
  });

  it('flags a corrupted checksum', () => {
    const corrupt = Uint8Array.from(A3951_MODE_BYTES);
    corrupt[corrupt.length - 1] ^= 0xff;
    const [frame] = new SoundcoreDecoder().push(corrupt);
    expect(frame.checksumOk).toBe(false);
  });

  it('computes the wrapping 8-bit sum', () => {
    expect(checksum([0x08, 0xee])).toBe(0xf6);
    // 300 × 0xFF wraps: 76500 mod 256 = 212.
    expect(checksum(new Array(300).fill(0xff))).toBe(212);
  });
});

/** The second real state capture — a different sound mode and EQ curve. */
const A3951_STATE_BYTES_2 = Uint8Array.from([
  0x09, 0xff, 0x00, 0x00, 0x01, 0x01, 0x01, 0x61, 0x00, 0x00, 0x01, 0x01, 0x04, 0x00, 0x01, 0x06,
  0xee, 0x6e, 0x78, 0x78, 0x6e, 0x82, 0x6e, 0x6e, 0x6e, 0x6e, 0x78, 0x78, 0x6e, 0x82, 0x6e, 0x6e,
  0x6e, 0x01, 0xff, 0x00, 0x3c, 0x3c, 0x3c, 0x3c, 0x3c, 0x3c, 0x3c, 0x3c, 0x3c, 0x3c, 0x3c, 0x3c,
  0x3c, 0x3c, 0x3c, 0x3c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x3c, 0x3c, 0x3c, 0x3c, 0x3c, 0x3c,
  0x3c, 0x3c, 0x3c, 0x3c, 0x3c, 0x3c, 0x3c, 0x3c, 0x3c, 0x3c, 0x01, 0x63, 0x01, 0x54, 0x01, 0x66,
  0x01, 0x54, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x01, 0x06, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
  0x95,
]);

describe('Soundcore payload codecs', () => {
  it('reads battery and wear detection out of the state capture', () => {
    const [frame] = new SoundcoreDecoder().push(A3951_STATE_BYTES);
    const reading = C.decodeState(frame!.payload)!;
    // The wire carries six steps (0–5); both buds report step 5 = full.
    expect(reading.battery).toEqual({
      left: { level: 100, charging: true },
      right: { level: 100, charging: true },
    });
    expect(reading.tws).toBe(true);
    expect(reading.eqProfile).toBe(0xfefe);
    expect(reading.eqLeft).toEqual([0xa0, 0x92, 0x82, 0x78, 0x78, 0x78, 0x78, 0x78]);
    expect(reading.wearDetection).toBe(true);
  });

  it('scales battery steps to percent and reads an absent bud as null', () => {
    // OpenSCQ30 gives every model max_level = 5; SoundcoreManager's battery
    // icon switches on exactly 0–5.
    expect(C.batteryStepToPercent(0)).toBe(0);
    expect(C.batteryStepToPercent(1)).toBe(20);
    expect(C.batteryStepToPercent(5)).toBe(100);
    // 255 means that side is absent (TWS link down, host is the other bud);
    // anything else out of range is treated the same rather than displayed.
    expect(C.batteryStepToPercent(255)).toBeNull();
    expect(C.batteryStepToPercent(6)).toBeNull();

    // A minimal-but-complete state: prefix through the fixed tail.
    const payload = new Array(84).fill(0);
    payload[2] = 0x02; // left level
    payload[3] = 0xff; // right level: absent
    payload[4] = 0x00; // left charging
    payload[5] = 0x01; // right charging
    const state = C.decodeState(Uint8Array.from(payload))!;
    expect(state.battery.left).toEqual({ level: 40, charging: false });
    expect(state.battery.right).toEqual({ level: null, charging: true });
  });

  it('decodes button assignments out of the state capture', () => {
    const [frame] = new SoundcoreDecoder().push(A3951_STATE_BYTES);
    const reading = C.decodeState(frame!.payload)!;
    expect(reading.buttons).toEqual([
      { side: C.ButtonSide.Left, gesture: C.Gesture.Double, enabled: true, twsAction: 0x3, soloAction: 0x6 },
      { side: C.ButtonSide.Left, gesture: C.Gesture.Long, enabled: true, twsAction: 0x4, soloAction: 0x5 },
      { side: C.ButtonSide.Right, gesture: C.Gesture.Double, enabled: true, twsAction: 0x6, soloAction: 0x6 },
      { side: C.ButtonSide.Right, gesture: C.Gesture.Long, enabled: true, twsAction: 0x4, soloAction: 0x5 },
      { side: C.ButtonSide.Left, gesture: C.Gesture.Single, enabled: false, twsAction: 0x1, soloAction: 0x1 },
      { side: C.ButtonSide.Right, gesture: C.Gesture.Single, enabled: false, twsAction: 0x0, soloAction: 0x0 },
    ]);
    // The second capture carries the same button bytes at the same offset.
    const [second] = new SoundcoreDecoder().push(A3951_STATE_BYTES_2);
    expect(C.decodeState(second!.payload)!.buttons).toEqual(reading.buttons);
  });

  it('round-trips a button write against the state block encoding', () => {
    // Double/hold pack solo high and pair-linked low; single is one nibble.
    expect(C.encodeButtonAction(C.ButtonSide.Left, C.Gesture.Double, C.ButtonAction.NextSong, C.ButtonAction.PlayPause))
      .toEqual([0, 0, (0x6 << 4) | 0x3]);
    expect(C.encodeButtonAction(C.ButtonSide.Right, C.Gesture.Single, C.ButtonAction.VolumeUp, C.ButtonAction.VolumeUp))
      .toEqual([1, 2, 0x0]);
    // And the write's action byte re-decodes to what the state block holds.
    const block = Uint8Array.from([
      ...C.buttonEntryBytes(true, true, C.ButtonAction.NextSong, C.ButtonAction.PlayPause),
      ...C.buttonEntryBytes(true, true, C.ButtonAction.AmbientSoundMode, C.ButtonAction.VoiceAssistant),
      ...C.buttonEntryBytes(true, true, C.ButtonAction.PlayPause, C.ButtonAction.PlayPause),
      ...C.buttonEntryBytes(true, true, C.ButtonAction.AmbientSoundMode, C.ButtonAction.VoiceAssistant),
      ...C.buttonEntryBytes(false, false, C.ButtonAction.VolumeDown, C.ButtonAction.VolumeDown),
      ...C.buttonEntryBytes(false, false, C.ButtonAction.VolumeUp, C.ButtonAction.VolumeUp),
    ]);
    expect(C.decodeButtons(block)).toEqual(C.decodeButtons(Uint8Array.from([0x01, 0x63, 0x01, 0x54, 0x01, 0x66, 0x01, 0x54, 0x00, 0x01, 0x00, 0x00])));
  });

  it('reads live battery levels and charging flags out of the pushes', () => {
    // 01 03: [left, right] levels; here 2/5 and 4/5.
    expect(C.decodeBatteryLevels(Uint8Array.from([0x02, 0x04]))).toEqual({
      left: 40,
      right: 80,
    });
    // Shorter than dual is not ours to read.
    expect(C.decodeBatteryLevels(Uint8Array.from([0x02]))).toBeNull();
    // 01 04: [left, right] charging flags.
    expect(C.decodeBatteryCharging(Uint8Array.from([0x01, 0x00]))).toEqual({
      left: true,
      right: false,
    });
    expect(C.decodeBatteryCharging(Uint8Array.from([0x01]))).toBeNull();
  });

  it("reads the sound mode out of the state response's tail, both captures", () => {
    const [first] = new SoundcoreDecoder().push(A3951_STATE_BYTES);
    const reading1 = C.decodeState(first!.payload)!;
    expect(reading1.soundMode).toEqual({
      current: C.CurrentMode.Normal,
      ancScene: C.AncScene.Outdoor,
      transparency: C.TransparencyMode.Vocal,
      custom: 6,
    });

    const [second] = new SoundcoreDecoder().push(A3951_STATE_BYTES_2);
    const reading2 = C.decodeState(second!.payload)!;
    expect(reading2.soundMode).toEqual({
      current: C.CurrentMode.Anc,
      ancScene: C.AncScene.Transport,
      transparency: C.TransparencyMode.Vocal,
      custom: 6,
    });
  });

  it('reads the sound mode out of the mode-update capture', () => {
    const [frame] = new SoundcoreDecoder().push(A3951_MODE_BYTES);
    const mode = C.decodeSoundMode(frame!.payload)!;
    expect(mode).toEqual({ current: C.CurrentMode.Anc, ancScene: C.AncScene.Outdoor, transparency: C.TransparencyMode.Vocal, custom: 6 });
  });

  it('reads firmware and serial out of the info capture', () => {
    const [frame] = new SoundcoreDecoder().push(A3951_INFO_BYTES);
    const info = C.decodeInfo(frame!.payload)!;
    expect(info.firmware).toEqual(['05.63', '05.63']);
    expect(info.serial).toBe('395107D26A2F12AC');
  });

  it('round-trips a sound mode through encode/decode', () => {
    const mode = { current: C.CurrentMode.Transparency, ancScene: C.AncScene.Indoor, transparency: C.TransparencyMode.Vocal, custom: 0 };
    expect(C.decodeSoundMode(Uint8Array.from(C.encodeSoundMode(mode)))).toEqual(mode);
  });
});

/** SoundcoreManager's real A3951 custom-EQ capture (Deep preset, no hear-id). */
const A3951_EQ_UPDATE_DEEP = Uint8Array.from([
  0x08, 0xee, 0x00, 0x00, 0x00, 0x03, 0x87, 0x56, 0x00, 0x07, 0x00, 0x00, 0x00, 0x8c, 0x82, 0x96,
  0x96, 0x8c, 0x64, 0x50, 0x46, 0x8c, 0x82, 0x96, 0x96, 0x8c, 0x64, 0x50, 0x46, 0xff, 0xff, 0x00,
  0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
  0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
  0xff, 0xff, 0xff, 0xff, 0xff, 0x7a, 0x77, 0x7b, 0x79, 0x7b, 0x76, 0x76, 0x73, 0x7a, 0x77, 0x7b,
  0x79, 0x7b, 0x76, 0x76, 0x73, 0xb9,
]);

describe('Soundcore equalizer', () => {
  it('encodes the Deep preset byte-for-byte against the device capture', () => {
    const deep = C.EQ_PRESETS.find((p) => p.id === 0x0007)!;
    // This one test pins the whole chain: signed→byte conversion, the
    // 76-byte payload layout, the hear-id "unset" fills, and the DRC matrix.
    expect(hex(encodePacket(C.Command.SetEq, C.encodeEqUpdate(0x0007, deep.curve, deep.curve)))).toBe(
      hex(A3951_EQ_UPDATE_DEEP),
    );
  });

  it('converts band bytes to signed tenths-of-dB and back', () => {
    expect(C.bandToSigned(0x8c)).toBe(20);
    expect(C.signedToBand(-50)).toBe(70);
    // The wire clamps at 0..180, so signed values above +60 do not survive.
    for (const signed of [-120, -50, 0, 20, 60]) {
      expect(C.bandToSigned(C.signedToBand(signed))).toBe(signed);
    }
  });

  it('derives the DRC copy the device validates', () => {
    // The Deep curve's DRC bytes, from the capture above.
    expect(C.drcBandBytes([0x8c, 0x82, 0x96, 0x96, 0x8c, 0x64, 0x50, 0x46])).toEqual([
      0x7a, 0x77, 0x7b, 0x79, 0x7b, 0x76, 0x76, 0x73,
    ]);
  });

  it('names presets and decodes the eq-info notification', () => {
    expect(C.eqPresetName(0x0007)).toBe('Deep');
    expect(C.eqPresetName(C.EQ_CUSTOM_ID)).toBe('Custom');
    // Artist profiles live on the device; we know their names, not curves.
    expect(C.eqPresetName(0x00ee)).toBe('Foxes');
    expect(C.EQ_PRESETS.find((p) => p.id === 0x01ee)).toMatchObject({ name: 'Halestorm', artist: true });
    expect(C.decodeEqInfo(Uint8Array.from([0x01, 0x00]))).toBe(0x0001);
  });

  it('reads the product code out of a serial number', () => {
    expect(C.productCodeFromSerial('395107D26A2F12AC')).toBe('a3951');
    expect(C.productCodeFromSerial('not-a-serial')).toBeNull();
  });
});

/**
 * A GATT-shaped fake: the session wires its handlers through `start()`, which
 * `FakeTransport` alone lacks (that seam exists for the real transport's
 * open/start split, which keeps one connection for both driver resolution
 * and use).
 */
class FakeGattTransport extends FakeTransport {
  readonly device = { name: 'soundcore Liberty Air 2 Pro' };
  #handlers: import('@/core/transport').TransportHandlers | null = null;
  start(handlers: import('@/core/transport').TransportHandlers): void {
    this.#handlers = handlers;
  }
  override receive(bytes: Uint8Array): void {
    this.#handlers?.onData(bytes);
  }
  override drop(reason?: Error): void {
    this.isOpen = false;
    this.#handlers?.onClose(reason);
  }
}

describe('SoundcoreDevice battery pushes', () => {
  it('updates battery from 01 03/01 04 notifications between state reads', async () => {
    const transport = new FakeGattTransport({ onData: () => {}, onClose: () => {} } as never);
    const device = new SoundcoreDevice();
    await device.adoptTransport(transport);
    expect(device.state.status).toBe('connected');

    const frame = (kind: number, payload: number[]): Uint8Array => {
      const total = 10 + payload.length;
      const raw = Uint8Array.from([0x09, 0xff, 0x00, 0x00, 0x01, kind >> 8, kind & 0xff, total & 0xff, total >> 8, ...payload]);
      return Uint8Array.from([...raw, checksum(raw)]);
    };

    transport.receive(frame(0x0103, [0x02, 0x04]));
    transport.receive(frame(0x0104, [0x01, 0x00]));
    expect(device.state.battery).toEqual({
      left: { level: 40, charging: true },
      right: { level: 80, charging: false },
    });

    // The bud then goes absent (docked with the other side as host).
    transport.receive(frame(0x0103, [0xff, 0x04]));
    expect(device.state.battery!.left.level).toBeNull();
    expect(device.state.battery!.right.level).toBe(80);
  });
});

/**
 * Answers the three reads `refresh` makes, in the fixed order it makes them
 * (state, then info, then LDAC) — the client's request queue is strictly
 * sequential, so counting writes is enough to know which reply is due next.
 * The state and info replies are real A3951 captures; info's serial resolves
 * to a model name through `SOUNDCORE_PRODUCTS`, same as a real connect.
 */
function soundcoreEagerReplies(transport: FakeGattTransport): void {
  let writes = 0;
  transport.onWrite = () => {
    writes += 1;
    if (writes === 1) queueMicrotask(() => transport.receive(A3951_STATE_BYTES));
    else if (writes === 2) queueMicrotask(() => transport.receive(A3951_INFO_BYTES));
    else if (writes === 3) {
      const kind = C.Kind.LdacState;
      const raw = Uint8Array.from([0x09, 0xff, 0x00, 0x00, 0x01, kind >> 8, kind & 0xff, 0x0b, 0x00, 0x00]);
      queueMicrotask(() => transport.receive(Uint8Array.from([...raw, checksum(raw)])));
    }
  };
}

describe('SoundcoreDevice disconnect caching', () => {
  it('keeps showing the identified model after an unexpected drop', async () => {
    const transport = new FakeGattTransport({ onData: () => {}, onClose: () => {} } as never);
    soundcoreEagerReplies(transport);
    const device = new SoundcoreDevice();
    await device.adoptTransport(transport);
    expect(device.state.info.model).toBe('Soundcore Liberty Air 2 Pro');

    transport.drop(new Error('The device has been lost.'));

    // The sidebar identifies the device off `info.model` — losing it here is
    // what makes a known device render as the generic "no device" placeholder
    // the moment it drops, instead of its own dimmed artwork.
    expect(device.state.status).toBe('disconnected');
    expect(device.state.info.model).toBe('Soundcore Liberty Air 2 Pro');
    // Battery is a live reading, not a setting — it must not survive
    // alongside the identity fields above.
    expect(device.state.battery).toBeNull();
  });

  it('keeps showing the identified model after a manual disconnect', async () => {
    const transport = new FakeGattTransport({ onData: () => {}, onClose: () => {} } as never);
    soundcoreEagerReplies(transport);
    const device = new SoundcoreDevice();
    await device.adoptTransport(transport);
    expect(device.state.info.model).toBe('Soundcore Liberty Air 2 Pro');

    await device.disconnect();

    expect(device.state.status).toBe('disconnected');
    expect(device.state.info.model).toBe('Soundcore Liberty Air 2 Pro');
  });

  it('makes no claim about a device that was never identified', async () => {
    // `#lastKnownDurable()` is shared by `onDrop` and `disconnect()` — pinning
    // it here against a device that never read anything is enough to cover
    // both call sites without standing up a transport for each.
    const device = new SoundcoreDevice();
    await device.disconnect();

    expect(device.state.status).toBe('disconnected');
    expect(device.state.info.model).toBeNull();
  });
});
