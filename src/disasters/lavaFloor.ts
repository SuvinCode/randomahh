import { sfx } from '../audio/sfx';
import { DEPTH } from '../config';
import type { Fighter } from '../fighters/fighter';
import type { DisasterFactory } from './types';

const WARN_MS = 1600;
const LAVA_MS = 10_000;
const COOL_MS = 700;

/**
 * The floor is lava! The floor glows and flashes first (fighters start heading
 * for the ledges), then for ten seconds anyone touching it gets burned and
 * hops up in a hurry. Ledges are safe.
 */
export const lavaFloor: DisasterFactory = (ctx, spec) => {
  const { scene, rng, terrain } = ctx;
  const g = scene.add.graphics().setDepth(DEPTH.crate - 1);
  const bubbles = Array.from({ length: 26 }, () => ({ x: rng.between(0, 960), t: rng.frac() * 1000, r: rng.between(3, 8) }));
  const touched = new Map<Fighter, number>();
  let ms = 0;
  ctx.effects.lavaFloor = true;
  ctx.announce('🔥 The floor is LAVA!', 0xff6b1a);

  return {
    update(dt) {
      ms += dt;
      g.clear();
      const total = WARN_MS + LAVA_MS + COOL_MS;
      if (ms > total) {
        ctx.effects.lavaFloor = false;
        return false;
      }
      if (ms > WARN_MS + LAVA_MS) ctx.effects.lavaFloor = false;
      for (const gr of terrain.ground) {
        if (ms < WARN_MS) {
          // Warning: the floor glows hotter and hotter, flashing.
          const p = ms / WARN_MS;
          const a = (Math.floor(ms / 110) % 2 ? 0.25 : 0.55) * p;
          g.fillStyle(0xff6b1a, a).fillRect(gr.x, gr.y, gr.width, gr.height);
          continue;
        }
        const cool = ms > WARN_MS + LAVA_MS ? 1 - (ms - WARN_MS - LAVA_MS) / COOL_MS : 1;
        g.fillStyle(0xc1121f, 0.95 * cool).fillRect(gr.x, gr.y, gr.width, gr.height);
        g.fillStyle(0xff6b1a, 0.9 * cool).fillRect(gr.x, gr.y, gr.width, 10);
        g.fillStyle(0xffd23f, 0.8 * cool);
        for (let x = gr.x; x < gr.x + gr.width; x += 24) {
          g.fillCircle(x + 12 + Math.sin(ms / 200 + x) * 4, gr.y + 4 + Math.sin(ms / 160 + x * 0.3) * 2, 6);
        }
        for (const b of bubbles) {
          const t = ((ms + b.t) % 1000) / 1000;
          g.fillStyle(0xffd23f, (1 - t) * 0.9 * cool).fillCircle(b.x, gr.y - t * 18, b.r * (1 - t * 0.5));
        }
      }
      if (ms < WARN_MS || ms > WARN_MS + LAVA_MS) return true;
      if (rng.frac() < dt / 220) sfx.play('bubble'); // blub… blub

      for (const f of ctx.fighters()) {
        const b = f.body;
        const onLava = f.onGround && terrain.ground.some((gr) => Math.abs(b.bottom - gr.y) < 4 && b.right > gr.x && b.left < gr.x + gr.width);
        const next = (touched.get(f) ?? 0) - dt;
        touched.set(f, next);
        if (!onLava || next > 0) continue;
        touched.set(f, 380);
        ctx.damage(f, 6, spec.by, { knock: 0, lift: 0 });
        if (!f.alive) continue; // burned up: their body is gone
        f.body.setVelocityY(-rng.between(480, 560));
        if (rng.frac() < 0.4) ctx.juice.burst(f.x, b.bottom, 0xff6b1a, 6);
      }
      return true;
    },
    destroy() {
      ctx.effects.lavaFloor = false;
      g.destroy();
    },
  };
};
