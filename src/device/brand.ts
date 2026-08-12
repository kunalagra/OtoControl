/**
 * Which vendor's protocol a device speaks.
 *
 * Its own module because almost everything depends on it — transport,
 * profiles, `DeviceDriver.brand` and artwork — and it belongs to none of
 * them. It lived in `ui/device/artwork` for a while, which made the protocol
 * layer import from the UI layer to name a protocol.
 *
 * A brand here means a protocol family, not a trademark: it is what decides
 * whether GAIA or MDR framing goes down the wire.
 *
 * No longer what `ActiveDevice` discriminates on, or what UI consumers branch
 * on — that moved to `driver`/`id` in `manager.ts`, once there was a `DRIVERS`
 * table to move it onto. `Brand` remains for the things that are genuinely
 * keyed by protocol family rather than by a specific driver: `profiles.ts`,
 * `transport.ts`'s `KnownService`, `ui/device/artwork.ts`, and the manager's
 * own sticky selection (`resolveBrand`/`knowsDevice`), whose tests pin these
 * exact two string values. Deleting it outright would mean folding all of
 * those into driver ids too, which is a larger change than retiring
 * `ActiveDevice`'s union — see `driver.ts`'s `brand` field on `DeviceDriver`
 * for the bridge between the two.
 */
export type Brand = 'sennheiser' | 'sony';
