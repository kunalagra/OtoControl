import { describe, expect, it } from 'vitest';

import { NothingDevice } from './device';
import * as C from './commands';
import { NothingDecoder, encodePacket } from './frame';
import { FakeTransport, ascii } from '@/core/fakeTransport.test-helper';
import type { TransportOpener } from '@/core/transport';

/** `adoptPort` is the test entry point — `connect()` would need the picker. */
const port = {} as SerialPort;

/**
 * Answers the reads a healthy device answers, and stays silent on the rest —
 * silence is how a real model says "not implemented", and the probe turns it
 * into an absent capability. ear-web gates the same queries on the model code
 * instead; this driver reads the code (`DeviceModel`) for the *name* but
 * still lets the timeout gate the features.
 */
function deviceReply(command: number): number[] | undefined {
  switch (command) {
    case C.Read.Battery:
      // Left 80%, right 60% charging, case absent.
      return [0x02, 0x02, 0x50, 0x03, 0xe0];
    case C.Read.Firmware:
      return ascii('US.B.1.2.3');
    case C.Read.DeviceModel:
      // The product id is little-endian bytes, not text: B162 is 0x62 0xB1.
      return [0x62, 0xb1];
    case C.Read.EqPreset:
      return [0x00];
    case C.Read.AncMode:
      return [0x01, 0x05, 0x00]; // level 1, off
    default:
      return undefined;
  }
}

function nothingOpener(): TransportOpener {
  return async (_port, handlers) => {
    const transport = new FakeTransport(handlers);
    transport.onWrite = (bytes) => {
      const [frame] = new NothingDecoder().push(bytes);
      if (!frame) return;
      const reply = deviceReply(frame.command);
      if (reply === undefined) return;
      queueMicrotask(() => transport.receive(encodePacket(frame.command & 0x7fff, frame.sequence, reply)));
    };
    return transport;
  };
}

/**
 * Answers every read, so no probe times out — for tests that only need a
 * connected device quickly. The timeout-driven probing is covered once, by
 * `nothingOpener`, at the cost this suite only pays once.
 */
function eagerOpener(): TransportOpener {
  return async (_port, handlers) => {
    const transport = new FakeTransport(handlers);
    transport.onWrite = (bytes) => {
      const [frame] = new NothingDecoder().push(bytes);
      if (!frame) return;
      const reply = deviceReply(frame.command) ?? [0x00];
      queueMicrotask(() => transport.receive(encodePacket(frame.command & 0x7fff, frame.sequence, reply)));
    };
    return transport;
  };
}

describe('NothingDevice', () => {
  it('connects, decodes what the device answers, and probes capabilities', async () => {
    const device = new NothingDevice(nothingOpener());
    await device.adoptPort(port);

    expect(device.state.status).toBe('connected');
    expect(device.state.info.firmware).toBe('US.B.1.2.3');
    // Identity comes off the wire: a Web Serial port carries no device name,
    // so this read is the only thing that can name the model.
    expect(device.state.info.modelBase).toBe('B162');
    expect(device.state.info.model).toBe('Nothing Ear (a)');
    expect(device.state.battery.left).toEqual({ level: 80, charging: false });
    // 0xe0: level 0x60 with the charging bit set.
    expect(device.state.battery.right).toEqual({ level: 96, charging: true });
    expect(device.state.battery.case).toBeNull();
    expect(device.state.eqPreset).toBe(0);
    expect(device.state.anc).toBe(1);

    // Answered reads become capabilities; the silent ones (custom EQ,
    // gestures, enhanced bass, …) must not.
    for (const capability of ['battery', 'eq', 'anc'] as const) {
      expect(device.state.capabilities.has(capability)).toBe(true);
    }
    for (const capability of ['customEq', 'gestures', 'enhancedBass', 'personalizedAnc'] as const) {
      expect(device.state.capabilities.has(capability)).toBe(false);
    }
    // This test walks the whole of `refresh` against a device that answers
    // four reads, so every other request times out. That is the worst case the
    // connect path can have: two reads at the full 1500 ms (the model read and
    // the firmware read) and twenty at the 400 ms probe timeout — about 11 s.
    // The budget is deliberately close to it, so making `refresh` ask more
    // questions, or asking them more patiently, fails here first.
  }, 16000);

  it('applies a battery notification pushed by the device', async () => {
    let transport: FakeTransport | null = null;
    const open: TransportOpener = async (_p, handlers) => {
      transport = new FakeTransport(handlers);
      transport.onWrite = (bytes) => {
        const [frame] = new NothingDecoder().push(bytes);
        if (!frame) return;
        const reply = deviceReply(frame.command) ?? [0x00];
        queueMicrotask(() => transport?.receive(encodePacket(frame.command & 0x7fff, frame.sequence, reply)));
      };
      return transport;
    };

    const device = new NothingDevice(open);
    await device.adoptPort(port);
    transport!.receive(encodePacket(C.Notify.Battery, 0, [0x01, 0x04, 0x64]));
    expect(device.state.battery.case).toEqual({ level: 100, charging: false });
  }, 20000);

  it('refuses to restore over a live connection', async () => {
    // Pins NothingDevice's own `isConnected` hook: a stale cache must never
    // overwrite what the hardware just reported.
    const device = new NothingDevice(eagerOpener());
    await device.adoptPort(port);

    const before = device.state.info.firmware;
    device.restore({
      info: { model: 'Nothing Ear (a)', modelBase: 'B162', firmware: '0.0.0' },
      anc: null,
      personalizedAnc: null,
      eqPreset: null,
      customEq: null,
      diracEq: null,
      advancedEq: null,
      bassEnhance: null,
      inEarDetection: null,
      lowLatency: null,
      gestures: null,
      capabilities: [],
    });
    expect(device.state.info.firmware).toBe(before);
  }, 20000);

  it('reads spatial audio with head tracking, and writes both bytes back', async () => {
    const sent: number[][] = [];
    const open: TransportOpener = async (_p, handlers) => {
      const transport = new FakeTransport(handlers);
      transport.onWrite = (bytes) => {
        const [frame] = new NothingDecoder().push(bytes);
        if (!frame) return;
        if (frame.command === C.Write.SetSpatialAudio) {
          sent.push([...frame.payload]);
          return; // writes are never answered
        }
        const reply =
          frame.command === C.Read.SpatialAudio ? [0x01, 0x00] : deviceReply(frame.command) ?? [0x00];
        queueMicrotask(() => transport.receive(encodePacket(frame.command & 0x7fff, frame.sequence, reply)));
      };
      return transport;
    };

    const device = new NothingDevice(open);
    await device.adoptPort(port);

    expect(device.state.capabilities.has('spatialAudio')).toBe(true);
    expect(device.state.spatialAudio).toEqual({ enabled: true, headTracking: false });

    // Turning head tracking on must keep the two-byte form: a model that
    // reported head tracking has state for the second byte.
    await device.setSpatialAudio(true, true);
    expect(sent).toEqual([[0x01, 0x01]]);
    expect(device.state.spatialAudio).toEqual({ enabled: true, headTracking: true });
  }, 20000);

  it('keeps spatial audio one byte wide on a model without head tracking', async () => {
    const sent: number[][] = [];
    const open: TransportOpener = async (_p, handlers) => {
      const transport = new FakeTransport(handlers);
      transport.onWrite = (bytes) => {
        const [frame] = new NothingDecoder().push(bytes);
        if (!frame) return;
        if (frame.command === C.Write.SetSpatialAudio) {
          sent.push([...frame.payload]);
          return;
        }
        const reply =
          frame.command === C.Read.SpatialAudio ? [0x00] : deviceReply(frame.command) ?? [0x00];
        queueMicrotask(() => transport.receive(encodePacket(frame.command & 0x7fff, frame.sequence, reply)));
      };
      return transport;
    };

    const device = new NothingDevice(open);
    await device.adoptPort(port);
    expect(device.state.spatialAudio).toEqual({ enabled: false, headTracking: null });

    await device.setSpatialAudio(true);
    expect(sent).toEqual([[0x01]]);
    expect(device.state.spatialAudio).toEqual({ enabled: true, headTracking: null });
  }, 20000);

  it('stays connected and unnamed when the model read goes unanswered', async () => {
    // The model read is not a capability: a device that will not name itself
    // must still connect and drive everything else, rather than the read
    // failure taking the session down with it.
    const open: TransportOpener = async (_p, handlers) => {
      const transport = new FakeTransport(handlers);
      transport.onWrite = (bytes) => {
        const [frame] = new NothingDecoder().push(bytes);
        if (!frame || frame.command === C.Read.DeviceModel) return;
        const reply = deviceReply(frame.command) ?? [0x00];
        queueMicrotask(() => transport.receive(encodePacket(frame.command & 0x7fff, frame.sequence, reply)));
      };
      return transport;
    };

    const device = new NothingDevice(open);
    await device.adoptPort(port);

    expect(device.state.status).toBe('connected');
    expect(device.state.info.modelBase).toBeNull();
    expect(device.state.info.model).toBeNull();
    expect(device.state.info.firmware).toBe('US.B.1.2.3');
    expect(device.state.capabilities.has('battery')).toBe(true);
  }, 20000);

  it('keeps a wire-read name a firmware string cannot account for', async () => {
    // The firmware read patches `info` after the model read. It used to write
    // `model: this.#modelName(firmware)` unconditionally, so a model that had
    // just named itself was immediately un-named again — `modelForFirmware`
    // returns null for every input.
    const open: TransportOpener = async (_p, handlers) => {
      const transport = new FakeTransport(handlers);
      transport.onWrite = (bytes) => {
        const [frame] = new NothingDecoder().push(bytes);
        if (!frame) return;
        const reply =
          frame.command === C.Read.DeviceModel ? [0x75, 0xb1] : deviceReply(frame.command) ?? [0x00];
        queueMicrotask(() => transport.receive(encodePacket(frame.command & 0x7fff, frame.sequence, reply)));
      };
      return transport;
    };

    const device = new NothingDevice(open);
    await device.adoptPort(port);

    expect(device.state.info.modelBase).toBe('B175');
    expect(device.state.info.model).toBe('CMF Headphone Pro');
    expect(device.state.info.firmware).toBe('US.B.1.2.3');
  }, 20000);
});

describe('NothingDevice disconnect caching', () => {
  it('keeps showing the identified model after an unexpected drop', async () => {
    let transport: FakeTransport | null = null;
    const open: TransportOpener = async (_p, handlers) => {
      transport = new FakeTransport(handlers);
      transport.onWrite = (bytes) => {
        const [frame] = new NothingDecoder().push(bytes);
        if (!frame) return;
        const reply = deviceReply(frame.command) ?? [0x00];
        queueMicrotask(() => transport?.receive(encodePacket(frame.command & 0x7fff, frame.sequence, reply)));
      };
      return transport;
    };

    const device = new NothingDevice(open);
    await device.adoptPort(port);
    expect(device.state.info.model).toBe('Nothing Ear (a)');

    transport!.drop(new Error('The device has been lost.'));

    // The sidebar identifies the device off `info.model` — losing it here is
    // what makes a known device render as the generic "no device" placeholder
    // the moment it drops, instead of its own dimmed artwork.
    expect(device.state.status).toBe('disconnected');
    expect(device.state.info.model).toBe('Nothing Ear (a)');
    // Battery is a live reading, not a setting — it must not survive
    // alongside the identity fields above.
    expect(device.state.battery.left).toBeNull();
  });

  it('keeps showing the identified model after a manual disconnect', async () => {
    const device = new NothingDevice(eagerOpener());
    await device.adoptPort(port);
    expect(device.state.info.model).toBe('Nothing Ear (a)');

    await device.disconnect();

    expect(device.state.status).toBe('disconnected');
    expect(device.state.info.model).toBe('Nothing Ear (a)');
  });

  it('makes no claim about a device that was never identified', async () => {
    // `#lastKnownDurable()` is shared by `onDrop` and `disconnect()` — pinning
    // it here against a device that never read anything is enough to cover
    // both call sites without standing up a transport for each.
    const device = new NothingDevice();
    await device.disconnect();

    expect(device.state.status).toBe('disconnected');
    expect(device.state.info.model).toBeNull();
  });
});
