/**
 * The Boat driver descriptor — Bluetrum-based boAt models (`BLUETRUM_SDK`)
 * over SPP.
 *
 * Capability gating runs off the opportunistically-read set (`device.ts`:
 * the `-2` bitmask plus the ids actually present in the batch reply), the
 * same shape as `drivers/nothing/driver.ts`, not Sony's live bitmap
 * negotiation. No EQ preset table, no gain range, no `eqPreview`: the wire
 * carries mode bytes and raw gain bytes whose units were not traced, and
 * the descriptor does not invent either.
 */

import type { DeviceDriver, DriverSection, QuickSetting } from '@/core/driver';
import { servicesFor } from '@/core/transport';
import { boatArtwork } from './assets';
import { lookupBoatProduct } from './catalog';
import { BoatDevice } from './device';
import type { BoatState } from './device';
import { BoatDevices } from './sections/BoatDevices';
import { BoatNoise } from './sections/BoatNoise';
import { BoatSound } from './sections/BoatSound';
import { BoatSystem } from './sections/BoatSystem';

const BOAT_SECTIONS: DriverSection[] = [
  { id: 'noise', label: 'Noise control' },
  { id: 'sound', label: 'Sound' },
  { id: 'devices', label: 'Connections' },
  { id: 'system', label: 'System' },
];

const COMPONENTS = {
  noise: BoatNoise,
  sound: BoatSound,
  devices: BoatDevices,
  system: BoatSystem,
} as const;

const cell = (level: number, charging: boolean): string => `${level}%${charging ? ' ⚡' : ''}`;

export const BOAT_DRIVER = {
  id: 'boat-bluetrum',
  label: 'Boat',
  brand: 'boat',
  services: servicesFor('boat'),
  profiles: [],
  create: (deps) => new BoatDevice(deps.openTransport),
  sections: (state: BoatState) => {
    // Before a poll has answered, keep every tab rather than hiding one about to appear.
    const known = state.capabilities.size > 0;
    return BOAT_SECTIONS.filter((section) => {
      if (section.id === 'noise') return !known || state.capabilities.has('anc');
      if (section.id === 'sound') return !known || state.capabilities.has('eq');
      // Nothing to show without the table, so unlike the others this stays hidden until known.
      if (section.id === 'devices') return state.capabilities.has('multipoint');
      return true;
    });
  },
  components: COMPONENTS,
  // Null until the peer table has been read, so Home shows its own empty state rather than an empty tile.
  connections: (state: BoatState) =>
    state.peers === null || state.peers.length === 0
      ? null
      : state.peers.map((peer) => ({ name: peer.name || peer.mac, connected: false, isThisDevice: false })),
  codecName: (_state: BoatState) => null,
  statusLine: (state: BoatState) => {
    const { battery } = state;
    if (!battery) return null;
    const parts: string[] = [];
    if (battery.left) parts.push(`L ${cell(battery.left.level, battery.left.charging)}`);
    if (battery.right) parts.push(`R ${cell(battery.right.level, battery.right.charging)}`);
    if (battery.case) parts.push(`Case ${cell(battery.case.level, battery.case.charging)}`);
    return parts.length > 0 ? parts.join(' · ') : null;
  },
  // True when in-ear is unknown, per the interface's own contract.
  worn: (state: BoatState) => state.inEar ?? true,
  artwork: (state: BoatState) =>
    boatArtwork(lookupBoatProduct(state.info.bleName ?? state.info.model)),
  // In-ear detection is the one Home switch with a known wire meaning.
  quickSettings: (device: BoatDevice, state: BoatState): QuickSetting[] =>
    !state.capabilities.has('inEar')
      ? []
      : [
          {
            kind: 'toggle',
            id: 'inEarDetect',
            label: 'In-ear detection',
            value: state.inEar,
            set: (value) => void device.setInEarDetect(value),
          },
        ],
} as const satisfies DeviceDriver<BoatDevice, BoatState>;
