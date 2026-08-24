/**
 * Nothing/CMF model table.
 *
 * ear-web identifies the model from the FastPair advertisement (a `B1xx` base
 * code or a hash id), which WebSerial cannot see. This driver instead reads
 * the base code off the wire — `Read.DeviceModel` — and looks it up here.
 *
 * So this table is used the other way round from Sony's: the *capabilities*
 * are negotiated live (each unsupported read times out and hides its
 * section), and this table exists for the display name, the profile artwork
 * fallback, and for the per-model quirks that live negotiation cannot
 * discover (which byte dialect a command uses).
 *
 * Codenames are Nothing's own internal ones, as used by ear-web's file naming.
 *
 * Every `base`/`bluetoothName` pair below matches the official app's own SKU
 * catalogue (`devices_info_list.json`, where each earphone's
 * `deviceSpu.modelId` *is* the `B1xx` code and `bluetoothName` is the
 * advertised name) — all 22 verified. The app also lists a B201 sharing
 * B173's `privateCode`; it has no catalogue entry, so it is not guessed at
 * here.
 *
 * **The authoritative source for these flags is not the white list** — it is
 * the app's per-model `IOTProductDevice` subclass
 * (`com/nothing/<codename>/core/device/IOTProductDevice<Codename>.java`).
 * Every predicate defaults to false in the base class and each model
 * overrides what it has. Reading a flag off `ear_white_list.json` instead
 * produced three wrong entries before this was found: its `ultraBass` and
 * `diracOpteoSupport` fields do not mean "has bass boost" and "has Dirac".
 *
 * Swept from those 18 classes, `·` meaning "not overridden, so false":
 *
 * | base | bassBoost | spatial | headTrack | advanceEq | ancLevel |
 * |---|---|---|---|---|---|
 * | B155 | ·     | ·    | ·    | true | 4   |
 * | B157 | ·     | ·    | ·    | ·    | 255 |
 * | B162 | true  | ·    | ·    | ·    | 4   |
 * | B163 | ·     | ·    | ·    | ·    | 3   |
 * | B164 | true  | true | ·    | ·    | 4   |
 * | B168 | true  | ·    | ·    | ·    | 3   |
 * | B170 | true  | true | true | true | 4   |
 * | B171 | true  | ·    | ·    | true | 4   |
 * | B172 | true  | true | ·    | ·    | 4   |
 * | B173 | true  | ·    | ·    | true | 4   |
 * | B174 | false | ·    | ·    | ·    | 4   |
 * | B175 | true  | true | true | ·    | 4   |
 * | B179 | true  | true | ·    | ·    | 4   |
 * | B181 | ·     | ·    | ·    | ·    | ·   |
 * | B183 | true  | ·    | ·    | ·    | 4   |
 * | B184 | true  | true | ·    | ·    | 4   |
 * | B185 | true  | ·    | ·    | ·    | 3   |
 * | B187 | true  | true | ·    | ·    | 4   |
 *
 * Notes on that table. `advanceEq` (B155/B170/B171/B173) is **not** the Buds
 * Pro 2 set our command comments used to claim. `hasBassEnhancerFunction` — a
 * separate command pair, `0xc053`/`0xf057`, which this driver does not
 * implement — is false on every model here. `hasAudioDoFunction` is true only
 * on B184. B157's `255` reads as a no-ANC sentinel.
 *
 * `diracEq` below is deliberately **not** taken from this sweep. The obvious
 * candidate predicate, `hldcOrDiracOne()`, is not the gate: the app selects
 * Dirac presets from a `getDiracOpteoEQList()` config whose source has not
 * been traced, and the reply itself is a plain `BasicInt`. So those flags
 * still carry their earlier reading and are the weakest column here.
 *
 * Models the app knows and this table does not: **B182** (gligar, beside
 * B184), **B201** (shares B173's `privateCode`) and **B220** (espeon). None
 * has a catalogue entry to name it, so none is guessed at.
 *
 * `codename` matches the app's own package per model and is documentation
 * only — nothing reads it. B186/B198 are left on `elekid` (B170's class);
 * they have no class of their own and plausibly share its implementation.
 *
 * The flags below were cross-checked against the official Nothing X app
 * (com.nothing.smartcenter v3.7.3, decompiled): `ear_white_list.json`'s
 * per-modelId configs confirm the exact ultraBass set (B162/B171/B164/B168/
 * B172/B174), the earTipFitTest set (B155/B162/B171/B172), personalizedAnc
 * (B155 only), the absence of classic EQ presets on B168/B172 (eq=0, the
 * listening-mode dialect), and no ANC on B174/B157 (no `ancLevel` / a
 * transparency-only one). The official `defaultControl` blobs also confirm
 * the gesture wire format this driver uses: a count, then 4-byte
 * (device, common, type, action) records.
 */

export interface NothingModel {
  /** The `B1xx` base code from FastPair advertising. */
  base: string;
  name: string;
  /**
   * The Bluetooth device name, as the device itself advertises it. Not used
   * for identification — Web Serial never exposes a device name, so the base
   * code comes off the wire — but it is how each row was verified against the
   * official app's catalogue, and how a human matches a row to a product.
   */
  bluetoothName: string;
  codename: string;
  /** Has any noise control at all. Ear (stick) and Ear (open) do not. */
  anc: boolean;
  /** Nothing's enhanced bass (B171/B172/B168/B162 dialect). */
  enhancedBass: boolean;
  /**
   * The Dirac Opteo EQ selector replaces classic EQ presets (the official
   * app's `eq: 0` models — B172/B168 and newer Buds).
   */
  diracEq: boolean;
  /** In-ear detection read is not implemented on Ear (open). */
  inEarDetection: boolean;
  /** Personalized ANC is Ear (2) only. */
  personalizedAnc: boolean;
  /** Ear tip fit test support. */
  earFitTest: boolean;
}

const M: NothingModel[] = [
  // --- ear-web era (protocol bytes verified against its implementation) ---
  { base: 'B181', bluetoothName: 'Nothing ear (1)', name: 'Nothing Ear (1)', codename: 'one', anc: true, enhancedBass: false, diracEq: false, inEarDetection: true, personalizedAnc: false, earFitTest: false },
  { base: 'B157', bluetoothName: 'Ear (Stick)', name: 'Nothing Ear (stick)', codename: 'sticks', anc: false, enhancedBass: false, diracEq: false, inEarDetection: true, personalizedAnc: false, earFitTest: false },
  { base: 'B155', bluetoothName: 'Ear (2)', name: 'Nothing Ear (2)', codename: 'two', anc: true, enhancedBass: false, diracEq: false, inEarDetection: true, personalizedAnc: true, earFitTest: true },
  { base: 'B162', bluetoothName: 'Nothing Ear (a)', name: 'Nothing Ear (a)', codename: 'cleffa', anc: true, enhancedBass: true, diracEq: false, inEarDetection: true, personalizedAnc: false, earFitTest: true },
  { base: 'B171', bluetoothName: 'Nothing Ear', name: 'Nothing Ear', codename: 'entei', anc: true, enhancedBass: true, diracEq: false, inEarDetection: true, personalizedAnc: false, earFitTest: true },
  // `IOTProductDeviceFlaffy` sets *both* bass predicates explicitly false —
  // `hasBassBoostFunction()` and `hasBassEnhancerFunction()` — so the open-ear
  // has no bass boost at all. It does override `getSupportANCLevel() = 4`,
  // which sits oddly with an open-ear design having no ANC; `anc` is left
  // false on the physical argument and the live probe settles it either way.
  { base: 'B174', bluetoothName: 'Nothing Ear (open)', name: 'Nothing Ear (open)', codename: 'flaffy', anc: false, enhancedBass: false, diracEq: false, inEarDetection: false, personalizedAnc: false, earFitTest: false },
  { base: 'B163', bluetoothName: 'Buds Pro', name: 'CMF Buds Pro', codename: 'corsola', anc: true, enhancedBass: false, diracEq: false, inEarDetection: true, personalizedAnc: false, earFitTest: false },
  { base: 'B168', bluetoothName: 'CMF Buds', name: 'CMF Buds', codename: 'donphan', anc: true, enhancedBass: true, diracEq: true, inEarDetection: true, personalizedAnc: false, earFitTest: false },
  { base: 'B172', bluetoothName: 'CMF Buds Pro 2', name: 'CMF Buds Pro 2', codename: 'espeon', anc: true, enhancedBass: true, diracEq: true, inEarDetection: true, personalizedAnc: false, earFitTest: true },
  { base: 'B164', bluetoothName: 'Neckband Pro', name: 'CMF Neckband Pro', codename: 'crobat', anc: true, enhancedBass: true, diracEq: false, inEarDetection: true, personalizedAnc: false, earFitTest: false },
  // --- official-app era (flags from ear_white_list.json v3.7.3; the probe
  // --- decides on real hardware, these are the app's own claims) ---
  { base: 'B173', bluetoothName: 'Nothing Ear (3)', name: 'Nothing Ear (3)', codename: 'three', anc: true, enhancedBass: true, diracEq: false, inEarDetection: true, personalizedAnc: false, earFitTest: true },
  { base: 'B183', bluetoothName: 'Nothing Ear (a)', name: 'Nothing Ear (a) (2025)', codename: 'hitmontop', anc: true, enhancedBass: true, diracEq: false, inEarDetection: true, personalizedAnc: false, earFitTest: true },
  { base: 'B190', bluetoothName: 'Nothing Ear (3a)', name: 'Nothing Ear (3a)', codename: 'jumpluff', anc: true, enhancedBass: true, diracEq: false, inEarDetection: true, personalizedAnc: false, earFitTest: true },
  { base: 'B179', bluetoothName: 'CMF Buds 2', name: 'CMF Buds 2', codename: 'girafarig', anc: true, enhancedBass: true, diracEq: false, inEarDetection: true, personalizedAnc: false, earFitTest: true },
  { base: 'B184', bluetoothName: 'CMF Buds 2 Plus', name: 'CMF Buds 2 Plus', codename: 'gligar', anc: true, enhancedBass: true, diracEq: false, inEarDetection: true, personalizedAnc: false, earFitTest: true },
  { base: 'B185', bluetoothName: 'CMF Buds 2a', name: 'CMF Buds 2a', codename: 'hoothoot', anc: true, enhancedBass: true, diracEq: true, inEarDetection: true, personalizedAnc: false, earFitTest: false },
  { base: 'B187', bluetoothName: 'CMF Buds Pro 2', name: 'CMF Buds Pro 2 (2nd gen)', codename: 'heracross', anc: true, enhancedBass: true, diracEq: true, inEarDetection: true, personalizedAnc: false, earFitTest: true },
  { base: 'B189', bluetoothName: 'CMF Clip Pro', name: 'CMF Clip Pro', codename: 'igglybuff', anc: false, enhancedBass: true, diracEq: false, inEarDetection: true, personalizedAnc: false, earFitTest: false },
  { base: 'B170', bluetoothName: 'Nothing Headphone (1)', name: 'Nothing Headphone (1)', codename: 'elekid', anc: true, enhancedBass: true, diracEq: false, inEarDetection: true, personalizedAnc: false, earFitTest: false },
  { base: 'B186', bluetoothName: 'Nothing Headphone (a)', name: 'Nothing Headphone (a)', codename: 'elekid', anc: true, enhancedBass: true, diracEq: false, inEarDetection: true, personalizedAnc: false, earFitTest: false },
  { base: 'B198', bluetoothName: 'Nothing Headphone (a)', name: 'Nothing Headphone (a) (2nd gen)', codename: 'elekid', anc: true, enhancedBass: true, diracEq: false, inEarDetection: true, personalizedAnc: false, earFitTest: false },
  // B175 read off `IOTProductDeviceForretress`, the app's own per-model class:
  // `hasBassBoostFunction() = true`, `hasSpatialAudioFunction() = true`,
  // `hasHeadTrack() = true`, `getSupportANCLevel() = 4`, and — inherited from
  // `IOTProductDevice`, which defaults every predicate to false —
  // `hldcOrDiracOne() = false` and `supportAdvanceEq() = false`. Not an
  // over-ear with in-ear detection (`single: 1`, `deviceType: 6`,
  // `earDetection: 0`).
  { base: 'B175', bluetoothName: 'CMF Headphone Pro', name: 'CMF Headphone Pro', codename: 'forretress', anc: true, enhancedBass: true, diracEq: false, inEarDetection: false, personalizedAnc: false, earFitTest: false },
];

export const NOTHING_MODELS: readonly NothingModel[] = M;

export const modelForBase = (base: string | null): NothingModel | null =>
  (base && M.find((model) => model.base === base)) || null;

/**
 * A model guess from a firmware string, best effort. Firmware strings look
 * like "US.A.1.2.3" and do not carry the model; this only catches the cases
 * ear-web itself gates on (its Ear (stick) ANC check parses the same string),
 * so null — "unknown, negotiate everything" — is the honest default.
 */
export function modelForFirmware(_firmware: string | null): NothingModel | null {
  return null;
}
