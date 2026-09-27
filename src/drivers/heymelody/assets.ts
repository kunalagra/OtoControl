import type { DeviceArtwork } from '@/core/artwork';
import { HEYMELODY_CATALOG_IMAGES, HEYMELODY_COLOUR_IMAGES } from './heymelodyCatalog.generated';

/**
 * The vendor catalog render for this productId — the one for the unit's own
 * colour (`0x010B`) when the catalog has per-colour renders, else the model's
 * default. No greyed variant exists, so the disconnected state reuses the hero
 * and relies on the component's desaturation. A model the catalog has no
 * render for gets the placeholder frame — showing another model's picture
 * would be the only alternative.
 */
export function heymelodyArtwork(productId: string | null, colourId?: number | null): DeviceArtwork {
  const id = productId?.toUpperCase();
  const remote = id
    ? ((colourId != null ? HEYMELODY_COLOUR_IMAGES[id]?.[String(colourId)] : undefined) ?? HEYMELODY_CATALOG_IMAGES[id])
    : undefined;
  if (!remote) return { hero: '', heroInactive: '', aspect: 1 };
  return { hero: remote, heroInactive: remote, aspect: 1 };
}
