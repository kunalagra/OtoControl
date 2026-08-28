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
import { SONY_CATALOG_MODELS } from './sonyModels.generated';

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
  /** Call audio processed for a more natural sound. */
  ComfortCall: 'comfort-call',
  /** Turning the touch surface on and off. */
  TouchControls: 'touch-controls',
  /** Choosing what each touch gesture does. */
  TouchAssignment: 'touch-assignment',
  VoicePrompts: 'voice-prompts',
  AutoPowerOff: 'auto-power-off',
  /** Powering the device off from the app. */
  PowerOff: 'power-off',
  LowLatency: 'low-latency',
  /** A more stable link, at the cost of some features. */
  BluetoothCompatibility: 'bluetooth-compatibility',
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
}

const F = Feature;

/** Escapes a literal name for embedding in a `RegExp`. */
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// --- Nothing / CMF ------------------------------------------------------------
//
// Nothing's model is not readable over serial — ear-web reads it from FastPair
// advertising — so these match on the display name a snapshot carried, or on a
// B1xx base code if one ever reaches `info.model`. Live capability probing,
// not this table, decides what the UI offers on a real connection.

const nothingProfile = (
  id: string,
  name: string,
  base: string,
  anc: boolean,
  extra: readonly FeatureId[] = [],
  form: 'earbuds' | 'over-ear' = 'earbuds',
): DeviceProfile => ({
  id,
  name,
  brand: 'nothing',
  // The base code and the display name, whichever a snapshot happened to keep.
  //
  // Anchored, and that is load-bearing. Nothing's names nest inside one
  // another — "CMF Buds" is a prefix of "CMF Buds 2", "CMF Buds Neo" and four
  // more; "Nothing Ear" of "Nothing Ear (3)" and "Nothing Ear (open)" — and
  // `profileFor` takes the first match in list order. Unanchored, 11 of the 23
  // models resolved to an older sibling's profile and drew its product render:
  // an Ear (3) showed an Ear, every CMF Buds 2 showed a CMF Buds. Matching the
  // whole string is what keeps a longer name from being swallowed by a shorter
  // one that happens to be declared first.
  match: new RegExp(`^(?:${base}|${name.replace(/[()]/g, '\\$&')})$`, 'i'),
  form,
  battery: form === 'over-ear' ? 'single' : 'dual',
  // Buds charge in a case; over-ears and the neckband have none.
  hasCase: form === 'earbuds' && id !== 'cmf-neckband-pro' && id !== 'cmf-clip-pro',
  features: [
    ...(anc ? [F.Anc, F.Transparency] : []),
    F.Equalizer,
    F.BassBoost,
    F.WearDetection,
    F.SmartPause,
    F.TouchAssignment,
    F.LowLatency,
    ...extra,
  ],
  // The B1xx base code lowercased keys the CDN render table in
  // ui/device/nothingCdn.generated.ts — the official app's own images.
  artwork: base.toLowerCase(),
  artworkAspect: 1,
});

// --- Soundcore ---------------------------------------------------------------
//
// Keyed on the Anker product code the serial number begins with ("39510…"
// → a3951), which is the only model identification the wire protocol offers.
// Names are the official app's own (`products.generated.ts`); features are
// what the hardware ships with, intersected with IMPLEMENTED at the UI.

const soundcoreProfile = (
  code: string,
  name: string,
  form: 'earbuds' | 'over-ear' = 'earbuds',
): DeviceProfile => ({
  id: code,
  name,
  brand: 'soundcore',
  // The bare product code (from the serial) or the marketing name — which
  // arrives either with its "soundcore" prefix (Gadgetbridge matches
  // "soundcore Liberty 4 NC" on the wire) or without it, so both are matched.
  match: new RegExp(
    [code, name, name.replace(/^soundcore\s+/i, '')]
      .map(escapeRegExp)
      .join('|'),
    'i',
  ),
  form,
  battery: form === 'over-ear' ? 'single' : 'dual',
  hasCase: form === 'earbuds',
  features: [F.Anc, F.Transparency, F.Equalizer, F.WearDetection],
  artwork: code,
  artworkAspect: 1,
});

const SOUNDCORE_PROFILES: readonly DeviceProfile[] = [
  soundcoreProfile('a3951', "Soundcore Liberty Air 2 Pro", 'earbuds'),
  soundcoreProfile('a3035', "soundcore Space One", 'over-ear'),
  soundcoreProfile('a3040', "Soundcore Space Q45", 'over-ear'),
  soundcoreProfile('a3062', "soundcore Space One Pro", 'over-ear'),
  soundcoreProfile('a3927', "Soundcore Life A1", 'earbuds'),
  soundcoreProfile('a3933', "Soundcore Life Note 3", 'earbuds'),
  soundcoreProfile('a3936', "Soundcore Space A40", 'earbuds'),
  soundcoreProfile('a3937', "soundcore P41i", 'earbuds'),
  soundcoreProfile('a3939', "Soundcore Life P3", 'earbuds'),
  soundcoreProfile('a3943', "soundcore Life Note C", 'earbuds'),
  soundcoreProfile('a3944', "soundcore Life P2 Mini", 'earbuds'),
  soundcoreProfile('a3945', "Soundcore Life Note 3S", 'earbuds'),
  soundcoreProfile('a3947', "soundcore Liberty 4 NC", 'earbuds'),
  soundcoreProfile('a3948', "soundcore A20i", 'earbuds'),
  soundcoreProfile('a3949', "soundcore P20i", 'earbuds'),
  soundcoreProfile('a3952', "Soundcore Liberty 3 Pro", 'earbuds'),
  soundcoreProfile('a3953', "Soundcore Liberty 4", 'earbuds'),
  soundcoreProfile('a3954', "soundcore Liberty 4 Pro", 'earbuds'),
  soundcoreProfile('a3955', "soundcore P40i", 'earbuds'),
  soundcoreProfile('a3957', "soundcore Liberty 5", 'earbuds'),
  soundcoreProfile('a3958', "soundcore A30i", 'earbuds'),
  soundcoreProfile('a3959', "soundcore P30i", 'earbuds'),
  soundcoreProfile('a3982', "Soundcore Life Dot 3i", 'earbuds'),
  soundcoreProfile('a3983', "Soundcore Life Note 3i", 'earbuds'),
  soundcoreProfile('a3994', "soundcore K20i", 'earbuds'),
];

/**
 * Every headphone-class model in Sony's own Sound Connect catalog
 * (`sonyModels.generated.ts`) becomes a profile — this table is the whole
 * Sony model list, verified or not.
 *
 * **Nothing is declared blind.** Feature lists are deliberately empty:
 * Sony devices negotiate their capability table live on every connect and
 * that read always wins, so a guessed feature could only ever be wrong
 * twice — once in the gap card, once in reality. Identity (name, form
 * factor, battery layout, square cloud render) is what a profile
 * contributes here, and identity is exactly what the catalog knows.
 */
const SONY_CATALOG_PROFILES: readonly DeviceProfile[] = SONY_CATALOG_MODELS.map(
  ({ name, form }): DeviceProfile => {
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return {
      id,
      name,
      brand: 'sony',
      // Anchored exact match. Sony reports the model string plainly over
      // serial, and an unanchored name would let 'LinkBuds' swallow
      // 'LinkBuds S' — neighbour-model collisions are what loose patterns
      // are made of.
      match: new RegExp(`^${escapeRegExp(name)}$`, 'i'),
      form,
      battery: form === 'over-ear' ? 'single' : 'dual',
      hasCase: form === 'earbuds',
      features: [],
      artwork: id,
      artworkAspect: 1,
    };
  },
);

/**
 * Keeps the first declaration for each id, so a generated table can overlap
 * a hand-verified one without either knowing about the other: `PROFILES`
 * lists verified sets first and generated ones after, and the later
 * duplicate simply loses. A collision is announced — silent shadowing is
 * the kind of bug that otherwise surfaces as "why is my verified profile
 * ignored?"
 */
const dedupeById = (profiles: readonly DeviceProfile[]): readonly DeviceProfile[] => {
  const seen = new Set<string>();
  return profiles.filter((profile) => {
    if (seen.has(profile.id)) {
      console.warn(`[profiles] duplicate id '${profile.id}' — keeping the first declaration`);
      return false;
    }
    seen.add(profile.id);
    return true;
  });
};

const NOTHING_PROFILES: readonly DeviceProfile[] = [
  nothingProfile('nothing-ear-1', 'Nothing Ear (1)', 'B181', true, [F.PowerOff]),
  nothingProfile('nothing-ear-stick', 'Nothing Ear (stick)', 'B157', false),
  nothingProfile('nothing-ear-2', 'Nothing Ear (2)', 'B155', true),
  nothingProfile('nothing-ear-a', 'Nothing Ear (a)', 'B162', true),
  nothingProfile('nothing-ear', 'Nothing Ear', 'B171', true),
  nothingProfile('nothing-ear-open', 'Nothing Ear (open)', 'B174', false),
  nothingProfile('cmf-buds-pro', 'CMF Buds Pro', 'B163', true),
  nothingProfile('cmf-buds', 'CMF Buds', 'B168', true),
  nothingProfile('cmf-buds-pro-2', 'CMF Buds Pro 2', 'B172', true),
  nothingProfile('cmf-neckband-pro', 'CMF Neckband Pro', 'B164', true),
  // Newer than ear-web's coverage: flags from the official app's
  // ear_white_list.json (v3.7.3). None have been spoken to over serial yet —
  // the probe decides what is really there on first connect.
  nothingProfile('nothing-ear-3', 'Nothing Ear (3)', 'B173', true),
  nothingProfile('nothing-ear-a-2025', 'Nothing Ear (a) (2025)', 'B183', true),
  nothingProfile('nothing-ear-3a', 'Nothing Ear (3a)', 'B190', true),
  nothingProfile('cmf-buds-2', 'CMF Buds 2', 'B179', true),
  nothingProfile('cmf-buds-2-plus', 'CMF Buds 2 Plus', 'B184', true),
  nothingProfile('cmf-buds-2a', 'CMF Buds 2a', 'B185', true),
  nothingProfile('cmf-buds-pro-2-v2', 'CMF Buds Pro 2 (2nd gen)', 'B187', true),
  nothingProfile('cmf-clip-pro', 'CMF Clip Pro', 'B189', false),
  nothingProfile('cmf-buds-neo', 'CMF Buds Neo', 'B193', true),
  nothingProfile('nothing-headphone-1', 'Nothing Headphone (1)', 'B170', true, [], 'over-ear'),
  nothingProfile('nothing-headphone-a', 'Nothing Headphone (a)', 'B186', true, [], 'over-ear'),
  nothingProfile('nothing-headphone-a-v2', 'Nothing Headphone (a) (2nd gen)', 'B198', true, [], 'over-ear'),
  nothingProfile('cmf-headphone-pro', 'CMF Headphone Pro', 'B175', true, [], 'over-ear'),
];

// --- Sennheiser (GAIA family, beyond the M4) ---------------------------------
//
// Declared from the Smart Control Plus app's own product configs (v1.6.0,
// decrypted in android-testing/sennheiser_m4_assets) cross-checked against the
// app binary's model-id and Bluetooth-name strings. None of these have been
// spoken to over serial yet — the M4 above is still the only hardware-verified
// entry — so a feature listed here is the vendor's claim, not our reading.
// The driver tolerates a rejected command, so an over-claim degrades a toggle;
// an under-claim merely hides one.
//
// The config vocabulary maps onto ours as: NoiseControl → ANC+transparency,
// AudioModes → bass boost (sound modes), ToneAndVoicePrompts → voice prompts,
// OnHeadDetection → wear detection, ConnectionManagement → multipoint. Facts
// with no equivalent here (FitTest, SoundZones, Auracast, telemetry…) stay out.
//
// `artwork` is the folder under `public/devices/sennheiser/` the renders were
// extracted into, or '' for products whose art the app ships only in its
// encrypted bundle (MTW5, HD 630, HDR 275) — those show the placeholder frame
// until someone extracts it.

const sennheiserProfile = (
  id: string,
  name: string,
  match: RegExp,
  form: 'earbuds' | 'over-ear',
  features: readonly FeatureId[],
  artwork: string,
  artworkAspect = 1125 / 558,
): DeviceProfile => ({
  id,
  name,
  brand: 'sennheiser',
  match,
  form,
  battery: form === 'over-ear' ? 'single' : 'dual',
  hasCase: form === 'earbuds',
  features,
  artwork,
  artworkAspect,
});

const SENNHEISER_PROFILES: readonly DeviceProfile[] = [
  sennheiserProfile(
    'momentum-5',
    'MOMENTUM 5 Wireless',
    /M5AEBT|MOMENTUM\s*5/i,
    'over-ear',
    [
      F.Anc, F.Transparency, F.Equalizer, F.BassBoost, F.Sidetone,
      F.WearDetection, F.SmartPause, F.AutoAnswer, F.ComfortCall,
      F.TouchControls, F.VoicePrompts, F.AutoPowerOff, F.Multipoint,
    ],
    'm5',
  ),
  sennheiserProfile(
    'momentum-tw-3',
    'MOMENTUM True Wireless 3',
    /MTW3|MOMENTUM\s*(?:TW|True\s*Wireless)\s*3/i,
    'earbuds',
    [
      F.Anc, F.Transparency, F.Equalizer, F.BassBoost,
      F.WearDetection, F.SmartPause, F.AutoAnswer,
      F.TouchControls, F.VoicePrompts, F.AutoPowerOff, F.Multipoint,
    ],
    'mtw3',
    1125 / 635,
  ),
  sennheiserProfile(
    'momentum-tw-4',
    'MOMENTUM True Wireless 4',
    /MTW4|MOMENTUM\s*(?:TW|True\s*Wireless)\s*4/i,
    'earbuds',
    [
      F.Anc, F.Transparency, F.Equalizer, F.BassBoost, F.Sidetone,
      F.WearDetection, F.SmartPause, F.AutoAnswer,
      F.TouchControls, F.VoicePrompts, F.AutoPowerOff, F.Multipoint,
    ],
    'mtw4',
  ),
  sennheiserProfile(
    'momentum-tw-5',
    'MOMENTUM True Wireless 5',
    /MTW5|MOMENTUM\s*(?:TW|True\s*Wireless)\s*5/i,
    'earbuds',
    [
      F.Anc, F.Transparency, F.Equalizer, F.BassBoost, F.Sidetone,
      F.WearDetection, F.SmartPause, F.AutoAnswer,
      F.TouchControls, F.VoicePrompts, F.AutoPowerOff, F.Multipoint,
    ],
    '',
  ),
  sennheiserProfile(
    'momentum-sport',
    'MOMENTUM Sport',
    /MSPORT1|MOMENTUM\s*Sport/i,
    'earbuds',
    [
      F.Anc, F.Transparency, F.Equalizer, F.BassBoost, F.Sidetone,
      F.WearDetection, F.SmartPause, F.AutoAnswer,
      F.TouchControls, F.VoicePrompts, F.AutoPowerOff, F.Multipoint,
    ],
    'm_sport1',
  ),
  // Ordered before plain ACCENTUM so the specific names claim their own
  // models; the plain entry's lookahead then only sees the over-ear.
  sennheiserProfile(
    'accentum-open',
    'ACCENTUM Open',
    /AOWS1|ACCENTUM\s*Open/i,
    'earbuds',
    [
      F.Transparency, F.Equalizer, F.BassBoost,
      F.WearDetection, F.SmartPause, F.AutoAnswer,
      F.TouchControls, F.VoicePrompts, F.AutoPowerOff, F.Multipoint,
    ],
    'aows1',
  ),
  sennheiserProfile(
    'accentum-plus',
    'ACCENTUM Plus Wireless',
    /ACCENTUM\s*Plus/i,
    'over-ear',
    [
      F.Anc, F.Transparency, F.Equalizer, F.Sidetone,
      F.WearDetection, F.SmartPause, F.AutoAnswer, F.ComfortCall,
      F.TouchControls, F.VoicePrompts, F.AutoPowerOff, F.Multipoint,
    ],
    'acc_plus1',
  ),
  sennheiserProfile(
    'accentum-tw',
    'ACCENTUM True Wireless',
    /ACCENTUM\s*(?:TW|True\s*Wireless)/i,
    'earbuds',
    [
      F.Anc, F.Transparency, F.Equalizer, F.BassBoost, F.Sidetone,
      F.WearDetection, F.SmartPause, F.AutoAnswer,
      F.TouchControls, F.VoicePrompts, F.AutoPowerOff, F.Multipoint,
    ],
    'acc_tw1',
  ),
  sennheiserProfile(
    'accentum',
    'ACCENTUM Wireless',
    /^ACCENTUM(?!.*(plus|tw|true|open|clip))/i,
    'over-ear',
    [
      F.Anc, F.Transparency, F.Equalizer, F.Sidetone,
      F.VoicePrompts, F.AutoPowerOff, F.Multipoint,
    ],
    'acc1',
  ),
  sennheiserProfile(
    'cx-200bt-tw',
    'CX 200BT TW',
    /CX\s*200(?!TW1)/i,
    'earbuds',
    [F.Equalizer, F.Sidetone, F.TouchControls, F.VoicePrompts, F.AutoPowerOff, F.Multipoint],
    'cx200_tw',
  ),
  sennheiserProfile(
    'cx-sport-tw',
    'CX Sport True Wireless',
    /CX200TW1|CX\s*Sport(\s*True\s*Wireless)?$/i,
    'earbuds',
    [F.Equalizer, F.Sidetone, F.TouchControls, F.VoicePrompts, F.AutoPowerOff, F.Multipoint],
    'cx200tw1_sport',
  ),
  sennheiserProfile(
    'cx-500bt-tw',
    'CX 500BT True Wireless',
    /CX\s*500/i,
    'earbuds',
    [
      F.Anc, F.Transparency, F.Equalizer, F.Sidetone,
      F.WearDetection, F.SmartPause, F.AutoAnswer,
      F.TouchControls, F.VoicePrompts, F.AutoPowerOff, F.Multipoint,
    ],
    'cx500_tw',
  ),
  sennheiserProfile(
    'cx-plus-tw',
    'CX Plus True Wireless',
    /CX\s*Plus|CXPLUSTW/i,
    'earbuds',
    [
      F.Anc, F.Transparency, F.Equalizer, F.Sidetone,
      F.WearDetection, F.SmartPause, F.AutoAnswer,
      F.TouchControls, F.VoicePrompts, F.AutoPowerOff, F.Multipoint,
    ],
    'cx_plus_tw',
  ),
  sennheiserProfile(
    'hd-630bt',
    'HD 630 BT',
    /HDB?\s*630/i,
    'over-ear',
    [
      F.Anc, F.Transparency, F.Equalizer, F.BassBoost, F.Sidetone,
      F.WearDetection, F.SmartPause, F.AutoAnswer, F.ComfortCall,
      F.TouchControls, F.VoicePrompts, F.AutoPowerOff, F.Multipoint,
    ],
    '',
  ),
  sennheiserProfile(
    'hdr-275',
    'HDR 275',
    /HDR\s*275/i,
    'over-ear',
    [F.Anc, F.Transparency, F.Equalizer, F.Sidetone, F.VoicePrompts, F.AutoPowerOff, F.Multipoint],
    '',
  ),
  // Not included: BTA1 — a Bluetooth transmitter for TVs, not headphones; its
  // feature set (Auracast broadcast, input source) has no overlap with ours.
  // atwm1/hdw960/sb02m/sb02s appear in the app binary with artwork but ship no
  // product config in this bundle, so there is no capability evidence to declare.
];

export const PROFILES: readonly DeviceProfile[] = dedupeById([
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
      F.ComfortCall,
      F.TouchControls,
      F.VoicePrompts,
      F.AutoPowerOff,
      F.BluetoothCompatibility,
      F.Multipoint,
    ],
    artwork: 'm4',
    artworkAspect: 1125 / 558,
  },
  ...SENNHEISER_PROFILES,
  ...SONY_CATALOG_PROFILES,
  ...NOTHING_PROFILES,
  ...SOUNDCORE_PROFILES,
]);

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
    F.ComfortCall,
    F.TouchControls,
    F.VoicePrompts,
    F.AutoPowerOff,
    F.LowLatency,
    F.BluetoothCompatibility,
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
    F.SpeakToChat,
    F.TouchAssignment,
    F.VoicePrompts,
    F.Multipoint,
  ],
  soundcore: [
    F.Anc,
    F.Transparency,
    F.Equalizer,
    F.BassBoost,
    F.WearDetection,
  ],
  nothing: [
    F.Anc,
    F.Transparency,
    F.Equalizer,
    F.BassBoost,
    F.WearDetection,
    F.SmartPause,
    F.TouchAssignment,
    F.LowLatency,
    // No F.PowerOff: Nothing's protocol has no power-off command — ear-web
    // implements none and the official app cannot either. Ear (1)'s profile
    // carries the feature, so listing it here would silently claim support.
  ],
  heymelody: [F.Anc, F.Equalizer],
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
  [F.ComfortCall]: 'Comfort call',
  [F.TouchControls]: 'Touch controls',
  [F.TouchAssignment]: 'Touch control assignment',
  [F.VoicePrompts]: 'Voice prompts',
  [F.AutoPowerOff]: 'Auto power off',
  [F.PowerOff]: 'Power off from the app',
  [F.LowLatency]: 'Low latency mode',
  [F.BluetoothCompatibility]: 'Bluetooth compatibility mode',
  [F.Multipoint]: 'Multipoint',
};
