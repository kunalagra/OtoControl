/**
 * Orchestration: owns the transport, the client and the observable state.
 *
 * Connect sequence is deliberately ordered — subscribe to notifications first,
 * then poll — so a change made on the headphone between the two still reaches
 * us rather than being silently missed.
 */

import {
  AncMode,
  formatVersion,
  getAncEnabled,
  getAncModes,
  getAudioPromptMode,
  getBattery,
  getChargingStatus,
  getCodec,
  getConnectionStatus,
  getEqBand,
  getEqConfig,
  getMaxConnections,
  getModelId,
  getOwnDeviceIndex,
  getPairedDevice,
  getPairedDeviceCount,
  getPhysicalDeviceState,
  getSerialNumber,
  getSidetone,
  getApiVersion,
  getSupportedFeatures,
  getSupportedFeaturesNext,
  getSystemVersion,
  getTimer,
  getTransparencyLevel,
  getTransparentHearing,
  Timer,
  setAncEnabled,
  setAncMode,
  connectPairedDevice,
  deletePairedDevice,
  disconnectPairedDevice,
  setEqBand,
  setSidetone,
  setTimer,
  setTransparencyLevel,
  setTransparentHearing,
} from '../gaia/commands';
import type { AncModeId, AncModes, Command } from '../gaia/commands';
import { Vendor } from '../gaia/frame';
import type { GaiaFrame } from '../gaia/frame';
import { REGISTER_NOTIFICATION_COMMAND, SUBSCRIBED_FEATURES } from '../gaia/features';
import { GaiaClient } from './client';
import type { FrameListener, ProbeResult } from './client';
import { isUnreachable, isWebSerialSupported, openSerialTransport, requestPort } from './transport';
import type { TransportOpener } from './transport';
import { DeviceSession } from './session';
import type { SessionHooks } from './session';
import { StateStore } from './stateStore';
import type { StateStoreHooks } from './stateStore';
import { describeError } from './errors';
import type { Persistable, SnapshotPayload } from './persistence';
import {
  SNAPSHOT_VERSION,
  TOGGLES,
  applyDurable,
  applyNotification,
  captureDurable,
  initialState,
  removalBlockedReason,
  togglesFor,
} from './state';
import type { DeviceState, ToggleKey } from './state';

type Listener = (state: DeviceState) => void;

const ANC_MODE_FIELDS: Record<AncModeId, keyof AncModes> = {
  [AncMode.AntiWind]: 'antiWind',
  [AncMode.Comfort]: 'comfort',
  [AncMode.Adaptive]: 'adaptive',
};

/**
 * How long to wait before re-reading the list after a delete.
 *
 * The vendor app names this condition — "Device list is not available after
 * device removal because of FW bug" — and ships an analytics event for it, so
 * one failed read is expected rather than exceptional.
 */
const DELETE_REREAD_DELAY_MS = 500;

/**
 * How soon after asking to drop our own link a resulting transport close
 * counts as that request's echo, rather than an unrelated, genuine loss.
 *
 * The ACK (or the rejection of a failed request) and the transport's close
 * event are two separate async signals, so a boolean latch cannot tell "this
 * close is the one I caused" from "the flag never got cleared" — see the
 * fix history on `#intentionalDropAt`. Two seconds comfortably covers normal
 * ACK-then-close latency while being far too short for a user to power off
 * or walk out of range in response to a click they just made.
 */
const INTENTIONAL_DROP_GRACE_MS = 2000;

/** Registering for notifications has no typed command; it takes a feature ID. */
const registerNotification: Command<number, void> = {
  name: 'registerNotification',
  vendor: Vendor.Sennheiser,
  id: REGISTER_NOTIFICATION_COMMAND,
  encode: (feature) => [feature],
  decode: () => undefined,
};

/** The store's driver-specific half: how this brand decides "unread"/"connected" and captures/applies its durable slice. */
const stateStoreHooks: StateStoreHooks<DeviceState> = {
  isUnread: (state) => state.info.model === null,
  isConnected: (state) => state.status === 'connected',
  capture: captureDurable,
  apply: applyDurable,
};

export class MomentumDevice implements Persistable {
  readonly #store: StateStore<DeviceState>;
  readonly #session: DeviceSession<GaiaClient>;
  /** Guards against overlapping polls when refreshes are triggered rapidly. */
  #refreshing = false;
  /**
   * When we last asked to drop our own link, so the resulting transport close
   * is reported as a clean disconnect rather than an error.
   *
   * A timestamp rather than a boolean: a boolean latch, once set, only clears
   * on a path someone remembered to write, and the success path here did not
   * — leaving a stray `true` that would misreport the *next*, genuine drop as
   * intentional. Comparing against a grace window bounds the risk instead of
   * depending on every call site clearing it correctly.
   */
  #intentionalDropAt = 0;

  constructor(openTransport: TransportOpener = openSerialTransport) {
    this.#store = new StateStore(
      { ...initialState, status: isWebSerialSupported() ? 'disconnected' : 'unsupported' },
      stateStoreHooks,
    );

    const hooks: SessionHooks<GaiaClient> = {
      createClient: (transport) => new GaiaClient(transport),
      handleData: (client, chunk) => client.handleData(chunk),
      wire: (client) => {
        client.onNotification((frame) => this.#onNotification(frame));
      },
      onStatus: (status, error) => this.#patch({ status, error }),
      onDrop: (reason) => {
        const intentional = Date.now() - this.#intentionalDropAt < INTENTIONAL_DROP_GRACE_MS;
        this.#patch({
          ...initialState,
          status: 'disconnected',
          error: intentional || !reason ? null : describeError(reason),
        });
      },
      abort: (client, reason) => client.abort(reason),
    };
    this.#session = new DeviceSession(openTransport, hooks);
  }

  get state(): DeviceState {
    return this.#store.state;
  }

  // --- Persistable --------------------------------------------------------

  readonly snapshotVersion = SNAPSHOT_VERSION;

  /** Durable settings as plain JSON, or null when there is nothing to save yet. */
  snapshot(): SnapshotPayload | null {
    return this.#store.snapshot();
  }

  /**
   * Seeds last-known settings so the UI has something real to show before the
   * headphones are reachable. See `StateStore.restore` for why this is
   * refused once connected.
   */
  restore(payload: SnapshotPayload): void {
    this.#store.restore(payload);
  }

  subscribe(listener: Listener): () => void {
    return this.#store.subscribe(listener);
  }

  /** Frame-level tap for the debug console. Survives reconnects. */
  onFrame(listener: FrameListener): () => void {
    return this.#session.attach((client) => client.onFrame(listener));
  }

  #patch(partial: Partial<DeviceState>): void {
    this.#store.patch(partial);
  }

  #replace(next: DeviceState): void {
    this.#store.replace(next);
  }

  /** Reconnects to an already-granted port without showing the picker. */
  async autoConnect(): Promise<boolean> {
    if (!isWebSerialSupported()) return false;
    // Only reconnect silently to a device this class can actually drive.
    const port = await DeviceSession.grantedPortFor('sennheiser');
    if (!port) return false;
    try {
      await this.#connectTo(port);
      return true;
    } catch {
      // A stale grant for a powered-off headphone is expected; stay quiet and
      // let the user press Connect.
      this.#patch({ status: 'disconnected' });
      return false;
    }
  }

  /**
   * Takes over a port the caller already obtained. Used when something else
   * showed the picker and resolved which brand the device is.
   */
  async adoptPort(port: SerialPort): Promise<void> {
    try {
      await this.#connectTo(port);
    } catch (error) {
      this.#patch({ status: 'disconnected', error: isUnreachable(error) ? null : describeError(error) });
    }
  }

  /** Shows the browser picker. Must be called from a user gesture. */
  async connect(): Promise<void> {
    if (!isWebSerialSupported()) {
      this.#patch({ status: 'unsupported' });
      return;
    }
    try {
      const { port } = await requestPort();
      await this.#connectTo(port);
    } catch (error) {
      this.#patch({ status: 'disconnected', error: isUnreachable(error) ? null : describeError(error) });
    }
  }

  async #connectTo(port: SerialPort): Promise<void> {
    await this.#session.connectTo(port, async () => {
      // Read `this.#session.client`, not the client `connectTo` handed us:
      // a drop mid-subscribe can null it out from under this callback.
      // `refresh()`, and every other client read below it, re-checks the
      // field and returns early once it is null. `#subscribe()` does not —
      // it reads `this.#session.client!` and relies on the per-feature
      // try/catch there to swallow the resulting TypeError instead. Both are
      // safe, but for different reasons; do not assume the second follows
      // the first's pattern.
      await this.#subscribe();
      await this.refresh();
    });
  }

  #onNotification(frame: GaiaFrame): void {
    this.#replace(applyNotification(this.#store.state, frame));
  }

  async #subscribe(): Promise<void> {
    for (const feature of SUBSCRIBED_FEATURES) {
      try {
        await this.#session.client!.request(registerNotification, feature);
      } catch (error) {
        // Not every feature is registrable on every firmware. Losing one
        // subscription degrades live updates; it should not fail the connect.
        console.warn(`[device] could not subscribe to feature ${feature}`, error);
      }
    }
  }

  /**
   * Polls everything. Individual failures are tolerated.
   *
   * Necessary because most settings have no notification in firmware — smart
   * pause, on-head detection, auto-answer, comfort call, sidetone, Bluetooth
   * compatibility and auto power off all report `notification_ID: 0x0000`, so
   * a change made in the phone app is invisible until we ask again.
   */
  async refresh(): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    if (this.#refreshing) return;
    this.#refreshing = true;
    try {
      await this.#refreshAll(client);
    } finally {
      this.#refreshing = false;
    }
  }

  async #refreshAll(client: GaiaClient): Promise<void> {

    const read = async <T>(command: Command<void, T>, apply: (value: T) => void) => {
      try {
        apply(await client.request(command, undefined));
      } catch (error) {
        console.warn(`[device] ${command.name} failed`, error);
      }
    };

    await this.#probeCapabilities(client);

    await read(getModelId, (model) => this.#patch({ info: { ...this.#store.state.info, model } }));
    await read(getSystemVersion, (parts) =>
      this.#patch({ info: { ...this.#store.state.info, firmware: formatVersion(parts) } }),
    );
    await read(getSerialNumber, (serial) =>
      this.#patch({ info: { ...this.#store.state.info, serial } }),
    );
    await read(getCodec, (codec) => this.#patch({ info: { ...this.#store.state.info, codec } }));
    await read(getBattery, (cells) => this.#patch({ battery: cells[0] ?? null }));
    await read(getChargingStatus, (cells) =>
      this.#patch({ charging: cells[0] === undefined ? null : cells[0] !== 0 }),
    );

    await read(getAncEnabled, (ancEnabled) =>
      this.#patch({ noise: { ...this.#store.state.noise, ancEnabled } }),
    );
    await read(getAncModes, (modes) => this.#patch({ noise: { ...this.#store.state.noise, modes } }));
    await read(getTransparentHearing, (transparentHearing) =>
      this.#patch({ noise: { ...this.#store.state.noise, transparentHearing } }),
    );
    await read(getTransparencyLevel, (transparencyLevel) =>
      this.#patch({ noise: { ...this.#store.state.noise, transparencyLevel } }),
    );

    await read(getPhysicalDeviceState, (wearState) => this.#patch({ wearState }));
    await read(getSidetone, (sidetone) => this.#patch({ sidetone }));
    await read(getAudioPromptMode, (audioPrompts) => this.#patch({ audioPrompts }));

    try {
      const { seconds } = await client.request(getTimer, Timer.PowerOff);
      this.#patch({ powerOffSeconds: seconds });
    } catch (error) {
      console.warn('[device] getTimer(PowerOff) failed', error);
    }

    // Model is read at the top of this method, so the profile is known by now.
    // A device that does not have a setting should not be asked about it.
    for (const { key, get } of togglesFor(this.#store.state.info.model)) {
      await read(get, (value) =>
        this.#patch({ toggles: { ...this.#store.state.toggles, [key]: value } }),
      );
    }

    await this.#refreshEq();
    await this.refreshConnections();
  }

  /**
   * Reads the headphones' own paired-device list — the phone app calls this
   * connection management. Distinct from the Bluetooth pairing the OS knows
   * about: this is what the headphones themselves remember.
   */
  async refreshConnections(): Promise<boolean> {
    const client = this.#session.client;
    if (!client) return false;

    let count = 0;
    try {
      count = await client.request(getPairedDeviceCount, undefined);
    } catch (error) {
      console.warn('[device] getPairedDeviceCount failed', error);
      return false;
    }

    // 0x1400 is an upper bound, not a live count: deleting an entry does not
    // compact the list, so indices have holes. The vendor app logs
    // "Encountered gap in paired devices list at index" for exactly this.
    const devices = [];
    for (let index = 0; index < count; index += 1) {
      try {
        devices.push(await client.request(getPairedDevice, index));
      } catch (error) {
        // Gaps are normal: an index can be empty after a device is removed.
        console.warn(`[device] getPairedDevice(${index}) failed`, error);
      }
    }

    // An answered count with nothing behind it is the FW bug, not an empty
    // list: keep what we had and let the caller retry, rather than patching an
    // empty list over a good one and reporting success.
    if (count > 0 && devices.length === 0) return false;

    let maxConnections = this.#store.state.connections.maxConnections;
    let ownIndex = this.#store.state.connections.ownIndex;
    try {
      maxConnections = await client.request(getMaxConnections, undefined);
    } catch (error) {
      console.warn('[device] getMaxConnections failed', error);
    }
    try {
      ownIndex = await client.request(getOwnDeviceIndex, undefined);
    } catch (error) {
      console.warn('[device] getOwnDeviceIndex failed', error);
    }

    this.#patch({
      connections: {
        devices: devices.sort((a, b) => a.index - b.index),
        maxConnections,
        ownIndex,
      },
    });
    return true;
  }

  /**
   * Connects or disconnects one of the headphones' remembered devices.
   *
   * Disconnecting the entry that is this machine drops our own control link, so
   * there is no reply to wait for — the link going away is the confirmation.
   */
  async setDeviceConnected(index: number, connected: boolean): Promise<void> {
    const client = this.#session.client;
    if (!client) return;

    if (!connected && index === this.#store.state.connections.ownIndex) {
      this.#intentionalDropAt = Date.now();
      try {
        await client.request(disconnectPairedDevice, index);
      } catch (error) {
        // A dropped link surfaces as a rejected request, and the session's
        // drop handling has already cleared its client by the time we get
        // here (abort() rejects synchronously, but the await resumes on a
        // later microtask) — that is the expected outcome, not a failure
        // worth showing. A NACK or a timeout rejects too, but leaves the
        // link — and the session's client — up; that is a real failure and
        // must not look like a dead button. Clear the grace window too, so a
        // later, unrelated drop isn't mistaken for this failed attempt.
        if (this.#session.client) {
          this.#intentionalDropAt = 0;
          this.#patch({ error: describeError(error) });
        } else {
          console.warn('[device] self-disconnect did not answer', error);
        }
      }
      return;
    }

    try {
      await client.request(connected ? connectPairedDevice : disconnectPairedDevice, index);
      // The headphones report the real outcome via 0x1484; ask in case they don't.
      const status = await client.request(getConnectionStatus, index);
      this.#replace(
        applyNotification(this.#store.state, {
          flags: 0,
          vendor: Vendor.Sennheiser,
          command: 0x1504,
          payload: Uint8Array.from([status.index, status.connected ? 1 : 0]),
          raw: new Uint8Array(0),
        }),
      );
    } catch (error) {
      this.#patch({ error: describeError(error) });
    }
  }

  /**
   * Forgets one of the headphones' remembered devices.
   *
   * A failed re-read afterwards is not treated as a failure: the delete has
   * already happened, and reporting an error over a successful removal is worse
   * than showing a list that is one refresh out of date.
   */
  async removePairedDevice(index: number): Promise<void> {
    const client = this.#session.client;
    if (!client) return;

    const blocked = removalBlockedReason(this.#store.state, index);
    if (blocked) {
      this.#patch({ error: blocked });
      return;
    }

    try {
      await client.request(deletePairedDevice, index);
    } catch (error) {
      this.#patch({ error: describeError(error) });
      return;
    }

    if (await this.refreshConnections()) return;
    await new Promise((resolve) => setTimeout(resolve, DELETE_REREAD_DELAY_MS));
    await this.refreshConnections();
  }

  /**
   * Asks the device what it implements.
   *
   * Informational for now: polling still follows the hardcoded command table,
   * because the returned IDs are GAIA core's namespace and it is not
   * established that they map onto Sennheiser's vendor feature IDs. Surfacing
   * it is the first step towards gating on it.
   */
  async #probeCapabilities(client: GaiaClient): Promise<void> {
    try {
      const features = new Map<number, number>();
      let page = await client.request(getSupportedFeatures, undefined);
      for (const [id, version] of page.features) features.set(id, version);

      // moreData means the list did not fit in one response.
      let guard = 0;
      while (page.moreData && guard < 8) {
        page = await client.request(getSupportedFeaturesNext, undefined);
        for (const [id, version] of page.features) features.set(id, version);
        guard += 1;
      }

      this.#patch({ supportedFeatures: features });
    } catch (error) {
      console.warn('[device] getSupportedFeatures failed — falling back to the command table', error);
    }

    try {
      this.#patch({ apiVersion: await client.request(getApiVersion, undefined) });
    } catch (error) {
      console.warn('[device] getApiVersion failed', error);
    }
  }

  /**
   * Band count and gain range come from the device, so a model with a
   * different EQ layout than the ACCENTUM these IDs were verified on still
   * renders correctly.
   */
  async #refreshEq(): Promise<void> {
    const client = this.#session.client;
    if (!client) return;

    let config;
    try {
      config = await client.request(getEqConfig, undefined);
    } catch (error) {
      console.warn('[device] getEqConfig failed — equaliser unavailable', error);
      return;
    }
    this.#patch({ eq: { ...this.#store.state.eq, config } });

    const gains: Array<number | undefined> = [];
    for (let band = 0; band < config.bands; band += 1) {
      try {
        const result = await client.request(getEqBand, band);
        // The M4 does not echo the band index, so fall back to the one asked for.
        gains[result.band ?? band] = result.gain;
      } catch (error) {
        console.warn(`[device] getEqBand(${band}) failed`, error);
      }
    }
    this.#patch({ eq: { ...this.#store.state.eq, gains } });
  }

  async setEqBand(band: number, gain: number): Promise<void> {
    const previous = this.#store.state.eq.gains;
    const next = [...previous];
    next[band] = gain;
    await this.#write(
      setEqBand,
      { band, gain },
      (s) => ({ ...s, eq: { ...s.eq, gains: next } }),
      (s) => ({ ...s, eq: { ...s.eq, gains: previous } }),
    );
  }

  /** Applies a whole preset, one band at a time — there is no bulk set. */
  /**
   * Applies a whole curve.
   *
   * GAIA has no bulk EQ set, so the device is written one band at a time — but
   * the UI is moved to the finished curve up front. Patching per band made a
   * preset visibly walk across the faders.
   */
  async setEqGains(gains: number[]): Promise<void> {
    const client = this.#session.client;
    if (!client) return;

    const previous = this.#store.state.eq.gains;
    this.#replace({ ...this.#store.state, eq: { ...this.#store.state.eq, gains: [...gains] } });

    try {
      for (let band = 0; band < gains.length; band += 1) {
        await client.request(setEqBand, { band, gain: gains[band] });
      }
    } catch (error) {
      this.#replace({ ...this.#store.state, eq: { ...this.#store.state.eq, gains: previous } });
      this.#patch({ error: describeError(error) });
    }
  }

  // --- writes -------------------------------------------------------------

  /**
   * Applies a value optimistically, sends it, and rolls back if the device
   * rejects it. A notification arriving in the meantime wins, because it
   * replaces state wholesale.
   */
  async #write<T>(
    command: Command<T, void>,
    value: T,
    optimistic: (state: DeviceState) => DeviceState,
    rollback: (state: DeviceState) => DeviceState,
  ): Promise<void> {
    const client = this.#session.client;
    if (!client) return;

    this.#replace(optimistic(this.#store.state));
    try {
      await client.request(command, value);
    } catch (error) {
      this.#replace(rollback(this.#store.state));
      this.#patch({ error: describeError(error) });
    }
  }

  async setAnc(enabled: boolean): Promise<void> {
    const previous = this.#store.state.noise.ancEnabled;
    await this.#write(
      setAncEnabled,
      enabled,
      (s) => ({ ...s, noise: { ...s.noise, ancEnabled: enabled } }),
      (s) => ({ ...s, noise: { ...s.noise, ancEnabled: previous } }),
    );
  }

  async setTransparentHearing(enabled: boolean): Promise<void> {
    const previous = this.#store.state.noise.transparentHearing;
    await this.#write(
      setTransparentHearing,
      enabled,
      (s) => ({ ...s, noise: { ...s.noise, transparentHearing: enabled } }),
      (s) => ({ ...s, noise: { ...s.noise, transparentHearing: previous } }),
    );
  }

  async setTransparencyLevel(level: number): Promise<void> {
    const previous = this.#store.state.noise.transparencyLevel;
    await this.#write(
      setTransparencyLevel,
      level,
      (s) => ({ ...s, noise: { ...s.noise, transparencyLevel: level } }),
      (s) => ({ ...s, noise: { ...s.noise, transparencyLevel: previous } }),
    );
  }

  /**
   * Sets one ANC sub-mode. The device reports all three together, so the
   * optimistic patch has to merge rather than replace.
   */
  async setAncMode(mode: AncModeId, state: number): Promise<void> {
    const previous = this.#store.state.noise.modes;
    if (!previous) return;
    const field = ANC_MODE_FIELDS[mode];
    await this.#write(
      setAncMode,
      { mode, state },
      (s) => ({
        ...s,
        noise: { ...s.noise, modes: { ...previous, [field]: state } },
      }),
      (s) => ({ ...s, noise: { ...s.noise, modes: previous } }),
    );
  }

  async setToggle(key: ToggleKey, value: boolean): Promise<void> {
    const spec = TOGGLES.find((t) => t.key === key);
    if (!spec) return;
    const previous = this.#store.state.toggles[key];
    await this.#write(
      spec.set,
      value,
      (s) => ({ ...s, toggles: { ...s.toggles, [key]: value } }),
      (s) => ({ ...s, toggles: { ...s.toggles, [key]: previous } }),
    );
  }

  async setPowerOff(seconds: number): Promise<void> {
    const previous = this.#store.state.powerOffSeconds;
    await this.#write(
      setTimer,
      { timer: Timer.PowerOff, seconds },
      (s) => ({ ...s, powerOffSeconds: seconds }),
      (s) => ({ ...s, powerOffSeconds: previous }),
    );
  }

  async setSidetone(level: number): Promise<void> {
    const previous = this.#store.state.sidetone;
    await this.#write(
      setSidetone,
      level,
      (s) => ({ ...s, sidetone: level }),
      (s) => ({ ...s, sidetone: previous }),
    );
  }

  /** Escape hatch for the debug console. */
  async sendRaw(frame: Uint8Array): Promise<void> {
    await this.#session.client?.sendRaw(frame);
  }

  /**
   * Sweeps a range of command IDs to find which ones this firmware implements.
   * Only zero-payload requests are sent, and unsafe IDs are refused outright.
   */
  async probeRange(
    vendor: number,
    from: number,
    to: number,
    onResult: (result: ProbeResult) => void,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<void> {
    const client = this.#session.client;
    if (!client) return;
    for (let command = from; command <= to; command += 1) {
      if (options.signal?.aborted) return;
      onResult(await client.probe(vendor, command, options.timeoutMs));
    }
  }

  // --- teardown -----------------------------------------------------------
  //
  // An unexpected drop is reported through the session's `onDrop` hook (see
  // the constructor) rather than a method here — the session owns the
  // transport and client, so it is the one that knows a drop happened.
  // `disconnect()` is the one teardown path that starts on this side, since
  // it is the device that decides to end the session.

  async disconnect(): Promise<void> {
    // So a manual disconnect can never inherit a pending self-disconnect's
    // grace window and misreport whatever happens next as intentional.
    this.#intentionalDropAt = 0;
    const closed = this.#session.disconnect();
    this.#patch({ ...initialState, status: 'disconnected' });
    await closed;
  }
}
