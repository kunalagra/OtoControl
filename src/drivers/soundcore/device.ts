/**
 * Soundcore device orchestration.
 *
 * BLE GATT only — Soundcore earbuds expose no serial service, which is why
 * this driver became possible only alongside `core/gattTransport.ts`. The
 * connection target is therefore always a `BluetoothDevice`; the model comes
 * from its advertised name, since the wire protocol has no model query.
 *
 * Scope today: identity, battery, and the ANC/transparency/normal sound mode.
 * The protocol reaches further (custom 8-band EQ, hear-id, LDAC notify) — the
 * framing and client already carry payloads, so those are additions, not
 * rework.
 */

import * as C from './commands';
import type { ButtonState, DualBattery, SoundMode } from './commands';
import { SoundcoreClient } from './client';
import { frameDebugEnabled } from './client';
import type { NotificationListener } from './client';
import type { Persistable, SnapshotPayload } from '@/core/persistence';
import { isBluetoothTarget, isWebSerialSupported } from '@/core/transport';
import type { ConnectionTarget, Transport, TransportOpener } from '@/core/transport';
import { GattTransport, openGattTransport } from '@/core/gattTransport';
import { SOUNDCORE_PRODUCTS } from './products.generated';
import { DeviceSession } from '@/core/session';
import type { SessionHooks } from '@/core/session';
import { StateStore } from '@/core/stateStore';
import type { StateStoreHooks } from '@/core/stateStore';
import { describeError } from '@/core/errors';
import type { ConnectionStatus } from '@/core/connection';

/**
 * Soundcore's services live in a 256-UUID family, so the opener resolves the
 * first service the device exposes rather than naming one — the same
 * positional choice SoundcoreManager's web build makes.
 */
const openSoundcoreTransport: TransportOpener = (target, handlers) => {
  if (!isBluetoothTarget(target)) {
    return Promise.reject(new Error('Soundcore earbuds are reachable over Bluetooth LE only'));
  }
  return openGattTransport(target, handlers);
};

export interface SoundcoreInfo {
  model: string | null;
  firmware: string | null;
  serial: string | null;
  /** The Anker product code parsed out of the serial, e.g. "a3951". */
  productCode: string | null;
}

export interface SoundcoreEq {
  /** Preset id, or 0xFEFE when the device is on custom bands. */
  profile: number;
  /** Signed band gains (−120..120), left and right, when custom. */
  left: number[];
  right: number[];
}

export interface SoundcoreState {
  status: ConnectionStatus;
  error: string | null;
  info: SoundcoreInfo;
  battery: DualBattery | null;
  soundMode: SoundMode | null;
  eq: SoundcoreEq | null;
  /** Per-bud tap assignments; null until the first state read. */
  buttons: ButtonState[] | null;
  /** "Preferred audio quality" in the official app. Null until queried. */
  ldac: boolean | null;
  voicePrompt: boolean | null;
  touchTone: boolean | null;
  wearDetection: boolean | null;
  /** True once the device answered its first state request. */
  capabilities: Set<'state' | 'info' | 'soundMode' | 'eq' | 'ldac'>;
}

export const initialSoundcoreState: SoundcoreState = {
  status: 'disconnected',
  error: null,
  info: { model: null, firmware: null, serial: null, productCode: null },
  battery: null,
  soundMode: null,
  eq: null,
  buttons: null,
  ldac: null,
  voicePrompt: null,
  touchTone: null,
  wearDetection: null,
  capabilities: new Set(),
};

/** Bumped when the durable payload changes shape; older caches are dropped. */
export const SOUNDCORE_SNAPSHOT_VERSION = 1;

export interface SoundcoreDurableState {
  info: SoundcoreInfo;
  soundMode: SoundMode | null;
  eq: SoundcoreEq | null;
  wearDetection: boolean | null;
}

const captureDurable = (state: SoundcoreState): SoundcoreDurableState => ({
  info: state.info,
  soundMode: state.soundMode,
  eq: state.eq,
  wearDetection: state.wearDetection,
});

const applyDurable = (payload: object): Partial<SoundcoreState> => ({
  info: (payload as SoundcoreDurableState).info,
  soundMode: (payload as SoundcoreDurableState).soundMode ?? null,
  eq: (payload as SoundcoreDurableState).eq ?? null,
  wearDetection: (payload as SoundcoreDurableState).wearDetection ?? null,
});

type Listener = (state: SoundcoreState) => void;

const stateStoreHooks: StateStoreHooks<SoundcoreState> = {
  isUnread: (state) => state.info.model === null && state.info.serial === null,
  isConnected: (state) => state.status === 'connected',
  capture: captureDurable,
  apply: (_state, payload) => applyDurable(payload),
};

export class SoundcoreDevice implements Persistable {
  readonly #store: StateStore<SoundcoreState>;
  readonly #session: DeviceSession<SoundcoreClient>;
  #refreshing = false;

  constructor(openTransport: TransportOpener = openSoundcoreTransport) {
    this.#store = new StateStore(
      { ...initialSoundcoreState, status: isWebSerialSupported() ? 'disconnected' : 'unsupported' },
      stateStoreHooks,
    );

    const onNotification: NotificationListener = (frame) => this.#onNotification(frame);
    const hooks: SessionHooks<SoundcoreClient> = {
      createClient: (transport) => new SoundcoreClient(transport),
      handleData: (client, chunk) => client.handleData(chunk),
      wire: (client) => client.onNotification(onNotification),
      onStatus: (status, error) => this.#patch({ status, error }),
      onDrop: (reason) =>
        this.#patch({
          ...initialSoundcoreState,
          ...this.#lastKnownDurable(),
          status: 'disconnected',
          error: reason ? describeError(reason) : null,
        }),
      abort: (client, reason) => client.abort(reason),
    };
    this.#session = new DeviceSession(openTransport, hooks);
  }

  get state(): SoundcoreState {
    return this.#store.state;
  }

  // --- Persistable ----------------------------------------------------------

  readonly snapshotVersion = SOUNDCORE_SNAPSHOT_VERSION;

  snapshot(): SnapshotPayload | null {
    return this.#store.snapshot();
  }

  restore(payload: SnapshotPayload): void {
    this.#store.restore(payload);
  }

  subscribe(listener: Listener): () => void {
    return this.#store.subscribe(listener);
  }

  #patch(partial: Partial<SoundcoreState>): void {
    this.#store.patch(partial);
  }

  async adoptPort(target: ConnectionTarget): Promise<void> {
    // The Bluetooth name is the only model identification this protocol has.
    if (isBluetoothTarget(target) && target.name) {
      this.#patch({ info: { ...this.#store.state.info, model: target.name } });
    }
    try {
      await this.#session.connectTo(target, async () => {
        await this.refresh();
      });
    } catch (error) {
      this.#patch({ status: 'disconnected', error: describeError(error) });
    }
  }

  /** The single-connection BLE adopt — see `NothingDevice.adoptTransport`. */
  async adoptTransport(transport: Transport): Promise<void> {
    if (transport instanceof GattTransport && transport.device.name) {
      this.#patch({ info: { ...this.#store.state.info, model: transport.device.name } });
    }
    if (transport instanceof GattTransport) this.#watchAdvertisements(transport.device);
    try {
      await this.#session.adoptTransport(transport, async () => {
        await this.refresh();
      });
    } catch (error) {
      this.#patch({ status: 'disconnected', error: describeError(error) });
    }
  }

  /**
   * Battery truth-finding, gated behind the debug-frames flag.
   *
   * The state response and the `01 03`/`01 04` pushes are the battery feed
   * (six steps per side, see `batteryStepToPercent`). This watcher is for the
   * finer-grained reading the official app shows: its levels come from the
   * BLE advertisement, which Android reads with no protocol exchange at all.
   * Watching advertisements while connected logs any manufacturer data,
   * whose layout we can then line up against the app's reading.
   */
  #watchAdvertisements(device: BluetoothDevice): void {
    if (!frameDebugEnabled() || typeof device.watchAdvertisements !== 'function') return;
    void device
      .watchAdvertisements()
      .then(() => console.info('[soundcore] watching advertisements for battery data'))
      .catch((error: Error) => console.info('[soundcore] cannot watch advertisements', error));
    device.addEventListener('advertisementreceived', (event) => {
      const data = event.manufacturerData;
      if (!data || data.size === 0) return;
      for (const [company, value] of data) {
        const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
        console.info(`[soundcore adv] company=0x${company.toString(16)} ${hex}`);
      }
    });
  }

  /**
   * Applies an unsolicited state change. Soundcore pushes the sound mode as
   * `06 01` after every write, battery levels and charging flags as `01 03`
   * / `01 04` whenever they move, and the full state as `01 01` when the
   * device settles.
   */
  #onNotification(frame: { kind: number; payload: Uint8Array }): void {
    try {
      switch (frame.kind) {
        case C.Kind.SoundModeUpdate: {
          const mode = C.decodeSoundMode(frame.payload);
          if (mode) this.#patch({ soundMode: mode });
          break;
        }
        case C.Kind.StateUpdate: {
          const reading = C.decodeState(frame.payload);
          if (reading) {
            this.#patch({
              battery: reading.battery,
              buttons: reading.buttons,
              touchTone: reading.touchTone,
              wearDetection: reading.wearDetection,
              ...(reading.soundMode ? { soundMode: reading.soundMode } : {}),
              ...(reading.eqProfile !== null ? { eq: this.#eqFromReading(reading) } : {}),
            });
          }
          break;
        }
        case C.Kind.LdacState: {
          if (frame.payload.length >= 1) {
            this.#patch({ ldac: frame.payload[0] !== 0 });
          }
          break;
        }
        case C.Kind.VoicePromptUpdate: {
          if (frame.payload.length >= 1) {
            this.#patch({ voicePrompt: frame.payload[0] !== 0 });
          }
          break;
        }
        case C.Kind.BatteryLevel:
        case C.Kind.BatteryCharging: {
          // Battery moves far more often than the device bothers pushing a
          // full state — these two are the live feed. Each restates only its
          // own half, so the other half comes from whatever was last known.
          const current = this.#store.state.battery ?? {
            left: { level: null, charging: false },
            right: { level: null, charging: false },
          };
          const levels =
            frame.kind === C.Kind.BatteryLevel ? C.decodeBatteryLevels(frame.payload) : null;
          const charging =
            frame.kind === C.Kind.BatteryCharging ? C.decodeBatteryCharging(frame.payload) : null;
          if (!levels && !charging) break;
          this.#patch({
            battery: {
              left: {
                level: levels ? levels.left : current.left.level,
                charging: charging ? charging.left : current.left.charging,
              },
              right: {
                level: levels ? levels.right : current.right.level,
                charging: charging ? charging.right : current.right.charging,
              },
            },
          });
          break;
        }
        case C.Kind.EqInfoUpdate: {
          // The device announces preset switches itself (app or touch).
          const profile = C.decodeEqInfo(frame.payload);
          if (profile !== null && this.#store.state.eq) {
            this.#patch({ eq: { ...this.#store.state.eq, profile } });
          }
          break;
        }
        default:
          break;
      }
    } catch (error) {
      console.warn('[soundcore] could not decode a notification', error);
    }
  }

  async refresh(): Promise<void> {
    const client = this.#session.client;
    if (!client || this.#refreshing) return;
    this.#refreshing = true;
    try {
      type Capability = 'state' | 'info' | 'ldac';
      const capabilities = new Set<Capability>();
      const probe = async (capability: Capability, run: () => Promise<void>) => {
        try {
          await run();
          capabilities.add(capability);
        } catch (error) {
          console.info(`[soundcore] ${capability} unavailable`, error);
        }
      };

      await probe('state', async () => {
        const payload = await client.request(C.Command.RequestState, C.Kind.StateUpdate);
        const reading = C.decodeState(payload);
        if (reading) {
          this.#patch({
            battery: reading.battery,
            buttons: reading.buttons,
            touchTone: reading.touchTone,
            wearDetection: reading.wearDetection,
            ...(reading.soundMode ? { soundMode: reading.soundMode } : {}),
            ...(reading.eqProfile !== null ? { eq: this.#eqFromReading(reading) } : {}),
          });
          this.#markCapability('state');
        }
      });

      await probe('info', async () => {
        const payload = await client.request(C.Command.RequestInfo, C.Kind.InfoUpdate);
        const info = C.decodeInfo(payload);
        if (info) {
          // The serial's first four hex digits are the Anker product code —
          // the one model identification this protocol offers.
          const productCode = C.productCodeFromSerial(info.serial);
          const named = productCode ? SOUNDCORE_PRODUCTS[productCode] : undefined;
          this.#patch({
            info: {
              ...this.#store.state.info,
              firmware: info.firmware.join(' / '),
              serial: info.serial,
              productCode,
              model: named ?? this.#store.state.info.model,
            },
          });
        }
      });

      await probe('ldac', async () => {
        const payload = await client.request(C.Command.RequestLdacState, C.Kind.LdacState);
        if (payload.length >= 1) this.#patch({ ldac: payload[0] !== 0 });
      });

      this.#patch({ capabilities });
    } finally {
      this.#refreshing = false;
    }
  }

  // --- writes ---------------------------------------------------------------

  /**
   * Applies part of a sound-mode change, restating the whole four-byte mode
   * as the protocol requires. The device confirms with a `06 01` push.
   */
  async setSoundMode(patch: Partial<SoundMode>): Promise<void> {
    const client = this.#session.client;
    const previous = this.#store.state.soundMode;
    if (!client) return;

    // A reasonable whole mode even before the first notification arrives.
    const base: SoundMode = previous ?? {
      current: C.CurrentMode.Normal,
      ancScene: C.AncScene.Outdoor,
      transparency: C.TransparencyMode.FullyTransparent,
      custom: 0,
    };
    const next = { ...base, ...patch };

    this.#patch({ soundMode: next });
    try {
      await client.request(C.Command.SetSoundMode, C.Kind.SetSoundModeAck, C.encodeSoundMode(next));
      const capabilities = new Set(this.#store.state.capabilities);
      capabilities.add('soundMode');
      this.#patch({ capabilities });
    } catch (error) {
      this.#patch({ soundMode: previous, error: describeError(error) });
    }
  }

  /**
   * Switches to one of the device's own presets. The curve arrives with the
   * next state read; the optimistic patch uses the table's copy of it.
   */
  async setEqPreset(presetId: number): Promise<void> {
    const client = this.#session.client;
    const previous = this.#store.state.eq;
    if (!client) return;

    const preset = C.EQ_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const next: SoundcoreEq = { profile: presetId, left: [...preset.curve], right: [...preset.curve] };

    this.#patch({ eq: next });
    try {
      await client.request(
        C.Command.SetEq,
        C.Kind.SetEqAck,
        C.encodeEqUpdate(presetId, preset.curve, preset.curve),
      );
      this.#markCapability('eq');
    } catch (error) {
      this.#patch({ eq: previous, error: describeError(error) });
    }
  }

  /**
   * Applies custom band gains for both ears in one write — the protocol
   * restates the full stereo curve, so a linked edit sends the same curve
   * twice and a per-ear edit restates the untouched side unchanged.
   */
  async setEqCustom(left: number[], right: number[]): Promise<void> {
    const client = this.#session.client;
    const previous = this.#store.state.eq;
    if (!client || !previous) return;

    const next: SoundcoreEq = { profile: C.EQ_CUSTOM_ID, left, right };

    this.#patch({ eq: next });
    try {
      await client.request(C.Command.SetEq, C.Kind.SetEqAck, C.encodeEqUpdate(C.EQ_CUSTOM_ID, left, right));
      this.#markCapability('eq');
    } catch (error) {
      this.#patch({ eq: previous, error: describeError(error) });
    }
  }

  /**
   * One boolean flag write, shared by every on/off setting: the device
   * acknowledges by echoing the command kind back, and the state push that
   * follows (where one exists) confirms the value.
   */
  async #setFlag(
    command: readonly number[],
    ackKind: number,
    field: 'wearDetection' | 'touchTone' | 'voicePrompt' | 'ldac',
    value: boolean,
  ): Promise<void> {
    const client = this.#session.client;
    const previous = this.#store.state[field];
    if (!client) return;

    this.#patch({ [field]: value } as Partial<SoundcoreState>);
    try {
      await client.request(command, ackKind, C.flagPayload(value));
      this.#markCapability('state');
    } catch (error) {
      this.#patch({ [field]: previous } as Partial<SoundcoreState>);
      this.#patch({ error: describeError(error) });
    }
  }

  /** Wear detection — auto-pause when a bud is removed. */
  setWearDetection(on: boolean): Promise<void> {
    return this.#setFlag(C.Command.SetWearDetection, C.Kind.SetWearDetectionAck, 'wearDetection', on);
  }

  /** The beep each tap plays. */
  setTouchTone(on: boolean): Promise<void> {
    return this.#setFlag(C.Command.SetTouchTone, C.Kind.SetTouchToneAck, 'touchTone', on);
  }

  /** The spoken prompts ("connected", battery level, …). */
  setVoicePrompt(on: boolean): Promise<void> {
    return this.#setFlag(C.Command.SetVoicePrompt, C.Kind.SetVoicePromptAck, 'voicePrompt', on);
  }

  /**
   * LDAC — the official app's "preferred audio quality". Only meaningful on
   * a phone that negotiates LDAC; over this link it is just the stored flag.
   */
  setLdac(on: boolean): Promise<void> {
    return this.#setFlag(C.Command.SetLdac, C.Kind.SetLdacAck, 'ldac', on);
  }

  /**
   * Reassigns both actions of one gesture. The single-tap slot has no TWS
   * split on the wire, so its two values must already agree.
   */
  async setButtonAction(
    side: C.ButtonSideId,
    gesture: C.GestureId,
    twsAction: number,
    soloAction: number,
  ): Promise<void> {
    const client = this.#session.client;
    const previous = this.#store.state.buttons;
    if (!client) return;

    const next = (previous ?? []).map((button) =>
      button.side === side && button.gesture === gesture
        ? { ...button, twsAction, soloAction }
        : button,
    );
    this.#patch({ buttons: next });
    try {
      await client.request(
        C.Command.SetButtonAction,
        C.Kind.ButtonActionAck,
        C.encodeButtonAction(side, gesture, twsAction, soloAction),
      );
      this.#markCapability('state');
    } catch (error) {
      this.#patch({ buttons: previous });
      this.#patch({ error: describeError(error) });
    }
  }

  /** Enables or disables one gesture on one bud. */
  async setButtonEnabled(side: C.ButtonSideId, gesture: C.GestureId, enabled: boolean): Promise<void> {
    const client = this.#session.client;
    const previous = this.#store.state.buttons;
    if (!client) return;

    const next = (previous ?? []).map((button) =>
      button.side === side && button.gesture === gesture ? { ...button, enabled } : button,
    );
    this.#patch({ buttons: next });
    try {
      await client.request(
        C.Command.SetButtonEnabled,
        C.Kind.ButtonEnabledAck,
        C.encodeButtonEnabled(side, gesture, enabled),
      );
      this.#markCapability('state');
    } catch (error) {
      this.#patch({ buttons: previous });
      this.#patch({ error: describeError(error) });
    }
  }

  /** Restores every gesture to the factory assignment; the next state read refreshes the UI. */
  async resetButtons(): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    try {
      await client.request(C.Command.ResetButtons, C.Kind.ResetButtonsAck);
      const payload = await client.request(C.Command.RequestState, C.Kind.StateUpdate);
      const reading = C.decodeState(payload);
      if (reading?.buttons) this.#patch({ buttons: reading.buttons });
    } catch (error) {
      this.#patch({ error: describeError(error) });
    }
  }

  /** The state response's EQ fields, decoded into signed gains. */
  #eqFromReading(reading: C.SoundcoreStateReading): SoundcoreEq {
    const signed = (bytes: number[]) => bytes.map(C.bandToSigned);
    const preset = reading.eqProfile !== null && reading.eqProfile !== C.EQ_CUSTOM_ID
      ? C.EQ_PRESETS.find((p) => p.id === reading.eqProfile)
      : undefined;
    return {
      profile: reading.eqProfile ?? C.EQ_CUSTOM_ID,
      left: reading.eqLeft ? signed(reading.eqLeft) : [...(preset?.curve ?? [])],
      right: reading.eqRight ? signed(reading.eqRight) : [...(preset?.curve ?? [])],
    };
  }

  #markCapability(capability: 'state' | 'info' | 'soundMode' | 'eq' | 'ldac'): void {
    const capabilities = new Set(this.#store.state.capabilities);
    capabilities.add(capability);
    this.#patch({ capabilities });
  }

  async disconnect(): Promise<void> {
    const durable = this.#lastKnownDurable();
    const closed = this.#session.disconnect();
    this.#patch({ ...initialSoundcoreState, ...durable, status: 'disconnected' });
    await closed;
  }

  /**
   * Identity and settings worth carrying across a disconnect, so the sidebar
   * keeps naming the device and rendering its artwork instead of collapsing
   * to the generic "no device" placeholder the instant the link drops.
   *
   * Reuses the exact same durable slice `Persistable` caches to local
   * storage — the split between what survives a disconnect and what does not
   * is one decision, not two, and `applyDurable` already encodes it. Empty
   * once nothing has ever been read, matching `StateStore.snapshot`'s own
   * gate: a device we never identified has nothing worth keeping.
   */
  #lastKnownDurable(): Partial<SoundcoreState> {
    const durable = this.#store.snapshot();
    return durable ? applyDurable(durable) : {};
  }
}
