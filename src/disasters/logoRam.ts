import Phaser from 'phaser';
import { sfx } from '../audio/sfx';
import { ARENA, DEPTH } from '../config';
import { blink, boxHitsCircle } from '../battle/geometry';
import type { Target } from '../battle/types';
import type { DisasterFactory } from './types';
import { arrowAt } from './warning';

const WARN_MS = 1300;
const SPEED = 560;
const R = 72;

type Style = 'claude' | 'tanda' | 'badge';

/**
 * A giant logo charges across the arena like a battering ram. Its lane flashes
 * first (with arrows on the side it comes from); then it rolls through,
 * flattening everyone in the way. The label picks the look: "Claude" is an
 * orange spark, "Tanda" a blue badge, anything else a badge with the name.
 */
export const logoRam: DisasterFactory = (ctx, spec) => {
  const { scene, rng, floorY } = ctx;
  const brand = spec.by.name;
  const style: Style = /claude|anthropic/i.test(brand) ? 'claude' : /tanda/i.test(brand) ? 'tanda' : 'badge';
  const warnG = scene.add.graphics().setDepth(DEPTH.telegraph);
  const rams = Array.from({ length: spec.count }, (_, k) => {
    const dir: 1 | -1 = rng.frac() < 0.5 ? 1 : -1;
    // Rolling along the floor, or charging through the middle of the arena.
    const victim = k === 0 && spec.target?.alive ? spec.target : undefined;
    const y = victim ? Phaser.Math.Clamp(victim.y, R + 20, floorY - R + 6) : rng.pick([floorY - R + 6, floorY - R - 150]);
    const g = scene.add.graphics().setDepth(DEPTH.disaster);
    drawLogo(g, style, ctx.colors.hazard);
    const text = scene.add
      .text(0, 0, style === 'claude' ? 'Claude' : style === 'tanda' ? 'tanda' : brand.slice(0, 14), {
        fontFamily: style === 'claude' ? 'Georgia, serif' : 'Arial, sans-serif',
        fontSize: style === 'badge' ? '22px' : '26px',
        fontStyle: 'bold',
        color: style === 'claude' ? '#3d3929' : '#ffffff',
        stroke: style === 'claude' ? '#f5f0e8' : '#000000',
        strokeThickness: style === 'claude' ? 5 : 4,
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.disaster + 1);
    const body = scene.add.container(dir === 1 ? -R * 1.5 : ARENA.width + R * 1.5, y, [g]).setDepth(DEPTH.disaster).setVisible(false);
    text.setVisible(false);
    return { dir, y, ms: -k * 1800, body, g, text, hit: new Set<Target>() };
  });

  return {
    update(dt) {
      warnG.clear();
      let running = false;
      for (const r of rams) {
        r.ms += dt;
        if (r.ms < 0) {
          running = true;
          continue;
        }
        if (r.ms < WARN_MS) {
          running = true;
          const a = blink(r.ms, 0.06, 0.18);
          warnG.fillStyle(ctx.colors.hazard, a).fillRect(0, r.y - R, ARENA.width, R * 2);
          warnG.lineStyle(2, ctx.colors.hazard, a * 4).strokeRect(0, r.y - R, ARENA.width, R * 2);
          arrowAt(warnG, r.dir === 1 ? 28 : ARENA.width - 28, r.y, r.dir, ctx.colors.hazard, r.ms);
          continue;
        }
        const x = r.body.x;
        if ((r.dir === 1 && x > ARENA.width + R * 2) || (r.dir === -1 && x < -R * 2)) {
          r.body.setVisible(false);
          r.text.setVisible(false);
          continue;
        }
        running = true;
        if (!r.body.visible) {
          r.body.setVisible(true);
          r.text.setVisible(true);
          sfx.play('roar');
          ctx.juice.shake(250, 0.006);
        }
        r.body.x += r.dir * SPEED * (dt / 1000);
        r.body.rotation += r.dir * SPEED * (dt / 1000) / R; // rolls
        r.text.setPosition(r.body.x, r.y + (style === 'claude' ? R + 18 : 0));
        if (Math.random() < dt / 40) ctx.juice.burst(r.body.x - r.dir * R, r.y + R - 6, 0xcccccc, 2);
        for (const t of ctx.targets()) {
          if (r.hit.has(t) || !boxHitsCircle(t.bounds(), r.body.x, r.y, R - 6)) continue;
          r.hit.add(t);
          ctx.damage(t, 100, spec.by, { fromX: r.body.x - r.dir * 50, knock: 650, lift: 420 });
        }
      }
      return running;
    },
    destroy() {
      warnG.destroy();
      rams.forEach((r) => {
        r.body.destroy(true);
        r.text.destroy();
      });
    },
  };
};

function drawLogo(g: Phaser.GameObjects.Graphics, style: Style, fallback: number): void {
  if (style === 'claude') {
    // A warm orange spark: tapered rays of slightly uneven length around a centre.
    const orange = 0xd97757;
    g.fillStyle(0xf5f0e8, 1).fillCircle(0, 0, R);
    g.lineStyle(4, 0x3d3929, 1).strokeCircle(0, 0, R);
    const rays = 12;
    for (let k = 0; k < rays; k++) {
      const a = (k / rays) * Math.PI * 2 + (k % 2 ? 0.08 : 0);
      const len = R * (k % 3 === 0 ? 0.86 : k % 3 === 1 ? 0.72 : 0.79);
      const w = 0.2;
      g.fillStyle(orange, 1).fillTriangle(
        Math.cos(a - w) * 10, Math.sin(a - w) * 10,
        Math.cos(a + w) * 10, Math.sin(a + w) * 10,
        Math.cos(a) * len, Math.sin(a) * len,
      );
    }
    g.fillStyle(orange, 1).fillCircle(0, 0, 13);
    return;
  }
  if (style === 'tanda') {
    const blue = 0x2a5bd7;
    g.fillStyle(0x000000, 1).fillCircle(0, 0, R + 3);
    g.fillStyle(blue, 1).fillCircle(0, 0, R);
    g.lineStyle(6, 0xffffff, 0.9).strokeCircle(0, 0, R - 10);
    // Clock ticks: Tanda is all about rostering and time.
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      g.lineStyle(4, 0xffffff, 0.8).lineBetween(Math.cos(a) * (R - 20), Math.sin(a) * (R - 20), Math.cos(a) * (R - 12), Math.sin(a) * (R - 12));
    }
    return;
  }
  g.fillStyle(0x000000, 1).fillCircle(0, 0, R + 3);
  g.fillStyle(fallback, 1).fillCircle(0, 0, R);
  g.lineStyle(5, 0xffffff, 0.85).strokeCircle(0, 0, R - 9);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    g.fillStyle(0xffffff, 0.8).fillCircle(Math.cos(a) * (R - 9), Math.sin(a) * (R - 9), 5);
  }
}
