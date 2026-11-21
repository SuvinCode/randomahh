import Phaser from 'phaser';
import { sfx } from '../audio/sfx';
import { ARENA, DEPTH } from '../config';
import { blink, boxHitsCircle } from '../battle/geometry';
import type { Fighter } from '../fighters/fighter';
import type { DisasterFactory } from './types';
import { aimAt } from './types';

const OPEN_MS = 1100;
const LIFE_MS = 6500;
const CORE = 20;
const RANGE = 440;

/**
 * A black hole tears open above the arena and drags every fighter toward it.
 * Touching the core shreds them (big damage) and spits them out. When it
 * collapses it goes bang.
 */
export const blackHole: DisasterFactory = (ctx, spec) => {
  const { scene, rng, floorY } = ctx;
  const g = scene.add.graphics().setDepth(DEPTH.disaster);
  const holes = Array.from({ length: spec.count }, (_, k) => {
    const near = k === 0 ? aimAt(ctx, spec) : undefined;
    const x = near ? Phaser.Math.Clamp(near.x, 120, ARENA.width - 120) : rng.between(150, ARENA.width - 150);
    return { x: k ? ARENA.width - x : x, y: rng.between(150, floorY - 200), ms: -k * 900, spin: 0, gone: false, ate: new Map<Fighter, number>() };
  });

  return {
    update(dt) {
      const s = dt / 1000;
      g.clear();
      let running = false;
      for (const h of holes) {
        h.ms += dt;
        if (h.ms < 0) {
          running = true;
          continue;
        }
        if (h.gone) continue;
        if (h.ms > LIFE_MS) {
          h.gone = true;
          ctx.explode(h.x, h.y, 130, 35, spec.by);
          sfx.play('explode');
          continue;
        }
        running = true;
        h.spin += s * 4;
        const size = Math.min(1, h.ms / OPEN_MS) * (h.ms > LIFE_MS - 500 ? 1 + (h.ms - (LIFE_MS - 500)) / 400 : 1);
        if (h.ms < OPEN_MS) g.lineStyle(3, ctx.colors.hazard, blink(h.ms)).strokeCircle(h.x, h.y, CORE + 40);

        // Accretion disc and lensing rings.
        for (let r = 0; r < 5; r++) {
          g.lineStyle(4 - r * 0.5, r % 2 ? 0x9d4edd : 0xff9e00, 0.75 - r * 0.12);
          g.beginPath();
          g.arc(h.x, h.y, (CORE + 10 + r * 14) * size, h.spin * (r % 2 ? -1.3 : 1) + r, h.spin * (r % 2 ? -1.3 : 1) + r + Math.PI * 1.3);
          g.strokePath();
        }
        g.fillStyle(0x000000, 1).fillCircle(h.x, h.y, CORE * size + 3);
        g.lineStyle(2, 0xffffff, 0.6).strokeCircle(h.x, h.y, CORE * size + 3);
        if (h.ms < OPEN_MS) continue;

        for (const f of ctx.fighters()) {
          const dx = h.x - f.x;
          const dy = h.y - f.y;
          const d = Math.hypot(dx, dy);
          if (d < RANGE) {
            // Strong near the core, weak far away: fighters at the edges can run for it.
            const strength = 1500 * Math.pow(1 - d / RANGE, 2) + 150;
            // Pull plus a little swirl, and cancel most of gravity so they float in.
            f.pull((dx / d) * strength - (dy / d) * 300, (dy / d) * strength - 900, s);
          }
          // The core shreds them and spits them out: 55 damage and a hard fling.
          const now = h.ms;
          if (boxHitsCircle(f.bounds(), h.x, h.y, CORE * size) && now - (h.ate.get(f) ?? -1e9) > 2000) {
            h.ate.set(f, now);
            const a = rng.frac() * Math.PI * 2;
            ctx.damage(f, 55, spec.by, { knock: 0, lift: 0 });
            f.fling(Math.cos(a) * 520, -Math.abs(Math.sin(a)) * 520 - 150);
          }
        }
      }
      return running;
    },
    destroy() {
      g.destroy();
    },
  };
};
