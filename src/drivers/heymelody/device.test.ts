import { describe, expect, it } from 'vitest';

import { HeyMelodyDevice } from './device';
import { Cmd, replyFor } from './commands';
import { SppFrameCodec, encodeSppFrame } from './sppFrame';
import { FakeTransport } from '@/core/fakeTransport.test-helper';
import type { TransportOpener } from '@/core/transport';

/** `adoptPort` is the test entry point — `connect()` would need the picker. */
const port = {} as SerialPort;

/** A responder keyed by command id, built on the real codec so fixtures can't drift from Task 2/6. */
function heyMelodyOpener(replies: Map<number, number[]>): TransportOpener {
  return async (_port, handlers) => {
    const transport = new FakeTransport(handlers);
    const decoder = new SppFrameCodec().createDecoder();
    transport.onWrite = (bytes) => {
      const [frame] = decoder.push(bytes);
      if (!frame) return;
      const reply = replies.get(frame.cmd);
      if (reply === undefined) return;
      queueMicrotask(() => transport.receive(encodeSppFrame(replyFor(frame.cmd), frame.seq, reply)));
    };
    return transport;
  };
}

const FULL_REPLIES = new Map<number, number[]>([
  [Cmd.QueryProductId, [0x00, 0x10, 0xf0, 0x06]], // -> productId "06F010", OPPO Enco Air4s
  [Cmd.Battery, [0x01, 0x01, 0xd4]], // count=1, left, packed 0xD4 -> level 84, charging
  [Cmd.QueryAncDirect, [3, 1, 2, 50]], // outer=3, inner=1 (currentMode), mType=2, level=50
  [Cmd.QueryEqCurrent, [0x01, 0x00]],
  [Cmd.QueryEqAll, [0]], // zero presets — simplest valid payload
  [Cmd.RegisterNotify, []],
]);

describe('HeyMelodyDevice connect', () => {
  it('identifies the device via the catalog and reads battery/ANC/EQ', async () => {
    const device = new HeyMelodyDevice(heyMelodyOpener(FULL_REPLIES), { timeoutMs: 50 });
    await device.adoptPort(port);

    expect(device.state.status).toBe('connected');
    expect(device.state.info.productId).toBe('06F010');
    expect(device.state.info.catalog?.name).toBe('OPPO Enco Air4s');
    expect(device.state.info.catalog?.brand).toBe('oppo');
    // `model` is the catalog-resolved display name the sidebar/manager read
    // generically off every driver — see the note on `HeyMelodyInfo`.
    expect(device.state.info.model).toBe('OPPO Enco Air4s');
    expect(device.state.battery).toEqual([{ device: 'left', level: 84, charging: true }]);
    expect(device.state.ancLevel).toBe(50);
    expect(device.state.eqCurrentPreset).toBe(1);
    expect(device.state.capabilities).toEqual(new Set(['battery', 'anc', 'eq']));
  });

  it('tolerates every command going unanswered', async () => {
    const device = new HeyMelodyDevice(heyMelodyOpener(new Map()), { timeoutMs: 20 });
    await device.adoptPort(port);

    expect(device.state.status).toBe('connected');
    expect(device.state.info.productId).toBeNull();
    expect(device.state.info.catalog).toBeNull();
    expect(device.state.capabilities.size).toBe(0);
  });

  it('does not mark ANC as a capability when the direct-query response is not a currentMode DTO', async () => {
    // Exercises the documented risk (spec §6): 0x010C's response shape is
    // unconfirmed. A `reduction`-shaped reply must not be silently accepted
    // as ANC support.
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.QueryAncDirect, [3, 2, 1, 2, 0x0a, 0x00]); // a 'reduction' event, not 'currentMode'
    const device = new HeyMelodyDevice(heyMelodyOpener(replies), { timeoutMs: 50 });
    await device.adoptPort(port);

    expect(device.state.capabilities.has('anc')).toBe(false);
    expect(device.state.ancLevel).toBeNull();
  });

  it('still marks eq capable off QueryEqAll alone when QueryEqCurrent goes unanswered', async () => {
    // The two EQ reads must not be coupled in one try/catch (spec §3.5) —
    // 0x0122 (QueryEqAll) is what actually supplies the Sound section's
    // preset list, so it must still be attempted, and still count, even when
    // 0x010F (QueryEqCurrent) is left unanswered.
    const replies = new Map(FULL_REPLIES);
    replies.delete(Cmd.QueryEqCurrent);
    replies.set(Cmd.QueryEqAll, [
      1, // one preset
      1, // isSelected
      0xfa, // minValue -6
      0x06, // maxValue 6
      1, // eqId
      3, // name length
      0x50,
      0x6f,
      0x70, // "Pop"
      0, // frequencyNum
    ]);
    const device = new HeyMelodyDevice(heyMelodyOpener(replies), { timeoutMs: 50 });
    await device.adoptPort(port);

    expect(device.state.capabilities.has('eq')).toBe(true);
    expect(device.state.eqCurrentPreset).toBeNull();
    expect(device.state.eqPresets).toHaveLength(1);
    expect(device.state.eqPresets[0]).toMatchObject({ eqId: 1, name: 'Pop', isSelected: true });
  });
});

describe('HeyMelodyDevice live ANC updates', () => {
  it('applies an unsolicited 0x0204 notification', async () => {
    let transport!: FakeTransport;
    const open: TransportOpener = async (_p, handlers) => {
      transport = new FakeTransport(handlers);
      const decoder = new SppFrameCodec().createDecoder();
      transport.onWrite = (bytes) => {
        const [frame] = decoder.push(bytes);
        if (!frame) return;
        const reply = FULL_REPLIES.get(frame.cmd);
        if (reply === undefined) return;
        queueMicrotask(() => transport.receive(encodeSppFrame(replyFor(frame.cmd), frame.seq, reply)));
      };
      return transport;
    };
    const device = new HeyMelodyDevice(open, { timeoutMs: 50 });
    await device.adoptPort(port);
    expect(device.state.ancLevel).toBe(50);

    transport.receive(encodeSppFrame(Cmd.ActiveReport, 0x01, [3, 1, 2, 75]));
    expect(device.state.ancLevel).toBe(75);
  });
});

describe('HeyMelodyDevice writes', () => {
  it('setAncMode applies optimistically and rolls back on failure', async () => {
    const replies = new Map(FULL_REPLIES);
    // SetAncMode is left unanswered, so the client's own timeout rejects it.
    const device = new HeyMelodyDevice(heyMelodyOpener(replies), { timeoutMs: 20 });
    await device.adoptPort(port);
    const before = device.state.ancLevel;

    await device.setAncMode(3);

    expect(device.state.ancLevel).toBe(before);
    expect(device.state.error).not.toBeNull();
  });

  it('setEqPreset applies optimistically and keeps the value once acknowledged', async () => {
    const replies = new Map(FULL_REPLIES);
    replies.set(Cmd.SetEqPreset, []);
    const device = new HeyMelodyDevice(heyMelodyOpener(replies), { timeoutMs: 50 });
    await device.adoptPort(port);

    await device.setEqPreset(2);

    expect(device.state.eqCurrentPreset).toBe(2);
    expect(device.state.error).toBeNull();
  });
});

describe('HeyMelodyDevice disconnect caching', () => {
  it('keeps showing the identified device after an unexpected drop', async () => {
    let transport!: FakeTransport;
    const open: TransportOpener = async (_p, handlers) => {
      transport = new FakeTransport(handlers);
      const decoder = new SppFrameCodec().createDecoder();
      transport.onWrite = (bytes) => {
        const [frame] = decoder.push(bytes);
        if (!frame) return;
        const reply = FULL_REPLIES.get(frame.cmd);
        if (reply === undefined) return;
        queueMicrotask(() => transport.receive(encodeSppFrame(replyFor(frame.cmd), frame.seq, reply)));
      };
      return transport;
    };
    const device = new HeyMelodyDevice(open, { timeoutMs: 50 });
    await device.adoptPort(port);
    expect(device.state.info.productId).toBe('06F010');

    transport.drop(new Error('The device has been lost.'));

    // Same fix as every other driver's onDrop/disconnect (see
    // src/drivers/sony/sony.ts, src/drivers/nothing/device.ts, etc.) —
    // applied here from the start rather than as a later bugfix.
    expect(device.state.status).toBe('disconnected');
    expect(device.state.info.productId).toBe('06F010');
    expect(device.state.info.catalog?.name).toBe('OPPO Enco Air4s');
    expect(device.state.info.model).toBe('OPPO Enco Air4s');
    // Live-only fields still reset.
    expect(device.state.battery).toEqual([]);
  });

  it('keeps showing the identified device after a manual disconnect', async () => {
    const device = new HeyMelodyDevice(heyMelodyOpener(FULL_REPLIES), { timeoutMs: 50 });
    await device.adoptPort(port);
    expect(device.state.info.productId).toBe('06F010');

    await device.disconnect();

    expect(device.state.status).toBe('disconnected');
    expect(device.state.info.productId).toBe('06F010');
    expect(device.state.info.model).toBe('OPPO Enco Air4s');
  });

  it('makes no claim about a device that was never identified', async () => {
    const device = new HeyMelodyDevice();
    await device.disconnect();
    expect(device.state.info.productId).toBeNull();
    expect(device.state.info.model).toBeNull();
  });
});
