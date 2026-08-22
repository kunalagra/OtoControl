import { describe, expect, it, onTestFinished } from 'vitest';

import { DeviceSession } from './session';
import type { SessionHooks } from './session';
import { FakeTransport } from './fakeTransport.test-helper';
import { M4_SERVICE_UUID, SONY_MDR_V2_UUID } from './transport';
import type { Transport, TransportHandlers, TransportOpener } from './transport';

/** A frame shape as trivial as the client — the session never inspects it. */
type FakeFrame = string;
type FakeFrameListener = (frame: FakeFrame, direction: 'tx' | 'rx') => void;

/**
 * `DeviceSession` is generic over the protocol client, so a trivial fake
 * stands in for `GaiaClient`/`MdrClient` here — the session never calls
 * anything on it beyond what `hooks` describe and `attach` functions ask for,
 * `abort` included.
 */
class FakeClient {
  readonly handled: Uint8Array[] = [];
  aborted: Error | null = null;
  #frameListeners = new Set<FakeFrameListener>();

  handleData(chunk: Uint8Array): void {
    this.handled.push(chunk);
  }

  abort(reason: Error): void {
    this.aborted = reason;
  }

  /** Mirrors `GaiaClient.onFrame`/`MdrClient.onFrame`: register, get an unwire back. */
  onFrame(listener: FakeFrameListener): () => void {
    this.#frameListeners.add(listener);
    return () => this.#frameListeners.delete(listener);
  }

  /** Simulates a frame moving across the wire, for tests to react to. */
  emit(frame: FakeFrame, direction: 'tx' | 'rx' = 'rx'): void {
    for (const listener of this.#frameListeners) listener(frame, direction);
  }
}

const port = {} as SerialPort;
const otherPort = {} as SerialPort;

/** Records every hook call, in order, as a short tag — the thing each test asserts on. */
function trackingHooks(calls: string[]): SessionHooks<FakeClient> {
  return {
    createClient: () => {
      calls.push('createClient');
      return new FakeClient();
    },
    handleData: (client, chunk) => client.handleData(chunk),
    wire: () => {
      calls.push('wire');
    },
    onStatus: (status, error) => calls.push(`status:${status}:${String(error)}`),
    onDrop: (reason) => calls.push(`drop:${reason?.message}`),
    abort: (client, reason) => client.abort(reason),
  };
}

/** An opener that resolves immediately with a fresh `FakeTransport`. */
function immediateOpener(): TransportOpener {
  return (_port, handlers) => Promise.resolve(new FakeTransport(handlers));
}

describe('DeviceSession.connectTo', () => {
  it('runs connecting -> open -> build -> wire -> connected -> after, in that order', async () => {
    const calls: string[] = [];
    const session = new DeviceSession(immediateOpener(), trackingHooks(calls));

    let handedClient: FakeClient | null = null;
    await session.connectTo(port, async (client) => {
      calls.push('after');
      handedClient = client;
    });

    expect(calls).toEqual(['status:connecting:null', 'createClient', 'wire', 'status:connected:null', 'after']);
    // `after` gets the same instance the session now reports as connected —
    // there is exactly one client for this connect, not a second build.
    expect(session.client).toBe(handedClient);
  });

  it('an attach function registered before a connect is invoked with the client once it is live', async () => {
    let wiredClient: FakeClient | null = null;
    const session = new DeviceSession(immediateOpener(), trackingHooks([]));

    session.attach((client) => {
      wiredClient = client;
      return () => {};
    });

    await session.connectTo(port, async () => {});

    expect(wiredClient).toBe(session.client);
  });

  it('an attach function survives a reconnect — it is invoked again against the next client', async () => {
    const attachedClients: FakeClient[] = [];
    const session = new DeviceSession(immediateOpener(), trackingHooks([]));

    session.attach((client) => {
      attachedClients.push(client);
      return () => {};
    });

    await session.connectTo(port, async () => {});
    await session.disconnect();
    await session.connectTo(otherPort, async () => {});

    expect(attachedClients).toHaveLength(2);
    expect(attachedClients[0]).not.toBe(attachedClients[1]);
  });

  it('a drop landing before the transport-open await resolves is never reported as connected', async () => {
    // Mirrors the real bug: `SerialTransport` can call `onClose` before its
    // own `open()` promise settles, so the opener here does the same —
    // firing the drop synchronously, before it even returns a transport.
    const calls: string[] = [];
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
    const session = new DeviceSession(opener, trackingHooks(calls));

    await session.connectTo(port, async () => {
      calls.push('after');
    });

    // Only `onStatus('connecting', ...)` and the drop itself should have
    // fired — the connect must never reach `createClient`, `wire`,
    // `connected`, or `after` once it has been superseded.
    expect(calls).toEqual(['status:connecting:null', 'drop:gone before open finished']);
    expect(session.client).toBeNull();
    // The transport opened for the now-superseded connect must not be leaked.
    expect(closed).toBe(true);
  });

  it('a second connectTo supersedes an in-flight first one', async () => {
    const calls: string[] = [];
    let resolveFirstOpen!: (transport: Transport) => void;
    const firstOpen = new Promise<Transport>((resolve) => {
      resolveFirstOpen = resolve;
    });

    const opener: TransportOpener = (calledPort, handlers) =>
      calledPort === port ? firstOpen : Promise.resolve(new FakeTransport(handlers));

    const session = new DeviceSession(opener, trackingHooks(calls));

    const first = session.connectTo(port, async () => {
      calls.push('after-first');
    });
    await session.connectTo(otherPort, async () => {
      calls.push('after-second');
    });

    const secondClientCalls = [...calls];
    expect(secondClientCalls).toContain('status:connected:null');
    const clientAfterSecond = session.client;

    // The stalled first open finally resolves — it must not clobber what the
    // second connect already established.
    let firstTransportClosed = false;
    resolveFirstOpen({
      write: async () => {},
      close: async () => {
        firstTransportClosed = true;
      },
      isOpen: true,
    });
    await first;

    expect(calls).not.toContain('after-first');
    expect(firstTransportClosed).toBe(true);
    expect(session.client).toBe(clientAfterSecond);
  });

  it('a second connectTo over a live session closes the first transport, and bytes arriving on it afterward reach nothing', async () => {
    // Not hypothetical: manager.connect() reaches this — it calls adoptPort
    // with no prior disconnect(), so a second connectTo can land while the
    // first session is still fully alive.
    const calls: string[] = [];
    let firstTransport: FakeTransport | null = null;
    let secondTransport: FakeTransport | null = null;
    const opener: TransportOpener = (calledPort, handlers) => {
      const transport = new FakeTransport(handlers);
      if (calledPort === port) firstTransport = transport;
      else secondTransport = transport;
      return Promise.resolve(transport);
    };
    const session = new DeviceSession(opener, trackingHooks(calls));

    await session.connectTo(port, async () => {});
    const firstClient = session.client!;
    await session.connectTo(otherPort, async () => {});
    const secondClient = session.client!;

    expect(secondTransport).not.toBeNull();
    // The first transport must be disposed of, not overwritten-and-leaked.
    expect(firstTransport!.isOpen).toBe(false);

    // `FakeTransport.receive` still lets bytes through after `close()` — on
    // purpose, since it reproduces the real race this guards against:
    // `SerialTransport`'s read loop keeps delivering until it actually
    // notices the port is gone. Those bytes must reach neither the old
    // client (it is dead) nor the new one (they were never meant for it).
    firstTransport!.receive(Uint8Array.from([9, 9, 9]));

    expect(firstClient.handled).toEqual([]);
    expect(secondClient.handled).toEqual([]);
  });
});

describe('DeviceSession.attach', () => {
  it('an attach function registered while already connected receives frames from the live client', async () => {
    let client!: FakeClient;
    const hooks: SessionHooks<FakeClient> = {
      createClient: () => {
        client = new FakeClient();
        return client;
      },
      handleData: (c, chunk) => c.handleData(chunk),
      wire: () => {},
      onStatus: () => {},
      onDrop: () => {},
      abort: () => {},
    };
    const session = new DeviceSession(immediateOpener(), hooks);

    await session.connectTo(port, async () => {});

    const received: Array<[FakeFrame, 'tx' | 'rx']> = [];
    session.attach((c) => c.onFrame((frame, direction) => received.push([frame, direction])));

    client.emit('hello', 'rx');

    expect(received).toEqual([['hello', 'rx']]);
  });

  it("attach's disposer stops delivery from the live client", async () => {
    let client!: FakeClient;
    const hooks: SessionHooks<FakeClient> = {
      createClient: () => {
        client = new FakeClient();
        return client;
      },
      handleData: (c, chunk) => c.handleData(chunk),
      wire: () => {},
      onStatus: () => {},
      onDrop: () => {},
      abort: () => {},
    };
    const session = new DeviceSession(immediateOpener(), hooks);

    await session.connectTo(port, async () => {});

    const received: FakeFrame[] = [];
    const detach = session.attach((c) => c.onFrame((frame) => received.push(frame)));

    client.emit('one');
    detach();
    client.emit('two');

    expect(received).toEqual(['one']);
  });

  it('a supersession genuinely detaches from the old client — it does not merely stop future reconnects from re-wiring it', async () => {
    // `#liveUnwire` could be cleared without invoking its thunks: the
    // discarded client is never fed another byte (the generation guard in
    // `connectTo`'s `onData` sees to that), so in real use it can never
    // legitimately emit again regardless of whether its listener is still
    // technically registered. This test manufactures the case that
    // distinction actually matters for — something calling the old client's
    // own emit path directly, bypassing the transport entirely — to pin
    // that this class enforces the detach rather than merely relying on the
    // old client being otherwise unreachable.
    const clients: FakeClient[] = [];
    const hooks: SessionHooks<FakeClient> = {
      createClient: () => {
        const c = new FakeClient();
        clients.push(c);
        return c;
      },
      handleData: (c, chunk) => c.handleData(chunk),
      wire: () => {},
      onStatus: () => {},
      onDrop: () => {},
      abort: () => {},
    };
    const session = new DeviceSession(immediateOpener(), hooks);

    await session.connectTo(port, async () => {});
    const firstClient = clients[0];

    const received: FakeFrame[] = [];
    session.attach((c) => c.onFrame((frame) => received.push(frame)));

    await session.connectTo(otherPort, async () => {});

    firstClient.emit('late frame from the superseded client');

    expect(received).toEqual([]);
  });

  it('a disposed attachment is not re-invoked on the next connect', async () => {
    // Distinct from "attach's disposer stops delivery from the live client"
    // above: that test only proves the *current* client stops hearing from a
    // disposed attachment. This proves the attachment itself is forgotten —
    // if `dispose` only unwired the live client and left `fn` in
    // `#attachments`, the next `connectTo`'s reconnect loop would happily
    // wire it onto the new client and this would still receive frames.
    const clients: FakeClient[] = [];
    const hooks: SessionHooks<FakeClient> = {
      createClient: () => {
        const c = new FakeClient();
        clients.push(c);
        return c;
      },
      handleData: (c, chunk) => c.handleData(chunk),
      wire: () => {},
      onStatus: () => {},
      onDrop: () => {},
      abort: () => {},
    };
    const session = new DeviceSession(immediateOpener(), hooks);

    await session.connectTo(port, async () => {});
    const received: FakeFrame[] = [];
    const detach = session.attach((c) => c.onFrame((frame) => received.push(frame)));
    detach();

    await session.connectTo(otherPort, async () => {});
    clients[1].emit('after-reconnect');

    expect(received).toEqual([]);
  });

  it("an attachment registered before any connect still detaches cleanly — the entry it relies on comes from connectTo's reconnect loop, not attach's own already-live branch", async () => {
    let client!: FakeClient;
    const hooks: SessionHooks<FakeClient> = {
      createClient: () => {
        client = new FakeClient();
        return client;
      },
      handleData: (c, chunk) => c.handleData(chunk),
      wire: () => {},
      onStatus: () => {},
      onDrop: () => {},
      abort: () => {},
    };
    const session = new DeviceSession(immediateOpener(), hooks);

    const received: FakeFrame[] = [];
    // No client exists yet, so `attach`'s own `if (this.#client) ...` branch
    // cannot be what wires this. Only `connectTo`'s
    // `for (const fn of this.#attachments) this.#liveUnwire.set(fn, fn(client))`
    // loop ever does.
    const detach = session.attach((c) => c.onFrame((frame) => received.push(frame)));

    await session.connectTo(port, async () => {});
    client.emit('one');
    detach();
    client.emit('two');

    expect(received).toEqual(['one']);
  });

  it('a supersession detaches a client wired only by the reconnect loop, not just one wired by attach\'s already-live branch', async () => {
    // The "supersession genuinely detaches" test above attaches *after* the
    // first connect, so its `#liveUnwire` entry comes from attach's own
    // `if (this.#client) this.#liveUnwire.set(...)` branch. This attaches
    // *before* any connect, so the only place that entry can come from is
    // connectTo's reconnect loop — proving `#detachLive` (via the second
    // connectTo's teardown) covers that loop's bookkeeping too.
    const clients: FakeClient[] = [];
    const hooks: SessionHooks<FakeClient> = {
      createClient: () => {
        const c = new FakeClient();
        clients.push(c);
        return c;
      },
      handleData: (c, chunk) => c.handleData(chunk),
      wire: () => {},
      onStatus: () => {},
      onDrop: () => {},
      abort: () => {},
    };
    const session = new DeviceSession(immediateOpener(), hooks);

    const received: FakeFrame[] = [];
    session.attach((c) => c.onFrame((frame) => received.push(frame)));

    await session.connectTo(port, async () => {});
    await session.connectTo(otherPort, async () => {});

    clients[0].emit('from the superseded client');

    expect(received).toEqual([]);
  });

  it('disconnect() detaches live attachments, not merely nulling the client field', async () => {
    let client!: FakeClient;
    const hooks: SessionHooks<FakeClient> = {
      createClient: () => {
        client = new FakeClient();
        return client;
      },
      handleData: (c, chunk) => c.handleData(chunk),
      wire: () => {},
      onStatus: () => {},
      onDrop: () => {},
      abort: () => {},
    };
    const session = new DeviceSession(immediateOpener(), hooks);

    const received: FakeFrame[] = [];
    session.attach((c) => c.onFrame((frame) => received.push(frame)));
    await session.connectTo(port, async () => {});

    await session.disconnect();
    client.emit('after disconnect');

    expect(received).toEqual([]);
  });
});

describe('DeviceSession data handling', () => {
  it('feeds inbound bytes to the connected client via handleData', async () => {
    let transport: FakeTransport | null = null;
    const opener: TransportOpener = (_port, handlers) => {
      transport = new FakeTransport(handlers);
      return Promise.resolve(transport);
    };
    const calls: string[] = [];
    const session = new DeviceSession(opener, trackingHooks(calls));

    await session.connectTo(port, async () => {});
    const client = session.client!;

    const bytes = Uint8Array.from([1, 2, 3]);
    transport!.receive(bytes);

    expect(client.handled).toEqual([bytes]);
  });

  it('does not feed bytes once the client has been dropped', async () => {
    let transport: FakeTransport | null = null;
    const opener: TransportOpener = (_port, handlers) => {
      transport = new FakeTransport(handlers);
      return Promise.resolve(transport);
    };
    const calls: string[] = [];
    const session = new DeviceSession(opener, trackingHooks(calls));

    await session.connectTo(port, async () => {});
    const client = session.client!;
    transport!.drop(new Error('gone'));

    // The transport itself is a fake and does not enforce this, so the
    // session's own generation guard in the `onData` handler — the same
    // mechanism `onClose` uses via `#handleDrop` — is what has to stop this.
    // A drop nulls `#client` too, so this particular case can't tell that
    // guard apart from a plain `if (this.#client)` check; the "second
    // connectTo" test above is what actually discriminates between them.
    transport!.receive(Uint8Array.from([9]));

    expect(client.handled).toEqual([]);
  });
});

describe('DeviceSession disconnect and drop', () => {
  it('disconnect aborts the client, closes the transport, and nulls both fields', async () => {
    let transport: FakeTransport | null = null;
    const opener: TransportOpener = (_port, handlers) => {
      transport = new FakeTransport(handlers);
      return Promise.resolve(transport);
    };
    const calls: string[] = [];
    const session = new DeviceSession(opener, trackingHooks(calls));

    await session.connectTo(port, async () => {});
    const client = session.client!;

    await session.disconnect();

    expect(client.aborted?.message).toBe('disconnected');
    expect(session.client).toBeNull();
    expect(transport!.isOpen).toBe(false);
  });

  it('reports an unexpected drop through onDrop and clears the client', async () => {
    let handlers!: TransportHandlers;
    const opener: TransportOpener = (_port, h) => {
      handlers = h;
      return Promise.resolve(new FakeTransport(h));
    };
    const calls: string[] = [];
    const session = new DeviceSession(opener, trackingHooks(calls));

    await session.connectTo(port, async () => {});
    const client = session.client!;

    handlers.onClose(new Error('headphones powered off'));

    expect(client.aborted?.message).toBe('headphones powered off');
    expect(session.client).toBeNull();
    expect(calls).toContain('drop:headphones powered off');
  });

  it('a stale close from a transport this session has already moved past does not tear down the live connect', async () => {
    // Mirrors #handleDrop's own comment: a late `onClose` from a superseded
    // transport — the first connect here, which the second connectTo below
    // has already moved past — must have nothing left to react to. Before
    // the generation token existed, this exact interleaving would have
    // clobbered the second, live connect.
    const calls: string[] = [];
    const transports: FakeTransport[] = [];
    const opener: TransportOpener = (_port, handlers) => {
      const transport = new FakeTransport(handlers);
      transports.push(transport);
      return Promise.resolve(transport);
    };
    const session = new DeviceSession(opener, trackingHooks(calls));

    await session.connectTo(port, async () => {});
    await session.connectTo(otherPort, async () => {});
    const secondClient = session.client;

    calls.length = 0;
    // The first transport's own close, arriving late.
    transports[0].drop(new Error('late close from the first transport'));

    expect(calls).toEqual([]);
    expect(session.client).toBe(secondClient);
    expect(session.client?.aborted).toBeNull();
  });

  it('disconnect() while a connect is stalled at open stops that connect from resurrecting a dead session once the open resolves', async () => {
    // Not hypothetical: manager.ts's select() disconnects both devices, then
    // immediately adoptPorts the one it wants — so a connect that is mid-open
    // when disconnect() runs is a real interleaving, not a test contrivance.
    const calls: string[] = [];
    let resolveOpen!: (transport: Transport) => void;
    const stalledOpen = new Promise<Transport>((resolve) => {
      resolveOpen = resolve;
    });
    const opener: TransportOpener = () => stalledOpen;
    const session = new DeviceSession(opener, trackingHooks(calls));

    const connecting = session.connectTo(port, async () => {
      calls.push('after');
    });

    // disconnect() runs before the open above has resolved — #transport and
    // #client are both still null, so there is nothing yet to abort or
    // close, but the generation bump here is what the stalled connect must
    // notice once it resumes.
    await session.disconnect();

    let transportClosed = false;
    resolveOpen({
      write: async () => {},
      close: async () => {
        transportClosed = true;
      },
      isOpen: true,
    });
    await connecting;

    // Without that bump, the stalled connect would not know it had been
    // superseded: it would patch `connected` back over a transport nobody
    // will ever close — the double-open manager.ts's disconnect-then-
    // adoptPort sequence in select() depends on this not happening.
    expect(calls).not.toContain('status:connected:null');
    expect(calls).not.toContain('after');
    expect(session.client).toBeNull();
    expect(transportClosed).toBe(true);
  });
});

describe('DeviceSession.grantedPortFor', () => {
  const portWithService = (serviceId: string): SerialPort =>
    ({ getInfo: () => ({ bluetoothServiceClassId: serviceId }) }) as unknown as SerialPort;

  /**
   * Stubs the one seam `findGrantedPort` reads from. Restored after the test
   * via `onTestFinished`, since `navigator` is a shared global and this is
   * called from inside a test body — where `afterEach` cannot be registered.
   */
  const stubGrantedPorts = (...ports: SerialPort[]): void => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { serial: { getPorts: async () => ports } },
    });
    onTestFinished(() => {
      if (original) Object.defineProperty(globalThis, 'navigator', original);
    });
  };

  it('returns the granted port when its service matches the requested brand', async () => {
    stubGrantedPorts(portWithService(M4_SERVICE_UUID));

    const port = await DeviceSession.grantedPortFor('sennheiser');

    expect(port).not.toBeNull();
  });

  it('refuses a granted port from a different brand — this is what stops a GaiaClient auto-connecting to a Sony port', async () => {
    stubGrantedPorts(portWithService(SONY_MDR_V2_UUID));

    const port = await DeviceSession.grantedPortFor('sennheiser');

    expect(port).toBeNull();
  });

  it('returns null when nothing is granted', async () => {
    stubGrantedPorts();

    const port = await DeviceSession.grantedPortFor('sony');

    expect(port).toBeNull();
  });
});

describe('DeviceSession.adoptTransport', () => {
  /** The shape the BLE path hands over: already open, listeners attached via start(). */
  class StartableFakeTransport extends FakeTransport {
    started: TransportHandlers | null = null;
    startedCalls = 0;

    start(handlers: TransportHandlers): void {
      this.startedCalls += 1;
      this.started = handlers;
    }
  }

  it('starts the transport in place and reaches connected without an opener', async () => {
    const calls: string[] = [];
    const session = new DeviceSession<FakeClient>(
      () => {
        throw new Error('the opener must not be called on the adopt path');
      },
      trackingHooks(calls),
    );

    const transport = new StartableFakeTransport(
      {} as import('./transport').TransportHandlers,
    );
    const afterCalls: string[] = [];
    await session.adoptTransport(transport, async () => {
      afterCalls.push('after');
    });

    // The session wired its handlers via start(), reported connected, ran after.
    expect(transport.startedCalls).toBe(1);
    expect(transport.started).not.toBeNull();
    expect(calls).toEqual(['status:connecting:null', 'createClient', 'wire', 'status:connected:null']);
    expect(afterCalls).toEqual(['after']);

    // Bytes reaching the started handlers flow to the client, generation-gated.
    transport.started!.onData(new Uint8Array([1]));
    expect(session.client?.handled.length).toBe(1);

    // A drop through the started handlers reports onDrop and clears the client.
    transport.started!.onClose(new Error('link lost'));
    expect(calls).toContain('drop:link lost');
    expect(session.client).toBeNull();
  });

  it('is idempotent in start() only because GattTransport makes it so — adopting twice supersedes', async () => {
    const calls: string[] = [];
    const session = new DeviceSession<FakeClient>(immediateOpener(), trackingHooks(calls));
    const first = new StartableFakeTransport({} as import('./transport').TransportHandlers);
    const second = new StartableFakeTransport({} as import('./transport').TransportHandlers);

    await session.adoptTransport(first, async () => undefined);
    await session.adoptTransport(second, async () => undefined);

    // The superseded transport's handlers go silent: its generation is stale.
    first.started!.onData(new Uint8Array([9]));
    second.started!.onData(new Uint8Array([1]));
    expect(session.client?.handled).toEqual([new Uint8Array([1])]);
  });
});
