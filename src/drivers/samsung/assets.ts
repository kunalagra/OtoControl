import type { DeviceArtwork } from '@/core/artwork';

/**
 * No product renders are bundled for Galaxy Buds, and this app fetches nothing
 * from the network for artwork, so every model gets the placeholder frame
 * (`ui/device/DeviceImage` draws one for an empty `hero`).
 */
export const samsungArtwork = (): DeviceArtwork => ({ hero: '', heroInactive: '', aspect: 1 });
