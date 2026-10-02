/**
 * Xiaomi earbud state, and what survives a disconnect.
 *
 * The split follows every driver here: identity and settings are durable
 * (`captureDurable` / `applyDurable`, see `core/persistence.ts`), while battery,
 * the handshake outcome and a ringing find are live-only.
 */

import type { ConnectionStatus } from '@/core/connection';
import type { AncModeValue, BatteryCell, CustomEq, GestureRecord } from './commands';

/** What the earbuds were seen to support. Probed, not assumed — see `device.ts`. */
export type XiaomiCapability = 'version' | 'battery' | 'anc' | 'strength' | 'eq' | 'customEq' | 'wear' | 'find' | 'gestures';

export interface XiaomiInfo {
  /**
   * The catalog name, else the name the earbuds report. Named `model` because
   * `core/manager.ts` reads `state.info.model` generically off every driver.
   */
  model: string | null;
  /** The Bluetooth name from the `GetInfo` reply, whatever the catalog says. */
  btName: string | null;
  vid: number | null;
  pid: number | null;
  /** One version per byte pair of the firmware record. */
  firmware: string[];
  /** The unit's colour id (`GetInfo` TLV 13), which picks its product render. */
  colour: number | null;
}

/**
 * How the auth handshake ended; a tester reads this from the System tab.
 * `complete`: the earbuds' own confirm arrived. `partial`: they answered ours but
 * sent no confirm. `skipped`: they took no part.
 */
export type HandshakeOutcome = 'complete' | 'partial' | 'skipped';

export interface XiaomiState {
  status: ConnectionStatus;
  error: string | null;
  info: XiaomiInfo;
  /** Live-only. */
  battery: BatteryCell[];
  /** Null until a reply or push has said. */
  ancMode: AncModeValue | null;
  ncStrength: number | null;
  transparencyStrength: number | null;
  eqPreset: number | null;
  /** True when in-ear detection is on. */
  wearDetection: boolean | null;
  /** The gesture table, one record per tap code the earbuds listed. Live-only: re-read on connect. */
  gestures: GestureRecord[];
  /** Long-press noise-control cycle bitmasks, `[left, right]`. Live-only. */
  longPressCycle: [number, number] | null;
  /** The custom EQ curve as last read back. Live-only. */
  customEq: CustomEq | null;
  /** Live-only: find-my-earbuds is ringing. */
  finding: boolean;
  capabilities: Set<XiaomiCapability>;
  /** Live-only; null before a connect has run the handshake. */
  handshake: HandshakeOutcome | null;
}

export const initialXiaomiState: XiaomiState = {
  status: 'disconnected',
  error: null,
  info: { model: null, btName: null, vid: null, pid: null, firmware: [], colour: null },
  battery: [],
  ancMode: null,
  ncStrength: null,
  transparencyStrength: null,
  eqPreset: null,
  wearDetection: null,
  gestures: [],
  longPressCycle: null,
  customEq: null,
  finding: false,
  capabilities: new Set(),
  handshake: null,
};

// --- persistence -----------------------------------------------------------

export const XIAOMI_SNAPSHOT_VERSION = 1;

export interface XiaomiDurableState {
  info: XiaomiInfo;
  ancMode: AncModeValue | null;
  ncStrength: number | null;
  transparencyStrength: number | null;
  eqPreset: number | null;
  wearDetection: boolean | null;
  /** A Set on the state; an array here, because JSON has no Set. */
  capabilities: XiaomiCapability[];
}

export const captureDurable = (state: XiaomiState): XiaomiDurableState => ({
  info: state.info,
  ancMode: state.ancMode,
  ncStrength: state.ncStrength,
  transparencyStrength: state.transparencyStrength,
  eqPreset: state.eqPreset,
  wearDetection: state.wearDetection,
  capabilities: [...state.capabilities],
});

export const applyDurable = (payload: object): Partial<XiaomiState> => {
  const snapshot = payload as Partial<XiaomiDurableState>;
  return {
    info: { ...initialXiaomiState.info, ...snapshot.info },
    ancMode: snapshot.ancMode ?? null,
    ncStrength: snapshot.ncStrength ?? null,
    transparencyStrength: snapshot.transparencyStrength ?? null,
    eqPreset: snapshot.eqPreset ?? null,
    wearDetection: snapshot.wearDetection ?? null,
    capabilities: new Set(snapshot.capabilities ?? []),
  };
};
