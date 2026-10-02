/**
 * Message ids — the byte after the frame header. The numbers agree across the
 * vendor plugin (`kk/f.java`, `mi/i.java`) and GalaxyBudsClient
 * (`Message/SppMessageEnums.cs`); the two sources disagree on a few names, so
 * the names here follow GalaxyBudsClient.
 */
export const MsgId = {
  /** Read: two 14-byte SKU strings, left then right. */
  DebugSku: 0x22,
  /** Read: ASCII build string. */
  DebugBuildInfo: 0x28,
  /** The device's answer to most writes: the request id, then a result. */
  Ack: 0x42,
  /** Push: battery, placement, charging. */
  Status: 0x60,
  /** Push: the whole settings block — layout depends on the model. */
  ExtendedStatus: 0x61,
  /** Read: hardware and software versions, one set per earbud. */
  VersionInfo: 0x63,
  NoiseControlsUpdate: 0x77,
  /** Write: `[0 off, 1 ANC, 2 ambient, 3 adaptive]`. */
  NoiseControls: 0x78,
  /** Write: ambient sound on/off. */
  AmbientMode: 0x80,
  /** Push: ambient sound changed on the earbuds, `[on]`. */
  AmbientModeUpdated: 0x81,
  /** Write: the ambient-sound step. */
  AmbientVolume: 0x84,
  Equalizer: 0x86,
  /** Write: tells the earbuds a companion app is running. */
  ManagerInfo: 0x88,
  LockTouchpad: 0x90,
  TouchUpdated: 0x91,
  /** Write: what a touch-and-hold does, `[left, right]`. */
  TouchOption: 0x92,
  /** Write: which noise modes a long press cycles through. */
  TouchNoiseCycle: 0x79,
  FindStart: 0xa0,
  /** Push and write: ringing stopped. */
  FindStop: 0xa1,
  MuteUpdated: 0xa3,
  /** Find, for models that can ring an earbud that is being worn. */
  FindOnWearing: 0xa6,
  /** Write: Buds Live's ANC on/off. */
  NoiseReduction: 0x98,
  /** Push: Buds Live's ANC changed on the earbuds, `[on]`. */
  NoiseReductionUpdated: 0x9b,
} as const;

/**
 * What the console on the System tab may send. Reads only: a typo there must
 * not be able to change a setting, so anything that writes is absent.
 */
export const QUERY_IDS: readonly number[] = [
  MsgId.DebugSku,
  0x24, // DEBUG_GET_VERSION
  0x26, // DEBUG_GET_ALL_DATA
  MsgId.DebugBuildInfo,
  0x29, // DEBUG_SERIAL_NUMBER
  MsgId.VersionInfo,
];
