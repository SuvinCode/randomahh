import Phaser from 'phaser';
import { sfx } from '../audio/sfx';
import { ARENA, DEPTH } from '../config';
import type { Fighter } from '../fighters/fighter';
import type { DisasterFactory } from './types';

const APPEAR_MS = 1400;
const SNAP_AT = 1900;
const DUST_MS = 1600;
const END_MS = SNAP_AT + DUST_MS + 1200;
const GEMS = [0xff3b3b, 0xffb703, 0x3a86ff, 0x8338ec, 0x06d6a0, 0xff8fab];

/**
 * A giant golden gauntlet rises over the arena, its gems light up one by one,
 * and it snaps. Half of the fighters (rounded down) fade away into dust.
 */
export const thanosSnap: DisasterFactory = (ctx, spec) => {
  const { scene, rng } = ctx;
  const g = scene.add.graphics().setDepth(DEPTH.disaster);
  let ms = 0;
  let snapped = false;
  let victims: { f: Fighter; at: number; done: boolean }[] = [];
  const x = ARENA.width / 2;
  ctx.announce(`${spec.by.icon} ${spec.by.name}…`, 0xb388ff);

  return {
    update(dt) {
      ms += dt;
      g.clear();
      if (ms < SNAP_AT + 900) {
        const rise = Math.min(1, ms / APPEAR_MS);
        const y = 200 - 60 * Phaser.Math.Easing.Back.Out(rise);
        const gemsLit = Math.min(6, Math.floor((ms / APPEAR_MS) * 6));
        drawGauntlet(g, x, y, ms >= SNAP_AT, gemsLit, Math.min(1, ms / 300));
      }
      if (!snapped && ms >= SNAP_AT) {
        snapped = true;
        sfx.play('snap');
        ctx.juice.flash(250, 0xffffff);
        ctx.juice.shake(250, 0.006);
        ctx.announce('Perfectly balanced.', 0xb388ff);
        const alive = rng.shuffle([...ctx.fighters()]);
        victims = alive.slice(0, Math.floor(alive.length / 2)).map((f, i) => ({ f, at: SNAP_AT + 200 + i * (900 / Math.max(1, alive.length / 2)), done: false }));
      }
      // Dust: each victim crumbles, drifting sideways, then is gone.
      for (const v of victims) {
        if (v.done || ms < v.at || !v.f.alive) continue;
        const t = ms - v.at;
        v.f.sprite.setAlpha(Math.max(0.05, 1 - t / 700));
        if (rng.frac() < dt / 25) ctx.juice.burst(v.f.x + rng.between(-8, 8), v.f.y + rng.between(-12, 12), 0x8d6e63, 2);
        if (t > 700) {
          v.done = true;
          ctx.damage(v.f, 9999, spec.by, { knock: 0, lift: 0 });
        }
      }
      return ms < END_MS;
    },
    destroy() {
      g.destroy();
    },
  };
};

function drawGauntlet(g: Phaser.GameObjects.Graphics, x: number, y: number, snapped: boolean, gems: number, alpha: number): void {
  const gold = 0xe0a526;
  const dark = 0x8a5a12;
  g.fillStyle(0x000000, alpha).fillRoundedRect(x - 52, y - 10, 104, 120, 18);
  g.fillStyle(gold, alpha).fillRoundedRect(x - 48, y - 6, 96, 112, 16);
  g.fillStyle(dark, alpha).fillRect(x - 48, y + 86, 96, 10);
  // Fingers: raised before the snap, folded after.
  for (let k = 0; k < 4; k++) {
    const fx = x - 40 + k * 22;
    const h = snapped ? 18 : 52 - Math.abs(k - 1.5) * 6;
    g.fillStyle(0x000000, alpha).fillRoundedRect(fx - 2, y - h - 4, 20, h + 10, 8);
    g.fillStyle(gold, alpha).fillRoundedRect(fx, y - h - 2, 16, h + 8, 7);
  }
  // Thumb, crossing over after the snap.
  g.fillStyle(gold, alpha).fillRoundedRect(snapped ? x - 30 : x + 46, snapped ? y - 8 : y + 10, 34, 18, 8);
  // Gems: five on the knuckles, one big one on the back of the hand.
  for (let k = 0; k < 6; k++) {
    const gx = k < 5 ? x - 40 + k * 20 + 8 : x;
    const gy = k < 5 ? y + 6 : y + 50;
    const r = k < 5 ? 6 : 11;
    g.fillStyle(0x000000, alpha).fillCircle(gx, gy, r + 2);
    g.fillStyle(k < gems ? GEMS[k] : 0x5a4a2a, alpha).fillCircle(gx, gy, r);
    if (k < gems) g.fillStyle(GEMS[k], 0.25 * alpha).fillCircle(gx, gy, r + 8);
  }
  if (snapped) {
    g.lineStyle(4, 0xffffff, 0.8 * alpha);
    for (let k = 0; k < 6; k++) {
      const a = -Math.PI / 2 + (k - 2.5) * 0.35;
      g.lineBetween(x - 20 + Math.cos(a) * 30, y - 20 + Math.sin(a) * 30, x - 20 + Math.cos(a) * 55, y - 20 + Math.sin(a) * 55);
    }
  }
}
