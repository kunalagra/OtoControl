/**
 * HeyMelody device state and the pure reduction of the one push notification
 * this phase models (ANC, over `0x0204`).
 *
 * Durable/live split follows the convention every driver in this repo uses:
 * identity and settings survive a disconnect (`captureDurable`/`applyDurable`,
 * see `core/persistence.ts` and `core/stateStore.ts`); battery and connection
 * status do not.
 */

import type { ConnectionStatus } from '@/core/connection';
import { decodeAncNotification } from './commands';
import type { BatteryCell, EqPreset } from './commands';
import type { HeyMelodyCatalogEntry } from './catalog.generated';

export type HeyMelodyCapability = 'battery' | 'anc' | 'eq';

export interface HeyMelodyInfo {
  /**
   * The catalog-resolved display name — what every other driver's state
   * calls `model`. Required by `core/manager.ts`'s `Adoptable.subscribe`
   * contract (it reads `state.info.model` generically to remember a device's
   * name for the port picker), not just a naming preference — see how
   * `device.ts`'s `#refreshAll` derives it from the catalog lookup.
   */
  model: string | null;
  productId: string | null;
  catalog: HeyMelodyCatalogEntry | null;
}

export interface HeyMelodyState {
  status: ConnectionStatus;
  error: string | null;
  info: HeyMelodyInfo;
  battery: BatteryCell[];
  ancSupportedModes: number[] | null;
  ancLevel: number | null;
  eqCurrentPreset: number | null;
  eqPresets: EqPreset[];
  /** Opportunistically probed — see spec §3.5 for why this replaces a bitmap parse. */
  capabilities: Set<HeyMelodyCapability>;
}

export const initialHeyMelodyState: HeyMelodyState = {
  status: 'disconnected',
  error: null,
  info: { model: null, productId: null, catalog: null },
  battery: [],
  ancSupportedModes: null,
  ancLevel: null,
  eqCurrentPreset: null,
  eqPresets: [],
  capabilities: new Set(),
};

// --- persistence -----------------------------------------------------------

export const HEYMELODY_SNAPSHOT_VERSION = 1;

export interface HeyMelodyDurableState {
  info: HeyMelodyInfo;
  ancSupportedModes: number[] | null;
  ancLevel: number | null;
  eqCurrentPreset: number | null;
  eqPresets: EqPreset[];
  /** A Set on the state; an array here, because JSON has no Set. */
  capabilities: HeyMelodyCapability[];
}

export const captureDurable = (state: HeyMelodyState): HeyMelodyDurableState => ({
  info: state.info,
  ancSupportedModes: state.ancSupportedModes,
  ancLevel: state.ancLevel,
  eqCurrentPreset: state.eqCurrentPreset,
  eqPresets: state.eqPresets,
  capabilities: [...state.capabilities],
});

export const applyDurable = (payload: object): Partial<HeyMelodyState> => {
  const snapshot = payload as HeyMelodyDurableState;
  return {
    info: snapshot.info,
    ancSupportedModes: snapshot.ancSupportedModes ?? null,
    ancLevel: snapshot.ancLevel ?? null,
    eqCurrentPreset: snapshot.eqCurrentPreset ?? null,
    eqPresets: snapshot.eqPresets ?? [],
    capabilities: new Set(snapshot.capabilities ?? []),
  };
};

// --- notification reduction --------------------------------------------------

/**
 * Folds an ANC push (`0x0204`) into state. Only `currentMode` events update
 * anything today — `reduction` and `intelligentMode` events are received and
 * decoded but have no surfaced setting yet (spec §2 non-goals), so they pass
 * through as a no-op rather than being silently mis-mapped onto a field they
 * do not describe. An unparseable payload also leaves state untouched.
 */
export function applyAncEvent(state: HeyMelodyState, payload: Uint8Array): HeyMelodyState {
  const event = decodeAncNotification(payload);
  if (!event || event.kind !== 'currentMode') return state;
  return {
    ...state,
    ancSupportedModes: event.supportedModes ?? state.ancSupportedModes,
    ancLevel: event.level ?? state.ancLevel,
  };
}
