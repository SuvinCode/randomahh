import Phaser from 'phaser';
import { sfx } from '../audio/sfx';
import { ARENA, DEPTH } from '../config';
import { blink } from '../battle/geometry';
import type { DisasterFactory } from './types';
import { aimAt } from './types';

const WARN_MS = 900;

/**
 * Asteroids streak in from space at an angle. A red target ring marks where
 * each will land; on impact it explodes.
 */
export const asteroids: DisasterFactory = (ctx, spec) => {
  const { scene, rng, floorY } = ctx;
  const warnG = scene.add.graphics().setDepth(DEPTH.telegraph);
  const total = spec.count;
  const marks: { x: number; ms: number; size: number }[] = [];
  let launched = 0;
  let nextMs = 0;

  return {
    update(dt) {
      nextMs -= dt;
      if (launched < total && nextMs <= 0) {
        nextMs = rng.between(250, 600);
        const victim = launched === 0 ? aimAt(ctx, spec) : rng.frac() < 0.6 ? rng.pick(ctx.fighters()) : undefined;
        const x = Phaser.Math.Clamp(victim ? victim.x + rng.between(-30, 30) : rng.between(40, ARENA.width - 40), 30, ARENA.width - 30);
        marks.push({ x, ms: 0, size: rng.between(12, 22) });
        launched++;
      }
      warnG.clear();
      for (let k = marks.length - 1; k >= 0; k--) {
        const m = marks[k];
        m.ms += dt;
        const a = blink(m.ms);
        warnG.lineStyle(2, 0xff3d3d, a).strokeEllipse(m.x, floorY, 60 + m.size * 2, 14);
        warnG.lineStyle(2, 0xff3d3d, a).lineBetween(m.x - 8, floorY - 8, m.x + 8, floorY + 8).lineBetween(m.x - 8, floorY + 8, m.x + 8, floorY - 8);
        if (m.ms >= WARN_MS) {
          marks.splice(k, 1);
          sfx.play('whistle'); // incoming!
          // Launch so it lands on the mark ~0.8s later, coming in at an angle.
          const from = m.x + rng.pick([-1, 1]) * rng.between(150, 350);
          const T = 0.8;
          const startY = -40;
          const vy = (floorY - startY) / T;
          ctx.projectiles.fire({
            kind: 'rock', x: from, y: startY, vx: (m.x - from) / T, vy, damage: 60, radius: m.size,
            color: 0xff8a3d, by: spec.by, explodeRadius: 55 + m.size * 2, lifeMs: 3000,
          });
        }
      }
      return launched < total || marks.length > 0;
    },
    destroy() {
      warnG.destroy();
    },
  };
};
