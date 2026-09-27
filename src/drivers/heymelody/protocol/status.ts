/** A missing or non-zero leading status byte fails, like the vendor's `CommandUtil.n()` (realme `:443-453`). */
export function statusBody(payload: Uint8Array, what: string): Uint8Array {
  if (payload.length === 0 || payload[0] !== 0) {
    throw new Error(`${what} returned status ${payload[0] ?? 'none'}`);
  }
  return payload.subarray(1);
}
