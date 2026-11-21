import Phaser from 'phaser';
import { sfx } from '../audio/sfx';
import { DEPTH } from '../config';
import { boxHitsRect } from '../battle/geometry';
import type { Fighter } from '../fighters/fighter';
import type { DisasterFactory } from './types';
import { aimAt } from './types';

const TRACK_MS = 1600;
const LOCK_MS = 450;
const FIRE_MS = 1300;
const WIDTH = 44;

/**
 * A satellite locks onto a fighter: a reticle follows them, then stops (run!),
 * then a fat beam from orbit burns down that column, drifting after them slowly.
 */
export const orbitalLaser: DisasterFactory = (ctx, spec) => {
  const { scene, rng, floorY } = ctx;
  const g = scene.add.graphics().setDepth(DEPTH.disaster);
  const warnG = scene.add.graphics().setDepth(DEPTH.telegraph);
  const shots = Array.from({ length: spec.count }, (_, k) => ({
    victim: (k === 0 ? aimAt(ctx, spec) : undefined) as Fighter | undefined,
    x: 480,
    ms: -k * 700,
    fired: false,
    tick: 0,
  }));

  return {
    update(dt) {
      g.clear();
      warnG.clear();
      let running = false;
      for (const s of shots) {
        s.ms += dt;
        if (s.ms < 0) {
          running = true;
          continue;
        }
        if (s.ms > TRACK_MS + LOCK_MS + FIRE_MS) continue;
        running = true;
        if (!s.victim || !s.victim.alive) {
          const all = ctx.fighters();
          s.victim = all.length ? rng.pick(all) : undefined;
          if (s.victim && s.ms < 50) s.x = s.victim.x;
        }
        if (s.ms < 50 && s.victim) s.x = s.victim.x;
        if (s.ms < TRACK_MS && s.victim) s.x += (s.victim.x - s.x) * Math.min(1, dt / 120);

        // Satellite at the top.
        g.fillStyle(0x8d99ae, 1).fillRect(s.x - 8, 6, 16, 12);
        g.fillStyle(0x4361ee, 1).fillRect(s.x - 26, 9, 16, 6).fillRect(s.x + 10, 9, 16, 6);
        g.fillStyle(0xff3d3d, 1).fillCircle(s.x, 20, 3);

        if (s.ms < TRACK_MS + LOCK_MS) {
          const locked = s.ms >= TRACK_MS;
          const a = locked ? (Math.floor(s.ms / 70) % 2 ? 0.4 : 1) : 0.8;
          const y = s.victim && !locked ? s.victim.y : floorY - 20;
          warnG.lineStyle(locked ? 3 : 2, 0xff3d3d, a).strokeCircle(s.x, y, locked ? 16 : 22);
          warnG.lineBetween(s.x - 28, y, s.x + 28, y).lineBetween(s.x, y - 28, s.x, y + 28);
          warnG.lineStyle(1, 0xff3d3d, 0.4).lineBetween(s.x, 20, s.x, floorY);
          continue;
        }
        if (!s.fired) {
          s.fired = true;
          sfx.play('laser');
          ctx.juice.flash(120, 0xff9e9e);
        }
        // Drift slowly toward the victim while firing.
        if (s.victim?.alive) s.x += Phaser.Math.Clamp(s.victim.x - s.x, -1, 1) * 100 * (dt / 1000);
        const t = s.ms - TRACK_MS - LOCK_MS;
        const fade = Math.min(1, (FIRE_MS - t) / 200);
        const wob = Math.sin(t / 30) * 3;
        g.fillStyle(0xff3d3d, 0.35 * fade).fillRect(s.x - WIDTH / 2 - 8, 20, WIDTH + 16, floorY - 20);
        g.fillStyle(0xff8fa3, 0.9 * fade).fillRect(s.x - WIDTH / 2 + wob, 20, WIDTH, floorY - 20);
        g.fillStyle(0xffffff, fade).fillRect(s.x - 6, 20, 12, floorY - 20);
        g.fillStyle(0xffffff, 0.8 * fade).fillEllipse(s.x, floorY, WIDTH * 2, 16);
        if (rng.frac() < dt / 60) ctx.juice.burst(s.x, floorY, 0xff8fa3, 4);
        s.tick -= dt;
        if (s.tick <= 0) {
          s.tick = 120;
          for (const f of ctx.targets()) {
            if (boxHitsRect(f.bounds(), s.x - WIDTH / 2, 0, WIDTH, floorY)) ctx.damage(f, 16, spec.by, { fromX: s.x, knock: 60, lift: 80 });
          }
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
