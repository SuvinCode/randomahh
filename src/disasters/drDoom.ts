import Phaser from 'phaser';
import { sfx } from '../audio/sfx';
import { ARENA, DEPTH } from '../config';
import type { BattleContext, Box, Target } from '../battle/types';
import type { DisasterFactory, DisasterSpec } from './types';

const MAX_HP = 350;
const LIFE_MS = 25_000;
const TRACK_MS = 750;
const LOCK_MS = 380;
let bossId = 100_000;

type Attack = { kind: 'beam'; ms: number; angle: number; victim: Target | null } | { kind: 'ring'; ms: number };

/**
 * An armoured villain in a green cloak flies in, hovers around and blasts the
 * fighters: aimed gauntlet beams (they track, lock, then fire) and rings of
 * magic sparks. Fighters can shoot back; whoever lands the last hit gets the
 * glory. If nobody beats him, he gets bored and teleports away.
 */
class Doom implements Target {
  readonly id = bossId++;
  readonly isBoss = true;
  readonly color = 0x2f9e44;
  hp = MAX_HP;
  x: number;
  y: number;
  private dead = false;
  private ms = 0;
  private flashMs = 0;
  private goal = { x: 0, y: 0 };
  private attackMs = 1500;
  private current: Attack | null = null;
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly fx: Phaser.GameObjects.Graphics;
  private readonly tag: Phaser.GameObjects.Text;

  constructor(
    private readonly ctx: BattleContext,
    private readonly spec: DisasterSpec,
    readonly name: string,
    fromLeft: boolean,
  ) {
    this.x = fromLeft ? -40 : ARENA.width + 40;
    this.y = 120;
    this.pickGoal();
    this.g = ctx.scene.add.graphics().setDepth(DEPTH.disaster);
    this.fx = ctx.scene.add.graphics().setDepth(DEPTH.telegraph);
    this.tag = ctx.scene.add
      .text(0, 0, name, { fontFamily: 'monospace', fontSize: '12px', fontStyle: 'bold', color: '#7dff9a', stroke: '#000000', strokeThickness: 4 })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.tags);
  }

  get alive(): boolean {
    return !this.dead;
  }

  bounds(): Box {
    return { left: this.x - 16, right: this.x + 16, top: this.y - 26, bottom: this.y + 24 };
  }

  applyDamage(amount: number): boolean {
    if (this.dead) return false;
    this.hp -= amount;
    this.flashMs = 90;
    if (this.hp <= 0) {
      this.dead = true;
      return true;
    }
    return false;
  }

  pull(): void {
    /* far too heavy */
  }

  private pickGoal(): void {
    this.goal = { x: this.ctx.rng.between(120, ARENA.width - 120), y: this.ctx.rng.between(90, this.ctx.floorY - 230) };
  }

  /** Returns false when he's gone (beaten or bored). */
  update(dt: number): boolean {
    const { ctx } = this;
    if (this.dead) {
      ctx.explode(this.x, this.y, 110, 30, this.spec.by, this);
      return false;
    }
    this.ms += dt;
    this.flashMs = Math.max(0, this.flashMs - dt);
    if (this.ms > LIFE_MS) {
      ctx.juice.burst(this.x, this.y, 0x7dff9a, 40);
      ctx.announce(`${this.name} got bored and teleported away`, 0x7dff9a);
      return false;
    }
    const s = dt / 1000;
    // Glide toward a waypoint, bobbing.
    const dx = this.goal.x - this.x;
    const dy = this.goal.y - this.y;
    const d = Math.hypot(dx, dy);
    if (d < 10) this.pickGoal();
    else {
      const sp = Math.min(d, 140 * s);
      this.x += (dx / d) * sp;
      this.y += (dy / d) * sp;
    }
    const bob = Math.sin(this.ms / 300) * 4;

    this.attackMs -= dt;
    if (!this.current && this.attackMs <= 0) {
      this.current = ctx.rng.frac() < 0.6 ? { kind: 'beam', ms: 0, angle: 0, victim: null } : { kind: 'ring', ms: 0 };
    }
    this.fx.clear();
    if (this.current) this.runAttack(this.current, dt);

    this.draw(bob);
    this.tag.setPosition(this.x, this.y - 34 + bob);
    return true;
  }

  private runAttack(a: Attack, dt: number): void {
    const { ctx } = this;
    a.ms += dt;
    if (a.kind === 'ring') {
      if (a.ms < 600) {
        this.fx.lineStyle(3, 0x7dff9a, 0.4 + 0.6 * ((a.ms / 100) % 1)).strokeCircle(this.x, this.y, 60 - a.ms / 15);
        return;
      }
      sfx.play('laser');
      const n = 12;
      const off = ctx.rng.frac() * Math.PI;
      for (let k = 0; k < n; k++) {
        const ang = off + (k / n) * Math.PI * 2;
        ctx.projectiles.fire({
          kind: 'spark', x: this.x, y: this.y, vx: Math.cos(ang) * 210, vy: Math.sin(ang) * 210,
          damage: 12, radius: 6, color: 0x7dff9a, by: this.spec.by, owner: this, lifeMs: 3500,
        });
      }
      this.finishAttack();
      return;
    }
    // Beam: track, lock, fire.
    if (!a.victim || !a.victim.alive) {
      const all = ctx.fighters();
      a.victim = all.length ? all.reduce((b, f) => (Math.abs(f.x - this.x) < Math.abs(b.x - this.x) ? f : b)) : null;
      if (!a.victim) return this.finishAttack();
    }
    if (a.ms < TRACK_MS) a.angle = Math.atan2(a.victim.y - this.y, a.victim.x - this.x);
    const ex = this.x + Math.cos(a.angle) * 1300;
    const ey = this.y + Math.sin(a.angle) * 1300;
    if (a.ms < TRACK_MS) {
      this.fx.lineStyle(1, 0x7dff9a, 0.7).lineBetween(this.x, this.y, ex, ey);
    } else if (a.ms < TRACK_MS + LOCK_MS) {
      this.fx.lineStyle(4, 0x7dff9a, Math.floor(a.ms / 70) % 2 ? 0.4 : 1).lineBetween(this.x, this.y, ex, ey);
    } else {
      sfx.play('laser');
      ctx.beam(this.x, this.y, ex, ey, 9, 32, this.spec.by, 0x7dff9a, this);
      this.finishAttack();
    }
  }

  private finishAttack(): void {
    this.current = null;
    this.attackMs = this.ctx.rng.between(900, 1900);
  }

  private draw(bob: number): void {
    const g = this.g;
    const x = this.x;
    const y = this.y + bob;
    g.clear();
    // Jet glow.
    g.fillStyle(0x7dff9a, 0.35 + 0.25 * Math.sin(this.ms / 50)).fillEllipse(x, y + 30, 18, 12);
    // Cloak.
    g.fillStyle(0x000000, 1).fillTriangle(x - 20, y + 26, x + 20, y + 26, x, y - 18);
    g.fillStyle(0x2f9e44, 1).fillTriangle(x - 17, y + 24, x + 17, y + 24, x, y - 15);
    // Armour body and belt.
    g.fillStyle(0x8d99ae, 1).fillRoundedRect(x - 9, y - 6, 18, 26, 4);
    g.fillStyle(0x5c677d, 1).fillRect(x - 9, y + 8, 18, 4);
    // Hood and metal mask.
    g.fillStyle(0x1b6e30, 1).fillCircle(x, y - 14, 12);
    g.fillStyle(this.flashMs > 0 ? 0xffffff : 0xadb5bd, 1).fillRoundedRect(x - 8, y - 21, 16, 17, 4);
    g.fillStyle(0x111111, 1).fillRect(x - 6, y - 16, 4, 2).fillRect(x + 2, y - 16, 4, 2).fillRect(x - 3, y - 9, 6, 2);
    // Health bar.
    const w = 44;
    g.fillStyle(0x000000, 0.8).fillRect(x - w / 2 - 1, y - 33, w + 2, 6);
    g.fillStyle(0x7dff9a, 1).fillRect(x - w / 2, y - 32, w * Math.max(0, this.hp / MAX_HP), 4);
  }

  destroy(): void {
    this.dead = true;
    this.g.destroy();
    this.fx.destroy();
    this.tag.destroy();
  }
}

export const drDoom: DisasterFactory = (ctx, spec) => {
  const bosses = Array.from({ length: spec.count }, (_, k) => {
    const name = spec.count > 1 ? `${spec.by.name} ${k + 1}` : spec.by.name;
    const b = new Doom(ctx, spec, name, k % 2 === 0);
    ctx.addTarget(b);
    return b;
  });
  ctx.announce(`${spec.by.icon} ${spec.by.name} has arrived!`, 0x7dff9a);
  const live = new Set(bosses);

  return {
    update(dt) {
      for (const b of [...live]) {
        if (!b.update(dt)) {
          ctx.removeTarget(b);
          b.destroy();
          live.delete(b);
        }
      }
      return live.size > 0;
    },
    destroy() {
      bosses.forEach((b) => {
        ctx.removeTarget(b);
        b.destroy();
      });
    },
  };
};
