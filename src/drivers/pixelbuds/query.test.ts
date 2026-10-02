import { describe, expect, it } from 'vitest';

import { Method } from './maestro';
import { parseQuery } from './query';

describe('parseQuery', () => {
  it('accepts the two argument-free reads, in any case', () => {
    expect(parseQuery('software')).toEqual({ method: Method.GetSoftwareInfo, payload: new Uint8Array(0) });
    expect(parseQuery('  Hardware ')).toEqual({ method: Method.GetHardwareInfo, payload: new Uint8Array(0) });
  });

  it('builds a ReadSetting request for a setting id', () => {
    expect(parseQuery('read 13')).toEqual({ method: Method.ReadSetting, payload: Uint8Array.of(0x20, 0x0d) });
    expect(parseQuery('READ 22')).toEqual({ method: Method.ReadSetting, payload: Uint8Array.of(0x20, 0x16) });
  });

  it.each(['', 'read', 'read x', 'read 1000', 'read -1', 'read 1 2', 'software 1', 'write 13 2', 'WriteSetting', '0103'])(
    'rejects %j with the help text',
    (text) => {
      expect(parseQuery(text)).toMatch(/^Enter software, hardware, or read/);
    },
  );
});
