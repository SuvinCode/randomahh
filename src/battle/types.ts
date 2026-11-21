import type Phaser from 'phaser';
import type { Juice } from '../fx';
import type { TerrainShape } from '../world/buildTerrain';
import type { ArenaBodies } from '../world/drawArena';
import type { Fighter } from '../fighters/fighter';
import type { Projectiles } from './projectiles';

export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Who dealt damage, for the kill feed. Disasters and bosses have no `fighter`. */
export interface Attacker {
  name: string;
  /** Emoji shown between killer and victim (weapon or disaster). */
  icon: string;
  color: number;
  fighter?: Fighter;
}

/** Anything that can be hit: fighters, and bosses like Dr Doom. */
export interface Target {
  readonly id: number;
  readonly name: string;
  readonly color: number;
  readonly isBoss: boolean;
  readonly alive: boolean;
  /** Not targeted by fighters' AI (invisibility). They can still be hit. */
  readonly hidden?: boolean;
  /** A small fry (zombie): no "defeated!" callout, no kill credit. */
  readonly minion?: boolean;
  /** Centre. */
  readonly x: number;
  readonly y: number;
  bounds(): Box;
  /** Only BattleContext.damage calls this. Returns true if this hit finished them. */
  applyDamage(amount: number, fromX: number, knock: number, lift: number): boolean;
  /** Accelerate (px/s²) for dt seconds: tornadoes, black holes. Bosses may ignore it. */
  pull(ax: number, ay: number, dt: number): void;
}

export interface PaletteColors {
  sky: number;
  ground: number;
  platform: number;
  accent: number;
  hazard: number;
}

export interface HitOptions {
  /** Where the hit came from (sets knockback direction). Defaults to the attacker's position or the target. */
  fromX?: number;
  /** Horizontal knockback speed, px/s. */
  knock?: number;
  /** Upward knockback speed, px/s. */
  lift?: number;
}

/**
 * Everything a weapon, projectile or disaster may touch. They never reach into
 * the scene directly.
 */
export interface BattleContext {
  scene: Phaser.Scene;
  rng: Phaser.Math.RandomDataGenerator;
  colors: PaletteColors;
  terrain: TerrainShape;
  bodies: ArenaBodies;
  /** Top of the floor (y). */
  floorY: number;
  juice: Juice;
  projectiles: Projectiles;
  /** Living fighters. */
  fighters(): Fighter[];
  /** Living fighters and bosses. */
  targets(): Target[];
  /** Deal damage (handles kill credit, the feed and effects). */
  damage(target: Target, amount: number, by: Attacker, opts?: HitOptions): void;
  /** Area damage with falloff and knockback away from the centre. */
  explode(x: number, y: number, radius: number, damage: number, by: Attacker, spare?: Target): void;
  /** Instant piercing beam: damages every target it crosses (except `spare`) and draws it briefly. */
  beam(x1: number, y1: number, x2: number, y2: number, half: number, damage: number, by: Attacker, color: number, spare?: Target): void;
  /** Bosses register themselves so fighters and projectiles can hit them. */
  addTarget(t: Target): void;
  removeTarget(t: Target): void;
  /** Big centre-screen text ("DOUBLE KILL!", "Dr Doom has arrived!"). */
  announce(text: string, color?: number): void;
  fighterByName(name: string): Fighter | undefined;
  /** Is (x, y) inside solid floor? (Projectiles pass through one-way ledges.) */
  inFloor(x: number, y: number): boolean;
  /** Weapon/powerup crates lying around (fighters sometimes go for them). */
  crates(): { x: number; y: number }[];
  /** Arena-wide states disasters switch on, which the fighters' AI reacts to. */
  effects: { lavaFloor: boolean };
  /** Current safe zone, [left, right]. */
  zone(): [number, number];
}
