import Phaser from 'phaser';
import { sfx } from '../audio/sfx';
import { ARENA, DEPTH } from '../config';
import { boxHitsSegment } from '../battle/geometry';
import type { DisasterFactory } from './types';

const RISE_MS = 1200;
const CHARGE_MS = 1300;
const SWEEP_MS = 1700;
const PAUSE_MS = 700;
const SINK_MS = 900;
const HEIGHT = 330;
const HALF = 13;

/**
 * A giant monster rises at the edge of the arena and roars. Its back spines
 * glow purple (the warning), then it breathes a giant purple beam that sweeps
 * across the arena from the far side toward itself, then back again.
 */
export const godzilla: DisasterFactory = (ctx, spec) => {
  const { scene, rng, floorY } = ctx;
  const back = scene.add.graphics().setDepth(DEPTH.disasterBack);
  const beamG = scene.add.graphics().setDepth(DEPTH.disaster);
  const monsters = Array.from({ length: spec.count }, (_, k) => ({
    side: (k === 0 ? (rng.frac() < 0.5 ? -1 : 1) : -1) as 1 | -1,
    ms: -k * 2200,
    tick: 0,
    roared: false,
  }));
  if (spec.count > 1) monsters[1].side = (monsters[0].side * -1) as 1 | -1;
  const total = RISE_MS + CHARGE_MS + SWEEP_MS + PAUSE_MS + SWEEP_MS + SINK_MS;

  return {
    update(dt) {
      back.clear();
      beamG.clear();
      let running = false;
      for (const m of monsters) {
        m.ms += dt;
        if (m.ms < 0) {
          running = true;
          continue;
        }
        if (m.ms > total) continue;
        running = true;
        const t = m.ms;
        const rise =
          t < RISE_MS ? Phaser.Math.Easing.Cubic.Out(t / RISE_MS) : t > total - SINK_MS ? 1 - (t - (total - SINK_MS)) / SINK_MS : 1;
        const baseX = m.side === -1 ? 70 : ARENA.width - 70;
        const top = floorY - HEIGHT * rise + 40;
        const charging = t > RISE_MS && t < RISE_MS + CHARGE_MS;
        const glow = charging ? (Math.floor(t / 90) % 2 ? 0.5 : 1) : t > RISE_MS + CHARGE_MS && t < total - SINK_MS ? 1 : 0;
        const mouth = drawMonster(back, baseX, top, -m.side as 1 | -1, glow, t);

        if (!m.roared && t > RISE_MS * 0.6) {
          m.roared = true;
          sfx.play('roar');
          ctx.juice.shake(700, 0.01);
        }
        // Two sweeps: far → near, then near → far.
        const s1 = RISE_MS + CHARGE_MS;
        const s2 = s1 + SWEEP_MS + PAUSE_MS;
        let p = -1;
        if (t >= s1 && t < s1 + SWEEP_MS) p = (t - s1) / SWEEP_MS;
        else if (t >= s2 && t < s2 + SWEEP_MS) p = 1 - (t - s2) / SWEEP_MS;
        if (p < 0) continue;
        const far = m.side === -1 ? ARENA.width + 40 : -40;
        const near = baseX - m.side * 60;
        const ex = Phaser.Math.Linear(far, near, p);
        const ey = floorY + 6;
        // Extend the beam past the impact point so it reads as one long ray.
        const ang = Math.atan2(ey - mouth.y, ex - mouth.x);
        const lx = mouth.x + Math.cos(ang) * 1400;
        const ly = mouth.y + Math.sin(ang) * 1400;
        beamG.lineStyle(HALF * 3.4, 0x7b2cbf, 0.35).lineBetween(mouth.x, mouth.y, lx, ly);
        beamG.lineStyle(HALF * 2, 0xb388ff, 0.95).lineBetween(mouth.x, mouth.y, lx, ly);
        beamG.lineStyle(HALF * 0.7, 0xffffff, 1).lineBetween(mouth.x, mouth.y, lx, ly);
        beamG.fillStyle(0xe0c3fc, 0.9).fillEllipse(ex, floorY, 70, 18);
        if (rng.frac() < dt / 30) ctx.juice.burst(ex, floorY - 4, 0xb388ff, 5);
        m.tick -= dt;
        if (m.tick <= 0) {
          m.tick = 100;
          for (const tg of ctx.targets()) {
            if (boxHitsSegment(tg.bounds(), mouth.x, mouth.y, lx, ly, HALF)) {
              ctx.damage(tg, 9, spec.by, { fromX: mouth.x, knock: 180, lift: 160 });
            }
          }
        }
      }
      return running;
    },
    destroy() {
      back.destroy();
      beamG.destroy();
    },
  };
};

/** Draw the kaiju facing `dir`; returns where its mouth is. */
function drawMonster(g: Phaser.GameObjects.Graphics, x: number, top: number, dir: 1 | -1, glow: number, t: number): { x: number; y: number } {
  const skin = 0x2d4a2b;
  const belly = 0x4f6f3a;
  const sway = Math.sin(t / 400) * 4;
  // Tail and body.
  g.fillStyle(skin, 1).fillTriangle(x - dir * 40, top + 220, x - dir * 160, top + 330, x - dir * 20, top + 300);
  g.fillStyle(0x000000, 1).fillEllipse(x, top + 190, 160, 300);
  g.fillStyle(skin, 1).fillEllipse(x, top + 190, 152, 292);
  g.fillStyle(belly, 1).fillEllipse(x + dir * 30, top + 210, 70, 220);
  // Spines down the back (glowing purple while charging/firing).
  for (let k = 0; k < 7; k++) {
    const sy = top + 30 + k * 34;
    const sx = x - dir * (60 - Math.abs(k - 2) * 4);
    const size = 26 - Math.abs(k - 2) * 2;
    g.fillStyle(glow > 0 ? 0xb388ff : 0x9aa89a, glow > 0 ? glow : 1).fillTriangle(sx, sy - size / 2, sx, sy + size / 2, sx - dir * size, sy);
    if (glow > 0) g.fillStyle(0xe0c3fc, 0.3 * glow).fillCircle(sx - (dir * size) / 2, sy, size * 0.9);
  }
  // Head with jaw.
  const hx = x + dir * 50;
  const hy = top + 30 + sway;
  g.fillStyle(0x000000, 1).fillEllipse(hx, hy, 110, 62);
  g.fillStyle(skin, 1).fillEllipse(hx, hy, 104, 56);
  g.fillStyle(skin, 1).fillTriangle(hx + dir * 20, hy + 10, hx + dir * 64, hy + 22, hx + dir * 20, hy + 30);
  g.fillStyle(glow > 0 ? 0xe0c3fc : 0xffd23f, 1).fillCircle(hx + dir * 18, hy - 10, 6);
  g.fillStyle(0x000000, 1).fillCircle(hx + dir * 20, hy - 10, 3);
  // Arms.
  g.lineStyle(14, skin, 1).lineBetween(x + dir * 40, top + 130, x + dir * 80, top + 160);
  return { x: hx + dir * 56, y: hy + 14 };
}
