/**
 * Turns a connect failure into copy the UI can show.
 *
 * Shared by `MomentumDevice` and `SonyDevice`: neither the check nor the
 * fallback formatting depends on a brand, a client, or any device-specific
 * state, so unlike `adoptPort`/`connect` — which shape a `#patch` against a
 * device-specific state type — there is nothing here for either device to
 * own.
 */
export function describeError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return 'No device was selected. Make sure it is powered on and connected as an audio device.';
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
