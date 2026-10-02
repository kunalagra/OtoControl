import { describe, expect, it } from 'vitest';

import { PixelBudsDevice } from './device';
import { budsScript, fakeBuds } from './harness.test-helper';
import type { BudsScript, FakeBuds } from './harness.test-helper';
import { Method, SettingId } from './maestro';
import { PacketType, rpcHash } from './rpc';
import type { RpcPacket } from './rpc';

/** `adoptPort` is the test entry point — `connect()` would need the picker. */
const port = {} as SerialPort;

const bytes = (text: string): number[] => text.split(' ').map((byte) => parseInt(byte, 16));
const hex = (data: ArrayLike<number>): string => Array.from(data, (b) => b.toString(16).padStart(2, '0')).join(' ');

// Fixtures written by hand from maestro_pw.proto, as in maestro.test.ts.
const SOFTWARE = bytes('22 11 0a 0a 0a 01 78 12 05 31 2e 32 2e 33 12 03 12 01 39'); // case 1.2.3, right 9
const HARDWARE = bytes('3a 0b 0a 02 43 31 12 01 52 1a 02 4c 31'); // case C1, right R, left L1
const RUNTIME = bytes('10 80 01 32 0e 0a 04 08 5a 10 01 12 04 08 50 10 02 1a 00 3a 02 08 01');
const EQ = bytes('22 12 82 01 0f 0d 00 00 c0 3f 1d 00 00 c0 c0 2d 00 00 c0 40'); // [1.5, 0, -6, 0, 6]

const SETTINGS: Record<number, number[]> = {
  [SettingId.AncState]: bytes('22 02 68 02'), // Active
  [SettingId.AncLoop]: bytes('22 08 62 06 08 01 18 01 20 01'), // active, aware, adaptive
  [SettingId.Multipoint]: bytes('22 02 58 01'),
  [SettingId.OnHeadDetection]: bytes('22 02 10 01'),
  [SettingId.UserEq]: EQ,
  [SettingId.VolumeEq]: bytes('22 02 78 00'),
};

/** The id a `ReadSetting` request asks for: `20 <id>`. */
const askedSetting = (request: RpcPacket): number => request.payload[1];

function scripted(overrides: Partial<BudsScript> = {}, settings: Record<number, number[] | null> = {}): BudsScript {
  return budsScript({
    unary: {
      [Method.GetSoftwareInfo]: () => ({ payload: SOFTWARE }),
      [Method.GetHardwareInfo]: () => ({ payload: HARDWARE }),
      [Method.ReadSetting]: (request) => {
        const reply = { ...SETTINGS, ...settings }[askedSetting(request)];
        return reply ? { payload: reply } : { status: 2 };
      },
      [Method.WriteSetting]: () => ({}),
    },
    streams: { [Method.SubscribeRuntimeInfo]: [RUNTIME], [Method.SubscribeToSettingsChanges]: [] },
    ...overrides,
  });
}

const FAST = { timeoutMs: 50, probeTimeoutMs: 50, discoveryWaitMs: 30, channelProbeMs: 15 };

async function connected(script: BudsScript = scripted()): Promise<{ device: PixelBudsDevice; buds: FakeBuds }> {
  const buds = fakeBuds(script);
  const device = new PixelBudsDevice(buds.open, FAST);
  await device.adoptPort(port);
  return { device, buds };
}

const writesOf = (buds: FakeBuds): string[] =>
  buds.requests.filter((request) => request.methodId === rpcHash(Method.WriteSetting)).map((request) => hex(request.payload));

describe('PixelBudsDevice connect', () => {
  it('learns the channel from the announcement, then reads identity, battery and every setting', async () => {
    const { device, buds } = await connected();
    const { state } = device;

    expect(state.status).toBe('connected');
    expect(state.channel).toBe(19);
    expect(state.channelProbed).toBe(false);
    // Nothing is asked of the buds until the channel is known, and the announcement needs no request.
    expect(buds.requests[0].methodId).not.toBe(rpcHash(Method.GetSoftwareInfo));

    expect(state.info.model).toBe('Pixel Buds Pro');
    expect(state.info.firmware).toEqual({ case: '1.2.3', right: '9', left: null });
    expect(state.info.serials).toEqual({ case: 'C1', right: 'R', left: 'L1' });
    expect(state.battery).toEqual([
      { device: 'case', level: 90, charging: false },
      { device: 'left', level: 80, charging: true },
      { device: 'right', level: 0, charging: false },
    ]);
    expect(state.placement).toEqual({ rightInCase: true, leftInCase: false });
    expect(state.ancMode).toBe(2);
    expect(state.ancLoop).toEqual({ active: true, off: false, aware: true, adaptive: true });
    expect(state.multipoint).toBe(true);
    expect(state.onHeadDetection).toBe(true);
    expect(state.eq).toEqual([1.5, 0, -6, 0, 6]);
    expect(state.volumeEq).toBe(false);
    expect(state.capabilities).toEqual(new Set(['firmware', 'battery', 'anc', 'multipoint', 'onHead', 'eq', 'volumeEq']));
  });

  it('subscribes to runtime info and setting changes with plain requests', async () => {
    const { buds } = await connected();
    const subscribed = buds.requests
      .filter((request) => request.type === PacketType.Request)
      .map((request) => request.methodId);
    expect(subscribed).toContain(rpcHash(Method.SubscribeRuntimeInfo));
    expect(subscribed).toContain(rpcHash(Method.SubscribeToSettingsChanges));
  });

  it('drops the controls for settings the buds refuse to read', async () => {
    const { device } = await connected(scripted({}, { [SettingId.UserEq]: null, [SettingId.VolumeEq]: null, [SettingId.Multipoint]: null }));
    expect(device.state.capabilities).toEqual(new Set(['firmware', 'battery', 'anc', 'onHead']));
    expect(device.state.eq).toBeNull();
    expect(device.state.multipoint).toBeNull();
    expect(device.state.status).toBe('connected');
  });

  it('survives a hardware-info refusal', async () => {
    const script = scripted();
    script.unary[Method.GetHardwareInfo] = () => ({ status: 2 });
    const { device } = await connected(script);
    expect(device.state.info.serials).toBeNull();
    expect(device.state.capabilities.has('anc')).toBe(true);
  });

  // UNVERIFIED fallback path: pbpctrl never asks, it only listens.
  it('finds the channel by asking when the buds announce nothing, and says so', async () => {
    const { device, buds } = await connected(scripted({ announce: false, channel: 24 }));
    expect(device.state.status).toBe('connected');
    expect(device.state.channel).toBe(24);
    expect(device.state.channelProbed).toBe(true);
    const probed = buds.requests.filter((request) => request.methodId === rpcHash(Method.GetSoftwareInfo)).map((request) => request.channelId);
    expect(probed.slice(0, 5)).toEqual([18, 19, 21, 23, 24]);
  });

  it('releases a port that never speaks Maestro, with an explanation', async () => {
    const { device, buds } = await connected(scripted({ announce: false, unary: {} }));
    expect(device.state.status).toBe('disconnected');
    expect(device.state.error).toBe('This does not look like a Google Pixel Buds Pro.');
    expect(buds.transport().isOpen).toBe(false);
    expect(device.state.info.model).toBeNull();
    expect(device.snapshot()).toBeNull();
  });

  it('refuses a Bluetooth LE target', async () => {
    const device = new PixelBudsDevice(fakeBuds(scripted()).open, FAST);
    await device.adoptPort({ id: 'ble', gatt: {} } as unknown as BluetoothDevice);
    expect(device.state.error).toMatch(/Bluetooth Classic/);
  });
});

describe('PixelBudsDevice live updates', () => {
  it('applies a pushed ANC change and a pushed battery update', async () => {
    const { device, buds } = await connected();
    buds.push(Method.SubscribeToSettingsChanges, bytes('22 02 68 03'));
    expect(device.state.ancMode).toBe(3);
    buds.push(Method.SubscribeRuntimeInfo, bytes('32 06 12 04 08 33 10 01'));
    expect(device.state.battery).toEqual([{ device: 'left', level: 51, charging: false }]);
    expect(device.state.placement).toBeNull();
  });

  it('ignores a pushed setting it does not model and one that will not parse', async () => {
    const { device, buds } = await connected();
    const before = device.state;
    buds.push(Method.SubscribeToSettingsChanges, bytes('22 03 88 01 05'));
    buds.push(Method.SubscribeToSettingsChanges, [0x22, 0x05, 0x01]);
    expect(device.state).toBe(before);
  });

  it('records the raw conversation both ways, from the connect marker', async () => {
    const { device } = await connected();
    const log = device.protocolLog;
    expect(log[0].direction).toBe('connect');
    expect(log.some((entry) => entry.direction === 'tx' && entry.bytes[0] === 0x7e)).toBe(true);
    expect(log.some((entry) => entry.direction === 'rx')).toBe(true);
  });
});

describe('PixelBudsDevice writes', () => {
  it('writes the ANC state and keeps it', async () => {
    const { device, buds } = await connected();
    await device.setAncMode(3);
    expect(device.state.ancMode).toBe(3);
    expect(writesOf(buds)).toEqual(['22 02 68 03']);
  });

  it('rolls an ANC write back on a refusal and reports it', async () => {
    const script = scripted();
    script.unary[Method.WriteSetting] = () => ({ status: 2 });
    const { device } = await connected(script);
    await device.setAncMode(1);
    expect(device.state.ancMode).toBe(2);
    expect(device.state.error).toMatch(/UNKNOWN/);
    expect(device.state.adaptiveRefused).toBe(false);
  });

  it('withdraws Adaptive for the session when the buds refuse it', async () => {
    const script = scripted();
    script.unary[Method.WriteSetting] = () => ({ status: 3 });
    const { device } = await connected(script);
    await device.setAncMode(4);
    expect(device.state.ancMode).toBe(2);
    expect(device.state.adaptiveRefused).toBe(true);
    expect(device.state.error).toBe('These earbuds do not support Adaptive.');
  });

  it('writes the bool settings and rolls each back on a refusal', async () => {
    const { device, buds } = await connected();
    await device.setMultipoint(false);
    await device.setOnHeadDetection(false);
    await device.setVolumeEq(true);
    expect(device.state).toMatchObject({ multipoint: false, onHeadDetection: false, volumeEq: true });
    expect(writesOf(buds)).toEqual(['22 02 58 00', '22 02 10 00', '22 02 78 01']);

    const script = scripted();
    script.unary[Method.WriteSetting] = () => ({ status: 2 });
    const refused = await connected(script);
    await refused.device.setMultipoint(false);
    expect(refused.device.state.multipoint).toBe(true);
    expect(refused.device.state.error).toMatch(/failed/);
  });

  it('clamps and rounds the EQ to ±6 dB in 0.1 steps, and writes all five bands', async () => {
    const { device, buds } = await connected();
    await device.setEq([9, -9, 0.04, 2.26, 0]);
    expect(device.state.eq).toEqual([6, -6, 0, 2.3, 0]);
    // 6.0 = 40c00000, -6.0 = c0c00000, 2.3f = 40133333; the zero bands are omitted
    expect(writesOf(buds)).toEqual(['22 12 82 01 0f 0d 00 00 c0 40 15 00 00 c0 c0 25 33 33 13 40']);
  });

  it('rolls the EQ back when the write fails, and ignores a wrong band count', async () => {
    const script = scripted();
    script.unary[Method.WriteSetting] = () => ({ status: 2 });
    const { device, buds } = await connected(script);
    await device.setEq([0, 0, 0, 0, 0]);
    expect(device.state.eq).toEqual([1.5, 0, -6, 0, 6]);
    const before = buds.requests.length;
    await device.setEq([1, 2]);
    expect(buds.requests).toHaveLength(before);
  });

  it('writes nothing when not connected', async () => {
    const device = new PixelBudsDevice(fakeBuds(scripted()).open, FAST);
    await device.setAncMode(1);
    await device.setEq([0, 0, 0, 0, 0]);
    await device.setMultipoint(true);
    expect(device.state.ancMode).toBeNull();
  });
});

describe('PixelBudsDevice query box', () => {
  it('sends only the read-only queries and returns the reply as hex', async () => {
    const { device, buds } = await connected();
    expect(await device.sendQuery('read 13')).toBe('22 02 68 02');
    expect(await device.sendQuery('software')).toBe(hex(SOFTWARE));
    expect(buds.requests.at(-1)!.methodId).toBe(rpcHash(Method.GetSoftwareInfo));
  });

  it('refuses anything that is not a read, before it reaches the link', async () => {
    const { device, buds } = await connected();
    const before = buds.requests.length;
    await expect(device.sendQuery('write 13 2')).rejects.toThrow(/software, hardware, or read/);
    await expect(device.sendQuery('')).rejects.toThrow();
    expect(buds.requests).toHaveLength(before);
  });

  it('says so when not connected', async () => {
    const device = new PixelBudsDevice(fakeBuds(scripted()).open, FAST);
    await expect(device.sendQuery('software')).rejects.toThrow('Not connected.');
  });
});

describe('PixelBudsDevice teardown and persistence', () => {
  it('cancels both streams, closes the link, and keeps what it knew', async () => {
    const { device, buds } = await connected();
    await device.disconnect();
    const cancelled = buds.requests.filter((request) => request.type === PacketType.ClientError).map((request) => request.methodId);
    expect(cancelled).toEqual([rpcHash(Method.SubscribeRuntimeInfo), rpcHash(Method.SubscribeToSettingsChanges)]);
    expect(buds.transport().isOpen).toBe(false);
    expect(device.state.status).toBe('disconnected');
    expect(device.state.info.model).toBe('Pixel Buds Pro');
    expect(device.state.ancMode).toBe(2);
    expect(device.state.battery).toEqual([]);
    expect(device.state.channel).toBeNull();
  });

  it('resets live state but keeps identity and settings on an unexpected drop', async () => {
    const { device, buds } = await connected();
    buds.transport().drop(new Error('link lost'));
    expect(device.state.status).toBe('disconnected');
    expect(device.state.error).toContain('link lost');
    expect(device.state.battery).toEqual([]);
    expect(device.state.info.firmware?.case).toBe('1.2.3');
    expect(device.state.eq).toEqual([1.5, 0, -6, 0, 6]);
  });

  it('snapshots durable settings and restores them onto a fresh device, but not while connected', async () => {
    const { device } = await connected();
    const snapshot = device.snapshot()!;
    expect(snapshot).toBeTruthy();

    const fresh = new PixelBudsDevice(fakeBuds(scripted()).open, FAST);
    fresh.restore(snapshot);
    expect(fresh.state.info.model).toBe('Pixel Buds Pro');
    expect(fresh.state.ancMode).toBe(2);
    expect(fresh.state.eq).toEqual([1.5, 0, -6, 0, 6]);
    expect(fresh.state.capabilities.has('anc')).toBe(true);
    expect(fresh.state.battery).toEqual([]);

    const live = await connected(scripted({}, { [SettingId.AncState]: bytes('22 02 68 01') }));
    live.device.restore(snapshot);
    expect(live.device.state.ancMode).toBe(1);
  });

  it('notifies subscribers and stops after unsubscribe', async () => {
    const buds = fakeBuds(scripted());
    const device = new PixelBudsDevice(buds.open, FAST);
    const seen: string[] = [];
    const off = device.subscribe((state) => seen.push(state.status));
    await device.adoptPort(port);
    expect(seen).toContain('connecting');
    expect(seen).toContain('connected');
    off();
    const count = seen.length;
    await device.disconnect();
    expect(seen).toHaveLength(count);
  });
});
