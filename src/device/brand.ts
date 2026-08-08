/**
 * Which vendor's protocol a device speaks.
 *
 * Its own module because almost everything depends on it — transport, the
 * device manager, profiles, the section registry and artwork — and it belongs
 * to none of them. It lived in `ui/device/artwork` for a while, which made the
 * protocol layer import from the UI layer to name a protocol.
 *
 * A brand here means a protocol family, not a trademark: it is what decides
 * whether GAIA or MDR framing goes down the wire.
 */
export type Brand = 'sennheiser' | 'sony';
