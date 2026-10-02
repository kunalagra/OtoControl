import type { DeviceArtwork } from '@/core/artwork';

/**
 * No render is bundled and none is fetched: Google publishes no product images
 * on the wire or in the companion app's bundle (spec §7), and this app makes no
 * network requests for artwork. The empty frame is the placeholder the shared
 * hero component already draws for a model without one.
 */
export const pixelBudsArtwork = (): DeviceArtwork => ({ hero: '', heroInactive: '', aspect: 1 });
