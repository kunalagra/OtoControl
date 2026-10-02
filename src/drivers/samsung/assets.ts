import type { DeviceArtwork } from '@/core/artwork';
import { COLOUR_NAMES, sameFinish } from './colours';
import { SAMSUNG_RENDERS } from './images.generated';
import type { SamsungModelId } from './models';

/** The renders are 650 × 519 transparent PNGs. */
const ASPECT = 650 / 519;

/** What a model gets when no render is known for it: the placeholder frame `DeviceImage` draws for an empty `hero`. */
const PLACEHOLDER: DeviceArtwork = { hero: '', heroInactive: '', aspect: 1 };

/**
 * The model's product render in the unit's own finish, falling back to the
 * model's first render when that finish has none, and to the placeholder when
 * the model has none at all.
 *
 * The renders are Samsung's own public CDN images (`images.generated.ts`, from
 * `scripts/gen-samsung-images.py`); only models Samsung still sells have one.
 * No greyed variant exists, so the disconnected state reuses the hero and
 * relies on the component's desaturation.
 */
export function samsungArtwork(modelId: SamsungModelId | null, colour: number | null): DeviceArtwork {
  const renders = modelId === null ? undefined : SAMSUNG_RENDERS[modelId];
  if (!renders || renders.length === 0) return PLACEHOLDER;
  const finish = colour === null ? undefined : COLOUR_NAMES[colour];
  const match = finish ? renders.find((render) => sameFinish(render.colour, finish)) : undefined;
  const { url } = match ?? renders[0];
  return { hero: url, heroInactive: url, aspect: ASPECT };
}
