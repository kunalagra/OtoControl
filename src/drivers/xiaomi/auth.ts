/**
 * The earbuds' handshake cipher: the Bluetooth SAFER+ variant (128-bit key, 8
 * rounds) that Gadgetbridge's `redmibuds/protocol/Authentication.java` and
 * `AuthData.java` implement. The key is the challenge itself and the plaintext
 * is a fixed 16 bytes, so the response is a function of the challenge alone —
 * there is no secret to hold. (The vendor app's notes call it a "custom stream
 * cipher"; its S-box at 0xa70 starts `01 2d e2 93`, which is `45^i mod 257`.)
 *
 * Checked against golden responses from WinMi-Buds' `tests/auth_reference.py`,
 * an independent transcription of the Java — see `auth.test.ts`.
 */

const BLOCK_SIZE = 16;
/** Bit i set: byte i is combined with XOR (and the exp table); clear: with addition (and the log table). */
const PATTERN = 0x9999;

const PLAINTEXT = Uint8Array.of(0x11, 0x22, 0x33, 0x33, 0x22, 0x11, 0x11, 0x22, 0x33, 0x33, 0x22, 0x11, 0x11, 0x22, 0x33, 0x33);

// AuthData.COEFFICIENTS
const COEFFICIENTS: ReadonlyArray<readonly number[]> = [
  [2, 1, 1, 1, 4, 2, 1, 1, 2, 2, 4, 2, 4, 4, 16, 8],
  [2, 1, 1, 1, 4, 2, 1, 1, 1, 1, 2, 1, 2, 2, 8, 4],
  [1, 1, 4, 2, 2, 2, 4, 2, 16, 8, 4, 4, 2, 1, 1, 1],
  [1, 1, 4, 2, 1, 1, 2, 1, 8, 4, 2, 2, 2, 1, 1, 1],
  [16, 8, 2, 2, 4, 2, 4, 4, 1, 1, 4, 2, 1, 1, 2, 1],
  [8, 4, 1, 1, 2, 1, 2, 2, 1, 1, 4, 2, 1, 1, 2, 1],
  [2, 2, 4, 2, 4, 4, 16, 8, 2, 1, 1, 1, 4, 2, 1, 1],
  [1, 1, 2, 1, 2, 2, 8, 4, 2, 1, 1, 1, 4, 2, 1, 1],
  [4, 2, 4, 4, 16, 8, 2, 2, 1, 1, 2, 1, 1, 1, 4, 2],
  [2, 1, 2, 2, 8, 4, 1, 1, 1, 1, 2, 1, 1, 1, 4, 2],
  [4, 4, 16, 8, 1, 1, 2, 1, 4, 2, 1, 1, 4, 2, 2, 2],
  [2, 2, 8, 4, 1, 1, 2, 1, 4, 2, 1, 1, 2, 1, 1, 1],
  [1, 1, 2, 1, 1, 1, 4, 2, 4, 4, 16, 8, 2, 2, 4, 2],
  [1, 1, 2, 1, 1, 1, 4, 2, 2, 2, 8, 4, 1, 1, 2, 1],
  [4, 2, 1, 1, 2, 1, 1, 1, 4, 2, 2, 2, 16, 8, 4, 4],
  [4, 2, 1, 1, 2, 1, 1, 1, 2, 1, 1, 1, 8, 4, 2, 2],
];

const xorMode = (index: number): boolean => ((1 << index) & PATTERN) !== 0;

/** `base ** exponent mod 257`, by square-and-multiply: the exponents here reach into the thousands. */
function powMod257(base: number, exponent: number): number {
  let result = 1;
  let factor = base % 257;
  for (let remaining = exponent; remaining > 0; remaining >>= 1) {
    if (remaining & 1) result = (result * factor) % 257;
    factor = (factor * factor) % 257;
  }
  return result;
}

// 45^i mod 257, with 256 stored as 0, and its inverse; 45 generates the group.
const EXP = new Uint8Array(256);
const LOG = new Uint8Array(256);
for (let i = 0; i < 256; i += 1) EXP[i] = powMod257(45, i) % 256;
for (let i = 0; i < 256; i += 1) LOG[EXP[i]] = i;

/** `BIAS[i][j] = 45^(45^(17(i+2)+j+1) mod 257) mod 257`, 256 stored as 0. */
const BIAS: Uint8Array[] = Array.from({ length: 16 }, (_, i) =>
  Uint8Array.from({ length: 16 }, (_, j) => powMod257(45, powMod257(45, 17 * (i + 2) + j + 1)) % 256),
);

const rotateLeft5 = (value: number): number => ((value >> 5) | (value << 3)) & 0xff;

/** The 17 round keys: the (adjusted) challenge, then sixteen rotations of a 17-byte register. */
function keySchedule(challenge: Uint8Array): Uint8Array[] {
  const first = Uint8Array.from(challenge);
  first[15] ^= 6;
  const keys: Uint8Array[] = [first];
  const register = new Uint8Array(17);
  register.set(first);
  register[16] = first.reduce((parity, byte) => parity ^ byte, 0);

  for (let round = 1; round <= 16; round += 1) {
    for (let i = 0; i < 17; i += 1) register[i] = rotateLeft5(register[i]);
    keys.push(Uint8Array.from({ length: 16 }, (_, i) => (register[(round + i) % 17] + BIAS[round - 1][i]) & 0xff));
  }
  return keys;
}

const mixIn = (block: Uint8Array, key: Uint8Array, xorWhenSet: boolean): void => {
  for (let i = 0; i < BLOCK_SIZE; i += 1) {
    block[i] = xorMode(i) === xorWhenSet ? block[i] ^ key[i] : (block[i] + key[i]) & 0xff;
  }
};

function encrypt(plaintext: Uint8Array, keys: Uint8Array[]): Uint8Array {
  let block = Uint8Array.from(plaintext);
  for (let round = 0; round < 8; round += 1) {
    if (round === 2) mixIn(block, plaintext, true);
    mixIn(block, keys[round * 2], true);
    for (let i = 0; i < BLOCK_SIZE; i += 1) block[i] = xorMode(i) ? EXP[block[i]] : LOG[block[i]];
    // The second key goes in the other way round: addition where the first used XOR.
    mixIn(block, keys[round * 2 + 1], false);
    const mixed = block;
    block = Uint8Array.from({ length: BLOCK_SIZE }, (_, i) => {
      let sum = 0;
      for (let j = 0; j < BLOCK_SIZE; j += 1) sum += COEFFICIENTS[i][j] * mixed[j];
      return sum & 0xff;
    });
  }
  mixIn(block, keys[16], true);
  return block;
}

/** The 16-byte answer the earbuds expect to a 16-byte challenge. */
export function challengeResponse(challenge: Uint8Array): Uint8Array {
  if (challenge.length !== BLOCK_SIZE) throw new Error(`a challenge is ${BLOCK_SIZE} bytes, got ${challenge.length}`);
  return encrypt(PLAINTEXT, keySchedule(challenge));
}
