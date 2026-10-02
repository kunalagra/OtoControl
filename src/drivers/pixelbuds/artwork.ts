import { asset } from '@/core/artwork';
import type { DeviceArtwork } from '@/core/artwork';
import { PIXELBUDS_DEFAULT_COLOUR, PIXELBUDS_RENDERS } from './pixelbudsCatalog.generated';
import { PIXELBUDS_PRO2_NAME, PIXELBUDS_PRO_NAME } from './state';

/**
 * The earbud render for the model, bundled from the companion app's own
 * drawables (`scripts/gen-pixelbuds-artwork.py`) — no network request. The
 * model is Pro 2 only on proof of Adaptive and Pro otherwise (`state.ts`), and
 * the wire reports no colour, so each model shows its default colour; `colour`
 * picks another once a source for it exists. An unnamed model gets the
 * placeholder frame the shared hero component draws.
 */
export function pixelBudsArtwork(model: string | null, colour?: string | null): DeviceArtwork {
  const slug = model === PIXELBUDS_PRO2_NAME ? 'pro2' : model === PIXELBUDS_PRO_NAME ? 'pro' : null;
  const renders = slug ? PIXELBUDS_RENDERS[slug] : undefined;
  const render = slug && renders ? ((colour ? renders[colour] : undefined) ?? renders[PIXELBUDS_DEFAULT_COLOUR[slug]]) : undefined;
  if (!render) return { hero: '', heroInactive: '', aspect: 1 };
  const url = asset(render.file);
  return { hero: url, heroInactive: url, aspect: render.width / render.height };
}
