import type Phaser from 'phaser';
import { sfx } from '../audio/sfx';
import { ARENA, DEPTH } from '../config';
import { arrowAt } from './warning';
import { boxHitsRect } from '../battle/geometry';
import type { Fighter } from '../fighters/fighter';
import type { DisasterFactory } from './types';

const WARN_MS = 1300;
const SPEED = 270;
const HEIGHT = 190;
const LENGTH = 300;

/**
 * Waves roll in from one side and sweep across the whole floor, carrying
 * fighters along and hurting them. High ledges are above the waterline.
 */
export const tsunami: DisasterFactory = (ctx, spec) => {
  const { scene, rng, floorY } = ctx;
  const g = scene.add.graphics().setDepth(DEPTH.disaster);
  const warnG = scene.add.graphics().setDepth(DEPTH.telegraph);
  const waves = Array.from({ length: spec.count }, (_, k) => {
    const dir: 1 | -1 = k % 2 === 0 ? (rng.frac() < 0.5 ? 1 : -1) : -1;
    return { dir, ms: -k * 2200, front: dir === 1 ? -20 : ARENA.width + 20 };
  });
  const tick = new Map<Fighter, number>();

  return {
    update(dt) {
      const s = dt / 1000;
      g.clear();
      warnG.clear();
      let running = false;
      for (const w of waves) {
        w.ms += dt;
        if (w.ms < 0) {
          running = true;
          continue;
        }
        if (w.ms < WARN_MS) {
          running = true;
          arrowAt(warnG, w.dir === 1 ? 24 : ARENA.width - 24, floorY - 60, w.dir, 0x4cc9f0, w.ms);
          arrowAt(warnG, w.dir === 1 ? 24 : ARENA.width - 24, floorY - 140, w.dir, 0x4cc9f0, w.ms);
          continue;
        }
        if (w.ms - dt < WARN_MS) sfx.play('wave'); // here it comes
        w.front += w.dir * SPEED * s;
        const back = w.front - w.dir * LENGTH;
        if ((w.dir === 1 && back > ARENA.width + 20) || (w.dir === -1 && back < -20)) continue;
        running = true;

        // Water body: tall at the front, tapering behind; foam on the crest.
        const left = Math.min(w.front, back);
        const pts: { x: number; y: number }[] = [];
        for (let k = 0; k <= 20; k++) {
          const f = k / 20; // 0 = back, 1 = front
          const x = back + (w.front - back) * f;
          const h = HEIGHT * Math.pow(f, 0.6) * (0.92 + 0.08 * Math.sin(w.ms / 120 + k));
          pts.push({ x, y: floorY - h });
        }
        g.fillStyle(0x1d6fa5, 0.82).beginPath();
        g.moveTo(back, floorY);
        pts.forEach((p) => g.lineTo(p.x, p.y));
        g.lineTo(w.front, floorY);
        g.closePath().fillPath();
        g.lineStyle(5, 0xe0fbfc, 0.9).strokePoints(pts.slice(10) as unknown as Phaser.Math.Vector2[]);

        for (const f of ctx.fighters()) {
          const b = f.bounds();
          if (!boxHitsRect(b, left, floorY - HEIGHT, LENGTH, HEIGHT)) continue;
          const frac = w.dir === 1 ? (f.x - back) / LENGTH : (back - f.x) / LENGTH;
          if (b.bottom < floorY - HEIGHT * Math.pow(Math.max(0, frac), 0.6)) continue; // above the water
          f.push(w.dir * SPEED * 1.1);
          f.pull(0, -1500, s); // buoyancy
          const next = (tick.get(f) ?? 0) - dt;
          if (next <= 0) {
            ctx.damage(f, 10, spec.by, { knock: 0, lift: 0 });
            tick.set(f, 280);
          } else tick.set(f, next);
        }
      }
      return running;
    },
    destroy() {
      g.destroy();
      warnG.destroy();
    },
  };
};
