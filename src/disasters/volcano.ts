import Phaser from 'phaser';
import { sfx } from '../audio/sfx';
import { ARENA, DEPTH } from '../config';
import { blink, boxHitsRect } from '../battle/geometry';
import type { DisasterFactory } from './types';
import { aimAt } from './types';

const RISE_MS = 1400;
const ERUPT_MS = 8000;
const SINK_MS = 800;
const W = 150;
const H = 95;

/**
 * A volcano pushes up out of the floor (cracks glow while it rises), then
 * erupts lava bombs in every direction. Standing in the crater burns.
 */
export const volcano: DisasterFactory = (ctx, spec) => {
  const { scene, rng, floorY } = ctx;
  const back = scene.add.graphics().setDepth(DEPTH.disasterBack);
  const front = scene.add.graphics().setDepth(DEPTH.telegraph);
  const cones = Array.from({ length: spec.count }, (_, k) => {
    const near = k === 0 ? aimAt(ctx, spec) : undefined;
    const x = near ? near.x : rng.between(120, ARENA.width - 120);
    return { x: Phaser.Math.Clamp(x + k * 300, W / 2, ARENA.width - W / 2), ms: -k * 500, fireMs: 0, burnMs: 0 };
  });
  ctx.juice.shake(RISE_MS, 0.005);

  return {
    update(dt) {
      back.clear();
      front.clear();
      let running = false;
      for (const c of cones) {
        c.ms += dt;
        const total = RISE_MS + ERUPT_MS + SINK_MS;
        if (c.ms < 0 || c.ms > total) continue;
        running = true;
        if (c.ms < RISE_MS) {
          // Warning: glowing cracks in the floor, flashing.
          const a = blink(c.ms);
          front.lineStyle(3, 0xff5a1f, a);
          for (let k = -3; k <= 3; k++) front.lineBetween(c.x + k * 18, floorY, c.x + k * 24 + rng.between(-4, 4), floorY - 10);
        }
        const rise = Math.min(1, c.ms / RISE_MS) * Math.min(1, (total - c.ms) / SINK_MS);
        const h = H * rise;
        back.fillStyle(0x3d2b24, 1).fillTriangle(c.x - W / 2, floorY, c.x + W / 2, floorY, c.x, floorY - h - 18);
        back.fillStyle(0x5a3d30, 1).fillTriangle(c.x - W / 4, floorY, c.x + W / 6, floorY, c.x - 4, floorY - h - 10);
        back.fillStyle(0xff5a1f, 1).fillEllipse(c.x, floorY - h, 40 * rise, 12 * rise);

        const erupting = c.ms > RISE_MS && c.ms < RISE_MS + ERUPT_MS;
        if (!erupting) continue;
        sfx.play('erupt'); // booms while it erupts (throttled)
        back.fillStyle(0xffb347, 0.6).fillEllipse(c.x, floorY - h - 6, 50, 24);
        c.fireMs -= dt;
        if (c.fireMs <= 0) {
          c.fireMs = rng.between(120, 220);
          const a = -Math.PI / 2 + rng.realInRange(-0.9, 0.9);
          const v = rng.between(380, 760);
          ctx.projectiles.fire({
            kind: 'lava', x: c.x, y: floorY - h, vx: Math.cos(a) * v, vy: Math.sin(a) * v, gravity: 900,
            damage: 22, radius: rng.between(5, 8), color: 0xff5a1f, by: spec.by, explodeRadius: 32, lifeMs: 4000,
          });
        }
        if (rng.frac() < dt / 900) ctx.juice.shake(150, 0.003);
        // Standing in the crater burns.
        c.burnMs -= dt;
        if (c.burnMs <= 0) {
          c.burnMs = 300;
          for (const f of ctx.fighters()) {
            if (boxHitsRect(f.bounds(), c.x - W / 4, floorY - h - 20, W / 2, h + 20)) {
              ctx.damage(f, 9, spec.by, { fromX: c.x, knock: 260, lift: 380 });
            }
          }
        }
      }
      return running || cones.some((c) => c.ms < 0);
    },
    destroy() {
      back.destroy();
      front.destroy();
    },
  };
};
