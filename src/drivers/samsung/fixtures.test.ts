/**
 * Real frames, from real earbuds.
 *
 * The first seven are the binary captures GalaxyBudsClient keeps as its own
 * test fixtures (`GalaxyBudsClient.Tests/TestData/ExtendedStatusUpdate/*.bin`),
 * with the values its tests expect them to decode to
 * (`GalaxyBudsClient.Tests/<Model>/ExtendedStatusUpdateTests.cs`) — one capture
 * per model, from the author's and contributors' hardware. The last is the
 * Buds3 Pro frame MagicPodsCore's `TestsSgb.cpp` carries, which a live session
 * against a Buds3 Pro also decoded (omarchy-buds `knowledge/spp-protocol.md`).
 * See docs/superpowers/specs/2026-10-02-samsung-driver-design.md §11.
 *
 * They are the only evidence in this repo that does not come from reading code,
 * so what they assert is deliberately the whole set of fields the driver reads.
 */
import { describe, expect, it } from 'vitest';

import { decodeExtended } from './decode';
import { FrameDecoder } from './frame';
import { modelById } from './models';
import type { SamsungModelId } from './models';

const bytes = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g)!.map((pair) => parseInt(pair, 16)));

interface Capture {
  model: SamsungModelId;
  variant?: 'legacy';
  hex: string;
}

const CAPTURES: Record<string, Capture> = {
  buds_rev3: { model: 'buds', variant: 'legacy', hex: 'fe0112610300465f0100000000020107002201a575ee' },
  budsPlus_rev13: { model: 'budsPlus', hex: 'fd1b10610d00575401001165000000030022010401040100000003001e55dd' },
  budsLive_rev9: { model: 'budsLive', hex: 'fd1c106109010f610100116400000022010017011701000003001000000281dd' },
  budsPro_rev10: {
    model: 'budsPro',
    hex: 'fd290c610a02595e010113640001002200002a012a0101000355000201000002001000010000220200009d24dd',
  },
  buds2_rev10: {
    model: 'buds2',
    hex: 'fd2810610a0364640101113300033f2201003c013c0102000366000100100000000011020101000000bea3dd',
  },
  buds2Pro_rev13: {
    model: 'buds2Pro',
    hex: 'fd3100610d046464010033580001bf220001460146010000033500030010010101013203010101000cae0100030001000101b637dd',
  },
  budsFe_rev2: {
    model: 'budsFe',
    hex: 'fd31106102063a590100110000008f3300004a014a01030004650001001000000101110300000000e80300009d0e1d005000c2cfdd',
  },
  buds3Pro_rev2: {
    model: 'buds3Pro',
    hex: 'fd3d006102086464010111000000ff22000054015401070004dd0004041000010000110200000000000000000000000000000100000200010000ff0101000f54dd',
  },
};

/** Decodes a capture through the real deframer, so the CRC and the length are checked too. */
function decode(name: string) {
  const capture = CAPTURES[name];
  const frames = new FrameDecoder(capture.variant ?? 'standard').push(bytes(capture.hex));
  expect(frames, `${name} must be one valid frame`).toHaveLength(1);
  expect(frames[0].id).toBe(0x61);
  const update = decodeExtended(frames[0].payload, modelById(capture.model)!);
  expect(update).not.toBeNull();
  return update!;
}

describe('every captured frame is a valid frame', () => {
  it('carries a CRC-16/XMODEM that checks out, whatever the flag bits say', () => {
    for (const name of Object.keys(CAPTURES)) {
      const capture = CAPTURES[name];
      expect(new FrameDecoder(capture.variant ?? 'standard').push(bytes(capture.hex)), name).toHaveLength(1);
    }
  });

  it('sets the header flags inconsistently, so nothing may depend on them', () => {
    const highBytes = Object.values(CAPTURES)
      .filter((capture) => capture.variant !== 'legacy')
      .map((capture) => bytes(capture.hex)[2]);
    expect(new Set(highBytes)).toEqual(new Set([0x10, 0x0c, 0x00]));
  });
});

describe('decodeExtended on real captures', () => {
  it('Galaxy Buds (2019), revision 3', () => {
    expect(decode('buds_rev3')).toMatchObject({
      revision: 3,
      earType: 0,
      battery: { left: 70, right: 95, case: null },
      placement: { left: 'idle', right: 'idle' },
      eq: 3, // enabled, mode 7: preset 2 ("Dynamic") on the Dolby-variant ladder
      touchLocked: false,
      noiseMode: 0,
      ambientLevel: 2,
      touchOptions: { left: 2, right: 2 }, // Volume on the 2019 Buds' own map
      colour: null,
    });
  });

  it('Galaxy Buds+, revision 13', () => {
    expect(decode('budsPlus_rev13')).toMatchObject({
      revision: 13,
      earType: 0,
      battery: { left: 87, right: 84, case: null }, // case byte 101 = unknown
      placement: { left: 'wearing', right: 'wearing' },
      eq: 3,
      touchLocked: false,
      noiseMode: 0,
      ambientLevel: 0,
      touchOptions: { left: 2, right: 2 }, // Ambient sound
      colour: 260, // Buds+ Black
    });
  });

  it('Galaxy Buds Live, revision 9', () => {
    expect(decode('budsLive_rev9')).toMatchObject({
      revision: 9,
      earType: 1,
      battery: { left: 15, right: 97, case: 100 },
      placement: { left: 'wearing', right: 'wearing' },
      eq: 0,
      touchLocked: false,
      noiseMode: 1, // ANC on
      ambientLevel: null, // Live has no ambient sound
      touchOptions: { left: 2, right: 2 }, // ANC on the Live's map
      colour: 279, // Buds Live White
    });
  });

  it('Galaxy Buds Pro, revision 10', () => {
    expect(decode('budsPro_rev10')).toMatchObject({
      revision: 10,
      earType: 2,
      battery: { left: 89, right: 94, case: 100 },
      placement: { left: 'wearing', right: 'case' },
      eq: 1,
      touchLocked: false,
      noiseMode: 0,
      ambientLevel: 2,
      touchOptions: { left: 2, right: 2 }, // switch noise control
      colour: 298, // Buds Pro Black
      noiseTouch: {
        right: { off: true, ambient: false, anc: true, adaptive: false },
        left: { off: true, ambient: false, anc: true, adaptive: false },
      },
    });
  });

  it('Galaxy Buds2, revision 10', () => {
    const update = decode('buds2_rev10');
    expect(update).toMatchObject({
      revision: 10,
      earType: 3,
      battery: { left: 100, right: 100, case: 51 },
      placement: { left: 'wearing', right: 'wearing' },
      eq: 3,
      touchLocked: true,
      noiseMode: 1,
      ambientLevel: 1,
      touchOptions: { left: 2, right: 2 },
      colour: 316, // Buds2 Green
      noiseTouch: {
        right: { off: false, ambient: true, anc: true, adaptive: false },
        left: { off: false, ambient: true, anc: true, adaptive: false },
      },
    });
    expect(update.gestures).toEqual({ single: true, double: true, triple: true, hold: true, doubleForCalls: true, holdForCalls: true });
  });

  it('Galaxy Buds2 Pro, revision 13', () => {
    const update = decode('buds2Pro_rev13');
    expect(update).toMatchObject({
      revision: 13,
      earType: 4,
      battery: { left: 100, right: 100, case: 88 },
      placement: { left: 'case', right: 'case' },
      eq: 1,
      touchLocked: false,
      noiseMode: 0,
      ambientLevel: 3,
      touchOptions: { left: 2, right: 2 },
      colour: 326, // Buds2 Pro Grey
      noiseTouch: {
        right: { off: true, ambient: false, anc: true, adaptive: false },
        left: { off: true, ambient: true, anc: false, adaptive: false },
      },
    });
    expect(update.gestures?.holdForCalls).toBe(true);
  });

  it('Galaxy Buds FE, revision 2', () => {
    const update = decode('budsFe_rev2');
    expect(update).toMatchObject({
      revision: 2,
      earType: 6,
      battery: { left: 58, right: 89, case: null }, // case byte 0 = no reading
      placement: { left: 'wearing', right: 'wearing' },
      eq: 0,
      touchLocked: false,
      noiseMode: 0,
      ambientLevel: 1,
      touchOptions: { left: 3, right: 3 }, // Volume
      colour: 330, // Buds FE Graphite
      noiseTouch: {
        right: { off: true, ambient: false, anc: true, adaptive: false },
        left: { off: false, ambient: true, anc: true, adaptive: false },
      },
    });
    expect(update.gestures).toMatchObject({ single: true, hold: true, doubleForCalls: false, holdForCalls: false });
  });

  it('Galaxy Buds3 Pro, revision 2: the prefix, lock, touch options, mode and colour', () => {
    const update = decode('buds3Pro_rev2');
    expect(update).toMatchObject({
      revision: 2,
      earType: 8,
      battery: { left: 100, right: 100, case: null },
      placement: { left: 'wearing', right: 'wearing' },
      eq: 0,
      touchLocked: false,
      noiseMode: 0,
      touchOptions: { left: 2, right: 2 },
      colour: 340, // Buds3 Pro Silver — also what omarchy-buds read from the device-id UUID
      ambientLevel: 4,
    });
  });
});
