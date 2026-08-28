/**
 * The HeyMelody driver descriptor — OPPO/realme/OnePlus earbuds sharing one
 * app and protocol. Capability gating runs off the opportunistically-probed
 * set (`device.ts`), the same shape as `drivers/nothing/driver.ts`, not
 * Sony's live bitmap negotiation — see spec §3.5 for why.
 */

import type { DeviceDriver, DriverSection } from '@/core/driver';
import { servicesFor } from '@/core/transport';
import { heymelodyArtwork } from './assets';
import { HeyMelodyDevice } from './device';
import type { HeyMelodyState } from './device';
import { BATTERY_LABEL } from './commands';
import { HeyMelodyNoise } from './sections/Noise';
import { HeyMelodySound } from './sections/Sound';
import { HeyMelodySystem } from './sections/System';

const HEYMELODY_SECTIONS: DriverSection[] = [
  { id: 'noise', label: 'Noise control' },
  { id: 'sound', label: 'Sound' },
  { id: 'system', label: 'System' },
];

const COMPONENTS = {
  noise: HeyMelodyNoise,
  sound: HeyMelodySound,
  system: HeyMelodySystem,
} as const;

export const HEYMELODY_DRIVER = {
  id: 'heymelody',
  label: 'HeyMelody (OPPO / realme / OnePlus)',
  brand: 'heymelody',
  services: servicesFor('heymelody'),
  profiles: [],
  create: (deps) => new HeyMelodyDevice(deps.openTransport),
  sections: (state) => {
    // Before a probe has run, keep every tab rather than hiding one about to appear.
    const known = state.capabilities.size > 0;
    return HEYMELODY_SECTIONS.filter((section) => {
      if (section.id === 'noise') return !known || state.capabilities.has('anc');
      if (section.id === 'sound') return !known || state.capabilities.has('eq');
      return true;
    });
  },
  components: COMPONENTS,
  codecName: (_state: HeyMelodyState) => null,
  statusLine: (state: HeyMelodyState) => {
    if (state.battery.length === 0) return null;
    return state.battery
      .map((cell) => `${BATTERY_LABEL[cell.device]} ${cell.level}%${cell.charging ? ' ⚡' : ''}`)
      .join(' · ');
  },
  // No wear-detection command modeled this phase — true-when-unknown per the interface's own contract.
  worn: (_state: HeyMelodyState) => true,
  artwork: (_state: HeyMelodyState) => heymelodyArtwork(),
} as const satisfies DeviceDriver<HeyMelodyDevice, HeyMelodyState>;
