import { describe, expect, it } from 'vitest';

import * as commands from './commands';
import { getSupportedFeatures, getSupportedFeaturesNext } from './commands';
import { Vendor } from './frame';
import {
  REGISTER_NOTIFICATION_COMMAND,
  SUBSCRIBED_FEATURES,
  SennheiserFeature,
  featureOf,
} from './features';

interface AnyCommand {
  name: string;
  vendor: number;
  id: number;
}

const isCommand = (value: unknown): value is AnyCommand =>
  typeof value === 'object' &&
  value !== null &&
  'id' in value &&
  'vendor' in value &&
  'encode' in value;

// Widened first: the module's export union does not extend AnyCommand, so the
// type guard cannot narrow it directly.
const allCommands = (Object.values(commands) as unknown[]).filter(isCommand);

describe('featureOf', () => {
  it('recovers the feature ID declared for each family in m4.json', () => {
    expect(featureOf(0x0007)).toBe(SennheiserFeature.Core);
    expect(featureOf(0x0402)).toBe(SennheiserFeature.Device);
    expect(featureOf(0x0603)).toBe(SennheiserFeature.Battery);
    expect(featureOf(0x0800)).toBe(SennheiserFeature.GenericAudio);
    expect(featureOf(0x1000)).toBe(SennheiserFeature.UserEq);
    expect(featureOf(0x1201)).toBe(SennheiserFeature.Versions);
    expect(featureOf(0x1401)).toBe(SennheiserFeature.DeviceManagement);
    expect(featureOf(0x1607)).toBe(SennheiserFeature.Mmi);
    expect(featureOf(0x1804)).toBe(SennheiserFeature.TransparentHearing);
    expect(featureOf(0x1a04)).toBe(SennheiserFeature.Anc);
  });

  it('gives a response, notification and error the same feature as the request', () => {
    for (const command of [0x1a04, 0x1b04, 0x1a84, 0x1b84]) {
      expect(featureOf(command)).toBe(SennheiserFeature.Anc);
    }
  });
});

describe('notification coverage', () => {
  it('found the command table to check', () => {
    expect(allCommands.length).toBeGreaterThan(20);
  });

  it('subscribes to the feature of every Sennheiser command the app sends', () => {
    const subscribed = new Set<number>(SUBSCRIBED_FEATURES);
    const missing = allCommands
      .filter((command) => command.vendor === Vendor.Sennheiser)
      .filter((command) => command.id !== REGISTER_NOTIFICATION_COMMAND)
      .filter((command) => !subscribed.has(featureOf(command.id)))
      .map((command) => `${command.name} (0x${command.id.toString(16)}) needs feature ${featureOf(command.id)}`);

    // Touch controls and paired devices were stale in the UI because features
    // 11 and 10 were missing here while their commands were being used.
    expect(missing).toEqual([]);
  });

  it('does not subscribe to firmware upgrade or DFU', () => {
    expect(SUBSCRIBED_FEATURES).not.toContain(1);
    expect(SUBSCRIBED_FEATURES).not.toContain(6);
  });

  it('lists each feature once', () => {
    expect(new Set(SUBSCRIBED_FEATURES).size).toBe(SUBSCRIBED_FEATURES.length);
  });
});

describe('Core_GetSupportedFeatures', () => {
  it('decodes the moreData flag and feature/version pairs', () => {
    const payload = Uint8Array.from([0x00, 0x03, 0x01, 0x0d, 0x02, 0x08, 0x01]);
    const result = getSupportedFeatures.decode(payload);
    expect(result.moreData).toBe(false);
    expect([...result.features]).toEqual([
      [0x03, 0x01],
      [0x0d, 0x02],
      [0x08, 0x01],
    ]);
  });

  it('flags when another page follows', () => {
    expect(getSupportedFeatures.decode(Uint8Array.from([0x01, 0x03, 0x01])).moreData).toBe(true);
  });

  it('ignores a trailing odd byte rather than inventing a version', () => {
    const result = getSupportedFeatures.decode(Uint8Array.from([0x00, 0x03, 0x01, 0x0d]));
    expect(result.features.size).toBe(1);
  });

  it('handles an empty feature list', () => {
    expect(getSupportedFeatures.decode(Uint8Array.from([0x00])).features.size).toBe(0);
  });

  it('rejects an empty payload', () => {
    expect(() => getSupportedFeatures.decode(Uint8Array.from([]))).toThrow();
  });

  it('is a GAIA core command, so it uses the Qualcomm vendor', () => {
    expect(getSupportedFeatures.vendor).toBe(Vendor.Qualcomm);
    expect(getSupportedFeaturesNext.id).toBe(getSupportedFeatures.id + 1);
  });
});
