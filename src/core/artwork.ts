/**
 * The brand-agnostic shape of a device's artwork, plus the one helper every
 * brand's resolver shares.
 *
 * Lives in the core tier — as the return type of `DeviceDriver.artwork` —
 * because it is a plain data contract with no DOM in it: the descriptor
 * registry in `core/driver.ts` names it, each vendor's resolver in
 * `drivers/<vendor>/` fills it, and `ui/device/DeviceImage` renders it. The
 * per-brand knowledge (which files exist, how colour is determined) stays
 * with the vendor that has it; this module deliberately knows none of that.
 */

export interface DeviceArtwork {
  hero: string
  /** Greyed render for the disconnected state; falls back to `hero`. */
  heroInactive: string
  /** width / height of the source image. */
  aspect: number
  /**
   * A bundled URL to swap in when `hero`/`heroInactive` fail to load — for
   * artwork served from a CDN, offline. Absent when the hero is already local
   * and cannot 404.
   */
  fallback?: string
  /**
   * Separate renders of the left and right earbuds, when the vendor ships
   * them — Soundcore does, for most models. Present lets the device frame
   * fade the one that is charging in its case, the way the official app does,
   * instead of showing one flat hero.
   */
  budLeft?: string
  budRight?: string
}

/** A path under `public/devices/`, respecting the deploy base URL. */
export const asset = (path: string): string => `${import.meta.env.BASE_URL}devices/${path}`
