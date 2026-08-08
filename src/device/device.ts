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
  getAudioMode,
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
  setAudioMode,
  connectPairedDevice,
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
import {
  SerialTransport,
  findGrantedPort,
  isUnreachable,
  isWebSerialSupported,
  requestPort,
} from './transport';
import type { Persistable, SnapshotPayload } from './persistence';
import {
  SNAPSHOT_VERSION,
  TOGGLES,
  applyDurable,
  applyNotification,
  captureDurable,
  initialState,
} from './state';
import type { DeviceState, ToggleKey } from './state';

type Listener = (state: DeviceState) => void;

const ANC_MODE_FIELDS: Record<AncModeId, keyof AncModes> = {
  [AncMode.AntiWind]: 'antiWind',
  [AncMode.Comfort]: 'comfort',
  [AncMode.Adaptive]: 'adaptive',
};

/** Registering for notifications has no typed command; it takes a feature ID. */
const registerNotification: Command<number, void> = {
  name: 'registerNotification',
  vendor: Vendor.Sennheiser,
  id: REGISTER_NOTIFICATION_COMMAND,
  encode: (feature) => [feature],
  decode: () => undefined,
};

export class MomentumDevice implements Persistable {
  #state: DeviceState = {
    ...initialState,
    status: isWebSerialSupported() ? 'disconnected' : 'unsupported',
  };
  #listeners = new Set<Listener>();
  #frameListeners = new Set<FrameListener>();
  #transport: SerialTransport | null = null;
  #client: GaiaClient | null = null;
  /** Guards against overlapping polls when refreshes are triggered rapidly. */
  #refreshing = false;

  get state(): DeviceState {
    return this.#state;
  }

  // --- Persistable --------------------------------------------------------

  readonly snapshotVersion = SNAPSHOT_VERSION;

  snapshot(): SnapshotPayload | null {
    // Nothing has been read yet, so there is nothing worth remembering.
    if (this.#state.info.model === null) return null;
    return captureDurable(this.#state);
  }

  /**
   * Seeds last-known settings so the UI has something real to show before the
   * headphones are reachable.
   *
   * Refuses to run once connected: the device is the source of truth, and a
   * cache arriving late must never overwrite what the hardware just said.
   */
  restore(payload: SnapshotPayload): void {
    if (this.#state.status === 'connected') return;
    this.#patch(applyDurable(this.#state, payload));
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Frame-level tap for the debug console. Survives reconnects. */
  onFrame(listener: FrameListener): () => void {
    this.#frameListeners.add(listener);
    return () => this.#frameListeners.delete(listener);
  }

  #patch(partial: Partial<DeviceState>): void {
    this.#state = { ...this.#state, ...partial };
    for (const listener of this.#listeners) listener(this.#state);
  }

  #replace(next: DeviceState): void {
    if (next === this.#state) return;
    this.#state = next;
    for (const listener of this.#listeners) listener(this.#state);
  }

  /** Reconnects to an already-granted port without showing the picker. */
  async autoConnect(): Promise<boolean> {
    if (!isWebSerialSupported()) return false;
    const granted = await findGrantedPort();
    // Only reconnect silently to a device this class can actually drive.
    if (!granted || granted.service.brand !== 'sennheiser') return false;
    try {
      await this.#connectTo(granted.port);
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
    this.#patch({ status: 'connecting', error: null });

    const transport = await SerialTransport.open(port, {
      onData: (chunk) => this.#client?.handleData(chunk),
      onClose: (reason) => this.#handleDrop(reason),
    });
    const client = new GaiaClient(transport);

    client.onNotification((frame) => this.#onNotification(frame));
    for (const listener of this.#frameListeners) client.onFrame(listener);

    this.#transport = transport;
    this.#client = client;
    this.#patch({ status: 'connected', error: null });

    await this.#subscribe();
    await this.refresh();
  }

  #onNotification(frame: GaiaFrame): void {
    this.#replace(applyNotification(this.#state, frame));
  }

  async #subscribe(): Promise<void> {
    for (const feature of SUBSCRIBED_FEATURES) {
      try {
        await this.#client!.request(registerNotification, feature);
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
    const client = this.#client;
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

    await read(getModelId, (model) => this.#patch({ info: { ...this.#state.info, model } }));
    await read(getSystemVersion, (parts) =>
      this.#patch({ info: { ...this.#state.info, firmware: formatVersion(parts) } }),
    );
    await read(getSerialNumber, (serial) =>
      this.#patch({ info: { ...this.#state.info, serial } }),
    );
    await read(getCodec, (codec) => this.#patch({ info: { ...this.#state.info, codec } }));
    await read(getBattery, (cells) => this.#patch({ battery: cells[0] ?? null }));
    await read(getChargingStatus, (cells) =>
      this.#patch({ charging: cells[0] === undefined ? null : cells[0] !== 0 }),
    );

    await read(getAncEnabled, (ancEnabled) =>
      this.#patch({ noise: { ...this.#state.noise, ancEnabled } }),
    );
    await read(getAncModes, (modes) => this.#patch({ noise: { ...this.#state.noise, modes } }));
    await read(getTransparentHearing, (transparentHearing) =>
      this.#patch({ noise: { ...this.#state.noise, transparentHearing } }),
    );
    await read(getTransparencyLevel, (transparencyLevel) =>
      this.#patch({ noise: { ...this.#state.noise, transparencyLevel } }),
    );

    await read(getPhysicalDeviceState, (wearState) => this.#patch({ wearState }));
    await read(getSidetone, (sidetone) => this.#patch({ sidetone }));
    await read(getAudioPromptMode, (audioPrompts) => this.#patch({ audioPrompts }));
    await read(getAudioMode, (audioMode) => this.#patch({ audioMode }));

    try {
      const { seconds } = await client.request(getTimer, Timer.PowerOff);
      this.#patch({ powerOffSeconds: seconds });
    } catch (error) {
      console.warn('[device] getTimer(PowerOff) failed', error);
    }

    for (const { key, get } of TOGGLES) {
      await read(get, (value) =>
        this.#patch({ toggles: { ...this.#state.toggles, [key]: value } }),
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
  async refreshConnections(): Promise<void> {
    const client = this.#client;
    if (!client) return;

    let count = 0;
    try {
      count = await client.request(getPairedDeviceCount, undefined);
    } catch (error) {
      console.warn('[device] getPairedDeviceCount failed', error);
      return;
    }

    const devices = [];
    for (let index = 0; index < count; index += 1) {
      try {
        devices.push(await client.request(getPairedDevice, index));
      } catch (error) {
        // Gaps are normal: an index can be empty after a device is removed.
        console.warn(`[device] getPairedDevice(${index}) failed`, error);
      }
    }

    let maxConnections = this.#state.connections.maxConnections;
    let ownIndex = this.#state.connections.ownIndex;
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
  }

  /**
   * Connects or disconnects one of the headphones' remembered devices.
   *
   * Disconnecting the entry that is this machine drops our own control link,
   * so the UI marks that row and does not offer the action.
   */
  async setDeviceConnected(index: number, connected: boolean): Promise<void> {
    const client = this.#client;
    if (!client) return;
    try {
      await client.request(connected ? connectPairedDevice : disconnectPairedDevice, index);
      // The headphones report the real outcome via 0x1484; ask in case they don't.
      const status = await client.request(getConnectionStatus, index);
      this.#replace(
        applyNotification(this.#state, {
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
    const client = this.#client;
    if (!client) return;

    let config;
    try {
      config = await client.request(getEqConfig, undefined);
    } catch (error) {
      console.warn('[device] getEqConfig failed — equaliser unavailable', error);
      return;
    }
    this.#patch({ eq: { ...this.#state.eq, config } });

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
    this.#patch({ eq: { ...this.#state.eq, gains } });
  }

  async setEqBand(band: number, gain: number): Promise<void> {
    const previous = this.#state.eq.gains;
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
    const client = this.#client;
    if (!client) return;

    const previous = this.#state.eq.gains;
    this.#replace({ ...this.#state, eq: { ...this.#state.eq, gains: [...gains] } });

    try {
      for (let band = 0; band < gains.length; band += 1) {
        await client.request(setEqBand, { band, gain: gains[band] });
      }
    } catch (error) {
      this.#replace({ ...this.#state, eq: { ...this.#state.eq, gains: previous } });
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
    const client = this.#client;
    if (!client) return;

    this.#replace(optimistic(this.#state));
    try {
      await client.request(command, value);
    } catch (error) {
      this.#replace(rollback(this.#state));
      this.#patch({ error: describeError(error) });
    }
  }

  async setAnc(enabled: boolean): Promise<void> {
    const previous = this.#state.noise.ancEnabled;
    await this.#write(
      setAncEnabled,
      enabled,
      (s) => ({ ...s, noise: { ...s.noise, ancEnabled: enabled } }),
      (s) => ({ ...s, noise: { ...s.noise, ancEnabled: previous } }),
    );
  }

  async setTransparentHearing(enabled: boolean): Promise<void> {
    const previous = this.#state.noise.transparentHearing;
    await this.#write(
      setTransparentHearing,
      enabled,
      (s) => ({ ...s, noise: { ...s.noise, transparentHearing: enabled } }),
      (s) => ({ ...s, noise: { ...s.noise, transparentHearing: previous } }),
    );
  }

  async setTransparencyLevel(level: number): Promise<void> {
    const previous = this.#state.noise.transparencyLevel;
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
    const previous = this.#state.noise.modes;
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
    const previous = this.#state.toggles[key];
    await this.#write(
      spec.set,
      value,
      (s) => ({ ...s, toggles: { ...s.toggles, [key]: value } }),
      (s) => ({ ...s, toggles: { ...s.toggles, [key]: previous } }),
    );
  }

  async setPowerOff(seconds: number): Promise<void> {
    const previous = this.#state.powerOffSeconds;
    await this.#write(
      setTimer,
      { timer: Timer.PowerOff, seconds },
      (s) => ({ ...s, powerOffSeconds: seconds }),
      (s) => ({ ...s, powerOffSeconds: previous }),
    );
  }

  async setAudioMode(mode: number): Promise<void> {
    const previous = this.#state.audioMode;
    await this.#write(
      setAudioMode,
      mode,
      (s) => ({ ...s, audioMode: mode }),
      (s) => ({ ...s, audioMode: previous }),
    );
  }

  async setSidetone(level: number): Promise<void> {
    const previous = this.#state.sidetone;
    await this.#write(
      setSidetone,
      level,
      (s) => ({ ...s, sidetone: level }),
      (s) => ({ ...s, sidetone: previous }),
    );
  }

  /** Escape hatch for the debug console. */
  async sendRaw(frame: Uint8Array): Promise<void> {
    await this.#client?.sendRaw(frame);
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
    const client = this.#client;
    if (!client) return;
    for (let command = from; command <= to; command += 1) {
      if (options.signal?.aborted) return;
      onResult(await client.probe(vendor, command, options.timeoutMs));
    }
  }

  // --- teardown -----------------------------------------------------------

  #handleDrop(reason?: Error): void {
    this.#client?.abort(reason ?? new Error('connection lost'));
    this.#transport = null;
    this.#client = null;
    this.#patch({
      ...initialState,
      status: 'disconnected',
      error: reason ? describeError(reason) : null,
    });
  }

  async disconnect(): Promise<void> {
    const transport = this.#transport;
    this.#client?.abort(new Error('disconnected'));
    this.#transport = null;
    this.#client = null;
    this.#patch({ ...initialState, status: 'disconnected' });
    await transport?.close().catch(() => undefined);
  }
}

function describeError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return 'No device was selected. Make sure it is powered on and connected as an audio device.';
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
