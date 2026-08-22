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
 *
 * That reading was tested directly and holds. `DriverId` in `core/driver.ts`
 * is `'sennheiser-gaia' | 'sony-mdr'`; these are `'sennheiser' | 'sony'`.
 * Both sets are pinned by tests — `core/driver.test.ts` on the ids,
 * `core/transport.test.ts` and `core/profiles.test.ts` on these — and spec
 * §3.2 writes the ids out longhand, so collapsing one into the other is a
 * value change, not a rename. What did move onto `DriverId` is the thing
 * that was never a brand in the first place: the discriminant three files in
 * `ui/` were reading off a whole driver descriptor.
 *
 * What still needs this type: `core/transport.ts` (`KnownService.brand`),
 * `core/session.ts`, `core/profiles.ts`, `core/driver.ts`'s `brand` field,
 * `ui/device/artwork.ts`, `ui/device/DeviceImage.tsx` and `core/manager.ts`.
 * This module moved here from the now-retired `src/device/` alongside
 * `manager.ts`; it was never a candidate for deletion.
 */
export type Brand = 'sennheiser' | 'sony' | 'nothing' | 'soundcore';
