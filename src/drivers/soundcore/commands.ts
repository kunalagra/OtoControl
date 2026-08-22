/**
 * Soundcore A3951 (Liberty Air 2 Pro) commands and payload codecs.
 *
 * Every constant is ported from gmallios/SoundcoreManager (`soundcore-lib`),
 * with the state payload's late fields aligned against its A3951 test
 * captures rather than the parser's struct order — the hear-id block in
 * between is not worth decoding, so the tail is read from the end.
 */

/** Response kinds, as u16 values in wire order (big-endian bytes 5–6). */
export const Kind = {
  StateUpdate: 0x0101,
  BatteryLevel: 0x0103,
  BatteryCharging: 0x0104,
  InfoUpdate: 0x0105,
  VoicePromptUpdate: 0x0110,
  /** LDAC state: answers the query and pushes after changes. */
  LdacState: 0x017f,
  EqInfoUpdate: 0x0201,
  /** Every write is acknowledged by its own command id echoing back — this
      one is the `03 87` EQ write's echo, confirmed on hardware. */
  SetEqAck: 0x0387,
  SoundModeUpdate: 0x0601,
  SetSoundModeAck: 0x0681,
  // Writes are acknowledged by the command id echoing back as a response kind.
  SetWearDetectionAck: 0x0181,
  SetTouchToneAck: 0x0183,
  SetVoicePromptAck: 0x0190,
  SetLdacAck: 0x01ff,
  ButtonActionAck: 0x0481,
  ResetButtonsAck: 0x0482,
  ButtonEnabledAck: 0x0483,
} as const;

/** The fixed 7-byte command headers. */
export const Command = {
  /** Full state: battery, EQ, hear-id, buttons, wear detection, sound mode. */
  RequestState: [0x08, 0xee, 0x00, 0x00, 0x00, 0x01, 0x01],
  /** Dual firmware string + 16-char serial. */
  RequestInfo: [0x08, 0xee, 0x00, 0x00, 0x00, 0x01, 0x05],
  /** Sound-mode write; answered by `Kind.SetSoundModeAck`. */
  SetSoundMode: [0x08, 0xee, 0x00, 0x00, 0x00, 0x06, 0x81],
  /** Custom-EQ write; answered by `Kind.SetEqAck`. */
  SetEq: [0x08, 0xee, 0x00, 0x00, 0x00, 0x03, 0x87],
  /** LDAC query (`Kind.LdacState` answers); write is `SetLdac`. */
  RequestLdacState: [0x08, 0xee, 0x00, 0x00, 0x00, 0x01, 0x7f],
  /** `[enabled]`; answered by `Kind.SetLdacAck`. */
  SetLdac: [0x08, 0xee, 0x00, 0x00, 0x00, 0x01, 0xff],
  /** `[on]`; answered by `Kind.SetWearDetectionAck`. */
  SetWearDetection: [0x08, 0xee, 0x00, 0x00, 0x00, 0x01, 0x81],
  /** `[on]`; answered by `Kind.SetTouchToneAck`. */
  SetTouchTone: [0x08, 0xee, 0x00, 0x00, 0x00, 0x01, 0x83],
  /** `[on]`; answered by `Kind.SetVoicePromptAck`; pushes `Kind.VoicePromptUpdate`. */
  SetVoicePrompt: [0x08, 0xee, 0x00, 0x00, 0x00, 0x01, 0x90],
  /** `[side, buttonId, actionByte]`; answered by `Kind.ButtonActionAck`. */
  SetButtonAction: [0x08, 0xee, 0x00, 0x00, 0x00, 0x04, 0x81],
  /** Restores every button to the factory action; empty payload. */
  ResetButtons: [0x08, 0xee, 0x00, 0x00, 0x00, 0x04, 0x82],
  /** `[side, buttonId, enabled]`; answered by `Kind.ButtonEnabledAck`. */
  SetButtonEnabled: [0x08, 0xee, 0x00, 0x00, 0x00, 0x04, 0x83],
} as const;

/** One boolean flag on the wire — every set-flag payload is exactly this. */
export const flagPayload = (value: boolean): number[] => [value ? 1 : 0];

// --- sound mode --------------------------------------------------------------

/** Which processing path is active. */
export const CurrentMode = {
  Anc: 0x00,
  Transparency: 0x01,
  Normal: 0x02,
} as const;

/** The ANC scene, while in ANC mode. */
export const AncScene = {
  Transport: 0x00,
  Outdoor: 0x01,
  Indoor: 0x02,
  Custom: 0x03,
} as const;

/** The transparency flavour, while in transparency mode. */
export const TransparencyMode = {
  FullyTransparent: 0x00,
  Vocal: 0x01,
} as const;

export interface SoundMode {
  current: number;
  ancScene: number;
  transparency: number;
  /** Vendor custom-ANC byte, carried through untouched on writes. */
  custom: number;
}

/** `[current, ancScene, transparency, custom]` — the A3951 write payload. */
export const encodeSoundMode = (mode: SoundMode): number[] => [
  mode.current,
  mode.ancScene,
  mode.transparency,
  mode.custom,
];

/** The `06 01` notification payload is the same four bytes. */
export function decodeSoundMode(payload: Uint8Array): SoundMode | null {
  if (payload.length < 4) return null;
  return { current: payload[0], ancScene: payload[1], transparency: payload[2], custom: payload[3] };
}

// --- state response ------------------------------------------------------------

export interface DualBattery {
  /**
   * Percent 0–100, or null when that side is not reporting. The wire byte is
   * one of six steps (0–5) — OpenSCQ30's device definitions give every
   * Soundcore model `max_level = 5` and render percent as level × 20, and
   * SoundcoreManager's own battery icon switches on exactly 0–5. A byte of
   * 255 means that bud is absent (TWS link down, host is the other side);
   * anything else out of range is treated the same rather than displayed.
   */
  left: { level: number | null; charging: boolean };
  right: { level: number | null; charging: boolean };
}

/** Wire step → percent; see `DualBattery` for why 0–5 and 255. */
export const batteryStepToPercent = (byte: number): number | null => {
  if (byte > 5) return null;
  return byte * 20;
};

const batteryCell = (levelByte: number, chargingByte: number) => ({
  level: batteryStepToPercent(levelByte),
  charging: chargingByte !== 0,
});

export interface SoundcoreStateReading {
  battery: DualBattery;
  /** True when both buds are linked as a pair. */
  tws: boolean;
  /** The active EQ profile id, 0xFEFE being custom. */
  eqProfile: number | null;
  /** The 8 custom band gains per side, when the profile is custom. */
  eqLeft: number[] | null;
  eqRight: number[] | null;
  /** Per-bud tap assignments; absent when the packet is too short to hold them. */
  buttons: ButtonState[] | null;
  /**
   * The sound mode. The device also pushes `06 01` after every change — but
   * only after a change, so this is the only source of the mode at connect
   * time.
   */
  soundMode: SoundMode | null;
  wearDetection: boolean | null;
  touchTone: boolean | null;
}

/**
 * Parses an A3951 state payload.
 *
 * Layout is fixed-width and decoded forward — verified against both of
 * SoundcoreManager's A3951 captures, where every offset below lands exactly:
 *
 * ```
 * 0      host device (which bud talks to the phone)
 * 1      TWS status
 * 2–5    battery: left level, right level, left charging, right charging
 * 6–23   EQ: profile u16 LE + left 8 bands + right 8 bands
 * 24–25  gender, age range        ┐ hear-id block, undecoded (39 bytes)
 * 26–64  HearID volume/time/curve ┘
 * 65–76  button assignments (see `decodeButtons`)
 * 77–80  sound mode: current, ANC scene, transparency, custom-ANC byte
 * 81     side tone          ┐
 * 82     wear detection     ├ fixed tail
 * 83     touch tone         ┘
 * 84+    optional: HearID preset u16 LE, "new battery" pair, unknown
 * ```
 *
 * Forward decoding matters because the trailing optionals are
 * firmware-dependent (OpenSCQ30 flags packets over 98 bytes as carrying the
 * newer battery field) — a tail read from the end would land on the wrong
 * bytes for any firmware whose optional count differs from the captures'.
 */
export function decodeState(payload: Uint8Array): SoundcoreStateReading | null {
  // Through the fixed tail at byte 83 inclusive.
  if (payload.length < 84) return null;

  const battery: DualBattery = {
    left: batteryCell(payload[2], payload[4]),
    right: batteryCell(payload[3], payload[5]),
  };

  const eqProfile = payload[6] | (payload[7] << 8);
  const isCustom = eqProfile === 0xfefe;

  return {
    battery,
    tws: payload[1] !== 0,
    eqProfile,
    eqLeft: isCustom ? Array.from(payload.slice(8, 16)) : null,
    eqRight: isCustom ? Array.from(payload.slice(16, 24)) : null,
    buttons: decodeButtons(payload.slice(65, 77)),
    soundMode: decodeSoundMode(payload.subarray(77, 81)),
    wearDetection: payload[82] !== 0,
    touchTone: payload[83] !== 0,
  };
}

/**
 * The `01 03` push: live battery levels, `[left, right]`. OpenSCQ30 registers
 * this kind as its dual-battery level handler; the same steps-to-percent rule
 * as the state block applies.
 */
export function decodeBatteryLevels(payload: Uint8Array): { left: number | null; right: number | null } | null {
  if (payload.length < 2) return null;
  return { left: batteryStepToPercent(payload[0]), right: batteryStepToPercent(payload[1]) };
}

/** The `01 04` push: live charging flags, `[left, right]`. */
export function decodeBatteryCharging(payload: Uint8Array): { left: boolean; right: boolean } | null {
  if (payload.length < 2) return null;
  return { left: payload[0] !== 0, right: payload[1] !== 0 };
}

// --- buttons --------------------------------------------------------------------

/** Which bud a gesture is assigned on. */
export const ButtonSide = { Left: 0, Right: 1 } as const;
export type ButtonSideId = (typeof ButtonSide)[keyof typeof ButtonSide];

/** The gestures this generation of buds can reassign. */
export const Gesture = {
  Single: 2,
  Double: 0,
  Long: 1,
} as const;
export type GestureId = (typeof Gesture)[keyof typeof Gesture];

/**
 * Action ids, from OpenSCQ30's `COMMON_ACTIONS` — cross-checked against
 * SoundcoreManager's parser test vector (`01 63 …` → double-press nibbles
 * PlayPause/NextSong, `00 01` → single-press VolumeDown).
 */
export const ButtonAction = {
  VolumeUp: 0x00,
  VolumeDown: 0x01,
  PreviousSong: 0x02,
  NextSong: 0x03,
  AmbientSoundMode: 0x04,
  VoiceAssistant: 0x05,
  PlayPause: 0x06,
} as const;

export const BUTTON_ACTION_NAMES: Readonly<Record<number, string>> = {
  [ButtonAction.VolumeUp]: 'Volume up',
  [ButtonAction.VolumeDown]: 'Volume down',
  [ButtonAction.PreviousSong]: 'Previous song',
  [ButtonAction.NextSong]: 'Next song',
  [ButtonAction.AmbientSoundMode]: 'Cycle noise control',
  [ButtonAction.VoiceAssistant]: 'Voice assistant',
  [ButtonAction.PlayPause]: 'Play / pause',
};

export interface ButtonState {
  side: ButtonSideId;
  gesture: GestureId;
  /** False when the gesture is disabled outright. */
  enabled: boolean;
  /**
   * The action while both buds are linked, and while one is used alone.
   * Single press carries no TWS split — the pair holds the same value.
   */
  twsAction: number;
  soloAction: number;
}

export const GESTURE_NAMES: Readonly<Record<number, string>> = {
  [Gesture.Single]: 'Single tap',
  [Gesture.Double]: 'Double tap',
  [Gesture.Long]: 'Hold',
};

const SIDE_NAMES = ['Left', 'Right'] as const;

/**
 * The state's 12-byte button block, six 2-byte entries in wire order:
 * left-double, left-hold, right-double, right-hold (each `[enabled,
 * solo<<4 | tws]`), then left-single, right-single (each `[enabled, action]`).
 *
 * Cross-checked between OpenSCQ30's `COMMON_SETTINGS` order and
 * SoundcoreManager's A3909 button-model bytes and parser test vector.
 */
export function decodeButtons(block: Uint8Array): ButtonState[] | null {
  if (block.length < 12) return null;
  // [side, gesture, tws-style?]
  const layout: Array<[ButtonSideId, GestureId, boolean]> = [
    [ButtonSide.Left, Gesture.Double, true],
    [ButtonSide.Left, Gesture.Long, true],
    [ButtonSide.Right, Gesture.Double, true],
    [ButtonSide.Right, Gesture.Long, true],
    [ButtonSide.Left, Gesture.Single, false],
    [ButtonSide.Right, Gesture.Single, false],
  ];
  return layout.map(([side, gesture, twsStyle], i) => {
    const enabled = block[i * 2] !== 0;
    const byte = block[i * 2 + 1];
    return {
      side,
      gesture,
      enabled,
      // Single press has no split; mirror its action into both slots.
      twsAction: twsStyle ? byte & 0xf : byte & 0xf,
      soloAction: twsStyle ? byte >> 4 : byte & 0xf,
    };
  });
}

/**
 * One button write: `[side, button id, action byte]`, where the action byte
 * packs the TWS-linked action low and solo action high for double/hold, and
 * is simply the action for single taps.
 */
export function encodeButtonAction(
  side: ButtonSideId,
  gesture: GestureId,
  twsAction: number,
  soloAction: number,
): number[] {
  const packed = gesture === Gesture.Single ? twsAction & 0xf : ((soloAction & 0xf) << 4) | (twsAction & 0xf);
  return [side, gesture, packed];
}

/**
 * Enables or disables one gesture on one bud: `[side, button id, enabled]`.
 * The gesture id doubles as the wire's button id (double = 0, hold = 1,
 * single = 2).
 */
export const encodeButtonEnabled = (
  side: ButtonSideId,
  gesture: GestureId,
  enabled: boolean,
): number[] => [side, gesture, enabled ? 1 : 0];

/** The state block's own rendering of one entry, for round-trip tests. */
export const buttonEntryBytes = (twsStyle: boolean, enabled: boolean, twsAction: number, soloAction: number): [number, number] =>
  [enabled ? 1 : 0, twsStyle ? ((soloAction & 0xf) << 4) | (twsAction & 0xf) : twsAction & 0xf];

export const buttonLabel = (button: ButtonState): string =>
  `${SIDE_NAMES[button.side]} ${GESTURE_NAMES[button.gesture].toLowerCase()}`;

// --- info response --------------------------------------------------------------

export interface SoundcoreInfoReading {
  /** Both firmware strings the device reports ("05.63", "05.63"). */
  firmware: [string, string];
  /** The 16-character serial. */
  serial: string;
}

/** Two 5-char firmware strings, then a 16-char serial — all ASCII. */
export function decodeInfo(payload: Uint8Array): SoundcoreInfoReading | null {
  if (payload.length < 26) return null;
  const ascii = (from: number, to: number) =>
    Array.from(payload.slice(from, to), (b) => String.fromCharCode(b)).join('');
  return { firmware: [ascii(0, 5), ascii(5, 10)], serial: ascii(10, 26) };
}

// --- equalizer -----------------------------------------------------------------

/**
 * Band gains travel as unsigned bytes in 0..180 encoding signed values
 * −120..120 (tenths of a dB at the UI layer: 0x8c = 140 = +20 = +2.0 dB).
 * Verified against SoundcoreManager's A3951 captures.
 */
export const bandToSigned = (byte: number): number => byte - 120;
export const signedToBand = (signed: number): number =>
  Math.max(0, Math.min(180, Math.round(signed) + 120));

/**
 * The device's own preset table: id, display name and the fixed curve each
 * renders as, ported from `soundcore-lib`'s `EQProfile` (curves in signed
 * units). "Custom" is not a curve — it means the device is using the bands.
 *
 * Artist profiles (`artist`) are stored on the device itself; the app only
 * names them and selects the id. SoundcoreManager carries no curve for them
 * either, so selecting one sends a flat placeholder curve and the next state
 * read shows what the device actually applies.
 */
export interface EqPreset {
  id: number;
  name: string;
  /** The curve the device uses for this preset, in signed units. */
  curve: readonly number[];
  /** True for the on-device artist profiles, whose curves live off-device. */
  artist?: boolean;
}

export const EQ_PRESETS: readonly EqPreset[] = [
  { id: 0x0000, name: 'Soundcore Signature', curve: [0, 0, 0, 0, 0, 0, 0, 0] },
  { id: 0x0001, name: 'Acoustic', curve: [40, 10, 20, 20, 40, 40, 40, 20] },
  { id: 0x0002, name: 'Bass Booster', curve: [40, 30, 10, 0, 0, 0, 0, 0] },
  { id: 0x0003, name: 'Bass Reducer', curve: [-40, -30, -10, 0, 0, 0, 0, 0] },
  { id: 0x0004, name: 'Classical', curve: [30, 30, -20, -20, 0, 20, 30, 40] },
  { id: 0x0005, name: 'Podcast', curve: [-30, 20, 40, 40, 30, 20, 0, -20] },
  { id: 0x0006, name: 'Dance', curve: [20, -30, -10, 10, 20, 20, 10, -30] },
  { id: 0x0007, name: 'Deep', curve: [20, 10, 30, 30, 20, -20, -40, -50] },
  { id: 0x0008, name: 'Electronic', curve: [30, 20, -20, 20, 10, 20, 30, 30] },
  { id: 0x0009, name: 'Flat', curve: [-20, -20, -10, 0, 0, 0, -20, -20] },
  { id: 0x000a, name: 'Hip Hop', curve: [20, 30, -10, -10, 20, -10, 20, 30] },
  { id: 0x000b, name: 'Jazz', curve: [20, 20, -20, -20, 0, 20, 30, 40] },
  { id: 0x000c, name: 'Latin', curve: [0, 0, -20, -20, -20, 0, 30, 50] },
  { id: 0x000d, name: 'Lounge', curve: [-10, 20, 40, 30, 0, -20, 20, 10] },
  { id: 0x000e, name: 'Piano', curve: [0, 30, 30, 20, 40, 50, 30, 40] },
  { id: 0x000f, name: 'Pop', curve: [-10, 10, 30, 30, 10, -10, -20, -30] },
  { id: 0x0010, name: 'R&B', curve: [60, 20, -20, -20, 20, 30, 30, 40] },
  { id: 0x0011, name: 'Rock', curve: [30, 20, -10, -10, 10, 30, 30, 30] },
  { id: 0x0012, name: 'Small Speakers', curve: [40, 30, 10, 0, -20, -30, -40, -40] },
  { id: 0x0013, name: 'Spoken Word', curve: [-30, -20, 10, 20, 20, 10, 0, -30] },
  { id: 0x0014, name: 'Treble Booster', curve: [-20, -20, -20, -10, 10, 20, 20, 40] },
  { id: 0x0015, name: 'Treble Reducer', curve: [0, 0, 0, -20, -30, -40, -40, -60] },
  // The "professional" artist series — ids from soundcore-lib's EQProfile.
  { id: 0x00ee, name: 'Foxes', curve: [0, 0, 0, 0, 0, 0, 0, 0], artist: true },
  { id: 0x01ee, name: 'Halestorm', curve: [0, 0, 0, 0, 0, 0, 0, 0], artist: true },
  { id: 0x02ee, name: 'Lecrae', curve: [0, 0, 0, 0, 0, 0, 0, 0], artist: true },
  { id: 0x03ee, name: 'Daya', curve: [0, 0, 0, 0, 0, 0, 0, 0], artist: true },
  { id: 0x04ee, name: 'Cedric Gervais', curve: [0, 0, 0, 0, 0, 0, 0, 0], artist: true },
  { id: 0x05ee, name: 'The Infamous Stringdusters', curve: [0, 0, 0, 0, 0, 0, 0, 0], artist: true },
  { id: 0x06ee, name: 'John Paul White', curve: [0, 0, 0, 0, 0, 0, 0, 0], artist: true },
];

export const EQ_CUSTOM_ID = 0xfefe;

export const eqPresetName = (id: number | null): string | null =>
  id === null ? null : id === EQ_CUSTOM_ID ? 'Custom' : (EQ_PRESETS.find((p) => p.id === id)?.name ?? null);

/**
 * The 8×8 DRC matrix, ported arithmetic-for-arithmetic from
 * `soundcore-lib`'s `calculate_drc_adjustments` — including the f64 mixing
 * and the trailing /10, because the bytes this produces are checked by the
 * device against the curve they accompany.
 */
export function drcBandBytes(bands: readonly number[]): number[] {
  const v = bands.map((b) => b / 10 - 12);
  const [d, d2, d4, d6, d7, d9, d10, d12] = v;
  const d3 = 0.85;
  const d14 = 0.95;
  const d5 = 1.26 * d - d2 * 0.71 * d3 + d4 * 0.177;
  const d8 = d5 - d6 * 0.0494 + d7 * 0.0345;
  const d11 = d8 - d9 * 0.0197 + d10 * 0.0075;
  const d13 = -0.71 * d * d3;
  const d15 = d4 * 0.81 * d3;
  const d16 = d9 * 0.81 * d3;

  const raw = [
    d11 - 0.00217 * d12,
    d13 + d2 * 1.73 * d14 - d15 + d6 * 0.204 - d7 * 0.068 + d9 * 0.045 - d10 * 0.0235 + d12 * 0.0075,
    d * 0.177 - d2 * 0.81 * d3 + d4 * 1.73 * d14 - d6 * 0.81 * d3 + d7 * 0.208 - d9 * 0.07 + d10 * 0.045 - d12 * 0.0197,
    -0.0494 * d + d2 * 0.204 - d15 + d6 * 1.73 * d14 - d7 * 0.82 * d3 + d9 * 0.208 - d10 * 0.068 + d12 * 0.0345,
    d * 0.0345 - d2 * 0.068 + d4 * 0.208 - 0.82 * d6 * d3 + d7 * 1.73 * d14 - d16 + d10 * 0.204 - d12 * 0.0494,
    -0.0197 * d + d2 * 0.045 - 0.07 * d4 + 0.208 * d6 - d7 * 0.81 * d3 + 1.73 * d9 * d14 - d10 * 0.81 * d3 + d12 * 0.177,
    d * 0.0075 - d2 * 0.0235 + d4 * 0.045 - 0.068 * d6 + d7 * 0.204 - d16 + 1.83 * d10 * d14 - d12 * 0.71 * d3,
    -0.00217 * d + d2 * 0.0075 - d4 * 0.0197 + d6 * 0.0345 - d7 * 0.0494 + d9 * 0.177 - d10 * 0.71 * d3 + d12 * 1.5,
  ].map((x) => x / 10);

  return raw.map((x) => Math.max(0, Math.min(255, Math.round((x + 12) * 10))));
}

/**
 * The 76-byte custom-EQ payload, verified byte-for-byte against
 * SoundcoreManager's A3951_EQ_UPDATE_DEEP_NO_HEAR_ID capture: profile (LE),
 * hear-id index, both 8-band curves, the hear-id blocks left at their "unset"
 * fills, and a DRC-derived copy of each curve the device validates.
 */
export function encodeEqUpdate(profileId: number, left: readonly number[], right: readonly number[]): number[] {
  // The wire carries bytes (signed + 120); the DRC copy derives from the same bytes.
  const bands = (curve: readonly number[]) => curve.slice(0, 8).map(signedToBand);
  const unset = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

  return [
    profileId & 0xff,
    (profileId >> 8) & 0xff,
    0x00,
    0x00, // hear-id EQ index, BE, unused
    ...bands(left),
    ...bands(right),
    0xff,
    0xff, // hear-id gender / age, unknown
    0x00,
    ...unset, // hear-id EQ, left — unset
    ...unset, // hear-id EQ, right
    0x00,
    0x00,
    0x00,
    0x00, // hear-id time
    0x00, // hear-id type
    ...unset, // hear-id custom, left
    ...unset, // hear-id custom, right
    ...drcBandBytes(bands(left)),
    ...drcBandBytes(bands(right)),
  ];
}

/** The `02 01` notification payload: the active profile id, u16 LE. */
export const decodeEqInfo = (payload: Uint8Array): number | null =>
  payload.length >= 2 ? payload[0] | (payload[1] << 8) : null;

/** The product code embedded in the serial, e.g. "395107D26A2F12AC" → "a3951". */
export const productCodeFromSerial = (serial: string): string | null => {
  const match = /^([0-9A-Fa-f]{4})/.exec(serial.trim());
  return match ? `a${match[1].toLowerCase()}` : null;
};
