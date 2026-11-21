import { sfx } from '../audio/sfx';
import { ARENA, DEPTH } from '../config';
import { arrowAt } from './warning';
import type { DisasterFactory } from './types';

const LIFE_MS = 10_000;
const GUST_MS = 2600;

/**
 * A blizzard: the arena frosts over and fills with snow, icy gusts shove
 * everyone sideways (arrows warn which way), fighters are slowed and chilled,
 * and icicles drop from above. More `count` = colder and nastier.
 */
export const blizzard: DisasterFactory = (ctx, spec) => {
  const { scene, rng, floorY } = ctx;
  const power = spec.count; // 1..2
  const g = scene.add.graphics().setDepth(DEPTH.disaster);
  const warn = scene.add.graphics().setDepth(DEPTH.telegraph);
  const flakes = Array.from({ length: 160 }, () => ({
    x: rng.between(0, ARENA.width),
    y: rng.between(-ARENA.height, ARENA.height),
    r: rng.realInRange(1, 3),
    v: rng.realInRange(60, 140),
  }));
  let ms = 0;
  let gustDir: 1 | -1 = rng.frac() < 0.5 ? 1 : -1;
  let chillTick = 0;
  let iceMs = 600;
  sfx.play('rumble');

  return {
    update(dt) {
      const s = dt / 1000;
      ms += dt;
      if (ms > LIFE_MS) return false;
      const fade = Math.min(1, ms / 800, (LIFE_MS - ms) / 800);

      // Gusts: 1s warning arrows, then the wind blows; direction flips each cycle.
      const cycle = ms % GUST_MS;
      if (cycle < dt) gustDir = gustDir === 1 ? -1 : 1;
      const blowing = cycle > 900;
      warn.clear();
      if (!blowing) for (const y of [150, 300, 440]) arrowAt(warn, gustDir === 1 ? 24 : ARENA.width - 24, y, gustDir, 0x9be7ff, cycle);

      for (const f of ctx.fighters()) {
        f.chill(300);
        if (blowing) f.push(gustDir * (90 + power * 40) * fade);
      }
      chillTick -= dt;
      if (chillTick <= 0) {
        chillTick = 500;
        ctx.fighters().forEach((f) => ctx.damage(f, 1 + power, spec.by, { knock: 0, lift: 0 }));
      }
      iceMs -= dt;
      if (iceMs <= 0) {
        iceMs = rng.between(250, 500) / power;
        const victim = rng.frac() < 0.5 ? rng.pick(ctx.fighters()) : undefined;
        ctx.projectiles.fire({
          kind: 'ice', x: victim ? victim.x + rng.between(-20, 20) : rng.between(20, ARENA.width - 20), y: -20, vx: 0, vy: 200,
          gravity: 900, damage: 12, radius: 5, color: 0xffffff, by: spec.by, lifeMs: 3000,
        });
      }

      g.clear();
      g.fillStyle(0xdff6ff, 0.16 * fade).fillRect(0, 0, ARENA.width, ARENA.height);
      g.fillStyle(0xffffff, 0.85 * fade).fillRect(0, floorY - 4, ARENA.width, 5);
      for (const fl of flakes) {
        fl.y += fl.v * s;
        fl.x += (blowing ? gustDir * 260 : 30) * s;
        if (fl.y > floorY) fl.y -= floorY + 20;
        if (fl.x > ARENA.width) fl.x -= ARENA.width;
        if (fl.x < 0) fl.x += ARENA.width;
        g.fillStyle(0xffffff, 0.9 * fade).fillCircle(fl.x, fl.y, fl.r);
      }
      return true;
    },
    destroy() {
      g.destroy();
      warn.destroy();
    },
  };
};
