import { WEAPONS_CATALOG, type WeaponType } from '@shared/commands';

export type WeaponKind = 'melee' | 'gun' | 'laser' | 'rocket';

export interface WeaponDef {
  type: WeaponType;
  kind: WeaponKind;
  name: string;
  emoji: string;
  /** How close the target must be before the fighter attacks (px). */
  range: number;
  cooldownMs: number;
  /** Per hit / per pellet / per explosion. */
  damage: number;
  knock: number;
  /** Guns: pellets per shot, spread (radians), projectile speed. */
  pellets?: number;
  spread?: number;
  speed?: number;
  /** Rockets: explosion radius. */
  blast?: number;
  /** Where the weapon is drawn and the colour of its shots. */
  color: number;
  /** How likely a fighter is to spawn with it (relative). */
  weight: number;
}

const base = (type: WeaponType) => ({ type, name: WEAPONS_CATALOG[type].name, emoji: WEAPONS_CATALOG[type].emoji });

/**
 * All weapons. Balance lives here. Fighters have 100 HP; weapons are tuned so a
 * one-on-one takes several seconds and disasters are the truly deadly thing.
 */
export const WEAPONS: Record<WeaponType, WeaponDef> = {
  sword: { ...base('sword'), kind: 'melee', range: 36, cooldownMs: 520, damage: 3, knock: 240, color: 0xd9e3f0, weight: 5 },
  hammer: { ...base('hammer'), kind: 'melee', range: 40, cooldownMs: 950, damage: 5, knock: 460, color: 0x9b6b43, weight: 3 },
  pistol: { ...base('pistol'), kind: 'gun', range: 360, cooldownMs: 520, damage: 1.6, knock: 110, pellets: 1, spread: 0.07, speed: 640, color: 0xffd23f, weight: 5 },
  shotgun: { ...base('shotgun'), kind: 'gun', range: 210, cooldownMs: 1150, damage: 1, knock: 160, pellets: 6, spread: 0.38, speed: 560, color: 0xff9f43, weight: 3 },
  minigun: { ...base('minigun'), kind: 'gun', range: 320, cooldownMs: 95, damage: 0.6, knock: 50, pellets: 1, spread: 0.17, speed: 700, color: 0xfff275, weight: 2 },
  sniper: { ...base('sniper'), kind: 'gun', range: 900, cooldownMs: 2000, damage: 7, knock: 260, pellets: 1, spread: 0.012, speed: 1500, color: 0x7dffb0, weight: 2 },
  laser: { ...base('laser'), kind: 'laser', range: 430, cooldownMs: 1000, damage: 1.6, knock: 140, color: 0xff3df2, weight: 3 },
  rocket: { ...base('rocket'), kind: 'rocket', range: 520, cooldownMs: 2100, damage: 7, knock: 0, speed: 330, blast: 58, color: 0xff5d3d, weight: 2 },
};

export function randomWeapon(rand: () => number): WeaponType {
  const all = Object.values(WEAPONS);
  let roll = rand() * all.reduce((s, w) => s + w.weight, 0);
  for (const w of all) {
    roll -= w.weight;
    if (roll <= 0) return w.type;
  }
  return 'sword';
}
