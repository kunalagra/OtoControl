import { describe, expect, it, vi } from 'vitest';

import { ProtocolLog, formatLog, hex } from './protocolLog';

describe('ProtocolLog', () => {
  it('records bytes in order, copying them', () => {
    const log = new ProtocolLog();
    const bytes = Uint8Array.from([1, 2]);
    log.append('tx', bytes);
    bytes[0] = 9;
    log.append('rx', Uint8Array.from([3]));
    expect(log.entries.map((entry) => [entry.direction, [...entry.bytes]])).toEqual([
      ['tx', [1, 2]],
      ['rx', [3]],
    ]);
  });

  it('hands out a new array on each append and notifies subscribers', () => {
    const log = new ProtocolLog();
    const listener = vi.fn();
    const stop = log.subscribe(listener);
    const before = log.entries;
    log.append('connect');
    expect(log.entries).not.toBe(before);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    log.append('connect');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps only the most recent entries', () => {
    const log = new ProtocolLog();
    for (let i = 0; i < 450; i++) log.append('rx', Uint8Array.from([i & 0xff]));
    expect(log.entries).toHaveLength(400);
    expect(log.entries[399].bytes[0]).toBe(449 & 0xff);
  });
});

describe('formatLog', () => {
  it('prints hex, timed from the first entry, with a marker for a new link', () => {
    vi.useFakeTimers();
    try {
      const log = new ProtocolLog();
      vi.setSystemTime(1000);
      log.append('connect');
      vi.setSystemTime(1250);
      log.append('rx', Uint8Array.from([0xfd, 0x0a]));
      expect(formatLog(log.entries)).toBe('+0ms -- connect --\n+250ms RX fd 0a');
    } finally {
      vi.useRealTimers();
    }
  });

  it('hex-formats with zero padding', () => {
    expect(hex(Uint8Array.from([0, 15, 255]))).toBe('00 0f ff');
  });
});
