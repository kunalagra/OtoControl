import { describe, expect, it } from 'vitest';

import { FakeTransport } from './fakeTransport.test-helper';
import { HandoffTransport, identifyOnPort } from './identify';
import type { ProbeCandidate } from './identify';
import type { TransportHandlers, TransportOpener } from './transport';
import { encodeFrame } from '@/drivers/samsung/frame';
import { samsungProbe } from '@/drivers/samsung/probe';
import { heymelodyProbe } from '@/drivers/heymelody/probe';
import { encodeSppFrame } from '@/drivers/heymelody/sppFrame';

const port = {} as SerialPort;
const candidates: ProbeCandidate[] = [
  { brand: 'heymelody', probe: heymelodyProbe },
  { brand: 'samsung', probe: samsungProbe },
];

/** A capability reply as a HeyMelody device sends it: `0x8100`, AA-framed. */
const heymelodyReply = (): Uint8Array => encodeSppFrame(0x8100, 1, [0x00, 0x01, 0x02]);
const samsungPush = (): Uint8Array => encodeFrame(0x60, [11, 80, 80, 1, 1, 0x11, 60, 0]);

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);
const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/** An opener that records the transport it made and lets the test script the device. */
function scripted(setup: (fake: FakeTransport) => void): { open: TransportOpener; fake: () => FakeTransport } {
  let made: FakeTransport | null = null;
  const open: TransportOpener = async (_target, handlers) => {
    made = new FakeTransport(handlers);
    setup(made);
    return made;
  };
  return { open, fake: () => made as FakeTransport };
}

const quick = { passiveMs: 25, activeMs: 25 };

describe('identifyOnPort', () => {
  it('recognises Galaxy Buds from a status push they send unprompted, without sending anything', async () => {
    const { open, fake } = scripted((fake) => queueMicrotask(() => fake.receive(samsungPush())));
    const result = await identifyOnPort(open, port, candidates, quick);
    expect(result.brand).toBe('samsung');
    expect(fake().written).toEqual([]);
  });

  it('recognises a push that arrives split, with garbage around it', async () => {
    const push = samsungPush();
    const { open, fake } = scripted((fake) => {
      setTimeout(() => fake.receive(bytes(0x00, 0xaa, 0x01, ...push.slice(0, 5))), 2);
      setTimeout(() => fake.receive(Uint8Array.from([...push.slice(5), 0x7f])), 6);
    });
    const result = await identifyOnPort(open, port, candidates, quick);
    expect(result.brand).toBe('samsung');
    expect(fake().written).toEqual([]);
  });

  it('asks a silent HeyMelody device its capability query, and recognises the reply', async () => {
    const { open, fake } = scripted((fake) => {
      fake.onWrite = (written) => {
        if (sameBytes(written, heymelodyProbe.query!)) queueMicrotask(() => fake.receive(heymelodyReply()));
      };
    });
    const result = await identifyOnPort(open, port, candidates, quick);
    expect(result.brand).toBe('heymelody');
    expect(fake().written).toEqual([heymelodyProbe.query]);
  });

  it('falls back to asking Galaxy Buds for their SKU when they stay quiet', async () => {
    const { open, fake } = scripted((fake) => {
      fake.onWrite = (written) => {
        if (sameBytes(written, samsungProbe.query!)) queueMicrotask(() => fake.receive(encodeFrame(0x22, new Array(28).fill(0))));
      };
    });
    const result = await identifyOnPort(open, port, candidates, quick);
    expect(result.brand).toBe('samsung');
    // Heard nothing for the passive window, was not answered by HeyMelody's query, then asked its own.
    expect(fake().written).toEqual([heymelodyProbe.query, samsungProbe.query]);
  });

  it('listens first, and sends nothing until the passive window has passed', async () => {
    const { open, fake } = scripted(() => {});
    const started = Date.now();
    const pending = identifyOnPort(open, port, candidates, { passiveMs: 60, activeMs: 5 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fake().written).toEqual([]);
    await pending;
    expect(Date.now() - started).toBeGreaterThanOrEqual(55);
  });

  it('reports nothing recognised, leaving the port open, when no one answers', async () => {
    const { open, fake } = scripted(() => {});
    const result = await identifyOnPort(open, port, candidates, quick);
    expect(result.brand).toBeNull();
    expect(result.transport.isOpen).toBe(true);
    expect(fake().isOpen).toBe(true);
  });

  it("is not fooled by one protocol's bytes looking a little like the other's", async () => {
    // Samsung's SOF in the middle of HeyMelody bytes, and an AA in the middle of a Samsung frame.
    const noise = bytes(0xfd, 0x05, 0x00, 0x01, 0x02, 0x03, 0xaa, 0x02, 0x00, 0x00);
    const { open } = scripted((fake) => queueMicrotask(() => fake.receive(noise)));
    expect((await identifyOnPort(open, port, candidates, quick)).brand).toBeNull();
  });

  it('puts the previously identified brand first when asking', async () => {
    const { open, fake } = scripted(() => {});
    await identifyOnPort(open, port, candidates, { ...quick, preferred: 'samsung' });
    expect(fake().written[0]).toEqual(samsungProbe.query);
  });

  it('puts HeyMelody first when that is what it was last time', async () => {
    const { open, fake } = scripted(() => {});
    await identifyOnPort(open, port, candidates, { ...quick, preferred: 'heymelody' });
    expect(fake().written).toEqual([heymelodyProbe.query, samsungProbe.query]);
  });

  it('stops at the first step that recognises someone', async () => {
    const { open, fake } = scripted((fake) => {
      fake.onWrite = (written) => {
        if (sameBytes(written, heymelodyProbe.query!)) queueMicrotask(() => fake.receive(heymelodyReply()));
      };
    });
    await identifyOnPort(open, port, candidates, { ...quick, preferred: 'heymelody' });
    expect(fake().written).toHaveLength(1);
  });

  it('rejects, and closes, when the link drops while it is listening', async () => {
    const { open, fake } = scripted((fake) => setTimeout(() => fake.drop(new Error('gone')), 5));
    await expect(identifyOnPort(open, port, candidates, { passiveMs: 200, activeMs: 200 })).rejects.toThrow('gone');
    expect(fake().isOpen).toBe(false);
  });

  it('propagates a failure to open', async () => {
    const open: TransportOpener = async () => {
      throw new Error('port busy');
    };
    await expect(identifyOnPort(open, port, candidates, quick)).rejects.toThrow('port busy');
  });
});

describe('HandoffTransport', () => {
  /** A handed-over transport, with `heard` already collected before any driver started it. */
  const heardBefore = (...chunks: Uint8Array[]): { handoff: HandoffTransport; fake: FakeTransport } => {
    const handoff = new HandoffTransport();
    const fake = new FakeTransport(handoff.handlers);
    handoff.bind(fake);
    for (const chunk of chunks) fake.receive(chunk);
    return { handoff, fake };
  };

  const sink = (): { handlers: TransportHandlers; data: Uint8Array[]; closes: Array<Error | undefined> } => {
    const data: Uint8Array[] = [];
    const closes: Array<Error | undefined> = [];
    return { handlers: { onData: (chunk) => data.push(chunk), onClose: (reason) => closes.push(reason) }, data, closes };
  };

  it('replays what it heard, after the current turn, in order', async () => {
    const { handoff } = heardBefore(bytes(1), bytes(2, 3));
    const { handlers, data } = sink();
    handoff.start(handlers);
    expect(data).toEqual([]); // not yet: the adopter has no client to give them to
    await Promise.resolve();
    expect(data.map((chunk) => [...chunk])).toEqual([[1], [2, 3]]);
  });

  it('forwards live data once started, after the replay', async () => {
    const { handoff, fake } = heardBefore(bytes(1));
    const { handlers, data } = sink();
    handoff.start(handlers);
    fake.receive(bytes(9));
    // Live data waits its turn behind the replay rather than overtaking it.
    expect(data).toEqual([]);
    await Promise.resolve();
    expect(data.map((chunk) => chunk[0])).toEqual([1, 9]);
  });

  it('reports a close that happened before anyone started it', async () => {
    const { handoff, fake } = heardBefore();
    fake.drop(new Error('lost'));
    const { handlers, closes } = sink();
    handoff.start(handlers);
    await Promise.resolve();
    expect(closes.map((reason) => reason?.message)).toEqual(['lost']);
  });

  it('forwards a later close, straight away once the replay has run', async () => {
    const { handoff, fake } = heardBefore();
    const { handlers, closes } = sink();
    handoff.start(handlers);
    await Promise.resolve();
    fake.drop();
    expect(closes).toHaveLength(1);
  });

  it('writes and closes through to the real transport', async () => {
    const { handoff, fake } = heardBefore();
    await handoff.write(bytes(7));
    expect(fake.written).toEqual([bytes(7)]);
    await handoff.close();
    expect(fake.isOpen).toBe(false);
    expect(handoff.isOpen).toBe(false);
  });

  it('refuses to write before a transport is bound', async () => {
    await expect(new HandoffTransport().write(bytes(1))).rejects.toThrow('closed');
  });
});

describe('probes', () => {
  it('Samsung: needs a whole frame with a good CRC', () => {
    const push = samsungPush();
    expect(samsungProbe.recognises(push)).toBe(true);
    expect(samsungProbe.recognises(push.slice(0, push.length - 1))).toBe(false);
    const corrupt = Uint8Array.from(push);
    corrupt[5] ^= 0x01;
    expect(samsungProbe.recognises(corrupt)).toBe(false);
    expect(samsungProbe.recognises(new Uint8Array(0))).toBe(false);
  });

  it('Samsung: does not take a HeyMelody frame for its own', () => {
    expect(samsungProbe.recognises(heymelodyReply())).toBe(false);
  });

  it('Samsung: asks for the SKU, a read', () => {
    expect([...samsungProbe.query!]).toEqual([...encodeFrame(0x22)]);
  });

  it('HeyMelody: wants the capability reply, and nothing else AA-framed', () => {
    expect(heymelodyProbe.recognises(heymelodyReply())).toBe(true);
    expect(heymelodyProbe.recognises(encodeSppFrame(0x8103, 1, [0]))).toBe(false);
    expect(heymelodyProbe.recognises(encodeSppFrame(0x0204, 1, [0]))).toBe(false);
  });

  it('HeyMelody: does not take a Samsung frame for its own', () => {
    expect(heymelodyProbe.recognises(samsungPush())).toBe(false);
  });

  it('HeyMelody: asks 0x0100 in its own framing', () => {
    expect([...heymelodyProbe.query!]).toEqual([...encodeSppFrame(0x0100, 1)]);
  });
});
