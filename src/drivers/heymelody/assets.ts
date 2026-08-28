import type { DeviceArtwork } from '@/core/artwork';

/**
 * No per-model artwork exists for this driver yet — 137 devices across 3
 * brands, and the app's own product images are cloud-served rather than
 * bundled (spec §2 non-goals). Empty `hero`/`heroInactive` deliberately route
 * `DeviceImage` into its existing "Product art unavailable" placeholder
 * (`ui/device/DeviceImage.tsx`'s `src === ''` branch) rather than pointing at
 * an asset that does not exist. Replace once real per-model renders are
 * sourced.
 */
export function heymelodyArtwork(): DeviceArtwork {
  return { hero: '', heroInactive: '', aspect: 1 };
}
