import Phaser from 'phaser';
import { sfx } from '../audio/sfx';
import { DEPTH } from '../config';
import { blink, boxHitsRect } from '../battle/geometry';
import type { DisasterFactory } from './types';
import { aimAt } from './types';

const WARN_MS = 700;
const STRIKE_MS = 260;
const WIDTH = 30;

/**
 * A storm cloud gathers and bolts strike fighters one after another: a column
 * flashes over the victim, then the bolt hits it (and arcs to someone close by).
 */
export const lightning: DisasterFactory = (ctx, spec) => {
  const { scene, rng, floorY } = ctx;
  const g = scene.add.graphics().setDepth(DEPTH.disaster);
  const warnG = scene.add.graphics().setDepth(DEPTH.telegraph);
  const bolts: { x: number; ms: number; pts: Phaser.Math.Vector2[]; struck: boolean }[] = [];
  let launched = 0;
  let nextMs = 300;
  let cloudMs = 0;

  const zigzag = (x: number) => {
    const pts: Phaser.Math.Vector2[] = [];
    for (let y = 30; y <= floorY; y += 32) pts.push(new Phaser.Math.Vector2(x + rng.between(-10, 10), Math.min(y, floorY)));
    return pts;
  };

  return {
    update(dt) {
      cloudMs += dt;
      nextMs -= dt;
      if (launched < spec.count && nextMs <= 0) {
        nextMs = rng.between(320, 520);
        const victim = launched === 0 ? aimAt(ctx, spec) : rng.pick(ctx.fighters());
        if (victim) bolts.push({ x: victim.x, ms: 0, pts: [], struck: false });
        launched++;
      }

      g.clear();
      warnG.clear();
      // Dark cloud bank across the top while the storm lasts.
      const fade = Math.min(1, cloudMs / 400);
      g.fillStyle(0x2b2d42, 0.55 * fade).fillRect(0, 0, 960, 34);
      for (let k = 0; k < 12; k++) g.fillStyle(0x3d405b, 0.7 * fade).fillCircle(k * 85 + 30, 28, 34);

      for (let k = bolts.length - 1; k >= 0; k--) {
        const b = bolts[k];
        b.ms += dt;
        if (b.ms < WARN_MS) {
          const a = blink(b.ms, 0.1, 0.3);
          warnG.fillStyle(0xfff275, a).fillRect(b.x - WIDTH / 2, 0, WIDTH, floorY);
          warnG.lineStyle(2, 0xfff275, a * 3).strokeRect(b.x - WIDTH / 2, 0, WIDTH, floorY);
          continue;
        }
        const t = b.ms - WARN_MS;
        if (t > STRIKE_MS) {
          bolts.splice(k, 1);
          continue;
        }
        if (!b.struck) {
          b.struck = true;
          sfx.play('thunder');
          ctx.juice.flash(80, 0xfff6c2);
          ctx.juice.burst(b.x, floorY, 0xfff275, 18);
          const hit = ctx.targets().filter((f) => boxHitsRect(f.bounds(), b.x - WIDTH / 2, 0, WIDTH, floorY));
          hit.forEach((f) => ctx.damage(f, 55, spec.by, { fromX: b.x, knock: 200, lift: 260 }));
          // Arc to the nearest bystander.
          const near = ctx.fighters().filter((f) => !hit.includes(f) && Math.abs(f.x - b.x) < 90);
          if (near[0]) ctx.beam(b.x, near[0].y, near[0].x, near[0].y, 3, 20, spec.by, 0xfff275);
        }
        if (Math.floor(t / 60) !== Math.floor((t - dt) / 60) || !b.pts.length) b.pts = zigzag(b.x);
        const a = 1 - t / STRIKE_MS;
        g.fillStyle(0xfff275, 0.25 * a).fillRect(b.x - WIDTH / 2, 0, WIDTH, floorY);
        g.lineStyle(8, 0xfff275, a).strokePoints(b.pts);
        g.lineStyle(3, 0xffffff, a).strokePoints(b.pts);
      }
      return launched < spec.count || bolts.length > 0;
    },
    destroy() {
      g.destroy();
      warnG.destroy();
    },
  };
};
