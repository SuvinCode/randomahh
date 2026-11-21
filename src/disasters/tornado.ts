import Phaser from 'phaser';
import { ARENA, DEPTH } from '../config';
import type { Fighter } from '../fighters/fighter';
import type { DisasterFactory } from './types';
import { aimAt } from './types';

const LIFE_MS = 9000;
const HEIGHT = 300;
const RADIUS = 46;

interface Twister {
  x: number;
  vx: number;
  ms: number;
  spin: number;
  debris: { a: number; h: number; r: number }[];
}

/**
 * Twisters touch down and wander along the floor. Anyone caught inside is
 * sucked upward while spinning (taking damage), then flung out of the top.
 */
export const tornado: DisasterFactory = (ctx, spec) => {
  const { scene, rng, floorY } = ctx;
  const g = scene.add.graphics().setDepth(DEPTH.disaster);
  const twisters: Twister[] = Array.from({ length: spec.count }, (_, k) => {
    const near = k === 0 ? aimAt(ctx, spec) : undefined;
    const x = near ? Phaser.Math.Clamp(near.x + rng.between(-140, 140), 60, ARENA.width - 60) : rng.between(80, ARENA.width - 80);
    return {
      x,
      vx: rng.pick([-1, 1]) * rng.between(70, 130),
      ms: -k * 600,
      spin: 0,
      debris: Array.from({ length: 14 }, () => ({ a: rng.frac() * Math.PI * 2, h: rng.frac(), r: rng.between(2, 4) })),
    };
  });
  ctx.juice.shake(300, 0.004);
  const damageTick = new Map<Fighter, number>();

  return {
    update(dt) {
      const s = dt / 1000;
      g.clear();
      let alive = false;
      for (const t of twisters) {
        t.ms += dt;
        if (t.ms < 0 || t.ms > LIFE_MS) continue;
        alive = true;
        // Grow in, shrink out.
        const scale = Math.min(1, t.ms / 600, (LIFE_MS - t.ms) / 600);
        t.spin += s * 9;
        t.x += t.vx * s;
        if (t.x < 50 || t.x > ARENA.width - 50) t.vx *= -1;
        if (rng.frac() < s * 0.6) t.vx = rng.pick([-1, 1]) * rng.between(60, 150);

        const top = floorY - HEIGHT * scale;
        // Funnel: stacked ellipses, narrow at the bottom.
        for (let k = 0; k < 14; k++) {
          const f = k / 13;
          const y = floorY - f * HEIGHT * scale;
          const w = (14 + f * f * 110) * scale;
          const wob = Math.sin(t.spin + f * 5) * 8 * f;
          g.lineStyle(3, k % 2 ? 0xb8c4cc : 0x8a969e, 0.75).strokeEllipse(t.x + wob, y, w, 12 + f * 14);
        }
        for (const d of t.debris) {
          d.a += s * (6 + d.h * 4);
          d.h = (d.h + s * 0.25) % 1;
          const w = (14 + d.h * d.h * 110) * scale * 0.5;
          g.fillStyle(0x6b4f3a, 0.9).fillCircle(t.x + Math.cos(d.a) * w, floorY - d.h * HEIGHT * scale, d.r);
        }

        for (const f of ctx.fighters()) {
          const reach = RADIUS + (floorY - f.y) * 0.22; // wider higher up
          const dx = t.x - f.x;
          if (Math.abs(dx) > reach * scale || f.y < top - 20) continue;
          if (f.y < top + 40) {
            // Spat out of the top.
            f.fling(rng.pick([-1, 1]) * rng.between(320, 480), -rng.between(200, 380));
            continue;
          }
          f.pull(dx * 14, -2600, s);
          const next = (damageTick.get(f) ?? 0) - dt;
          if (next <= 0) {
            ctx.damage(f, 10, spec.by, { fromX: f.x, knock: 0, lift: 0 });
            damageTick.set(f, 250);
          } else damageTick.set(f, next);
        }
      }
      return alive || twisters.some((t) => t.ms < 0);
    },
    destroy() {
      g.destroy();
    },
  };
};
