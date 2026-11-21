import Phaser from 'phaser';
import { sfx } from '../audio/sfx';
import { ARENA, DEPTH } from '../config';
import type { DisasterFactory } from './types';

const LIFE_MS = 10_000;
const BEAT_MS = 430;
const COLORS = [0xff3d81, 0x3df2ff, 0xfff275, 0x7dff9a, 0xb388ff, 0xff9f43, 0xffffff];

/**
 * Disco! For ten seconds the ledges flash through party colours on the beat, a
 * disco ball spins up top throwing light beams, and fighters hop to the music.
 * Harmless fun (well, the fighting carries on).
 */
export const disco: DisasterFactory = (ctx) => {
  const { scene, rng } = ctx;
  const g = scene.add.graphics().setDepth(DEPTH.disasterBack);
  const ball = scene.add.graphics().setDepth(DEPTH.disaster);
  const ledges = ctx.bodies.platforms.getChildren() as Phaser.GameObjects.Rectangle[];
  const original = ledges.map((r) => r.fillColor);
  let ms = 0;
  let beat = -1;
  let spin = 0;

  const restore = () => ledges.forEach((r, k) => r.active && r.setFillStyle(original[k]));

  return {
    update(dt) {
      ms += dt;
      if (ms > LIFE_MS) {
        restore();
        return false;
      }
      spin += dt * 0.003;
      const b = Math.floor(ms / BEAT_MS);
      if (b !== beat) {
        beat = b;
        sfx.play('beat');
        ledges.forEach((r) => r.active && r.setFillStyle(rng.pick(COLORS)));
        for (const f of ctx.fighters()) if (f.onGround && rng.frac() < 0.6) f.body.setVelocityY(-260);
      }
      const pulse = 1 - (ms % BEAT_MS) / BEAT_MS;
      const fade = Math.min(1, ms / 400, (LIFE_MS - ms) / 400);
      g.clear();
      // Coloured wash and light beams from the ball.
      g.fillStyle(COLORS[beat % COLORS.length], 0.07 * pulse * fade).fillRect(0, 0, ARENA.width, ARENA.height);
      const bx = ARENA.width / 2;
      const by = 56;
      for (let k = 0; k < 10; k++) {
        const a = spin + (k / 10) * Math.PI * 2;
        if (Math.sin(a) < -0.2) continue; // only beams pointing down-ish
        const ex = bx + Math.cos(a) * 900;
        const ey = by + Math.abs(Math.sin(a)) * 900;
        const c = COLORS[(k + beat) % COLORS.length];
        g.fillStyle(c, 0.12 * fade).fillTriangle(bx, by, ex - 40, ey, ex + 40, ey);
      }
      ball.clear();
      ball.lineStyle(2, 0xaaaaaa, fade).lineBetween(bx, 0, bx, by - 24);
      ball.fillStyle(0x000000, fade).fillCircle(bx, by, 26);
      ball.fillStyle(0xcfd8dc, fade).fillCircle(bx, by, 24);
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          if (r * r + c * c > 5) continue;
          const lit = (r + c + beat) % 3 === 0;
          ball.fillStyle(lit ? 0xffffff : 0x90a4ae, fade).fillRect(bx + c * 9 - 4 + ((spin * 20) % 9) - 4, by + r * 9 - 4, 7, 7);
        }
      }
      return true;
    },
    destroy() {
      restore();
      g.destroy();
      ball.destroy();
    },
  };
};
