/** Game-wide tunables. Gameplay feel lives here so it can be tweaked in one place. */

/** The battle world. The god panel sits below it (PANEL_HEIGHT), outside physics. */
export const ARENA = {
  width: 960,
  height: 540,
  gravity: 1400,
  groundHeight: 48,
} as const;

/** Height of the god box panel under the arena (DOM input + quick buttons). */
export const PANEL_HEIGHT = 96;
export const GAME_HEIGHT = ARENA.height + PANEL_HEIGHT;

export const FIGHTER = {
  width: 20,
  height: 26,
  maxHp: 100,
  /** Random per fighter, px/s. */
  speedMin: 105,
  speedMax: 165,
  accel: 900,
  jumpMin: 470,
  jumpMax: 600,
  /** After a hit, the AI can't steer for this long (knockback plays out). */
  stunMs: 260,
  /** Brief flash after a hit; damage still lands, it's only visual. */
  flashMs: 120,
} as const;

export const BATTLE = {
  /** The storm starts closing in at this time... */
  zoneStartMs: 50_000,
  /** ...and is fully closed (to zoneMinWidth) at this time. */
  zoneEndMs: 110_000,
  zoneMinWidth: 160,
  zoneDps: 12,
  /** A crate (weapon or mystery powerup) falls about this often. */
  crateEveryMs: 6_000,
  /** Kills by one fighter within this window count as a multi-kill. */
  multiKillMs: 3_000,
  /** Pause on the last survivor before the results screen. */
  endDelayMs: 2_200,
} as const;

/** Draw order. */
export const DEPTH = {
  background: -10,
  terrain: 0,
  zone: 20,
  disasterBack: 30,
  crate: 40,
  fighter: 50,
  weapon: 51,
  projectile: 55,
  disaster: 58,
  telegraph: 60,
  particles: 62,
  tags: 70,
  hud: 100,
  banner: 110,
} as const;

export const TEXTURES = {
  spark: 'fx-spark',
} as const;

export const REGISTRY_KEYS = {
  /** string[]: fighter names for the next battle. */
  roster: 'roster',
} as const;
