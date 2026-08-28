import { describe, expect, it } from 'vitest';

import { SonyDevice, captureDurable, initialSonyState } from './sony';
import { FakeTransport, ascii } from '@/core/fakeTransport.test-helper';
import type { ConnectionTarget, Transport, TransportOpener } from '@/core/transport';
import { Command, DeviceInfoType, Reply } from './mdr/commands';
import { DataType, MdrDecoder, encodeFrame } from './mdr/frame';

/** `adoptPort` is the test entry point — `connect()` would need the picker. */
const port = {} as SerialPort;

/**
 * Answers the five reads `#handshake` makes (protocol info, model, firmware,
 * series/colour, supported functions), so `#readFeatures` has nothing left to
 * poll and `adoptPort` settles quickly. The model name is real — `WF-C500`,
 * length-prefixed per `decodeDeviceInfoText` (`./mdr/commands.ts:171-175`,
 * length at byte 2) — so a test that reads it back is asserting the data path
 * actually decoded something, not just that the handshake didn't time out.
 *
 * Deliberately not `gaiaHarness`: MDR framing (escaped, checksummed,
 * length-prefixed, every data frame ACKed) is nothing like GAIA's, so a
 * responder built for one would be silently wrong for the other. This one
 * only needs to survive the fixed handshake sequence, not arbitrary Sony
 * commands — a full MDR responder is the known gap left for the next phase.
 */
function handshakeReply(command: number, inquiry: number | undefined): number[] | undefined {
  switch (command) {
    case Command.GetProtocolInfo:
      return [Reply.ProtocolInfo, 0x00];
    case Command.GetDeviceInfo:
      // Series/colour has no length byte (see `decodeSeriesAndColour`); model
      // and firmware do, and a declared length of 0 decodes to ''.
      if (inquiry === DeviceInfoType.SeriesAndColour) {
        return [Reply.DeviceInfo, inquiry, 0x00, 0x00];
      }
      if (inquiry === DeviceInfoType.ModelName) {
        const name = ascii('WF-C500');
        return [Reply.DeviceInfo, inquiry, name.length, ...name];
      }
      return [Reply.DeviceInfo, inquiry ?? 0x00, 0x00];
    case Command.GetSupportFunction:
      return [Reply.SupportFunction, 0x00, 0x00]; // count 0 — nothing to poll
    default:
      return undefined;
  }
}

/**
 * A `TransportOpener` wired to `handshakeReply`, for tests that only need a
 * connected device and don't need to inspect the transport themselves.
 */
function sonyHandshakeOpener(): TransportOpener {
  return async (_port, handlers) => {
    const transport = new FakeTransport(handlers);
    transport.onWrite = (bytes) => {
      const [frame] = new MdrDecoder().push(bytes);
      if (!frame || frame.dataType !== DataType.Command1) return;
      const reply = handshakeReply(frame.payload[0], frame.payload[1]);
      if (!reply) return;
      const sequence = frame.sequence;
      queueMicrotask(() => transport.receive(encodeFrame(DataType.Command1, sequence, reply)));
    };
    return transport;
  };
}

describe('SonyDevice as a Persistable', () => {
  it('refuses to restore over a live connection', async () => {
    // Pins SonyDevice's own `isConnected` hook. stateStore.test.ts proves the
    // refusal policy against a fake state shape; nothing there ties it to
    // `state.status === 'connected'` specifically — a typo'd predicate here
    // would leave every existing test green while letting a stale cache
    // silently overwrite a live reading.
    const device = new SonyDevice(sonyHandshakeOpener());
    await device.adoptPort(port);
    expect(device.state.status).toBe('connected');

    const before = device.state.info.model;
    device.restore(
      captureDurable({
        ...initialSonyState,
        info: { ...initialSonyState.info, model: 'SOME-OTHER-MODEL' },
      }),
    );

    // A stale cache must never overwrite what the hardware just reported.
    expect(device.state.info.model).toBe(before);
  });
});

describe('SonyDevice transport seam', () => {
  it('opens through the injected opener and reports an unexpected drop', async () => {
    let transport: FakeTransport | null = null;
    let openedWith: ConnectionTarget | null = null;
    const open: TransportOpener = async (p, handlers) => {
      openedWith = p;
      transport = new FakeTransport(handlers);
      transport.onWrite = (bytes) => {
        const [frame] = new MdrDecoder().push(bytes);
        // The client also writes its own ACKs for every reply it receives —
        // those are `DataType.Ack`, carry no payload, and need no answer.
        // Both command tables: voice guidance rides the second one.
        if (!frame || frame.dataType !== DataType.Command1) return;
        const reply = handshakeReply(frame.payload[0], frame.payload[1]);
        if (!reply) return;
        // Mirrors the request's own sequence bit rather than hardcoding 0.
        // `MdrClient#dispatch` never actually checks it when matching a reply
        // to a pending request (see `./mdr/client.ts:116-121`), so this buys
        // nothing for correctness — it is honesty about what a real device
        // would send back.
        const sequence = frame.sequence;
        // A later microtask, as in `gaiaHarness`: the client registers its
        // pending request around the write, and answering inline would be a
        // tighter race than any real transport produces.
        queueMicrotask(() =>
          transport?.receive(encodeFrame(DataType.Command1, sequence, reply)),
        );
      };
      return transport;
    };

    const device = new SonyDevice(open);
    await device.adoptPort(port);

    // Proves the seam: the port passed to `adoptPort` reached the injected
    // opener rather than a `SerialTransport` `SonyDevice` built itself.
    expect(openedWith).toBe(port);
    expect(device.state.status).toBe('connected');

    // Proves the data path, not just that the handshake didn't time out:
    // `status` flips to 'connected' at `sony.ts:285`, before `refresh()` ever
    // runs, so it would read 'connected' even if `onData` were never wired to
    // the client — that failure mode would only show up as a 5 x 1200ms
    // handshake timeout. Asserting on a real decoded value closes that gap.
    expect(device.state.info.model).toBe('WF-C500');

    // Proves `#handleDrop` is reachable through the fake: `onClose` was wired
    // to the same handlers object the opener received, so this exercises the
    // real teardown path rather than something the test synthesised.
    transport!.drop(new Error('link lost'));

    expect(device.state.status).toBe('disconnected');
    expect(device.state.error).toBe('link lost');
  });
});

describe('SonyDevice disconnect caching', () => {
  it('keeps showing the identified model after an unexpected drop', async () => {
    let transport: FakeTransport | null = null;
    const open: TransportOpener = async (_p, handlers) => {
      transport = new FakeTransport(handlers);
      transport.onWrite = (bytes) => {
        const [frame] = new MdrDecoder().push(bytes);
        if (!frame || frame.dataType !== DataType.Command1) return;
        const reply = handshakeReply(frame.payload[0], frame.payload[1]);
        if (!reply) return;
        const sequence = frame.sequence;
        queueMicrotask(() => transport?.receive(encodeFrame(DataType.Command1, sequence, reply)));
      };
      return transport;
    };

    const device = new SonyDevice(open);
    await device.adoptPort(port);
    expect(device.state.info.model).toBe('WF-C500');

    transport!.drop(new Error('The device has been lost.'));

    // The sidebar identifies the device off `info.model` — losing it here is
    // what makes a known device render as the generic "no device" placeholder
    // the moment it drops, instead of its own dimmed artwork.
    expect(device.state.status).toBe('disconnected');
    expect(device.state.info.model).toBe('WF-C500');
  });

  it('keeps showing the identified model after a manual disconnect', async () => {
    const device = new SonyDevice(sonyHandshakeOpener());
    await device.adoptPort(port);
    expect(device.state.info.model).toBe('WF-C500');

    await device.disconnect();

    expect(device.state.status).toBe('disconnected');
    expect(device.state.info.model).toBe('WF-C500');
  });

  it('makes no claim about a device that was never identified', async () => {
    // `#lastKnownDurable()` is shared by `onDrop` and `disconnect()` — pinning
    // it here against a device that never read anything is enough to cover
    // both call sites without standing up a transport for each.
    const device = new SonyDevice();
    await device.disconnect();

    expect(device.state.status).toBe('disconnected');
    expect(device.state.info.model).toBeNull();
  });
});

describe('SonyDevice connect race', () => {
  it('does not report connected when the transport drops before open resolves', async () => {
    // Same race as MomentumDevice's (see device.test.ts): SerialTransport's
    // read loop queues its continuation before open()'s own promise resolves,
    // so an already-errored `readable` makes onClose fire before `#connectTo`
    // ever assigns `#client` or patches `connected`. An opener that fires
    // onClose before its returned promise settles reproduces that ordering
    // without needing real timing.
    let closed = false;
    const opener: TransportOpener = (_port, handlers) => {
      handlers.onClose(new Error('gone before open finished'));
      const deadTransport: Transport = {
        write: async () => {
          throw new Error('transport is closed');
        },
        close: async () => {
          closed = true;
        },
        isOpen: false,
      };
      return Promise.resolve(deadTransport);
    };

    const device = new SonyDevice(opener);
    await device.adoptPort(port);

    // The drop landed first, so the connect that resumes afterward must not
    // clobber it with `connected` — that would tell the app a dead transport
    // is a live link.
    expect(device.state.status).toBe('disconnected');
    expect(device.state.error).toBe('gone before open finished');
    // The transport opened for the superseded connect must not be leaked.
    expect(closed).toBe(true);
  });
});

  /**
 * A responder that completes the fixed handshake, reports a chosen set of
 * supported functions, and answers arbitrary command/inquiry pairs from a
 * table — enough to drive `refresh()` beyond the handshake without a full
 * MDR responder.
 */
function openerWithSupport(
  support: number[],
  answers: Record<string, number[]>,
): { opener: TransportOpener; sent: number[][] } {
  const sent: number[][] = [];
  const opener: TransportOpener = async (_port, handlers) => {
    const transport = new FakeTransport(handlers);
    transport.onWrite = (bytes) => {
      const [frame] = new MdrDecoder().push(bytes);
      // Both command tables: voice guidance rides the second one.
      if (!frame || (frame.dataType !== DataType.Command1 && frame.dataType !== DataType.Command2)) return;
      sent.push([...frame.payload]);
      let reply: number[] | undefined;
      if (frame.payload[0] === Command.GetSupportFunction) {
        reply = [Reply.SupportFunction, 0x00, support.length, ...support.flatMap((id) => [id, 0x00])];
      } else {
        const hex = (n: number) => `0x${n.toString(16).padStart(2, '0')}`;
        const key = `${hex(frame.payload[0])}:${hex(frame.payload[1] ?? 0)}`;
        reply = answers[key] ?? handshakeReply(frame.payload[0], frame.payload[1]);
      }
      if (!reply) return;
      const sequence = frame.sequence;
      queueMicrotask(() => transport.receive(encodeFrame(DataType.Command1, sequence, reply)));
    };
    return transport;
  };
  return { opener, sent };
}


/**
 * One device-list reply body, built the way the wire lays it out.
 *
 * Connection type `0x00`, so entries use the classic layout — mac, status,
 * name length, name, with no class of device. `opcode` picks RET (`0x37`) or
 * NTFY (`0x39`).
 */
function pairingListBody(opcode = 0x37, connectionType = 0x00): number[] {
  const e = (mac: string, status: number, name: string) => [
    ...[...mac].map((c) => c.charCodeAt(0)),
    status, name.length,
    ...[...name].map((c) => c.charCodeAt(0)),
  ];
  return [
    opcode, connectionType, 2,
    ...e('AA:BB:CC:DD:EE:FF', 1, 'Pixel'),
    ...e('11:22:33:44:55:66', 0, 'MacBook'),
    1,
  ];
}

describe('SonyDevice speak-to-chat', () => {
  it('reads enable and config when the Type-2 capability is reported', async () => {
    const { opener } = openerWithSupport([0xfc], {
      '0xf6:0x0c': [Reply.SystemParam, 0x0c, 0x00, 0x01],
      '0xfa:0x0c': [0xfb, 0x0c, 0x01, 0x02],
    });
    const device = new SonyDevice(opener);
    await device.adoptPort(port);
    expect(device.state.speakToChat).toEqual({
      enabled: true,
      sensitivity: 0x01,
      timeout: 0x02,
    });
  });

  it('leaves speak-to-chat unread when the capability is absent', async () => {
    const { opener, sent } = openerWithSupport([], {});
    const device = new SonyDevice(opener);
    await device.adoptPort(port);
    expect(device.state.speakToChat).toBeNull();
    expect(sent.some((p) => p[0] === 0xf6 && p[1] === 0x0c)).toBe(false);
  });

  it('routes a 0x0c notification to speak-to-chat, not pause-on-removal', async () => {
    // Regression: the notification dispatcher read every SYSTEM notify as
    // pause-on-removal, so a speak-to-chat push would have overwritten it.
    const { opener } = openerWithSupport([0xfc, 0xf1], {
      '0xf6:0x0c': [Reply.SystemParam, 0x0c, 0x00, 0x01],
      '0xf6:0x01': [Reply.SystemParam, 0x01, 0x00],
      '0xfa:0x0c': [0xfb, 0x0c, 0x00, 0x01],
    });
    let transport: FakeTransport | null = null;
    const wrapped: TransportOpener = async (p, handlers) => {
      transport = (await opener(p, handlers)) as FakeTransport;
      return transport;
    };
    const device = new SonyDevice(wrapped);
    await device.adoptPort(port);
    expect(device.state.pauseOnRemoval).toBe(true);

    transport!.receive(encodeFrame(DataType.Command1, 1, [Reply.SystemParamNotify, 0x0c, 0x01, 0x01]));
    expect(device.state.speakToChat?.enabled).toBe(false);
    expect(device.state.pauseOnRemoval).toBe(true);
  });

  it('writes the enable toggle optimistically and rolls back on failure', async () => {
    const { opener } = openerWithSupport([0xfc], {
      '0xf6:0x0c': [Reply.SystemParam, 0x0c, 0x00, 0x01],
      '0xfa:0x0c': [0xfb, 0x0c, 0x00, 0x01],
    });
    const wrapped: TransportOpener = async (p, handlers) => {
      const transport = (await opener(p, handlers)) as FakeTransport;
      const inner = transport.onWrite!;
      transport.onWrite = (bytes) => {
        const [frame] = new MdrDecoder().push(bytes);
        if (frame && frame.payload[0] === Command.SetSystemParam) throw new Error('write failed');
        inner(bytes);
      };
      return transport;
    };
    const device = new SonyDevice(wrapped);
    await device.adoptPort(port);
    expect(device.state.speakToChat?.enabled).toBe(true);

    await device.setSpeakToChatEnabled(false);
    expect(device.state.speakToChat?.enabled).toBe(true);
    expect(device.state.error).not.toBeNull();
  });
});

describe('SonyDevice touch assignment', () => {
  it('reads the left/right assignment when the capability is reported', async () => {
    const { opener } = openerWithSupport([0xf3], {
      '0xf6:0x03': [Reply.SystemParam, 0x03, 0x02, 0x10, 0xff],
    });
    const device = new SonyDevice(opener);
    await device.adoptPort(port);
    expect(device.state.touchAssignment).toEqual({ left: 0x10, right: 0xff });
  });

  it('does not ask without the capability', async () => {
    const { opener, sent } = openerWithSupport([0x21], {});
    const device = new SonyDevice(opener);
    await device.adoptPort(port);
    expect(device.state.touchAssignment).toBeNull();
    expect(sent.some((p) => p[0] === 0xf6 && p[1] === 0x03)).toBe(false);
  });

  it('a touch notification updates the assignment without touching speak-to-chat', async () => {
    const { opener } = openerWithSupport([0xf3, 0xfc], {
      '0xf6:0x03': [Reply.SystemParam, 0x03, 0x02, 0x10, 0xff],
      '0xf6:0x0c': [Reply.SystemParam, 0x0c, 0x00, 0x01],
      '0xfa:0x0c': [0xfb, 0x0c, 0x00, 0x01],
    });
    let transport: FakeTransport | null = null;
    const wrapped: TransportOpener = async (p, handlers) => {
      transport = (await opener(p, handlers)) as FakeTransport;
      return transport;
    };
    const device = new SonyDevice(wrapped);
    await device.adoptPort(port);

    transport!.receive(
      encodeFrame(DataType.Command1, 1, [Reply.SystemParamNotify, 0x03, 0x02, 0x20, 0x20]),
    );
    expect(device.state.touchAssignment).toEqual({ left: 0x20, right: 0x20 });
    expect(device.state.speakToChat?.enabled).toBe(true);
  });
});

describe('SonyDevice voice guidance', () => {
  it('reads the on/off on a device that reports the guidance capability', async () => {
    const { opener } = openerWithSupport([0x44], {
      '0x46:0x03': [0x47, 0x03, 0x00, 0x00],
    });
    const device = new SonyDevice(opener);
    await device.adoptPort(port);
    expect(device.state.voiceGuidance).toEqual({ enabled: true, volume: null });
  });

  it('reads the volume too when the capability includes adjustment', async () => {
    const { opener } = openerWithSupport([0x42], {
      '0x46:0x03': [0x47, 0x03, 0x01, 0x00],
      '0x46:0x20': [0x47, 0x20, 0xfe],
    });
    const device = new SonyDevice(opener);
    await device.adoptPort(port);
    expect(device.state.voiceGuidance).toEqual({ enabled: false, volume: -2 });
  });

  it('does not ask a device without the guidance capability', async () => {
    const { opener, sent } = openerWithSupport([0x61], {});
    const device = new SonyDevice(opener);
    await device.adoptPort(port);
    expect(device.state.voiceGuidance).toBeNull();
    expect(sent.some((p) => p[0] === 0x46)).toBe(false);
  });

  it('a table-2 notification updates the setting', async () => {
    const { opener } = openerWithSupport([0x44], {
      '0x46:0x03': [0x47, 0x03, 0x00, 0x00],
    });
    let transport: FakeTransport | null = null;
    const wrapped: TransportOpener = async (p, handlers) => {
      transport = (await opener(p, handlers)) as FakeTransport;
      return transport;
    };
    const device = new SonyDevice(wrapped);
    await device.adoptPort(port);

    transport!.receive(encodeFrame(DataType.Command2, 1, [0x49, 0x03, 0x01, 0x00]));
    expect(device.state.voiceGuidance?.enabled).toBe(false);
  });
});

describe('SonyDevice connections', () => {
  it('reads the paired list and playback fix on a capable device', async () => {
    const { opener } = openerWithSupport([0x30, 0x31], {
      '0x36:0x00': pairingListBody(),
      '0x36:0x01': [0x37, 0x01, 0x00],
    });
    const device = new SonyDevice(opener);
    await device.adoptPort(port);
    expect(device.state.connections).toEqual({
      devices: [
        { mac: 'AA:BB:CC:DD:EE:FF', name: 'Pixel', status: 1, connected: true, classOfDevice: null },
        { mac: '11:22:33:44:55:66', name: 'MacBook', status: 0, connected: false, classOfDevice: null },
      ],
      playbackMac: 'AA:BB:CC:DD:EE:FF',
      playbackFixed: true,
    });
  });

  it('does not ask without the pairing capability', async () => {
    const { opener, sent } = openerWithSupport([0x61], {});
    const device = new SonyDevice(opener);
    await device.adoptPort(port);
    expect(device.state.connections).toBeNull();
    expect(sent.some((p) => p[0] === 0x36)).toBe(false);
  });

  it('a list notification replaces the list, keeping the fix', async () => {
    const { opener } = openerWithSupport([0x30, 0x31], {
      '0x36:0x00': pairingListBody(),
      '0x36:0x01': [0x37, 0x01, 0x00],
    });
    let transport: FakeTransport | null = null;
    const wrapped: TransportOpener = async (p, handlers) => {
      transport = (await opener(p, handlers)) as FakeTransport;
      return transport;
    };
    const device = new SonyDevice(wrapped);
    await device.adoptPort(port);

    // PERI_NTFY_PARAM, not RET — the push the device sends after any
    // connection change. Passing 0x39 as the *connection type* (as this used
    // to) never exercised the notification path at all.
    transport!.receive(encodeFrame(DataType.Command2, 1, pairingListBody(0x39)));
    expect(device.state.connections?.devices.length).toBe(2);
    expect(device.state.connections?.playbackFixed).toBe(true);
  });

  it('a source-switch push renames the playback device', async () => {
    const { opener } = openerWithSupport([0x30, 0x31], {
      '0x36:0x00': pairingListBody(),
      '0x36:0x01': [0x37, 0x01, 0x00],
    });
    let transport: FakeTransport | null = null;
    const wrapped: TransportOpener = async (p, handlers) => {
      transport = (await opener(p, handlers)) as FakeTransport;
      return transport;
    };
    const device = new SonyDevice(wrapped);
    await device.adoptPort(port);
    expect(device.state.connections?.playbackMac).toBe('AA:BB:CC:DD:EE:FF');

    // PERI_NTFY_EXTENDED_PARAM: routing moved to the other remembered device,
    // without us asking and without a fresh list.
    const mac = [...'11:22:33:44:55:66'].map((c) => c.charCodeAt(0));
    transport!.receive(encodeFrame(DataType.Command2, 2, [0x3d, 0x01, ...mac]));
    expect(device.state.connections?.playbackMac).toBe('11:22:33:44:55:66');
    // The list itself is untouched.
    expect(device.state.connections?.devices.length).toBe(2);
  });

  it('routes playback with an optimistic patch and rollback', async () => {
    const { opener } = openerWithSupport([0x30, 0x31], {
      '0x36:0x00': pairingListBody(),
      '0x36:0x01': [0x37, 0x01, 0x00],
    });
    const wrapped: TransportOpener = async (p, handlers) => {
      const transport = (await opener(p, handlers)) as FakeTransport;
      const inner = transport.onWrite!;
      transport.onWrite = (bytes) => {
        const [frame] = new MdrDecoder().push(bytes);
        if (frame && frame.payload[0] === 0x3c) throw new Error('write failed');
        inner(bytes);
      };
      return transport;
    };
    const device = new SonyDevice(wrapped);
    await device.adoptPort(port);

    await device.setPlaybackDevice('11:22:33:44:55:66');
    expect(device.state.connections?.playbackMac).toBe('AA:BB:CC:DD:EE:FF');
    expect(device.state.error).not.toBeNull();
  });

  it('drops the paired-device list on an unexpected disconnect, not just the identity fields', async () => {
    // `connected` on a paired-device entry is a live fact — "holds a link
    // right now" (see `PairedDevice.status` in mdr/pairing.ts) — not a
    // setting. It rides inside the same durable slice the disconnect-caching
    // fix now carries across a drop, so this pins that the carry-over stops
    // short of resurrecting a stale "Connected" badge for a peer we can no
    // longer confirm anything about.
    const { opener } = openerWithSupport([0x30, 0x31], {
      '0x36:0x00': pairingListBody(),
      '0x36:0x01': [0x37, 0x01, 0x00],
    });
    let transport: FakeTransport | null = null;
    const wrapped: TransportOpener = async (p, handlers) => {
      transport = (await opener(p, handlers)) as FakeTransport;
      return transport;
    };
    const device = new SonyDevice(wrapped);
    await device.adoptPort(port);
    expect(device.state.connections?.devices.length).toBe(2);

    transport!.drop(new Error('The device has been lost.'));

    expect(device.state.status).toBe('disconnected');
    // The model survives (the disconnect-caching fix); the live paired-device
    // list does not.
    expect(device.state.info.model).toBe('WF-C500');
    expect(device.state.connections).toBeNull();
  });

  it('drops the paired-device list on a manual disconnect too', async () => {
    const { opener } = openerWithSupport([0x30, 0x31], {
      '0x36:0x00': pairingListBody(),
      '0x36:0x01': [0x37, 0x01, 0x00],
    });
    const device = new SonyDevice(opener);
    await device.adoptPort(port);
    expect(device.state.connections?.devices.length).toBe(2);

    await device.disconnect();

    expect(device.state.info.model).toBe('WF-C500');
    expect(device.state.connections).toBeNull();
  });
});
