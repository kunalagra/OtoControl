/**
 * Orchestration: owns the transport, the client and the observable state.
 *
 * Connect runs the handshake, reads the identity (`GetInfo`), the live state
 * (`GetRunInfo`) and the two configs this driver surfaces, then keeps state
 * current from the earbuds' own pushes. Capabilities are probed, not assumed:
 * a read that is refused or unanswered just means that control is not shown.
 * See `docs/superpowers/specs/2026-10-02-xiaomi-driver-design.md`.
 */

import { challengeResponse } from './auth';
import { XiaomiClient } from './client';
import {
  ConfigId,
  Opcode,
  QUERY_OPCODES,
  decodeConfig,
  decodeInfo,
  decodeRunInfo,
  decodeStatusPush,
  encodeFind,
  encodeGetConfig,
  encodeGetInfo,
  encodeGetRunInfo,
  encodeSetAncMode,
  encodeSetEqPreset,
  encodeSetStrength,
  encodeSetWearDetection,
} from './commands';
import type { AncModeValue, ConfigState, FindTarget, StrengthTargetValue } from './commands';
import type { XiaomiFrame } from './frame';
import { catalogName, modelHints } from './models';
import { XIAOMI_SNAPSHOT_VERSION, applyDurable, captureDurable, initialXiaomiState } from './state';
import type { XiaomiCapability, XiaomiState } from './state';
// Re-exported so `core/manager.ts` can import it from this module, the same
// way it imports every other driver's state type from that driver's main
// device file rather than reaching past it into an internal module.
export type { XiaomiState } from './state';
import { isBluetoothTarget, isUnreachable, isWebSerialSupported, openSerialTransport } from '@/core/transport';
import type { ConnectionTarget, TransportOpener } from '@/core/transport';
import { DeviceSession } from '@/core/session';
import type { SessionHooks } from '@/core/session';
import { StateStore } from '@/core/stateStore';
import type { StateStoreHooks } from '@/core/stateStore';
import { describeError } from '@/core/errors';
import type { Persistable, SnapshotPayload } from '@/core/persistence';

type Listener = (state: XiaomiState) => void;

/**
 * How long a read that might not exist waits before giving up: run info, the
 * config reads, and the handshake's own steps. Injectable, like every other
 * driver's, so tests do not pay it per unanswered command.
 */
const PROBE_TIMEOUT_MS = 400;

/**
 * The official app waits briefly after the socket opens before it starts the
 * handshake (MiBudsController `EarbudsClient.AuthenticateAsync`).
 */
const SETTLE_MS = 500;

/** How long to wait, after our confirm, for the earbuds' own confirm. */
const CONFIRM_WAIT_MS = 1500;

/** How much of the conversation `protocolLog` keeps. */
const PROTOCOL_LOG_MAX = 400;

export interface ProtocolLogEntry {
  /** `Date.now()` when the bytes crossed the link. */
  at: number;
  /** `connect` marks a new link, with no bytes. */
  direction: 'tx' | 'rx' | 'connect';
  bytes: Uint8Array;
}

const NOT_XIAOMI_ERROR = 'This does not look like Xiaomi or Redmi earbuds.';

export interface XiaomiDeviceOptions {
  /** Injected so tests do not pay `DEFAULT_TIMEOUT_MS` per unanswered command. */
  timeoutMs?: number;
  /** Injected so tests do not pay `PROBE_TIMEOUT_MS` per unanswered probe. */
  probeTimeoutMs?: number;
  settleMs?: number;
  confirmWaitMs?: number;
  /** Injected so a test can pin the challenge it sends. */
  random?: (length: number) => Uint8Array;
}

const randomBytes = (length: number): Uint8Array => crypto.getRandomValues(new Uint8Array(length));

const stateStoreHooks: StateStoreHooks<XiaomiState> = {
  isUnread: (state) => state.info.vid === null && state.info.btName === null,
  isConnected: (state) => state.status === 'connected',
  capture: captureDurable,
  apply: (_state, payload) => applyDurable(payload),
};

const delay = (ms: number): Promise<void> => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

export class XiaomiDevice implements Persistable {
  readonly #store: StateStore<XiaomiState>;
  readonly #session: DeviceSession<XiaomiClient>;
  readonly #timeoutMs?: number;
  readonly #probeTimeoutMs: number;
  readonly #settleMs: number;
  readonly #confirmWaitMs: number;
  readonly #random: (length: number) => Uint8Array;
  #refreshing = false;
  /** Resolves when the earbuds' own `0x51` arrives; reset per connection. */
  #confirmed: Promise<void> = Promise.resolve();
  #markConfirmed: () => void = () => undefined;
  #protocolLog: ProtocolLogEntry[] = [];
  readonly #protocolLogListeners = new Set<() => void>();

  constructor(openTransport: TransportOpener = openSerialTransport, options: XiaomiDeviceOptions = {}) {
    this.#timeoutMs = options.timeoutMs;
    this.#probeTimeoutMs = options.probeTimeoutMs ?? PROBE_TIMEOUT_MS;
    this.#settleMs = options.settleMs ?? SETTLE_MS;
    this.#confirmWaitMs = options.confirmWaitMs ?? CONFIRM_WAIT_MS;
    this.#random = options.random ?? randomBytes;
    this.#store = new StateStore(
      { ...initialXiaomiState, status: isWebSerialSupported() ? 'disconnected' : 'unsupported' },
      stateStoreHooks,
    );

    const hooks: SessionHooks<XiaomiClient> = {
      createClient: (transport) => new XiaomiClient(transport, { timeoutMs: this.#timeoutMs }),
      handleData: (client, chunk) => client.handleData(chunk),
      wire: (client) => {
        this.#confirmed = new Promise((resolve) => {
          this.#markConfirmed = resolve;
        });
        client.onInbound((frame) => this.#onInbound(frame));
        this.#appendLog('connect', new Uint8Array());
        client.onRaw((bytes, direction) => this.#appendLog(direction, bytes));
      },
      onStatus: (status, error) => this.#patch({ status, error }),
      onDrop: (reason) =>
        this.#patch({
          ...initialXiaomiState,
          ...this.#lastKnownDurable(),
          status: 'disconnected',
          error: reason ? describeError(reason) : null,
        }),
      abort: (client, reason) => client.abort(reason),
    };
    this.#session = new DeviceSession(openTransport, hooks);
  }

  get state(): XiaomiState {
    return this.#store.state;
  }

  /**
   * Raw bytes both ways since the first connect, newest last — for working out what a
   * model that misbehaves actually sends. Kept outside state so logging never re-renders.
   */
  get protocolLog(): readonly ProtocolLogEntry[] {
    return this.#protocolLog;
  }

  onProtocolLog(listener: () => void): () => void {
    this.#protocolLogListeners.add(listener);
    return () => this.#protocolLogListeners.delete(listener);
  }

  #appendLog(direction: ProtocolLogEntry['direction'], bytes: Uint8Array): void {
    this.#protocolLog = [...this.#protocolLog, { at: Date.now(), direction, bytes: Uint8Array.from(bytes) }].slice(-PROTOCOL_LOG_MAX);
    for (const listener of this.#protocolLogListeners) listener();
  }

  /**
   * Sends one hand-entered read and resolves with its reply payload. Limited to
   * the info, run-info and config-read opcodes, so nothing typed here changes a setting.
   */
  async sendQuery(opcode: number, payload: number[]): Promise<Uint8Array> {
    if (!QUERY_OPCODES.has(opcode)) {
      throw new Error('Only reads can be sent from here: 02 (info), 09 (run info) and F3 (config).');
    }
    const client = this.#session.client;
    if (!client) throw new Error('Not connected.');
    return client.request(opcode, payload);
  }

  // --- Persistable ---------------------------------------------------------

  readonly snapshotVersion = XIAOMI_SNAPSHOT_VERSION;

  snapshot(): SnapshotPayload | null {
    return this.#store.snapshot();
  }

  restore(payload: SnapshotPayload): void {
    this.#store.restore(payload);
  }

  subscribe(listener: Listener): () => void {
    return this.#store.subscribe(listener);
  }

  #patch(partial: Partial<XiaomiState>): void {
    this.#store.patch(partial);
  }

  /**
   * Identity and settings worth carrying across a disconnect, so the sidebar
   * keeps naming the device instead of collapsing to the generic "no device"
   * placeholder the instant the link drops.
   */
  #lastKnownDurable(): Partial<XiaomiState> {
    const durable = this.#store.snapshot();
    return durable ? applyDurable(durable) : {};
  }

  // --- connect ---------------------------------------------------------------

  /** Takes over a port the caller already obtained (serial only, this version). */
  async adoptPort(target: ConnectionTarget): Promise<void> {
    if (isBluetoothTarget(target)) {
      this.#patch({ status: 'disconnected', error: 'BLE GATT is not implemented for Xiaomi earbuds yet.' });
      return;
    }
    try {
      await this.#session.connectTo(target, async () => {
        // Cleared so a superseded session's controls cannot linger over a new pair.
        this.#patch({ handshake: null, finding: false });
        await this.#handshake();
        await this.refresh();
      });
    } catch (error) {
      this.#patch({ status: 'disconnected', error: isUnreachable(error) ? null : describeError(error) });
    }
  }

  /**
   * Answers the earbuds' own requests and folds their pushes into state.
   * Returns the answer's payload; the client sends it, empty or not.
   */
  #onInbound(frame: XiaomiFrame): number[] | void {
    switch (frame.opcode) {
      case Opcode.AuthChallenge: {
        // `[01][16-byte challenge]`; answered `[01][E21(challenge)]` (GB `handleAuthentication`).
        if (frame.payload.length < 17) return [];
        return [0x01, ...challengeResponse(frame.payload.subarray(1, 17))];
      }
      case Opcode.AuthConfirm:
        this.#markConfirmed();
        return [0x01];
      case Opcode.ReportStatus: {
        const push = decodeStatusPush(frame.payload);
        const patch: Partial<XiaomiState> = {};
        if (push.battery) patch.battery = push.battery;
        if (push.ancMode !== null) patch.ancMode = push.ancMode;
        this.#patch(patch);
        return;
      }
      case Opcode.NotifyConfig:
        this.#applyConfig(decodeConfig(frame.payload, true));
        return;
      default:
        return;
    }
  }

  /**
   * The handshake: our challenge, our confirm, then the earbuds' own challenge
   * and confirm, which `#onInbound` answers as they arrive. Every step is
   * best-effort, because some models skip it (MiBudsController) or answer only
   * the last step (MiBudsClient); a model that needs it and does not get it
   * simply fails the `GetInfo` read that follows.
   */
  async #handshake(): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    await delay(this.#settleMs);
    let answered = false;
    try {
      await client.request(Opcode.AuthChallenge, [0x01, ...this.#random(16)], { timeoutMs: this.#probeTimeoutMs });
      answered = true;
      await client.request(Opcode.AuthConfirm, [0x01, 0x00], { timeoutMs: this.#probeTimeoutMs });
    } catch (error) {
      console.debug('[xiaomi] handshake step unanswered', error);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const confirmed = await Promise.race([
      this.#confirmed.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), this.#confirmWaitMs);
      }),
    ]);
    clearTimeout(timer);
    if (this.#session.client !== client) return;
    this.#patch({ handshake: confirmed || answered ? 'complete' : 'skipped' });
  }

  // --- refresh -----------------------------------------------------------

  async refresh(): Promise<void> {
    const client = this.#session.client;
    if (!client || this.#refreshing) return;
    this.#refreshing = true;
    try {
      await this.#refreshAll(client);
    } finally {
      this.#refreshing = false;
    }
  }

  async #refreshAll(client: XiaomiClient): Promise<void> {
    const identified = await this.#readInfo(client);
    // The link dropped mid-connect: onDrop already reset state and set the real reason.
    if (this.#session.client !== client) return;
    if (!identified) {
      // Anything on this service class answers `GetInfo`; one that does not is released
      // rather than held, so auto-connect can move on.
      await this.disconnect();
      this.#patch({ error: NOT_XIAOMI_ERROR });
      return;
    }
    const capabilities = new Set<XiaomiCapability>(['find']);
    const { info } = this.#store.state;
    if (info.firmware.length > 0) capabilities.add('version');
    if (this.#store.state.battery.length > 0) capabilities.add('battery');
    const hints = modelHints(info.btName, info.model);

    try {
      const run = decodeRunInfo(await client.request(Opcode.GetRunInfo, encodeGetRunInfo(), { timeoutMs: this.#probeTimeoutMs }));
      if (run.ancMode !== null && hints.noiseControl) {
        capabilities.add('anc');
        this.#patch({ ancMode: run.ancMode });
      }
      if (run.wearDetection !== null) {
        capabilities.add('wear');
        this.#patch({ wearDetection: run.wearDetection });
      }
    } catch (error) {
      console.debug('[xiaomi] run info unavailable', error);
    }

    const strength = await this.#readConfig(client, ConfigId.Strength);
    if (strength && hints.noiseControl && (strength.ncStrength !== undefined || strength.transparencyStrength !== undefined)) {
      capabilities.add('strength');
      this.#applyConfig(strength);
    }
    const eq = await this.#readConfig(client, ConfigId.EqPreset);
    if (eq?.eqPreset !== undefined) {
      capabilities.add('eq');
      this.#applyConfig(eq);
    }

    if (this.#session.client !== client) return;
    this.#patch({ capabilities });
  }

  /** The identity read; one retry, because the earbuds may still be finishing their own handshake. */
  async #readInfo(client: XiaomiClient): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const identity = decodeInfo(await client.request(Opcode.GetInfo, encodeGetInfo()));
        const catalog = catalogName(identity.vid, identity.pid);
        this.#patch({
          info: {
            model: catalog ?? identity.btName,
            btName: identity.btName,
            vid: identity.vid,
            pid: identity.pid,
            firmware: identity.firmware,
          },
          battery: identity.battery,
        });
        return true;
      } catch (error) {
        console.debug('[xiaomi] GetInfo failed', error);
      }
    }
    return false;
  }

  async #readConfig(client: XiaomiClient, id: number): Promise<ConfigState | null> {
    try {
      return decodeConfig(await client.request(Opcode.GetConfig, encodeGetConfig(id), { timeoutMs: this.#probeTimeoutMs }), false);
    } catch (error) {
      console.debug(`[xiaomi] config 0x${id.toString(16)} did not read`, error);
      return null;
    }
  }

  #applyConfig(config: ConfigState): void {
    const patch: Partial<XiaomiState> = {};
    if (config.ncStrength !== undefined) patch.ncStrength = config.ncStrength;
    if (config.transparencyStrength !== undefined) patch.transparencyStrength = config.transparencyStrength;
    if (config.eqPreset !== undefined) patch.eqPreset = config.eqPreset;
    if (config.ancMode !== undefined) patch.ancMode = config.ancMode;
    this.#patch(patch);
  }

  // --- settings ----------------------------------------------------------

  /**
   * Optimistic, rolled back with the reason if the earbuds refuse or do not
   * answer. Every setter below follows the same shape.
   */
  async #write<K extends keyof XiaomiState>(
    key: K,
    next: XiaomiState[K],
    send: (client: XiaomiClient) => Promise<unknown>,
  ): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    const previous = this.#store.state[key];
    this.#patch({ [key]: next } as Partial<XiaomiState>);
    try {
      await send(client);
    } catch (error) {
      this.#patch({ [key]: previous, error: describeError(error) } as Partial<XiaomiState>);
    }
  }

  setAncMode(mode: AncModeValue): Promise<void> {
    return this.#write('ancMode', mode, (client) => client.request(Opcode.SetStatus, encodeSetAncMode(mode)));
  }

  setStrength(target: StrengthTargetValue, level: number): Promise<void> {
    return this.#write(target === 1 ? 'ncStrength' : 'transparencyStrength', level, (client) =>
      client.request(Opcode.SetConfig, encodeSetStrength(target, level)),
    );
  }

  setEqPreset(preset: number): Promise<void> {
    return this.#write('eqPreset', preset, (client) => client.request(Opcode.SetConfig, encodeSetEqPreset(preset)));
  }

  setWearDetection(enabled: boolean): Promise<void> {
    return this.#write('wearDetection', enabled, (client) => client.request(Opcode.SetStatus, encodeSetWearDetection(enabled)));
  }

  /** Stops first, as Gadgetbridge does, so a ring already in progress restarts cleanly. */
  setFinding(on: boolean, which: FindTarget = 3): Promise<void> {
    return this.#write('finding', on, async (client) => {
      if (on) await client.request(Opcode.SetConfig, encodeFind(false, 3));
      await client.request(Opcode.SetConfig, encodeFind(on, which));
    });
  }

  // --- teardown ----------------------------------------------------------

  async disconnect(): Promise<void> {
    const durable = this.#lastKnownDurable();
    const closed = this.#session.disconnect();
    this.#patch({ ...initialXiaomiState, ...durable, status: 'disconnected' });
    await closed;
  }
}
