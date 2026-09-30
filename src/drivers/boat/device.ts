/**
 * Boat (Bluetrum) device orchestration.
 *
 * Serial SPP only — Bluetrum earbuds expose no GATT control service, and
 * identity comes off the wire (`INFO_BLUETOOTH_NAME = 3`) rather than the
 * port, so `adoptPort` takes any serial target and `refresh` resolves the
 * model through the catalog. A non-`BLUETRUM_SDK` match — or a port that
 * never answers the identity poll — is released with `NOT_BOAT_ERROR`
 * rather than held, so auto-connect can move on (the HeyMelody pattern).
 *
 * One `refresh` is one batch: the default 34-id `DeviceInfoRequest.d` poll
 * (cmd 39), whose `[id][len][value]` reply is the whole state. Capability
 * is the union of the device-reported `-2` bitmask and the ids actually
 * present in the reply.
 */

import * as C from './commands';
import { BoatClient } from './client';
import type { BluetrumFrame } from './bluetrumFrame';
import { isBluetrumProduct, lookupBoatProduct } from './catalog';
import type { Persistable, SnapshotPayload } from '@/core/persistence';
import { isBluetoothTarget, isWebSerialSupported, openSerialTransport } from '@/core/transport';
import type { ConnectionTarget, TransportOpener } from '@/core/transport';
import { DeviceSession } from '@/core/session';
import type { SessionHooks } from '@/core/session';
import { StateStore } from '@/core/stateStore';
import type { StateStoreHooks } from '@/core/stateStore';
import { describeError } from '@/core/errors';
import type { ConnectionStatus } from '@/core/connection';

export const NOT_BOAT_ERROR = 'This does not look like a Boat Bluetrum device.';

export type BoatCapability =
  | 'battery'
  | 'anc'
  | 'eq'
  | 'keys'
  | 'multipoint'
  | 'findDevice'
  | 'inEar'
  | 'volume';

export interface BoatInfo {
  model: string | null;
  bleName: string | null;
  sdkType: string | null;
  firmware: string | null;
}

export interface BoatKey {
  type: number;
  fn: number;
}

export interface BoatState {
  status: ConnectionStatus;
  error: string | null;
  info: BoatInfo;
  battery: C.DeviceBattery | null;
  ancMode: number | null;
  eq: C.EqSetting | null;
  keys: BoatKey[] | null;
  peers: C.MultipointPeer[] | null;
  inEar: boolean | null;
  volume: number | null;
  capabilities: Set<BoatCapability>;
}

export const initialBoatState: BoatState = {
  status: 'disconnected',
  error: null,
  info: { model: null, bleName: null, sdkType: null, firmware: null },
  battery: null,
  ancMode: null,
  eq: null,
  keys: null,
  peers: null,
  inEar: null,
  volume: null,
  capabilities: new Set(),
};

/** Bumped when the durable payload changes shape; older caches are dropped. */
export const BOAT_SNAPSHOT_VERSION = 1;

export interface BoatDurableState {
  info: BoatInfo;
  ancMode: number | null;
  eq: C.EqSetting | null;
}

const captureDurable = (state: BoatState): BoatDurableState => ({
  info: state.info,
  ancMode: state.ancMode,
  eq: state.eq,
});

const applyDurable = (payload: object): Partial<BoatState> => ({
  info: (payload as BoatDurableState).info,
  ancMode: (payload as BoatDurableState).ancMode ?? null,
  eq: (payload as BoatDurableState).eq ?? null,
});

type Listener = (state: BoatState) => void;

const stateStoreHooks: StateStoreHooks<BoatState> = {
  isUnread: (state) => state.info.model === null,
  isConnected: (state) => state.status === 'connected',
  capture: captureDurable,
  apply: (_state, payload) => applyDurable(payload),
};

export interface BoatDeviceOptions {
  /** Injected so tests do not pay `DEFAULT_TIMEOUT_MS` per unanswered poll. */
  timeoutMs?: number;
}

const ascii = (value: Uint8Array): string =>
  Array.from(value, (b) => String.fromCharCode(b & 0xff)).join('');

export class BoatDevice implements Persistable {
  readonly #store: StateStore<BoatState>;
  readonly #session: DeviceSession<BoatClient>;
  readonly #timeoutMs?: number;
  #refreshing = false;

  constructor(openTransport: TransportOpener = openSerialTransport, options: BoatDeviceOptions = {}) {
    this.#timeoutMs = options.timeoutMs;
    this.#store = new StateStore(
      { ...initialBoatState, status: isWebSerialSupported() ? 'disconnected' : 'unsupported' },
      stateStoreHooks,
    );

    const hooks: SessionHooks<BoatClient> = {
      createClient: (transport) => new BoatClient(transport, { timeoutMs: this.#timeoutMs }),
      handleData: (client, chunk) => client.handleData(chunk),
      wire: (client) => {
        client.onNotification((frame) => this.#onNotification(frame));
      },
      onStatus: (status, error) => this.#patch({ status, error }),
      onDrop: (reason) =>
        this.#patch({
          ...initialBoatState,
          ...this.#lastKnownDurable(),
          status: 'disconnected',
          error: reason ? describeError(reason) : null,
        }),
      abort: (client, reason) => client.abort(reason),
    };
    this.#session = new DeviceSession(openTransport, hooks);
  }

  get state(): BoatState {
    return this.#store.state;
  }

  // --- Persistable ----------------------------------------------------------

  readonly snapshotVersion = BOAT_SNAPSHOT_VERSION;

  snapshot(): SnapshotPayload | null {
    return this.#store.snapshot();
  }

  restore(payload: SnapshotPayload): void {
    this.#store.restore(payload);
  }

  subscribe(listener: Listener): () => void {
    return this.#store.subscribe(listener);
  }

  #patch(partial: Partial<BoatState>): void {
    this.#store.patch(partial);
  }

  #lastKnownDurable(): Partial<BoatState> {
    const durable = this.#store.snapshot();
    return durable ? applyDurable(durable) : {};
  }

  // --- connect ---------------------------------------------------------------

  async adoptPort(target: ConnectionTarget): Promise<void> {
    if (isBluetoothTarget(target)) {
      this.#patch({ status: 'disconnected', error: 'BLE GATT is not implemented for Boat yet.' });
      return;
    }
    try {
      await this.#session.connectTo(target, async () => {
        await this.refresh();
      });
    } catch (error) {
      this.#patch({ status: 'disconnected', error: describeError(error) });
    }
  }

  #onNotification(frame: BluetrumFrame): void {
    // Batch pushes (cmd 40, or a type-3 cmd-39 echo) carry [id][len][value]
    // records; anything else is a per-command push this driver ignores.
    if (frame.cmd !== C.Cmd.Notify && frame.cmd !== C.Cmd.DeviceInfo) return;
    try {
      this.#applyBatch(C.decodeInfoBatch(frame.payload), { identity: false });
    } catch (error) {
      console.debug('[boat] unreadable push', error);
    }
  }

  // --- refresh -----------------------------------------------------------------

  async refresh(): Promise<void> {
    const client = this.#session.client;
    if (!client || this.#refreshing) return;
    this.#refreshing = true;
    try {
      const payload = await client.request(
        C.Cmd.DeviceInfo,
        Array.from(C.encodeDeviceInfoQuery(C.DEVICE_INFO_DEFAULT_IDS)),
        { timeoutMs: this.#timeoutMs },
      );
      if (this.#session.client !== client) return;
      const found = this.#applyBatch(C.decodeInfoBatch(payload), { identity: true });
      if (this.#session.client !== client) return;
      if (!found) {
        await this.disconnect();
        this.#patch({ error: NOT_BOAT_ERROR });
        return;
      }
    } catch (error) {
      if (this.#session.client !== client) return;
      await this.disconnect();
      this.#patch({ error: error instanceof NonBluetrumError ? error.message : NOT_BOAT_ERROR });
    } finally {
      this.#refreshing = false;
    }
  }

  /**
   * Folds one batch reply into state. Returns false when the reply carried
   * no recognisable Bluetrum record at all — the handshake-failure signal.
   * With `identity`, the `INFO_BLUETOOTH_NAME` record also resolves (and
   * gates on) the catalog model; pushes never rename the device.
   */
  #applyBatch(
    entries: Array<{ id: number; value: Uint8Array }>,
    options: { identity: boolean },
  ): boolean {
    const client = this.#session.client;
    let found = false;
    const capabilities = new Set(this.#store.state.capabilities);
    const mark = (cap: BoatCapability): void => {
      capabilities.add(cap);
    };

    for (const { id, value } of entries) {
      switch (id) {
        case C.Info.MaxPacketSize:
          if (value.length >= 1 && client) client.setMaxPayload(value[0] & 0xff);
          found = true;
          break;
        case C.Info.Capabilities: {
          const caps = C.decodeCapabilities(value);
          if (caps) {
            found = true;
            if (caps.anc) mark('anc');
            if (caps.multipoint) mark('multipoint');
          }
          break;
        }
        case C.Info.Power: {
          const battery = C.decodeBattery(value);
          if (battery) {
            this.#patch({ battery });
            mark('battery');
            found = true;
          }
          break;
        }
        case C.Info.BluetoothName: {
          const bleName = ascii(value);
          if (options.identity && bleName.length > 0) {
            const product = lookupBoatProduct(bleName);
            if (product && !isBluetrumProduct(product)) {
              throw new NonBluetrumError(product.sdkType);
            }
            this.#patch({
              info: {
                ...this.#store.state.info,
                bleName,
                model: product?.name ?? bleName,
                sdkType: product?.sdkType ?? null,
              },
            });
            found = true;
          }
          break;
        }
        case C.Info.FirmwareVersion:
          this.#patch({ info: { ...this.#store.state.info, firmware: ascii(value) } });
          found = true;
          break;
        case C.Info.EqSetting: {
          const eq = C.decodeEqCurrent(value);
          if (eq) {
            this.#patch({ eq });
            mark('eq');
            found = true;
          }
          break;
        }
        case C.Info.KeySettings: {
          const keys = [...C.decodeKeys(value)].map(([type, fn]) => ({ type, fn }));
          this.#patch({ keys });
          mark('keys');
          found = true;
          break;
        }
        case C.Info.AncMode: {
          const mode = C.decodeByte(value);
          if (mode !== null) {
            this.#patch({ ancMode: mode });
            mark('anc');
            found = true;
          }
          break;
        }
        case C.Info.Volume: {
          const volume = C.decodeByte(value);
          if (volume !== null) {
            this.#patch({ volume });
            mark('volume');
            found = true;
          }
          break;
        }
        case C.Info.InEarStatus: {
          const inEar = C.decodeBoolean(value);
          if (inEar !== null) {
            this.#patch({ inEar });
            mark('inEar');
            found = true;
          }
          break;
        }
        case C.Info.MultipointStatus: {
          mark('multipoint');
          found = true;
          break;
        }
        case C.Info.MultipointInfo: {
          const peers = C.decodeMultipoint(value);
          if (peers) {
            this.#patch({ peers });
            mark('multipoint');
            found = true;
          }
          break;
        }
        default:
          break;
      }
    }

    if (found) {
      // The find-device setter exists on every Bluetrum model — once the
      // batch proves the stack, the capability is proven with it.
      mark('findDevice');
      this.#patch({ capabilities });
    }
    return found;
  }

  // --- writes ------------------------------------------------------------------

  /** ANC mode (cmd 53 tag 1): optimistic, rolled back on failure. */
  async setAncMode(mode: number): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    const previous = this.#store.state.ancMode;
    this.#patch({ ancMode: mode });
    try {
      await client.request(C.Cmd.Anc, Array.from(C.encodeAncMode(mode)), { timeoutMs: this.#timeoutMs });
    } catch (error) {
      this.#patch({ ancMode: previous, error: describeError(error) });
    }
  }

  /** EQ preset or custom curve (cmd 32 `[10][mode][gains]`). */
  async setEq(mode: number, gains: readonly number[], custom = false): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    const previous = this.#store.state.eq;
    const next: C.EqSetting = { mode, gains: [...gains], custom };
    this.#patch({ eq: next });
    try {
      await client.request(C.Cmd.Eq, Array.from(C.encodeEqPreset(mode, gains, custom)), {
        timeoutMs: this.#timeoutMs,
      });
    } catch (error) {
      this.#patch({ eq: previous, error: describeError(error) });
    }
  }

  /** One gesture remap (cmd 34 TLV `[keyType][fn]`). */
  async setKey(keyType: number, keyFunction: number): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    const previous = this.#store.state.keys;
    const next = (previous ?? []).map((key) => (key.type === keyType ? { ...key, fn: keyFunction } : key));
    this.#patch({ keys: next });
    try {
      await client.request(C.Cmd.Key, Array.from(C.encodeKey(keyType, keyFunction)), {
        timeoutMs: this.#timeoutMs,
      });
    } catch (error) {
      this.#patch({ keys: previous, error: describeError(error) });
    }
  }

  /** Ring the buds (cmd 42, 1 byte `0/1`). */
  async setFindDevice(on: boolean): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    try {
      await client.request(C.Cmd.FindDevice, Array.from(C.encodeFindDevice(on)), {
        timeoutMs: this.#timeoutMs,
      });
    } catch (error) {
      this.#patch({ error: describeError(error) });
    }
  }

  /** In-ear detection (cmd 38, 1 byte `0/1`). */
  async setInEarDetect(on: boolean): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    const previous = this.#store.state.inEar;
    this.#patch({ inEar: on });
    try {
      await client.request(C.Cmd.InEarDetect, [on ? 1 : 0], { timeoutMs: this.#timeoutMs });
    } catch (error) {
      this.#patch({ inEar: previous, error: describeError(error) });
    }
  }

  // --- teardown ------------------------------------------------------------------

  async disconnect(): Promise<void> {
    const durable = this.#lastKnownDurable();
    const closed = this.#session.disconnect();
    this.#patch({ ...initialBoatState, ...durable, status: 'disconnected' });
    await closed;
  }
}

class NonBluetrumError extends Error {
  constructor(sdkType: string | null) {
    super(`This is a ${sdkType ?? 'non-Bluetrum'} Boat model, not a Bluetrum one.`);
    this.name = 'NonBluetrumError';
  }
}
