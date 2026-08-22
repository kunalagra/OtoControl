import { describe, expect, it } from 'vitest';

import {
  FEATURE_NAMES,
  Feature,
  PROFILES,
  profileFor,
  unsupportedFeatures,
} from './profiles';
import { SONY_CATALOG_MODELS } from './sonyModels.generated';

describe('profileFor', () => {
  it('matches the model string a Momentum reports', () => {
    // The device says "M4AEBT Black", not "MOMENTUM 4 Wireless".
    expect(profileFor('sennheiser', 'M4AEBT Black')?.id).toBe('momentum-4');
  });

  it('matches Sony models', () => {
    expect(profileFor('sony', 'WF-C500')?.id).toBe('wf-c500');
    expect(profileFor('sony', 'WH-1000XM5')?.id).toBe('wh-1000xm5');
  });

  it('will not match a model across brands', () => {
    // Brand comes from the granted port's service, so a cross-brand match
    // would mean showing one vendor's features for another's hardware.
    expect(profileFor('sennheiser', 'WF-C500')).toBeNull();
    expect(profileFor('sony', 'M4AEBT Black')).toBeNull();
  });

  it('returns null for an unknown model rather than guessing', () => {
    expect(profileFor('sony', 'WF-9999XZ')).toBeNull();
    expect(profileFor('sony', null)).toBeNull();
  });

  it('gives each neighbouring model its own profile rather than a loose match', () => {
    // WF-C510 is in Sony's catalog, so it resolves — to its own entry, never
    // to WF-C500's.
    expect(profileFor('sony', 'WF-C510')?.id).toBe('wf-c510');
    expect(profileFor('sony', 'WF-C510')?.name).toBe('WF-C510');
  });
});

describe('profile data', () => {
  it('gives every profile a unique id', () => {
    const ids = PROFILES.map((profile) => profile.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('names every feature it declares', () => {
    for (const profile of PROFILES) {
      for (const feature of profile.features) {
        expect(FEATURE_NAMES[feature]).toBeTruthy();
      }
    }
  });

  it('only claims a case for earbuds', () => {
    for (const profile of PROFILES) {
      if (profile.hasCase) expect(profile.form).toBe('earbuds');
    }
  });

  it('pairs dual battery with earbuds', () => {
    for (const profile of PROFILES) {
      if (profile.battery === 'dual') expect(profile.form).toBe('earbuds');
    }
  });
});

describe('unsupportedFeatures', () => {
  it('is empty for the Momentum, which is driven feature by feature', () => {
    const m4 = PROFILES.find((profile) => profile.id === 'momentum-4')!;
    expect(unsupportedFeatures(m4)).toEqual([]);
  });

  it('does not claim low latency, which this model never enables', () => {
    // m4.json: "LowLatencyMode_MinFwVersion": "99.99.99".
    const m4 = PROFILES.find((profile) => profile.id === 'momentum-4')!;
    expect(m4.features).not.toContain(Feature.LowLatency);
    expect(m4.features).toContain(Feature.ComfortCall);
    expect(m4.features).toContain(Feature.BluetoothCompatibility);
  });

  it('declares no Sony features at all — the capability read is the truth', () => {
    // The old hand-written layer carried feature lists: one hardware-verified
    // (WF-C500), the rest declared blind from vendor configs. Every entry
    // lost to the live capability read on each connect anyway, which made
    // them a second source of truth for facts the device re-states better.
    // The probe's Reported-capabilities card is now the only feature surface.
    const sonyProfiles = PROFILES.filter((profile) => profile.brand === 'sony');
    expect(sonyProfiles.length).toBeGreaterThan(0);
    for (const profile of sonyProfiles) {
      expect(profile.features, profile.id).toEqual([]);
      expect(unsupportedFeatures(profile), profile.id).toEqual([]);
    }
  });
});

describe('the wider Sony range', () => {
  const sony = PROFILES.filter((profile) => profile.brand === 'sony');

  it('covers every headphone-class model in Sony\'s catalog', () => {
    const ids = new Set(sony.map((profile) => profile.id));
    // The generated table is the model list; every entry resolves.
    for (const { name } of SONY_CATALOG_MODELS) {
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      expect(ids.has(id), name).toBe(true);
    }
    // Speakers are excluded — they do not speak this driver's protocol.
    expect(ids.has('linkbuds-speaker')).toBe(false);
    expect(ids.has('srs-ns7')).toBe(false);
    expect(ids.has('ult-field-1')).toBe(false);
  });


  it('classifies form factor from Sony\'s own naming', () => {
    expect(profileFor('sony', 'INZONE Buds')?.form).toBe('earbuds');
    expect(profileFor('sony', 'LinkBuds S')?.form).toBe('earbuds');
    expect(profileFor('sony', 'WI-C600N')?.form).toBe('over-ear');
    expect(profileFor('sony', 'ULT WEAR')?.form).toBe('over-ear');
    expect(profileFor('sony', 'INZONE H9 II')?.battery).toBe('single');
    expect(profileFor('sony', 'LinkBuds Clip')?.hasCase).toBe(true);
  });

  it('does not let one model number match another', () => {
    // WF and WH differ by a single letter, and XM3/4/5 by a digit.
    expect(profileFor('sony', 'WH-1000XM4')?.id).toBe('wh-1000xm4');
    expect(profileFor('sony', 'WF-1000XM4')?.id).toBe('wf-1000xm4');
    expect(profileFor('sony', 'WH-1000XM3')?.id).toBe('wh-1000xm3');
  });

  it('gives every ANC model noise control we can actually drive', () => {
    for (const profile of sony) {
      if (!profile.features.includes(Feature.Anc)) continue;
      expect(unsupportedFeatures(profile)).not.toContain(Feature.Anc);
      expect(unsupportedFeatures(profile)).not.toContain(Feature.AmbientLevel);
    }
  });

  it('only claims a colour render that exists on disk', async () => {
    // Guards the mapping between artworkColours and the converted webp files.
    const { readdirSync } = await import('node:fs');
    const files = new Set(readdirSync('public/devices/sony'));
    const slugs: Record<number, string> = {
      0x01: 'black', 0x02: 'white', 0x03: 'silver',
      0x05: 'blue', 0x06: 'pink', 0x08: 'green', 0x0c: 'orange',
    };
    for (const profile of sony) {
      for (const code of profile.artworkColours) {
        expect(files).toContain(`${profile.artwork}_${slugs[code]}_hero.webp`);
      }
    }
  });
});
