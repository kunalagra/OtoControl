import { describe, expect, it } from 'vitest';

import { SonyDevice, captureDurable, initialSonyState } from './sony';
import { FakeTransport, ascii } from './fakeTransport.test-helper';
import type { Transport, TransportOpener } from './transport';
import { Command, DeviceInfoType, Reply } from '../mdr/commands';
import { DataType, MdrDecoder, encodeFrame } from '../mdr/frame';

/** `adoptPort` is the test entry point — `connect()` would need the picker. */
const port = {} as SerialPort;

/**
 * Answers the five reads `#handshake` makes (protocol info, model, firmware,
 * series/colour, supported functions), so `#readFeatures` has nothing left to
 * poll and `adoptPort` settles quickly. The model name is real — `WF-C500`,
 * length-prefixed per `decodeDeviceInfoText` (`../mdr/commands.ts:171-175`,
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
    let openedWith: SerialPort | null = null;
    const open: TransportOpener = async (p, handlers) => {
      openedWith = p;
      transport = new FakeTransport(handlers);
      transport.onWrite = (bytes) => {
        const [frame] = new MdrDecoder().push(bytes);
        // The client also writes its own ACKs for every reply it receives —
        // those are `DataType.Ack`, carry no payload, and need no answer.
        if (!frame || frame.dataType !== DataType.Command1) return;
        const reply = handshakeReply(frame.payload[0], frame.payload[1]);
        if (!reply) return;
        // Mirrors the request's own sequence bit rather than hardcoding 0.
        // `MdrClient#dispatch` never actually checks it when matching a reply
        // to a pending request (see `client.ts:116-121`), so this buys
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
