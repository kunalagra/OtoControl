import type { DeviceArtwork } from '@/core/artwork';

/**
 * No product render yet. The vendor catalog does carry icon URLs per model, but
 * wiring them in means a generated asset table and a CDN dependency that v1
 * leaves out, so every model gets the placeholder frame rather than another
 * model's picture.
 */
export const xiaomiArtwork = (): DeviceArtwork => ({ hero: '', heroInactive: '', aspect: 1 });
