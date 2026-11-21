import type { DisasterType } from '@shared/commands';
import { asteroids } from './asteroids';
import { disco } from './disco';
import { godzilla } from './godzilla';
import { lavaFloor } from './lavaFloor';
import { logoRam } from './logoRam';
import { nuke } from './nuke';
import { thanosSnap } from './thanosSnap';
import { beeSwarm } from './beeSwarm';
import { blizzard } from './blizzard';
import { giantStomp } from './giantStomp';
import { ufo } from './ufo';
import { zombieHorde } from './zombieHorde';
import { blackHole } from './blackHole';
import { drDoom } from './drDoom';
import { earthquake } from './earthquake';
import { lightning } from './lightning';
import { megaBomb } from './megaBomb';
import { orbitalLaser } from './orbitalLaser';
import { tornado } from './tornado';
import { tsunami } from './tsunami';
import type { DisasterFactory } from './types';
import { volcano } from './volcano';

/**
 * One file per disaster in this folder, registered here. A full Record, so
 * adding a type to shared/commands.ts fails to compile until it's implemented.
 */
export const disasterRegistry: Record<DisasterType, DisasterFactory> = {
  tornado,
  volcano,
  black_hole: blackHole,
  lightning,
  asteroids,
  dr_doom: drDoom,
  earthquake,
  tsunami,
  orbital_laser: orbitalLaser,
  mega_bomb: megaBomb,
  zombie_horde: zombieHorde,
  ufo,
  blizzard,
  giant_stomp: giantStomp,
  bee_swarm: beeSwarm,
  logo_ram: logoRam,
  thanos_snap: thanosSnap,
  disco,
  lava_floor: lavaFloor,
  godzilla,
  nuke,
};
