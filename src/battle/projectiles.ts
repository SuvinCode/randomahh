import Phaser from 'phaser';
import { ARENA, DEPTH } from '../config';
import { boxHitsCircle } from './geometry';
import type { Attacker, BattleContext, Target } from './types';

export type ProjectileKind = 'bullet' | 'rocket' | 'lava' | 'spark' | 'rock' | 'ice';

export interface ProjectileSpec {
  kind: ProjectileKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  damage: number;
  radius: number;
  color: number;
  by: Attacker;
  /** Never hits this target (whoever fired it). */
  owner?: Target;
  /** px/s² downward. */
  gravity?: number;
  /** Explodes on impact with this radius (damage = `damage`). */
  explodeRadius?: number;
  /** Knockback speed on a direct hit. */
  knock?: number;
  lifeMs?: number;
}

interface Projectile extends ProjectileSpec {
  ms: number;
  trail: { x: number; y: number }[];
}

/**
 * Every bullet, rocket, lava bomb and spark in flight, simulated and drawn in
 * one place. They pass through one-way ledges and stop at the floor and walls.
 */
export class Projectiles {
  private readonly list: Projectile[] = [];
  private readonly g: Phaser.GameObjects.Graphics;
  private ctx!: BattleContext;

  constructor(scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(DEPTH.projectile);
  }

  attach(ctx: BattleContext): void {
    this.ctx = ctx;
  }

  fire(spec: ProjectileSpec): void {
    if (this.list.length > 600) return; // safety valve
    this.list.push({ ...spec, ms: 0, trail: [] });
  }

  get count(): number {
    return this.list.length;
  }

  update(dt: number): void {
    const s = dt / 1000;
    const targets = this.ctx.targets();
    this.g.clear();
    for (let k = this.list.length - 1; k >= 0; k--) {
      const p = this.list[k];
      p.ms += dt;
      if (p.gravity) p.vy += p.gravity * s;
      p.x += p.vx * s;
      p.y += p.vy * s;
      if (p.kind === 'rocket' || p.kind === 'lava' || p.kind === 'rock') {
        p.trail.push({ x: p.x, y: p.y });
        if (p.trail.length > 10) p.trail.shift();
      }

      const out = p.x < -30 || p.x > ARENA.width + 30 || p.y > ARENA.height + 30 || p.y < -600;
      const expired = p.lifeMs !== undefined && p.ms > p.lifeMs;
      const landed = this.ctx.inFloor(p.x, p.y + p.radius * 0.5);
      let hit: Target | undefined;
      if (!out && !landed) hit = targets.find((t) => t !== p.owner && t.alive && boxHitsCircle(t.bounds(), p.x, p.y, p.radius));

      if (hit || landed || out || expired) {
        this.list.splice(k, 1);
        if (p.explodeRadius && !out) {
          this.ctx.explode(p.x, p.y, p.explodeRadius, p.damage, p.by);
        } else if (hit) {
          this.ctx.damage(hit, p.damage, p.by, { fromX: p.x - Math.sign(p.vx) * 10, knock: p.knock ?? 120, lift: 120 });
          this.ctx.juice.burst(p.x, p.y, p.color, 5);
        } else if (landed) {
          this.ctx.juice.burst(p.x, p.y, p.color, 3);
        }
        continue;
      }
      this.draw(p);
    }
  }

  private draw(p: Projectile): void {
    const g = this.g;
    p.trail.forEach((t, n) => g.fillStyle(p.kind === 'rocket' ? 0xbbbbbb : p.color, (n / p.trail.length) * 0.45).fillCircle(t.x, t.y, 1 + n * 0.35));
    switch (p.kind) {
      case 'bullet': {
        const len = Math.min(14, Math.hypot(p.vx, p.vy) * 0.012);
        const a = Math.atan2(p.vy, p.vx);
        g.lineStyle(p.radius * 1.6, p.color, 1).lineBetween(p.x, p.y, p.x - Math.cos(a) * len, p.y - Math.sin(a) * len);
        g.fillStyle(0xffffff, 1).fillCircle(p.x, p.y, p.radius * 0.6);
        break;
      }
      case 'rocket': {
        const a = Math.atan2(p.vy, p.vx);
        g.lineStyle(6, 0x333333, 1).lineBetween(p.x, p.y, p.x - Math.cos(a) * 12, p.y - Math.sin(a) * 12);
        g.fillStyle(p.color, 1).fillCircle(p.x, p.y, 4);
        g.fillStyle(0xffb347, Phaser.Math.FloatBetween(0.6, 1)).fillCircle(p.x - Math.cos(a) * 14, p.y - Math.sin(a) * 14, 4);
        break;
      }
      case 'lava':
        g.fillStyle(0x000000, 1).fillCircle(p.x, p.y, p.radius + 1.5);
        g.fillStyle(p.color, 1).fillCircle(p.x, p.y, p.radius);
        g.fillStyle(0xffe066, 1).fillCircle(p.x - 1.5, p.y - 1.5, p.radius * 0.45);
        break;
      case 'rock':
        g.fillStyle(0x000000, 1).fillCircle(p.x, p.y, p.radius + 2);
        g.fillStyle(0x7a6a5a, 1).fillCircle(p.x, p.y, p.radius);
        g.fillStyle(0x5a4a3a, 1).fillCircle(p.x + p.radius * 0.3, p.y + p.radius * 0.2, p.radius * 0.35);
        g.fillStyle(0xff8a3d, 0.7).fillCircle(p.x - p.vx * 0.02, p.y - p.vy * 0.02, p.radius * 0.8);
        break;
      case 'ice': {
        const r = p.radius;
        g.fillStyle(0xffffff, 0.9).fillTriangle(p.x - r, p.y - r * 2.5, p.x + r, p.y - r * 2.5, p.x, p.y + r);
        g.lineStyle(1, 0x5fa8d3, 1).strokeTriangle(p.x - r, p.y - r * 2.5, p.x + r, p.y - r * 2.5, p.x, p.y + r);
        break;
      }
      case 'spark':
        g.fillStyle(0x000000, 1).fillCircle(p.x, p.y, p.radius + 1.5);
        g.fillStyle(p.color, 1).fillCircle(p.x, p.y, p.radius);
        g.fillStyle(0xffffff, 0.8).fillCircle(p.x - 1, p.y - 1, p.radius * 0.4);
        break;
    }
  }

  destroy(): void {
    this.list.length = 0;
    this.g.destroy();
  }
}
