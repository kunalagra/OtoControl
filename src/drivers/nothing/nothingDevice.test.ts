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
 * instead; over serial there is no model code, so the timeout *is* the gate.
 */
function deviceReply(command: number): number[] | undefined {
  switch (command) {
    case C.Read.Battery:
      // Left 80%, right 60% charging, case absent.
      return [0x02, 0x02, 0x50, 0x03, 0xe0];
    case C.Read.Firmware:
      return ascii('US.B.1.2.3');
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
  }, 20000);

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
});
