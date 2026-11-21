import Phaser from 'phaser';
import { sfx } from '../audio/sfx';
import { ARENA, DEPTH } from '../config';
import { blink, boxHitsRect } from '../battle/geometry';
import type { Fighter } from '../fighters/fighter';
import type { DisasterFactory } from './types';
import { aimAt } from './types';

const AIM_MS = 700;
const LOCK_MS = 650;
const DROP_MS = 130;
const STAY_MS = 450;
const LIFT_MS = 400;
const HALF = 70;

/**
 * A giant foot from the sky. Its shadow follows a fighter, stops (run!), and
 * the foot stomps the whole column flat, knocking nearby fighters flying.
 * `count` stomps, one after another.
 */
export const giantStomp: DisasterFactory = (ctx, spec) => {
  const { scene, rng, floorY } = ctx;
  const g = scene.add.graphics().setDepth(DEPTH.disaster);
  const warn = scene.add.graphics().setDepth(DEPTH.telegraph);
  const stomps = Array.from({ length: spec.count }, (_, k) => ({
    ms: -k * 1700,
    x: ARENA.width / 2,
    victim: (k === 0 ? aimAt(ctx, spec) : undefined) as Fighter | undefined,
    landed: false,
    flip: rng.frac() < 0.5,
  }));
  const total = AIM_MS + LOCK_MS + DROP_MS + STAY_MS + LIFT_MS;

  return {
    update(dt) {
      g.clear();
      warn.clear();
      let running = false;
      for (const st of stomps) {
        st.ms += dt;
        if (st.ms < 0) {
          running = true;
          continue;
        }
        if (st.ms > total) continue;
        running = true;
        if (st.ms < AIM_MS) {
          if (!st.victim?.alive) {
            const all = ctx.fighters();
            st.victim = all.length ? rng.pick(all) : undefined;
          }
          if (st.victim) st.x = Phaser.Math.Clamp(st.x + (st.victim.x - st.x) * Math.min(1, dt / 90), HALF, ARENA.width - HALF);
        }
        const t = st.ms;
        const prep = Math.min(1, t / (AIM_MS + LOCK_MS));
        if (t < AIM_MS + LOCK_MS) {
          warn.fillStyle(0x000000, 0.2 + 0.35 * prep).fillEllipse(st.x, floorY, HALF * 2 * (0.5 + 0.5 * prep), 16);
          warn.lineStyle(2, 0xff3d3d, t > AIM_MS ? blink(t) : 0.5).strokeRect(st.x - HALF, 0, HALF * 2, floorY);
        }
        // Foot height: hidden above, slams down, stays, lifts.
        let footBottom: number;
        const d0 = AIM_MS + LOCK_MS;
        if (t < d0) footBottom = -20;
        else if (t < d0 + DROP_MS) footBottom = Phaser.Math.Linear(-20, floorY, (t - d0) / DROP_MS);
        else if (t < d0 + DROP_MS + STAY_MS) footBottom = floorY;
        else footBottom = Phaser.Math.Linear(floorY, -40, (t - d0 - DROP_MS - STAY_MS) / LIFT_MS);

        if (!st.landed && t >= d0 + DROP_MS) {
          st.landed = true;
          sfx.play('explode');
          ctx.juice.shake(300, 0.016);
          ctx.juice.burst(st.x - HALF, floorY - 4, 0x8d7b68, 14);
          ctx.juice.burst(st.x + HALF, floorY - 4, 0x8d7b68, 14);
          for (const tg of ctx.targets()) {
            const b = tg.bounds();
            if (boxHitsRect(b, st.x - HALF, 0, HALF * 2, floorY)) ctx.damage(tg, 80, spec.by, { fromX: st.x, knock: 300, lift: 200 });
            else if (Math.abs(tg.x - st.x) < HALF + 130 && b.bottom > floorY - 40) {
              ctx.damage(tg, 10, spec.by, { fromX: st.x, knock: 420, lift: 360 });
            }
          }
        }
        if (footBottom > -20) drawFoot(g, st.x, footBottom, st.flip);
      }
      return running;
    },
    destroy() {
      g.destroy();
      warn.destroy();
    },
  };
};

function drawFoot(g: Phaser.GameObjects.Graphics, x: number, bottom: number, flip: boolean): void {
  const skin = 0xe0ac69;
  const d = flip ? -1 : 1;
  // Leg up to the top of the screen.
  g.fillStyle(0x000000, 1).fillRect(x - 42, -10, 84, bottom - 30);
  g.fillStyle(skin, 1).fillRect(x - 39, -10, 78, bottom - 32);
  // Foot and toes.
  g.fillStyle(0x000000, 1).fillRoundedRect(x - HALF - 2, bottom - 44, HALF * 2 + 4, 46, 16);
  g.fillStyle(skin, 1).fillRoundedRect(x - HALF, bottom - 42, HALF * 2, 42, 14);
  for (let k = 0; k < 5; k++) {
    const tx = x + d * (HALF - 10 - k * 13);
    g.fillStyle(0x000000, 1).fillCircle(tx, bottom - 8, 8 - k * 0.6);
    g.fillStyle(0xf3c98b, 1).fillCircle(tx, bottom - 8, 6.5 - k * 0.6);
  }
  g.fillStyle(0xc68642, 0.6).fillRect(x - 39, bottom - 50, 78, 6);
}
