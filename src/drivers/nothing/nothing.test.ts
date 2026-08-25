import { describe, expect, it } from 'vitest';

import { NothingDecoder, crc16, encodePacket } from './frame';
import * as C from './commands';
import { NOTHING_MODELS, modelForBluetoothName } from './models';
import { profileFor } from '../../core/profiles';
import { replyFor } from './client';

const hex = (bytes: Uint8Array | number[]): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

describe('Nothing framing', () => {
  // Vectors computed independently against ear-web's crc16/packet code
  // (res/js/bluetooth_socket.js) — same algorithm, so the bytes must match.
  it('encodes a battery read exactly as ear-web would', () => {
    expect(hex(encodePacket(0xc007, 1))).toBe('55600107c0000001acdf');
  });

  it('encodes an ANC write with its payload', () => {
    expect(hex(encodePacket(0xf00f, 2, [0x01, 0x05, 0x00]))).toBe('5560010ff0030002010500fb53');
  });

  it('decodes a frame it encoded, across a chunk split', () => {
    const packet = encodePacket(0xc01f, 7, [0x05]);
    const decoder = new NothingDecoder();
    const first = decoder.push(packet.slice(0, 5));
    expect(first).toEqual([]);
    const frames = decoder.push(packet.slice(5));
    expect(frames).toHaveLength(1);
    expect(frames[0].command).toBe(0xc01f);
    expect(frames[0].sequence).toBe(7);
    expect(Array.from(frames[0].payload)).toEqual([0x05]);
    expect(frames[0].crcOk).toBe(true);
  });

  it('drops leading garbage before the sync byte', () => {
    const decoder = new NothingDecoder();
    const packet = encodePacket(0xc007, 1);
    const frames = decoder.push(new Uint8Array([0x00, 0xff, ...packet]));
    expect(frames).toHaveLength(1);
    expect(frames[0].crcOk).toBe(true);
  });

  it('flags a corrupted CRC', () => {
    const packet = encodePacket(0xc007, 1);
    packet[packet.length - 1] ^= 0xff;
    const [frame] = new NothingDecoder().push(packet);
    expect(frame.crcOk).toBe(false);
  });

  it('matches the Modbus CRC of ear-web’s algorithm on a known input', () => {
    // crc16([0x01]) with init 0xFFFF / poly 0xA001.
    expect(crc16([0x01])).toBe(0x807e & 0xffff);
  });
});

describe('Nothing reply ids', () => {
  it('clears bit 15 of a read command', () => {
    expect(replyFor(C.Read.Battery)).toBe(0x4007);
    expect(replyFor(C.Read.Firmware)).toBe(0x4042);
    expect(replyFor(C.Read.AncMode)).toBe(0x401e);
  });
});

describe('Nothing payload codecs', () => {
  it('decodes a battery payload with charging bits', () => {
    const payload = Uint8Array.from([0x03, 0x02, 0x64, 0x03, 0x2a, 0x04, 0x87]);
    expect(C.decodeBattery(payload)).toEqual({
      single: null,
      left: { level: 100, charging: false },
      right: { level: 42, charging: false },
      case: { level: 7, charging: true },
    });
  });

  it('round-trips ANC levels through the wire-byte table', () => {
    for (const level of [1, 2, 3, 4, 5, 6]) {
      const encoded = C.encodeAncMode(level);
      expect(encoded).toHaveLength(3);
      const decoded = C.decodeAncMode(Uint8Array.from([0x01, encoded[1], 0x00]));
      expect(decoded).toBe(level);
    }
  });

  it('decodes firmware ASCII', () => {
    const text = 'US.B.1.0.2';
    expect(C.decodeFirmware(Uint8Array.from([...text].map((c) => c.charCodeAt(0))))).toBe(text);
  });

  it('round-trips a custom EQ, band records and all', () => {
    // The three bands a CMF Headphone Pro reports, per its own white-list
    // `customEQ` block: 140 Hz low shelf, 980 Hz peak, 3500 Hz high shelf.
    const eq: C.CustomEq = {
      totalGain: 0,
      bands: [
        { filterType: C.EqFilter.Peak, gain: 6, frequency: 980, q: 0.7 },
        { filterType: C.EqFilter.HighShelf, gain: 3, frequency: 3500, q: 1 },
        { filterType: C.EqFilter.LowShelf, gain: -2, frequency: 140, q: 0.8 },
      ],
    };
    const payload = Uint8Array.from(C.encodeCustomEq(eq));
    // The length the app's own `obtainDataPacket` allocates: count*13 + 5.
    expect(payload).toHaveLength(3 * 13 + 5);
    const back = C.decodeCustomEq(payload)!;
    expect(back.bands).toHaveLength(3);
    back.bands.forEach((band, i) => {
      expect(band.filterType).toBe(eq.bands[i].filterType);
      expect(band.gain).toBeCloseTo(eq.bands[i].gain, 4);
      expect(band.frequency).toBeCloseTo(eq.bands[i].frequency, 2);
      expect(band.q).toBeCloseTo(eq.bands[i].q, 4);
    });
  });

  it('labels a band by its filter shape, not its position', () => {
    // The old fixed ['Bass','Mid','Treble'] list mislabelled every slider:
    // the wire order is peak, high shelf, low shelf — mid, treble, bass.
    expect(C.eqBandLabel({ filterType: C.EqFilter.Peak, gain: 0, frequency: 980, q: 1 })).toBe('Mid');
    expect(C.eqBandLabel({ filterType: C.EqFilter.HighShelf, gain: 0, frequency: 3500, q: 1 })).toBe('Treble');
    expect(C.eqBandLabel({ filterType: C.EqFilter.LowShelf, gain: 0, frequency: 140, q: 1 })).toBe('Bass');
  });

  it('reads floats little-endian, as the app does', () => {
    // 1.0f little-endian is 00 00 80 3F.
    expect(C.encodeEqFloat(1)).toEqual([0x00, 0x00, 0x80, 0x3f]);
    expect(C.decodeEqFloat([0x00, 0x00, 0x80, 0x3f])).toBe(1);
    // 980.0f — the frequency in B175's own config.
    expect(C.decodeEqFloat(C.encodeEqFloat(980))).toBe(980);
    expect(C.decodeEqFloat(C.encodeEqFloat(-4.5))).toBe(-4.5);
  });

  it('refuses an EQ body that cannot hold the bands it claims', () => {
    expect(C.decodeCustomEq(Uint8Array.from([]))).toBeNull();
    expect(C.decodeCustomEq(Uint8Array.from([0x03, 0, 0, 0, 0]))).toBeNull();
  });

  it('decodes gestures as count-terminated records', () => {
    const payload = Uint8Array.from([0x02, 0x02, 0x01, 0x02, 0x08, 0x03, 0x01, 0x07, 0x19]);
    expect(C.decodeGestures(payload)).toEqual([
      { device: 2, button: 1, gesture: 2, operation: 8 },
      { device: 3, button: 1, gesture: 7, operation: 0x19 },
    ]);
  });

  it('decodes enhanced bass with the halved level', () => {
    expect(C.decodeEnhancedBass(Uint8Array.from([0x01, 0x06]))).toEqual({
      enabled: true,
      level: 3,
    });
  });
});

describe('spatial audio', () => {
  it('decodes the one-byte form as spatial audio without head tracking', () => {
    expect(C.decodeSpatialAudio(Uint8Array.from([0x01]))).toEqual({
      enabled: true,
      headTracking: null,
    });
    expect(C.decodeSpatialAudio(Uint8Array.from([0x00]))).toEqual({
      enabled: false,
      headTracking: null,
    });
  });

  it('decodes the second byte as head tracking where the model sends it', () => {
    expect(C.decodeSpatialAudio(Uint8Array.from([0x01, 0x01]))).toEqual({
      enabled: true,
      headTracking: true,
    });
    expect(C.decodeSpatialAudio(Uint8Array.from([0x01, 0x00]))).toEqual({
      enabled: true,
      headTracking: false,
    });
  });

  it('returns null for an empty body rather than guessing a state', () => {
    expect(C.decodeSpatialAudio(Uint8Array.from([]))).toBeNull();
  });

  it('omits the second byte unless head tracking is being set', () => {
    // The official app sends one byte when there is no head tracking, not a
    // zero — `BasicBoolean.obtainDataPacket` branches on `hasHead`.
    expect(C.encodeSpatialAudio(true)).toEqual([0x01]);
    expect(C.encodeSpatialAudio(false)).toEqual([0x00]);
    expect(C.encodeSpatialAudio(true, null)).toEqual([0x01]);
    expect(C.encodeSpatialAudio(true, true)).toEqual([0x01, 0x01]);
    expect(C.encodeSpatialAudio(true, false)).toEqual([0x01, 0x00]);
    expect(C.encodeSpatialAudio(false, true)).toEqual([0x00, 0x01]);
  });

  it('round-trips every shape the wire can carry', () => {
    for (const bytes of [[0x00], [0x01], [0x00, 0x00], [0x01, 0x00], [0x01, 0x01]]) {
      const decoded = C.decodeSpatialAudio(Uint8Array.from(bytes))!;
      expect(C.encodeSpatialAudio(decoded.enabled, decoded.headTracking)).toEqual(bytes);
    }
  });
});

describe('ring my buds', () => {
  it('encodes the side byte then the play state', () => {
    expect(C.encodeRing('left', true)).toEqual([0x02, 0x01]);
    expect(C.encodeRing('right', true)).toEqual([0x03, 0x01]);
    // Stopping uses the same side byte with a silent second byte.
    expect(C.encodeRing('left', false)).toEqual([0x02, 0x00]);
  });
});

describe('device model', () => {
  it('reverses the payload and hex-encodes it, as the app does', () => {
    // A CMF Headphone Pro answers two bytes, little-endian: 0x75 0xB1.
    expect(C.decodeDeviceModel(Uint8Array.from([0x75, 0xb1]))).toBe('B175');
    expect(C.decodeDeviceModel(Uint8Array.from([0x62, 0xb1]))).toBe('B162');
    expect(C.decodeDeviceModel(Uint8Array.from([0x90, 0xb1]))).toBe('B190');
  });

  it('is not reading ASCII — the codes are hex digits, not text', () => {
    // The ASCII for "B175" decodes to something else entirely, which is what
    // the old scanning decoder wrongly expected to see.
    expect(C.decodeDeviceModel(Uint8Array.from([0x42, 0x31, 0x37, 0x35]))).toBe('35373142');
  });

  it('pads each byte to two digits', () => {
    expect(C.decodeDeviceModel(Uint8Array.from([0x05, 0x0a]))).toBe('0A05');
  });

  it('handles the four-byte ids the app uses for non-earphones', () => {
    // Watch Pro 2 is 34F72851 in the SKU catalogue.
    expect(C.decodeDeviceModel(Uint8Array.from([0x51, 0x28, 0xf7, 0x34]))).toBe('34F72851');
  });

  it('returns null only for an empty body', () => {
    expect(C.decodeDeviceModel(Uint8Array.from([]))).toBeNull();
    expect(C.decodeDeviceModel(Uint8Array.from([0x00]))).toBe('00');
  });

  it('every base code in the model table is four hex digits', () => {
    // Load-bearing: the decoder emits hex, so a non-hex base code could never
    // be matched by `modelForBase`.
    for (const model of NOTHING_MODELS) {
      expect(model.base).toMatch(/^[0-9A-FB]{4}$/);
    }
  });
});

describe('single-body battery', () => {
  it('reads the over-ears\' one cell, which used to be dropped', () => {
    // The official app calls id 6 "stereo" and falls back to id 7; mapping
    // only 2/3/4 returned an all-null battery for every over-ear while the
    // read itself succeeded, so the capability probe passed and the UI showed
    // nothing.
    for (const id of [0x05, 0x06, 0x07]) {
      expect(C.decodeBattery(Uint8Array.from([0x01, id, 0xd2]))).toEqual({
        left: null,
        right: null,
        case: null,
        single: { level: 82, charging: true },
      });
    }
  });

  it('still ignores the watch id, this app driving no watches', () => {
    expect(C.decodeBattery(Uint8Array.from([0x01, 0x01, 0x50]))).toEqual({
      left: null,
      right: null,
      case: null,
      single: null,
    });
  });
});

describe('colour id', () => {
  it('formats the byte as the two hex digits the CDN table is keyed by', () => {
    expect(C.decodeColourId(Uint8Array.from([0x01]))).toBe('01');
    expect(C.decodeColourId(Uint8Array.from([0x06]))).toBe('06');
    expect(C.decodeColourId(Uint8Array.from([0x10]))).toBe('10');
  });

  it('returns null for an empty body rather than guessing a colour', () => {
    expect(C.decodeColourId(Uint8Array.from([]))).toBeNull();
  });
});

describe('single-body models', () => {
  it('marks exactly the over-ears and the neckband', () => {
    // `single: 1` / `deviceType: 6` in the app's white list. Drives the
    // one-cell battery row and suppresses the per-bud gesture card.
    const single = NOTHING_MODELS.filter((m) => m.singleBody).map((m) => m.base).sort();
    expect(single).toEqual(['B164', 'B170', 'B175', 'B186', 'B198']);
  });

  it('keeps wear detection independent of body shape', () => {
    // The two are orthogonal: B170 is single-body and does detect wear.
    const b170 = NOTHING_MODELS.find((m) => m.base === 'B170')!;
    expect(b170.singleBody).toBe(true);
    expect(b170.inEarDetection).toBe(true);
  });

  it('follows Nothing\'s own config where it and BudsLink disagree', () => {
    // B175: Nothing says `earDetection: 0`, BudsLink says true. The app is the
    // ground truth for this table. Safe to record either way — nothing gates
    // on the flag, because `decodeInEarDetection` addresses feature id 1 and
    // lets the device settle it.
    expect(NOTHING_MODELS.find((m) => m.base === 'B175')!.inEarDetection).toBe(false);
    // Where Nothing is silent, BudsLink fills in — it marks these two false.
    for (const base of ['B179', 'B181']) {
      expect(NOTHING_MODELS.find((m) => m.base === base)!.inEarDetection).toBe(false);
    }
  });

  it('records personalized ANC where BudsLink drives it', () => {
    for (const base of ['B155', 'B171', 'B173']) {
      expect(NOTHING_MODELS.find((m) => m.base === base)!.personalizedAnc).toBe(true);
    }
  });
});

describe('CMF Buds Neo (B193)', () => {
  // The one model Nothing X 3.8.0 adds over 3.7.3. It has no
  // `IOTProductDevice` class of its own — the 18 in the dex are unchanged
  // between the two builds — so unlike every other row here its flags come
  // from `ear_white_list.json`, read only through the fields that hold up
  // when checked against the 22 models already verified from those classes.
  const b193 = () => NOTHING_MODELS.find((m) => m.base === 'B193')!;

  it('is in the table under its advertised name', () => {
    expect(b193().bluetoothName).toBe('CMF Buds Neo');
    expect(modelForBluetoothName('CMF Buds Neo')?.base).toBe('B193');
  });

  it('takes ANC and enhanced bass', () => {
    // `ancLevel: 63`. And `ultraBass: 1`, which over the 22 verified models
    // never once claimed bass boost a model did not have (15/15) — it only
    // under-reports, as it does on B190 and B175.
    expect(b193().anc).toBe(true);
    expect(b193().enhancedBass).toBe(true);
  });

  it('keeps the classic EQ presets rather than the Dirac selector', () => {
    // `eq: 0` is the exact discriminator: it selects {B168, B172, B185, B187},
    // and those are precisely this table's `diracEq` models — 22/22, no
    // exceptions. B193 has no `eq` key, so it is not a Dirac model.
    // `diracOpteoSupport: 1` would have said otherwise; it agrees with this
    // table only 19/22, which is why the table comment warns against it.
    expect(b193().diracEq).toBe(false);
  });

  it('leaves false what the white list is silent about', () => {
    // No `earTipFitTest` key (that field matches this table 22/22) and no
    // `personalizedAnc`. `earDetection: 0`, which holds 7/8 where stated.
    expect(b193().earFitTest).toBe(false);
    expect(b193().personalizedAnc).toBe(false);
    expect(b193().inEarDetection).toBe(false);
    expect(b193().singleBody).toBeUndefined();
  });
});

describe('extra-feature status', () => {
  it('addresses the feature by id, not by position', () => {
    // count 2, then (id, value) pairs. In-ear detection is id 1.
    const body = Uint8Array.from([0x02, 0x09, 0x01, 0x01, 0x01]);
    expect(C.decodeInEarDetection(body)).toBe(true);
    // The old decoder read payload[2] — here the *other* feature's value.
    expect(C.decodeExtraFeature(body, 0x09)).toBe(true);
  });

  it('distinguishes "off" from "not mentioned"', () => {
    const off = Uint8Array.from([0x01, 0x01, 0x00]);
    expect(C.decodeInEarDetection(off)).toBe(false);
    const absent = Uint8Array.from([0x01, 0x07, 0x01]);
    expect(C.decodeInEarDetection(absent)).toBeNull();
    expect(C.decodeInEarDetection(Uint8Array.from([]))).toBeNull();
  });

  it('writes the count-prefixed triple the app writes', () => {
    expect(C.encodeInEarDetection(true)).toEqual([0x01, 0x01, 0x01]);
    expect(C.encodeInEarDetection(false)).toEqual([0x01, 0x01, 0x00]);
  });
});

describe('noise-control triples', () => {
  it('finds the item keyed 1 wherever it sits', () => {
    // Two 3-byte (key, mode, level) items, the current one second.
    const body = Uint8Array.from([0x02, 0x03, 0x00, 0x01, 0x07, 0x00]);
    expect(C.decodeAncMode(body)).toBe(C.AncLevel.Transparency);
  });

  it('covers all eight of the app\'s modes', () => {
    const expected: Array<[number, number]> = [
      [C.AncLevel.NcHigh, 0x01],
      [C.AncLevel.NcMid, 0x02],
      [C.AncLevel.NcLow, 0x03],
      [C.AncLevel.Adaptive, 0x04],
      [C.AncLevel.Off, 0x05],
      [C.AncLevel.Comfortable, 0x06],
      [C.AncLevel.Transparency, 0x07],
      [C.AncLevel.Adaptive2, 0x08],
    ];
    for (const [level, wire] of expected) {
      expect(C.encodeAncMode(level)).toEqual([0x01, wire, 0x00]);
      expect(C.decodeAncMode(Uint8Array.from([0x01, wire, 0x00]))).toBe(level);
    }
  });

  it('returns null when no item is keyed 1', () => {
    expect(C.decodeAncMode(Uint8Array.from([0x03, 0x07, 0x00]))).toBeNull();
  });
});

describe('personalized ANC', () => {
  it('keeps the calibration byte the reply carries', () => {
    expect(C.decodePersonalizedAnc(Uint8Array.from([0x01, 0x02]))).toEqual({
      enabled: true,
      calibration: 2,
    });
    expect(C.decodePersonalizedAnc(Uint8Array.from([0x00]))).toEqual({
      enabled: false,
      calibration: 0,
    });
    expect(C.decodePersonalizedAnc(Uint8Array.from([]))).toBeNull();
  });
});

describe('wear state', () => {
  it('decodes the flag bits per device', () => {
    // Left in ear and connected (0x84), right in the case (0x81).
    const body = Uint8Array.from([0x02, 0x02, 0x84, 0x03, 0x81]);
    const status = C.decodeEarphoneStatus(body);
    expect(status.left).toEqual({
      inCase: false,
      inEar: true,
      onCall: false,
      ota: false,
      connected: true,
    });
    expect(status.right?.inCase).toBe(true);
    expect(status.right?.inEar).toBe(false);
    expect(status.case).toBeNull();
  });

  it('reads a single-body device into the same slot the battery uses', () => {
    const status = C.decodeEarphoneStatus(Uint8Array.from([0x01, 0x06, 0x04]));
    expect(status.single?.inEar).toBe(true);
    expect(C.isWorn(status)).toBe(true);
  });

  it('is not worn when nothing reports an ear, and unknown stays null', () => {
    expect(C.isWorn(C.decodeEarphoneStatus(Uint8Array.from([0x01, 0x02, 0x81])))).toBe(false);
    expect(C.isWorn(null)).toBe(false);
  });
});

describe('device configuration', () => {
  const body = (text: string) =>
    Uint8Array.from([text.length, ...[...text].map((c) => c.charCodeAt(0))]);

  it('parses the count byte then CSV lines, not a binary structure', () => {
    const values = C.decodeConfiguration(body('2,4,SN12345\n2,1,HW-A\n3,2,1.0.1.45'));
    expect(values).toEqual([
      { device: 2, type: 4, value: 'SN12345' },
      { device: 2, type: 1, value: 'HW-A' },
      { device: 3, type: 2, value: '1.0.1.45' },
    ]);
    expect(C.configValue(values, C.ConfigType.SerialNumber)).toBe('SN12345');
    expect(C.configValue(values, C.ConfigType.HardwareVersion)).toBe('HW-A');
    expect(C.configValue(values, C.ConfigType.ManufactureDate)).toBeNull();
  });

  it('skips malformed lines the way the app does', () => {
    expect(C.decodeConfiguration(body('nonsense\n2,4,OK'))).toEqual([
      { device: 2, type: 4, value: 'OK' },
    ]);
    expect(C.decodeConfiguration(Uint8Array.from([]))).toEqual([]);
  });
});

describe('clarity boost and the one-byte switches', () => {
  it('round-trips clarity boost as [enabled, level]', () => {
    expect(C.encodeClarityBoost(true, C.ClarityLevel.High)).toEqual([0x01, 0x02]);
    expect(C.decodeClarityBoost(Uint8Array.from([0x01, 0x02]))).toEqual({
      enabled: true,
      level: 2,
    });
    expect(C.decodeClarityBoost(Uint8Array.from([]))).toBeNull();
  });

  it('round-trips the shared switch shape', () => {
    expect(C.encodeSwitch(true)).toEqual([0x01]);
    expect(C.encodeSwitch(false)).toEqual([0x00]);
    expect(C.decodeSwitch(Uint8Array.from([0x01]))).toBe(true);
    expect(C.decodeSwitch(Uint8Array.from([0x00]))).toBe(false);
    expect(C.decodeSwitch(Uint8Array.from([]))).toBeNull();
  });
});

describe('gesture records', () => {
  it('carries the button byte through a write', () => {
    // The old encoder wrote a constant 0x01 here, retargeting the assignment
    // at the function button whatever control it came from.
    expect(
      C.encodeGesture({ device: 3, button: G_BUTTON_ANC, gesture: 7, operation: 10 }),
    ).toEqual([0x01, 0x03, G_BUTTON_ANC, 0x07, 0x0a]);
  });

  it('round-trips a record', () => {
    const record = { device: 2, button: 5, gesture: 17, operation: 27 };
    const wire = C.encodeGesture(record);
    expect(C.decodeGestures(Uint8Array.from(wire))).toEqual([record]);
  });
});

const G_BUTTON_ANC = C.GestureButton.Anc;


describe('advanced 8-band EQ', () => {
  const band = (filterType: number, gain: number, frequency: number, q: number) => ({
    filterType,
    gain,
    frequency,
    q,
  });

  it('round-trips the profile index, total gain and every band', () => {
    const eq: C.AdvancedEq = {
      profileIndex: 2,
      totalGain: 0,
      bands: C.ADVANCED_EQ_FREQUENCIES.map((f, i) =>
        band(i === 0 ? C.EqFilter.LowShelf : i === 7 ? C.EqFilter.HighShelf : C.EqFilter.Peak, i - 3, f.hz, 1),
      ),
    };
    const wire = Uint8Array.from(C.encodeAdvancedEqBands(eq));
    // profileIndex(1) + count(1) + totalGain(4) + 8 × 13
    expect(wire).toHaveLength(6 + 8 * 13);
    const back = C.decodeAdvancedEqBands(wire)!;
    expect(back.profileIndex).toBe(2);
    expect(back.bands).toHaveLength(8);
    back.bands.forEach((b, i) => {
      expect(b.filterType).toBe(eq.bands[i].filterType);
      expect(b.gain).toBeCloseTo(eq.bands[i].gain, 4);
      expect(b.frequency).toBeCloseTo(eq.bands[i].frequency, 2);
    });
  });

  it('reads a zero count as eight bands, as EQEntity does', () => {
    // A profile never written reports count 0; the app treats that as 8.
    const wire = new Uint8Array(6 + 8 * 13);
    wire[0] = 1;
    wire[1] = 0;
    const back = C.decodeAdvancedEqBands(wire)!;
    expect(back.bands).toHaveLength(8);
  });

  it('is one byte further in than the simple custom EQ', () => {
    // Simple: [count][gain] then bands at 5. Advanced: [profile][count][gain]
    // then bands at 6. Getting these confused shifts every value.
    const wire = Uint8Array.from(C.encodeAdvancedEqBands({
      profileIndex: 0,
      totalGain: 0,
      bands: [band(C.EqFilter.Peak, 7, 980, 0.7)],
    }));
    expect(wire[0]).toBe(0); // profile index
    expect(wire[1]).toBe(1); // band count
    expect(wire[6]).toBe(C.EqFilter.Peak); // first band's filter type
    expect(C.decodeAdvancedEqBands(wire)!.bands[0].gain).toBeCloseTo(7, 4);
  });

  it('refuses a body too short for the bands it claims', () => {
    expect(C.decodeAdvancedEqBands(Uint8Array.from([0, 8, 0, 0, 0]))).toBeNull();
    expect(C.decodeAdvancedEqBands(Uint8Array.from([]))).toBeNull();
  });

  it('carries the eight default centre frequencies', () => {
    expect(C.ADVANCED_EQ_FREQUENCIES.map((f) => f.hz)).toEqual([
      55, 110, 220, 440, 1320, 3300, 6600, 13200,
    ]);
  });
});

describe('clock and one-shot actions', () => {
  it('writes epoch seconds big-endian, unlike the EQ floats', () => {
    // 2026-01-01T00:00:00Z is 0x684C_5A00... check against the arithmetic.
    const when = new Date('2026-01-01T00:00:00Z');
    const seconds = Math.floor(when.getTime() / 1000);
    expect(C.encodeUtcTime(when)).toEqual([
      (seconds >>> 24) & 0xff,
      (seconds >>> 16) & 0xff,
      (seconds >>> 8) & 0xff,
      seconds & 0xff,
    ]);
    // Big-endian: the most significant byte first, so it is not 0x00-led.
    expect(C.encodeUtcTime(when)[0]).toBeGreaterThan(0);
  });

  it('starts calibration with a bare 1', () => {
    expect(C.encodeStartCalibration()).toEqual([0x01]);
  });
});

describe('gesture labels', () => {
  it('names the single-body device id BudsLink confirms', () => {
    expect(C.GestureDevice.Single).toBe(6);
    expect(C.gestureDeviceLabel(C.GestureDevice.Single)).toBe('Headphone');
    expect(C.gestureDeviceLabel(C.GestureDevice.Left)).toBe('Left bud');
  });

  it('labels a B175 slot the way BudsLink describes it', () => {
    // device 0x06, magic button 0x0A, press-and-hold 0x07.
    expect(
      C.gestureLabel({ device: 6, button: 0x0a, gesture: 0x07, operation: 0x0b }),
    ).toBe('Magic button · Press and hold');
  });

  it('names the two operations only the white list and BudsLink carry', () => {
    expect(C.GESTURE_OPERATION_NAMES[C.GestureOperation.UltraBass]).toBe('Ultra bass');
    expect(C.GESTURE_OPERATION_NAMES[C.GestureOperation.TrebleEnhance]).toBe('Treble enhance');
    expect(C.GestureOperation.UltraBass).toBe(0x23);
    expect(C.GestureOperation.TrebleEnhance).toBe(0x24);
  });

  it('falls back to the raw bytes rather than inventing a name', () => {
    expect(C.gestureLabel({ device: 2, button: 99, gesture: 98, operation: 1 })).toBe(
      'Button 99 · Gesture 98',
    );
  });
});

describe('ring my buds', () => {
  it('addresses a single-body device as 0x06, not a side', () => {
    // BudsLink's `setRingMyBuds` branches on `batterySingle` and pushes 0x06.
    // The old encoder had no such case and its comment claimed the over-ears
    // had no ringer at all.
    expect(C.encodeRing('single', true)).toEqual([0x06, 0x01]);
    expect(C.encodeRing('single', false)).toEqual([0x06, 0x00]);
  });

  it('omits the side byte on the one legacy model', () => {
    expect(C.encodeRing('left', true, { legacy: true })).toEqual([0x01]);
    expect(C.encodeRing('single', false, { legacy: true })).toEqual([0x00]);
  });

  it('uses the same device ids as battery and gestures', () => {
    expect(C.encodeRing('left', true)[0]).toBe(C.GestureDevice.Left);
    expect(C.encodeRing('right', true)[0]).toBe(C.GestureDevice.Right);
    expect(C.encodeRing('single', true)[0]).toBe(C.GestureDevice.Single);
  });
});

describe('model table conflicts between sources', () => {
  it('rings the Ear (1) the legacy way and nothing else', () => {
    const legacy = NOTHING_MODELS.filter((m) => m.ringLegacy).map((m) => m.base);
    expect(legacy).toEqual(['B181']);
  });
});

describe('colourway names', () => {
  it('maps the byte to the name in the app\'s DeviceColor enum', () => {
    expect(C.nothingColourName('01')).toBe('Black');
    expect(C.nothingColourName('02')).toBe('White');
    expect(C.nothingColourName('03')).toBe('Blue');
    expect(C.nothingColourName('06')).toBe('Green');
    expect(C.nothingColourName('07')).toBe('Orange');
  });

  it('decodes blue off the wire', () => {
    // DeviceColor.BLUE is ordinal 3, so the byte is 0x03 and the key "03".
    expect(C.decodeColourId(Uint8Array.from([0x03]))).toBe('03');
    expect(C.nothingColourName(C.decodeColourId(Uint8Array.from([0x03])))).toBe('Blue');
  });

  it('returns null for an id the enum does not name', () => {
    expect(C.nothingColourName('FE')).toBeNull();
    expect(C.nothingColourName(null)).toBeNull();
  });
});

describe('every model resolves to its own profile', () => {
  // `nothingArtwork` looks the profile up by `state.info.model`, which is the
  // display name, and `profileFor` returns the first match in list order. The
  // profile regexes must therefore match the whole name: Nothing's names nest,
  // so a substring match hands a model the artwork of whichever older sibling
  // was declared first.
  it('by display name', () => {
    for (const model of NOTHING_MODELS) {
      expect(profileFor('nothing', model.name)?.artwork).toBe(model.base.toLowerCase());
    }
  });

  it('by base code', () => {
    for (const model of NOTHING_MODELS) {
      expect(profileFor('nothing', model.base)?.artwork).toBe(model.base.toLowerCase());
    }
  });
});
