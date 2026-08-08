import { describe, expect, it } from 'vitest';

import {
  FEATURE_NAMES,
  Feature,
  IMPLEMENTED,
  PROFILES,
  profileFor,
  unsupportedFeatures,
} from './profiles';

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

  it('does not let WF-C500 swallow WF-C510', () => {
    // A neighbouring model number is the obvious way a loose pattern breaks.
    expect(profileFor('sony', 'WF-C510')).toBeNull();
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

  it('shows the one WF-C500 feature we never wrote', () => {
    // The device reports voice guidance and BudsLink declares it, but we have
    // no command for it. Declaring the hardware honestly is what surfaced it.
    const c500 = PROFILES.find((profile) => profile.id === 'wf-c500')!;
    expect(unsupportedFeatures(c500)).toEqual([Feature.VoicePrompts]);
  });

  it('reports the XM5 gap honestly', () => {
    const xm5 = PROFILES.find((profile) => profile.id === 'wh-1000xm5')!;
    const missing = unsupportedFeatures(xm5);

    // Noise control is built now — the headline feature works.
    expect(missing).not.toContain(Feature.Anc);
    expect(missing).not.toContain(Feature.AmbientLevel);
    // As does everything it shares with the WF-C500.
    expect(missing).not.toContain(Feature.Equalizer);
    expect(missing).not.toContain(Feature.Upscaling);

    // What is left is the honest to-do list, surfaced in the UI rather than
    // hidden. Speak-to-chat is the next most visible one.
    expect(missing).toContain(Feature.SpeakToChat);
    expect(missing).toContain(Feature.Multipoint);
  });

  it('never lists a feature the brand implements', () => {
    for (const profile of PROFILES) {
      const implemented = new Set(IMPLEMENTED[profile.brand]);
      for (const feature of unsupportedFeatures(profile)) {
        expect(implemented.has(feature)).toBe(false);
      }
    }
  });
});

describe('the wider Sony range', () => {
  const sony = PROFILES.filter((profile) => profile.brand === 'sony');

  it('covers every model we hold renders for', () => {
    expect(sony.map((profile) => profile.id).sort()).toEqual([
      'wf-1000xm3', 'wf-1000xm4', 'wf-1000xm5', 'wf-c500',
      'wh-1000xm3', 'wh-1000xm4', 'wh-1000xm5',
    ]);
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
