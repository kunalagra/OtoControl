import { describe, expect, it } from 'vitest';

import { challengeResponse } from './auth';

const bytes = (text: string): Uint8Array => Uint8Array.from(text.match(/../g)!.map((pair) => parseInt(pair, 16)));
const hex = (value: Uint8Array): string => Array.from(value, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();

/**
 * Golden responses from WinMi-Buds' `tests/auth_reference.py`, an independent
 * Python transcription of Gadgetbridge's `Authentication.java`. The first
 * three are also pinned in WinMi's own C# checks; the rest were produced by the
 * same script on further challenges.
 */
const VECTORS: Array<[string, string]> = [
  ['000102030405060708090A0B0C0D0E0F', '8713913C41434E091CAD794A1B5D95C4'],
  ['00000000000000000000000000000000', 'BCA5905BC849392E7BF9FDCDC570EF77'],
  ['FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF', 'F26249F9A7BC42731FEB945FD9E8D06F'],
  ['A54DCA182530BB1D6D132CDED6237B2E', 'D8D7B447F34DE753062E954BFCCC5B19'],
  ['D91E3F721FCB1971174494D6493C9D5C', '0398311FE1BA64588BA4F327CC86B22F'],
  ['3460BE31201E69FEDAA0EEE8B9997F5C', '4AAFF624C16913B2D90A79E9E4C22B3A'],
  ['7C2999FDAFE593253CD654AF4DFAD714', '41C3C3852AA13F38035B38E63DD8694D'],
  ['0102030405060708090A0B0C0D0E0F10', 'FACD31A7EC313D13A4CEC64D52D27E21'],
];

describe('challengeResponse', () => {
  it.each(VECTORS)('answers %s', (challenge, expected) => {
    expect(hex(challengeResponse(bytes(challenge)))).toBe(expected);
  });

  it('does not change the challenge it is given', () => {
    const challenge = bytes('000102030405060708090A0B0C0D0E0F');
    challengeResponse(challenge);
    expect(hex(challenge)).toBe('000102030405060708090A0B0C0D0E0F');
  });

  it('is repeatable', () => {
    const challenge = bytes('3460BE31201E69FEDAA0EEE8B9997F5C');
    expect(challengeResponse(challenge)).toEqual(challengeResponse(challenge));
  });

  it('rejects a challenge that is not 16 bytes', () => {
    expect(() => challengeResponse(Uint8Array.of(1))).toThrow('16 bytes');
  });
});
