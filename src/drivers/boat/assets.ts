import type { DeviceArtwork } from '@/core/artwork';
import type { BoatProduct } from './products.generated';

/**
 * The vendor catalog render for this model (`product_image_1`), plus the
 * per-bud renders the catalog carries (`hearable_left/right_bud_image`) —
 * the `DeviceArtwork.budLeft/budRight` slots, so the device frame can fade
 * the bud sitting in its case. No greyed variant exists, so the
 * disconnected state reuses the hero. Unknown models get the placeholder
 * frame rather than another model's picture.
 */
export function boatArtwork(product: BoatProduct | null): DeviceArtwork {
  if (!product?.image) return { hero: '', heroInactive: '', aspect: 1 };
  return {
    hero: product.image,
    heroInactive: product.image,
    aspect: 1,
    ...(product.leftImage ? { budLeft: product.leftImage } : {}),
    ...(product.rightImage ? { budRight: product.rightImage } : {}),
  };
}
