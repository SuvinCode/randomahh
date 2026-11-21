import Phaser from 'phaser';
import { sfx } from '../audio/sfx';
import { ARENA, DEPTH } from '../config';
import { blink, boxHitsRect } from '../battle/geometry';
import type { BattleContext, Box, Target } from '../battle/types';
import type { DisasterFactory, DisasterSpec } from './types';

const RISE_MS = 1100;
const LIFE_MS = 22_000;
const HP = 45;
const W = 18;
const H = 26;
let zombieId = 200_000;

/**
 * Zombies claw their way out of the floor (hands poke up first: the warning),
 * then shuffle after the nearest fighter and bite. Fighters can fight back:
 * zombies have a little health. Whatever's left crumbles after a while.
 */
class Zombie implements Target {
  readonly id = zombieId++;
  readonly isBoss = true;
  readonly minion = true;
  readonly color = 0x6a994e;
  hp = HP;
  y: number;
  private ms = 0;
  private biteMs = 0;
  private flashMs = 0;
  private dead = false;
  private readonly speed: number;
  private dir: 1 | -1 = 1;

  constructor(
    private readonly ctx: BattleContext,
    private readonly spec: DisasterSpec,
    public x: number,
    delayMs: number,
  ) {
    this.ms = -delayMs;
    this.y = ctx.floorY - H / 2;
    this.speed = ctx.rng.between(50, 85);
  }

  get name(): string {
    return this.spec.by.name;
  }
  get alive(): boolean {
    return !this.dead && this.ms >= RISE_MS;
  }
  get gone(): boolean {
    return this.dead;
  }

  bounds(): Box {
    return { left: this.x - W / 2, right: this.x + W / 2, top: this.ctx.floorY - H, bottom: this.ctx.floorY };
  }

  applyDamage(amount: number, fromX: number): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    this.flashMs = 90;
    this.x += this.x < fromX ? -4 : 4;
    if (this.hp <= 0) {
      this.dead = true;
      return true;
    }
    return false;
  }

  pull(): void {
    /* shambling, stubborn */
  }

  /** Returns false once it has crumbled away. */
  update(dt: number, g: Phaser.GameObjects.Graphics, warn: Phaser.GameObjects.Graphics): boolean {
    if (this.dead) return false;
    this.ms += dt;
    if (this.ms < 0) return true;
    const { ctx } = this;
    const floor = ctx.floorY;
    if (this.ms > LIFE_MS) {
      ctx.juice.burst(this.x, floor - 10, this.color, 10);
      this.dead = true;
      return false;
    }
    this.flashMs = Math.max(0, this.flashMs - dt);

    if (this.ms < RISE_MS) {
      // Warning: dirt mound and grasping hands, then the body rises out.
      const p = this.ms / RISE_MS;
      warn.fillStyle(0x5a3d2b, 1).fillEllipse(this.x, floor, 30, 8);
      warn.lineStyle(2, 0x6a994e, blink(this.ms)).lineBetween(this.x - 6, floor, this.x - 8, floor - 8 - p * 8).lineBetween(this.x + 6, floor, this.x + 8, floor - 8 - p * 8);
      if (p > 0.5) this.draw(g, floor + H * (1 - p) * 2, 0);
      return true;
    }

    // Shuffle toward the nearest fighter (on the floor; they can't climb).
    let nearest: { x: number } | undefined;
    let best = Infinity;
    for (const f of ctx.fighters()) {
      const d = Math.abs(f.x - this.x) + Math.abs(f.y - this.y) * 0.5;
      if (d < best) {
        best = d;
        nearest = f;
      }
    }
    if (nearest) {
      this.dir = nearest.x > this.x ? 1 : -1;
      if (Math.abs(nearest.x - this.x) > 6) this.x += this.dir * this.speed * (dt / 1000);
    }
    this.x = Phaser.Math.Clamp(this.x, 10, ARENA.width - 10);

    this.biteMs -= dt;
    if (this.biteMs <= 0) {
      const b = this.bounds();
      const victim = ctx.fighters().find((f) => boxHitsRect(f.bounds(), b.left - 4, b.top, W + 8, H));
      if (victim) {
        this.biteMs = 700;
        ctx.damage(victim, 7, this.spec.by, { fromX: this.x, knock: 140, lift: 120 });
        if (ctx.rng.frac() < 0.3) sfx.play('groan');
      }
    }
    this.draw(g, floor, Math.sin(this.ms / 120) * 3);
    return true;
  }

  private draw(g: Phaser.GameObjects.Graphics, feet: number, sway: number): void {
    const x = this.x;
    const top = feet - H;
    const body = this.flashMs > 0 ? 0xffffff : this.color;
    g.fillStyle(0x000000, 1).fillRoundedRect(x - W / 2 - 1, top - 1, W + 2, H + 2, 5);
    g.fillStyle(body, 1).fillRoundedRect(x - W / 2, top, W, H, 4);
    g.fillStyle(0x3d5a3d, 1).fillRect(x - W / 2, top + 14, W, 12);
    // Arms out front.
    g.lineStyle(4, body, 1).lineBetween(x + this.dir * 4, top + 11, x + this.dir * 18, top + 9 + sway);
    g.fillStyle(0xff4d4d, 1).fillRect(x + this.dir * 3 - 1, top + 6, 3, 3).fillRect(x + this.dir * 7 - 1, top + 6, 3, 3);
    // Health bar.
    g.fillStyle(0x000000, 0.7).fillRect(x - 10, top - 6, 20, 3);
    g.fillStyle(0x9ef01a, 1).fillRect(x - 10, top - 6, 20 * Math.max(0, this.hp / HP), 3);
  }
}

export const zombieHorde: DisasterFactory = (ctx, spec) => {
  const g = ctx.scene.add.graphics().setDepth(DEPTH.disaster);
  const warn = ctx.scene.add.graphics().setDepth(DEPTH.telegraph);
  const zombies = Array.from({ length: spec.count }, (_, k) => {
    const near = k === 0 && spec.target?.alive ? spec.target.x + ctx.rng.pick([-90, 90]) : ctx.rng.between(30, ARENA.width - 30);
    const z = new Zombie(ctx, spec, Phaser.Math.Clamp(near, 20, ARENA.width - 20), k * 250);
    ctx.addTarget(z);
    return z;
  });
  const live = new Set(zombies);
  sfx.play('groan');

  return {
    update(dt) {
      g.clear();
      warn.clear();
      for (const z of [...live]) {
        if (!z.update(dt, g, warn)) {
          ctx.removeTarget(z);
          live.delete(z);
        }
      }
      return live.size > 0;
    },
    destroy() {
      zombies.forEach((z) => ctx.removeTarget(z));
      g.destroy();
      warn.destroy();
    },
  };
};
