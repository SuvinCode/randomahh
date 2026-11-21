import Phaser from 'phaser';
import { sfx } from '../audio/sfx';
import { ARENA, DEPTH } from '../config';
import { boxHitsRect } from '../battle/geometry';
import type { Fighter } from '../fighters/fighter';
import type { DisasterFactory } from './types';
import { aimAt } from './types';

const HOVER_Y = 70;
const SEEK_MS = 1600;
const WARN_MS = 800;
const BEAM_MS = 2600;
const TOP_W = 30;
const BOTTOM_W = 76;
const ATTEMPTS = 2;
/** At most this many abductions per beam. */
const PER_BEAM = 2;

type Phase = 'seek' | 'warn' | 'beam';

/**
 * Flying saucers glide over a fighter. A thin cone flickers (the warning),
 * then the tractor beam switches on and lifts anyone inside it up toward the
 * saucer. Pulled all the way in = abducted (at most two per beam). Each
 * saucer makes two passes, then flies off.
 */
export const ufo: DisasterFactory = (ctx, spec) => {
  const { scene, rng, floorY } = ctx;
  const g = scene.add.graphics().setDepth(DEPTH.disaster);
  const saucers = Array.from({ length: spec.count }, (_, k) => ({
    x: k % 2 ? ARENA.width + 60 : -60,
    phase: 'seek' as Phase,
    ms: -k * 900,
    tries: 0,
    taken: 0,
    victim: (k === 0 ? aimAt(ctx, spec) : undefined) as Fighter | undefined,
    leaving: false,
  }));
  sfx.play('spawn');

  const inBeam = (x: number, f: Fighter) => {
    const b = f.bounds();
    const t = Phaser.Math.Clamp((f.y - HOVER_Y) / (floorY - HOVER_Y), 0, 1);
    const half = (TOP_W + (BOTTOM_W - TOP_W) * t) / 2;
    return boxHitsRect(b, x - half, HOVER_Y + 10, half * 2, floorY - HOVER_Y);
  };

  return {
    update(dt) {
      const s = dt / 1000;
      g.clear();
      let running = false;
      for (const u of saucers) {
        u.ms += dt;
        if (u.ms < 0) {
          running = true;
          continue;
        }
        if (u.leaving) {
          u.x += (u.x < ARENA.width / 2 ? -1 : 1) * 320 * s;
          if (u.x < -80 || u.x > ARENA.width + 80) continue;
          running = true;
          drawSaucer(g, u.x, HOVER_Y, u.ms, false);
          continue;
        }
        running = true;
        if (!u.victim?.alive) {
          const all = ctx.fighters();
          u.victim = all.length ? rng.pick(all) : undefined;
        }
        if (u.phase === 'seek') {
          if (u.victim) u.x += Phaser.Math.Clamp(u.victim.x - u.x, -260 * s, 260 * s);
          if (u.ms > SEEK_MS) [u.phase, u.ms] = ['warn', 0];
        } else if (u.phase === 'warn') {
          const a = Math.floor(u.ms / 90) % 2 ? 0.15 : 0.45;
          g.lineStyle(2, 0x9ef01a, a).lineBetween(u.x - TOP_W / 2, HOVER_Y + 10, u.x - BOTTOM_W / 2, floorY);
          g.lineBetween(u.x + TOP_W / 2, HOVER_Y + 10, u.x + BOTTOM_W / 2, floorY);
          if (u.ms > WARN_MS) {
            [u.phase, u.ms] = ['beam', 0];
            sfx.play('teleport');
          }
        } else {
          // Tractor beam.
          const pulse = 0.25 + 0.08 * Math.sin(u.ms / 60);
          g.fillStyle(0x9ef01a, pulse).fillTriangle(u.x - TOP_W / 2, HOVER_Y + 10, u.x + TOP_W / 2, HOVER_Y + 10, u.x + BOTTOM_W / 2, floorY);
          g.fillTriangle(u.x - TOP_W / 2, HOVER_Y + 10, u.x - BOTTOM_W / 2, floorY, u.x + BOTTOM_W / 2, floorY);
          for (let k = 0; k < 4; k++) {
            const ry = floorY - ((u.ms / 4 + k * 100) % (floorY - HOVER_Y));
            g.lineStyle(2, 0xd8f3dc, 0.5).strokeEllipse(u.x, ry, 30 + (ry - HOVER_Y) * 0.15, 6);
          }
          for (const f of ctx.fighters()) {
            if (u.taken >= PER_BEAM || !inBeam(u.x, f)) continue;
            f.pull((u.x - f.x) * 6, -2400, s);
            if (f.y < HOVER_Y + 30) {
              u.taken++;
              ctx.juice.burst(f.x, f.y, 0x9ef01a, 16);
              ctx.damage(f, 999, spec.by, { knock: 0, lift: 0 });
            }
          }
          if (u.ms > BEAM_MS) {
            u.tries++;
            [u.phase, u.ms] = ['seek', 0];
            u.victim = undefined;
            u.taken = 0;
            if (u.tries >= ATTEMPTS) u.leaving = true;
          }
        }
        drawSaucer(g, u.x, HOVER_Y, u.ms, u.phase === 'beam');
      }
      return running;
    },
    destroy() {
      g.destroy();
    },
  };
};

function drawSaucer(g: Phaser.GameObjects.Graphics, x: number, y: number, ms: number, beaming: boolean): void {
  const bob = Math.sin(ms / 200) * 3;
  y += bob;
  g.fillStyle(0x9be7ff, 0.85).fillEllipse(x, y - 8, 34, 24);
  g.fillStyle(0x000000, 1).fillEllipse(x, y + 1, 84, 22);
  g.fillStyle(0x8d99ae, 1).fillEllipse(x, y, 80, 18);
  g.fillStyle(0x5c677d, 1).fillEllipse(x, y + 4, 60, 8);
  for (let k = 0; k < 5; k++) {
    const on = (Math.floor(ms / 120) + k) % 2 === 0;
    g.fillStyle(on ? 0xffd23f : 0xff5d73, 1).fillCircle(x - 28 + k * 14, y + 1, 3);
  }
  if (beaming) g.fillStyle(0x9ef01a, 1).fillEllipse(x, y + 9, 26, 6);
}
