import Phaser from 'phaser';
import type { BackgroundStyle, Palette } from './theme';
import { ARENA, DEPTH } from '../config';
import { hex } from '../textures';

const W = ARENA.width;
const H = ARENA.height;

/** Shade a colour: amount < 0 darkens, > 0 lightens (percent). */
function shade(color: number, amount: number): number {
  const c = Phaser.Display.Color.IntegerToColor(color);
  return (amount < 0 ? c.darken(-amount) : c.lighten(amount)).color;
}

/**
 * Animated, palette-driven backdrop, one look per `backgroundStyle`. A static
 * layer is drawn once; a light dynamic layer is redrawn each frame. Purely
 * decorative: no physics, always behind the terrain.
 */
export class Background {
  private readonly dyn: Phaser.GameObjects.Graphics;
  private readonly rng = new Phaser.Math.RandomDataGenerator(['random-ahh-bg']);
  private t = 0;
  private readonly sky: number;
  private readonly accent: number;
  private readonly ground: number;
  private readonly bits: { x: number; y: number; r: number; s: number; p: number; layer: number }[] = [];
  private shooting?: { x: number; y: number; life: number };

  constructor(
    scene: Phaser.Scene,
    palette: Palette,
    private readonly style: BackgroundStyle,
  ) {
    this.sky = hex(palette.sky);
    this.accent = hex(palette.accent);
    this.ground = hex(palette.ground);
    const g = scene.add.graphics().setDepth(DEPTH.background);
    this.dyn = scene.add.graphics().setDepth(DEPTH.background + 1);
    this.drawStatic(g);
  }

  private drawStatic(g: Phaser.GameObjects.Graphics): void {
    const { sky, accent, ground, rng } = this;
    const top = shade(sky, -12);
    const bottom = shade(sky, 14);
    g.fillGradientStyle(top, top, bottom, bottom, 1).fillRect(0, 0, W, H);

    switch (this.style) {
      case 'plain':
        for (let i = 0; i < 30; i++) this.bits.push({ x: rng.between(0, W), y: rng.between(0, H), r: rng.realInRange(1, 2.5), s: rng.realInRange(4, 12), p: rng.frac() * 6, layer: 0 });
        break;
      case 'gradient': {
        // Warm horizon band and soft distant hills.
        const glow = shade(sky, 30);
        g.fillGradientStyle(sky, sky, glow, glow, 1).fillRect(0, H * 0.45, W, H * 0.55);
        this.hills(g, shade(ground, -18), 0.62, 70, 0.006, 1.3);
        break;
      }
      case 'stars':
        for (let layer = 0; layer < 3; layer++) {
          for (let i = 0; i < 45; i++) {
            this.bits.push({ x: rng.between(0, W), y: rng.between(0, H - 70), r: 0.6 + layer * 0.6, s: 3 + layer * 5, p: rng.frac() * 6, layer });
          }
        }
        // A faint planet.
        g.fillStyle(accent, 0.12).fillCircle(W * 0.82, H * 0.22, 46);
        g.fillStyle(accent, 0.18).fillCircle(W * 0.82 - 10, H * 0.22 - 8, 30);
        break;
      case 'clouds':
        this.hills(g, shade(ground, -25), 0.7, 60, 0.008, 0.4);
        this.hills(g, shade(ground, -10), 0.78, 45, 0.012, 2.1);
        for (let i = 0; i < 9; i++) {
          this.bits.push({ x: rng.between(0, W), y: rng.between(30, 260), r: rng.realInRange(0.7, 1.3), s: rng.realInRange(6, 18), p: 0, layer: i % 2 });
        }
        break;
      case 'grid': {
        const horizon = H * 0.5;
        g.fillStyle(accent, 0.1).fillRect(0, horizon - 2, W, 4);
        g.fillStyle(accent, 0.06).fillCircle(W / 2, horizon, 160);
        break;
      }
      case 'waves':
        for (let i = 0; i < 18; i++) this.bits.push({ x: rng.between(0, W), y: rng.between(0, H), r: rng.realInRange(2, 5), s: rng.realInRange(15, 40), p: rng.frac() * 6, layer: 0 });
        break;
    }
  }

  /** A band of rolling hills at `yFrac` of the height. */
  private hills(g: Phaser.GameObjects.Graphics, color: number, yFrac: number, amp: number, freq: number, phase: number): void {
    const pts: Phaser.Math.Vector2[] = [new Phaser.Math.Vector2(0, H)];
    for (let x = 0; x <= W; x += 16) {
      pts.push(new Phaser.Math.Vector2(x, H * yFrac - Math.abs(Math.sin(x * freq + phase)) * amp - Math.sin(x * freq * 2.7) * amp * 0.25));
    }
    pts.push(new Phaser.Math.Vector2(W, H));
    g.fillStyle(color, 1).fillPoints(pts, true);
  }

  update(deltaMs: number): void {
    this.t += deltaMs / 1000;
    const { dyn, t, accent } = this;
    dyn.clear();

    switch (this.style) {
      case 'plain':
        for (const b of this.bits) {
          const y = (b.y - t * b.s + H) % H;
          dyn.fillStyle(0xffffff, 0.08 + 0.06 * Math.sin(t + b.p)).fillCircle(b.x + Math.sin(t * 0.5 + b.p) * 6, y, b.r);
        }
        break;
      case 'gradient': {
        const r = 58 + Math.sin(t * 0.8) * 3;
        dyn.fillStyle(accent, 0.15).fillCircle(W * 0.72, H * 0.42, r + 30);
        dyn.fillStyle(accent, 0.55).fillCircle(W * 0.72, H * 0.42, r);
        break;
      }
      case 'stars':
        for (const b of this.bits) {
          const x = (b.x - t * b.s + W) % W;
          dyn.fillStyle(b.layer === 2 && b.p > 5 ? accent : 0xffffff, 0.35 + 0.35 * Math.sin(t * (1.5 + b.layer) + b.p)).fillCircle(x, b.y, b.r);
        }
        if (!this.shooting && this.rng.frac() < deltaMs / 4000) this.shooting = { x: this.rng.between(200, W), y: this.rng.between(20, 160), life: 0 };
        if (this.shooting) {
          const s = this.shooting;
          s.life += deltaMs / 700;
          const hx = s.x - s.life * 360;
          const hy = s.y + s.life * 140;
          dyn.lineStyle(2, 0xffffff, 1 - s.life).lineBetween(hx, hy, hx + 60, hy - 24);
          if (s.life >= 1) this.shooting = undefined;
        }
        break;
      case 'clouds':
        for (const b of this.bits) {
          const x = ((b.x + t * b.s) % (W + 240)) - 120;
          const a = b.layer === 0 ? 0.22 : 0.32;
          dyn.fillStyle(0xffffff, a);
          dyn.fillEllipse(x, b.y, 130 * b.r, 38 * b.r).fillEllipse(x + 38 * b.r, b.y - 14 * b.r, 80 * b.r, 40 * b.r);
          dyn.fillEllipse(x - 34 * b.r, b.y - 6 * b.r, 60 * b.r, 30 * b.r);
        }
        break;
      case 'grid': {
        const horizon = H * 0.5;
        dyn.lineStyle(1, accent, 0.28);
        for (let i = -12; i <= 12; i++) dyn.lineBetween(W / 2 + i * 18, horizon, W / 2 + i * 140, H);
        const scroll = (t * 0.6) % 1;
        for (let k = 0; k < 10; k++) {
          const z = (k + scroll) / 10;
          const y = horizon + (H - horizon) * z * z;
          dyn.lineStyle(1, accent, 0.08 + 0.3 * z).lineBetween(0, y, W, y);
        }
        dyn.lineStyle(1, accent, 0.1);
        for (let x = 0; x <= W; x += 60) dyn.lineBetween(x, 0, x, horizon);
        break;
      }
      case 'waves':
        for (let row = 0; row < 5; row++) {
          const baseY = 150 + row * 70;
          const pts: Phaser.Math.Vector2[] = [];
          for (let x = 0; x <= W; x += 12) {
            pts.push(new Phaser.Math.Vector2(x, baseY + Math.sin(x / 70 + t * (0.8 + row * 0.25) + row) * (8 + row * 2)));
          }
          dyn.lineStyle(3, accent, 0.1 + row * 0.04).strokePoints(pts);
        }
        for (const b of this.bits) {
          const y = (b.y - t * b.s + H * 2) % H;
          dyn.lineStyle(1.5, 0xffffff, 0.25).strokeCircle(b.x + Math.sin(t * 2 + b.p) * 4, y, b.r);
        }
        break;
    }
  }
}
