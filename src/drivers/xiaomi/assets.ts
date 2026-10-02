import type { DeviceArtwork } from '@/core/artwork';
import { catalogImage } from './models';

/**
 * Every render in the vendor catalog is 860x580 (one outlier is 1080x800), the
 * earbuds laid out beside their case on a transparent background.
 */
const ASPECT = 860 / 580;

/**
 * The vendor catalog's render for this model, in the unit's own colour (`GetInfo`
 * TLV 13) when the catalog has it, else the model's default. No greyed variant
 * exists, so the disconnected state reuses the hero and relies on the component's
 * desaturation. A model the catalog has no render for gets the placeholder frame —
 * showing another model's picture would be the only alternative.
 */
export function xiaomiArtwork(vid: number | null, pid: number | null, colour: number | null): DeviceArtwork {
  const url = catalogImage(vid, pid, colour);
  if (!url) return { hero: '', heroInactive: '', aspect: 1 };
  return { hero: url, heroInactive: url, aspect: ASPECT };
}
