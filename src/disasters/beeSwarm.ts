import Phaser from 'phaser';
import { sfx } from '../audio/sfx';
import { ARENA, DEPTH } from '../config';
import { blink, boxHitsCircle } from '../battle/geometry';
import type { Fighter } from '../fighters/fighter';
import type { DisasterFactory } from './types';
import { aimAt } from './types';

const HIVE_MS = 900;
const LIFE_MS = 12_000;
const RADIUS = 42;
const SPEED = 150;

/**
 * A hive drops in and wobbles (the warning), then a buzzing cloud of bees
 * bursts out and chases one fighter after another, stinging anyone in it.
 * They lose interest every few seconds and pick someone new.
 */
export const beeSwarm: DisasterFactory = (ctx, spec) => {
  const { scene, rng } = ctx;
  const g = scene.add.graphics().setDepth(DEPTH.disaster);
  const warn = scene.add.graphics().setDepth(DEPTH.telegraph);
  const swarms = Array.from({ length: spec.count }, (_, k) => {
    const x = rng.between(120, ARENA.width - 120);
    return {
      x,
      y: 60,
      ms: -k * 700,
      victim: (k === 0 ? aimAt(ctx, spec) : undefined) as Fighter | undefined,
      retargetMs: 4000,
      stingMs: 0,
      bees: Array.from({ length: 32 }, () => ({ a: rng.frac() * Math.PI * 2, r: rng.between(6, RADIUS), w: rng.realInRange(3, 7) })),
    };
  });

  return {
    update(dt) {
      const s = dt / 1000;
      g.clear();
      warn.clear();
      let running = false;
      for (const sw of swarms) {
        sw.ms += dt;
        if (sw.ms < 0) {
          running = true;
          continue;
        }
        if (sw.ms > HIVE_MS + LIFE_MS) continue;
        running = true;
        if (sw.ms < HIVE_MS) {
          // Wobbling hive with a flashing ring: they're coming.
          const wob = Math.sin(sw.ms / 40) * 4;
          warn.fillStyle(0xe9a23b, 1).fillEllipse(sw.x + wob, sw.y, 30, 36);
          warn.lineStyle(2, 0x7a4a12, 1).lineBetween(sw.x - 14 + wob, sw.y - 6, sw.x + 14 + wob, sw.y - 6).lineBetween(sw.x - 14 + wob, sw.y + 6, sw.x + 14 + wob, sw.y + 6);
          warn.lineStyle(2, 0xffd23f, blink(sw.ms)).strokeCircle(sw.x, sw.y, 30);
          continue;
        }
        const life = sw.ms - HIVE_MS;
        sw.retargetMs -= dt;
        if (!sw.victim?.alive || sw.retargetMs <= 0) {
          const all = ctx.fighters();
          sw.victim = all.length ? rng.pick(all) : undefined;
          sw.retargetMs = rng.between(3000, 5000);
        }
        if (sw.victim) {
          const dx = sw.victim.x - sw.x;
          const dy = sw.victim.y - sw.y;
          const d = Math.hypot(dx, dy) || 1;
          const step = Math.min(d, SPEED * s);
          sw.x += (dx / d) * step + Math.sin(life / 150) * 40 * s;
          sw.y += (dy / d) * step + Math.cos(life / 170) * 30 * s;
        }
        sw.x = Phaser.Math.Clamp(sw.x, 10, ARENA.width - 10);
        sw.stingMs -= dt;
        if (sw.stingMs <= 0) {
          sw.stingMs = 260;
          let stung = false;
          for (const f of ctx.fighters()) {
            if (boxHitsCircle(f.bounds(), sw.x, sw.y, RADIUS)) {
              ctx.damage(f, 4, spec.by, { knock: 0, lift: 0 });
              stung = true;
            }
          }
          if (stung) sfx.play('buzz');
        }
        const fade = Math.min(1, (LIFE_MS - life) / 600);
        for (const b of sw.bees) {
          b.a += b.w * s;
          const bx = sw.x + Math.cos(b.a) * b.r;
          const by = sw.y + Math.sin(b.a * 1.3) * b.r * 0.7;
          g.fillStyle(0x000000, fade).fillEllipse(bx, by, 10, 7, 8);
          g.fillStyle(0xffd23f, fade).fillEllipse(bx, by, 7, 4, 8);
          g.fillStyle(0x000000, fade).fillRect(bx - 1, by - 2, 2, 4);
          g.fillStyle(0xffffff, 0.7 * fade).fillCircle(bx - 1, by - 3, 2);
        }
      }
      return running;
    },
    destroy() {
      g.destroy();
      warn.destroy();
    },
  };
};
