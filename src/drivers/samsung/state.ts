/**
 * Galaxy Buds device state.
 *
 * Durable/live split follows the convention every driver in this repo uses:
 * identity and settings survive a disconnect (`captureDurable`/`applyDurable`,
 * see `core/persistence.ts` and `core/stateStore.ts`); battery, placement and
 * ringing do not.
 */

import type { ConnectionStatus } from '@/core/connection';
import type { Cells, Placement, TouchGestures } from './decode';
import type { NoiseCycle } from './commands';
import type { SamsungModelId, TouchAction } from './models';

export interface SamsungInfo {
  /** The model's display name — the field `core/manager.ts` reads generically off every driver's state. */
  model: string | null;
  modelId: SamsungModelId | null;
  /** The SKU the earbuds reported (left, else right), as read. */
  sku: string | null;
  /** The extended-status revision: what gates features within a model. */
  revision: number | null;
  firmware: string | null;
  hardware: string | null;
  /** The unit's colour id (`DeviceIds`), which picks its product render. */
  colour: number | null;
}

export interface SamsungState {
  status: ConnectionStatus;
  error: string | null;
  info: SamsungInfo;
  battery: Cells<number | null>;
  charging: Cells<boolean>;
  placement: { left: Placement; right: Placement };
  /** 0 off, 1 ANC, 2 ambient, 3 adaptive. */
  noiseMode: number | null;
  /** 0 off/normal, 1-5 the built-in presets, 6 custom. */
  eq: number | null;
  touchLocked: boolean | null;
  /** Per-gesture flags, kept so locking can restate them unchanged. */
  gestures: TouchGestures | null;
  /** The ambient-sound step, zero-based, where the model has one. */
  ambientLevel: number | null;
  /** What a touch-and-hold does on each earbud; null for a byte in no map. */
  hold: { left: TouchAction | null; right: TouchAction | null };
  /** The pair of modes a long press cycles through on each earbud, where the model lets that be chosen. */
  noiseCycle: { left: NoiseCycle | null; right: NoiseCycle | null };
  /** Live-only: resets on disconnect. */
  finding: boolean;
  /**
   * Why an identity read went wrong — the raw reply, or `no reply` — so a
   * tester can report it from the System tab without DevTools. Live-only.
   */
  diagnostics: Partial<Record<'sku' | 'version', string>>;
}

export const initialSamsungState: SamsungState = {
  status: 'disconnected',
  error: null,
  info: { model: null, modelId: null, sku: null, revision: null, firmware: null, hardware: null, colour: null },
  battery: { left: null, right: null, case: null },
  charging: { left: false, right: false, case: false },
  placement: { left: 'disconnected', right: 'disconnected' },
  noiseMode: null,
  eq: null,
  touchLocked: null,
  gestures: null,
  ambientLevel: null,
  hold: { left: null, right: null },
  noiseCycle: { left: null, right: null },
  finding: false,
  diagnostics: {},
};

// --- persistence -----------------------------------------------------------

export const SAMSUNG_SNAPSHOT_VERSION = 1;

export interface SamsungDurableState {
  info: SamsungInfo;
  noiseMode: number | null;
  eq: number | null;
  touchLocked: boolean | null;
  gestures: TouchGestures | null;
  ambientLevel: number | null;
  hold: SamsungState['hold'];
  noiseCycle: SamsungState['noiseCycle'];
}

export const captureDurable = (state: SamsungState): SamsungDurableState => ({
  info: state.info,
  noiseMode: state.noiseMode,
  eq: state.eq,
  touchLocked: state.touchLocked,
  gestures: state.gestures,
  ambientLevel: state.ambientLevel,
  hold: state.hold,
  noiseCycle: state.noiseCycle,
});

export const applyDurable = (payload: object): Partial<SamsungState> => {
  const snapshot = payload as Partial<SamsungDurableState>;
  return {
    info: { ...initialSamsungState.info, ...snapshot.info },
    noiseMode: snapshot.noiseMode ?? null,
    eq: snapshot.eq ?? null,
    touchLocked: snapshot.touchLocked ?? null,
    gestures: snapshot.gestures ?? null,
    ambientLevel: snapshot.ambientLevel ?? null,
    hold: snapshot.hold ?? initialSamsungState.hold,
    noiseCycle: snapshot.noiseCycle ?? initialSamsungState.noiseCycle,
  };
};
