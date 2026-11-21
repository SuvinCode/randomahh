import Phaser from 'phaser';
import { sfx } from '../audio/sfx';
import { ARENA, DEPTH } from '../config';
import type { DisasterFactory } from './types';
import { aimAt } from './types';

const FUSE_MS = 3000;
const RADIUS = 210;

/**
 * A huge cartoon bomb drops onto the floor, its fuse fizzing and a countdown
 * ticking with a ring showing the blast radius. Then: boom.
 */
export const megaBomb: DisasterFactory = (ctx, spec) => {
  const { scene, rng, floorY } = ctx;
  const g = scene.add.graphics().setDepth(DEPTH.disaster);
  const bombs = Array.from({ length: spec.count }, (_, k) => {
    const near = k === 0 ? aimAt(ctx, spec) : undefined;
    const x = Phaser.Math.Clamp(near ? near.x : rng.between(100, ARENA.width - 100), 40, ARENA.width - 40);
    const text = scene.add
      .text(x, 0, '', { fontFamily: 'monospace', fontSize: '22px', fontStyle: 'bold', color: '#ffffff', stroke: '#000000', strokeThickness: 5 })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.telegraph);
    return { x: k ? ARENA.width - x : x, y: -40, vy: 0, ms: -k * 800, landedAt: -1, done: false, text };
  });

  return {
    update(dt) {
      const s = dt / 1000;
      g.clear();
      let running = false;
      for (const b of bombs) {
        b.ms += dt;
        if (b.done) continue;
        running = true;
        if (b.ms < 0) continue;
        const R = 22;
        if (b.landedAt < 0) {
          b.vy += 1400 * s;
          b.y += b.vy * s;
          if (b.y + R >= floorY) {
            b.y = floorY - R;
            b.landedAt = b.ms;
            ctx.juice.shake(120, 0.004);
          }
        }
        const fuse = b.landedAt < 0 ? 0 : b.ms - b.landedAt;
        if (fuse >= FUSE_MS) {
          b.done = true;
          b.text.destroy();
          ctx.explode(b.x, b.y, RADIUS, 110, spec.by);
          ctx.juice.flash(200, 0xffe8a3);
          sfx.play('explode');
          continue;
        }
        // Blast ring warning once it lands.
        if (b.landedAt >= 0) {
          const a = Math.floor(fuse / (fuse > FUSE_MS - 1000 ? 70 : 160)) % 2 ? 0.25 : 0.7;
          g.lineStyle(3, 0xff3d3d, a).strokeCircle(b.x, b.y, RADIUS);
          g.fillStyle(0xff3d3d, 0.06).fillCircle(b.x, b.y, RADIUS);
          const left = String(Math.ceil((FUSE_MS - fuse) / 1000));
          if (b.text.text !== left) sfx.play('tick'); // one tick per second of countdown
          b.text.setText(left).setPosition(b.x, b.y - R - 18);
        }
        const flash = b.landedAt >= 0 && Math.floor(fuse / 120) % 2 === 0;
        g.fillStyle(0x000000, 1).fillCircle(b.x, b.y, R + 2);
        g.fillStyle(flash ? 0xff3d3d : 0x22223b, 1).fillCircle(b.x, b.y, R);
        g.fillStyle(0xffffff, 0.35).fillCircle(b.x - 8, b.y - 8, 6);
        g.fillStyle(0x555555, 1).fillRect(b.x - 5, b.y - R - 6, 10, 7);
        g.lineStyle(2, 0xc9a66b, 1).lineBetween(b.x, b.y - R - 6, b.x + 6, b.y - R - 14);
        g.fillStyle(0xffd23f, rng.frac()).fillCircle(b.x + 6, b.y - R - 15, 4);
      }
      return running;
    },
    destroy() {
      g.destroy();
      bombs.forEach((b) => b.text.destroy());
    },
  };
};
