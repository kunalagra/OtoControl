import { describe, expect, it } from 'vitest';
import { Cmd, replyFor } from './cmd';

describe('replyFor', () => {
  it('sets the reply bit', () => {
    expect(replyFor(Cmd.QueryProductId)).toBe(0x8103);
    expect(replyFor(Cmd.Battery)).toBe(0x8106);
  });
});
