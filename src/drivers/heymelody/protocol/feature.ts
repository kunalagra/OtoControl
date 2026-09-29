/**
 * Feature switches (`0x010D` query, `0x0403` set), BassWave level (`0x0124` / `0x041B`) and
 * alert-sound volume (`0x0130` / `0x0427`). Layouts: HeyMelody `HeadsetCoreService`, realme
 * notes, QuickBuds capture on OnePlus Buds 4.
 */

import { statusBody } from './status';

export const FeatureId = { AutoPlay: 4, GameLegacy: 6, BassWave: 29, GameMain: 40 } as const;

/** Every switch this driver surfaces, asked for in one `0x010D`. */
export const QUERIED_FEATURES: readonly number[] = [FeatureId.AutoPlay, FeatureId.GameLegacy, FeatureId.BassWave, FeatureId.GameMain];

export const ALERT_VOLUME_RANGE = { min: 1, max: 10 } as const;

const signed = (byte: number): number => (byte > 127 ? byte - 256 : byte);

export function encodeQueryFeatures(ids: readonly number[]): number[] {
  return [ids.length, ...ids];
}

/** `0x810D`: `[status][count]([id][value])…`; only the ids the model has come back. */
export function decodeFeatures(payload: Uint8Array): Map<number, boolean> {
  const body = statusBody(payload, 'feature query');
  const count = body[0] ?? 0;
  const features = new Map<number, boolean>();
  for (let i = 0; i < count && 2 + i * 2 < body.length; i += 1) {
    features.set(body[1 + i * 2], body[2 + i * 2] !== 0);
  }
  return features;
}

export function encodeSetFeature(id: number, on: boolean): number[] {
  return [id, on ? 1 : 0];
}

/**
 * Game mode is feature 40 on models with game sound (HeyMelody `GameModeItem`), 6 otherwise;
 * when a model has both, 6 is the low-latency switch.
 */
export function gameModeIds(features: ReadonlyMap<number, boolean>): { main: number | null; lowLatency: number | null } {
  if (features.has(FeatureId.GameMain)) {
    return { main: FeatureId.GameMain, lowLatency: features.has(FeatureId.GameLegacy) ? FeatureId.GameLegacy : null };
  }
  return { main: features.has(FeatureId.GameLegacy) ? FeatureId.GameLegacy : null, lowLatency: null };
}

export interface BassLevel {
  min: number;
  max: number;
  level: number;
}

/** `0x8124`: `[status][min s8][max s8][level s8]`. */
export function decodeBassLevel(payload: Uint8Array): BassLevel {
  const body = statusBody(payload, 'BassWave level');
  if (body.length < 3) throw new Error('BassWave level reply too short');
  return { min: signed(body[0]), max: signed(body[1]), level: signed(body[2]) };
}

export function encodeBassLevel({ min, max, level }: BassLevel): number[] {
  return [min & 0xff, max & 0xff, level & 0xff];
}

/** `0x8130`: `[status][level]`. */
export function decodeAlertVolume(payload: Uint8Array): number {
  const body = statusBody(payload, 'alert volume');
  if (body.length < 1) throw new Error('alert volume reply has no level');
  return body[0];
}
