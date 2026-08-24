/**
 * Sony MDR protocol v2, table 1.
 *
 * Opcodes from BudsLink's `PayloadTypeV2T1`; every decoder here is tested
 * against payloads captured from a real WF-C500 (firmware 1.0.7).
 *
 * Nothing that writes firmware or resets the device is modelled, matching the
 * policy on the Sennheiser side.
 */

/** GET n → RET n+1, SET n+2 → RET n+1, NTFY n+3. */
export const Command = {
  GetProtocolInfo: 0x00,
  GetCapability: 0x02,
  GetDeviceInfo: 0x04,
  GetSupportFunction: 0x06,
  GetStatus: 0x12,
  GetPowerStatus: 0x22,
  /** Missing from BudsLink's table; fills the GET/RET/SET/NTFY group at 0x22-0x25. */
  SetPowerStatus: 0x24,
  GetPowerParam: 0x26,
  SetPowerParam: 0x28,
  GetAudioParam: 0xe6,
  SetAudioParam: 0xe8,
  GetEq: 0x56,
  SetEq: 0x58,
  GetNcAsm: 0x66,
  SetNcAsm: 0x68,
  GetSystemParam: 0xf6,
  SetSystemParam: 0xf8,
} as const;

export const Reply = {
  ProtocolInfo: 0x01,
  DeviceInfo: 0x05,
  SupportFunction: 0x07,
  Status: 0x13,
  StatusNotify: 0x15,
  PowerStatus: 0x23,
  PowerStatusNotify: 0x25,
  Eq: 0x57,
  EqNotify: 0x59,
  NcAsmParam: 0x67,
  NcAsmNotify: 0x69,
  PowerParam: 0x27,
  PowerParamNotify: 0x29,
  SystemParam: 0xf7,
  SystemParamNotify: 0xf9,
  /** Extended system params (speak-to-chat config): GET 0xfa/RET 0xfb/SET 0xfc/NTFY 0xfd. */
  SystemExtParam: 0xfb,
  SystemExtParamNotify: 0xfd,
} as const;

/** Second byte of `GetDeviceInfo`. */
export const DeviceInfoType = {
  Fixed: 0x00,
  ModelName: 0x01,
  FirmwareVersion: 0x02,
  SeriesAndColour: 0x03,
} as const;

/** Second byte of `GetPowerStatus`. */
export const BatteryType = {
  Single: 0x00,
  Dual: 0x01,
  Case: 0x02,
  SingleThreshold: 0x08,
  DualThreshold: 0x09,
  CaseThreshold: 0x0a,
} as const;

/**
 * Second byte of the power commands.
 * From `PowerInquiredType` in the Sound Connect app.
 */
export const PowerInquiredType = {
  Battery: 0x00,
  LeftRightBattery: 0x01,
  CradleBattery: 0x02,
  PowerOff: 0x03,
  AutoPowerOff: 0x04,
} as const;

/**
 * Second byte of the audio-param commands — a shared dispatcher opcode.
 * Connection mode, DSEE and BGM mode all ride `0xE6/0xE7/0xE8/0xE9`, told apart
 * by this byte, so the opcode alone does not identify the feature.
 */
export const AudioInquiredType = {
  ConnectionMode: 0x00,
  Upscaling: 0x01,
  ConnectionModeWithLdacStatus: 0x02,
  BgmMode: 0x03,
  ConnectionModeClassicLeAudio: 0x05,
} as const;

/** Sound-quality vs connection-stability priority. */
export const PriorMode = {
  SoundQuality: 0x00,
  ConnectionQuality: 0x01,
  LowLatencyBeta: 0x02,
} as const;

export const PRIOR_MODE_OPTIONS: Array<{ value: number; label: string; hint: string }> = [
  {
    value: PriorMode.SoundQuality,
    label: 'Sound quality',
    hint: 'Best available codec; more prone to dropouts.',
  },
  {
    value: PriorMode.ConnectionQuality,
    label: 'Stable connection',
    hint: 'Fewer dropouts in crowded environments.',
  },
];

/**
 * Powers the device off. Fire-and-forget: there is no readback, and the link
 * dropping is the only confirmation.
 *
 * `[POWER_SET_STATUS, PowerInquiredType.POWER_OFF, USER_POWER_OFF]`.
 */
export const USER_POWER_OFF = 0x01;

export const encodePowerOff = (): number[] => [
  Command.SetPowerStatus,
  PowerInquiredType.PowerOff,
  USER_POWER_OFF,
];

/**
 * Connection mode, basic variant: `[AUDIO_SET_PARAM, CONNECTION_MODE, mode]`.
 *
 * Three bytes, no enable/disable — that fourth byte belongs to the LE-audio
 * variant (`AudioInquiredType 0x05`), which is a different capability.
 */
export const encodeConnectionMode = (mode: number): number[] => [
  Command.SetAudioParam,
  AudioInquiredType.ConnectionMode,
  mode,
];

/** `[0xE7, CONNECTION_MODE, mode]`. */
export function decodeConnectionMode(payload: Uint8Array): number {
  if (payload.length < 3) throw new Error('expected 3 bytes');
  return payload[2];
}

/** Second byte of `GetStatus`. */
export const StatusType = {
  Codec: 0x02,
  Upscaling: 0x03,
} as const;

/** Second byte of `GetEq`. */
export const EqInquiryType = {
  PresetEq: 0x00,
  Ebb: 0x01,
  PresetEqNonCustomisable: 0x02,
  CustomEq: 0x31,
} as const;

// --- decoders -------------------------------------------------------------

const ascii = (bytes: Uint8Array): string =>
  new TextDecoder().decode(bytes).replace(/\0+$/, '');

/**
 * `[0x05, type, length, ...bytes]` for model and firmware.
 *
 * Series/colour (type 0x03) is the exception — it has no length prefix — so it
 * is decoded separately by `decodeSeriesAndColour`.
 */
export function decodeDeviceInfoText(payload: Uint8Array): string {
  if (payload.length < 3) throw new Error('expected at least 3 bytes');
  const declared = payload[2];
  return ascii(payload.slice(3, 3 + declared));
}

export interface SeriesAndColour {
  series: number;
  colour: number;
}

/**
 * `[0x05, 0x03, series, colour]` — no length byte, unlike every other device
 * info type. Observed as `05 03 00 01` on a black WF-C500.
 */
export function decodeSeriesAndColour(payload: Uint8Array): SeriesAndColour {
  if (payload.length < 4) throw new Error('expected 4 bytes');
  return { series: payload[2], colour: payload[3] };
}

/**
 * Four states, not a boolean.
 *
 * `UNKNOWN` is the important one, and it does not mean what it sounds like:
 * an earbud sitting in the case drops out of the tandem link, so the device
 * cannot speak for it and reports `UNKNOWN` with level 0. Observed on a
 * WF-C500 with the left bud in the case and the right worn:
 * `23 01 00 02 64 00`.
 *
 * So a level of 0 alongside `UNKNOWN` means "not reporting", not "flat".
 */
export const BatteryStatus = {
  NotCharging: 0x00,
  Charging: 0x01,
  Unknown: 0x02,
  Charged: 0x03,
} as const;

export interface BatteryLevel {
  level: number;
  status: number;
  /** Actively taking charge. */
  charging: boolean;
  /** On power — charging or already full. */
  onPower: boolean;
  /**
   * False when the earbud is not reporting, which in practice means it is in
   * the case. Its `level` is meaningless when this is false.
   */
  present: boolean;
}

const batteryAt = (level: number, status: number): BatteryLevel => ({
  level,
  status,
  charging: status === BatteryStatus.Charging,
  onPower: status === BatteryStatus.Charging || status === BatteryStatus.Charged,
  present: status !== BatteryStatus.Unknown,
});

export interface DualBattery {
  left: BatteryLevel;
  right: BatteryLevel;
}

/**
 * `[0x23, 0x01, leftLevel, leftStatus, rightLevel, rightStatus]`.
 * Observed as `23 01 64 00 64 00` — both at 100%, neither charging.
 */
export function decodeDualBattery(payload: Uint8Array): DualBattery {
  if (payload.length < 6) throw new Error('expected 6 bytes');
  return {
    left: batteryAt(payload[2], payload[3]),
    right: batteryAt(payload[4], payload[5]),
  };
}

/** `[0x23, type, level, status]` for single and case batteries. */
export function decodeSingleBattery(payload: Uint8Array): BatteryLevel {
  if (payload.length < 4) throw new Error('expected 4 bytes');
  return batteryAt(payload[2], payload[3]);
}

/** `[0x13, 0x02, codec]`. Observed as `13 02 02` = AAC. */
export function decodeCodec(payload: Uint8Array): number {
  if (payload.length < 3) throw new Error('expected 3 bytes');
  return payload[2];
}

/** `[0x13, 0x03, enabled, ...]`. Observed as `13 03 01 00` = on. */
export function decodeUpscaling(payload: Uint8Array): boolean {
  if (payload.length < 3) throw new Error('expected 3 bytes');
  return payload[2] !== 0x00;
}

/**
 * DSEE on/off: `[0xE8 AUDIO_SET_PARAM, UPSCALING, enabled]`.
 *
 * Three bytes. The v1 protocol inserts a setting-type byte before the value,
 * but the decompiled v2 payload class writes the value straight after the
 * inquiry type, and v2 is what these devices speak.
 */
export const encodeUpscaling = (enabled: boolean): number[] => [
  Command.SetAudioParam,
  AudioInquiredType.Upscaling,
  enabled ? 0x01 : 0x00,
];

/**
 * The DSEE *setting*, read through the audio-param family.
 *
 * Distinct from `decodeUpscaling`, which reads the *indicator* — whether
 * upscaling is active right now. The indicator can be false while the setting
 * is on, for instance when the active codec cannot be upscaled.
 */
export function decodeUpscalingSetting(payload: Uint8Array): boolean {
  if (payload.length < 3) throw new Error('expected 3 bytes');
  return payload[2] !== 0x00;
}

const CODEC_NAMES: Record<number, string> = {
  0x00: 'Unsettled',
  0x01: 'SBC',
  0x02: 'AAC',
  0x10: 'LDAC',
  0x20: 'aptX',
  0x21: 'aptX HD',
  0x30: 'LC3',
  0xff: 'Other',
};

export const codecName = (id: number): string => CODEC_NAMES[id] ?? `Codec 0x${id.toString(16)}`;

// --- equaliser ------------------------------------------------------------

/**
 * Band values are unsigned with a midpoint offset: the device reports 0x0A for
 * flat, so gain in steps is `value - EQ_MIDPOINT`. Observed as
 * `57 00 00 06 0A 0A 0A 0A 0A 0A` — preset off, six bands, all flat.
 */
export const EQ_MIDPOINT = 10;

export interface EqSettings {
  inquiryType: number;
  preset: number;
  /** Signed steps around flat, one per band. */
  gains: number[];
}

export function decodeEq(payload: Uint8Array): EqSettings {
  if (payload.length < 4) throw new Error('expected at least 4 bytes');
  const bandCount = payload[3];
  const raw = payload.slice(4, 4 + bandCount);
  if (raw.length < bandCount) throw new Error('band count exceeds payload');
  return {
    inquiryType: payload[1],
    preset: payload[2],
    gains: Array.from(raw, (value) => value - EQ_MIDPOINT),
  };
}

const bandByte = (gain: number): number =>
  Math.max(0, Math.min(0xff, Math.round(gain + EQ_MIDPOINT)));

/**
 * Selecting a preset: `[0x58, inquiryType, preset, 0x00]` — **no band bytes**.
 *
 * The empty band list is not an optimisation, it is the protocol. Sony's app
 * builds this message with an empty `int[]` in both protocol generations
 * (`m20/h.java` and `l20/c.java`, `sendActiveEqPresetId`); the device derives
 * the curve from the preset itself. Appending the current curve produces a
 * frame the earbuds acknowledge and then ignore, which is exactly how a preset
 * change looks when nothing happens.
 */
export function encodeEqPreset(preset: number): number[] {
  return [Command.SetEq, EqInquiryType.PresetEq, preset, 0];
}

/**
 * Editing the curve: `[0x58, inquiryType, preset, bandCount, ...bands]`.
 *
 * Here the band list is the point and the preset id rides along. The app passes
 * the *currently active* preset read back from the device (`nn/l.java`
 * `sendEqBandSteps`), and its v1 implementation substitutes `Unspecified` —
 * so pass through what the device last reported rather than forcing an id.
 */
export function encodeEqBands(preset: number, gains: number[]): number[] {
  return [Command.SetEq, EqInquiryType.PresetEq, preset, gains.length, ...gains.map(bandByte)];
}

/**
 * Preset ids, from `EqPresetId` in the Sound Connect app. The v1 and v2 tables
 * define identical byte codes, so no generation split is needed.
 *
 * This is the whole namespace Sony has ever shipped; a given model accepts only
 * a subset, so treat it as a decoding table rather than a menu.
 */
export const EqPreset = {
  Off: 0x00,
  Rock: 0x01,
  Pop: 0x02,
  Jazz: 0x03,
  Dance: 0x04,
  Edm: 0x05,
  RnbHipHop: 0x06,
  Acoustic: 0x07,
  Bright: 0x10,
  Excited: 0x11,
  Mellow: 0x12,
  Relaxed: 0x13,
  Vocal: 0x14,
  TrebleBoost: 0x15,
  BassBoost: 0x16,
  Speech: 0x17,
  GamingEq: 0x20,
  Custom: 0xa0,
  UserSetting1: 0xa1,
  UserSetting2: 0xa2,
  UserSetting3: 0xa3,
  UserSetting4: 0xa4,
  UserSetting5: 0xa5,
  /** "leave the preset alone" — used when only the band steps are changing. */
  Unspecified: 0xff,
} as const;

export const EQ_PRESET_NAMES: Record<number, string> = {
  [EqPreset.Off]: 'Off',
  [EqPreset.Rock]: 'Rock',
  [EqPreset.Pop]: 'Pop',
  [EqPreset.Jazz]: 'Jazz',
  [EqPreset.Dance]: 'Dance',
  [EqPreset.Edm]: 'EDM',
  [EqPreset.RnbHipHop]: 'R&B / Hip-hop',
  [EqPreset.Acoustic]: 'Acoustic',
  [EqPreset.Bright]: 'Bright',
  [EqPreset.Excited]: 'Excited',
  [EqPreset.Mellow]: 'Mellow',
  [EqPreset.Relaxed]: 'Relaxed',
  [EqPreset.Vocal]: 'Vocal',
  [EqPreset.TrebleBoost]: 'Treble boost',
  [EqPreset.BassBoost]: 'Bass boost',
  [EqPreset.Speech]: 'Speech',
  [EqPreset.GamingEq]: 'Gaming',
  [EqPreset.Custom]: 'Custom',
  [EqPreset.UserSetting1]: 'Custom 1',
  [EqPreset.UserSetting2]: 'Custom 2',
  [EqPreset.UserSetting3]: 'Custom 3',
  [EqPreset.UserSetting4]: 'Custom 4',
  [EqPreset.UserSetting5]: 'Custom 5',
  [EqPreset.Unspecified]: 'Unspecified',
};

export const eqPresetName = (id: number): string =>
  EQ_PRESET_NAMES[id] ?? `Preset 0x${id.toString(16)}`;

// --- capabilities ---------------------------------------------------------

/**
 * Function IDs from `RET_SUPPORT_FUNCTION`. Only the ones this app acts on are
 * named; the device reports more.
 */
export const SonyFunction = {
  ConciergeData: 0x10,
  ConnectionStatus: 0x11,
  CodecIndicator: 0x12,
  UpscalingIndicator: 0x13,
  BleSetup: 0x14,
  BatteryLevel: 0x20,
  LeftRightBatteryLevel: 0x21,
  CaseBatteryLevel: 0x22,
  PowerOff: 0x23,
  AutoPowerOff: 0x24,
  AutoPowerOffWithWearingDetection: 0x25,
  /** Voice guidance, table 2: on/off with language switching. */
  VoiceGuidanceWithLanguageSwitch: 0x44,
  /** Voice guidance, table 2: only an on/off switch. */
  VoiceGuidanceOnOffOnly: 0x45,
  /** Voice guidance, table 2: includes the volume adjustment. */
  VoiceGuidanceWithVolume: 0x42,
  /** Pause when the headphones are taken off. */
  PauseOnRemoval: 0xf1,
  SpeakToChat: 0xf2,
  WearingStatusDetector: 0xf6,
  SpeakToChatType2: 0xfc,
  TandemKeepAlive: 0x27,
  FirmwareUpdate: 0x32,
  PresetEq: 0x50,
  Ebb: 0x51,
  CustomEq: 0x55,
  NoiseCancellingOnOff: 0x61,
  AmbientSoundMode: 0x66,
  FixedMessage: 0x90,
  FixedMessageWithLrSelection: 0x92,
  PlaybackController: 0xa1,
  ActionLogNotifier: 0xc1,
  ConnectionQualityMode: 0xe1,
  UpscalingAutoOff: 0xe2,
  /** DSEE toggle that also reports why it is unavailable. */
  UpscalingAutoOffWithDisableReason: 0xed,
  /** Touch-control assignment — remapping what each earbud's taps do. */
  AssignableSetting: 0xf3,
  /** Reduced variant of the above, for devices with fewer keys. */
  AssignableSettingWithLimitation: 0xfe,
  QuickAccess: 0xfd,
} as const;

/**
 * `[0x07, 0x00, count, (functionId, index) * count]`.
 *
 * This is the device describing itself. GAIA has an equivalent in
 * `Core_GetSupportedFeatures` (0x0001), so this is not unique to Sony — the
 * difference is that MDR punishes asking for something unsupported with a
 * timeout, whereas GAIA returns an error frame straight away.
 */
export function decodeSupportedFunctions(payload: Uint8Array): Set<number> {
  if (payload.length < 3) throw new Error('expected at least 3 bytes');
  const count = payload[2];
  const functions = new Set<number>();
  for (let i = 0; i < count; i += 1) {
    const offset = 3 + i * 2;
    if (offset >= payload.length) break;
    functions.add(payload[offset]);
  }
  return functions;
}
