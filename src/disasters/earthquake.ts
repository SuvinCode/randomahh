import { sfx } from '../audio/sfx';
import { ARENA, DEPTH } from '../config';
import type { DisasterFactory } from './types';

const LIFE_MS = 6000;

/**
 * The ground shakes. Every half second or so, anyone standing on the floor is
 * jolted into the air and takes damage; cracks open and rocks fall from above.
 * Higher `count` = a stronger quake. Ledges are the safe place to be.
 */
export const earthquake: DisasterFactory = (ctx, spec) => {
  const { scene, rng, floorY } = ctx;
  const power = spec.count; // 1..3
  const g = scene.add.graphics().setDepth(DEPTH.disasterBack + 1);
  const cracks = Array.from({ length: 6 + power * 3 }, () => ({ x: rng.between(20, ARENA.width - 20), len: rng.between(10, 30) }));
  let ms = 0;
  let joltMs = 400;

  return {
    update(dt) {
      ms += dt;
      if (ms > LIFE_MS) return false;
      ctx.juice.shake(dt + 20, 0.004 + power * 0.002);
      joltMs -= dt;
      if (joltMs <= 0) {
        joltMs = rng.between(450, 750) / power;
        if (rng.frac() < 0.4) sfx.play('quake');
        for (const f of ctx.fighters()) {
          if (f.onGround && Math.abs(f.bounds().bottom - floorY) < 4) {
            ctx.damage(f, 5 + power * 2, spec.by, { knock: 0, lift: 0 });
            f.fling(rng.between(-160, 160), -rng.between(220, 380));
          }
        }
        // Rocks shaken loose from above.
        ctx.projectiles.fire({
          kind: 'rock', x: rng.between(20, ARENA.width - 20), y: -20, vx: 0, vy: 120, gravity: 900,
          damage: 14, radius: rng.between(6, 10), color: 0x8d7b68, by: spec.by, explodeRadius: 26, lifeMs: 3000,
        });
      }
      g.clear();
      const grow = Math.min(1, ms / 1500) * Math.min(1, (LIFE_MS - ms) / 600);
      g.lineStyle(3, 0x1a1a1a, 0.8);
      for (const c of cracks) {
        g.lineBetween(c.x, floorY, c.x + 6, floorY + c.len * grow * 0.5);
        g.lineBetween(c.x + 6, floorY + c.len * grow * 0.5, c.x - 3, floorY + c.len * grow);
      }
      return true;
    },
    destroy() {
      g.destroy();
    },
  };
};
