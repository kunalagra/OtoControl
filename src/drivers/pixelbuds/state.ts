/**
 * Pixel Buds device state and the pure reduction of a `SettingsRsp`.
 *
 * Durable/live split follows the convention every driver in this repo uses:
 * identity and settings survive a disconnect (`captureDurable`/`applyDurable`,
 * see `core/persistence.ts` and `core/stateStore.ts`); battery, placement and
 * connection status do not.
 */

import type { ConnectionStatus } from '@/core/connection';
import { AncState, SettingId } from './maestro';
import type { AncLoop, AncMode, BatteryCell, EqGains, FirmwareVersions, Placement, SerialNumbers, SettingChange } from './maestro';

/** What a connected pair has answered for, so a tab is only shown for something the buds really have. */
export type PixelBudsCapability = 'firmware' | 'battery' | 'anc' | 'multipoint' | 'onHead' | 'eq' | 'volumeEq';

export interface PixelBudsInfo {
  /**
   * Required by `core/manager.ts`'s `Adoptable.subscribe` contract, which reads
   * `state.info.model` generically to remember a device's name. Generic on
   * purpose: nothing on the wire tells a Pixel Buds Pro from a Pro 2 (spec §6).
   */
  model: string | null;
  firmware: FirmwareVersions | null;
  serials: SerialNumbers | null;
}

export interface PixelBudsState {
  status: ConnectionStatus;
  error: string | null;
  info: PixelBudsInfo;
  /** Live-only: whichever of case/left/right the buds reported last. */
  battery: BatteryCell[];
  /** Live-only. */
  placement: Placement | null;
  ancMode: AncMode | null;
  /** Which modes a long press cycles through. Doubles as a hint for whether Adaptive exists. */
  ancLoop: AncLoop | null;
  /** The buds refused a write of Adaptive this session, so it is not offered again. Live-only. */
  adaptiveRefused: boolean;
  multipoint: boolean | null;
  onHeadDetection: boolean | null;
  eq: EqGains | null;
  volumeEq: boolean | null;
  capabilities: Set<PixelBudsCapability>;
  /** The Maestro channel the buds answered on, and whether finding it needed the unverified probe. Live-only. */
  channel: number | null;
  channelProbed: boolean;
}

export const initialPixelBudsState: PixelBudsState = {
  status: 'disconnected',
  error: null,
  info: { model: null, firmware: null, serials: null },
  battery: [],
  placement: null,
  ancMode: null,
  ancLoop: null,
  adaptiveRefused: false,
  multipoint: null,
  onHeadDetection: null,
  eq: null,
  volumeEq: null,
  capabilities: new Set(),
  channel: null,
  channelProbed: false,
};

// --- persistence -----------------------------------------------------------

export const PIXELBUDS_SNAPSHOT_VERSION = 1;

export interface PixelBudsDurableState {
  info: PixelBudsInfo;
  ancMode: AncMode | null;
  ancLoop: AncLoop | null;
  multipoint: boolean | null;
  onHeadDetection: boolean | null;
  eq: EqGains | null;
  volumeEq: boolean | null;
  /** A Set on the state; an array here, because JSON has no Set. */
  capabilities: PixelBudsCapability[];
}

export const captureDurable = (state: PixelBudsState): PixelBudsDurableState => ({
  info: state.info,
  ancMode: state.ancMode,
  ancLoop: state.ancLoop,
  multipoint: state.multipoint,
  onHeadDetection: state.onHeadDetection,
  eq: state.eq,
  volumeEq: state.volumeEq,
  capabilities: [...state.capabilities],
});

export const applyDurable = (payload: object): Partial<PixelBudsState> => {
  const snapshot = payload as Partial<PixelBudsDurableState>;
  return {
    info: {
      model: snapshot.info?.model ?? null,
      firmware: snapshot.info?.firmware ?? null,
      serials: snapshot.info?.serials ?? null,
    },
    ancMode: snapshot.ancMode ?? null,
    ancLoop: snapshot.ancLoop ?? null,
    multipoint: snapshot.multipoint ?? null,
    onHeadDetection: snapshot.onHeadDetection ?? null,
    eq: snapshot.eq ?? null,
    volumeEq: snapshot.volumeEq ?? null,
    capabilities: new Set(snapshot.capabilities ?? []),
  };
};

// --- settings reduction --------------------------------------------------------

/** The capability each setting stands for. */
export const CAPABILITY_FOR_SETTING: Partial<Record<number, PixelBudsCapability>> = {
  [SettingId.AncState]: 'anc',
  [SettingId.Multipoint]: 'multipoint',
  [SettingId.OnHeadDetection]: 'onHead',
  [SettingId.UserEq]: 'eq',
  [SettingId.VolumeEq]: 'volumeEq',
};

/**
 * Folds one setting value into state — a read reply and a pushed change are the same message.
 * An ANC value outside the enum leaves the mode untouched rather than claiming one.
 */
export function applySetting(state: PixelBudsState, change: SettingChange): PixelBudsState {
  switch (change.setting) {
    case SettingId.AncState:
      return change.value === null ? state : { ...state, ancMode: change.value };
    case SettingId.AncLoop:
      return { ...state, ancLoop: change.value };
    case SettingId.Multipoint:
      return { ...state, multipoint: change.value };
    case SettingId.OnHeadDetection:
      return { ...state, onHeadDetection: change.value };
    case SettingId.VolumeEq:
      return { ...state, volumeEq: change.value };
    case SettingId.UserEq:
      return { ...state, eq: change.value };
  }
}

/** Whether the Noise tab should list Adaptive: never twice-refused, and not when the loop is known to lack it. */
export function offersAdaptive(state: Pick<PixelBudsState, 'ancMode' | 'ancLoop' | 'adaptiveRefused'>): boolean {
  if (state.ancMode === AncState.Adaptive) return true;
  if (state.adaptiveRefused) return false;
  return state.ancLoop === null || state.ancLoop.adaptive;
}
