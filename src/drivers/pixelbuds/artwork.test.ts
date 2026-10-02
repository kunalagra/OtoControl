import { describe, expect, it } from 'vitest';

import { pixelBudsArtwork } from './artwork';
import { PIXELBUDS_RENDERS } from './pixelbudsCatalog.generated';
import { PIXELBUDS_PRO2_NAME, PIXELBUDS_PRO_NAME } from './state';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('pixelBudsArtwork', () => {
  it('shows a render per model, with its own aspect', () => {
    const pro = pixelBudsArtwork(PIXELBUDS_PRO_NAME);
    const pro2 = pixelBudsArtwork(PIXELBUDS_PRO2_NAME);
    expect(pro.hero).toContain('pixelbuds/pro-');
    expect(pro2.hero).toContain('pixelbuds/pro2-');
    expect(pro.aspect).toBeCloseTo(360 / 289);
    expect(pro2.aspect).toBe(1);
  });

  it('takes a named colour when it exists and falls back to the default when it does not', () => {
    expect(pixelBudsArtwork(PIXELBUDS_PRO2_NAME, 'hazel').hero).toContain('pro2-hazel');
    expect(pixelBudsArtwork(PIXELBUDS_PRO2_NAME, 'nope').hero).toContain('pro2-porcelain');
  });

  it('leaves the placeholder for an unnamed model', () => {
    expect(pixelBudsArtwork(null)).toEqual({ hero: '', heroInactive: '', aspect: 1 });
    expect(pixelBudsArtwork('Pixel Buds A-Series').hero).toBe('');
  });

  it('only names files that are bundled', () => {
    for (const renders of Object.values(PIXELBUDS_RENDERS)) {
      for (const { file } of Object.values(renders)) expect(existsSync(resolve(__dirname, '../../../public/devices', file))).toBe(true);
    }
  });
});
