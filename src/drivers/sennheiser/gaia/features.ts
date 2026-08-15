/**
 * Feature IDs used to subscribe to async notifications.
 *
 * Registration is `Config_RegisterNotification` (cmd 0x0007, payload
 * `[featureId]`, answered by 0x0107). Without it the headphones only reply to
 * polls and the UI cannot follow changes made from the buttons or phone app.
 *
 * IDs transcribed from `reference/m4.json` (`RegisterNotification_*`).
 */

import { Vendor } from './frame';

export const REGISTER_NOTIFICATION_COMMAND = 0x0007;
export const REGISTER_NOTIFICATION_RESPONSE = 0x0107;

/** Sennheiser-vendor features (0x0495). */
export const SennheiserFeature = {
  Core: 0,
  Device: 2,
  Battery: 3,
  GenericAudio: 4,
  UserEq: 8,
  Versions: 9,
  DeviceManagement: 10,
  Mmi: 11,
  TransparentHearing: 12,
  Anc: 13,
} as const;

export type SennheiserFeatureId =
  (typeof SennheiserFeature)[keyof typeof SennheiserFeature];

/**
 * Qualcomm-vendor features (0x001D) — a different namespace from the Sennheiser
 * one above, despite the overlapping numbers.
 *
 * This is what `Core_GetSupportedFeatures` reports. A MOMENTUM 4 on firmware
 * 3.38.3 returns 0x00 v4, 0x04 v2, 0x06 v2, 0x07 v1, 0x0C v1, 0x0D v1.
 */
export const QualcommFeature = {
  Core: 0,
  Earbud: 1,
  AudioCuration: 2,
  VoiceUi: 3,
  Debug: 4,
  Dfu: 6,
} as const;

/** Names for the IDs we can identify; the rest are shown as raw values. */
export const QUALCOMM_FEATURE_NAMES: Record<number, string> = {
  0x00: 'Core',
  0x01: 'Earbud',
  0x02: 'Audio curation',
  0x03: 'Voice UI',
  0x04: 'Debug',
  0x06: 'Upgrade (DFU)',
};

export const qualcommFeatureName = (id: number): string | null =>
  QUALCOMM_FEATURE_NAMES[id] ?? null;

/**
 * The feature a command belongs to, encoded in the top 7 bits of its ID.
 *
 * Verified against every `RegisterNotification_*` entry in m4.json: ANC
 * commands are 0x1Axx and ANC is feature 13 (0x1A04 >>> 9 === 13), battery is
 * 0x06xx and feature 3, touch control is 0x16xx and feature 11, and so on.
 *
 * This matters because a command only pushes notifications if its *feature* was
 * registered — subscribing to the wrong set silently leaves settings stale.
 */
export const featureOf = (command: number): number => command >>> 9;

/**
 * What we subscribe to on connect: every feature the app reads from.
 *
 * Excludes DFU and firmware upgrade, which we never touch. `commands.test.ts`
 * asserts this list covers every Sennheiser command the app sends, so adding a
 * command to a new feature fails the build rather than quietly not updating.
 */
export const SUBSCRIBED_FEATURES: SennheiserFeatureId[] = [
  SennheiserFeature.Core,
  SennheiserFeature.Device,
  SennheiserFeature.Battery,
  SennheiserFeature.GenericAudio,
  SennheiserFeature.UserEq,
  SennheiserFeature.Versions,
  SennheiserFeature.DeviceManagement,
  SennheiserFeature.Mmi,
  SennheiserFeature.TransparentHearing,
  SennheiserFeature.Anc,
];

export const registerNotificationRequest = (feature: SennheiserFeatureId) => ({
  vendor: Vendor.Sennheiser,
  command: REGISTER_NOTIFICATION_COMMAND,
  payload: [feature],
});
