import { describe, expect, it } from 'vitest';

import { SAMSUNG_DRIVER } from './driver';
import { initialSamsungState } from './state';
import { samsungArtwork } from './assets';
import { COLOUR_NAMES, sameFinish } from './colours';
import { SAMSUNG_RENDERS } from './images.generated';
import { MODELS } from './models';

describe('samsungArtwork', () => {
  it("picks the render in the unit's own finish", () => {
    // 360 is a Buds4 Pro in white, 359 in black.
    expect(samsungArtwork('buds4Pro', 360).hero).toMatch(/sm-r640nzwa/);
    expect(samsungArtwork('buds4Pro', 359).hero).toMatch(/sm-r640nzka/);
  });

  it('matches a finish by what Samsung calls it, not the id table\'s word', () => {
    // The unit says Apricot; the store sells that Buds4 Pro as "pink gold".
    expect(samsungArtwork('buds4Pro', 361).hero).toMatch(/sm-r640nzda/);
    // The unit says Silver; the store sells the Buds3 FE as gray.
    expect(samsungArtwork('buds3Fe', 347).hero).toMatch(/sm-r420nza/);
  });

  it('falls back to the model\'s first render for a finish it has none of, or none reported', () => {
    const first = SAMSUNG_RENDERS.buds3Pro[0].url;
    expect(samsungArtwork('buds3Pro', 341).hero).toBe(first); // white: not in the catalog
    expect(samsungArtwork('buds3Pro', null).hero).toBe(first);
    expect(samsungArtwork('buds3Pro', 99999).hero).toBe(first);
  });

  it('draws the placeholder for a model with no render, and for no model', () => {
    expect(samsungArtwork('buds2Pro', 326)).toEqual({ hero: '', heroInactive: '', aspect: 1 });
    expect(samsungArtwork(null, null).hero).toBe('');
    expect(samsungArtwork('unknown', null).hero).toBe('');
  });

  it('sizes the frame to the render and reuses it when disconnected', () => {
    const artwork = samsungArtwork('buds4', 356);
    expect(artwork.aspect).toBeCloseTo(650 / 519);
    expect(artwork.heroInactive).toBe(artwork.hero);
  });
});

describe('SAMSUNG_DRIVER.artwork', () => {
  it("resolves from the model and the colour the earbuds reported", () => {
    const state = { ...initialSamsungState, info: { ...initialSamsungState.info, modelId: 'buds4Pro' as const, colour: 360 } };
    expect(SAMSUNG_DRIVER.artwork(state).hero).toMatch(/sm-r640nzwa/);
  });

  it('is the placeholder before anything is known', () => {
    expect(SAMSUNG_DRIVER.artwork(initialSamsungState).hero).toBe('');
  });
});

describe('the generated catalog', () => {
  it('only names models the driver knows, with https Samsung CDN URLs', () => {
    const known = new Set<string>(MODELS.map((model) => model.id));
    for (const [model, renders] of Object.entries(SAMSUNG_RENDERS)) {
      expect(known.has(model), model).toBe(true);
      for (const render of renders) {
        expect(render.url, `${model} ${render.colour}`).toMatch(/^https:\/\/images\.samsung\.com\/is\/image\/samsung\/p6pim\//);
      }
    }
  });

  it('carries nothing that looks like a credential', () => {
    expect(JSON.stringify(SAMSUNG_RENDERS)).not.toMatch(/token|secret|signature|apikey/i);
  });
});

describe('colours', () => {
  it('names the ids the real captures reported', () => {
    expect([260, 279, 298, 316, 326, 330, 340].map((id) => COLOUR_NAMES[id])).toEqual([
      'black', 'white', 'black', 'green', 'grey', 'graphite', 'silver',
    ]);
  });

  it('treats synonyms as one finish and distinct finishes as distinct', () => {
    expect(sameFinish('graphite', 'gray')).toBe(true);
    expect(sameFinish('apricot', 'pink gold')).toBe(true);
    expect(sameFinish('onyx', 'black')).toBe(true);
    expect(sameFinish('white', 'black')).toBe(false);
    expect(sameFinish('silver', 'white')).toBe(false);
  });
});
