/**
 * What each model of headphone actually has, declared as data.
 *
 * Two different questions get confused easily, so they are kept apart here:
 *
 * - **What does the hardware have?** That is this file. It is a fact about the
 *   product, knowable from the vendor's own app before we ever see the device.
 * - **What can this app drive?** That is `IMPLEMENTED`, below. A feature the
 *   headphones have but we have not written the protocol for is not a hole in
 *   the hardware, and saying so honestly beats hiding it.
 *
 * The two are intersected at the UI, so a device can report "your headphones
 * have this, we cannot control it yet" rather than silently omitting it.
 *
 * **This does not override what a device says about itself.** Sony negotiates
 * its capability table live on every connect, and that always wins — a profile
 * is a description, not an authority. Sennheiser is the opposite case, and the
 * reason this file has to exist: GAIA's `Core_GetSupportedFeatures` reports
 * Qualcomm *core* feature IDs, a different namespace from Sennheiser's vendor
 * features, so there is no runtime way to ask a Momentum what it supports. For
 * GAIA this file is the only source there is.
 *
 * Model facts are cross-checked against maniacx/BudsLink's per-model configs
 * (GPL — read as reference, nothing copied) and, where we have had the
 * hardware, against a live capability read.
 */

import type { Brand } from './brand';

/**
 * One vocabulary across brands.
 *
 * Vendors name the same idea differently — Sony's "DSEE" and a hypothetical
 * rival's "upscaling" are one feature — so concepts that genuinely align share
 * a name here. Concepts that only look similar deliberately do not: Sennheiser
 * transparency is a continuous level blended against ANC, while Sony's ambient
 * mode is a stepped scale with its own semantics, so they stay separate.
 */
export const Feature = {
  // --- noise ---
  Anc: 'anc',
  /** Sennheiser: a continuous level traded off against ANC. */
  Transparency: 'transparency',
  /** Sony: a stepped ambient scale, with optional focus on voice. */
  AmbientLevel: 'ambient-level',
  SpeakToChat: 'speak-to-chat',

  // --- sound ---
  Equalizer: 'equalizer',
  BassBoost: 'bass-boost',
  /** Sony calls this DSEE. */
  Upscaling: 'upscaling',
  Sidetone: 'sidetone',
  /** Sound quality vs connection stability. */
  ConnectionMode: 'connection-mode',

  // --- behaviour ---
  /** A sensor that knows the headphones are on your head. */
  WearDetection: 'wear-detection',
  SmartPause: 'smart-pause',
  AutoAnswer: 'auto-answer',
  /** Turning the touch surface on and off. */
  TouchControls: 'touch-controls',
  /** Choosing what each touch gesture does. */
  TouchAssignment: 'touch-assignment',
  VoicePrompts: 'voice-prompts',
  AutoPowerOff: 'auto-power-off',
  /** Powering the device off from the app. */
  PowerOff: 'power-off',
  LowLatency: 'low-latency',
  Multipoint: 'multipoint',
} as const;

export type FeatureId = (typeof Feature)[keyof typeof Feature];

export interface DeviceProfile {
  id: string;
  /** How the product is sold, for display when the device is not connected. */
  name: string;
  brand: Brand;
  /** Matched against the model string the device reports. */
  match: RegExp;
  /** Drives how battery is presented, not just artwork. */
  form: 'over-ear' | 'earbuds';
  battery: 'single' | 'dual';
  /** Earbud cases report their own charge; over-ears have none. */
  hasCase: boolean;
  /** What the hardware has. Not what we can drive — see `IMPLEMENTED`. */
  features: readonly FeatureId[];
  /** Asset prefix under `public/devices/<brand>/`. */
  artwork: string;
  /**
   * width / height of this model's renders.
   *
   * Per model rather than per brand because the artwork came from different
   * places: the WF-C500 set are 2.56:1 product-page shots, the rest are square
   * catalogue renders. Framing a square render in a 2.56:1 box crops the
   * headphones; the reverse leaves a band of empty space.
   */
  artworkAspect: number;
  /**
   * Colour codes we actually hold a render for, from Sony's `ModelColor`.
   *
   * Knowing a colour's *name* is universal; having a *picture* of it is per
   * model. Without this, a WF-C500 reporting Silver would request a file that
   * only the XM5 has.
   */
  artworkColours: readonly number[];
}

const F = Feature;

export const PROFILES: readonly DeviceProfile[] = [
  {
    id: 'momentum-4',
    name: 'MOMENTUM 4 Wireless',
    brand: 'sennheiser',
    match: /M4AEBT|MOMENTUM\s*4/i,
    form: 'over-ear',
    battery: 'single',
    hasCase: false,
    // Verified against the hardware, command by command, not declared blind.
    features: [
      F.Anc,
      F.Transparency,
      F.Equalizer,
      F.BassBoost,
      F.Sidetone,
      F.WearDetection,
      F.SmartPause,
      F.AutoAnswer,
      F.TouchControls,
      F.VoicePrompts,
      F.AutoPowerOff,
      F.LowLatency,
      F.Multipoint,
    ],
    artwork: 'momentum-4',
    artworkAspect: 1125 / 558,
    // Sennheiser carries colour in the model string, not a colour byte.
    artworkColours: [],
  },
  {
    id: 'wf-c500',
    name: 'WF-C500',
    brand: 'sony',
    match: /WF-C500/i,
    form: 'earbuds',
    battery: 'dual',
    hasCase: true,
    // Confirmed by a live capability read: 16 functions, no ANC, no ambient,
    // no wear sensors and no assignable touch controls.
    features: [F.Equalizer, F.Upscaling, F.ConnectionMode, F.VoicePrompts, F.PowerOff],
    artwork: 'wf-c500',
    artworkAspect: 2028 / 792,
    // Black, White, Green, Orange — the four it shipped in.
    artworkColours: [0x01, 0x02, 0x08, 0x0c],
  },
  {
    id: 'wh-1000xm5',
    name: 'WH-1000XM5',
    brand: 'sony',
    match: /WH-1000XM5/i,
    form: 'over-ear',
    battery: 'single',
    hasCase: false,
    /**
     * From BudsLink's per-model config, not from hardware — nobody has
     * connected one to this app yet. Its capability read will overrule this
     * the moment someone does, which is exactly the intended behaviour.
     */
    features: [
      F.Anc,
      F.AmbientLevel,
      F.SpeakToChat,
      F.Equalizer,
      F.Upscaling,
      F.WearDetection,
      F.SmartPause,
      F.TouchAssignment,
      F.VoicePrompts,
      F.AutoPowerOff,
      F.PowerOff,
      F.Multipoint,
    ],
    artwork: 'wh-1000xm5',
    // Square catalogue renders, unlike the WF-C500's wide product-page shots.
    artworkAspect: 1,
    // Black, Silver, Blue, Pink.
    artworkColours: [0x01, 0x03, 0x05, 0x06],
  },
  {
    id: 'wh-1000xm4',
    name: 'WH-1000XM4',
    brand: 'sony',
    match: /WH-1000XM4/i,
    form: 'over-ear',
    battery: 'single',
    hasCase: false,
    features: [
      F.Anc, F.AmbientLevel, F.SpeakToChat, F.Equalizer, F.Upscaling, F.WearDetection,
      F.SmartPause, F.TouchAssignment, F.VoicePrompts, F.AutoPowerOff, F.PowerOff, F.Multipoint,
    ],
    artwork: 'wh-1000xm4',
    artworkAspect: 1,
    artworkColours: [0x01, 0x02, 0x03, 0x05],
  },
  {
    id: 'wh-1000xm3',
    name: 'WH-1000XM3',
    brand: 'sony',
    match: /WH-1000XM3/i,
    form: 'over-ear',
    battery: 'single',
    hasCase: false,
    features: [
      F.Anc, F.AmbientLevel, F.Equalizer, F.Upscaling, F.WearDetection, F.SmartPause,
      F.VoicePrompts, F.AutoPowerOff, F.PowerOff,
    ],
    artwork: 'wh-1000xm3',
    artworkAspect: 1,
    artworkColours: [0x01, 0x03],
  },
  {
    id: 'wf-1000xm5',
    name: 'WF-1000XM5',
    brand: 'sony',
    match: /WF-1000XM5/i,
    form: 'earbuds',
    battery: 'dual',
    hasCase: true,
    features: [
      F.Anc, F.AmbientLevel, F.SpeakToChat, F.Equalizer, F.Upscaling, F.WearDetection,
      F.SmartPause, F.TouchAssignment, F.VoicePrompts, F.PowerOff, F.Multipoint,
    ],
    artwork: 'wf-1000xm5',
    artworkAspect: 1,
    artworkColours: [0x01, 0x03, 0x06],
  },
  {
    id: 'wf-1000xm4',
    name: 'WF-1000XM4',
    brand: 'sony',
    match: /WF-1000XM4/i,
    form: 'earbuds',
    battery: 'dual',
    hasCase: true,
    features: [
      F.Anc, F.AmbientLevel, F.SpeakToChat, F.Equalizer, F.Upscaling, F.WearDetection,
      F.SmartPause, F.TouchAssignment, F.VoicePrompts, F.PowerOff,
    ],
    artwork: 'wf-1000xm4',
    artworkAspect: 1,
    artworkColours: [0x01, 0x03],
  },
  {
    id: 'wf-1000xm3',
    name: 'WF-1000XM3',
    brand: 'sony',
    match: /WF-1000XM3/i,
    form: 'earbuds',
    battery: 'dual',
    hasCase: true,
    features: [
      F.Anc, F.AmbientLevel, F.Equalizer, F.Upscaling, F.WearDetection, F.SmartPause,
      F.VoicePrompts, F.PowerOff,
    ],
    artwork: 'wf-1000xm3',
    artworkAspect: 1,
    artworkColours: [0x01, 0x03],
  },
];

/**
 * What this app can actually control today, per brand.
 *
 * The gap against a profile's `features` is the honest to-do list. The
 * WH-1000XM5's noise control sits in that gap: the earphones have it, the
 * protocol for it is `NCASM_*` in the same command table we already speak, and
 * nobody has written it yet.
 */
export const IMPLEMENTED: Record<Brand, readonly FeatureId[]> = {
  sennheiser: [
    F.Anc,
    F.Transparency,
    F.Equalizer,
    F.BassBoost,
    F.Sidetone,
    F.WearDetection,
    F.SmartPause,
    F.AutoAnswer,
    F.TouchControls,
    F.VoicePrompts,
    F.AutoPowerOff,
    F.LowLatency,
    F.Multipoint,
  ],
  sony: [
    F.Equalizer,
    F.Upscaling,
    F.ConnectionMode,
    F.PowerOff,
    F.Anc,
    F.AmbientLevel,
    F.AutoPowerOff,
    F.SmartPause,
  ],
};

/** The profile for a reported model string, or null when we know of no such model. */
export function profileFor(brand: Brand, model: string | null): DeviceProfile | null {
  if (!model) return null;
  return PROFILES.find((p) => p.brand === brand && p.match.test(model)) ?? null;
}

/** Features the hardware has that this app cannot yet drive. */
export function unsupportedFeatures(profile: DeviceProfile): FeatureId[] {
  const implemented = new Set(IMPLEMENTED[profile.brand]);
  return profile.features.filter((feature) => !implemented.has(feature));
}

/** Human-readable names, for telling someone what their headphones can do. */
export const FEATURE_NAMES: Record<FeatureId, string> = {
  [F.Anc]: 'Noise cancelling',
  [F.Transparency]: 'Transparency',
  [F.AmbientLevel]: 'Ambient sound',
  [F.SpeakToChat]: 'Speak-to-chat',
  [F.Equalizer]: 'Equalizer',
  [F.BassBoost]: 'Bass boost',
  [F.Upscaling]: 'Upscaling (DSEE)',
  [F.Sidetone]: 'Sidetone',
  [F.ConnectionMode]: 'Connection quality',
  [F.WearDetection]: 'Wear detection',
  [F.SmartPause]: 'Smart pause',
  [F.AutoAnswer]: 'Auto-answer calls',
  [F.TouchControls]: 'Touch controls',
  [F.TouchAssignment]: 'Touch control assignment',
  [F.VoicePrompts]: 'Voice prompts',
  [F.AutoPowerOff]: 'Auto power off',
  [F.PowerOff]: 'Power off from the app',
  [F.LowLatency]: 'Low latency mode',
  [F.Multipoint]: 'Multipoint',
};
