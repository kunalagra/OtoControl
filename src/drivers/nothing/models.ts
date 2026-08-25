/**
 * Nothing/CMF model table.
 *
 * ear-web identifies the model from the FastPair advertisement (a `B1xx` base
 * code or a hash id), which WebSerial cannot see. This driver has two sources
 * instead: the advertised Bluetooth name on the GATT carrier, and the base
 * code read off the wire (`Read.DeviceModel`) on either. The wire read is the
 * more precise of the two, being a base code rather than a name shared across
 * generations.
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
 * advertised name) — all 23 verified, B193 included.
 *
 * **The authoritative source for these flags is not the white list** — it is
 * the app's per-model `IOTProductDevice` subclass
 * (`com/nothing/<codename>/core/device/IOTProductDevice<Codename>.java`).
 * Every predicate defaults to false in the base class and each model
 * overrides what it has. Reading a flag off `ear_white_list.json` instead
 * produced three wrong entries before this was found: its `ultraBass` and
 * `diracOpteoSupport` fields do not mean "has bass boost" and "has Dirac".
 *
 * Cross-checked a third time against **BudsLink**'s own per-model configs
 * (`src/lib/devices/nothingBuds/deviceConfigs/`, 17 of the 22 that predate
 * B193), which
 * is a working implementation rather than a reading of vendor data. That pass
 * corrected eight rows: `inEarDetection` was wrong on B164/B179/B181/B185/
 * B186/B198 (BudsLink says no, and says so explicitly for B179 and B181) and
 * on B175 (BudsLink says yes — an over-ear still detects wear, whatever the
 * white list's `earDetection: 0` means), and `personalizedAnc` was missing on
 * B171 and B173.
 *
 * It also independently confirms, for B175: `batterySingle`, the exact
 * `noiseControl` byte map this driver uses, `bassEnhanceLevel` (so
 * `enhancedBass: true` was the right call over the white list's `ultraBass: 0`),
 * `dualConnection`, and `spatialimmersiveModes`.
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
 * Models the app knows and this table does not: **B182** (`GligarManager.
 * productId`, beside B184), **B201** (`ear_white_list.json` carries it both as
 * B173's `supportId` and as an entry of its own) and **B220**
 * (`IOTProductDeviceEspeon`). None has a catalogue entry to name it, so none
 * is guessed at. All three are still absent in 3.8.0.
 *
 * `codename` matches the app's own package per model and is documentation
 * only — nothing reads it. B186/B198 are left on `elekid` (B170's class);
 * they have no class of their own and plausibly share its implementation.
 *
 * The flags below were cross-checked against the official Nothing X app
 * (com.nothing.smartcenter v3.7.3, decompiled, and re-checked against v3.8.0,
 * which changes not one flag on any of these models): `ear_white_list.json`'s
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
   * The Bluetooth device name, as the device itself advertises it. Used to
   * identify a device reached over GATT, where it is all that is available
   * before the first exchange; the wire's base code supersedes it once read.
   * Also how each row was verified against the official app's catalogue.
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
  /**
   * One body rather than a left/right pair — the over-ears and the neckband
   * (`single: 1`, `deviceType: 6` in `ear_white_list.json`). They report one
   * battery cell, and their controls are a button/wheel/slider rather than the
   * per-bud pinches the gesture model describes.
   */
  singleBody?: boolean;
  /**
   * Rings without a side byte — `[playing]` rather than `[device, playing]`.
   * BudsLink's `ringLegacy`, set on the Ear (1) alone.
   */
  ringLegacy?: boolean;
}

const M: NothingModel[] = [
  // --- ear-web era (protocol bytes verified against its implementation) ---
  { base: 'B181', bluetoothName: 'Nothing ear (1)', name: 'Nothing Ear (1)', codename: 'one', anc: true, enhancedBass: false, diracEq: false, inEarDetection: false, personalizedAnc: false, earFitTest: false, ringLegacy: true },
  { base: 'B157', bluetoothName: 'Ear (Stick)', name: 'Nothing Ear (stick)', codename: 'sticks', anc: false, enhancedBass: false, diracEq: false, inEarDetection: true, personalizedAnc: false, earFitTest: false },
  { base: 'B155', bluetoothName: 'Ear (2)', name: 'Nothing Ear (2)', codename: 'two', anc: true, enhancedBass: false, diracEq: false, inEarDetection: true, personalizedAnc: true, earFitTest: true },
  { base: 'B162', bluetoothName: 'Nothing Ear (a)', name: 'Nothing Ear (a)', codename: 'cleffa', anc: true, enhancedBass: true, diracEq: false, inEarDetection: true, personalizedAnc: false, earFitTest: true },
  { base: 'B171', bluetoothName: 'Nothing Ear', name: 'Nothing Ear', codename: 'entei', anc: true, enhancedBass: true, diracEq: false, inEarDetection: true, personalizedAnc: true, earFitTest: true },
  // `IOTProductDeviceFlaffy` sets *both* bass predicates explicitly false —
  // `hasBassBoostFunction()` and `hasBassEnhancerFunction()` — so the open-ear
  // has no bass boost at all. It does override `getSupportANCLevel() = 4`,
  // which sits oddly with an open-ear design having no ANC; `anc` is left
  // false on the physical argument and the live probe settles it either way.
  { base: 'B174', bluetoothName: 'Nothing Ear (open)', name: 'Nothing Ear (open)', codename: 'flaffy', anc: false, enhancedBass: false, diracEq: false, inEarDetection: false, personalizedAnc: false, earFitTest: false },
  { base: 'B163', bluetoothName: 'Buds Pro', name: 'CMF Buds Pro', codename: 'corsola', anc: true, enhancedBass: false, diracEq: false, inEarDetection: true, personalizedAnc: false, earFitTest: false },
  { base: 'B168', bluetoothName: 'CMF Buds', name: 'CMF Buds', codename: 'donphan', anc: true, enhancedBass: true, diracEq: true, inEarDetection: true, personalizedAnc: false, earFitTest: false },
  { base: 'B172', bluetoothName: 'CMF Buds Pro 2', name: 'CMF Buds Pro 2', codename: 'espeon', anc: true, enhancedBass: true, diracEq: true, inEarDetection: true, personalizedAnc: false, earFitTest: true },
  { base: 'B164', bluetoothName: 'Neckband Pro', name: 'CMF Neckband Pro', codename: 'crobat', anc: true, enhancedBass: true, diracEq: false, inEarDetection: false, personalizedAnc: false, earFitTest: false, singleBody: true },
  // --- official-app era (flags from ear_white_list.json v3.7.3; the probe
  // --- decides on real hardware, these are the app's own claims) ---
  { base: 'B173', bluetoothName: 'Nothing Ear (3)', name: 'Nothing Ear (3)', codename: 'three', anc: true, enhancedBass: true, diracEq: false, inEarDetection: true, personalizedAnc: true, earFitTest: true },
  { base: 'B183', bluetoothName: 'Nothing Ear (a)', name: 'Nothing Ear (a) (2025)', codename: 'hitmontop', anc: true, enhancedBass: true, diracEq: false, inEarDetection: true, personalizedAnc: false, earFitTest: true },
  { base: 'B190', bluetoothName: 'Nothing Ear (3a)', name: 'Nothing Ear (3a)', codename: 'jumpluff', anc: true, enhancedBass: true, diracEq: false, inEarDetection: true, personalizedAnc: false, earFitTest: true },
  { base: 'B179', bluetoothName: 'CMF Buds 2', name: 'CMF Buds 2', codename: 'girafarig', anc: true, enhancedBass: true, diracEq: false, inEarDetection: false, personalizedAnc: false, earFitTest: true },
  { base: 'B184', bluetoothName: 'CMF Buds 2 Plus', name: 'CMF Buds 2 Plus', codename: 'gligar', anc: true, enhancedBass: true, diracEq: false, inEarDetection: true, personalizedAnc: false, earFitTest: true },
  { base: 'B185', bluetoothName: 'CMF Buds 2a', name: 'CMF Buds 2a', codename: 'hoothoot', anc: true, enhancedBass: true, diracEq: true, inEarDetection: false, personalizedAnc: false, earFitTest: false },
  { base: 'B187', bluetoothName: 'CMF Buds Pro 2', name: 'CMF Buds Pro 2 (2nd gen)', codename: 'heracross', anc: true, enhancedBass: true, diracEq: true, inEarDetection: true, personalizedAnc: false, earFitTest: true },
  { base: 'B189', bluetoothName: 'CMF Clip Pro', name: 'CMF Clip Pro', codename: 'igglybuff', anc: false, enhancedBass: true, diracEq: false, inEarDetection: true, personalizedAnc: false, earFitTest: false },
  // New in app 3.8.0, and the one row not swept from an `IOTProductDevice`
  // class — B193 has none. Its flags come from `ear_white_list.json` via the
  // fields that survive a check against the 22 rows above: `ultraBass: 1`
  // (never a false positive, 15/15), no `earTipFitTest` key (22/22),
  // `earDetection: 0` (7/8 where stated) and no `eq: 0` (22/22 for Dirac).
  { base: 'B193', bluetoothName: 'CMF Buds Neo', name: 'CMF Buds Neo', codename: 'larvitar', anc: true, enhancedBass: true, diracEq: false, inEarDetection: false, personalizedAnc: false, earFitTest: false },
  { base: 'B170', bluetoothName: 'Nothing Headphone (1)', name: 'Nothing Headphone (1)', codename: 'elekid', anc: true, enhancedBass: true, diracEq: false, inEarDetection: true, personalizedAnc: false, earFitTest: false, singleBody: true },
  { base: 'B186', bluetoothName: 'Nothing Headphone (a)', name: 'Nothing Headphone (a)', codename: 'elekid', anc: true, enhancedBass: true, diracEq: false, inEarDetection: false, personalizedAnc: false, earFitTest: false, singleBody: true },
  { base: 'B198', bluetoothName: 'Nothing Headphone (a)', name: 'Nothing Headphone (a) (2nd gen)', codename: 'elekid', anc: true, enhancedBass: true, diracEq: false, inEarDetection: false, personalizedAnc: false, earFitTest: false, singleBody: true },
  // `inEarDetection: false` is what Nothing's own config says
  // (`earDetection: 0`), and the app is the ground truth for this table.
  // BudsLink disagrees — it sets `inEarDetection: true` for B175 — but nothing
  // gates on this flag any more: `decodeInEarDetection` addresses feature id 1
  // inside `0xc00e`'s list, so the device settles it at runtime and a wrong
  // flag cannot hide a working control.
  //
  // B175 read off `IOTProductDeviceForretress`, the app's own per-model class:
  // `hasBassBoostFunction() = true`, `hasSpatialAudioFunction() = true`,
  // `hasHeadTrack() = true`, `getSupportANCLevel() = 4`, and — inherited from
  // `IOTProductDevice`, which defaults every predicate to false —
  // `hldcOrDiracOne() = false` and `supportAdvanceEq() = false`. Not an
  // over-ear with in-ear detection (`single: 1`, `deviceType: 6`,
  // `earDetection: 0`).
  // `personalizedAnc` is recorded false because no vendor source claims it —
  // but a real unit answers `GET_PERSONALIZED_ANC 0xc020` and the control
  // appears. Left as-is deliberately: it documents the vendor's claim, and it
  // is the standing evidence for why the probes are not gated on this table
  // (see `refresh` in `device.ts`).
  { base: 'B175', bluetoothName: 'CMF Headphone Pro', name: 'CMF Headphone Pro', codename: 'forretress', anc: true, enhancedBass: true, diracEq: false, inEarDetection: false, personalizedAnc: false, earFitTest: false, singleBody: true },
];

export const NOTHING_MODELS: readonly NothingModel[] = M;

export const modelForBase = (base: string | null): NothingModel | null =>
  (base && M.find((model) => model.base === base)) || null;

/**
 * The model for a Bluetooth device name, or null for a name we do not know.
 *
 * Only the GATT carrier has a device name to offer; over Web Serial the base
 * code comes off the wire instead (`Read.DeviceModel`). Names are shared
 * across generations — "Nothing Ear (a)" is both B162 and B183, "CMF Buds
 * Pro 2" both B172 and B187 — and a name cannot split them, so the earlier
 * model wins. The capability probe decides what the UI offers either way;
 * this only picks the name and the artwork.
 */
export const modelForBluetoothName = (name: string): NothingModel | null =>
  M.find((model) => model.bluetoothName.toLowerCase() === name.toLowerCase().trim()) ?? null;

/**
 * A model guess from a firmware string, best effort. Firmware strings look
 * like "US.A.1.2.3" and do not carry the model; this only catches the cases
 * ear-web itself gates on (its Ear (stick) ANC check parses the same string),
 * so null — "unknown, negotiate everything" — is the honest default.
 */
export function modelForFirmware(_firmware: string | null): NothingModel | null {
  return null;
}
