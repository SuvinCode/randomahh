import type { DisasterType } from '@shared/commands';
import type { SfxName } from './sfx';

/**
 * The sound each disaster makes when it's unleashed (played by Battle). A full
 * Record, so a new disaster without a sound fails to compile. `null`: the
 * disaster makes its own entrance sound (the nuke's siren).
 * Big moments (impacts, eruptions, the wave arriving…) play from the disaster files.
 */
export const DISASTER_SOUNDS: Record<DisasterType, SfxName | null> = {
  tornado: 'wind',
  volcano: 'volcano',
  black_hole: 'blackhole',
  lightning: 'crackle',
  asteroids: 'whistle',
  dr_doom: 'villain',
  earthquake: 'quake',
  tsunami: 'swell',
  orbital_laser: 'charge',
  mega_bomb: 'fuse',
  zombie_horde: 'groan',
  ufo: 'ufo',
  blizzard: 'blizzard',
  giant_stomp: 'giant',
  bee_swarm: 'swarm',
  logo_ram: 'horn',
  thanos_snap: 'shimmer',
  disco: 'party',
  lava_floor: 'lava',
  godzilla: 'kaiju',
  nuke: null,
};
