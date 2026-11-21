import Phaser from 'phaser';
import { sfx } from '../audio/sfx';
import { ARENA, DEPTH } from '../config';
import type { DisasterFactory } from './types';

const WARN_MS = 2600;
const CLOUD_MS = 1400;
const BLACK_MS = 2000;
const FADE_MS = 700;
const SCORCH_MS = 2500;

/**
 * A nuke. Sirens wail and the screen flashes red while the missile falls; on
 * impact there's a blinding flash, a mushroom cloud, and heavy damage to
 * everyone; then the whole arena goes black for two seconds before the dust
 * clears on a scorched floor.
 */
export const nuke: DisasterFactory = (ctx, spec) => {
  const { scene, rng, floorY } = ctx;
  const target = spec.target?.alive ? spec.target.x : ARENA.width / 2 + rng.between(-120, 120);
  const x = Phaser.Math.Clamp(target, 120, ARENA.width - 120);
  const g = scene.add.graphics().setDepth(DEPTH.disaster);
  const warnG = scene.add.graphics().setDepth(DEPTH.telegraph);
  const black = scene.add.rectangle(ARENA.width / 2, ARENA.height / 2, ARENA.width, ARENA.height, 0x000000, 1).setDepth(DEPTH.banner + 10).setAlpha(0);
  let ms = 0;
  let sirenMs = 0;
  let hit = false;
  ctx.announce('☢️ NUKE INCOMING ☢️', 0xff3d3d);

  return {
    update(dt) {
      ms += dt;
      g.clear();
      warnG.clear();
      if (ms < WARN_MS) {
        sirenMs -= dt;
        if (sirenMs <= 0) {
          sirenMs = 1000;
          sfx.play('siren');
        }
        const pulse = 0.08 + 0.1 * Math.abs(Math.sin(ms / 250));
        warnG.fillStyle(0xff0000, pulse).fillRect(0, 0, ARENA.width, ARENA.height);
        // Missile falling toward the target, with a target ring on the floor.
        const p = ms / WARN_MS;
        const my = Phaser.Math.Linear(-60, floorY - 30, p * p);
        warnG.lineStyle(3, 0xff3d3d, Math.floor(ms / 120) % 2 ? 0.4 : 1).strokeEllipse(x, floorY, 120, 22);
        g.fillStyle(0xbbbbbb, 0.5).fillRect(x - 3, my - 140, 6, 110);
        g.fillStyle(0x000000, 1).fillRoundedRect(x - 11, my - 46, 22, 62, 10);
        g.fillStyle(0x6c757d, 1).fillRoundedRect(x - 9, my - 44, 18, 58, 9);
        g.fillStyle(0xffd23f, 1).fillCircle(x, my - 10, 6);
        g.fillStyle(0x000000, 1).fillTriangle(x - 3, my - 12, x + 3, my - 12, x, my - 6);
        g.fillStyle(0xff3d3d, 1).fillTriangle(x - 9, my - 44, x + 9, my - 44, x, my - 70);
        g.fillStyle(0xff9e00, rng.frac()).fillTriangle(x - 6, my + 14, x + 6, my + 14, x, my + 34);
        return true;
      }
      if (!hit) {
        hit = true;
        sfx.play('explode');
        sfx.play('roar');
        ctx.juice.flash(500, 0xffffff);
        ctx.juice.shake(1400, 0.025);
        ctx.juice.explosion(x, floorY - 20, 260, 0xffe066);
        for (const t of ctx.targets()) {
          const d = Math.abs(t.x - x);
          // Everyone gets hurt; closer means worse.
          const dmg = t.isBoss ? 150 : Math.round(45 + 40 * Math.max(0, 1 - d / 500));
          ctx.damage(t, dmg, spec.by, { fromX: x, knock: 500, lift: 420 });
        }
      }
      const t = ms - WARN_MS;
      // Mushroom cloud grows, then the screen goes black, then fades back.
      const grow = Math.min(1, t / CLOUD_MS);
      if (t < CLOUD_MS + BLACK_MS + FADE_MS) drawMushroom(g, x, floorY, grow, t);
      if (t > CLOUD_MS && t < CLOUD_MS + BLACK_MS) black.setAlpha(Math.min(1, (t - CLOUD_MS) / 150));
      else if (t >= CLOUD_MS + BLACK_MS) black.setAlpha(Math.max(0, 1 - (t - CLOUD_MS - BLACK_MS) / FADE_MS));
      // Scorch marks linger after the blackout.
      if (t > CLOUD_MS + BLACK_MS) {
        const left = 1 - (t - CLOUD_MS - BLACK_MS - FADE_MS) / SCORCH_MS;
        if (left > 0) {
          g.fillStyle(0x1a1a1a, 0.6 * Math.min(1, left)).fillEllipse(x, floorY + 2, 420, 30);
          g.fillStyle(0x555555, 0.25 * Math.min(1, left)).fillEllipse(x, floorY - 60, 300, 120);
        }
      }
      return t < CLOUD_MS + BLACK_MS + FADE_MS + SCORCH_MS;
    },
    destroy() {
      g.destroy();
      warnG.destroy();
      black.destroy();
    },
  };
};

function drawMushroom(g: Phaser.GameObjects.Graphics, x: number, floorY: number, grow: number, t: number): void {
  const capY = floorY - 60 - 260 * grow;
  const heat = Math.max(0, 1 - t / 2500);
  const stemColor = Phaser.Display.Color.Interpolate.ColorWithColor(
    Phaser.Display.Color.ValueToColor(0x6d6875),
    Phaser.Display.Color.ValueToColor(0xffb703),
    1,
    heat,
  );
  const stem = Phaser.Display.Color.GetColor(stemColor.r, stemColor.g, stemColor.b);
  // Ground ring.
  g.fillStyle(0xffd6a5, 0.7 * heat + 0.2).fillEllipse(x, floorY - 6, 360 * grow + 40, 40 * grow + 10);
  // Stem.
  g.fillStyle(stem, 0.95).fillRect(x - 26 - 10 * grow, capY + 40, 52 + 20 * grow, floorY - capY - 40);
  // Cap: overlapping puffs.
  const capW = 120 + 170 * grow;
  for (let k = 0; k < 7; k++) {
    const a = (k / 6) * Math.PI;
    const px = x + Math.cos(a) * capW * 0.42;
    const py = capY + 10 - Math.sin(a) * 40 * grow;
    g.fillStyle(k % 2 ? 0xff9e00 : 0xff5d3d, 0.9 * heat + 0.1).fillCircle(px, py, 40 + 30 * grow);
    g.fillStyle(0x6d6875, 0.6 * (1 - heat)).fillCircle(px, py, 40 + 30 * grow);
  }
  g.fillStyle(0xffe066, 0.9 * heat).fillEllipse(x, capY + 10, capW * 0.7, 70 * grow + 20);
  g.fillStyle(0xffffff, 0.6 * heat).fillEllipse(x, capY + 30, 80, 30);
}
