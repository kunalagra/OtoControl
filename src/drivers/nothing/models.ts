/**
 * Nothing/CMF model table.
 *
 * ear-web identifies the model from the FastPair advertisement (a `B1xx` base
 * code or a hash id), which WebSerial cannot see — over the wire there is only
 * the firmware string. So this table is used the other way round from Sony's:
 * the *capabilities* are negotiated live (each unsupported read times out and
 * hides its section), and this table exists for the display name, the profile
 * artwork fallback, and for the per-model quirks that live negotiation cannot
 * discover (which byte dialect a command uses).
 *
 * Codenames are Nothing's own internal ones, as used by ear-web's file naming.
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
  /** The Bluetooth device name, as the device itself advertises it. */
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
  { base: 'B174', bluetoothName: 'Nothing Ear (open)', name: 'Nothing Ear (open)', codename: 'flaaffy', anc: false, enhancedBass: true, diracEq: false, inEarDetection: false, personalizedAnc: false, earFitTest: false },
  { base: 'B163', bluetoothName: 'Buds Pro', name: 'CMF Buds Pro', codename: 'corsola', anc: true, enhancedBass: false, diracEq: false, inEarDetection: true, personalizedAnc: false, earFitTest: false },
  { base: 'B168', bluetoothName: 'CMF Buds', name: 'CMF Buds', codename: 'donphan', anc: true, enhancedBass: true, diracEq: true, inEarDetection: true, personalizedAnc: false, earFitTest: false },
  { base: 'B172', bluetoothName: 'CMF Buds Pro 2', name: 'CMF Buds Pro 2', codename: 'espeon', anc: true, enhancedBass: true, diracEq: true, inEarDetection: true, personalizedAnc: false, earFitTest: true },
  { base: 'B164', bluetoothName: 'Neckband Pro', name: 'CMF Neckband Pro', codename: 'crobat', anc: true, enhancedBass: true, diracEq: false, inEarDetection: true, personalizedAnc: false, earFitTest: false },
  // --- official-app era (flags from ear_white_list.json v3.7.3; the probe
  // --- decides on real hardware, these are the app's own claims) ---
  { base: 'B173', bluetoothName: 'Nothing Ear (3)', name: 'Nothing Ear (3)', codename: '', anc: true, enhancedBass: true, diracEq: false, inEarDetection: true, personalizedAnc: false, earFitTest: true },
  { base: 'B183', bluetoothName: 'Nothing Ear (a)', name: 'Nothing Ear (a) (2025)', codename: 'cleffa', anc: true, enhancedBass: true, diracEq: false, inEarDetection: true, personalizedAnc: false, earFitTest: true },
  { base: 'B190', bluetoothName: 'Nothing Ear (3a)', name: 'Nothing Ear (3a)', codename: 'jumpluff', anc: true, enhancedBass: true, diracEq: false, inEarDetection: true, personalizedAnc: false, earFitTest: true },
  { base: 'B179', bluetoothName: 'CMF Buds 2', name: 'CMF Buds 2', codename: '', anc: true, enhancedBass: true, diracEq: false, inEarDetection: true, personalizedAnc: false, earFitTest: true },
  { base: 'B184', bluetoothName: 'CMF Buds 2 Plus', name: 'CMF Buds 2 Plus', codename: '', anc: true, enhancedBass: true, diracEq: false, inEarDetection: true, personalizedAnc: false, earFitTest: true },
  { base: 'B185', bluetoothName: 'CMF Buds 2a', name: 'CMF Buds 2a', codename: '', anc: true, enhancedBass: true, diracEq: true, inEarDetection: true, personalizedAnc: false, earFitTest: false },
  { base: 'B187', bluetoothName: 'CMF Buds Pro 2', name: 'CMF Buds Pro 2 (2nd gen)', codename: '', anc: true, enhancedBass: true, diracEq: true, inEarDetection: true, personalizedAnc: false, earFitTest: true },
  { base: 'B189', bluetoothName: 'CMF Clip Pro', name: 'CMF Clip Pro', codename: 'igglybuff', anc: false, enhancedBass: true, diracEq: false, inEarDetection: true, personalizedAnc: false, earFitTest: false },
  { base: 'B170', bluetoothName: 'Nothing Headphone (1)', name: 'Nothing Headphone (1)', codename: 'elekid', anc: true, enhancedBass: true, diracEq: false, inEarDetection: true, personalizedAnc: false, earFitTest: false },
  { base: 'B186', bluetoothName: 'Nothing Headphone (a)', name: 'Nothing Headphone (a)', codename: 'elekid', anc: true, enhancedBass: true, diracEq: false, inEarDetection: true, personalizedAnc: false, earFitTest: false },
  { base: 'B198', bluetoothName: 'Nothing Headphone (a)', name: 'Nothing Headphone (a) (2nd gen)', codename: 'elekid', anc: true, enhancedBass: true, diracEq: false, inEarDetection: true, personalizedAnc: false, earFitTest: false },
  { base: 'B175', bluetoothName: 'CMF Headphone Pro', name: 'CMF Headphone Pro', codename: 'forretress', anc: true, enhancedBass: true, diracEq: false, inEarDetection: true, personalizedAnc: false, earFitTest: false },
];

export const NOTHING_MODELS: readonly NothingModel[] = M;

export const modelForBase = (base: string | null): NothingModel | null =>
  (base && M.find((model) => model.base === base)) || null;

/**
 * The model for a Bluetooth device name, or null for a name we do not know.
 *
 * Names are shared across generations — "Nothing Ear (a)" is both B162 and
 * B183, "CMF Buds Pro 2" both B172 and B187 — and the serial link cannot
 * split them, so the earlier model wins. The capability probe still decides
 * what the UI offers either way; this only picks the name and the artwork.
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
